// The evidence the test reviewer gets: every test the branch removes, skips or focuses.

import { isTestFile } from './paths.ts'

export type TestChanges = {
  /** Test files deleted or renamed away. */
  removedFiles: string[]
  /** Test cases whose declaration line was removed (a rename shows as removed plus added). */
  removedTests: { file: string; name: string }[]
  skipped: { file: string; line: string }[]
  focused: { file: string; line: string }[]
}

const DECLARATION = /^\s*(?:test|it)(?:\.each\(.*?\))?\s*\(\s*(['"`])(.+?)\1/
const SKIP = /\b(?:test|it|describe)\.(?:skip|todo|skipIf)\b|\bx(?:it|test|describe)\s*\(/
const FOCUS = /\b(?:test|it|describe)\.only\b|\bf(?:it|describe)\s*\(/

/**
 * Reads `git diff --name-status` and a unified `git diff` (base...HEAD) and lists the test
 * changes a reviewer must judge.
 */
export function testChanges(nameStatus: string, diff: string): TestChanges {
  const removedFiles = nameStatus
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(
      ([status, path]) => path && (status === 'D' || status?.startsWith('R')) && isTestFile(path),
    )
    .map(([, path]) => path as string)

  const changes: TestChanges = { removedFiles, removedTests: [], skipped: [], focused: [] }
  let file = ''
  for (const line of diff.split('\n')) {
    // A deleted file's header is `--- a/<file>` then `+++ /dev/null`; a new one's the reverse.
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      const path = line.slice(4).replace(/^[ab]\//, '')
      if (path !== '/dev/null') file = path
      continue
    }
    if (!isTestFile(file)) continue
    if (line.startsWith('-')) {
      const declared = DECLARATION.exec(line.slice(1))
      if (declared) changes.removedTests.push({ file, name: declared[2] ?? '' })
    } else if (line.startsWith('+')) {
      const added = line.slice(1).trim()
      if (SKIP.test(added)) changes.skipped.push({ file, line: added })
      if (FOCUS.test(added)) changes.focused.push({ file, line: added })
    }
  }
  return changes
}
