// The guard's policy for reads (Read, Grep, Glob, and the paths a Bash command names) and for the
// prompts the orchestrator hands the agents it launches or messages (Agent, SendMessage).
//
// Two layers keep a reviewer's blind pass blind. The seal (seal.ts) moves the sealed material out
// of the worktree; this guard denies the other channels to it:
// - for every subagent of the job, at all times: the main checkout outside the job's worktree (the
//   job's state and the sealed store included), and Claude Code's own files (~/.claude, its
//   transcripts and file history, and its task outputs in the temp folder), which hold the build
//   agent's and the orchestrator's reasoning; a search from `/` reaches all of them;
// - for a reviewer, at all times: the other reviewer's sandbox;
// - while the job is sealed, until a reviewer's own blind pass is written: the sealed names in the
//   job's folder, a second layer should a sealed file be written back there;
// - while the job is sealed: an orchestrator's prompt that names or quotes sealed material.
//
// A reviewer planned to verify in the pass under way (review-plan.ts) has no blind pass: until its
// final report is written, it reads the previous merged findings and its own earlier final reports,
// in the sealed store or by their names, and the orchestrator may name them to it. The rest of the
// sealed names stays closed to it, sealed or not.
//
// Every path is judged where it leads (paths.ts canonical): a symlink reaches nothing its target
// wouldn't.
//
// A nested run (an agent's Explore) has its own agent type, so these rules hold for any subagent,
// not only the four factory agents. The orchestrator (no agent) reads anything.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { commandPaths, type NamedPath } from './bash-words.ts'
import { readEvents } from './events.ts'
import { jobsDir, REVIEWER_ROLES, reviewPass } from './job.ts'
import { canonical, isWithin, JOBS_FOLDER } from './paths.ts'
import { COPIED_WORDS, sharedPhrase } from './phrases.ts'
import {
  allow,
  bashWhere,
  deny,
  first,
  type GuardContext,
  type Policy,
  type Verdict,
} from './policy.ts'
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

/**
 * Claude Code's own folders: ~/.claude, and CLAUDE_CONFIG_DIR when set. Its transcripts, file
 * history, task lists and history hold every session's reasoning and every file it wrote.
 */
const claudeDirs = () => [
  canonical(join(homedir(), '.claude')),
  ...(process.env.CLAUDE_CONFIG_DIR ? [canonical(process.env.CLAUDE_CONFIG_DIR)] : []),
]

/** Where Claude Code keeps task outputs and scratchpads: claude-<uid>/ in /tmp and in $TMPDIR. */
const taskOutputDirs = () => {
  const uid = process.getuid?.() ?? 0
  return [`/private/tmp/claude-${uid}`, canonical(join(tmpdir(), `claude-${uid}`))]
}
/** Task outputs of any user, in /tmp or in a macOS per-user temp folder. */
const TASK_OUTPUTS = /^\/(?:private\/)?(?:tmp|var\/folders\/[^/]+\/[^/]+\/T)\/claude-/

/**
 * Where Claude Code saves a tool call's output too long to return: a file the agent is then told
 * to read. It holds what commands printed, never an agent's reasoning, so it stays readable.
 */
const isToolResult = (path: string) =>
  !isGlob(path) &&
  claudeDirs().some((dir) =>
    /^projects\/[^/]+\/[^/]+\/tool-results\/[^/]+$/.test(relative(dir, path)),
  )

/** Folders that, searched whole, reach the main checkout or Claude Code's files. */
const searchRoots = () =>
  new Set(['/', '/private', '/Users', '/var', '/private/var', '/tmp', '/private/tmp', homedir()])

const claudeDenied = deny(
  "Claude Code's own files (~/.claude and CLAUDE_CONFIG_DIR: transcripts, file history, history, tasks; and the task outputs in /tmp/claude-* and $TMPDIR/claude-*) hold other agents' reasoning: no agent of a factory job reads them, nor keeps files there. One exception: when Claude Code tells you a long output was saved to a tool-results file, read that file. Work from the job's folder; a reviewer keeps scratch files in its own sandbox (bun run factory sandbox <n> <role>).",
)

