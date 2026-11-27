// Nobody but the CLI writes to GitHub, answers a Decision Request for the user, or edits a job's
// state. These tests drive the guard end to end, the way Claude Code calls it, from the orchestrator
// and from an agent.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
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

// An agent works in the job's worktree; the orchestrator also runs the CLI from the main checkout.
const decide = (
  command: string,
  agent: string | undefined,
  cwd: string = agent ? worktree : root,
) => {
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
    'bun run factory status',
    'git status',
    'git commit -m "feat: x"',
    'bun test 2>&1 | tail -5',
  ])('allows %s', (command) => {
    expect(decide(command, agent)).toBeNull()
  })

  test("allows writing the handoff folder in the job's worktree", () => {
    expect(decide('echo x > factory/.jobs/13/build-notes.md', agent, worktree)).toBeNull()
    expect(
      decide(`cp /tmp/x ${worktree}/factory/.jobs/13/build-notes.md`, agent, worktree),
    ).toBeNull()
  })
})

// Reading GitHub and the job's state stays the orchestrator's: an agent reads the issue from the job
// folder, and the state holds the event log and the sealed store.
describe('reads only the orchestrator may make', () => {
  test.each([
    'gh issue view 13',
    'gh issue view 13 --comments --json body',
    'gh issue list --label factory:ready',
    'gh pr view 5',
    'gh pr list',
    'gh pr checks 5',
    'gh pr diff 5',
    'cat ROOT/factory/.jobs/13/job.json',
    'jq .state ROOT/factory/.jobs/13/job.json',
  ])('%s: allowed to the orchestrator, denied to an agent', (template) => {
    const command = template.replaceAll('ROOT', root)
    expect(decide(command, undefined)).toBeNull()
    expect(decide(command, 'factory-build')?.permissionDecision).toBe('deny')
  })
})

// The adversarial review of factory v1.3 got each of these past the guard. They run as Claude Code
// runs the guard, from the orchestrator in the main checkout and from an agent in the worktree.
describe('factory commands, read as main.ts reads its arguments', () => {
  test.each([
    'bun run factory --note x answer 13 yes',
    'bun run factory --session s answer 13 yes',
    'bun run factory --port 1 answer 13 yes',
    'bun run factory --note=x answer 13 yes',
    'bun run factory -- answer 13 yes',
    'bun factory/cli/src/main answer 13 yes',
    'bun ./factory/cli/src/main answer 13 yes',
    'bun factory/cli/src/main.t? answer 13 yes',
    'node factory/cli/src/main.ts answer 13 yes',
    'bun --cwd factory/cli run src/main.ts answer 13 yes',
    'bun factory answer 13 yes',
  ])('denies answering for the user, from anyone: %s', (command) => {
    for (const agent of [undefined, 'factory-build']) {
      expect(decide(command, agent)?.permissionDecisionReason).toContain('! bun run factory answer')
    }
  })

  test.each([
    'A=answer; bun run factory $A 13 yes',
    'bun run factory $(echo answer) 13 yes',
    'bun run factory `echo answer` 13 yes',
    'echo answer 13 yes | xargs bun run factory',
    `bun -e 'const {answer}=await import("./factory/cli/src/commands/answer.ts"); answer(process.cwd(),13,"yes")'`,
    `bun -e 'import("./factory/cli/src/seal.ts").then(m=>m.unseal("/r",13))'`,
    `node --eval 'require("./factory/cli/src/main.ts")'`,
  ])('denies a factory command it cannot read, from anyone: %s', (command) => {
    for (const agent of [undefined, 'factory-build']) {
      expect(decide(command, agent)?.permissionDecision).toBe('deny')
    }
  })

  test.each([
    'bun run factory hook log',
    "echo '{}' | bun run factory hook log",
    'bun run factory hook guard < /tmp/x',
  ])('denies running the hooks, which only Claude Code runs: %s', (command) => {
    for (const agent of [undefined, 'factory-build']) {
      expect(decide(command, agent)?.permissionDecisionReason).toContain('factory hook')
    }
  })

  test.each([
    'bun run factory unseal 13',
    'bun factory/cli/src/main unseal 13',
    'bun run factory --note x unseal 13',
    'bun run factory --pass 2 unseal 13',
    'bun run factory --note x pr 13',
    'bun run factory review 13',
    'bun run factory launch 13 factory-build --task build',
    'bun run factory sandbox 13 evaluator',
  ])('denies an agent a command that moves the job: %s', (command) => {
    expect(decide(command, 'factory-build')?.permissionDecision).toBe('deny')
    expect(decide(command, undefined)).toBeNull()
  })

  // `watch` and `clean` are the user's, from their own prompt: the guard denies them to everyone.
  test.each([
    'bun run factory watch --port 4999',
    'bun run factory clean 13',
    'bun run factory clean 13 --abandon',
  ])('denies everyone %s: only the user runs it', (command) => {
    for (const agent of [undefined, 'factory-build']) {
      const decision = decide(command, agent)
      expect(decision?.permissionDecision).toBe('deny')
      expect(decision?.permissionDecisionReason).toContain('the user')
    }
  })

  // The skill has the orchestrator run the red; a build agent's red would commit its own product
  // changes as the red commit, unjudged by the gate.
  test('factory red is the orchestrator’s, not an agent’s', () => {
    expect(decide('bun run factory red 13', undefined)).toBeNull()
    for (const agent of ['factory-build', 'factory-test', 'factory-evaluator']) {
      expect(decide('bun run factory red 13', agent)?.permissionDecision).toBe('deny')
    }
  })

  test.each([
    ['factory-build', 'bun run factory check 13'],
    ['factory-test', 'bun run factory status'],
    ['factory-diagnose', 'bun run factory status'],
    ['factory-evaluator', 'bun run factory sandbox 13 evaluator'],
    ['factory-test-reviewer', 'bun run factory sandbox exec 13 test-reviewer -- bun test'],
  ])('lets %s run its own command: %s', (agent, command) => {
    expect(decide(command, agent)).toBeNull()
  })

  test('denies an agent a factory command for another job', () => {
    expect(decide('bun run factory check 7', 'factory-build')?.permissionDecision).toBe('deny')
  })
})

