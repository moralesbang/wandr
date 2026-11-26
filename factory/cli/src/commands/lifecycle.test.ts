import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { loadJob, saveJob, stateDir } from '../job.ts'
import { git } from '../shell.ts'
import { record, Refusal } from './common.ts'
import { abandon, composeProjectOf, rewrite } from './lifecycle.ts'

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

describe('factory clean --abandon', () => {
  // A main checkout cloned from a bare origin, a job's worktree on its pushed branch, and fake gh
  // and docker on PATH that log every call and answer from environment variables.
  let base = ''
  let main = ''
  let worktree = ''
  let calls = ''
  const path = process.env.PATH
  const BRANCH = 'feat/7-add-a-thing'

  beforeEach(async () => {
    base = mkdtempSync(join(tmpdir(), 'factory-abandon-'))
    const origin = join(base, 'origin.git')
    main = join(base, 'main')
    await git(base, 'init', '--quiet', '--bare', '--initial-branch=main', origin)
    await git(base, 'clone', '--quiet', origin, main)
    for (const [key, value] of [
      ['user.email', 'test@example.com'],
      ['user.name', 'Test'],
      ['commit.gpgsign', 'false'],
    ] as const) {
      await git(main, 'config', key, value)
    }
    writeFileSync(join(main, 'a.txt'), 'one\n')
    await git(main, 'add', '-A')
    await git(main, 'commit', '--quiet', '-m', 'first')
    await git(main, 'push', '--quiet', 'origin', 'main')
    worktree = join(main, '.claude', 'worktrees', '7-add-a-thing')
    await git(main, 'worktree', 'add', '--quiet', '-b', BRANCH, worktree)
    await git(worktree, 'push', '--quiet', 'origin', BRANCH)
    saveJob(main, makeJob({ worktree, branch: BRANCH, state: 'blocked' }))
    record(main, 7, 'job.started')

    const bin = join(base, 'bin')
    mkdirSync(bin)
    calls = join(base, 'calls.log')
    const fake = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`)
      chmodSync(join(bin, name), 0o755)
    }
    fake('gh', 'case "$1 $2" in "pr list") echo "${FAKE_PRS:-[]}";; esac')
    // On `compose … down`, also log the job's last event: it must be written by then.
    fake(
      'docker',
      [
        'case "$1" in',
        '  ps|volume) echo "$FAKE_CONTAINERS";;',
        `  compose) echo "last event: $(tail -n1 '${join(stateDir(main, 7), 'events.jsonl')}')" >> "${calls}";;`,
        'esac',
      ].join('\n'),
    )
    process.env.PATH = `${bin}:${path}`
    process.env.FAKE_PRS = '[]'
    process.env.FAKE_CONTAINERS = ''
  })
  afterEach(() => {
    process.env.PATH = path
    delete process.env.FAKE_PRS
    delete process.env.FAKE_CONTAINERS
    rmSync(base, { recursive: true, force: true })
  })

  const log = () => (existsSync(calls) ? readFileSync(calls, 'utf8') : '')
  const remoteBranch = () => git(main, 'ls-remote', '--heads', 'origin', BRANCH)
  const localBranch = () => git(main, 'branch', '--list', BRANCH)

  test('is refused while the branch has an open PR, and changes nothing', async () => {
    process.env.FAKE_PRS = '[{"url":"https://example.com/pull/9","state":"OPEN"}]'
    const error = await refusal(abandon(main, 7))
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('https://example.com/pull/9')
    expect(existsSync(worktree)).toBe(true)
    expect(await localBranch()).not.toBe('')
    expect(await remoteBranch()).not.toBe('')
    expect(loadJob(main, 7)).not.toBeNull()
    expect(log()).not.toContain('docker')
    expect(log()).not.toContain('issue edit')
  })

  test('is refused when the PR merged: that job is cleaned, not abandoned', async () => {
    process.env.FAKE_PRS = '[{"url":"https://example.com/pull/9","state":"MERGED"}]'
    expect(await refusal(abandon(main, 7))).toBeInstanceOf(Refusal)
    expect(loadJob(main, 7)).not.toBeNull()
  })

  test('takes down the worktree stack, removes worktree, branches and state, and resets the label', async () => {
    process.env.FAKE_PRS = '[{"url":"https://example.com/pull/9","state":"CLOSED"}]'
    process.env.FAKE_CONTAINERS = 'abc123'
    await abandon(main, 7)

    expect(log()).toContain('docker compose -p 7-add-a-thing down --volumes --remove-orphans')
    expect(log()).toMatch(/last event: .*"kind":"job\.abandoned"/)
    expect(existsSync(worktree)).toBe(false)
    expect(await localBranch()).toBe('')
    expect(await remoteBranch()).toBe('')
    expect(existsSync(stateDir(main, 7))).toBe(false)
    expect(log()).toContain(
      'gh issue edit 7 --add-label factory:ready --remove-label factory:building --remove-label factory:blocked --remove-label factory:pr-open',
    )
    // The order the steps run in: the stack, then the label once everything else is gone.
    expect(log().indexOf('docker compose')).toBeLessThan(log().indexOf('gh issue edit'))
  })

  test('skips what is already gone: no stack, no worktree, no remote branch', async () => {
    await git(main, 'worktree', 'remove', '--force', worktree)
    await git(main, 'push', '--quiet', 'origin', '--delete', BRANCH)
    const done = await abandon(main, 7)
    expect(log()).not.toContain('docker compose')
    expect(await localBranch()).toBe('')
    expect(existsSync(stateDir(main, 7))).toBe(false)
    expect(log()).toContain('gh issue edit 7 --add-label factory:ready')
    expect(done).toContain('No compose stack of its own.')
  })

  test('never takes down the shared stack', async () => {
    process.env.FAKE_CONTAINERS = 'abc123'
    await git(main, 'worktree', 'remove', '--force', worktree)
    saveJob(main, makeJob({ worktree: join(base, 'elsewhere', 'wandr'), branch: BRANCH }))
    await abandon(main, 7)
    expect(log()).not.toContain('docker compose')
  })
})

describe('composeProjectOf', () => {
  test.each([
    // The stack job #13's worktree started before docker-compose.yml set `name: wandr`.
    [
      '/repo/.claude/worktrees/13-ux-give-wandr-a-favicon-and-app-icons',
      '13-ux-give-wandr-a-favicon-and-app-icons',
    ],
    ['/repo/.claude/worktrees/42-Fix.The_Thing', '42-fixthe_thing'],
    ['/Users/me/Projects/wandr', 'wandr'],
  ])('%s is compose project %s', (worktree, project) => {
    expect(composeProjectOf(worktree)).toBe(project)
  })
})
