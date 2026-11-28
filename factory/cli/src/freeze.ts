// The factory doesn't change under a running job. The hooks run the main checkout's CLI and a job's
// state lives there, so a change to the CLI, the skill, the agents or the hooks while a job is
// active changes the judge mid-job (job #15 ran 65 minutes against a factory another session was
// rewriting). Two layers, one for each way a change gets in:
//
// - The guard PREVENTS what a Claude Code session does: while any job is active, no session of the
//   repo, bound to a job or not, writes the files that define how a job runs in the main checkout
//   (FACTORY_FILES) or moves that checkout's HEAD or working tree. Work in another worktree is free.
// - The fingerprint DETECTS the rest, what the guard can't see (the user's `!` commands, their
//   editor, another tool): `factory start` records the files' content hashes, uncommitted changes
//   included, and every CLI command and every guard verdict of that job compares them.

import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { commandPaths, gitCommands, invocations, type GitCommand } from './bash-words.ts'
import type { HookInput } from './events.ts'
import { isActive, type Job } from './job.ts'
import { canonical, FACTORY_ROOTS, isFactoryFile, isWithin } from './paths.ts'
import { allow, deny, type Verdict } from './policy.ts'

/** Each file that defines how a job runs, by its path in the repo, with the hash of its content. */
export type Fingerprint = Record<string, string>

