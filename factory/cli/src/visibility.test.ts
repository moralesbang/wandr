import { describe, expect, test } from 'bun:test'
import { classifyRead, classifyWrite, type Target } from './visibility.ts'

const repo = (path: string): Target => ({ area: 'repo', path })
const job = (path: string): Target => ({ area: 'job', path })
const allowed = { ok: true } as const

describe('classifyWrite: the test agent', () => {
  test('may write an acceptance test', () => {
    expect(classifyWrite('factory-test', repo('apps/api/src/walks.acceptance.test.ts'))).toEqual(
      allowed,
    )
  })

  test('may write acceptance.md in the job folder', () => {
    expect(classifyWrite('factory-test', job('acceptance.md'))).toEqual(allowed)
  })

  test.each(['turbo.json', 'knowledge/standards/testing.md', '.github/workflows/ci.yml'])(
    'may not write the rule path %s',
    (path) => {
      expect(classifyWrite('factory-test', repo(path)).ok).toBe(false)
    },
  )

  test('may not write build-notes.md', () => {
    expect(classifyWrite('factory-test', job('build-notes.md')).ok).toBe(false)
  })
})

describe('classifyWrite: the build agent', () => {
  test('may write source', () => {
    expect(classifyWrite('factory-build', repo('apps/api/src/walks.ts'))).toEqual(allowed)
  })

  test('may write build-notes.md in the job folder', () => {
    expect(classifyWrite('factory-build', job('build-notes.md'))).toEqual(allowed)
  })

  test('may not write an acceptance test', () => {
    expect(classifyWrite('factory-build', repo('apps/api/src/walks.acceptance.test.ts')).ok).toBe(
      false,
    )
  })

  test('may not write a rule path', () => {
    expect(classifyWrite('factory-build', repo('.oxlintrc.json')).ok).toBe(false)
  })

  test("may not write the reviewers' reports", () => {
    expect(classifyWrite('factory-build', job('reviews/1.evaluator.md')).ok).toBe(false)
  })
})

describe('classifyWrite: the reviewers', () => {
  test('the evaluator may write its blind pass and its final report', () => {
    expect(classifyWrite('factory-evaluator', job('reviews/1.evaluator.blind.md'))).toEqual(allowed)
    expect(classifyWrite('factory-evaluator', job('reviews/2.evaluator.md'))).toEqual(allowed)
  })

  test('the test reviewer may write its own report', () => {
    expect(classifyWrite('factory-test-reviewer', job('reviews/1.test-reviewer.md'))).toEqual(
      allowed,
    )
  })

  test("the evaluator may not write the test reviewer's report", () => {
    expect(classifyWrite('factory-evaluator', job('reviews/1.test-reviewer.md')).ok).toBe(false)
  })

  test('a reviewer may not write in the repo', () => {
    expect(classifyWrite('factory-evaluator', repo('apps/api/src/walks.ts')).ok).toBe(false)
  })
})

describe('classifyWrite: everyone', () => {
  test('an unknown agent is denied', () => {
    expect(classifyWrite('general-purpose', repo('apps/api/src/walks.ts')).ok).toBe(false)
  })

  test('no agent may write outside the worktree and the job folder', () => {
    expect(classifyWrite('factory-build', { area: 'outside', path: '/tmp/x.ts' }).ok).toBe(false)
  })
})

describe('classifyRead', () => {
  const before = { blindPassWritten: false }
  const after = { blindPassWritten: true }

  test.each(['factory-evaluator', 'factory-test-reviewer'] as const)(
    '%s reads the AC map before its blind pass',
    (agent) => {
      expect(classifyRead(agent, { area: 'job', path: 'acceptance.md' }, before).ok).toBe(true)
    },
  )

  test('the test agent reading implementation source is a breach', () => {
    expect(classifyRead('factory-test', repo('apps/api/src/walks.ts'), before).ok).toBe(false)
  })

  test('the test agent reading a public contract is fine', () => {
    expect(classifyRead('factory-test', repo('packages/contract/src/walk.ts'), before).ok).toBe(
      true,
    )
  })

  test('the build agent reading the repo is fine', () => {
    expect(classifyRead('factory-build', repo('apps/api/src/walks.ts'), before).ok).toBe(true)
  })

  test("the build agent reading a reviewer's blind pass is a breach", () => {
    expect(classifyRead('factory-build', job('reviews/1.evaluator.blind.md'), before).ok).toBe(
      false,
    )
  })

  test('a reviewer reading build-notes before its blind pass is a breach', () => {
    expect(classifyRead('factory-evaluator', job('build-notes.md'), before).ok).toBe(false)
  })

  test('a reviewer reading build-notes after its blind pass is fine', () => {
    expect(classifyRead('factory-evaluator', job('build-notes.md'), after).ok).toBe(true)
  })

  test("a reviewer reading the other reviewer's report is a breach", () => {
    expect(classifyRead('factory-evaluator', job('reviews/1.test-reviewer.md'), after).ok).toBe(
      false,
    )
  })

  test('any read outside the worktree and the job folder is a breach', () => {
    expect(
      classifyRead('factory-build', { area: 'outside', path: '/Users/x/other.ts' }, after).ok,
    ).toBe(false)
  })
})

