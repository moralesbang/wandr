import { requireRouted } from './route.ts'
import { $ } from 'bun'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  countAttempt,
  countRound,
  handoffDir,
  latestAnswer,
  listJobs,
  loadJob,
  reviewPass,
  saveJob,
  stateDir,
  type Job,
} from '../job.ts'
import { readEvents } from '../events.ts'
import { isAcceptanceTest } from '../paths.ts'
import { COPIED_WORDS, sharedPhrase } from '../phrases.ts'
import { removeSandboxes } from '../sandbox.ts'
import { refuseWhileSealed } from '../seal.ts'
import { commitAll, gh, git, uncommitted } from '../shell.ts'
import { LABELS, record, Refusal, refuseWhileBlocked, requireJob, withCliCommit } from './common.ts'
import { parseRuling, requireSameGuarantee, rulingFile } from './ruling.ts'
import { moveLabel } from './start.ts'

export function attempt(root: string, number: number): Job {
  const job = requireJob(root, number)
  refuseWhileBlocked(job, 'a build attempt')
  requireRouted(job, 'a build attempt')
  refuseWhileSealed(root, job, 'a build attempt')
  const counted = countAttempt(job)
  if (!counted.ok) throw new Refusal(counted.reason)
  saveJob(root, counted.job)
  record(root, number, 'attempt', { attempt: counted.job.attempts })
  return counted.job
}

export { sharedPhrase }

/**
 * Starts a new round with the pass's merged findings. Refused without them, and when they copy the
 * build notes: findings carry the reviewers' evidence, not the build's reasoning handed back.
 */
export function round(root: string, number: number): Job {
  const job = requireJob(root, number)
  refuseWhileBlocked(job, 'a new round')
  refuseWhileSealed(root, job, 'a new round')
  const pass = reviewPass(job)
  const findingsFile = join(handoffDir(job), 'reviews', `${pass}.findings.md`)
  if (!existsSync(findingsFile)) {
    throw new Refusal(`Write the merged findings of review pass ${pass} in ${findingsFile} first.`)
  }
  const notesFile = join(handoffDir(job), 'build-notes.md')
  const copied =
    existsSync(notesFile) &&
    sharedPhrase(readFileSync(findingsFile, 'utf8'), readFileSync(notesFile, 'utf8'), COPIED_WORDS)
  if (copied) {
    throw new Refusal(
      `reviews/${pass}.findings.md shares "${copied}" with build-notes.md. Write each finding in the reviewers' words, with their evidence (command, output, file:line), not the build notes'.`,
    )
  }
  const counted = countRound(job)
  if (!counted.ok) throw new Refusal(counted.reason)
  saveJob(root, counted.job)
  record(root, number, 'round', { round: counted.job.rounds })
  return counted.job
}

/** Commits what changed in the worktree, after checking that only acceptance tests did. */
async function commitAcceptanceChange(
  job: Job,
  what: string,
  message: string,
): Promise<{ sha: string; files: string[] }> {
  const changed = await uncommitted(job.worktree)
  if (changed.length === 0) throw new Refusal('Nothing changed.')
  const others = changed.filter((path) => !isAcceptanceTest(path))
  if (others.length) {
    throw new Refusal(`${what} changes only acceptance tests; these aren't: ${others.join(', ')}`)
  }
  return { sha: await commitAll(job.worktree, message), files: changed }
}

/**
 * What a commit says about the user's answer: its text for the body and the trailer that cites it.
 * Null when the latest Decision Request has no answer, or a commit already cited it: one answer
 * authorizes one rewrite or one acceptance-test fix.
 */
function citation(job: Job) {
  const answer = latestAnswer(job)
  if (!answer || answer.cited) return null
  return {
    answer,
    body: `The user answered Decision Request ${answer.request}:\n\n${answer.text}`,
    trailer: `Authorized-By: factory answer ${answer.at} (#${job.number}, Decision Request ${answer.request})`,
  }
}

const markCited = (job: Job): Job => ({
  ...job,
  answers: job.answers.map((answer) =>
    answer.request === job.decisionRequests.length ? { ...answer, cited: true } : answer,
  ),
})

