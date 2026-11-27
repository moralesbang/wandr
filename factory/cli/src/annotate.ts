// Reads a job's event log in order and annotates each event with what factory watch shows: the
// factory role behind it, isolation breaches, and information moving from one agent to another.
//
// A read is a Read, but also a Grep or a Glob, and a Bash command that prints a file: job #13's
// reviewers read the sealed inputs with `cat`, and a page that classified only Read showed nothing.
// Bash commands are read with the guard's own tokenizer (bash-words.ts), so the page flags what the
// guard would deny. A denied read is a breach too: the agent tried.

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { commandPaths } from './bash-words.ts'
import { locate, type FactoryEvent, type Places } from './events.ts'
import { jobFolder } from './paths.ts'
import { classifyRead, isFactoryAgent, type AgentType, type Target } from './visibility.ts'
import { reviewerRole } from './review-plan.ts'

/** A denial the guard logged: the call never ran, but the agent reached for what it may not read. */
const DENIED_READS = new Set(['read.denied', 'bash.denied', 'agent.denied'])

export type Annotated = FactoryEvent & {
  /** The factory agent behind the event; a nested Explore run takes its launcher's role. */
  role?: AgentType
  /** The agent run that launched this one, for nested runs. */
  parent?: string
  breach?: string
  /** The input a fine read matched. */
  input?: string
  /** Who wrote the file this event reads, when another actor did. */
  from?: string
  /** For a Bash command, a Grep or a Glob: each path it read and how it was classified. */
  reads?: { target: Target; input?: string; breach?: string }[]
}

const roleName = (role: AgentType) => role.replace('factory-', '')

export class Annotator {
  /**
   * Where the job's areas are, to place the paths a command names. Given by the caller, or learned
   * from the job's `job.started` event.
   */
  constructor(private places?: Places) {}

  private typeOf = new Map<string, string>()
  private parentOf = new Map<string, string>()
  private rounds = 0
  private blindPasses = new Set<string>()
  /** What each reviewer does per review pass, from the `review.planned` events. */
  private plans = new Map<number, Record<string, unknown>>()
  private writerOf = new Map<string, string>()
  /** Agent calls whose run hasn't started yet: who called, and for which agent type. */
  private pending: {
    caller: string | undefined
    type: string
    prompt?: unknown
    description?: unknown
  }[] = []

  roleOf(agentId: string | undefined): AgentType | undefined {
    let id = agentId
    for (let depth = 0; id && depth < 5; depth++) {
      const type = this.typeOf.get(id)
      if (type && isFactoryAgent(type)) return type
      id = this.parentOf.get(id)
    }
    return undefined
  }

  private actor(event: FactoryEvent, role: AgentType | undefined) {
    if (role) return role
    return event.source === 'cli' ? 'cli' : event.agent ? event.agent.type : 'orchestrator'
  }

  push(event: FactoryEvent): Annotated {
    if (event.agent) this.typeOf.set(event.agent.id, event.agent.type)
    if (event.kind === 'agent.launched' && event.agent) {
      const child = event.detail?.childId
      if (typeof child === 'string') this.parentOf.set(child, event.agent.id)
    }
    if (event.kind === 'agent.prompt') {
      const type = event.detail?.subagentType
      this.pending.push({
        caller: event.agent?.id,
        type: typeof type === 'string' ? type : 'general-purpose',
        prompt: event.detail?.prompt,
        description: event.detail?.description,
      })
    }
    let started: (typeof this.pending)[number] | undefined
    if (event.kind === 'agent.start' && event.agent) {
      // A run starts before its launch result arrives, so it is tied to the oldest pending call
      // for its type; agent.launched confirms it later.
      const at = this.pending.findIndex((call) => call.type === event.agent?.type)
      started = at === -1 ? undefined : this.pending.splice(at, 1)[0]
      if (started?.caller) this.parentOf.set(event.agent.id, started.caller)
    }
    if (event.source === 'cli' && event.kind === 'round') this.rounds += 1
    if (event.source === 'cli' && event.kind === 'review.planned') {
      const { pass, roles } = event.detail ?? {}
      if (typeof pass === 'number' && roles && typeof roles === 'object') {
        this.plans.set(pass, roles as Record<string, unknown>)
      }
    }
    if (event.source === 'cli' && event.kind === 'job.started' && !this.places) {
      const worktree = event.detail?.worktree
      if (typeof worktree === 'string') {
        this.places = { worktree, handoffDir: join(worktree, jobFolder(event.job)) }
      }
    }

    const role = this.roleOf(event.agent?.id)
    const annotated: Annotated = { ...event }
    if (role) annotated.role = role
    const parent = event.agent && this.parentOf.get(event.agent.id)
    if (parent) annotated.parent = parent
    if (started) {
      // The context the agent starts with: the prompt its caller handed it.
      annotated.detail = {
        ...event.detail,
        prompt: started.prompt,
        description: started.description,
      }
    }

    const target = event.target
    const key = target && `${target.area}:${target.path}`

    if (event.kind === 'write' && target && key) {
      this.writerOf.set(key, this.actor(event, role))
      const pass = this.rounds + 1
      if (
        role &&
        target.area === 'job' &&
        target.path === `reviews/${pass}.${roleName(role)}.blind.md`
      ) {
        this.blindPasses.add(`${role}:${pass}`)
      }
    }

    if (event.kind === 'read' && target && key) {
      const writer = this.writerOf.get(key)
      if (writer && writer !== this.actor(event, role)) annotated.from = writer
      const verdict = this.classify(event, role, target)
      if (verdict?.input) annotated.input = verdict.input
      if (verdict?.breach) annotated.breach = verdict.breach
    }

    if (event.kind === 'bash' || event.kind === 'search') {
      const reads = this.readTargets(event).map((read) => ({
        target: read,
        ...this.classify(event, role, read),
      }))
      if (reads.length) annotated.reads = reads
      const breaches = [...new Set(reads.flatMap((read) => (read.breach ? [read.breach] : [])))]
      if (breaches.length) annotated.breach = breaches.join('; ')
    }

    if (DENIED_READS.has(event.kind)) {
      const reason = event.detail?.reason
      annotated.breach = typeof reason === 'string' ? reason : `${event.kind.replace('.', ' ')}`
    }
    return annotated
  }

