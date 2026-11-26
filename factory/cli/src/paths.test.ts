import { describe, expect, test } from 'bun:test'
import { isAcceptanceTest, isTestFile, protectedFromBuild, RULE_PATHS } from './paths.ts'

const SAMPLE_PATHS: [string, string][] = [
  ['CI', '.github/workflows/ci.yml'],
  ['Lint and format', '.oxlintrc.json'],
  ['Lint and format', '.oxfmtrc.json'],
  ['Lint and format', 'packages/oxlint-plugin-wandr/src/index.ts'],
  ['TypeScript', 'packages/tsconfig/base.json'],
  ['TypeScript', 'apps/api/tsconfig.json'],
  ['TypeScript', 'tsconfig.json'],
  ['Test runners and the task graph', 'apps/web/playwright.config.ts'],
  ['Test runners and the task graph', 'bunfig.toml'],
  ['Test runners and the task graph', 'turbo.json'],
  ['The rules and the factory', 'CLAUDE.md'],
  ['The rules and the factory', 'knowledge/standards/testing.md'],
  ['The rules and the factory', 'factory/cli/src/main.ts'],
  ['The rules and the factory', '.claude/agents/factory-build.md'],
  ['Acceptance tests', 'packages/sharing/src/stretch.acceptance.test.ts'],
  ['Acceptance tests', 'apps/web/src/features/walk/map.acceptance.test.tsx'],
  ['Acceptance tests', 'apps/web/e2e/demo.spec.ts'],
]

describe('protectedFromBuild', () => {
  test.each(SAMPLE_PATHS)('protects %s: %s', (label, path) => {
    expect(protectedFromBuild(path)).toBe(label)
  })

  test('every row of the protected-paths table has a sample above', () => {
    const covered = new Set(SAMPLE_PATHS.map(([label]) => label))
    expect(RULE_PATHS.filter((rule) => !covered.has(rule.what))).toEqual([])
  })

  test.each([
    'apps/api/src/app.ts',
    'apps/web/src/features/walk/resolve-gesture.ts',
    'packages/sharing/src/stretch.test.ts',
    'docs/05-architecture.md',
  ])('lets a build change the normal file %s', (path) => {
    expect(protectedFromBuild(path)).toBeNull()
  })
})

describe('isAcceptanceTest', () => {
  test('a .acceptance.test.ts file is an acceptance test', () => {
    expect(isAcceptanceTest('apps/api/src/walks.acceptance.test.ts')).toBe(true)
  })

  test('a plain .test.ts file is not', () => {
    expect(isAcceptanceTest('apps/api/src/walks.test.ts')).toBe(false)
  })

  test('everything under apps/web/e2e is', () => {
    expect(isAcceptanceTest('apps/web/e2e/support/login.ts')).toBe(true)
  })
})

describe('isTestFile', () => {
  test.each([
    'a/b.test.ts',
    'a/b.test.tsx',
    'a/b.spec.ts',
    'a/b.acceptance.test.ts',
    'apps/web/e2e/helpers.ts',
  ])('%s is a test file', (path) => {
    expect(isTestFile(path)).toBe(true)
  })

  test('a source file is not', () => {
    expect(isTestFile('a/b.ts')).toBe(false)
  })
})
