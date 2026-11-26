import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ciSteps, readCiSteps, withChecksLock } from './checks.ts'
import { jobsDir } from './job.ts'

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
