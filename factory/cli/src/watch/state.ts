// What factory watch knows about a job, built from its event stream. The page imports this file
// (server.ts serves it to the browser as plain JavaScript), and the tests run it, so it has no
// imports beyond types and touches neither the DOM nor the clock: the page passes the time in.

import type { Annotated } from '../annotate.ts'
import type { RunUsage } from '../usage.ts'

// ---- The flow: stations and edges, as in factory/README.md ---------------------------------------

type StationKind = 'user' | 'orch' | 'cli' | 'agent' | 'wait'

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
  diag: { label: 'Diagnosis', kind: 'agent', x: 664, y: 318, sub: 'opus' },
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
  'e19',
  'e20',
] as const
type EdgeId = (typeof EDGE_IDS)[number]

const ROLE_STATION: Record<string, StationId> = {
  'factory-test': 'test',
  'factory-build': 'build',
  'factory-evaluator': 'eval',
  'factory-test-reviewer': 'tqr',
  'factory-diagnose': 'diag',
}
const stationOfActor = (actor: string | undefined): StationId | undefined =>
  actor ? ROLE_STATION[actor] : undefined

type StationState = 'idle' | 'active' | 'done' | 'fail'
type Phase = 'building' | 'blocked' | 'pr_open'

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

type Reticle = { at: StationId[]; what: string; mode: OrchestratorMode }

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
  diag: { at: 'build', what: 'dispatching build with the diagnosis' },
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
  if (running.includes('diag')) return pick(['diag'], 'waiting on the diagnosis agent')
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

type RiskLevel = 'low' | 'normal' | 'high'
export type RoleTask = 'review' | 'verify' | 'carry'

/** What the server adds to job.json for the page: files the job's events do not carry. */
export type JobExtras = {
  /** The text of each Decision Request, oldest first; null when its file is gone. */
  requests: (string | null)[]
  /** The verdict each ruling's file says, by ruling number; null while it is unwritten. */
  rulingVerdicts: Record<string, string | null>
  /** The roles that have a folder under the handoff's sandbox/. */
  sandboxFolders: string[]
  /** The contents of seal.json while the job is sealed. */
  seal: { pass: number; roles: string[]; at: string } | null
}

type PlanInfo = {
  pass: number
  head?: string
  changed: string[] | number
  risk: RiskLevel
  raisedBy: string[]
  roles: Partial<Record<string, RoleTask>>
  at: string
}

/** job.json as the page gets it, with the server's extras. Everything but the first three is optional. */
export type JobInfo = {
  number: number
  title: string
  state: Phase
  risk?: RiskLevel
  reviews?: PlanInfo[]
  rulings?: { ruling: number; diff: string; at: string }[]
  atfixes?: { sha: string; note: string; files: string[]; ruling?: number }[]
  decisionRequests?: { at: string; file: string }[]
  answers?: { request: number; at: string; text: string; cited?: boolean }[]
  extras?: JobExtras
}

/** The orchestrator's own setting, as in ORCHESTRATOR in launch.ts (a test keeps them equal). */
export const ORCHESTRATOR_PLAN = { model: 'opus', effort: 'high' } as const

/** A run's reads: the Read tool's, and the paths a Bash command, a Grep or a Glob read. */
type ReadEntry = Annotated & { via: string }

/** What `factory launch` planned for one agent run. */
type PlannedRun = {
  agent: string
  task: string
  model: string
  effort: string
  risk: string
  t: number
  /** The run that started under this plan, once one did. */
  run: string | null
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
  reads: ReadEntry[]
  writes: Annotated[]
  denied: Annotated[]
  searches: Annotated[]
  bash: Annotated[]
  changed: { status: string; path: string }[]
  /** The run's total from its latest usage event: each one recomputes it from the transcript. */
  usage: RunUsage | null
  /** What `factory launch` planned for it, when the log has a plan for this run. */
  plan: PlannedRun | null
}

/** One seal: the review pass it covers, who must write a blind pass, and when it opened and shut. */
type SealRecord = {
  pass: number
  roles: string[]
  sealedAt: number
  unsealedAt: number | null
  /** Roles whose blind pass of this pass is written. */
  blind: string[]
}

type SandboxRecord = {
  role: string
  path: string
  port: unknown
  database: unknown
  bucket: unknown
  removed: boolean
}

