// The guard's policy for Bash commands, from the orchestrator and from every agent.
//
// During a job nobody but the CLI writes to GitHub, answers a Decision Request for the user, or
// edits the job's state in the main checkout: the user's own `gh` account is what every agent
// uses, so a comment or a `factory answer` from a tool call would look like the user's. The
// commands the CLI itself runs are not tool calls, so the CLI keeps posting the PR.
//
// This reads the command text. It stops what a hurried or careless agent types, in the spellings
// listed in bash-policy.test.ts; it cannot stop a command built out of sight, such as a script
// written first and run after.

import { relative, resolve, isAbsolute } from 'node:path'
import { JOBS_FOLDER } from './paths.ts'
import { allow, deny, type GuardContext, type Policy, type Verdict } from './policy.ts'

/** The command split into simple commands, each a list of words, with quoting and escapes undone. */
function simpleCommands(command: string): string[][] {
  return (
    command
      // Quotes and backslashes hide words from a pattern; a shell would join them back.
      .replaceAll(/['"\\]/g, '')
      // File-descriptor redirections are not command separators.
      .replaceAll(/\d*>&\d+|&>|\d*>\s*\/dev\/null/g, ' ')
      .split(/[;&|\n()`]|\$\(/)
      .map((part) => part.split(/\s+/).filter(Boolean))
      .filter((words) => words.length > 0)
  )
}

// Why this rule is the whole separation between the user and an agent: verified on Claude Code
// 2.1.332, a command the user types with `!` does not fire PreToolUse hooks and a model's Bash call
// does, while both run with the same environment (CLAUDECODE, session id) and no TTY on stdin. So
// `factory answer` itself can't tell them apart and checks nothing about its caller; this denial
// is what keeps agents from running it.
const FACTORY_ANSWER = /(?:\bfactory|main\.ts)(?:\s+-\S*)*\s+answer\b/

const answerDenied = deny(
  'Only the user answers a Decision Request, from their own prompt. Raise a Decision Request with `bun run factory block` and wait: the user answers with `! bun run factory answer <n> "<text>"`.',
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

function ghVerdict(words: string[]): Verdict {
  const ghAt = words.flatMap((word, index) => (/(?:^|\/)gh$/.test(word) ? [index] : []))
  for (const at of ghAt) {
    const rest: string[] = []
    for (let i = at + 1; i < words.length; i++) {
      const word = words[i]!
      if (GH_VALUE_FLAGS.has(word)) i++
      else if (!word.startsWith('-')) rest.push(word)
    }
    const [sub, verb] = rest
    if (sub === undefined) continue
    const allowed = READ_ONLY[sub]
    if (allowed === true) continue
    if (!allowed || (verb !== undefined && !allowed.includes(verb))) {
      return githubDenied(`gh ${sub}${verb ? ` ${verb}` : ''}`)
    }
  }
  return allow
}

/** Programs that only read what they are given; with a redirection they are not read-only. */
const READERS = new Set([
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
])

const isFactoryCli = (words: string[]) =>
  words[0] === 'bun' && words[1] === 'run' && words[2] === 'factory'

/**
 * Whether a word names a place inside the main checkout's job state folders. A relative word
 * resolves against the call's directory: inside the job's worktree it is the handoff folder, which
 * agents write.
 */
function inState(word: string, root: string, cwd: string): boolean {
  if (!word.includes('.jobs')) return false
  const state = resolve(root, JOBS_FOLDER)
  return word.split(/[=<>:,]/).some((piece) => {
    if (!piece.includes('.jobs') || piece.startsWith('$') || piece.startsWith('~')) return false
    const path = isAbsolute(piece) ? resolve(piece) : resolve(cwd, piece)
    const rel = relative(state, path)
    return !rel.startsWith('..') && !isAbsolute(rel)
  })
}

const stateDenied = deny(
  "The job's state in the main checkout (factory/.jobs/<n>/job.json, events.jsonl) is written only by the CLI. Use `bun run factory <command>`; to unblock a job the user runs `! bun run factory answer`.",
)

function stateVerdict(command: string, { root, job, input }: GuardContext): Verdict {
  const cwd = typeof input.cwd === 'string' ? input.cwd : job.worktree
  // A redirection can sit in another word of the same command than the path it writes to.
  for (const words of simpleCommands(command)) {
    if (!words.some((word) => inState(word, root, cwd))) continue
    const rawRedirect = command.replaceAll(/\d*>&\d+|&>|\d*>\s*\/dev\/null/g, ' ').includes('>')
    if (isFactoryCli(words)) continue
    if (READERS.has(words[0] ?? '') && !rawRedirect) continue
    return stateDenied
  }
  return allow
}

export const bashPolicy: Policy = (context) => {
  const command = context.input.tool_input?.command
  if (typeof command !== 'string') return allow
  const commands = simpleCommands(command)
  if (FACTORY_ANSWER.test(commands.map((words) => words.join(' ')).join('\n'))) {
    return answerDenied
  }
  for (const words of commands) {
    const verdict = ghVerdict(words)
    if (!verdict.ok) return verdict
  }
  return stateVerdict(command, context)
}
