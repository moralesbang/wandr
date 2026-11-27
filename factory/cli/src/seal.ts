// The seal: while the reviewers write their blind first passes, everything in the job's folder that
// carries the build agent's reasoning, or cites it, sits in the main checkout's state folder,
// outside every agent's reach. Job #13's reviewers read the Decision Request (which repeats the
// build notes) and the earlier final reports and findings (written after reading them) with `cat`
// before their blind passes; a file that isn't in the worktree can't be read there by any command.
//
// The guard denies the same files by name as a second layer (read-guard.ts), and `factory unseal`
// puts them back, exactly as they were, once every sealed reviewer wrote its blind pass.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { record, Refusal, requireJob } from './commands/common.ts'
import { readEvents, type FactoryEvent } from './events.ts'
import { rolesWith } from './review-plan.ts'
import { wroteInJob } from './runs.ts'
import {
  handoffDir,
  REVIEWER_ROLES,
  reviewPass,
  saveJob,
  stateDir,
  writeAtomic,
  type Job,
  type ReviewerRole,
} from './job.ts'

export { REVIEWER_ROLES, type ReviewerRole }

export type Seal = {
  pass: number
  roles: ReviewerRole[]
  /** What was moved, relative to the job's folder: files, or folders moved whole. */
  files: string[]
  at: string
}

/** What a blind pass must not see, at the top of the job's folder; reviews/ is sorted per file. */
const SEALED_TOP = [
  'build-notes.md',
  'decision-requests',
  'diagnosis.md',
  'summary.md',
  'research.md',
  'routing-proposal.json',
] as const

const BLIND_PASS = /\.blind\.md$/

/**
 * Whether a path in the job's folder is sealed material: the build notes, the Decision Requests,
 * the diagnosis, the summary, routing research and proposal, and every review file but a blind pass.
 */
export function isSealedName(rel: string): boolean {
  const parts = rel.split('/').filter(Boolean)
  const [top] = parts
  if (!top) return false
  if ((SEALED_TOP as readonly string[]).includes(top)) return true
  return top === 'reviews' && parts.length > 1 && !BLIND_PASS.test(parts.at(-1) ?? '')
}

/** The sealed store, in the main checkout's state folder; it mirrors the job folder's layout. */
export const sealedStore = (root: string, number: number) => join(stateDir(root, number), 'sealed')
const sealRecord = (root: string, number: number) => join(stateDir(root, number), 'seal.json')

export function loadSeal(root: string, number: number): Seal | null {
  const file = sealRecord(root, number)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Seal) : null
}

export const blindPassFile = (job: Pick<Job, 'number' | 'worktree'>, pass: number, role: string) =>
  join(handoffDir(job), 'reviews', `${pass}.${role}.blind.md`)

/** The sealed roles whose blind pass for the sealed pass isn't written yet. */
export const missingBlindPasses = (job: Pick<Job, 'number' | 'worktree'>, sealed: Seal) =>
  sealed.roles.filter((role) => !existsSync(blindPassFile(job, sealed.pass, role)))

/**
 * Whether the log shows the role's own agent writing its blind pass with Write or Edit, in a run
 * that began after the seal: an earlier run read the build notes in an earlier pass, so a blind
 * pass it writes on a message is not blind.
 */
const wroteItself = (events: FactoryEvent[], sealed: Seal, role: ReviewerRole) =>
  wroteInJob(events, {
    type: `factory-${role}`,
    rel: `reviews/${sealed.pass}.${role}.blind.md`,
    since: sealed.at,
  })

/**
 * Why a sealed role's blind pass can't lift the seal, or null when it can: the file is there, holds
 * a review, and the event log shows that role's own agent wrote it with the Write tool after the
 * seal. Anything else (an `echo` from another run, an empty file) proves no blind pass was made.
 */
