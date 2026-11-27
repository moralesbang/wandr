// A job's files live in two folders named factory/.jobs/<n>/:
// - the state folder, in the main checkout: job.json and events.jsonl, written only by the CLI and
//   the hooks, so the job's record outlives its worktree;
// - the handoff folder, in the job's worktree: the files agents and the orchestrator hand each
//   other. Claude Code confines a session that entered a worktree, and its subagents, to that
//   worktree, so this is the only place they can write.

import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { JOBS_FOLDER, jobFolder } from './paths.ts'
import { RoutingPlan } from './routing.ts'

const MAX_JOBS = 3
const MAX_BUILD_ATTEMPTS = 3
const MAX_ROUNDS = 3
const MAX_RED_REJECTIONS = 3

export const RISKS = ['low', 'normal', 'high'] as const
export const Risk = z.enum(RISKS)
export type Risk = z.infer<typeof Risk>

export const REVIEWER_ROLES = ['evaluator', 'test-reviewer'] as const
export type ReviewerRole = (typeof REVIEWER_ROLES)[number]

/**
 * What a reviewer does in a review pass: a full blind `review`, a `verify` of the previous
 * findings against the diff since the last reviewed HEAD, or `carry`, its approval standing.
 */
export const RoleTask = z.enum(['review', 'verify', 'carry'])
export type RoleTask = z.infer<typeof RoleTask>

export const ReviewPlan = z.object({
  pass: z.number().int().positive(),
  /** The HEAD this pass reviews. */
  head: z.string(),
  /** The HEAD the previous pass reviewed; null on the first pass. */
  since: z.string().nullable(),
  /** The files changed since then. */
  changed: z.array(z.string()),
  risk: Risk,
  routingRevision: z.number().int().nonnegative().default(0),
  raisedBy: z.array(z.string()),
  roles: z.object({ evaluator: RoleTask.optional(), 'test-reviewer': RoleTask }),
  at: z.string(),
})
export type ReviewPlan = z.infer<typeof ReviewPlan>

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
  /** The risk the issue declares; an issue without the field is normal. */
  risk: Risk.default('normal'),
  /** Legacy jobs retain the original flow; every new job must be classified before execution. */
  routingRequired: z.boolean().default(false),
  routing: RoutingPlan.nullable().default(null),
  routingHistory: z.array(RoutingPlan).default([]),
  routingRevision: z.number().int().nonnegative().default(0),
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
  /**
   * The patch id of each commit the CLI made, by sha: after a rebase the shas change and the patches
   * don't, so the gate still knows the CLI's commits (and refuses a branch that lost one).
   */
  cliPatches: z.record(z.string(), z.string()).default({}),
  attempts: z.number().int().nonnegative(),
  rounds: z.number().int().nonnegative(),
  lastCheck: Check.nullable(),
  gate: z.object({ head: z.string(), passed: z.boolean(), at: z.string() }).nullable(),
  atfixes: z.array(
    z.object({
      sha: z.string(),
      note: z.string(),
      files: z.array(z.string()),
      /** The test reviewer's same-guarantee ruling the fix was committed on. */
      ruling: z.number().int().positive().optional(),
    }),
  ),
  /**
   * Rulings `factory ruling` asked a test reviewer for: the number of rulings/<ruling>.md in the
   * handoff folder and the hash of the acceptance-test diff it rules on.
   */
  rulings: z
    .array(z.object({ ruling: z.number().int().positive(), diff: z.string(), at: z.string() }))
    .default([]),
  /** Acceptance-test rewrites the user authorized after a Decision Request. */
  rewrites: z.array(z.object({ commit: z.string(), note: z.string(), at: z.string() })).default([]),
  /** How many times `factory red` rejected the test agent's red. */
  redRejections: z.number().int().nonnegative().default(0),
  /**
   * `ruling` is the changed-guarantee ruling the request was raised on: only an answer to such a
   * request lets `factory atfix` commit the ruled fix without a same-guarantee ruling.
   */
  decisionRequests: z.array(
    z.object({ at: z.string(), file: z.string(), ruling: z.number().int().positive().optional() }),
  ),
  /**
   * The user's answers, written only by `factory answer`, which the user runs from their own
   * prompt. `request` is the 1-based position in decisionRequests; `cited` is set once a commit
   * carries the answer as its authorization.
   */
  answers: z
    .array(
      z.object({
        request: z.number().int().positive(),
        at: z.string(),
        text: z.string(),
        cited: z.boolean().default(false),
      }),
    )
    .default([]),
  /**
   * The sha256 of each blind pass as `factory unseal` found it, by its path relative to the job's
   * folder. After that nobody writes the file, and `factory pr` checks the hashes: a blind pass
   * rewritten once the build notes were out would no longer be blind.
   */
  blindPasses: z.record(z.string(), z.string()).default({}),
  /** One plan per review pass, written by `factory review`. */
  reviews: z.array(ReviewPlan).default([]),
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

/** Every job's state folder, in the main checkout; also holds the checks lock. */
export const jobsDir = (root: string) => join(root, JOBS_FOLDER)
/** A job's state folder, in the main checkout: job.json, events.jsonl and the CLI's own logs. */
export const stateDir = (root: string, number: number) => join(root, jobFolder(number))
/** A job's handoff folder, in its worktree: what agents and the orchestrator read and write. */
export const handoffDir = (job: Pick<Job, 'number' | 'worktree'>) =>
  join(job.worktree, jobFolder(job.number))

