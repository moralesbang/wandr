// The user's answer to a Decision Request is the only thing that unblocks a job. These tests defend
// that `factory answer` records it once, for the latest request, and never on a job that asked
// nothing.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { loadJob, saveJob } from '../job.ts'
import { Refusal } from './common.ts'
import { answer } from './answer.ts'

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-answer-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const DR = { at: '2026-01-01T00:00:00Z', file: 'decision-requests/1.md' }
const refusal = (run: () => unknown) => {
  try {
    run()
  } catch (caught) {
    return caught
  }
  return null
}

describe('factory answer', () => {
  test('records the answer to the latest request', () => {
    saveJob(root, makeJob({ state: 'blocked', decisionRequests: [DR] }))
    const job = answer(root, 7, 'Yes, drop the guarantee')
    expect(job.answers).toHaveLength(1)
    expect(job.answers[0]).toMatchObject({ request: 1, text: 'Yes, drop the guarantee' })
    expect(loadJob(root, 7)?.answers).toEqual(job.answers)
  })

  test('answers the latest request when there are several', () => {
    saveJob(
      root,
      makeJob({
        state: 'blocked',
        decisionRequests: [DR, { ...DR, file: 'decision-requests/2.md' }],
        answers: [{ request: 1, at: '2026-01-02T00:00:00Z', text: 'ok', cited: true }],
      }),
    )
    expect(answer(root, 7, 'second').answers.map((a) => a.request)).toEqual([1, 2])
  })

  test.each([
    ['the job is building', { state: 'building' as const, decisionRequests: [DR] }],
    ['the job has no Decision Request', { state: 'blocked' as const }],
  ])('is refused when %s', (_what, overrides) => {
    saveJob(root, makeJob(overrides))
    expect(refusal(() => answer(root, 7, 'yes'))).toBeInstanceOf(Refusal)
    expect(loadJob(root, 7)?.answers).toEqual([])
  })

  test('is refused when the latest request already has an answer', () => {
    saveJob(
      root,
      makeJob({
        state: 'blocked',
        decisionRequests: [DR],
        answers: [{ request: 1, at: '2026-01-02T00:00:00Z', text: 'first', cited: false }],
      }),
    )
    expect(refusal(() => answer(root, 7, 'second'))).toBeInstanceOf(Refusal)
    expect(loadJob(root, 7)?.answers[0]?.text).toBe('first')
  })

  test.each(['', '   ', '\n'])('is refused with empty text %j', (text) => {
    saveJob(root, makeJob({ state: 'blocked', decisionRequests: [DR] }))
    expect(refusal(() => answer(root, 7, text))).toBeInstanceOf(Refusal)
    expect(loadJob(root, 7)?.answers).toEqual([])
  })
})
