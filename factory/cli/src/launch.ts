// The model and effort every factory run uses, fixed in the repo: the orchestrator copies what
// `factory launch` prints into its Agent call instead of choosing. Judging runs (diagnosis, the
// reviewers) get the stronger model; writing runs get the cheaper one. The job's effective risk
// (risk.ts) sets how hard the reviewers look, and whether the evaluator runs at all.

import { record, Refusal, refuseWhileBlocked } from './commands/common.ts'
import { refreshRouting, requireRouted } from './commands/route.ts'
import type { Risk } from './job.ts'
import { jobRisk } from './risk.ts'
import { requiresAcceptance } from './routing.ts'

export const TASKS = ['write', 'fix', 'review', 'verify', 'ruling', 'diagnose', 'build'] as const
export type Task = (typeof TASKS)[number]

export type Model = 'sonnet' | 'opus'
export type Effort = 'low' | 'medium' | 'high'
export type Setting = { model: Model; effort: Effort }

/** The main session's own setting, for the skill's frontmatter; `factory launch` never plans it. */
export const ORCHESTRATOR: Setting = { model: 'sonnet', effort: 'medium' }

const s = (model: Model, effort: Effort): Setting => ({ model, effort })
const always = (setting: Setting) => ({ low: setting, normal: setting, high: setting })

/** A setting per risk level; null means the run doesn't happen at that level. */
type ByRisk = Record<Risk, Setting | null>

const EVALUATOR: ByRisk = { low: null, normal: s('opus', 'medium'), high: s('opus', 'high') }
const TEST_REVIEWER_REVIEW: ByRisk = {
  low: s('opus', 'medium'),
  normal: s('opus', 'medium'),
  high: s('opus', 'high'),
}
const TEST_REVIEWER_CHECK: ByRisk = {
  low: s('opus', 'low'),
  normal: s('opus', 'low'),
  high: s('opus', 'medium'),
}

export const LAUNCH_TABLE: Record<string, Partial<Record<Task, ByRisk>>> = {
  'factory-diagnose': { diagnose: always(s('opus', 'high')) },
  'factory-test': { write: always(s('sonnet', 'high')), fix: always(s('sonnet', 'medium')) },
  'factory-build': { build: always(s('sonnet', 'medium')) },
  // The evaluator's verify (a pass where only tests changed and it hadn't approved) is the same run
  // as its review: the table sets the evaluator by risk alone.
  'factory-evaluator': { review: EVALUATOR, verify: EVALUATOR },
  'factory-test-reviewer': {
    review: TEST_REVIEWER_REVIEW,
    verify: TEST_REVIEWER_CHECK,
    ruling: TEST_REVIEWER_CHECK,
  },
}

export type LaunchSetting = ({ ok: true } & Setting) | { ok: false; reason: string }

/** The model and effort for one run, or why the table has no such run. */
export function launchSetting(agent: string, task: string, risk: Risk): LaunchSetting {
  const tasks = LAUNCH_TABLE[agent]
  if (!tasks) {
    return {
      ok: false,
      reason: `${agent} is not an agent the factory launches: ${Object.keys(LAUNCH_TABLE).join(', ')}.`,
    }
  }
  const byRisk = tasks[task as Task]
  if (!byRisk) {
    return {
      ok: false,
      reason: `${agent} has no task "${task}"; its tasks: ${Object.keys(tasks).join(', ')}.`,
    }
  }
  const setting = byRisk[risk]
  if (!setting) {
    return {
      ok: false,
      reason: `${agent} doesn't run at low risk: the test reviewer alone judges a low-risk job.`,
    }
  }
  return { ok: true, ...setting }
}

export type Launch = {
  agent: string
  task: Task
  model: Model
  effort: Effort
  risk: Risk
  raisedBy: string[]
  workflow?: string
  scope?: string
  verification?: string[]
}

/** Plans one agent run at the job's effective risk and logs it; refused when the table says no. */
export async function launch(
  root: string,
  number: number,
  agent: string,
  task: string,
): Promise<Launch> {
  const job = await refreshRouting(root, number)
  refuseWhileBlocked(job, 'an agent launch')
  requireRouted(job, 'an agent launch')
  if (
    agent === 'factory-build' &&
    job.routing &&
    requiresAcceptance(job.routing) &&
    !job.redCommit
  ) {
    throw new Refusal(
      'This route requires independent acceptance tests and a verified red before implementation. If a light job escalated after implementation, raise a Decision Request to restart; do not continue the build.',
    )
  }
  if (job.routing?.workflow === 'light' && agent === 'factory-test') {
    throw new Refusal(
      'The light workflow has no acceptance-test writer; its independent reviewer verifies acceptance criteria.',
    )
  }
  const { risk, raisedBy } = await jobRisk(job)
  const setting = launchSetting(agent, task, risk)
  if (!setting.ok) throw new Refusal(`Job #${number} (${risk} risk): ${setting.reason}`)
  const planned: Launch = {
    agent,
    task: task as Task,
    model: setting.model,
    effort: setting.effort,
    risk,
    raisedBy,
    ...(job.routing
      ? {
          workflow: job.routing.workflow,
          scope: job.routing.scope,
          verification: job.routing.verification,
        }
      : {}),
  }
  record(root, number, 'launch.planned', {
    agent,
    task,
    model: setting.model,
    effort: setting.effort,
    risk,
  })
  return planned
}

export const LAUNCH_USAGE = `  launch <n> <agent> --task <${TASKS.join('|')}>
                             the model and effort to launch an agent with, as JSON`
