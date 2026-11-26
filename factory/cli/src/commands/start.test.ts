// Jobs started before the handoff folder moved into the worktree kept their handoff files in the
// main checkout, where agents can't write. Resuming one must bring those files into the worktree.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { saveJob } from '../job.ts'
import { start } from './start.ts'

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

describe('factory start on an existing job', () => {
  test('copies the handoff files that exist only in the main checkout into the worktree', async () => {
    await start(root, 7, 'session-2')
    expect(readFileSync(join(handoff, 'issue.md'), 'utf8')).toBe('# Add a thing (#7)\n')
    expect(readFileSync(join(handoff, 'reviews', '1.evaluator.blind.md'), 'utf8')).toBe('blind\n')
  })

  test('leaves the state in the main checkout', async () => {
    await start(root, 7, 'session-2')
    expect(existsSync(join(handoff, 'job.json'))).toBe(false)
    expect(existsSync(join(handoff, 'events.jsonl'))).toBe(false)
    expect(existsSync(join(main, 'job.json'))).toBe(true)
  })

  test('never overwrites what an agent already wrote in the worktree', async () => {
    mkdirSync(handoff, { recursive: true })
    writeFileSync(join(main, 'acceptance.md'), 'stale\n')
    writeFileSync(join(handoff, 'acceptance.md'), 'current\n')
    await start(root, 7, 'session-2')
    expect(readFileSync(join(handoff, 'acceptance.md'), 'utf8')).toBe('current\n')
  })
})
