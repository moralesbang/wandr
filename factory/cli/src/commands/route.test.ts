import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { handoffDir, Job, loadJob, saveJob, stateDir } from '../job.ts'
import type { RoutingProposal } from '../routing.ts'
import { git } from '../shell.ts'
import { Refusal } from './common.ts'
import { refreshRouting, requireRouted, route } from './route.ts'

let root = ''
let tree = ''
let file = ''
const proposal = (changes: Partial<RoutingProposal> = {}): RoutingProposal => ({
  scope: 'frontend',
  complexity: 'small',
  evidence: ['The issue changes a spacing token.'],
  expectedPaths: ['apps/web/src/styles.css'],
  behaviorChange: false,
  uncertainty: [],
  verification: ['Run CI; inspect both themes.'],
  ...changes,
})
const write = (path: string, value: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}
const propose = (changes: Partial<RoutingProposal> = {}) =>
  writeFileSync(file, JSON.stringify(proposal(changes)))

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-route-'))
  tree = join(root, 'tree')
  file = join(root, 'proposal.json')
  mkdirSync(tree)
  await git(tree, 'init', '--quiet')
  await git(tree, 'config', 'user.email', 'test@example.com')
  await git(tree, 'config', 'user.name', 'Test')
  await git(tree, 'config', 'commit.gpgsign', 'false')
  write(join(tree, '.gitignore'), 'factory/.jobs/\n')
  write(join(tree, 'apps/web/src/styles.css'), ':root { --spacing: 4px; }\n')
  await git(tree, 'add', '-A')
  await git(tree, 'commit', '--quiet', '-m', 'base')
  saveJob(
    root,
    makeJob({
      worktree: tree,
      base: await git(tree, 'rev-parse', 'HEAD'),
      risk: 'low',
      routingRequired: true,
    }),
  )
  propose()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('factory route', () => {
  test('legacy state loads without routing; new state cannot execute before classification', () => {
    const {
      routingRequired: _required,
      routing: _route,
      routingHistory: _history,
      routingRevision: _revision,
      ...legacy
    } = makeJob()
    const loaded = Job.parse(legacy)
    expect(loaded.routingRequired).toBe(false)
    expect(loaded.routing).toBeNull()
    expect(() => requireRouted(loaded, 'a build')).not.toThrow()
    expect(() => requireRouted(loadJob(root, 7)!, 'a build')).toThrow('needs classification')
  })

  test('persists and audits a plan outside the handoff, and invalidates earlier checks', async () => {
    const job = await route(root, 7, file)
    expect(job.routing?.workflow).toBe('light')
    expect(job.routingRevision).toBe(1)
    expect(job.routingHistory).toHaveLength(1)
    expect(job.gate).toBeNull()
    expect(job.lastCheck).toBeNull()
    expect(loadJob(root, 7)?.routing).toEqual(job.routing)
    expect(readFileSync(join(stateDir(root, 7), 'events.jsonl'), 'utf8')).toContain(
      'routing.planned',
    )
    expect(() => requireRouted(job, 'a build')).not.toThrow()
    expect((await route(root, 7, file)).routingRevision).toBe(1)
  })

  test('blocks research execution, allows evidence gathering, requires report to reclassify', async () => {
    propose({ complexity: 'uncertain', uncertainty: ['Which spacing token applies?'] })
    const research = await route(root, 7, file)
    expect(() => requireRouted(research, 'a build')).toThrow('research-only')
    expect(() => requireRouted(research, 'research', { allowResearch: true })).not.toThrow()
    propose()
    await expect(route(root, 7, file)).rejects.toThrow('research.md')
    write(
      join(handoffDir(research), 'research.md'),
      'The approved design uses the spacing token.\n',
    )
    const confirmed = await route(root, 7, file)
    expect(confirmed.routing?.workflow).toBe('light')
    expect(confirmed.routingHistory).toHaveLength(2)
  })

  test('research reclassification keeps an already-established high risk floor', async () => {
    propose({ expectedPaths: ['apps/api/src/db/schema.ts'], complexity: 'uncertain' })
    const research = await route(root, 7, file)
    write(join(handoffDir(research), 'research.md'), 'Persistence will stay untouched.\n')
    propose()
    expect((await route(root, 7, file)).routing?.workflow).toBe('reinforced')
  })

  test('cannot replace a confirmed route with a cheaper proposal', async () => {
    propose({ behaviorChange: true })
    await route(root, 7, file)
    propose()
    await expect(route(root, 7, file)).rejects.toThrow('confirmed route cannot be replaced')
  })

  test('a corrected scope remains idempotent when the same proposal is submitted again', async () => {
    propose({ expectedPaths: ['apps/api/src/routes/walks.ts'] })
    const first = await route(root, 7, file)
    expect(first.routing?.scope).toBe('backend')
    expect((await route(root, 7, file)).routingRevision).toBe(first.routingRevision)
  })

  test('cannot reclassify blocked or already executing jobs', async () => {
    const job = loadJob(root, 7)!
    saveJob(root, { ...job, state: 'blocked' })
    await expect(route(root, 7, file)).rejects.toThrow('blocked')
    saveJob(root, { ...job, attempts: 1 })
    await expect(route(root, 7, file)).rejects.toThrow('Execution already started')
  })

  test('invalid proposals never persist an execution plan', async () => {
    writeFileSync(file, JSON.stringify({ ...proposal(), workflow: 'light' }))
    await expect(route(root, 7, file)).rejects.toBeInstanceOf(Refusal)
    expect(loadJob(root, 7)?.routing).toBeNull()
  })
})

