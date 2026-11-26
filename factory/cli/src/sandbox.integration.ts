// Two reviewers' sandboxes of one job, used at the same time, each see only their own work: their
// own build on their own port, their own database and their own bucket. Job #13's reviewers shared
// all three, and the evaluator read the test reviewer's mutated manifest as the build's.
//
// Needs the shared Docker services (`bun run services`, migrated) and Playwright's browsers, so it
// runs as `bun run e2e` (CI's `bunx turbo run e2e`), not with the unit suite. The job is a
// throwaway worktree of this repo at a commit of the current files, never a real job's worktree.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SQL, S3Client } from 'bun'
import { $ } from 'bun'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { makeJob } from './job-fixture.ts'
import { saveJob, type Job } from './job.ts'
import {
  createSandbox,
  removeSandbox,
  removeSandboxes,
  runInSandbox,
  type Sandbox,
} from './sandbox.ts'
import { git, workingTree } from './shell.ts'

const MINUTES = 60_000
const repo = resolve(import.meta.dir, '..', '..', '..')
const ROLES = ['evaluator', 'test-reviewer'] as const
type Role = (typeof ROLES)[number]

let root = ''
let job: Job
const sandboxes = {} as Record<Role, Sandbox>

const services = () => {
  const env = Object.fromEntries(
    readFileSync(join(repo, 'apps', 'api', '.env.test'), 'utf8')
      .split('\n')
      .map((line) => line.split(/=(.*)/s))
      .filter((pair) => pair.length > 1),
  ) as Record<string, string>
  return env
}
const shared = services()
const s3 = (bucket: string) =>
  new S3Client({
    endpoint: shared.S3_ENDPOINT,
    region: shared.S3_REGION,
    accessKeyId: shared.S3_ACCESS_KEY_ID,
    secretAccessKey: shared.S3_SECRET_ACCESS_KEY,
    bucket,
  })
const adminSql = () => new SQL(shared.DATABASE_URL as string)

async function databaseExists(name: string) {
  const sql = adminSql()
  try {
    return (await sql`select 1 from pg_database where datname = ${name}`).length > 0
  } finally {
    await sql.close()
  }
}

async function bucketKeys(bucket: string): Promise<string[] | null> {
  try {
    return ((await s3(bucket).list()).contents ?? []).map((object) => object.key).toSorted()
  } catch {
    return null
  }
}

// Writes a row and an object through the API's own modules (in apps/api, where its packages
// resolve) and its .env.test, as a server the sandbox starts would reach them, then reports what
// it sees after the other sandbox has written too.
const probe = (out: string) => `
  import { sql } from 'drizzle-orm'
  import { db } from './src/db/client.ts'
  import { bucket } from './src/photos/bucket.ts'
  const role = process.argv[2]
  await db.execute(sql\`create table if not exists sandbox_probe (role text)\`)
  await db.execute(sql\`insert into sandbox_probe values (\${role})\`)
  await bucket.write(\`\${role}.txt\`, role)
  await Bun.sleep(1000)
  const rows = await db.execute(sql\`select role from sandbox_probe\`)
  const keys = ((await bucket.list()).contents ?? []).map((object) => object.key)
  await Bun.write(${JSON.stringify(out)}, JSON.stringify({ rows: [...rows].map((r) => r.role), keys }))
  process.exit(0)
`

const marker = (role: Role) => `served by the ${role} sandbox`

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-sandbox-it-'))
  // The job's HEAD is what a sandbox checks out: commit the files as they are now, uncommitted
  // changes included, on no branch, so the test runs the code under test.
  const tree = await workingTree(repo)
  const commit = (
    await $`git -C ${repo} commit-tree ${tree} -m ${'factory sandbox integration test'}`
      .env({
        ...process.env,
        GIT_AUTHOR_NAME: 'factory',
        GIT_AUTHOR_EMAIL: 'factory@localhost',
        GIT_COMMITTER_NAME: 'factory',
        GIT_COMMITTER_EMAIL: 'factory@localhost',
      })
      .quiet()
      .text()
  ).trim()
  const worktree = join(root, 'job')
  await git(repo, 'worktree', 'add', '--quiet', '--detach', worktree, commit)
  // A number no real job uses, distinct per run so concurrent runs don't share databases.
  job = makeJob({ number: 900_000 + (process.pid % 99_999), worktree })
  saveJob(root, job)
}, 2 * MINUTES)

afterAll(async () => {
  if (job) {
    await removeSandboxes(root, job)
    await git(repo, 'worktree', 'remove', '--force', job.worktree).catch(() => '')
    await git(repo, 'worktree', 'prune')
  }
  rmSync(root, { recursive: true, force: true })
}, 2 * MINUTES)

