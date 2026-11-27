// One path for an acceptance-test fix: a fresh test reviewer rules whether the uncommitted change
// keeps the guarantee, on the exact diff the CLI hashed; `factory atfix --ruling` commits only that
// diff, only on a same-guarantee ruling. A changed guarantee goes to the user. The build agent never
// decides it.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { loadJob, saveJob } from '../job.ts'
import { git } from '../shell.ts'
import { Refusal } from './common.ts'
import { atfix } from './lifecycle.ts'
import { parseRuling, ruling } from './ruling.ts'

let root = ''
let tree = ''
let handoff = ''
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-ruling-root-'))
  tree = mkdtempSync(join(tmpdir(), 'factory-ruling-tree-'))
  handoff = join(tree, 'factory', '.jobs', '7')
  await git(tree, 'init', '--quiet')
  await git(tree, 'config', 'user.email', 'test@example.com')
  await git(tree, 'config', 'user.name', 'Test')
  await git(tree, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(tree, '.gitignore'), 'factory/.jobs/\n')
  writeFileSync(join(tree, 'x.acceptance.test.ts'), 'one\n')
  await git(tree, 'add', '-A')
  await git(tree, 'commit', '--quiet', '-m', 'first')
  saveJob(root, makeJob({ worktree: tree }))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(tree, { recursive: true, force: true })
})

const refusal = (run: () => Promise<unknown>) => run().catch((caught: unknown) => caught)
const rule = (m: number, verdict: string, diff: string) => {
  mkdirSync(join(handoff, 'rulings'), { recursive: true })
  writeFileSync(
    join(handoff, 'rulings', `${m}.md`),
    `Verdict: ${verdict}\nDiff: ${diff}\n\nThe selector changed; the check is the same.\n`,
  )
}

describe('parseRuling', () => {
  test.each([
    ['Verdict: same-guarantee\nDiff: abc', { verdict: 'same-guarantee', diff: 'abc' }],
    ['\nverdict:  changed-guarantee \nDiff:abc\n', { verdict: 'changed-guarantee', diff: 'abc' }],
    ['Verdict: approve\nDiff: abc', { verdict: null, diff: 'abc' }],
    ['Verdict: same-guarantee', { verdict: 'same-guarantee', diff: null }],
  ])('%j', (text, parsed) => {
    expect(parseRuling(text)).toEqual(parsed as ReturnType<typeof parseRuling>)
  })
})

describe('factory ruling', () => {
  test('is refused when no acceptance test changed', async () => {
    writeFileSync(join(tree, 'other.ts'), 'x\n')
    expect(await refusal(() => ruling(root, 7))).toBeInstanceOf(Refusal)
  })

  test("hashes the acceptance-test diff, new files included, and names the ruling's file", async () => {
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'two\n')
    writeFileSync(join(tree, 'y.acceptance.test.ts'), 'new\n')
    const first = await ruling(root, 7)
    expect(first.ruling).toBe(1)
    expect(first.diff).toMatch(/^[0-9a-f]{64}$/)
    expect(first.file).toBe(join(handoff, 'rulings', '1.md'))
    expect(existsSync(join(handoff, 'rulings'))).toBe(true)
    expect(loadJob(root, 7)?.rulings).toEqual([
      { ruling: 1, diff: first.diff, at: expect.any(String) },
    ])

    writeFileSync(join(tree, 'y.acceptance.test.ts'), 'newer\n')
    const second = await ruling(root, 7)
    expect(second.ruling).toBe(2)
    expect(second.diff).not.toBe(first.diff)
  })

  test('the hash leaves out files that are not acceptance tests', async () => {
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'two\n')
    const before = await ruling(root, 7)
    writeFileSync(join(tree, 'other.ts'), 'x\n')
    expect((await ruling(root, 7)).diff).toBe(before.diff)
  })
})

describe('factory atfix --ruling', () => {
  test('commits the fix the ruling judged same-guarantee, and records the ruling', async () => {
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'two\n')
    const { diff } = await ruling(root, 7)
    rule(1, 'same-guarantee', diff)
    const job = await atfix(root, 7, 'fix a selector', { ruling: 1 })
    expect(job.atfixes).toEqual([
      expect.objectContaining({
        note: 'fix a selector',
        ruling: 1,
        files: ['x.acceptance.test.ts'],
      }),
    ])
    expect(await git(tree, 'log', '-1', '--format=%B')).toContain('Factory-Ruling: 1')
  })

  test.each([
    ['no ruling at all', () => atfix(root, 7, 'fix a selector'), 'factory ruling 7'],
    [
      'a ruling the CLI never asked for',
      () => atfix(root, 7, 'fix', { ruling: 2 }),
      'rulings/2.md',
    ],
  ])('is refused with %s', async (_name, run, hint) => {
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'two\n')
    const error = await refusal(run)
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain(hint)
    expect(loadJob(root, 7)?.atfixes).toEqual([])
  })

  test('is refused while the reviewer has not written the ruling', async () => {
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'two\n')
    await ruling(root, 7)
    expect(await refusal(() => atfix(root, 7, 'fix', { ruling: 1 }))).toBeInstanceOf(Refusal)
  })

  test('a changed-guarantee ruling is refused and sent to a Decision Request', async () => {
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'two\n')
    const { diff } = await ruling(root, 7)
    rule(1, 'changed-guarantee', diff)
    const error = await refusal(() => atfix(root, 7, 'fix', { ruling: 1 }))
    expect((error as Refusal).message).toContain('factory block 7')
    expect(loadJob(root, 7)?.atfixes).toEqual([])
  })

  test('is refused when the diff changed after the ruling', async () => {
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'two\n')
    const { diff } = await ruling(root, 7)
    rule(1, 'same-guarantee', diff)
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'three\n')
    const error = await refusal(() => atfix(root, 7, 'fix', { ruling: 1 }))
    expect((error as Refusal).message).toContain('changed since')
    expect(loadJob(root, 7)?.atfixes).toEqual([])
  })

  test('an answered Decision Request raised on a changed-guarantee ruling needs no ruling and cites the answer', async () => {
    saveJob(
      root,
      makeJob({
        worktree: tree,
        decisionRequests: [
          { at: '2026-01-01T00:00:00Z', file: 'decision-requests/1.md', ruling: 1 },
        ],
        answers: [{ request: 1, at: '2026-01-02T00:00:00Z', text: 'Go', cited: false }],
      }),
    )
    writeFileSync(join(tree, 'x.acceptance.test.ts'), 'two\n')
    await atfix(root, 7, 'apply the answer')
    expect(await git(tree, 'log', '-1', '--format=%B')).toContain('Authorized-By: factory answer')
  })
})
