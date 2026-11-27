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

export type GuardJob = ReturnType<typeof guardJob>

/** A job #7 in a temp root, its worktree laid out, optionally sealed for review pass rounds + 1. */
export function guardJob(
  options: {
    sealed?: boolean
    plan?: Record<string, string>
    rounds?: number
    job?: Partial<Job>
    roles?: string[]
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
  return {
    root,
    worktree,
    handoff,
    store: join(root, 'factory', '.jobs', '7', 'sealed'),
    state: join(root, 'factory', '.jobs', '7'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    /** One guard call; null when allowed, else the denial's reason. */
    guard(who: Who, tool: string, input: object, cwd: string = worktree, session = SESSION) {
      const out = hookGuard(
        root,
        JSON.stringify({
          session_id: session,
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_use_id: 'tu',
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
