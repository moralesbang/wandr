// Two checks on the orchestrator's own calls inside a job, both about the model and effort the
// factory fixes (FI-019): the main session must run ORCHESTRATOR, and an agent it launches must
// carry exactly what `factory launch` planned. Claude Code gives a skill's frontmatter model to one
// turn only, and nothing but the user's `/model` and `/effort` changes the session's, so the guard
// reads what the session actually ran and denies the call when it drifts.

import { existsSync, readFileSync } from 'node:fs'
import { readEvents } from './events.ts'
import { ORCHESTRATOR } from './launch.ts'
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

/** The factory agent an orchestrator call launches, or null for anything else (Explore included). */
export function launchedAgent(
  tool: string | undefined,
  input: Record<string, unknown> | undefined,
): string | null {
  if (tool !== 'Agent' && tool !== 'Task') return null
  const type = str(input?.subagent_type)
  return type?.startsWith('factory-') ? type : null
}

/**
 * The plan an agent's next launch is judged by: the latest `launch.planned` for it that no
 * authorized launch used up. One plan authorizes one launch, so a stale plan can't authorize a later
 * run, and a newer plan replaces an older unused one. Matching is by agent and by order in the log.
 */
function unusedPlan(
  events: ReturnType<typeof readEvents>,
  agent: string,
): { model: string; effort: string } | null {
  let plan: { model: string; effort: string } | null = null
  for (const event of events) {
    if (event.detail?.agent !== agent) continue
    if (event.kind === 'launch.planned') {
      plan = { model: String(event.detail.model ?? ''), effort: String(event.detail.effort ?? '') }
    } else if (event.kind === 'launch.authorized') {
      plan = null
    }
  }
  return plan
}

/**
 * An orchestrator's launch of a factory agent carries the model and effort of the unused plan
 * `factory launch` logged for that agent. Subagents' own calls (their `Agent(Explore)`) and every
 * other subagent type are not judged here. The hook logs `launch.authorized` for a launch it lets
 * through, which uses the plan up.
 */
export const launchMatchesPlan: Policy = (context) => {
  if (context.agent) return allow
  const agent = launchedAgent(context.input.tool_name, context.input.tool_input)
  if (!agent) return allow
  const n = context.job.number
  const events = readEvents(context.root, n)
  const toolUseId = context.input.tool_use_id
  // The same call judged again (a retry) is the launch the plan was already used for.
  if (
    toolUseId !== undefined &&
    events.some((event) => event.kind === 'launch.authorized' && event.toolUseId === toolUseId)
  ) {
    return allow
  }
  const plan = unusedPlan(events, agent)
  if (!plan) {
    return deny(
      `No unused launch plan for ${agent} in job #${n}: run \`bun run factory launch ${n} ${agent} --task <task>\` and copy the model and effort it prints into this Agent call. One plan authorizes one launch.`,
    )
  }
  const model = str(context.input.tool_input?.model)
  const effort = str(context.input.tool_input?.effort)
  if (model === plan.model && effort === plan.effort) return allow
  return deny(
    `This Agent call for ${agent} carries model ${model ?? 'none'} and effort ${effort ?? 'none'}; the factory fixed ${plan.model} and ${plan.effort} for it (factory launch). Pass exactly those in the call's model and effort.`,
  )
}
