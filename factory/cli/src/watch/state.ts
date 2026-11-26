// What factory watch knows about a job, built from its event stream. The page imports this file
// (server.ts serves it to the browser as plain JavaScript), and the tests run it, so it has no
// imports beyond types and touches neither the DOM nor the clock: the page passes the time in.

import type { Annotated } from '../annotate.ts'
import type { RunUsage } from '../usage.ts'

// ---- The flow: stations and edges, as in factory/README.md ---------------------------------------

export type StationKind = 'user' | 'orch' | 'cli' | 'agent' | 'wait'

export const STATIONS = {
  ready: { label: 'Issue ready', kind: 'user', x: 24, y: 34 },
  start: { label: '/factory', kind: 'orch', x: 184, y: 34 },
  wt: { label: 'Worktree', kind: 'cli', x: 344, y: 34 },
  test: { label: 'Test agent', kind: 'agent', x: 504, y: 34, sub: 'sonnet' },
  red: { label: 'Valid red?', kind: 'cli', x: 664, y: 34 },
  build: { label: 'Build agent', kind: 'agent', x: 664, y: 174, sub: 'sonnet' },
  checks: { label: 'Checks', kind: 'cli', x: 504, y: 174 },
  gate: { label: 'Gate', kind: 'cli', x: 344, y: 174 },
  eval: { label: 'Evaluator', kind: 'agent', x: 184, y: 138, sub: 'opus' },
  tqr: { label: 'Test reviewer', kind: 'agent', x: 184, y: 210, sub: 'opus' },
  verdict: { label: 'Findings?', kind: 'orch', x: 24, y: 174 },
  atfix: { label: 'AT fix', kind: 'agent', x: 504, y: 318, sub: 'test agent' },
  pr: { label: 'PR', kind: 'cli', x: 24, y: 318 },
  merged: { label: 'You merge', kind: 'user', x: 184, y: 318 },
  dr: { label: 'Decision', kind: 'wait', x: 824, y: 174, sub: 'request' },
} as const satisfies Record<
  string,
  { label: string; kind: StationKind; x: number; y: number; sub?: string }
>

export type StationId = keyof typeof STATIONS
export const STATION_IDS = Object.keys(STATIONS) as StationId[]
export const CARD = { w: 112, h: 44 }

export const EDGE_IDS = [
  'e1',
  'e2',
  'e3',
  'e4',
  'e5',
  'e6',
  'e7',
  'e8',
  'e9',
  'e10',
  'e11',
  'e12',
  'e13',
  'e14',
  'e15',
  'e16',
  'e17',
  'e18',
] as const
export type EdgeId = (typeof EDGE_IDS)[number]

const ROLE_STATION: Record<string, StationId> = {
  'factory-test': 'test',
  'factory-build': 'build',
  'factory-evaluator': 'eval',
  'factory-test-reviewer': 'tqr',
}
const stationOfActor = (actor: string | undefined): StationId | undefined =>
  actor ? ROLE_STATION[actor] : undefined

export type StationState = 'idle' | 'active' | 'done' | 'fail'
export type Phase = 'building' | 'blocked' | 'pr_open'

// ---- Where the orchestrator is -----------------------------------------------------------------

/** What the orchestrator is doing, which sets the colour of its lane in the timeline. */
export type OrchestratorMode =
  /** Deciding, in its own session. */
  | 'orch'
  /** Running a CLI step. */
  | 'cli'
  /** Waiting on an agent run. */
  | 'agent'
  /** Waiting on the user. */
  | 'wait'

export type Reticle = { at: StationId[]; what: string; mode: OrchestratorMode }

/** Everything `orchestratorAt` needs; the reducer keeps it up to date. */
export type OrchestratorInput = {
  phase: Phase
  /** Stations of the top-level agent runs that haven't stopped. */
  running: StationId[]
  /** The kind of the latest CLI event, or null before the first. */
  lastCli: string | null
  /** The station of the agent run that stopped last, until the next CLI event or agent start. */
  lastStop: StationId | null
  attempt: number
  round: number
}

