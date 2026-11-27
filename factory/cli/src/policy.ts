// What the guard hook decides on one tool call, split by tool family. Each policy is a pure function
// of the call and the job: it never reads the hook's stdin or writes the log; commands/hook.ts does.

import { homedir } from 'node:os'
import type { Where } from './bash-words.ts'
import type { HookInput, Places } from './events.ts'
import type { Job } from './job.ts'

export type Verdict = { ok: true } | { ok: false; reason: string }

export const allow: Verdict = { ok: true }
export const deny = (reason: string): Verdict => ({ ok: false, reason })

/** The first denial among the verdicts, or allow. */
export const first = (verdicts: Iterable<Verdict>): Verdict => {
  for (const verdict of verdicts) if (!verdict.ok) return verdict
  return allow
}

export type GuardContext = {
  /** The main checkout's root, where job state lives, symlinks resolved. */
  root: string
  /** The job, its worktree's path with symlinks resolved. */
  job: Job
  input: HookInput
  /** Where the job's areas are on disk. */
  places: Places
  /** The agent run that made the call; absent for the orchestrator (the main session). */
  agent?: { id: string; type: string }
}

export type Policy = (context: GuardContext) => Verdict

/** Where a call's relative paths start, and the folders a Bash command's words may name. */
export const bashWhere = (context: GuardContext): Where => ({
  cwd: typeof context.input.cwd === 'string' ? context.input.cwd : context.job.worktree,
  home: homedir(),
  handoff: context.places.handoffDir,
})
