import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readEvents } from '../events.ts'
import { makeJob, writeBlindPass, writeReport } from '../job-fixture.ts'
import { loadJob, saveJob, stateDir, type Job } from '../job.ts'
import { loadSeal } from '../seal.ts'
import { git } from '../shell.ts'
import { Refusal } from './common.ts'
import { planRouting } from '../routing.ts'
import { review, reviewReport } from './review.ts'

let root = ''
let tree = ''
let handoff = ''
let base = ''

const put = (path: string, text = 'x\n') => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
const commit = async (...paths: string[]) => {
  for (const path of paths) put(join(tree, path), `${path} ${Math.random()}\n`)
  await git(tree, 'add', '--', ...paths)
  await git(tree, 'commit', '--quiet', '-m', paths.join(' '))
  return git(tree, 'rev-parse', 'HEAD')
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-review-root-'))
  tree = mkdtempSync(join(tmpdir(), 'factory-review-tree-'))
  handoff = join(tree, 'factory', '.jobs', '7')
  await git(tree, 'init', '--quiet')
  await git(tree, 'config', 'user.email', 'test@example.com')
  await git(tree, 'config', 'user.name', 'Test')
  await git(tree, 'config', 'commit.gpgsign', 'false')
  base = await commit('README.md')
  await commit('apps/web/src/icon.ts', 'apps/web/e2e/icons.spec.ts')
  put(join(handoff, 'issue.md'), '# Add a thing (#7)\n')
  put(join(handoff, 'build-notes.md'), '# Notes\n')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(tree, { recursive: true, force: true })
})

const save = (overrides: Partial<Job> = {}) =>
  saveJob(root, makeJob({ worktree: tree, base, ...overrides }))

/** Plans pass 1, writes each reviewer's reports, unseals and records the round. */
const afterFirstPass = async (verdicts: { evaluator: string; 'test-reviewer': string }) => {
  save()
  const plan = await review(root, 7)
  for (const [role, verdict] of Object.entries(verdicts)) {
    writeBlindPass(root, 7, 1, role)
    put(join(handoff, 'reviews', `1.${role}.md`), `Verdict: ${verdict}\n`)
  }
  const { unseal } = await import('../seal.ts')
  unseal(root, 7)
  put(join(handoff, 'reviews', '1.findings.md'), '# Findings\n')
  saveJob(root, { ...loadJob(root, 7)!, rounds: 1 })
  return plan
}

describe('factory review, first pass', () => {
  test('a normal-risk job: both reviewers review blind, both are sealed, the plan is recorded', async () => {
    save()
    const head = await git(tree, 'rev-parse', 'HEAD')
    const plan = await review(root, 7)
    expect(plan).toMatchObject({
      pass: 1,
      head,
      since: null,
      risk: 'normal',
      roles: { evaluator: 'review', 'test-reviewer': 'review' },
    })
    expect(loadSeal(root, 7)?.roles).toEqual(['evaluator', 'test-reviewer'])
    expect(existsSync(join(handoff, 'build-notes.md'))).toBe(false)
    expect(loadJob(root, 7)?.reviews).toEqual([plan])
    const event = readEvents(root, 7).find((item) => item.kind === 'review.planned')
    expect(event?.detail).toMatchObject({ pass: 1, head, roles: plan.roles })
  })

  test('a low-risk job: the test reviewer alone reviews, and alone is sealed', async () => {
    save({ risk: 'low' })
    const plan = await review(root, 7)
    expect(plan.roles).toEqual({ 'test-reviewer': 'review' })
    expect(loadSeal(root, 7)?.roles).toEqual(['test-reviewer'])
  })

  test('run again on the same HEAD, it prints the same plan and seals nothing twice', async () => {
    save()
    const plan = await review(root, 7)
    expect(await review(root, 7)).toEqual(plan)
    expect(loadJob(root, 7)?.reviews).toHaveLength(1)
  })

  test('is refused once HEAD moved past the HEAD its pass planned', async () => {
    save()
    await review(root, 7)
    const { unseal } = await import('../seal.ts')
    writeBlindPass(root, 7, 1, 'evaluator')
    writeBlindPass(root, 7, 1, 'test-reviewer')
    unseal(root, 7)
    await commit('apps/web/src/other.ts')
    expect(await review(root, 7).catch((caught) => caught)).toBeInstanceOf(Refusal)
  })
})

