import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { handoffDir, saveJob, type Job } from '../job.ts'
import { protectedFromBuild } from '../paths.ts'
import { git, lines, uncommitted } from '../shell.ts'
import { testChanges, type TestChanges } from '../test-changes.ts'
import { record, requireJob } from './common.ts'

export type GateResult = { passed: boolean; problems: string[]; tests: TestChanges; head: string }

/**
 * The independent gate before review: the last checks were green on exactly HEAD, nothing is left
 * uncommitted, and no commit the CLI didn't make touches a protected path. Commits already on main
 * aren't the job's: a job that merges main doesn't answer for them.
 */
export async function gate(
  root: string,
  number: number,
): Promise<{ job: Job; result: GateResult }> {
  const job = requireJob(root, number)
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
    const files = lines(
      await git(cwd, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha),
    )
    for (const file of files) {
      const protection = protectedFromBuild(file)
      if (protection)
        problems.push(`${sha.slice(0, 7)} changes ${file} (${protection}), a protected path.`)
    }
  }

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
