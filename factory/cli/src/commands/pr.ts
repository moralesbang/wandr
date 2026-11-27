import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readEvents, type FactoryEvent } from '../events.ts'
import type { RunUsage } from '../usage.ts'
import {
  handoffDir,
  reviewPass,
  saveJob,
  stateDir,
  type Job,
  type ReviewerRole,
  type ReviewPlan,
} from '../job.ts'
import { refuseWhileSealed } from '../seal.ts'
import { gh, git } from '../shell.ts'
import { LABELS, record, Refusal, requireJob } from './common.ts'
import { moveLabel } from './start.ts'

/** GitHub refuses comments and bodies over 65,536 characters. */
const LIMIT = 60_000
const fit = (text: string) =>
  text.length <= LIMIT
    ? text
    : `${text.slice(0, LIMIT)}\n\n…(cut: the full file is in the job's handoff folder)`

const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8').trim() : null)

/** A final report approves when its first non-empty line is `Verdict: approve`. */
export const approves = (report: string) =>
  /^verdict:\s*approve\b/i.test(
    report
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? '',
  )

export function prBody(job: Job, parts: { summary: string; acceptance: string }): string {
  const check = job.lastCheck
  const fixes = job.atfixes.length
    ? job.atfixes
        .map((fix) => `- ${fix.sha.slice(0, 7)}: ${fix.note} (${fix.files.join(', ')})`)
        .join('\n')
    : 'None.'
  const rewrites = job.rewrites.length
    ? `## Authorized guarantee changes\n\n${job.rewrites
        .map((item) => `- ${item.commit.slice(0, 7)}: ${item.note}`)
        .join('\n')}`
    : null
  return fit(
    [
      `Closes #${job.number}`,
      `## Summary\n\n${parts.summary}`,
      `## Acceptance criteria\n\n${parts.acceptance}`,
      `## Checks\n\nThe local CI checks passed on \`${job.gate?.head.slice(0, 7)}\`${check ? ` (${check.at})` : ''}. ${job.attempts} build attempt(s), ${job.rounds} review round(s) with findings.`,
      `## Acceptance test fixes\n\n${fixes}`,
      ...(rewrites ? [rewrites] : []),
      `The build notes and both reviewers' final reports are in the first comment.`,
      `🤖 Generated with [Claude Code](https://claude.com/claude-code)`,
    ].join('\n\n'),
  )
}

const usd = (value: number) => `$${value.toFixed(2)}`
const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))
/** `claude-opus-5-5` for one name, `claude-opus-5-5 ×12, claude-sonnet-5-5 ×3` for several. */
const seen = (counts: Record<string, number>) => {
  const entries = Object.entries(counts)
  if (entries.length === 1) return entries[0]![0]
  return entries.map(([name, n]) => `${name} ×${n}`).join(', ') || '–'
}
const cost = (total: number, unpriced: string[]) =>
  unpriced.length ? `${usd(total)} + unpriced (${unpriced.join(', ')})` : usd(total)

/**
 * The per-run table of the PR comment, from the job's events: each run's latest usage event wins,
 * since a resumed subagent logs its total again. Null when the log holds no usage.
 */
export function usageTable(events: FactoryEvent[]): string | null {
  const runs = new Map<string, { label: string; usage: RunUsage }>()
  for (const event of events) {
    if (event.kind !== 'usage' || !event.detail) continue
    const id = event.agent?.id ?? 'orchestrator'
    const label = event.agent ? `${event.agent.type} (${id.slice(0, 7)})` : 'orchestrator'
    runs.set(id, { label, usage: event.detail as RunUsage })
  }
  if (!runs.size) return null
  const rows = [...runs.values()].map(
    ({ label, usage }) =>
      `| ${label} | ${seen(usage.models)} | ${seen(usage.efforts)} | ${kilo(usage.tokens.input)} | ${kilo(usage.tokens.output)} | ${kilo(usage.tokens.cacheRead)} | ${kilo(usage.tokens.cacheWrite5m + usage.tokens.cacheWrite1h)} | ${cost(usage.usd, usage.unpriced)} |`,
  )
  const all = [...runs.values()].map((run) => run.usage)
  const total = cost(
    all.reduce((sum, usage) => sum + usage.usd, 0),
    [...new Set(all.flatMap((usage) => usage.unpriced))],
  )
  return [
    '| Agent | Model | Effort | Input | Output | Cache read | Cache write | Cost |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    `| **Total** | | | | | | | **${total}** |`,
  ].join('\n')
}

