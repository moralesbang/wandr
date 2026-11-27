// The third adversarial review's F4, G1 and G2: no walk reaches the other reviewer's sandbox, a
// pending verifier's sealed names stay closed to every nested run, and the other reviewer's blind
// pass stays closed until the reader's own is written.

import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import {
  BUILD,
  DIAG,
  EVAL,
  EXPLORE,
  TEST,
  TR,
  guardJob,
  put,
  type GuardJob,
} from '../guard-fixture.ts'
import { writeBlindPass } from '../job-fixture.ts'

let j: GuardJob
afterEach(() => j.cleanup())

const OTHER = (h: string) => `${h}/reviews/2.test-reviewer.blind.md`
const BOTH = { evaluator: 'review', 'test-reviewer': 'review' }
const X = (command: string, role = 'evaluator') =>
  `bun run factory sandbox exec 7 ${role} -- ${command}`

// What a walk from the job's folder, or from the sandboxes' folder, reaches: the other reviewer's
// evidence. rg and grep from the worktree root skip the gitignored job folder, so they stay.
const WALKS = [
  'rg mutated factory/.jobs/7/sandbox',
  'grep -rn mutated factory/.jobs/7/sandbox',
  'rg mutated factory/.jobs/7',
  'grep -rn mutated factory/.jobs/7',
  'rg mutated factory/.jobs',
  'rg mutated factory/.jobs/7/sandbox/evaluator/..',
  'cd factory/.jobs/7/sandbox && rg mutated .',
  'cd factory/.jobs/7/sandbox && grep -rn mutated .',
  'cd factory/.jobs/7/sandbox/evaluator && rg mutated ..',
  'ls -R factory/.jobs/7/sandbox',
  'find factory/.jobs/7/sandbox -name walks.ts',
  'find factory/.jobs/7 -name walks.ts',
  'tar cf - factory/.jobs/7/sandbox',
  'du -a factory/.jobs/7/sandbox',
  'cat factory/.jobs/7/sandbox/*/apps/api/src/routes/walks.ts',
  'cat factory/.jobs/*/sandbox/test-reviewer/apps/api/src/routes/walks.ts',
]

