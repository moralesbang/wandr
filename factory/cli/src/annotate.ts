// Reads a job's event log in order and annotates each event with what factory watch shows: the
// factory role behind it, isolation breaches, and information moving from one agent to another.

import type { FactoryEvent } from './events.ts'
import { classifyRead, isFactoryAgent, type AgentType } from './visibility.ts'

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
}

const roleName = (role: AgentType) => role.replace('factory-', '')

export class Annotator {
  private typeOf = new Map<string, string>()
  private parentOf = new Map<string, string>()
  private rounds = 0
  private blindPasses = new Set<string>()
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
      if (role) {
        const verdict = classifyRead(role, target, {
          blindPassWritten: this.blindPasses.has(`${role}:${this.rounds + 1}`),
        })
        if (verdict.ok) annotated.input = verdict.input
        else annotated.breach = verdict.reason
      } else if (event.agent && target.area !== 'outside') {
        // A run inside a job that isn't a factory agent and wasn't launched by one.
        annotated.breach = `${event.agent.type} is not a factory agent and has no declared inputs`
      }
    }
    return annotated
  }
}

export function annotate(events: readonly FactoryEvent[]): Annotated[] {
  const annotator = new Annotator()
  return events.map((event) => annotator.push(event))
}