describe('refreshRouting', () => {
  test('research needs no implementation worktree to reject execution', async () => {
    propose({ complexity: 'uncertain' })
    const job = await route(root, 7, file)
    rmSync(tree, { recursive: true, force: true })
    const refreshed = await refreshRouting(root, 7)
    expect(refreshed.routingRevision).toBe(job.routingRevision)
    expect(() => requireRouted(refreshed, 'implementation')).toThrow('research-only')
  })

  test('blocked jobs cannot change routing state', async () => {
    const job = await route(root, 7, file)
    saveJob(root, { ...job, state: 'blocked' })
    write(join(tree, 'apps/api/src/db/schema.ts'), 'export const schema = 2\n')
    await expect(refreshRouting(root, 7)).rejects.toThrow('blocked')
    expect(loadJob(root, 7)?.routingRevision).toBe(job.routingRevision)
  })

  test('sealed jobs keep their plan until reviewers finish, while unchanged launches can proceed', async () => {
    const job = await route(root, 7, file)
    write(
      join(stateDir(root, 7), 'seal.json'),
      JSON.stringify({
        pass: 1,
        roles: ['test-reviewer'],
        files: [],
        at: new Date().toISOString(),
      }),
    )
    expect((await refreshRouting(root, 7)).routingRevision).toBe(job.routingRevision)
    write(join(tree, 'apps/api/src/db/schema.ts'), 'export const schema = 2\n')
    await expect(refreshRouting(root, 7)).rejects.toThrow('sealed')
    expect(loadJob(root, 7)?.routingRevision).toBe(job.routingRevision)
  })
  test.each(['untracked', 'unstaged', 'staged', 'committed'])(
    'detects %s sensitive work and keeps escalation after revert',
    async (state) => {
      if (state !== 'untracked') {
        write(join(tree, 'apps/api/src/db/schema.ts'), 'export const schema = 1\n')
        await git(tree, 'add', '-A')
        await git(tree, 'commit', '--quiet', '-m', 'initial schema')
        saveJob(root, { ...loadJob(root, 7)!, base: await git(tree, 'rev-parse', 'HEAD') })
      }
      const first = await route(root, 7, file)
      write(join(tree, 'apps/api/src/db/schema.ts'), 'export const schema = 2\n')
      if (state === 'staged' || state === 'committed') await git(tree, 'add', '-A')
      if (state === 'committed') await git(tree, 'commit', '--quiet', '-m', 'change schema')
      const changed = await refreshRouting(root, 7)
      expect(changed.routing?.workflow).toBe('reinforced')
      expect(changed.routing?.risk).toBe('high')
      expect(changed.routing?.scope).toBe('fullstack')
      expect(changed.routingRevision).toBe(first.routingRevision + 1)
      expect(changed.routingHistory).toHaveLength(2)
      expect((await refreshRouting(root, 7)).routingRevision).toBe(changed.routingRevision)
      rmSync(join(tree, 'apps/api/src/db/schema.ts'))
      expect((await refreshRouting(root, 7)).routing?.risk).toBe('high')
    },
  )

  test('does not treat the handoff files as product scope', async () => {
    const job = await route(root, 7, file)
    write(join(handoffDir(job), 'build-notes.md'), 'Build notes.\n')
    expect((await refreshRouting(root, 7)).routingRevision).toBe(job.routingRevision)
  })

  test('does not route legacy jobs by accident', async () => {
    const job = loadJob(root, 7)!
    saveJob(root, { ...job, routingRequired: false })
    write(join(tree, 'apps/api/src/db/schema.ts'), 'export const schema = 2\n')
    expect((await refreshRouting(root, 7)).routing).toBeNull()
  })
})
