// factory watch: tails every job's event log, annotates it against "who sees what", and pushes it
// to the page over server-sent events. A finished job replays from the same stream.
//
// The page shows everything: the build notes' commands, the user's answers, the sealed material's
// names. So the server answers only a request that carries the token it made at start, which it
// keeps in the main checkout's state folder (no agent reads there) and prints in the URL for the
// user. An agent that reaches the port gets nothing.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Annotator } from '../annotate.ts'
import type { FactoryEvent } from '../events.ts'
import { jobsDir, writeAtomic } from '../job.ts'
import { jobFrame } from './extras.ts'

type Tail = { offset: number; annotator: Annotator; job: string }

const encoder = new TextEncoder()
const frame = (type: string, data: unknown) =>
  encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)

function jobNumbers(root: string): number[] {
  const dir = jobsDir(root)
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => /^\d+$/.test(name))
        .map(Number)
        .toSorted((a, b) => a - b)
    : []
}

/** Sends what each job's log gained since the last poll, annotated in order. */
function poll(
  root: string,
  tails: Map<number, Tail>,
  only: number | null,
  send: (chunk: Uint8Array) => void,
) {
  const numbers = jobNumbers(root)
  // An abandoned job's folder is gone; if its issue starts again, its new log starts from zero.
  for (const number of tails.keys()) if (!numbers.includes(number)) tails.delete(number)
  for (const number of numbers) {
    if (only !== null && number !== only) continue
    const dir = join(jobsDir(root), String(number))
    let tail = tails.get(number)
    if (!tail) {
      tail = { offset: 0, annotator: new Annotator(), job: '' }
      tails.set(number, tail)
    }
    // job.json and the files its extras read change without the log moving, so the frame is
    // rebuilt each poll and sent when it differs from the last one.
    if (existsSync(join(dir, 'job.json'))) {
      try {
        const next = jobFrame(root, number)
        const body = JSON.stringify(next)
        if (body !== tail.job) {
          send(frame('job', next))
          tail.job = body
        }
      } catch {
        // job.json is halfway through a write: try again on the next poll.
      }
    }
    const log = join(dir, 'events.jsonl')
    if (!existsSync(log) || statSync(log).size <= tail.offset) continue
    const fresh = readFileSync(log).subarray(tail.offset)
    // Only whole lines: a hook may be halfway through appending one.
    const end = fresh.lastIndexOf(0x0a) + 1
    if (end === 0) continue
    tail.offset += end
    for (const line of fresh.subarray(0, end).toString('utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        send(frame('event', tail.annotator.push(JSON.parse(line) as FactoryEvent)))
      } catch {
        // A corrupt line is skipped.
      }
    }
  }
}

/** Where the running server keeps its token: the main checkout's state folder. */
export const watchTokenFile = (root: string) => join(jobsDir(root), 'watch-token')

/** A fresh token, written where only the user and the CLI read it. */
function newToken(root: string): string {
  const token = randomBytes(32).toString('hex')
  mkdirSync(jobsDir(root), { recursive: true })
  writeAtomic(watchTokenFile(root), `${token}\n`)
  chmodSync(watchTokenFile(root), 0o600)
  return token
}

/** Whether a request carries the token, in its query. */
function carries(request: Request, token: string): boolean {
  const given = Buffer.from(new URL(request.url).searchParams.get('token') ?? '')
  const wanted = Buffer.from(token)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

const refused = () =>
  new Response('factory watch: open the URL the command printed; it carries the token.\n', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })

/** Starts the live page's server; every route answers only a request with the token. */
export function serveWatch(root: string, port: number) {
  const token = newToken(root)
  // The page imports state.js and opens the stream with the token it was opened with.
  const page = readFileSync(join(import.meta.dir, 'page.html'), 'utf8').replace(
    "from '/state.js'",
    `from '/state.js?token=${token}'`,
  )
  // state.ts is shared with the tests, so the browser gets it as plain JavaScript, types erased.
  const state = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    readFileSync(join(import.meta.dir, 'state.ts'), 'utf8'),
  )
  const guarded =
    (route: (request: Request) => Response) =>
    (request: Request): Response =>
      carries(request, token) ? route(request) : refused()
  const server = Bun.serve({
    port,
    idleTimeout: 0,
    fetch: refused,
    routes: {
      '/': guarded(
        () => new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
      ),
      '/state.js': guarded(
        () =>
          new Response(state, {
            headers: {
              'Content-Type': 'text/javascript; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }),
      ),
      '/events': guarded((request) => {
        const job = new URL(request.url).searchParams.get('job')
        const only = job ? Number(job) : null
        const tails = new Map<number, Tail>()
        let timer: ReturnType<typeof setInterval> | undefined
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (chunk: Uint8Array) => controller.enqueue(chunk)
            poll(root, tails, only, send)
            send(frame('ready', { jobs: jobNumbers(root) }))
            let beats = 0
            timer = setInterval(() => {
              try {
                poll(root, tails, only, send)
                if (++beats % 40 === 0) send(encoder.encode(': keep-alive\n\n'))
              } catch {
                clearInterval(timer)
              }
            }, 400)
          },
          cancel() {
            clearInterval(timer)
          },
        })
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
          },
        })
      }),
    },
  })
  return { server, token, url: `${server.url}?token=${token}` }
}

export async function watch(root: string, port: number): Promise<void> {
  const { url } = serveWatch(root, port)
  console.log(`factory watch: ${url}`)
  await new Promise(() => {})
}
