import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installFakeGh, makeJob, writeRuling } from '../job-fixture.ts'
import { loadJob, saveJob, stateDir } from '../job.ts'
import { git } from '../shell.ts'
import { record, Refusal } from './common.ts'
import { abandon, atfix, block, composeProjectOf, rewrite } from './lifecycle.ts'
import { ruling } from './ruling.ts'

let root = ''
let tree = ''
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-rewrite-root-'))
  tree = mkdtempSync(join(tmpdir(), 'factory-rewrite-tree-'))
  await git(tree, 'init', '--quiet')
  await git(tree, 'config', 'user.email', 'test@example.com')
  await git(tree, 'config', 'user.name', 'Test')
  await git(tree, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(tree, 'a.txt'), 'one\n')
  writeFileSync(join(tree, '.gitignore'), 'factory/.jobs/\n')
  await git(tree, 'add', '-A')
  await git(tree, 'commit', '--quiet', '-m', 'first')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(tree, { recursive: true, force: true })
})

const DR = { at: '2026-01-01T00:00:00Z', file: 'decision-requests/1.md' }
const refusal = (promise: Promise<unknown>) => promise.catch((caught: unknown) => caught)

const answered = (overrides: { cited?: boolean } = {}) => ({
  decisionRequests: [DR],
  answers: [
    { request: 1, at: '2026-01-02T00:00:00Z', text: 'Yes, relax it', cited: false, ...overrides },
  ],
})

describe('factory rewrite', () => {
  test('is refused when the job has no Decision Request', async () => {
    saveJob(root, makeJob({ worktree: tree }))
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'x\n')
    expect(await refusal(rewrite(root, 7, 'relax x'))).toBeInstanceOf(Refusal)
    expect(loadJob(root, 7)?.rewrites).toEqual([])
  })

  test('is refused when the latest Decision Request has no answer', async () => {
    saveJob(root, makeJob({ worktree: tree, decisionRequests: [DR] }))
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'x\n')
    const error = await refusal(rewrite(root, 7, 'relax x'))
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('factory answer')
    expect(loadJob(root, 7)?.rewrites).toEqual([])
  })

  test('is refused when only an earlier request was answered', async () => {
    saveJob(
      root,
      makeJob({
        worktree: tree,
        decisionRequests: [DR, { ...DR, file: 'decision-requests/2.md' }],
        answers: answered().answers,
      }),
    )
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'x\n')
    expect(await refusal(rewrite(root, 7, 'relax x'))).toBeInstanceOf(Refusal)
  })

  test('is refused without the note describing the change', async () => {
    saveJob(root, makeJob({ worktree: tree, ...answered() }))
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'x\n')
    expect(await refusal(rewrite(root, 7, '  '))).toBeInstanceOf(Refusal)
  })

  test('is refused when a file other than an acceptance test changed', async () => {
    saveJob(root, makeJob({ worktree: tree, ...answered() }))
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'x\n')
    writeFileSync(join(tree, 'a.txt'), 'two\n')
    const error = await refusal(rewrite(root, 7, 'relax x'))
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('a.txt')
  })

  test('commits the acceptance tests, cites the answer and records the rewrite', async () => {
    saveJob(root, makeJob({ worktree: tree, ...answered() }))
    mkdirSync(join(tree, 'apps/web/e2e'), { recursive: true })
    writeFileSync(join(tree, 'apps/web/e2e/a.spec.ts'), 'x\n')
    const job = await rewrite(root, 7, 'relax x')
    const head = await git(tree, 'rev-parse', 'HEAD')
    expect(job.rewrites[0]).toMatchObject({ commit: head, note: 'relax x' })
    expect(job.cliCommits).toContain(head)
    const message = await git(tree, 'log', '-1', '--format=%B')
    expect(message).toContain('relax x')
    expect(message).toContain('Yes, relax it')
    expect(message).toContain('Factory-Job: #7')
    expect(message).toContain(
      'Authorized-By: factory answer 2026-01-02T00:00:00Z (#7, Decision Request 1)',
    )
    expect(job.answers[0]?.cited).toBe(true)
  })
})

