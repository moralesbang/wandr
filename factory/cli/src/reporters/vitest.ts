// A Vitest reporter that writes the common report (../report.ts) to $FACTORY_REPORT. Run with
// `vitest run --reporter=<absolute path>`. It is self-contained: the runner loads it on its own.

import { writeFileSync } from 'node:fs'
import type { Reporter, TestModule } from 'vitest/node'
import type { Report } from '../report.ts'

type Test = Report['tests'][number]

function build(modules: ReadonlyArray<TestModule>): Report {
  const report: Report = { runner: 'vitest', files: [], tests: [] }
  for (const module of modules) {
    const file = module.relativeModuleId
    const loadError = module.errors()[0]
    report.files.push({ path: file, ...(loadError ? { loadError: loadError.message } : {}) })
    for (const test of module.children.allTests()) {
      const result = test.result()
      const status: Test['status'] =
        result.state === 'passed' ? 'passed' : result.state === 'failed' ? 'failed' : 'skipped'
      const error = result.state === 'failed' ? result.errors[0] : undefined
      report.tests.push({
        file,
        name: test.fullName,
        status,
        ...(error
          ? {
              failure: {
                // Vitest names the error of a failed `expect` AssertionError.
                kind: error.name === 'AssertionError' ? 'assertion' : 'error',
                type: error.name ?? 'Error',
                message: error.message,
              },
            }
          : {}),
      })
    }
  }
  return report
}

export default class FactoryReporter implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    const target = process.env.FACTORY_REPORT
    if (!target) throw new Error('FACTORY_REPORT is not set')
    writeFileSync(target, JSON.stringify(build(modules), null, 2))
  }
}
