import { afterEach, describe, expect, test } from 'bun:test'
import { readEvents } from '../events.ts'
import { BUILD, guardJob, planLaunch, TR } from '../guard-fixture.ts'

let fixture: ReturnType<typeof guardJob> | undefined
const job = (launches: 'free' | 'strict' = 'strict') =>
  (fixture = guardJob({ sealed: false, launches }))
afterEach(() => fixture?.cleanup())

const PROMPT = { description: 'build', prompt: 'Build issue 7 in the worktree.' }

describe("FI-019: the guard holds the orchestrator to opus at high effort, from the session's own transcript", () => {
  test('a main session that ran opus at high effort acts', () => {
    const f = job()
    expect(f.bash(null, 'git status')).toBeNull()
    expect(
      f.guard(null, 'Write', { file_path: `${f.handoff}/summary.md`, content: 'x' }),
    ).toBeNull()
  })

  test.each([
    ['sonnet', 'claude-sonnet-5-5', 'high', 'model claude-sonnet-5-5, not opus'],
    ['medium effort', 'claude-opus-5-5', 'medium', 'effort medium, not high'],
  ])(
    'a session on %s is denied every call, with the commands that fix it',
    (_name, model, effort, said) => {
      const f = job()
      f.runAs(model, effort)
      for (const reason of [
        f.bash(null, 'git status'),
        f.guard(null, 'Read', { file_path: `${f.worktree}/apps/web/src/main.ts` }),
        f.guard(null, 'Agent', { subagent_type: 'Explore', ...PROMPT }),
      ]) {
        expect(reason).toContain(said)
        expect(reason).toContain('/model opus')
        expect(reason).toContain('/effort high')
      }
    },
  )

  test('the latest assistant message decides, so fixing the session fixes the job', () => {
    const f = job()
    f.runAs('claude-sonnet-5-5', 'medium')
    expect(f.bash(null, 'git status')).not.toBeNull()
    f.runAs('claude-opus-5-5', 'high')
    expect(f.bash(null, 'git status')).toBeNull()
  })

  test('a transcript the guard cannot read denies the call, as every call it cannot judge', () => {
    const f = job()
    f.runAs('<synthetic>', 'high')
    expect(f.bash(null, 'git status')).toContain("can't read the main session")
  })

  test('the status command stays readable at the wrong setting, and the subagents are not judged by it', () => {
    const f = job()
    f.runAs('claude-sonnet-5-5', 'medium')
    expect(f.bash(null, 'bun run factory status 7')).toBeNull()
    expect(f.bash(null, 'bun run factory status 7 && git push')).not.toBeNull()
    expect(f.bash(BUILD, 'git status')).toBeNull()
  })
})

const SONNET = { model: 'sonnet', effort: 'medium' }

/** `factory launch <n> <agent> --task <task>`: the plan, and the call that carries it out. */
const planned = (agent: string, task: string, model = 'sonnet', effort = 'medium') => {
  const plan = planLaunch(fixture?.root ?? '', agent, task, model, effort)
  return {
    subagent_type: agent,
    description: task,
    prompt: `${plan.header}\nDo the work.`,
    model,
    effort,
  }
}
const orchestrator = (call: object) => fixture?.guard(null, 'Agent', call) ?? null

