// The PostToolUse hook on AskUserQuestion: records what the user answered, in the job state and the
// event log. The user's reply reaches the hook in `tool_response`, which no model writes, so an
// answer here is the user's: the guard denies an AskUserQuestion call whose input already carries
// `answers` or `annotations` (pre-filling the reply), and every agent but the orchestrator has no
// such tool. Two things take an answer: an open Decision Request (the same record `factory answer`
// makes, with the same one-answer-one-commit semantics) and a confirmation the CLI asked for
// (confirm.ts). The hook is synchronous: the orchestrator's next command must find the answer.

import { HookInput, readEvents } from '../events.ts'
import { latestAnswer, locateSession, logHookError } from '../job.ts'
import { answer } from './answer.ts'
import { record } from './common.ts'
import { pendingConfirmation } from './confirm.ts'

/** One question the user answered: the question's text, the label or text they gave. */
export type Reply = { question: string; answer: string; notes?: string }

const object = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === 'string') {
    try {
      return object(JSON.parse(value))
    } catch {
      return null
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * What the user answered, from a PostToolUse input: `tool_response.answers` maps each question's
 * text to the label chosen or the text typed in (the transcript's own record of the tool's result,
 * `toolUseResult`, has `questions`, `answers` and `annotations` on Claude Code 2.1.332). The tool's
 * input is read too, in case Claude Code puts the reply there once the user answered.
 */
export function repliesOf(input: HookInput): Reply[] {
  for (const source of [input.tool_response, input.tool_input]) {
    const result = object(source)
    const answers = object(result?.answers)
    if (!answers) continue
    const annotations = object(result?.annotations)
    const replies = Object.entries(answers).flatMap(([question, given]): Reply[] => {
      const text = (Array.isArray(given) ? given.join(', ') : String(given ?? '')).trim()
      const notes = object(annotations?.[question])?.notes
      return text
        ? [{ question, answer: text, ...(typeof notes === 'string' && notes ? { notes } : {}) }]
        : []
    })
    if (replies.length > 0) return replies
  }
  return []
}

/** The answer's text as it is kept: the replies, and the notes the user added to them. */
const textOf = (replies: Reply[]) =>
  replies
    .map((reply) => (replies.length > 1 ? `${reply.question}: ${reply.answer}` : reply.answer))
    .concat(replies.flatMap((reply) => (reply.notes ? [`Notes: ${reply.notes}`] : [])))
    .join('\n')

export function hookAnswer(root: string, stdin: string): void {
  try {
    const input = HookInput.parse(JSON.parse(stdin))
    if (input.tool_name !== 'AskUserQuestion' || input.agent_id) return
    const located = locateSession(root, input.session_id)
    if (!located || !('job' in located)) return
    const { job } = located
    const replies = repliesOf(input)
    if (replies.length === 0) return
    const pending = pendingConfirmation(readEvents(root, job.number))
    const confirming = pending && replies.find((reply) => reply.question === pending.question)
    if (pending && confirming) {
      const yes = confirming.answer === pending.yes
      record(root, job.number, yes ? 'confirmation.recorded' : 'confirmation.declined', {
        action: pending.action,
        ...(pending.threshold === undefined ? {} : { threshold: pending.threshold }),
      })
      return
    }
    if (job.state === 'blocked' && job.decisionRequests.length > 0 && !latestAnswer(job)) {
      answer(root, job.number, textOf(replies), {
        channel: 'question',
        ...(replies.length === 1 ? { question: replies[0]!.question } : {}),
      })
    }
  } catch (error) {
    try {
      logHookError(root, 'answer', error)
    } catch {
      // Nowhere left to say it.
    }
  }
}
