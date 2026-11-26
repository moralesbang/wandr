// Each reviewer probes the build by mutating its own disposable checkout, inside the job's folder.
// The guard must let it write there, so it never falls back to Bash, and must keep it out of the
// other reviewer's sandbox, so one reviewer's mutation never reaches the other's evidence.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEvents } from '../events.ts'
import { makeJob } from '../job-fixture.ts'
import { saveJob } from '../job.ts'
import { hookGuard } from './hook.ts'

let root = ''
let worktree = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-guard-sandbox-'))
  worktree = join(root, '.claude', 'worktrees', '7-add-a-thing')
  saveJob(root, makeJob({ worktree, session: 'job-session' }))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const sandbox = (role: string, file: string) =>
  join(worktree, 'factory', '.jobs', '7', 'sandbox', role, file)

const guard = (agent: string, tool: string, path: string) =>
  hookGuard(
    root,
    JSON.stringify({
      session_id: 'job-session',
      hook_event_name: 'PreToolUse',
      agent_id: 'run-1',
      agent_type: agent,
      tool_name: tool,
      tool_input: { file_path: path },
    }),
  )

const denied = (output: string) =>
  (JSON.parse(output) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput
    .permissionDecision === 'deny'

describe('hook guard: reviewer sandboxes', () => {
  test.each([
    ['factory-evaluator', 'evaluator', 'Edit', 'apps/web/public/manifest.webmanifest'],
    ['factory-evaluator', 'evaluator', 'Write', 'probe.mjs'],
    ['factory-test-reviewer', 'test-reviewer', 'Write', '.mut/apps/web/dist/index.html'],
    ['factory-test-reviewer', 'test-reviewer', 'Edit', 'apps/api/src/app.ts'],
  ])('lets %s write in its own sandbox (%s): %s %s', (agent, role, tool, file) => {
    expect(guard(agent, tool, sandbox(role, file))).toBe('')
    expect(readEvents(root, 7).filter((event) => event.kind === 'write.denied')).toEqual([])
  })

  test.each([
    ['factory-evaluator', 'test-reviewer'],
    ['factory-test-reviewer', 'evaluator'],
  ])("denies %s writing in the %s's sandbox, and logs it", (agent, other) => {
    expect(
      denied(guard(agent, 'Write', sandbox(other, 'apps/web/public/manifest.webmanifest'))),
    ).toBe(true)
    expect(readEvents(root, 7).map((event) => event.kind)).toEqual(['write.denied'])
  })

  test("denies the build agent writing in a reviewer's sandbox", () => {
    expect(
      denied(guard('factory-build', 'Edit', sandbox('evaluator', 'apps/api/src/app.ts'))),
    ).toBe(true)
  })

  test('still denies a reviewer writing in the job worktree itself', () => {
    expect(denied(guard('factory-evaluator', 'Edit', join(worktree, 'apps/api/src/app.ts')))).toBe(
      true,
    )
  })
})
