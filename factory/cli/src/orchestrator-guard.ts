// Two checks on the orchestrator's own calls inside a job, both about the model and effort the
// factory fixes (FI-019): the main session must run ORCHESTRATOR, and an agent it launches must
// carry exactly what `factory launch` planned. Claude Code gives a skill's frontmatter model to one
// turn only, and nothing but the user's `/model` and `/effort` changes the session's, so the guard
// reads what the session actually ran and denies the call when it drifts.

import { existsSync, readFileSync } from 'node:fs'
import { readEvents } from './events.ts'
import { LAUNCH_HEADER as HEADER, ORCHESTRATOR } from './launch.ts'
import { allow, deny, type Policy } from './policy.ts'

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

/** The model and effort of the latest assistant message a transcript holds, or null. */
export function latestSetting(path: string): { model: string; effort?: string } | null {
  if (!existsSync(path)) return null
  const lines = readFileSync(path, 'utf8').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i]?.trim()
    if (!raw) continue
    let line: { type?: unknown; isSidechain?: unknown; effort?: unknown; message?: unknown }
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    if (line.type !== 'assistant' || line.isSidechain === true) continue
    const model = str((line.message as { model?: unknown } | undefined)?.model)
    // Claude Code's placeholder for an error it made up carries no model the session ran.
    if (!model || model === '<synthetic>') continue
    const effort = str(line.effort)
    return { model, ...(effort ? { effort } : {}) }
  }
  return null
}

/** `opus` is `claude-opus-5-5` in a transcript. */
const isModel = (actual: string, short: string) => actual.startsWith(`claude-${short}-`)

/** The one command a session at the wrong setting may still run: reading the job's status. */
const STATUS_ONLY = /^\s*bun run factory status(?:\s+\d+)?\s*$/

const fix = `Ask the user to run \`/model ${ORCHESTRATOR.model}\` and \`/effort ${ORCHESTRATOR.effort}\` in this session, then retry.`

/**
 * The main session runs the orchestrator's setting. Judged on the latest assistant message in the
 * session's transcript, which is the one making this call: its line is written before PreToolUse
 * fires. A transcript that can't be read or shows no model is denied, as every call the guard can't
 * judge is. The user's own `!` commands fire no hook, so the user is never locked out, and `factory
 * status` stays readable.
 */
export const orchestratorSetting: Policy = (context) => {
  if (context.agent) return allow
  if (
    context.input.tool_name === 'Bash' &&
    STATUS_ONLY.test(str(context.input.tool_input?.command) ?? '')
  ) {
    return allow
  }
  const path = context.input.transcript_path
  const actual = path ? latestSetting(path) : null
  if (!actual) {
    return deny(
      `The factory guard can't read the main session's model and effort (${path ? `${path} holds no assistant message` : 'the hook input has no transcript'}), and a job's orchestrator must run ${ORCHESTRATOR.model} at ${ORCHESTRATOR.effort} effort. ${fix}`,
    )
  }
  const problems = [
    ...(isModel(actual.model, ORCHESTRATOR.model)
      ? []
      : [`model ${actual.model}, not ${ORCHESTRATOR.model}`]),
    ...(actual.effort === ORCHESTRATOR.effort
      ? []
      : [`effort ${actual.effort ?? 'unknown'}, not ${ORCHESTRATOR.effort}`]),
  ]
  if (problems.length === 0) return allow
  return deny(
    `The orchestrator of a factory job runs ${ORCHESTRATOR.model} at ${ORCHESTRATOR.effort} effort: it judges the route, merges the reviewers' findings and decides when to ask the user, and a skill's frontmatter can't set the session's model. This session ran ${problems.join(' and ')}. ${fix}`,
  )
}

const isLaunch = (tool: string | undefined) => tool === 'Agent' || tool === 'Task'

/** The factory agent an orchestrator call launches, or null for anything else (Explore included). */
export function launchedAgent(
  tool: string | undefined,
  input: Record<string, unknown> | undefined,
): string | null {
  if (!isLaunch(tool)) return null
  const type = str(input?.subagent_type)
  return type?.startsWith('factory-') ? type : null
}

