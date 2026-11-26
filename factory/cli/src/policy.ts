// What the guard hook decides on one tool call, split by tool family. Each policy is a pure function
// of the call and the job: it never reads the hook's stdin or writes the log; commands/hook.ts does.

import type { HookInput, Places } from './events.ts'
import type { Job } from './job.ts'

export type Verdict = { ok: true } | { ok: false; reason: string }

export const allow: Verdict = { ok: true }
export const deny = (reason: string): Verdict => ({ ok: false, reason })

export type GuardContext = {
  /** The main checkout's root, where job state lives. */
  root: string
  job: Job
  input: HookInput
  /** Where the job's areas are on disk. */
  places: Places
  /** The agent run that made the call; absent for the orchestrator (the main session). */
  agent?: { id: string; type: string }
}

export type Policy = (context: GuardContext) => Verdict
