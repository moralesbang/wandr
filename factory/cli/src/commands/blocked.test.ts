// A Decision Request stops the job until the user answers it, and the answer authorizes exactly one
// commit. The adversarial review of factory v1.3 counted a build attempt on a blocked job, committed
// an acceptance-test fix with no ruling on an answer about something else, and rewrote the tests
// twice on one answer.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch } from '../launch.ts'
import { installFakeGh, makeJob } from '../job-fixture.ts'
import { handoffDir, loadJob, saveJob } from '../job.ts'
import { git } from '../shell.ts'
import { answer } from './answer.ts'
import { Refusal } from './common.ts'
import { gate } from './gate.ts'
import { atfix, attempt, block, rewrite, round } from './lifecycle.ts'
import { pr } from './pr.ts'
import { red } from './red.ts'
import { review } from './review.ts'
import { ruling } from './ruling.ts'
import { start } from './start.ts'

let root = ''
let tree = ''
let fake: ReturnType<typeof installFakeGh>
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-halt-root-'))
  tree = mkdtempSync(join(tmpdir(), 'factory-halt-tree-'))
  fake = installFakeGh(root)
  await git(tree, 'init', '--quiet')
  await git(tree, 'config', 'user.email', 'test@example.com')
  await git(tree, 'config', 'user.name', 'Test')
  await git(tree, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(tree, '.gitignore'), 'factory/.jobs/\n')
  await git(tree, 'add', '-A')
  await git(tree, 'commit', '--quiet', '-m', 'first')
  saveJob(root, makeJob({ worktree: tree, session: 's1' }))
  mkdirSync(handoffDir({ number: 7, worktree: tree }), { recursive: true })
  writeFileSync(join(handoffDir({ number: 7, worktree: tree }), 'issue.md'), '# Add a thing\n')
})
afterEach(() => {
  fake.restore()
  rmSync(root, { recursive: true, force: true })
  rmSync(tree, { recursive: true, force: true })
})

const refusal = async (run: () => unknown) => {
  try {
    await run()
  } catch (caught) {
    return caught
  }
  return null
}

/** Blocks the job on a Decision Request, as the orchestrator does. */
const raise = async () => {
  const draft = join(root, 'draft.md')
  writeFileSync(draft, '# Context\n\nMay the test change?\n')
  return block(root, 7, draft)
}

const changeTest = (text: string) => writeFileSync(join(tree, 'x.acceptance.test.ts'), text)

describe('a blocked job', () => {
  test.each([
    ['attempt', () => attempt(root, 7)],
    ['round', () => round(root, 7)],
    ['gate', () => gate(root, 7)],
    ['review', () => review(root, 7)],
    ['ruling', () => ruling(root, 7)],
    ['atfix', () => atfix(root, 7, 'fix', { ruling: 1 })],
    ['rewrite', () => rewrite(root, 7, 'rewrite')],
    ['pr', () => pr(root, 7)],
    ['red', () => red(root, 7)],
    ['launch', () => launch(root, 7, 'factory-build', 'build')],
    ['block', () => raise()],
  ])('refuses factory %s until the user answers', async (_command, run) => {
    await raise()
    const before = loadJob(root, 7)
    const error = await refusal(run)
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('is blocked on a Decision Request')
    expect(loadJob(root, 7)).toEqual(before)
  })
})

/** The user answers from their own prompt, and the orchestrator resumes the job. */
const answered = async () => {
  answer(root, 7, 'Yes, change it.')
  await start(root, 7, 's2')
}

describe('an answer authorizes one commit', () => {
  test('an answer to a request raised on a changed-guarantee ruling lets one atfix through', async () => {
    changeTest('two\n')
    const { diff, file } = await ruling(root, 7)
    writeFileSync(file, `Verdict: changed-guarantee\nDiff: ${diff}\n\nThe check is weaker.\n`)
    const { job } = await raise()
    expect(job.decisionRequests[0]?.ruling).toBe(1)
    await answered()

    const fixed = await atfix(root, 7, 'apply the answer')
    expect(fixed.answers[0]?.cited).toBe(true)
    expect(await git(tree, 'log', '-1', '--format=%B')).toContain('Authorized-By: factory answer')

    changeTest('three\n')
    expect(await refusal(() => atfix(root, 7, 'again'))).toBeInstanceOf(Refusal)
    expect(await refusal(() => rewrite(root, 7, 'again'))).toBeInstanceOf(Refusal)
  })

  test('an answer to any other request lets no atfix through without a ruling', async () => {
    await raise()
    await answered()
    changeTest('two\n')
    const error = await refusal(() => atfix(root, 7, 'drop an assertion'))
    expect(error).toBeInstanceOf(Refusal)
    expect(loadJob(root, 7)?.atfixes).toEqual([])
  })

  test('a rewrite uses the answer up', async () => {
    await raise()
    await answered()
    changeTest('two\n')
    await rewrite(root, 7, 'rewrite 1')
    changeTest('three\n')
    const error = await refusal(() => rewrite(root, 7, 'rewrite 2'))
    expect((error as Refusal).message).toContain('already authorized')
    expect(loadJob(root, 7)?.rewrites).toHaveLength(1)
  })
})
