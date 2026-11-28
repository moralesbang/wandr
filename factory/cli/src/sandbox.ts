// A reviewer's sandbox: a disposable checkout of the job's HEAD with its own port, database and
// bucket, so two reviewers can mutate code, build and run tests at once without seeing each other's
// work. Job #13's reviewers shared port 3100, apps/web/dist and the test database, and the evaluator
// read the test reviewer's mutated manifest as if it were the build.
//
// The checkout lives in the job's folder, <worktree>/factory/.jobs/<n>/sandbox/<role>/, because
// Claude Code refuses an agent's Write or Edit outside the worktree; factory/.jobs/ is gitignored.
// Its record (port, database, bucket) is job state, in the main checkout, written only by the CLI.

import { SQL, S3Client } from 'bun'
import { createHash, createHmac } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Refusal } from './commands/common.ts'
import { handoffDir, jobsDir, stateDir, type Job } from './job.ts'
import { checkRole, isSandboxRole, sandboxNames } from './sandbox-names.ts'
import { git, runLogged } from './shell.ts'

export type Sandbox = {
  role: string
  /** The checkout, inside the job's folder in its worktree. */
  path: string
  port: number
  database: string
  bucket: string
  databaseUrl: string
  createdAt: string
}

export { sandboxNames }

const sandboxesDir = (job: Pick<Job, 'number' | 'worktree'>) => join(handoffDir(job), 'sandbox')
const recordsDir = (root: string, number: number) => join(stateDir(root, number), 'sandbox')
const recordPath = (root: string, number: number, role: string) =>
  join(recordsDir(root, number), `${role}.json`)
const logPath = (root: string, number: number, role: string) =>
  join(recordsDir(root, number), `${role}.log`)

export function loadSandbox(root: string, number: number, role: string): Sandbox | null {
  checkRole(role)
  const path = recordPath(root, number, role)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Sandbox) : null
}

/**
 * What a command in the sandbox runs with. The API reads PORT, DATABASE_URL and S3_BUCKET, and
 * Bun lets the process environment win over --env-file and .env.test; Playwright reads E2E_PORT.
 */
export const sandboxEnv = (sandbox: Sandbox): Record<string, string> => ({
  PORT: String(sandbox.port),
  E2E_PORT: String(sandbox.port),
  DATABASE_URL: sandbox.databaseUrl,
  S3_BUCKET: sandbox.bucket,
})

/** Sets keys in a dotenv file's text, in place when present, appended when not. */
export function withOverrides(text: string, overrides: Record<string, string>): string {
  const left = new Map(Object.entries(overrides))
  const lines = text.replace(/\n$/, '').split('\n')
  const updated = lines.map((line) => {
    const key = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1]
    if (!key || !left.has(key)) return line
    const value = left.get(key)
    left.delete(key)
    return `${key}=${value}`
  })
  return `${[...updated, ...[...left].map(([key, value]) => `${key}=${value}`)].join('\n')}\n`
}

const parseDotenv = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((line) => /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim()))
      .filter((match) => match !== null)
      .map((match) => [match[1] as string, match[2] as string]),
  )

/**
 * Runs `argv` in the sandbox's checkout with its environment, its output on this process's. No
 * shell stands in between: each argument reaches the program exactly as given.
 */
export async function runInSandbox(
  sandbox: Sandbox,
  argv: string[],
  timeoutMs?: number,
): Promise<number> {
  const child = Bun.spawn(argv, {
    cwd: sandbox.path,
    env: { ...process.env, ...sandboxEnv(sandbox) },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  // A command that outlives the time left in the reviewer's budget is killed there.
  let timedOut = false
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, timeoutMs)
  try {
    const code = await child.exited
    if (timedOut && timeoutMs !== undefined) {
      console.error(
        `factory sandbox exec: killed after ${Math.round(timeoutMs / 1000)}s, the time left in the sandbox budget.`,
      )
      return 124
    }
    return code
  } finally {
    clearTimeout(timer)
  }
}

/** The shared services, as the job's own test settings reach them. */
type Services = {
  databaseUrl: string
  s3: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string }
}

function servicesOf(worktree: string): Services {
  const env = parseDotenv(readFileSync(join(worktree, 'apps', 'api', '.env.test'), 'utf8'))
  const need = (key: string) => {
    const value = env[key]
    if (!value) throw new Refusal(`apps/api/.env.test in ${worktree} has no ${key}.`)
    return value
  }
  return {
    databaseUrl: need('DATABASE_URL'),
    s3: {
      endpoint: need('S3_ENDPOINT'),
      region: need('S3_REGION'),
      accessKeyId: need('S3_ACCESS_KEY_ID'),
      secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    },
  }
}

const withDatabase = (url: string, database: string) => {
  const next = new URL(url)
  next.pathname = `/${database}`
  return next.toString()
}

