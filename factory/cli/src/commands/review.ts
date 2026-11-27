// `factory review <n>`: plans the review pass under way, in proportion to what changed since the
// last reviewed HEAD (review-plan.ts), records the plan and seals the roles that review blind.
// Only the orchestrator runs it (bash-policy.ts).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { handoffDir, reviewPass, saveJob, type Job, type ReviewPlan } from '../job.ts'
import { approves } from './pr.ts'
import { planRoles, rolesWith, type PreviousPass } from '../review-plan.ts'
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

const previousPass = (job: Job, plan: ReviewPlan | undefined): PreviousPass | null =>
  plan ? { roles: plan.roles, evaluatorApproved: evaluatorApproved(job, plan) } : null

export async function review(root: string, number: number): Promise<ReviewPlan> {
  const job = requireJob(root, number)
  refuseWhileBlocked(job, 'a review plan')
  const pass = reviewPass(job)
  const head = await git(job.worktree, 'rev-parse', 'HEAD')
  const planned = job.reviews.find((plan) => plan.pass === pass)
  if (planned) {
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
  const roles = planRoles({ risk, previous: previousPass(job, previous), changed })
  const plan: ReviewPlan = {
    pass,
    head,
    since: previous?.head ?? null,
    changed,
    risk,
    raisedBy,
    roles,
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
export function verifierReads(root: string, job: Job, plan: ReviewPlan): Record<string, string[]> {
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
