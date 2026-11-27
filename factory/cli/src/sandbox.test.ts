// A reviewer's sandbox: its names on the shared services, the environment its commands run with
// and how a command reaches it. The services themselves are exercised by sandbox.integration.ts.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Refusal } from './commands/common.ts'
import { makeJob } from './job-fixture.ts'
import {
  freePort,
  recordedPorts,
  removeSandbox,
  runInSandbox,
  sandboxEnv,
  sandboxNames,
  withOverrides,
  type Sandbox,
} from './sandbox.ts'

describe('sandboxNames', () => {
  test.each([
    [13, 'evaluator', 'wandr_test_13_evaluator', 'wandr-test-13-evaluator'],
    [13, 'test-reviewer', 'wandr_test_13_test_reviewer', 'wandr-test-13-test-reviewer'],
  ])('job %d, role %s: database %s, bucket %s', (job, role, database, bucket) => {
    expect(sandboxNames(job, role)).toEqual({ database, bucket })
  })

  test('the main checks keep their own database and bucket', () => {
    for (const role of ['evaluator', 'test-reviewer']) {
      const { database, bucket } = sandboxNames(13, role)
      expect(database).not.toBe('wandr_test')
      expect(bucket).not.toBe('wandr-test')
    }
  })

  // A sandbox is a reviewer's, and the guard keeps each reviewer out of the other's: a role that
  // only looks like one (Evaluator, a third name) would be a sandbox no rule covers.
  test.each([
    '',
    '../evaluator',
    'a/b',
    'evaluator;drop',
    '-x',
    'role with space',
    'Evaluator',
    'TEST-REVIEWER',
    'probe-2',
    'test',
    'evaluator-2',
  ])('refuses the role %p: only evaluator and test-reviewer have sandboxes', (role) => {
    expect(() => sandboxNames(13, role)).toThrow(Refusal)
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

describe('sandbox ports', () => {
  let root = ''
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'factory-sandbox-ports-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const record = (job: number, role: string, port: number) => {
    mkdirSync(join(root, 'factory', '.jobs', String(job), 'sandbox'), { recursive: true })
    writeFileSync(
      join(root, 'factory', '.jobs', String(job), 'sandbox', `${role}.json`),
      JSON.stringify({ ...sandbox('/x'), role, port }),
    )
  }

  test("every job's recorded sandbox holds its port", () => {
    record(7, 'evaluator', 45001)
    record(9, 'test-reviewer', 45002)
    expect([...recordedPorts(root)].toSorted()).toEqual([45001, 45002])
  })

  // A sandbox's server is down between runs, so the OS may offer its port to the next sandbox.
  test('a new sandbox never gets a port another sandbox holds', () => {
    const offered = [45001, 45001, 45003]
    expect(freePort(new Set([45001, 45002]), () => offered.shift())).toBe(45003)
  })
})

describe('removing a sandbox', () => {
  let root = ''
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'factory-sandbox-rm-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const job = () => makeJob({ worktree: join(root, '.claude', 'worktrees', '7-gone') })
  const recordFile = () => join(root, 'factory', '.jobs', '7', 'sandbox', 'evaluator.json')
  const keepRecord = () => {
    mkdirSync(dirname(recordFile()), { recursive: true })
    writeFileSync(recordFile(), JSON.stringify(sandbox('/x')))
  }

  test('keeps the record when no checkout says where the services are', async () => {
    keepRecord()
    const error = await removeSandbox(root, job(), 'evaluator').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Refusal)
    expect(existsSync(recordFile())).toBe(true)
  })

  test("reads the services from the main checkout once the job's worktree is gone, and keeps the record while the drop fails", async () => {
    keepRecord()
    mkdirSync(join(root, 'apps', 'api'), { recursive: true })
    writeFileSync(
      join(root, 'apps', 'api', '.env.test'),
      'DATABASE_URL=postgres://u:p@127.0.0.1:1/wandr_test\nS3_ENDPOINT=http://127.0.0.1:1\nS3_REGION=us-east-1\nS3_ACCESS_KEY_ID=a\nS3_SECRET_ACCESS_KEY=b\n',
    )
    const error = await removeSandbox(root, job(), 'evaluator').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain('.env.test')
    expect(existsSync(recordFile())).toBe(true)
  })
})
