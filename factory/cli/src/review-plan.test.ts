import { describe, expect, test } from 'bun:test'
import type { Risk } from './job.ts'
import { planRoles, type PlannedRoles, type PreviousPass } from './review-plan.ts'
import passes from './replay-fixtures/job13-review-passes.json'
import { effectiveRisk } from './risk.ts'

const both = (evaluator: string): PreviousPass => ({
  roles: { evaluator: 'review', 'test-reviewer': 'review' },
  evaluatorApproved: evaluator === 'approve',
})
const testReviewerOnly: PreviousPass = {
  roles: { 'test-reviewer': 'review' },
  evaluatorApproved: false,
}

const PRODUCT = ['apps/web/src/a.ts', 'apps/web/e2e/a.spec.ts']
const TESTS = ['apps/web/e2e/a.spec.ts', 'apps/api/src/b.test.ts']

describe('planRoles', () => {
  test.each([
    // risk, previous pass, changed since its HEAD, plan
    ['low', null, [], { 'test-reviewer': 'review' }],
    ['normal', null, [], { evaluator: 'review', 'test-reviewer': 'review' }],
    ['high', null, [], { evaluator: 'review', 'test-reviewer': 'review' }],
    ['normal', both('approve'), PRODUCT, { evaluator: 'review', 'test-reviewer': 'review' }],
    ['normal', both('changes'), PRODUCT, { evaluator: 'review', 'test-reviewer': 'review' }],
    ['low', testReviewerOnly, PRODUCT, { 'test-reviewer': 'review' }],
    ['normal', both('approve'), TESTS, { evaluator: 'carry', 'test-reviewer': 'verify' }],
    ['high', both('approve'), TESTS, { evaluator: 'carry', 'test-reviewer': 'verify' }],
    ['normal', both('changes'), TESTS, { evaluator: 'verify', 'test-reviewer': 'verify' }],
    ['normal', both('approve'), [], { evaluator: 'carry', 'test-reviewer': 'verify' }],
    ['low', testReviewerOnly, TESTS, { 'test-reviewer': 'verify' }],
    // Raised to normal since the last pass: the evaluator never judged this branch.
    ['normal', testReviewerOnly, TESTS, { evaluator: 'review', 'test-reviewer': 'verify' }],
  ] as [Risk, PreviousPass | null, string[], PlannedRoles][])(
    '%s risk, previous %j, changed %j',
    (risk, previous, changed, plan) => {
      expect(planRoles({ risk, previous, changed })).toEqual(plan)
    },
  )
})

describe('replay: job #13', () => {
  const [first, second] = passes.passes
  const risk = effectiveRisk('normal', first!.changedSinceBase!).risk

  test('was normal risk: its issue predates the field and its diff raised nothing', () => {
    expect(passes.declaredRisk).toBeNull()
    expect(effectiveRisk('normal', first!.changedSinceBase!)).toEqual({
      risk: 'normal',
      raisedBy: [],
    })
  })

  test('pass 1 is a full blind review by both reviewers', () => {
    expect(planRoles({ risk, previous: null, changed: [] })).toEqual({
      evaluator: 'review',
      'test-reviewer': 'review',
    })
  })

  test('pass 2, where only the acceptance test changed, is a test-reviewer verify and the evaluator approval carries', () => {
    expect(second!.ranAs).toEqual({ evaluator: 'review', 'test-reviewer': 'review' })
    const plan = planRoles({
      risk,
      previous: {
        roles: { evaluator: 'review', 'test-reviewer': 'review' },
        evaluatorApproved: first!.verdicts!.evaluator === 'approve',
      },
      changed: second!.changedSincePrevious!,
    })
    expect(plan).toEqual({ evaluator: 'carry', 'test-reviewer': 'verify' })
  })
})
