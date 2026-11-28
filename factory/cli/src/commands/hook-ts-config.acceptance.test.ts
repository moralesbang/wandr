// A TypeScript config is protected by what it is, not by its name (FI-005): job #15's test agent
// was denied `.typecheck-fixture-manual/tsconfig.json`, then wrote the same content as `check.json`
// and ran `tsc -p …/check.json`, which the guard allowed.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BUILD, guardJob, TEST, type GuardJob } from '../guard-fixture.ts'

let j: GuardJob
afterEach(() => j.cleanup())

const CONFIG = '{"extends":"../tsconfig.json","include":["../src","./router.ts"]}'

describe('FI-005: a TypeScript config is one whatever its name', () => {
  test.each([TEST, BUILD])('job 15 replay: $agent_type writes check.json', (who) => {
    j = guardJob({ sealed: false })
    const dir = join(j.worktree, 'apps/web/.typecheck-fixture-manual')
    expect(
      j.guard(who, 'Write', { file_path: join(dir, 'check.json'), content: CONFIG }),
    ).toContain('protected (TypeScript)')
  })

  test.each([
    ['compilerOptions', '{"compilerOptions":{"strict":true}}'],
    ['an extends naming a tsconfig', '{"extends":"@wandr/tsconfig/web.json"}'],
  ])('an Edit and a MultiEdit with %s are denied', (_name, text) => {
    j = guardJob({ sealed: false })
    const file_path = join(j.worktree, 'apps/web/check.json')
    expect(j.guard(TEST, 'Edit', { file_path, old_string: 'a', new_string: text })).toContain(
      'protected (TypeScript)',
    )
    expect(
      j.guard(TEST, 'MultiEdit', { file_path, edits: [{ old_string: 'a', new_string: text }] }),
    ).toContain('protected (TypeScript)')
  })

  test('job 15 replay: the Bash command that writes check.json and runs tsc -p is denied', () => {
    j = guardJob({ sealed: false })
    const web = join(j.worktree, 'apps/web')
    const command = `cd ${web} && mkdir .typecheck-fixture-manual && echo '${CONFIG}' > .typecheck-fixture-manual/check.json\nnode_modules/.bin/tsc -p .typecheck-fixture-manual/check.json --pretty false | head; rm -rf .typecheck-fixture-manual`
    expect(j.bash(TEST, command, j.worktree)).toContain('TypeScript')
  })

  test('a heredoc into a json file with compilerOptions is denied', () => {
    j = guardJob({ sealed: false })
    const command = `cat > apps/web/check.json <<'EOF'\n{"compilerOptions":{"strict":true}}\nEOF`
    expect(j.bash(BUILD, command)).toContain('protected (TypeScript)')
  })

  test.each([
    'tsc -p apps/web/check.json',
    'node_modules/.bin/tsc --project apps/web/check.json --noEmit',
    'bunx tsc -p apps/web/check.json',
    'npx tsc --project=apps/web/check.json',
    'bun x tsc -p apps/web/check.json',
    'bunx tsc -p apps/web/check',
    'tsc -p apps/web/check.jsonc',
  ])('%s is denied to the test and build agents', (command) => {
    j = guardJob({ sealed: false })
    for (const who of [TEST, BUILD])
      expect(j.bash(who, command)).toContain('TypeScript project must be a protected tsconfig')
  })

  test.each([
    'tsc -p . --noEmit',
    'bunx tsc -p apps/web --noEmit',
    'tsc --project apps/web/tsconfig.json',
    'npx tsc -p apps/web/tsconfig.app.json',
    'tsc --noEmit',
  ])('%s stays allowed', (command) => {
    j = guardJob({ sealed: false })
    mkdirSync(join(j.worktree, 'apps/web'), { recursive: true })
    expect(j.bash(TEST, command)).toBeNull()
  })

  test('control: a json file with plain content stays allowed', () => {
    j = guardJob({ sealed: false })
    const file_path = join(j.worktree, 'apps/web/src/data.json')
    expect(j.guard(TEST, 'Write', { file_path, content: '{"name":"a","extends":"b"}' })).toBeNull()
    expect(j.guard(BUILD, 'Write', { file_path, content: '{"scripts":{"a":"b"}}' })).toBeNull()
    expect(j.bash(TEST, `echo '{"a":1}' > apps/web/src/data.json`)).toBeNull()
  })
})
