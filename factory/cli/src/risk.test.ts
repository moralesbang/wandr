import { describe, expect, test } from 'bun:test'
import type { Risk } from './job.ts'
import { effectiveRisk } from './risk.ts'

describe('effectiveRisk', () => {
  test.each([
    // declared, changed paths, effective, raised by
    ['low', ['apps/web/src/styles.css', 'docs/04-flows.md'], 'low', []],
    ['low', [], 'low', []],
    ['low', ['packages/sharing/src/stretch.ts'], 'normal', ['packages/sharing/src/stretch.ts']],
    ['low', ['packages/contract/src/walk.ts'], 'normal', ['packages/contract/src/walk.ts']],
    ['low', ['apps/api/src/db/schema.ts'], 'normal', ['apps/api/src/db/schema.ts']],
    ['low', ['apps/api/src/routes/walks.ts'], 'normal', ['apps/api/src/routes/walks.ts']],
    ['low', ['apps/api/src/photos/strip.ts'], 'normal', ['apps/api/src/photos/strip.ts']],
    [
      'low',
      ['apps/api/src/http/cache-control.ts'],
      'normal',
      ['apps/api/src/http/cache-control.ts'],
    ],
    ['low', ['package.json'], 'normal', ['package.json']],
    ['low', ['apps/web/package.json'], 'normal', ['apps/web/package.json']],
    ['low', ['bun.lock'], 'normal', ['bun.lock']],
    ['low', ['apps/web/vite.config.ts'], 'normal', ['apps/web/vite.config.ts']],
    [
      'low',
      ['apps/web/src/a.css', 'bun.lock', 'packages/sharing/src/x.ts'],
      'normal',
      ['bun.lock', 'packages/sharing/src/x.ts'],
    ],
    ['low', ['apps/api/src/http/other.ts', 'apps/api/src/app.ts'], 'low', []],
    ['normal', ['apps/web/src/styles.css'], 'normal', []],
    ['normal', ['packages/sharing/src/stretch.ts'], 'normal', []],
    ['high', ['apps/web/src/styles.css'], 'high', []],
    ['high', ['bun.lock'], 'high', []],
  ] as [Risk, string[], Risk, string[]][])(
    'declared %s, diff %j: %s',
    (declared, changed, risk, raisedBy) => {
      expect(effectiveRisk(declared, changed)).toEqual({ risk, raisedBy })
    },
  )
})