const MAX_ATTEMPTS = 3
const CLI_STATION: Record<string, { at: StationId; what: string }> = {
  'job.started': { at: 'wt', what: 'creating the worktree' },
  'job.resumed': { at: 'start', what: 'resuming the job' },
  'job.migrated': { at: 'start', what: 'resuming the job' },
  'red.accepted': { at: 'red', what: 'red accepted' },
  'red.rejected': { at: 'red', what: 'red rejected · back to the test agent' },
  'checks.started': { at: 'checks', what: 'running the checks' },
  'checks.passed': { at: 'checks', what: 'checks green' },
  'checks.failed': { at: 'checks', what: 'checks red' },
  'gate.passed': { at: 'gate', what: 'gate passed · dispatching the reviewers' },
  'gate.rejected': { at: 'gate', what: 'gate rejected' },
  atfix: { at: 'atfix', what: 'applying an AT fix' },
  rewrite: { at: 'atfix', what: 'rewriting an acceptance test' },
}
const AFTER_STOP: Partial<Record<StationId, { at: StationId; what: string }>> = {
  test: { at: 'red', what: 'asking the CLI for a valid red' },
  build: { at: 'checks', what: 'running the checks' },
  eval: { at: 'verdict', what: 'merging the reviews' },
  tqr: { at: 'verdict', what: 'merging the reviews' },
}

const modeAt = (at: StationId[], running: StationId[]): OrchestratorMode => {
  if (at.some((id) => running.includes(id))) return 'agent'
  const first = at[0]
  const kind = first ? STATIONS[first].kind : 'orch'
  return kind === 'cli' ? 'cli' : kind === 'wait' || kind === 'user' ? 'wait' : 'orch'
}

/**
 * The station (or stations) the orchestrator is on, and what it is doing there, from the events
 * so far. In order of precedence: a Decision Request or an open PR; the reviewers running; the
 * build agent running (the checks it triggers keep the orchestrator there); the test agent
 * running; the agent that just stopped; the latest CLI step.
 */
export function orchestratorAt(input: OrchestratorInput): Reticle {
  const { phase, running, lastCli, lastStop, attempt, round } = input
  const pick = (at: StationId[], what: string): Reticle => ({
    at,
    what,
    mode: modeAt(at, running),
  })
  if (phase === 'blocked') return { at: ['dr'], what: 'waiting on you', mode: 'wait' }
  if (phase === 'pr_open')
    return { at: ['merged'], what: 'your turn · review the PR', mode: 'wait' }
  const reviewers = (['eval', 'tqr'] as const).filter((id) => running.includes(id))
  if (reviewers.length === 2) return pick([...reviewers], 'waiting on both reviewers · blind pass')
  if (reviewers.length === 1) {
    return pick(
      [...reviewers],
      reviewers[0] === 'eval' ? 'waiting on the evaluator' : 'waiting on the test reviewer',
    )
  }
  if (running.includes('build'))
    return pick(['build'], `waiting on build · try ${attempt}/${MAX_ATTEMPTS}`)
  if (running.includes('test')) return pick(['test'], 'waiting on the test agent')
  if (lastStop) {
    const next = AFTER_STOP[lastStop]
    if (next) return pick([next.at], next.what)
  }
  if (lastCli === 'attempt') {
    return pick(['build'], `dispatching build · try ${attempt}/${MAX_ATTEMPTS}`)
  }
  if (lastCli === 'round') return pick(['verdict'], `merging findings · round ${round}`)
  if (lastCli === 'blocked') return pick(['dr'], 'waiting on you')
  if (lastCli === 'pr.opened') return pick(['merged'], 'your turn · review the PR')
  const step = lastCli ? CLI_STATION[lastCli] : undefined
  if (step) return pick([step.at], step.what)
  return pick(['start'], 'taking the job')
}

/** The box around a reticle's stations, in map pixels, with 8px of air on every side. */
export function reticleBox(at: StationId[]) {
  const pad = 8
  const cards = at.map((id) => STATIONS[id])
  if (!cards.length) return { x: 0, y: 0, w: 0, h: 0 }
  const x0 = Math.min(...cards.map((c) => c.x))
  const y0 = Math.min(...cards.map((c) => c.y))
  const x1 = Math.max(...cards.map((c) => c.x + CARD.w))
  const y1 = Math.max(...cards.map((c) => c.y + CARD.h))
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }
}