/** Asks for a ruling on the fix in the worktree and writes a same-guarantee one. */
const sameGuarantee = async () => {
  const asked = await ruling(root, 7)
  writeRuling(root, 7, asked.ruling, `Verdict: same-guarantee\nDiff: ${asked.diff}\n`)
  return asked.ruling
}

describe('factory atfix', () => {
  test('commits a fix on a ruling with no citation when nothing was answered', async () => {
    saveJob(root, makeJob({ worktree: tree }))
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'x\n')
    await atfix(root, 7, 'rename a helper', { ruling: await sameGuarantee() })
    expect(await git(tree, 'log', '-1', '--format=%B')).not.toContain('Authorized-By')
  })

  test('cites an answered request the first commit after it, and not again', async () => {
    // Raised on a changed-guarantee ruling: only such an answer stands in for a ruling.
    saveJob(
      root,
      makeJob({ worktree: tree, ...answered(), decisionRequests: [{ ...DR, ruling: 1 }] }),
    )
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'x\n')
    const first = await atfix(root, 7, 'apply the answer')
    const message = await git(tree, 'log', '-1', '--format=%B')
    expect(message).toContain('Yes, relax it')
    expect(message).toContain(
      'Authorized-By: factory answer 2026-01-02T00:00:00Z (#7, Decision Request 1)',
    )
    expect(first.answers[0]?.cited).toBe(true)

    writeFileSync(join(tree, 'y.acceptance.test.ts'), 'y\n')
    await atfix(root, 7, 'another fix', { ruling: await sameGuarantee() })
    expect(await git(tree, 'log', '-1', '--format=%B')).not.toContain('Authorized-By')
  })
})

describe('factory block', () => {
  let fake: ReturnType<typeof installFakeGh>
  beforeEach(() => {
    fake = installFakeGh(root)
  })
  afterEach(() => fake.restore())

  test('keeps the request, moves the label, posts nothing and returns the request to print', async () => {
    saveJob(root, makeJob({ worktree: tree }))
    const file = join(root, 'dr.md')
    writeFileSync(file, '# Question\n\nMay I relax x?\n')
    const { job, request } = await block(root, 7, file)
    expect(request).toContain('May I relax x?')
    expect(job.state).toBe('blocked')
    expect(job.decisionRequests).toHaveLength(1)
    expect(readFileSync(job.decisionRequests[0]!.file, 'utf8')).toContain('May I relax x?')
    expect(fake.calls()).toContain('issue edit 7 --add-label factory:blocked')
    expect(fake.calls()).not.toContain('comment')
  })
})

