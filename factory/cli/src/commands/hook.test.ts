// The guard decides where an agent may write. The handoff folder lives in the job's worktree,
// the only place Claude Code lets a session that entered the worktree write, so the guard must let
// each agent write its own handoff file there and still deny the rest of factory/.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { readEvents } from '../events.ts'
import { saveJob } from '../job.ts'
import { hookGuard, hookLog } from './hook.ts'

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

const logged = () =>
  readEvents(root, 7)
    .filter((event) => event.kind === 'usage')
    .map((event) => ({
      run: event.agent?.id ?? 'orchestrator',
      usd: (event.detail as { usd: number }).usd,
    }))

const log = (input: Record<string, unknown>) =>
  hookLog(root, JSON.stringify({ session_id: 'job-session', ...input }))

describe('hook log: usage', () => {
  const fixtures = join(import.meta.dir, '..', 'usage-fixtures', 'job13')
  test("a subagent's stop and the main session's turn end log each run's cost", async () => {
    const reviewer = 'agent-a97330887a0a40f7a'
    await log({
      hook_event_name: 'SubagentStop',
      agent_id: 'a97330887a0a40f7a',
      agent_type: 'factory-test-reviewer',
      agent_transcript_path: join(fixtures, `${reviewer}.jsonl`),
      transcript_path: join(fixtures, 'main.jsonl'),
    })
    await log({ hook_event_name: 'Stop', transcript_path: join(fixtures, 'main.jsonl') })

    const runs = logged()
    expect(runs.map((r) => r.run)).toEqual(['a97330887a0a40f7a', 'orchestrator', 'orchestrator'])
    expect(Math.abs((runs[0]?.usd ?? 0) - 1.09)).toBeLessThan(0.01)
    expect(Math.abs((runs[1]?.usd ?? 0) - 1.57)).toBeLessThan(0.01)
  })

  test('a transcript that is gone logs the stop and breaks nothing', async () => {
    await log({
      hook_event_name: 'SubagentStop',
      agent_id: 'gone',
      agent_type: 'factory-build',
      agent_transcript_path: join(root, 'no-such.jsonl'),
    })
    expect(readEvents(root, 7).map((event) => event.kind)).toEqual(['agent.stop'])
  })
})