// ---- A job's state ------------------------------------------------------------------------------

export type JobInfo = {
  number: number
  title: string
  state: Phase
}

export type Run = {
  id: string
  type: string
  role: string | undefined
  parent: string | undefined
  /** The station of the factory role behind the run; a nested run takes its launcher's. */
  station: StationId | undefined
  /** False for a run the log only saw stop. */
  started: boolean
  start: number
  end: number | null
  prompt: unknown
  description: unknown
  instructions: Annotated[]
  reads: Annotated[]
  writes: Annotated[]
  denied: Annotated[]
  searches: Annotated[]
  bash: Annotated[]
  changed: { status: string; path: string }[]
  /** The run's total from its latest usage event: each one recomputes it from the transcript. */
  usage: RunUsage | null
}

/** What the job's runs cost together; `unpriced` models have tokens but no price. */
export type Cost = { usd: number; unpriced: string[] }

export type Segment = { mode: OrchestratorMode; from: number; to: number | null }
export type Mark = { t: number; kind: string; fail: boolean }

export type JobView = {
  number: number
  info: JobInfo | null
  runs: Map<string, Run>
  order: string[]
  marks: Mark[]
  breaches: { ev: Annotated; run: Run }[]
  deniedCount: number
  handoffs: { ev: Annotated; run: Run }[]
  /** The newest events, oldest first, capped at FEED_CAP. */
  feed: Annotated[]
  feedTotal: number
  t0: number | null
  last: number
  /** From the job's own events, never from job.json, so a replay shows the job as it was then. */
  phase: Phase | null
  attempt: number
  round: number
  readCount: number
  tokens: number
  cost: Cost
  stations: Record<StationId, StationState>
  /** Stations whose run read something it should not have. */
  flagged: Set<StationId>
  trail: Set<EdgeId>
  /** The edges of the latest move, and when it happened. */
  on: EdgeId[]
  onAt: number
  reticle: Reticle
  segments: Segment[]
  lastCli: string | null
  lastStop: StationId | null
  /** A round ended with findings the next build attempt will take. */
  findingsPending: boolean
  /** Counts events; the page redraws what depends on it only when it moves. */
  rev: number
}

export const FEED_CAP = 300

export function createJobView(number: number): JobView {
  return {
    number,
    info: null,
    runs: new Map(),
    order: [],
    marks: [],
    breaches: [],
    deniedCount: 0,
    handoffs: [],
    feed: [],
    feedTotal: 0,
    t0: null,
    last: 0,
    phase: null,
    attempt: 0,
    round: 0,
    readCount: 0,
    tokens: 0,
    cost: { usd: 0, unpriced: [] },
    stations: Object.fromEntries(STATION_IDS.map((id) => [id, 'idle'])) as Record<
      StationId,
      StationState
    >,
    flagged: new Set(),
    trail: new Set(),
    on: [],
    onAt: 0,
    reticle: orchestratorAt({
      phase: 'building',
      running: [],
      lastCli: null,
      lastStop: null,
      attempt: 0,
      round: 0,
    }),
    segments: [],
    lastCli: null,
    lastStop: null,
    findingsPending: false,
    rev: 0,
  }
}

/** What an event asks the page to animate, besides the state it changed. */
export type Effects = { comet?: { from: StationId; to: StationId } }

const FAIL_KINDS = new Set(['checks.failed', 'gate.rejected', 'red.rejected'])
const AGENT_STATIONS = new Set<StationId>(['test', 'build', 'eval', 'tqr'])

export const runningStations = (view: JobView): StationId[] => {
  const found = new Set<StationId>()
  for (const run of view.runs.values()) {
    if (run.started && run.end === null && !run.parent && run.station) found.add(run.station)
  }
  return [...found]
}

function totalCost(view: JobView): Cost {
  const runs = [...view.runs.values()]
  return {
    usd: runs.reduce((sum, run) => sum + (run.usage?.usd ?? 0), 0),
    unpriced: [...new Set(runs.flatMap((run) => run.usage?.unpriced ?? []))],
  }
}