  /** The breach rule for one read, or nothing for the orchestrator's reads. */
  private classify(
    event: FactoryEvent,
    role: AgentType | undefined,
    target: Target,
  ): { input?: string; breach?: string } | undefined {
    if (role) {
      const verifying = this.verifies(role)
      // A verifier reads the sealed store while another reviewer's blind pass keeps the job sealed.
      const placed = verifying ? this.fromSealedStore(event.job, target) : target
      const verdict = classifyRead(role, placed, {
        blindPassWritten: this.blindPasses.has(`${role}:${this.rounds + 1}`),
        verifying,
      })
      return verdict.ok ? { input: verdict.input } : { breach: verdict.reason }
    }
    if (event.agent && target.area !== 'outside') {
      // A run inside a job that isn't a factory agent and wasn't launched by one.
      return { breach: `${event.agent.type} is not a factory agent and has no declared inputs` }
    }
    return undefined
  }

  /** Whether the review plan of the current pass has this reviewer verify instead of review. */
  private verifies(role: AgentType): boolean {
    const reviewer = reviewerRole(role)
    return reviewer !== null && this.plans.get(this.rounds + 1)?.[reviewer] === 'verify'
  }

  /** A path in the job's sealed store, in the main checkout, as the job-folder path it mirrors. */
  private fromSealedStore(job: number, target: Target): Target {
    if (target.area !== 'outside') return target
    const marker = `/${jobFolder(job)}/sealed/`
    const at = target.path.indexOf(marker)
    return at === -1 ? target : { area: 'job', path: target.path.slice(at + marker.length) }
  }

  /** The absolute path of a target, back from its area. */
  private absolute(target: Target, places: Places) {
    if (target.area === 'job') return join(places.handoffDir, target.path)
    if (target.area === 'repo') return join(places.worktree, target.path)
    return target.path
  }

  /** What a Bash command or a search read, placed in its area; nothing until the places are known. */
  private readTargets(event: FactoryEvent): Target[] {
    const places = this.places
    if (!places) return []
    const detail = event.detail ?? {}
    if (event.kind === 'bash') {
      const command = typeof detail.command === 'string' ? detail.command : ''
      // Agents run in the job's worktree; a log that records the command's folder says so.
      const cwd = typeof detail.cwd === 'string' ? detail.cwd : places.worktree
      return commandPaths(command, { cwd, home: homedir() })
        .filter((named) => named.read)
        .map((named) => locate(named.path, places))
    }
    const base = event.target ? this.absolute(event.target, places) : places.worktree
    const pattern = typeof detail.pattern === 'string' ? detail.pattern : ''
    // A Grep's pattern is a regex over contents; a Glob's names the files it lists.
    if (detail.tool === 'Glob' && pattern) {
      return [locate(isAbsolute(pattern) ? pattern : resolve(base, pattern), places)]
    }
    return event.target ? [event.target] : []
  }
}

export function annotate(events: readonly FactoryEvent[]): Annotated[] {
  const annotator = new Annotator()
  return events.map((event) => annotator.push(event))
}
