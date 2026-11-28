import { latestAnswer, saveJob, type Job } from '../job.ts'
import { record, Refusal, requireJob } from './common.ts'

/**
 * Records the user's answer to the job's latest Decision Request. Two channels write it, and the
 * guard keeps both the user's: the PostToolUse hook, from the user's reply to the orchestrator's
 * AskUserQuestion (hook-answer.ts), and `! bun run factory answer <n> "<text>"` from the user's own
 * prompt, which the guard denies to every tool call. So an answer in job.json is the user's.
 */
export function answer(
  root: string,
  number: number,
  text: string,
  via: { channel: 'question' | 'command'; question?: string } = { channel: 'command' },
): Job {
  const job = requireJob(root, number)
  const requests = job.decisionRequests.length
  if (job.state !== 'blocked' || requests === 0) {
    throw new Refusal(
      `Job #${number} is not waiting for an answer: it raised no open Decision Request.`,
    )
  }
  if (latestAnswer(job)) {
    throw new Refusal(`Decision Request ${requests} of job #${number} already has an answer.`)
  }
  if (!text.trim()) throw new Refusal(`Say the answer: factory answer ${number} "<text>"`)
  const at = new Date().toISOString()
  const updated: Job = {
    ...job,
    answers: [
      ...job.answers,
      {
        request: requests,
        at,
        text,
        ...(via.question ? { question: via.question } : {}),
        cited: false,
      },
    ],
  }
  saveJob(root, updated)
  record(root, number, 'answered', { request: requests, channel: via.channel })
  return updated
}
