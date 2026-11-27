import { appendEvent, cliEvent } from '../events.ts'
import { loadJob, unlessBlocked, type Job } from '../job.ts'

/** A refusal: the CLI prints the message and exits non-zero. */
export class Refusal extends Error {}

export function requireJob(root: string, number: number): Job {
  const job = loadJob(root, number)
  if (!job) throw new Refusal(`No job for issue #${number}. Run: bun run factory start ${number}`)
  return job
}

/** Refuses a step that would move a job blocked on a Decision Request (job.ts unlessBlocked). */
export function refuseWhileBlocked(job: Pick<Job, 'number' | 'state'>, step: string): void {
  const allowed = unlessBlocked(job, step)
  if (!allowed.ok) throw new Refusal(allowed.reason)
}

export const record = (root: string, job: number, kind: string, detail?: Record<string, unknown>) =>
  appendEvent(root, cliEvent(job, kind, detail))

export const LABELS = {
  ready: 'factory:ready',
  building: 'factory:building',
  blocked: 'factory:blocked',
  pr_open: 'factory:pr-open',
} as const
