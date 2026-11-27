// The guard's policy for Bash commands (and every tool that runs one, like Monitor), from the
// orchestrator and from every agent.
//
// During a job nobody but the CLI writes to GitHub, answers a Decision Request for the user, or
// edits the job's state in the main checkout: the user's own `gh` account is what every agent
// uses, so a comment or a `factory answer` from a tool call would look like the user's. The
// commands the CLI itself runs are not tool calls, so the CLI keeps pushing the branch and posting
// the PR. A subagent also runs no `gh` at all, runs only its own factory commands, writes only its
// own column (write-guard.ts), reads nothing read-guard.ts keeps from it, and leaves the seal to
// the orchestrator.
//
// THREAT MODEL
// - The guard stops a hurried or careless agent, and any plain command or tool call.
// - It reads command text (bash-words.ts), and a shell is open-ended, so a deliberately built
//   command can get past it.
// - Accepted residual: a script written then run; code built at runtime (base64, eval, string
//   concatenation); interpreters' own file operations beyond what `scriptWrites` recognizes; the
//   commit subject; code comments.
// - The real fix for that class is OS-level sandboxing of Bash, planned next. This file fixes the
//   plain cases and doesn't chase the residual.

import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  commandPaths,
  factoryCall,
  gitCommands,
  invocationPaths,
  invocations,
  isPush,
  isPushProgram,
  isSubtreePush,
  runtimeCalls,
  runtimeFlags,
  type Invocation,
} from './bash-words.ts'
import { jobsDir } from './job.ts'
import { canonical, isWithin } from './paths.ts'
import {
  allow,
  bashWhere,
  deny,
  first,
  type GuardContext,
  type Policy,
  type Verdict,
} from './policy.ts'
import { bashReadVerdict, sealedIn } from './read-guard.ts'
import { reviewerRole } from './review-plan.ts'
import { REVIEWER_ROLES } from './job.ts'
import { sandboxNames } from './sandbox-names.ts'
import { loadSeal } from './seal.ts'
import { writeVerdict } from './write-guard.ts'

// Why the `answer` rule is the whole separation between the user and an agent: verified on Claude
// Code 2.1.332, a command the user types with `!` does not fire PreToolUse hooks and a model's Bash
// call does, while both run with the same environment (CLAUDECODE, session id) and no TTY on stdin.
// So `factory answer` itself can't tell them apart and checks nothing about its caller; this denial
// is what keeps every tool call from running it.
const answerDenied = deny(
  'Only the user answers a Decision Request, from their own prompt. Raise a Decision Request with `bun run factory block` and wait: the user answers with `! bun run factory answer <n> "<text>"`.',
)

// Only Claude Code runs the hooks: a `factory hook log` from a tool call would forge the job's log.
const hookDenied = deny(
  "Only Claude Code runs `factory hook`: a tool call that feeds it input would write a forged event into the job's log. Use `bun run factory status` to see the job.",
)

/**
 * The factory commands an agent runs; the rest move the job, and only the orchestrator does. A
 * reviewer runs its checks in its own sandbox (`factory sandbox exec`), never `factory check`: that
 * one takes the checks lock and runs on the job's worktree.
 */
const AGENT_COMMANDS = new Set(['check', 'status'])
const REVIEWER_COMMANDS = new Set(['status'])

// `watch` serves the live page, with a token the user opens; `clean` removes a job's worktree, its
// branch and state, or discards it: both are the user's, from their own prompt.
const userOnly = (command: string) =>
  deny(
    `Only the user runs \`factory ${command}\`, from their own prompt: \`! bun run factory ${command}\`. ${
      command === 'watch'
        ? 'The user follows the job live with it.'
        : 'Say in your reply that the job is ready to clean; do not run it.'
    }`,
  )

const sessionDenied = (given: string, own: string) =>
  deny(
    `\`factory start --session ${given}\` would move this job to another session and switch its guard off. A tool call passes the session it runs in, ${own}: \`bun run factory start <n> --session ${own}\`.`,
  )

