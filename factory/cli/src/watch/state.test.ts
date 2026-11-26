import { describe, expect, test } from 'bun:test'
import { Annotator } from '../annotate.ts'
import type { FactoryEvent } from '../events.ts'
import {
  applyEvent,
  createJobView,
  edgeState,
  orchestratorAt,
  reticleBox,
  type OrchestratorInput,
  type OrchestratorMode,
  type StationId,
} from './state.ts'

const idle: OrchestratorInput = {
  phase: 'building',
  running: [],
  lastCli: null,
  lastStop: null,
  attempt: 0,
  round: 0,
}

// What the reticle guarantees: the orchestrator is shown where the factory is waiting on someone.
describe('orchestratorAt', () => {
  test.each<[string, Partial<OrchestratorInput>, StationId[], string]>([
    ['no event yet', {}, ['start'], 'taking the job'],
    ['job started', { lastCli: 'job.started' }, ['wt'], 'creating the worktree'],
    ['test agent running', { running: ['test'] }, ['test'], 'waiting on the test agent'],
    [
      'test agent stopped, red not asked yet',
      { lastStop: 'test' },
      ['red'],
      'asking the CLI for a valid red',
    ],
    ['red accepted', { lastCli: 'red.accepted' }, ['red'], 'red accepted'],
    [
      'build dispatched, not started',
      { lastCli: 'attempt', attempt: 1 },
      ['build'],
      'dispatching build · try 1/3',
    ],
    [
      'build running',
      { running: ['build'], attempt: 2, lastCli: 'attempt' },
      ['build'],
      'waiting on build · try 2/3',
    ],
    [
      'checks run while the build agent runs',
      { running: ['build'], lastCli: 'checks.failed', attempt: 1 },
      ['build'],
      'waiting on build · try 1/3',
    ],
    [
      'build stopped, checks next',
      { lastStop: 'build', attempt: 1 },
      ['checks'],
      'running the checks',
    ],
    ['checks with no agent', { lastCli: 'checks.started' }, ['checks'], 'running the checks'],
    [
      'gate passed',
      { lastCli: 'gate.passed' },
      ['gate'],
      'gate passed · dispatching the reviewers',
    ],
    [
      'both reviewers running',
      { running: ['eval', 'tqr'], lastCli: 'gate.passed' },
      ['eval', 'tqr'],
      'waiting on both reviewers · blind pass',
    ],
    [
      'one reviewer left',
      { running: ['tqr'], lastStop: 'eval' },
      ['tqr'],
      'waiting on the test reviewer',
    ],
    ['reviewers stopped', { lastStop: 'tqr' }, ['verdict'], 'merging the reviews'],
    [
      'a round with findings',
      { lastCli: 'round', round: 1 },
      ['verdict'],
      'merging findings · round 1',
    ],
    ['an AT fix', { lastCli: 'atfix' }, ['atfix'], 'applying an AT fix'],
    ['blocked', { phase: 'blocked', running: ['build'] }, ['dr'], 'waiting on you'],
    ['PR open', { phase: 'pr_open' }, ['merged'], 'your turn · review the PR'],
  ])('%s', (_name, patch, at, what) => {
    expect(orchestratorAt({ ...idle, ...patch })).toMatchObject({ at, what })
  })

  test.each<[string, Partial<OrchestratorInput>, OrchestratorMode]>([
    ['agent', { running: ['build'] }, 'agent'],
    ['cli', { lastCli: 'gate.passed' }, 'cli'],
    ['orch', { lastCli: 'round', round: 1 }, 'orch'],
    ['wait', { phase: 'blocked' }, 'wait'],
  ])('the lane colour while %s', (_name, patch, mode) => {
    expect(orchestratorAt({ ...idle, ...patch }).mode).toBe(mode)
  })
})

test('the reticle box wraps one card, and two cards together', () => {
  expect(reticleBox(['build'])).toEqual({ x: 656, y: 166, w: 128, h: 60 })
  expect(reticleBox(['eval', 'tqr'])).toEqual({ x: 176, y: 130, w: 128, h: 132 })
})

// A job shaped like factory/.jobs/13: the test agent, a build agent with an Explore child whose
// first checks fail, the reviewers (one of them breaching its blind pass), a Decision Request
// raised and answered, then the PR.
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
const TEST = { id: 'a-test', type: 'factory-test' }
const BUILD = { id: 'a-build', type: 'factory-build' }
const EXPLORE = { id: 'a-explore', type: 'Explore' }
const EVAL = { id: 'a-eval', type: 'factory-evaluator' }
const TQR = { id: 'a-tqr', type: 'factory-test-reviewer' }
const launch = (
  s: number,
  agent: { id: string; type: string },
  prompt: string,
  caller?: { id: string; type: string },
): FactoryEvent[] => [
  hook(s, 'agent.prompt', caller, { detail: { subagentType: agent.type, prompt } }),
  hook(s + 0.1, 'agent.launched', caller, { detail: { childId: agent.id } }),
  hook(s + 0.2, 'agent.start', agent),
]
const read = (s: number, agent: { id: string; type: string }, path: string): FactoryEvent =>
  hook(s, 'read', agent, { target: { area: 'repo', path }, tokens: 100 })