const commitMessage = (
  subject: string,
  note: string,
  number: number,
  cited: ReturnType<typeof citation>,
) =>
  [
    subject,
    note,
    ...(cited ? [cited.body] : []),
    [`Factory-Job: #${number}`, ...(cited ? [cited.trailer] : [])].join('\n'),
  ].join('\n\n')

/**
 * Commits the test agent's fix to acceptance tests, and nothing else, on one of two grounds: a fresh
 * test reviewer's same-guarantee ruling on exactly this diff (`factory ruling`), or the user's
 * answer to a Decision Request raised on a changed-guarantee ruling (`factory block` records the
 * link), which the commit cites and uses up. An answer to any other request authorizes no fix.
 */
export async function atfix(
  root: string,
  number: number,
  note: string,
  options: { ruling?: number } = {},
): Promise<Job> {
  const job = requireJob(root, number)
  refuseWhileBlocked(job, 'an acceptance-test fix')
  refuseWhileSealed(root, job, 'an acceptance-test fix')
  if (!note.trim()) throw new Refusal('Say what the fix changes: factory atfix <n> --note "…"')
  const answered = options.ruling === undefined ? citation(job) : null
  const onRuling = answered && job.decisionRequests[answered.answer.request - 1]?.ruling
  const cited = onRuling ? answered : null
  if (options.ruling === undefined && !cited) {
    throw new Refusal(
      `An acceptance-test fix needs a ruling that it keeps the guarantee. Run factory ruling ${number}, launch a fresh factory-test-reviewer (task ruling) to write the file it names, then: factory atfix ${number} --ruling <m> --note "…". A changed guarantee goes to the user: factory block ${number} <file>; the user's answer to that request authorizes one atfix or rewrite.`,
    )
  }
  const ruled =
    options.ruling === undefined
      ? null
      : {
          ruling: options.ruling,
          diff: await requireSameGuarantee(job, options.ruling, readEvents(root, number)),
        }
  const subject = `test(#${number}): fix an acceptance test`
  const message = commitMessage(subject, note, number, cited)
  const { sha, files } = await commitAcceptanceChange(
    job,
    'An acceptance-test fix',
    ruled ? `${message}\nFactory-Ruling: ${ruled.ruling} (diff ${ruled.diff})` : message,
  )
  const updated: Job = {
    ...(cited ? markCited(job) : job),
    ...(await withCliCommit(job, sha)),
    atfixes: [...job.atfixes, { sha, note, files, ...(ruled ? { ruling: ruled.ruling } : {}) }],
  }
  saveJob(root, updated)
  record(root, number, 'atfix', { sha, note, files, ...(ruled ? { ruling: ruled.ruling } : {}) })
  return updated
}

/**
 * Commits the test agent's rewrite of acceptance tests after the user authorized a change of
 * guarantee by answering a Decision Request. The commit cites that answer; the note describes the
 * change.
 */
export async function rewrite(root: string, number: number, note: string): Promise<Job> {
  const job = requireJob(root, number)
  refuseWhileBlocked(job, 'a rewrite')
  refuseWhileSealed(root, job, 'a rewrite')
  const cited = citation(job)
  if (!cited) {
    throw new Refusal(
      job.decisionRequests.length === 0
        ? `Job #${number} has no Decision Request, so no guarantee change can be authorized. Raise one with factory block.`
        : latestAnswer(job)?.cited
          ? `The answer to Decision Request ${job.decisionRequests.length} of job #${number} already authorized a commit; one answer authorizes one rewrite or fix. Raise a new Decision Request with factory block.`
          : `Decision Request ${job.decisionRequests.length} of job #${number} has no answer, so no guarantee change is authorized. The user answers with: ! bun run factory answer ${number} "<answer>"`,
    )
  }
  if (!note.trim()) {
    throw new Refusal('Say what the rewrite changes: factory rewrite <n> --note "…"')
  }
  const { sha, files } = await commitAcceptanceChange(
    job,
    'An authorized rewrite',
    commitMessage(`test(#${number}): rewrite acceptance tests as authorized`, note, number, cited),
  )
  const updated: Job = {
    ...markCited(job),
    ...(await withCliCommit(job, sha)),
    rewrites: [...job.rewrites, { commit: sha, note, at: new Date().toISOString() }],
  }
  saveJob(root, updated)
  record(root, number, 'rewrite', { sha, note, files })
  return updated
}