// The seal keeps a reviewer's blind pass blind, and an agent that could lift it would lift it; a
// ruling, a test fix, a red or a review plan an agent ran for itself would be its own verdict. A
// red from the build agent would commit its product changes unjudged.
const orchestratorOnly = (command: string, agentType: string) =>
  deny(
    reviewerRole(agentType)
      ? `Only the orchestrator runs \`factory ${command}\`: it moves the job. A reviewer runs \`factory status\` and its own sandbox (\`factory sandbox [exec|rm] <n> <your role>\`): run every check and test through \`factory sandbox exec\`. Finish your own task and report it.`
      : `Only the orchestrator runs \`factory ${command}\`: it moves the job. An agent runs \`factory check <n>\` and \`factory status\`. Finish your own task and report it.`,
  )

const unreadable = (what: string) =>
  deny(
    `${what}, so the guard can't tell which factory command runs. Type the command out: \`bun run factory <command> <n>\`.`,
  )

/** Code given inline to bun or node that reaches the factory CLI's modules. */
const FACTORY_CODE = /factory\/cli|cli\/src\/|src\/(?:commands|seal|job|main)\b/
/** Code given inline that starts gh. */
const GH_CODE = /['"`]gh['"`]/

/** The factory commands a call runs: `answer` and `hook` for no one, the rest by who calls. */
function factoryVerdict(command: string, calls: Invocation[], context: GuardContext): Verdict {
  for (const call of calls) {
    if (runtimeCalls(call).some((runtime) => runtimeFlags(runtime)?.evaluates)) {
      if (FACTORY_CODE.test(command)) {
        return unreadable('Code run with `bun -e` or `node -e` loads the factory CLI')
      }
      if (GH_CODE.test(command)) return githubDenied('Code run with `-e` that starts gh')
    }
    const factory = factoryCall(call)
    if (!factory) continue
    if (factory.viaXargs) return unreadable('xargs supplies the factory command its arguments')
    const sub = factory.command
    if (sub?.startsWith('$'))
      return unreadable(`The factory command is ${sub}, taken from the shell`)
    if (sub === 'answer') return answerDenied
    if (sub === 'hook') return hookDenied
    if (sub === 'watch' || sub === 'clean') return userOnly(sub)
    if (sub === 'start') {
      const given = factory.values['--session']
      const own = context.input.session_id
      if (given !== undefined && given !== own) return sessionDenied(given, own)
    }
    if (!context.agent || sub === undefined) continue
    const sandbox = factory.sandbox
    if (sandbox) {
      const role = reviewerRole(context.agent.type)
      if (!role) {
        return deny(
          'Only a reviewer has a sandbox, made and run with `factory sandbox`. Work in the worktree.',
        )
      }
      if (sandbox.role !== role) {
        return deny(
          `Your sandbox is ${role}'s: \`bun run factory sandbox [exec|rm] ${context.job.number} ${role}\`. The other reviewer's sandbox, its database and its bucket are its evidence.`,
        )
      }
      if (sandbox.number !== undefined && sandbox.number !== String(context.job.number)) {
        return deny(`Your job is #${context.job.number}; its sandbox is the only one you run.`)
      }
      continue
    }
    const allowed = reviewerRole(context.agent.type) ? REVIEWER_COMMANDS : AGENT_COMMANDS
    if (!allowed.has(sub)) return orchestratorOnly(sub, context.agent.type)
    const number = factory.positionals[1]
    if (number !== undefined && number !== String(context.job.number)) {
      return deny(`Your job is #${context.job.number}; run factory commands for it alone.`)
    }
  }
  return allow
}

/** Programs that run the program they are given: the words after one are in program position. */
const LAUNCHERS = new Set([
  'nice',
  'caffeinate',
  'arch',
  'script',
  'time',
  'timeout',
  'nohup',
  'exec',
  'env',
  'sudo',
  'doas',
  'command',
  'builtin',
  'xargs',
  'stdbuf',
  'setsid',
  'ionice',
  'unbuffer',
  'watch',
  'parallel',
  'taskpolicy',
  'sandbox-exec',
  'su',
  'strace',
  'chroot',
])

/** Where a launcher starts in the command: its first word, or `find`'s `-exec`. */
function launcherAt(all: string[]): number {
  return all.findIndex(
    (word, i) =>
      LAUNCHERS.has(basename(word)) ||
      (['-exec', '-execdir', '-ok', '-okdir'].includes(word) && all.slice(0, i).some(isFind)),
  )
}
const isFind = (word: string) => basename(word) === 'find'

/** `env -S "<command line>"` splits one string into a command: the guard can't read it. */
const SPLIT_STRING = /^-[A-Za-z]*S|^--split-string/

/** Git settings that run a command the guard doesn't see: an alias, a hooks folder, a pager. */
const RUNS_COMMANDS = /^(?:alias\.|core\.hookspath$|core\.fsmonitor$|core\.sshcommand$)/i

/**
 * Ways to run a program the guard can't read the name of: `env -S`, a git alias, and the `claude`
 * program, which would run a session with no guard of its own.
 */
function indirectVerdict(calls: Invocation[]): Verdict {
  for (const call of calls) {
    const { all } = call
    for (let i = 0; i < all.length; i++) {
      if (basename(all[i]!) !== 'env') continue
      const flags = all.slice(i + 1).findIndex((word) => !word.startsWith('-'))
      const given = all.slice(i + 1, flags === -1 ? undefined : i + 1 + flags)
      if (given.some((word) => SPLIT_STRING.test(word))) {
        return deny(
          "`env -S` builds a command out of one string, so the guard can't tell what runs. Write the command out.",
        )
      }
    }
    const launched = launcherAt(all)
    const claude = all.findIndex(
      (word, i) =>
        basename(word) === 'claude' &&
        (i === all.length - call.words.length || (launched !== -1 && i > launched)),
    )
    if (claude !== -1) {
      return deny(
        'The `claude` program starts a session with no guard of its own; during a job nobody runs it from a tool call.',
      )
    }
    for (const git of gitCommands(call)) {
      const hidden = git.configs.find((config) => RUNS_COMMANDS.test(config.split('=')[0] ?? ''))
      if (hidden) {
        return deny(
          `\`git -c ${hidden.split('=')[0]}\` sets a command the guard doesn't see (an alias, a hook, a pager): during a job git runs with its own settings.`,
        )
      }
    }
  }
  return allow
}

/** A program taken from a variable or a substitution: `$G issue comment`, `$(which gh) …`. */
function programVerdict(calls: Invocation[]): Verdict {
  const hidden = calls.find((call) => (call.words[0] ?? '').startsWith('$'))
  return hidden
    ? deny(
        `The program here is ${hidden.words[0]}, which the shell fills in, so the guard can't tell what runs. Name the program: write out its name or its path.`,
      )
    : allow
}

const isGh = (word: string) => /(?:^|\/)gh$/.test(word)

const agentGhDenied = ({ places }: GuardContext) =>
  deny(
    `Agents of a factory job don't use gh: the issue and its ACs are in ${places.handoffDir}/issue.md, and the branch is in git. Ask the orchestrator for anything else in your report.`,
  )

const githubDenied = (what: string) =>
  deny(
    `${what} writes to GitHub, and during a job only the CLI does. Say what you need in the job's files, or raise a Decision Request with \`bun run factory block\`; the user answers with \`! bun run factory answer\`. Reading stays allowed: gh issue view|list, gh pr view|list|checks|diff.`,
  )

const READ_ONLY: Record<string, readonly string[] | true> = {
  issue: ['view', 'list', 'status'],
  pr: ['view', 'list', 'checks', 'diff', 'status'],
  run: ['view', 'list', 'watch'],
  workflow: ['view', 'list'],
  auth: ['status'],
  search: true,
  status: true,
  browse: true,
  help: true,
  version: true,
}

/** `gh` flags that take a value, which must not be taken for the subcommand. */
const GH_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname'])

/** Flags that print the token: `gh auth status` reads, `gh auth status -t` hands out the account. */
const SHOWS_TOKEN = new Set(['-t', '--show-token'])

function ghVerdict(words: string[]): Verdict {
  const ghAt = words.flatMap((word, index) => (isGh(word) ? [index] : []))
  for (const at of ghAt) {
    const rest: string[] = []
    const flags: string[] = []
    for (let i = at + 1; i < words.length; i++) {
      const word = words[i]!
      if (GH_VALUE_FLAGS.has(word)) i++
      else if (word.startsWith('-')) flags.push(word)
      else rest.push(word)
    }
    const [sub, verb] = rest
    if (sub === undefined) continue
    if (sub === 'auth' && flags.some((flag) => SHOWS_TOKEN.has(flag))) {
      return githubDenied('gh auth status --show-token hands out the token that')
    }
    const allowed = READ_ONLY[sub]
    if (allowed === true) continue
    if (!allowed || (verb !== undefined && !allowed.includes(verb))) {
      return githubDenied(`gh ${sub}${verb ? ` ${verb}` : ''}`)
    }
  }
  return allow
}

/** HTTP clients, which reach GitHub's API with the user's token as easily as gh. */
const HTTP_CLIENTS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'httpie'])
const GITHUB_HOST = /(?:^|[/@.])github\.com\b/

