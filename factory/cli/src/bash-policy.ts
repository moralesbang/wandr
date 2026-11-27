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
// This reads the command text (bash-words.ts). It stops what a hurried or careless agent types, in
// the spellings listed in bash-policy.test.ts; it cannot stop a command built out of sight, such as
// a script written first and run after, base64, or an eval of a string built at runtime.

import { homedir } from 'node:os'
import { basename } from 'node:path'
import {
  commandPaths,
  factoryCall,
  gitCommand,
  invocationPaths,
  invocations,
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
import { bashReadVerdict } from './read-guard.ts'
import { reviewerRole } from './review-plan.ts'
import { REVIEWER_ROLES } from './job.ts'
import { sandboxNames } from './sandbox-names.ts'
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

/** The factory commands an agent runs; the rest move the job, and only the orchestrator does. */
const AGENT_COMMANDS = new Set(['check', 'status'])

// The seal keeps a reviewer's blind pass blind, and an agent that could lift it would lift it; a
// ruling, a test fix, a red or a review plan an agent ran for itself would be its own verdict. A
// red from the build agent would commit its product changes unjudged.
const orchestratorOnly = (command: string) =>
  deny(
    `Only the orchestrator runs \`factory ${command}\`: it moves the job. An agent runs \`factory check <n>\` and \`factory status\`, and a reviewer also its own sandbox (\`factory sandbox [exec|rm] <n> <your role>\`). Finish your own task and report it.`,
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
    if (runtimeFlags(call)?.evaluates) {
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
    if (!AGENT_COMMANDS.has(sub)) return orchestratorOnly(sub)
    const number = factory.positionals[1]
    if (number !== undefined && number !== String(context.job.number)) {
      return deny(`Your job is #${context.job.number}; run factory commands for it alone.`)
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
    if (gitCommand(call)?.sub === 'push') {
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
  for (const call of calls) {
    const git = gitCommand(call)
    if (git?.sub !== 'commit') continue
    const own = role ? `${places.handoffDir}/sandbox/${role}` : null
    if (own && isWithin(canonical(git.cwd), canonical(own))) continue
    return deny(
      `${agent.type} commits nothing in the job's worktree: the CLI commits the test agent's work (factory red, atfix, rewrite), the build agent commits its own, and a reviewer reports. Leave the change uncommitted and say so in your reply.`,
    )
  }
  return allow
}

/** A reviewer names neither the other reviewer's database nor its bucket. */
function servicesVerdict(calls: Invocation[], context: GuardContext): Verdict {
  const role = context.agent ? reviewerRole(context.agent.type) : null
  if (!role) return allow
  const other = REVIEWER_ROLES.find((candidate) => candidate !== role)!
  const { database, bucket } = sandboxNames(context.job.number, other)
  const named = calls
    .flatMap((call) => call.all)
    .find((word) => word.includes(database) || word.includes(bucket))
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

const BLIND_PASS = /\/reviews\/\d+\.[a-z-]+\.blind\.md$/

/**
 * What an agent's command writes stays in its column, as an Edit or a Write would. A blind pass is
 * written with the Write tool: `factory unseal` checks the log for that write.
 */
function writesVerdict(command: string, context: GuardContext): Verdict {
  if (!context.agent) return allow
  const at = bashWhere(context)
  const written = commandPaths(command, at).filter((named) => named.write)
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
      yield commitVerdict(calls, context)
      yield servicesVerdict(calls, context)
      yield stateVerdict(calls, command, context)
      yield writesVerdict(command, context)
      yield bashReadVerdict(command, context)
    })(),
  )
}
