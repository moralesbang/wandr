// Value record (T-009). Guarantee: an agent of a job can hand back its report, and writing
// `/dev/null` is not a write outside the worktree. Defect caught: job #15's 54 denials of
// `SubagentHandback` (every agent hit 3 to 8 as it finished) and `curl -s -o /dev/null` denied as
// "Write outside the job's worktree and folder". No acceptance test gives either: the invariants
// are about what the guard denies, and these are two things it must not. Level: the guard, as
// Claude Code calls it.

import { afterEach, describe, expect, test } from 'bun:test'
import { BUILD, EVAL, EXPLORE, guardJob, TEST, TR, type GuardJob } from '../guard-fixture.ts'

let f: GuardJob
afterEach(() => f.cleanup())

describe('SubagentHandback', () => {
  test.each([BUILD, TEST, EVAL, TR, EXPLORE])('is allowed to $agent_type', (who) => {
    f = guardJob({ sealed: false })
    expect(f.guard(who, 'SubagentHandback', { message: 'done: wrote acceptance.md' })).toBeNull()
  })

  test('other tools with no policy stay denied to an agent', () => {
    f = guardJob({ sealed: false })
    expect(f.guard(BUILD, 'WebFetch', { url: 'https://example.com' })).toContain('not a tool')
  })
})

describe('/dev/null is no write outside the worktree', () => {
  test.each([
    'curl -s -o /dev/null http://localhost:3100/health',
    'curl --output /dev/null http://localhost:3100/health',
    'echo x | tee /dev/null',
    'cp apps/web/src/main.ts /dev/null',
    'ls nothing 2>/dev/null',
    'bun test > /dev/null 2>&1',
  ])('lets a build agent run: %s', (command) => {
    f = guardJob({ sealed: false })
    expect(f.bash(BUILD, command)).toBeNull()
  })

  test.each([
    'curl -s -o /dev/tty http://localhost:3100/health',
    'cp apps/web/src/main.ts /etc/passwd',
  ])('and other targets are judged as before: %s', (command) => {
    f = guardJob({ sealed: false })
    expect(f.bash(BUILD, command)).not.toBeNull()
  })
})
