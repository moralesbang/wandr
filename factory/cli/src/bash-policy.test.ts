// Nobody but the CLI writes to GitHub, answers a Decision Request for the user, or edits a job's
// state. These tests drive the guard end to end, the way Claude Code calls it, from the orchestrator
// and from an agent.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hookGuard } from './commands/hook.ts'
import { makeJob } from './job-fixture.ts'
import { saveJob } from './job.ts'

let root = ''
let worktree = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-bash-'))
  worktree = join(root, '.claude', 'worktrees', '7-add-a-thing')
  saveJob(root, makeJob({ number: 13, worktree, session: 'job-session' }))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const WHO = [
  ['the orchestrator', undefined],
  ['an agent', 'factory-build'],
] as const

const decide = (command: string, agent: string | undefined, cwd: string = root) => {
  const out = hookGuard(
    root,
    JSON.stringify({
      session_id: 'job-session',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      cwd,
      tool_input: { command },
      ...(agent ? { agent_id: 'run-1', agent_type: agent } : {}),
    }),
  )
  return out
    ? (JSON.parse(out).hookSpecificOutput as {
        permissionDecision: string
        permissionDecisionReason: string
      })
    : null
}

describe.each(WHO)('the guard on Bash from %s', (_who, agent) => {
  test.each([
    'gh issue comment 13 --body x',
    'gh issue edit 13 --add-label factory:ready',
    'gh issue close 13',
    'gh issue reopen 13',
    'gh issue create --title t',
    'gh issue delete 13',
    'gh issue lock 13',
    'gh pr comment 5 --body x',
    'gh pr review 5 --approve',
    'gh pr edit 5 --title x',
    'gh pr create --fill',
    'gh pr merge 5',
    'gh pr close 5',
    'gh pr ready 5',
    'gh label create x',
    'gh api repos/o/r/issues/13/comments -f body=x',
    'gh auth token',
    'gh repo delete o/r',
    'gh release create v1',
    'gh secret set X',
    'gh workflow run ci.yml',
    'gh -R o/r issue comment 13 --body x',
    'git status && gh issue comment 13 --body x',
    'echo hi | gh issue comment 13 --body-file -',
    'bash -c "gh issue comment 13 --body x"',
    "sh -c 'gh issue comment 13 -b x'",
    'env GH_TOKEN=x gh issue comment 13 -b x',
    'echo $(gh issue comment 13 -b x)',
    '/opt/homebrew/bin/gh issue comment 13 -b x',
    'g""h issue comment 13 -b x',
  ])('denies writing to GitHub: %s', (command) => {
    const decision = decide(command, agent)
    expect(decision?.permissionDecision).toBe('deny')
    expect(decision?.permissionDecisionReason).toContain('Decision Request')
  })

  test.each([
    'bun run factory answer 13 "yes"',
    'bun run factory answer 13 yes',
    'bun factory/cli/src/main.ts answer 13 yes',
    'bun /repo/factory/cli/src/main.ts answer 13 yes',
    'bun run main.ts answer 13 yes',
    'bash -c "bun run factory answer 13 yes"',
    "sh -c 'bun run factory answer 13 yes'",
    'env FOO=1 bun run factory answer 13 yes',
    'echo $(bun run factory answer 13 yes)',
    'git status; bun run factory answer 13 yes',
    'true && bun run factory answer 13 yes',
    'true | bun run factory answer 13 yes',
    'bun run factory ans""wer 13 yes',
    'bun run   factory   answer 13 yes',
  ])('denies answering for the user: %s', (command) => {
    const decision = decide(command, agent)
    expect(decision?.permissionDecision).toBe('deny')
    expect(decision?.permissionDecisionReason).toContain('! bun run factory answer')
  })

  test.each([
    `echo '{}' > ${'ROOT'}/factory/.jobs/13/job.json`,
    `cp /tmp/x ROOT/factory/.jobs/13/job.json`,
    `mv /tmp/x ROOT/factory/.jobs/13/events.jsonl`,
    `echo x | tee ROOT/factory/.jobs/13/job.json`,
    `sed -i s/blocked/building/ ROOT/factory/.jobs/13/job.json`,
    `node -e "require('fs').writeFileSync('ROOT/factory/.jobs/13/job.json','{}')"`,
    `cd ROOT/factory/.jobs/13 && echo x > job.json`,
    `bash -c "echo x >> ROOT/factory/.jobs/13/events.jsonl"`,
    `cat ROOT/factory/.jobs/13/job.json > ROOT/factory/.jobs/13/job.json`,
    `echo x > ROOT/factory/.jobs/13/../13/job.json`,
  ])("denies writing the job's state: %s", (template) => {
    const decision = decide(template.replaceAll('ROOT', root), agent)
    expect(decision?.permissionDecision).toBe('deny')
    expect(decision?.permissionDecisionReason).toContain('bun run factory')
  })

  test('denies a relative write to the state when run from the main checkout', () => {
    expect(decide('echo x > factory/.jobs/13/job.json', agent, root)?.permissionDecision).toBe(
      'deny',
    )
  })

  test.each([
    'bun run factory check 13',
    'bun run factory red 13',
    'gh issue view 13',
    'gh issue view 13 --comments --json body',
    'gh issue list --label factory:ready',
    'gh pr view 5',
    'gh pr list',
    'gh pr checks 5',
    'gh pr diff 5',
    'git status',
    'git commit -m "feat: x"',
    'cat ROOT/factory/.jobs/13/job.json',
    'jq .state ROOT/factory/.jobs/13/job.json',
    'bun test 2>&1 | tail -5',
  ])('allows %s', (template) => {
    expect(decide(template.replaceAll('ROOT', root), agent)).toBeNull()
  })

  test("allows writing the handoff folder in the job's worktree", () => {
    expect(decide('echo x > factory/.jobs/13/build-notes.md', agent, worktree)).toBeNull()
    expect(
      decide(`cp /tmp/x ${worktree}/factory/.jobs/13/build-notes.md`, agent, worktree),
    ).toBeNull()
  })
})
