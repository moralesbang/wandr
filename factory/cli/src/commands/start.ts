import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDocker, type DockerDeps } from '../docker.ts'
import { changedMessage, factoryChanges, factoryFingerprint } from '../freeze.ts'
import { parseCriteria, parseRisk, slugify } from '../issue.ts'
import {
  canStartAnother,
  handoffDir,
  latestAnswer,
  listJobs,
  loadJob,
  migrateHandoff,
  saveJob,
  stateDir,
  type Job,
} from '../job.ts'
import { gh, git, runLogged } from '../shell.ts'
import { LABELS, record, Refusal } from './common.ts'

type Issue = {
  number: number
  title: string
  body: string
  state: string
  labels: { name: string }[]
}

const LABEL_COLORS: Record<string, [string, string]> = {
  [LABELS.ready]: ['0e8a16', 'The factory may take this issue'],
  [LABELS.building]: ['1d76db', 'A factory job is building this issue'],
  [LABELS.blocked]: ['d93f0b', 'A factory job waits for a decision on this issue'],
  [LABELS.pr_open]: ['5319e7', 'A factory job opened a PR for this issue'],
}

async function ensureLabels() {
  const existing = new Set(
    (
      JSON.parse(await gh('label', 'list', '--json', 'name', '--limit', '200')) as {
        name: string
      }[]
    ).map((label) => label.name),
  )
  for (const [name, [color, description]] of Object.entries(LABEL_COLORS)) {
    if (!existing.has(name)) {
      await gh('label', 'create', name, '--color', color, '--description', description)
    }
  }
}

export async function moveLabel(number: number, to: string) {
  const others = Object.values(LABELS).filter((label) => label !== to)
  await gh(
    'issue',
    'edit',
    String(number),
    '--add-label',
    to,
    ...others.flatMap((l) => ['--remove-label', l]),
  )
}

const viewIssue = async (number: number) =>
  JSON.parse(
    await gh('issue', 'view', String(number), '--json', 'number,title,body,state,labels'),
  ) as Issue

const writeIssue = (handoff: string, issue: Issue) =>
  writeFileSync(join(handoff, 'issue.md'), `# ${issue.title} (#${issue.number})\n\n${issue.body}\n`)

/** What `start` touches outside the repo, replaceable in a test. */
export type StartDeps = { docker?: DockerDeps }

export async function start(
  root: string,
  number: number,
  session: string,
  deps: StartDeps = {},
): Promise<Job> {
  // Before anything else: a job that can't run its checks or its sandboxes shouldn't start.
  await ensureDocker(deps.docker)
  const existing = loadJob(root, number)
  if (existing) return resume(root, existing, session)

  const allowed = canStartAnother(listJobs(root))
  if (!allowed.ok) throw new Refusal(allowed.reason)

  const issue = await viewIssue(number)
  if (issue.state !== 'OPEN') throw new Refusal(`Issue #${number} is not open.`)
  if (!issue.labels.some((label) => label.name === LABELS.ready)) {
    throw new Refusal(`Issue #${number} doesn't have the ${LABELS.ready} label. The user sets it.`)
  }
  const criteria = parseCriteria(issue.body)
  if (!criteria.ok) throw new Refusal(`Issue #${number}: ${criteria.reason}`)
  const risk = parseRisk(issue.body)
  if (!risk.ok) throw new Refusal(`Issue #${number}: ${risk.reason}`)

  const slug = slugify(issue.title)
  const branch = `feat/${number}-${slug}`
  const worktree = join(root, '.claude', 'worktrees', `${number}-${slug}`)
  await git(root, 'fetch', '--quiet', 'origin', 'main')
  const base = await git(root, 'rev-parse', 'origin/main')
  await git(root, 'worktree', 'add', '--quiet', '-b', branch, worktree, base)

  // Local secrets aren't committed; the worktree needs the developer's copy.
  const env = join(root, 'apps', 'api', '.env')
  if (existsSync(env)) copyFileSync(env, join(worktree, 'apps', 'api', '.env'))

  const state = stateDir(root, number)
  mkdirSync(state, { recursive: true })
  const install = await runLogged(
    ['bun', 'install', '--frozen-lockfile'],
    worktree,
    join(state, 'install.log'),
  )
  if (install !== 0)
    throw new Refusal(`bun install failed in ${worktree}; see ${state}/install.log`)

  const handoff = handoffDir({ number, worktree })
  mkdirSync(handoff, { recursive: true })
  writeIssue(handoff, issue)
  const job: Job = {
    factoryFingerprint: factoryFingerprint(root),
    number,
    title: issue.title,
    risk: risk.risk,
    routingRequired: true,
    routing: null,
    routingHistory: [],
    routingRevision: 0,
    slug,
    branch,
    worktree,
    session,
    state: 'building',
    base,
    redCommit: null,
    cliCommits: [],
    cliPatches: {},
    attempts: 0,
    rounds: 0,
    lastCheck: null,
    gate: null,
    atfixes: [],
    rulings: [],
    rewrites: [],
    redRejections: 0,
    decisionRequests: [],
    answers: [],
    reviews: [],
    blindPasses: {},
    pr: null,
    startedAt: new Date().toISOString(),
  }
  saveJob(root, job)
  await ensureLabels()
  await moveLabel(number, LABELS.building)
  record(root, number, 'job.started', {
    branch,
    worktree,
    criteria: criteria.criteria.length,
    risk: risk.risk,
  })
  return job
}

