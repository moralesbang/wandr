import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitAll, git, uncommitted, workingTree } from './shell.ts'

let dir = ''
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'factory-git-'))
  await git(dir, 'init', '--quiet')
  await git(dir, 'config', 'user.email', 'test@example.com')
  await git(dir, 'config', 'user.name', 'Test')
  await git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '--quiet', '-m', 'first')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('workingTree', () => {
  test('equals the HEAD tree when everything is committed', async () => {
    expect(await workingTree(dir)).toBe(await git(dir, 'rev-parse', 'HEAD^{tree}'))
  })

  test('differs from the HEAD tree when a file is modified', async () => {
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    expect(await workingTree(dir)).not.toBe(await git(dir, 'rev-parse', 'HEAD^{tree}'))
  })

  test('differs from the HEAD tree when a file is untracked', async () => {
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    expect(await workingTree(dir)).not.toBe(await git(dir, 'rev-parse', 'HEAD^{tree}'))
  })

  test('leaves the real index and the status untouched', async () => {
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    const before = await git(dir, 'status', '--porcelain=v1')
    await workingTree(dir)
    expect(await git(dir, 'status', '--porcelain=v1')).toBe(before)
    expect(before).toContain('?? new.txt')
  })
})

describe('uncommitted', () => {
  test('lists a modified tracked file by its full path', async () => {
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    expect(await uncommitted(dir)).toEqual(['a.txt'])
  })
})

// G7: a hook file an agent wrote into the checkout would run with the user's account when the CLI
// commits or pushes.
describe('the CLI’s own git runs no hooks', () => {
  test('a pre-commit hook does not run when the CLI commits', async () => {
    const marker = join(dir, 'hook-ran')
    const hook = join(dir, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\n`)
    chmodSync(hook, 0o755)
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    await commitAll(dir, 'second')
    expect(existsSync(marker)).toBe(false)
  })
})
