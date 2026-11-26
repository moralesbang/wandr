import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { saveJob } from '../job.ts'
import { Refusal } from './common.ts'
import { red } from './red.ts'

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-red-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('factory red', () => {
  test('the 4th red is refused before anything runs', async () => {
    saveJob(root, makeJob({ redRejections: 3, worktree: join(root, 'no-such-worktree') }))
    const error = await red(root, 7).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('Decision Request')
  })
})