/**
 * The changed-guarantee ruling a new Decision Request is raised on: the latest ruling, when it says
 * the fix changes the guarantee and no earlier request cites it yet.
 */
function changedRuling(job: Job): number | undefined {
  const latest = job.rulings.at(-1)
  if (!latest || job.decisionRequests.some((request) => request.ruling === latest.ruling)) {
    return undefined
  }
  const file = rulingFile(job, latest.ruling)
  if (!existsSync(file)) return undefined
  return parseRuling(readFileSync(file, 'utf8')).verdict === 'changed-guarantee'
    ? latest.ruling
    : undefined
}

/**
 * Keeps a Decision Request in the job's folder and blocks the job until the user answers with
 * `factory answer`. Nothing is posted on the issue: no one but the user may answer, so the request
 * goes to the terminal; the caller prints the returned text. A request raised on a
 * changed-guarantee ruling records which one.
 */
export async function block(
  root: string,
  number: number,
  file: string,
): Promise<{ job: Job; request: string }> {
  const job = requireJob(root, number)
  // A second request would leave the first one's answer pointing at the wrong question.
  refuseWhileBlocked(job, 'another Decision Request')
  // Kept in decision-requests/, the request would be sealed material the seal never recorded.
  refuseWhileSealed(root, job, 'a Decision Request')
  const dir = join(handoffDir(job), 'decision-requests')
  mkdirSync(dir, { recursive: true })
  const kept = join(dir, `${job.decisionRequests.length + 1}.md`)
  copyFileSync(file, kept)
  const at = new Date().toISOString()
  await moveLabel(number, LABELS.blocked)
  const ruling = changedRuling(job)
  const updated: Job = {
    ...job,
    state: 'blocked',
    decisionRequests: [...job.decisionRequests, { at, file: kept, ...(ruling ? { ruling } : {}) }],
  }
  saveJob(root, updated)
  record(root, number, 'blocked', { file: kept, ...(ruling ? { ruling } : {}) })
  return { job: updated, request: readFileSync(kept, 'utf8') }
}

export function status(root: string): string {
  const jobs = listJobs(root)
  if (jobs.length === 0) return 'No jobs.'
  return jobs
    .map(
      (job) =>
        `#${job.number}  ${job.state.padEnd(8)}  attempts ${job.attempts}/3  rounds ${job.rounds}/3  ${job.branch}${job.routing ? `  ${job.routing.workflow}/${job.routing.scope} (${job.routing.risk})` : job.routingRequired ? '  awaiting classification' : '  legacy standard'}${job.pr ? `  ${job.pr}` : ''}`,
    )
    .join('\n')
}

/** The compose project every checkout shares: `name:` in docker-compose.yml. */
const SHARED_COMPOSE_PROJECT = 'wandr'

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
  let job: Job | null = null
  try {
    job = loadJob(root, number)
  } catch (error) {
    return abandonUnreadable(root, number, error)
  }
  if (!job) return abandonUnreadable(root, number, 'there is no job.json')
  // Only the user runs clean (the guard denies it from any tool call), so a blocked job is theirs
  // to discard without answering first.
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
  // Before the worktree goes: a sandbox reads its service settings from it.
  done.push(...(await removeSandboxes(root, job)))

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
/**
 * What an abandon can still do for a job whose job.json doesn't parse (an unknown key from another
 * factory version, a half-written file): it needs only the job's number and its folder, and takes
 * the worktree path and the branch from whatever job.json still says, or from the checkout itself.
 * No schema validation, no PR check it can't make: each step runs on its own and the result says
 * what it removed and what it couldn't. Plain `clean` and every other command stay strict.
 */
