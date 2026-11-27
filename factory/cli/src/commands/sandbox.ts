// `factory sandbox`: a reviewer's own disposable checkout, port, database and bucket. See
// ../sandbox.ts for why each reviewer needs one.

import { existsSync } from 'node:fs'
import { createSandbox, loadSandbox, removeSandbox, runInSandbox } from '../sandbox.ts'
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
export async function sandboxCommand(root: string, args: string[]): Promise<number> {
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
    return runInSandbox(sandbox, argv)
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