const job13: [string, FactoryEvent[]][] = [
  ['job.started', [cli(0, 'job.started', { branch: 'feat/13-icons' })]],
  [
    'test agent',
    [
      ...launch(2, TEST, 'write the acceptance tests'),
      hook(4, 'read', TEST, { target: { area: 'job', path: 'issue.md' }, tokens: 100 }),
      hook(30, 'write', TEST, { target: { area: 'job', path: 'acceptance.md' } }),
    ],
  ],
  ['test agent stops', [hook(40, 'agent.stop', TEST, { detail: { changed: [] } })]],
  ['red.accepted', [cli(45, 'red.accepted', { files: ['apps/web/e2e/icons.spec.ts'] })]],
  ['attempt 1', [cli(50, 'attempt', { attempt: 1 })]],
  [
    'build agent, with an Explore child',
    [
      ...launch(52, BUILD, 'build it'),
      ...launch(60, EXPLORE, 'find the metadata', BUILD),
      read(61, EXPLORE, 'apps/web/src/app/layout.tsx'),
    ],
  ],
  ['the Explore child stops', [hook(70, 'agent.stop', EXPLORE)]],
  ['checks start while build runs', [cli(80, 'checks.started')]],
  ['checks fail', [cli(95, 'checks.failed', { failedStep: 'bun run lint' })]],
  ['build stops', [hook(120, 'agent.stop', BUILD, { detail: { changed: [] } })]],
  ['checks start after build', [cli(125, 'checks.started')]],
  ['checks pass', [cli(140, 'checks.passed')]],
  ['gate passes', [cli(145, 'gate.passed')]],
  ['reviewers run', [...launch(150, EVAL, 'judge it'), ...launch(150.5, TQR, 'judge the tests')]],
  [
    'the test reviewer breaches its blind pass',
    [hook(160, 'read', TQR, { target: { area: 'job', path: 'build-notes.md' }, tokens: 50 })],
  ],
  ['evaluator stops', [hook(180, 'agent.stop', EVAL)]],
  ['test reviewer stops', [hook(185, 'agent.stop', TQR)]],
  ['blocked', [cli(200, 'blocked', { file: 'decision-requests/1.md' })]],
  ['resumed', [cli(300, 'job.resumed', { from: 'blocked' })]],
  ['PR opens', [cli(320, 'pr.opened', { url: 'https://github.com/o/r/pull/15' })]],
]

const expectedReticle: Record<string, [StationId[], string]> = {
  'job.started': [['wt'], 'creating the worktree'],
  'test agent': [['test'], 'waiting on the test agent'],
  'test agent stops': [['red'], 'asking the CLI for a valid red'],
  'red.accepted': [['red'], 'red accepted'],
  'attempt 1': [['build'], 'dispatching build · try 1/3'],
  'build agent, with an Explore child': [['build'], 'waiting on build · try 1/3'],
  'the Explore child stops': [['build'], 'waiting on build · try 1/3'],
  'checks start while build runs': [['build'], 'waiting on build · try 1/3'],
  'checks fail': [['build'], 'waiting on build · try 1/3'],
  'build stops': [['checks'], 'running the checks'],
  'checks start after build': [['checks'], 'running the checks'],
  'checks pass': [['checks'], 'checks green'],
  'gate passes': [['gate'], 'gate passed · dispatching the reviewers'],
  'reviewers run': [['eval', 'tqr'], 'waiting on both reviewers · blind pass'],
  'the test reviewer breaches its blind pass': [
    ['eval', 'tqr'],
    'waiting on both reviewers · blind pass',
  ],
  'evaluator stops': [['tqr'], 'waiting on the test reviewer'],
  'test reviewer stops': [['verdict'], 'merging the reviews'],
  blocked: [['dr'], 'waiting on you'],
  resumed: [['start'], 'resuming the job'],
  'PR opens': [['merged'], 'your turn · review the PR'],
}

const run = () => {
  const annotator = new Annotator()
  const view = createJobView(13)
  const comets: unknown[] = []
  for (const [, events] of job13) {
    for (const event of events) {
      const effects = applyEvent(view, annotator.push(event))
      if (effects.comet) comets.push(effects.comet)
    }
  }
  return { view }
}

