// The third adversarial review's F2: every shell's inline code is read as a command, `eval`'s
// literal arguments too, and a shell that is fed code on stdin is denied.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { EVAL, guardJob, type GuardJob } from '../guard-fixture.ts'

let j: GuardJob
beforeEach(() => {
  j = guardJob({ plan: { evaluator: 'review', 'test-reviewer': 'review' } })
})
afterEach(() => j.cleanup())

const INLINE = (code: string) => [
  `sh -c '${code}'`,
  `bash -c '${code}'`,
  `bash -lc '${code}'`,
  `bash -ec '${code}'`,
  `zsh -ic '${code}'`,
  `sh -ec '${code}'`,
  `bash -e -c '${code}'`,
  `bash --norc -c '${code}'`,
  `bash -l -c '${code}'`,
  `bash -o pipefail -c '${code}'`,
  `env bash -lc '${code}'`,
  `nice -n 5 bash -lc '${code}'`,
  `zsh -c '${code}'`,
  `dash -c '${code}'`,
  `ksh -c '${code}'`,
  `mksh -c '${code}'`,
  `fish -c '${code}'`,
  `busybox sh -c '${code}'`,
  `eval '${code}'`,
  `eval ${code}`,
  `sh -c 'bash -lc "${code}"'`,
]

describe('F2: a shell’s inline code is a command of its own', () => {
  test.each(INLINE('bun run factory answer 7 yes'))(
    'denies `%s` to the orchestrator',
    (command) => {
      expect(j.bash(null, command, j.root)).toContain('Only the user answers')
    },
  )

  test.each(INLINE('bun run factory clean 7'))('denies `%s` to the orchestrator', (command) => {
    expect(j.bash(null, command, j.root)).toContain('factory clean')
  })

  test.each(INLINE('git push'))('denies `%s` to the orchestrator', (command) => {
    expect(j.bash(null, command, j.root)).toContain('git push')
  })

  test('denies a state write and a gh write inside a login shell', () => {
    expect(j.bash(null, `bash -lc 'echo x > factory/.jobs/7/job.json'`, j.root)).not.toBeNull()
    expect(j.bash(null, `bash -lc 'gh issue comment 7 -b x'`, j.root)).not.toBeNull()
  })

  test.each(INLINE(`cat factory/.jobs/7/build-notes.md`))(
    'denies `%s` to a sealed reviewer',
    (command) => {
      expect(j.bash(EVAL, command)).not.toBeNull()
    },
  )

  test.each(INLINE('cat ~/.claude/history.jsonl'))('denies `%s` to a reviewer', (command) => {
    expect(j.bash(EVAL, command)).not.toBeNull()
  })

  test('lets a shell run plain, harmless inline code', () => {
    expect(j.bash(null, `bash -lc 'echo hi'`, j.root)).toBeNull()
    expect(j.bash(null, `eval 'echo hi'`, j.root)).toBeNull()
    expect(j.bash(null, 'command -v bash', j.root)).toBeNull()
  })
})

describe('F2: a shell fed code on stdin', () => {
  test.each([
    `echo 'bun run factory answer 7 yes' | sh`,
    `echo 'bun run factory answer 7 yes' | bash`,
    `echo 'bun run factory answer 7 yes' | env bash`,
    `bash <<< 'bun run factory answer 7 yes'`,
    `bash <<EOF\necho hi\nEOF`,
    `bash -s`,
    `cat x | bash -s -- arg`,
    `zsh <<< 'x'`,
    `busybox sh <<< 'x'`,
    `sh -`,
  ])('denies `%s` to everyone', (command) => {
    expect(j.bash(null, command, j.root)).toContain('stdin')
    expect(j.bash(EVAL, command)).toContain('stdin')
  })

  test('lets a shell run a script file', () => {
    expect(j.bash(null, 'bash x.sh', j.root)).toBeNull()
    expect(j.bash(null, 'sh ./x.sh arg', j.root)).toBeNull()
    expect(j.bash(null, 'sh < script.sh', j.root)).toBeNull()
    expect(j.bash(null, 'bash -e x.sh', j.root)).toBeNull()
  })
})
