// What the page's panels guarantee, from event streams shaped like a real job's: the Decision
// Request, risk, review plans, the seal, rulings, model and effort, sandboxes and denials.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Annotator } from '../annotate.ts'
import type { FactoryEvent } from '../events.ts'
import { makeJob } from '../job-fixture.ts'
import { saveJob } from '../job.ts'
import { ORCHESTRATOR } from '../launch.ts'
import { jobFrame } from './extras.ts'
import {
  applyEvent,
  createJobView,
  decisionOf,
  describe as describeEvent,
  markTitle,
  mismatches,
  modelCheck,
  ORCHESTRATOR_PLAN,
  orchestratorAt,
  phaseOf,
  reviewPlansOf,
  riskOf,
  rulingsOf,
  sandboxesOf,
  sealOf,
  STATIONS,
  type JobInfo,
} from './state.ts'

const T0 = Date.parse('2026-11-26T17:50:00.000Z')
let seq = 0
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
const cli = (s: number, kind: string, detail?: Record<string, unknown>): FactoryEvent => ({
  t: at(s),
  job: 13,
  source: 'cli',
  kind,
  detail,
})
const hook = (
  s: number,
  kind: string,
  agent?: { id: string; type: string },
  extra: Partial<FactoryEvent> = {},
): FactoryEvent => ({
  t: at(s),
  job: 13,
  source: 'hook',
  kind,
  toolUseId: `tool-${seq++}`,
  ...(agent ? { agent } : {}),
  ...extra,
})
const EVAL = { id: 'a-eval', type: 'factory-evaluator' }
const TQR = { id: 'a-tqr', type: 'factory-test-reviewer' }
const BUILD = { id: 'a-build', type: 'factory-build' }
const DIAG = { id: 'a-diag', type: 'factory-diagnose' }
const start = (s: number, agent: { id: string; type: string }) => hook(s, 'agent.start', agent)
const usage = (models: Record<string, number>, efforts: Record<string, number>) => ({
  messages: 4,
  models,
  efforts,
  tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite5m: 4, cacheWrite1h: 5 },
  usd: 0.5,
  unpriced: [],
})
const info = (over: Partial<JobInfo> = {}): JobInfo => ({
  number: 13,
  title: 'Icons',
  state: 'building',
  ...over,
})
const play = (events: FactoryEvent[], jobInfo: JobInfo | null = null) => {
  const annotator = new Annotator()
  const view = createJobView(13)
  view.info = jobInfo
  for (const event of events) applyEvent(view, annotator.push(event))
  return view
}

const planned = (roles: Record<string, string>, raisedBy: string[] = []) =>
  cli(5, 'review.planned', {
    pass: 1,
    head: 'abc',
    since: null,
    changed: 2,
    risk: 'high',
    raisedBy,
    roles,
  })

const blind = (s: number, agent: { id: string; type: string }, role: string) =>
  hook(s, 'write', agent, { target: { area: 'job', path: `reviews/1.${role}.blind.md` } })

const launch = (s: number, agent: string, model: string, effort: string) =>
  cli(s, 'launch.planned', { agent, task: 'review', model, effort, risk: 'normal' })

const read = (
  s: number,
  tool: string,
  detail: Record<string, unknown>,
  target?: FactoryEvent['target'],
) =>
  hook(s, tool === 'Grep' || tool === 'Glob' ? 'search' : 'bash', TQR, {
    ...(target ? { target } : {}),
    detail: tool === 'Bash' ? detail : { tool, ...detail },
  })

