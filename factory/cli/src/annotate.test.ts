import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
const bash = (agent: FactoryEvent['agent'], command: string) =>
  hook('bash', { agent, detail: { command } })

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

describe('reads by Bash, Grep and Glob', () => {
  const worktree = '/repo/.claude/worktrees/7-add-a-thing'
  const started: FactoryEvent = {
    t: String(tick++),
    job: 7,
    source: 'cli',
    kind: 'job.started',
    detail: { worktree },
  }
  const flagged = (...events: FactoryEvent[]) => annotate([started, ...events]).at(-1)?.breach

  test.each([
    'cat factory/.jobs/7/build-notes.md',
    `cat -n ${worktree}/factory/.jobs/7/build-notes.md`,
    'git log --oneline && cat factory/.jobs/7/decision-requests/1.md factory/.jobs/7/decision-requests/1.posted.md',
    'cat factory/.jobs/7/decision-requests/*.md',
    'head -50 factory/.jobs/7/reviews/1.findings.md',
    'sed -n 1,40p factory/.jobs/7/diagnosis.md',
    'grep -n width factory/.jobs/7/build-notes.md',
    'jq . factory/.jobs/7/summary.md',
    'cd factory/.jobs/7 && cat reviews/1.evaluator.md',
    'echo ----; cat factory/.jobs/7/reviews/1.evaluator.md | head',
  ])('flags a reviewer reading a sealed input before its blind pass: %s', (command) => {
    expect(flagged(bash(evaluator, command))).toContain('blind first pass')
  })

  test.each([
    'ls factory/.jobs/7 factory/.jobs/7/*',
    'cat factory/.jobs/7/issue.md factory/.jobs/7/gate.json',
    'grep -n build-notes apps/web/src/main.ts',
    'git diff main...HEAD --stat',
    'cat factory/.jobs/7/reviews/1.evaluator.blind.md',
  ])('does not flag %s', (command) => {
    expect(flagged(bash(evaluator, command))).toBeUndefined()
  })

  test('does not take a heredoc for a file the command reads', () => {
    const tester = { id: 'q1', type: 'factory-test' }
    expect(
      flagged(bash(tester, 'cat > apps/web/e2e/icons.spec.ts <<EOF\nimport x\nEOF')),
    ).toBeUndefined()
  })

  test('does not flag the same read once the blind pass is written', () => {
    expect(
      flagged(
        write(evaluator, 'reviews/1.evaluator.blind.md'),
        bash(evaluator, 'cat factory/.jobs/7/build-notes.md'),
      ),
    ).toBeUndefined()
  })

  test("flags a Bash read of the main checkout's job state", () => {
    expect(flagged(bash(builder, 'cat /repo/factory/.jobs/7/sealed/build-notes.md'))).toContain(
      'outside',
    )
  })

  test('flags a Grep in the sealed inputs and a Glob for them', () => {
    expect(
      flagged(
        hook('search', {
          agent: evaluator,
          target: { area: 'job', path: 'build-notes.md' },
          detail: { tool: 'Grep', pattern: 'width' },
        }),
      ),
    ).toContain('blind first pass')
    expect(
      flagged(
        hook('search', {
          agent: evaluator,
          target: { area: 'repo', path: 'factory/.jobs/7' },
          detail: { tool: 'Glob', pattern: 'reviews/*.findings.md' },
        }),
      ),
    ).toBeDefined()
  })

  test.each(['read.denied', 'bash.denied', 'agent.denied'])('flags %s as a breach', (kind) => {
    expect(flagged(hook(kind, { agent: evaluator, detail: { reason: 'sealed' } }))).toBe('sealed')
  })
})

