import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  countAttempt,
  countRound,
  handoffDir,
  listJobs,
  saveJob,
  stateDir,
  type Job,
} from '../job.ts'
import { isAcceptanceTest } from '../paths.ts'
import { commitAll, gh, git, uncommitted } from '../shell.ts'
import { LABELS, record, Refusal, requireJob } from './common.ts'
import { DECISION_REQUEST_MARKER, moveLabel } from './start.ts'

export function attempt(root: string, number: number): Job {
  const counted = countAttempt(requireJob(root, number))
  if (!counted.ok) throw new Refusal(counted.reason)
  saveJob(root, counted.job)
  record(root, number, 'attempt', { attempt: counted.job.attempts })
  return counted.job
}

export function round(root: string, number: number): Job {
  const counted = countRound(requireJob(root, number))
  if (!counted.ok) throw new Refusal(counted.reason)
  saveJob(root, counted.job)
  record(root, number, 'round', { round: counted.job.rounds })
  return counted.job
}

/** Commits what changed in the worktree, after checking that only acceptance tests did. */
async function commitAcceptanceChange(
  job: Job,
  what: string,
  message: (note: string) => string,
  note: string,
): Promise<{ sha: string; files: string[] }> {
  const changed = await uncommitted(job.worktree)
  if (changed.length === 0) throw new Refusal('Nothing changed.')
  const others = changed.filter((path) => !isAcceptanceTest(path))
  if (others.length) {
    throw new Refusal(`${what} changes only acceptance tests; these aren't: ${others.join(', ')}`)
  }
  return { sha: await commitAll(job.worktree, message(note)), files: changed }
}

/** Commits the test agent's same-guarantee fix to acceptance tests, and nothing else. */
export async function atfix(root: string, number: number, note: string): Promise<Job> {
  const job = requireJob(root, number)
  if (!note.trim()) throw new Refusal('Say what the fix changes: factory atfix <n> --note "…"')
  const { sha, files } = await commitAcceptanceChange(
    job,
    'An acceptance-test fix',
    (text) => `test(#${number}): fix an acceptance test\n\n${text}\n\nFactory-Job: #${number}`,
    note,
  )
  const updated: Job = {
    ...job,
    cliCommits: [...job.cliCommits, sha],
    atfixes: [...job.atfixes, { sha, note, files }],
  }
  saveJob(root, updated)
  record(root, number, 'atfix', { sha, note, files })
  return updated
}

/**
 * Commits the test agent's rewrite of acceptance tests after the user authorized a change of
 * guarantee on the issue. The note cites that authorization.
 */
export async function rewrite(root: string, number: number, note: string): Promise<Job> {
  const job = requireJob(root, number)
  if (!note.trim()) {
    throw new Refusal(
      'Cite the user\'s authorization: factory rewrite <n> --note "<the issue comment URL>"',
    )
  }
  if (job.decisionRequests.length === 0) {
    throw new Refusal(
      `Job #${number} has no Decision Request, so no guarantee change can be authorized. Raise one with factory block.`,
    )
  }
  const { sha, files } = await commitAcceptanceChange(
    job,
    'An authorized rewrite',
    (text) =>
      `test(#${number}): rewrite acceptance tests as authorized\n\n${text}\n\nFactory-Job: #${number}`,
    note,
  )
  const updated: Job = {
    ...job,
    cliCommits: [...job.cliCommits, sha],
    rewrites: [...job.rewrites, { commit: sha, note, at: new Date().toISOString() }],
  }
  saveJob(root, updated)
  record(root, number, 'rewrite', { sha, note, files })
  return updated
}

/** Posts a Decision Request on the issue and blocks the job until the user answers there. */
export async function block(root: string, number: number, file: string): Promise<Job> {
  const job = requireJob(root, number)
  const dir = join(handoffDir(job), 'decision-requests')
  mkdirSync(dir, { recursive: true })
  const kept = join(dir, `${job.decisionRequests.length + 1}.md`)
  copyFileSync(file, kept)
  const posted = join(dir, `${job.decisionRequests.length + 1}.posted.md`)
  writeFileSync(posted, `${DECISION_REQUEST_MARKER}\n${readFileSync(file, 'utf8')}`)
  const at = new Date().toISOString()
  await gh('issue', 'comment', String(number), '--body-file', posted)
  await moveLabel(number, LABELS.blocked)
  const updated: Job = {
    ...job,
    state: 'blocked',
    decisionRequests: [...job.decisionRequests, { at, file: kept }],
  }
  saveJob(root, updated)
  record(root, number, 'blocked', { file: kept })
  return updated
}

export function status(root: string): string {
  const jobs = listJobs(root)
  if (jobs.length === 0) return 'No jobs.'
  return jobs
    .map(
      (job) =>
        `#${job.number}  ${job.state.padEnd(8)}  attempts ${job.attempts}/3  rounds ${job.rounds}/3  ${job.branch}${job.pr ? `  ${job.pr}` : ''}`,
    )
    .join('\n')
}

/** Removes a merged job's worktree (its handoff folder with it), branch and state folder. */
export async function clean(root: string, number: number): Promise<void> {
  const job = requireJob(root, number)
  const state = job.pr
    ? (JSON.parse(await gh('pr', 'view', job.pr, '--json', 'state')) as { state: string }).state
    : 'NONE'
  if (state !== 'MERGED') throw new Refusal(`Job #${number}'s PR isn't merged (${state}).`)
  await git(root, 'worktree', 'remove', '--force', job.worktree)
  await git(root, 'branch', '-D', job.branch)
  rmSync(stateDir(root, number), { recursive: true, force: true })
}
