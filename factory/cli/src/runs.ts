// What the event log says about who wrote a file in the job's folder. The agents' own files (a
// blind pass, a ruling, a final report) count only when the log shows the right run wrote them with
// the Write tool: a file with no such write was put there by someone else, the orchestrator's Bash
// included.

import type { FactoryEvent } from './events.ts'

/** When a run began: the first `agent.start` the log holds for its id. */
export function startedAt(events: FactoryEvent[], id: string): string | undefined {
  return events.find((event) => event.kind === 'agent.start' && event.agent?.id === id)?.t
}

/**
 * Whether a run of the given agent type wrote `rel` (relative to the job's folder) with the Write,
 * Edit or MultiEdit tool, after `since` when given. The run itself must have begun after `since`
 * too: a run that was already going when the file was asked for may have read what it must not.
 */
export function wroteInJob(
  events: FactoryEvent[],
  options: { type: string; rel: string; since?: string },
): boolean {
  const { type, rel, since } = options
  return events.some((event) => {
    if (event.kind !== 'write' || event.source !== 'hook' || event.agent?.type !== type) {
      return false
    }
    if (event.target?.area !== 'job' || event.target.path !== rel) return false
    const began = startedAt(events, event.agent.id)
    if (began === undefined || began > event.t) return false
    return since === undefined || began >= since
  })
}
