import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readEvents } from '../events.ts'
import { factoryFingerprint, fingerprintChanges } from '../freeze.ts'
import { guardJob, put, type GuardJob } from '../guard-fixture.ts'
import { loadJob, saveJob } from '../job.ts'
import { requireUnchangedFactory } from './common.ts'
import { refreeze } from './refreeze.ts'
import { start } from './start.ts'
import { withDocker } from '../job-fixture.ts'

let fixture: GuardJob | undefined
const job = (options: Parameters<typeof guardJob>[0] = {}) =>
  (fixture = guardJob({ sealed: false, ...options }))
afterEach(() => fixture?.cleanup())

const OTHER = 'someone-elses-session'

/** Lays out the files that define how a job runs in the fixture's main checkout. */
function factoryFiles(root: string) {
  put(join(root, 'factory', 'cli', 'src', 'main.ts'), 'main\n')
  put(join(root, '.claude', 'skills', 'factory', 'SKILL.md'), 'skill\n')
  put(join(root, '.claude', 'agents', 'factory-build.md'), 'agent\n')
  put(join(root, '.claude', 'settings.json'), '{}\n')
  put(join(root, 'package.json'), '{}\n')
  put(join(root, 'bun.lock'), '\n')
}

describe('FI-026: the factory is frozen in the main checkout while a job is active', () => {
  test.each([
    ['the CLI', 'factory/cli/src/main.ts'],
    ['the skill', '.claude/skills/factory/SKILL.md'],
    ['an agent', '.claude/agents/factory-build.md'],
    ['the hooks', '.claude/settings.json'],
    ['the root scripts', 'package.json'],
    ['the lockfile', 'bun.lock'],
  ])('a session of the repo that is bound to no job cannot write %s', (_what, path) => {
    const f = job()
    const reason = f.guard(
      null,
      'Write',
      { file_path: join(f.root, path), content: 'x' },
      f.root,
      OTHER,
    )
    expect(reason).toContain('job #7')
    expect(reason).toContain('Work in a worktree')
    expect(reason).toContain('opens its PR or is cleaned')
    expect(
      f.guard(
        null,
        'Edit',
        { file_path: join(f.root, path), old_string: 'a', new_string: 'b' },
        f.root,
        OTHER,
      ),
    ).toContain('job #7')
  })

  test.each([
    'echo x > factory/cli/src/main.ts',
    'sed -i "" s/a/b/ .claude/settings.json',
    'tee package.json',
    'cp /tmp/x .claude/agents/factory-build.md',
    'rm -rf factory/cli',
    'rm -rf .claude',
    'git checkout -- factory/cli/src/main.ts',
  ])('and not with Bash: %s', (command) => {
    const f = job()
    expect(f.bash(null, command, f.root)).toContain('job #7')
    expect(f.guard(null, 'Bash', { command }, f.root, OTHER)).toContain('job #7')
  })

  test.each([
    'git switch main',
    'git checkout main',
    'git checkout -b other',
    'git pull',
    'git merge origin/main',
    'git reset --hard origin/main',
    'git rebase main',
    'git stash',
    'git cherry-pick abc',
    'cd .claude && git -C .. pull',
  ])('and moves neither its HEAD nor its working tree: %s', (command) => {
    const f = job()
    expect(f.guard(null, 'Bash', { command }, f.root, OTHER)).toContain('main checkout')
  })

  test('a git command aimed at the main checkout from another folder is denied too', () => {
    const f = job()
    expect(
      f.guard(null, 'Bash', { command: `git -C ${f.root} pull` }, f.worktree, OTHER),
    ).toContain('main checkout')
  })

  test('the denial is logged in the active job', () => {
    const f = job()
    f.guard(null, 'Write', { file_path: join(f.root, 'package.json'), content: 'x' }, f.root, OTHER)
    const denied = readEvents(f.root, 7).filter((event) => event.kind === 'freeze.denied')
    expect(denied).toHaveLength(1)
    expect(denied[0]?.detail?.session).toBe(OTHER)
  })

  test('work in another worktree, reads, job state and ordinary files stay allowed', () => {
    const f = job()
    const other = join(f.root, '.claude', 'worktrees', 'other-work')
    mkdirSync(join(other, 'factory', 'cli'), { recursive: true })
    for (const [tool, input, cwd] of [
      ['Write', { file_path: join(other, 'factory', 'cli', 'a.ts'), content: 'x' }, other],
      ['Write', { file_path: join(f.root, 'README.md'), content: 'x' }, f.root],
      ['Read', { file_path: join(f.root, 'package.json') }, f.root],
      ['Bash', { command: 'git switch -c next' }, other],
      ['Bash', { command: 'git pull' }, other],
      ['Bash', { command: 'git status && git log -1' }, f.root],
      ['Bash', { command: 'git checkout -- README.md' }, f.root],
      ['Bash', { command: 'echo hi > /tmp/x' }, f.root],
    ] as const) {
      expect(f.guard(null, tool, input, cwd, OTHER)).toBeNull()
    }
  })

  test('a worktree outside the repo folder is free too, and so is a repo with no active job', () => {
    const f = job()
    expect(f.guard(null, 'Bash', { command: 'git pull' }, '/elsewhere/worktree', OTHER)).toBeNull()
    saveJob(f.root, { ...loadJob(f.root, 7)!, state: 'pr_open' })
    expect(
      f.guard(
        null,
        'Write',
        { file_path: join(f.root, 'package.json'), content: 'x' },
        f.root,
        OTHER,
      ),
    ).toBeNull()
    expect(f.bash(null, 'git pull', f.root)).toBeNull()
  })

  test('a blocked job freezes it as a building one does', () => {
    const f = job({ job: { state: 'blocked' } })
    expect(
      f.guard(
        null,
        'Write',
        { file_path: join(f.root, 'package.json'), content: 'x' },
        f.root,
        OTHER,
      ),
    ).toContain('job #7')
  })

  test('a session bound to no job is never denied for anything else, and a broken job.json does not lock it out', () => {
    const f = job()
    writeFileSync(join(f.state, 'job.json'), '{ not json')
    expect(f.guard(null, 'Bash', { command: 'ls' }, f.root, OTHER)).toBeNull()
    expect(f.guard(null, 'Write', { file_path: '/tmp/x', content: 'x' }, f.root, OTHER)).toBeNull()
  })
})

