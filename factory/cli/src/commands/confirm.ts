// The user's yes to a step that needs it, given through the orchestrator's AskUserQuestion. Cleaning
// a merged job and abandoning an unmerged one remove a worktree, a branch and the job's state;
// `refreeze` accepts a factory that changed under the job; `cost` lets a job that passed a cost
// threshold go on. Each runs only after the user said yes to a question the CLI wrote: `factory
// confirm` prints it and logs `confirmation.asked`; the PostToolUse hook logs `confirmation.recorded`
// from the user's reply (hook-answer.ts); the guard lets one `clean` or `refreeze` through per yes
// and logs `confirmation.used`, and the CLI itself counts a yes to `cost` against the threshold it
// names. The model never writes the answer, and never words the question.

import { costAlarm, describeCost } from '../cost.ts'
import { readEvents, type FactoryEvent } from '../events.ts'
import { factoryChanges } from '../freeze.ts'
import type { Job } from '../job.ts'
import { record, Refusal, requireJob } from './common.ts'

export const CONFIRM_ACTIONS = ['clean', 'abandon', 'refreeze', 'cost'] as const
export type ConfirmAction = (typeof CONFIRM_ACTIONS)[number]

export const isConfirmAction = (value: string | undefined): value is ConfirmAction =>
  CONFIRM_ACTIONS.includes(value as ConfirmAction)

/** The label that confirms: the answer the hook counts as a yes. */
export const yesLabel = (action: ConfirmAction, number: number, threshold = 0) =>
  ({
    clean: `Yes, clean job #${number}`,
    abandon: `Yes, abandon job #${number}`,
    refreeze: `Yes, accept the changed factory for job #${number}`,
    cost: `Yes, continue job #${number} past $${threshold}`,
  })[action]

type Facts = { changes?: string[]; cost?: string; threshold?: number }

/** The AskUserQuestion input the CLI wrote for a confirmation. */
export function confirmationQuestion(job: Job, action: ConfirmAction, facts: Facts = {}) {
  const label = yesLabel(action, job.number, facts.threshold)
  const text = {
    abandon: {
      question: `Abandon job #${job.number} (${job.title})? This removes its worktree and sandboxes, deletes the branch ${job.branch} locally and on origin, deletes the job's state and puts issue #${job.number} back to factory:ready. Work that isn't merged is lost.`,
      header: 'Abandon job',
      yes: 'Discard the job so its issue can start again.',
      no: ['No, keep it', 'Nothing is removed.'],
    },
    clean: {
      question: `Clean job #${job.number} (${job.title})? Its PR is merged: this removes its worktree and sandboxes, deletes the branch ${job.branch} and deletes the job's state.`,
      header: 'Clean job',
      yes: 'Remove the merged job.',
      no: ['No, keep it', 'Nothing is removed.'],
    },
    refreeze: {
      question: `The factory's files changed under job #${job.number} (${job.title}) after it started: ${(facts.changes ?? []).join(', ')}. Judge the job by the new files from here on?`,
      header: 'Factory',
      yes: 'The job is judged by the files as they are now.',
      no: ['No, keep the old ones', 'The job stays stopped: revert the files, or abandon the job.'],
    },
    cost: {
      question: `Job #${job.number} (${job.title}) has cost ${facts.cost ?? '?'} and passed $${facts.threshold ?? 0}. Keep going until the next threshold?`,
      header: 'Cost',
      yes: 'Acknowledge this threshold and carry on.',
      no: ['No, stop here', 'The job stops; the orchestrator offers to abandon it.'],
    },
  }[action]
  return {
    questions: [
      {
        question: text.question,
        header: text.header,
        multiSelect: false,
        options: [
          { label, description: text.yes },
          { label: text.no[0]!, description: text.no[1]! },
        ],
      },
    ],
  }
}

/** `factory confirm <n> <action>`: logs the question and prints it for AskUserQuestion. */
export function confirm(root: string, number: number, action: ConfirmAction) {
  const job = requireJob(root, number)
  const facts: Facts = {}
  if (action === 'refreeze') {
    facts.changes = factoryChanges(root, job)
    if (facts.changes.length === 0) {
      throw new Refusal(
        `The factory files haven't changed under job #${number}: nothing to accept.`,
      )
    }
  }
  if (action === 'cost') {
    const alarm = costAlarm(readEvents(root, number))
    if (!alarm) throw new Refusal(`Job #${number} has no unacknowledged cost threshold.`)
    facts.cost = describeCost(alarm)
    facts.threshold = alarm.threshold
  }
  const input = confirmationQuestion(job, action, facts)
  record(root, number, 'confirmation.asked', {
    action,
    question: input.questions[0]?.question,
    yes: yesLabel(action, number, facts.threshold),
    ...(facts.threshold === undefined ? {} : { threshold: facts.threshold }),
  })
  return input
}

/** The confirmation the user gave and no command has used yet: recorded minus used, for an action. */
export function unusedConfirmations(
  events: readonly FactoryEvent[],
  action: ConfirmAction,
): number {
  let unused = 0
  for (const event of events) {
    if (event.detail?.action !== action) continue
    if (event.kind === 'confirmation.recorded') unused++
    else if (event.kind === 'confirmation.used') unused = Math.max(0, unused - 1)
  }
  return unused
}

export type Pending = { action: ConfirmAction; question: string; yes: string; threshold?: number }

/** The question the CLI asked last for which the user hasn't replied yet, or null. */
export function pendingConfirmation(events: readonly FactoryEvent[]): Pending | null {
  let pending: Pending | null = null
  for (const event of events) {
    const { action, question, yes, threshold } = event.detail ?? {}
    if (event.kind === 'confirmation.asked') {
      pending =
        isConfirmAction(typeof action === 'string' ? action : undefined) &&
        typeof question === 'string' &&
        typeof yes === 'string'
          ? {
              action: action as ConfirmAction,
              question,
              yes,
              ...(typeof threshold === 'number' ? { threshold } : {}),
            }
          : null
    } else if (event.kind === 'confirmation.recorded' || event.kind === 'confirmation.declined') {
      pending = null
    }
  }
  return pending
}
