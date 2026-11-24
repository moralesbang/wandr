import { expect, test } from 'bun:test'
import { redactPath } from './redact-path.ts'

test.each([
  ['a shared page', '/s/abc123', '/s/[redacted]'],
  ['a shared page with a trailing slash', '/s/abc123/', '/s/[redacted]/'],
  ['the shared API', '/api/shared/abc123', '/api/shared/[redacted]'],
  ['a shared photo', '/api/shared/abc123/finds/0/photo', '/api/shared/[redacted]/finds/0/photo'],
  ['an upper-case path', '/S/abc123', '/S/[redacted]'],
  ['repeated slashes', '//s//abc123', '//s//[redacted]'],
  ['a journal path', '/api/walks/7f1c', '/api/walks/7f1c'],
  ['a path that only starts like one', '/settings/abc', '/settings/abc'],
  ['the SPA root', '/', '/'],
])('%s: %s logs as %s', (_case, path, logged) => {
  expect(redactPath(path)).toBe(logged)
})