const searchDenied = (path: string) =>
  deny(
    `A search from ${path} walks the main checkout and Claude Code's own files. Search the worktree, or name the folder you need.`,
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
 * The file system's root is an ancestor only for a search: a lone `/` is far more often an
 * argument (`tr / -`) than a search of the whole disk, and `find /` is denied as a search.
 */
const reaches = (path: string, place: string, search = false) => {
  const start = isGlob(path) ? literalPrefix(path) : path
  return isWithin(start, place) || ((search || start !== '/') && isWithin(place, start))
}

/** A path as the file system reaches it; for a glob, its literal folder resolved, the rest kept. */
function judged(path: string): string {
  if (!isGlob(path)) return canonical(path)
  const prefix = literalPrefix(path)
  return `${canonical(prefix)}${path.slice(prefix.length)}`
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

/**
 * The role of a reviewer planned to verify in the pass under way that hasn't written its final
 * report: sealed or not, it reads only its own inputs among the sealed names.
 */
function pendingVerifier(context: GuardContext): ReviewerRole | null {
  const role = context.agent ? reviewerRole(context.agent.type) : null
  const pass = reviewPass(context.job)
  if (!role || plannedTask(context.job, pass, role) !== 'verify') return null
  return existsSync(join(context.places.handoffDir, 'reviews', `${pass}.${role}.md`)) ? null : role
}

/**
 * Whether any reviewer planned to verify in the pass under way hasn't written its final report.
 * Such a reviewer reads only its own inputs, and so does everyone else: the sealed names stay closed
 * to a nested run under it, which can't be told apart from a stranger.
 */
function anyPendingVerifier(context: GuardContext): boolean {
  const pass = reviewPass(context.job)
  return REVIEWER_ROLES.some(
    (role) =>
      plannedTask(context.job, pass, role) === 'verify' &&
      !existsSync(join(context.places.handoffDir, 'reviews', `${pass}.${role}.md`)),
  )
}

/** The other reviewer's sandbox, which a reviewer neither reads nor writes. */
const otherSandbox = (context: GuardContext): string | null => {
  const role = context.agent ? reviewerRole(context.agent.type) : null
  const other = role && REVIEWER_ROLES.find((candidate) => candidate !== role)
  return other ? join(context.places.handoffDir, 'sandbox', other) : null
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

/**
 * Whether a glob can match a place, or something under it: its literal folder is the place or above
 * it, and each segment after that fits the place's own segment, or the pattern runs on past it.
 */
function globReaches(glob: string, place: string): boolean {
  const prefix = literalPrefix(glob)
  if (!isWithin(place, prefix)) return false
  const rest = relative(prefix, place).split('/').filter(Boolean)
  const segments = glob.slice(prefix.length).split('/').filter(Boolean)
  for (const [index, segment] of segments.entries()) {
    // A brace may hold a slash; it is read as reaching.
    if (segment.includes('**') || /[{}]/.test(segment) || index >= rest.length) return true
    if (!new Bun.Glob(segment).match(rest[index]!)) return false
  }
  return segments.length >= rest.length
}

/**
 * The verdict on a path, or a glob, that reaches a place the caller must not read: a walk from
 * above it, a glob over it. The place itself and what is under it are judged by name elsewhere.
 * `rg`, `grep` and the Grep and Glob tools skip what .gitignore lists, the job's folder among it,
 * so a root above `factory/.jobs/` stays allowed for them; a root inside it is searched even when
 * ignored.
 */
function reachesPlace(
  path: string,
  start: string,
  how: Reading,
  place: string,
  context: GuardContext,
): boolean {
  const walk = isGlob(path) ? globReaches(path, place) : how.search && isWithin(place, start)
  if (!walk) return false
  const explicit = isWithin(start, join(context.job.worktree, JOBS_FOLDER))
  const skipped = how.ignoring && (how.tool || !isGlob(path)) && !explicit
  return !skipped
}

/** The other reviewer's blind passes this caller may not read yet. */
function closedBlindPasses(context: GuardContext): string[] {
  const dir = join(context.places.handoffDir, 'reviews')
  if (!context.agent || !existsSync(dir)) return []
  const role = reviewerRole(context.agent.type)
  const sealed = loadSeal(context.root, context.job.number) !== null
  return readdirSync(dir).flatMap((name) => {
    const match = /^(\d+)\.(evaluator|test-reviewer)\.blind\.md$/.exec(name)
    if (!match || match[2] === role) return []
    // A reviewer reads the other's blind pass of a pass once its own for that pass is written; any
    // other run, while the job is sealed.
    const open = role ? existsSync(blindPassFile(context.job, Number(match[1]), role)) : !sealed
    return open ? [] : [join(dir, name)]
  })
}

export type Reading = {
  /** The call is the Grep or the Glob tool: its patterns skip what .gitignore lists too. */
  tool?: boolean
  /** The program shows names, not content (ls, stat). */
  listing?: boolean
  /** The path is the root of a recursive walk, or where a symlink leads. */
  search?: boolean
  /** The walk skips what .gitignore lists (rg, grep in Claude Code's shell, the Grep tool). */
  ignoring?: boolean
}

/** The verdict on one path a subagent reads or names. */
export function readVerdict(raw: string, context: GuardContext, how: Reading = {}): Verdict {
  if (!context.agent) return allow
  const { listing = false, search = false, ignoring = false } = how
  const path = judged(raw)
  if (isToolResult(path)) return allow
  if (path === '/proc' || path.startsWith('/proc/')) {
    return deny(
      "/proc shows every process's command line and environment, the other reviewer's included: no agent of a factory job reads it.",
    )
  }
  const start = isGlob(path) ? literalPrefix(path) : path
  if (search && searchRoots().has(start)) return searchDenied(start)
  if (
    claudeDirs().some((dir) => reaches(path, dir, search)) ||
    taskOutputDirs().some((dir) => reaches(path, dir, search)) ||
    TASK_OUTPUTS.test(path)
  ) {
    return claudeDenied
  }
  // The temp folders themselves, listed or walked, reach the task outputs too.
  if (!isGlob(path) && ['/private/tmp', canonical(tmpdir())].includes(path)) return claudeDenied
  const { root, job } = context
  const other = otherSandbox(context)
  if (other && isWithin(start, other)) {
    return deny(
      `${start} is the other reviewer's sandbox: its mutations are its evidence, not yours. Work in your own, ${join(context.places.handoffDir, 'sandbox', reviewerRole(context.agent.type) ?? '')}.`,
    )
  }
  // A nested run (an Explore) has no link in the hook input to the reviewer that launched it, so
  // no run but a reviewer is told apart from a stranger: the sandboxes are a reviewer's alone.
  const sandboxes = join(context.places.handoffDir, 'sandbox')
  if (!reviewerRole(context.agent.type) && isWithin(start, sandboxes)) {
    return deny(
      `${start} is in a reviewer's sandbox, its evidence: only a reviewer reads there (the hook input names no parent for a nested run, so an Explore can't be told from a stranger). Read the worktree instead.`,
    )
  }
  const pending = pendingVerifier(context)
  const sealed =
    blindSeal(context) ??
    (pending || anyPendingVerifier(context)
      ? { pass: reviewPass(job), roles: [], files: [], at: '' }
      : null)
  const verifier = sealed && (pending ?? verifierIn(job, sealed, context.agent.type))
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
        ? `${name} is not an input of a verify pass. It reads the previous merged findings and your own earlier final report, at the paths the orchestrator gave you, and the diff since the last reviewed HEAD, nothing else.`
        : role
          ? `${name} is sealed until your blind first pass is written. Write ${context.places.handoffDir}/reviews/${sealed.pass}.${role}.blind.md from the issue, the diff, the checks and gate.json alone; the orchestrator sends you the build notes after it.`
          : `${name} is sealed while the reviewers write their blind first passes, and no run reads it until \`factory unseal\`. Work from the issue, the diff, the checks and gate.json.`,
    )
  }
  if (sealed && search) {
    const searched = searchVerdict(start, context, ignoring)
    if (!searched.ok) return searched
  }
  const walked = sandboxWalkVerdict(path, start, how, context)
  if (walked) return walked
  const closed = listing
    ? undefined
    : closedBlindPasses(context).find((file) =>
        isGlob(path)
          ? globReaches(path, file)
          : file === path || reachesPlace(path, start, how, file, context),
      )
  if (closed) {
    return deny(
      `${relative(context.places.handoffDir, closed)} is the other reviewer's blind first pass: it stays closed until your own blind pass for that pass is written, so the two stay independent. Write yours from the issue, the diff, the checks and gate.json alone.`,
    )
  }
  return allow
}

/**
 * A reviewer's walk, or glob, that reaches the other reviewer's sandbox, and any other run's that
 * reaches the sandboxes folder: each sandbox is its reviewer's evidence. Null when it reaches none.
 */
function sandboxWalkVerdict(
  path: string,
  start: string,
  how: Reading,
  context: GuardContext,
): Verdict | null {
  const role = context.agent ? reviewerRole(context.agent.type) : null
  const sandboxes = join(context.places.handoffDir, 'sandbox')
  // A worker's walk from above the sandboxes only matters once a reviewer made one.
  const place = role ? otherSandbox(context) : existsSync(sandboxes) ? sandboxes : null
  if (!place || !reachesPlace(path, start, how, place, context)) return null
  return deny(
    `${start} reaches ${role ? "the other reviewer's sandbox" : "the reviewers' sandboxes"}, its evidence: a walk (find, ls -R, tar, du, rg or grep rooted in factory/.jobs/, a glob over sandbox/*) is not yours to make from there. Search the code, scoped to apps/ or packages/ (rg and grep from the worktree root skip factory/.jobs/)${role ? `, or your own sandbox, ${join(context.places.handoffDir, 'sandbox', role)}` : ''}.`,
  )
}

/**
 * A walk that holds the job's folder while a reviewer may not read it yet: rooted in the folder,
 * or in an ancestor of it that doesn't skip what .gitignore lists. `rg` and `grep` (and the Grep
 * tool) from the worktree root skip the gitignored folder, so they pass; `find`, `tar`, `du`,
 * `tree`, `ls -R` and `cp -r` don't, and a reviewer scopes them to `apps/` or `packages/`.
 */
function searchVerdict(start: string, context: GuardContext, ignoring: boolean): Verdict {
  const handoff = context.places.handoffDir
  const rel = relative(handoff, start)
  const inside = isWithin(start, handoff)
  // The folder itself, or `reviews/`, which holds the sealed reports: a root the walk names
  // explicitly is searched even when ignored. Deeper inputs are judged name by name.
  if (inside && (rel === '' || rel === 'reviews' || rel === 'decision-requests')) {
    return deny(
      `${start} holds files you may not read yet (the build notes, Decision Requests, earlier reports: they open after your blind first pass is written, or are not your inputs). Search the code, apps/ or packages/, or name the files you were given.`,
    )
  }
  const above = isWithin(handoff, start) && !inside
  if (above && !ignoring) {
    return deny(
      `${start} is above the job's folder, which holds files you may not read yet, and this walk doesn't skip it. Scope find (and tar, du, tree, ls -R) to apps/ or packages/; rg and grep from the worktree root skip the job's folder.`,
    )
  }
  return allow
}

/** Programs that show names, not content. */
const LISTERS = new Set(['ls', 'stat', 'file', 'du', 'tree', 'cd'])

/** Every path a subagent's Bash command names, the folder it runs in first. */
export function bashReadVerdict(command: string, context: GuardContext): Verdict {
  if (!context.agent) return allow
  const at = bashWhere(context)
  const named: NamedPath[] = [
    { path: at.cwd, program: 'cd', read: false },
    ...commandPaths(command, at),
  ]
  return first(
    named.map((item) =>
      readVerdict(item.path, context, {
        listing: LISTERS.has(item.program),
        search: item.search ?? false,
        ignoring: item.ignoring ?? false,
      }),
    ),
  )
}

export const readPolicy: Policy = (context) => {
  if (!context.agent) return allow
  const input = context.input.tool_input ?? {}
  const { cwd } = bashWhere(context)
  const at = (path: string) => (isAbsolute(path) ? path : `${cwd}/${path}`)
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
      return first(
        [base, ...filtered].map((path, index) =>
          readVerdict(path, context, { search: index === 0, ignoring: true, tool: true }),
        ),
      )
    }
    case 'Glob': {
      const base = at(str(input.path) ?? cwd)
      const pattern = str(input.pattern) ?? ''
      return first(
        [base, isAbsolute(pattern) ? pattern : join(base, pattern)].map((path) =>
          readVerdict(path, context, { listing: true, search: true, ignoring: true, tool: true }),
        ),
      )
    }
    default:
      return allow
  }
}

