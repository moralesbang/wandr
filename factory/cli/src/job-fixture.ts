// A job for tests: every field set, each overridable.

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
  pr: null,
  startedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})
