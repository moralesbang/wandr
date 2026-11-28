// The user's confirmation of a destructive step, given through the orchestrator's AskUserQuestion.
// Cleaning a merged job and abandoning an unmerged one remove a worktree, a branch and the job's
// state, so they run only after the user said yes to a question the CLI wrote: `factory confirm`
// prints it and logs `confirmation.asked`; the PostToolUse hook logs `confirmation.recorded` from
// the user's reply (hook-answer.ts); the guard lets one `factory clean` through per confirmation and
// logs `confirmation.used`. The model never writes the answer, and never words the question.

import type { FactoryEvent } from '../events.ts'
import type { Job } from '../job.ts'
import { record, requireJob } from './common.ts'

export const CONFIRM_ACTIONS = ['clean', 'abandon'] as const
export type ConfirmAction = (typeof CONFIRM_ACTIONS)[number]

export const isConfirmAction = (value: string | undefined): value is ConfirmAction =>
  CONFIRM_ACTIONS.includes(value as ConfirmAction)

/** The label that confirms: the answer the hook counts as a yes. */
export const yesLabel = (action: ConfirmAction, number: number) => `Yes, ${action} job #${number}`

/** The AskUserQuestion input the CLI wrote for a confirmation. */
export function confirmationQuestion(job: Job, action: ConfirmAction) {
  const abandon = action === 'abandon'
  return {
    questions: [
      {
        question: abandon
          ? `Abandon job #${job.number} (${job.title})? This removes its worktree and sandboxes, deletes the branch ${job.branch} locally and on origin, deletes the job's state and puts issue #${job.number} back to factory:ready. Work that isn't merged is lost.`
          : `Clean job #${job.number} (${job.title})? Its PR is merged: this removes its worktree and sandboxes, deletes the branch ${job.branch} and deletes the job's state.`,
        header: abandon ? 'Abandon job' : 'Clean job',
        multiSelect: false,
        options: [
          {
            label: yesLabel(action, job.number),
            description: abandon
              ? 'Discard the job so its issue can start again.'
              : 'Remove the merged job.',
          },
          { label: 'No, keep it', description: 'Nothing is removed.' },
        ],
      },
    ],
  }
}

/** `factory confirm <n> clean|abandon`: logs the question and prints it for AskUserQuestion. */
export function confirm(root: string, number: number, action: ConfirmAction) {
  const job = requireJob(root, number)
  const input = confirmationQuestion(job, action)
  record(root, number, 'confirmation.asked', {
    action,
    question: input.questions[0]?.question,
    yes: yesLabel(action, number),
  })
  return input
}

/** The confirmation the user gave and no `clean` has used yet: recorded minus used, for an action. */
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

/** The question the CLI asked last for which the user hasn't replied yet, or null. */
export function pendingConfirmation(
  events: readonly FactoryEvent[],
): { action: ConfirmAction; question: string; yes: string } | null {
  let pending: { action: ConfirmAction; question: string; yes: string } | null = null
  for (const event of events) {
    const { action, question, yes } = event.detail ?? {}
    if (event.kind === 'confirmation.asked') {
      pending =
        isConfirmAction(typeof action === 'string' ? action : undefined) &&
        typeof question === 'string' &&
        typeof yes === 'string'
          ? { action: action as ConfirmAction, question, yes }
          : null
    } else if (event.kind === 'confirmation.recorded' || event.kind === 'confirmation.declined') {
      pending = null
    }
  }
  return pending
}