describe('Decision Request', () => {
  const blocked = [cli(0, 'job.started'), cli(10, 'blocked', { file: '/x/decision-requests/1.md' })]
  const withText = info({
    state: 'blocked',
    decisionRequests: [{ at: at(10), file: '/x/decision-requests/1.md' }],
    extras: {
      requests: ['Context: the fix changes the guarantee.\nOptions: A, B.'],
      rulingVerdicts: {},
      sandboxFolders: [],
      seal: null,
    },
  })

  test('a blocked job shows the request in full and the command that answers it', () => {
    const view = play(blocked, withText)
    expect(decisionOf(view).pending).toEqual({
      n: 1,
      text: 'Context: the fix changes the guarantee.\nOptions: A, B.',
      waitingFor: '! bun run factory answer 13 "<text>"',
    })
  })

  test('an answered request is no longer pending, and the answer is in the history', () => {
    const answered = info({
      ...withText,
      answers: [{ request: 1, at: at(20), text: 'Go with A.', cited: false }],
    })
    const view = play([...blocked, cli(20, 'answered', { request: 1 })], answered)
    expect(decisionOf(view).pending).toBeNull()
    expect(decisionOf(view).history).toEqual([{ n: 1, answered: true, answer: 'Go with A.' }])
    expect(phaseOf(view)).toBe('blocked')
  })

  test('the answered event is in the feed and the timeline, with the answer on the mark', () => {
    const answered = info({
      ...withText,
      answers: [{ request: 1, at: at(20), text: 'Go with A.', cited: false }],
    })
    const view = play([...blocked, cli(20, 'answered', { request: 1 })], answered)
    const mark = view.marks.at(-1)
    expect(mark).toMatchObject({ kind: 'answered', request: 1 })
    expect(mark && markTitle(view, mark)).toBe('answered · Go with A.')
    expect(describeEvent(view.feed.at(-1) as never)).toMatchObject({
      kind: 'answered',
      msg: 'Decision Request 1 answered',
    })
  })

  test('an event that only adds facts leaves the orchestrator on the Decision Request', () => {
    const view = play([...blocked, cli(20, 'answered', { request: 1 })], withText)
    expect(view.reticle.at).toEqual(['dr'])
  })

  test('a request whose file is gone is still pending, without text', () => {
    const view = play(blocked, {
      ...withText,
      extras: { requests: [null], rulingVerdicts: {}, sandboxFolders: [], seal: null },
    })
    expect(decisionOf(view).pending?.text).toBeNull()
  })

  test('a running job has nothing pending', () => {
    expect(decisionOf(play([cli(0, 'job.started')], info())).pending).toBeNull()
  })
})

describe('risk and the review plan', () => {
  test('shows the declared and the effective risk, and why it was raised', () => {
    const view = play(
      [planned({ evaluator: 'review', 'test-reviewer': 'review' }, ['apps/api/src/auth.ts'])],
      info({ risk: 'normal' }),
    )
    expect(riskOf(view)).toEqual({
      declared: 'normal',
      effective: 'high',
      raised: true,
      raisedBy: ['apps/api/src/auth.ts'],
    })
  })

  test('a risk that stayed as declared was not raised, whatever the paths say', () => {
    const view = play(
      [cli(1, 'launch.planned', { agent: 'factory-test', task: 'write', risk: 'normal' })],
      info({ risk: 'normal' }),
    )
    expect(riskOf(view)).toMatchObject({ effective: 'normal', raised: false, raisedBy: [] })
  })

  test('the latest launch decides the effective risk', () => {
    const view = play(
      [
        planned({ evaluator: 'review', 'test-reviewer': 'review' }, ['a.ts']),
        cli(9, 'launch.planned', { agent: 'factory-build', task: 'build', risk: 'high' }),
      ],
      info({ risk: 'low' }),
    )
    expect(riskOf(view).effective).toBe('high')
  })

  test('shows each role as review, verify or carry, per pass', () => {
    const view = play([
      planned({ evaluator: 'review', 'test-reviewer': 'review' }),
      {
        ...cli(50, 'review.planned', {
          pass: 2,
          risk: 'high',
          raisedBy: [],
          changed: 1,
          roles: { evaluator: 'carry', 'test-reviewer': 'verify' },
        }),
      },
    ])
    expect(reviewPlansOf(view).map((plan) => [plan.pass, plan.roles])).toEqual([
      [1, { evaluator: 'review', 'test-reviewer': 'review' }],
      [2, { evaluator: 'carry', 'test-reviewer': 'verify' }],
    ])
  })

  test('falls back to job.json plans when the log has none', () => {
    const view = play(
      [],
      info({
        reviews: [
          {
            pass: 1,
            changed: [],
            risk: 'normal',
            raisedBy: [],
            roles: { 'test-reviewer': 'review' },
            at: at(1),
          },
        ],
      }),
    )
    expect(reviewPlansOf(view)[0]?.roles).toEqual({ 'test-reviewer': 'review' })
  })
})