function runOf(view: JobView, ev: Annotated, time: number): Run {
  const id = ev.agent ? ev.agent.id : 'orchestrator'
  let run = view.runs.get(id)
  if (!run) {
    run = {
      id,
      type: ev.agent ? ev.agent.type : 'orchestrator',
      role: ev.role,
      parent: ev.parent,
      station: undefined,
      started: ev.kind !== 'agent.stop',
      start: time,
      end: null,
      prompt: null,
      description: null,
      instructions: [],
      reads: [],
      writes: [],
      denied: [],
      searches: [],
      bash: [],
      changed: [],
      usage: null,
    }
    view.runs.set(id, run)
    view.order.push(id)
  }
  if (ev.role && !run.role) run.role = ev.role
  if (ev.parent && !run.parent) run.parent = ev.parent
  run.station ??= stationOfActor(run.role ?? run.type)
  return run
}

/** Lights a CLI or orchestrator station: the one that was lit before settles to done. */
function pulse(view: JobView, id: StationId, state: StationState = 'active') {
  for (const other of STATION_IDS) {
    if (!AGENT_STATIONS.has(other) && view.stations[other] === 'active') {
      view.stations[other] = 'done'
    }
  }
  view.stations[id] = state
}

function move(view: JobView, time: number, on: EdgeId[], trail: EdgeId[] = []) {
  for (const id of [...trail, ...on]) view.trail.add(id)
  if (on.length) {
    view.on = on
    view.onAt = time
  }
}

function applyCli(view: JobView, ev: Annotated, time: number) {
  const detail = ev.detail ?? {}
  switch (ev.kind) {
    case 'job.started':
      view.stations.ready = 'done'
      pulse(view, 'start', 'done')
      pulse(view, 'wt')
      move(view, time, ['e2'], ['e1'])
      view.phase = 'building'
      break
    case 'job.resumed':
      pulse(view, 'start')
      if (view.phase === 'blocked') view.stations.dr = 'done'
      view.phase = 'building'
      break
    case 'red.accepted':
      pulse(view, 'red')
      move(view, time, ['e4'])
      break
    case 'red.rejected':
      pulse(view, 'red', 'fail')
      move(view, time, ['e5'], ['e4'])
      break
    case 'attempt': {
      view.attempt = typeof detail.attempt === 'number' ? detail.attempt : view.attempt + 1
      const builtBefore = [...view.runs.values()].some((r) => r.role === 'factory-build')
      if (view.findingsPending) move(view, time, ['e12'])
      else if (!builtBefore) move(view, time, ['e6'])
      view.findingsPending = false
      break
    }
    case 'checks.started':
      pulse(view, 'checks')
      move(view, time, [view.lastCli === 'atfix' ? 'e14' : 'e7'])
      break
    case 'checks.passed':
      pulse(view, 'checks', 'done')
      move(view, time, ['e9'])
      break
    case 'checks.failed':
      pulse(view, 'checks', 'fail')
      move(view, time, ['e8'])
      break
    case 'gate.passed':
      pulse(view, 'gate')
      move(view, time, ['e10'])
      break
    case 'gate.rejected':
      pulse(view, 'gate', 'fail')
      break
    case 'round':
      view.round = typeof detail.round === 'number' ? detail.round : view.round + 1
      view.findingsPending = true
      pulse(view, 'verdict')
      move(view, time, ['e11'])
      break
    case 'atfix':
    case 'rewrite':
      pulse(view, 'atfix')
      move(view, time, ['e13'])
      break
    case 'blocked':
      pulse(view, 'dr')
      move(view, time, [view.lastCli === 'red.rejected' ? 'e18' : 'e17'])
      view.phase = 'blocked'
      break
    case 'pr.opened':
      pulse(view, 'pr', 'done')
      pulse(view, 'merged')
      move(view, time, ['e15', 'e16'])
      view.phase = 'pr_open'
      break
    default:
      break
  }
  view.marks.push({ t: time, kind: ev.kind, fail: FAIL_KINDS.has(ev.kind) })
  view.lastCli = ev.kind
  view.lastStop = null
}

