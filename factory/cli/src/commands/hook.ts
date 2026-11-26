// Entry points for Claude Code's hooks (.claude/settings.json). Each reads the hook input on
// stdin; outside a factory job both do nothing.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendEvent, eventsFromHook, HookInput, locate, type FactoryEvent } from '../events.ts'
import { findJobBySession, jobDir, jobsDir, type Job } from '../job.ts'
import { changedBetween, workingTree } from '../shell.ts'
import { classifyWrite } from '../visibility.ts'

const readText = (path: string) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** The hook input and the job its session runs, or null outside a factory job. */
function find(root: string, stdin: string): { input: HookInput; job: Job; dir: string } | null {
  const input = HookInput.parse(JSON.parse(stdin))
  const job = findJobBySession(root, input.session_id)
  return job ? { input, job, dir: jobDir(root, job.number) } : null
}

const logError = (root: string, hook: string, error: unknown) => {
  mkdirSync(jobsDir(root), { recursive: true })
  appendFileSync(
    join(jobsDir(root), 'hook-errors.log'),
    `${new Date().toISOString()} ${hook} ${String(error)}\n`,
  )
}

/** Records the worktree's state when an agent starts, and what it changed when it stops. */
async function withRunChanges(events: FactoryEvent[], input: HookInput, job: Job, dir: string) {
  if (!input.agent_id) return events
  const runs = join(dir, 'runs')
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
    const { input, job, dir } = found
    const events = eventsFromHook(input, {
      job,
      jobDir: dir,
      now: new Date().toISOString(),
      readText,
    })
    for (const event of await withRunChanges(events, input, job, dir)) appendEvent(root, event)
  } catch (error) {
    logError(root, 'log', error)
  }
}

/**
 * Denies an Edit or Write outside the agent's write scope. Prints the PreToolUse decision on
 * stdout; prints nothing to let the call through. Fails open: the CLI gate is the final verdict.
 */
export function hookGuard(root: string, stdin: string): string {
  try {
    const found = find(root, stdin)
    if (!found) return ''
    const { input, job, dir } = found
    // The orchestrator, in the main session, isn't guarded: its writes are logged.
    if (!input.agent_id) return ''
    const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path
    if (typeof path !== 'string') return ''
    const target = locate(path, { worktree: job.worktree, jobDir: dir })
    const verdict = classifyWrite(input.agent_type ?? 'unknown', target)
    if (verdict.ok) return ''
    appendEvent(root, {
      t: new Date().toISOString(),
      job: job.number,
      source: 'hook',
      agent: { id: input.agent_id, type: input.agent_type ?? 'unknown' },
      kind: 'write.denied',
      ...(input.tool_use_id ? { toolUseId: input.tool_use_id } : {}),
      target,
      detail: { reason: verdict.reason },
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
