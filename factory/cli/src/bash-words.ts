// How the guard and factory watch read a Bash command. Both read it with these functions, so what
// the guard denies and what the page flags never disagree.
//
// This reads the command text only. A path built at runtime ("$a/$b", a variable set by another
// command) or a script written first and run after is out of its sight: the guard stops what a
// hurried agent types, and the seal keeps the files themselves out of reach. What it can't read,
// it says: a command substitution leaves the word SUBSTITUTION, and a variable stays `$NAME`.

import { existsSync, statSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { canonical } from './paths.ts'

/** The word a command substitution, `$(…)`, `…` or `<(…)`, leaves in the command around it. */
const SUBSTITUTION = '$SUBST'

/** A heredoc's opening: `<<EOF`, `<<-'EOF'`; not a here-string, `<<<`. */
const HEREDOC = /(?<!<)<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/
/** Programs that run a heredoc's body as a script: its lines are commands, not text. */
const RUNS_HEREDOC = /(?:^|[\s;&|(])(?:bash|sh|zsh|python3?|node|bun|perl|ruby)\b[^;&|]*<</

/** Drops heredoc bodies, the text a command reads, unless a shell or an interpreter runs it. */
function withoutHeredocs(command: string): string {
  const kept: string[] = []
  let delimiter: string | null = null
  for (const line of command.split('\n')) {
    if (delimiter !== null) {
      if (line.trim() === delimiter) delimiter = null
      continue
    }
    kept.push(line)
    const heredoc = HEREDOC.exec(line)
    // `factory sandbox exec … -- psql <<EOF`: the program that reads the body is the one after `--`.
    const reader =
      /\bsandbox\s+exec\b/.test(line) && line.includes(' -- ')
        ? line.slice(line.indexOf(' -- '))
        : line
    if (heredoc && !RUNS_HEREDOC.test(reader)) delimiter = heredoc[2] ?? null
  }
  return kept.join('\n')
}

/** Where the substitution opened at `from` (just past `$(`) closes, quotes and nesting followed. */
function closingParen(text: string, from: number): number {
  let depth = 1
  let quote: string | null = null
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '\\') i++
    else if (c === "'" || c === '"') quote = c
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return text.length
}

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')'])

/**
 * Reads a command as the shell would split it: quotes and escapes undone, separators (`;`, `&`,
 * `|`, newlines, parentheses) only outside quotes, a redirection operator its own word (`>`, `2>`,
 * `>>`, `<`, `<<`, `<<<`), file-descriptor duplications (`2>&1`) dropped, comments dropped. A
 * substitution's commands come first, and leave SUBSTITUTION in the word that used them.
 */
function lex(command: string): string[][] {
  const commands: string[][] = []
  let words: string[] = []
  let word: string | null = null
  let quote: string | null = null
  const inner: string[][] = []
  const endWord = () => {
    if (word !== null) words.push(word)
    word = null
  }
  const endCommand = () => {
    endWord()
    commands.push(...inner.splice(0))
    if (words.length) commands.push(words)
    words = []
  }
  const text = command
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quote === "'") {
      if (c === "'") quote = null
      else word += c
      continue
    }
    if (c === '\\') {
      word = (word ?? '') + (text[i + 1] === '\n' ? '' : (text[i + 1] ?? ''))
      i++
      continue
    }
    const opens = (c === '$' || (!quote && (c === '<' || c === '>'))) && text[i + 1] === '('
    if (opens || c === '`') {
      const start = c === '`' ? i + 1 : i + 2
      const end = c === '`' ? text.indexOf('`', start) : closingParen(text, start)
      const close = end === -1 ? text.length : end
      inner.push(...lex(text.slice(start, close)))
      word = (word ?? '') + SUBSTITUTION
      i = close
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = null
      else word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      word ??= ''
      continue
    }
    if (c === '#' && word === null) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++
      continue
    }
    if (c === '&' && text[i + 1] === '>') continue
    if (c === '>' || c === '<') {
      const fd = word !== null && /^\d+$/.test(word) ? word : ''
      if (!fd) endWord()
      word = null
      let operator = c
      while (i + 1 < text.length && /[<>|&-]/.test(text[i + 1]!) && operator.length < 3) {
        operator += text[++i]
      }
      if (operator.endsWith('&')) {
        // A duplication, `2>&1`, `>&-`: no file.
        while (i + 1 < text.length && /[\d-]/.test(text[i + 1]!)) i++
        continue
      }
      words.push(fd + operator.replace(/\|$/, ''))
      continue
    }
    if (SEPARATORS.has(c)) {
      endCommand()
      continue
    }
    if (/\s/.test(c)) {
      endWord()
      continue
    }
    word = (word ?? '') + c
  }
  endCommand()
  return commands
}

/** The command split into simple commands, each a list of words, with quoting and escapes undone. */
function simpleCommands(command: string): string[][] {
  return lex(withoutHeredocs(command))
}

/** A path a command names, absolute and as written (symlinks unresolved); it may hold globs. */
export type NamedPath = {
  path: string
  program: string
  /** The program reads the file's content: a reader's file argument or a `<` input. */
  read: boolean
  /** The program writes it: a `>` target, or what a writer (tee, cp, rm…) changes. */
  write?: boolean
  /** The root of a recursive walk (find, rg, grep -r…), or where a symlink leads. */
  search?: boolean
  /** The walk honors .gitignore (rg, and grep in Claude Code's shell), so it skips ignored folders. */
  ignoring?: boolean
  /** The write reaches everything below the path when it is a folder: rm, mv, a copy into it, tar x. */
  tree?: boolean
  /** The write is narrowed by a filter (`find -name`), so a folder above a protected one isn't it. */
  filtered?: boolean
}

type Reader = {
  /** Its first operand is a pattern, a script or a filter, not a file. */
  pattern?: true
  /** Flags that take values, and how many. */
  values?: Record<string, number>
  /** Flags that give the pattern, so the first operand is a file. */
  patternFlags?: readonly string[]
}

const GREP: Reader = {
  pattern: true,
  values: { '-A': 1, '-B': 1, '-C': 1, '-m': 1, '-e': 1, '-f': 1, '-g': 1, '-t': 1, '--glob': 1 },
  patternFlags: ['-e', '-f', '--regexp', '--file'],
}
const HEAD: Reader = { values: { '-n': 1, '-c': 1 } }