describe('factory clean --abandon', () => {
  // A main checkout cloned from a bare origin, a job's worktree on its pushed branch, and fake gh
  // and docker on PATH that log every call and answer from environment variables.
  let base = ''
  let main = ''
  let worktree = ''
  let calls = ''
  const path = process.env.PATH
  const BRANCH = 'feat/7-add-a-thing'

  beforeEach(async () => {
    base = mkdtempSync(join(tmpdir(), 'factory-abandon-'))
    const origin = join(base, 'origin.git')
    main = join(base, 'main')
    await git(base, 'init', '--quiet', '--bare', '--initial-branch=main', origin)
    await git(base, 'clone', '--quiet', origin, main)
    for (const [key, value] of [
      ['user.email', 'test@example.com'],
      ['user.name', 'Test'],
      ['commit.gpgsign', 'false'],
    ] as const) {
      await git(main, 'config', key, value)
    }
    writeFileSync(join(main, 'a.txt'), 'one\n')
    await git(main, 'add', '-A')
    await git(main, 'commit', '--quiet', '-m', 'first')
    await git(main, 'push', '--quiet', 'origin', 'main')
    worktree = join(main, '.claude', 'worktrees', '7-add-a-thing')
    await git(main, 'worktree', 'add', '--quiet', '-b', BRANCH, worktree)
    await git(worktree, 'push', '--quiet', 'origin', BRANCH)
    saveJob(main, makeJob({ worktree, branch: BRANCH }))
    record(main, 7, 'job.started')

    const bin = join(base, 'bin')
    mkdirSync(bin)
    calls = join(base, 'calls.log')
    const fake = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`)
      chmodSync(join(bin, name), 0o755)
    }
    fake('gh', 'case "$1 $2" in "pr list") echo "${FAKE_PRS:-[]}";; esac')
    // On `compose … down`, also log the job's last event: it must be written by then.
    fake(
      'docker',
      [
        'case "$1" in',
        '  ps|volume) echo "$FAKE_CONTAINERS";;',
        `  compose) echo "last event: $(tail -n1 '${join(stateDir(main, 7), 'events.jsonl')}')" >> "${calls}";;`,
        'esac',
      ].join('\n'),
    )
    process.env.PATH = `${bin}:${path}`
    process.env.FAKE_PRS = '[]'
    process.env.FAKE_CONTAINERS = ''
  })
  afterEach(() => {
    process.env.PATH = path
    delete process.env.FAKE_PRS
    delete process.env.FAKE_CONTAINERS
    rmSync(base, { recursive: true, force: true })
  })

  const log = () => (existsSync(calls) ? readFileSync(calls, 'utf8') : '')
  const remoteBranch = () => git(main, 'ls-remote', '--heads', 'origin', BRANCH)
  const localBranch = () => git(main, 'branch', '--list', BRANCH)

  test('is refused while the branch has an open PR, and changes nothing', async () => {
    process.env.FAKE_PRS = '[{"url":"https://example.com/pull/9","state":"OPEN"}]'
    const error = await refusal(abandon(main, 7))
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('https://example.com/pull/9')
    expect(existsSync(worktree)).toBe(true)
    expect(await localBranch()).not.toBe('')
    expect(await remoteBranch()).not.toBe('')
    expect(loadJob(main, 7)).not.toBeNull()
    expect(log()).not.toContain('docker')
    expect(log()).not.toContain('issue edit')
  })

  test('is refused when the PR merged: that job is cleaned, not abandoned', async () => {
    process.env.FAKE_PRS = '[{"url":"https://example.com/pull/9","state":"MERGED"}]'
    expect(await refusal(abandon(main, 7))).toBeInstanceOf(Refusal)
    expect(loadJob(main, 7)).not.toBeNull()
  })

  test('takes down the worktree stack, removes worktree, branches and state, and resets the label', async () => {
    process.env.FAKE_PRS = '[{"url":"https://example.com/pull/9","state":"CLOSED"}]'
    process.env.FAKE_CONTAINERS = 'abc123'
    await abandon(main, 7)

    expect(log()).toContain('docker compose -p 7-add-a-thing down --volumes --remove-orphans')
    expect(log()).toMatch(/last event: .*"kind":"job\.abandoned"/)
    expect(existsSync(worktree)).toBe(false)
    expect(await localBranch()).toBe('')
    expect(await remoteBranch()).toBe('')
    expect(existsSync(stateDir(main, 7))).toBe(false)
    expect(log()).toContain(
      'gh issue edit 7 --add-label factory:ready --remove-label factory:building --remove-label factory:blocked --remove-label factory:pr-open',
    )
    // The order the steps run in: the stack, then the label once everything else is gone.
    expect(log().indexOf('docker compose')).toBeLessThan(log().indexOf('gh issue edit'))
  })

  test('skips what is already gone: no stack, no worktree, no remote branch', async () => {
    await git(main, 'worktree', 'remove', '--force', worktree)
    await git(main, 'push', '--quiet', 'origin', '--delete', BRANCH)
    const done = await abandon(main, 7)
    expect(log()).not.toContain('docker compose')
    expect(await localBranch()).toBe('')
    expect(existsSync(stateDir(main, 7))).toBe(false)
    expect(log()).toContain('gh issue edit 7 --add-label factory:ready')
    expect(done).toContain('No compose stack of its own.')
  })

  // Value record (T-009). Guarantee: a job whose job.json no longer validates can still be
  // abandoned, which is the job its user most needs to abandon. The case that happened: job #15's
  // `routing` carried a `lane` key, and `RoutingProposal` is a `z.strictObject`, so the load died
  // with `unrecognized_keys` and `clean --abandon` with it. Defect caught: abandon dying on a
  // ZodError and leaving the worktree, branch and state behind. No acceptance test gives it:
  // FI-001 is about who may run it. Level: unit, on the real git repo above.
  const plan = {
    scope: 'frontend',
    complexity: 'small',
    evidence: ['the issue names one file'],
    expectedPaths: ['apps/web/src/main.tsx'],
    behaviorChange: false,
    uncertainty: [],
    verification: ['the checks'],
    workflow: 'standard',
    risk: 'normal',
    reasons: ['behavior changes'],
    policyVersion: '1.4',
    at: '2026-01-01T00:00:00.000Z',
  }
  test.each([
    ['a field of the wrong type', (job: object) => JSON.stringify({ ...job, attempts: 'many' })],
    [
      'a `lane` key inside `routing` (a strict object)',
      (job: object) => JSON.stringify({ ...job, routing: { ...plan, lane: 'factory' } }),
    ],
    [
      'a `lane` key inside `routingHistory`',
      (job: object) => JSON.stringify({ ...job, routingHistory: [{ ...plan, lane: 'factory' }] }),
    ],
  ])('abandons a job whose job.json has %s, from what it can read', async (_why, corrupt) => {
    const file = join(stateDir(main, 7), 'job.json')
    writeFileSync(file, corrupt(JSON.parse(readFileSync(file, 'utf8'))))
    expect(() => loadJob(main, 7)).toThrow()
    const done = await abandon(main, 7)
    expect(done[0]).toContain("job.json can't be read")
    expect(existsSync(worktree)).toBe(false)
    expect(await localBranch()).toBe('')
    expect(await remoteBranch()).toBe('')
    expect(existsSync(stateDir(main, 7))).toBe(false)
    expect(log()).toContain('gh issue edit 7 --add-label factory:ready')
  })

  test('abandons a job whose job.json is not JSON by finding its worktree, and says what it removed', async () => {
    writeFileSync(join(stateDir(main, 7), 'job.json'), '{ half')
    const done = await abandon(main, 7)
    expect(existsSync(worktree)).toBe(false)
    expect(await localBranch()).toBe('')
    expect(existsSync(stateDir(main, 7))).toBe(false)
    expect(done.join('\n')).toContain('Removed the worktree')
  })

  test('says what it could not do when nothing names the branch, and stops at an open PR', async () => {
    writeFileSync(join(stateDir(main, 7), 'job.json'), '[]')
    await git(main, 'worktree', 'remove', '--force', worktree)
    const done = await abandon(main, 7)
    expect(done.join('\n')).toContain("Couldn't do the PR check: no branch is known")
    expect(done.join('\n')).toContain("Couldn't do the worktree")
    expect(existsSync(stateDir(main, 7))).toBe(false)
    mkdirSync(stateDir(main, 7), { recursive: true })
    writeFileSync(join(stateDir(main, 7), 'job.json'), `{"branch":"${BRANCH}", "attempts": "x"}`)
    process.env.FAKE_PRS = '[{"url":"https://example.com/pull/9","state":"OPEN"}]'
    const stopped = await abandon(main, 7)
    expect(stopped.join('\n')).toContain('https://example.com/pull/9')
    expect(existsSync(stateDir(main, 7))).toBe(true)
  })

  test('never takes down the shared stack', async () => {
    process.env.FAKE_CONTAINERS = 'abc123'
    await git(main, 'worktree', 'remove', '--force', worktree)
    saveJob(main, makeJob({ worktree: join(base, 'elsewhere', 'wandr'), branch: BRANCH }))
    await abandon(main, 7)
    expect(log()).not.toContain('docker compose')
  })
})

describe('composeProjectOf', () => {
  test.each([
    // The stack job #13's worktree started before docker-compose.yml set `name: wandr`.
    [
      '/repo/.claude/worktrees/13-ux-give-wandr-a-favicon-and-app-icons',
      '13-ux-give-wandr-a-favicon-and-app-icons',
    ],
    ['/repo/.claude/worktrees/42-Fix.The_Thing', '42-fixthe_thing'],
    ['/Users/me/Projects/wandr', 'wandr'],
  ])('%s is compose project %s', (worktree, project) => {
    expect(composeProjectOf(worktree)).toBe(project)
  })
})
