// A review pass in proportion to what changed. The first pass, and any pass after product code
// changed, is a full blind review by every reviewer the risk requires. A pass after only tests
// changed is a check of the previous findings: the test reviewer verifies them against the diff,
// and the evaluator's approval carries, or it verifies too when it hadn't approved. Job #13's
// second pass reran both blind reviews over a one-file acceptance-test change.

import type { Job, ReviewerRole, ReviewPlan, Risk, RoleTask } from './job.ts'
import { isTestFile } from './paths.ts'

export type PlannedRoles = ReviewPlan['roles']

export type PreviousPass = {
  roles: PlannedRoles
  /** Whether the evaluator approved in that pass, by its report or by an approval it carried. */
  evaluatorApproved: boolean
}

/** The reviewers a risk level requires: the test reviewer alone judges a low-risk job. */
export const requiredRoles = (risk: Risk): ReviewerRole[] =>
  risk === 'low' ? ['test-reviewer'] : ['evaluator', 'test-reviewer']

/** What each required reviewer does in this pass. */
export function planRoles(input: {
  risk: Risk
  previous: PreviousPass | null
  /** The files changed since the previous pass's HEAD. */
  changed: readonly string[]
}): PlannedRoles {
  const { risk, previous, changed } = input
  const roles = requiredRoles(risk)
  const full = !previous || changed.some((path) => !isTestFile(path))
  const task = (role: ReviewerRole): RoleTask => {
    if (full || !previous.roles[role]) return 'review'
    if (role === 'evaluator') return previous.evaluatorApproved ? 'carry' : 'verify'
    return 'verify'
  }
  return Object.fromEntries(roles.map((role) => [role, task(role)])) as PlannedRoles
}

/** The roles of a plan with the given task. */
export const rolesWith = (plan: Pick<ReviewPlan, 'roles'>, task: RoleTask): ReviewerRole[] =>
  (Object.entries(plan.roles) as [ReviewerRole, RoleTask | undefined][])
    .filter(([, planned]) => planned === task)
    .map(([role]) => role)

/** What the job's plan for a pass has a role do; undefined when the pass has no plan or no role. */
export const plannedTask = (
  job: Pick<Job, 'reviews'>,
  pass: number,
  role: string,
): RoleTask | undefined =>
  job.reviews.find((plan) => plan.pass === pass)?.roles[role as ReviewerRole]

/** The reviewer role of an agent type, or null for any other run. */
export const reviewerRole = (agentType: string): ReviewerRole | null =>
  (/^factory-(evaluator|test-reviewer)$/.exec(agentType)?.[1] as ReviewerRole | undefined) ?? null

/**
 * The sealed names a verifier reads while another reviewer's blind pass keeps the job sealed: the
 * merged findings and its own earlier final reports. The build notes, the Decision Requests and the
 * other reviewer's reports stay sealed for it too.
 */
export const verifierMayRead = (role: ReviewerRole, rel: string) =>
  /^reviews\/\d+\.findings\.md$/.test(rel) || new RegExp(`^reviews/\\d+\\.${role}\\.md$`).test(rel)
