// `factory pr` opens the PR only when every reviewer the pass's plan names has its say: a report
// that approves for a review or a verify, or an approval that carries.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  freezeBlindPass,
  installFakeGh,
  makeJob,
  writeBlindPass,
  writeReport,
} from '../job-fixture.ts'
import { saveJob, stateDir, type ReviewPlan } from '../job.ts'
import { git } from '../shell.ts'
import { Refusal } from './common.ts'
import { pr } from './pr.ts'

let root = ''
let tree = ''
let handoff = ''
let head = ''
let fake: ReturnType<typeof installFakeGh>

const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(handoff, rel)), { recursive: true })
  writeFileSync(join(handoff, rel), text)
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-pr-root-'))
  tree = mkdtempSync(join(tmpdir(), 'factory-pr-tree-'))
  const origin = mkdtempSync(join(tmpdir(), 'factory-pr-origin-'))
  await git(origin, 'init', '--quiet', '--bare')
  await git(tree, 'init', '--quiet')
  await git(tree, 'config', 'user.email', 'test@example.com')
  await git(tree, 'config', 'user.name', 'Test')
  await git(tree, 'config', 'commit.gpgsign', 'false')
  await git(tree, 'remote', 'add', 'origin', origin)
  writeFileSync(join(tree, 'a.txt'), 'one\n')
  await git(tree, 'add', 'a.txt')
  await git(tree, 'commit', '--quiet', '-m', 'first')
  await git(tree, 'checkout', '--quiet', '-b', 'factory/7-add-a-thing')
  head = await git(tree, 'rev-parse', 'HEAD')
  handoff = join(tree, 'factory', '.jobs', '7')
  put('summary.md', 'What changed.\n')
  put('acceptance.md', 'AC1: tested.\n')
  fake = installFakeGh(root)
})
afterEach(() => {
  fake.restore()
  rmSync(root, { recursive: true, force: true })
  rmSync(tree, { recursive: true, force: true })
})

// A final report as a real run leaves it: the file and the log's record of its own Write.
const report = (pass: number, role: string, text: string) => writeReport(root, 7, pass, role, text)

// A blind pass as the unseal leaves it: written by its own run, its hash recorded in the job.
const blind = (pass: number, role: string, text: string) => {
  const file = writeBlindPass(root, 7, pass, role, text)
  freezeBlindPass(root, 7, `reviews/${pass}.${role}.blind.md`)
  return file
}

const plan = (pass: number, roles: ReviewPlan['roles'], at = head): ReviewPlan => ({
  pass,
  head: at,
  since: null,
  changed: [],
  risk: 'normal',
  raisedBy: [],
  roles,
  at: '2026-01-01T00:00:00Z',
})

const save = (reviews: ReviewPlan[], rounds = reviews.length - 1) =>
  saveJob(
    root,
    makeJob({
      worktree: tree,
      rounds: Math.max(rounds, 0),
      gate: { head, passed: true, at: 'now' },
      reviews,
    }),
  )
const refusal = () => pr(root, 7).catch((caught: unknown) => caught)

const reviewed = () => {
  save([plan(1, { evaluator: 'review', 'test-reviewer': 'review' })])
  blind(1, 'evaluator', 'Blind: F1.\n')
  blind(1, 'test-reviewer', 'Blind: F2.\n')
  report(1, 'evaluator', 'Verdict: approve\n')
  report(1, 'test-reviewer', 'Verdict: approve\n')
}

