// The local checks: the run steps of .github/workflows/ci.yml, read when they run so they can't
// drift from CI, under one machine-wide lock because every job shares the test database, the
// bucket and Playwright's port.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { jobsDir } from './job.ts'

export type Step = { job: string; name: string; run: string }

/** Steps CI needs and a developer machine doesn't, with the reason. */
const NOT_LOCAL: { pattern: RegExp; reason: string }[] = [
  { pattern: /playwright install/, reason: 'browsers are installed once per machine' },
  { pattern: /\$\{\{/, reason: 'it reads GitHub Actions expressions' },
]

type Workflow = { jobs: Record<string, { steps?: { name?: string; run?: string }[] }> }

/** Every `run` step of the workflow, in job order, each run once. */
export function ciSteps(workflowYaml: string): { steps: Step[]; skipped: Step[] } {
  const workflow = Bun.YAML.parse(workflowYaml) as Workflow
  const steps: Step[] = []
  const skipped: Step[] = []
  const seen = new Set<string>()
  for (const [job, { steps: jobSteps = [] }] of Object.entries(workflow.jobs)) {
    for (const { name, run } of jobSteps) {
      if (!run || seen.has(run)) continue
      seen.add(run)
      const step = { job, name: name ?? run.split('\n')[0] ?? run, run }
      if (NOT_LOCAL.some(({ pattern }) => pattern.test(run))) skipped.push(step)
      else steps.push(step)
    }
  }
  return { steps, skipped }
}

export const readCiSteps = (repo: string) =>
  ciSteps(readFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'utf8'))

/** GitHub Actions runs `run` scripts with bash -e and pipefail. */
export const shellOf = (run: string) =>
  `bash --noprofile --norc -eo pipefail -c ${JSON.stringify(run)}`

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Takes the checks lock for `job`, waiting while another live process holds it. A lock whose
 * holder died is taken over.
 */
export async function withChecksLock<T>(
  root: string,
  job: number,
  work: () => Promise<T>,
  onWait: (holder: number) => void = () => {},
): Promise<T> {
  const dir = join(jobsDir(root), 'checks.lock')
  const owner = join(dir, 'owner.json')
  mkdirSync(jobsDir(root), { recursive: true })
  let announced = false
  for (;;) {
    try {
      mkdirSync(dir)
      writeFileSync(owner, JSON.stringify({ pid: process.pid, job }))
      break
    } catch {
      const holder = existsSync(owner)
        ? (JSON.parse(readFileSync(owner, 'utf8')) as { pid: number; job: number })
        : null
      if (holder && !alive(holder.pid)) {
        rmSync(dir, { recursive: true, force: true })
        continue
      }
      if (holder && !announced) {
        onWait(holder.job)
        announced = true
      }
      await Bun.sleep(2000)
    }
  }
  try {
    return await work()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
