import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readReport, redProblems, runOf } from './junit.ts'

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, 'junit-fixtures', name), 'utf8')
const run = (runner: 'bun' | 'vitest' | 'playwright', reportName: string) => ({
  runner,
  cwd: '.',
  reportName,
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

describe('readReport', () => {
  test('reads the Playwright project of each case', () => {
    const projects = new Set(readReport(fixture('playwright.xml')).map((c) => c.project))
    expect(projects).toEqual(new Set(['chromium', 'webkit']))
  })
})

describe('redProblems: bun test', () => {
  const xml = fixture('bun-test.xml')
  const file = run('bun', 'src/zz-a.acceptance.test.ts')

  test('accepts a test that fails on an assertion', () => {
    const only = xml.replace(/<testcase name="throws"[\s\S]*?<\/testcase>/, '')
    const withoutPassing = only.replace(/<testcase name="passes"[^>]*\/>/, '')
    expect(redProblems('bun', withoutPassing, [file])).toEqual([])
  })

  test('rejects a test that fails with a thrown Error', () => {
    expect(redProblems('bun', xml, [file]).join('\n')).toContain(
      'throws: fails with Error, not an assertion',
    )
  })

  test('rejects a test that passes', () => {
    expect(redProblems('bun', xml, [file]).join('\n')).toContain(
      'passes: passes before any implementation',
    )
  })

  test('rejects a file missing from the report (it failed to load)', () => {
    const problems = redProblems('bun', xml, [run('bun', 'src/zz-missing.acceptance.test.ts')])
    expect(problems[0]).toContain('missing from the report')
  })
})

describe('redProblems: Vitest', () => {
  const xml = fixture('vitest.xml')

  test.each(['src/zz-b.acceptance.test.ts', 'src/zz-c.acceptance.test.ts'])(
    'rejects %s, whose load error is a testcase named after the file',
    (name) => {
      expect(redProblems('vitest', xml, [run('vitest', name)])[0]).toContain('failed to load')
    },
  )

  test('rejects a thrown Error and a passing test in the same file', () => {
    const problems = redProblems('vitest', xml, [run('vitest', 'src/zz-a.acceptance.test.ts')])
    expect(problems).toHaveLength(2)
  })
})

describe('redProblems: Playwright', () => {
  const xml = fixture('playwright.xml')
  const problems = redProblems('playwright', xml, [run('playwright', 'a.spec.ts')])

  test('accepts a failed expect() as an assertion', () => {
    expect(problems.join('\n')).not.toContain('› assertion')
    expect(problems.join('\n')).not.toContain('› visible')
  })

  test('rejects a TimeoutError from a click on a missing element', () => {
    expect(problems.join('\n')).toContain(
      'click missing: fails with TimeoutError, not an assertion',
    )
  })

  test('rejects a thrown Error', () => {
    expect(problems.join('\n')).toContain('throws: fails with Error, not an assertion')
  })

  test('rejects a passing test', () => {
    expect(problems.join('\n')).toContain('passes: passes before any implementation')
  })

  test('rejects an empty run (the file failed to load)', () => {
    const empty = redProblems('playwright', fixture('playwright-empty.xml'), [
      run('playwright', 'a.spec.ts'),
    ])
    expect(empty[0]).toContain('no test ran')
  })
})

describe('redProblems: skipped tests', () => {
  test('rejects a skipped test', () => {
    const xml = `<testsuites><testsuite name="s"><testcase name="later" classname="x.test.ts" file="x.test.ts"><skipped/></testcase></testsuite></testsuites>`
    expect(redProblems('bun', xml, [run('bun', 'x.test.ts')])[0]).toContain('skipped')
  })
})
