import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Refusal } from './commands/common.ts'
import { readEvents } from './events.ts'
import { makeJob } from './job-fixture.ts'
import { planRouting } from './routing.ts'
import { saveJob, type Risk } from './job.ts'
import { launch, launchSetting, ORCHESTRATOR, TASKS, type Task } from './launch.ts'
import { git } from './shell.ts'

const AGENT_NAMES = [
  'factory-diagnose',
  'factory-test',
  'factory-build',
  'factory-evaluator',
  'factory-test-reviewer',
] as const

// Every agent × task × level the table has; a missing row is a refusal.
const TABLE: Record<string, Partial<Record<Task, Record<Risk, string | null>>>> = {
  'factory-diagnose': {
    diagnose: { low: 'opus high', normal: 'opus high', high: 'opus high' },
  },
  'factory-test': {
    write: { low: 'sonnet high', normal: 'sonnet high', high: 'sonnet high' },
    fix: { low: 'sonnet medium', normal: 'sonnet medium', high: 'sonnet medium' },
  },
  'factory-build': {
    build: { low: 'sonnet medium', normal: 'sonnet medium', high: 'sonnet medium' },
  },
  'factory-evaluator': {
    review: { low: null, normal: 'opus medium', high: 'opus high' },
    verify: { low: null, normal: 'opus medium', high: 'opus high' },
  },
  'factory-test-reviewer': {
    review: { low: 'opus medium', normal: 'opus medium', high: 'opus high' },
    verify: { low: 'opus low', normal: 'opus low', high: 'opus medium' },
    ruling: { low: 'opus low', normal: 'opus low', high: 'opus medium' },
  },
}

const MATRIX = AGENT_NAMES.flatMap((agent) =>
  TASKS.flatMap((task) =>
    (['low', 'normal', 'high'] as const).map(
      (risk) => [agent, task, risk, TABLE[agent]?.[task]?.[risk] ?? null] as const,
    ),
  ),
)

const routing = (uncertainty: string[] = []) =>
  planRouting(
    {
      scope: 'frontend',
      complexity: 'small',
      evidence: ['Only stylesheet changes'],
      expectedPaths: ['apps/web/src/styles.css'],
      behaviorChange: false,
      uncertainty,
      verification: ['Review rendered layout'],
    },
    'low',
  )

describe('launchSetting: the whole table', () => {
  test.each(MATRIX)('%s %s at %s risk: %s', (agent, task, risk, expected) => {
    const setting = launchSetting(agent, task, risk)
    if (expected === null) {
      expect(setting.ok).toBe(false)
    } else {
      expect(setting.ok && `${setting.model} ${setting.effort}`).toBe(expected)
    }
  })

  test('an agent the table does not know is refused', () => {
    expect(launchSetting('Explore', 'review', 'normal').ok).toBe(false)
  })

  test('the evaluator at low risk is refused with the reason', () => {
    const setting = launchSetting('factory-evaluator', 'review', 'low')
    expect(!setting.ok && setting.reason).toContain('low risk')
  })

  test('the orchestrator runs sonnet at medium effort', () => {
    expect(ORCHESTRATOR).toEqual({ model: 'sonnet', effort: 'medium' })
  })
})

describe('factory launch', () => {
  let root = ''
  let tree = ''
  let base = ''
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'factory-launch-root-'))
    tree = mkdtempSync(join(tmpdir(), 'factory-launch-tree-'))
    await git(tree, 'init', '--quiet')
    await git(tree, 'config', 'user.email', 'test@example.com')
    await git(tree, 'config', 'user.name', 'Test')
    await git(tree, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(tree, 'a.txt'), 'one\n')
    await git(tree, 'add', '-A')
    await git(tree, 'commit', '--quiet', '-m', 'first')
    base = await git(tree, 'rev-parse', 'HEAD')
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(tree, { recursive: true, force: true })
  })

  const commit = async (path: string) => {
    mkdirSync(join(tree, path, '..'), { recursive: true })
    writeFileSync(join(tree, path), 'x\n')
    await git(tree, 'add', '-A')
    await git(tree, 'commit', '--quiet', '-m', path)
  }

  test('prints the setting for the job effective risk and logs launch.planned', async () => {
    saveJob(root, makeJob({ worktree: tree, base, risk: 'high' }))
    const planned = await launch(root, 7, 'factory-test-reviewer', 'verify')
    expect(planned).toEqual({
      agent: 'factory-test-reviewer',
      task: 'verify',
      model: 'opus',
      effort: 'medium',
      risk: 'high',
      raisedBy: [],
    })
    const event = readEvents(root, 7).find((item) => item.kind === 'launch.planned')
    expect(event?.detail).toEqual({
      agent: 'factory-test-reviewer',
      task: 'verify',
      model: 'opus',
      effort: 'medium',
      risk: 'high',
    })
  })

  test('a low-risk job whose branch touches the privacy boundary launches as normal', async () => {
    saveJob(root, makeJob({ worktree: tree, base, risk: 'low' }))
    await commit('packages/sharing/src/stretch.ts')
    const planned = await launch(root, 7, 'factory-evaluator', 'review')
    expect(planned).toMatchObject({
      model: 'opus',
      effort: 'medium',
      risk: 'normal',
      raisedBy: ['packages/sharing/src/stretch.ts'],
    })
  })

  test('the evaluator of a low-risk job is refused, and nothing is logged', async () => {
    saveJob(root, makeJob({ worktree: tree, base, risk: 'low' }))
    await commit('apps/web/src/styles.css')
    const error = await launch(root, 7, 'factory-evaluator', 'review').catch((caught) => caught)
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('low risk')
    expect(readEvents(root, 7).some((item) => item.kind === 'launch.planned')).toBe(false)
  })

  test('an escalated light job cannot continue implementation without independent acceptance tests', async () => {
    const lightPlan = planRouting(
      {
        scope: 'frontend',
        complexity: 'small',
        evidence: ['Only stylesheet spacing changes'],
        expectedPaths: ['apps/web/src/styles.css'],
        behaviorChange: false,
        uncertainty: [],
        verification: ['Inspect spacing'],
      },
      'low',
    )
    saveJob(
      root,
      makeJob({
        worktree: tree,
        base,
        risk: 'low',
        routingRequired: true,
        routing: lightPlan,
        attempts: 1,
      }),
    )
    await commit('apps/api/src/routes/walks.ts')
    await expect(launch(root, 7, 'factory-build', 'build')).rejects.toThrow('verified red')
    expect(readEvents(root, 7).some((item) => item.kind === 'launch.planned')).toBe(false)
  })

  test('a task the agent does not have is refused', async () => {
    saveJob(root, makeJob({ worktree: tree, base }))
    const error = await launch(root, 7, 'factory-build', 'review').catch((caught) => caught)
    expect(error).toBeInstanceOf(Refusal)
  })
})

describe('v1.4 launch requirements', () => {
  test('unclassified new jobs cannot launch agents', async () => {
    const root = mkdtempSync(join(tmpdir(), 'factory-unclassified-'))
    try {
      saveJob(root, makeJob({ routingRequired: true }))
      await expect(launch(root, 7, 'factory-build', 'build')).rejects.toThrow('classif')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('research cannot launch implementation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'factory-research-launch-'))
    try {
      saveJob(
        root,
        makeJob({ routingRequired: true, routing: routing(['Need to inspect behavior']) }),
      )
      await expect(launch(root, 7, 'factory-build', 'build')).rejects.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