/** Every file under a folder of the repo, without the installed dependencies. */
function filesUnder(root: string, folder: string): string[] {
  let entries
  try {
    entries = readdirSync(join(root, folder), { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    if (entry.name === 'node_modules') return []
    const path = `${folder}/${entry.name}`
    return entry.isDirectory() ? filesUnder(root, path) : entry.isFile() ? [path] : []
  })
}

/** The files that define how a job runs, in a checkout: paths.ts FACTORY_FILES, as they exist. */
export function factoryFiles(root: string): string[] {
  const candidates = [
    ...filesUnder(root, 'factory/cli'),
    ...filesUnder(root, '.claude/skills/factory'),
    ...filesUnder(root, '.claude/agents'),
    '.claude/settings.json',
    'package.json',
    'bun.lock',
  ]
  return candidates.filter(isFactoryFile).toSorted()
}

/** The content of those files as they are now, uncommitted changes included. */
export function factoryFingerprint(root: string): Fingerprint {
  const found: Fingerprint = {}
  for (const path of factoryFiles(root)) {
    try {
      found[path] = new Bun.CryptoHasher('sha256')
        .update(readFileSync(join(root, path)))
        .digest('hex')
    } catch {
      // Gone between the listing and the read: it is missing from the fingerprint, as removed.
    }
  }
  return found
}

/** The files that differ between a recorded fingerprint and the current one, each with how. */
export function fingerprintChanges(recorded: Fingerprint, current: Fingerprint): string[] {
  const paths = new Set([...Object.keys(recorded), ...Object.keys(current)])
  return [...paths]
    .toSorted()
    .flatMap((path) =>
      recorded[path] === current[path]
        ? []
        : [
            `${path} (${recorded[path] === undefined ? 'added' : current[path] === undefined ? 'removed' : 'changed'})`,
          ],
    )
}

/** What changed in the main checkout's factory files since the job started; empty when nothing. */
export function factoryChanges(
  root: string,
  job: Pick<Job, 'state' | 'factoryFingerprint'>,
): string[] {
  if (!isActive(job) || !job.factoryFingerprint) return []
  return fingerprintChanges(job.factoryFingerprint, factoryFingerprint(root))
}

const shown = (changes: string[]) =>
  changes.length > 8
    ? `${changes.slice(0, 8).join(', ')} and ${changes.length - 8} more`
    : changes.join(', ')

/** Why a job whose factory files changed since it started refuses, naming them. */
export const changedMessage = (number: number, changes: string[]) =>
  `The factory changed under job #${number} after it started: ${shown(changes)}. A job is judged by the factory it started with, so it stops here. Revert those files (the main checkout's factory files are frozen while a job runs), or accept the new ones with \`! bun run factory refreeze ${number}\`, which the user runs from their own prompt, or discard the job with \`! bun run factory clean ${number} --abandon\`.`

/** The guard's verdict on a job's call: refuses once the factory under it changed. */
export function fingerprintVerdict(root: string, job: Job): Verdict {
  const changes = factoryChanges(root, job)
  return changes.length === 0 ? allow : deny(changedMessage(job.number, changes))
}

/** The jobs that freeze the factory: those building or blocked. */
export const activeJobs = (jobs: readonly Job[]) => jobs.filter(isActive)

const named = (jobs: readonly Job[]) =>
  jobs.map((job) => `job #${job.number} (${job.state})`).join(', ')

const frozen = (jobs: readonly Job[], what: string) =>
  deny(
    `${what}. The factory is frozen in the main checkout while ${named(jobs)} ${jobs.length === 1 ? 'is' : 'are'} active: the hooks run that checkout's CLI, skill and agents, so a change now would change how the job is judged mid-run. Work in a worktree (EnterWorktree, or \`git worktree add\`), or wait until the job opens its PR or is cleaned.`,
  )

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/** The repo-relative factory file a write to `path` reaches in the main checkout, or null. */
function factoryTarget(root: string, path: string, cwd: string, tree: boolean): string | null {
  const absolute = canonical(path, cwd)
  if (!isWithin(absolute, root)) return null
  const rel = relative(root, absolute)
  if (rel && isFactoryFile(rel)) return rel
  // A folder written whole (`rm -rf`, `mv`, `cp -r`) with a factory file below it.
  return tree ? (FACTORY_ROOTS.find((dir) => isWithin(join(root, dir), absolute)) ?? null) : null
}

/** Git commands that move HEAD or rewrite the working tree they run in. */
const MOVES_CHECKOUT = new Set([
  'switch',
  'pull',
  'merge',
  'reset',
  'rebase',
  'stash',
  'cherry-pick',
  'revert',
  'am',
  'clean',
])
const APPLY_ONLY_READS = new Set(['--check', '--stat', '--numstat', '--summary'])

/** Whether a git command moves HEAD or rewrites the working tree of the repo it works in. */
function movesCheckout(git: GitCommand): boolean {
  const { sub, args } = git
  if (MOVES_CHECKOUT.has(sub)) return true
  if (sub === 'apply') return !args.some((word) => APPLY_ONLY_READS.has(word))
  // `git checkout -- <path>` restores files (the write check judges them); any other checkout
  // switches branch or detaches HEAD.
  if (sub === 'checkout') {
    const dash = args.indexOf('--')
    return dash === -1 || args.slice(0, dash).some((word) => !word.startsWith('-'))
  }
  if (sub === 'restore') {
    const staged = args.some((word) => word === '--staged' || word === '-S')
    const worktree = args.some((word) => word === '--worktree' || word === '-W')
    return !staged || worktree
  }
  return false
}

/** Git's own ways to point at another repository than the folder the command runs in. */
const REDIRECTS_GIT = /^(?:--git-dir|--work-tree|GIT_DIR=|GIT_WORK_TREE=)/

/** `bun` commands that rewrite package.json and bun.lock. */
const REWRITES_PACKAGES = new Set([
  'add',
  'remove',
  'rm',
  'update',
  'up',
  'patch',
  'unlink',
  'link',
])

/** Whether a folder is the main checkout itself, not a worktree under it. */
const inMainCheckout = (root: string, cwd: string) => {
  const real = canonical(cwd)
  // The job state under factory/.jobs is not the factory: the guard's state rules judge it.
  return (
    isWithin(real, root) &&
    !isWithin(real, join(root, '.claude', 'worktrees')) &&
    !isWithin(real, join(root, 'factory', '.jobs'))
  )
}

function bashVerdict(root: string, input: HookInput, jobs: readonly Job[]): Verdict {
  const command = input.tool_input?.command
  if (typeof command !== 'string') return allow
  const cwd = typeof input.cwd === 'string' ? input.cwd : root
  const where = { cwd, home: homedir() }
  for (const written of commandPaths(command, where)) {
    if (!written.write) continue
    const hit = factoryTarget(root, written.path, cwd, written.tree === true)
    if (hit) return frozen(jobs, `This command writes ${hit}, a file that defines how a job runs`)
  }
  for (const call of invocations(command, where)) {
    for (const git of gitCommands(call)) {
      if (!movesCheckout(git)) continue
      const aimed = call.all.some((word) => REDIRECTS_GIT.test(word))
      if (aimed || inMainCheckout(root, git.cwd)) {
        return frozen(jobs, `\`git ${git.sub}\` moves the main checkout's HEAD or working tree`)
      }
    }
    const [program, sub] = call.words
    if (
      basename(program ?? '') === 'bun' &&
      REWRITES_PACKAGES.has(sub ?? '') &&
      inMainCheckout(root, call.cwd)
    ) {
      return frozen(jobs, `\`bun ${sub}\` rewrites package.json and bun.lock in the main checkout`)
    }
  }
  return allow
}

/**
 * The verdict on one call of any Claude Code session of the repo, bound to a job or not: while a job
 * is active, nobody writes the files that define how it runs in the main checkout or moves that
 * checkout. Allows everything when no job is active, and everything in another worktree.
 */
export function freezeVerdict(root: string, input: HookInput, jobs: readonly Job[]): Verdict {
  const active = activeJobs(jobs)
  if (active.length === 0) return allow
  const tool = input.tool_name ?? ''
  if (WRITE_TOOLS.has(tool)) {
    const toolInput = input.tool_input ?? {}
    const path = toolInput.file_path ?? toolInput.notebook_path
    if (typeof path !== 'string') return allow
    const cwd = typeof input.cwd === 'string' ? input.cwd : root
    const hit = factoryTarget(root, path, cwd, false)
    return hit ? frozen(active, `${hit} defines how a job runs`) : allow
  }
  return bashVerdict(root, input, active)
}