describe('seal', () => {
  const sealed = cli(10, 'sealed', { pass: 1, roles: ['evaluator', 'test-reviewer'], files: [] })

  test('a sealed job has a lock and no tick until a blind pass is written', () => {
    expect(sealOf(play([sealed])).sealed).toMatchObject({ pass: 1, blind: [], unsealedAt: null })
  })

  test('one tick per sealed role whose blind pass is written', () => {
    const view = play([sealed, start(11, EVAL), blind(20, EVAL, 'evaluator')])
    expect(sealOf(view).sealed?.blind).toEqual(['evaluator'])
  })

  test('a blind pass of another pass ticks nothing', () => {
    const view = play([
      sealed,
      hook(20, 'write', EVAL, { target: { area: 'job', path: 'reviews/2.evaluator.blind.md' } }),
    ])
    expect(sealOf(view).sealed?.blind).toEqual([])
  })

  test('the unseal moment closes the lock and keeps its time', () => {
    const view = play([
      sealed,
      blind(20, EVAL, 'evaluator'),
      blind(21, TQR, 'test-reviewer'),
      cli(30, 'unsealed', { pass: 1, roles: ['evaluator', 'test-reviewer'], files: [] }),
    ])
    const seal = sealOf(view)
    expect(seal.sealed).toBeNull()
    expect(seal.lifted).toEqual([
      expect.objectContaining({
        pass: 1,
        blind: ['evaluator', 'test-reviewer'],
        unsealedAt: T0 + 30_000,
      }),
    ])
  })
})

describe('rulings', () => {
  const asked = cli(5, 'ruling.requested', { ruling: 1, diff: 'a1b2c3d4' })

  test('shows the number, the diff hash and the verdict', () => {
    const view = play(
      [asked],
      info({
        rulings: [{ ruling: 1, diff: 'a1b2c3d4', at: at(5) }],
        extras: {
          requests: [],
          rulingVerdicts: { '1': 'same-guarantee' },
          sandboxFolders: [],
          seal: null,
        },
      }),
    )
    expect(rulingsOf(view)).toEqual([
      { ruling: 1, diff: 'a1b2c3d4', verdict: 'same-guarantee', committed: null },
    ])
  })

  test('an AT fix committed on the ruling is shown with it', () => {
    const view = play(
      [asked, cli(9, 'atfix', { sha: 'f00', note: 'fix', files: [], ruling: 1 })],
      info({ atfixes: [{ sha: 'f00ba4', note: 'fix', files: [], ruling: 1 }] }),
    )
    expect(rulingsOf(view)[0]?.committed).toEqual({ sha: 'f00ba4' })
  })

  test('a ruling without a verdict yet has none', () => {
    expect(rulingsOf(play([asked]))[0]?.verdict).toBeNull()
  })
})

describe('model and effort, planned against actual', () => {
  const OPUS = 'claude-opus-5-5'
  const SONNET = 'claude-sonnet-5-5'

  test('a run that used what was planned is ok', () => {
    const view = play([
      launch(1, 'factory-evaluator', 'opus', 'medium'),
      start(2, EVAL),
      hook(9, 'usage', EVAL, { detail: usage({ [OPUS]: 4 }, { medium: 4 }) }),
    ])
    expect(modelCheck(view.runs.get('a-eval') as never)).toMatchObject({
      status: 'ok',
      planned: { model: 'opus', effort: 'medium' },
    })
  })

  test('flags the wrong model and the wrong effort', () => {
    const view = play([
      launch(1, 'factory-evaluator', 'opus', 'high'),
      start(2, EVAL),
      hook(9, 'usage', EVAL, { detail: usage({ [SONNET]: 4 }, { medium: 4 }) }),
    ])
    const check = modelCheck(view.runs.get('a-eval') as never)
    expect(check.status).toBe('mismatch')
    expect(check.problems).toEqual([`model ${SONNET}, planned opus`, 'effort medium, planned high'])
    expect(mismatches(view).map((run) => run.id)).toEqual(['a-eval'])
  })

  test('a run that also used another model is a mismatch', () => {
    const view = play([
      launch(1, 'factory-evaluator', 'opus', 'medium'),
      start(2, EVAL),
      hook(9, 'usage', EVAL, { detail: usage({ [OPUS]: 3, [SONNET]: 1 }, { medium: 4 }) }),
    ])
    expect(modelCheck(view.runs.get('a-eval') as never).status).toBe('mismatch')
  })

  test('each plan goes to the next run of its agent, in order', () => {
    const view = play([
      launch(1, 'factory-test-reviewer', 'opus', 'medium'),
      launch(2, 'factory-test-reviewer', 'opus', 'low'),
      start(3, TQR),
      start(4, { id: 'a-tqr2', type: 'factory-test-reviewer' }),
    ])
    expect(view.runs.get('a-tqr')?.plan?.effort).toBe('medium')
    expect(view.runs.get('a-tqr2')?.plan?.effort).toBe('low')
  })

  test('a run with a plan and no usage yet is pending; one without a plan is unplanned', () => {
    const view = play([
      launch(1, 'factory-evaluator', 'opus', 'medium'),
      start(2, EVAL),
      start(3, BUILD),
    ])
    expect(modelCheck(view.runs.get('a-eval') as never).status).toBe('pending')
    expect(modelCheck(view.runs.get('a-build') as never).status).toBe('unplanned')
  })

  test('the orchestrator is judged against sonnet and medium', () => {
    expect<unknown>(ORCHESTRATOR_PLAN).toEqual(ORCHESTRATOR)
    const ok = play([
      hook(5, 'usage', undefined, { detail: usage({ [SONNET]: 9 }, { medium: 9 }) }),
    ])
    expect(modelCheck(ok.runs.get('orchestrator') as never).status).toBe('ok')
    const wrong = play([hook(5, 'usage', undefined, { detail: usage({ [OPUS]: 9 }, { high: 9 }) })])
    expect(modelCheck(wrong.runs.get('orchestrator') as never).problems).toHaveLength(2)
  })
})

