// A job for tests: every field set, each overridable.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Job } from './job.ts'

export const makeJob = (overrides: Partial<Job> = {}): Job => ({
  number: 7,
  title: 'Add a thing',
  slug: 'add-a-thing',
  branch: 'factory/7-add-a-thing',
  worktree: '/repo/.claude/worktrees/7-add-a-thing',
  session: 'session-1',
  state: 'building',
  base: 'abc1234',
  redCommit: null,
  cliCommits: [],
  attempts: 0,
  rounds: 0,
  lastCheck: null,
  gate: { head: 'deadbeefcafe', passed: true, at: '2026-01-01T00:00:00Z' },
  atfixes: [],
  rewrites: [],
  redRejections: 0,
  decisionRequests: [],
  answers: [],
  pr: null,
  startedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

/**
 * Puts a fake `gh` first on PATH that logs every call to `<dir>/calls.log` and prints nothing, so a
 * test can assert what the CLI sent to GitHub. `restore` puts PATH back.
 */
export function installFakeGh(dir: string) {
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const calls = join(dir, 'calls.log')
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "gh $*" >> "${calls}"\n`)
  chmodSync(join(bin, 'gh'), 0o755)
  const path = process.env.PATH
  process.env.PATH = `${bin}:${path}`
  return {
    calls: () => (existsSync(calls) ? readFileSync(calls, 'utf8') : ''),
    restore: () => {
      process.env.PATH = path
    },
  }
}
