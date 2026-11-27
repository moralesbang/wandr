// A job in a temp root for the guard's tests, driven through hookGuard as Claude Code calls it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { hookGuard } from './commands/hook.ts'
import { appendEvent, type FactoryEvent } from './events.ts'
import { makeJob } from './job-fixture.ts'
import { saveJob, type Job } from './job.ts'
import { seal } from './seal.ts'

export const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

export const NOTES =
  'Adding width and height attributes to the icon links did not help at all here.'

export const SESSION = 'job-session'

export type Who = { agent_id: string; agent_type: string } | null
export const EVAL = { agent_id: 'e1', agent_type: 'factory-evaluator' }
export const TR = { agent_id: 't1', agent_type: 'factory-test-reviewer' }
export const BUILD = { agent_id: 'b1', agent_type: 'factory-build' }
export const TEST = { agent_id: 'a1', agent_type: 'factory-test' }
export const DIAG = { agent_id: 'd1', agent_type: 'factory-diagnose' }
export const EXPLORE = { agent_id: 'x1', agent_type: 'Explore' }

/** A main-session transcript whose latest assistant message ran opus at high effort. */
export function mainTranscript(root: string, model = 'claude-opus-5-5', effort = 'high') {
  const path = join(root, 'main-session.jsonl')
  put(
    path,
    `${JSON.stringify({ type: 'user', message: { role: 'user' } })}\n${JSON.stringify({ type: 'assistant', effort, message: { id: 'm1', model, usage: {} } })}\n`,
  )
  return path
}

let plans = 0

/**
 * What `factory launch` does before an Agent call: logs the plan, returns what the call carries,
 * the `header` its prompt starts with included.
 */
export function planLaunch(
  root: string,
  agent: string,
  task = 'review',
  model = 'opus',
  effort = 'medium',
) {
  const planId = (++plans).toString(16).padStart(8, '0')
  appendEvent(root, {
    t: new Date().toISOString(),
    job: 7,
    source: 'cli',
    kind: 'launch.planned',
    detail: { planId, agent, task, model, effort },
  })
  return { model, effort, planId, header: `factory-launch: 7 ${agent} ${task} ${planId}` }
}

/** An orchestrator's Agent call for a factory agent, carrying the plan `factory launch` made. */
export function plannedCall(root: string, agent: string, prompt: string, task = 'review') {
  const { model, effort, header } = planLaunch(root, agent, task)
  return {
    subagent_type: agent,
    description: 'review',
    prompt: `${header}\n${prompt}`,
    model,
    effort,
  }
}

export type GuardJob = ReturnType<typeof guardJob>

/** A job #7 in a temp root, its worktree laid out, optionally sealed for review pass rounds + 1. */
export function guardJob(
  options: {
    sealed?: boolean
    plan?: Record<string, string>
    rounds?: number
    job?: Partial<Job>
    roles?: string[]
    /**
     * `free` (the default) plans each factory launch the orchestrator makes and fills in its model
     * and effort, as the skill does, so a test about something else isn't judged on the plan;
     * `strict` leaves launches as the test wrote them.
     */
    launches?: 'free' | 'strict'
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'factory-guard-'))
  const worktree = join(root, '.claude', 'worktrees', '7-add-a-thing')
  const handoff = join(worktree, 'factory', '.jobs', '7')
  const rounds = options.rounds ?? 1
  const reviews = options.plan
    ? [
        {
          pass: rounds + 1,
          head: 'h',
          since: 'g',
          changed: [],
          risk: 'normal' as const,
          routingRevision: 0,
          raisedBy: [],
          roles: options.plan as never,
          at: 'x',
        },
      ]
    : []
  saveJob(root, makeJob({ worktree, session: SESSION, rounds, reviews, ...options.job }))
  put(join(handoff, 'issue.md'), '# Add a thing (#7)\n')
  put(join(handoff, 'gate.json'), '{}\n')
  put(join(handoff, 'build-notes.md'), `# Notes\n\n${NOTES}\n`)
  put(join(handoff, 'decision-requests', '1.md'), '# Context\n\nThe build escalated.\n')
  put(join(handoff, 'reviews', '1.evaluator.md'), 'Verdict: changes\n')
  put(join(handoff, 'reviews', '1.test-reviewer.md'), 'Verdict: changes\n')
  put(join(handoff, 'reviews', '1.findings.md'), '# Findings\n')
  put(join(worktree, 'apps', 'web', 'e2e', 'a.spec.ts'), 'expect(1)\n')
  put(join(worktree, 'apps', 'web', 'src', 'main.ts'), 'x\n')
  mkdirSync(join(handoff, 'sandbox', 'evaluator'), { recursive: true })
  mkdirSync(join(handoff, 'sandbox', 'test-reviewer'), { recursive: true })
  if (options.sealed !== false) {
    seal(root, 7, { pass: rounds + 1, roles: options.roles ?? ['evaluator', 'test-reviewer'] })
  }
  const transcript = mainTranscript(root)
  let calls = 0
  /** Rewrites the main session's transcript: its latest assistant message as given. */
  const runAs = (model: string, effort: string) => mainTranscript(root, model, effort)
  return {
    root,
    worktree,
    transcript,
    runAs,
    handoff,
    store: join(root, 'factory', '.jobs', '7', 'sealed'),
    state: join(root, 'factory', '.jobs', '7'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    /** One guard call; null when allowed, else the denial's reason. */
    guard(who: Who, tool: string, input: object, cwd: string = worktree, session = SESSION) {
      const factoryAgent = (input as { subagent_type?: unknown }).subagent_type
      if (
        !who &&
        options.launches !== 'strict' &&
        (tool === 'Agent' || tool === 'Task') &&
        typeof factoryAgent === 'string' &&
        factoryAgent.startsWith('factory-')
      ) {
        const planned = planLaunch(root, factoryAgent)
        const given = (input as { prompt?: unknown }).prompt
        input = {
          model: planned.model,
          effort: planned.effort,
          ...input,
          prompt: `${planned.header}\n${typeof given === 'string' ? given : ''}`,
        }
      }
      const out = hookGuard(
        root,
        JSON.stringify({
          session_id: session,
          transcript_path: transcript,
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_use_id: `tu-${++calls}`,
          cwd,
          tool_input: input,
          ...who,
        }),
      )
      return out
        ? (JSON.parse(out) as { hookSpecificOutput: { permissionDecisionReason: string } })
            .hookSpecificOutput.permissionDecisionReason
        : null
    },
    bash(who: Who, command: string, cwd?: string) {
      return this.guard(who, 'Bash', { command }, cwd)
    },
    /** A hook event as the log hook would have written it. */
    log(event: Partial<FactoryEvent> & { kind: string }) {
      appendEvent(root, {
        t: new Date().toISOString(),
        job: 7,
        source: 'hook',
        ...event,
      })
    },
  }
}
