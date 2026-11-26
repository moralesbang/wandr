// factory watch: tails every job's event log, annotates it against "who sees what", and pushes it
// to the page over server-sent events. A finished job replays from the same stream.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Annotator } from '../annotate.ts'
import type { FactoryEvent } from '../events.ts'
import { jobsDir, loadJob } from '../job.ts'

type Tail = { offset: number; annotator: Annotator; jobMtime: number }

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
      tail = { offset: 0, annotator: new Annotator(), jobMtime: 0 }
      tails.set(number, tail)
    }
    const jobFile = join(dir, 'job.json')
    if (existsSync(jobFile)) {
      const mtime = statSync(jobFile).mtimeMs
      if (mtime !== tail.jobMtime) {
        try {
          send(frame('job', loadJob(root, number)))
          tail.jobMtime = mtime
        } catch {
          // job.json is halfway through a write: try again on the next poll.
        }
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

export async function watch(root: string, port: number): Promise<void> {
  const page = readFileSync(join(import.meta.dir, 'page.html'), 'utf8')
  const server = Bun.serve({
    port,
    idleTimeout: 0,
    routes: {
      '/': new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
      '/events': (request) => {
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
      },
    },
  })
  console.log(`factory watch: ${server.url}`)
  await new Promise(() => {})
}