/** gh writes, HTTP to GitHub and `git push`, for everyone; any gh at all for an agent. */
function githubVerdict(calls: Invocation[], context: GuardContext): Verdict {
  for (const call of calls) {
    const verdict = ghVerdict(call.all)
    if (!verdict.ok) return verdict
    const program = basename(call.words[0] ?? '')
    if (HTTP_CLIENTS.has(program) && call.all.some((word) => GITHUB_HOST.test(word))) {
      return githubDenied(`${program} to GitHub`)
    }
    if (gitCommands(call).some(isPush) || call.all.some(isPushProgram) || isSubtreePush(call.all)) {
      return githubDenied(
        '`git push` (the CLI pushes the branch itself when it opens the PR: factory pr)',
      )
    }
  }
  if (context.agent && calls.some((call) => call.all.some(isGh))) return agentGhDenied(context)
  return allow
}

/**
 * Agents but the build agent commit nothing in the job's worktree: the test agent's work is
 * committed by the CLI, and a reviewer reports. A reviewer may commit in its own sandbox.
 */
function commitVerdict(calls: Invocation[], context: GuardContext): Verdict {
  const { agent, places } = context
  if (!agent || agent.type === 'factory-build') return allow
  const role = reviewerRole(agent.type)
  for (const git of calls.flatMap(gitCommands)) {
    if (git.sub !== 'commit') continue
    const own = role ? `${places.handoffDir}/sandbox/${role}` : null
    if (own && isWithin(canonical(git.cwd), canonical(own))) continue
    return deny(
      `${agent.type} commits nothing in the job's worktree: the CLI commits the test agent's work (factory red, atfix, rewrite), the build agent commits its own, and a reviewer reports. Leave the change uncommitted and say so in your reply.`,
    )
  }
  return allow
}