describe('a job shaped like #13', () => {
  test('the reticle follows the orchestrator through every step', () => {
    const annotator = new Annotator()
    const view = createJobView(13)
    const seen: Record<string, [StationId[], string]> = {}
    for (const [step, events] of job13) {
      for (const event of events) applyEvent(view, annotator.push(event))
      seen[step] = [view.reticle.at, view.reticle.what]
    }
    expect(seen).toEqual(expectedReticle)
  })

  test('stations settle: failed, flagged, waiting', () => {
    const { view } = run()
    expect(view.stations.test).toBe('done')
    expect(view.stations.build).toBe('done')
    expect(view.stations.checks).toBe('done')
    expect(view.stations.merged).toBe('active')
    expect(view.stations.dr).toBe('done')
    expect([...view.flagged]).toEqual(['tqr'])
  })

  test('a failed check lights the station red until the next run', () => {
    const annotator = new Annotator()
    const view = createJobView(13)
    for (const event of job13.slice(0, 9).flatMap(([, events]) => events)) {
      applyEvent(view, annotator.push(event))
    }
    expect(view.stations.checks).toBe('fail')
    expect(view.on).toEqual(['e8'])
  })

  test('counts, phase and the orchestrator lane', () => {
    const { view } = run()
    expect(view.phase).toBe('pr_open')
    expect(view.attempt).toBe(1)
    expect(view.readCount).toBe(3)
    expect(view.tokens).toBe(250)
    expect(view.breaches.map((b) => b.run.id)).toEqual(['a-tqr'])
    expect(view.segments.map((s) => s.mode)).toEqual([
      'cli',
      'agent',
      'cli',
      'orch',
      'agent',
      'cli',
      'agent',
      'orch',
      'wait',
      'orch',
      'wait',
    ])
    expect(view.segments.at(-1)?.to).toBeNull()
  })

  test('a read of another actor’s file sends a comet only between two stations', () => {
    const annotator = new Annotator()
    const view = createJobView(13)
    const events = [
      ...launch(1, TEST, 'x'),
      hook(2, 'write', TEST, { target: { area: 'job', path: 'acceptance.md' } }),
      hook(3, 'agent.stop', TEST),
      ...launch(4, BUILD, 'y'),
      hook(5, 'read', BUILD, { target: { area: 'job', path: 'acceptance.md' }, tokens: 10 }),
    ]
    const effects = events.map((event) => applyEvent(view, annotator.push(event)))
    expect(effects.at(-1)).toEqual({ comet: { from: 'test', to: 'build' } })
    expect(effects.slice(0, -1).every((e) => !e.comet)).toBe(true)
  })

  test('the latest move stays lit for the window, then falls back to the trail', () => {
    const { view } = run()
    expect(edgeState(view, 'e16', view.onAt + 1000, 5000)).toBe('on')
    expect(edgeState(view, 'e16', view.onAt + 6000, 5000)).toBe('trail')
    expect(edgeState(view, 'e17', view.onAt, 5000)).toBe('trail')
  })
})

const usage = (usd: number, over: Record<string, unknown> = {}) => ({
  messages: 3,
  models: { 'claude-sonnet-5-5': 3 },
  efforts: { medium: 3 },
  tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite5m: 4, cacheWrite1h: 5 },
  usd,
  unpriced: [],
  ...over,
})
const play = (...events: FactoryEvent[]) => {
  const annotator = new Annotator()
  const view = createJobView(13)
  for (const event of events) applyEvent(view, annotator.push(event))
  return view
}

describe('cost, model and effort per run', () => {
  test('each run shows its model and effort, and the job totals the runs', () => {
    const view = play(
      ...launch(1, TEST, 'x'),
      hook(2, 'agent.stop', TEST),
      hook(3, 'usage', TEST, { detail: usage(0.5) }),
      hook(4, 'usage', undefined, { detail: usage(1.25, { models: { 'claude-opus-5-5': 3 } }) }),
    )
    expect(view.runs.get('a-test')?.usage).toMatchObject({
      models: { 'claude-sonnet-5-5': 3 },
      efforts: { medium: 3 },
      usd: 0.5,
    })
    expect(view.runs.get('orchestrator')?.usage?.usd).toBe(1.25)
    expect(view.cost.usd).toBeCloseTo(1.75, 6)
  })

  test('a run that stops again replaces its cost instead of adding to it', () => {
    const view = play(
      ...launch(1, TEST, 'x'),
      hook(2, 'usage', TEST, { detail: usage(0.5) }),
      hook(3, 'usage', TEST, { detail: usage(0.8) }),
    )
    expect(view.runs.get('a-test')?.usage?.usd).toBe(0.8)
    expect(view.cost.usd).toBeCloseTo(0.8, 6)
  })

  test('a run with an unpriced model puts it on the job, not a zero', () => {
    const view = play(
      ...launch(1, TEST, 'x'),
      hook(2, 'usage', TEST, { detail: usage(0, { unpriced: ['claude-mystery-9'] }) }),
    )
    expect(view.cost.unpriced).toEqual(['claude-mystery-9'])
  })
})
