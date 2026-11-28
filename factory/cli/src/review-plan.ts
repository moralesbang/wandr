// A review pass in proportion to what changed. The first pass, and any pass after product code
// changed, is a full blind review by every reviewer the risk requires. A pass after only tests
// changed is a check of the previous findings: the test reviewer verifies them against the diff,
// and the evaluator's approval carries, or it verifies too when it hadn't approved. Job #13's
// second pass reran both blind reviews over a one-file acceptance-test change. A pass after a fix
// is a verify too when the product files the fix changed are the ones the findings named: job #15's
// second pass changed the one file its first finding cited plus three tests, and still ran two full
// blind reviews, nine sandbox commands in one reviewer alone.

import type { Job, ReviewerRole, ReviewPlan, Risk, RoleTask } from './job.ts'
import { RISKS } from './job.ts'
import { isTestFile } from './paths.ts'

export type PlannedRoles = ReviewPlan['roles']

export type PreviousPass = {
  roles: PlannedRoles
  /** The risk that pass was planned at. */
  risk: Risk
  /** The previous pass's merged findings (`reviews/<k>.findings.md`), or null when not written. */
  findings: string | null
  /** Whether the evaluator approved in that pass, by its report or by an approval it carried. */
  evaluatorApproved: boolean
}

/** The reviewers a risk level requires: the test reviewer alone judges a low-risk job. */
const requiredRoles = (risk: Risk): ReviewerRole[] =>
  risk === 'low' ? ['test-reviewer'] : ['evaluator', 'test-reviewer']

/**
 * Whether every product file a fix changed is named in the findings it answers, as `path` or
 * `path:line`: the fix is then the finding's, and a pass reviews that fix rather than everything.
 */
const fixesTheFindings = (product: readonly string[], findings: string | null) =>
  findings !== null && product.every((path) => findings.includes(path))

/** What each required reviewer does in this pass. */
export function planRoles(input: {
  risk: Risk
  previous: PreviousPass | null
  /** The files changed since the previous pass's HEAD. */
  changed: readonly string[]
}): PlannedRoles {
  const { risk, previous, changed } = input
  const roles = requiredRoles(risk)
  const product = changed.filter((path) => !isTestFile(path))
  // Only a risk that did not rise keeps a fix a verify: a stricter bar means a fresh look.
  const risen = previous !== null && RISKS.indexOf(risk) > RISKS.indexOf(previous.risk)
  const full =
    !previous || (product.length > 0 && (risen || !fixesTheFindings(product, previous.findings)))
  const task = (role: ReviewerRole): RoleTask => {
    if (full || !previous.roles[role]) return 'review'
    // The evaluator's approval carries only past a change of tests: a product fix is its to verify.
    if (role === 'evaluator') {
      return previous.evaluatorApproved && product.length === 0 ? 'carry' : 'verify'
    }
    return 'verify'
  }
  return Object.fromEntries(roles.map((role) => [role, task(role)])) as PlannedRoles
}

/** The most `factory sandbox exec` commands one reviewer run may spend, by what it does and the risk. */
export const SANDBOX_BUDGET: Record<'review' | 'verify' | 'ruling', Record<Risk, number>> = {
  review: { low: 3, normal: 6, high: 12 },
  verify: { low: 2, normal: 3, high: 6 },
  ruling: { low: 0, normal: 0, high: 0 },
}

/**
 * The sandbox budget of a reviewer run: its task in the pass under way, at the plan's risk. A run
 * the plan doesn't name (a ruling on an acceptance-test fix, asked between two passes) has none,
 * and a role whose approval carries runs nothing.
 */
export function sandboxBudget(job: Pick<Job, 'reviews' | 'rounds'>, role: string): number {
  const pass = job.rounds + 1
  const plan = job.reviews.find((planned) => planned.pass === pass)
  const task = plan?.roles[role as ReviewerRole]
  if (!plan || task === 'carry') return 0
  return SANDBOX_BUDGET[task ?? 'ruling'][plan.risk]
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