function blindPassProblem(
  job: Pick<Job, 'number' | 'worktree'>,
  sealed: Seal,
  role: ReviewerRole,
  events: FactoryEvent[],
): string | null {
  const rel = `reviews/${sealed.pass}.${role}.blind.md`
  const file = blindPassFile(job, sealed.pass, role)
  if (!existsSync(file)) return `no blind pass yet from the ${role} (${rel})`
  if (!readFileSync(file, 'utf8').trim()) return `the ${role}'s blind pass ${rel} is empty`
  if (!wroteItself(events, sealed, role)) {
    return `${rel} was not written with the Write tool by a factory-${role} run launched after the seal; relaunch the ${role} for its blind pass`
  }
  return null
}

/** The sha256 of a file's bytes, in hex. */
export const fileHash = (file: string) =>
  new Bun.CryptoHasher('sha256').update(readFileSync(file)).digest('hex')

/**
 * The verifiers of the sealed pass whose final report isn't written: they read the previous merged
 * findings and their own earlier report from the sealed store, which the unseal would move away.
 */
function verifiersReading(job: Job, sealed: Seal): string[] {
  const plan = job.reviews.find((planned) => planned.pass === sealed.pass)
  return (plan ? rolesWith(plan, 'verify') : [])
    .filter((role) => {
      const report = join(handoffDir(job), 'reviews', `${sealed.pass}.${role}.md`)
      return !existsSync(report) || !readFileSync(report, 'utf8').trim()
    })
    .map(
      (role) =>
        `the ${role} verifies in this pass and has not written its final report (reviews/${sealed.pass}.${role}.md): it reads the previous findings from the sealed store, which the unseal would move from under it`,
    )
}

/** Every file under a folder, relative to it; empty when it doesn't exist. */
function filesUnder(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const rel = prefix ? `${prefix}/${name}` : name
    return statSync(join(dir, name)).isDirectory() ? filesUnder(join(dir, name), rel) : [rel]
  })
}

/** The sealed material now in the job's folder: top-level entries whole, reviews/ per entry. */
function sealable(handoff: string): string[] {
  const top = SEALED_TOP.filter((name) => existsSync(join(handoff, name)))
  const reviews = existsSync(join(handoff, 'reviews'))
    ? readdirSync(join(handoff, 'reviews'))
        .map((name) => `reviews/${name}`)
        .filter(isSealedName)
    : []
  return [...top, ...reviews].toSorted()
}