/** Runs one statement on the shared Postgres, through the main checks' own database. */
async function admin(services: Services, statement: string) {
  const sql = new SQL(services.databaseUrl)
  try {
    await sql.unsafe(statement)
  } finally {
    await sql.close()
  }
}

// The name comes from sandboxNames, letters, digits and underscores only, so quoting it is safe.
const dropDatabase = (services: Services, database: string) =>
  admin(services, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
// template0, because CREATE DATABASE refuses a template another session is connected to, and two
// sandboxes are created at once.
const createDatabase = (services: Services, database: string) =>
  admin(services, `CREATE DATABASE "${database}" TEMPLATE template0`)

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()

/**
 * Creates or deletes a bucket. Bun's S3 client handles objects but not buckets, so this signs the
 * request itself (AWS Signature Version 4, path-style, empty payload).
 */
async function bucketRequest(s3: Services['s3'], method: 'PUT' | 'DELETE', bucket: string) {
  const url = new URL(`/${bucket}`, s3.endpoint)
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const day = now.slice(0, 8)
  const payload = sha256('')
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payload,
    'x-amz-date': now,
  }
  const names = Object.keys(headers).toSorted()
  const signed = names.join(';')
  const canonical = [
    method,
    url.pathname,
    '',
    names.map((name) => `${name}:${headers[name]}\n`).join(''),
    signed,
    payload,
  ].join('\n')
  const scope = `${day}/${s3.region}/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', now, scope, sha256(canonical)].join('\n')
  const key = ['s3', 'aws4_request'].reduce(
    (k, part) => hmac(k, part),
    hmac(hmac(`AWS4${s3.secretAccessKey}`, day), s3.region),
  )
  const signature = createHmac('sha256', key).update(toSign).digest('hex')
  const response = await fetch(url, {
    method,
    headers: {
      'x-amz-content-sha256': payload,
      'x-amz-date': now,
      authorization: `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    },
  })
  return { status: response.status, body: await response.text() }
}

async function createBucket(services: Services, bucket: string) {
  const { status, body } = await bucketRequest(services.s3, 'PUT', bucket)
  if (status !== 200) throw new Error(`Creating bucket ${bucket} failed (${status}): ${body}`)
}

/** Empties the bucket, since S3 deletes only an empty one, then deletes it. Gone is fine. */
async function dropBucket(services: Services, bucket: string) {
  const client = new S3Client({ ...services.s3, bucket })
  for (;;) {
    let listed
    try {
      listed = await client.list({ maxKeys: 1000 })
    } catch (error) {
      if (String(error).includes('NoSuchBucket') || String(error).includes('does not exist')) return
      throw error
    }
    const keys = (listed.contents ?? []).map((object) => object.key)
    if (!keys.length) break
    await Promise.all(keys.map((key) => client.delete(key)))
  }
  const { status, body } = await bucketRequest(services.s3, 'DELETE', bucket)
  if (status !== 204 && status !== 200 && status !== 404) {
    throw new Error(`Deleting bucket ${bucket} failed (${status}): ${body}`)
  }
}

/** The ports every recorded sandbox holds, any job's: free now, but theirs once they serve. */
export function recordedPorts(root: string): Set<number> {
  const ports = new Set<number>()
  const dir = jobsDir(root)
  if (!existsSync(dir)) return ports
  for (const job of readdirSync(dir).filter((name) => /^\d+$/.test(name))) {
    const records = recordsDir(root, Number(job))
    if (!existsSync(records)) continue
    for (const file of readdirSync(records).filter((name) => name.endsWith('.json'))) {
      try {
        const { port } = JSON.parse(readFileSync(join(records, file), 'utf8')) as Partial<Sandbox>
        if (typeof port === 'number') ports.add(port)
      } catch {
        // A record cut short: its port is unknown, and the OS check below still holds.
      }
    }
  }
  return ports
}

/** A port nothing listens on now; the OS hands out ephemeral ports, never Playwright's 3100. */
function unusedPort(): number | undefined {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port
  void server.stop(true)
  return port
}

/**
 * A port nothing listens on now and no other sandbox holds: a sandbox's port sits free between
 * its runs, and the OS would hand it out again.
 */
export function freePort(taken: ReadonlySet<number>, pick = unusedPort): number {
  for (let tries = 0; tries < 100; tries++) {
    const port = pick()
    if (port !== undefined && !taken.has(port)) return port
  }
  throw new Error('No free port that no sandbox holds.')
}

/**
 * Makes a fresh sandbox for `role`: removes any earlier one, checks out the job's HEAD, installs,
 * writes the checkout's env files, and creates and migrates its database and its bucket.
 */