/** The agents that work in the job's worktree: they run the git and the tests their task needs. */
const WORKERS = new Set(['factory-build', 'factory-test', 'factory-diagnose'])

const BRANCH_MUTATING = /^-[a-zA-Z]*[fdDmMcC][a-zA-Z]*$|^--(?:force|delete|move|copy)$/
const WORKTREE_MUTATING = new Set(['add', 'remove', 'move', 'prune', 'lock', 'unlock', 'repair'])
/** Git commands that move the worktree they run in: harmless in a reviewer's own sandbox. */
const MOVES_WORKTREE = new Set([
  'reset',
  'clean',
  'stash',
  'switch',
  'apply',
  'am',
  'merge',
  'rebase',
  'cherry-pick',
])
const READS_CONFIG = new Set([
  '--get',
  '--get-all',
  '--get-regexp',
  '--get-urlmatch',
  '-l',
  '--list',
  '--show-origin',
  '--name-only',
  '--show-scope',
])
const WRITES_CONFIG = new Set([
  '--add',
  '--unset',
  '--unset-all',
  '--replace-all',
  '--rename-section',
  '--remove-section',
  '-e',
  '--edit',
])

/** Whether `git config <args>` changes a setting: a key with a value, or an unset. */
function writesConfig(args: string[]): boolean {
  if (args.some((word) => WRITES_CONFIG.has(word))) return true
  if (args.some((word) => READS_CONFIG.has(word))) return false
  const operands: string[] = []
  for (let i = 0; i < args.length; i++) {
    const word = args[i]!
    if (['-f', '--file', '--blob', '--type', '--default'].includes(word)) i++
    else if (!word.startsWith('-')) operands.push(word)
  }
  return operands.length >= 2
}