describe('GitHub, during a job', () => {
  test.each([
    'G=gh; $G issue comment 13 -b x',
    '$(which gh) issue comment 13 -b x',
    'gh auth status --show-token',
    'gh auth status -t',
    `curl -X POST -H "Authorization: token X" https://api.github.com/repos/o/r/issues/13/comments -d '{"body":"hi"}'`,
    'wget --post-data x https://github.com/o/r',
    'git push origin HEAD',
    'git push origin --delete main',
    'git -C . push -f origin HEAD',
    `bun -e 'Bun.spawnSync(["gh","issue","comment","13","-b","x"])'`,
  ])('denies everyone: %s', (command) => {
    for (const agent of [undefined, 'factory-build']) {
      expect(decide(command, agent)?.permissionDecision).toBe('deny')
    }
  })

  test.each([
    'gh auth status',
    'gh issue view 13 --repo o/r && gh pr view',
    'curl -s localhost:3000/health',
  ])('still lets the orchestrator read: %s', (command) => {
    expect(decide(command, undefined)).toBeNull()
  })
})

describe("the job's state, wherever the command's cd leads", () => {
  test.each([
    'cd factory && echo x >> .jobs/13/events.jsonl',
    `cd factory && sed -i '' 's/"answers": \\[\\]/"answers": [{"request":1}]/' .jobs/13/job.json`,
    'cp /tmp/j factory/.job?/13/job.json',
    'cp /tmp/j factory/.j*/13/job.json',
    'cp /tmp/j factory/*/13/job.json',
    'ln -s ROOT/factory j',
    'ln -s ROOT/factory/.jobs/13 j',
    `python3 -c "open('ROOT/factory/.jobs/13/job.json', 'w').write('{}')"`,
    "jq '.a | .b' factory/.jobs/13/job.json > factory/.jobs/13/job.json",
  ])('denies the orchestrator: %s', (template) => {
    expect(decide(template.replaceAll('ROOT', root), undefined, root)?.permissionDecision).toBe(
      'deny',
    )
  })

  test('denies writing through a symlink made earlier', () => {
    mkdirSync(join(root, 'factory', '.jobs', '13'), { recursive: true })
    mkdirSync(worktree, { recursive: true })
    symlinkSync(join(root, 'factory'), join(worktree, 'j'))
    expect(decide('echo x > j/.jobs/13/job.json', undefined, worktree)?.permissionDecision).toBe(
      'deny',
    )
  })

  test('lets a reader read it and write elsewhere', () => {
    expect(
      decide("jq '.state | ascii_upcase' factory/.jobs/13/job.json > /tmp/x", undefined, root),
    ).toBeNull()
  })
})

