// Routing decisions live in CLI-owned state, outside the blind reviewers' worktree.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { handoffDir, saveJob, type Job } from '../job.ts'
import { JOBS_FOLDER } from '../paths.ts'
import { planRouting, reassessRouting, RoutingProposal, type RoutingPlan } from '../routing.ts'
import { refuseWhileSealed } from '../seal.ts'
import { git } from '../shell.ts'
import { record, Refusal, refuseWhileBlocked, requireJob } from './common.ts'

export const ROUTE_USAGE = `  route <n> <file>           validate a classification proposal and persist the execution plan`

/** Research may gather evidence; every implementation or verdict needs a confirmed route. */
export function requireRouted(
  job: Pick<Job, 'number' | 'routingRequired' | 'routing'>,
  step: string,
  options: { allowResearch?: boolean } = {},
): void {
  if (job.routingRequired && !job.routing) {
    throw new Refusal(
      `Job #${job.number} needs classification before ${step}. Run factory route ${job.number} <proposal.json>.`,
    )
  }
  if (job.routing?.workflow === 'research' && !options.allowResearch) {
    throw new Refusal(
      `Job #${job.number} is research-only: ${step} cannot run. Write research.md, then classify again with factory route.`,
    )
  }
}

function persist(root: string, job: Job, routing: RoutingPlan, kind: string): Job {
  const updated: Job = {
    ...job,
    routing,
    routingHistory: [...job.routingHistory, routing],
    routingRevision: job.routingRevision + 1,
    gate: null,
    lastCheck: null,
  }
  saveJob(root, updated)
  record(root, job.number, kind, {
    workflow: routing.workflow,
    scope: routing.scope,
    risk: routing.risk,
    revision: updated.routingRevision,
    reasons: routing.reasons,
  })
  return updated
}

/** Includes committed, staged, unstaged and untracked work; deleted and renamed paths cannot hide. */
async function observedPaths(job: Job): Promise<string[]> {
  const tracked = await git(job.worktree, 'diff', '--name-only', '--no-renames', '-z', job.base)
  const untracked = await git(job.worktree, 'ls-files', '--others', '--exclude-standard', '-z')
  return [...new Set([...tracked.split('\0'), ...untracked.split('\0')])]
    .filter((path) => path && path !== JOBS_FOLDER && !path.startsWith(`${JOBS_FOLDER}/`))
    .toSorted()
}

/** Recheck before launch/check/gate/review/PR, invalidating earlier verdicts when controls grow. */
export async function refreshRouting(root: string, number: number): Promise<Job> {
  const job = requireJob(root, number)
  if (!job.routing) return job
  refuseWhileBlocked(job, 'routing reassessment')
  if (job.routing.workflow === 'research') return job
  const routing = reassessRouting(job.routing, await observedPaths(job))
  if (JSON.stringify(routing) === JSON.stringify(job.routing)) return job
  refuseWhileSealed(root, job, 'routing reassessment')
  return persist(root, job, routing, 'routing.escalated')
}

function sameProposal(plan: RoutingPlan, proposal: RoutingProposal): boolean {
  const normalized = planRouting(proposal, plan.risk)
  const previous = Object.fromEntries(
    Object.keys(RoutingProposal.shape).map((key) => [key, plan[key as keyof RoutingProposal]]),
  )
  const next = Object.fromEntries(
    Object.keys(RoutingProposal.shape).map((key) => [
      key,
      normalized[key as keyof RoutingProposal],
    ]),
  )
  return (
    JSON.stringify(RoutingProposal.parse(previous)) === JSON.stringify(RoutingProposal.parse(next))
  )
}

export async function route(root: string, number: number, file: string): Promise<Job> {
  const job = requireJob(root, number)
  refuseWhileBlocked(job, 'classification')
  refuseWhileSealed(root, job, 'classification')
  if (job.state === 'pr_open') throw new Refusal('An open PR cannot be reclassified.')
  let proposal: RoutingProposal
  try {
    proposal = RoutingProposal.parse(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    throw new Refusal(`Invalid routing proposal: ${String(error)}`)
  }
  if (job.routing && sameProposal(job.routing, proposal)) return refreshRouting(root, number)
  if (job.attempts || job.redCommit || job.reviews.length) {
    throw new Refusal(
      'Execution already started. Routing cannot remove or replace its controls; raise a Decision Request for scope changes.',
    )
  }
  if (job.routing) {
    if (job.routing.workflow !== 'research') {
      throw new Refusal(
        'A confirmed route cannot be replaced. The diff can only escalate its controls.',
      )
    }
    const report = join(handoffDir(job), 'research.md')
    if (!existsSync(report) || !readFileSync(report, 'utf8').trim()) {
      throw new Refusal('Research needs a non-empty research.md before classification can change.')
    }
  }
  const declaredRisk =
    job.routing?.risk === 'high' || job.risk === 'high'
      ? 'high'
      : job.routing?.risk === 'normal' || job.risk === 'normal'
        ? 'normal'
        : 'low'
  const routing = planRouting(proposal, declaredRisk)
  persist(root, job, routing, 'routing.planned')
  return refreshRouting(root, number)
}
