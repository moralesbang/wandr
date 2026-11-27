// Entry points for Claude Code's hooks (.claude/settings.json). Each reads the hook input on
// stdin; outside a factory job both do nothing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  appendEvent,
  eventsFromHook,
  HookInput,
  locate,
  type FactoryEvent,
  type Places,
} from '../events.ts'
import {
  locateSession,
  handoffDir,
  hookErrorsLog,
  logHookError,
  stateDir,
  type Job,
} from '../job.ts'
import { canonical } from '../paths.ts'
import { changedBetween, workingTree } from '../shell.ts'
import { bashPolicy } from '../bash-policy.ts'
import { allow, first, type Policy, type Verdict } from '../policy.ts'
import { agentPolicy, messagePolicy, readPolicy } from '../read-guard.ts'
import { writePolicy } from '../write-guard.ts'
import { launchedAgent, launchMatchesPlan, orchestratorSetting } from '../orchestrator-guard.ts'

const readText = (path: string) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * The hook input and the job its session runs, or null outside a factory job. A job whose job.json
 * doesn't read is still the session's job: `unreadable` carries its number.
 */
type Found = { input: HookInput; job: Job } | { input: HookInput; unreadable: number }

function find(root: string, stdin: string): Found | null {
  const input = HookInput.parse(JSON.parse(stdin))
  const located = locateSession(root, input.session_id)
  return located ? { input, ...located } : null
}

const logError = (root: string, hook: string, error: unknown) => {
  try {
    logHookError(root, hook, error)
  } catch {
    // Nowhere left to say it.
  }
}

/** Claude Code's agent ids are letters, digits, `_` and `-`; the log names files after them. */
const AGENT_ID = /^[A-Za-z0-9_-]+$/

/** Records the worktree's state when an agent starts, and what it changed when it stops. */
async function withRunChanges(events: FactoryEvent[], input: HookInput, job: Job, root: string) {
  if (!input.agent_id) return events
  const runs = join(stateDir(root, job.number), 'runs')
  const snapshot = join(runs, `${input.agent_id}.tree`)
  if (input.hook_event_name === 'SubagentStart') {
    mkdirSync(runs, { recursive: true })
    writeFileSync(snapshot, await workingTree(job.worktree))
    return events
  }
  if (input.hook_event_name === 'SubagentStop' && existsSync(snapshot)) {
    const before = readFileSync(snapshot, 'utf8').trim()
    const changed = await changedBetween(job.worktree, before, await workingTree(job.worktree))
    return events.map((event) =>
      event.kind === 'agent.stop' ? { ...event, detail: { ...event.detail, changed } } : event,
    )
  }
  return events
}

export async function hookLog(root: string, stdin: string): Promise<void> {
  try {
    const found = find(root, stdin)
    if (!found || !('job' in found)) return
    const { input, job } = found
    if (input.agent_id !== undefined && !AGENT_ID.test(input.agent_id)) {
      logError(root, 'log', `ignored an event with the agent id ${JSON.stringify(input.agent_id)}`)
      return
    }
    const events = eventsFromHook(input, {
      job,
      handoffDir: handoffDir(job),
      now: new Date().toISOString(),
      readText,
    })
    for (const event of await withRunChanges(events, input, job, root)) appendEvent(root, event)
  } catch (error) {
    logError(root, 'log', error)
  }
}

type Entry = { policy: Policy; kind: string }

const BASH: Entry = { policy: bashPolicy, kind: 'bash.denied' }

/** Which policy judges each tool, and the event a denial logs. */
const POLICIES: Record<string, Entry> = {
  Edit: { policy: writePolicy, kind: 'write.denied' },
  Write: { policy: writePolicy, kind: 'write.denied' },
  MultiEdit: { policy: writePolicy, kind: 'write.denied' },
  NotebookEdit: { policy: writePolicy, kind: 'write.denied' },
  Read: { policy: readPolicy, kind: 'read.denied' },
  Grep: { policy: readPolicy, kind: 'read.denied' },
  Glob: { policy: readPolicy, kind: 'read.denied' },
  Bash: BASH,
  // Monitor runs a shell command in the background, as Bash does.
  Monitor: BASH,
  Agent: { policy: agentPolicy, kind: 'agent.denied' },
  Task: { policy: agentPolicy, kind: 'agent.denied' },
  SendMessage: { policy: messagePolicy, kind: 'agent.denied' },
}

/**
 * The tools a subagent of a job may call: the ones the guard judges, and a few that touch no file
 * (a todo list, loading a deferred tool's schema, stopping its own background task). Any other
 * tool, an MCP server's included, reads or reaches what the guard can't judge.
 */
const SUBAGENT_TOOLS = new Set([...Object.keys(POLICIES), 'TodoWrite', 'ToolSearch', 'TaskStop'])

/**
 * What the orchestrator calls besides the above: the tools that move it between worktrees, ask the
 * user, wake it, notify, or run a skill. An MCP server's tool reaches what the guard can't judge
 * (a browser logged in to GitHub as the user), and an unknown tool is unjudged too.
 */
const ORCHESTRATOR_TOOLS = new Set([
  ...SUBAGENT_TOOLS,
  'EnterWorktree',
  'ExitWorktree',
  'TaskOutput',
  'TaskStop',
  'ListAgents',
  'AskUserQuestion',
  'Skill',
  'ToolSearch',
  'ScheduleWakeup',
  'ReadNotifications',
  'SendUserFile',
  'PushNotification',
])

