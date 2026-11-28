import { afterEach, describe, expect, test } from 'bun:test'
import { COST_STEP_USD, costAlarm, jobCost } from '../cost.ts'
import { readEvents } from '../events.ts'
import { guardJob, SESSION, type GuardJob } from '../guard-fixture.ts'
import { COST_ALARM_COMMANDS, requireCostAcknowledged } from './common.ts'
import { confirm } from './confirm.ts'
import { hookAnswer } from './hook-answer.ts'
import { usageTable } from './pr.ts'

let fixture: GuardJob | undefined
afterEach(() => fixture?.cleanup())

const usage = (usd: number) => ({
  messages: 1,
  models: { 'claude-opus-5-5': 1 },
  efforts: { high: 1 },
  tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
  usd,
  unpriced: [],
})

/** A run's usage as the Stop hooks log it; a later event of the same run replaces the earlier. */
const spend = (f: GuardJob, usd: number, agent?: { id: string; type: string }) =>
  f.log({ kind: 'usage', ...(agent ? { agent } : {}), detail: usage(usd) })

const BUILD = { id: 'build-run-1', type: 'factory-build' }

/** The user's reply to the question `factory confirm` printed, as the PostToolUse hook gets it. */
function reply(f: GuardJob, question: string, answer: string) {
  hookAnswer(
    f.root,
    JSON.stringify({
      session_id: SESSION,
      hook_event_name: 'PostToolUse',
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question }] },
      tool_response: { answers: { [question]: answer } },
    }),
  )
}

const ask = (f: GuardJob) => confirm(f.root, 7, 'cost').questions[0]!

describe('FI-032: the user is asked each further $5 a job costs, and nothing is cut', () => {
  test('the step is one constant', () => {
    expect(COST_STEP_USD).toBe(5)
  })

  test("the job's cost is each run's latest usage, as the PR cost table counts it", () => {
    const f = (fixture = guardJob({ sealed: false }))
    spend(f, 1.5)
    spend(f, 2, BUILD)
    spend(f, 3, BUILD)
    spend(f, 2.5)
    const events = readEvents(f.root, 7)
    expect(jobCost(events).usd).toBeCloseTo(5.5)
    expect(usageTable(events)).toContain('**$5.50**')
  })

  test('below $5 nothing is refused; at $5 the decision points are, with the amount and who spent it', () => {
    const f = (fixture = guardJob({ sealed: false }))
    spend(f, 4.99)
    expect(() => requireCostAcknowledged(f.root, 7)).not.toThrow()
    spend(f, 1, BUILD)
    expect(() => requireCostAcknowledged(f.root, 7)).toThrow('$5.99')
    expect(() => requireCostAcknowledged(f.root, 7)).toThrow('factory-build (build-r) $1.00')
    expect(() => requireCostAcknowledged(f.root, 7)).toThrow('factory confirm 7 cost')
    expect(() => requireCostAcknowledged(f.root, 7)).toThrow('lag by one turn')
  })

  test('the alarm stops the launch, review, round and attempt commands, and nothing else', () => {
    expect([...COST_ALARM_COMMANDS].toSorted()).toEqual(['attempt', 'launch', 'review', 'round'])
  })

  test("the user's yes acknowledges that threshold and the job goes on until the next", () => {
    const f = (fixture = guardJob({ sealed: false }))
    spend(f, 5.2)
    const question = ask(f)
    expect(question.question).toContain('$5.20')
    reply(f, question.question, question.options[0]!.label)
    expect(() => requireCostAcknowledged(f.root, 7)).not.toThrow()
    spend(f, 9.9)
    expect(() => requireCostAcknowledged(f.root, 7)).not.toThrow()
    spend(f, 10.1)
    expect(costAlarm(readEvents(f.root, 7))?.threshold).toBe(10)
    expect(() => requireCostAcknowledged(f.root, 7)).toThrow('past $10')
  })

  test('a no leaves the job refused, and a question the CLI did not word acknowledges nothing', () => {
    const f = (fixture = guardJob({ sealed: false }))
    spend(f, 5.5)
    const question = ask(f)
    reply(f, question.question, 'No, stop here')
    expect(() => requireCostAcknowledged(f.root, 7)).toThrow('past $5')
    reply(f, 'Keep going? (the model’s own wording)', question.options[0]!.label)
    expect(() => requireCostAcknowledged(f.root, 7)).toThrow('past $5')
  })

  test('the question exists only while a threshold is unacknowledged', () => {
    const f = (fixture = guardJob({ sealed: false }))
    spend(f, 2)
    expect(() => ask(f)).toThrow('no unacknowledged cost threshold')
  })

  test('the orchestrator may run `factory confirm 7 cost`, and the model cannot run `refreeze` or answer for the user', () => {
    const f = (fixture = guardJob({ sealed: false }))
    expect(f.bash(null, 'bun run factory confirm 7 cost', f.root)).toBeNull()
    expect(f.bash(null, 'bun run factory answer 7 yes', f.root)).toContain('answer')
  })
})
