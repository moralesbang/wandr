// Which repo paths are acceptance tests and which define the rules a build is judged by.
// Paths are relative to the repo (or the job's worktree) root, with forward slashes.

import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** Whether an absolute path is the folder itself or anything under it. */
export function isWithin(path: string, dir: string): boolean {
  const rel = relative(dir, path)
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
}

/**
 * The path the file system would reach, every symlink resolved: what the guard judges, so a link
 * in the worktree to `/` or to the main checkout reaches nothing the target itself wouldn't.
 * Components are followed one by one, `..` after a link included, as the kernel does; from the
 * first one that doesn't exist yet, the rest is appended as written.
 */
export function canonical(path: string, cwd = '/'): string {
  const absolute = isAbsolute(path) ? path : `${cwd}/${path}`
  try {
    return realpathSync(absolute)
  } catch {
    // Some component doesn't exist yet, or isn't a folder: walk it.
  }
  const parts = absolute.split('/').filter((part) => part && part !== '.')
  let real = '/'
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part === '..') {
      real = dirname(real)
      continue
    }
    const next = join(real, part)
    try {
      real = realpathSync(next)
    } catch {
      return resolve(next, ...parts.slice(i + 1))
    }
  }
  return real
}

const match = (patterns: readonly string[], path: string) =>
  patterns.some((pattern) => new Bun.Glob(pattern).match(path))

const ACCEPTANCE_TESTS = [
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
 * The files that define how a job runs, in the main checkout: the CLI, the orchestrator's skill,
 * the agents, the hooks and the root scripts the CLI runs through (`bun run factory`, the install
 * and the checks). The job state under `factory/.jobs/` is not one. While a job is active they are
 * frozen (freeze.ts): a change under a running job would change how the job is judged.
 */
export const FACTORY_FILES = [
  'factory/cli/**',
  '.claude/skills/factory/**',
  '.claude/agents/factory-*.md',
  '.claude/settings.json',
  'package.json',
  'bun.lock',
] as const

/**
 * The folders and files FACTORY_FILES live in, for a write that takes a whole folder (`rm -rf`,
 * `mv`) with a factory file below it.
 */
export const FACTORY_ROOTS = [
  'factory/cli',
  '.claude/skills/factory',
  '.claude/agents',
  '.claude/settings.json',
  'package.json',
  'bun.lock',
] as const

/** Whether a repo-relative path is one of FACTORY_FILES (an installed dependency is not). */
export const isFactoryFile = (path: string): boolean =>
  !path.split('/').includes('node_modules') && match(FACTORY_FILES, path)

/**
 * The folders the protected paths live in, for a write to a folder that holds them (`rm -rf`,
 * `mv`, `tar x`, a copy into one): each has a protected path directly under it. The acceptance
 * tests beside their code (`*.acceptance.test.ts`) are not listed: only the gate sees those.
 */
export const PROTECTED_DIRS = [
  'apps/web/e2e',
  '.github/workflows',
  'packages/tsconfig',
  'packages/oxlint-plugin-wandr',
  'knowledge',
  'factory',
  '.claude',
] as const

/**
 * The privacy boundary: the code that decides what a walker's data looks like, who reaches it and
 * what leaves the server. A diff that touches it is never low risk.
 */
const PRIVACY_BOUNDARY = [
  'packages/sharing/**',
  'packages/contract/**',
  'apps/api/src/db/**',
  'apps/api/src/routes/**',
  'apps/api/src/photos/**',
  'apps/api/src/http/cache-control.ts',
] as const

/** Files that change what runs or gets installed without looking like code: never low risk. */
const TAMPER_PRONE = ['**/package.json', 'bun.lock', '**/vite.config.ts'] as const

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

/** The text of a TypeScript config: `compilerOptions`, or an `extends` naming a tsconfig. */
const TS_CONFIG_TEXT = /"compilerOptions"|"extends"\s*:\s*"[^"]*tsconfig[^"]*"/

/**
 * Whether text written to a path makes it a TypeScript config whatever its name: a `.json` file
 * with that content, which `tsc -p` would take as a project. The protection is by what it is.
 */
export function isTsConfigText(path: string, text: string): boolean {
  return path.endsWith('.json') && TS_CONFIG_TEXT.test(text)
}

/** The denial of a write of a TypeScript config by its content, in the style of a protected path's. */
export function tsConfigDenial(agent: string, path: string): string {
  return `${path} is protected (TypeScript): its content is a TypeScript config, whatever the file is named. ${agent === 'factory-build' ? 'Stop and escalate to the orchestrator' : 'Raise it with the orchestrator'} instead of changing it.`
}

/**
 * Whether a path is a TypeScript config the protected paths cover by name: `tsconfig*.json`, or
 * anything under `packages/tsconfig`.
 */
export function isProtectedTsConfig(path: string): boolean {
  return /(?:^|\/)tsconfig[^/]*\.json$/.test(path) || /(?:^|\/)packages\/tsconfig\//.test(path)
}

/** Any test file, of either kind. */
export function isTestFile(path: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(path) || isAcceptanceTest(path)
}
