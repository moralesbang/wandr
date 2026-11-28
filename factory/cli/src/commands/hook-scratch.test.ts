// Value record (T-009). Guarantee: a writer agent denied a write outside the worktree is told
// where its scratch output goes, and writes there freely. Defect caught: job #15's build agent,
// denied three times for redirecting `factory check` output into Claude Code's scratchpad, ignored
// "Work in the worktree" and tried again. FI-012 defends the denial, not its wording, so no
// acceptance test gives this. Level: the guard, as Claude Code calls it.

import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { BUILD, DIAG, guardJob, TEST, type GuardJob } from '../guard-fixture.ts'

let f: GuardJob
afterEach(() => f.cleanup())

const SCRATCHPAD =
  '/private/tmp/claude-501/-Users-moralesbang-Projects-wandr/21b7ba14-5c17-4d45-911a-f5de025ffde9/scratchpad'

describe('scratch output of a writer agent', () => {
  test.each([BUILD, TEST])(
    'the job 15 redirect into the scratchpad stays denied to $agent_type and names the worktree scratch folder',
    (who) => {
      f = guardJob({ sealed: false })
      const denial = f.bash(
        who,
        `bun run factory check 7 > ${SCRATCHPAD}/c.txt 2>&1; tail -40 ${SCRATCHPAD}/c.txt`,
      )
      expect(denial).toContain('Write outside the job')
      expect(denial).toContain(`${join(f.worktree, '.scratch')}/`)
    },
  )

  test('the Write tool outside the worktree names it too', () => {
    f = guardJob({ sealed: false })
    const denial = f.guard(BUILD, 'Write', { file_path: `${SCRATCHPAD}/c.txt`, content: 'x' })
    expect(denial).toContain(`${join(f.worktree, '.scratch')}/`)
  })

  test.each([BUILD, TEST])('$agent_type may redirect output into .scratch/', (who) => {
    f = guardJob({ sealed: false })
    expect(
      f.bash(who, 'bun run factory check 7 > .scratch/c.txt 2>&1; tail -40 .scratch/c.txt'),
    ).toBeNull()
  })

  test('the diagnosis agent, which writes only diagnosis.md, is not pointed at a folder it cannot use', () => {
    f = guardJob({ sealed: false })
    const denial = f.bash(DIAG, `echo x > ${SCRATCHPAD}/c.txt`)
    expect(denial).toContain('Write outside the job')
    expect(denial).not.toContain('.scratch')
  })
})