/** The plan id a call names in its prompt's first line, or null. */
export const launchedPlanId = (input: Record<string, unknown> | undefined): string | null =>
  HEADER.exec(str(input?.prompt) ?? '')?.[4] ?? null

/**
 * Which subagents a job's session may launch. Every subagent of a job launches only `Explore`, on
 * `haiku`. The orchestrator launches `Explore` on `haiku` too, and a factory agent only with a
 * plan: its prompt starts with the header `factory launch` printed, the plan's id is known and
 * unused, and the call's agent, task, model and effort are the plan's. One plan authorizes one
 * launch, so a stale plan can't authorize a later run, and the task is part of the plan, so a
 * ruling's plan can't authorize a review. Any other type, `general-purpose` included, is denied.
 * The hook logs `launch.authorized` with the plan id for a launch it lets through, which uses the
 * plan up; the same call judged again (a retry) is the launch already authorized.
 */
export const launchPolicy: Policy = (context) => {
  const { tool_name: tool, tool_input: input, tool_use_id: toolUseId } = context.input
  if (!isLaunch(tool)) return allow
  const type = str(input?.subagent_type) ?? ''
  const model = str(input?.model)
  const none = type || 'a call with no subagent_type'
  if (type === 'Explore') {
    // Explore's default model in this setup can't be read from the guard's inputs, and runs of it
    // have passed `sonnet`: it is pinned, not defaulted.
    return model === 'haiku'
      ? allow
      : deny(
          `An Explore subagent of a factory job runs on haiku: pass model "haiku" in the Agent call (this one carries ${model ?? 'none'}).`,
        )
  }
  if (context.agent) {
    return deny(
      `A factory agent launches only an Explore subagent (model "haiku"); ${none} is not one.`,
    )
  }
  const n = context.job.number
  const run = `bun run factory launch ${n} <agent> --task <task>`
  if (!type.startsWith('factory-')) {
    return deny(
      `During job #${n} the orchestrator launches only the factory's agents, each after \`${run}\`, and Explore on haiku; ${none} is neither.`,
    )
  }
  const header = HEADER.exec(str(input?.prompt) ?? '')
  if (!header) {
    return deny(
      `This Agent call for ${type} doesn't start its prompt with the header \`${run}\` prints (a line "factory-launch: <n> <agent> <task> <plan id>"). Run it and put that line first.`,
    )
  }
  const [, headerJob, headerAgent, headerTask, planId] = header
  const events = readEvents(context.root, n)
  const plan = events.find(
    (event) => event.kind === 'launch.planned' && event.detail?.planId === planId,
  )
  if (!plan || Number(headerJob) !== n) {
    return deny(`Launch plan ${planId} is not a plan of job #${n}: run \`${run}\`.`)
  }
  const used = events.find(
    (event) => event.kind === 'launch.authorized' && event.detail?.planId === planId,
  )
  if (used && (toolUseId === undefined || used.toolUseId !== toolUseId)) {
    return deny(
      `Launch plan ${planId} was already used for a launch. One plan authorizes one launch: run \`${run}\` again.`,
    )
  }
  const planned = {
    agent: String(plan.detail?.agent),
    task: String(plan.detail?.task),
    model: String(plan.detail?.model),
    effort: String(plan.detail?.effort),
  }
  // The header's agent and task are the call's own claim: the type is the call's agent.
  const carried = {
    agent: headerAgent === type ? type : `${type} (header ${headerAgent})`,
    task: headerTask,
    model: model ?? 'none',
    effort: str(input?.effort) ?? 'none',
  }
  const differs = (['agent', 'task', 'model', 'effort'] as const).filter(
    (key) => carried[key] !== planned[key],
  )
  if (differs.length === 0) return allow
  return deny(
    `This Agent call differs from launch plan ${planId} in ${differs.join(', ')}: the plan is ${planned.agent} ${planned.task} on ${planned.model} at ${planned.effort} effort, the call is ${carried.agent} ${carried.task} on ${carried.model} at ${carried.effort}. Pass exactly the plan's.`,
  )
}
