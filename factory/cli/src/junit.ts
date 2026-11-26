// `bun test` has no custom-reporter API, only `--reporter=junit`, so its JUnit XML is converted
// into the common report (report.ts). Checked against bun test 1.4.5 (see junit-fixtures/).
// Vitest and Playwright write the common report themselves (reporters/).

import { XMLParser } from 'fast-xml-parser'
import type { Report } from './report.ts'

type XmlNode = Record<string, unknown>
const asArray = (value: unknown): XmlNode[] =>
  value === undefined ? [] : Array.isArray(value) ? (value as XmlNode[]) : [value as XmlNode]
const text = (value: unknown) => (typeof value === 'string' ? value : '')

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })

/**
 * Reads bun's JUnit XML. A failed assertion is `<failure type="AssertionError">`; a file that
 * fails to load is absent from the report, which `redProblems` rejects as a file with no tests.
 */
export function fromBunJUnit(xml: string): Report {
  const report: Report = { runner: 'bun', files: [], tests: [] }
  const files = new Set<string>()
  const visit = (suite: XmlNode) => {
    for (const node of asArray(suite.testcase)) {
      const file = text(node.file) || text(node.classname)
      files.add(file)
      const failure = asArray(node.failure)[0] ?? asArray(node.error)[0]
      const type = text(failure?.type)
      report.tests.push({
        file,
        name: text(node.name),
        status: node.skipped !== undefined ? 'skipped' : failure ? 'failed' : 'passed',
        ...(failure
          ? {
              failure: {
                kind: type === 'AssertionError' ? 'assertion' : 'error',
                type: type || 'Error',
                message: text(failure.message),
              },
            }
          : {}),
      })
    }
    asArray(suite.testsuite).forEach(visit)
  }
  asArray((parser.parse(xml) as XmlNode).testsuites).forEach(visit)
  report.files = [...files].map((path) => ({ path }))
  return report
}