describe('factory pr follows the review plan', () => {
  test('is refused when the pass under way has no plan', async () => {
    save([])
    report(1, 'evaluator', 'Verdict: approve\n')
    report(1, 'test-reviewer', 'Verdict: approve\n')
    const error = await refusal()
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('factory review 7')
  })

  test('is refused when the plan reviewed another HEAD', async () => {
    save([plan(1, { evaluator: 'review', 'test-reviewer': 'review' }, 'f00')])
    report(1, 'evaluator', 'Verdict: approve\n')
    report(1, 'test-reviewer', 'Verdict: approve\n')
    expect(await refusal()).toBeInstanceOf(Refusal)
  })

  test('is refused when a verifier has no report for the pass', async () => {
    save([
      plan(1, { evaluator: 'review', 'test-reviewer': 'review' }),
      plan(2, { evaluator: 'carry', 'test-reviewer': 'verify' }),
    ])
    const error = await refusal()
    expect((error as Refusal).message).toContain('test-reviewer')
    expect(fake.calls()).toBe('')
  })

  test('is refused when a reviewer of the pass asks for changes', async () => {
    save([plan(1, { evaluator: 'review', 'test-reviewer': 'review' })])
    put('reviews/1.evaluator.blind.md', 'Blind: F1.\n')
    put('reviews/1.test-reviewer.blind.md', 'Blind: F2.\n')
    report(1, 'evaluator', 'Verdict: changes\n')
    report(1, 'test-reviewer', 'Verdict: approve\n')
    expect(await refusal()).toBeInstanceOf(Refusal)
  })

  test("opens with the verifier's report and the evaluator's carried approval", async () => {
    save([
      plan(1, { evaluator: 'review', 'test-reviewer': 'review' }),
      plan(2, { evaluator: 'carry', 'test-reviewer': 'verify' }),
    ])
    report(2, 'test-reviewer', 'Verdict: approve\n\nVerified F1 and F2.\n')
    await pr(root, 7)
    expect(fake.calls()).toContain('gh pr create')
    const comment = readFileSync(join(stateDir(root, 7), 'pr-comment.md'), 'utf8')
    expect(comment).toContain('Verified F1 and F2.')
    expect(comment).toContain('carries')
  })

  // A final report without a blind pass rests on the build notes alone.
  test.each([
    ['no blind pass', null],
    ['an empty blind pass', '\n  \n'],
  ])('is refused when a role that reviewed has %s', async (_what, blindText) => {
    save([plan(1, { evaluator: 'review', 'test-reviewer': 'review' })])
    put('reviews/1.evaluator.blind.md', 'Blind: F1.\n')
    if (blindText !== null) put('reviews/1.test-reviewer.blind.md', blindText)
    report(1, 'evaluator', 'Verdict: approve\n')
    report(1, 'test-reviewer', 'Verdict: approve\n')
    const error = await refusal()
    expect((error as Refusal).message).toContain('reviews/1.test-reviewer.blind.md')
    expect(fake.calls()).toBe('')
  })

  test.each([
    ['the evaluator', 'evaluator'],
    ['the test reviewer', 'test-reviewer'],
  ])('is refused when %s’s report was not written by its own run', async (_who, role) => {
    save([plan(1, { evaluator: 'review', 'test-reviewer': 'review' })])
    put('reviews/1.evaluator.blind.md', 'Blind: F1.\n')
    put('reviews/1.test-reviewer.blind.md', 'Blind: F2.\n')
    for (const other of ['evaluator', 'test-reviewer']) {
      if (other === role) put(`reviews/1.${other}.md`, 'Verdict: approve\n')
      else report(1, other, 'Verdict: approve\n')
    }
    const error = await refusal()
    expect((error as Refusal).message).toContain(`reviews/1.${role}.md`)
    expect((error as Refusal).message).toContain('Write')
    expect(fake.calls()).toBe('')
  })

  describe('G5: the blind passes are the ones the unseal froze', () => {
    test('opens when every blind pass is as it was frozen', async () => {
      reviewed()
      await pr(root, 7)
      expect(fake.calls()).toContain('gh pr create')
    })

    test('is refused when a blind pass changed after the unseal', async () => {
      reviewed()
      writeFileSync(join(handoff, 'reviews/1.evaluator.blind.md'), 'Blind: F1, rewritten.\n')
      const error = await refusal()
      expect((error as Refusal).message).toContain('reviews/1.evaluator.blind.md')
      expect((error as Refusal).message).toContain('changed')
      expect(fake.calls()).toBe('')
    })

    test('is refused when a blind pass was never frozen by an unseal', async () => {
      reviewed()
      saveJob(root, {
        ...(await Bun.file(join(stateDir(root, 7), 'job.json')).json()),
        blindPasses: {},
      })
      const error = await refusal()
      expect((error as Refusal).message).toContain('unseal')
      expect(fake.calls()).toBe('')
    })
  })

  test('opens a low-risk job on the test reviewer alone', async () => {
    save([{ ...plan(1, { 'test-reviewer': 'review' }), risk: 'low' }])
    blind(1, 'test-reviewer', 'Blind: F1 and F2.\n')
    report(1, 'test-reviewer', 'Verdict: approve\n')
    await pr(root, 7)
    expect(fake.calls()).toContain('gh pr create')
    const comment = readFileSync(join(stateDir(root, 7), 'pr-comment.md'), 'utf8')
    expect(comment).toContain('low risk')
  })
})