async function abandonUnreadable(root: string, number: number, why: unknown): Promise<string[]> {
  const done: string[] = [
    `Job #${number}'s job.json can't be read (${String(why).split('\n')[0]}), so the abandon works from what is left.`,
  ]
  const couldnt: string[] = []
  const step = async (what: string, run: () => Promise<string | void>) => {
    try {
      const said = await run()
      if (said) done.push(said)
    } catch (error) {
      couldnt.push(`${what}: ${String(error).split('\n')[0]}`)
    }
  }
  let raw: { branch?: unknown; worktree?: unknown; state?: unknown } = {}
  try {
    raw = JSON.parse(readFileSync(join(stateDir(root, number), 'job.json'), 'utf8'))
  } catch {
    // Unparsable: fall back to the checkout.
  }
  const worktrees = join(root, '.claude', 'worktrees')
  const found = existsSync(worktrees)
    ? readdirSync(worktrees).find((name) => name.startsWith(`${number}-`))
    : undefined
  const worktree =
    typeof raw.worktree === 'string' ? raw.worktree : found ? join(worktrees, found) : null
  let branch = typeof raw.branch === 'string' ? raw.branch : null
  if (!branch && worktree && existsSync(worktree)) {
    await step('reading the branch', async () => {
      branch = await git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD')
    })
  }
  if (!existsSync(stateDir(root, number)) && !worktree) {
    throw new Refusal(`No job for issue #${number}: no state folder and no worktree to discard.`)
  }
  const label = branch as string | null
  if (label) {
    await step('checking the branch for a PR', async () => {
      const prs = JSON.parse(
        await gh('pr', 'list', '--head', label, '--state', 'all', '--json', 'url,state'),
      ) as { url: string; state: string }[]
      const open = prs.find((pr) => pr.state === 'OPEN' || pr.state === 'MERGED')
      if (open) {
        throw new Refusal(
          `Job #${number}'s branch has a ${open.state} PR, ${open.url}: close it by hand (or clean a merged one once job.json reads), then abandon.`,
        )
      }
    })
    if (couldnt.some((line) => line.includes('PR')))
      return [...done, ...couldnt.map((l) => `Stopped: ${l}`)]
  } else {
    couldnt.push('the PR check: no branch is known')
  }
  if (worktree) {
    await step('the compose stack', () => downWorktreeStack(root, worktree))
    await step('the sandboxes', async () => {
      const removed = await removeSandboxes(root, { number, worktree } as Job)
      return removed.length ? removed.join(' ') : 'No sandboxes.'
    })
    if (existsSync(worktree)) {
      await step('removing the worktree', async () => {
        await git(root, 'worktree', 'remove', '--force', worktree)
        return `Removed the worktree ${worktree}.`
      })
    } else {
      done.push(`The worktree ${worktree} is already gone.`)
    }
    await step('pruning worktrees', async () => {
      await git(root, 'worktree', 'prune')
    })
  } else {
    couldnt.push('the worktree: none is known and none matches')
  }
  if (label) {
    await step('deleting the local branch', async () => {
      if (await exitsZero($`git -C ${root} show-ref --verify --quiet refs/heads/${label}`)) {
        await git(root, 'branch', '-D', label)
        return `Deleted the branch ${label}.`
      }
    })
    await step('deleting the remote branch', async () => {
      if (await git(root, 'ls-remote', '--heads', 'origin', label)) {
        await git(root, 'push', '--quiet', 'origin', '--delete', label)
        return `Deleted the remote branch origin/${label}.`
      }
    })
  }
  await step("deleting the job's state", async () => {
    rmSync(stateDir(root, number), { recursive: true, force: true })
    return `Deleted the job's state, ${stateDir(root, number)}.`
  })
  await step('moving the label', async () => {
    await moveLabel(number, LABELS.ready)
    return `Issue #${number} is back to ${LABELS.ready}.`
  })
  return [...done, ...couldnt.map((line) => `Couldn't do ${line}`)]
}

export async function clean(root: string, number: number): Promise<void> {
  const job = requireJob(root, number)
  const state = job.pr
    ? (JSON.parse(await gh('pr', 'view', job.pr, '--json', 'state')) as { state: string }).state
    : 'NONE'
  if (state !== 'MERGED') throw new Refusal(`Job #${number}'s PR isn't merged (${state}).`)
  await removeSandboxes(root, job)
  await git(root, 'worktree', 'remove', '--force', job.worktree)
  await git(root, 'branch', '-D', job.branch)
  rmSync(stateDir(root, number), { recursive: true, force: true })
}