/** The calls the guard denies; each is logged as an event of its own kind. */
const DENIAL_KINDS = new Set(['write.denied', 'read.denied', 'bash.denied', 'agent.denied'])

/** What the job's runs cost together; `unpriced` models have tokens but no price. */
export type Cost = { usd: number; unpriced: string[] }

type Segment = { mode: OrchestratorMode; from: number; to: number | null }
export type Mark = { t: number; kind: string; fail: boolean; request?: number }

type JobView = {
  number: number
  info: JobInfo | null
  runs: Map<string, Run>
  order: string[]
  marks: Mark[]
  breaches: { ev: Annotated; run: Run }[]
  /** Calls the guard denied, of every kind in DENIAL_KINDS. */
  deniedCount: number
  deniedBy: Record<string, number>
  /** Reads by the tool that made them: Read, Bash, Grep or Glob. */
  readBy: Record<string, number>
  seals: SealRecord[]
  sandboxes: Map<string, SandboxRecord>
  planned: PlannedRun[]
  /** The review plans the log announced, one per pass. */
  reviewPlans: PlanInfo[]
  /** Risk the latest plan or launch named. */
  risk: RiskLevel | null
  rulingRequests: { ruling: number; diff: string; t: number }[]
  /** Rulings an AT fix was committed on, by ruling number. */
  rulingFixes: Map<number, { sha: string | null; t: number }>
  blockedCount: number
  answeredCount: number
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

const FEED_CAP = 300

export function createJobView(number: number): JobView {
  return {
    number,
    info: null,
    runs: new Map(),
    order: [],
    marks: [],
    breaches: [],
    deniedCount: 0,
    deniedBy: {},
    readBy: { Read: 0, Bash: 0, Grep: 0, Glob: 0 },
    seals: [],
    sandboxes: new Map(),
    planned: [],
    reviewPlans: [],
    risk: null,
    rulingRequests: [],
    rulingFixes: new Map(),
    blockedCount: 0,
    answeredCount: 0,
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
type Effects = { comet?: { from: StationId; to: StationId } }

const FAIL_KINDS = new Set(['checks.failed', 'gate.rejected', 'red.rejected'])
const AGENT_STATIONS = new Set<StationId>(['test', 'build', 'eval', 'tqr', 'diag'])

const runningStations = (view: JobView): StationId[] => {
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
      plan: null,
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

const RISK_RANK: Record<RiskLevel, number> = { low: 0, normal: 1, high: 2 }
const asRisk = (value: unknown): RiskLevel | null =>
  value === 'low' || value === 'normal' || value === 'high' ? value : null
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

/**
 * CLI events that add facts to the job without moving the flow: the orchestrator is where it was.
 * They show in the timeline and the feed, and update the panels, never the reticle.
 */
const INFO_KINDS = new Set([
  'launch.planned',
  'review.planned',
  'sealed',
  'unsealed',
  'ruling.requested',
  'answered',
  'sandbox.created',
  'sandbox.removed',
])

function applyInfo(view: JobView, ev: Annotated, time: number) {
  const detail = ev.detail ?? {}
  switch (ev.kind) {
    case 'launch.planned':
      view.risk = asRisk(detail.risk) ?? view.risk
      view.planned.push({
        agent: String(detail.agent ?? ''),
        task: String(detail.task ?? ''),
        model: String(detail.model ?? ''),
        effort: String(detail.effort ?? ''),
        risk: String(detail.risk ?? ''),
        t: time,
        run: null,
      })
      break
    case 'review.planned': {
      const risk = asRisk(detail.risk)
      view.risk = risk ?? view.risk
      const roles = (detail.roles ?? {}) as PlanInfo['roles']
      const plan: PlanInfo = {
        pass: Number(detail.pass ?? view.reviewPlans.length + 1),
        changed: typeof detail.changed === 'number' ? detail.changed : strings(detail.changed),
        risk: risk ?? 'normal',
        raisedBy: strings(detail.raisedBy),
        roles,
        at: ev.t,
      }
      const at = view.reviewPlans.findIndex((item) => item.pass === plan.pass)
      if (at === -1) view.reviewPlans.push(plan)
      else view.reviewPlans[at] = plan
      break
    }
    case 'sealed':
      view.seals.push({
        pass: Number(detail.pass ?? 0),
        roles: strings(detail.roles),
        sealedAt: time,
        unsealedAt: null,
        blind: [],
      })
      break
    case 'unsealed': {
      const open = view.seals.findLast((item) => item.unsealedAt === null)
      if (open) open.unsealedAt = time
      break
    }
    case 'ruling.requested':
      view.rulingRequests.push({
        ruling: Number(detail.ruling ?? 0),
        diff: String(detail.diff ?? ''),
        t: time,
      })
      break
    case 'answered':
      view.answeredCount += 1
      break
    case 'sandbox.created':
      view.sandboxes.set(String(detail.role ?? ''), {
        role: String(detail.role ?? ''),
        path: String(detail.path ?? ''),
        port: detail.port,
        database: detail.database,
        bucket: detail.bucket,
        removed: false,
      })
      break
    case 'sandbox.removed': {
      const found = view.sandboxes.get(String(detail.role ?? ''))
      if (found) found.removed = true
      break
    }
    default:
      break
  }
  view.marks.push({
    t: time,
    kind: ev.kind,
    fail: false,
    ...(ev.kind === 'answered' ? { request: Number(detail.request ?? view.answeredCount) } : {}),
  })
}

function applyCli(view: JobView, ev: Annotated, time: number) {
  const detail = ev.detail ?? {}
  if (INFO_KINDS.has(ev.kind)) {
    applyInfo(view, ev, time)
    return
  }
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
      if (ev.kind === 'atfix' && typeof detail.ruling === 'number') {
        view.rulingFixes.set(detail.ruling, {
          sha: typeof detail.sha === 'string' ? detail.sha : null,
          t: time,
        })
      }
      pulse(view, 'atfix')
      move(view, time, ['e13'])
      break
    case 'blocked':
      pulse(view, 'dr')
      move(view, time, [view.lastCli === 'red.rejected' ? 'e18' : 'e17'])
      view.phase = 'blocked'
      view.blockedCount += 1
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
        if (run.station === 'diag') move(view, time, ['e19'])
      }
      bindPlan(view, run)
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
          if (station === 'diag') move(view, time, ['e20'], ['e19'])
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
      run.reads.push({ ...ev, via: 'Read' })
      view.readCount += 1
      view.readBy.Read = (view.readBy.Read ?? 0) + 1
      view.tokens += ev.tokens ?? 0
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
    case 'write': {
      run.writes.push(ev)
      const blind = /^reviews\/(\d+)\.(evaluator|test-reviewer)\.blind\.md$/.exec(
        ev.target?.area === 'job' ? ev.target.path : '',
      )
      const seal = blind && view.seals.findLast((item) => item.pass === Number(blind[1]))
      if (seal && blind?.[2] && !seal.blind.includes(blind[2])) seal.blind.push(blind[2])
      break
    }
    case 'search':
      run.searches.push(ev)
      addReads(view, run, ev, String(detail.tool ?? 'Grep'))
      break
    case 'bash':
      run.bash.push(ev)
      addReads(view, run, ev, 'Bash')
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
  if (DENIAL_KINDS.has(ev.kind)) {
    run.denied.push(ev)
    view.deniedCount += 1
    view.deniedBy[ev.kind] = (view.deniedBy[ev.kind] ?? 0) + 1
  }
  // A breach is whatever the annotator flagged: a read by any tool, or a denied read or call.
  if (ev.breach) {
    view.breaches.push({ ev, run })
    if (run.station) view.flagged.add(run.station)
  }
  return effects
}

/** The paths a Bash command, a Grep or a Glob read, each as a read of the run, tagged by its tool. */
function addReads(view: JobView, run: Run, ev: Annotated, via: string) {
  for (const read of ev.reads ?? []) {
    const { breach: _all, reads: _reads, input: _input, ...rest } = ev
    run.reads.push({
      ...rest,
      kind: 'read',
      target: read.target,
      via,
      ...(read.input ? { input: read.input } : {}),
      ...(read.breach ? { breach: read.breach } : {}),
    })
    view.readCount += 1
    view.readBy[via] = (view.readBy[via] ?? 0) + 1
  }
}

/** Ties the run that just started to the oldest unclaimed `factory launch` plan for its agent. */
function bindPlan(view: JobView, run: Run) {
  if (run.plan || run.parent) return
  const plan = view.planned.find((item) => item.run === null && item.agent === run.type)
  if (plan) {
    plan.run = run.id
    run.plan = plan
  }
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

type EdgeState = 'idle' | 'trail' | 'on'

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

// ---- Panels: what the page shows besides the flow ----------------------------------------------

export type Decision = {
  /** The Decision Request waiting for the user, while the job is blocked and unanswered. */
  pending: { n: number; text: string | null; waitingFor: string } | null
  /** Every request raised so far, with the user's answer once there is one. */
  history: { n: number; answered: boolean; answer: string | null }[]
}

/** The text on the page for the command the user runs to answer. */
export const waitingFor = (job: number) => `! bun run factory answer ${job} "<text>"`

export function decisionOf(view: JobView): Decision {
  const info = view.info
  const total = Math.max(view.blockedCount, info?.decisionRequests?.length ?? 0)
  const history = Array.from({ length: total }, (_, index) => {
    const n = index + 1
    const answer = info?.answers?.find((item) => item.request === n)?.text ?? null
    // The log says an answer exists; the text comes from job.json, so it may not be here yet.
    return { n, answered: view.answeredCount >= n || answer !== null, answer }
  })
  const open = history.at(-1)
  const blocked = phaseOf(view) === 'blocked' && open !== undefined && !open.answered
  return {
    pending:
      blocked && open
        ? {
            n: open.n,
            text: info?.extras?.requests[open.n - 1] ?? null,
            waitingFor: waitingFor(view.number),
          }
        : null,
    history,
  }
}

type RiskView = {
  declared: RiskLevel | null
  effective: RiskLevel | null
  raised: boolean
  raisedBy: string[]
}

/** The issue's declared risk and the one in force; `raisedBy` names the paths that raised it. */
export function riskOf(view: JobView): RiskView {
  const declared = view.info?.risk ?? null
  const plans = reviewPlansOf(view)
  const effective = view.risk ?? plans.at(-1)?.risk ?? declared
  const raised =
    declared !== null && effective !== null && RISK_RANK[effective] > RISK_RANK[declared]
  const raisedBy = [...new Set(plans.flatMap((plan) => plan.raisedBy))]
  return { declared, effective, raised, raisedBy: raised ? raisedBy : [] }
}

/** One plan per review pass: from the log, or from job.json when the log has none. */
export const reviewPlansOf = (view: JobView): PlanInfo[] =>
  view.reviewPlans.length ? view.reviewPlans : (view.info?.reviews ?? [])

type SealView = {
  /** The seal in force, with a tick per role whose blind pass is written. */
  sealed: SealRecord | null
  /** The seals already lifted, with the moment of each unseal. */
  lifted: SealRecord[]
}

export function sealOf(view: JobView): SealView {
  const sealed = view.seals.findLast((item) => item.unsealedAt === null) ?? null
  return { sealed, lifted: view.seals.filter((item) => item.unsealedAt !== null) }
}

type RulingRow = {
  ruling: number
  diff: string
  verdict: string | null
  /** The AT fix committed on it, if any. */
  committed: { sha: string | null } | null
}

export function rulingsOf(view: JobView): RulingRow[] {
  const info = view.info
  const asked = new Map<number, string>()
  for (const item of info?.rulings ?? []) asked.set(item.ruling, item.diff)
  for (const item of view.rulingRequests) asked.set(item.ruling, item.diff)
  return [...asked]
    .toSorted((a, b) => a[0] - b[0])
    .map(([ruling, diff]) => {
      const fix = view.rulingFixes.get(ruling)
      const saved = info?.atfixes?.find((item) => item.ruling === ruling)
      return {
        ruling,
        diff,
        verdict: info?.extras?.rulingVerdicts[String(ruling)] ?? null,
        committed: fix || saved ? { sha: saved?.sha ?? fix?.sha ?? null } : null,
      }
    })
}

type SandboxStrip = {
  source: 'events' | 'folders' | 'none'
  rows: { role: string; detail: string }[]
}

/** Each reviewer's sandbox: from the sandbox events, else from the folders under sandbox/. */
export function sandboxesOf(view: JobView): SandboxStrip {
  if (view.sandboxes.size) {
    return {
      source: 'events',
      rows: [...view.sandboxes.values()].map((box) => ({
        role: box.role,
        detail: box.removed
          ? 'removed'
          : `port ${String(box.port)} · db ${String(box.database)} · bucket ${String(box.bucket)}`,
      })),
    }
  }
  const folders = view.info?.extras?.sandboxFolders ?? []
  return folders.length
    ? { source: 'folders', rows: folders.map((role) => ({ role, detail: 'folder only' })) }
    : { source: 'none', rows: [] }
}

type ModelCheck = {
  status: 'unplanned' | 'pending' | 'ok' | 'mismatch'
  planned: { model: string; effort: string } | null
  actual: { models: string[]; efforts: string[] } | null
  problems: string[]
}

/**
 * A run's model and effort against what was planned for it: `factory launch`'s plan for an agent,
 * ORCHESTRATOR for the orchestrator. The plan says `opus`; usage says `claude-opus-5-5`.
 */
export function modelCheck(run: Run): ModelCheck {
  const planned =
    run.id === 'orchestrator'
      ? ORCHESTRATOR_PLAN
      : run.plan
        ? { model: run.plan.model, effort: run.plan.effort }
        : null
  const actual = run.usage
    ? { models: Object.keys(run.usage.models), efforts: Object.keys(run.usage.efforts) }
    : null
  if (!planned) return { status: 'unplanned', planned, actual, problems: [] }
  if (!actual) return { status: 'pending', planned, actual, problems: [] }
  const problems: string[] = []
  const wrongModels = actual.models.filter((name) => !name.includes(planned.model))
  if (wrongModels.length) problems.push(`model ${wrongModels.join(', ')}, planned ${planned.model}`)
  const wrongEfforts = actual.efforts.filter((name) => name !== planned.effort)
  if (wrongEfforts.length)
    problems.push(`effort ${wrongEfforts.join(', ')}, planned ${planned.effort}`)
  return { status: problems.length ? 'mismatch' : 'ok', planned, actual, problems }
}

/** The runs whose model or effort differs from the plan. */
export const mismatches = (view: JobView): Run[] =>
  [...view.runs.values()].filter((run) => modelCheck(run).status === 'mismatch')

/** The tooltip of a CLI mark in the timeline; an answer carries the user's own words. */
export function markTitle(view: JobView, mark: Mark): string {
  if (mark.kind !== 'answered') return mark.kind
  const text = view.info?.answers?.find((item) => item.request === mark.request)?.text
  return text ? `answered · ${text}` : 'answered'
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
const FAIL_ROW_KINDS = new Set([...FAIL_KINDS, ...DENIAL_KINDS, 'blocked'])

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
    case 'read.denied':
      msg = `${path} · ${text(detail.reason)}`
      break
    case 'bash.denied':
      msg = `${trim(text(detail.command), 100)} · ${text(detail.reason)}`
      break
    case 'agent.denied':
      msg = `${text(detail.subagentType) || text(detail.to)} · ${text(detail.reason)}`
      break
    case 'launch.planned':
      msg = `${text(detail.agent).replace('factory-', '')} · ${text(detail.task)} · ${text(detail.model)}/${text(detail.effort)} · ${text(detail.risk)} risk`
      break
    case 'review.planned':
      msg = `pass ${String(detail.pass ?? '')} · ${Object.entries(
        (detail.roles ?? {}) as Record<string, string>,
      )
        .map(([role, task]) => `${role} ${task}`)
        .join(', ')} · ${text(detail.risk)} risk`
      break
    case 'sealed':
      msg = `pass ${String(detail.pass ?? '')} · ${Array.isArray(detail.roles) ? detail.roles.join(', ') : ''}`
      break
    case 'unsealed':
      msg = `pass ${String(detail.pass ?? '')} · blind passes written`
      break
    case 'ruling.requested':
      msg = `ruling ${String(detail.ruling ?? '')} · diff ${text(detail.diff).slice(0, 12)}`
      break
    case 'answered':
      msg = `Decision Request ${String(detail.request ?? '')} answered`
      cls = 'ok'
      break
    case 'sandbox.created':
      msg = `${text(detail.role)} · port ${String(detail.port ?? '')}`
      break
    case 'sandbox.removed':
      msg = text(detail.role)
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
      if (typeof detail.ruling === 'number') msg = `ruling ${detail.ruling} · ${msg}`
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
  // Any other event the annotator flagged (a Bash read, a Grep, a denied call) is a breach too.
  if (ev.breach && ev.kind !== 'read') {
    cls = 'breach'
    // A denial's message already says why.
    if (!DENIAL_KINDS.has(ev.kind)) msg = `${msg} · ${ev.breach}`
  }
  return { kind, msg, cls }
}
