import { expect, test } from 'bun:test'
import { cacheControlFor } from './cache-control.ts'

test.each([
  ['a shared page', '/s/abc123', 'no-store'],
  ['a shared page, upper case', '/S/abc123', 'no-store'],
  ['the shared API', '/api/shared/abc123', 'no-store'],
  ['a shared photo', '/api/shared/abc123/finds/0/photo', 'no-store'],
  ['a journal route', '/api/walks', 'no-store'],
  ['a hashed asset', '/assets/index-3f2a.js', 'public, max-age=31536000, immutable'],
  ['index.html', '/', 'no-cache'],
  ['a SPA path', '/walks/7f1c', 'no-cache'],
  ['the manifest', '/manifest.webmanifest', 'no-cache'],
])('%s (%s): %s', (_case, path, header) => {
  expect(cacheControlFor(path)).toBe(header)
})
