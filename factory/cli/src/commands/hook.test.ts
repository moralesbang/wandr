// The guard decides where an agent may write. The handoff folder lives in the job's worktree,
// the only place Claude Code lets a session that entered the worktree write, so the guard must let
// each agent write its own handoff file there and still deny the rest of factory/.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { saveJob } from '../job.ts'
import { hookGuard } from './hook.ts'

let root = ''
let worktree = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-guard-'))
  worktree = join(root, '.claude', 'worktrees', '7-add-a-thing')
  saveJob(root, makeJob({ worktree, session: 'job-session' }))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const guard = (agent: string, path: string) =>
  hookGuard(
    root,
    JSON.stringify({
      session_id: 'job-session',
      hook_event_name: 'PreToolUse',
      agent_id: 'run-1',
      agent_type: agent,
      tool_name: 'Write',
      tool_input: { file_path: path },
    }),
  )

describe('hook guard: the job folder', () => {
  test.each([
    ['factory-test', 'acceptance.md'],
    ['factory-build', 'build-notes.md'],
    ['factory-evaluator', 'reviews/1.evaluator.blind.md'],
  ])("lets %s write %s in the worktree's job folder", (agent, file) => {
    expect(guard(agent, join(worktree, 'factory', '.jobs', '7', file))).toBe('')
  })

  test.each([
    [
      'factory-test',
      "the main checkout's job folder",
      () => join(root, 'factory/.jobs/7/acceptance.md'),
    ],
    [
      'factory-test',
      "another agent's handoff file",
      () => join(worktree, 'factory/.jobs/7/build-notes.md'),
    ],
    [
      'factory-build',
      "the job's state, copied into the worktree",
      () => join(worktree, 'factory/.jobs/7/job.json'),
    ],
    ['factory-build', 'the factory', () => join(worktree, 'factory/cli/src/paths.ts')],
    ['factory-test', 'the factory', () => join(worktree, 'factory/README.md')],
  ])('denies %s writing %s', (agent, _what, path) => {
    const decision = JSON.parse(guard(agent, path())) as {
      hookSpecificOutput: { permissionDecision: string }
    }
    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny')
  })
})
