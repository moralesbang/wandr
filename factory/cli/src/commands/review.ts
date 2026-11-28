// `factory review <n>`: plans the review pass under way, in proportion to what changed since the
// last reviewed HEAD (review-plan.ts), records the plan and seals the roles that review blind.
// Only the orchestrator runs it (bash-policy.ts).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { handoffDir, reviewPass, saveJob, type Job, type ReviewPlan } from '../job.ts'
import { approves } from './pr.ts'
import { refreshRouting, requireRouted } from './route.ts'
import { planRoles, rolesWith, sandboxMinutes, type PreviousPass } from '../review-plan.ts'
import { jobRisk } from '../risk.ts'
import { loadSeal, refuseWhileSealed, seal, sealedStore } from '../seal.ts'
import { git, lines } from '../shell.ts'
import { record, Refusal, refuseWhileBlocked, requireJob } from './common.ts'

export const REVIEW_USAGE = `  review <n>                 plan the review pass: who reviews blind, verifies or carries; seals the blind reviewers`

/** Whether the evaluator approved in a pass: by its final report, or by an approval it carried. */
function evaluatorApproved(job: Job, plan: ReviewPlan): boolean {
  if (plan.roles.evaluator === 'carry') return true
  const report = join(handoffDir(job), 'reviews', `${plan.pass}.evaluator.md`)
  return existsSync(report) && approves(readFileSync(report, 'utf8'))
}

/** The merged findings the round after a pass wrote, if it wrote them. */
function findingsOf(job: Job, plan: ReviewPlan): string | null {
  const file = join(handoffDir(job), 'reviews', `${plan.pass}.findings.md`)
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

const previousPass = (job: Job, plan: ReviewPlan | undefined): PreviousPass | null =>
  plan
    ? {
        roles: plan.roles,
        risk: plan.risk,
        findings: findingsOf(job, plan),
        evaluatorApproved: evaluatorApproved(job, plan),
      }
    : null

export async function review(root: string, number: number): Promise<ReviewPlan> {
  const job = await refreshRouting(root, number)
  refuseWhileBlocked(job, 'a review plan')
  requireRouted(job, 'a review plan')
  const pass = reviewPass(job)
  const head = await git(job.worktree, 'rev-parse', 'HEAD')
  const planned = job.reviews.find((plan) => plan.pass === pass)
  if (planned) {
    if ((planned.routingRevision ?? 0) !== job.routingRevision) {
      throw new Refusal(
        'The review pass predates the current route. Write the findings and run factory round before review.',
      )
    }
    if (planned.head === head) return planned
    throw new Refusal(
      `Review pass ${pass} of job #${number} was planned on ${planned.head.slice(0, 7)}, and HEAD is now ${head.slice(0, 7)}. A change after a review pass goes through a round: write the findings, then run factory round ${number}.`,
    )
  }
  refuseWhileSealed(root, job, 'a review plan')
  const previous = job.reviews.findLast((plan) => plan.pass < pass)
  const changed = previous
    ? lines(await git(job.worktree, 'diff', '--name-only', '--no-renames', previous.head, head))
    : []
  const { risk, raisedBy } = await jobRisk(job)
  const previousRouting = (previous?.routingRevision ?? 0) === job.routingRevision
  const roles = planRoles({
    risk,
    previous: previousRouting ? previousPass(job, previous) : null,
    changed,
  })
  const plan: ReviewPlan = {
    pass,
    head,
    since: previous?.head ?? null,
    changed,
    risk,
    raisedBy,
    roles,
    routingRevision: job.routingRevision,
    at: new Date().toISOString(),
  }
  const blind = rolesWith(plan, 'review')
  if (blind.length) seal(root, number, { pass, roles: blind })
  saveJob(root, { ...job, reviews: [...job.reviews, plan] })
  record(root, number, 'review.planned', {
    pass,
    head,
    since: plan.since,
    changed: changed.length,
    routingRevision: job.routingRevision,
    risk,
    raisedBy,
    roles,
  })
  return plan
}

/**
 * What each verifier of a pass reads besides the diff since the last reviewed HEAD: the previous
 * pass's merged findings and its own previous final report, from the sealed store while another
 * reviewer's blind pass keeps the job sealed.
 */
function verifierReads(root: string, job: Job, plan: ReviewPlan): Record<string, string[]> {
  const folder = loadSeal(root, job.number) ? sealedStore(root, job.number) : handoffDir(job)
  const previous = plan.pass - 1
  return Object.fromEntries(
    rolesWith(plan, 'verify').map((role) => [
      role,
      [`reviews/${previous}.findings.md`, `reviews/${previous}.${role}.md`].map((rel) =>
        join(folder, rel),
      ),
    ]),
  )
}

/**
 * What `factory review` prints: the plan, whether the job is sealed now (not whether this plan
 * sealed it: run again after the unseal, it says false), and what each verifier reads.
 */
export async function reviewReport(root: string, number: number) {
  const plan = await review(root, number)
  const job = requireJob(root, number)
  return {
    ...plan,
    // The minutes each reviewer role may spend in `sandbox exec` this pass; the CLI refuses past it.
    sandboxMinutes: Object.fromEntries(
      Object.keys(plan.roles).map((role) => [role, sandboxMinutes(job, role)]),
    ),
    sealed: loadSeal(root, number) !== null,
    reads: verifierReads(root, job, plan),
  }
}
