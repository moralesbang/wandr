// `factory pr` opens the PR only when every reviewer the pass's plan names has its say: a report
// that approves for a review or a verify, or an approval that carries.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { installFakeGh, makeJob } from '../job-fixture.ts'
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

describe('factory pr follows the review plan', () => {
  test('is refused when the pass under way has no plan', async () => {
    save([])
    put('reviews/1.evaluator.md', 'Verdict: approve\n')
    put('reviews/1.test-reviewer.md', 'Verdict: approve\n')
    const error = await refusal()
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('factory review 7')
  })

  test('is refused when the plan reviewed another HEAD', async () => {
    save([plan(1, { evaluator: 'review', 'test-reviewer': 'review' }, 'f00')])
    put('reviews/1.evaluator.md', 'Verdict: approve\n')
    put('reviews/1.test-reviewer.md', 'Verdict: approve\n')
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
    put('reviews/1.evaluator.md', 'Verdict: changes\n')
    put('reviews/1.test-reviewer.md', 'Verdict: approve\n')
    expect(await refusal()).toBeInstanceOf(Refusal)
  })

  test("opens with the verifier's report and the evaluator's carried approval", async () => {
    save([
      plan(1, { evaluator: 'review', 'test-reviewer': 'review' }),
      plan(2, { evaluator: 'carry', 'test-reviewer': 'verify' }),
    ])
    put('reviews/2.test-reviewer.md', 'Verdict: approve\n\nVerified F1 and F2.\n')
    await pr(root, 7)
    expect(fake.calls()).toContain('gh pr create')
    const comment = readFileSync(join(stateDir(root, 7), 'pr-comment.md'), 'utf8')
    expect(comment).toContain('Verified F1 and F2.')
    expect(comment).toContain('carries')
  })

  test('opens a low-risk job on the test reviewer alone', async () => {
    save([{ ...plan(1, { 'test-reviewer': 'review' }), risk: 'low' }])
    put('reviews/1.test-reviewer.md', 'Verdict: approve\n')
    await pr(root, 7)
    expect(fake.calls()).toContain('gh pr create')
    const comment = readFileSync(join(stateDir(root, 7), 'pr-comment.md'), 'utf8')
    expect(comment).toContain('low risk')
  })
})
