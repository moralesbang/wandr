// What a job has cost so far, from its event log, and the alarm that asks the user at each further
// COST_STEP_USD. An alarm, not a cut: the CLI refuses the orchestrator's next decision point until
// the user said yes to continue, and nothing stops a job on its own.
//
// The figure is the sum of each run's latest `usage` event, as the PR's cost table computes it. The
// orchestrator's own usage is logged only when its turn ends (the `Stop` hook), so the figure can
// lag by one turn.

import type { FactoryEvent } from './events.ts'
import type { RunUsage } from './usage.ts'

/** The job's cost alarm fires when it passes this many dollars, and again at each further one. */
export const COST_STEP_USD = 5

/** Each run's latest usage event: a resumed subagent logs its total again, the last one wins. */
export function latestUsage(events: readonly FactoryEvent[]) {
  const runs = new Map<string, { label: string; usage: RunUsage }>()
  for (const event of events) {
    if (event.kind !== 'usage' || !event.detail) continue
    const id = event.agent?.id ?? 'orchestrator'
    const label = event.agent ? `${event.agent.type} (${id.slice(0, 7)})` : 'orchestrator'
    runs.set(id, { label, usage: event.detail as RunUsage })
  }
  return runs
}

/** The priced cost of the job and what each run cost; a model with no price is listed apart. */
export function jobCost(events: readonly FactoryEvent[]) {
  const runs = [...latestUsage(events).values()]
  return {
    usd: runs.reduce((sum, run) => sum + run.usage.usd, 0),
    unpriced: [...new Set(runs.flatMap((run) => run.usage.unpriced))],
    runs: runs.map((run) => ({ label: run.label, usd: run.usage.usd })),
  }
}

/** The highest multiple of the step the cost has passed; 0 below the first. */
export const costThreshold = (usd: number) => Math.floor(usd / COST_STEP_USD) * COST_STEP_USD

/** The highest threshold the user said yes to, 0 when none. */
export const acknowledgedThreshold = (events: readonly FactoryEvent[]) =>
  events.reduce((top, event) => {
    const threshold = event.detail?.threshold
    return event.kind === 'confirmation.recorded' &&
      event.detail?.action === 'cost' &&
      typeof threshold === 'number'
      ? Math.max(top, threshold)
      : top
  }, 0)

/** The threshold the job passed and the user hasn't acknowledged, with what it cost; else null. */
export function costAlarm(events: readonly FactoryEvent[]) {
  const cost = jobCost(events)
  const threshold = costThreshold(cost.usd)
  return threshold > acknowledgedThreshold(events) ? { threshold, ...cost } : null
}

const usd = (value: number) => `$${value.toFixed(2)}`

/** The spent amount with a per-agent breakdown, biggest first, for a refusal and a question. */
export const describeCost = (cost: ReturnType<typeof jobCost>) =>
  `${usd(cost.usd)}${cost.unpriced.length ? ` + unpriced (${cost.unpriced.join(', ')})` : ''}: ${cost.runs
    .toSorted((a, b) => b.usd - a.usd)
    .map((run) => `${run.label} ${usd(run.usd)}`)
    .join(', ')}`
