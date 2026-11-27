// What the page needs besides job.json and the event log: files in the job's folders. The log
// holds paths and counts, never contents, so a Decision Request's text, a ruling's verdict and the
// sandbox folders come from disk. The job frame carries them; a replay shows them as they are now.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRuling, rulingFile } from '../commands/ruling.ts'
import { handoffDir, loadJob, type Job } from '../job.ts'
import { loadSeal } from '../seal.ts'
import type { JobExtras } from './state.ts'

const readOrNull = (file: string) => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function jobExtras(root: string, job: Job): JobExtras {
  const sandboxDir = join(handoffDir(job), 'sandbox')
  return {
    requests: job.decisionRequests.map((request) => readOrNull(request.file)),
    rulingVerdicts: Object.fromEntries(
      job.rulings.map((item) => {
        const text = readOrNull(rulingFile(job, item.ruling))
        return [String(item.ruling), text === null ? null : parseRuling(text).verdict]
      }),
    ),
    sandboxFolders: existsSync(sandboxDir)
      ? readdirSync(sandboxDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .toSorted()
      : [],
    seal: loadSeal(root, job.number),
  }
}

/** job.json with the page's extras, or null for a job without one. */
export function jobFrame(root: string, number: number): (Job & { extras: JobExtras }) | null {
  const job = loadJob(root, number)
  return job ? { ...job, extras: jobExtras(root, job) } : null
}
