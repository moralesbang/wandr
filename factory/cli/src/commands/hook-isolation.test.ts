// G2, G3, G7: what a reviewer and a nested run may do to the shared repository and to the other
// reviewer's evidence, which tools the orchestrator has during a job, and the git settings no
// agent writes.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  BUILD,
  DIAG,
  EVAL,
  EXPLORE,
  TEST,
  TR,
  guardJob,
  put,
  type GuardJob,
} from '../guard-fixture.ts'

let j: GuardJob
beforeEach(() => {
  j = guardJob({ sealed: false })
})
afterEach(() => j.cleanup())

const RESTRICTED = [
  ['git reset --hard HEAD~3'],
  ['git clean -fdx'],
  ['git stash'],
  ['git switch main'],
  ['git checkout -b mine'],
  ['git checkout -B mine'],
  ['git branch -f mine HEAD'],
  ['git branch -D mine'],
  ['git branch -m mine other'],
  ['git apply fix.patch'],
  ['git am fix.patch'],
  ['git merge main'],
  ['git rebase main'],
  ['git cherry-pick abc1234'],
  ['git update-ref refs/heads/mine HEAD'],
  ['git notes add -m x HEAD'],
  ['git config user.name x'],
  ['git worktree add /tmp/x'],
  ['git worktree remove --force factory/.jobs/7/sandbox/test-reviewer'],
  ['git tag v1'],
  ['nice git reset --hard'],
]

describe('G2: a reviewer or a nested run does not move the shared repository', () => {
  test.each(RESTRICTED)('denies a reviewer `%s` outside its sandbox', (command) => {
    expect(j.bash(EVAL, command)).not.toBeNull()
    expect(j.bash(TR, command)).not.toBeNull()
    expect(j.bash(EXPLORE, command)).not.toBeNull()
  })

  test.each([
    'git reset --hard HEAD~1',
    'git clean -fd',
    'git checkout -b probe',
    'git apply mutation.patch',
    'git stash',
  ])('lets a reviewer run `%s` in its own sandbox', (command) => {
    expect(j.bash(EVAL, command, `${j.handoff}/sandbox/evaluator`)).toBeNull()
    expect(j.bash(EVAL, `git -C ${j.handoff}/sandbox/evaluator ${command.slice(4)}`)).toBeNull()
  })

  test("denies a reviewer another role's sandbox, with the git moves too", () => {
    expect(j.bash(EVAL, 'git reset --hard', `${j.handoff}/sandbox/test-reviewer`)).not.toBeNull()
  })

  test('denies a nested run the sandbox folder altogether', () => {
    put(`${j.handoff}/sandbox/evaluator/apps/x.ts`, 'mutated\n')
    for (const who of [EXPLORE, BUILD, TEST, DIAG]) {
      expect(
        j.guard(who, 'Read', { file_path: `${j.handoff}/sandbox/evaluator/apps/x.ts` }),
      ).toContain('sandbox')
      expect(j.bash(who, `cat ${j.handoff}/sandbox/evaluator/apps/x.ts`)).toContain('sandbox')
    }
  })

  test('lets the worker agents run the git they need', () => {
    for (const command of [
      'git reset --soft HEAD~1',
      'git stash',
      'git rebase main',
      'git checkout -b probe',
      'git branch --list',
    ]) {
      expect(j.bash(BUILD, command)).toBeNull()
    }
    expect(j.bash(EVAL, 'git log --oneline -3')).toBeNull()
    expect(j.bash(EVAL, 'git diff main...HEAD')).toBeNull()
    expect(j.bash(EVAL, 'git worktree list')).toBeNull()
    expect(j.bash(EXPLORE, 'git status')).toBeNull()
  })

  test.each([
    'git update-ref refs/heads/factory/7-add-a-thing HEAD~5',
    'git update-ref -d factory/7-add-a-thing',
    'git branch -f factory/7-add-a-thing abc1234',
    'git branch -D factory/7-add-a-thing',
    'git checkout -B factory/7-add-a-thing abc1234',
    'git switch -C factory/7-add-a-thing abc1234',
  ])('denies any agent `%s`: it moves the job’s branch', (command) => {
    for (const who of [BUILD, TEST, DIAG, EVAL]) expect(j.bash(who, command)).toContain('branch')
  })
})

describe('G2: a reviewer runs tests and servers only through factory sandbox exec', () => {
  test.each([
    'bunx playwright test',
    'cd apps/web && bunx playwright test',
    'npx playwright test --ui',
    'bun run --cwd apps/web e2e',
    'bun run e2e',
    'bun test',
    'bun test apps/api',
    'bun run dev',
    'bun run test',
    'bunx vite',
    'vite build',
    'docker compose up -d',
    'docker-compose up',
    'nice bun test',
  ])('denies a reviewer `%s` outside the sandbox', (command) => {
    expect(j.bash(EVAL, command)).toContain('sandbox exec')
    expect(j.bash(TR, command)).toContain('sandbox exec')
  })

  test('denies it from inside the sandbox folder too: its settings come with sandbox exec', () => {
    expect(j.bash(EVAL, 'bun test apps/api', `${j.handoff}/sandbox/evaluator`)).toContain(
      'sandbox exec',
    )
  })

  test.each([
    'bun test',
    'bunx playwright test --config apps/web/playwright.config.ts',
    'bun run --cwd apps/web e2e',
    'bun run dev',
    'docker compose ps',
  ])('lets a reviewer run `%s` through sandbox exec', (command) => {
    expect(j.bash(EVAL, `bun run factory sandbox exec 7 evaluator -- ${command}`)).toBeNull()
  })

  test('lets a reviewer run its type check, lint and format through the sandbox', () => {
    for (const command of ['bunx oxlint apps/web/src', 'bun run typecheck']) {
      expect(j.bash(EVAL, command)).toContain('sandbox exec')
      expect(j.bash(EVAL, `bun run factory sandbox exec 7 evaluator -- ${command}`)).toBeNull()
    }
  })

  test('the test and build agents still run their tests', () => {
    expect(j.bash(TEST, 'bun test apps/api')).toBeNull()
    expect(j.bash(BUILD, 'bunx playwright test')).toBeNull()
  })
})

