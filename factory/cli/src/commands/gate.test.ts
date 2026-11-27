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
      branch: 'feat/7-add-a-thing',
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

const mainMoves = async () => {
  await commit('apps/web/src/b.ts', 'the job')
  await git(tree, 'checkout', '--quiet', 'main')
  await commit('factory/cli/src/paths.ts', 'a factory fix')
  await git(tree, 'push', '--quiet', 'origin', 'main')
  await git(tree, 'checkout', '--quiet', 'feat/7-add-a-thing')
}

describe('factory gate', () => {
  test("passes a job that rebased onto main's change to a protected path", async () => {
    await mainMoves()
    await git(tree, 'rebase', '--quiet', 'main')

    const result = await runGate()
    expect(result.problems).toEqual([])
    expect(result.passed).toBe(true)
  })

  // B7: a merge commit's own diff is empty to `diff-tree`, so a change made inside one (an
  // acceptance test weakened in the merge, after `merge -s ours`) passed the gate unseen.
  test('rejects a merge commit an agent made, even a plain merge of main', async () => {
    await mainMoves()
    await git(tree, 'merge', '--quiet', '--no-edit', 'main')

    const result = await runGate()
    expect(result.passed).toBe(false)
    expect(result.problems.join('\n')).toContain('merge commit')
    expect(result.problems.join('\n')).toContain('rebase')
  })

  test('rejects an acceptance test weakened inside a merge commit', async () => {
    await commit('apps/web/e2e/a.spec.ts', 'toHaveLength(3)')
    const red = await git(tree, 'rev-parse', 'HEAD')
    await git(tree, 'switch', '--quiet', '-c', 'side')
    await commit('apps/web/src/extra.ts', 'extra')
    await git(tree, 'switch', '--quiet', 'feat/7-add-a-thing')
    await git(tree, 'merge', '--quiet', '--no-commit', '-s', 'ours', 'side')
    writeFileSync(join(tree, 'apps/web/e2e/a.spec.ts'), 'toBeDefined()\n')
    await git(tree, 'add', '-A')
    await git(tree, 'commit', '--quiet', '-m', 'chore: merge side')

    const result = await runGate([red])
    expect(result.passed).toBe(false)
    expect(result.problems.join('\n')).toContain('merge commit')
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

// G6: a note on a commit and a commit amended away both carry text past the seal: `git log
// --show-notes` and `git reflog` show them to a reviewer that reads the repo.
describe('factory gate: what git keeps besides the commits', () => {
  test('rejects any ref under refs/notes/', async () => {
    await commit('apps/web/src/b.ts', 'feat(web): add icons')
    await git(tree, 'notes', 'add', '-m', 'I escalated because width did not help', 'HEAD')
    const result = await runGate()
    expect(result.passed).toBe(false)
    expect(result.problems.join('\n')).toContain('refs/notes')
  })

  test('forgets the reflog, where an amended-away message body still shows', async () => {
    await commit('apps/web/src/b.ts', 'feat(web): add icons\n\nThe reasoning in the body.')
    expect((await runGate()).passed).toBe(false)
    await git(tree, 'commit', '--quiet', '--amend', '-m', 'feat(web): add icons')
    // The amend left its entry: the old commit's id, and the new one.
    expect(await git(tree, 'reflog', 'show', 'HEAD')).toContain('amend')

    expect((await runGate()).problems).toEqual([])
    expect(await git(tree, 'reflog', 'show', 'HEAD')).toBe('')
    expect(await git(tree, 'reflog', 'show', 'feat/7-add-a-thing')).toBe('')
  })
})
