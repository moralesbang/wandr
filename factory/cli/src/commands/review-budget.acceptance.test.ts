import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEvents } from '../events.ts'
import { EVAL, guardJob, type GuardJob } from '../guard-fixture.ts'
import type { Risk } from '../job.ts'
import {
  planRoles,
  SANDBOX_MINUTES,
  sandboxMinutes,
  type PlannedRoles,
  type PreviousPass,
} from '../review-plan.ts'
import { runInSandbox, type Sandbox } from '../sandbox.ts'
import { sandboxCommand, type ExecDeps } from './sandbox.ts'

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

/** A sandbox record for the role, as `factory sandbox` leaves it. */
function sandboxFor(f: GuardJob, role: string) {
  const sandbox: Sandbox = {
    role,
    path: tmpdir(),
    port: 3101,
    database: 'd',
    bucket: 'b',
    databaseUrl: 'postgres://x',
    createdAt: 'x',
  }
  mkdirSync(join(f.state, 'sandbox'), { recursive: true })
  writeFileSync(join(f.state, 'sandbox', `${role}.json`), JSON.stringify(sandbox))
}

/** A clock and a runner: each command takes the seconds given, and is cut at the limit it is handed. */
function clock() {
  let now = 0
  const limits: number[] = []
  const takes: number[] = []
  const deps: ExecDeps = {
    now: () => now,
    run: async (_sandbox, _argv, limit) => {
      limits.push(limit)
      const wants = (takes.shift() ?? 1) * 1000
      now += Math.min(wants, limit)
      return wants > limit ? 124 : 0
    },
  }
  return { deps, limits, takes }
}

const exec = (f: GuardJob, role = 'evaluator', deps?: ExecDeps) =>
  sandboxCommand(f.root, ['exec', '7', role, '--', 'bun', 'test'], deps)

describe('FI-031: a reviewer role spends a bounded time in the sandbox, per job and pass', () => {
  test.each([
    ['review', 'low', 3],
    ['review', 'normal', 6],
    ['review', 'high', 15],
    ['verify', 'low', 2],
    ['verify', 'normal', 3],
    ['verify', 'high', 8],
    ['ruling', 'low', 0],
    ['ruling', 'normal', 0],
    ['ruling', 'high', 0],
  ] as const)('%s at %s risk gets %i minutes', (task, risk, minutes) => {
    expect(SANDBOX_MINUTES[task][risk as Risk]).toBe(minutes)
  })

  test('the plan names the minutes: review, verify, a carry that runs nothing, a ruling that has none', () => {
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
    expect(sandboxMinutes(job as never, 'evaluator')).toBe(3)
    expect(sandboxMinutes(job as never, 'test-reviewer')).toBe(6)
    expect(sandboxMinutes({ ...job, rounds: 2 } as never, 'test-reviewer')).toBe(0)
    const carried = { reviews: [{ ...job.reviews[0], roles: { evaluator: 'carry' } }], rounds: 1 }
    expect(sandboxMinutes(carried as never, 'evaluator')).toBe(0)
  })

  test('each exec runs with the time left as its limit, and its duration goes in the log', async () => {
    const f = (fixture = guardJob({
      plan: { evaluator: 'review', 'test-reviewer': 'review' },
      sealed: false,
    }))
    sandboxFor(f, 'evaluator')
    const { deps, limits, takes } = clock()
    takes.push(100, 30)
    await exec(f, 'evaluator', deps)
    await exec(f, 'evaluator', deps)
    expect(limits).toEqual([360_000, 260_000])
    const logged = readEvents(f.root, 7).filter((event) => event.kind === 'sandbox.exec')
    expect(logged.map((event) => event.source)).toEqual(['cli', 'cli'])
    expect(logged.map((event) => event.detail)).toEqual([
      { role: 'evaluator', pass: 2, seconds: 100, exit: 0 },
      { role: 'evaluator', pass: 2, seconds: 30, exit: 0 },
    ])
  })

  test('one command that packs many steps is cut at the time left, and the next is refused', async () => {
    const f = (fixture = guardJob({
      plan: { evaluator: 'review', 'test-reviewer': 'review' },
      sealed: false,
    }))
    sandboxFor(f, 'evaluator')
    const { deps, limits, takes } = clock()
    takes.push(900)
    expect(await exec(f, 'evaluator', deps)).toBe(124)
    const refused = await exec(f, 'evaluator', deps).catch((error: unknown) => error)
    expect((refused as Error).message).toContain(
      'write your report with the evidence you have and list what you could not check as a finding',
    )
    expect(limits).toEqual([360_000])
  })

  test('the clock is per role and per pass, and a relaunched run inherits what was spent', async () => {
    const f = (fixture = guardJob({
      plan: { evaluator: 'review', 'test-reviewer': 'review' },
      sealed: false,
    }))
    sandboxFor(f, 'evaluator')
    sandboxFor(f, 'test-reviewer')
    // Spent in the previous pass: no part of this pass's budget.
    f.log({
      source: 'cli',
      kind: 'sandbox.exec',
      detail: { role: 'evaluator', pass: 1, seconds: 340 },
    })
    const { deps, limits, takes } = clock()
    takes.push(60, 10)
    await exec(f, 'evaluator', deps)
    await exec(f, 'test-reviewer', deps)
    expect(limits).toEqual([360_000, 360_000])
    // A new run of the evaluator (no state of its own) starts from the 60 seconds already spent.
    await exec(f, 'evaluator', deps)
    expect(limits[2]).toBe(300_000)
  })

  test('a ruling, asked when nothing is planned for the pass, has no time at all', async () => {
    const f = (fixture = guardJob({ sealed: false, rounds: 1, job: { reviews: [] } }))
    sandboxFor(f, 'test-reviewer')
    const { deps, limits } = clock()
    const refused = await exec(f, 'test-reviewer', deps).catch((error: unknown) => error)
    expect((refused as Error).message).toContain('budget')
    expect(limits).toEqual([])
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
