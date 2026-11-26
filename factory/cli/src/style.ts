// Lint and format for a set of files, with the worktree's own oxlint, oxfmt and config: the same
// verdict CI's lint and Format steps give on them.

import { $ } from 'bun'
import { join } from 'node:path'

const bin = (worktree: string, name: string) => join(worktree, 'node_modules', '.bin', name)

/** A tool's output as plain text: oxfmt colors file names when it thinks it runs in CI. */
const text = (result: { stdout: Buffer; stderr: Buffer }) =>
  Bun.stripANSI(`${result.stdout.toString()}${result.stderr.toString()}`)

/**
 * One problem per lint error and per unformatted file, each naming the file and how to fix it. An
 * empty list means every file passes `oxlint --deny-warnings` and `oxfmt --check`.
 */
export async function styleProblems(worktree: string, files: readonly string[]): Promise<string[]> {
  if (files.length === 0) return []
  const problems: string[] = []

  const lint = await $`${bin(worktree, 'oxlint')} --deny-warnings --format=unix ${files}`
    .cwd(worktree)
    .nothrow()
    .quiet()
  if (lint.exitCode !== 0) {
    const output = text(lint)
    // Unix format: `path:line:col: message [Severity/plugin(rule)]`, one per line.
    const found = output.split('\n').filter((line) => files.some((f) => line.startsWith(`${f}:`)))
    for (const line of found) {
      problems.push(
        `${line} — fails lint; fix it and check with \`bunx oxlint ${line.split(':')[0]}\``,
      )
    }
    if (found.length === 0) problems.push(`oxlint failed on ${files.join(', ')}: ${output.trim()}`)
  }

  const format = await $`${bin(worktree, 'oxfmt')} --check ${files}`.cwd(worktree).nothrow().quiet()
  if (format.exitCode !== 0) {
    const output = text(format)
    const unformatted = files.filter((file) =>
      output.split('\n').some((line) => line.startsWith(`${file} `) || line === file),
    )
    for (const file of unformatted) {
      problems.push(`${file}: not formatted — run \`bunx oxfmt ${file}\``)
    }
    if (unformatted.length === 0) {
      problems.push(`oxfmt --check failed on ${files.join(', ')}: ${output.trim()}`)
    }
  }
  return problems
}
