import type { Env, Hono } from 'hono'
import { serveStatic } from 'hono/bun'

// The SPA's built files from the same origin as the API; every other path
// gets index.html and the SPA's router takes it from there.
export const mountSpa = <E extends Env>(app: Hono<E>, root: string) => {
  app.use('*', serveStatic({ root }))
  app.get('*', serveStatic({ root, path: 'index.html' }))
}