/** The files and folders agents and the orchestrator hand each other, in the handoff folder. */
const HANDOFF_FILES = [
  'issue.md',
  'research.md',
  'routing-proposal.json',
  'acceptance.md',
  'build-notes.md',
  'checks',
  'gate.json',
  'reviews',
  'decision-requests',
  'diagnosis.md',
  'summary.md',
] as const

/**
 * Copies into the worktree's handoff folder every handoff file that exists only in the main
 * checkout's job folder, where jobs started before the split kept them. Never overwrites.
 */
export function migrateHandoff(root: string, job: Pick<Job, 'number' | 'worktree'>): string[] {
  const from = stateDir(root, job.number)
  const to = handoffDir(job)
  mkdirSync(to, { recursive: true })
  const copied: string[] = []
  for (const name of HANDOFF_FILES) {
    const source = join(from, name)
    if (!existsSync(source)) continue
    const target = join(to, name)
    const missing = !existsSync(target)
    cpSync(source, target, { recursive: true, force: false, errorOnExist: false })
    if (missing) copied.push(name)
  }
  return copied
}

export function loadJob(root: string, number: number): Job | null {
  const file = join(stateDir(root, number), 'job.json')
  return existsSync(file) ? Job.parse(JSON.parse(readFileSync(file, 'utf8'))) : null
}

/**
 * Writes a file whole or not at all: a reader (the guard, factory watch) never sees it half
 * written, and a crash mid-write leaves the previous version.
 */
export function writeAtomic(path: string, text: string): void {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, text)
  renameSync(temporary, path)
}

export function saveJob(root: string, job: Job): void {
  const dir = stateDir(root, job.number)
  mkdirSync(dir, { recursive: true })
  writeAtomic(join(dir, 'job.json'), `${JSON.stringify(Job.parse(job), null, 2)}\n`)
  recordSession(root, job.session, job.number)
}

/**
 * Which job each session runs, written by the CLI next to the jobs' state: the guard asks it when a
 * job's job.json no longer parses, which would otherwise take that job's guard down with it.
 */
const sessionIndex = (root: string) => join(jobsDir(root), 'sessions.json')

function readSessionIndex(root: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(sessionIndex(root), 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function recordSession(root: string, session: string, number: number): void {
  const index = readSessionIndex(root)
  if (index[session] === number) return
  writeAtomic(sessionIndex(root), `${JSON.stringify({ ...index, [session]: number }, null, 2)}\n`)
}

/** Where the hooks log what went wrong, in the main checkout's state folder. */
export const hookErrorsLog = (root: string) => join(jobsDir(root), 'hook-errors.log')

export function logHookError(root: string, where: string, error: unknown): void {
  mkdirSync(jobsDir(root), { recursive: true })
  appendFileSync(hookErrorsLog(root), `${new Date().toISOString()} ${where} ${String(error)}\n`)
}

/**
 * Every job whose job.json reads. One that doesn't is skipped and logged to hook-errors.log, so a
 * broken job can't take the others' guard down with it.
 */
export function listJobs(root: string): Job[] {
  const dir = jobsDir(root)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /^\d+$/.test(name))
    .flatMap((name) => {
      try {
        return [loadJob(root, Number(name))]
      } catch (error) {
        logHookError(root, `jobs ${jobFolder(Number(name))}/job.json`, error)
        return []
      }
    })
    .filter((job): job is Job => job !== null)
    .toSorted((a, b) => a.number - b.number)
}

export const findJobBySession = (root: string, session: string) =>
  listJobs(root).find((job) => job.session === session) ?? null

/** The numbers of the jobs whose job.json is there but doesn't read. */
function unreadableJobs(root: string): number[] {
  const dir = jobsDir(root)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
    .filter((number) => {
      try {
        loadJob(root, number)
        return false
      } catch {
        return true
      }
    })
}

/**
 * The job a session runs: its job, or, when that job's job.json doesn't read, the job's number, by
 * the session index or by the session's id in job.json's raw text. A call from such a session is
 * denied, never let through as if it belonged to no job.
 */
export function locateSession(
  root: string,
  session: string,
): { job: Job } | { unreadable: number } | null {
  const job = findJobBySession(root, session)
  if (job) return { job }
  const broken = unreadableJobs(root)
  if (broken.length === 0) return null
  const indexed = readSessionIndex(root)[session]
  if (indexed !== undefined && broken.includes(indexed)) return { unreadable: indexed }
  const quoted = JSON.stringify(session)
  const owner = broken.find((number) => {
    try {
      return readFileSync(join(stateDir(root, number), 'job.json'), 'utf8').includes(quoted)
    } catch {
      return false
    }
  })
  return owner === undefined ? null : { unreadable: owner }
}

type Allowed = { ok: true } | { ok: false; reason: string }

type Counted = { ok: true; job: Job } | { ok: false; reason: string }

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

/**
 * Whether a blocked job may take a step, or why not: while a Decision Request waits, nothing moves
 * the job. Only `factory answer` (the user's) and then `factory start` act on it.
 */
export function unlessBlocked(job: Pick<Job, 'number' | 'state'>, step: string): Allowed {
  return job.state === 'blocked'
    ? {
        ok: false,
        reason: `Job #${job.number} is blocked on a Decision Request, so ${step} can't run. The user answers with \`! bun run factory answer ${job.number} "<text>"\`; then \`bun run factory start ${job.number}\` resumes it.`,
      }
    : { ok: true }
}

/** The user's answer to the job's latest Decision Request, if it has one. */
export const latestAnswer = (job: Pick<Job, 'decisionRequests' | 'answers'>) =>
  job.answers.find((answer) => answer.request === job.decisionRequests.length)

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
