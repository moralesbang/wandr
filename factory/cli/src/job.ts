// A job's state, kept in factory/.jobs/<n>/job.json in the main checkout.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'

export const MAX_JOBS = 3
export const MAX_BUILD_ATTEMPTS = 3
export const MAX_ROUNDS = 3
export const MAX_RED_REJECTIONS = 3

const Check = z.object({
  /** The tree the checks ran on: equal to HEAD's tree when they ran on a clean, committed state. */
  tree: z.string(),
  green: z.boolean(),
  failedStep: z.string().nullable(),
  at: z.string(),
  log: z.string(),
})

export const Job = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  slug: z.string(),
  branch: z.string(),
  worktree: z.string(),
  session: z.string(),
  state: z.enum(['building', 'blocked', 'pr_open']),
  base: z.string(),
  /** The latest red commit. */
  redCommit: z.string().nullable(),
  /** Commits the CLI made (red commits and acceptance-test fixes): the gate doesn't judge them. */
  cliCommits: z.array(z.string()),
  attempts: z.number().int().nonnegative(),
  rounds: z.number().int().nonnegative(),
  lastCheck: Check.nullable(),
  gate: z.object({ head: z.string(), passed: z.boolean(), at: z.string() }).nullable(),
  atfixes: z.array(z.object({ sha: z.string(), note: z.string(), files: z.array(z.string()) })),
  /** Acceptance-test rewrites the user authorized after a Decision Request. */
  rewrites: z.array(z.object({ commit: z.string(), note: z.string(), at: z.string() })).default([]),
  /** How many times `factory red` rejected the test agent's red. */
  redRejections: z.number().int().nonnegative().default(0),
  decisionRequests: z.array(z.object({ at: z.string(), file: z.string() })),
  pr: z.string().nullable(),
  startedAt: z.string(),
})
export type Job = z.infer<typeof Job>

/**
 * The main checkout's root. The CLI may run from the main checkout or from a job's worktree
 * (.claude/worktrees/<n>-<slug>); job state always lives in the main checkout.
 */
export function mainRoot(from: string = import.meta.dir): string {
  const marker = '/.claude/worktrees/'
  const at = from.indexOf(marker)
  return at === -1 ? resolve(from, '../../..') : from.slice(0, at)
}

export const jobsDir = (root: string) => join(root, 'factory', '.jobs')
export const jobDir = (root: string, number: number) => join(jobsDir(root), String(number))

export function loadJob(root: string, number: number): Job | null {
  const file = join(jobDir(root, number), 'job.json')
  return existsSync(file) ? Job.parse(JSON.parse(readFileSync(file, 'utf8'))) : null
}

export function saveJob(root: string, job: Job): void {
  const dir = jobDir(root, job.number)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'job.json'), `${JSON.stringify(Job.parse(job), null, 2)}\n`)
}

export function listJobs(root: string): Job[] {
  const dir = jobsDir(root)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /^\d+$/.test(name))
    .map((name) => loadJob(root, Number(name)))
    .filter((job): job is Job => job !== null)
    .toSorted((a, b) => a.number - b.number)
}

export const findJobBySession = (root: string, session: string) =>
  listJobs(root).find((job) => job.session === session) ?? null

export type Allowed = { ok: true } | { ok: false; reason: string }

export type Counted = { ok: true; job: Job } | { ok: false; reason: string }

/** Starts a new build attempt, or refuses the one past the limit. */
export function countAttempt(job: Job): Counted {
  if (job.attempts >= MAX_BUILD_ATTEMPTS) {
    return {
      ok: false,
      reason: `Job #${job.number} already used its ${MAX_BUILD_ATTEMPTS} build attempts. Raise a Decision Request.`,
    }
  }
  return { ok: true, job: { ...job, attempts: job.attempts + 1 } }
}

/** Starts a new outer-loop round with findings, or refuses the one past the limit. */
export function countRound(job: Job): Counted {
  if (job.rounds >= MAX_ROUNDS) {
    return {
      ok: false,
      reason: `Job #${job.number} already had ${MAX_ROUNDS} rounds with findings. Raise a Decision Request.`,
    }
  }
  return { ok: true, job: { ...job, rounds: job.rounds + 1 } }
}

/** Whether `factory red` may run again, or the job already used its rejected reds. */
export function canTryRed(job: Pick<Job, 'number' | 'redRejections'>): Allowed {
  return job.redRejections >= MAX_RED_REJECTIONS
    ? {
        ok: false,
        reason: `Job #${job.number} already had ${MAX_RED_REJECTIONS} rejected reds. Raise a Decision Request.`,
      }
    : { ok: true }
}

/** The review pass now under way: 1 before any round with findings, then one more per round. */
export const reviewPass = (job: Pick<Job, 'rounds'>) => job.rounds + 1

/** Refuses a new job when MAX_JOBS are already building. */
export function canStartAnother(
  jobs: readonly Job[],
): { ok: true } | { ok: false; reason: string } {
  const building = jobs.filter((job) => job.state === 'building')
  return building.length >= MAX_JOBS
    ? {
        ok: false,
        reason: `${MAX_JOBS} jobs are already building (${building.map((job) => `#${job.number}`).join(', ')}). Wait for one to open its PR or block.`,
      }
    : { ok: true }
}
