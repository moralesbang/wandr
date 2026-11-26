import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { jobDir, saveJob, type Job } from '../job.ts'
import { protectedFromBuild } from '../paths.ts'
import { git, lines, uncommitted } from '../shell.ts'
import { testChanges, type TestChanges } from '../test-changes.ts'
import { record, requireJob } from './common.ts'

export type GateResult = { passed: boolean; problems: string[]; tests: TestChanges; head: string }

/**
 * The independent gate before review: the last checks were green on exactly HEAD, nothing is left
 * uncommitted, and no commit the CLI didn't make touches a protected path.
 */
export async function gate(
  root: string,
  number: number,
): Promise<{ job: Job; result: GateResult }> {
  const job = requireJob(root, number)
  const cwd = job.worktree
  const head = await git(cwd, 'rev-parse', 'HEAD')
  const headTree = await git(cwd, 'rev-parse', 'HEAD^{tree}')
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

  const agentCommits = lines(await git(cwd, 'rev-list', `${job.base}..HEAD`)).filter(
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
    await git(cwd, 'diff', '--name-status', `${job.base}...HEAD`),
    await git(cwd, 'diff', '--unified=0', `${job.base}...HEAD`),
  )
  const result: GateResult = { passed: problems.length === 0, problems, tests, head }
  writeFileSync(join(jobDir(root, number), 'gate.json'), `${JSON.stringify(result, null, 2)}\n`)
  const updated: Job = {
    ...job,
    gate: { head, passed: result.passed, at: new Date().toISOString() },
  }
  saveJob(root, updated)
  record(root, number, result.passed ? 'gate.passed' : 'gate.rejected', { head, problems })
  return { job: updated, result }
}
