import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { loadJob, saveJob } from '../job.ts'
import { git } from '../shell.ts'
import { Refusal } from './common.ts'
import { red } from './red.ts'

const repo = join(import.meta.dir, '..', '..', '..', '..')

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

const FILE = 'packages/thing/sum.acceptance.test.ts'
/** An acceptance test that fails on an assertion, as a valid red does. */
const acceptanceTest = (assertion: string) =>
  `import { expect, test } from 'bun:test'\n\ntest('sorts', () => {\n  ${assertion}\n})\n`

describe('factory red on lint and format', () => {
  // A worktree with the repo's oxlint and oxfmt, a lint config with the categories CI enables, and
  // the repo's format config.
  let tree = ''
  beforeEach(async () => {
    tree = mkdtempSync(join(tmpdir(), 'factory-red-tree-'))
    await git(tree, 'init', '--quiet')
    await git(tree, 'config', 'user.email', 'test@example.com')
    await git(tree, 'config', 'user.name', 'Test')
    await git(tree, 'config', 'commit.gpgsign', 'false')
    symlinkSync(join(repo, 'node_modules'), join(tree, 'node_modules'))
    writeFileSync(
      join(tree, '.oxlintrc.json'),
      JSON.stringify({
        plugins: ['unicorn'],
        categories: { correctness: 'error', suspicious: 'error' },
      }),
    )
    writeFileSync(join(tree, '.oxfmtrc.json'), await Bun.file(join(repo, '.oxfmtrc.json')).text())
    writeFileSync(join(tree, '.gitignore'), 'node_modules\n')
    await git(tree, 'add', '-A')
    await git(tree, 'commit', '--quiet', '-m', 'first')
    mkdirSync(join(tree, 'packages', 'thing'), { recursive: true })
    saveJob(root, makeJob({ worktree: tree }))
  })
  afterEach(() => rmSync(tree, { recursive: true, force: true }))

  const write = (content: string) => writeFileSync(join(tree, FILE), content)

  test('accepts a red whose files pass lint and format', async () => {
    write(acceptanceTest('expect([3, 1].toSorted()).toEqual([1])'))
    const { job, problems } = await red(root, 7)
    expect(problems).toEqual([])
    expect(job.redCommit).toBe(await git(tree, 'rev-parse', 'HEAD'))
  }, 30_000)

  test('rejects a file that fails lint, naming the line, the rule and how to check it', async () => {
    write(acceptanceTest('expect([3, 1].sort()).toEqual([1])'))
    const { job, problems } = await red(root, 7)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toStartWith(`${FILE}:4:`)
    expect(problems[0]).toContain('no-array-sort')
    expect(problems[0]).toContain(`bunx oxlint ${FILE}`)
    expect(job.redCommit).toBeNull()
    expect(loadJob(root, 7)?.redRejections).toBe(1)
  }, 30_000)

  test('rejects a file that is not formatted, naming the command that formats it', async () => {
    write(acceptanceTest('expect([3,1].toSorted()).toEqual([1])'))
    const { job, problems } = await red(root, 7)
    expect(problems).toEqual([`${FILE}: not formatted — run \`bunx oxfmt ${FILE}\``])
    expect(job.redCommit).toBeNull()
    expect(loadJob(root, 7)?.redRejections).toBe(1)
  }, 30_000)

  test('reports lint, format and the run together, so one rejection names every fix', async () => {
    write(
      `import { expect, test } from 'bun:test'\n\ntest('sorts', () => {\n  expect([3,1].sort()).toEqual([1, 3])\n})\n`,
    )
    const { problems } = await red(root, 7)
    expect(problems.some((p) => p.includes('no-array-sort'))).toBe(true)
    expect(problems.some((p) => p.includes('not formatted'))).toBe(true)
    // The test passes, which rejects the red on its own.
    expect(problems).toHaveLength(3)
  }, 30_000)
})