/**
 * Takes a job back up in a new or the same session; a blocked job returns to building. A job
 * started before the handoff folder moved into the worktree gets its handoff files copied there.
 */
async function resume(root: string, job: Job, session: string): Promise<Job> {
  if (job.state === 'pr_open') {
    throw new Refusal(`Job #${job.number} already opened its PR: ${job.pr}`)
  }
  if (!existsSync(job.worktree)) {
    throw new Refusal(`Job #${job.number}'s worktree is gone: ${job.worktree}`)
  }
  // A job is judged by the factory it started with: a change since then stops it. A job started
  // before the fingerprint gets one now.
  const changes = factoryChanges(root, job)
  if (changes.length > 0) throw new Refusal(changedMessage(job.number, changes))
  const migrated = migrateHandoff(root, job)
  if (migrated.length) record(root, job.number, 'job.migrated', { files: migrated })
  if (!existsSync(join(handoffDir(job), 'issue.md'))) {
    writeIssue(handoffDir(job), await viewIssue(job.number))
  }
  let resumed = {
    ...job,
    session,
    factoryFingerprint: job.factoryFingerprint ?? factoryFingerprint(root),
  }
  if (job.state === 'blocked') {
    // Only the user's own `factory answer` unblocks a job; a chat reply or a comment proves nothing.
    if (job.decisionRequests.length > 0 && !latestAnswer(job)) {
      throw new Refusal(
        `Job #${job.number} is blocked: Decision Request ${job.decisionRequests.length} has no answer. Ask the user with AskUserQuestion (a hook records their reply), or they answer with: ! bun run factory answer ${job.number} "<answer>"`,
      )
    }
    resumed = { ...resumed, state: 'building' }
    await moveLabel(job.number, LABELS.building)
  }
  saveJob(root, resumed)
  record(root, job.number, 'job.resumed', { from: job.state })
  return resumed
}

/**
 * The user's answer to the Decision Request the job just resumed from, for the orchestrator to
 * read; null when there is none or a commit already cited it.
 */
export function describeAnswer(job: Job): string | null {
  const answer = latestAnswer(job)
  if (!answer || answer.cited) return null
  const asked = answer.question ? `\n\nQuestion: ${answer.question}` : ''
  return `The user answered Decision Request ${answer.request} (${answer.at}):${asked}\n\n${answer.text}`
}