describe('sandboxes', () => {
  test('the strip comes from the sandbox events, and a removed one says so', () => {
    const view = play([
      cli(1, 'sandbox.created', {
        role: 'evaluator',
        path: '/p',
        port: 4101,
        database: 'db1',
        bucket: 'b1',
      }),
      cli(2, 'sandbox.created', {
        role: 'test-reviewer',
        path: '/q',
        port: 4102,
        database: 'db2',
        bucket: 'b2',
      }),
      cli(3, 'sandbox.removed', { role: 'evaluator' }),
    ])
    expect(sandboxesOf(view)).toEqual({
      source: 'events',
      rows: [
        { role: 'evaluator', detail: 'removed' },
        { role: 'test-reviewer', detail: 'port 4102 · db db2 · bucket b2' },
      ],
    })
  })

  test('with no events, the folders under sandbox/ stand in, and with neither it says none', () => {
    const folders = info({
      extras: { requests: [], rulingVerdicts: {}, sandboxFolders: ['evaluator'], seal: null },
    })
    expect(sandboxesOf(play([], folders))).toEqual({
      source: 'folders',
      rows: [{ role: 'evaluator', detail: 'folder only' }],
    })
    expect(sandboxesOf(play([])).source).toBe('none')
  })
})

describe('reads and denials', () => {
  const places = cli(0, 'job.started', { worktree: '/w' })

  test('counts Bash, Grep and Glob reads with the Read tool’s, and lists them in the run', () => {
    const view = play([
      places,
      start(1, TQR),
      hook(2, 'read', TQR, { target: { area: 'job', path: 'issue.md' }, tokens: 10 }),
      read(3, 'Bash', { command: 'cat factory/.jobs/13/issue.md' }),
      read(4, 'Grep', { pattern: 'x' }, { area: 'repo', path: 'apps' }),
    ])
    expect(view.readBy).toEqual({ Read: 1, Bash: 1, Grep: 1, Glob: 0 })
    expect(view.readCount).toBe(3)
    expect(view.runs.get('a-tqr')?.reads.map((item) => item.via)).toEqual(['Read', 'Bash', 'Grep'])
  })

  test('a Bash read of sealed material is a breach of the run, and only that read is flagged', () => {
    const view = play([
      places,
      start(1, TQR),
      read(3, 'Bash', { command: 'cat factory/.jobs/13/build-notes.md factory/.jobs/13/issue.md' }),
    ])
    const reads = view.runs.get('a-tqr')?.reads ?? []
    expect(reads.map((item) => Boolean(item.breach))).toEqual([true, false])
    expect(view.breaches).toHaveLength(1)
    expect([...view.flagged]).toEqual(['tqr'])
  })

  test.each(['write.denied', 'read.denied', 'bash.denied', 'agent.denied'])(
    '%s counts as a denial of the run, next to the others',
    (kind) => {
      const view = play([
        start(1, TQR),
        hook(2, 'write.denied', TQR, { detail: { reason: 'no' } }),
        hook(3, kind, TQR, { detail: { reason: 'no' } }),
      ])
      expect(view.deniedCount).toBe(2)
      expect(view.deniedBy[kind]).toBe(kind === 'write.denied' ? 2 : 1)
      expect(view.runs.get('a-tqr')?.denied).toHaveLength(2)
    },
  )

  test('a denied read is also a breach, and the feed row says why', () => {
    const view = play([
      start(1, TQR),
      hook(2, 'read.denied', TQR, {
        target: { area: 'job', path: 'build-notes.md' },
        detail: { reason: 'sealed' },
      }),
    ])
    expect(view.breaches).toHaveLength(1)
    expect(describeEvent(view.feed.at(-1) as never)).toMatchObject({ cls: 'breach' })
  })
})

