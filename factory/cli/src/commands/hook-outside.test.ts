// Value record (T-009). Guarantee: a write outside the repo is denied with text that says where it
// leads. Defect caught: job #15's orchestrator, before routing, edited `~/.claude/settings.json`
// and was told "the repo is read-only", naming the wrong place. No acceptance test gives it: the
// invariant (FI-012) is that the write is denied, which it was; this is about the message. Level:
// the guard, as Claude Code calls it.

import { afterEach, describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { guardJob, type GuardJob } from '../guard-fixture.ts'

let j: GuardJob
afterEach(() => j.cleanup())

describe('before routing, a write outside the repo', () => {
  test.each(['Edit', 'Write'])(
    '%s of ~/.claude/settings.json names Claude Code’s files',
    (tool) => {
      j = guardJob({ sealed: false, job: { routingRequired: true, routing: null } })
      const reason = j.guard(null, tool, {
        file_path: join(homedir(), '.claude', 'settings.json'),
        content: '{}',
        old_string: 'a',
        new_string: 'b',
      })
      expect(reason).toContain('Claude Code')
      expect(reason).not.toContain('repo is read-only')
    },
  )

  test('a path outside the worktree names the worktree', () => {
    j = guardJob({ sealed: false, job: { routingRequired: true, routing: null } })
    const reason = j.guard(null, 'Write', { file_path: '/etc/hosts-x', content: 'x' })
    expect(reason).toContain(j.worktree)
    expect(reason).not.toContain('repo is read-only')
  })

  test('a file in the repo keeps the read-only text', () => {
    j = guardJob({ sealed: false, job: { routingRequired: true, routing: null } })
    const reason = j.guard(null, 'Write', {
      file_path: join(j.worktree, 'apps/web/src/main.ts'),
      content: 'x',
    })
    expect(reason).toContain('Before executable routing, the repo is read-only.')
  })
})
