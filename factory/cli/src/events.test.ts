import { describe, expect, test } from 'bun:test'
import { eventsFromHook, locate, type HookInput } from './events.ts'
import { makeJob } from './job-fixture.ts'

const job = makeJob()
const places = { worktree: job.worktree, handoffDir: `${job.worktree}/factory/.jobs/7` }

describe('locate', () => {
  test('a path in the worktree is in the repo area, relative to it', () => {
    expect(locate(`${job.worktree}/apps/api/src/app.ts`, places)).toEqual({
      area: 'repo',
      path: 'apps/api/src/app.ts',
    })
  })

  test("a path in the worktree's job folder is in the job area", () => {
    expect(locate(`${job.worktree}/factory/.jobs/7/build-notes.md`, places)).toEqual({
      area: 'job',
      path: 'build-notes.md',
    })
  })

  test("the main checkout's job folder, where the state lives, is outside", () => {
    expect(locate('/repo/factory/.jobs/7/acceptance.md', places)).toEqual({
      area: 'outside',
      path: '/repo/factory/.jobs/7/acceptance.md',
    })
  })

  test('the main checkout is outside', () => {
    expect(locate('/repo/apps/api/src/app.ts', places)).toEqual({
      area: 'outside',
      path: '/repo/apps/api/src/app.ts',
    })
  })

  test('a sibling folder that shares a prefix is outside', () => {
    expect(locate(`${job.worktree}-other/a.ts`, places).area).toBe('outside')
  })
})

describe('eventsFromHook: Read', () => {
  const SECRET = 'const secretToken = "do-not-log-this"'
  const content = `${SECRET}\nline two\nline three`
  const input: HookInput = {
    session_id: 's',
    hook_event_name: 'PreToolUse',
    agent_id: 'b1',
    agent_type: 'factory-build',
    tool_name: 'Read',
    tool_input: { file_path: `${job.worktree}/apps/api/src/app.ts`, offset: 2, limit: 1 },
  }
  const context = { job, handoffDir: places.handoffDir, now: 'now', readText: () => content }
  const [event] = eventsFromHook(input, context)

  test('logs the path, the line range and the tokens', () => {
    expect(event).toMatchObject({
      kind: 'read',
      target: { area: 'repo', path: 'apps/api/src/app.ts' },
      lines: { offset: 2, limit: 1 },
      tokens: 2,
    })
  })

  test('never logs the file content', () => {
    expect(JSON.stringify(event)).not.toContain('secretToken')
    expect(JSON.stringify(event)).not.toContain('line two')
  })

  test('logs no tokens when the file can not be read', () => {
    const [unreadable] = eventsFromHook(input, { ...context, readText: () => null })
    expect(unreadable?.tokens).toBeUndefined()
  })
})

describe('eventsFromHook: writes', () => {
  const base = { session_id: 's', tool_name: 'Edit', tool_input: { file_path: '/repo/x' } }
  const context = { job, handoffDir: places.handoffDir, now: 'now', readText: () => null }

  test('an edit is not logged before it happens', () => {
    expect(eventsFromHook({ ...base, hook_event_name: 'PreToolUse' }, context)).toEqual([])
  })

  test('an edit is logged once it happened', () => {
    const [event] = eventsFromHook({ ...base, hook_event_name: 'PostToolUse' }, context)
    expect(event?.kind).toBe('write')
  })
})
