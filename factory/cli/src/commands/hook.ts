// Entry points for Claude Code's hooks (.claude/settings.json). Each reads the hook input on
// stdin; outside a factory job both do nothing.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  appendEvent,
  eventsFromHook,
  HookInput,
  locate,
  type FactoryEvent,
  type Places,
} from '../events.ts'
import { findJobBySession, handoffDir, jobsDir, stateDir, type Job } from '../job.ts'
import { isWithin } from '../paths.ts'
import { changedBetween, workingTree } from '../shell.ts'
import { bashPolicy } from '../bash-policy.ts'
import { allow, deny, type Policy } from '../policy.ts'
import { agentPolicy, messagePolicy, readPolicy } from '../read-guard.ts'
import { isSealedName, loadSeal } from '../seal.ts'
import { classifyWrite } from '../visibility.ts'

const readText = (path: string) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** The hook input and the job its session runs, or null outside a factory job. */
function find(root: string, stdin: string): { input: HookInput; job: Job } | null {
  const input = HookInput.parse(JSON.parse(stdin))
  const job = findJobBySession(root, input.session_id)
  return job ? { input, job } : null
}

const logError = (root: string, hook: string, error: unknown) => {
  mkdirSync(jobsDir(root), { recursive: true })
  appendFileSync(
    join(jobsDir(root), 'hook-errors.log'),
    `${new Date().toISOString()} ${hook} ${String(error)}\n`,
  )
}

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
    if (!found) return
    const { input, job } = found
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

/**
 * Edit and Write by an agent stay inside its write column. Nobody, the orchestrator included, writes
 * the job's state in the main checkout (only the CLI and the hooks do) or, while the job is sealed,
 * a sealed name in the job's folder: `factory unseal` would refuse to overwrite it.
 */
const writePolicy: Policy = ({ root, job, input, places, agent }) => {
  const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path
  if (typeof path !== 'string') return allow
  const absolute = resolve(path)
  if (!agent && isWithin(absolute, jobsDir(root))) {
    return deny(
      `${absolute} is the job's state in the main checkout, written only by the CLI and the hooks. Use \`bun run factory <command>\`; what you hand an agent goes in ${places.handoffDir}.`,
    )
  }
  const sealed = loadSeal(root, job.number)
  const rel = relative(places.handoffDir, absolute)
  if (sealed && isWithin(absolute, places.handoffDir) && isSealedName(rel)) {
    return deny(
      `Job #${job.number} is sealed for review pass ${sealed.pass}: ${rel} is sealed material, and \`bun run factory unseal ${job.number}\` would refuse to overwrite it. Write it after the unseal.`,
    )
  }
  if (!agent) return allow
  return classifyWrite(agent.type, locate(path, places))
}

/** Which policy judges each tool, and the event a denial logs. */
const POLICIES: Record<string, { policy: Policy; kind: string }> = {
  Edit: { policy: writePolicy, kind: 'write.denied' },
  Write: { policy: writePolicy, kind: 'write.denied' },
  NotebookEdit: { policy: writePolicy, kind: 'write.denied' },
  Read: { policy: readPolicy, kind: 'read.denied' },
  Grep: { policy: readPolicy, kind: 'read.denied' },
  Glob: { policy: readPolicy, kind: 'read.denied' },
  Bash: { policy: bashPolicy, kind: 'bash.denied' },
  Agent: { policy: agentPolicy, kind: 'agent.denied' },
  Task: { policy: agentPolicy, kind: 'agent.denied' },
  SendMessage: { policy: messagePolicy, kind: 'agent.denied' },
}

/** What a denial logs besides its reason: the path it read or wrote, the command, the recipient. */
function deniedTarget(input: HookInput, places: Places): Partial<FactoryEvent> {
  const toolInput = input.tool_input ?? {}
  const text = (key: string) => (typeof toolInput[key] === 'string' ? toolInput[key] : undefined)
  const path = text('file_path') ?? text('notebook_path') ?? text('path')
  return {
    ...(path ? { target: locate(resolve(path), places) } : {}),
    detail: {
      ...(text('command') ? { command: text('command')?.slice(0, 300) } : {}),
      ...(text('pattern') ? { pattern: text('pattern') } : {}),
      ...(text('subagent_type') ? { subagentType: text('subagent_type') } : {}),
      ...(text('to') ? { to: text('to') } : {}),
    },
  }
}

/**
 * The synchronous PreToolUse guard: asks the tool's policy, logs a denial and prints the decision
 * on stdout; prints nothing to let the call through. Fails open: the CLI gate is the final verdict.
 */
export function hookGuard(root: string, stdin: string): string {
  try {
    const found = find(root, stdin)
    if (!found) return ''
    const { input, job } = found
    const entry = POLICIES[input.tool_name ?? '']
    if (!entry) return ''
    const places = { worktree: job.worktree, handoffDir: handoffDir(job) }
    const agent = input.agent_id
      ? { id: input.agent_id, type: input.agent_type ?? 'unknown' }
      : undefined
    const verdict = entry.policy({ root, job, input, places, ...(agent ? { agent } : {}) })
    if (verdict.ok) return ''
    const denied = deniedTarget(input, places)
    appendEvent(root, {
      t: new Date().toISOString(),
      job: job.number,
      source: 'hook',
      ...(agent ? { agent } : {}),
      kind: entry.kind,
      ...(input.tool_use_id ? { toolUseId: input.tool_use_id } : {}),
      ...denied,
      detail: { ...denied.detail, reason: verdict.reason },
    })
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: verdict.reason,
      },
    })
  } catch (error) {
    logError(root, 'guard', error)
    return ''
  }
}
