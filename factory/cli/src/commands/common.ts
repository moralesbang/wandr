import { appendEvent, cliEvent } from '../events.ts'
import { changedMessage, factoryChanges } from '../freeze.ts'
import { loadJob, unlessBlocked, type Job } from '../job.ts'
import { patchId } from '../shell.ts'

/** A refusal: the CLI prints the message and exits non-zero. */
export class Refusal extends Error {}

export function requireJob(root: string, number: number): Job {
  const job = loadJob(root, number)
  if (!job) throw new Refusal(`No job for issue #${number}. Run: bun run factory start ${number}`)
  return job
}

/**
 * Refuses a command on a job whose factory files (the CLI, the skill, the agents, the hooks)
 * changed since `factory start` recorded them: a job is judged by the factory it started with.
 */
export function requireUnchangedFactory(root: string, number: number): void {
  const job = loadJob(root, number)
  if (!job) return
  const changes = factoryChanges(root, job)
  if (changes.length > 0) throw new Refusal(changedMessage(number, changes))
}

/** Refuses a step that would move a job blocked on a Decision Request (job.ts unlessBlocked). */
export function refuseWhileBlocked(job: Pick<Job, 'number' | 'state'>, step: string): void {
  const allowed = unlessBlocked(job, step)
  if (!allowed.ok) throw new Refusal(allowed.reason)
}

/** The job's commit lists with a commit the CLI just made: its sha, and its patch id for a rebase. */
export async function withCliCommit(
  job: Job,
  sha: string,
): Promise<Pick<Job, 'cliCommits' | 'cliPatches'>> {
  const id = await patchId(job.worktree, sha)
  return {
    cliCommits: [...job.cliCommits, sha],
    cliPatches: id ? { ...job.cliPatches, [sha]: id } : job.cliPatches,
  }
}

export const record = (root: string, job: number, kind: string, detail?: Record<string, unknown>) =>
  appendEvent(root, cliEvent(job, kind, detail))

export const LABELS = {
  ready: 'factory:ready',
  building: 'factory:building',
  blocked: 'factory:blocked',
  pr_open: 'factory:pr-open',
} as const