function applyHook(view: JobView, ev: Annotated, time: number): Effects {
  const effects: Effects = {}
  const run = runOf(view, ev, time)
  const top = !run.parent
  const detail = ev.detail ?? {}
  switch (ev.kind) {
    case 'agent.start':
      run.start = time
      run.prompt = detail.prompt
      run.description = detail.description
      if (top && run.station) {
        view.stations[run.station] = 'active'
        view.lastStop = null
        if (run.station === 'test') move(view, time, ['e3'], ['e1', 'e2'])
      }
      break
    case 'agent.stop': {
      if (!run.started) break
      run.end = time
      run.changed = Array.isArray(detail.changed)
        ? (detail.changed as { status: string; path: string }[])
        : []
      if (top && run.station) {
        const station = run.station
        if (!runningStations(view).includes(station)) {
          view.stations[station] = 'done'
          view.lastStop = station
          if (
            (station === 'eval' || station === 'tqr') &&
            !runningStations(view).some((id) => id === 'eval' || id === 'tqr')
          ) {
            move(view, time, ['e11'])
          }
        }
      }
      break
    }
    case 'usage':
      run.usage = ev.detail as RunUsage
      view.cost = totalCost(view)
      break
    case 'instructions':
      run.instructions.push(ev)
      break
    case 'read': {
      run.reads.push(ev)
      view.readCount += 1
      view.tokens += ev.tokens ?? 0
      if (ev.breach) {
        view.breaches.push({ ev, run })
        if (run.station) view.flagged.add(run.station)
      }
      if (ev.from) {
        view.handoffs.push({ ev, run })
        const from =
          stationOfActor(ev.from) ?? (ev.from === 'orchestrator' ? view.reticle.at[0] : undefined)
        if (from && run.station && from !== run.station) {
          effects.comet = { from, to: run.station }
        }
      }
      break
    }
    case 'write':
      run.writes.push(ev)
      break
    case 'write.denied':
      run.denied.push(ev)
      view.deniedCount += 1
      break
    case 'search':
      run.searches.push(ev)
      break
    case 'bash':
      run.bash.push(ev)
      break
    case 'bash.files':
      run.changed.push(
        ...(Array.isArray(detail.files) ? (detail.files as string[]) : []).map((path) => ({
          status: 'B',
          path,
        })),
      )
      break
    default:
      break
  }
  return effects
}

function trackSegments(view: JobView, time: number) {
  const open = view.segments.at(-1)
  const mode = view.reticle.mode
  if (open && open.mode === mode) return
  if (open) open.to = time
  view.segments.push({ mode, from: time, to: null })
}

/** Folds one event into a job's view (in place) and says what the page should animate. */
export function applyEvent(view: JobView, ev: Annotated): Effects {
  const time = Date.parse(ev.t)
  if (view.t0 === null || time < view.t0) view.t0 = time
  view.last = Math.max(view.last, time)
  view.rev += 1
  view.feed.push(ev)
  view.feedTotal += 1
  if (view.feed.length > FEED_CAP) view.feed.shift()

  let effects: Effects = {}
  if (ev.source === 'cli') applyCli(view, ev, time)
  else effects = applyHook(view, ev, time)

  view.reticle = orchestratorAt({
    phase: view.phase ?? 'building',
    running: runningStations(view),
    lastCli: view.lastCli,
    lastStop: view.lastStop,
    attempt: view.attempt,
    round: view.round,
  })
  trackSegments(view, time)
  return effects
}

// ---- What the page reads back ------------------------------------------------------------------

export type EdgeState = 'idle' | 'trail' | 'on'

/** `window` is how long the latest move stays lit, in the same time as `now`. */
export function edgeState(view: JobView, id: EdgeId, now: number, window: number): EdgeState {
  if (view.on.includes(id) && now - view.onAt < window) return 'on'
  return view.trail.has(id) ? 'trail' : 'idle'
}

/** The job's phase from its events; job.json's state only before the first event. */
export const phaseOf = (view: JobView): Phase =>
  view.phase ?? (view.rev === 0 ? view.info?.state : undefined) ?? 'building'