/** The policy for a tool: its own, or Bash's for any tool that takes a shell command. */
const entryFor = (input: HookInput): Entry | null =>
  POLICIES[input.tool_name ?? ''] ?? (typeof input.tool_input?.command === 'string' ? BASH : null)

/** What a denial logs besides its reason: the path it read or wrote, the command, the recipient. */
function deniedTarget(input: HookInput, places: Places): Partial<FactoryEvent> {
  const toolInput = input.tool_input ?? {}
  const text = (key: string) => (typeof toolInput[key] === 'string' ? toolInput[key] : undefined)
  const path = text('file_path') ?? text('notebook_path') ?? text('path')
  return {
    ...(path ? { target: locate(path, places) } : {}),
    detail: {
      ...(text('command') ? { command: text('command')?.slice(0, 300) } : {}),
      ...(text('pattern') ? { pattern: text('pattern') } : {}),
      ...(text('subagent_type') ? { subagentType: text('subagent_type') } : {}),
      ...(text('to') ? { to: text('to') } : {}),
    },
  }
}

const denial = (reason: string) =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  })

/**
 * The synchronous PreToolUse guard: asks the tool's policy, logs a denial and prints the decision
 * on stdout; prints nothing to let the call through. Outside a factory job it lets everything
 * through. Inside one it fails closed: a call it can't judge, for any error, is denied.
 */
export function hookGuard(mainRoot: string, stdin: string): string {
  let found: Found | null
  try {
    found = find(mainRoot, stdin)
  } catch (error) {
    logError(mainRoot, 'guard', error)
    return ''
  }
  if (!found) return ''
  if ('unreadable' in found) {
    return denial(
      `The factory guard can't read job #${found.unreadable}'s state (its job.json doesn't parse; the error is in ${hookErrorsLog(mainRoot)}), and during a job a call it can't judge is denied. Tell the user in your reply; they fix or restore factory/.jobs/${found.unreadable}/job.json.`,
    )
  }
  try {
    return judge(mainRoot, found.input, found.job)
  } catch (error) {
    logError(mainRoot, 'guard', error)
    return denial(
      `The factory guard failed on this call (the error is in ${hookErrorsLog(mainRoot)}), and during a job a call it can't judge is denied. Try it another way, or report the failure in your reply.`,
    )
  }
}

/**
 * A denial for a tool the guard has no policy to judge: any tool but the allowed ones, an MCP
 * server's included. Null when the tool is allowed, to be judged by its own policy if it has one.
 */
function unjudged(tool: string, entry: Entry | null, agent: unknown): Verdict | null {
  if (agent) {
    return SUBAGENT_TOOLS.has(tool)
      ? null
      : {
          ok: false,
          reason: `${tool} is not a tool an agent of a factory job uses: the guard can't judge what it reads or reaches. Use Read, Grep, Glob, Bash, Edit or Write.`,
        }
  }
  if (tool.startsWith('mcp__')) {
    return {
      ok: false,
      reason: `${tool} is an MCP tool: during a job the orchestrator has none, since it reaches what the guard can't judge (a browser signed in to GitHub as the user, a mailbox). Use the CLI, Read, Write, Edit, Bash, Agent or SendMessage.`,
    }
  }
  return ORCHESTRATOR_TOOLS.has(tool) || entry
    ? null
    : {
        ok: false,
        reason: `${tool} is not a tool the orchestrator of a factory job uses: the guard can't judge what it reaches. Its tools: ${[...ORCHESTRATOR_TOOLS].join(', ')}.`,
      }
}

/** The verdict on one call of a job's session; every path judged where its symlinks lead. */
function judge(mainRoot: string, input: HookInput, found: Job): string {
  const root = canonical(mainRoot)
  const job = { ...found, worktree: canonical(found.worktree) }
  const places = { worktree: job.worktree, handoffDir: handoffDir(job) }
  const agent = input.agent_id
    ? { id: input.agent_id, type: input.agent_type ?? 'unknown' }
    : undefined
  const tool = input.tool_name ?? ''
  const entry = entryFor(input)
  const context = { root, job, input, places, ...(agent ? { agent } : {}) }
  const verdict =
    unjudged(tool, entry, agent) ??
    first([
      orchestratorSetting(context),
      entry ? entry.policy(context) : allow,
      launchMatchesPlan(context),
    ])
  if (!verdict || verdict.ok) {
    const launched = agent ? null : launchedAgent(tool, input.tool_input)
    // A launch the guard lets through uses its plan up: the next one needs a plan of its own.
    if (launched) {
      appendEvent(root, {
        t: new Date().toISOString(),
        job: job.number,
        source: 'hook',
        kind: 'launch.authorized',
        ...(input.tool_use_id ? { toolUseId: input.tool_use_id } : {}),
        detail: { agent: launched },
      })
    }
    return ''
  }
  const denied = deniedTarget(input, places)
  appendEvent(root, {
    t: new Date().toISOString(),
    job: job.number,
    source: 'hook',
    ...(agent ? { agent } : {}),
    kind: entry?.kind ?? 'tool.denied',
    ...(input.tool_use_id ? { toolUseId: input.tool_use_id } : {}),
    ...denied,
    detail: { ...denied.detail, reason: verdict.reason },
  })
  return denial(verdict.reason)
}
