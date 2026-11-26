import { describe, expect, test } from 'bun:test'
import { annotate } from './annotate.ts'
import type { FactoryEvent } from './events.ts'

const evaluator = { id: 'e1', type: 'factory-evaluator' }
const builder = { id: 'b1', type: 'factory-build' }

let tick = 0
const hook = (kind: string, extra: Partial<FactoryEvent> = {}): FactoryEvent => ({
  t: String(tick++),
  job: 7,
  source: 'hook',
  kind,
  ...extra,
})
const cli = (kind: string): FactoryEvent => ({ t: String(tick++), job: 7, source: 'cli', kind })
const read = (
  agent: FactoryEvent['agent'],
  path: string,
  area: 'job' | 'repo' | 'outside' = 'job',
) => hook('read', { agent, target: { area, path } })
const write = (agent: FactoryEvent['agent'], path: string) =>
  hook('write', { agent, target: { area: 'job', path } })

describe('the blind pass', () => {
  test('a reviewer reading build-notes before its blind pass is flagged', () => {
    const [event] = annotate([read(evaluator, 'build-notes.md')])
    expect(event?.breach).toContain('blind first pass')
  })

  test('a reviewer reading build-notes after its blind pass is not', () => {
    const events = annotate([
      write(evaluator, 'reviews/1.evaluator.blind.md'),
      read(evaluator, 'build-notes.md'),
    ])
    expect(events[1]?.breach).toBeUndefined()
  })

  test('a blind pass written for another role does not unlock the read', () => {
    const events = annotate([
      write({ id: 't1', type: 'factory-test-reviewer' }, 'reviews/1.test-reviewer.blind.md'),
      read(evaluator, 'build-notes.md'),
    ])
    expect(events[1]?.breach).toBeDefined()
  })

  test('after a round with findings the pass is 2, so the first blind pass no longer counts', () => {
    const events = annotate([
      write(evaluator, 'reviews/1.evaluator.blind.md'),
      cli('round'),
      read(evaluator, 'build-notes.md'),
      write(evaluator, 'reviews/2.evaluator.blind.md'),
      read(evaluator, 'build-notes.md'),
    ])
    expect(events[2]?.breach).toBeDefined()
    expect(events[4]?.breach).toBeUndefined()
  })
})

describe('nested runs', () => {
  const nested = [
    hook('agent.prompt', {
      agent: evaluator,
      detail: { subagentType: 'Explore', prompt: 'find the stretch code', description: 'search' },
    }),
    hook('agent.start', { agent: { id: 'x1', type: 'Explore' } }),
  ]

  test('an Explore run takes the role of the agent that launched it', () => {
    const events = annotate([...nested, read({ id: 'x1', type: 'Explore' }, 'build-notes.md')])
    expect(events[2]?.role).toBe('factory-evaluator')
    expect(events[2]?.parent).toBe('e1')
    expect(events[2]?.breach).toContain('blind first pass')
  })

  test("the run's start carries the prompt its caller handed it", () => {
    const events = annotate(nested)
    expect(events[1]?.detail?.prompt).toBe('find the stretch code')
  })

  test('an Explore run launched by the orchestrator has no factory role', () => {
    const events = annotate([
      hook('agent.prompt', { detail: { subagentType: 'Explore', prompt: 'p' } }),
      hook('agent.start', { agent: { id: 'x2', type: 'Explore' } }),
      read({ id: 'x2', type: 'Explore' }, 'apps/api/src/walks.ts', 'repo'),
    ])
    expect(events[2]?.role).toBeUndefined()
  })
})

describe('other breaches and handoffs', () => {
  test('a read outside the worktree is flagged', () => {
    const [event] = annotate([read(builder, '/Users/x/other/file.ts', 'outside')])
    expect(event?.breach).toContain('outside')
  })

  test("a read inside the agent's inputs carries the input it matched", () => {
    const [event] = annotate([read(builder, 'apps/api/src/walks.ts', 'repo')])
    expect(event?.breach).toBeUndefined()
    expect(event?.input).toBe('The repo and knowledge/')
  })

  test('a read of a file another actor wrote carries who wrote it', () => {
    const events = annotate([
      write(builder, 'build-notes.md'),
      write(evaluator, 'reviews/1.evaluator.blind.md'),
      read(evaluator, 'build-notes.md'),
    ])
    expect(events[2]?.from).toBe('factory-build')
  })

  test('a read of a file the same actor wrote carries no handoff', () => {
    const events = annotate([write(builder, 'build-notes.md'), read(builder, 'build-notes.md')])
    expect(events[1]?.from).toBeUndefined()
  })
})
