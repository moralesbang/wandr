// Value record (T-009). Guarantee: `factory start` opens the live page for the user and tells the
// orchestrator nothing of its URL, which carries the token the page's data needs. Defect caught: the
// token reaching the orchestrator through `start`'s output, or a second start launching a second
// server. No acceptance test gives it: FI-021 is about the page's token, not who sees the URL.
// Level: unit, with the server and the browser faked.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jobsDir } from '../job.ts'
import { openWatch, watchInfoFile, type WatchDeps } from './background.ts'
import { watchTokenFile } from './server.ts'

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-watch-'))
  mkdirSync(jobsDir(root), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function fake(overrides: Partial<WatchDeps> = {}) {
  const opened: string[] = []
  const spawned: number[] = []
  const deps: WatchDeps = {
    platform: 'darwin',
    alive: () => true,
    // The server a spawn starts: records its pid and port, and the token it made.
    spawn: (_root, port) => {
      spawned.push(port)
      writeFileSync(watchTokenFile(root), 'secret-token\n')
      writeFileSync(watchInfoFile(root), JSON.stringify({ pid: 4242, port }))
      return 4242
    },
    open: (url) => {
      opened.push(url)
      return true
    },
    sleep: async () => {},
    attempts: 3,
    ...overrides,
  }
  return { deps, opened, spawned }
}

describe('openWatch', () => {
  test('starts the server and opens the URL with the token, returning a line without it', async () => {
    const { deps, opened, spawned } = fake()
    const said = await openWatch(root, 4300, deps)
    expect(spawned).toEqual([4300])
    expect(opened).toEqual(['http://localhost:4300/?token=secret-token'])
    expect(said).not.toContain('secret-token')
    expect(said).toContain('open')
  })

  test('a server that runs is reused, not started twice', async () => {
    const { deps, opened, spawned } = fake()
    await openWatch(root, 4300, deps)
    await openWatch(root, 4300, deps)
    expect(spawned).toHaveLength(1)
    expect(opened).toHaveLength(2)
  })

  test('a server that never comes up is reported, with no URL', async () => {
    const { deps, opened } = fake({ spawn: () => 1 })
    const said = await openWatch(root, 4300, deps)
    expect(opened).toEqual([])
    expect(said).toContain('factory watch')
  })

  test('a platform with no way to open a browser leaves the URL out of the output too', async () => {
    const { deps } = fake({ open: () => false })
    const said = await openWatch(root, 4300, deps)
    expect(said).not.toContain('token')
    expect(said).toContain('! bun run factory watch')
  })
})
