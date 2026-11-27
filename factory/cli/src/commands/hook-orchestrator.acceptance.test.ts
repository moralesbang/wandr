import { afterEach, describe, expect, test } from 'bun:test'
import { readEvents } from '../events.ts'
import { BUILD, EXPLORE, guardJob, TR } from '../guard-fixture.ts'

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

const plan = (agent: string, model = 'sonnet', effort = 'medium') =>
  fixture?.log({ source: 'cli', kind: 'launch.planned', detail: { agent, model, effort } })
const launch = (extra: object, agent = 'factory-build') =>
  fixture?.guard(null, 'Agent', { subagent_type: agent, ...PROMPT, ...extra }) ?? null

describe('FI-019: the guard holds each launch to the plan `factory launch` logged', () => {
  test('a launch with the planned model and effort goes through', () => {
    job()
    plan('factory-build')
    expect(launch({ model: 'sonnet', effort: 'medium' })).toBeNull()
  })

  test('a launch with no plan at all is denied and says to run factory launch', () => {
    job()
    expect(launch({ model: 'sonnet', effort: 'medium' })).toContain(
      'factory launch 7 factory-build',
    )
  })

  test.each([
    ['another model', { model: 'opus', effort: 'medium' }],
    ['another effort', { model: 'sonnet', effort: 'high' }],
    ['no model', { effort: 'medium' }],
    ['no effort', { model: 'sonnet' }],
  ])('a launch with %s is denied, naming what the plan fixed', (_name, extra) => {
    job()
    plan('factory-build')
    const reason = launch(extra)
    expect(reason).toContain('sonnet')
    expect(reason).toContain('medium')
    expect(reason).toContain('factory-build')
  })

  test('one plan authorizes one launch: a stale plan cannot authorize a later run', () => {
    job()
    plan('factory-build')
    expect(launch({ model: 'sonnet', effort: 'medium' })).toBeNull()
    expect(launch({ model: 'sonnet', effort: 'medium' })).toContain('No unused launch plan')
    plan('factory-build')
    expect(launch({ model: 'sonnet', effort: 'medium' })).toBeNull()
    expect(
      readEvents(fixture?.root ?? '', 7).filter((e) => e.kind === 'launch.authorized'),
    ).toHaveLength(2)
  })

  test('the latest plan replaces an older unused one', () => {
    job()
    plan('factory-build', 'sonnet', 'medium')
    plan('factory-build', 'opus', 'high')
    expect(launch({ model: 'sonnet', effort: 'medium' })).not.toBeNull()
    expect(launch({ model: 'opus', effort: 'high' })).toBeNull()
  })

  test("a plan is for its agent: another agent's plan authorizes nothing", () => {
    job()
    plan('factory-test-reviewer', 'opus', 'medium')
    expect(launch({ model: 'opus', effort: 'medium' })).toContain('No unused launch plan')
    expect(launch({ model: 'opus', effort: 'medium' }, 'factory-test-reviewer')).toBeNull()
  })

  test("a denied launch uses no plan, and a subagent's own Explore call needs none", () => {
    job()
    plan('factory-build')
    expect(launch({ model: 'opus', effort: 'high' })).not.toBeNull()
    expect(launch({ model: 'sonnet', effort: 'medium' })).toBeNull()
    for (const who of [BUILD, TR])
      expect(
        fixture?.guard(who, 'Agent', { subagent_type: 'Explore', ...PROMPT, model: 'haiku' }),
      ).toBeNull()
    expect(fixture?.guard(null, 'Agent', { subagent_type: 'Explore', ...PROMPT })).toBeNull()
    expect(
      fixture?.guard(EXPLORE, 'Read', { file_path: `${fixture.worktree}/apps/web/src/main.ts` }),
    ).toBeNull()
  })
})
