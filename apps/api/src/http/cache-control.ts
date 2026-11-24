import type { MiddlewareHandler } from 'hono'

// Every Cache-Control header the app sends is decided here (docs/05-architecture.md §2).
export const cacheControlFor = (path: string): string => {
  // Shared pages and their API: a revoked link must not live in any cache (API-008).
  if (/^\/+(s|api\/+shared)(\/|$)/i.test(path)) return 'no-store'
  if (/^\/+api(\/|$)/i.test(path)) return 'no-store'
  // Vite's hashed build output never changes under the same name.
  if (path.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  // index.html and the files beside it are revalidated on every load.
  return 'no-cache'
}

export const cacheControl = (): MiddlewareHandler => async (c, next) => {
  await next()
  c.header('Cache-Control', cacheControlFor(c.req.path))
}
