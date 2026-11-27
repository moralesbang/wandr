// How the guard and factory watch read a Bash command. Both read it with these functions, so what
// the guard denies and what the page flags never disagree.
//
// This reads the command text only. A path built at runtime ("$a/$b", a variable set by another
// command) or a script written first and run after is out of its sight: the guard stops what a
// hurried agent types, and the seal keeps the files themselves out of reach. What it can't read,
// it says: a command substitution leaves the word SUBSTITUTION, and a variable stays `$NAME`.

import { existsSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { canonical } from './paths.ts'

/** The word a command substitution, `$(…)`, `…` or `<(…)`, leaves in the command around it. */
export const SUBSTITUTION = '$SUBST'

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
    if (heredoc && !RUNS_HEREDOC.test(line)) delimiter = heredoc[2] ?? null
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
export function simpleCommands(command: string): string[][] {
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
}

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

/** Value flags of the other programs this reads: `ln -t <dir>`. */
const OTHER_VALUES: Record<string, Record<string, number>> = { ln: { '-t': 1, '-S': 1 } }

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
  'exec',
  'do',
  'then',
  'else',
  '!',
  '{',
])
const SHELLS = new Set(['bash', 'sh', 'zsh'])
/** Programs that change the folder the next commands run in. */
const CD = new Set(['cd', 'pushd'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
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
    for (;;) {
      while (i < all.length && ASSIGNMENT.test(all[i]!)) {
        // A value with spaces may be a command the program runs: GH_PAGER='sh -c "gh …"'.
        const value = all[i++]!.replace(ASSIGNMENT, '')
        if (/\s/.test(value)) found.push(...invocations(value, { ...at, cwd }))
      }
      if (!PREFIXES.has(all[i] ?? '')) break
      prefixes.push(all[i++]!)
      while (i < all.length && all[i]!.startsWith('-')) i++
    }
    const words = all.slice(i)
    const name = basename(words[0] ?? '')
    const invocation: Invocation = { words, all, prefixes, cwd }
    if (SHELLS.has(name) && words[1] === '-c') {
      found.push({ ...invocation, words: words.slice(0, 1) })
      found.push(...invocations(words.slice(2).join(' '), { ...at, cwd }))
      continue
    }
    if (CD.has(name)) {
      const target = cdTarget(words.slice(1), at.home, cwd)
      found.push(target === null ? invocation : { ...invocation, cd: target })
      cwd = target ?? cwd
      continue
    }
    found.push(invocation)
    const sandbox = factoryCall(invocation)?.sandbox
    if (sandbox?.action === 'exec' && sandbox.role && at.handoff) {
      const inside = join(at.handoff, 'sandbox', sandbox.role)
      found.push(...invocations(sandbox.argv.join(' '), { ...at, cwd: inside }))
    }
  }
  return found
}

/** Pieces of a word that may be paths: `--config=../x`, `S=/tmp/x`, `HEAD:apps/x`. */
const pieces = (word: string) => word.split(/[=:,]/).filter(Boolean)
const pathy = (piece: string) => /[/~.]/.test(piece) || piece.startsWith('$')

/** git's subcommand and the folder it works in (`git -C <dir>`), past its global flags. */
export function gitCommand(
  invocation: Invocation,
): { sub: string; at: number; cwd: string } | null {
  const { words } = invocation
  if (basename(words[0] ?? '') !== 'git') return null
  let cwd = invocation.cwd
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!
    if (word === '-C') {
      cwd = resolve(cwd, words[++i] ?? '.')
      continue
    }
    if (word === '-c' || word === '--git-dir' || word === '--work-tree' || word === '--namespace') {
      i++
      continue
    }
    if (word.startsWith('-')) continue
    return { sub: word, at: i, cwd }
  }
  return null
}

/** The paths `git checkout` and `git restore` overwrite in the worktree. */
function gitWrites(invocation: Invocation): NamedPath[] {
  const git = gitCommand(invocation)
  if (!git || (git.sub !== 'checkout' && git.sub !== 'restore')) return []
  const args = invocation.words.slice(git.at + 1)
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
  return paths.flatMap((word) => {
    const path = toPath(word, git.cwd)
    return path ? [{ path, program: 'git', read: false, write: true }] : []
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
  if (SHELLS.has(name) && words[1] === '-c') return found
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
  for (let j = 1; j < words.length; j++) {
    const word = words[j]!
    // An empty word (`sed -i ''`) is no path.
    if (word === '') continue
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
  if (INTERPRETERS.has(name.replace(/\d+(?:\.\d+)*$/, ''))) {
    return [...found, ...inlinePaths(words, cwd, name)]
  }
  // cp, mv and install write their last operand, or the folder -t names.
  const copies = ['cp', 'mv', 'install'].includes(name)
  const destination = copies
    ? (target ?? (operands.length > 1 ? operands.at(-1) : undefined))
    : undefined
  if (copies && target) named(target, { read: false, write: true })
  operands.forEach((word, index) => {
    const isDestination = copies && !target && index === operands.length - 1 && destination
    if (isDestination) named(word, { read: false, write: true })
    else if (writer) named(word, { read: false, write: true, search })
    else if (inPlace) named(word, { read: true, write: true })
    else named(word, { read: reader !== undefined, search })
  })
  return [...found, ...gitWrites(invocation)]
}

/** Interpreters that run code given on the command line. */
const INTERPRETERS = new Set(['python', 'node', 'bun', 'perl', 'ruby', 'deno'])
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
const RUNS_INLINE =
  /(?:^|[\s;&|(])(?:python3?|node|bun|perl|ruby|deno)\s+(?:[^;&|]*\s)?-(?:c|e|-eval|p|-print)\b/

function scriptWrites(command: string, at: Where): NamedPath[] {
  if (!RUNS_INLINE.test(command)) return []
  return SCRIPT_WRITES.flatMap((pattern) =>
    [...command.matchAll(pattern)].flatMap((match) => {
      const path = toPath(expand(match[2] ?? '', at.home, at.cwd), at.cwd)
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
  return [...invocations(command, at).flatMap(invocationPaths), ...scriptWrites(command, at)]
}

/** What `factory sandbox` does, on which job and role, and the command it runs. */
export type SandboxCall = {
  action: 'create' | 'exec' | 'rm'
  number: string | undefined
  role: string | undefined
  argv: string[]
}

/** A factory CLI invocation, read as main.ts's own parser would. */
export type FactoryCall = {
  /** The command: the first positional. A `$`-word means the shell supplies it. */
  command: string | undefined
  positionals: string[]
  values: Record<string, string>
  /** xargs supplies the arguments, so they can't be read. */
  viaXargs: boolean
  sandbox?: SandboxCall
}

const RUNTIMES = new Set(['bun', 'node'])
/** The runtime's own flags that take a value: `bun --cwd factory/cli run …`. */
const RUNTIME_VALUES = new Set(['--cwd', '-r', '--preload', '--config', '--env-file', '--require'])
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
export const EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print'])

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

/** The factory CLI call a program makes, or null when it runs anything else. */
export function factoryCall(invocation: Invocation): FactoryCall | null {
  const runtime = runtimeFlags(invocation)
  if (!runtime || runtime.evaluates) return null
  const script = invocation.words[runtime.script]
  if (!script || !isFactoryScript(script, invocation.cwd)) return null
  const args = invocation.words.slice(runtime.script + 1)
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
      positionals.push(...args.slice(i + 1))
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
