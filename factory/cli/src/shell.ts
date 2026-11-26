// git and gh, through Bun.$. Every call throws on a non-zero exit unless it says otherwise.

import { $ } from 'bun'
import { copyFileSync, existsSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await $`git -C ${cwd} ${args}`.quiet().text()).trim()
}

export async function gh(...args: string[]): Promise<string> {
  return (await $`gh ${args}`.quiet().text()).trim()
}

export const lines = (output: string) => output.split('\n').filter(Boolean)

/**
 * The tree object of the worktree's files as they are now, committed or not, built in a throwaway
 * index so the real one is untouched. Equal to HEAD's tree exactly when everything is committed.
 */
export async function workingTree(worktree: string): Promise<string> {
  const index = resolve(worktree, await git(worktree, 'rev-parse', '--git-path', 'index'))
  const scratch = join(tmpdir(), `factory-index-${process.pid}-${crypto.randomUUID()}`)
  if (existsSync(index)) {
    copyFileSync(index, scratch)
    // Racy git: an entry whose mtime is not older than the index file is re-hashed instead of
    // trusted. The copy is newer than every entry, so a same-size edit made in the same clock tick
    // as the last `git add` would look unchanged. A 1970 mtime makes every entry racy (0 would mean "no timestamp").
    utimesSync(scratch, 1, 1)
  }
  try {
    const env = { ...process.env, GIT_INDEX_FILE: scratch }
    await $`git -C ${worktree} add -A`.env(env).quiet()
    return (await $`git -C ${worktree} write-tree`.env(env).quiet().text()).trim()
  } finally {
    rmSync(scratch, { force: true })
  }
}

/** Files that differ between two trees or commits, with their status letter. */
export async function changedBetween(
  cwd: string,
  from: string,
  to: string,
): Promise<{ status: string; path: string }[]> {
  return lines(await git(cwd, 'diff', '--name-status', '--no-renames', from, to)).map((line) => {
    const [status, path] = line.split('\t')
    return { status: status ?? '?', path: path ?? '' }
  })
}

/** Uncommitted changes in a worktree, untracked files included. */
export async function uncommitted(cwd: string): Promise<string[]> {
  // Not through git(): trimming would eat the leading space of the first " M path" line.
  const output = await $`git -C ${cwd} status --porcelain=v1 -uall --no-renames`.quiet().text()
  return lines(output).map((line) => line.slice(3))
}

export async function commitAll(cwd: string, message: string): Promise<string> {
  await git(cwd, 'add', '-A')
  await git(cwd, 'commit', '--quiet', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** Runs a shell command in `cwd`, appending its output to `log`. Resolves to its exit code. */
export async function runLogged(
  command: string,
  cwd: string,
  log: string,
  env: Record<string, string> = {},
): Promise<number> {
  const child = Bun.spawn(['sh', '-c', `${command} >> "$FACTORY_LOG" 2>&1`], {
    cwd,
    env: { ...process.env, ...env, FACTORY_LOG: log },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return child.exited
}
