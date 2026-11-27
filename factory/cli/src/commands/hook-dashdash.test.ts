// The third adversarial review's F1: bun drops a `--` that follows the script, and a `--` before
// the subcommand must never hide it. The guard reads the CLI call as main.ts receives it.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BUILD, EVAL, guardJob, type GuardJob } from '../guard-fixture.ts'

let j: GuardJob
beforeEach(() => {
  j = guardJob({ sealed: false })
})
afterEach(() => j.cleanup())

const ANSWER = [
  'bun run factory -- answer 7 yes',
  'bun run factory -- --note x answer 7 yes',
  'bun run factory -- --port 1 answer 7 yes',
  'bun run factory -- --session s answer 7 yes',
  'bun run factory -- --abandon answer 7 yes',
  'bun run factory --note x -- answer 7 yes',
  'bun run factory -- --note=x answer 7 yes',
  'bun run factory -- -- answer 7 yes',
  'bun run factory -- -- --note x answer 7 yes',
  'bun run --silent factory -- --note x answer 7 yes',
  'bun factory/cli/src/main.ts -- --note x answer 7 yes',
  'bun factory/cli/src/main.ts -- -- answer 7 yes',
  'bun factory/cli/src/main.ts --note x -- -- answer 7 yes',
  'npm run factory -- --note x answer 7 yes',
]

describe('F1: a `--` after the script hides no subcommand', () => {
  test.each(ANSWER)('denies `%s` to the orchestrator', (command) => {
    expect(j.bash(null, command, j.root)).toContain('Only the user answers')
  })

  test.each([
    ['bun run factory -- --note x clean 7', 'clean'],
    ['bun run factory -- --abandon clean 7', 'clean'],
    ['bun run factory -- --note x watch', 'watch'],
    ['bun run factory -- --note x hook log', 'hook'],
  ])('denies `%s` to the orchestrator', (command) => {
    expect(j.bash(null, command, j.root)).not.toBeNull()
  })

  test.each([
    'bun run factory -- --session decoy start 7',
    'bun run factory -- --session decoy --note x start 7',
    'bun run factory -- -- --session decoy start 7',
    'bun factory/cli/src/main.ts -- --session decoy start 7',
  ])('denies `%s`: it would rebind the session', (command) => {
    expect(j.bash(null, command, j.root)).toContain('session')
  })

  test('lets the orchestrator start with its own session behind a `--`', () => {
    expect(j.bash(null, 'bun run factory -- start 7 --session job-session', j.root)).toBeNull()
  })

  test('names the real subcommand in the refusal, never a flag', () => {
    const reason = j.bash(BUILD, 'bun run factory -- --note x gate 7')
    expect(reason).toContain('`factory gate`')
    expect(reason).not.toContain('factory --note')
    expect(j.bash(EVAL, 'bun run factory -- --note x unseal 7')).toContain('`factory unseal`')
  })

  test('judges a reviewer sandbox call behind a `--` as the plain one', () => {
    const own = 'bun run factory -- sandbox exec 7 evaluator -- ls'
    expect(j.bash(EVAL, own)).toBeNull()
    expect(j.bash(EVAL, 'bun run factory -- sandbox exec 7 test-reviewer -- ls')).toContain(
      "evaluator's",
    )
  })
})
