// What a reviewer's sandbox is called: its folder, its database and its bucket, one per role. Kept
// apart from sandbox.ts so the guard hook reads the names without loading the services' clients.

import { Refusal } from './commands/common.ts'
import { REVIEWER_ROLES, type ReviewerRole } from './job.ts'

/** A sandbox belongs to a reviewer: the role is exactly one of theirs, as written. */
export const isSandboxRole = (role: string): role is ReviewerRole =>
  (REVIEWER_ROLES as readonly string[]).includes(role)

export function checkRole(role: string): asserts role is ReviewerRole {
  if (!isSandboxRole(role)) {
    throw new Refusal(
      `A sandbox belongs to a reviewer: its role is ${REVIEWER_ROLES.join(' or ')}, exactly; got "${role}".`,
    )
  }
}

/**
 * The sandbox's database and bucket on the shared services. Never the main checks' `wandr_test` and
 * `wandr-test`: those take the checks lock, sandboxes don't.
 */
export function sandboxNames(job: number, role: string): { database: string; bucket: string } {
  checkRole(role)
  const words = role.split('-')
  return {
    database: ['wandr_test', job, ...words].join('_'),
    bucket: ['wandr-test', job, ...words].join('-'),
  }
}
