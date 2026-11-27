// The guard's policy for writes: Edit, Write and NotebookEdit, and what an agent's Bash command
// writes (bash-policy.ts). Agents stay in their write column (visibility.ts classifyWrite). Nobody,
// the orchestrator included, writes the job's state in the main checkout (only the CLI and the
// hooks do) or, while the job is sealed, a sealed name in the job's folder: `factory unseal` would
// refuse to overwrite it. Two exceptions follow the pass's review plan: a reviewer planned to
// verify writes its own final report while another's blind pass keeps the job sealed, and a
// reviewer whose approval carries writes no report. While sealed, what the orchestrator writes in
// the job's folder carries no sealed material either: it is the reviewers' input.
//
// Every path is judged where it leads (paths.ts canonical), so a symlink writes nothing its target
// wouldn't.

import { relative } from 'node:path'
import { locate } from './events.ts'
import { jobsDir, reviewPass } from './job.ts'
import { canonical, isWithin } from './paths.ts'
import { allow, bashWhere, deny, type GuardContext, type Policy, type Verdict } from './policy.ts'
import { sealedIn } from './read-guard.ts'
import { plannedTask, reviewerRole } from './review-plan.ts'
import { isSealedName, loadSeal } from './seal.ts'
import { classifyWrite } from './visibility.ts'

/** The verdict on one path a call writes; relative paths start in the call's folder. */
export function writeVerdict(path: string, context: GuardContext): Verdict {
  const { root, job, places, agent } = context
  const absolute = canonical(path, bashWhere(context).cwd)
  if (!agent && isWithin(absolute, jobsDir(root))) {
    return deny(
      `${absolute} is the job's state in the main checkout, written only by the CLI and the hooks. Use \`bun run factory <command>\`; what you hand an agent goes in ${places.handoffDir}.`,
    )
  }
  const sealed = loadSeal(root, job.number)
  const rel = relative(places.handoffDir, absolute)
  const inHandoff = isWithin(absolute, places.handoffDir)
  const role = agent ? reviewerRole(agent.type) : null
  const verifiersReport =
    sealed &&
    role &&
    plannedTask(job, sealed.pass, role) === 'verify' &&
    rel === `reviews/${sealed.pass}.${role}.md`
  if (sealed && inHandoff && isSealedName(rel) && !verifiersReport) {
    return deny(
      `Job #${job.number} is sealed for review pass ${sealed.pass}: ${rel} is sealed material, and \`bun run factory unseal ${job.number}\` would refuse to overwrite it. Write it after the unseal.`,
    )
  }
  const pass = reviewPass(job)
  if (
    role &&
    inHandoff &&
    plannedTask(job, pass, role) === 'carry' &&
    new RegExp(`^reviews/${pass}\\.${role}(?:\\.blind)?\\.md$`).test(rel)
  ) {
    return deny(
      `In review pass ${pass} the ${role}'s approval from the previous pass carries: only tests changed since. It writes no report for this pass.`,
    )
  }
  if (!agent) return allow
  return classifyWrite(agent.type, locate(absolute, places))
}

/** What an Edit, Write or NotebookEdit puts in the file. */
const writtenText = (input: Record<string, unknown>) =>
  ['content', 'new_string', 'new_source']
    .map((key) => input[key])
    .filter((value): value is string => typeof value === 'string')
    .join('\n')

export const writePolicy: Policy = (context) => {
  const input = context.input.tool_input ?? {}
  const path = input.file_path ?? input.notebook_path
  if (typeof path !== 'string') return allow
  const verdict = writeVerdict(path, context)
  if (!verdict.ok || context.agent) return verdict
  const { root, job, places } = context
  const sealed = loadSeal(root, job.number)
  if (!sealed || !isWithin(canonical(path, bashWhere(context).cwd), places.handoffDir)) return allow
  const found = sealedIn(writtenText(input), root, job.number, null)
  return found
    ? deny(
        `Job #${job.number} is sealed for review pass ${sealed.pass}, and what you write in the job's folder ${found}. The reviewers read that folder for their blind passes: write it after \`bun run factory unseal ${job.number}\`.`,
      )
    : allow
}