/** Programs that print or copy the content of the files they are given. */
const READERS: Record<string, Reader> = {
  cat: {},
  tac: {},
  nl: {},
  less: {},
  more: {},
  bat: {},
  strings: {},
  od: {},
  xxd: {},
  hexdump: {},
  base64: {},
  wc: {},
  diff: {},
  cmp: {},
  comm: {},
  uniq: {},
  cp: { values: { '-t': 1, '-S': 1 } },
  install: { values: { '-m': 1, '-o': 1, '-g': 1, '-t': 1 } },
  head: HEAD,
  tail: HEAD,
  sort: { values: { '-k': 1, '-t': 1, '-o': 1 } },
  cut: { values: { '-d': 1, '-f': 1, '-c': 1, '-b': 1 } },
  grep: GREP,
  egrep: GREP,
  fgrep: GREP,
  rg: GREP,
  sed: {
    pattern: true,
    values: { '-e': 1, '-f': 1 },
    patternFlags: ['-e', '-f', '--expression', '--file'],
  },
  awk: { pattern: true, values: { '-f': 1, '-v': 1, '-F': 1 }, patternFlags: ['-f'] },
  jq: {
    pattern: true,
    values: { '--arg': 2, '--argjson': 2, '--slurpfile': 2, '--rawfile': 2, '--indent': 1 },
  },
}

/** Programs that change every file they are given. */
const WRITERS: Record<string, Record<string, number>> = {
  tee: {},
  rm: {},
  rmdir: {},
  unlink: {},
  shred: {},
  touch: { '-t': 1, '-r': 1, '-d': 1 },
  mkdir: { '-m': 1 },
  truncate: { '-s': 1, '-r': 1 },
  mv: { '-t': 1, '-S': 1 },
  // Editors run from a script: `ed -s file <<< w`, `ex -sc 'w' -c q file`, `vi -es file`.
  ed: { '-p': 1 },
  ex: { '-c': 1, '-sc': 1, '-S': 1, '-u': 1, '-T': 1, '--cmd': 1 },
  vi: { '-c': 1, '-S': 1, '-u': 1, '-T': 1, '--cmd': 1 },
  vim: { '-c': 1, '-S': 1, '-u': 1, '-T': 1, '--cmd': 1 },
  nvim: { '-c': 1, '-S': 1, '-u': 1, '-T': 1, '--cmd': 1 },
  patch: { '-i': 1, '--input': 1, '-d': 1, '--directory': 1, '-p': 1, '-r': 1, '-F': 1, '-V': 1 },
}
/** Writers whose operands are folders to remove or move as a whole. */
const TREE_WRITERS = new Set(['rm', 'rmdir', 'mv', 'shred'])
/** Editors: `+cmd` is a command, not a file. */
const EDITORS = new Set(['ed', 'ex', 'vi', 'vim', 'nvim'])

/** Programs that walk a tree from each path they are given. */
const SEARCHERS = new Set(['find', 'fd', 'rg', 'ag', 'ack', 'du', 'tree', 'tar', 'zip', 'rsync'])
/** Programs that walk a tree only when told to, and the flag that tells them: grep -r, ls -R. */
const GREP_RECURSIVE = /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive|--dereference-recursive)$/
const RECURSIVE_FLAGS: Record<string, RegExp> = {
  grep: GREP_RECURSIVE,
  egrep: GREP_RECURSIVE,
  fgrep: GREP_RECURSIVE,
  ls: /^(?:-[a-zA-Z]*R[a-zA-Z]*|--recursive)$/,
  cp: /^(?:-[a-zA-Z]*[rRa][a-zA-Z]*|--recursive|--archive)$/,
  scp: /^-[a-zA-Z]*r[a-zA-Z]*$/,
}

/** Searchers that skip what .gitignore lists, unless told not to. */
const IGNORING = new Set(['rg', 'grep', 'egrep', 'fgrep', 'ugrep'])
const NO_IGNORE = /^(?:--no-ignore.*|-u+|--unrestricted|--hidden)$/

/** Value flags of the other programs this reads: `ln -t <dir>`. */
const OTHER_VALUES: Record<string, Record<string, number>> = {
  ln: { '-t': 1, '-S': 1 },
  rsync: { '-e': 1, '--rsh': 1, '--exclude': 1, '--include': 1, '--filter': 1, '-f': 1 },
}

/** Programs whose `-t <dir>` names the folder they write into. */
const INTO_TARGET = new Set(['cp', 'mv', 'install', 'ln'])

