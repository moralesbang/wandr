import type { MiddlewareHandler } from 'hono'
import { redactPath } from './redact-path.ts'

// One line per request to stdout, where Railway keeps it. No query string,
// headers or body: nothing that could hold a cookie, a password or a note.
export const requestLogger = (): MiddlewareHandler => async (c, next) => {
  const start = performance.now()
  await next()
  const ms = Math.round(performance.now() - start)
  console.log(`${c.req.method} ${redactPath(c.req.path)} ${c.res.status} ${ms}ms`)
}