export const runLabel = (view: JobView, run: Run): string => {
  if (run.id === 'orchestrator') return 'Orchestrator'
  const name = run.type.replace('factory-', '').replace(/-/g, ' ')
  const label = name.charAt(0).toUpperCase() + name.slice(1)
  if (run.role === 'factory-build' && !run.parent) {
    const builds = [...view.runs.values()].filter((r) => r.role === 'factory-build' && !r.parent)
    return `${label} · try ${builds.indexOf(run) + 1}`
  }
  return label
}

export const runTokens = (run: Run) => run.reads.reduce((sum, r) => sum + (r.tokens ?? 0), 0)

export const where = (target: Annotated['target']): string =>
  target
    ? target.area === 'job'
      ? `job:${target.path}`
      : target.area === 'repo'
        ? target.path
        : `outside: ${target.path}`
    : ''

const OK_KINDS = new Set(['red.accepted', 'checks.passed', 'gate.passed', 'pr.opened'])
const FAIL_ROW_KINDS = new Set([...FAIL_KINDS, 'write.denied', 'blocked'])

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const trim = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}…` : value

/** Who a feed row's chip names, and which colour class it takes. */
export function actorOf(ev: Annotated): { who: string; k: string } {
  if (ev.source === 'cli') return { who: 'cli', k: 'k-cli' }
  if (!ev.agent) return { who: 'orch', k: 'k-orch' }
  const role = ev.agent.type in ROLE_STATION ? ev.agent.type : undefined
  if (!role) return { who: ev.agent.type.toLowerCase() || 'agent', k: 'k-explore' }
  const short = role.replace('factory-', '')
  return { who: short === 'test-reviewer' ? 'test-rev' : short, k: 'k-agent' }
}

/** One row of the live feed: a kind, a short message and a style (ok, fail, hand, breach). */
export function describe(ev: Annotated): { kind: string; msg: string; cls: string } {
  const detail = ev.detail ?? {}
  const path = where(ev.target)
  let kind = ev.kind
  let msg = ''
  let cls = OK_KINDS.has(ev.kind) ? 'ok' : FAIL_ROW_KINDS.has(ev.kind) ? 'fail' : ''
  switch (ev.kind) {
    case 'read':
      msg = path
      if (ev.from) {
        kind = 'handoff'
        msg = `${path} from ${ev.from.replace('factory-', '')}`
        cls = 'hand'
      }
      if (ev.breach) {
        cls = 'breach'
        msg = `${path} · ${ev.breach}`
      }
      break
    case 'write':
    case 'instructions':
      msg = path
      break
    case 'write.denied':
      msg = `${path} · ${text(detail.reason)}`
      break
    case 'search':
      msg = `${text(detail.tool)} ${text(detail.pattern)} ${path}`.trim()
      break
    case 'bash':
      msg = trim(text(detail.command), 160)
      break
    case 'bash.files':
      msg = `${Array.isArray(detail.files) ? detail.files.length : 0} files changed`
      break
    case 'tool':
      msg = text(detail.tool)
      break
    case 'agent.prompt':
      msg = `${text(detail.subagentType)} · ${trim(text(detail.description), 100)}`
      break
    case 'agent.launched':
      msg = text(detail.childType) || text(detail.childId)
      break
    case 'usage':
      msg = typeof detail.usd === 'number' ? `$${detail.usd.toFixed(2)}` : ''
      break
    case 'agent.stop':
      msg = Array.isArray(detail.changed) ? `${detail.changed.length} files changed` : ''
      break
    case 'job.started':
      msg = text(detail.branch)
      break
    case 'attempt':
      msg = `build attempt ${String(detail.attempt ?? '')}`
      break
    case 'round':
      msg = `review round ${String(detail.round ?? '')}`
      break
    case 'red.accepted':
      msg = `${Array.isArray(detail.files) ? detail.files.length : 0} acceptance files`
      break
    case 'red.rejected':
    case 'gate.rejected':
      msg = Array.isArray(detail.problems) ? trim(detail.problems.join(' · '), 160) : ''
      break
    case 'checks.failed':
      msg = text(detail.failedStep)
      break
    case 'atfix':
    case 'rewrite':
      msg = trim(text(detail.note), 140)
      break
    case 'pr.opened':
      msg = text(detail.url)
      break
    case 'blocked':
      msg = text(detail.file)
      break
    default:
      break
  }
  return { kind, msg, cls }
}
