// A job for tests: every field set, each overridable.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { appendEvent, eventsFromHook } from './events.ts'
import { handoffDir, loadJob, type Job } from './job.ts'

export const makeJob = (overrides: Partial<Job> = {}): Job => ({
  number: 7,
  title: 'Add a thing',
  risk: 'normal',
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
  rulings: [],
  rewrites: [],
  redRejections: 0,
  decisionRequests: [],
  answers: [],
  reviews: [],
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

/**
 * A reviewer's blind pass as a real run leaves it: the file in the job's folder, and the write the
 * log hook records when the role's own agent writes it with the Write tool (`factory unseal`
 * checks both).
 */
export function writeBlindPass(
  root: string,
  number: number,
  pass: number,
  role: string,
  text = 'blind\n',
): string {
  const job = loadJob(root, number)
  if (!job) throw new Error(`No job ${number} in ${root}`)
  const file = join(handoffDir(job), 'reviews', `${pass}.${role}.blind.md`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  const input = {
    session_id: job.session,
    hook_event_name: 'PostToolUse',
    agent_id: `${role}-run`,
    agent_type: `factory-${role}`,
    tool_name: 'Write',
    tool_input: { file_path: file, content: text },
  }
  const context = {
    job,
    handoffDir: handoffDir(job),
    now: new Date().toISOString(),
    readText: () => null,
  }
  for (const event of eventsFromHook(input, context)) appendEvent(root, event)
  return file
}
