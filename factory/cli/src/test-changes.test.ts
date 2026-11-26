import { describe, expect, test } from 'bun:test'
import { testChanges } from './test-changes.ts'

const FILE = 'packages/sharing/src/stretch.test.ts'
const diffOf = (...body: string[]) =>
  [`--- a/${FILE}`, `+++ b/${FILE}`, '@@ -1,3 +1,3 @@', ...body].join('\n')

describe('testChanges', () => {
  test('lists a deleted test file', () => {
    const changes = testChanges(`D\t${FILE}\nM\tapps/api/src/walks.ts`, '')
    expect(changes.removedFiles).toEqual([FILE])
  })

  test('lists a test file renamed away', () => {
    const changes = testChanges(`R100\t${FILE}\tpackages/sharing/src/other.test.ts`, '')
    expect(changes.removedFiles).toEqual([FILE])
  })

  test('does not list a deleted source file', () => {
    expect(testChanges('D\tapps/api/src/walks.ts', '').removedFiles).toEqual([])
  })

  test('lists a removed test by name', () => {
    const changes = testChanges('', diffOf("-  test('hides the photo', () => {", ' other'))
    expect(changes.removedTests).toEqual([{ file: FILE, name: 'hides the photo' }])
  })

  test('lists the tests of a file deleted with a /dev/null header', () => {
    const diff = [
      `--- a/${FILE}`,
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      "-test('first', () => {})",
      "-test('second', () => {})",
    ].join('\n')
    expect(testChanges('', diff).removedTests.map((t) => t.name)).toEqual(['first', 'second'])
  })

  test('lists an added skip', () => {
    const changes = testChanges('', diffOf("+  test.skip('later', () => {})"))
    expect(changes.skipped).toEqual([{ file: FILE, line: "test.skip('later', () => {})" }])
  })

  test('lists an added focus', () => {
    const changes = testChanges('', diffOf("+  it.only('just this', () => {})"))
    expect(changes.focused).toHaveLength(1)
  })

  test('ignores a skip written in a source file', () => {
    const diff = ['--- a/src/a.ts', '+++ b/src/a.ts', '@@', '+const x = test.skip'].join('\n')
    expect(testChanges('', diff).skipped).toEqual([])
  })

  test('reports nothing when a diff only adds ordinary tests', () => {
    const changes = testChanges('', diffOf("+test('new', () => {})"))
    expect(changes).toEqual({ removedFiles: [], removedTests: [], skipped: [], focused: [] })
  })
})
