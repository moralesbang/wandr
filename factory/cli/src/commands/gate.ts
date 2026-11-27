import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { handoffDir, saveJob, type Job } from '../job.ts'
import { protectedFromBuild } from '../paths.ts'
import { git, lines, uncommitted } from '../shell.ts'
import { testChanges, type TestChanges } from '../test-changes.ts'
import { record, refuseWhileBlocked, requireJob } from './common.ts'

export type GateResult = { passed: boolean; problems: string[]; tests: TestChanges; head: string }

/**
 * The trailers a build commit may carry: attribution and references, each one short line. Anything
 * else under the subject is a body, and a `Note: …` line is a body dressed as a trailer.
 */
const TRAILER =
  /^(?:Co-Authored-By|Signed-off-by|Claude-Session|Factory-Job|Refs|Closes|Fixes): \S.{0,150}$/i

/**
 * What a commit message says beyond its subject and its trailers. The build agent's reasoning
 * reaches the reviewers only through build-notes.md, which is sealed during their blind passes; a
 * body would carry it past the seal in `git log`.
 */
export function bodyBeyondTrailers(message: string): string {
  const [, ...rest] = message.trim().split('\n')
  return rest
    .filter((line) => line.trim() && !TRAILER.test(line.trim()))
    .join('\n')
    .trim()
}

/**
 * Empties the reflogs of HEAD and the job's branch: a commit message body amended away after the
 * gate rejected it stays readable there (`git reflog`, `git log -g`), past the seal. Only these two
 * refs, so the other jobs' branches and the reviewers' sandboxes (linked worktrees with their own
 * HEAD) keep their reflogs. The amended-away commit's object stays until git collects it, but no
 * ref names it any more.
 */
async function forgetReflogs(cwd: string, branch: string): Promise<void> {
  for (const ref of ['HEAD', `refs/heads/${branch}`]) {
    try {
      await git(cwd, 'reflog', 'expire', '--expire=now', '--expire-unreachable=now', ref)
    } catch {
      // A reflog that can't be expired is no reason to reject the gate; the next run tries again.
    }
  }
}

/**
 * The independent gate before review: the last checks were green on exactly HEAD, nothing is left
 * uncommitted, and no commit the CLI didn't make is a merge, touches a protected path or has a message body. Commits already on main
 * aren't the job's: a job that merges main doesn't answer for them.
 */
export async function gate(
  root: string,
  number: number,
): Promise<{ job: Job; result: GateResult }> {
  const job = requireJob(root, number)
  refuseWhileBlocked(job, 'the gate')
  const cwd = job.worktree
  const head = await git(cwd, 'rev-parse', 'HEAD')
  const headTree = await git(cwd, 'rev-parse', 'HEAD^{tree}')
  // Fetched now rather than read from the local ref, which a Bash command could move.
  await git(cwd, 'fetch', '--quiet', 'origin', 'main')
  const main = await git(cwd, 'rev-parse', 'FETCH_HEAD')
  const problems: string[] = []

  if (!job.redCommit) problems.push('There is no red commit yet. Run factory red first.')
  const dirty = await uncommitted(cwd)
  if (dirty.length)
    problems.push(`Uncommitted changes: ${dirty.join(', ')}. Commit or revert them.`)
  if (!job.lastCheck) {
    problems.push('The checks never ran. Run factory check.')
  } else if (!job.lastCheck.green) {
    problems.push(
      `The last checks failed at "${job.lastCheck.failedStep}". See ${job.lastCheck.log}`,
    )
  } else if (job.lastCheck.tree !== headTree) {
    problems.push('The last green checks ran on other code than HEAD. Run factory check again.')
  }

  const agentCommits = lines(await git(cwd, 'rev-list', 'HEAD', `^${job.base}`, `^${main}`)).filter(
    (sha) => !job.cliCommits.includes(sha),
  )
  for (const sha of agentCommits) {
    const parents = lines(await git(cwd, 'rev-list', '--parents', '-n', '1', sha)).flatMap((line) =>
      line.split(' ').slice(1),
    )
    if (parents.length > 1) {
      problems.push(
        `${sha.slice(0, 7)} is a merge commit. An agent's merge hides its changes from the gate (a merge's own diff is empty): rebase onto main (\`git rebase main\`) and keep the history linear.`,
      )
      continue
    }
    if (bodyBeyondTrailers(await git(cwd, 'log', '-1', '--format=%B', sha))) {
      problems.push(
        `${sha.slice(0, 7)} has a commit message body. A build commit is a subject line and its trailers only: the reasons go in build-notes.md. Reword it: \`git commit --amend\` for the last commit, or \`git reset --soft\` to before it and commit again.`,
      )
    }
    // Against its first parent: what the commit itself changed.
    const files = lines(
      parents.length
        ? await git(cwd, 'diff', '--name-only', '--no-renames', `${sha}^1`, sha)
        : await git(cwd, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha),
    )
    for (const file of files) {
      const protection = protectedFromBuild(file)
      if (protection)
        problems.push(`${sha.slice(0, 7)} changes ${file} (${protection}), a protected path.`)
    }
  }

  const notes = lines(await git(cwd, 'for-each-ref', '--format=%(refname)', 'refs/notes/'))
  if (notes.length) {
    problems.push(
      `${notes.join(', ')} holds git notes: a note rides along with \`git log --show-notes\` past the seal, and an agent keeps its reasoning in build-notes.md. Delete it: \`git update-ref -d ${notes[0]}\`.`,
    )
  }
  await forgetReflogs(cwd, job.branch)

  const tests = testChanges(
    await git(cwd, 'diff', '--name-status', `${main}...HEAD`),
    await git(cwd, 'diff', '--unified=0', `${main}...HEAD`),
  )
  const result: GateResult = { passed: problems.length === 0, problems, tests, head }
  // The reviewers read the gate's test changes from the handoff folder.
  mkdirSync(handoffDir(job), { recursive: true })
  writeFileSync(join(handoffDir(job), 'gate.json'), `${JSON.stringify(result, null, 2)}\n`)
  const updated: Job = {
    ...job,
    gate: { head, passed: result.passed, at: new Date().toISOString() },
  }
  saveJob(root, updated)
  record(root, number, result.passed ? 'gate.passed' : 'gate.rejected', { head, problems })
  return { job: updated, result }
}
