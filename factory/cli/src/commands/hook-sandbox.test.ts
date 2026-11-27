// Each reviewer probes the build by mutating its own disposable checkout, inside the job's folder.
// The guard must let it write there, so it never falls back to Bash, and must keep it out of the
// other reviewer's sandbox, so one reviewer's mutation never reaches the other's evidence.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { readEvents } from '../events.ts'
import { makeJob } from '../job-fixture.ts'
import { saveJob } from '../job.ts'
import { hookGuard } from './hook.ts'

let root = ''
let worktree = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-guard-sandbox-'))
  worktree = join(root, '.claude', 'worktrees', '7-add-a-thing')
  saveJob(root, makeJob({ worktree, session: 'job-session' }))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const sandbox = (role: string, file: string) =>
  join(worktree, 'factory', '.jobs', '7', 'sandbox', role, file)

const guard = (agent: string, tool: string, path: string) =>
  hookGuard(
    root,
    JSON.stringify({
      session_id: 'job-session',
      hook_event_name: 'PreToolUse',
      agent_id: 'run-1',
      agent_type: agent,
      tool_name: tool,
      tool_input: { file_path: path },
    }),
  )

const denied = (output: string) =>
  (JSON.parse(output) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput
    .permissionDecision === 'deny'

describe('hook guard: reviewer sandboxes', () => {
  test.each([
    ['factory-evaluator', 'evaluator', 'Edit', 'apps/web/public/manifest.webmanifest'],
    ['factory-evaluator', 'evaluator', 'Write', 'probe.mjs'],
    ['factory-test-reviewer', 'test-reviewer', 'Write', '.mut/apps/web/dist/index.html'],
    ['factory-test-reviewer', 'test-reviewer', 'Edit', 'apps/api/src/app.ts'],
  ])('lets %s write in its own sandbox (%s): %s %s', (agent, role, tool, file) => {
    expect(guard(agent, tool, sandbox(role, file))).toBe('')
    expect(readEvents(root, 7).filter((event) => event.kind === 'write.denied')).toEqual([])
  })

  test.each([
    ['factory-evaluator', 'test-reviewer'],
    ['factory-test-reviewer', 'evaluator'],
  ])("denies %s writing in the %s's sandbox, and logs it", (agent, other) => {
    expect(
      denied(guard(agent, 'Write', sandbox(other, 'apps/web/public/manifest.webmanifest'))),
    ).toBe(true)
    expect(readEvents(root, 7).map((event) => event.kind)).toEqual(['write.denied'])
  })

  test("denies the build agent writing in a reviewer's sandbox", () => {
    expect(
      denied(guard('factory-build', 'Edit', sandbox('evaluator', 'apps/api/src/app.ts'))),
    ).toBe(true)
  })

  test('still denies a reviewer writing in the job worktree itself', () => {
    expect(denied(guard('factory-evaluator', 'Edit', join(worktree, 'apps/api/src/app.ts')))).toBe(
      true,
    )
  })
})

const bash = (agent: string, command: string) => {
  const out = hookGuard(
    root,
    JSON.stringify({
      session_id: 'job-session',
      hook_event_name: 'PreToolUse',
      agent_id: 'run-1',
      agent_type: agent,
      tool_name: 'Bash',
      cwd: worktree,
      tool_input: { command },
    }),
  )
  return out === '' ? 'allow' : 'deny'
}

const read = (agent: string, path: string) => (guard(agent, 'Read', path) === '' ? 'allow' : 'deny')

// One reviewer's mutations are its evidence: the other may neither run nor touch its sandbox, nor
// reach its database or bucket by name.
describe("hook guard: the other reviewer's sandbox", () => {
  test.each([
    'bun run factory sandbox rm 7 test-reviewer',
    'bun run factory sandbox 7 test-reviewer',
    "bun run factory sandbox exec 7 test-reviewer -- sh -c 'rm -rf apps'",
    'bun run factory sandbox exec 7 Test-Reviewer -- bun test',
    'cat SANDBOX/apps/api/.env.test',
    'echo bug >> SANDBOX/apps/web/src/main.ts',
    'cd SANDBOX && bun test',
    "psql postgres://postgres:postgres@localhost:5432/wandr_test_7_test_reviewer -c 'drop table walks'",
    'bun -e "new Bun.S3Client({ bucket: \'wandr-test-7-test-reviewer\' })"',
  ])('denies the evaluator: %s', (template) => {
    const command = template.replaceAll('SANDBOX', sandbox('test-reviewer', '').replace(/\/$/, ''))
    expect(bash('factory-evaluator', command)).toBe('deny')
  })

  test("denies reading the other's sandbox with Read", () => {
    expect(read('factory-evaluator', sandbox('test-reviewer', 'apps/api/.env.test'))).toBe('deny')
    expect(read('factory-test-reviewer', sandbox('evaluator', 'apps/api/.env.test'))).toBe('deny')
  })

  test.each([
    'bun run factory sandbox 7 evaluator',
    'bun run factory sandbox exec 7 evaluator -- bun test',
    'bun run factory sandbox rm 7 evaluator',
    'cat SANDBOX/apps/api/.env.test',
  ])('lets the evaluator use its own: %s', (template) => {
    const command = template.replaceAll('SANDBOX', sandbox('evaluator', '').replace(/\/$/, ''))
    expect(bash('factory-evaluator', command)).toBe('allow')
  })

  test.each(['factory-build', 'factory-test', 'factory-diagnose', 'Explore'])(
    'denies %s any sandbox',
    (agent) => {
      expect(bash(agent, 'bun run factory sandbox 7 evaluator')).toBe('deny')
    },
  )

  // The command after `--` runs in the sandbox's checkout: its relative paths start there.
  test('judges the command a sandbox runs from the sandbox', () => {
    const notes = join(root, 'factory', '.jobs', '7', 'sealed', 'build-notes.md')
    const rel = relative(sandbox('evaluator', ''), notes)
    expect(
      bash('factory-evaluator', `bun run factory sandbox exec 7 evaluator -- cat ${rel}`),
    ).toBe('deny')
    expect(
      bash(
        'factory-evaluator',
        'bun run factory sandbox exec 7 evaluator -- cat apps/api/.env.test',
      ),
    ).toBe('allow')
  })
})
