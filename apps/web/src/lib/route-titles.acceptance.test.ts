// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

// WEB-012: `bun run typecheck` rejects a route without `staticData.title`, the root route included.
// Each case type-checks the real app together with a small router, as the project's own check does.

const webRoot = join(import.meta.dirname, '..', '..')
const tsc = join(webRoot, 'node_modules', '.bin', 'tsc')

const UNTITLED = `import { createRootRouteWithContext, createRoute } from '@tanstack/react-router'
export const rootRoute = createRootRouteWithContext<{ name: string }>()({})
export const pageRoute = createRoute({ getParentRoute: () => rootRoute, path: '/page' })
`

const TITLED = `import { createRootRouteWithContext, createRoute } from '@tanstack/react-router'
export const rootRoute = createRootRouteWithContext<{ name: string }>()({ staticData: { title: 'Root' } })
export const pageRoute = createRoute({ getParentRoute: () => rootRoute, path: '/page', staticData: { title: 'Page' } })
`

const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

// The lines of the router file that tsc reports an error on.
function errorLines(source: string): number[] {
  const folder = mkdtempSync(join(webRoot, '.typecheck-fixture-'))
  folders.push(folder)
  writeFileSync(join(folder, 'router.ts'), source)
  writeFileSync(
    join(folder, 'check.json'),
    JSON.stringify({ extends: '../tsconfig.json', include: ['../src', './router.ts'] }),
  )
  const result = spawnSync(tsc, ['-p', join(folder, 'check.json'), '--pretty', 'false'], {
    encoding: 'utf8',
  })
  const output = `${result.stdout}${result.stderr}`
  return [...output.matchAll(/router\.ts\((\d+),\d+\): error/g)].map((m) => Number(m[1]))
}

describe('a route without a title', () => {
  test('is a type error for the root route and a page route, and a title is all it takes to pass', () => {
    // The titled routes are the control: the errors come from the missing title, not the fixture.
    expect({ untitled: errorLines(UNTITLED), titled: errorLines(TITLED) }).toEqual({
      untitled: [2, 3],
      titled: [],
    })
  })
})
