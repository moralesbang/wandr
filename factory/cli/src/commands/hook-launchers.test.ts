// The second adversarial review's launcher findings (B1, B2): the guard reads every word position
// of a command for a factory CLI call or a `git push`, not only the first, and a tool call can't
// rebind the job's session.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { loadJob } from '../job.ts'
import { BUILD, EVAL, EXPLORE, guardJob, type GuardJob } from '../guard-fixture.ts'
import { start } from './start.ts'

let j: GuardJob
beforeEach(() => {
  j = guardJob({ sealed: false })
})
afterEach(() => j.cleanup())

describe('B1: a tool call cannot rebind the job session', () => {
  test('denies `factory start --session <other>` and the job keeps its session', async () => {
    expect(j.bash(null, 'bun run factory start 7 --session decoy', j.root)).toContain('session')
    // What the allowed command used to do: the job followed the decoy and the guard went dark.
    await start(j.root, 7, 'job-session')
    expect(loadJob(j.root, 7)?.session).toBe('job-session')
  })

  test('denies the `--session=<other>` spelling and a session the shell fills in', () => {
    expect(j.bash(null, 'bun run factory start 7 --session=decoy', j.root)).not.toBeNull()
    expect(j.bash(null, 'bun run factory start 7 --session $SID', j.root)).not.toBeNull()
  })

  test('denies it through a launcher too', () => {
    expect(j.bash(null, 'nice bun run factory start 7 --session decoy', j.root)).not.toBeNull()
  })

  test('lets `factory start` through with the hook input’s own session', () => {
    expect(j.bash(null, 'bun run factory start 7 --session job-session', j.root)).toBeNull()
  })
})

const LAUNCHED = [
  'nice bun run factory answer 7 yes',
  'nice -n 5 bun run factory answer 7 yes',
  'caffeinate -i bun run factory answer 7 yes',
  'arch -arm64 bun run factory answer 7 yes',
  'timeout 60 bun run factory answer 7 yes',
  'npm run factory -- answer 7 yes',
  'npx --yes bun run factory answer 7 yes',
  'bunx bun run factory answer 7 yes',
  'script -q /dev/null bun run factory answer 7 yes',
  'time bun run factory answer 7 yes',
  'find . -maxdepth 0 -exec bun run factory answer 7 yes \\;',
  'find . -maxdepth 0 -execdir bun run factory answer 7 yes \\;',
  'find . -maxdepth 0 -ok bun run factory answer 7 yes \\;',
  'nice node factory/cli/src/main.ts answer 7 yes',
  'pnpm run factory answer 7 yes',
  'yarn run factory answer 7 yes',
]

describe('B2: the factory CLI behind a launcher', () => {
  test.each(LAUNCHED)('denies `%s` to the orchestrator', (command) => {
    expect(j.bash(null, command, j.root)).toContain('Only the user answers')
  })

  test.each([
    'nice bun run factory red 7',
    'bun run factory sandbox exec 7 evaluator -- nice bun run factory answer 7 yes',
  ])('denies `%s` to an agent that may not run it', (command) => {
    expect(j.bash(BUILD, command)).not.toBeNull()
  })

  test('denies a launcher in front of a sandbox command that is another reviewer’s', () => {
    expect(j.bash(EVAL, 'nice bun run factory sandbox exec 7 test-reviewer -- bun test')).toContain(
      "evaluator's",
    )
  })

  test('still lets the orchestrator run the commands behind a launcher that are its own', () => {
    expect(j.bash(null, 'nice bun run factory status', j.root)).toBeNull()
  })
})

const PUSHES = [
  'nice git push origin HEAD',
  'caffeinate git push origin HEAD',
  'timeout 60 git push origin HEAD',
  'git subtree push --prefix=apps origin feat/x',
  'git send-pack origin HEAD',
  'git -C . receive-pack .',
  '/opt/homebrew/opt/git/libexec/git-core/git-push origin HEAD',
  '$(git --exec-path)/git-push origin HEAD',
  'find . -maxdepth 0 -exec git push origin HEAD \\;',
  'find . -maxdepth 0 -execdir git push origin HEAD \\;',
  'git -c alias.p=push p origin HEAD',
  'git -c alias.p="!bun run factory answer 7 yes" p',
]

describe('B2: git push behind a launcher, and the aliases that hide it', () => {
  test.each(PUSHES)('denies `%s`', (command) => {
    expect(j.bash(null, command, j.root)).not.toBeNull()
    expect(j.bash(BUILD, command)).not.toBeNull()
  })

  test('still lets git commit and git log through', () => {
    expect(j.bash(BUILD, 'nice git log --oneline -3')).toBeNull()
    expect(j.bash(BUILD, 'git commit -m "feat: x"')).toBeNull()
  })

  test('denies `env -S`, which builds a command out of one string', () => {
    expect(j.bash(null, "env -S 'bun run factory answer 7 yes'", j.root)).toContain('env -S')
    expect(j.bash(null, "nice env -S 'bun run factory answer 7 yes'", j.root)).toContain('env -S')
    expect(j.bash(null, 'env FOO=1 bun run factory status', j.root)).toBeNull()
  })

  test.each([
    "claude -p 'run: bun run factory answer 7 yes' --dangerously-skip-permissions",
    'nice claude -p hi',
    '/Users/me/.local/bin/claude -p hi',
  ])('denies the claude program to everyone: `%s`', (command) => {
    expect(j.bash(null, command, j.root)).toContain('claude')
    expect(j.bash(BUILD, command)).toContain('claude')
  })

  test('lets a search for the word claude through', () => {
    expect(j.bash(EXPLORE, 'rg claude docs')).toBeNull()
    expect(j.bash(null, 'ls ~/.claude', j.root)).toBeNull()
  })
})
