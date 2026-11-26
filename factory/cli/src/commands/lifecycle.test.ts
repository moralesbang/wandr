import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { loadJob, saveJob } from '../job.ts'
import { git } from '../shell.ts'
import { Refusal } from './common.ts'
import { rewrite } from './lifecycle.ts'

let root = ''
let tree = ''
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-rewrite-root-'))
  tree = mkdtempSync(join(tmpdir(), 'factory-rewrite-tree-'))
  await git(tree, 'init', '--quiet')
  await git(tree, 'config', 'user.email', 'test@example.com')
  await git(tree, 'config', 'user.name', 'Test')
  await git(tree, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(tree, 'a.txt'), 'one\n')
  await git(tree, 'add', '-A')
  await git(tree, 'commit', '--quiet', '-m', 'first')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(tree, { recursive: true, force: true })
})

const DR = { at: '2026-01-01T00:00:00Z', file: 'decision-requests/1.md' }
const refusal = (promise: Promise<unknown>) => promise.catch((caught: unknown) => caught)

describe('factory rewrite', () => {
  test('is refused when the job has no Decision Request', async () => {
    saveJob(root, makeJob({ worktree: tree }))
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'x\n')
    expect(await refusal(rewrite(root, 7, 'https://example.com/c'))).toBeInstanceOf(Refusal)
    expect(loadJob(root, 7)?.rewrites).toEqual([])
  })

  test('is refused without the note citing the authorization', async () => {
    saveJob(root, makeJob({ worktree: tree, decisionRequests: [DR] }))
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'x\n')
    expect(await refusal(rewrite(root, 7, '  '))).toBeInstanceOf(Refusal)
  })

  test('is refused when a file other than an acceptance test changed', async () => {
    saveJob(root, makeJob({ worktree: tree, decisionRequests: [DR] }))
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'x\n')
    writeFileSync(join(tree, 'a.txt'), 'two\n')
    const error = await refusal(rewrite(root, 7, 'https://example.com/c'))
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('a.txt')
  })

  test('commits the acceptance tests and records the rewrite', async () => {
    saveJob(root, makeJob({ worktree: tree, decisionRequests: [DR] }))
    mkdirSync(join(tree, 'apps/web/e2e'), { recursive: true })
    writeFileSync(join(tree, 'apps/web/e2e/a.spec.ts'), 'x\n')
    const job = await rewrite(root, 7, 'https://example.com/c')
    const head = await git(tree, 'rev-parse', 'HEAD')
    expect(job.rewrites[0]).toMatchObject({ commit: head, note: 'https://example.com/c' })
    expect(job.cliCommits).toContain(head)
    expect(await git(tree, 'log', '-1', '--format=%B')).toContain('Factory-Job: #7')
  })
})