/** Moves a file or folder, across file systems too. */
function move(from: string, to: string) {
  mkdirSync(dirname(to), { recursive: true })
  try {
    renameSync(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    cpSync(from, to, { recursive: true, errorOnExist: true, force: false })
    rmSync(from, { recursive: true, force: true })
  }
}

const unsealHint = (number: number) =>
  `Once every sealed reviewer wrote its blind pass, run: bun run factory unseal ${number}`

/**
 * Moves the sealed material out of the job's folder into the sealed store, for review pass `pass`
 * by `roles`. The record is written first, so an interrupted seal still says where its files went.
 */
export function seal(
  root: string,
  number: number,
  options: { pass: number; roles: readonly string[] },
): Seal {
  const job = requireJob(root, number)
  const existing = loadSeal(root, number)
  if (existing || filesUnder(sealedStore(root, number)).length) {
    throw new Refusal(
      `Job #${number} is already sealed${existing ? ` for review pass ${existing.pass}` : ''}; a second seal would mix its files with the first. ${unsealHint(number)}`,
    )
  }
  if (options.pass !== reviewPass(job)) {
    throw new Refusal(
      `Job #${number} is at review pass ${reviewPass(job)}, not ${options.pass}: seal the pass under way.`,
    )
  }
  const roles = [...new Set(options.roles)]
  const unknown = roles.filter((role) => !(REVIEWER_ROLES as readonly string[]).includes(role))
  if (roles.length === 0 || unknown.length) {
    throw new Refusal(
      `A seal is for the reviewers, ${REVIEWER_ROLES.join(' and ')}; got: ${roles.join(', ') || 'none'}.`,
    )
  }
  const handoff = handoffDir(job)
  const sealed: Seal = {
    pass: options.pass,
    roles: roles as ReviewerRole[],
    files: sealable(handoff),
    at: new Date().toISOString(),
  }
  mkdirSync(stateDir(root, number), { recursive: true })
  writeAtomic(sealRecord(root, number), `${JSON.stringify(sealed, null, 2)}\n`)
  for (const rel of sealed.files) move(join(handoff, rel), join(sealedStore(root, number), rel))
  record(root, number, 'sealed', { pass: sealed.pass, roles: sealed.roles, files: sealed.files })
  return sealed
}

/**
 * Puts every sealed file back where it was. Refused until each sealed role's own agent wrote its
 * blind pass (blindPassProblem), and, moving nothing, when a sealed file's place in the job's
 * folder was taken meanwhile.
 */
export function unseal(root: string, number: number): Seal {
  const job = requireJob(root, number)
  const sealed = loadSeal(root, number)
  if (!sealed) throw new Refusal(`Job #${number} is not sealed.`)
  const events = readEvents(root, number)
  const problems = [
    ...sealed.roles.map((role) => blindPassProblem(job, sealed, role, events)),
    ...verifiersReading(job, sealed),
  ].filter((problem) => problem !== null)
  if (problems.length) {
    throw new Refusal(`Job #${number} stays sealed: ${problems.join('; ')}.`)
  }
  const handoff = handoffDir(job)
  const store = sealedStore(root, number)
  const taken = sealed.files.filter(
    (rel) => existsSync(join(store, rel)) && existsSync(join(handoff, rel)),
  )
  if (taken.length) {
    throw new Refusal(
      `Job #${number} stays sealed: ${taken.join(', ')} was written in the job's folder while sealed, and unsealing would overwrite it. Move it aside, then unseal.`,
    )
  }
  for (const rel of sealed.files) {
    if (existsSync(join(store, rel))) move(join(store, rel), join(handoff, rel))
  }
  const left = filesUnder(store)
  if (left.length) {
    // Never delete what this seal didn't move: say so and keep the record.
    throw new Refusal(
      `Job #${number}: the sealed store still holds ${left.join(', ')}, which the seal never recorded. Move it back by hand from ${store}.`,
    )
  }
  rmSync(store, { recursive: true, force: true })
  // The blind passes stand as they are now: no one writes them again, and `factory pr` checks.
  const frozen = Object.fromEntries(
    sealed.roles.map((role) => {
      const rel = `reviews/${sealed.pass}.${role}.blind.md`
      return [rel, fileHash(join(handoff, rel))]
    }),
  )
  saveJob(root, { ...job, blindPasses: { ...job.blindPasses, ...frozen } })
  rmSync(sealRecord(root, number))
  record(root, number, 'unsealed', { pass: sealed.pass, roles: sealed.roles, files: sealed.files })
  return sealed
}

/** Refuses a step that would take a sealed job on without its notes. */
export function refuseWhileSealed(root: string, job: Pick<Job, 'number'>, step: string): void {
  const sealed = loadSeal(root, job.number)
  if (!sealed) return
  throw new Refusal(
    `Job #${job.number} is sealed for review pass ${sealed.pass}: its build notes, Decision Requests and earlier reviews are out of the worktree, so ${step} can't run. ${unsealHint(job.number)}`,
  )
}

/** What the orchestrator must know when it resumes a sealed job; null when it isn't sealed. */
export function describeSeal(root: string, job: Job): string | null {
  const sealed = loadSeal(root, job.number)
  if (!sealed) return null
  const missing = missingBlindPasses(job, sealed)
  return [
    `Job #${job.number} is sealed for review pass ${sealed.pass} (${sealed.roles.join(', ')}).`,
    missing.length
      ? `Blind passes still missing: ${missing.map((role) => `reviews/${sealed.pass}.${role}.blind.md`).join(', ')}. Launch those reviewers for their blind pass only.`
      : 'Every blind pass is written.',
    `Then run: bun run factory unseal ${job.number}`,
  ].join('\n')
}
