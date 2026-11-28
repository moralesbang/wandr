// Jobs started before the handoff folder moved into the worktree kept their handoff files in the
// main checkout, where agents can't write. Resuming one must bring those files into the worktree.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installFakeGh, makeJob, withDocker } from '../job-fixture.ts'
import { loadJob, saveJob } from '../job.ts'
import { Refusal } from './common.ts'
import { describeAnswer, start } from './start.ts'

let root = ''
let worktree = ''
let main = ''
let handoff = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-start-'))
  worktree = join(root, '.claude', 'worktrees', '7-add-a-thing')
  main = join(root, 'factory', '.jobs', '7')
  handoff = join(worktree, 'factory', '.jobs', '7')
  mkdirSync(worktree, { recursive: true })
  saveJob(root, makeJob({ worktree, state: 'building' }))
  mkdirSync(join(main, 'reviews'), { recursive: true })
  writeFileSync(join(main, 'issue.md'), '# Add a thing (#7)\n')
  writeFileSync(join(main, 'reviews', '1.evaluator.blind.md'), 'blind\n')
  writeFileSync(join(main, 'events.jsonl'), '')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

// Value record (T-009). Guarantee: `start` stops on a Docker that isn't there before it touches
// the job, GitHub or the checkout. Defect caught: 13 minutes lost in job #15 to a Docker that
// wasn't running. The FI-029 acceptance test covers the preflight itself, not that `start` calls it
// first. Level: unit.
describe('factory start without Docker', () => {
  test('refuses before it reads the job, and changes nothing', async () => {
    const before = loadJob(root, 7)
    const docker = { ...withDocker.docker, run: async () => 1, platform: 'linux' }
    const error = await start(root, 7, 'session-2', { docker }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('Docker')
    expect(loadJob(root, 7)).toEqual(before)
  })
})

describe('factory start on an existing job', () => {
  test('copies the handoff files that exist only in the main checkout into the worktree', async () => {
    await start(root, 7, 'session-2', withDocker)
    expect(readFileSync(join(handoff, 'issue.md'), 'utf8')).toBe('# Add a thing (#7)\n')
    expect(readFileSync(join(handoff, 'reviews', '1.evaluator.blind.md'), 'utf8')).toBe('blind\n')
  })

  test('leaves the state in the main checkout', async () => {
    await start(root, 7, 'session-2', withDocker)
    expect(existsSync(join(handoff, 'job.json'))).toBe(false)
    expect(existsSync(join(handoff, 'events.jsonl'))).toBe(false)
    expect(existsSync(join(main, 'job.json'))).toBe(true)
  })

  test('never overwrites what an agent already wrote in the worktree', async () => {
    mkdirSync(handoff, { recursive: true })
    writeFileSync(join(main, 'acceptance.md'), 'stale\n')
    writeFileSync(join(handoff, 'acceptance.md'), 'current\n')
    await start(root, 7, 'session-2', withDocker)
    expect(readFileSync(join(handoff, 'acceptance.md'), 'utf8')).toBe('current\n')
  })
})

const refusal = (promise: Promise<unknown>) => promise.catch((caught: unknown) => caught)

const blocked = (overrides: Parameters<typeof makeJob>[0]) =>
  saveJob(root, makeJob({ worktree, state: 'blocked', ...overrides }))

describe('factory start on a blocked job', () => {
  const DR = { at: '2026-01-01T00:00:00Z', file: 'decision-requests/1.md' }
  const ANSWER = { request: 1, at: '2026-01-02T00:00:00Z', text: 'Drop it, go on', cited: false }
  let fake: ReturnType<typeof installFakeGh>
  beforeEach(() => {
    fake = installFakeGh(root)
  })
  afterEach(() => fake.restore())

  test('is refused while the latest Decision Request has no answer, and stays blocked', async () => {
    blocked({ decisionRequests: [DR] })
    const error = await refusal(start(root, 7, 'session-2', withDocker))
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('factory answer')
    expect(loadJob(root, 7)?.state).toBe('blocked')
    expect(fake.calls()).toBe('')
  })

  test('is refused when only an earlier request has an answer', async () => {
    blocked({
      decisionRequests: [DR, { ...DR, file: 'decision-requests/2.md' }],
      answers: [{ ...ANSWER, cited: true }],
    })
    expect(await refusal(start(root, 7, 'session-2', withDocker))).toBeInstanceOf(Refusal)
    expect(loadJob(root, 7)?.state).toBe('blocked')
  })

  test('takes the job back to building once the latest request is answered', async () => {
    blocked({ decisionRequests: [DR], answers: [ANSWER] })
    const job = await start(root, 7, 'session-2', withDocker)
    expect(job.state).toBe('building')
    expect(loadJob(root, 7)?.state).toBe('building')
    expect(fake.calls()).toContain('--add-label factory:building')
    expect(describeAnswer(job)).toContain('Drop it, go on')
  })

  test('prints no answer for a job whose answer a commit already cited', () => {
    const job = makeJob({ decisionRequests: [DR], answers: [{ ...ANSWER, cited: true }] })
    expect(describeAnswer(job)).toBeNull()
  })
})