/** Words that run the word after them as the program. */
const PREFIXES = new Set([
  'env',
  'command',
  'builtin',
  'nohup',
  'time',
  'sudo',
  'xargs',
  'nice',
  'caffeinate',
  'arch',
  'script',
  'timeout',
  'setsid',
  'stdbuf',
  'ionice',
  'unbuffer',
  'taskpolicy',
  'doas',
  'exec',
  'do',
  'then',
  'else',
  '!',
  '{',
])
/** Shells, which run the code they are given: inline, from a file or from stdin. */
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'mksh', 'fish', 'ash', 'csh', 'tcsh'])
/** Shell flags that take a value: `bash -o pipefail`, `bash --rcfile x`. */
const SHELL_VALUE_FLAGS = new Set(['--rcfile', '--init-file', '-o', '+o', '-O', '+O'])
/** Programs that change the folder the next commands run in. */
const CD = new Set(['cd', 'pushd'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
/** A number, a duration or the null device: what a launcher takes besides flags. */
const LAUNCHER_ARG = /^(?:\d+(?:\.\d+)?[smhd]?|\/dev\/null)$/
/** `>`, `>>` and `<` name files; `<<EOF` and `<<<` are a heredoc and a here-string, not files. */
const REDIRECT = /^\d*(>>?|<<<|<<-?|<)(.*)$/

export type Where = {
  cwd: string
  home: string
  /** The job's handoff folder: `factory sandbox exec` runs its command in sandbox/<role> there. */
  handoff?: string
}

/** One program a command runs, with the words around it. */
export type Invocation = {
  /** The program and its arguments, with `~` and the variables everyone knows expanded. */
  words: string[]
  /** Every word of the simple command, assignments and prefixes included. */
  all: string[]
  /** Words that ran the program for the command: env, xargs, sudo. */
  prefixes: string[]
  /** The folder it runs in, following the `cd`s before it. */
  cwd: string
  /** Run by `factory sandbox exec`: in the reviewer's sandbox, with its port, database and bucket. */
  sandboxed?: boolean
  /**
   * The program is a shell (or `eval`): `code` runs the inline code it was given, which the guard
   * reads as a command of its own; `stdin` is a shell fed its code on stdin (a pipe, a heredoc, a
   * here-string, `-s`), which the guard can't read; `script` runs a file.
   */
  shell?: 'code' | 'stdin' | 'script'
  /** For `cd` and `pushd`: the folder it moves to; absent when that can't be known (`cd -`). */
  cd?: string
}

/**
 * A word with `~` and the variables the guard can know expanded: $HOME, $TMPDIR, $USER and $PWD.
 * Any other `$NAME` stays, and a path starting with one is skipped.
 */
function expand(word: string, home: string, cwd: string): string {
  const known: Record<string, string> = {
    HOME: home,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    USER: process.env.USER ?? userInfo().username,
    PWD: cwd,
  }
  return word
    .replace(/^~(?=\/|$)/, home)
    .replaceAll(
      /\$(?:\{(HOME|TMPDIR|USER|PWD)\}|(HOME|TMPDIR|USER|PWD)(?![A-Za-z0-9_]))/g,
      (_, braced: string | undefined, bare: string | undefined) =>
        known[braced ?? bare ?? ''] ?? '',
    )
}

/** A word as a path, unresolved, so a symlink in it is followed as the kernel would; null for `$VAR`. */
function toPath(word: string, cwd: string): string | null {
  if (!word || word === '-' || word.startsWith('$') || word.startsWith('~')) return null
  return isAbsolute(word) ? word : `${cwd}/${word}`
}

/** `cd`'s target: `cd -P /x`, `cd -- x`; null for `cd -` (back), which can't be followed. */
function cdTarget(args: string[], home: string, cwd: string): string | null {
  const operand = args.find((word) => !/^-[PLe@]+$/.test(word) && word !== '--')
  if (operand === undefined) return home
  // cd is logical: `..` leaves the folder as typed, as $PWD says, not the link's target.
  return operand === '-' ? null : resolve(toPath(operand, cwd) ?? cwd)
}

/**
 * A word written back as the shell would read it as one word, so a command rebuilt from words
 * (`sandbox exec … -- perl -pe '' file`) lexes into the words it had: an empty or spaced word keeps
 * its quotes, and a redirection operator stays one.
 */
function requote(word: string): string {
  if (REDIRECT.test(word) || /^[A-Za-z0-9_@%+=:,./~$-]+$/.test(word)) return word
  return `'${word.replaceAll("'", "'\\''")}'`
}

/**
 * How a shell invocation gets its code, and the words of the inline code. Null when the program is
 * not a shell. A flag cluster with a `c` (`-lc`, `-ec`, `-e -c`, `--norc -c`) makes the next word
 * the code; `busybox sh` is `sh`.
 */
function shellForm(
  words: string[],
): { kind: 'code'; code: string[] } | { kind: 'stdin' } | { kind: 'script' } | null {
  const at = basename(words[0] ?? '') === 'busybox' ? 1 : 0
  if (!SHELLS.has(basename(words[at] ?? ''))) return null
  let fromStdin = false
  let fed = false
  let file = false
  let script: string | undefined
  for (let j = at + 1; j < words.length; j++) {
    const word = words[j]!
    const redirect = REDIRECT.exec(word)
    if (redirect) {
      if (!redirect[2]) j++
      if (redirect[1] === '<') file = true
      else if (redirect[1]?.startsWith('<<')) fed = true
      continue
    }
    if (word === '--') {
      script = words[j + 1]
      break
    }
    if (word === '-') {
      fromStdin = true
      continue
    }
    if (!/^[-+]/.test(word)) {
      script = word
      break
    }
    if (word.startsWith('--')) {
      if (SHELL_VALUE_FLAGS.has(word)) j++
      continue
    }
    const letters = word.slice(1)
    const values = [...letters].filter((letter) => 'oO'.includes(letter)).length
    if (word.startsWith('-') && letters.includes('c')) {
      return { kind: 'code', code: words.slice(j + 1 + values) }
    }
    if (word.startsWith('-') && letters.includes('s')) fromStdin = true
    j += values
  }
  if (fed || fromStdin) return { kind: 'stdin' }
  return script !== undefined || file ? { kind: 'script' } : { kind: 'stdin' }
}

/**
 * Every program a command runs, in order, each with the folder it runs in. `sh -c` and
 * `factory sandbox exec … -- <cmd>` run another command: theirs are read too, the sandbox's from
 * its own folder.
 */
export function invocations(command: string, at: Where): Invocation[] {
  const found: Invocation[] = []
  let cwd = at.cwd
  for (const raw of simpleCommands(command)) {
    const all = raw.map((word) => expand(word, at.home, cwd))
    let i = 0
    const prefixes: string[] = []
    // `command -v bash` looks a program up; it runs nothing.
    let lookup = false
    for (;;) {
      while (i < all.length && ASSIGNMENT.test(all[i]!)) {
        // A value with spaces may be a command the program runs: GH_PAGER='sh -c "gh …"'.
        const value = all[i++]!.replace(ASSIGNMENT, '')
        if (/\s/.test(value)) found.push(...invocations(value, { ...at, cwd }))
      }
      if (!PREFIXES.has(all[i] ?? '')) break
      const prefix = all[i++]!
      prefixes.push(prefix)
      // The launcher's own flags and their values: `nice -n 5`, `timeout 60`, `script -q /dev/null`.
      const flagsFrom = i
      while (i < all.length && (all[i]!.startsWith('-') || LAUNCHER_ARG.test(all[i]!))) i++
      if (
        prefix === 'command' &&
        all.slice(flagsFrom, i).some((word) => /^-[a-zA-Z]*[vV]/.test(word))
      ) {
        lookup = true
      }
    }
    const words = all.slice(i)
    const name = basename(words[0] ?? '')
    const invocation: Invocation = { words, all, prefixes, cwd }
    const form = lookup ? null : shellForm(words)
    if (form?.kind === 'code') {
      found.push({ ...invocation, words: words.slice(0, 1), shell: 'code' })
      found.push(...invocations(form.code.join(' '), { ...at, cwd }))
      continue
    }
    if (!lookup && name === 'eval') {
      found.push({ ...invocation, words: words.slice(0, 1), shell: 'code' })
      found.push(...invocations(words.slice(1).join(' '), { ...at, cwd }))
      continue
    }
    if (form) invocation.shell = form.kind
    if (CD.has(name)) {
      const target = cdTarget(words.slice(1), at.home, cwd)
      found.push(target === null ? invocation : { ...invocation, cd: target })
      cwd = target ?? cwd
      continue
    }
    const sandbox = factoryCall(invocation)?.sandbox
    // The call after `--` runs in the sandbox, and is judged there below: the outer call keeps only
    // the words before it, so its operands aren't read from the folder `exec` was typed in.
    const judged =
      sandbox?.action === 'exec' && sandbox.argv.length
        ? { ...invocation, words: words.slice(0, words.length - sandbox.argv.length - 1) }
        : invocation
    found.push(judged)
    if (sandbox?.action === 'exec' && sandbox.role && at.handoff) {
      const inside = join(at.handoff, 'sandbox', sandbox.role)
      found.push(
        ...invocations(sandbox.argv.map(requote).join(' '), { ...at, cwd: inside }).map((call) => ({
          ...call,
          sandboxed: true,
        })),
      )
    }
  }
  return found
}

/** Pieces of a word that may be paths: `--config=../x`, `S=/tmp/x`, `HEAD:apps/x`. */
const pieces = (word: string) => word.split(/[=:,]/).filter(Boolean)
const pathy = (piece: string) => /[/~.]/.test(piece) || piece.startsWith('$')

/** One `git` in a command: its subcommand, the arguments after it and the folder it works in. */
export type GitCommand = {
  sub: string
  /** The subcommand's index in the invocation's words. */
  at: number
  cwd: string
  /** The arguments after the subcommand. */
  args: string[]
  /** The `-c <key>=<value>` settings before the subcommand, and `--config-env`'s. */
  configs: string[]
}

/** git's own flags that take the next word as their value. */
const GIT_VALUE_FLAGS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
])

