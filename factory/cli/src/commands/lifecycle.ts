import { $ } from 'bun'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
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

/** The compose project every checkout shares: `name:` in docker-compose.yml. */
export const SHARED_COMPOSE_PROJECT = 'wandr'

/**
 * The compose project a worktree started before docker-compose.yml set `name:`: compose named it
 * after the folder, lowercased, keeping only letters, digits, `_` and `-`.
 */
export const composeProjectOf = (worktree: string) =>
  basename(worktree)
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]/g, '')
    .replace(/^[^a-z0-9]+/, '')

/**
 * Takes down the worktree's own compose stack, with its volumes, if one is left. Never the shared
 * stack. Returns what it did, or why it couldn't look.
 */
async function downWorktreeStack(root: string, worktree: string): Promise<string> {
  const project = composeProjectOf(worktree)
  if (!project || project === SHARED_COMPOSE_PROJECT) return 'No compose stack of its own.'
  const label = `label=com.docker.compose.project=${project}`
  const containers = await $`docker ps -aq --filter ${label}`.nothrow().quiet()
  const volumes = await $`docker volume ls -q --filter ${label}`.nothrow().quiet()
  if (containers.exitCode !== 0 || volumes.exitCode !== 0) {
    return `Docker isn't reachable, so a compose stack "${project}" may be left: docker compose -p ${project} down --volumes`
  }
  if (!`${containers.stdout}${volumes.stdout}`.trim()) return 'No compose stack of its own.'
  await $`docker compose -p ${project} down --volumes --remove-orphans`.cwd(root).quiet()
  return `Took down the compose stack "${project}" and its volumes.`
}

const exitsZero = async (command: ReturnType<typeof $>) =>
  (await command.nothrow().quiet()).exitCode === 0

/**
 * Discards a job that never merged, so its issue can start again from scratch: takes down any
 * compose stack its worktree started, removes the worktree and the branch, local and remote,
 * deletes the job's state and puts the issue's label back to factory:ready, as it was before
 * factory start. Refused while the branch has an open PR (close it first) or a merged one (that's
 * plain clean). Returns each step's outcome.
 */
export async function abandon(root: string, number: number): Promise<string[]> {
  const job = requireJob(root, number)
  const prs = JSON.parse(
    await gh('pr', 'list', '--head', job.branch, '--state', 'all', '--json', 'url,state'),
  ) as { url: string; state: string }[]
  const open = prs.find((pr) => pr.state === 'OPEN')
  if (open) {
    throw new Refusal(`Job #${number} has an open PR, ${open.url}. Close it first, then abandon.`)
  }
  const merged = prs.find((pr) => pr.state === 'MERGED')
  if (merged) {
    throw new Refusal(
      `Job #${number}'s PR is merged, ${merged.url}: run factory clean ${number} without --abandon.`,
    )
  }
  // The last event of the job's log, before the log goes with its folder; factory watch shows it.
  record(root, number, 'job.abandoned', {
    from: job.state,
    branch: job.branch,
    worktree: job.worktree,
    closedPrs: prs.map((pr) => pr.url),
  })

  const done = [await downWorktreeStack(root, job.worktree)]

  if (existsSync(job.worktree)) {
    await git(root, 'worktree', 'remove', '--force', job.worktree)
    done.push(`Removed the worktree ${job.worktree}.`)
  }
  await git(root, 'worktree', 'prune')
  if (await exitsZero($`git -C ${root} show-ref --verify --quiet refs/heads/${job.branch}`)) {
    await git(root, 'branch', '-D', job.branch)
    done.push(`Deleted the branch ${job.branch}.`)
  }
  if (await git(root, 'ls-remote', '--heads', 'origin', job.branch)) {
    await git(root, 'push', '--quiet', 'origin', '--delete', job.branch)
    done.push(`Deleted the remote branch origin/${job.branch}.`)
  }

  rmSync(stateDir(root, number), { recursive: true, force: true })
  done.push(`Deleted the job's state, ${stateDir(root, number)}.`)

  await moveLabel(number, LABELS.ready)
  done.push(`Issue #${number} is back to ${LABELS.ready}.`)
  return done
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