/**
 * The git an agent runs, judged apart from push and commit. Every agent's `git config` write is
 * denied (a hooks path or an alias runs a command later, with the user's account), and none moves
 * the job's branch. A reviewer or a nested run (an Explore) moves nothing shared: no reset, clean,
 * stash, switch, apply, merge, rebase or cherry-pick outside its own sandbox, and no ref, note,
 * tag or worktree anywhere.
 */
function gitVerdict(calls: Invocation[], context: GuardContext): Verdict {
  const { agent, job, places } = context
  if (!agent) {
    // The orchestrator's own git config is its own, but not a setting that runs a command later.
    const hidden = calls
      .flatMap(gitCommands)
      .find(
        (git) =>
          git.sub === 'config' &&
          writesConfig(git.args) &&
          RUNS_COMMANDS.test(git.args.find((word) => !word.startsWith('-')) ?? ''),
      )
    return hidden
      ? deny(
          '`git config` of an alias, a hooks path or an fsmonitor sets a command git runs later, past the guard. Nobody sets one during a job.',
        )
      : allow
  }
  const role = reviewerRole(agent.type)
  const own = role ? canonical(join(places.handoffDir, 'sandbox', role)) : null
  const restricted = !WORKERS.has(agent.type)
  for (const git of calls.flatMap(gitCommands)) {
    const { sub, args } = git
    const flags = args.filter((word) => word.startsWith('-'))
    const names = args.some((word) =>
      [job.branch, `refs/heads/${job.branch}`, `heads/${job.branch}`].includes(word),
    )
    const movesBranch =
      sub === 'update-ref' ||
      (sub === 'branch' && flags.some((flag) => BRANCH_MUTATING.test(flag))) ||
      (sub === 'checkout' && flags.includes('-B')) ||
      (sub === 'switch' && flags.some((flag) => flag === '-C' || flag === '--force-create'))
    if (names && movesBranch) {
      return deny(
        `\`git ${sub}\` on ${job.branch} moves the job's branch: the commits the CLI and the gate judged would no longer be the ones on it. Nobody but the job's own commits and the CLI touch that branch.`,
      )
    }
    if (sub === 'config' && writesConfig(args)) {
      return deny(
        "`git config` changes a setting (a hooks path, an alias, a pager) that runs a command later with the user's account. No agent writes git settings during a job; read them with `git config --get <key>`.",
      )
    }
    if (!restricted) continue
    const sharedWrite =
      sub === 'update-ref' ||
      sub === 'notes' ||
      (sub === 'tag' &&
        !flags.some((flag) => ['-l', '--list'].includes(flag)) &&
        args.length > 0) ||
      (sub === 'worktree' && WORKTREE_MUTATING.has(args[0] ?? '')) ||
      (sub === 'branch' && flags.some((flag) => BRANCH_MUTATING.test(flag)))
    const inside = own !== null && isWithin(canonical(git.cwd), own)
    const movesTree =
      MOVES_WORKTREE.has(sub) ||
      (sub === 'checkout' && flags.some((flag) => ['-b', '-B', '--orphan'].includes(flag)))
    if (sharedWrite || (movesTree && !inside)) {
      return deny(
        `${agent.type} runs no \`git ${sub}\` ${sharedWrite ? 'at all' : 'outside its own sandbox'}: it moves the shared repository or the job's worktree, which the build and the other reviewer's evidence stand on. ${role ? `Mutate your own sandbox, ${join(places.handoffDir, 'sandbox', role)}.` : 'Read with git log, diff and show.'}`,
      )
    }
  }
  return allow
}

const RUNNER_SCRIPT = /^(?:e2e|test|dev|start|preview|serve)(?::.*)?$/
const RUNNER_PROGRAMS = new Set(['playwright', 'vite', 'vitest', 'docker-compose'])

