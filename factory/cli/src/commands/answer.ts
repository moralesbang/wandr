import { latestAnswer, saveJob, type Job } from '../job.ts'
import { record, Refusal, requireJob } from './common.ts'

/**
 * Records the user's answer to the job's latest Decision Request. The user runs it from their own
 * prompt (`! bun run factory answer <n> "<text>"`); the guard denies it to every tool call, so an
 * answer in job.json is the user's.
 */
export function answer(root: string, number: number, text: string): Job {
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
    answers: [...job.answers, { request: requests, at, text, cited: false }],
  }
  saveJob(root, updated)
  record(root, number, 'answered', { request: requests })
  return updated
}
