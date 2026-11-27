// The guard's policy for reads (Read, Grep, Glob, and the paths a Bash command names) and for the
// prompts the orchestrator hands the agents it launches or messages (Agent, SendMessage).
//
// Two layers keep a reviewer's blind pass blind. The seal (seal.ts) moves the sealed material out
// of the worktree; this guard denies the other channels to it:
// - for every subagent of the job, at all times: the main checkout outside the job's worktree (the
//   job's state and the sealed store included), and Claude Code's transcripts and task outputs,
//   which hold the build agent's and the orchestrator's reasoning;
// - while the job is sealed, until a reviewer's own blind pass is written: the sealed names in the
//   job's folder, a second layer should a sealed file be written back there;
// - while the job is sealed: an orchestrator's prompt that names or quotes sealed material.
//
// A reviewer planned to verify in the sealed pass (review-plan.ts) has no blind pass: it reads the
// previous merged findings and its own earlier final reports, in the sealed store or by their names,
// and the orchestrator may name them to it. The rest of the sealed material stays closed to it.
//
// A nested run (an agent's Explore) has its own agent type, so these rules hold for any subagent,
// not only the four factory agents. The orchestrator (no agent) reads anything.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { commandPaths, type NamedPath } from './bash-words.ts'
import { jobsDir } from './job.ts'
import { isWithin } from './paths.ts'
import { allow, deny, type GuardContext, type Policy, type Verdict } from './policy.ts'
import { plannedTask, reviewerRole, verifierMayRead } from './review-plan.ts'
import {
  blindPassFile,
  isSealedName,
  loadSeal,
  sealedStore,
  type ReviewerRole,
  type Seal,
} from './seal.ts'

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

