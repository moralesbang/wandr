// A job's risk: what the issue declares, raised by what the branch actually touches. It decides
// which reviewers a pass needs and which model and effort each agent runs with (launch.ts).

import type { Job, Risk } from './job.ts'
import { isPrivacyBoundary, isTamperProne } from './paths.ts'
import { git, lines } from './shell.ts'

export type EffectiveRisk = {
  risk: Risk
  /** The changed paths that raised the declared risk; empty when it stands as declared. */
  raisedBy: string[]
}

/**
 * The declared risk, raised to normal when the diff touches the privacy boundary or a tamper-prone
 * file. Never lowers a risk, and never raises it past normal: only the issue declares high.
 */
export function effectiveRisk(declared: Risk, changedPaths: readonly string[]): EffectiveRisk {
  if (declared !== 'low') return { risk: declared, raisedBy: [] }
  const raisedBy = changedPaths.filter((path) => isPrivacyBoundary(path) || isTamperProne(path))
  return raisedBy.length ? { risk: 'normal', raisedBy } : { risk: 'low', raisedBy: [] }
}

/** The files the job's branch changed, base..HEAD of its worktree. */
export const branchChanges = async (job: Pick<Job, 'worktree' | 'base'>) =>
  lines(await git(job.worktree, 'diff', '--name-only', '--no-renames', job.base, 'HEAD'))

/** The job's effective risk now, from its branch's diff. */
export const jobRisk = async (job: Pick<Job, 'worktree' | 'base' | 'risk'>) =>
  effectiveRisk(job.risk, await branchChanges(job))