describe('F4: a reviewer’s walk never reaches the other reviewer’s sandbox', () => {
  test.each(WALKS)('denies the evaluator `%s`, sealed or not', (command) => {
    for (const sealed of [true, false]) {
      j = guardJob({ sealed, plan: BOTH })
      put(`${j.handoff}/sandbox/test-reviewer/apps/api/src/routes/walks.ts`, 'mutated\n')
      expect(j.bash(EVAL, command)).not.toBeNull()
      j.cleanup()
    }
  })

  test.each([
    'rg mutated ..',
    'grep -r mutated ..',
    'ls -R ..',
    'find .. -name walks.ts',
    'cat ../test-reviewer/apps/api/src/routes/walks.ts',
    'perl -pe "" ../test-reviewer/apps/api/src/routes/walks.ts',
    'bun test ../test-reviewer/apps/api',
    'bun run ../test-reviewer/apps/api/src/routes/walks.ts',
    'bun run --cwd ../test-reviewer/apps/api test',
    'python3 -c "print(open(\'../test-reviewer/apps/api/src/routes/walks.ts\').read())"',
  ])('denies the evaluator `sandbox exec … -- %s`, judged from its own sandbox', (command) => {
    j = guardJob({ sealed: false, plan: BOTH })
    put(`${j.handoff}/sandbox/test-reviewer/apps/api/src/routes/walks.ts`, 'mutated\n')
    expect(j.bash(EVAL, X(command))).not.toBeNull()
  })

  test('denies the tools, whatever the path or the glob', () => {
    j = guardJob({ sealed: false, plan: BOTH })
    const sandboxes = `${j.handoff}/sandbox`
    for (const input of [
      { pattern: 'mutated', path: sandboxes },
      { pattern: 'mutated', path: sandboxes, glob: '*.ts' },
      { pattern: 'mutated', path: j.handoff },
    ]) {
      expect(j.guard(EVAL, 'Grep', input)).not.toBeNull()
      expect(j.guard(TR, 'Grep', input)).not.toBeNull()
    }
    const glob = (role: string) => ({
      pattern: 'mutated',
      path: j.worktree,
      glob: `factory/.jobs/7/sandbox/${role}/**`,
    })
    expect(j.guard(EVAL, 'Grep', glob('test-reviewer'))).not.toBeNull()
    expect(j.guard(TR, 'Grep', glob('evaluator'))).not.toBeNull()
    for (const input of [
      { pattern: '**/*.ts', path: sandboxes },
      { pattern: 'sandbox/**/*.ts', path: j.handoff },
      { pattern: '**/*.ts', path: j.handoff },
    ]) {
      expect(j.guard(EVAL, 'Glob', input)).not.toBeNull()
    }
  })

  test('lets a reviewer search the worktree, and walk its own sandbox', () => {
    j = guardJob({ sealed: false, plan: BOTH })
    for (const command of [
      'rg mutated .',
      'rg mutated',
      'grep -rn mutated .',
      'grep -rn mutated apps packages',
      'find apps -name walks.ts',
      'ls -R apps',
      'rg mutated factory/.jobs/7/sandbox/evaluator',
      'find factory/.jobs/7/sandbox/evaluator -name walks.ts',
      'ls factory/.jobs/7/sandbox',
      X('rg mutated .'),
      X('grep -r mutated apps'),
      X('ls ..'),
    ]) {
      expect(j.bash(EVAL, command)).toBeNull()
    }
    for (const who of [EVAL, TR]) {
      expect(j.guard(who, 'Grep', { pattern: 'x', path: j.worktree })).toBeNull()
      expect(j.guard(who, 'Grep', { pattern: 'x', glob: '*.ts' })).toBeNull()
      expect(j.guard(who, 'Glob', { pattern: '**/*.test.ts' })).toBeNull()
    }
    expect(
      j.guard(EVAL, 'Glob', { pattern: '**/*.ts', path: `${j.handoff}/sandbox/evaluator` }),
    ).toBeNull()
  })

  test('the test reviewer is judged the same way', () => {
    j = guardJob({ sealed: false, plan: BOTH })
    expect(j.bash(TR, 'rg mutated factory/.jobs/7/sandbox')).not.toBeNull()
    expect(j.bash(TR, 'rg mutated .')).toBeNull()
  })

  test.each([
    'find . -name x',
    'ls -R .',
    'rg mutated factory/.jobs/7/sandbox',
    'grep -rn mutated factory/.jobs/7',
    'find factory/.jobs/7/sandbox -name x',
  ])('denies a nested run or a worker `%s`: no walk from at or above the sandboxes', (command) => {
    j = guardJob({ sealed: false })
    for (const who of [EXPLORE, BUILD, TEST, DIAG]) expect(j.bash(who, command)).not.toBeNull()
  })

  test.each(['rg mutated .', 'grep -rn mutated .', 'find apps -name x', 'ls -R apps'])(
    'lets a nested run or a worker `%s`',
    (command) => {
      j = guardJob({ sealed: false })
      for (const who of [EXPLORE, BUILD, TEST, DIAG]) expect(j.bash(who, command)).toBeNull()
    },
  )

  test('lets a worker use Grep and Glob from the worktree root', () => {
    j = guardJob({ sealed: false })
    for (const who of [BUILD, TEST, DIAG]) {
      expect(j.guard(who, 'Grep', { pattern: 'x', path: j.worktree })).toBeNull()
      expect(j.guard(who, 'Glob', { pattern: '**/*.ts' })).toBeNull()
    }
  })

  test('lets a worker find from the worktree root while no reviewer made a sandbox', () => {
    j = guardJob({ sealed: false })
    rmSync(`${j.handoff}/sandbox`, { recursive: true })
    for (const who of [BUILD, TEST, DIAG]) expect(j.bash(who, 'find . -name x')).toBeNull()
  })
})

describe('G1: while a verifier is pending, no nested run reads the sealed names', () => {
  const VERIFY = { evaluator: 'carry', 'test-reviewer': 'verify' }
  const NAMES = [
    'build-notes.md',
    'decision-requests/1.md',
    'reviews/1.evaluator.md',
    'reviews/1.test-reviewer.md',
  ]

  test.each(NAMES)('denies %s to an Explore, the other reviewer and the workers', (name) => {
    j = guardJob({ sealed: false, plan: VERIFY })
    for (const who of [EXPLORE, EVAL, BUILD, TEST, DIAG]) {
      expect(j.guard(who, 'Read', { file_path: `${j.handoff}/${name}` })).not.toBeNull()
      expect(j.bash(who, `cat ${j.handoff}/${name}`)).not.toBeNull()
    }
  })

  test('denies a glob over them', () => {
    j = guardJob({ sealed: false, plan: VERIFY })
    expect(j.bash(EXPLORE, `cat ${j.handoff}/reviews/*.md`)).not.toBeNull()
  })

  test('the verifier still reads its own inputs, and nothing else sealed', () => {
    j = guardJob({ sealed: false, plan: VERIFY })
    expect(j.guard(TR, 'Read', { file_path: `${j.handoff}/reviews/1.findings.md` })).toBeNull()
    expect(j.guard(TR, 'Read', { file_path: `${j.handoff}/reviews/1.test-reviewer.md` })).toBeNull()
    expect(j.guard(TR, 'Read', { file_path: `${j.handoff}/build-notes.md` })).not.toBeNull()
    expect(j.guard(TR, 'Read', { file_path: `${j.handoff}/reviews/1.evaluator.md` })).not.toBeNull()
  })

  test('opens once the verifier’s final report is written', () => {
    j = guardJob({ sealed: false, plan: VERIFY })
    put(`${j.handoff}/reviews/2.test-reviewer.md`, 'Verdict: approve\n')
    for (const who of [EXPLORE, BUILD]) {
      expect(j.guard(who, 'Read', { file_path: `${j.handoff}/build-notes.md` })).toBeNull()
    }
  })

  test('is open when nobody verifies', () => {
    j = guardJob({ sealed: false, plan: { evaluator: 'carry', 'test-reviewer': 'carry' } })
    expect(j.guard(EXPLORE, 'Read', { file_path: `${j.handoff}/build-notes.md` })).toBeNull()
  })
})

