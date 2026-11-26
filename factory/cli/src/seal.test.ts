// While the reviewers write their blind passes, what the build agent and earlier rounds wrote must be
// physically out of the worktree, so no command an agent runs there can read it; unsealing must put
// every file back exactly as it was. Job #13's reviewers read the Decision Request and the earlier
// final reports with `cat` before their blind passes.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { Refusal } from './commands/common.ts'
import { atfix, attempt, block, rewrite, round } from './commands/lifecycle.ts'
import { pr } from './commands/pr.ts'
import { start } from './commands/start.ts'
import { readEvents } from './events.ts'
import { installFakeGh, makeJob } from './job-fixture.ts'
import { loadJob, saveJob, stateDir } from './job.ts'
import { describeSeal, loadSeal, seal, unseal } from './seal.ts'

let root = ''
let handoff = ''

/** Every file under a folder, by its path relative to it, with its content. */
const snapshot = (dir: string): Record<string, string> => {
  const files: Record<string, string> = {}
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else files[relative(dir, path)] = readFileSync(path, 'utf8')
    }
  }
  if (existsSync(dir)) walk(dir)
  return files
}

const put = (path: string, text: string) => {
  mkdirSync(dirname(join(handoff, path)), { recursive: true })
  writeFileSync(join(handoff, path), text)
}

const SEALED = [
  'build-notes.md',
  'decision-requests/1.md',
  'decision-requests/draft.md',
  'diagnosis.md',
  'summary.md',
  'reviews/1.evaluator.md',
  'reviews/1.test-reviewer.md',
  'reviews/1.findings.md',
  'reviews/scratch.txt',
]
const KEPT = [
  'issue.md',
  'acceptance.md',
  'gate.json',
  'checks/2026-01-01.log',
  'reviews/1.evaluator.blind.md',
  'reviews/1.test-reviewer.blind.md',
]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-seal-'))
  const worktree = join(root, '.claude', 'worktrees', '7-add-a-thing')
  handoff = join(worktree, 'factory', '.jobs', '7')
  // Pass 2: one round with findings is behind it.
  saveJob(root, makeJob({ worktree, rounds: 1 }))
  for (const path of [...SEALED, ...KEPT]) put(path, `${path}\n`)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const BOTH = { pass: 2, roles: ['evaluator', 'test-reviewer'] }
const refusal = (run: () => unknown) => {
  try {
    run()
  } catch (caught) {
    return caught
  }
  return null
}
const settle = async (run: () => unknown) => {
  try {
    await run()
  } catch (caught) {
    return caught
  }
  return null
}
const writeBlindPasses = () => {
  put('reviews/2.evaluator.blind.md', 'blind\n')
  put('reviews/2.test-reviewer.blind.md', 'blind\n')
}

describe('factory seal', () => {
  test.each(SEALED)('moves %s out of the worktree, into the sealed store', (path) => {
    seal(root, 7, BOTH)
    expect(existsSync(join(handoff, path))).toBe(false)
    expect(readFileSync(join(stateDir(root, 7), 'sealed', path), 'utf8')).toBe(`${path}\n`)
  })

  test.each(KEPT)('leaves %s in the job folder', (path) => {
    seal(root, 7, BOTH)
    expect(readFileSync(join(handoff, path), 'utf8')).toBe(`${path}\n`)
  })

  test('records the seal in the job state and logs it', () => {
    seal(root, 7, BOTH)
    expect(loadSeal(root, 7)).toMatchObject({
      pass: 2,
      roles: ['evaluator', 'test-reviewer'],
      files: expect.arrayContaining([
        'build-notes.md',
        'decision-requests',
        'reviews/1.findings.md',
      ]),
    })
    expect(readEvents(root, 7).map((event) => event.kind)).toContain('sealed')
  })

  test('refuses a seal over an existing seal, and moves nothing', () => {
    seal(root, 7, BOTH)
    put('build-notes.md', 'written after the seal\n')
    const before = snapshot(handoff)
    expect(refusal(() => seal(root, 7, BOTH))).toBeInstanceOf(Refusal)
    expect(snapshot(handoff)).toEqual(before)
    expect(readFileSync(join(stateDir(root, 7), 'sealed', 'build-notes.md'), 'utf8')).toBe(
      'build-notes.md\n',
    )
  })

  test('refuses a pass other than the review pass under way', () => {
    expect(refusal(() => seal(root, 7, { ...BOTH, pass: 1 }))).toBeInstanceOf(Refusal)
    expect(existsSync(join(handoff, 'build-notes.md'))).toBe(true)
  })

  test('refuses a role that is not a reviewer', () => {
    expect(refusal(() => seal(root, 7, { pass: 2, roles: ['build'] }))).toBeInstanceOf(Refusal)
    expect(loadSeal(root, 7)).toBeNull()
  })
})

