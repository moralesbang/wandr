import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInSandbox, type Sandbox } from './sandbox.ts'

// Process groups are a POSIX feature: the only platform without them is Windows, where the factory
// (a Bun CLI driving git worktrees and a Postgres in Docker) isn't run, so these tests skip there.
const posix = process.platform !== 'win32'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-kill-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const sandbox = (): Sandbox => ({
  role: 'evaluator',
  path: dir,
  port: 3101,
  database: 'd',
  bucket: 'b',
  databaseUrl: 'postgres://x',
  createdAt: 'x',
})

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const pids = (file: string) =>
  readFileSync(join(dir, file), 'utf8').trim().split(/\s+/).filter(Boolean).map(Number)

/** Waits for the processes to be gone, a moment for the kernel to reap what was killed. */
async function gone(list: number[]) {
  for (let i = 0; i < 80 && list.some(alive); i++) await Bun.sleep(25)
  return list.every((pid) => !alive(pid))
}

/** Whether this process can listen on the port, trying for a moment while the kernel lets go. */
async function listens(port: number) {
  for (let i = 0; i < 80; i++) {
    try {
      const server = Bun.serve({ port, fetch: () => new Response() })
      void server.stop(true)
      return true
    } catch {
      await Bun.sleep(25)
    }
  }
  return false
}

const freePort = () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = Number(server.port)
  void server.stop(true)
  return port
}

describe.skipIf(!posix)(
  'FI-031: a sandbox exec that ends leaves no process of its group behind',
  () => {
    test('a timeout ends the whole tree of `sh -c`, exits 124 and is not the CLI’s own group', async () => {
      const started = Date.now()
      const code = await runInSandbox(
        sandbox(),
        ['sh', '-c', 'sleep 300 & echo $! > pids; echo $$ >> pids; sleep 300'],
        300,
        300,
      )
      expect(code).toBe(124)
      expect(Date.now() - started).toBeLessThan(10_000)
      const recorded = pids('pids')
      expect(recorded).toHaveLength(2)
      expect(await gone(recorded)).toBe(true)
      // This process, in a group of its own apart from the command's, is still here.
      expect(alive(process.pid)).toBe(true)
    })

    test('a command that ignores SIGTERM is killed after the grace period', async () => {
      const code = await runInSandbox(
        sandbox(),
        ['sh', '-c', 'trap "" TERM; sleep 300 & echo $! > pids; sleep 300'],
        300,
        300,
      )
      expect(code).toBe(124)
      expect(await gone(pids('pids'))).toBe(true)
    })

    test('a server a command started leaves its port free once the exec timed out', async () => {
      const port = freePort()
      const code = await runInSandbox(
        sandbox(),
        [
          'sh',
          '-c',
          `bun -e 'Bun.serve({ port: ${port}, fetch: () => new Response("up") }); await new Promise(() => {})' & echo $! > pids; wait`,
        ],
        1500,
        300,
      )
      expect(code).toBe(124)
      expect(await gone(pids('pids'))).toBe(true)
      expect(await listens(port)).toBe(true)
    })

    test('a command that ends normally but left a background child behind has it ended too', async () => {
      const code = await runInSandbox(
        sandbox(),
        ['sh', '-c', 'sleep 300 & echo $! > pids'],
        60_000,
        300,
      )
      expect(code).toBe(0)
      expect(await gone(pids('pids'))).toBe(true)
    })

    test('the command’s exit code and its output survive', async () => {
      const out = join(dir, 'out.txt')
      const code = await runInSandbox(
        sandbox(),
        ['sh', '-c', `echo hello > ${out}; exit 7`],
        60_000,
        300,
      )
      expect(code).toBe(7)
      expect(readFileSync(out, 'utf8')).toBe('hello\n')
    })
  },
)
