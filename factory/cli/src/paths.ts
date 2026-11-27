// Which repo paths are acceptance tests and which define the rules a build is judged by.
// Paths are relative to the repo (or the job's worktree) root, with forward slashes.

import { isAbsolute, relative } from 'node:path'

/** Whether an absolute path is the folder itself or anything under it. */
export function isWithin(path: string, dir: string): boolean {
  const rel = relative(dir, path)
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
}

const match = (patterns: readonly string[], path: string) =>
  patterns.some((pattern) => new Bun.Glob(pattern).match(path))

export const ACCEPTANCE_TESTS = [
  '**/*.acceptance.test.ts',
  '**/*.acceptance.test.tsx',
  'apps/web/e2e/**',
] as const

/** The rows of "Protected paths" in factory/README.md, minus the acceptance tests. */
export const RULE_PATHS = [
  { what: 'CI', patterns: ['.github/workflows/**'] },
  {
    what: 'Lint and format',
    patterns: ['.oxlintrc.json', '.oxfmtrc.json', 'packages/oxlint-plugin-wandr/**'],
  },
  { what: 'TypeScript', patterns: ['packages/tsconfig/**', '**/tsconfig*.json'] },
  {
    what: 'Test runners and the task graph',
    patterns: ['apps/web/playwright.config.ts', 'bunfig.toml', 'turbo.json'],
  },
  {
    what: 'The rules and the factory',
    patterns: ['CLAUDE.md', 'knowledge/**', 'factory/**', '.claude/**'],
  },
] as const

/**
 * The privacy boundary: the code that decides what a walker's data looks like, who reaches it and
 * what leaves the server. A diff that touches it is never low risk.
 */
export const PRIVACY_BOUNDARY = [
  'packages/sharing/**',
  'packages/contract/**',
  'apps/api/src/db/**',
  'apps/api/src/routes/**',
  'apps/api/src/photos/**',
  'apps/api/src/http/cache-control.ts',
] as const

/** Files that change what runs or gets installed without looking like code: never low risk. */
export const TAMPER_PRONE = ['**/package.json', 'bun.lock', '**/vite.config.ts'] as const

export const isPrivacyBoundary = (path: string) => match(PRIVACY_BOUNDARY, path)
export const isTamperProne = (path: string) => match(TAMPER_PRONE, path)

/** Where every job keeps its files, relative to a checkout's root. Gitignored. */
export const JOBS_FOLDER = 'factory/.jobs'

/**
 * A job's folder, relative to a checkout's root. It exists twice: in the main checkout for the
 * job's state, and in the job's worktree for the files agents hand each other.
 */
export const jobFolder = (number: number) => `${JOBS_FOLDER}/${number}`

export function isAcceptanceTest(path: string): boolean {
  return match(ACCEPTANCE_TESTS, path)
}

/** What a rule path protects, or null when the path defines no rule. Acceptance tests aren't rule paths. */
export function ruleProtecting(path: string): string | null {
  return RULE_PATHS.find((rule) => match(rule.patterns, path))?.what ?? null
}

/** Why a build may not change this path, or null when it may. */
export function protectedFromBuild(path: string): string | null {
  return isAcceptanceTest(path) ? 'Acceptance tests' : ruleProtecting(path)
}

/** Any test file, of either kind. */
export function isTestFile(path: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(path) || isAcceptanceTest(path)
}
