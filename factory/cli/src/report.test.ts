import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readReport, redProblems, runOf } from './report.ts'

const fixture = (name: string) =>
  readReport(readFileSync(join(import.meta.dir, 'report-fixtures', name), 'utf8'))
const only = (report: ReturnType<typeof fixture>, name: string) => ({
  ...report,
  tests: report.tests.filter((entry) => entry.name.endsWith(name)),
})

describe('runOf', () => {
  test('an e2e file runs with Playwright from apps/web, named relative to e2e', () => {
    expect(runOf('apps/web/e2e/demo.spec.ts')).toEqual({
      runner: 'playwright',
      cwd: 'apps/web',
      reportName: 'demo.spec.ts',
    })
  })

  test('a web source test runs with Vitest from apps/web', () => {
    expect(runOf('apps/web/src/features/walk/a.acceptance.test.ts')).toEqual({
      runner: 'vitest',
      cwd: 'apps/web',
      reportName: 'src/features/walk/a.acceptance.test.ts',
    })
  })

  test('a package or api test runs with bun test from its workspace', () => {
    expect(runOf('packages/sharing/src/stretch.acceptance.test.ts')).toEqual({
      runner: 'bun',
      cwd: 'packages/sharing',
      reportName: 'src/stretch.acceptance.test.ts',
    })
  })
})

describe('the valid red on a Vitest report', () => {
  const report = fixture('vitest.json')
  const a = 'src/zz-a.acceptance.test.ts'

  test('accepts a failed expect as an assertion', () => {
    expect(redProblems(only(report, 'fails on an assertion'), [a])).toEqual([])
  })

  test('rejects a thrown Error', () => {
    expect(redProblems(only(report, 'throws'), [a])[0]).toContain(
      'group > throws: fails with Error, not an assertion',
    )
  })

  test('rejects a passing test', () => {
    expect(redProblems(only(report, 'passes'), [a])[0]).toContain(
      'passes before any implementation',
    )
  })

  test('rejects a skipped test', () => {
    expect(redProblems(only(report, 'skipped'), [a])[0]).toContain('skipped')
  })

  test('rejects a file that failed to load, with the reason', () => {
    expect(redProblems(report, ['src/zz-c.acceptance.test.ts'])[0]).toContain(
      'failed to load: Failed to resolve import "./does-not-exist"',
    )
  })

  test('rejects a file absent from the report', () => {
    expect(redProblems(report, ['src/zz-missing.acceptance.test.ts'])[0]).toContain('no test ran')
  })
})

describe('the valid red on a Playwright report', () => {
  const report = fixture('playwright.json')
  const a = 'zz-a.spec.ts'

  test.each(['assertion', 'visible'])('accepts a failed expect (%s) in every project', (name) => {
    expect(redProblems(only(report, `› ${name}`), [a])).toEqual([])
  })

  test('rejects a timeout from a click on a missing element', () => {
    expect(redProblems(only(report, 'click missing'), [a])[0]).toContain(
      'click missing: fails with TimeoutError, not an assertion',
    )
  })

  test('rejects a thrown Error', () => {
    expect(redProblems(only(report, 'throws'), [a])[0]).toContain(
      'throws: fails with Error, not an assertion',
    )
  })

  test('rejects a passing test', () => {
    expect(redProblems(only(report, 'passes'), [a])[0]).toContain(
      'passes before any implementation',
    )
  })

  test('rejects a skipped test', () => {
    expect(redProblems(only(report, 'skipped'), [a])[0]).toContain('skipped')
  })

  test('rejects a file that failed to load, with the reason', () => {
    expect(redProblems(fixture('playwright-load-error.json'), ['zz-b.spec.ts'])[0]).toContain(
      'failed to load: SyntaxError',
    )
  })

  test('rejects a file with no tests in the run', () => {
    expect(redProblems(fixture('playwright-load-error.json'), [a])[0]).toContain('no test ran')
  })
})
