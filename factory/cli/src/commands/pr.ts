import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { handoffDir, reviewPass, saveJob, stateDir, type Job } from '../job.ts'
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

/** Opens the PR once the gate passed on HEAD and both final reports approve. */
export async function pr(root: string, number: number): Promise<Job> {
  const job = requireJob(root, number)
  // What the agents and the orchestrator wrote is in the handoff folder; what the CLI posts is
  // kept with the job's state.
  const dir = handoffDir(job)
  const posted = stateDir(root, number)
  const head = await git(job.worktree, 'rev-parse', 'HEAD')
  if (!job.gate?.passed || job.gate.head !== head) {
    throw new Refusal('The gate has not passed on HEAD. Run factory gate.')
  }
  const pass = reviewPass(job)
  const reports = {
    evaluator: read(join(dir, 'reviews', `${pass}.evaluator.md`)),
    testReviewer: read(join(dir, 'reviews', `${pass}.test-reviewer.md`)),
  }
  for (const [who, report] of Object.entries(reports)) {
    if (!report) throw new Refusal(`No final report from the ${who} for review pass ${pass}.`)
    if (!approves(report))
      throw new Refusal(`The ${who}'s final report for pass ${pass} doesn't approve.`)
  }
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
    fit(
      [
        `## Build notes\n\n${read(join(dir, 'build-notes.md')) ?? '_None written._'}`,
        `## Evaluator, final report (pass ${pass})\n\n${reports.evaluator}`,
        `## Test reviewer, final report (pass ${pass})\n\n${reports.testReviewer}`,
      ].join('\n\n'),
    ),
  )
  await gh('pr', 'comment', url, '--body-file', commentFile)
  await moveLabel(number, LABELS.pr_open)
  const updated: Job = { ...job, state: 'pr_open', pr: url }
  saveJob(root, updated)
  record(root, number, 'pr.opened', { url })
  return updated
}