describe('sandboxes: each reviewer owns its own', () => {
  const before = { blindPassWritten: false }

  test.each([
    ['factory-evaluator', 'sandbox/evaluator/apps/web/public/manifest.webmanifest'],
    ['factory-test-reviewer', 'sandbox/test-reviewer/apps/api/src/app.ts'],
  ] as const)('%s may write and read anywhere in its own sandbox: %s', (agent, path) => {
    expect(classifyWrite(agent, job(path))).toEqual(allowed)
    expect(classifyRead(agent, job(path), before).ok).toBe(true)
  })

  test.each([
    ['factory-evaluator', 'sandbox/test-reviewer/apps/web/public/manifest.webmanifest'],
    ['factory-test-reviewer', 'sandbox/evaluator/apps/api/src/app.ts'],
    ['factory-evaluator', 'sandbox/evaluator-other/x.ts'],
    ['factory-build', 'sandbox/evaluator/apps/api/src/app.ts'],
  ] as const)("%s may neither write nor read another's sandbox: %s", (agent, path) => {
    expect(classifyWrite(agent, job(path)).ok).toBe(false)
    expect(classifyRead(agent, job(path), before).ok).toBe(false)
  })
})

describe('classifyRead: what a reviewer sees only after its blind pass', () => {
  const before = { blindPassWritten: false }
  const after = { blindPassWritten: true }

  // Each of these repeats or cites the build agent's reasoning: a Decision Request restates the
  // escalation from the build notes, and an earlier round's final reports and findings were written
  // after reading them.
  test.each([
    ['factory-evaluator', 'build-notes.md'],
    ['factory-evaluator', 'decision-requests/1.md'],
    ['factory-test-reviewer', 'decision-requests/1.posted.md'],
    ['factory-evaluator', 'reviews/1.findings.md'],
    ['factory-evaluator', 'reviews/1.evaluator.md'],
    ['factory-test-reviewer', 'reviews/1.test-reviewer.md'],
    ['factory-evaluator', 'diagnosis.md'],
    ['factory-test-reviewer', 'summary.md'],
  ] as const)('%s reading %s: a breach before, fine after', (agent, path) => {
    const early = classifyRead(agent, job(path), before)
    expect(early.ok).toBe(false)
    expect(early.ok ? '' : early.reason).toContain('before writing its blind first pass')
    expect(classifyRead(agent, job(path), after).ok).toBe(true)
  })

  test.each([
    ['factory-evaluator', 'reviews/1.evaluator.blind.md'],
    ['factory-test-reviewer', 'reviews/2.test-reviewer.blind.md'],
  ] as const)('%s reads its own blind passes from the start: %s', (agent, path) => {
    expect(classifyRead(agent, job(path), before).ok).toBe(true)
  })
})

describe('the diagnosis agent', () => {
  const before = { blindPassWritten: false }

  test.each([
    repo('apps/web/src/main.ts'),
    job('build-notes.md'),
    job('checks/1.log'),
    job('reviews/1.findings.md'),
    job('reviews/1.evaluator.md'),
    job('decision-requests/1.md'),
    job('issue.md'),
  ])('reads %j from its start', (target) => {
    expect(classifyRead('factory-diagnose', target, before).ok).toBe(true)
  })

  test('writes diagnosis.md', () => {
    expect(classifyWrite('factory-diagnose', job('diagnosis.md'))).toEqual(allowed)
  })

  test.each([job('build-notes.md'), job('reviews/1.findings.md'), repo('apps/web/src/main.ts')])(
    'writes nothing else: %j',
    (target) => {
      expect(classifyWrite('factory-diagnose', target).ok).toBe(false)
    },
  )
})

describe('rulings', () => {
  test('the test reviewer writes a ruling', () => {
    expect(classifyWrite('factory-test-reviewer', job('rulings/2.md'))).toEqual(allowed)
  })

  test.each([
    ['factory-evaluator', 'rulings/2.md'],
    ['factory-build', 'rulings/2.md'],
    ['factory-test', 'rulings/2.md'],
    ['factory-test-reviewer', 'rulings/notes.md'],
  ])('%s may not write %s', (agent, path) => {
    expect(classifyWrite(agent, job(path)).ok).toBe(false)
  })
})

describe('classifyRead: a verifier', () => {
  const before = { blindPassWritten: false, verifying: true }

  test.each([
    ['factory-evaluator', 'reviews/1.findings.md'],
    ['factory-evaluator', 'reviews/1.evaluator.md'],
    ['factory-test-reviewer', 'reviews/1.test-reviewer.md'],
  ] as const)('%s reads %s without a blind pass', (agent, path) => {
    expect(classifyRead(agent, job(path), before).ok).toBe(true)
  })

  test.each([
    ['factory-evaluator', 'build-notes.md'],
    ['factory-evaluator', 'reviews/1.test-reviewer.md'],
    ['factory-test-reviewer', 'decision-requests/1.md'],
  ] as const)('%s still may not read %s', (agent, path) => {
    expect(classifyRead(agent, job(path), before).ok).toBe(false)
  })

  test('the same read is a breach when the reviewer is not verifying', () => {
    expect(
      classifyRead('factory-evaluator', job('reviews/1.findings.md'), { blindPassWritten: false })
        .ok,
    ).toBe(false)
  })

  test('verifying excuses nothing outside the job folder', () => {
    expect(
      classifyRead(
        'factory-evaluator',
        { area: 'outside', path: '/x/reviews/1.findings.md' },
        before,
      ).ok,
    ).toBe(false)
  })
})
