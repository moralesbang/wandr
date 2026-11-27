// The event log, factory/.jobs/<n>/events.jsonl in the main checkout: written only by the CLI and
// by Claude Code hooks.
// It keeps paths, line ranges and sizes, never file contents.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { z } from 'zod'
import { stateDir, type Job } from './job.ts'
import { canonical } from './paths.ts'
import { usageOf } from './usage.ts'
import type { Area, Target } from './visibility.ts'

export type AgentRef = { id: string; type: string }

export type FactoryEvent = {
  t: string
  job: number
  source: 'hook' | 'cli'
  /** The agent run that acted; absent for the orchestrator (the main session) and the CLI. */
  agent?: AgentRef
  kind: string
  toolUseId?: string
  target?: Target
  lines?: { offset?: number; limit?: number }
  tokens?: number
  detail?: Record<string, unknown>
}

export function appendEvent(root: string, event: FactoryEvent): void {
  const dir = stateDir(root, event.job)
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify(event)}\n`)
}

/** Every event of a job's log, oldest first; a line that doesn't parse is skipped. */
export function readEvents(root: string, job: number): FactoryEvent[] {
  const file = join(stateDir(root, job), 'events.jsonl')
  if (!existsSync(file)) return []
  const events: FactoryEvent[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    try {
      if (line.trim()) events.push(JSON.parse(line) as FactoryEvent)
    } catch {
      // A line cut short by a crash is not the log's fault.
    }
  }
  return events
}

export const cliEvent = (
  job: number,
  kind: string,
  detail?: Record<string, unknown>,
): FactoryEvent => ({ t: new Date().toISOString(), job, source: 'cli', kind, detail })

/** The fields of Claude Code's hook input the log uses. */
export const HookInput = z.looseObject({
  session_id: z.string(),
  hook_event_name: z.string(),
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
  tool_input: z.record(z.string(), z.unknown()).optional(),
  tool_response: z.unknown().optional(),
  file_path: z.string().optional(),
  load_reason: z.string().optional(),
  /** The main session's transcript, which is the orchestrator's. */
  transcript_path: z.string().optional(),
  /** The stopping subagent's own transcript. */
  agent_transcript_path: z.string().optional(),
})
export type HookInput = z.infer<typeof HookInput>

/** Where a job's areas are on disk: its worktree, and the handoff folder inside it. */
export type Places = { worktree: string; handoffDir: string }

/**
 * Places an absolute path in its area: the job's handoff folder, the rest of its worktree, or
 * outside both. The handoff folder sits inside the worktree, so it is matched first. The main
 * checkout, its copy of the job's folder included, is outside. Symlinks are resolved on both
 * sides, so a link in the worktree is placed where it leads.
 */
export function locate(path: string, places: Places): Target {
  const real = canonical(path)
  const inside = (dir: string) => {
    const rel = relative(canonical(dir), real)
    return rel && !rel.startsWith('..') && !rel.startsWith(sep) ? rel.split(sep).join('/') : null
  }
  const asJob = inside(places.handoffDir)
  if (asJob) return { area: 'job', path: asJob }
  const asRepo = inside(places.worktree)
  if (asRepo) return { area: 'repo', path: asRepo }
  return { area: 'outside' as Area, path: real }
}

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)
const num = (value: unknown) => (typeof value === 'number' ? value : undefined)

/** Roughly 4 characters per token, over the lines a Read returns (2000 by default). */
export function approximateTokens(content: string, offset = 1, limit = 2000): number {
  const lines = content.split('\n').slice(Math.max(offset - 1, 0), Math.max(offset - 1, 0) + limit)
  return Math.ceil(lines.join('\n').length / 4)
}

export type HookContext = {
  job: Job
  /** The job's handoff folder, in its worktree. */
  handoffDir: string
  now: string
  /** Reads a file's text to size it; returns null when it can't. Never logged. */
  readText: (path: string) => string | null
}

/** Turns one hook input into the events it logs; an event of no interest logs nothing. */
export function eventsFromHook(input: HookInput, context: HookContext): FactoryEvent[] {
  const places: Places = { worktree: context.job.worktree, handoffDir: context.handoffDir }
  const base = {
    t: context.now,
    job: context.job.number,
    source: 'hook' as const,
    ...(input.agent_id
      ? { agent: { id: input.agent_id, type: input.agent_type ?? 'unknown' } }
      : {}),
    ...(input.tool_use_id ? { toolUseId: input.tool_use_id } : {}),
  }
  const toolInput = input.tool_input ?? {}

  switch (input.hook_event_name) {
    case 'SubagentStart':
      return [{ ...base, kind: 'agent.start' }]
    case 'SubagentStop':
      return [
        { ...base, kind: 'agent.stop' },
        // A resumed subagent stops again with the same transcript: the latest event of a run wins.
        ...usageEvents(input.agent_transcript_path, base, context),
        ...usageEvents(input.transcript_path, orchestrator(base), context),
      ]
    case 'Stop':
      return usageEvents(input.transcript_path, orchestrator(base), context)
    case 'InstructionsLoaded':
      return input.file_path
        ? [
            {
              ...base,
              kind: 'instructions',
              target: locate(input.file_path, places),
              detail: { reason: input.load_reason },
            },
          ]
        : []
    case 'PreToolUse':
      return preToolEvents(input, toolInput, base, places, context)
    case 'PostToolUse':
      return postToolEvents(input, toolInput, base, places)
    default:
      return []
  }
}

type Base = Omit<FactoryEvent, 'kind'>

const orchestrator = ({ agent: _agent, ...rest }: Base): Base => rest

/** The run's total so far, from the whole transcript; nothing when it can't be read. */
function usageEvents(path: string | undefined, base: Base, context: HookContext): FactoryEvent[] {
  const usage = path ? usageOf(path, context.readText) : null
  return usage ? [{ ...base, kind: 'usage', detail: usage }] : []
}

function preToolEvents(
  input: HookInput,
  toolInput: Record<string, unknown>,
  base: Base,
  places: Places,
  context: HookContext,
): FactoryEvent[] {
  const path = str(toolInput.file_path) ?? str(toolInput.notebook_path)
  switch (input.tool_name) {
    case 'Read': {
      if (!path) return []
      const offset = num(toolInput.offset)
      const limit = num(toolInput.limit)
      const content = context.readText(path)
      return [
        {
          ...base,
          kind: 'read',
          target: locate(path, places),
          lines: { offset, limit },
          ...(content === null ? {} : { tokens: approximateTokens(content, offset, limit) }),
        },
      ]
    }
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      // Logged after the fact, in PostToolUse: only a write that happened counts.
      return []
    case 'Grep':
    case 'Glob': {
      const searched = str(toolInput.path)
      return [
        {
          ...base,
          kind: 'search',
          ...(searched ? { target: locate(searched, places) } : {}),
          detail: {
            tool: input.tool_name,
            pattern: str(toolInput.pattern),
            ...(str(toolInput.glob) ? { glob: str(toolInput.glob) } : {}),
          },
        },
      ]
    }
    case 'Bash':
      return [
        {
          ...base,
          kind: 'bash',
          detail: {
            command: (str(toolInput.command) ?? '').slice(0, 4000),
            ...(str(input.cwd) ? { cwd: str(input.cwd) } : {}),
          },
        },
      ]
    case 'Agent':
    case 'Task':
      return [
        {
          ...base,
          kind: 'agent.prompt',
          detail: {
            subagentType: str(toolInput.subagent_type),
            description: str(toolInput.description),
            prompt: str(toolInput.prompt),
          },
        },
      ]
    default:
      return input.tool_name ? [{ ...base, kind: 'tool', detail: { tool: input.tool_name } }] : []
  }
}

function postToolEvents(
  input: HookInput,
  toolInput: Record<string, unknown>,
  base: Base,
  places: Places,
): FactoryEvent[] {
  const response = (input.tool_response ?? {}) as Record<string, unknown>
  const path = str(toolInput.file_path) ?? str(toolInput.notebook_path)
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(input.tool_name ?? '') && path) {
    return [{ ...base, kind: 'write', target: locate(path, places) }]
  }
  if ((input.tool_name === 'Agent' || input.tool_name === 'Task') && str(response.agentId)) {
    return [
      {
        ...base,
        kind: 'agent.launched',
        detail: { childId: str(response.agentId), childType: str(response.agentType) },
      },
    ]
  }
  if (input.tool_name === 'Bash' && response.bashEditDiff !== undefined) {
    const diff = response.bashEditDiff
    const files = Array.isArray(diff)
      ? diff.map((entry) =>
          typeof entry === 'string'
            ? entry
            : (str((entry as Record<string, unknown>).file_path) ??
              str((entry as Record<string, unknown>).filePath) ??
              str((entry as Record<string, unknown>).path) ??
              '?'),
        )
      : typeof diff === 'object' && diff !== null
        ? Object.keys(diff)
        : []
    return files.length ? [{ ...base, kind: 'bash.files', detail: { files } }] : []
  }
  return []
}