/**
 * Every `git` the invocation runs, at any word position: behind a launcher (`nice git push`) or in
 * `find -exec git push`. Each with its subcommand, past git's global flags, and the folder it works
 * in (`git -C <dir>`).
 */
export function gitCommands(invocation: Invocation): GitCommand[] {
  const { words } = invocation
  const found: GitCommand[] = []
  for (let start = 0; start < words.length; start++) {
    if (basename(words[start]!) !== 'git') continue
    let cwd = invocation.cwd
    const configs: string[] = []
    for (let i = start + 1; i < words.length; i++) {
      const word = words[i]!
      if (word === '-C') {
        cwd = resolve(cwd, words[++i] ?? '.')
        continue
      }
      if (word === '-c') {
        configs.push(words[++i] ?? '')
        continue
      }
      if (word.startsWith('--config-env=')) {
        configs.push(word.slice('--config-env='.length))
        continue
      }
      if (GIT_VALUE_FLAGS.has(word)) {
        i++
        continue
      }
      if (word.startsWith('-')) continue
      found.push({ sub: word, at: i, cwd, args: words.slice(i + 1), configs })
      break
    }
  }
  return found
}

/** Programs git ships that send a branch to a remote, run by their own names. */
const PUSH_PROGRAMS = /^git-(?:push|send-pack|receive-pack|http-push)$/

/** Whether a git command, or a program of git's, sends commits to a remote. */
export const isPush = (git: GitCommand) =>
  ['push', 'send-pack', 'receive-pack', 'http-push'].includes(git.sub) ||
  (git.sub === 'subtree' && git.args.includes('push'))

/** A word that names one of git's push programs, however it is reached: `…/git-core/git-push`. */
export const isPushProgram = (word: string) => PUSH_PROGRAMS.test(basename(word))

/** `git-subtree push …`, run by its own name. */
export const isSubtreePush = (words: string[]) =>
  words.some((word) => basename(word) === 'git-subtree') && words.includes('push')

/** The paths `git checkout` and `git restore` overwrite in the worktree. */
function gitWrites(invocation: Invocation): NamedPath[] {
  return gitCommands(invocation).flatMap((git) => gitCommandWrites(git))
}

function gitCommandWrites(git: GitCommand): NamedPath[] {
  if (git.sub === 'rm' || git.sub === 'mv') {
    // `git rm`, `git mv`: every operand is removed or moved, folders whole.
    const dash = git.args.indexOf('--')
    const operands = (dash === -1 ? git.args : git.args.slice(dash + 1)).filter(
      (word, i, all) => dash !== -1 || (!word.startsWith('-') && all[i - 1] !== '--'),
    )
    return operands.flatMap((word) => {
      const path = toPath(word, git.cwd)
      return path ? [{ path, program: 'git', read: false, write: true, tree: true }] : []
    })
  }
  if (git.sub !== 'checkout' && git.sub !== 'restore') return []
  const { args } = git
  const dash = args.indexOf('--')
  const operands =
    dash === -1
      ? args.filter(
          (word, i) => !word.startsWith('-') && !['-s', '--source'].includes(args[i - 1]!),
        )
      : args.slice(dash + 1)
  // Without `--`, checkout's operand may be a branch: only one that exists as a path is a path.
  const paths =
    git.sub === 'checkout' && dash === -1
      ? operands.filter((word) => existsSync(resolve(git.cwd, word)))
      : operands
  // From a revision (`checkout <rev> -- <dir>`, `restore --source`), a folder is rewritten whole.
  const fromRevision =
    args.some((word) => word === '-s' || word === '--source' || word.startsWith('--source=')) ||
    (git.sub === 'checkout' &&
      dash !== -1 &&
      args.slice(0, dash).some((word) => !word.startsWith('-')))
  return paths.flatMap((word) => {
    const path = toPath(word, git.cwd)
    return path ? [{ path, program: 'git', read: false, write: true, tree: fromRevision }] : []
  })
}