/** The test runner or server a command starts, or null. */
function runnerIn(call: Invocation): string | null {
  const names = call.words.map((word) => basename(word))
  const program = names.find((name) => RUNNER_PROGRAMS.has(name))
  if (program) return program
  const docker = names.indexOf('docker')
  if (docker !== -1 && names[docker + 1] === 'compose') return 'docker compose'
  for (const runtime of runtimeCalls(call)) {
    const flags = runtimeFlags(runtime)
    if (!flags) continue
    const word = runtime.words[flags.script]
    const ran = runtime.words.slice(1, flags.script).includes('run')
    if (basename(runtime.words[0] ?? '') === 'bun' && !ran && word === 'test') return 'bun test'
    if (ran && word && RUNNER_SCRIPT.test(word)) return `bun run ${word}`
  }
  return null
}

/** A reviewer starts tests and servers only through `factory sandbox exec`: its port and services. */
function runnersVerdict(calls: Invocation[], context: GuardContext): Verdict {
  const role = context.agent ? reviewerRole(context.agent.type) : null
  if (!role) return allow
  for (const call of calls) {
    if (call.sandboxed || factoryCall(call)) continue
    const runner = runnerIn(call)
    if (runner) {
      return deny(
        `\`${runner}\` outside \`factory sandbox exec\` runs on the shared port 3100 and the shared test database, which the checks and the other reviewer use. Run it through \`bun run factory sandbox exec ${context.job.number} ${role} -- <command>\`.`,
      )
    }
  }
  return allow
}

/** A reviewer names neither the other reviewer's database nor its bucket, heredoc bodies included. */
function servicesVerdict(calls: Invocation[], command: string, context: GuardContext): Verdict {
  const role = context.agent ? reviewerRole(context.agent.type) : null
  if (!role) return allow
  const other = REVIEWER_ROLES.find((candidate) => candidate !== role)!
  const { database, bucket } = sandboxNames(context.job.number, other)
  const names = [database, bucket]
  // The raw text too: a heredoc's body is no word of the command, and a psql script is one.
  const named = names.find((name) =>
    [command, ...calls.flatMap((call) => call.all)].some((text) => text.includes(name)),
  )
  return named
    ? deny(
        `${named} names the ${other}'s sandbox database or bucket, its evidence. Use your own, through \`bun run factory sandbox exec ${context.job.number} ${role} -- <command>\`.`,
      )
    : allow
}

/** Programs that only read what they are given, and so may read the job's state. */
const STATE_READERS = new Set([
  'cat',
  'ls',
  'head',
  'tail',
  'grep',
  'rg',
  'wc',
  'jq',
  'stat',
  'file',
  'diff',
  'cd',
])

const stateDenied = deny(
  "The job's state in the main checkout (factory/.jobs/<n>/job.json, events.jsonl) is written only by the CLI. Use `bun run factory <command>`; to unblock a job the user runs `! bun run factory answer`.",
)

