// The guard's policy for writes: Edit, Write and NotebookEdit, and what an agent's Bash command
// writes (bash-policy.ts). Agents stay in their write column (visibility.ts classifyWrite). Nobody,
// the orchestrator included, writes the job's state in the main checkout (only the CLI and the
// hooks do) or, while the job is sealed, a sealed name in the job's folder: `factory unseal` would
// refuse to overwrite it. Two exceptions follow the pass's review plan: a reviewer planned to
// verify writes its own final report while another's blind pass keeps the job sealed, and a
// reviewer whose approval carries writes no report. While sealed, what the orchestrator writes
// anywhere in the worktree carries no sealed material either: the worktree is the reviewers' input.
//
// Every path is judged where it leads (paths.ts canonical), so a symlink writes nothing its target
// wouldn't.

import { join, relative } from 'node:path'
import { locate } from './events.ts'
import { jobsDir, reviewPass } from './job.ts'
import { canonical, isTsConfigText, isWithin, tsConfigDenial } from './paths.ts'
import { allow, bashWhere, deny, type GuardContext, type Policy, type Verdict } from './policy.ts'
import { routingReadOnly, sealedIn } from './read-guard.ts'
import { plannedTask, reviewerRole } from './review-plan.ts'
import { isSealedName, loadSeal } from './seal.ts'
import { classifyWrite } from './visibility.ts'

/**
 * What only a reviewer's own run writes in the job's folder: its rulings, its blind passes and its
 * final reports. `factory unseal`, `atfix` and `pr` accept them only with the log's record of that
 * run's own write, so a file the orchestrator wrote would be refused anyway; the guard says so.
 */
const REVIEWER_FILE = /^(?:rulings\/.+|reviews\/[^/]*\.(?:evaluator|test-reviewer)[^/]*\.md)$/

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
  if (routingReadOnly(job)) {
    const researchHandoff =
      !agent &&
      inHandoff &&
      (rel === 'routing-proposal.json' ||
        rel === 'research.md' ||
        /^decision-requests\/[^/]+\.md$/.test(rel))
    if (!researchHandoff && isWithin(absolute, join(bashWhere(context).home, '.claude')))
      return deny(
        `${absolute} is one of Claude Code's own files (~/.claude: its settings, its agents). No agent writes them during a job; raise the change with the user.`,
      )
    if (!researchHandoff && !isWithin(absolute, job.worktree))
      return deny(
        `${absolute} is outside the job's worktree, ${job.worktree}. Before executable routing the orchestrator writes only routing-proposal.json, research.md or a Decision Request in the job folder.`,
      )
    if (!researchHandoff)
      return deny(
        'Before executable routing, the repo is read-only. The orchestrator writes only routing-proposal.json, research.md or a Decision Request in the job folder.',
      )
  }
  if (inHandoff && job.blindPasses[rel] !== undefined) {
    return deny(
      `${rel} is a blind pass, frozen when \`factory unseal\` lifted the seal: its hash is recorded, and \`factory pr\` refuses a changed one. A blind pass rewritten after the build notes were out would not be blind. Say what you add in the final report.`,
    )
  }
  if (!agent && inHandoff && REVIEWER_FILE.test(rel)) {
    return deny(
      `${rel} is written by a reviewer's own run (a ruling, a blind pass or a final report), never by the orchestrator: the CLI accepts only what the log shows that run wrote with the Write tool. Launch the reviewer for it.`,
    )
  }
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
  return classifyWrite(agent.type, locate(absolute, places), job.worktree)
}

/** What an Edit, Write, MultiEdit or NotebookEdit puts in the file. */
const writtenText = (input: Record<string, unknown>) => {
  const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : []
  return [input, ...edits]
    .flatMap((part) => ['content', 'new_string', 'new_source'].map((key) => part?.[key]))
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
}

/** The agents whose writes a TypeScript config's content protects: they may not change the typecheck. */
const TS_CONFIG_WRITERS = new Set(['factory-test', 'factory-build'])

export const writePolicy: Policy = (context) => {
  const input = context.input.tool_input ?? {}
  const path = input.file_path ?? input.notebook_path
  if (typeof path !== 'string') return allow
  const verdict = writeVerdict(path, context)
  if (context.agent && verdict.ok && TS_CONFIG_WRITERS.has(context.agent.type)) {
    const absolute = canonical(path, bashWhere(context).cwd)
    if (isTsConfigText(path, writtenText(input)))
      return deny(tsConfigDenial(context.agent.type, absolute))
  }
  if (!verdict.ok || context.agent) return verdict
  const { root, job } = context
  const sealed = loadSeal(root, job.number)
  if (!sealed || !isWithin(canonical(path, bashWhere(context).cwd), job.worktree)) return allow
  const found = sealedIn(writtenText(input), root, job.number, null)
  return found
    ? deny(
        `Job #${job.number} is sealed for review pass ${sealed.pass}, and what you write in the worktree ${found}. The reviewers read the worktree and the job's folder for their blind passes: write it after \`bun run factory unseal ${job.number}\`.`,
      )
    : allow
}
