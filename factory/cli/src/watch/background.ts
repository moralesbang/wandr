// `factory start` opens the live page for the user: it starts the server in the background if none
// runs and opens the URL in the user's browser. The URL carries a token the page's data needs (the
// page shows the sealed names and the user's answers), so the CLI process opens it itself and prints
// nothing of it: the orchestrator that ran `start` never sees the token. The server records its pid
// and port in `watch.json`, next to the token, so a second `start` or a `factory watch` finds it.

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { jobsDir, writeAtomic } from '../job.ts'
import { watchTokenFile } from './server.ts'

export const WATCH_PORT = 4300

export const watchInfoFile = (root: string) => join(jobsDir(root), 'watch.json')

type Info = { pid: number; port: number }

export function readWatchInfo(root: string): Info | null {
  try {
    const parsed = JSON.parse(readFileSync(watchInfoFile(root), 'utf8')) as Partial<Info>
    return typeof parsed.pid === 'number' && typeof parsed.port === 'number'
      ? { pid: parsed.pid, port: parsed.port }
      : null
  } catch {
    return null
  }
}

/** Records the running server; removes the record when the process ends. */
export function recordWatch(root: string, port: number): void {
  writeAtomic(watchInfoFile(root), `${JSON.stringify({ pid: process.pid, port })}\n`)
  const forget = () => rmSync(watchInfoFile(root), { force: true })
  process.on('exit', forget)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => process.exit(0))
}

/** Everything `openWatch` touches outside the checkout, replaceable in a test. */
export type WatchDeps = {
  platform: string
  alive: (pid: number) => boolean
  /** Starts the server detached from this process and returns its pid. */
  spawn: (root: string, port: number) => number
  /** Opens a URL in the user's browser; false when this platform has no way to. */
  open: (url: string) => boolean
  sleep: (ms: number) => Promise<void>
  attempts: number
}

export const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const realWatch = (): WatchDeps => ({
  platform: process.platform,
  alive: isAlive,
  spawn: (root, port) => {
    const log = join(jobsDir(root), 'watch.log')
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, '..', 'main.ts'), 'watch', '--port', String(port)],
      {
        stdin: 'ignore',
        stdout: Bun.file(log),
        stderr: Bun.file(log),
        detached: true,
      },
    )
    child.unref()
    return child.pid
  },
  open: (url) => {
    const program =
      process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null
    if (!program) return false
    try {
      Bun.spawn([program, url], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).unref()
      return true
    } catch {
      return false
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts: 40,
})

/**
 * Starts the live page's server if it isn't running and opens the page in the user's browser.
 * Returns what to tell the orchestrator, never the URL.
 */
export async function openWatch(
  root: string,
  port: number = WATCH_PORT,
  deps: WatchDeps = realWatch(),
): Promise<string> {
  let info = readWatchInfo(root)
  if (!info || !deps.alive(info.pid)) {
    const pid = deps.spawn(root, port)
    info = null
    for (let i = 0; i < deps.attempts && !info; i++) {
      await deps.sleep(250)
      const written = readWatchInfo(root)
      if (written && written.pid === pid) info = written
    }
    if (!info)
      return `The live page didn't start (see ${join(jobsDir(root), 'watch.log')}); the user can run \`! bun run factory watch\`.`
  }
  if (!existsSync(watchTokenFile(root)))
    return 'The live page runs; the user can run `! bun run factory watch` for its URL.'
  const token = readFileSync(watchTokenFile(root), 'utf8').trim()
  return deps.open(`http://localhost:${info.port}/?token=${token}`)
    ? "The live page is open in the user's browser."
    : 'The live page runs; the user can run `! bun run factory watch` for its URL.'
}