describe('factory unseal', () => {
  test('refuses until every sealed role wrote its blind pass, and keeps the files sealed', () => {
    seal(root, 7, BOTH)
    put('reviews/2.evaluator.blind.md', 'blind\n')
    const error = refusal(() => unseal(root, 7))
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('test-reviewer')
    expect(existsSync(join(handoff, 'build-notes.md'))).toBe(false)
    expect(loadSeal(root, 7)).not.toBeNull()
  })

  test('puts every file back exactly as it was, and clears the seal', () => {
    const before = snapshot(handoff)
    seal(root, 7, BOTH)
    writeBlindPasses()
    unseal(root, 7)
    expect(snapshot(handoff)).toEqual({
      ...before,
      'reviews/2.evaluator.blind.md': 'blind\n',
      'reviews/2.test-reviewer.blind.md': 'blind\n',
    })
    expect(existsSync(join(stateDir(root, 7), 'sealed'))).toBe(false)
    expect(loadSeal(root, 7)).toBeNull()
    expect(readEvents(root, 7).map((event) => event.kind)).toEqual(['sealed', 'unsealed'])
  })

  test("refuses, moving nothing, when a sealed file's place was taken meanwhile", () => {
    seal(root, 7, BOTH)
    writeBlindPasses()
    put('build-notes.md', 'written while sealed\n')
    const store = snapshot(join(stateDir(root, 7), 'sealed'))
    const error = refusal(() => unseal(root, 7))
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('build-notes.md')
    expect(snapshot(join(stateDir(root, 7), 'sealed'))).toEqual(store)
    expect(readFileSync(join(handoff, 'build-notes.md'), 'utf8')).toBe('written while sealed\n')
  })

  test('refuses a job that is not sealed', () => {
    expect(refusal(() => unseal(root, 7))).toBeInstanceOf(Refusal)
  })
})

describe('a sealed job never goes on without its notes', () => {
  let fake: ReturnType<typeof installFakeGh>
  beforeEach(() => {
    fake = installFakeGh(root)
  })
  afterEach(() => fake.restore())

  test.each([
    ['attempt', () => attempt(root, 7)],
    ['round', () => round(root, 7)],
    ['atfix', () => atfix(root, 7, 'a note')],
    ['rewrite', () => rewrite(root, 7, 'a note')],
    ['block', () => block(root, 7, join(root, 'dr.md'))],
    ['pr', () => pr(root, 7)],
  ] as const)('factory %s refuses, says to unseal, and changes nothing', async (_name, run) => {
    writeFileSync(join(root, 'dr.md'), '# Question\n')
    seal(root, 7, BOTH)
    const job = loadJob(root, 7)
    const error = await settle(run)
    expect(error).toBeInstanceOf(Refusal)
    expect((error as Refusal).message).toContain('factory unseal 7')
    expect(loadJob(root, 7)).toEqual(job)
    expect(existsSync(join(handoff, 'decision-requests'))).toBe(false)
    expect(fake.calls()).toBe('')
  })

  test('factory start resumes it in the new session, keeps it sealed and says what is missing', async () => {
    seal(root, 7, BOTH)
    put('reviews/2.evaluator.blind.md', 'blind\n')
    const job = await start(root, 7, 'session-2')
    expect(job.session).toBe('session-2')
    expect(existsSync(join(handoff, 'build-notes.md'))).toBe(false)
    const note = describeSeal(root, job)
    expect(note).toContain('reviews/2.test-reviewer.blind.md')
    expect(note).not.toContain('reviews/2.evaluator.blind.md')
    expect(note).toContain('factory unseal 7')
  })

  test('describeSeal says nothing about a job that is not sealed', () => {
    expect(describeSeal(root, makeJob())).toBeNull()
  })
})