describe('a verifier in the watch', () => {
  test('its reads of the previous findings and its own report are no breach, the notes are', () => {
    const view = play([
      cli(0, 'job.started', { worktree: '/w' }),
      cli(1, 'round', { round: 1 }),
      cli(2, 'review.planned', {
        pass: 2,
        risk: 'normal',
        raisedBy: [],
        changed: 1,
        roles: { evaluator: 'verify', 'test-reviewer': 'review' },
      }),
      start(3, EVAL),
      hook(4, 'read', EVAL, { target: { area: 'job', path: 'reviews/1.findings.md' } }),
      hook(5, 'read', EVAL, { target: { area: 'job', path: 'reviews/1.evaluator.md' } }),
      hook(6, 'read', EVAL, { target: { area: 'job', path: 'build-notes.md' } }),
    ])
    expect(view.breaches.map((item) => item.ev.target?.path)).toEqual(['build-notes.md'])
  })
})

describe('the diagnosis agent', () => {
  test('has a station that lights while it runs and settles when it stops', () => {
    expect(STATIONS.diag.label).toBe('Diagnosis')
    const annotator = new Annotator()
    const view = createJobView(13)
    applyEvent(view, annotator.push(cli(0, 'job.started', { worktree: '/w' })))
    applyEvent(view, annotator.push(start(5, DIAG)))
    expect(view.stations.diag).toBe('active')
    expect(view.reticle).toMatchObject({ at: ['diag'], what: 'waiting on the diagnosis agent' })
    expect(view.on).toEqual(['e19'])
    applyEvent(view, annotator.push(hook(30, 'agent.stop', DIAG, { detail: { changed: [] } })))
    expect(view.stations.diag).toBe('done')
    expect(view.on).toEqual(['e20'])
    expect(view.reticle.what).toBe('dispatching build with the diagnosis')
  })

  test('a plain stop does not need a station of its own to be tracked by the reticle', () => {
    expect(
      orchestratorAt({
        phase: 'building',
        running: ['diag'],
        lastCli: 'checks.failed',
        lastStop: null,
        attempt: 2,
        round: 0,
      }).at,
    ).toEqual(['diag'])
  })
})

describe('the job frame', () => {
  test('carries the request text, the ruling verdicts, the sandbox folders and the seal', () => {
    const root = mkdtempSync(join(tmpdir(), 'factory-watch-'))
    try {
      const worktree = join(root, '.claude', 'worktrees', '7-add-a-thing')
      const handoff = join(worktree, 'factory', '.jobs', '7')
      mkdirSync(join(handoff, 'rulings'), { recursive: true })
      mkdirSync(join(handoff, 'sandbox', 'evaluator'), { recursive: true })
      mkdirSync(join(handoff, 'decision-requests'), { recursive: true })
      writeFileSync(join(handoff, 'decision-requests', '1.md'), '# Context\nPick one.')
      writeFileSync(join(handoff, 'rulings', '1.md'), 'Verdict: changed-guarantee\nDiff: abc\n')
      saveJob(
        root,
        makeJob({
          worktree,
          state: 'blocked',
          decisionRequests: [{ at: at(1), file: join(handoff, 'decision-requests', '1.md') }],
          rulings: [
            { ruling: 1, diff: 'abc', at: at(1) },
            { ruling: 2, diff: 'def', at: at(2) },
          ],
        }),
      )
      const frame = jobFrame(root, 7)
      expect(frame?.extras).toEqual({
        requests: ['# Context\nPick one.'],
        rulingVerdicts: { '1': 'changed-guarantee', '2': null },
        sandboxFolders: ['evaluator'],
        seal: null,
      })
      expect(jobFrame(root, 8)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
