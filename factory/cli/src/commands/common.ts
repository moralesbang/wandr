import { appendEvent, cliEvent } from '../events.ts'
import { loadJob, type Job } from '../job.ts'

/** A refusal: the CLI prints the message and exits non-zero. */
export class Refusal extends Error {}

export function requireJob(root: string, number: number): Job {
  const job = loadJob(root, number)
  if (!job) throw new Refusal(`No job for issue #${number}. Run: bun run factory start ${number}`)
  return job
}

export const record = (root: string, job: number, kind: string, detail?: Record<string, unknown>) =>
  appendEvent(root, cliEvent(job, kind, detail))

export const LABELS = {
  ready: 'factory:ready',
  building: 'factory:building',
  blocked: 'factory:blocked',
  pr_open: 'factory:pr-open',
} as const