/** The first comment on the PR: what the cost was, the build notes and both final reports. */
export function prComment(parts: {
  buildNotes: string | null
  pass: number
  evaluator: string
  testReviewer: string
  usage: string | null
}): string {
  return fit(
    [
      ...(parts.usage ? [`## Cost per agent\n\n${parts.usage}`] : []),
      `## Build notes\n\n${parts.buildNotes ?? '_None written._'}`,
      `## Evaluator, final report (pass ${parts.pass})\n\n${parts.evaluator}`,
      `## Test reviewer, final report (pass ${parts.pass})\n\n${parts.testReviewer}`,
    ].join('\n\n'),
  )
}

/**
 * What each reviewer says for the pass, by its plan: the final report of a role that reviewed or
 * verified, which must approve; the approval a role carries; or that the risk didn't need it.
 * Refuses when a planned report is missing or doesn't approve.
 */
export function plannedReports(
  job: Pick<Job, 'reviews'>,
  plan: ReviewPlan,
  readReport: (rel: string) => string | null,
): Record<ReviewerRole, string> {
  const say = (role: ReviewerRole): string => {
    const task = plan.roles[role]
    if (!task) {
      return `_Not launched: the job is ${plan.risk} risk, and the test reviewer alone judges a low-risk job._`
    }
    if (task === 'carry') {
      const judged = job.reviews.findLast(
        (earlier) => earlier.pass < plan.pass && earlier.roles[role] !== 'carry',
      )
      return `_Its approval from review pass ${judged?.pass ?? '?'} carries: only tests changed since._`
    }
    const report = readReport(`reviews/${plan.pass}.${role}.md`)
    if (!report) throw new Refusal(`No final report from the ${role} for review pass ${plan.pass}.`)
    if (!approves(report)) {
      throw new Refusal(`The ${role}'s final report for pass ${plan.pass} doesn't approve.`)
    }
    return report
  }
  return { evaluator: say('evaluator'), 'test-reviewer': say('test-reviewer') }
}

/** Opens the PR once the gate passed on HEAD and every reviewer the pass's plan names approves. */
export async function pr(root: string, number: number): Promise<Job> {
  const job = requireJob(root, number)
  refuseWhileSealed(root, job, 'the PR')
  // What the agents and the orchestrator wrote is in the handoff folder; what the CLI posts is
  // kept with the job's state.
  const dir = handoffDir(job)
  const posted = stateDir(root, number)
  const head = await git(job.worktree, 'rev-parse', 'HEAD')
  if (!job.gate?.passed || job.gate.head !== head) {
    throw new Refusal('The gate has not passed on HEAD. Run factory gate.')
  }
  const pass = reviewPass(job)
  const plan = job.reviews.find((planned) => planned.pass === pass)
  if (!plan) {
    throw new Refusal(
      `Review pass ${pass} has no plan. Run: bun run factory review ${number}, then the reviewers it names.`,
    )
  }
  if (plan.head !== head) {
    throw new Refusal(
      `Review pass ${pass} reviewed ${plan.head.slice(0, 7)}, and HEAD is ${head.slice(0, 7)}: what changed since was never reviewed.`,
    )
  }
  const reports = plannedReports(job, plan, (rel) => read(join(dir, rel)))
  const summary = read(join(dir, 'summary.md'))
  const acceptance = read(join(dir, 'acceptance.md'))
  if (!summary) throw new Refusal(`Write the PR summary in ${dir}/summary.md first.`)
  if (!acceptance) throw new Refusal(`The test agent's ${dir}/acceptance.md is missing.`)

  await git(job.worktree, 'push', '--quiet', '-u', 'origin', job.branch)
  const bodyFile = join(posted, 'pr-body.md')
  writeFileSync(bodyFile, prBody(job, { summary, acceptance }))
  const url = await gh(
    'pr',
    'create',
    '--base',
    'main',
    '--head',
    job.branch,
    '--title',
    job.title,
    '--body-file',
    bodyFile,
  )
  const commentFile = join(posted, 'pr-comment.md')
  writeFileSync(
    commentFile,
    prComment({
      buildNotes: read(join(dir, 'build-notes.md')),
      pass,
      evaluator: reports.evaluator,
      testReviewer: reports['test-reviewer'],
      usage: usageTable(readEvents(root, number)),
    }),
  )
  await gh('pr', 'comment', url, '--body-file', commentFile)
  await moveLabel(number, LABELS.pr_open)
  const updated: Job = { ...job, state: 'pr_open', pr: url }
  saveJob(root, updated)
  record(root, number, 'pr.opened', { url })
  return updated
}