/** Every path one program names, each with what it does to it. */
export function invocationPaths(invocation: Invocation): NamedPath[] {
  const { words, cwd } = invocation
  const found: NamedPath[] = []
  const program = words[0] ?? ''
  const name = basename(program)
  const named = (word: string, how: Omit<NamedPath, 'path' | 'program'>) => {
    for (const piece of how.read || how.write ? [word] : pieces(word)) {
      if (!how.read && !how.write && !pathy(piece)) continue
      const path = toPath(piece, cwd)
      if (path && !path.startsWith('/dev/')) found.push({ path, program: name, ...how })
    }
  }
  const assignments = invocation.all.slice(0, invocation.all.length - words.length)
  for (const word of assignments) if (ASSIGNMENT.test(word)) named(word, { read: false })
  if (program.includes('/')) named(program, { read: false })
  if (invocation.shell === 'code') return found
  // `exec 3> file`, `exec > file`: the redirection stands where the program would.
  const leading = REDIRECT.exec(program)
  if (leading && !leading[1]?.startsWith('<<')) {
    const file = leading[2] || words[1]
    if (file) named(file, { read: leading[1] === '<', write: leading[1] !== '<', tree: false })
    return found
  }
  if (CD.has(name)) {
    if (invocation.cd) found.push({ path: invocation.cd, program: 'cd', read: false })
    return found
  }
  const reader = READERS[name]
  const writer = WRITERS[name]
  const values = reader?.values ?? writer ?? OTHER_VALUES[name] ?? {}
  const recursive = RECURSIVE_FLAGS[name]
  const search =
    SEARCHERS.has(name) ||
    (recursive !== undefined && words.slice(1).some((w) => recursive.test(w)))
  const inPlace = name === 'sed' && words.some((word) => /^-[a-zA-Z]*i|^--in-place/.test(word))
  let patternPending =
    reader?.pattern === true &&
    !words.some((word) =>
      reader.patternFlags?.some((flag) => word === flag || word.startsWith(`${flag}=`)),
    )
  const operands: string[] = []
  let target: string | undefined
  // `find`'s roots come before its expression: what follows (`-name x`, `( … )`) is no path.
  let expression = false
  for (let j = 1; j < words.length; j++) {
    const word = words[j]!
    if (name === 'find' && (word.startsWith('-') || word === '(' || word === '!')) expression = true
    if (name === 'find' && expression && !word.startsWith('-')) continue
    // An empty word (`sed -i ''`) is no path.
    if (word === '') continue
    if (EDITORS.has(name) && word.startsWith('+')) continue
    const redirect = REDIRECT.exec(word)
    if (redirect) {
      const file = redirect[2] || words[++j]
      if (file && !redirect[1]?.startsWith('<<')) {
        const input = redirect[1] === '<'
        named(file, { read: input, write: !input })
      }
      continue
    }
    if (name === 'dd' && /^(?:of|if)=/.test(word)) {
      named(word.slice(3), { read: word.startsWith('if='), write: word.startsWith('of=') })
      continue
    }
    if (name === 'sort') {
      // `sort -o <file>` writes its output there, even over an input.
      const output =
        word === '-o'
          ? words[j + 1]
          : word.startsWith('--output=')
            ? word.slice('--output='.length)
            : /^-o./.test(word)
              ? word.slice(2)
              : undefined
      if (output) named(output, { read: false, write: true })
    }
    if (word.startsWith('-') && word !== '-') {
      if (INTO_TARGET.has(name) && (word === '-t' || word.startsWith('--target-directory='))) {
        target = word === '-t' ? words[j + 1] : word.slice(word.indexOf('=') + 1)
      }
      j += values[word] ?? 0
      if (word.includes('=')) named(word.slice(word.indexOf('=') + 1), { read: false, search })
      continue
    }
    if (reader && patternPending) {
      patternPending = false
      continue
    }
    operands.push(word)
  }
  if (name === 'ln') return [...found, ...linkPaths(operands, target, cwd, words)]
  // `find <root> -delete` and `find <root> -exec rm {} +` remove what is under each root.
  if (
    name === 'find' &&
    words.some(
      (word, i) =>
        word === '-delete' ||
        (/^-exec(?:dir)?$/.test(word) &&
          /^(?:rm|mv|shred|truncate)$/.test(basename(words[i + 1] ?? ''))),
    )
  ) {
    const filtered = words.some((word) =>
      /^-(?:i?name|i?path|i?regex|type|newer|[acm]time|size|user|perm|empty)$/.test(word),
    )
    for (const root of operands) named(root, { read: false, write: true, tree: true, filtered })
  }
  const ignoring = IGNORING.has(name) && !words.some((word) => NO_IGNORE.test(word))
  // A walk with no root named starts where it runs: `find -name x`, `rg icon`, `ls -R`.
  const rootless =
    search &&
    (name === 'find'
      ? words[1] === undefined || /^[-(!]/.test(words[1])
      : operands.length === 0 && !words.some((word) => REDIRECT.test(word)))
  if (rootless) found.push({ path: cwd, program: name, read: false, search: true, ignoring })
  const family = name.replace(/\d+(?:\.\d+)*$/, '')
  if (INTERPRETERS.has(family)) {
    return [...found, ...inlinePaths(words, cwd, name), ...operandPaths(family, words, cwd, name)]
  }
  // cp, mv and install write their last operand, or the folder -t names.
  const copies = ['cp', 'mv', 'install', 'rsync', 'ditto'].includes(name)
  const destination = copies
    ? (target ?? (operands.length > 1 ? operands.at(-1) : undefined))
    : undefined
  if (copies && target) named(target, { read: false, write: true, tree: true })
  // A copy into a folder writes each source's name there: `cp x.acceptance.test.ts apps/api/src`.
  const into = destination ? resolve(cwd, destination) : null
  if (copies && into && (destination?.endsWith('/') || isDirectory(into))) {
    const sources = target ? operands : operands.slice(0, -1)
    for (const source of sources) named(join(into, basename(source)), { read: false, write: true })
  }
  operands.forEach((word, index) => {
    const isDestination = copies && !target && index === operands.length - 1 && destination
    if (isDestination) named(word, { read: false, write: true, tree: true })
    else if (writer) {
      named(word, { read: false, write: true, search, ignoring, tree: TREE_WRITERS.has(name) })
    } else if (inPlace) named(word, { read: true, write: true })
    else named(word, { read: reader !== undefined || search, search, ignoring })
  })
  return [...found, ...gitWrites(invocation), ...extractWrites(invocation, name)]
}

/** Whether a path is a folder that exists. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Archives and downloads that write where they are told: `tar x -C <dir>` and `unzip -d <dir>`
 * (the folder, or the current one), `curl -o`, `wget -O`, and `chmod`, `chown`, `chgrp` on their
 * operands.
 */
function extractWrites(invocation: Invocation, name: string): NamedPath[] {
  const { words, cwd } = invocation
  const args = words.slice(1)
  const write = (word: string | undefined, tree = false): NamedPath[] => {
    const path = word ? toPath(word, cwd) : null
    return path ? [{ path, program: name, read: false, write: true, tree }] : []
  }
  const after = (...flags: string[]) => {
    const at = args.findIndex((word) =>
      flags.some((flag) => word === flag || word.startsWith(`${flag}=`)),
    )
    if (at === -1) return undefined
    const word = args[at]!
    return word.includes('=') ? word.slice(word.indexOf('=') + 1) : args[at + 1]
  }
  switch (name) {
    case 'tar': {
      const extracts =
        args.some(
          (word) => word === '--extract' || (/^-[a-zA-Z]+$/.test(word) && word.includes('x')),
        ) || /^[a-zA-Z]*x[a-zA-Z]*$/.test(args[0] ?? '')
      return extracts ? write(after('-C', '--directory') ?? '.', true) : []
    }
    case 'unzip':
      return write(after('-d') ?? '.', true)
    case 'curl':
      return write(after('-o', '--output'))
    case 'wget':
      return write(after('-O', '--output-document'))
    case 'chmod':
    case 'chown':
    case 'chgrp': {
      const operands = args.filter((word) => !word.startsWith('-'))
      return operands.slice(1).flatMap((word) =>
        write(
          word,
          args.some((a) => /^-[a-zA-Z]*R/.test(a)),
        ),
      )
    }
    default:
      return []
  }
}

/** Interpreters that run code given on the command line. */
const INTERPRETERS = new Set(['python', 'node', 'bun', 'perl', 'ruby', 'deno', 'php'])
/** A path written as a string literal in code: `open('/x/y')`, `readFileSync("../z")`. */
const PATH_LITERAL = /(['"`])((?:\/|~\/|\.{1,2}\/)[^'"`\s]*)\1/g

/**
 * The paths an interpreter's inline code (`python -c`, `node -e`) names as string literals, taken
 * as read: a script given inline is read like the files it names. Its writes are scriptWrites'.
 */
function inlinePaths(words: string[], cwd: string, name: string): NamedPath[] {
  const at = words.findIndex((word) => EVAL_FLAGS.has(word) || word === '-c')
  const code = at === -1 ? [] : words.slice(at + 1)
  return code.flatMap((word) =>
    [...word.matchAll(PATH_LITERAL)].flatMap((match) => {
      const path = toPath(match[2] ?? '', cwd)
      return path ? [{ path, program: name, read: true }] : []
    }),
  )
}

/**
 * `ln`: the link it makes is written; where the link leads becomes reachable through it, like the
 * root of a search. A symbolic link's target is relative to the link's folder.
 */
function linkPaths(
  operands: string[],
  target: string | undefined,
  cwd: string,
  words: string[],
): NamedPath[] {
  const symbolic = words.some((word) => /^-[a-zA-Z]*s/.test(word) || word === '--symbolic')
  const sources = target || operands.length < 2 ? operands : operands.slice(0, -1)
  const link = target ?? (operands.length > 1 ? operands.at(-1) : '.')
  const found: NamedPath[] = []
  const linkPath = link === undefined ? null : toPath(link, cwd)
  if (linkPath) found.push({ path: linkPath, program: 'ln', read: false, write: true })
  for (const source of sources) {
    const from = symbolic && !isAbsolute(source) && linkPath ? dirname(linkPath) : cwd
    const path = toPath(source, from)
    if (path) found.push({ path, program: 'ln', read: false, search: true })
  }
  return found
}

/**
 * Paths an inline script opens for writing, as written in the command: Python's `open(…, 'w')`
 * and `Path(…).write_text`, Node's and Bun's write calls. A path the script builds is out of sight.
 */
const SCRIPT_WRITES = [
  /open\(\s*(['"])([^'"]+)\1\s*,\s*(?:mode\s*=\s*)?['"][^'"]*[wax+]/g,
  /Path\(\s*(['"])([^'"]+)\1\s*\)\s*\.\s*(?:write_text|write_bytes|touch|unlink|mkdir)/g,
  /(?:writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream|Bun\.write|rmSync|unlinkSync|truncateSync|mkdirSync)\(\s*(['"`])([^'"`]+)\1/g,
  /(?:copyFileSync|renameSync|cpSync|copyFile|rename)\(\s*['"`][^'"`]+['"`]\s*,\s*(['"`])([^'"`]+)\1/g,
]
/** awk writes a file with `print > "file"`, `print >> "file"` and `printf … > "file"` in its program. */
const AWKS = new Set(['awk', 'gawk', 'mawk', 'nawk'])
const AWK_REDIRECT = /\b(?:print|printf)\b[^;}\n]*?>>?\s*(['"])([^'"]+)\1/g

/** What an interpreter's command line holds: its inline code, its script and its operands. */
type InterpreterArgs = {
  code: string[]
  /** The script file, when no code is given inline. */
  script: string | undefined
  operands: string[]
  /** perl's and ruby's `-i`: the operands are edited in place. */
  inPlace: boolean
  /** Bun's or Deno's own subcommand (`bun test`, `bun run`), when the command starts with one. */
  subcommand?: string
  /** Where `bun --cwd <dir>` runs. */
  cwds: string[]
}

/** Bun's and Deno's own subcommands: their operands are scripts' names and filters, not files. */
const RUNTIME_SUBCOMMANDS = new Set([
  'run',
  'test',
  'install',
  'i',
  'add',
  'remove',
  'rm',
  'update',
  'x',
  'create',
  'init',
  'build',
  'pm',
  'link',
  'unlink',
  'outdated',
  'publish',
  'upgrade',
  'repl',
  'exec',
  'eval',
  'fmt',
  'lint',
  'check',
  'task',
  'compile',
  'bench',
  'doc',
  'info',
  'cache',
  'help',
])

/** Flags that take the next word as a value, per interpreter, besides the ones that give code. */
const VALUE_FLAGS: Record<string, readonly string[]> = {
  python: ['-W', '-X', '-Q'],
  node: ['-r', '--require', '--import', '--loader', '--env-file', '--conditions', '-C'],
  bun: ['-r', '--preload', '--cwd', '--config', '--env-file', '--port', '--define', '-d'],
  deno: ['--config', '--import-map', '--lock', '--allow-read', '--allow-write'],
  php: ['-d', '-c', '-n'],
  perl: [],
  ruby: [],
}
const CODE_FLAGS: Record<string, readonly string[]> = {
  python: ['-c'],
  node: ['-e', '--eval', '-p', '--print', '-pe', '-ep'],
  bun: ['-e', '--eval', '-p', '--print'],
  deno: [],
  php: ['-r'],
  perl: [],
  ruby: [],
}

/**
 * Reads an interpreter's command line: the inline code after `-e`/`-c`, the script file when there
 * is none, every operand after it, and perl's and ruby's in-place flag (`-i`, `-pi`, `-i.bak`).
 */
function interpreterArgs(family: string, words: string[]): InterpreterArgs {
  const found: InterpreterArgs = {
    code: [],
    script: undefined,
    operands: [],
    inPlace: false,
    cwds: [],
  }
  const codeFlags = CODE_FLAGS[family] ?? []
  const valueFlags = VALUE_FLAGS[family] ?? []
  const clustered = family === 'perl' || family === 'ruby'
  let rest = false
  let first = true
  for (let j = 1; j < words.length; j++) {
    const word = words[j]!
    if (!rest && word === '--') {
      rest = true
      continue
    }
    if (rest || !word.startsWith('-') || word === '-') {
      if (first && (family === 'bun' || family === 'deno') && RUNTIME_SUBCOMMANDS.has(word)) {
        if (found.code.length === 0) {
          // `bun test <path>` and `bun run <path>` hand the runtime files; the rest hand it none.
          if (word !== 'test' && word !== 'run') return found
          found.subcommand = word
          first = false
          continue
        }
      }
      first = false
      if (found.code.length === 0 && found.script === undefined) found.script = word
      else found.operands.push(word)
      continue
    }
    if (codeFlags.includes(word)) {
      if (j + 1 < words.length) found.code.push(words[++j]!)
      continue
    }
    if (valueFlags.includes(word)) {
      if (word === '--cwd' && words[j + 1]) found.cwds.push(words[j + 1]!)
      j++
      continue
    }
    if (word.startsWith('--cwd=')) found.cwds.push(word.slice('--cwd='.length))
    if (family === 'python' && word === '-m') {
      // `-m module`: the module is the script, what follows are its operands.
      if (found.script === undefined) found.script = words[++j]
      first = false
      continue
    }
    if (clustered && !word.startsWith('--')) {
      for (let c = 1; c < word.length; c++) {
        const letter = word[c]!
        if (letter === 'i') {
          found.inPlace = true
          break
        }
        if (letter === 'e' || letter === 'E') {
          if (word.length > c + 1) found.code.push(word.slice(c + 1))
          else if (j + 1 < words.length) found.code.push(words[++j]!)
          break
        }
        if ('IMrFCDdVxm'.includes(letter)) {
          if ('Ir'.includes(letter) && word.length === c + 1) j++
          break
        }
      }
    }
  }
  return found
}

/**
 * The files an interpreter is handed: its script, and every operand after the code or the script,
 * each read; perl's and ruby's `-i` also writes the operands. A runtime's own subcommand
 * (`bun test`, `bun run build`) hands it no files.
 */
function operandPaths(family: string, words: string[], cwd: string, name: string): NamedPath[] {
  const { script, operands, inPlace, subcommand, cwds } = interpreterArgs(family, words)
  const given = script === undefined ? operands : [script, ...operands]
  // After `bun test` or `bun run`, only a word that looks like a path is one: `bun run build` is a
  // script's name.
  const paths = [...cwds, ...(subcommand ? given.filter((word) => /[/~]|^\./.test(word)) : given)]
  return paths.flatMap((word) => {
    const path = toPath(word, cwd)
    return path
      ? [
          {
            path,
            program: name,
            read: true,
            ...(inPlace && word !== script ? { write: true } : {}),
          },
        ]
      : []
  })
}

/**
 * Paths an interpreter's inline code opens for writing, as written in the code: Python's
 * `open(…, 'w')` and `Path(…).write_text`, Node's and Bun's write calls. Relative to the folder
 * the interpreter runs in, a `cd` before it counted. A path the script builds is out of sight.
 */
function scriptWrites(invocation: Invocation, home: string): NamedPath[] {
  const { words, cwd } = invocation
  const family = basename(words[0] ?? '').replace(/\d+(?:\.\d+)*$/, '')
  if (AWKS.has(family)) {
    return [...words.slice(1).join('\n').matchAll(AWK_REDIRECT)].flatMap((match) => {
      const path = toPath(expand(match[2] ?? '', home, cwd), cwd)
      return path ? [{ path, program: 'script', read: false, write: true }] : []
    })
  }
  if (!INTERPRETERS.has(family)) return []
  const text = interpreterArgs(family, words).code.join('\n')
  return SCRIPT_WRITES.flatMap((pattern) =>
    [...text.matchAll(pattern)].flatMap((match) => {
      const path = toPath(expand(match[2] ?? '', home, cwd), cwd)
      return path ? [{ path, program: 'script', read: false, write: true }] : []
    }),
  )
}

/**
 * Every path a command names, in order, each resolved against the folder the command runs in,
 * following its `cd`s. Bare words count only as a reader's or a writer's operands, or when they
 * look like paths; a word a shell would expand from another variable is skipped.
 */
export function commandPaths(command: string, at: Where): NamedPath[] {
  const calls = invocations(command, at)
  return [
    ...calls.flatMap(invocationPaths),
    ...calls.flatMap((call) => scriptWrites(call, at.home)),
  ]
}

/** What `factory sandbox` does, on which job and role, and the command it runs. */
type SandboxCall = {
  action: 'create' | 'exec' | 'rm'
  number: string | undefined
  role: string | undefined
  argv: string[]
}

/** A factory CLI invocation, read as main.ts's own parser would. */
type FactoryCall = {
  /** The command: the first positional. A `$`-word means the shell supplies it. */
  command: string | undefined
  positionals: string[]
  values: Record<string, string>
  /** xargs supplies the arguments, so they can't be read. */
  viaXargs: boolean
  sandbox?: SandboxCall
}

/** What runs the CLI's script: Bun and Node, and the package runners that start either. */
const RUNTIMES = new Set(['bun', 'node', 'npm', 'npx', 'bunx', 'pnpm', 'yarn'])
/** The runtime's own flags that take a value: `bun --cwd factory/cli run …`. */
const RUNTIME_VALUES = new Set([
  '--cwd',
  '-r',
  '--preload',
  '--config',
  '--env-file',
  '--require',
  '--filter',
  '-F',
])
/** main.ts's flags that take a value (its parseArgs options of type string). */
const FACTORY_VALUES = new Set([
  '--note',
  '--session',
  '--port',
  '--pass',
  '--roles',
  '--task',
  '--ruling',
])
/** Flags that make the runtime run code from the command line. */
const EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print'])

/**
 * Whether the runtime's script is the factory CLI: the `factory` script, or main(.ts) in
 * factory/cli/src, symlinks resolved. A main(.ts) elsewhere that doesn't exist can't be told apart
 * from the CLI, so it counts.
 */
function isFactoryScript(word: string, cwd: string): boolean {
  if (word === 'factory') return true
  const glob = new Bun.Glob(basename(word))
  const names = ['main', 'main.ts'].filter((name) => glob.match(name))
  if (names.length === 0) return false
  const dir = canonical(dirname(word), cwd)
  if (dir.endsWith('/factory/cli/src')) return true
  return !names.some((name) => existsSync(join(dir, name)))
}

/** The runtime's flags before its script, and whether one of them runs code given inline. */
export function runtimeFlags(
  invocation: Invocation,
): { script: number; evaluates: boolean } | null {
  const [program, ...rest] = invocation.words
  if (!RUNTIMES.has(basename(program ?? ''))) return null
  let i = 0
  let evaluates = false
  const skipFlags = () => {
    while (i < rest.length && rest[i]!.startsWith('-')) {
      if (EVAL_FLAGS.has(rest[i]!)) evaluates = true
      if (RUNTIME_VALUES.has(rest[i]!)) i++
      i++
    }
  }
  skipFlags()
  if (rest[i] === 'run') {
    i++
    skipFlags()
  }
  return { script: i + 1, evaluates }
}

/**
 * Each runtime word of the invocation, at any position (behind `nice`, `timeout`, `script`, in
 * `find -exec`), with the words from it on as an invocation of its own.
 */
export function runtimeCalls(invocation: Invocation): Invocation[] {
  return invocation.words.flatMap((word, i) =>
    RUNTIMES.has(basename(word)) ? [{ ...invocation, words: invocation.words.slice(i) }] : [],
  )
}

/** The factory CLI call a command makes behind any launcher, or null when it runs anything else. */
export function factoryCall(invocation: Invocation): FactoryCall | null {
  for (const call of runtimeCalls(invocation)) {
    const found = factoryCallAt(call)
    if (found) return found
  }
  return null
}

/** The factory CLI call a runtime word starts, or null. */
function factoryCallAt(invocation: Invocation): FactoryCall | null {
  const runtime = runtimeFlags(invocation)
  if (!runtime || runtime.evaluates) return null
  const script = invocation.words[runtime.script]
  if (!script || !isFactoryScript(script, invocation.cwd)) return null
  // Bun drops a `--` right after the script, and `bun run factory` drops one more on the way to
  // main.ts: `bun run factory -- -- --note x answer 7` reaches main.ts as `--note x answer 7`.
  let args = invocation.words.slice(runtime.script + 1)
  for (let drops = 0; drops < 2 && args[0] === '--'; drops++) args = args.slice(1)
  const viaXargs = invocation.prefixes.includes('xargs')
  if (args[0] === 'sandbox') {
    // main.ts hands everything after `sandbox` to the sandbox command, which splits it at `--`.
    const split = args.indexOf('--')
    const head = split === -1 ? args.slice(1) : args.slice(1, split)
    const argv = split === -1 ? [] : args.slice(split + 1)
    const action = head[0] === 'exec' || head[0] === 'rm' ? head[0] : 'create'
    const [number, role] = action === 'create' ? head : head.slice(1)
    return {
      command: 'sandbox',
      positionals: ['sandbox', ...head],
      values: {},
      viaXargs,
      sandbox: { action, number, role, argv },
    }
  }
  const positionals: string[] = []
  const values: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const word = args[i]!
    if (word === '--') {
      // Everything after a `--` is a positional to main.ts, a second `--` too: the guard skips it,
      // so no `--` hides the subcommand.
      positionals.push(...args.slice(i + 1).filter((rest) => rest !== '--'))
      break
    }
    if (word.startsWith('--') && word.includes('=')) {
      values[word.slice(0, word.indexOf('='))] = word.slice(word.indexOf('=') + 1)
      continue
    }
    if (FACTORY_VALUES.has(word)) {
      values[word] = args[++i] ?? ''
      continue
    }
    if (word.startsWith('-') && word !== '-') continue
    positionals.push(word)
  }
  return { command: positionals[0], positionals, values, viaXargs }
}
