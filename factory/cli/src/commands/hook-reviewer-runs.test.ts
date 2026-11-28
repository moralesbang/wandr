// The third adversarial review's G3: outside `factory sandbox exec` a reviewer runs an allowlist of
// read-only commands, not a denylist of runners; inside it, anything goes, subject to the path rules.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { EVAL, TR, guardJob, type GuardJob } from '../guard-fixture.ts'

let j: GuardJob
beforeEach(() => {
  j = guardJob({ plan: { evaluator: 'review', 'test-reviewer': 'review' } })
})
afterEach(() => j.cleanup())

const S = () => `${j.handoff}/sandbox/evaluator`

describe('G3: what a reviewer runs outside the sandbox', () => {
  test.each([
    'cat apps/web/src/main.ts',
    'ls apps',
    'rg walk apps',
    'grep -rn walk apps packages',
    'find apps -name "*.ts" -not -path "*/node_modules/*"',
    'head -n 20 apps/web/src/main.ts',
    'tail -n 20 factory/.jobs/7/checks/1.log',
    'wc -l apps/web/src/main.ts',
    'jq .port factory/.jobs/7/sandbox/evaluator.json',
    'diff apps/web/src/main.ts apps/web/src/main.ts',
    'git diff main...HEAD',
    'git log --oneline -5',
    'git show HEAD:apps/web/src/main.ts',
    'git status --short',
    'git blame apps/web/src/main.ts',
    'git ls-files apps/web',
    'git rev-parse HEAD',
    'sed -n 1,20p apps/web/src/main.ts',
    `awk '{print $1}' apps/web/src/main.ts`,
    `awk '$1 > 5' apps/web/src/main.ts`,
    'bun run factory status',
    'bun run factory sandbox 7 __ROLE__',
    'bun run factory sandbox rm 7 __ROLE__',
    `mkdir -p ${'$S'}/scratch`.replace('$S', '__S__'),
    'echo hi',
    'cd apps && ls',
    'git diff main...HEAD | head -50',
    'for f in apps/web/src/*.ts; do wc -l $f; done',
    'bash -lc "cat apps/web/src/main.ts"',
    'FOO=bar',
  ])('lets a reviewer run `%s`', (command) => {
    const as = (role: string) =>
      command.replace('__S__', `${j.handoff}/sandbox/${role}`).replaceAll('__ROLE__', role)
    expect(j.bash(EVAL, as('evaluator'))).toBeNull()
    expect(j.bash(TR, as('test-reviewer'))).toBeNull()
  })

  test('lets a reviewer write scratch files in its own sandbox', () => {
    for (const command of [
      `echo note > ${S()}/scratch.md`,
      `mkdir ${S()}/.mut`,
      `touch ${S()}/a`,
      `cp apps/web/src/main.ts ${S()}/main.bak`,
      `cat apps/web/src/main.ts | tee ${S()}/copy.ts`,
      `sed -i '' s/a/b/ ${S()}/apps/api/src/routes/walks.ts`,
      `cd ${S()} && sed -i '' s/a/b/ apps/api/src/routes/walks.ts`,
      `cd ${S()} && git reset --hard`,
      `git -C ${S()} stash`,
      `git -C ${S()} commit -am probe`,
    ]) {
      expect(j.bash(EVAL, command)).toBeNull()
    }
  })

  test.each([
    'bun test',
    'bun test apps/api',
    'bun run typecheck',
    'bun run build',
    'bun run e2e',
    'bunx oxlint apps/web/src',
    'bunx playwright test',
    'bunx tsc -p .',
    'node script.js',
    `node -e 'console.log(1)'`,
    'python3 probe.py',
    'perl -pe "" apps/web/src/main.ts',
    'bash probe.sh',
    'sh ./probe.sh',
    'make test',
    'npm test',
    'curl -s localhost:3100/health',
    'curl -s localhost:3100/walks -X POST -d x',
    'psql "$DATABASE_URL" -c "select 1"',
    'docker compose up -d',
    'docker ps',
    'aws s3 ls',
    'ps aux',
    'pgrep -f bun',
    'pkill -f bun',
    'kill 123',
    'lsof -i :3100',
    'env',
    'xargs -a list rm',
    `awk 'BEGIN{system("rm x")}'`,
    'git fetch origin',
    'git bisect run bun test',
    'git filter-branch --tree-filter x HEAD',
    'git submodule foreach bun test',
    'time bun test',
    'nice -n 5 bun run build',
    'timeout 60 bun test',
    `cd ${'__S__'} && bun test`,
  ])('denies a reviewer `%s` and says to run it through sandbox exec', (command) => {
    const evaluator = j.bash(EVAL, command.replace('__S__', S()))
    expect(evaluator).toContain('sandbox exec 7 evaluator')
    const tr = j.bash(TR, command.replace('__S__', `${j.handoff}/sandbox/test-reviewer`))
    expect(tr).toContain('sandbox exec 7 test-reviewer')
  })

  test('denies `sed -i` of the shared worktree: only a sandbox is a reviewer’s to edit', () => {
    expect(j.bash(EVAL, `sed -i '' s/a/b/ apps/web/src/main.ts`)).not.toBeNull()
  })

  test.each([
    'find apps -name x -exec rm {} +',
    'find apps -name x -delete',
    'tar xf x.tar',
    'unzip x.zip',
    'chmod +x probe.sh',
    `awk 'BEGIN{print "x" > "f"}'`,
  ])('denies a reviewer `%s` outside the sandbox: it writes the shared worktree', (command) => {
    expect(j.bash(EVAL, command)).not.toBeNull()
  })

  test('lets the same commands through `sandbox exec`, whatever they are', () => {
    for (const [command, who] of [
      'bun test',
      'bunx playwright test',
      'bun run --cwd apps/web build',
      'python3 probe.py',
      'node script.js',
      'curl -s localhost:$PORT/health',
      'psql "$DATABASE_URL" -c "select 1"',
      'ps aux',
      'sed -i "" s/a/b/ apps/web/src/main.ts',
      'bash probe.sh',
      'make test',
      'tar xf x.tar',
    ].map((typed, run) => [typed, { ...EVAL, agent_id: `e-${run}` }] as const)) {
      // One run each: the sandbox budget counts per run, and this is about what a sandbox runs.
      expect(j.bash(who, `bun run factory sandbox exec 7 evaluator -- ${command}`)).toBeNull()
    }
  })

  test('denies a git move outside the sandbox, with the same refusal as before', () => {
    expect(j.bash(EVAL, 'git reset --hard')).toContain('sandbox')
    expect(j.bash(EVAL, 'git stash')).toContain('sandbox')
  })

  test('does not change what the build, test and diagnose agents run', async () => {
    const { BUILD, TEST, DIAG } = await import('../guard-fixture.ts')
    for (const who of [BUILD, TEST, DIAG]) {
      expect(j.bash(who, 'bun test apps/api')).toBeNull()
      expect(j.bash(who, 'python3 probe.py')).toBeNull()
    }
  })
})
