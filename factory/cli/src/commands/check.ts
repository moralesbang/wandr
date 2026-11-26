import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readCiSteps, shellOf, withChecksLock } from '../checks.ts'
import { jobDir, saveJob, type Job } from '../job.ts'
import { runLogged, workingTree } from '../shell.ts'
import { record, requireJob } from './common.ts'

/** Runs CI's steps in the job's worktree, in order, stopping at the first that fails. */
export async function check(root: string, number: number): Promise<Job> {
  const job = requireJob(root, number)
  const dir = join(jobDir(root, number), 'checks')
  mkdirSync(dir, { recursive: true })
  const log = join(dir, `${new Date().toISOString().replaceAll(':', '-')}.log`)
  const { steps, skipped } = readCiSteps(job.worktree)
  writeFileSync(
    log,
    `Local CI checks for job #${number}\nSkipped here: ${skipped.map((s) => `"${s.name}"`).join(', ') || 'none'}\n`,
  )

  return withChecksLock(
    root,
    number,
    async () => {
      record(root, number, 'checks.started', { log })
      const tree = await workingTree(job.worktree)
      let failedStep: string | null = null
      for (const step of steps) {
        writeFileSync(log, `\n=== ${step.job} › ${step.name}\n`, { flag: 'a' })
        const code = await runLogged(shellOf(step.run), job.worktree, log, { CI: '1' })
        if (code !== 0) {
          failedStep = step.name
          writeFileSync(log, `\n=== FAILED (exit ${code}): ${step.name}\n`, { flag: 'a' })
          break
        }
      }
      const green = failedStep === null
      const updated: Job = {
        ...job,
        lastCheck: { tree, green, failedStep, at: new Date().toISOString(), log },
      }
      saveJob(root, updated)
      record(root, number, green ? 'checks.passed' : 'checks.failed', { failedStep, log })
      return updated
    },
    (holder) => console.error(`Waiting for job #${holder}'s checks to finish…`),
  )
}
