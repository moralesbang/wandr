// A job for tests: every field set, each overridable.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { realDocker } from './docker.ts'
import { appendEvent, eventsFromHook } from './events.ts'
import { handoffDir, loadJob, saveJob, type Job } from './job.ts'
import { fileHash } from './seal.ts'

export const makeJob = (overrides: Partial<Job> = {}): Job => ({
  number: 7,
  title: 'Add a thing',
  risk: 'normal',
  routingRequired: false,
  routing: null,
  routingHistory: [],
  routingRevision: 0,
  slug: 'add-a-thing',
  branch: 'factory/7-add-a-thing',
  worktree: '/repo/.claude/worktrees/7-add-a-thing',
  session: 'session-1',
  state: 'building',
  factoryFingerprint: null,
  base: 'abc1234',
  redCommit: null,
  cliCommits: [],
  cliPatches: {},
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
  blindPasses: {},
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

let runs = 0

/**
 * A file in the job's folder as a real run leaves it: the file itself, and the events the log hook
 * records when that run starts and writes it with the Write tool. `factory unseal`, `atfix` and
 * `pr` check the log for both. Each call is a new run.
 */
export function writeAsRun(
  root: string,
  number: number,
  agentType: string,
  rel: string,
  text: string,
  options: { id?: string; started?: boolean } = {},
): string {
  const job = loadJob(root, number)
  if (!job) throw new Error(`No job ${number} in ${root}`)
  const file = join(handoffDir(job), rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  const id = options.id ?? `${agentType.replace('factory-', '')}-run-${++runs}`
  const context = {
    job,
    handoffDir: handoffDir(job),
    now: new Date().toISOString(),
    readText: () => null,
  }
  const hook = (event: string, extra: object = {}) => ({
    session_id: job.session,
    hook_event_name: event,
    agent_id: id,
    agent_type: agentType,
    ...extra,
  })
  if (options.started !== false) {
    for (const event of eventsFromHook(hook('SubagentStart'), context)) appendEvent(root, event)
  }
  const write = hook('PostToolUse', {
    tool_name: 'Write',
    tool_input: { file_path: file, content: text },
  })
  for (const event of eventsFromHook(write, context)) appendEvent(root, event)
  return file
}

/** A reviewer's blind pass as a real run leaves it: see writeAsRun. */
export const writeBlindPass = (
  root: string,
  number: number,
  pass: number,
  role: string,
  text = 'blind\n',
) => writeAsRun(root, number, `factory-${role}`, `reviews/${pass}.${role}.blind.md`, text)

/** A reviewer's final report for a pass, written by its own run. */
export const writeReport = (
  root: string,
  number: number,
  pass: number,
  role: string,
  text = 'Verdict: approve\n',
) => writeAsRun(root, number, `factory-${role}`, `reviews/${pass}.${role}.md`, text)

/** A test reviewer's ruling file, written by a run that started after the ruling was asked for. */
export const writeRuling = (root: string, number: number, m: number, text: string) =>
  writeAsRun(root, number, 'factory-test-reviewer', `rulings/${m}.md`, text)

/** What `factory unseal` does to a blind pass that stands: records its hash in the job. */
export function freezeBlindPass(root: string, number: number, rel: string): void {
  const job = loadJob(root, number)
  if (!job) throw new Error(`No job ${number} in ${root}`)
  saveJob(root, {
    ...job,
    blindPasses: { ...job.blindPasses, [rel]: fileHash(join(handoffDir(job), rel)) },
  })
}

/** The preflight's Docker as a machine with a running daemon has it: `start` needs none in a test. */
export const withDocker = { docker: { ...realDocker(), run: async () => 0 } }

/** Pass 1 planned as a full review: a reviewer's sandbox budget comes from its plan. */
export const fullReviewPlan = (risk: 'low' | 'normal' | 'high' = 'normal') => ({
  pass: 1,
  head: 'h',
  since: null,
  changed: [],
  risk,
  routingRevision: 0,
  raisedBy: [],
  roles: { evaluator: 'review' as const, 'test-reviewer': 'review' as const },
  at: '2026-01-01T00:00:00Z',
})
