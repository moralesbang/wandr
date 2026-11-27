// The live page shows every job's log: the build agent's commands, the user's answers, the sealed
// material's names. An agent can reach localhost as easily as the user, so the server answers only
// a request with the token it printed for the user.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendEvent } from '../events.ts'
import { makeJob } from '../job-fixture.ts'
import { saveJob } from '../job.ts'
import { serveWatch, watchTokenFile } from './server.ts'

let root = ''
let served: ReturnType<typeof serveWatch>
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-watch-'))
  saveJob(root, makeJob({ session: 'job-session' }))
  appendEvent(root, {
    t: '2026-01-01T00:00:00Z',
    job: 7,
    source: 'hook',
    kind: 'bash',
    detail: { command: 'echo BUILD REASONING >> build-notes.md' },
  })
  served = serveWatch(root, 0)
})
afterEach(async () => {
  await served.server.stop(true)
  rmSync(root, { recursive: true, force: true })
})

const get = (path: string, token?: string) => {
  const url = new URL(path, served.server.url)
  if (token !== undefined) url.searchParams.set('token', token)
  return fetch(url)
}

/** The first chunks of the event stream, for long enough to hold the log. */
async function streamed(response: Response): Promise<string> {
  const reader = response.body!.getReader()
  let text = ''
  const until = Date.now() + 1000
  while (Date.now() < until && !text.includes('BUILD REASONING')) {
    const next = await Promise.race([reader.read(), Bun.sleep(300).then(() => null)])
    if (!next || next.done) break
    text += new TextDecoder().decode(next.value)
  }
  await reader.cancel()
  return text
}

describe('factory watch', () => {
  test.each(['/', '/state.js', '/events', '/events?job=7', '/nowhere'])(
    'refuses %s without the token',
    async (path) => {
      const response = await get(path)
      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain('BUILD REASONING')
    },
  )

  test.each(['/', '/state.js', '/events'])('refuses %s with a wrong token', async (path) => {
    expect((await get(path, 'x'.repeat(64))).status).toBe(403)
  })

  test('serves the page, its script and the stream with the token', async () => {
    const page = await get('/', served.token)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`/state.js?token=${served.token}`)
    expect((await get('/state.js', served.token)).status).toBe(200)
    expect(await streamed(await get('/events', served.token))).toContain('BUILD REASONING')
    expect(served.url).toContain(`?token=${served.token}`)
  })

  test("keeps the token in the main checkout's state folder, readable by its owner alone", () => {
    expect(readFileSync(watchTokenFile(root), 'utf8').trim()).toBe(served.token)
    expect(statSync(watchTokenFile(root)).mode & 0o777).toBe(0o600)
    expect(watchTokenFile(root)).toStartWith(join(root, 'factory', '.jobs'))
  })
})
