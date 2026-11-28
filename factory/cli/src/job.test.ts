import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canStartAnother,
  canTryRed,
  countAttempt,
  countRound,
  listJobs,
  loadJob,
  findJobBySession,
  mainRoot,
  reviewPass,
  saveJob,
} from './job.ts'
import { makeJob } from './job-fixture.ts'
import { git } from './shell.ts'

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-job-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('build attempts', () => {
  test('the 3rd attempt is counted', () => {
    const counted = countAttempt(makeJob({ attempts: 2 }))
    expect(counted.ok && counted.job.attempts).toBe(3)
  })

  test('a 4th attempt is refused', () => {
    expect(countAttempt(makeJob({ attempts: 3 })).ok).toBe(false)
  })
})

describe('rejected reds', () => {
  test('a 3rd rejected red is still followed by a refusal only afterwards', () => {
    expect(canTryRed(makeJob({ redRejections: 2 })).ok).toBe(true)
  })

  test('a red is refused once 3 rejections are recorded', () => {
    expect(canTryRed(makeJob({ redRejections: 3 })).ok).toBe(false)
  })
})

describe('review rounds', () => {
  test('the 3rd round is counted', () => {
    const counted = countRound(makeJob({ rounds: 2 }))
    expect(counted.ok && counted.job.rounds).toBe(3)
  })

  test('a 4th round is refused', () => {
    expect(countRound(makeJob({ rounds: 3 })).ok).toBe(false)
  })

  test('the review pass is one more than the rounds with findings', () => {
    expect(reviewPass({ rounds: 0 })).toBe(1)
    expect(reviewPass({ rounds: 2 })).toBe(3)
  })
})

describe('concurrent jobs', () => {
  test('a 4th building job is refused', () => {
    for (const number of [1, 2, 3]) saveJob(root, makeJob({ number }))
    expect(canStartAnother(listJobs(root)).ok).toBe(false)
  })

  test('a blocked or open-PR job does not count against the limit', () => {
    saveJob(root, makeJob({ number: 1 }))
    saveJob(root, makeJob({ number: 2 }))
    saveJob(root, makeJob({ number: 3, state: 'blocked' }))
    saveJob(root, makeJob({ number: 4, state: 'pr_open' }))
    expect(canStartAnother(listJobs(root)).ok).toBe(true)
  })
})

describe('job state on disk', () => {
  test('a saved job loads back unchanged', () => {
    const job = makeJob({ attempts: 2, redCommit: 'abc' })
    saveJob(root, job)
    expect(loadJob(root, job.number)).toEqual(job)
  })

  test('loading a job that was never started gives null', () => {
    expect(loadJob(root, 99)).toBeNull()
  })

  test('listJobs sorts by issue number', () => {
    saveJob(root, makeJob({ number: 12 }))
    saveJob(root, makeJob({ number: 3 }))
    expect(listJobs(root).map((job) => job.number)).toEqual([3, 12])
  })
})

// A job.json that doesn't parse (written by hand, or cut short) must not hide every other job from
// the guard: the guard finds a session's job through this list.
describe('a job that does not read', () => {
  test('listJobs skips it, logs it to hook-errors.log, and lists the rest', () => {
    saveJob(root, makeJob({ number: 7, session: 'job-session' }))
    mkdirSync(join(root, 'factory', '.jobs', '99'), { recursive: true })
    writeFileSync(join(root, 'factory', '.jobs', '99', 'job.json'), '{\n')
    expect(listJobs(root).map((job) => job.number)).toEqual([7])
    expect(findJobBySession(root, 'job-session')?.number).toBe(7)
    const log = readFileSync(join(root, 'factory', '.jobs', 'hook-errors.log'), 'utf8')
    expect(log).toContain('factory/.jobs/99/job.json')
  })

  test('saveJob replaces job.json whole and leaves no temporary file', () => {
    saveJob(root, makeJob({ number: 7 }))
    saveJob(root, makeJob({ number: 7, attempts: 2 }))
    expect(loadJob(root, 7)?.attempts).toBe(2)
    expect(readdirSync(join(root, 'factory', '.jobs', '7'))).toEqual(['job.json'])
    expect(existsSync(join(root, 'factory', '.jobs', '7', 'job.json'))).toBe(true)
  })
})

describe('mainRoot', () => {
  test('from a job worktree it is the main checkout', () => {
    expect(mainRoot('/Users/x/wandr/.claude/worktrees/7-add/factory/cli/src')).toBe(
      '/Users/x/wandr',
    )
  })

  test('from the main checkout it is the repo root', () => {
    expect(mainRoot('/Users/x/wandr/factory/cli/src')).toBe('/Users/x/wandr')
  })
})

// Value record (T-009). Guarantee: a hook run from the copy in any other worktree (a session started
// there has $CLAUDE_PROJECT_DIR = that worktree) still finds the main checkout's jobs, which the
// freeze rule needs. Defect caught: a worktree outside .claude/worktrees taking itself for the main
// checkout and seeing no active job. No acceptance test gives it. Level: a real git repo.
describe('mainRoot from a worktree outside .claude/worktrees', () => {
  test('is the main checkout, found through git', async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-mainroot-')))
    try {
      const main = join(base, 'main')
      const other = join(base, 'elsewhere')
      await git(base, 'init', '--quiet', main)
      await git(main, 'config', 'user.email', 't@example.com')
      await git(main, 'config', 'user.name', 'T')
      await git(main, 'commit', '--quiet', '--allow-empty', '-m', 'first')
      await git(main, 'worktree', 'add', '--quiet', '-b', 'side', other)
      mkdirSync(join(other, 'factory', 'cli', 'src'), { recursive: true })
      expect(mainRoot(join(other, 'factory', 'cli', 'src'))).toBe(main)
      mkdirSync(join(main, 'factory', 'cli', 'src'), { recursive: true })
      expect(mainRoot(join(main, 'factory', 'cli', 'src'))).toBe(main)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('a job saved before the risk field', () => {
  test('loads as normal risk', () => {
    const { risk: _risk, ...old } = makeJob()
    mkdirSync(join(root, 'factory', '.jobs', '7'), { recursive: true })
    writeFileSync(join(root, 'factory', '.jobs', '7', 'job.json'), JSON.stringify(old))
    expect(loadJob(root, 7)?.risk).toBe('normal')
  })
})
