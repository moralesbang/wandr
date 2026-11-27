// A verify pass is no blind pass: the verifier checks the previous findings against the diff. When
// another reviewer still writes its blind pass in the same pass, the job stays sealed for that one,
// and the verifier must still reach its own inputs and write its report, and nothing more. A role
// whose approval carries writes nothing. These tests drive the guard the way Claude Code calls it.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { stateDir, saveJob, type ReviewPlan } from '../job.ts'
import { seal } from '../seal.ts'
import { hookGuard } from './hook.ts'

let root = ''
let worktree = ''
let handoff = ''
let store = ''

const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const plan = (pass: number, roles: ReviewPlan['roles']): ReviewPlan => ({
  pass,
  head: `head${pass}`,
  since: pass === 1 ? null : `head${pass - 1}`,
  changed: [],
  risk: 'normal',
  raisedBy: [],
  roles,
  at: '2026-01-01T00:00:00Z',
})
const FIRST = plan(1, { evaluator: 'review', 'test-reviewer': 'review' })

const setUp = (second: ReviewPlan['roles']) => {
  saveJob(
    root,
    makeJob({ worktree, session: 'job-session', rounds: 1, reviews: [FIRST, plan(2, second)] }),
  )
  put(join(handoff, 'issue.md'), '# Add a thing (#7)\n')
  put(join(handoff, 'build-notes.md'), '# Notes\n')
  put(join(handoff, 'decision-requests', '1.md'), '# Context\n')
  put(join(handoff, 'reviews', '1.evaluator.md'), 'Verdict: changes\n')
  put(join(handoff, 'reviews', '1.test-reviewer.md'), 'Verdict: changes\n')
  put(join(handoff, 'reviews', '1.findings.md'), '# Findings\n')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-guard-verify-'))
  worktree = join(root, '.claude', 'worktrees', '7-add-a-thing')
  handoff = join(worktree, 'factory', '.jobs', '7')
  store = join(stateDir(root, 7), 'sealed')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

type Decision = { permissionDecision: string; permissionDecisionReason: string }

const EVALUATOR = { agent_id: 'e1', agent_type: 'factory-evaluator' }
const TEST_REVIEWER = { agent_id: 't1', agent_type: 'factory-test-reviewer' }
type Who = typeof EVALUATOR | null

const call = (who: Who, tool: string, toolInput: Record<string, unknown>): Decision | null => {
  const out = hookGuard(
    root,
    JSON.stringify({
      session_id: 'job-session',
      hook_event_name: 'PreToolUse',
      tool_name: tool,
      tool_use_id: 'tu-1',
      cwd: worktree,
      tool_input: toolInput,
      ...who,
    }),
  )
  return out ? (JSON.parse(out) as { hookSpecificOutput: Decision }).hookSpecificOutput : null
}
const read = (who: Who, path: string) => call(who, 'Read', { file_path: path })
const bash = (who: Who, command: string) => call(who, 'Bash', { command })
const write = (who: Who, path: string) => call(who, 'Write', { file_path: path, content: 'x' })
const launch = (type: string, prompt: string) =>
  call(null, 'Agent', { subagent_type: type, description: 'review', prompt })

describe('the evaluator reviews blind while the test reviewer verifies (sealed for the evaluator)', () => {
  beforeEach(() => {
    setUp({ evaluator: 'review', 'test-reviewer': 'verify' })
    seal(root, 7, { pass: 2, roles: ['evaluator'] })
  })

  test('the verifier writes its own report for the pass', () => {
    expect(write(TEST_REVIEWER, join(handoff, 'reviews', '2.test-reviewer.md'))).toBeNull()
  })

  test.each([
    [
      'the merged findings, by Read',
      () => read(TEST_REVIEWER, join(store, 'reviews/1.findings.md')),
    ],
    [
      'its own previous report, by Read',
      () => read(TEST_REVIEWER, join(store, 'reviews/1.test-reviewer.md')),
    ],
    [
      'the merged findings, by cat',
      () => bash(TEST_REVIEWER, `cat ${store}/reviews/1.findings.md`),
    ],
    [
      'the findings by their name in the job folder',
      () => read(TEST_REVIEWER, join(handoff, 'reviews/1.findings.md')),
    ],
    ['the diff', () => bash(TEST_REVIEWER, 'git diff head1 head2')],
  ])('the verifier reads %s', (_name, run) => {
    expect(run()).toBeNull()
  })

  test.each([
    ['the build notes in the store', () => read(TEST_REVIEWER, join(store, 'build-notes.md'))],
    [
      'the Decision Requests in the store',
      () => bash(TEST_REVIEWER, `cat ${store}/decision-requests/1.md`),
    ],
    [
      "the other reviewer's report in the store",
      () => read(TEST_REVIEWER, join(store, 'reviews/1.evaluator.md')),
    ],
    ['the build notes by name', () => read(TEST_REVIEWER, join(handoff, 'build-notes.md'))],
    ['the job state', () => read(TEST_REVIEWER, join(stateDir(root, 7), 'job.json'))],
  ])('the verifier is denied %s', (_name, run) => {
    expect(run()?.permissionDecision).toBe('deny')
  })

  test.each([
    ['the findings in the store', () => read(EVALUATOR, join(store, 'reviews/1.findings.md'))],
    ['the findings by name', () => read(EVALUATOR, join(handoff, 'reviews/1.findings.md'))],
    ["the verifier's report", () => read(EVALUATOR, join(handoff, 'reviews/2.test-reviewer.md'))],
    [
      'its own final report, before its blind pass',
      () => write(EVALUATOR, join(handoff, 'reviews/2.evaluator.md')),
    ],
    [
      "the verifier's report, by writing it",
      () => write(EVALUATOR, join(handoff, 'reviews/2.test-reviewer.md')),
    ],
  ])('the blind reviewer is still denied %s', (_name, run) => {
    expect(run()?.permissionDecision).toBe('deny')
  })

  test('the orchestrator hands the verifier the findings path', () => {
    expect(
      launch(
        'factory-test-reviewer',
        `Verify pass 2: read ${store}/reviews/1.findings.md and reviews/1.test-reviewer.md, then git diff head1 head2.`,
      ),
    ).toBeNull()
  })

  test('the orchestrator may not hand the verifier the build notes', () => {
    expect(
      launch('factory-test-reviewer', `Read ${handoff}/build-notes.md first.`)?.permissionDecision,
    ).toBe('deny')
  })

  test('the orchestrator may not hand the blind reviewer the findings', () => {
    expect(
      launch('factory-evaluator', `Read ${store}/reviews/1.findings.md.`)?.permissionDecision,
    ).toBe('deny')
  })
})

describe('the evaluator carries its approval while the test reviewer verifies (nothing sealed)', () => {
  beforeEach(() => setUp({ evaluator: 'carry', 'test-reviewer': 'verify' }))

  test('the verifier writes its report', () => {
    expect(write(TEST_REVIEWER, join(handoff, 'reviews', '2.test-reviewer.md'))).toBeNull()
  })

  test.each(['2.evaluator.md', '2.evaluator.blind.md'])(
    'the carrying evaluator writes no %s',
    (name) => {
      expect(write(EVALUATOR, join(handoff, 'reviews', name))?.permissionDecision).toBe('deny')
    },
  )
})

// Nothing is sealed when every role verifies or carries, yet a verify pass is still no blind pass
// for the sealed names: the verifier reads its own inputs among them, until its report is written.
describe('the test reviewer verifies, nothing sealed', () => {
  beforeEach(() => setUp({ evaluator: 'carry', 'test-reviewer': 'verify' }))

  test.each([
    ['Read the build notes', () => read(TEST_REVIEWER, join(handoff, 'build-notes.md'))],
    [
      "cat the notes, a Decision Request and the other reviewer's report",
      () =>
        bash(
          TEST_REVIEWER,
          `cat ${handoff}/build-notes.md ${handoff}/decision-requests/1.md ${handoff}/reviews/1.evaluator.md`,
        ),
    ],
    [
      'Grep the Decision Requests',
      () => call(TEST_REVIEWER, 'Grep', { pattern: 'x', path: join(handoff, 'decision-requests') }),
    ],
    ['cat them by glob', () => bash(TEST_REVIEWER, 'cat factory/.jobs/7/decision-requests/*')],
  ])('denies the verifier: %s', (_what, run) => {
    expect(run()?.permissionDecision).toBe('deny')
  })

  test.each([
    ['its previous findings', () => read(TEST_REVIEWER, join(handoff, 'reviews/1.findings.md'))],
    ['its own report', () => bash(TEST_REVIEWER, `cat ${handoff}/reviews/1.test-reviewer.md`)],
    ['the issue', () => read(TEST_REVIEWER, join(handoff, 'issue.md'))],
    ['the repo', () => read(TEST_REVIEWER, join(worktree, 'apps', 'x.ts'))],
    ['the diff', () => bash(TEST_REVIEWER, 'git diff head1 head2')],
  ])('lets the verifier read %s', (_what, run) => {
    expect(run()).toBeNull()
  })

  test('once its final report is written, the verifier reads the rest', () => {
    put(join(handoff, 'reviews', '2.test-reviewer.md'), 'Verdict: approve\n')
    expect(read(TEST_REVIEWER, join(handoff, 'build-notes.md'))).toBeNull()
  })
})