describe('FI-019: the guard holds each launch to the plan `factory launch` logged, by id', () => {
  test('a launch that carries its plan goes through', () => {
    job()
    expect(orchestrator(planned('factory-build', 'build'))).toBeNull()
  })

  test('a launch with no header, a malformed one or an unknown plan id is denied', () => {
    job()
    const call = planned('factory-build', 'build')
    expect(orchestrator({ ...call, prompt: 'Do the work.' })).toContain('header')
    expect(orchestrator({ ...call, prompt: `Do the work.\n${call.prompt}` })).toContain('header')
    expect(
      orchestrator({ ...call, prompt: 'factory-launch: 7 factory-build build 1234' }),
    ).toContain('header')
    expect(
      orchestrator({ ...call, prompt: 'factory-launch: 7 factory-build build deadbeef\nx' }),
    ).toContain('not a plan of job #7')
    expect(
      orchestrator({
        ...call,
        prompt: call.prompt.replace('factory-launch: 7', 'factory-launch: 8'),
      }),
    ).toContain('not a plan of job #7')
  })

  test.each([
    ['another model', { model: 'opus' }, 'model'],
    ['another effort', { effort: 'high' }, 'effort'],
    ['no model', { model: undefined }, 'model'],
    ['no effort', { effort: undefined }, 'effort'],
    ['another agent type', { subagent_type: 'factory-test' }, 'agent'],
  ])('a launch with %s is denied, naming what differs from the plan', (_name, change, key) => {
    job()
    const reason = orchestrator({ ...planned('factory-build', 'build'), ...change })
    expect(reason).toContain(`differs from launch plan`)
    expect(reason).toContain(key)
    expect(reason).toContain('sonnet')
  })

  test("a ruling's plan cannot authorize a review: the task is part of the plan", () => {
    job()
    const ruling = planned('factory-test-reviewer', 'ruling', 'opus', 'low')
    const asReview = {
      ...ruling,
      prompt: ruling.prompt.replace('factory-test-reviewer ruling', 'factory-test-reviewer review'),
    }
    expect(orchestrator(asReview)).toContain('differs from launch plan')
    expect(orchestrator(asReview)).toContain('task')
    expect(orchestrator(ruling)).toBeNull()
  })

  test('one plan authorizes one launch: a used plan cannot authorize a later run', () => {
    job()
    const call = planned('factory-build', 'build')
    expect(orchestrator(call)).toBeNull()
    expect(orchestrator(call)).toContain('already used')
    expect(orchestrator(planned('factory-build', 'build'))).toBeNull()
    expect(
      readEvents(fixture?.root ?? '', 7).filter((e) => e.kind === 'launch.authorized'),
    ).toHaveLength(2)
  })

  test('the plan used up is the one the call names, whatever was planned after it', () => {
    job()
    const first = planned('factory-build', 'build')
    const second = planned('factory-build', 'build', 'opus', 'high')
    expect(orchestrator(second)).toBeNull()
    expect(orchestrator(first)).toBeNull()
  })

  test('a denied launch uses no plan', () => {
    job()
    const call = planned('factory-build', 'build')
    expect(orchestrator({ ...call, model: 'opus' })).not.toBeNull()
    expect(orchestrator(call)).toBeNull()
  })
})

describe('FI-024: a factory agent launches only an Explore subagent, on haiku', () => {
  const explore = { subagent_type: 'Explore', description: 'map', prompt: 'Find the routes.' }

  test.each([
    ['the build agent', BUILD],
    ['the test reviewer', TR],
  ])('%s may launch Explore on haiku', (_name, who) => {
    job()
    expect(fixture?.guard(who, 'Agent', { ...explore, model: 'haiku' })).toBeNull()
    expect(fixture?.guard(who, 'Task', { ...explore, model: 'haiku' })).toBeNull()
  })

  test.each([
    ['sonnet', { model: 'sonnet' }],
    ['opus', { model: 'opus' }],
    ['no model: the default is not relied on', {}],
  ])('Explore on %s is denied', (_name, extra) => {
    job()
    expect(fixture?.guard(TR, 'Agent', { ...explore, ...extra })).toContain('haiku')
  })

  test.each([
    ['general-purpose', 'general-purpose'],
    ['a factory agent', 'factory-build'],
    ['Plan', 'Plan'],
    ['no type', undefined],
  ])('a launch of %s from a factory agent is denied, whatever its model', (_name, type) => {
    job()
    for (const who of [BUILD, TR]) {
      expect(
        fixture?.guard(who, 'Agent', { ...explore, subagent_type: type, model: 'sonnet' }),
      ).toContain('only an Explore')
    }
  })
})

describe('FI-025: inside a job the orchestrator launches only factory agents with a plan, and Explore on haiku', () => {
  test('Explore on haiku goes through, on anything else it is denied', () => {
    job()
    const explore = { subagent_type: 'Explore', description: 'map', prompt: 'Find the routes.' }
    expect(orchestrator({ ...explore, model: 'haiku' })).toBeNull()
    expect(orchestrator({ ...explore, model: 'sonnet' })).toContain('haiku')
    expect(orchestrator(explore)).toContain('haiku')
  })

  test.each(['general-purpose', 'Plan', 'claude', 'statusline-setup', ''])(
    'a %s launch is denied, plan or not',
    (type) => {
      job()
      const call = { ...planned('factory-build', 'build'), subagent_type: type, ...SONNET }
      expect(orchestrator(call)).toContain('only the factory')
      expect(orchestrator({ ...call, isolation: 'worktree', run_in_background: true })).toContain(
        'only the factory',
      )
    },
  )

  test('it holds in every state the job is in, since the session stays bound to it', () => {
    for (const state of ['building', 'blocked', 'pr_open'] as const) {
      fixture?.cleanup()
      fixture = guardJob({ sealed: false, launches: 'strict', job: { state } })
      expect(
        orchestrator({
          subagent_type: 'general-purpose',
          description: 'x',
          prompt: 'x',
          ...SONNET,
        }),
      ).toContain('only the factory')
    }
  })

  test('outside a job nothing is judged', () => {
    job()
    expect(
      fixture?.guard(
        null,
        'Agent',
        { subagent_type: 'general-purpose', description: 'x', prompt: 'x' },
        undefined,
        'another-session',
      ),
    ).toBeNull()
  })
})
