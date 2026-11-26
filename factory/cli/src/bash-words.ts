// How the guard and factory watch read a Bash command. Both read it with these functions, so what
// the guard denies and what the page flags never disagree.
//
// This reads the command text only. A path built at runtime ("$a/$b", a variable set by another
// command) or a script written first and run after is out of its sight: the guard stops what a
// hurried agent types, and the seal keeps the files themselves out of reach.

import { basename, isAbsolute, resolve } from 'node:path'

/** File-descriptor redirections, which are neither separators nor paths. */
const FD_REDIRECTS = /\d*>&\d+|&>|\d*>\s*\/dev\/null/g

/** The command split into simple commands, each a list of words, with quoting and escapes undone. */
export function simpleCommands(command: string): string[][] {
  return (
    command
      // Quotes and backslashes hide words from a pattern; a shell would join them back.
      .replaceAll(/['"\\]/g, '')
      .replaceAll(FD_REDIRECTS, ' ')
      .split(/[;&|\n()`]|\$\(/)
      .map((part) => part.split(/\s+/).filter(Boolean))
      .filter((words) => words.length > 0)
  )
}

/** Whether the command, file-descriptor redirections aside, writes to a file with `>`. */
export const redirectsOutput = (command: string) =>
  command.replaceAll(FD_REDIRECTS, ' ').includes('>')

/** A path a command names, absolute; it may hold glob characters. */
export type NamedPath = {
  path: string
  program: string
  /** True when the program reads the file's content: a reader's file argument or a `<` input. */
  read: boolean
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
  cp: {},
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

/** Words that run the word after them as the program. */
const PREFIXES = new Set([
  'env',
  'command',
  'nohup',
  'time',
  'sudo',
  'xargs',
  'exec',
  'do',
  'then',
  'else',
  '!',
  '{',
])
const SHELLS = new Set(['bash', 'sh', 'zsh'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
/** `>`, `>>` and `<` name files; `<<EOF` and `<<<` are a heredoc and a here-string, not files. */
const REDIRECT = /^\d*(>>?|<<<|<<-?|<)(.*)$/

export type Where = { cwd: string; home: string }

/** A word as a path: `~` and `$HOME` expanded, relative to the working folder; null for `$VAR`. */
function toPath(word: string, at: Where): string | null {
  const home = /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)(.*)$/.exec(word)
  if (home) return resolve(at.home, `.${home[1] ?? ''}`)
  if (!word || word === '-' || word.startsWith('$') || word.startsWith('~')) return null
  return isAbsolute(word) ? resolve(word) : resolve(at.cwd, word)
}

/** Pieces of a word that may be paths: `--config=../x`, `S=/tmp/x`, `HEAD:apps/x`. */
const pieces = (word: string) => word.split(/[=:,]/).filter(Boolean)
const pathy = (piece: string) => /[/~.]/.test(piece) || piece.startsWith('$')

/**
 * Every path a command names, in order, each resolved against the folder the command runs in,
 * following its `cd`s. Bare words count only as a reader's file operands, or when they look like
 * paths; a word a shell would expand from another variable is skipped.
 */
export function commandPaths(command: string, at: Where): NamedPath[] {
  const found: NamedPath[] = []
  let cwd = at.cwd
  for (const words of simpleCommands(command)) {
    let i = 0
    const named = (word: string, program: string, read: boolean) => {
      for (const piece of read ? [word] : pieces(word)) {
        if (!read && !pathy(piece)) continue
        const path = toPath(piece, { cwd, home: at.home })
        if (path && !path.startsWith('/dev/')) found.push({ path, program, read })
      }
    }
    for (;;) {
      while (i < words.length && ASSIGNMENT.test(words[i]!)) named(words[i++]!, '', false)
      if (!PREFIXES.has(words[i] ?? '')) break
      i++
      while (i < words.length && words[i]!.startsWith('-')) i++
    }
    const program = words[i] ?? ''
    const name = basename(program)
    if (program.includes('/')) named(program, name, false)
    if (SHELLS.has(name) && words[i + 1] === '-c') {
      found.push(...commandPaths(words.slice(i + 2).join(' '), { cwd, home: at.home }))
      continue
    }
    if (name === 'cd') {
      const target = words[i + 1]
      const dir = target === undefined ? at.home : toPath(target, { cwd, home: at.home })
      if (dir) {
        found.push({ path: dir, program: 'cd', read: false })
        cwd = dir
      }
      continue
    }
    const reader = READERS[name]
    let patternPending =
      reader?.pattern === true &&
      !words.some((word) =>
        reader.patternFlags?.some((flag) => word === flag || word.startsWith(`${flag}=`)),
      )
    for (let j = i + 1; j < words.length; j++) {
      const word = words[j]!
      const redirect = REDIRECT.exec(word)
      if (redirect) {
        const target = redirect[2] || words[++j]
        if (target && !redirect[1]?.startsWith('<<')) named(target, name, redirect[1] === '<')
        continue
      }
      if (word.startsWith('-')) {
        j += reader?.values?.[word] ?? 0
        if (word.includes('=')) named(word.slice(word.indexOf('=') + 1), name, false)
        continue
      }
      if (reader && patternPending) {
        patternPending = false
        continue
      }
      named(word, name, reader !== undefined)
    }
  }
  return found
}