const fingerprinted = () => {
  const f = job()
  factoryFiles(f.root)
  saveJob(f.root, { ...loadJob(f.root, 7)!, factoryFingerprint: factoryFingerprint(f.root) })
  return f
}

describe('FI-027: a job is judged by the factory it started with', () => {
  test('the fingerprint is the content of the files that define how a job runs, uncommitted ones included', () => {
    const f = job()
    factoryFiles(f.root)
    put(join(f.root, 'factory', '.jobs', '7', 'state.txt'), 'not part of it')
    put(join(f.root, 'factory', 'cli', 'node_modules', 'dep', 'index.js'), 'installed')
    put(join(f.root, 'README.md'), 'docs')
    expect(Object.keys(factoryFingerprint(f.root))).toEqual([
      '.claude/agents/factory-build.md',
      '.claude/settings.json',
      '.claude/skills/factory/SKILL.md',
      'bun.lock',
      'factory/cli/src/main.ts',
      'package.json',
    ])
  })

  test('unchanged files let every call and every command through', () => {
    const f = fingerprinted()
    expect(f.bash(null, 'git status')).toBeNull()
    expect(() => requireUnchangedFactory(f.root, 7)).not.toThrow()
  })

  test.each([
    [
      'changed',
      (root: string) => put(join(root, 'factory', 'cli', 'src', 'main.ts'), 'edited\n'),
      'factory/cli/src/main.ts (changed)',
    ],
    [
      'added',
      (root: string) => put(join(root, 'factory', 'cli', 'src', 'new.ts'), 'new\n'),
      'factory/cli/src/new.ts (added)',
    ],
    ['removed', (root: string) => rmSync(join(root, 'bun.lock')), 'bun.lock (removed)'],
  ])('a file %s since the start stops the guard and the CLI, naming it', (_how, change, named) => {
    const f = fingerprinted()
    change(f.root)
    const reason = f.bash(null, 'git status')
    expect(reason).toContain(named)
    expect(reason).toContain('job #7')
    expect(
      f.guard({ agent_id: 'b1', agent_type: 'factory-build' }, 'Read', {
        file_path: join(f.worktree, 'apps/web/src/main.ts'),
      }),
    ).toContain(named)
    expect(() => requireUnchangedFactory(f.root, 7)).toThrow(named)
    expect(readEvents(f.root, 7).some((event) => event.kind === 'factory.changed')).toBe(true)
  })

  test('a job that is not active, or has no fingerprint, is not judged by it', () => {
    const f = fingerprinted()
    put(join(f.root, 'package.json'), '{"changed":true}\n')
    saveJob(f.root, { ...loadJob(f.root, 7)!, state: 'pr_open' })
    expect(() => requireUnchangedFactory(f.root, 7)).not.toThrow()
    saveJob(f.root, { ...loadJob(f.root, 7)!, state: 'building', factoryFingerprint: null })
    expect(() => requireUnchangedFactory(f.root, 7)).not.toThrow()
  })

  test('`start` records a fingerprint on a resumed job that has none, and refuses one that changed', async () => {
    const f = job()
    factoryFiles(f.root)
    await start(f.root, 7, 'session-2', withDocker)
    const recorded = loadJob(f.root, 7)!.factoryFingerprint
    expect(recorded).toEqual(factoryFingerprint(f.root))
    put(join(f.root, 'factory', 'cli', 'src', 'main.ts'), 'edited\n')
    await expect(start(f.root, 7, 'session-3', withDocker)).rejects.toThrow(
      'factory/cli/src/main.ts (changed)',
    )
  })

  test('only the user accepts a changed factory, and the job is then judged by the new files', () => {
    const f = fingerprinted()
    put(join(f.root, 'factory', 'cli', 'src', 'main.ts'), 'edited\n')
    expect(f.bash(null, 'bun run factory refreeze 7', f.root)).toContain('the user')
    const accepted = refreeze(f.root, 7)
    expect(accepted).toEqual(['factory/cli/src/main.ts (changed)'])
    expect(f.bash(null, 'git status')).toBeNull()
  })

  test('the differences between two fingerprints name each file and how it differs', () => {
    expect(fingerprintChanges({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })).toEqual([
      'b (changed)',
      'c (added)',
    ])
    expect(fingerprintChanges({ a: '1' }, {})).toEqual(['a (removed)'])
  })
})
