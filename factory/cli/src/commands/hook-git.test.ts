// The third adversarial review's G5, G6, F3 (the agent side) and the nits: what the guard denies
// of git is what the agent files and the skill say it denies, and a reviewer's own sandbox is its
// own to reset, stash and clean.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { loadJob, saveJob } from '../job.ts'
import { git } from '../shell.ts'
import { BUILD, DIAG, EVAL, EXPLORE, TEST, TR, guardJob, type GuardJob } from '../guard-fixture.ts'

let j: GuardJob
const S = () => `${j.handoff}/sandbox/evaluator`
const X = (command: string) => `bun run factory sandbox exec 7 evaluator -- ${command}`

const repo = async (cli: boolean) => {
  await git(j.worktree, 'init', '--quiet', '-b', 'feat/7')
  await git(j.worktree, 'config', 'user.email', 'a@b')
  await git(j.worktree, 'config', 'user.name', 'x')
  await git(j.worktree, 'commit', '--quiet', '--allow-empty', '-m', 'test(#7): red')
  const sha = await git(j.worktree, 'rev-parse', 'HEAD')
  const job = loadJob(j.root, 7)!
  saveJob(j.root, { ...job, cliCommits: cli ? [sha] : [] })
}
beforeEach(() => {
  j = guardJob({ sealed: false })
})
afterEach(() => j.cleanup())

describe('G5: no one reads the stored credentials', () => {
  test.each([
    'git credential fill <<< "host=github.com"',
    'printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill',
    'git credential approve',
    'git credential reject',
    'git credential-osxkeychain get',
    'git credential-store --file x get',
    'git -C . credential fill',
    'nice git credential fill',
    '/usr/libexec/git-core/git-credential-osxkeychain get',
  ])('denies `%s` to the orchestrator and to every agent', (command) => {
    for (const who of [null, BUILD, TEST, DIAG, EVAL, TR, EXPLORE]) {
      expect(j.bash(who, command, j.root)).toContain('credential')
    }
  })

  test('still lets git read its other settings', () => {
    expect(j.bash(BUILD, 'git config --get user.name')).toBeNull()
  })
})

describe('nits: the git the agent files and the skill say is denied', () => {
  const REFS = [
    'git notes add -m x HEAD',
    'git notes append -m x',
    'git update-ref refs/heads/other HEAD',
    'git update-ref -d refs/notes/commits',
    'git tag v1',
    'git tag -a v1 -m x',
    'git branch -f other HEAD',
    'git branch -D other',
    'git config user.name x',
    'git config --add core.hooksPath /tmp/x',
  ]
  test.each(REFS)('denies the build, test and diagnose agents `%s`', (command) => {
    for (const who of [BUILD, TEST, DIAG]) expect(j.bash(who, command)).not.toBeNull()
  })

  test.each(['git merge main', 'git merge --no-ff side', 'git merge --squash side'])(
    'denies the build, test and diagnose agents `%s`: the history stays linear',
    (command) => {
      for (const who of [BUILD, TEST, DIAG]) expect(j.bash(who, command)).toContain('rebase')
    },
  )

  test('denies the orchestrator a git note, and lets it read notes and set its identity', () => {
    expect(j.bash(null, 'git notes add -m x HEAD', j.root)).toContain('notes')
    expect(j.bash(null, 'git notes list', j.root)).toBeNull()
    expect(j.bash(null, 'git config user.name Someone', j.root)).toBeNull()
    expect(j.bash(null, 'git config user.email a@b', j.root)).toBeNull()
    expect(j.bash(null, 'git config alias.x "!gh issue close 7"', j.root)).not.toBeNull()
  })

  test('still lets the agents read refs, tags and notes', () => {
    for (const command of ['git tag -l', 'git tag --list "v*"', 'git notes list', 'git branch']) {
      expect(j.bash(BUILD, command)).toBeNull()
    }
  })
})

describe('F3: the build agent keeps the CLI’s commits', () => {
  test.each([
    'git reset --hard 0123456789abcdef0123456789abcdef01234567',
    'git reset --hard HEAD~1',
    'git reset --hard origin/main',
    'git reset --keep HEAD~2',
    'git reset --hard feat/7 --',
  ])('denies `%s`', (command) => {
    for (const who of [BUILD, TEST, DIAG]) expect(j.bash(who, command)).toContain('reset')
  })

  test.each([
    'git reset --hard',
    'git reset --hard HEAD',
    'git reset --soft HEAD~1',
    'git reset HEAD apps/web/src/main.ts',
  ])('lets the build agent `%s`', (command) => {
    expect(j.bash(BUILD, command)).toBeNull()
  })

  test('denies `git rebase --onto`, and lets `git rebase main` through', () => {
    expect(j.bash(BUILD, 'git rebase --onto main HEAD~1')).toContain('--onto')
    expect(j.bash(BUILD, 'git rebase main')).toBeNull()
  })
})

describe('G6: a reviewer runs git in its own sandbox, by any spelling', () => {
  test.each([
    'git reset --hard',
    'git stash',
    'git clean -fd',
    'git checkout -- .',
    'git checkout .',
    'git restore .',
    'git restore --source=HEAD -- .',
    'git restore --staged --worktree .',
    'git apply mut.patch',
  ])('lets the evaluator `%s` through `sandbox exec`', (command) => {
    expect(j.bash(EVAL, X(command))).toBeNull()
  })

  test.each([
    'git checkout -- .',
    'git checkout .',
    'git restore .',
    'git reset --hard HEAD',
    'git clean -fd',
  ])('lets the evaluator `%s` after a cd into its sandbox, and with git -C', (command) => {
    expect(j.bash(EVAL, `cd ${S()} && ${command}`)).toBeNull()
    expect(j.bash(EVAL, `git -C ${S()} ${command.slice(4)}`)).toBeNull()
  })

  test("still denies the same through the other role's sandbox, and in the shared worktree", () => {
    expect(
      j.bash(EVAL, 'bun run factory sandbox exec 7 test-reviewer -- git reset --hard'),
    ).not.toBeNull()
    expect(j.bash(EVAL, 'git reset --hard')).not.toBeNull()
    expect(j.bash(EVAL, 'git checkout -- .')).not.toBeNull()
    expect(j.bash(EVAL, 'git restore .')).not.toBeNull()
    expect(j.bash(EVAL, `git -C ${j.handoff}/sandbox/test-reviewer reset --hard`)).not.toBeNull()
  })

  test("a `..` out of the sandbox inside exec is still the worktree's", () => {
    expect(j.bash(EVAL, X('git -C ../.. reset --hard'))).not.toBeNull()
    expect(j.bash(EVAL, X('git checkout -- ../../apps'))).not.toBeNull()
  })
})

describe('F3: `git commit --amend` of a CLI commit', () => {
  const amend = 'git commit --amend --no-edit'

  test('denies the build agent amending the red commit', async () => {
    await repo(true)
    expect(j.bash(BUILD, amend)).toContain('amend')
  })

  test('lets it amend its own commit', async () => {
    await repo(false)
    expect(j.bash(BUILD, amend)).toBeNull()
  })
})
