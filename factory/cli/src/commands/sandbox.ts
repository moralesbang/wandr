// `factory sandbox`: a reviewer's own disposable checkout, port, database and bucket. See
// ../sandbox.ts for why each reviewer needs one.

import { existsSync } from 'node:fs'
import { readEvents } from '../events.ts'
import { reviewPass } from '../job.ts'
import { sandboxMinutes } from '../review-plan.ts'
import {
  createSandbox,
  loadSandbox,
  removeSandbox,
  runInSandbox,
  type Sandbox,
} from '../sandbox.ts'
import { record, Refusal, requireJob } from './common.ts'

export const SANDBOX_USAGE = `  sandbox <n> <role>                 make a fresh sandbox for a reviewer; prints its path, port,
                                     database and bucket as JSON
  sandbox exec <n> <role> -- <cmd…>  run a command in the sandbox with its environment
  sandbox rm <n> <role>              remove the sandbox, its database and its bucket`

const number = (value: string | undefined) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Refusal(`Expected an issue number.\n\n${SANDBOX_USAGE}`)
  }
  return parsed
}

/**
 * Runs `factory sandbox …` from the arguments after `sandbox`, untouched by the CLI's option
 * parser: everything after `--` belongs to the command run in the sandbox. Resolves to the exit
 * code, the command's own for `exec`.
 */
/** What `sandbox exec` runs a command with and times it by: replaceable in a test. */
export type ExecDeps = {
  run: (sandbox: Sandbox, argv: string[], timeoutMs: number) => Promise<number>
  now: () => number
}

const realExec: ExecDeps = { run: runInSandbox, now: Date.now }

/**
 * The seconds a role already spent in `sandbox exec` in the pass under way, from the CLI's own
 * `sandbox.exec` events: per job, pass and role, so a relaunched reviewer inherits what is spent.
 */
export function sandboxSecondsSpent(root: string, job: number, role: string, pass: number) {
  return readEvents(root, job)
    .filter(
      (event) =>
        event.kind === 'sandbox.exec' && event.detail?.role === role && event.detail?.pass === pass,
    )
    .reduce((sum, event) => sum + Number(event.detail?.seconds ?? 0), 0)
}

export async function sandboxCommand(
  root: string,
  args: string[],
  deps: ExecDeps = realExec,
): Promise<number> {
  const split = args.indexOf('--')
  const head = split === -1 ? args : args.slice(0, split)
  const argv = split === -1 ? [] : args.slice(split + 1)

  if (head[0] === 'exec') {
    const [, n, role] = head
    if (!role || !argv.length) throw new Refusal(`Usage:\n${SANDBOX_USAGE}`)
    const job = requireJob(root, number(n))
    const sandbox = loadSandbox(root, job.number, role)
    if (!sandbox || !existsSync(sandbox.path)) {
      throw new Refusal(
        `Job #${job.number} has no ${role} sandbox. Run: factory sandbox ${job.number} ${role}`,
      )
    }
    // The reviewer's time in the sandbox is budgeted per job, pass and role (review-plan.ts
    // SANDBOX_MINUTES): the CLI runs the command, so the CLI keeps the clock. The command is killed
    // when the time left runs out, and each run's duration goes in the log.
    const pass = reviewPass(job)
    const budget = sandboxMinutes(job, role) * 60
    const left = budget - sandboxSecondsSpent(root, job.number, role, pass)
    if (left <= 0) {
      throw new Refusal(
        `Sandbox budget spent: write your report with the evidence you have and list what you could not check as a finding. (The ${role} had ${Math.round(budget / 60)} min in review pass ${pass}.)`,
      )
    }
    const started = deps.now()
    const exit = await deps.run(sandbox, argv, left * 1000)
    const seconds = Math.round(((deps.now() - started) / 1000) * 10) / 10
    record(root, job.number, 'sandbox.exec', { role, pass, seconds, exit })
    return exit
  }

  if (head[0] === 'rm') {
    const [, n, role] = head
    if (!role) throw new Refusal(`Usage:\n${SANDBOX_USAGE}`)
    const job = requireJob(root, number(n))
    const done = await removeSandbox(root, job, role)
    record(root, job.number, 'sandbox.removed', { role })
    console.log(done.length ? done.join('\n') : `Job #${job.number} had no ${role} sandbox.`)
    return 0
  }

  const [n, role] = head
  if (!role || head.length > 2 || argv.length) throw new Refusal(`Usage:\n${SANDBOX_USAGE}`)
  const job = requireJob(root, number(n))
  const sandbox = await createSandbox(root, job, role)
  const { path, port, database, bucket } = sandbox
  record(root, job.number, 'sandbox.created', { role, path, port, database, bucket })
  console.log(JSON.stringify({ path, port, database, bucket }, null, 2))
  return 0
}
