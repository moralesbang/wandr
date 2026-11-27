// The guard decides where an agent may write. The handoff folder lives in the job's worktree,
// the only place Claude Code lets a session that entered the worktree write, so the guard must let
// each agent write its own handoff file there and still deny the rest of factory/.

import { $ } from 'bun'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
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

const call = (tool: string, toolInput: Record<string, unknown>, agent?: string) => {
  const out = hookGuard(
    root,
    JSON.stringify({
      session_id: 'job-session',
      hook_event_name: 'PreToolUse',
      tool_name: tool,
      cwd: agent ? worktree : root,
      tool_input: toolInput,
      ...(agent ? { agent_id: 'run-1', agent_type: agent } : {}),
    }),
  )
  return out
    ? (JSON.parse(out) as { hookSpecificOutput: { permissionDecisionReason: string } })
        .hookSpecificOutput.permissionDecisionReason
    : null
}

const sealed = () => join(root, 'factory', '.jobs', '7', 'sealed', 'build-notes.md')

// The guard used to let every call through on any error, so one unreadable file anywhere in the
// state folder opened every job's seal.
describe('hook guard: fails closed inside a job', () => {
  test("another job's broken job.json leaves this job's guard standing", () => {
    mkdirSync(join(root, 'factory', '.jobs', '99'), { recursive: true })
    writeFileSync(join(root, 'factory', '.jobs', '99', 'job.json'), '{\n')
    expect(call('Bash', { command: `cat ${sealed()}` }, 'factory-evaluator')).not.toBeNull()
    expect(call('Bash', { command: 'bun run factory answer 7 yes' })).toContain('answer')
  })

  test("an error judging a call of the job's session denies it, and names the log", () => {
    mkdirSync(join(root, 'factory', '.jobs', '7'), { recursive: true })
    writeFileSync(join(root, 'factory', '.jobs', '7', 'seal.json'), '{\n')
    const reason = call('Read', { file_path: join(worktree, 'apps/x.ts') }, 'factory-evaluator')
    expect(reason).toContain('hook-errors.log')
    expect(readFileSync(join(root, 'factory', '.jobs', 'hook-errors.log'), 'utf8')).toContain(
      'guard',
    )
  })

  test('outside a job it still lets everything through', () => {
    const out = hookGuard(
      root,
      JSON.stringify({
        session_id: 'another',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'bun run factory answer 7 x' },
      }),
    )
    expect(out).toBe('')
    expect(hookGuard(root, 'not json')).toBe('')
  })
})

// The hook matches every tool (.claude/settings.json), so a tool the guard has no policy for is
// still judged: Monitor runs a shell command, and an agent may use only the tools listed.
describe('hook guard: tools without a policy of their own', () => {
  test('Monitor and any tool with a shell command are judged as Bash', () => {
    expect(
      call('Monitor', { command: `cat ${sealed()}`, description: 'x' }, 'Explore'),
    ).not.toBeNull()
    expect(
      call('Monitor', { command: 'bun run factory answer 7 yes', description: 'x' }),
    ).toContain('answer')
    expect(call('PowerShell', { command: 'bun run factory answer 7 yes' })).toContain('answer')
  })

  test.each([
    ['NotebookRead', { notebook_path: '/x/build-notes.md' }],
    ['LSP', { operation: 'documentSymbol', filePath: '/x/build-notes.md' }],
    ['WebFetch', { url: 'file:///x/build-notes.md', prompt: 'x' }],
    ['WebSearch', { query: 'x' }],
    ['mcp__claude-in-chrome__navigate', { url: 'file:///x' }],
    ['Skill', { skill: 'x' }],
  ])('denies an agent %s, and logs it', (tool, input) => {
    expect(call(tool, input, 'factory-evaluator')).toContain('not a tool an agent')
    expect(readEvents(root, 7).map((event) => event.kind)).toEqual(['tool.denied'])
  })

  test.each(['TodoWrite', 'ToolSearch', 'TaskStop'])('lets an agent use %s', (tool) => {
    expect(call(tool, {}, 'factory-build')).toBeNull()
  })

  test('the orchestrator keeps the tools it has', () => {
    expect(call('WebSearch', { query: 'x' })).toBeNull()
    expect(call('mcp__claude_ai_Claude_Docs__guide', { items: [] })).toBeNull()
  })
})

describe('hook guard: a symlink is judged where it leads', () => {
  test("denies Write and Edit through a link to the main checkout's state", () => {
    mkdirSync(join(root, 'factory', '.jobs', '7'), { recursive: true })
    mkdirSync(worktree, { recursive: true })
    symlinkSync('/', join(worktree, 'r'))
    const state = join(worktree, 'r', root, 'factory', '.jobs', '7', 'job.json')
    expect(call('Write', { file_path: state, content: '{}' }, 'factory-build')).not.toBeNull()
    expect(
      call('Edit', { file_path: state, old_string: 'a', new_string: 'b' }, 'factory-test'),
    ).not.toBeNull()
    symlinkSync(join(root, 'factory'), join(worktree, 'j'))
    expect(
      call('Write', { file_path: join(worktree, 'j', '.jobs', '7', 'job.json'), content: '{}' }),
    ).toContain("job's state")
  })
})

// agent_id names the files the log hook writes (runs/<agent_id>.tree): a forged one must not
// climb out of the state folder, nor reach the log.
describe('hook log: agent ids', () => {
  test('ignores an event whose agent id is not an id', async () => {
    mkdirSync(worktree, { recursive: true })
    await $`git init -q ${worktree}`
    await hookLog(
      root,
      JSON.stringify({
        session_id: 'job-session',
        hook_event_name: 'SubagentStart',
        agent_id: '../../../../escaped',
        agent_type: 'factory-evaluator',
      }),
    )
    expect(readEvents(root, 7)).toEqual([])
    expect(existsSync(join(root, 'escaped.tree'))).toBe(false)
  })
})