/** Names of sealed material as a prompt would write them; the sealed store with or without `/`. */
const SEALED_WORDS =
  /build[- ]notes|decision[- ]requests?|diagnosis\.md|summary\.md|findings\.md|reviews\/\d+\.(?:evaluator|test-reviewer)\.md|\/sealed(?![\w.-])/gi

/** What a verifier may be told: where its inputs are, and their names. */
const verifierMayHear = (role: string, word: string) =>
  /^(?:findings\.md|\/sealed)$/i.test(word) ||
  new RegExp(`^reviews/\\d+\\.${role}\\.md$`, 'i').test(word)

/** Every sealed file's text, but those `skip` leaves out by their path relative to the store. */
function sealedTexts(dir: string, skip: (rel: string) => boolean, prefix = ''): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(path).isDirectory()) return sealedTexts(path, skip, rel)
    return skip(rel) ? [] : [readFileSync(path, 'utf8')]
  })
}

/** Words only: case, punctuation and line breaks don't hide a pasted phrase. */
const normalized = (text: string) => text.toLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, ' ')

/**
 * What sealed material a text names or quotes, or null when it holds none. Quoting is sharing
 * COPIED_WORDS words in a row with a sealed file, as `factory round` judges a findings file. A
 * prompt to a verifier may name and quote the verifier's own inputs.
 */
