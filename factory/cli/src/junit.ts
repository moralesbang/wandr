// The valid red: every new or changed acceptance test appears in its runner's JUnit report and
// fails on an assertion. What each runner writes was checked against bun test 1.4, Vitest 5 and
// Playwright 1.65 (see junit-fixtures/).

import { XMLParser } from 'fast-xml-parser'

export type Runner = 'bun' | 'vitest' | 'playwright'

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

type Outcome = { element: 'failure' | 'error'; type: string; message: string }
export type TestCase = {
  file: string
  name: string
  project?: string
  outcome?: Outcome
  skipped: boolean
}

type XmlNode = Record<string, unknown>
const asArray = (value: unknown): XmlNode[] =>
  value === undefined ? [] : Array.isArray(value) ? (value as XmlNode[]) : [value as XmlNode]
const text = (value: unknown) => (typeof value === 'string' ? value : '')

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })

export function readReport(xml: string): TestCase[] {
  const root = parser.parse(xml) as XmlNode
  const cases: TestCase[] = []
  const visit = (suite: XmlNode) => {
    for (const node of asArray(suite.testcase)) {
      const failure = asArray(node.failure)[0]
      const error = asArray(node.error)[0]
      const outcome: Outcome | undefined = failure
        ? { element: 'failure', type: text(failure.type), message: text(failure.message) }
        : error
          ? { element: 'error', type: text(error.type), message: text(error.message) }
          : undefined
      cases.push({
        file: text(node.file) || text(node.classname),
        name: text(node.name),
        project: text(suite.hostname) || undefined,
        outcome,
        skipped: node.skipped !== undefined,
      })
    }
    asArray(suite.testsuite).forEach(visit)
  }
  asArray(root.testsuites).forEach(visit)
  return cases
}

const firstLine = (message: string) => message.split('\n')[0]?.trim() ?? ''

const failsOnAssertion = (runner: Runner, outcome: Outcome) =>
  outcome.element === 'failure' &&
  (runner === 'playwright' ? outcome.type.startsWith('expect.') : outcome.type === 'AssertionError')

/**
 * Problems that reject the red for these files, all run by `runner` into one report. An empty
 * list accepts it.
 */
export function redProblems(runner: Runner, xml: string, files: readonly TestRun[]): string[] {
  const cases = readReport(xml)
  const problems = new Set<string>()
  for (const { reportName } of files) {
    const ofFile = cases.filter((testCase) => testCase.file === reportName)
    if (ofFile.length === 0) {
      problems.add(
        runner === 'playwright'
          ? `${reportName}: no test ran. The file failed to load or has no tests; run it to see why.`
          : `${reportName}: missing from the report. The file failed to load; run it to see why.`,
      )
      continue
    }
    for (const testCase of ofFile) {
      const label = `${reportName} › ${testCase.name}`
      if (runner === 'vitest' && testCase.name === reportName) {
        problems.add(`${reportName}: failed to load: ${firstLine(testCase.outcome?.message ?? '')}`)
      } else if (testCase.skipped) {
        problems.add(`${label}: skipped. Every acceptance test must run and fail.`)
      } else if (!testCase.outcome) {
        problems.add(`${label}: passes before any implementation. It guarantees nothing yet.`)
      } else if (!failsOnAssertion(runner, testCase.outcome)) {
        problems.add(
          `${label}: fails with ${testCase.outcome.type || testCase.outcome.element}, not an assertion: ${firstLine(testCase.outcome.message)}`,
        )
      }
    }
  }
  return [...problems]
}