const GLOB = /[*?[{]/

/** Every file and folder in the state folder, for a glob to be matched against. */
function stateEntries(dir: string): string[] {
  const glob = new Bun.Glob('**')
  try {
    return [dir, ...glob.scanSync({ cwd: dir, dot: true, onlyFiles: false, absolute: true })]
  } catch {
    return [dir]
  }
}

/**
 * Whether a path, symlinks resolved, is in the main checkout's job state folders. A glob counts when
 * it matches something there: the shell expands it only to what exists.
 */
function inState(path: string, state: string, entries: () => string[]): boolean {
  if (!GLOB.test(path)) return isWithin(canonical(path), state)
  const at = path.search(GLOB)
  const prefix = path.slice(0, path.lastIndexOf('/', at) + 1) || '/'
  const real = canonical(prefix)
  const pattern = new Bun.Glob(`${real.replace(/\/$/, '')}/${path.slice(prefix.length)}`)
  if (isWithin(real, state)) return true
  return isWithin(state, real) && entries().some((entry) => pattern.match(entry))
}

/**
 * Nobody but the CLI writes the job's state: a command that names it may only read it, with a
 * program that only reads. Every path the command names counts, wherever its `cd`s lead.
 */
function stateVerdict(calls: Invocation[], command: string, context: GuardContext): Verdict {
  const state = canonical(jobsDir(context.root))
  let entries: string[] | undefined
  const listed = () => (entries ??= stateEntries(state))
  for (const call of calls) {
    if (factoryCall(call)) continue
    // A link to the state folder, or to a folder above it, is a way to write it later.
    const links = invocationPaths(call).filter((named) => named.program === 'ln' && named.search)
    if (links.some((named) => isWithin(state, canonical(named.path)))) return stateDenied
    // A patch or a checkout run from inside the state folder rewrites what is in it.
    const rewrites = gitCommands(call).some(
      (git) =>
        isWithin(canonical(git.cwd), state) &&
        [
          'apply',
          'am',
          'checkout',
          'restore',
          'reset',
          'stash',
          'clean',
          'merge',
          'rebase',
          'cherry-pick',
        ].includes(git.sub),
    )
    if (rewrites) return stateDenied
    const touched = invocationPaths(call).filter((named) => inState(named.path, state, listed))
    if (!touched.length) continue
    const reading = STATE_READERS.has(basename(call.words[0] ?? ''))
    if (reading && touched.every((named) => !named.write)) continue
    return stateDenied
  }
  // An inline script's own writes: `python -c "open('…/job.json', 'w')"`.
  const at = bashWhere(context)
  const scripted = commandPaths(command, at).filter((named) => named.program === 'script')
  return scripted.some((named) => inState(named.path, state, listed)) ? stateDenied : allow
}

/**
 * While sealed, a command of the orchestrator's that writes into the worktree (a redirect, a
 * heredoc, `tee`, `cp`) carries no sealed text, by name or by quote: the worktree is what the
 * reviewers read for their blind passes.
 */
function sealedTextVerdict(
  command: string,
  written: { path: string }[],
  context: GuardContext,
): Verdict {
  const { root, job } = context
  const sealed = loadSeal(root, job.number)
  if (!sealed) return allow
  const into = written.some((named) =>
    isWithin(canonical(named.path, bashWhere(context).cwd), job.worktree),
  )
  const found = into ? sealedIn(command, root, job.number, null) : null
  return found
    ? deny(
        `Job #${job.number} is sealed for review pass ${sealed.pass}, and this command writes into the worktree text that ${found}. The reviewers read the worktree for their blind passes: write it after \`bun run factory unseal ${job.number}\`.`,
      )
    : allow
}

const BLIND_PASS = /\/reviews\/\d+\.[a-z-]+\.blind\.md$/

/**
 * What an agent's command writes stays in its column, as an Edit or a Write would. A blind pass is
 * written with the Write tool: `factory unseal` checks the log for that write.
 */
function writesVerdict(command: string, context: GuardContext): Verdict {
  const at = bashWhere(context)
  const written = commandPaths(command, at).filter((named) => named.write)
  // The orchestrator's own Bash writes are judged as its Write tool's are: not the reviewers' files.
  if (!context.agent) {
    return first([
      ...written.map((named) => writeVerdict(named.path, context)),
      sealedTextVerdict(command, written, context),
    ])
  }
  const blind = written.find((named) => BLIND_PASS.test(canonical(named.path)))
  if (blind) {
    return deny(
      `Write your blind pass, ${canonical(blind.path)}, with the Write tool: \`factory unseal\` accepts only a blind pass the reviewer's own run wrote that way.`,
    )
  }
  return first(written.map((named) => writeVerdict(named.path, context)))
}

export const bashPolicy: Policy = (context) => {
  const command = context.input.tool_input?.command
  if (typeof command !== 'string') return allow
  const calls = invocations(command, { ...bashWhere(context), home: homedir() })
  return first(
    (function* () {
      yield githubVerdict(calls, context)
      yield factoryVerdict(command, calls, context)
      yield programVerdict(calls)
      yield indirectVerdict(calls)
      yield commitVerdict(calls, context)
      yield servicesVerdict(calls, command, context)
      yield gitVerdict(calls, context)
      yield runnersVerdict(calls, context)
      yield stateVerdict(calls, command, context)
      yield writesVerdict(command, context)
      yield bashReadVerdict(command, context)
    })(),
  )
}
