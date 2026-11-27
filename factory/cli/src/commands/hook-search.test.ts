// B5: a reviewer that must not read the job's folder yet (a verifier before its final report, a
// sealed reviewer before its blind pass) can't search a tree that contains it either. `rg` and
// `grep` from the worktree root skip the gitignored folder, as does the Grep tool; `find` and the
// other walkers don't, so they stay out of any folder above the job's folder.

import { afterEach, describe, expect, test } from 'bun:test'
import { EVAL, EXPLORE, TR, guardJob, type GuardJob } from '../guard-fixture.ts'

let j: GuardJob
afterEach(() => j.cleanup())

const w = () => j.worktree
const h = () => j.handoff

/** A verify pass planned for the test reviewer, the evaluator's approval carried: no seal. */
const verifier = () =>
  guardJob({ sealed: false, plan: { evaluator: 'carry', 'test-reviewer': 'verify' } })
/** Pass 2 sealed for both reviewers' blind passes. */
const blind = () => guardJob({ sealed: true })

describe.each([
  ['a verifier before its final report', verifier, TR],
  ['a sealed reviewer before its blind pass', blind, EVAL],
])('B5: %s', (_name, make, who) => {
  test.each([
    (x: GuardJob) =>
      x.guard(who, 'Grep', { pattern: '.', path: x.handoff, output_mode: 'content' }),
    (x: GuardJob) => x.guard(who, 'Grep', { pattern: '.', path: `${x.handoff}/reviews` }),
    (x: GuardJob) => x.guard(who, 'Glob', { pattern: '**/*', path: x.handoff }),
    (x: GuardJob) => x.bash(who, `grep -r icon ${x.handoff}`),
    (x: GuardJob) => x.bash(who, 'grep -rn . factory/.jobs/7'),
    (x: GuardJob) => x.bash(who, 'rg icon factory/.jobs/7'),
    (x: GuardJob) => x.bash(who, 'tar cf - factory/.jobs/7 | tar xOf -'),
    (x: GuardJob) => x.bash(who, 'cp -r factory/.jobs/7 /tmp/copy'),
    (x: GuardJob) => x.bash(who, 'find factory/.jobs/7 -type f -exec cat {} +'),
    (x: GuardJob) => x.bash(who, 'du -a factory/.jobs/7'),
    (x: GuardJob) => x.bash(who, 'tree factory/.jobs/7'),
    (x: GuardJob) => x.bash(who, 'ls -R factory/.jobs/7'),
    (x: GuardJob) => x.bash(who, 'cd factory/.jobs/7 && grep -rn .'),
    (x: GuardJob) => x.bash(who, 'cd factory/.jobs/7 && find . -type f'),
    (x: GuardJob) => x.bash(who, 'cd factory/.jobs/7 && rg .'),
  ])('denies a search rooted in the job’s folder: #%#', (run) => {
    j = make()
    expect(run(j)).not.toBeNull()
  })

  test.each([
    'find . -name "*.ts" -exec cat {} +',
    'find factory -type f',
    'find factory/.jobs -type f',
    'find -name "*.ts"',
    'tar cf - .',
    'du -a .',
    'tree',
    'ls -R',
    'ls -R factory',
  ])('denies `%s` from above the job’s folder, and says where to scope find', (command) => {
    j = make()
    const reason = j.bash(who, command)
    expect(reason).toContain('apps/')
  })

  test.each([
    'rg icon factory',
    'rg icon',
    'rg icon .',
    'grep -rn icon .',
    'grep -rn icon apps',
    'grep -r icon factory',
    'find apps -name "*.ts"',
    'find packages -type f',
    'find apps/web/src -type f',
    'ls apps',
  ])('lets `%s` through: it skips the gitignored folder or stays out of it', (command) => {
    j = make()
    expect(j.bash(who, command)).toBeNull()
  })

  test('denies rg and grep once they are told to search ignored files', () => {
    j = make()
    expect(j.bash(who, 'rg --no-ignore --hidden icon .')).not.toBeNull()
    expect(j.bash(who, 'rg -uu icon .')).not.toBeNull()
    expect(j.bash(who, 'grep -rn --no-ignore-files icon .')).not.toBeNull()
  })

  test('lets the Grep and Glob tools search from the worktree root, and the job’s inputs', () => {
    j = make()
    expect(j.guard(who, 'Grep', { pattern: 'walk', glob: '*.ts' })).toBeNull()
    expect(j.guard(who, 'Grep', { pattern: 'walk', path: `${w()}/apps` })).toBeNull()
    expect(j.guard(who, 'Glob', { pattern: '**/*.test.ts' })).toBeNull()
    expect(j.guard(who, 'Grep', { pattern: 'x', path: `${h()}/checks` })).toBeNull()
    expect(j.bash(who, `find ${h()}/checks -name '*.log'`)).toBeNull()
    expect(
      j.bash(who, `find ${h()}/sandbox/${who.agent_type.replace('factory-', '')} -name x`),
    ).toBeNull()
  })

  test('the same search of an Explore run it launched is judged the same', () => {
    // An unsealed verifier's Explore can't be told from any other: the hook input names no parent.
    if (who === TR) return
    j = make()
    expect(j.bash(EXPLORE, 'find . -name "*.ts"')).not.toBeNull()
  })
})

describe('B5: once the reviewer may read the job’s folder, it may search it', () => {
  test('an evaluator whose blind pass is written finds from the root', () => {
    j = guardJob({ sealed: false })
    expect(j.bash(EVAL, 'find . -name "*.ts" -not -path "*/node_modules/*"')).toBeNull()
  })
})