describe('G2: the other reviewer’s blind pass stays closed until your own is written', () => {
  test('denies the evaluator every way to read the test reviewer’s blind pass', () => {
    j = guardJob({ plan: BOTH })
    put(OTHER(j.handoff), 'The test reviewer found: AC3 untested\n')
    expect(j.guard(EVAL, 'Read', { file_path: OTHER(j.handoff) })).not.toBeNull()
    expect(j.bash(EVAL, `cat ${OTHER(j.handoff)}`)).not.toBeNull()
    expect(j.bash(EVAL, 'cat factory/.jobs/7/reviews/*.blind.md')).not.toBeNull()
    expect(j.bash(EVAL, 'cat factory/.jobs/7/reviews/2.test-*')).not.toBeNull()
    expect(j.bash(EVAL, 'rg AC3 factory/.jobs/7/reviews')).not.toBeNull()
    expect(j.bash(EVAL, 'rg AC3 factory/.jobs/7')).not.toBeNull()
    expect(j.guard(EVAL, 'Grep', { pattern: 'AC3', path: OTHER(j.handoff) })).not.toBeNull()
    expect(j.guard(EVAL, 'Grep', { pattern: 'AC3', path: `${j.handoff}/reviews` })).not.toBeNull()
    expect(j.guard(EVAL, 'Glob', { pattern: 'reviews/*.blind.md', path: j.handoff })).not.toBeNull()
  })

  test('denies it unsealed too, and to a verifier that has no blind pass', () => {
    j = guardJob({ sealed: false, plan: { evaluator: 'review', 'test-reviewer': 'verify' } })
    put(`${j.handoff}/reviews/2.evaluator.blind.md`, 'blind\n')
    expect(
      j.guard(TR, 'Read', { file_path: `${j.handoff}/reviews/2.evaluator.blind.md` }),
    ).not.toBeNull()
    expect(j.bash(TR, `cat ${j.handoff}/reviews/2.evaluator.blind.md`)).not.toBeNull()
  })

  test('denies a nested run and a worker while the job is sealed', () => {
    j = guardJob({ plan: BOTH })
    put(OTHER(j.handoff), 'blind\n')
    for (const who of [EXPLORE, BUILD, DIAG]) {
      expect(j.guard(who, 'Read', { file_path: OTHER(j.handoff) })).not.toBeNull()
    }
  })

  test('lets the evaluator read its own blind pass, and the other’s once its own is written', () => {
    j = guardJob({ plan: BOTH })
    put(OTHER(j.handoff), 'blind\n')
    put(`${j.handoff}/reviews/2.evaluator.blind.md`, 'mine\n')
    expect(
      j.guard(EVAL, 'Read', { file_path: `${j.handoff}/reviews/2.evaluator.blind.md` }),
    ).toBeNull()
    writeBlindPass(j.root, 7, 2, 'evaluator')
    expect(j.guard(EVAL, 'Read', { file_path: OTHER(j.handoff) })).toBeNull()
    expect(j.bash(EVAL, `cat ${OTHER(j.handoff)}`)).toBeNull()
  })

  test('is open to everyone after the unseal', () => {
    j = guardJob({ sealed: false, plan: BOTH })
    put(OTHER(j.handoff), 'blind\n')
    put(`${j.handoff}/reviews/2.evaluator.blind.md`, 'mine\n')
    for (const who of [EXPLORE, BUILD, EVAL, TR]) {
      expect(
        j.guard(who, 'Read', { file_path: `${j.handoff}/reviews/2.evaluator.blind.md` }),
      ).toBeNull()
    }
  })
})
