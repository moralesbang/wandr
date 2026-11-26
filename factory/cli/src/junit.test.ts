import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fromBunJUnit } from './junit.ts'
import { redProblems } from './report.ts'

const xml = readFileSync(join(import.meta.dir, 'junit-fixtures', 'bun-test.xml'), 'utf8')
const file = 'src/zz-a.acceptance.test.ts'
const problemsFor = (source: string, name = file) => redProblems(fromBunJUnit(source), [name])

describe('bun test report', () => {
  test('a failed assertion is read as an assertion', () => {
    const [first] = fromBunJUnit(xml).tests
    expect(first?.failure?.kind).toBe('assertion')
  })

  test('a thrown Error is read as an error, not an assertion', () => {
    expect(fromBunJUnit(xml).tests[1]?.failure).toMatchObject({ kind: 'error', type: 'Error' })
  })

  test('a passing test has no failure', () => {
    const passing = fromBunJUnit(xml).tests[2]
    expect([passing?.status, passing?.failure]).toEqual(['passed', undefined])
  })

  test('a skipped test is read as skipped', () => {
    const skipped = `<testsuites><testsuite name="s"><testcase name="later" classname="x.test.ts" file="x.test.ts"><skipped/></testcase></testsuite></testsuites>`
    expect(fromBunJUnit(skipped).tests[0]?.status).toBe('skipped')
  })
})

describe('the valid red on a bun test report', () => {
  const assertionOnly = xml
    .replace(/<testcase name="throws"[\s\S]*?<\/testcase>/, '')
    .replace(/<testcase name="passes"[^>]*\/>/, '')

  test('accepts a file whose only test fails on an assertion', () => {
    expect(problemsFor(assertionOnly)).toEqual([])
  })

  test('rejects a thrown Error', () => {
    expect(problemsFor(xml).join('\n')).toContain('throws: fails with Error, not an assertion')
  })

  test('rejects a passing test', () => {
    expect(problemsFor(xml).join('\n')).toContain('passes: passes before any implementation')
  })

  test('rejects a skipped test', () => {
    const skipped = `<testsuites><testsuite name="s"><testcase name="later" classname="x.test.ts" file="x.test.ts"><skipped/></testcase></testsuite></testsuites>`
    expect(problemsFor(skipped, 'x.test.ts')[0]).toContain('skipped')
  })

  test('rejects a file missing from the report, which is a load error', () => {
    expect(problemsFor(xml, 'src/zz-missing.acceptance.test.ts')[0]).toContain('no test ran')
  })
})