describe("replay: job #13's reviewers", () => {
  const fixture = readFileSync(
    join(import.meta.dir, 'replay-fixtures', 'job13-reviewers.jsonl'),
    'utf8',
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FactoryEvent)
  const events = annotate(fixture)
  const at = (time: string, type: string) =>
    events.find(
      (event) =>
        event.t.slice(11, 19) === time && event.agent?.type === type && event.kind === 'bash',
    )

  test.each([
    ['20:25:24', 'factory-evaluator', 'decision requests'],
    ['20:25:28', 'factory-test-reviewer', 'decision requests'],
    ['20:30:45', 'factory-evaluator', 'merged findings'],
    ['20:30:45', 'factory-evaluator', 'its own final reports'],
    ['20:30:45', 'factory-test-reviewer', 'merged findings'],
    ['20:30:45', 'factory-test-reviewer', 'its own final reports'],
  ])('flags the %s read by the %s of %s before its blind pass', (time, type, input) => {
    const breach = at(time, type)?.breach
    expect(breach).toContain(input)
    expect(breach).toContain('before writing its blind first pass')
  })

  test('does not flag the build-notes reads after each blind pass', () => {
    const notes = events.filter(
      (event) =>
        event.t > '2026-11-26T20:29' &&
        (event.target?.path === 'build-notes.md' ||
          String(event.detail?.command).includes('build-notes.md')),
    )
    expect(notes.length).toBe(4)
    for (const event of notes) expect(event.breach).toBeUndefined()
  })
})

// A verifier has no blind pass: the plan for the pass says `verify`, and it reads the previous
// merged findings and its own previous final report. The build notes stay closed to it.
const planned = (roles: Record<string, string>) => ({
  t: String(tick++),
  job: 7,
  source: 'cli' as const,
  kind: 'review.planned',
  detail: { pass: 2, roles },
})

describe('a verifier in the pass', () => {
  const second = [cli('round')]

  test.each(['reviews/1.findings.md', 'reviews/1.evaluator.md'])(
    'its read of %s is not a breach',
    (path) => {
      const events = annotate([
        ...second,
        planned({ evaluator: 'verify', 'test-reviewer': 'review' }),
        read(evaluator, path),
      ])
      expect(events.at(-1)?.breach).toBeUndefined()
      expect(events.at(-1)?.input).toContain('verify')
    },
  )

  test('its read of the build notes still is', () => {
    const events = annotate([
      ...second,
      planned({ evaluator: 'verify', 'test-reviewer': 'review' }),
      read(evaluator, 'build-notes.md'),
    ])
    expect(events.at(-1)?.breach).toContain('blind first pass')
  })

  test("it may not read the other reviewer's report", () => {
    const events = annotate([
      ...second,
      planned({ evaluator: 'verify', 'test-reviewer': 'review' }),
      read(evaluator, 'reviews/1.test-reviewer.md'),
    ])
    expect(events.at(-1)?.breach).toBeDefined()
  })

  test('a reviewer planned to review is still flagged for the same read', () => {
    const events = annotate([
      ...second,
      planned({ evaluator: 'review', 'test-reviewer': 'review' }),
      read(evaluator, 'reviews/1.findings.md'),
    ])
    expect(events.at(-1)?.breach).toBeDefined()
  })

  test("the plan is the pass's: a verify in pass 2 does not excuse pass 3", () => {
    const events = annotate([
      ...second,
      planned({ evaluator: 'verify', 'test-reviewer': 'review' }),
      cli('round'),
      read(evaluator, 'reviews/2.findings.md'),
    ])
    expect(events.at(-1)?.breach).toBeDefined()
  })

  test("a read in the sealed store of the job's state is its own input too", () => {
    const events = annotate([
      ...second,
      planned({ evaluator: 'verify', 'test-reviewer': 'review' }),
      read(evaluator, '/repo/factory/.jobs/7/sealed/reviews/1.findings.md', 'outside'),
      read(evaluator, '/repo/factory/.jobs/7/sealed/build-notes.md', 'outside'),
    ])
    expect(events.at(-2)?.breach).toBeUndefined()
    expect(events.at(-1)?.breach).toBeDefined()
  })
})