export function sealedIn(
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
  const ours = normalized(text)
  for (const sealedText of sealedTexts(sealedStore(root, number), skip)) {
    const quoted = sharedPhrase(ours, normalized(sealedText), COPIED_WORDS)
    if (quoted) return `quotes "${quoted.slice(0, 60)}…"`
  }
  return null
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
    const found = sealedIn(text, context.root, context.job.number, verifier)
    if (!found) return allow
    const n = context.job.number
    return deny(
      `Job #${n} is sealed for review pass ${sealed.pass} until every sealed reviewer wrote its blind pass, and this prompt ${found}. Give a reviewer only the issue, the worktree, the job's folder, the pass and gate.json. Once the blind passes exist, run \`bun run factory unseal ${n}\`, then send the build notes.`,
    )
  }

export const agentPolicy: Policy = promptPolicy('prompt', 'description')

/**
 * While the job is sealed, a message reaches only a run the log shows started after the seal, or
 * one that isn't a reviewer: a reviewer launched earlier read the build notes in an earlier pass,
 * and a blind pass it wrote on a message would not be blind. A recipient the log can't place is
 * denied too; a fresh Agent call makes the reviewer to write the blind pass.
 */
const staleRecipient: Policy = (context) => {
  if (context.agent) return allow
  const sealed = loadSeal(context.root, context.job.number)
  if (!sealed) return allow
  const to = str(context.input.tool_input?.to)
  const events = readEvents(context.root, context.job.number)
  const start = events.find((event) => event.kind === 'agent.start' && event.agent?.id === to)
  const type = start?.agent?.type
  if (start && type && !reviewerRole(type)) return allow
  if (start && start.t >= sealed.at) return allow
  const n = context.job.number
  return deny(
    `Job #${n} is sealed for review pass ${sealed.pass}: ${to ?? 'that recipient'} ${start ? 'started before the seal, so it may have read the build notes' : "can't be placed by the log"}, and a blind pass it wrote on a message would not be blind. Launch a fresh reviewer with an Agent call (bun run factory launch ${n} <agent> --task review) instead of messaging one.`,
  )
}

export const messagePolicy: Policy = (context) =>
  first([promptPolicy('message', 'summary')(context), staleRecipient(context)])
