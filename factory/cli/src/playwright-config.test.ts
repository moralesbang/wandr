// A reviewer's sandbox serves its own build on its own port. Playwright's config must take that
// port and never reuse a server already listening there: a reused server is someone else's build,
// which is how job #13's evaluator read the test reviewer's mutated manifest on port 3100.

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const web = join(import.meta.dir, '..', '..', '..', 'apps', 'web')

type Loaded = {
  baseURL: string
  url: string
  port: string
  reuse: boolean
}

/** Loads the config in a fresh process, since it reads the environment once, at import. */
async function load(env: Record<string, string | undefined>): Promise<Loaded> {
  const script = `
    const { default: config } = await import('./playwright.config.ts')
    console.log(JSON.stringify({
      baseURL: config.use.baseURL,
      url: config.webServer.url,
      port: config.webServer.env.PORT,
      reuse: config.webServer.reuseExistingServer,
    }))`
  const base = { ...process.env }
  delete base.E2E_PORT
  delete base.CI
  const child = Bun.spawn(['bun', '-e', script], {
    cwd: web,
    env: { ...base, ...env } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(err)
  return JSON.parse(out) as Loaded
}

describe('playwright.config.ts: port and server reuse', () => {
  test('without E2E_PORT it serves on 3100 and reuses a running dev server locally', async () => {
    expect(await load({})).toEqual({
      baseURL: 'http://localhost:3100',
      url: 'http://localhost:3100/api/health',
      port: '3100',
      reuse: true,
    })
  })

  test('without E2E_PORT in CI it never reuses', async () => {
    expect((await load({ CI: '1' })).reuse).toBe(false)
  })

  test('with E2E_PORT it serves on that port and never reuses, even outside CI', async () => {
    expect(await load({ E2E_PORT: '45678' })).toEqual({
      baseURL: 'http://localhost:45678',
      url: 'http://localhost:45678/api/health',
      port: '45678',
      reuse: false,
    })
  })
})
