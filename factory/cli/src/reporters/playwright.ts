// A Playwright reporter that writes the common report (../report.ts) to $FACTORY_REPORT. Run with
// `playwright test --reporter=<absolute path>`. It is self-contained: the runner loads it on its
// own.

import { writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import type {
  FullConfig,
  Reporter,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from '@playwright/test/reporter'
import type { Report } from '../report.ts'

type Test = Report['tests'][number]

const ESCAPES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const plain = (text: string) => text.replace(ESCAPES, '')

/** The failed `expect` step whose error is the one that ended the test, if there is one. */
function failedExpect(steps: readonly TestStep[], error: TestError): TestStep | undefined {
  for (const step of steps) {
    if (step.category === 'expect' && step.error && step.error.message === error.message)
      return step
    const inner = failedExpect(step.steps, error)
    if (inner) return inner
  }
  return undefined
}

function failureOf(result: TestResult, error: TestError): NonNullable<Test['failure']> {
  const message = plain(error.message ?? error.value ?? '')
  // A failed `expect` is a step in the `expect` category that carries the error that ended the test.
  const step = failedExpect(result.steps, error)
  if (step)
    return { kind: 'assertion', type: step.title.replace(/^Expect "(.*)"$/, 'expect.$1'), message }
  // The leading `Name:` of the message only labels the rejection; it does not decide anything.
  return { kind: 'error', type: /^(\w+): /.exec(message)?.[1] ?? 'Error', message }
}

export default class FactoryReporter implements Reporter {
  private root = process.cwd()
  private files = new Map<string, string | undefined>()
  private tests = new Map<string, Test>()

  onBegin(config: FullConfig): void {
    this.root = config.projects[0]?.testDir ?? process.cwd()
  }

  private nameOf(file: string): string {
    return relative(this.root, file)
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const file = this.nameOf(test.location.file)
    if (!this.files.has(file)) this.files.set(file, undefined)
    const error = result.errors[0]
    const status: Test['status'] =
      result.status === 'skipped' ? 'skipped' : result.status === 'passed' ? 'passed' : 'failed'
    // A retry replaces the earlier result of the same test.
    this.tests.set(test.id, {
      file,
      name: test.titlePath().slice(3).join(' › ') || test.title,
      project: test.parent.project()?.name,
      status,
      ...(status === 'failed' && error ? { failure: failureOf(result, error) } : {}),
    })
  }

  onError(error: TestError): void {
    const file = error.location?.file
    if (file) this.files.set(this.nameOf(file), plain(error.message ?? error.value ?? ''))
  }

  onEnd(): void {
    const target = process.env.FACTORY_REPORT
    if (!target) throw new Error('FACTORY_REPORT is not set')
    const report: Report = {
      runner: 'playwright',
      files: [...this.files].map(([path, loadError]) => ({
        path,
        ...(loadError !== undefined ? { loadError } : {}),
      })),
      tests: [...this.tests.values()],
    }
    writeFileSync(target, JSON.stringify(report, null, 2))
  }
}
