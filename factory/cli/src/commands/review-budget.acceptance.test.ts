import { afterEach, describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { EVAL, guardJob, TR, type GuardJob } from '../guard-fixture.ts'
import type { Risk } from '../job.ts'
import {
  planRoles,
  SANDBOX_BUDGET,
  sandboxBudget,
  type PlannedRoles,
  type PreviousPass,
} from '../review-plan.ts'
import { runInSandbox, type Sandbox } from '../sandbox.ts'

let fixture: GuardJob | undefined
afterEach(() => fixture?.cleanup())

const previous = (over: Partial<PreviousPass> = {}): PreviousPass => ({
  roles: { evaluator: 'review', 'test-reviewer': 'review' },
  risk: 'normal',
  findings: null,
  evaluatorApproved: false,
  ...over,
})

describe('FI-030: a pass after a fix reviews the fix, not everything', () => {
  // Job #15's pass 2: four files changed since pass 1, `main.tsx` (the file pass 1's finding 1 cited
  // at line 23) and three tests. It planned a full blind review for both reviewers.
  const JOB_15_PASS_2 = [
    'apps/web/src/main.tsx',
    'apps/web/src/main.test.tsx',
    'apps/web/e2e/titles.spec.ts',
    'apps/web/src/routes/not-found.test.tsx',
  ]
  const FINDINGS = '1. Missing title for the 404 route (apps/web/src/main.tsx:23).\n'

  test("job #15's pass 2 plans verify for both reviewers", () => {
    expect(
      planRoles({
        risk: 'normal',
        previous: previous({ findings: FINDINGS }),
        changed: JOB_15_PASS_2,
      }),
    ).toEqual({ evaluator: 'verify', 'test-reviewer': 'verify' })
  })

  test.each([
    [
      'a product file the findings never named changed',
      previous({ findings: FINDINGS }),
      ['apps/web/src/main.tsx', 'apps/web/src/other.tsx'],
    ],
    ['the findings file is missing', previous(), ['apps/web/src/main.tsx']],
    [
      'the risk rose since that pass',
      previous({ risk: 'low', findings: FINDINGS }),
      ['apps/web/src/main.tsx'],
    ],
  ] as [string, PreviousPass, string[]][])(
    'stays a full blind review when %s',
    (_why, before, changed) => {
      const plan = planRoles({ risk: 'normal', previous: before, changed })
      expect(plan['test-reviewer']).toBe('review')
    },
  )

  test('a named path without a line counts, and a test-only change keeps its rules', () => {
    expect(
      planRoles({
        risk: 'normal',
        previous: previous({ findings: 'see apps/web/src/main.tsx' }),
        changed: ['apps/web/src/main.tsx'],
      }),
    ).toEqual({ evaluator: 'verify', 'test-reviewer': 'verify' })
    expect(
      planRoles({
        risk: 'normal',
        previous: previous({ evaluatorApproved: true }),
        changed: ['apps/api/src/a.test.ts'],
      }),
    ).toEqual({ evaluator: 'carry', 'test-reviewer': 'verify' } as PlannedRoles)
  })
})

const exec = (n: number) =>
  `bun run factory sandbox exec 7 evaluator -- bun test apps/web/src/a${n}.test.ts`

describe('FI-031: a reviewer run spends a bounded number of sandbox commands', () => {
  test.each([
    ['review', 'low', 3],
    ['review', 'normal', 6],
    ['review', 'high', 12],
    ['verify', 'low', 2],
    ['verify', 'normal', 3],
    ['verify', 'high', 6],
    ['ruling', 'low', 0],
    ['ruling', 'normal', 0],
    ['ruling', 'high', 0],
  ] as const)('%s at %s risk may spend %i', (task, risk, budget) => {
    expect(SANDBOX_BUDGET[task][risk as Risk]).toBe(budget)
  })

  test('the plan names the budget: review, verify, a carry that runs nothing, and a ruling that has none', () => {
    const f = (fixture = guardJob({
      plan: { evaluator: 'verify', 'test-reviewer': 'review' },
      sealed: false,
    }))
    const job = {
      reviews: [
        {
          pass: 2,
          risk: 'normal' as Risk,
          roles: { evaluator: 'verify', 'test-reviewer': 'review' },
        },
      ],
      rounds: 1,
    }
    expect(sandboxBudget(job as never, 'evaluator')).toBe(3)
    expect(sandboxBudget(job as never, 'test-reviewer')).toBe(6)
    expect(sandboxBudget({ ...job, rounds: 2 } as never, 'test-reviewer')).toBe(0)
    expect(
      sandboxBudget(
        { reviews: [{ ...job.reviews[0], roles: { evaluator: 'carry' } }], rounds: 1 } as never,
        'evaluator',
      ),
    ).toBe(0)
    expect(f.root).toBeTruthy()
  })

  test('the command past the budget is denied with what to do, and the count is per run', () => {
    const f = (fixture = guardJob({
      plan: { evaluator: 'verify', 'test-reviewer': 'review' },
      sealed: false,
    }))
    for (let n = 1; n <= 3; n++) expect(f.bash(EVAL, exec(n))).toBeNull()
    const reason = f.bash(EVAL, exec(4))
    expect(reason).toContain('budget')
    expect(reason).toContain(
      'write your report with the evidence you have and list what you could not check as a finding',
    )
    expect(f.bash({ ...EVAL, agent_id: 'e2' }, exec(1))).toBeNull()
    // The test reviewer's own budget (review at normal: 6) is its own.
    for (let n = 1; n <= 6; n++)
      expect(
        f.bash(TR, `bun run factory sandbox exec 7 test-reviewer -- bun test a${n}`),
      ).toBeNull()
    expect(f.bash(TR, 'bun run factory sandbox exec 7 test-reviewer -- bun test a7')).toContain(
      'budget',
    )
  })

  test('one command with two execs spends two, and a denied command spends none', () => {
    const f = (fixture = guardJob({
      plan: { evaluator: 'verify', 'test-reviewer': 'review' },
      sealed: false,
    }))
    expect(f.bash(EVAL, `${exec(1)} && ${exec(2)}`)).toBeNull()
    expect(f.bash(EVAL, `${exec(3)} && ${exec(4)}`)).toContain('budget')
    expect(f.bash(EVAL, exec(5))).toBeNull()
    expect(f.bash(EVAL, exec(6))).toContain('budget')
  })

  test('a ruling run, asked between two passes when nothing is planned, has no sandbox commands', () => {
    // Round 1 was recorded, so pass 2 is under way and has no plan yet.
    const f = (fixture = guardJob({
      plan: { evaluator: 'review', 'test-reviewer': 'review' },
      sealed: false,
    }))
    f.cleanup()
    const between = (fixture = guardJob({
      sealed: false,
      rounds: 1,
      plan: undefined,
      job: { reviews: [] },
    }))
    expect(
      between.bash(TR, 'bun run factory sandbox exec 7 test-reviewer -- bun test a'),
    ).toContain('budget')
  })

  test.each([
    'turbo run lint typecheck test build',
    'bun run test',
    'bun run build',
    'bun run lint',
    'bun run e2e',
  ])(
    'a whole-suite run in the sandbox is denied, and `factory check` is named as the evidence: %s',
    (command) => {
      const f = (fixture = guardJob({
        plan: { evaluator: 'review', 'test-reviewer': 'review' },
        sealed: false,
      }))
      const reason = f.bash(EVAL, `bun run factory sandbox exec 7 evaluator -- ${command}`)
      expect(reason).toContain('factory check')
      expect(reason).toContain('whole suite')
    },
  )

  test.each([
    'bun run --cwd apps/web test',
    'bun run --filter @wandr/web test',
    'bun test apps/web/src/a.test.ts',
    'bunx playwright test apps/web/e2e/a.spec.ts',
  ])('and a targeted command is not: %s', (command) => {
    const f = (fixture = guardJob({
      plan: { evaluator: 'review', 'test-reviewer': 'review' },
      sealed: false,
    }))
    expect(f.bash(EVAL, `bun run factory sandbox exec 7 evaluator -- ${command}`)).toBeNull()
  })

  test('a command that outlives the timeout is killed and exits 124', async () => {
    const sandbox: Sandbox = {
      role: 'evaluator',
      path: tmpdir(),
      port: 3101,
      database: 'd',
      bucket: 'b',
      databaseUrl: 'postgres://x',
      createdAt: 'x',
    }
    const started = Date.now()
    expect(await runInSandbox(sandbox, ['sleep', '30'], 150)).toBe(124)
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