export async function createSandbox(root: string, job: Job, role: string): Promise<Sandbox> {
  const { database, bucket } = sandboxNames(job.number, role)
  await removeSandbox(root, job, role)

  const path = join(sandboxesDir(job), role)
  const log = logPath(root, job.number, role)
  mkdirSync(recordsDir(root, job.number), { recursive: true })
  writeFileSync(log, '')
  await git(job.worktree, 'worktree', 'add', '--quiet', '--detach', path, 'HEAD')

  const services = servicesOf(job.worktree)
  const sandbox: Sandbox = {
    role,
    path,
    port: freePort(recordedPorts(root)),
    database,
    bucket,
    databaseUrl: withDatabase(services.databaseUrl, database),
    createdAt: new Date().toISOString(),
  }
  // Recorded before anything else is created, so a failure halfway still leaves rm what to remove.
  writeFileSync(recordPath(root, job.number, role), `${JSON.stringify(sandbox, null, 2)}\n`)

  // The environment reaches commands run through `factory sandbox exec`, but turbo hands a task
  // only the variables turbo.json declares. The checkout's own env files carry the same values, so
  // a server started any other way still lands on the sandbox's database and bucket.
  const overrides = {
    PORT: String(sandbox.port),
    DATABASE_URL: sandbox.databaseUrl,
    S3_BUCKET: bucket,
  }
  const api = join(path, 'apps', 'api')
  const envTest = join(api, '.env.test')
  writeFileSync(envTest, withOverrides(readFileSync(envTest, 'utf8'), overrides))
  // Hidden from git, so a reviewer's diff shows its mutations and nothing of the sandbox's own.
  await git(path, 'update-index', '--skip-worktree', 'apps/api/.env.test')
  const localEnv = join(job.worktree, 'apps', 'api', '.env')
  if (existsSync(localEnv)) {
    copyFileSync(localEnv, join(api, '.env'))
    writeFileSync(
      join(api, '.env'),
      withOverrides(readFileSync(join(api, '.env'), 'utf8'), overrides),
    )
  }

  const env = sandboxEnv(sandbox)
  if ((await runLogged(['bun', 'install', '--frozen-lockfile'], path, log, env)) !== 0) {
    throw new Refusal(`bun install failed in ${path}; see ${log}`)
  }
  await createDatabase(services, database)
  if (
    (await runLogged(['bun', 'run', '--cwd', 'apps/api', 'db:migrate:test'], path, log, env)) !== 0
  ) {
    throw new Refusal(`Migrating ${database} failed; see ${log}`)
  }
  await createBucket(services, bucket)
  return sandbox
}

/** The checkout whose apps/api/.env.test reaches the shared services: the job's, or the main one. */
const servicesCheckout = (root: string, job: Job) =>
  [job.worktree, root].find((dir) => existsSync(join(dir, 'apps', 'api', '.env.test'))) ?? null

/**
 * Removes the checkout, drops the database and the bucket. Each step tolerates what is gone. The
 * record goes last, once the database and the bucket are gone: until then it says what is left,
 * so `sandbox rm` can be rerun.
 */
export async function removeSandbox(root: string, job: Job, role: string): Promise<string[]> {
  const { database, bucket } = sandboxNames(job.number, role)
  const path = join(sandboxesDir(job), role)
  const done: string[] = []
  if (existsSync(path)) {
    await git(job.worktree, 'worktree', 'remove', '--force', path).catch(() => '')
    rmSync(path, { recursive: true, force: true })
    done.push(`Removed the sandbox checkout ${path}.`)
  }
  if (existsSync(job.worktree)) await git(job.worktree, 'worktree', 'prune')
  // The services may be down when a job is cleaned; the names are known, so rm can be rerun.
  const checkout = servicesCheckout(root, job)
  if (!checkout) {
    throw new Refusal(
      `Neither ${job.worktree} nor ${root} has apps/api/.env.test, so ${database} and ${bucket} can't be reached to drop. The record stays in ${recordPath(root, job.number, role)}; rerun factory sandbox rm ${job.number} ${role} once one exists.`,
    )
  }
  const services = servicesOf(checkout)
  await dropDatabase(services, database)
  await dropBucket(services, bucket)
  done.push(`Dropped the database ${database} and the bucket ${bucket}.`)
  rmSync(recordPath(root, job.number, role), { force: true })
  rmSync(logPath(root, job.number, role), { force: true })
  return done
}

/** Every role with a sandbox: a recorded one or a checkout on disk. */
function sandboxRoles(root: string, job: Job): string[] {
  const records = existsSync(recordsDir(root, job.number))
    ? readdirSync(recordsDir(root, job.number))
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -'.json'.length))
    : []
  const checkouts = existsSync(sandboxesDir(job)) ? readdirSync(sandboxesDir(job)) : []
  return [...new Set([...records, ...checkouts])].filter(isSandboxRole).toSorted()
}

/** Removes every sandbox of a job: what `clean` and `clean --abandon` call first. */
export async function removeSandboxes(root: string, job: Job): Promise<string[]> {
  const done: string[] = []
  for (const role of sandboxRoles(root, job)) done.push(...(await removeSandbox(root, job, role)))
  return done
}
