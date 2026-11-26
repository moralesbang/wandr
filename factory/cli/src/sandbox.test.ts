// A reviewer's sandbox: its names on the shared services, the environment its commands run with
// and how a command reaches it. The services themselves are exercised by sandbox.integration.ts.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Refusal } from './commands/common.ts'
import { runInSandbox, sandboxEnv, sandboxNames, withOverrides, type Sandbox } from './sandbox.ts'

describe('sandboxNames', () => {
  test.each([
    [13, 'evaluator', 'wandr_test_13_evaluator', 'wandr-test-13-evaluator'],
    [13, 'test-reviewer', 'wandr_test_13_test_reviewer', 'wandr-test-13-test-reviewer'],
    [7, 'Probe-2', 'wandr_test_7_probe_2', 'wandr-test-7-probe-2'],
  ])('job %d, role %s: database %s, bucket %s', (job, role, database, bucket) => {
    expect(sandboxNames(job, role)).toEqual({ database, bucket })
  })

  test('the main checks keep their own database and bucket', () => {
    const { database, bucket } = sandboxNames(13, 'test')
    expect(database).not.toBe('wandr_test')
    expect(bucket).not.toBe('wandr-test')
  })

  test.each(['', '../evaluator', 'a/b', 'evaluator;drop', '-x', 'role with space'])(
    'refuses the role %p: it names a folder and a database',
    (role) => {
      expect(() => sandboxNames(13, role)).toThrow(Refusal)
    },
  )

  test('a long role stays within the services limits and distinct from its neighbour', () => {
    const a = sandboxNames(13, `${'r'.repeat(60)}-a`)
    const b = sandboxNames(13, `${'r'.repeat(60)}-b`)
    for (const names of [a, b]) {
      expect(names.database.length).toBeLessThanOrEqual(63)
      expect(names.bucket.length).toBeLessThanOrEqual(63)
      expect(names.bucket).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    }
    expect(a.database).not.toBe(b.database)
    expect(a.bucket).not.toBe(b.bucket)
  })
})

const sandbox = (path: string): Sandbox => ({
  role: 'evaluator',
  path,
  port: 45123,
  database: 'wandr_test_13_evaluator',
  bucket: 'wandr-test-13-evaluator',
  databaseUrl: 'postgres://wandr:wandr@localhost:5432/wandr_test_13_evaluator',
  createdAt: '2026-01-01T00:00:00Z',
})

describe('sandboxEnv', () => {
  test("points the API, Playwright and the tests at the sandbox's own port, database and bucket", () => {
    expect(sandboxEnv(sandbox('/x'))).toEqual({
      PORT: '45123',
      E2E_PORT: '45123',
      DATABASE_URL: 'postgres://wandr:wandr@localhost:5432/wandr_test_13_evaluator',
      S3_BUCKET: 'wandr-test-13-evaluator',
    })
  })
})

describe('withOverrides', () => {
  test("replaces the sandbox's keys in an env file, keeps the rest and adds what is missing", () => {
    const text =
      '# Test values\nPORT=3000\nDATABASE_URL=postgres://h/wandr_test\nS3_REGION=us-east-1\n'
    expect(
      withOverrides(text, { PORT: '45123', DATABASE_URL: 'postgres://h/x', S3_BUCKET: 'b' }),
    ).toBe(
      '# Test values\nPORT=45123\nDATABASE_URL=postgres://h/x\nS3_REGION=us-east-1\nS3_BUCKET=b\n',
    )
  })
})

describe('runInSandbox', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'factory-sandbox-exec-'))
    mkdirSync(join(dir, 'checkout'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('runs the argv untouched, in the checkout, with the sandbox env, and passes the exit code', async () => {
    const out = join(dir, 'out.json')
    const script = `require('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({
      argv: process.argv.slice(2), cwd: process.cwd(),
      env: { PORT: process.env.PORT, E2E_PORT: process.env.E2E_PORT,
             DATABASE_URL: process.env.DATABASE_URL, S3_BUCKET: process.env.S3_BUCKET },
    })); process.exit(7)`
    const args = ['two words', '$HOME', "'; rm -rf /'", '--flag=x', '*']
    const probe = join(dir, 'probe.js')
    writeFileSync(probe, script)
    const code = await runInSandbox(sandbox(join(dir, 'checkout')), ['bun', probe, ...args])
    expect(code).toBe(7)
    const seen = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>
    expect(seen.argv).toEqual(args)
    expect(seen.cwd).toEndWith('/checkout')
    expect(seen.env).toEqual(sandboxEnv(sandbox('')))
  })
})
