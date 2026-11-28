import { afterEach, describe, expect, test } from 'bun:test'
import { readEvents } from '../events.ts'
import { guardJob, SESSION, type GuardJob } from '../guard-fixture.ts'
import { loadJob } from '../job.ts'
import { confirm } from './confirm.ts'
import { hookAnswer } from './hook-answer.ts'

let fixture: GuardJob | undefined
const blocked = () =>
  (fixture = guardJob({
    sealed: false,
    job: { state: 'blocked', decisionRequests: [{ at: '2026-01-01T00:00:00Z', file: 'd/1.md' }] },
  }))
afterEach(() => fixture?.cleanup())

const QUESTION = 'Which way should the build go?'

/** What Claude Code gives the PostToolUse hook after the user answered an AskUserQuestion. */
const postToolUse = (
  f: GuardJob,
  answers: Record<string, string>,
  extra: Record<string, unknown> = {},
) =>
  hookAnswer(
    f.root,
    JSON.stringify({
      session_id: SESSION,
      hook_event_name: 'PostToolUse',
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: QUESTION }] },
      tool_response: { questions: [{ question: QUESTION }], answers, annotations: {} },
      ...extra,
    }),
  )

const ask = (f: GuardJob, input: object, who: Parameters<GuardJob['guard']>[0] = null) =>
  f.guard(who, 'AskUserQuestion', input)

describe('FI-028: the user answers through their own reply, and no tool call writes it', () => {
  test('the orchestrator asks; the hook records the reply as the job state and the log', () => {
    const f = blocked()
    expect(ask(f, { questions: [{ question: QUESTION, header: 'Build', options: [] }] })).toBeNull()
    postToolUse(f, { [QUESTION]: 'Option A (Recommended)' })
    const job = loadJob(f.root, 7)!
    expect(job.answers).toEqual([
      {
        request: 1,
        at: expect.any(String),
        text: 'Option A (Recommended)',
        question: QUESTION,
        cited: false,
      },
    ])
    const answered = readEvents(f.root, 7).find((event) => event.kind === 'answered')
    expect(answered?.detail).toEqual({ request: 1, channel: 'question' })
  })

  test("the user's own words and notes are kept", () => {
    const f = blocked()
    postToolUse(
      f,
      { [QUESTION]: 'Do neither: split the job' },
      {
        tool_response: {
          answers: { [QUESTION]: 'Do neither: split the job' },
          annotations: { [QUESTION]: { notes: 'cut the e2e part' } },
        },
      },
    )
    expect(loadJob(f.root, 7)!.answers[0]?.text).toBe(
      'Do neither: split the job\nNotes: cut the e2e part',
    )
  })

  test('the reply may arrive in the input, and only a reply counts', () => {
    const f = blocked()
    postToolUse(f, {}, { tool_response: 'cancelled' })
    expect(loadJob(f.root, 7)!.answers).toEqual([])
    postToolUse(f, {}, { tool_response: undefined, tool_input: { answers: { [QUESTION]: 'B' } } })
    expect(loadJob(f.root, 7)!.answers[0]?.text).toBe('B')
  })

  test('one answer per request, and none from an agent, a job that waits for nothing or another tool', () => {
    const f = blocked()
    postToolUse(f, { [QUESTION]: 'first' })
    postToolUse(f, { [QUESTION]: 'second' })
    expect(loadJob(f.root, 7)!.answers.map((answer) => answer.text)).toEqual(['first'])
    const g = guardJob({ sealed: false })
    postToolUse(g, { [QUESTION]: 'building' })
    expect(loadJob(g.root, 7)!.answers).toEqual([])
    const h = blocked()
    postToolUse(h, { [QUESTION]: 'from an agent' }, { agent_id: 'b1', agent_type: 'factory-build' })
    postToolUse(h, { [QUESTION]: 'other tool' }, { tool_name: 'Bash' })
    postToolUse(h, { [QUESTION]: 'other session' }, { session_id: 'someone-else' })
    expect(loadJob(h.root, 7)!.answers).toEqual([])
  })

  test('a call that carries the reply is denied, so the model cannot answer for the user', () => {
    const f = blocked()
    const asked = [{ question: QUESTION, header: 'Build', options: [] }]
    expect(ask(f, { questions: asked, answers: { [QUESTION]: 'A' } })).toContain('answers')
    expect(ask(f, { questions: asked, annotations: {} })).toContain('annotations')
    expect(ask(f, { questions: asked })).toBeNull()
  })

  test('an agent has no AskUserQuestion, and `factory answer` stays the user’s', () => {
    const f = blocked()
    const build = { agent_id: 'b1', agent_type: 'factory-build' }
    expect(ask(f, { questions: [] }, build)).toContain('AskUserQuestion')
    expect(f.bash(null, 'bun run factory answer 7 yes', f.root)).toContain(
      '! bun run factory answer',
    )
  })
})

const asked = (f: GuardJob, action: 'clean' | 'abandon') => confirm(f.root, 7, action).questions[0]!
const reply = (f: GuardJob, question: string, answer: string) =>
  postToolUse(f, { [question]: answer }, { tool_input: { questions: [{ question }] } })

describe('FI-028: a clean runs only after the user said yes to the CLI’s question', () => {
  test('without a confirmation the guard denies clean and says what to do; the user’s own prompt fires no hook', () => {
    const f = blocked()
    const reason = f.bash(null, 'bun run factory clean 7 --abandon', f.root)
    expect(reason).toContain('factory confirm 7 abandon')
    expect(reason).toContain('AskUserQuestion')
    expect(f.bash(null, 'bun run factory clean 7', f.root)).toContain('factory confirm 7 clean')
  })

  test('the CLI words the question; the user’s yes allows one clean, and a second needs a new yes', () => {
    const f = blocked()
    const question = asked(f, 'abandon')
    expect(question.question).toContain('Abandon job #7')
    reply(f, question.question, question.options[0]!.label)
    expect(readEvents(f.root, 7).some((event) => event.kind === 'confirmation.recorded')).toBe(true)
    expect(f.bash(null, 'bun run factory clean 7 --abandon', f.root)).toBeNull()
    expect(readEvents(f.root, 7).some((event) => event.kind === 'confirmation.used')).toBe(true)
    expect(f.bash(null, 'bun run factory clean 7 --abandon', f.root)).toContain('confirm')
  })

  test('a yes to abandon is no yes to clean, a no declines, and a question the CLI did not write counts for nothing', () => {
    const f = blocked()
    const abandon = asked(f, 'abandon')
    reply(f, abandon.question, abandon.options[0]!.label)
    expect(f.bash(null, 'bun run factory clean 7', f.root)).toContain('confirm')
    const clean = asked(f, 'clean')
    reply(f, clean.question, 'No, keep it')
    expect(f.bash(null, 'bun run factory clean 7', f.root)).toContain('confirm')
    reply(f, 'Clean job #7? (the model’s own wording)', clean.options[0]!.label)
    expect(f.bash(null, 'bun run factory clean 7', f.root)).toContain('confirm')
  })

  test('the confirmation covers the orchestrator’s own job only, never an agent', () => {
    const f = blocked()
    const question = asked(f, 'clean')
    reply(f, question.question, question.options[0]!.label)
    expect(f.bash(null, 'bun run factory clean 8', f.root)).toContain('#7')
    expect(
      f.guard({ agent_id: 'b1', agent_type: 'factory-build' }, 'Bash', {
        command: 'bun run factory clean 7',
      }),
    ).toContain('orchestrator')
  })
})