describe("G2: the services check reads heredocs for the other role's database and bucket", () => {
  test('denies a database name inside a heredoc body', () => {
    const command = `psql postgres://u:p@localhost:5432/postgres <<'EOF'\n\\c wandr_test_7_test_reviewer\nDROP TABLE walks;\nEOF`
    expect(j.bash(EVAL, command)).toContain("test-reviewer's sandbox")
    expect(
      j.bash(TR, command.replace('wandr_test_7_test_reviewer', 'wandr_test_7_evaluator')),
    ).toContain("evaluator's sandbox")
  })

  test('denies a bucket name inside a heredoc body', () => {
    expect(
      j.bash(EVAL, `cat <<EOF | sh\naws s3 rb s3://wandr-test-7-test-reviewer\nEOF`),
    ).not.toBeNull()
  })

  test("lets a reviewer's own names through", () => {
    expect(
      j.bash(
        EVAL,
        `bun run factory sandbox exec 7 evaluator -- psql <<'EOF'\n\\c wandr_test_7_evaluator\nEOF`,
      ),
    ).toBeNull()
  })
})

describe('G7: no agent writes git settings', () => {
  test.each([
    'git config core.hooksPath apps/web/.hooks',
    "git config alias.st '!bun run factory answer 7 yes'",
    'git config --global user.name x',
    'git config --unset user.name',
    'git config --add remote.origin.pushurl x',
  ])('denies every agent `%s`', (command) => {
    for (const who of [BUILD, TEST, DIAG, EVAL, TR, EXPLORE]) {
      expect(j.bash(who, command)).toContain('git config')
    }
  })

  test('denies the orchestrator a setting that runs a command later, and a patch in the state folder', () => {
    expect(j.bash(null, 'git config alias.p push', j.root)).toContain('git config')
    expect(j.bash(null, 'git config core.hooksPath x', j.root)).toContain('git config')
    expect(j.bash(null, 'git config user.name x', j.root)).toBeNull()
    expect(j.bash(null, 'git apply /tmp/p.patch', j.state)).toContain("job's state")
  })

  test('lets an agent read the settings', () => {
    expect(j.bash(BUILD, 'git config user.name')).toBeNull()
    expect(j.bash(BUILD, 'git config --get remote.origin.url')).toBeNull()
    expect(j.bash(BUILD, 'git config --list')).toBeNull()
  })

  test('denies an inline hooks path', () => {
    expect(j.bash(BUILD, 'git -c core.hooksPath=apps/web/.hooks commit -m x')).not.toBeNull()
  })
})

describe('G3: the orchestrator’s tools during a job', () => {
  test.each([
    'mcp__claude-in-chrome__navigate',
    'mcp__claude-in-chrome__javascript_tool',
    'mcp__claude_ai_Gmail__authenticate',
  ])('denies the MCP tool %s', (tool) => {
    expect(j.guard(null, tool, { url: 'https://github.com/o/r/issues/7' }, j.root)).toContain('MCP')
  })

  test('judges MultiEdit like Edit, for everyone', () => {
    const file = `${j.worktree}/apps/web/e2e/a.spec.ts`
    const edits = [{ old_string: 'expect(1)', new_string: '' }]
    expect(j.guard(BUILD, 'MultiEdit', { file_path: file, edits })).toContain('protected')
    expect(
      j.guard(null, 'MultiEdit', { file_path: `${j.state}/job.json`, edits }, j.root),
    ).toContain("job's state")
    expect(
      j.guard(BUILD, 'MultiEdit', { file_path: `${j.worktree}/apps/web/src/main.ts`, edits }),
    ).toBeNull()
  })

  test.each(['WebFetch', 'WebSearch', 'Whatever', 'ExitPlanMode', 'LSP'])(
    'denies %s, a tool that is not in the orchestrator’s list',
    (tool) => {
      const reason = j.guard(null, tool, { url: 'https://example.com' })
      expect(reason).toContain(tool)
      expect(reason).toContain('EnterWorktree')
    },
  )

  test.each([
    ['Bash', { command: 'bun run factory status' }],
    ['Read', { file_path: '/etc/hosts' }],
    ['Grep', { pattern: 'x' }],
    ['Glob', { pattern: '*' }],
    ['Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' }],
    ['Write', { file_path: 'a.ts', content: 'a' }],
    ['Agent', { subagent_type: 'Explore', description: 'x', prompt: 'x', model: 'haiku' }],
    ['SendMessage', { to: 'x1', message: 'hi' }],
    ['EnterWorktree', { path: '/x' }],
    ['ExitWorktree', {}],
    ['TaskOutput', { task_id: '1' }],
    ['TaskStop', { task_id: '1' }],
    ['ListAgents', {}],
    ['AskUserQuestion', { questions: [] }],
    ['Skill', { skill: 'factory' }],
    ['ToolSearch', { query: 'x' }],
    ['ScheduleWakeup', { delaySeconds: 60 }],
    ['ReadNotifications', {}],
    ['SendUserFile', {}],
    ['PushNotification', {}],
    ['TodoWrite', { todos: [] }],
  ])('lets the orchestrator call %s', (tool, input) => {
    expect(j.guard(null, tool, input)).toBeNull()
  })
})
