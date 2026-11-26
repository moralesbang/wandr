import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ciSteps, readCiSteps, shellOf, withChecksLock } from './checks.ts'
import { jobsDir } from './job.ts'
import { runLogged } from './shell.ts'

const repo = join(import.meta.dir, '..', '..', '..')

describe('ciSteps on the real ci.yml', () => {
  const { steps, skipped } = readCiSteps(repo)

  test('excludes the Playwright browser install', () => {
    expect(steps.some((step) => step.run.includes('playwright install'))).toBe(false)
    expect(skipped.some((step) => step.run.includes('playwright install'))).toBe(true)
  })

  test('excludes the step that reads GitHub Actions expressions', () => {
    expect(steps.some((step) => step.run.includes('${{'))).toBe(false)
  })

  test('includes the e2e step', () => {
    expect(steps.some((step) => step.run.includes('turbo run e2e'))).toBe(true)
  })

  test('includes the lint, type and test step', () => {
    expect(steps.some((step) => step.run.includes('turbo run lint typecheck test'))).toBe(true)
  })
})

describe('ciSteps', () => {
  test('runs a command once even when two jobs repeat it', () => {
    const yaml = [
      'jobs:',
      '  a:',
      '    steps:',
      '      - run: bun install',
      '  b:',
      '    steps:',
      '      - run: bun install',
    ].join('\n')
    expect(ciSteps(yaml).steps).toHaveLength(1)
  })

  test('ignores steps that only use an action', () => {
    const yaml = 'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n'
    expect(ciSteps(yaml).steps).toEqual([])
  })
})

describe('a CI step run as factory check runs it', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'factory-step-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  /** Runs a step's script the way `factory check` does; returns its exit code and the log. */
  const runStep = async (run: string, env: Record<string, string> = {}) => {
    const log = join(dir, 'step.log')
    writeFileSync(log, '')
    const code = await runLogged(shellOf(run), dir, log, env)
    return { code, log: readFileSync(log, 'utf8') }
  }

  test('a one-line step runs, and its stdout and stderr reach the log', async () => {
    expect(await runStep('echo out; echo err >&2')).toEqual({ code: 0, log: 'out\nerr\n' })
  })

  test('a multi-line step keeps its newlines, a continuation and a { …; } group', async () => {
    // The shape of "Generated files match the code": a continued command whose failure runs a group.
    const run = [
      'echo first',
      'test -n "" \\',
      '  || { echo "stale"; exit 3; }',
      'echo never',
      '',
    ].join('\n')
    expect(await runStep(run)).toEqual({ code: 3, log: 'first\nstale\n' })
  })

  test('a multi-line step whose continued command passes runs to the end', async () => {
    const run = ['test -n "x" \\', '  || { echo "stale"; exit 3; }', 'echo done', ''].join('\n')
    expect(await runStep(run)).toEqual({ code: 0, log: 'done\n' })
  })

  test('bash, not an outer shell, expands $VAR and backticks', async () => {
    const run = 'VALUE=inner\necho "var:$VALUE tick:`echo $VALUE`"\n'
    expect(await runStep(run, { VALUE: 'outer' })).toEqual({
      code: 0,
      log: 'var:inner tick:inner\n',
    })
  })

  test('a failing command in a pipeline fails the step, as with pipefail in CI', async () => {
    expect((await runStep('false | cat\necho after\n')).code).not.toBe(0)
  })
})

describe('withChecksLock', () => {
  let root = ''
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'factory-lock-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const lockDir = () => join(jobsDir(root), 'checks.lock')
  const holdBy = (pid: number, job: number) => {
    mkdirSync(lockDir(), { recursive: true })
    writeFileSync(join(lockDir(), 'owner.json'), JSON.stringify({ pid, job }))
  }

  test('takes a free lock, runs the work and releases it', async () => {
    let during = ''
    const result = await withChecksLock(root, 7, async () => {
      during = readFileSync(join(lockDir(), 'owner.json'), 'utf8')
      return 'done'
    })
    expect(result).toBe('done')
    expect(JSON.parse(during)).toEqual({ pid: process.pid, job: 7 })
    expect(await Bun.file(join(lockDir(), 'owner.json')).exists()).toBe(false)
  })

  test('takes over a lock whose holder is dead', async () => {
    const dead = Bun.spawn(['true'])
    await dead.exited
    holdBy(dead.pid, 3)
    const result = await withChecksLock(root, 7, async () => 'ran')
    expect(result).toBe('ran')
  })

  test('waits while a live process holds the lock', async () => {
    holdBy(process.pid, 3)
    const waited: number[] = []
    const events: string[] = []
    const pending = withChecksLock(
      root,
      7,
      async () => {
        events.push('work')
      },
      (holder) => waited.push(holder),
    )
    await Bun.sleep(300)
    events.push('released')
    rmSync(lockDir(), { recursive: true })
    await pending
    expect(waited).toEqual([3])
    expect(events).toEqual(['released', 'work'])
  }, 10_000)
})
