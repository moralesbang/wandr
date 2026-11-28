import { factoryFingerprint, fingerprintChanges } from '../freeze.ts'
import { saveJob } from '../job.ts'
import { record, requireJob } from './common.ts'

/**
 * Accepts the factory as it is now for a job whose factory files changed since it started: the job
 * is judged by these files from here on. The user runs it from their own prompt (the guard denies
 * it to every tool call), because a job judged by a factory that changed under it is the user's
 * call. The files it accepts go in the log.
 */
export function refreeze(root: string, number: number): string[] {
  const job = requireJob(root, number)
  const current = factoryFingerprint(root)
  const changes = fingerprintChanges(job.factoryFingerprint ?? {}, current)
  saveJob(root, { ...job, factoryFingerprint: current })
  record(root, number, 'factory.accepted', { files: changes })
  return changes
}
