// The gate judges the job's own commits. A job that merges main to pick up a fix must not be
// rejected for what main changed, and a commit of the job's own that touches a protected path
// must still be.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { saveJob } from '../job.ts'
import { git } from '../shell.ts'
import { gate } from './gate.ts'

let root = ''
let tree = ''
let base = ''

const commit = async (path: string, message: string) => {
  mkdirSync(join(tree, path, '..'), { recursive: true })
  writeFileSync(join(tree, path), `${message}\n`)
  await git(tree, 'add', '-A')
  await git(tree, 'commit', '--quiet', '-m', message)
  return git(tree, 'rev-parse', 'HEAD')
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-gate-root-'))
  tree = mkdtempSync(join(tmpdir(), 'factory-gate-tree-'))
  const origin = mkdtempSync(join(tmpdir(), 'factory-gate-origin-'))
  await git(origin, 'init', '--quiet', '--bare')
  await git(tree, 'init', '--quiet', '-b', 'main')
  await git(tree, 'config', 'user.email', 'test@example.com')
  await git(tree, 'config', 'user.name', 'Test')
  await git(tree, 'config', 'commit.gpgsign', 'false')
  await git(tree, 'remote', 'add', 'origin', origin)
  writeFileSync(join(tree, '.gitignore'), 'factory/.jobs/\n')
  base = await commit('apps/web/src/a.ts', 'base')
  await git(tree, 'push', '--quiet', 'origin', 'main')
  await git(tree, 'checkout', '--quiet', '-b', 'feat/7-add-a-thing')
})
afterEach(async () => {
  const origin = await git(tree, 'remote', 'get-url', 'origin')
  for (const dir of [root, tree, origin]) rmSync(dir, { recursive: true, force: true })
})

/** Saves the job as if its checks had just passed on HEAD, then runs the gate. */
const runGate = async (cliCommits: string[] = []) => {
  saveJob(
    root,
    makeJob({
      worktree: tree,
      cliCommits,
      base,
      redCommit: base,
      lastCheck: {
        tree: await git(tree, 'rev-parse', 'HEAD^{tree}'),
        green: true,
        failedStep: null,
        at: 'now',
        log: 'check.log',
      },
    }),
  )
  return (await gate(root, 7)).result
}

describe('factory gate', () => {
  test("passes a job that merged main's change to a protected path", async () => {
    await commit('apps/web/src/b.ts', 'the job')
    await git(tree, 'checkout', '--quiet', 'main')
    await commit('factory/cli/src/paths.ts', 'a factory fix')
    await git(tree, 'push', '--quiet', 'origin', 'main')
    await git(tree, 'checkout', '--quiet', 'feat/7-add-a-thing')
    await git(tree, 'merge', '--quiet', '--no-edit', 'main')

    const result = await runGate()
    expect(result.problems).toEqual([])
    expect(result.passed).toBe(true)
  })

  test("rejects the job's own commit to a protected path", async () => {
    await commit('factory/cli/src/paths.ts', 'the job')

    const result = await runGate()
    expect(result.passed).toBe(false)
    expect(result.problems.join('\n')).toContain('factory/cli/src/paths.ts')
  })
})

// The build agent's reasoning reaches the reviewers only through build-notes.md, which is sealed
// during their blind passes; a commit body would carry it past the seal in `git log`.
describe('factory gate: build commit messages', () => {
  const TRAILERS =
    'Co-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_1'

  test.each([
    [
      'a body paragraph',
      'feat(web): add icons\n\nAdding width/height did not help, so I escalated.',
    ],
    [
      'a body before the trailers',
      `feat(web): add icons\n\nWhy: the 32px icon blurred.\n\n${TRAILERS}`,
    ],
    [
      'reasoning dressed as a trailer',
      `feat(web): add icons\n\n${TRAILERS}\nNote: width and height did not help`,
    ],
  ])('rejects a build commit whose message has %s', async (_what, message) => {
    const sha = await commit('apps/web/src/b.ts', message)
    const result = await runGate()
    expect(result.passed).toBe(false)
    expect(result.problems.join('\n')).toContain(sha.slice(0, 7))
    expect(result.problems.join('\n')).toContain('build-notes.md')
  })

  test.each([
    ['a subject alone', 'feat(web): add icons'],
    ['a subject and its trailers', `feat(web): add icons\n\n${TRAILERS}`],
  ])('passes a build commit with %s', async (_what, message) => {
    await commit('apps/web/src/b.ts', message)
    expect((await runGate()).problems).toEqual([])
  })

  test("does not judge a CLI commit's body", async () => {
    const sha = await commit(
      'apps/web/src/b.acceptance.test.ts',
      'test(#7): fix\n\nThe note.\n\nFactory-Job: #7',
    )
    expect((await runGate([sha])).problems).toEqual([])
  })
})