describe('factory sandbox: two reviewers at once', () => {
  test(
    'each sandbox gets its own checkout, port, database and bucket',
    async () => {
      const made = await Promise.all(ROLES.map((role) => createSandbox(root, job, role)))
      for (const sandbox of made) sandboxes[sandbox.role as Role] = sandbox
      const [a, b] = made as [Sandbox, Sandbox]
      expect(a.path).toBe(
        join(job.worktree, 'factory/.jobs', String(job.number), 'sandbox/evaluator'),
      )
      expect(new Set([a.port, b.port, 3100]).size).toBe(3)
      expect(a.database).not.toBe(b.database)
      expect(a.bucket).not.toBe(b.bucket)
      for (const sandbox of made) {
        expect(await databaseExists(sandbox.database)).toBe(true)
        expect(await bucketKeys(sandbox.bucket)).toEqual([])
        // The sandbox's own env file stays out of the diff a reviewer reads.
        expect(await git(sandbox.path, 'status', '--porcelain')).toBe('')
      }
    },
    10 * MINUTES,
  )

  test(
    'two Playwright runs at the same time each see only their own mutated build',
    async () => {
      for (const role of ROLES) {
        const other = ROLES.find((r) => r !== role) as Role
        const web = join(sandboxes[role].path, 'apps', 'web')
        writeFileSync(join(web, 'public', 'sandbox-probe.txt'), marker(role))
        writeFileSync(
          join(web, 'e2e', 'sandbox-probe.spec.ts'),
          `import { expect, test } from '@playwright/test'

test('serves this sandbox build, not the other one', async ({ request }) => {
  const body = await (await request.get('/sandbox-probe.txt')).text()
  expect(body).toBe(${JSON.stringify(marker(role))})
  expect(body).not.toBe(${JSON.stringify(marker(other))})
})
`,
        )
      }
      const build = await Promise.all(
        ROLES.map((role) =>
          runInSandbox(sandboxes[role], ['bun', 'run', '--cwd', 'apps/web', 'build']),
        ),
      )
      expect(build).toEqual([0, 0])
      const e2e = await Promise.all(
        ROLES.map((role) =>
          runInSandbox(sandboxes[role], [
            'bun',
            'run',
            '--cwd',
            'apps/web',
            'e2e',
            'e2e/sandbox-probe.spec.ts',
            '--project=chromium',
          ]),
        ),
      )
      expect(e2e).toEqual([0, 0])
    },
    10 * MINUTES,
  )

  test(
    "the API's own database and bucket clients write to the sandbox's, unseen by the other",
    async () => {
      const outs = ROLES.map((role) => join(root, `${role}.json`))
      ROLES.forEach((role, i) =>
        writeFileSync(
          join(sandboxes[role].path, 'apps/api/probe-services.ts'),
          probe(outs[i] as string),
        ),
      )
      const codes = await Promise.all(
        ROLES.map((role) =>
          runInSandbox(sandboxes[role], [
            'bun',
            '--env-file=apps/api/.env.test',
            'apps/api/probe-services.ts',
            role,
          ]),
        ),
      )
      expect(codes).toEqual([0, 0])
      ROLES.forEach((role, i) => {
        expect(JSON.parse(readFileSync(outs[i] as string, 'utf8'))).toEqual({
          rows: [role],
          keys: [`${role}.txt`],
        })
      })
      const sql = adminSql()
      try {
        const [found] = await sql`select to_regclass('sandbox_probe') as t`
        expect(found.t).toBeNull()
      } finally {
        await sql.close()
      }
    },
    5 * MINUTES,
  )

  test(
    'recreating a sandbox starts it fresh: no mutation, no rows, no objects',
    async () => {
      const again = await createSandbox(root, job, 'evaluator')
      sandboxes.evaluator = again
      expect(existsSync(join(again.path, 'apps/web/public/sandbox-probe.txt'))).toBe(false)
      expect(existsSync(join(again.path, 'apps/api/probe-services.ts'))).toBe(false)
      expect(await bucketKeys(again.bucket)).toEqual([])
      const sql = new SQL(again.databaseUrl)
      try {
        const [found] = await sql`select to_regclass('sandbox_probe') as t`
        expect(found.t).toBeNull()
      } finally {
        await sql.close()
      }
    },
    10 * MINUTES,
  )

  test(
    'rm removes the checkout, the database and the bucket',
    async () => {
      for (const role of ROLES) {
        const { path, database, bucket } = sandboxes[role]
        await removeSandbox(root, job, role)
        expect(existsSync(path)).toBe(false)
        expect(await databaseExists(database)).toBe(false)
        expect(await bucketKeys(bucket)).toBeNull()
      }
      expect(await git(repo, 'worktree', 'list')).not.toContain('/sandbox/')
    },
    2 * MINUTES,
  )
})
