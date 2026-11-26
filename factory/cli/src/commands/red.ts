import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withChecksLock } from '../checks.ts'
import { canTryRed, jobDir, saveJob, type Job } from '../job.ts'
import { fromBunJUnit } from '../junit.ts'
import { isAcceptanceTest, ruleProtecting } from '../paths.ts'
import {
  readReport,
  redProblems,
  runOf,
  type Report,
  type Runner,
  type TestRun,
} from '../report.ts'
import { commitAll, runLogged, uncommitted } from '../shell.ts'
import { record, Refusal, requireJob } from './common.ts'

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

const reporter = (runner: 'vitest' | 'playwright') =>
  fileURLToPath(new URL(`../reporters/${runner}.ts`, import.meta.url))

/** Runs a group's files; Vitest and Playwright write our common report, bun writes JUnit. */
function command(runner: Runner, names: string[], report: string): string {
  const files = names.map(quote).join(' ')
  switch (runner) {
    case 'bun':
      return `bun test ${files} --reporter=junit --reporter-outfile=${quote(report)}`
    case 'vitest':
      return `bunx vitest run ${files} --reporter=${quote(reporter('vitest'))}`
    case 'playwright':
      return `bunx playwright test ${files} --reporter=${quote(reporter('playwright'))}`
  }
}

/** The group's report, or an empty one when the runner wrote none (it crashed before running). */
function readRun(runner: Runner, path: string): Report {
  if (!existsSync(path)) return { runner, files: [], tests: [] }
  const content = readFileSync(path, 'utf8')
  return runner === 'bun' ? fromBunJUnit(content) : readReport(content)
}

/**
 * Runs the new or changed acceptance tests and, when every one fails on an assertion, commits the
 * test agent's work as the red commit.
 */
export async function red(root: string, number: number): Promise<{ job: Job; problems: string[] }> {
  const job = requireJob(root, number)
  const allowed = canTryRed(job)
  if (!allowed.ok) throw new Refusal(allowed.reason)
  const changed = await uncommitted(job.worktree)
  const rules = changed.filter((path) => ruleProtecting(path) && !isAcceptanceTest(path))
  if (rules.length) {
    throw new Refusal(
      `The red may not change protected paths: ${rules.join(', ')}. Revert them; a change to the rules needs the user.`,
    )
  }
  const acceptance = changed.filter(
    (path) => isAcceptanceTest(path) && existsSync(join(job.worktree, path)),
  )
  if (acceptance.length === 0) {
    throw new Refusal(
      'No new or changed acceptance test (*.acceptance.test.ts(x) or apps/web/e2e/**).',
    )
  }

  const groups = new Map<string, TestRun[]>()
  for (const path of acceptance) {
    const run = runOf(path)
    const key = `${run.runner} ${run.cwd}`
    groups.set(key, [...(groups.get(key) ?? []), run])
  }

  const dir = join(jobDir(root, number), 'red')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const log = join(dir, `${stamp}.log`)

  const needs = (runner: Runner) => [...groups.values()].some((runs) => runs[0]?.runner === runner)

  const problems = await withChecksLock(
    root,
    number,
    async () => {
      const needsServices = needs('playwright') || acceptance.some((p) => p.startsWith('apps/api/'))
      if (needsServices) await runLogged('bun run services', job.worktree, log)
      if (needs('playwright')) {
        await runLogged('bun run --cwd apps/api db:migrate:test', job.worktree, log)
        await runLogged('bunx turbo run build --filter=@wandr/web', job.worktree, log)
      }
      const found: string[] = []
      let index = 0
      for (const runs of groups.values()) {
        const first = runs[0]
        if (!first) continue
        const report = join(
          dir,
          `${stamp}-${first.runner}-${index++}.${first.runner === 'bun' ? 'xml' : 'json'}`,
        )
        await runLogged(
          command(
            first.runner,
            runs.map((run) => run.reportName),
            report,
          ),
          join(job.worktree, first.cwd),
          log,
          { CI: '1', FACTORY_REPORT: report },
        )
        found.push(
          ...redProblems(
            readRun(first.runner, report),
            runs.map((run) => run.reportName),
          ),
        )
      }
      return found
    },
    (holder) => console.error(`Waiting for job #${holder}'s checks to finish…`),
  )

  if (problems.length) {
    const rejected = { ...job, redRejections: job.redRejections + 1 }
    saveJob(root, rejected)
    record(root, number, 'red.rejected', { files: acceptance, problems, log })
    return { job: rejected, problems }
  }
  const sha = await commitAll(
    job.worktree,
    `test(#${number}): add the acceptance tests for "${job.title}"\n\nFactory-Job: #${number}`,
  )
  const updated = { ...job, redCommit: sha, cliCommits: [...job.cliCommits, sha] }
  saveJob(root, updated)
  record(root, number, 'red.accepted', { sha, files: acceptance })
  return { job: updated, problems }
}