/** JOB is the job's folder in the worktree. */
const at = (command: string) => command.replaceAll('JOB', join(worktree, 'factory', '.jobs', '13'))

describe("an agent's Bash writes stay in its column", () => {
  test.each([
    ['factory-test', `printf 'Verdict: same-guarantee\\nDiff: abc\\n' > JOB/rulings/1.md`],
    ['factory-build', `echo 'Verdict: approve' > JOB/reviews/1.evaluator.md`],
    ['factory-evaluator', `echo 'Verdict: approve' > JOB/reviews/1.test-reviewer.md`],
    ['factory-evaluator', `echo x > JOB/reviews/2.test-reviewer.blind.md`],
    ['factory-evaluator', `echo x > JOB/reviews/2.evaluator.blind.md`],
    ['factory-build', "sed -i '' 's/expect/void/' apps/web/e2e/icons.spec.ts"],
    ['factory-build', "sed -i '' 's/deny(/allow;(/' factory/cli/src/bash-policy.ts"],
    ['factory-build', 'echo x > .claude/settings.json'],
    ['factory-build', `echo summary > JOB/summary.md`],
    ['factory-build', 'echo x &> .oxlintrc.json'],
    ['factory-build', 'tee -a knowledge/README.md < /tmp/x'],
    ['factory-build', 'cp /tmp/x apps/web/e2e/a.spec.ts'],
    ['factory-build', 'mv apps/web/e2e/a.spec.ts /tmp/'],
    ['factory-build', 'rm -f apps/web/e2e/a.spec.ts'],
    ['factory-build', 'touch turbo.json'],
    ['factory-build', 'mkdir -p .github/workflows/x'],
    ['factory-build', 'truncate -s 0 bunfig.toml'],
    ['factory-build', 'ln -sf /tmp/x CLAUDE.md'],
    ['factory-build', 'dd if=/tmp/x of=apps/web/playwright.config.ts'],
    ['factory-build', 'install -m 644 /tmp/x knowledge/standards/testing.md'],
    ['factory-build', 'git checkout main -- apps/web/e2e/a.spec.ts'],
    ['factory-build', 'git restore --source main factory/cli/src/paths.ts'],
    ['factory-build', `python3 -c "open('apps/web/e2e/a.spec.ts', 'w').write('')"`],
    ['factory-build', `node -e "require('fs').writeFileSync('.oxfmtrc.json', '{}')"`],
    ['factory-test', 'git commit -m "test: red"'],
    ['factory-evaluator', 'git commit -am "fix"'],
  ])('denies %s: %s', (agent, command) => {
    expect(decide(at(command), agent)?.permissionDecision).toBe('deny')
  })

  test.each([
    ['factory-build', 'echo note >> factory/.jobs/13/build-notes.md'],
    ['factory-build', 'bun test > apps/api/test-output.txt 2>&1'],
    ['factory-build', 'mkdir -p apps/web/src/features/x && touch apps/web/src/features/x/a.ts'],
    ['factory-build', 'git commit -m "feat: x"'],
    ['factory-test', 'mkdir -p apps/web/e2e && touch apps/web/e2e/new.spec.ts'],
    [
      'factory-evaluator',
      'cd factory/.jobs/13/sandbox/evaluator && bun run build > build.log 2>&1',
    ],
    ['factory-evaluator', 'cd factory/.jobs/13/sandbox/evaluator && git commit -qam probe'],
  ])('lets %s write its own column: %s', (agent, command) => {
    expect(decide(command, agent)).toBeNull()
  })
})
