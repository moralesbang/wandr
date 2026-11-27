// `factory ruling <n>`: before an acceptance-test fix is committed, a fresh test reviewer rules
// whether it keeps the guarantee. The CLI hashes the uncommitted acceptance-test diff; the ruling
// names that hash, so `factory atfix --ruling` commits exactly the diff that was ruled on. A
// changed guarantee is the user's call, through a Decision Request; the build agent never decides.

import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { handoffDir, saveJob, type Job } from '../job.ts'
import { isAcceptanceTest } from '../paths.ts'
import { refuseWhileSealed } from '../seal.ts'
import { git, lines, workingTree } from '../shell.ts'
import { record, Refusal, refuseWhileBlocked, requireJob } from './common.ts'

export const RULING_USAGE = `  ruling <n>                 hash the uncommitted acceptance-test fix and name the file a test reviewer rules in
  atfix <n> --ruling <m> --note <text>
                             commit that fix on a same-guarantee ruling`

/**
 * The sha256 of the uncommitted acceptance-test diff against HEAD, new files included; null when no
 * acceptance test changed. Built from a throwaway index, so the real one is untouched.
 */
export async function acceptanceDiffHash(worktree: string): Promise<string | null> {
  const now = await workingTree(worktree)
  const changed = lines(await git(worktree, 'diff', '--name-only', '--no-renames', 'HEAD', now))
  const tests = changed.filter(isAcceptanceTest)
  if (tests.length === 0) return null
  const diff = await git(worktree, 'diff', '--binary', '--no-renames', 'HEAD', now, '--', ...tests)
  return new Bun.CryptoHasher('sha256').update(diff).digest('hex')
}

export const rulingFile = (job: Pick<Job, 'number' | 'worktree'>, m: number) =>
  join(handoffDir(job), 'rulings', `${m}.md`)

export type Requested = { ruling: number; diff: string; file: string }

/** Asks for a ruling on the uncommitted acceptance-test fix: its number, its diff's hash, its file. */
export async function ruling(root: string, number: number): Promise<Requested> {
  const job = requireJob(root, number)
  refuseWhileBlocked(job, 'a ruling')
  refuseWhileSealed(root, job, 'a ruling')
  const diff = await acceptanceDiffHash(job.worktree)
  if (!diff) {
    throw new Refusal(
      `No uncommitted acceptance-test change in ${job.worktree}: launch factory-test (task fix) first.`,
    )
  }
  const next = job.rulings.length + 1
  const file = rulingFile(job, next)
  mkdirSync(join(handoffDir(job), 'rulings'), { recursive: true })
  saveJob(root, {
    ...job,
    rulings: [...job.rulings, { ruling: next, diff, at: new Date().toISOString() }],
  })
  record(root, number, 'ruling.requested', { ruling: next, diff })
  return { ruling: next, diff, file }
}

export type Ruling = {
  verdict: 'same-guarantee' | 'changed-guarantee' | null
  diff: string | null
}

/** Reads a ruling's `Verdict: same-guarantee|changed-guarantee` and `Diff: <hash>` lines. */
export function parseRuling(text: string): Ruling {
  const verdict = /^\s*verdict:\s*(same-guarantee|changed-guarantee)\s*$/im.exec(text)?.[1]
  const diff = /^\s*diff:\s*(\S+)\s*$/im.exec(text)?.[1]
  return {
    verdict: (verdict?.toLowerCase() as Ruling['verdict'] | undefined) ?? null,
    diff: diff ?? null,
  }
}

/**
 * Refuses unless ruling `m` was asked for, is written, says same-guarantee and rules on the
 * acceptance-test diff in the worktree now. Returns the hash it ruled on.
 */
export async function requireSameGuarantee(job: Job, m: number): Promise<string> {
  const file = rulingFile(job, m)
  const asked = job.rulings.find((item) => item.ruling === m)
  if (!asked) {
    throw new Refusal(
      `rulings/${m}.md was never asked for. Run factory ruling ${job.number} and launch the test reviewer (task ruling) on the file it names.`,
    )
  }
  if (!existsSync(file)) {
    throw new Refusal(
      `No ruling yet in ${file}. Launch a fresh factory-test-reviewer (task ruling) to write it.`,
    )
  }
  const { verdict, diff } = parseRuling(readFileSync(file, 'utf8'))
  if (verdict === 'changed-guarantee') {
    throw new Refusal(
      `rulings/${m}.md says the fix changes what the test guarantees. That is the user's decision: raise a Decision Request with factory block ${job.number} <file>, and after the user's answer, commit with factory rewrite.`,
    )
  }
  if (verdict !== 'same-guarantee') {
    throw new Refusal(
      `rulings/${m}.md has no "Verdict: same-guarantee" or "Verdict: changed-guarantee" line.`,
    )
  }
  const now = await acceptanceDiffHash(job.worktree)
  if (diff !== asked.diff || now !== asked.diff) {
    throw new Refusal(
      `The acceptance-test diff changed since ruling ${m} (ruled on ${diff ?? 'no Diff line'}, asked for ${asked.diff}, now ${now ?? 'none'}). Run factory ruling ${job.number} again for the fix as it is.`,
    )
  }
  return asked.diff
}