const GLOB = /[*?[{]/
const isGlob = (path: string) => GLOB.test(path)

/** The folder a glob starts from: everything before its first segment with a glob character. */
const literalPrefix = (path: string) => {
  const at = path.search(GLOB)
  return at === -1 ? path : dirname(`${path.slice(0, at)}x`)
}

/** Where Claude Code keeps transcripts: ~/.claude/projects, and CLAUDE_CONFIG_DIR's when set. */
const transcripts = () => [
  join(homedir(), '.claude', 'projects'),
  ...(process.env.CLAUDE_CONFIG_DIR ? [join(process.env.CLAUDE_CONFIG_DIR, 'projects')] : []),
]
/** Claude Code keeps task outputs and scratchpads in /tmp/claude-<uid>/ (/private/tmp on macOS). */
const TASK_OUTPUTS = /^\/(?:private\/)?tmp\/claude-/

/**
 * Where Claude Code saves a tool call's output too long to return: a file the agent is then told
 * to read. It holds what commands printed, never an agent's reasoning, so it stays readable.
 */
const isToolResult = (path: string) =>
  !isGlob(path) &&
  transcripts().some((dir) => /^[^/]+\/[^/]+\/tool-results\/[^/]+$/.test(relative(dir, path)))

const where = (context: GuardContext) => ({
  cwd: str(context.input.cwd) ?? context.job.worktree,
  home: homedir(),
})

const transcriptsDenied = deny(
  "Claude Code's transcripts and task outputs (~/.claude/projects, /tmp/claude-*) hold other agents' reasoning: no agent of a factory job reads them, nor keeps files there. Work from the job's folder; when an output is too long, rerun the command narrowed (head, grep) instead of opening the saved file. A reviewer keeps scratch files in its own sandbox (bun run factory sandbox <n> <role>).",
)

const mainDenied = (context: GuardContext, path: string) =>
  isWithin(path, jobsDir(context.root))
    ? deny(
        `The job's state in the main checkout (${jobsDir(context.root)}/: job.json, events.jsonl, the sealed store) is out of every agent's reach. The job's files are in ${context.places.handoffDir}, in your worktree.`,
      )
    : deny(
        `${path} is in the main checkout, outside this job's worktree. Work in the worktree, ${context.job.worktree}.`,
      )

/**
 * Whether a path, or a glob, reaches into a place: under it, or an ancestor a search would walk.
 * The file system's root is no one's ancestor here: a lone `/` is far more often an argument
 * (`tr / -`) than a search of the whole disk.
 */
const reaches = (path: string, place: string) => {
  const start = isGlob(path) ? literalPrefix(path) : path
  return isWithin(start, place) || (start !== '/' && isWithin(place, start))
}

/**
 * The sealed paths a reviewer's blind pass must not name: whatever the seal moved, and the names
 * sealed material takes, so a file written back after the seal is denied too.
 */
function sealedCandidates(sealed: Seal): string[] {
  const reviews = Array.from({ length: sealed.pass - 1 }, (_, index) =>
    ['evaluator', 'test-reviewer', 'findings'].map((name) => `reviews/${index + 1}.${name}.md`),
  ).flat()
  return [
    ...new Set([
      'build-notes.md',
      'decision-requests',
      'diagnosis.md',
      'summary.md',
      ...reviews,
      ...sealed.files,
    ]),
  ]
}

/** The seal in force for this caller, or null when its blind pass is written or nothing is sealed. */
function blindSeal(context: GuardContext): Seal | null {
  const sealed = loadSeal(context.root, context.job.number)
  if (!sealed || !context.agent) return null
  const role = reviewerRole(context.agent.type)
  // Any other run (an Explore, the build agent) has no blind pass of its own to unlock it.
  return role && existsSync(blindPassFile(context.job, sealed.pass, role)) ? null : sealed
}

/** The verifier's role when the caller is a reviewer planned to verify in the sealed pass. */
const verifierIn = (job: GuardContext['job'], sealed: Seal, agentType: string | undefined) => {
  const role = agentType ? reviewerRole(agentType) : null
  return role && plannedTask(job, sealed.pass, role) === 'verify' ? role : null
}

/** A sealed file's name without its pass number: `findings.md`, `evaluator.md`. */
const stem = (rel: string) => basename(rel).replace(/^\d+\./, '')

/** Whether a path or glob names sealed material in the job's folder. */
function namesSealed(path: string, sealed: Seal, handoff: string, listing: boolean): string | null {
  if (!isGlob(path)) {
    return isWithin(path, handoff) && isSealedName(relative(handoff, path))
      ? relative(handoff, path)
      : null
  }
  const prefix = literalPrefix(path)
  if (isWithin(prefix, handoff) && isSealedName(relative(handoff, prefix))) {
    return relative(handoff, prefix)
  }
  // A listing shows names, and the seal took the files away: only a read by pattern counts.
  if (listing) return null
  const glob = new Bun.Glob(path)
  const aimed = isWithin(prefix, handoff)
  return (
    sealedCandidates(sealed).find(
      (rel) => (aimed || path.includes(stem(rel))) && glob.match(join(handoff, rel)),
    ) ?? null
  )
}

/** The verdict on one path a subagent reads or names. */
export function readVerdict(path: string, context: GuardContext, listing = false): Verdict {
  if (!context.agent) return allow
  if (isToolResult(path)) return allow
  if (transcripts().some((dir) => reaches(path, dir)) || TASK_OUTPUTS.test(path)) {
    return transcriptsDenied
  }
  // `/tmp` itself, walked by a search, reaches the task outputs too.
  if (!isGlob(path) && ['/tmp', '/private/tmp'].includes(path)) return transcriptsDenied
  const start = isGlob(path) ? literalPrefix(path) : path
  const { root, job } = context
  const sealed = blindSeal(context)
  const verifier = sealed && verifierIn(job, sealed, context.agent.type)
  const store = sealedStore(root, job.number)
  if (verifier && !isGlob(path) && isWithin(path, store)) {
    if (verifierMayRead(verifier, relative(store, path))) return allow
  }
  if (reaches(start, root) && !isWithin(start, job.worktree)) return mainDenied(context, start)
  const name = sealed && namesSealed(path, sealed, context.places.handoffDir, listing)
  if (sealed && name) {
    if (verifier && verifierMayRead(verifier, name)) return allow
    const role = reviewerRole(context.agent.type)
    return deny(
      verifier
        ? `${name} stays sealed while another reviewer writes its blind pass. A verify pass reads the previous merged findings and your own earlier final report (in ${store}/reviews/) and the diff since the last reviewed HEAD, nothing else.`
        : role
          ? `${name} is sealed until your blind first pass is written. Write ${context.places.handoffDir}/reviews/${sealed.pass}.${role}.blind.md from the issue, the diff, the checks and gate.json alone; the orchestrator sends you the build notes after it.`
          : `${name} is sealed while the reviewers write their blind first passes, and no run reads it until \`factory unseal\`. Work from the issue, the diff, the checks and gate.json.`,
    )
  }
  return allow
}

const first = (verdicts: Iterable<Verdict>) => {
  for (const verdict of verdicts) if (!verdict.ok) return verdict
  return allow
}

/** Programs that show names, not content. */
const LISTERS = new Set(['ls', 'stat', 'file', 'du', 'tree', 'cd'])

/** Every path a subagent's Bash command names, the folder it runs in first. */
export function bashReadVerdict(command: string, context: GuardContext): Verdict {
  if (!context.agent) return allow
  const at = where(context)
  const named: NamedPath[] = [
    { path: resolve(at.cwd), program: 'cd', read: false },
    ...commandPaths(command, at),
  ]
  return first(named.map((item) => readVerdict(item.path, context, LISTERS.has(item.program))))
}

export const readPolicy: Policy = (context) => {
  if (!context.agent) return allow
  const input = context.input.tool_input ?? {}
  const { cwd } = where(context)
  const at = (path: string) => (isAbsolute(path) ? resolve(path) : resolve(cwd, path))
  switch (context.input.tool_name) {
    case 'Read': {
      const path = str(input.file_path) ?? str(input.notebook_path)
      return path ? readVerdict(at(path), context) : allow
    }
    case 'Grep': {
      const base = at(str(input.path) ?? cwd)
      const glob = str(input.glob)
      // Grep's glob matches file names at any depth under its path.
      const filtered = glob
        ? [join(base, glob), ...(glob.includes('/') ? [] : [join(base, '**', glob)])]
        : []
      return first([base, ...filtered].map((path) => readVerdict(path, context)))
    }
    case 'Glob': {
      const base = at(str(input.path) ?? cwd)
      const pattern = str(input.pattern) ?? ''
      return first(
        [base, isAbsolute(pattern) ? pattern : join(base, pattern)].map((path) =>
          readVerdict(path, context, true),
        ),
      )
    }
    default:
      return allow
  }
}

/** Names of sealed material as a prompt would write them. */
const SEALED_WORDS =
  /build-notes|decision-requests|diagnosis\.md|summary\.md|findings\.md|reviews\/\d+\.(?:evaluator|test-reviewer)\.md|\/sealed\//gi

/** What a verifier may be told: where its inputs are, and their names. */
const verifierMayHear = (role: string, word: string) =>
  /^(?:findings\.md|\/sealed\/)$/i.test(word) ||
  new RegExp(`^reviews/\\d+\\.${role}\\.md$`, 'i').test(word)

/**
 * Lines long enough that finding one in a prompt means it was pasted, not written anew; `skip`
 * leaves out the files, by their path relative to the store, the prompt's reader may read.
 */
function sealedLines(dir: string, skip: (rel: string) => boolean, prefix = ''): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(path).isDirectory()) return sealedLines(path, skip, rel)
    if (skip(rel)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length >= 40)
  })
}

