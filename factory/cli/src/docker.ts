// Docker is the first thing a job needs and the last thing anyone checks: the e2e tests and the
// reviewers' sandboxes run on `bun run services`. Job #15 lost about 13 minutes to a Docker Desktop
// that wasn't running before anyone noticed. `factory start` and `factory check` call this first:
// on macOS with Docker Desktop installed it opens the app and waits for the daemon; anywhere else
// it only checks. Either way a Docker that isn't there fails fast, with what to do.

import { existsSync } from 'node:fs'
import { Refusal } from './commands/common.ts'

/** Everything the preflight touches, so a test needs no Docker: each piece is replaceable. */
export type DockerDeps = {
  platform: string
  /** CI never starts anything: the runner has Docker or it doesn't. */
  ci: boolean
  exists: (path: string) => boolean
  /** Runs a command and returns its exit code; one that can't start is a failure. */
  run: (argv: string[]) => Promise<number>
  sleep: (ms: number) => Promise<void>
  now: () => number
  /** How long to wait for the daemon after opening the app. */
  timeoutMs: number
  pollMs: number
}

export const DOCKER_APP = '/Applications/Docker.app'
export const DOCKER_TIMEOUT_MS = 90_000

/** The exit code of a command, killed after `limit` ms (a wedged daemon hangs `docker info`). */
async function run(argv: string[], limit = 20_000): Promise<number> {
  try {
    const child = Bun.spawn(argv, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
    const timer = setTimeout(() => child.kill(), limit)
    try {
      return await child.exited
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return 127
  }
}

export const realDocker = (): DockerDeps => ({
  platform: process.platform,
  ci: Boolean(process.env.CI),
  exists: existsSync,
  run,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
  timeoutMs: DOCKER_TIMEOUT_MS,
  pollMs: 2_000,
})

const FAILED = "Docker didn't start; open Docker Desktop, accept any prompt it shows, and retry."

/**
 * Makes sure `docker info` succeeds, or refuses. On macOS with Docker Desktop installed it runs
 * `open -a Docker` and polls for up to `timeoutMs`; on Linux and in CI it never starts anything.
 */
export async function ensureDocker(deps: DockerDeps = realDocker()): Promise<void> {
  if ((await deps.run(['docker', 'info'])) === 0) return
  if (deps.ci || deps.platform !== 'darwin' || !deps.exists(DOCKER_APP)) {
    throw new Refusal(
      deps.platform === 'darwin' && !deps.ci
        ? `Docker isn't running and ${DOCKER_APP} isn't installed. Install Docker Desktop, open it, and retry.`
        : "Docker isn't running (`docker info` fails). Start the Docker daemon and retry.",
    )
  }
  console.error('Docker is not running: opening Docker Desktop and waiting for it…')
  await deps.run(['open', '-a', 'Docker'])
  const deadline = deps.now() + deps.timeoutMs
  while (deps.now() < deadline) {
    await deps.sleep(deps.pollMs)
    if ((await deps.run(['docker', 'info'])) === 0) return
  }
  throw new Refusal(FAILED)
}
