// The shape every runner's result is reduced to before the valid red is judged. Vitest and
// Playwright write it through our own reporters (reporters/); `bun test` has no reporter API, so
// junit.ts converts its JUnit XML into the same shape.

import { z } from 'zod'

export const runnerSchema = z.enum(['bun', 'vitest', 'playwright'])
export type Runner = z.infer<typeof runnerSchema>

const failureSchema = z.object({
  /** `assertion` when a failed expectation ended the test; `error` for anything else. */
  kind: z.enum(['assertion', 'error']),
  /** The error's name or the matcher that failed, for the rejection message. */
  type: z.string(),
  message: z.string(),
})

export const reportSchema = z.object({
  runner: runnerSchema,
  /** The files the runner loaded, or tried to; paths are relative to the runner's test root. */
  files: z.array(z.object({ path: z.string(), loadError: z.string().optional() })),
  tests: z.array(
    z.object({
      file: z.string(),
      name: z.string(),
      project: z.string().optional(),
      status: z.enum(['passed', 'failed', 'skipped']),
      failure: failureSchema.optional(),
    }),
  ),
})
export type Report = z.infer<typeof reportSchema>

export const readReport = (json: string): Report => reportSchema.parse(JSON.parse(json))

/** Where a test file runs: its runner, the directory it runs from, and its name in the report. */
export type TestRun = { runner: Runner; cwd: string; reportName: string }

export function runOf(repoPath: string): TestRun {
  if (repoPath.startsWith('apps/web/e2e/')) {
    return {
      runner: 'playwright',
      cwd: 'apps/web',
      reportName: repoPath.slice('apps/web/e2e/'.length),
    }
  }
  if (repoPath.startsWith('apps/web/')) {
    return { runner: 'vitest', cwd: 'apps/web', reportName: repoPath.slice('apps/web/'.length) }
  }
  const [top, name] = repoPath.split('/')
  const cwd = `${top}/${name}`
  return { runner: 'bun', cwd, reportName: repoPath.slice(cwd.length + 1) }
}

const firstLine = (message: string) => message.split('\n')[0]?.trim() ?? ''

/**
 * Problems that reject the red for these files. A file is accepted when it loaded, ran at least
 * one test and every test failed on an assertion. An empty list accepts the red.
 */
export function redProblems(report: Report, files: readonly string[]): string[] {
  const problems = new Set<string>()
  for (const file of files) {
    const loadError = report.files.find((entry) => entry.path === file)?.loadError
    if (loadError !== undefined) {
      problems.add(`${file}: failed to load: ${firstLine(loadError)}`)
      continue
    }
    const tests = report.tests.filter((test) => test.file === file)
    if (tests.length === 0) {
      problems.add(
        `${file}: no test ran. The file is missing from the report, failed to load or has no tests; run it to see why.`,
      )
      continue
    }
    for (const test of tests) {
      const label = `${file} › ${test.name}`
      if (test.status === 'skipped') {
        problems.add(`${label}: skipped. Every acceptance test must run and fail.`)
      } else if (test.status === 'passed' || !test.failure) {
        problems.add(`${label}: passes before any implementation. It guarantees nothing yet.`)
      } else if (test.failure.kind !== 'assertion') {
        problems.add(
          `${label}: fails with ${test.failure.type}, not an assertion: ${firstLine(test.failure.message)}`,
        )
      }
    }
  }
  return [...problems]
}