/**
 * What sealed material a prompt names or quotes, or null when it holds none. A prompt to a
 * verifier may name and quote the verifier's own inputs.
 */
function sealedInPrompt(
  text: string,
  root: string,
  number: number,
  verifier: ReviewerRole | null,
): string | null {
  const named = [...text.matchAll(SEALED_WORDS)]
    .map((match) => match[0])
    .find((word) => !verifier || !verifierMayHear(verifier, word))
  if (named) return `names ${named}`
  const skip = (rel: string) => verifier !== null && verifierMayRead(verifier, rel)
  const quoted = sealedLines(sealedStore(root, number), skip).find((line) => text.includes(line))
  return quoted ? `quotes "${quoted.slice(0, 60)}…"` : null
}

/** While the job is sealed, the orchestrator's prompt carries no sealed material to any agent. */
const promptPolicy =
  (...fields: string[]): Policy =>
  (context) => {
    if (context.agent) return allow
    const sealed = loadSeal(context.root, context.job.number)
    if (!sealed) return allow
    const text = fields.map((field) => str(context.input.tool_input?.[field]) ?? '').join('\n')
    const recipient = str(context.input.tool_input?.subagent_type)
    const verifier = verifierIn(context.job, sealed, recipient)
    const found = sealedInPrompt(text, context.root, context.job.number, verifier)
    if (!found) return allow
    const n = context.job.number
    return deny(
      `Job #${n} is sealed for review pass ${sealed.pass} until every sealed reviewer wrote its blind pass, and this prompt ${found}. Give a reviewer only the issue, the worktree, the job's folder, the pass and gate.json. Once the blind passes exist, run \`bun run factory unseal ${n}\`, then send the build notes.`,
    )
  }

export const agentPolicy: Policy = promptPolicy('prompt', 'description')

export const messagePolicy: Policy = promptPolicy('message', 'summary')