describe('factory review, a later pass', () => {
  test('only tests changed and the evaluator approved: the test reviewer verifies, the evaluator carries, nothing is sealed', async () => {
    const first = await afterFirstPass({ evaluator: 'approve', 'test-reviewer': 'changes' })
    const head = await commit('apps/web/e2e/icons.spec.ts')
    const plan = await review(root, 7)
    expect(plan).toMatchObject({
      pass: 2,
      head,
      since: first.head,
      changed: ['apps/web/e2e/icons.spec.ts'],
      roles: { evaluator: 'carry', 'test-reviewer': 'verify' },
    })
    expect(loadSeal(root, 7)).toBeNull()
    expect(existsSync(join(handoff, 'build-notes.md'))).toBe(true)
  })

  test('only tests changed and the evaluator asked for changes: both verify', async () => {
    await afterFirstPass({ evaluator: 'changes', 'test-reviewer': 'changes' })
    await commit('apps/web/e2e/icons.spec.ts')
    const plan = await review(root, 7)
    expect(plan.roles).toEqual({ evaluator: 'verify', 'test-reviewer': 'verify' })
  })

  test('product code changed: both review blind again, and both are sealed', async () => {
    await afterFirstPass({ evaluator: 'approve', 'test-reviewer': 'changes' })
    await commit('apps/web/src/icon.ts', 'apps/web/e2e/icons.spec.ts')
    const plan = await review(root, 7)
    expect(plan.roles).toEqual({ evaluator: 'review', 'test-reviewer': 'review' })
    expect(loadSeal(root, 7)?.roles).toEqual(['evaluator', 'test-reviewer'])
  })

  test('an approval carried in one pass carries again in the next', async () => {
    await afterFirstPass({ evaluator: 'approve', 'test-reviewer': 'changes' })
    await commit('apps/web/e2e/icons.spec.ts')
    await review(root, 7)
    put(join(handoff, 'reviews', '2.test-reviewer.md'), 'Verdict: changes\n')
    saveJob(root, { ...loadJob(root, 7)!, rounds: 2 })
    await commit('apps/web/e2e/icons.spec.ts')
    const plan = await review(root, 7)
    expect(plan.roles).toEqual({ evaluator: 'carry', 'test-reviewer': 'verify' })
  })
})

describe('what `factory review` prints', () => {
  test('says sealed while the seal stands, and not sealed when it is run again after the unseal', async () => {
    save()
    expect((await reviewReport(root, 7)).sealed).toBe(true)
    writeBlindPass(root, 7, 1, 'evaluator')
    writeBlindPass(root, 7, 1, 'test-reviewer')
    const { unseal } = await import('../seal.ts')
    unseal(root, 7)
    const again = await reviewReport(root, 7)
    expect(again.sealed).toBe(false)
    expect(again.roles).toEqual({ evaluator: 'review', 'test-reviewer': 'review' })
  })
})

const setup = async () => {
  await afterFirstPass({ evaluator: 'changes', 'test-reviewer': 'changes' })
  await commit('apps/web/src/icon.ts', 'apps/web/e2e/icons.spec.ts')
  const plan = await review(root, 7)
  // Pass 2 plans a blind evaluator and a verifying test reviewer: edit the plan to that.
  const job = loadJob(root, 7)!
  saveJob(root, {
    ...job,
    reviews: job.reviews.map((item) =>
      item.pass === 2
        ? { ...item, roles: { evaluator: 'review', 'test-reviewer': 'verify' } }
        : item,
    ),
  })
  return plan
}

// A verifier reads the previous findings from the sealed store while another reviewer's blind pass
// keeps the job sealed: the unseal would move them from under it.
describe('factory unseal, while a verifier is still reading', () => {
  test('is refused until the verifier’s final report is written', async () => {
    const { unseal } = await import('../seal.ts')
    await setup()
    // Only the evaluator reviews blind in this pass, so only it is sealed.
    const record = join(stateDir(root, 7), 'seal.json')
    writeFileSync(record, JSON.stringify({ ...loadSeal(root, 7), roles: ['evaluator'] }))
    writeBlindPass(root, 7, 2, 'evaluator')
    expect(loadSeal(root, 7)?.pass).toBe(2)
    let message = ''
    try {
      unseal(root, 7)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('test-reviewer')
    expect(message).toContain('verif')
    expect(loadSeal(root, 7)).not.toBeNull()
    writeReport(root, 7, 2, 'test-reviewer')
    unseal(root, 7)
    expect(loadSeal(root, 7)).toBeNull()
  })
})

const routing = () =>
  planRouting(
    {
      scope: 'frontend',
      complexity: 'standard',
      evidence: ['The issue changes the icon behavior.'],
      expectedPaths: ['apps/web/src/icon.ts', 'apps/web/e2e/icons.spec.ts'],
      behaviorChange: true,
      uncertainty: [],
      verification: ['Run the icon acceptance tests.'],
    },
    'normal',
  )

describe('factory review routing revisions', () => {
  test('new jobs require classification before review', async () => {
    save({ routingRequired: true })
    expect(((await review(root, 7).catch((caught) => caught)) as Error).message).toContain('route')
    expect(loadSeal(root, 7)).toBeNull()
  })

  test('records the routing revision and refuses reusing the plan after it changes', async () => {
    save({ routingRequired: true, routing: routing(), routingRevision: 1 })
    const plan = await review(root, 7)
    expect(plan.routingRevision).toBe(1)
    const job = loadJob(root, 7)!
    saveJob(root, { ...job, routingRevision: 2 })
    expect(((await review(root, 7).catch((caught) => caught)) as Error).message).toContain(
      'predates',
    )
    expect(loadJob(root, 7)?.reviews).toHaveLength(1)
  })

  test('a new routing revision forces a full independent review even after only test changes', async () => {
    await afterFirstPass({ evaluator: 'approve', 'test-reviewer': 'changes' })
    await commit('apps/web/e2e/icons.spec.ts')
    saveJob(root, {
      ...loadJob(root, 7)!,
      routingRequired: true,
      routing: routing(),
      routingRevision: 1,
    })
    const plan = await review(root, 7)
    expect(plan.routingRevision).toBe(1)
    expect(plan.roles).toEqual({ evaluator: 'review', 'test-reviewer': 'review' })
    expect(loadSeal(root, 7)?.roles).toEqual(['evaluator', 'test-reviewer'])
  })
})
