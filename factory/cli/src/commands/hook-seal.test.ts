// A reviewer's blind pass is blind only if every channel to the build agent's reasoning is closed
// until it is written. Job #13's reviewers read the Decision Request, the earlier final reports and
// the merged findings with `cat` before their blind passes, and factory watch saw nothing. These
// tests drive the guard the way Claude Code calls it, on a saved job with a real worktree layout,
// sealed with real files.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { readEvents, type FactoryEvent } from '../events.ts'
import { makeJob, writeBlindPass } from '../job-fixture.ts'
import { saveJob, stateDir } from '../job.ts'
import { seal, unseal } from '../seal.ts'
import { annotate } from '../annotate.ts'
import { hookGuard } from './hook.ts'

const NOTES_LINE = 'Adding width and height attributes to the icon links did not help.'

let root = ''
let worktree = ''
let handoff = ''

const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-guard-seal-'))
  worktree = join(root, '.claude', 'worktrees', '7-add-a-thing')
  handoff = join(worktree, 'factory', '.jobs', '7')
  // Pass 2: one round with findings is behind it.
  saveJob(root, makeJob({ worktree, session: 'job-session', rounds: 1 }))
  put(join(handoff, 'issue.md'), '# Add a thing (#7)\n')
  put(join(handoff, 'gate.json'), '{}\n')
  put(join(handoff, 'checks', '1.log'), 'green\n')
  put(join(handoff, 'build-notes.md'), `# Notes\n\n${NOTES_LINE}\n`)
  put(join(handoff, 'decision-requests', '1.md'), '# Context\n\nThe build escalated.\n')
  put(join(handoff, 'reviews', '1.evaluator.blind.md'), 'blind\n')
  put(join(handoff, 'reviews', '1.evaluator.md'), 'Verdict: changes\n')
  put(join(handoff, 'reviews', '1.test-reviewer.md'), 'Verdict: changes\n')
  put(join(handoff, 'reviews', '1.findings.md'), '# Findings\n')
  put(join(worktree, 'apps', 'web', 'src', 'main.ts'), 'x\n')
  put(join(root, 'apps', 'web', 'src', 'main.ts'), 'x\n')
  seal(root, 7, { pass: 2, roles: ['evaluator', 'test-reviewer'] })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

type Decision = { permissionDecision: string; permissionDecisionReason: string }

const EVALUATOR = { agent_id: 'e1', agent_type: 'factory-evaluator' }
const TEST_REVIEWER = { agent_id: 't1', agent_type: 'factory-test-reviewer' }
const BUILD = { agent_id: 'b1', agent_type: 'factory-build' }
const EXPLORE = { agent_id: 'x1', agent_type: 'Explore' }
type Who = typeof EVALUATOR | null

const call = (
  who: Who,
  tool: string,
  toolInput: Record<string, unknown>,
  cwd: string = worktree,
): Decision | null => {
  const out = hookGuard(
    root,
    JSON.stringify({
      session_id: 'job-session',
      hook_event_name: 'PreToolUse',
      tool_name: tool,
      tool_use_id: 'tu-1',
      cwd,
      tool_input: toolInput,
      ...who,
    }),
  )
  return out ? (JSON.parse(out) as { hookSpecificOutput: Decision }).hookSpecificOutput : null
}

const bash = (who: Who, command: string, cwd?: string) => call(who, 'Bash', { command }, cwd)
const read = (who: Who, path: string) => call(who, 'Read', { file_path: path })
const launch = (prompt: string) =>
  call(null, 'Agent', { subagent_type: 'factory-evaluator', description: 'review', prompt })
const message = (text: string) => call(null, 'SendMessage', { to: 'evaluator', message: text })
const blindPassesWritten = () => {
  writeBlindPass(root, 7, 2, 'evaluator')
  writeBlindPass(root, 7, 2, 'test-reviewer')
}

describe('the job folder, before the blind pass', () => {
  test('the sealed files are physically gone from it', () => {
    for (const path of [
      'build-notes.md',
      'decision-requests/1.md',
      'reviews/1.evaluator.md',
      'reviews/1.findings.md',
    ]) {
      expect(existsSync(join(handoff, path))).toBe(false)
    }
  })

  test.each([
    ['Read build-notes', EVALUATOR, () => read(EVALUATOR, join(handoff, 'build-notes.md'))],
    [
      "Read the other reviewer's earlier report",
      TEST_REVIEWER,
      () => read(TEST_REVIEWER, join(handoff, 'reviews/1.evaluator.md')),
    ],
    [
      'Read its own earlier final report',
      EVALUATOR,
      () => read(EVALUATOR, join(handoff, 'reviews/1.evaluator.md')),
    ],
    [
      'Read through a nested Explore run',
      EXPLORE,
      () => read(EXPLORE, join(handoff, 'build-notes.md')),
    ],
    ['cat build-notes', EVALUATOR, () => bash(EVALUATOR, 'cat factory/.jobs/7/build-notes.md')],
    [
      'cat the Decision Requests by glob (job #13, round 1)',
      TEST_REVIEWER,
      () =>
        bash(TEST_REVIEWER, 'git show HEAD | head -80; cat factory/.jobs/7/decision-requests/*.md'),
    ],
    [
      'cat the earlier reports and findings (job #13, round 2)',
      EVALUATOR,
      () =>
        bash(
          EVALUATOR,
          'cat factory/.jobs/7/acceptance.md; echo ----; cat factory/.jobs/7/reviews/1.evaluator.md; cat factory/.jobs/7/reviews/1.findings.md',
        ),
    ],
    [
      'cd into the folder, then cat',
      EVALUATOR,
      () => bash(EVALUATOR, 'cd factory/.jobs/7 && head -50 build-notes.md'),
    ],
    ['cat every file of the folder', EVALUATOR, () => bash(EVALUATOR, 'cat factory/.jobs/7/*')],
    [
      'Grep the notes by glob',
      EVALUATOR,
      () => call(EVALUATOR, 'Grep', { pattern: 'width', path: handoff, glob: 'build-notes.md' }),
    ],
    [
      'Grep the findings anywhere',
      EVALUATOR,
      () => call(EVALUATOR, 'Grep', { pattern: 'x', glob: '**/*.findings.md' }),
    ],
    [
      'Glob the Decision Requests',
      EVALUATOR,
      () => call(EVALUATOR, 'Glob', { pattern: 'factory/.jobs/7/decision-requests/*' }),
    ],
  ])('denies by name: %s', (_what, _who, run) => {
    const decision = run()
    expect(decision?.permissionDecision).toBe('deny')
    expect(decision?.permissionDecisionReason).toContain('blind')
  })

  test.each([
    ['Read the issue', () => read(EVALUATOR, join(handoff, 'issue.md'))],
    [
      'Read its earlier blind pass',
      () => read(EVALUATOR, join(handoff, 'reviews/1.evaluator.blind.md')),
    ],
    ['Read the repo', () => read(EVALUATOR, join(worktree, 'apps/web/src/main.ts'))],
    ['list the folder', () => bash(EVALUATOR, 'ls factory/.jobs/7 factory/.jobs/7/*')],
    [
      'cat the issue and the gate',
      () => bash(EVALUATOR, 'cat factory/.jobs/7/issue.md factory/.jobs/7/gate.json'),
    ],
    ['read the checks', () => bash(EVALUATOR, 'tail -40 factory/.jobs/7/checks/1.log')],
    [
      'read the diff',
      () => bash(EVALUATOR, 'git diff --stat main...HEAD && git log --oneline main..HEAD'),
    ],
    [
      'run in its sandbox',
      () => bash(EVALUATOR, 'bun run factory sandbox 7 evaluator -- bun test'),
    ],
    ['Glob the repo', () => call(EVALUATOR, 'Glob', { pattern: '**/*.md' })],
    ['Grep the repo', () => call(EVALUATOR, 'Grep', { pattern: 'icon' })],
    [
      'write its blind pass',
      () => call(EVALUATOR, 'Write', { file_path: join(handoff, 'reviews/2.evaluator.blind.md') }),
    ],
  ])('still allows: %s', (_what, run) => {
    expect(run()).toBeNull()
  })

  test('logs a denied read with its target, and factory watch flags it', () => {
    read(EVALUATOR, join(handoff, 'build-notes.md'))
    bash(EVALUATOR, 'cat factory/.jobs/7/build-notes.md')
    const denied = readEvents(root, 7).filter((event) => event.kind.endsWith('.denied'))
    expect(denied.map((event) => event.kind)).toEqual(['read.denied', 'bash.denied'])
    expect(denied[0]?.target).toEqual({ area: 'job', path: 'build-notes.md' })
    expect(denied[1]?.detail?.command).toBe('cat factory/.jobs/7/build-notes.md')
    expect(annotate(denied).every((event) => event.breach)).toBe(true)
  })
})

const SUBAGENTS = [
  ['the evaluator', EVALUATOR],
  ['the build agent', BUILD],
  ['a nested Explore run', EXPLORE],
] as const

describe.each(SUBAGENTS)('the main checkout, for %s at all times', (_who, who) => {
  test.each([
    ['Read the sealed store', () => read(who, join(stateDir(root, 7), 'sealed', 'build-notes.md'))],
    ['Read the event log', () => read(who, join(stateDir(root, 7), 'events.jsonl'))],
    ['Read the main checkout', () => read(who, join(root, 'apps/web/src/main.ts'))],
    [
      'Grep the state',
      () => call(who, 'Grep', { pattern: 'width', path: join(root, 'factory/.jobs') }),
    ],
    ['Glob the state', () => call(who, 'Glob', { pattern: '**/*.md', path: stateDir(root, 7) })],
    ['cat the sealed store', () => bash(who, `cat ${stateDir(root, 7)}/sealed/build-notes.md`)],
    [
      'cat it by a relative path',
      () => bash(who, 'cat ../../../factory/.jobs/7/sealed/build-notes.md'),
    ],
    ['jq the job', () => bash(who, `jq . ${stateDir(root, 7)}/job.json`)],
    ['grep the main checkout', () => bash(who, `grep -rn icon ${root}/apps`)],
    ['work from the main checkout', () => bash(who, 'git status', root)],
  ])('denies: %s', (_what, run) => {
    expect(run()?.permissionDecision).toBe('deny')
  })
})

describe.each(SUBAGENTS)('transcripts and task outputs, for %s at all times', (_who, who) => {
  const projects = join(homedir(), '.claude', 'projects')
  test.each([
    ['Read a transcript', () => read(who, join(projects, '-repo', 'session.jsonl'))],
    ['Grep the transcripts', () => call(who, 'Grep', { pattern: 'width', path: projects })],
    [
      'tail the subagent transcripts',
      () => bash(who, 'tail ~/.claude/projects/*/*/subagents/*.jsonl'),
    ],
    ['list them through $HOME', () => bash(who, 'ls $HOME/.claude/projects')],
    ['cat a task output', () => bash(who, 'cat /private/tmp/claude-501/-repo/s1/tasks/b1.output')],
    ['use the scratchpad', () => bash(who, 'S=/tmp/claude-501/-repo/s1/scratchpad && mkdir -p $S')],
  ])('denies: %s', (_what, run) => {
    const decision = run()
    expect(decision?.permissionDecision).toBe('deny')
    expect(decision?.permissionDecisionReason).toContain('transcripts')
  })

  // Claude Code saves an output too long to return there and tells the agent to read it: denying
  // it would leave the agent without its own command's output.
  test('allows reading a saved tool output', () => {
    const saved = join(projects, '-repo', 's1', 'tool-results', 'b1x2.txt')
    expect(read(who, saved)).toBeNull()
    expect(bash(who, `cat ${saved}`)).toBeNull()
  })

  test('still denies a transcript next to the saved outputs', () => {
    expect(
      read(who, join(projects, '-repo', 's1', 'subagents', 'agent-a.jsonl'))?.permissionDecision,
    ).toBe('deny')
  })
})

describe('gh and the seal commands', () => {
  test.each(SUBAGENTS)('denies %s any gh command, reads included', (_who, who) => {
    for (const command of [
      'gh issue view 7 --comments',
      'gh pr view 5',
      'gh api repos/o/r/issues/7/comments',
    ]) {
      const decision = bash(who, command)
      expect(decision?.permissionDecision).toBe('deny')
    }
    expect(bash(who, 'gh issue view 7 --comments')?.permissionDecisionReason).toContain('issue.md')
  })

  test.each([
    'bun run factory unseal 7',
    'bun run factory seal 7 --pass 2 --roles evaluator',
    'bun run factory review 7',
    'bun factory/cli/src/main.ts unseal 7',
    'bun run factory ruling 7',
    'bun run factory atfix 7 --ruling 1 --note x',
    'bun run factory rewrite 7 --note x',
    'bun run factory launch 7 factory-build --task build',
    'bun run factory round 7',
    'bun run factory pr 7',
  ])('denies a subagent running %s', (command) => {
    const decision = bash(EVALUATOR, command)
    expect(decision?.permissionDecision).toBe('deny')
    expect(decision?.permissionDecisionReason).toContain('orchestrator')
  })

  test.each(['bun run factory check 7', 'bun run factory status'])(
    'lets a subagent run %s',
    (command) => {
      expect(bash(EVALUATOR, command)).toBeNull()
    },
  )

  test.each(['gh issue view 7 --comments', 'bun run factory unseal 7'])(
    'lets the orchestrator run %s',
    (command) => {
      expect(bash(null, command, root)).toBeNull()
    },
  )
})

describe("the orchestrator's prompts while sealed", () => {
  const CLEAN = `Review issue 7, pass 2. Worktree ${worktree}. Job folder ${handoff}. Gate: ${handoff}/gate.json.`

  test.each([
    ['names the build notes', () => launch(`${CLEAN} Also read ${handoff}/build-notes.md.`)],
    ['names the merged findings', () => launch(`${CLEAN} See reviews/1.findings.md.`)],
    [
      'names a Decision Request',
      () => launch(`${CLEAN} The build escalated: decision-requests/1.md.`),
    ],
    ['quotes the build notes', () => launch(`${CLEAN} Note: ${NOTES_LINE}`)],
    ['sends the build notes by SendMessage', () => message(`Now read ${handoff}/build-notes.md`)],
  ])('denies a prompt that %s', (_what, run) => {
    const decision = run()
    expect(decision?.permissionDecision).toBe('deny')
    expect(decision?.permissionDecisionReason).toContain('factory unseal 7')
  })

  test('allows a prompt that holds only the blind inputs', () => {
    expect(launch(CLEAN)).toBeNull()
  })

  test('allows sending the build notes once unsealed', () => {
    blindPassesWritten()
    unseal(root, 7)
    expect(message(`Now read ${handoff}/build-notes.md`)).toBeNull()
  })
})

describe("the orchestrator's writes", () => {
  test("denies an Edit or Write into the main checkout's job state", () => {
    for (const tool of ['Write', 'Edit']) {
      expect(
        call(null, tool, { file_path: join(stateDir(root, 7), 'job.json') }, root)
          ?.permissionDecision,
      ).toBe('deny')
    }
  })

  test('denies writing a sealed name into the job folder while sealed, and allows it after', () => {
    expect(
      call(null, 'Write', { file_path: join(handoff, 'summary.md') })?.permissionDecision,
    ).toBe('deny')
    blindPassesWritten()
    unseal(root, 7)
    expect(call(null, 'Write', { file_path: join(handoff, 'summary.md') })).toBeNull()
  })
})

describe('after unseal', () => {
  test('a reviewer whose blind pass is written reads the build notes, by Read and by Bash', () => {
    blindPassesWritten()
    unseal(root, 7)
    expect(readFileSync(join(handoff, 'build-notes.md'), 'utf8')).toContain(NOTES_LINE)
    expect(read(EVALUATOR, join(handoff, 'build-notes.md'))).toBeNull()
    expect(bash(EVALUATOR, `cat -n ${handoff}/build-notes.md`)).toBeNull()
    expect(bash(TEST_REVIEWER, 'cat factory/.jobs/7/reviews/1.findings.md')).toBeNull()
  })

  test('the main checkout stays closed', () => {
    blindPassesWritten()
    unseal(root, 7)
    expect(read(EVALUATOR, join(stateDir(root, 7), 'job.json'))?.permissionDecision).toBe('deny')
  })
})

// Job #13's reviewers, replayed: every command factory watch flags as reading a sealed input before
// the blind pass is denied by the guard, at the same moment, on the same layout.
describe("replay: job #13's reviewers through the guard", () => {
  const fixture = readFileSync(
    join(import.meta.dir, '..', 'replay-fixtures', 'job13-reviewers.jsonl'),
    'utf8',
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FactoryEvent)

  const premature = annotate(fixture).filter(
    (event) =>
      event.kind === 'bash' && event.breach?.includes('before writing its blind first pass'),
  )

  test('factory watch finds the four sealed reads of job #13', () => {
    expect(premature.map((event) => `${event.t.slice(11, 19)} ${event.role}`)).toEqual([
      '20:25:24 factory-evaluator',
      '20:25:28 factory-test-reviewer',
      '20:30:45 factory-evaluator',
      '20:30:45 factory-test-reviewer',
    ])
  })

  test.each([1, 2])('the guard denies pass %i of them', (pass) => {
    const main = mkdtempSync(join(tmpdir(), 'factory-replay-'))
    try {
      const tree = join(main, '.claude', 'worktrees', '13-ux-give-wandr-a-favicon-and-app-icons')
      const job = join(tree, 'factory', '.jobs', '13')
      saveJob(
        main,
        makeJob({ number: 13, worktree: tree, session: 'job-session', rounds: pass - 1 }),
      )
      put(join(job, 'build-notes.md'), 'notes\n')
      put(join(job, 'decision-requests', '1.md'), 'request\n')
      put(join(job, 'decision-requests', '1.posted.md'), 'request\n')
      if (pass === 2) {
        for (const report of ['1.evaluator.md', '1.test-reviewer.md', '1.findings.md']) {
          put(join(job, 'reviews', report), 'report\n')
        }
      }
      seal(main, 13, { pass, roles: ['evaluator', 'test-reviewer'] })
      const ofPass = premature.filter((event) => (event.t < '2026-11-26T20:29:56' ? 1 : 2) === pass)
      expect(ofPass).toHaveLength(2)
      for (const event of ofPass) {
        const out = hookGuard(
          main,
          JSON.stringify({
            session_id: 'job-session',
            hook_event_name: 'PreToolUse',
            tool_name: 'Bash',
            cwd: tree,
            agent_id: event.agent?.id,
            agent_type: event.agent?.type,
            tool_input: { command: String(event.detail?.command).replaceAll('/repo', main) },
          }),
        )
        expect(out).toContain('"permissionDecision":"deny"')
      }
    } finally {
      rmSync(main, { recursive: true, force: true })
    }
  })
})

// The adversarial review of factory v1.3 reached the sealed store through each of these.
const store = () => join(stateDir(root, 7), 'sealed')
/** The sealed store as a path relative to `/`. */
const fromRoot = () => store().slice(1)

describe.each(SUBAGENTS)('ways around the main checkout, for %s', (_who, who) => {
  test.each([
    ['link the file system root', () => bash(who, 'ln -s / r')],
    ['link the main checkout through $PWD', () => bash(who, 'ln -s $PWD/../../.. m')],
    [
      'link it in one go and read through it',
      () => bash(who, `ln -s / r && cat r${store()}/build-notes.md`),
    ],
    ['pushd to the root', () => bash(who, `pushd / && cat ${fromRoot()}/build-notes.md`)],
    ['cd -P to the root', () => bash(who, `cd -P / && cat ${fromRoot()}/build-notes.md`)],
    ['builtin cd to the root', () => bash(who, `builtin cd / && cat ${fromRoot()}/build-notes.md`)],
    [
      'find from the root',
      () => bash(who, "find / -name build-notes.md -path '*sealed*' -exec cat {} +"),
    ],
    ['rg from the root', () => bash(who, 'rg -uu --no-messages Adding /')],
    ['grep -r from /private', () => bash(who, 'grep -rl Adding /private')],
    ['du the home folder', () => bash(who, `du -a ${homedir()}`)],
    [
      'Grep from the root',
      () => call(who, 'Grep', { pattern: 'Adding', path: '/', glob: '**/sealed/**' }),
    ],
    ['Glob from the root', () => call(who, 'Glob', { pattern: '**/sealed/**', path: '/' })],
    [
      'Glob an absolute pattern from the root',
      () => call(who, 'Glob', { pattern: '/**/sealed/**' }),
    ],
    [
      'quote $HOME back up to the root',
      () => bash(who, `cat "$HOME/../..${store()}/build-notes.md"`),
    ],
    [
      'run the CLI sandbox with a path relative to it',
      () =>
        bash(
          who,
          `bun run factory sandbox exec 7 evaluator -- cat ${relative(join(handoff, 'sandbox', 'evaluator'), join(store(), 'build-notes.md'))}`,
        ),
    ],
  ])('denies: %s', (_what, run) => {
    expect(run()?.permissionDecision).toBe('deny')
  })

  test('denies a read through a link that already exists', () => {
    symlinkSync('/', join(worktree, 'r'))
    expect(read(who, join(worktree, 'r', store(), 'build-notes.md'))?.permissionDecision).toBe(
      'deny',
    )
    expect(bash(who, `cat r${store()}/build-notes.md`)?.permissionDecision).toBe('deny')
    expect(bash(who, 'cat r/etc/hosts')).toBeNull()
  })

  test('still lets a lone / be an argument', () => {
    expect(bash(who, 'echo a/b | tr / -')).toBeNull()
    expect(bash(who, 'ls /')).toBeNull()
  })
})

describe.each(SUBAGENTS)("Claude Code's own files, for %s at all times", (_who, who) => {
  const claude = join(homedir(), '.claude')
  test.each([
    [
      'grep its file history',
      () => bash(who, 'grep -rl "Decision Request" ~/.claude/file-history'),
    ],
    ['cat its file history', () => bash(who, `cat ${claude}/file-history/*/*`)],
    [
      'Grep its file history',
      () => call(who, 'Grep', { pattern: 'x', path: join(claude, 'file-history') }),
    ],
    [
      'Read a file-history version',
      () => read(who, join(claude, 'file-history', 'ea6d', 'c69f@v2')),
    ],
    ['cat the prompt history', () => bash(who, `cat ${claude}/history.jsonl`)],
    ['list its tasks', () => bash(who, `ls ${claude}/tasks ${claude}/jobs`)],
    ['reach it through $USER', () => bash(who, 'cat /Users/$USER/.claude/history.jsonl')],
    ['reach it through ${HOME}', () => bash(who, 'cat ${HOME}/.claude/history.jsonl')],
    ['cat a task output in $TMPDIR', () => bash(who, 'cat $TMPDIR/claude-501/x/tasks/abc.output')],
    [
      'cat a task output in ${TMPDIR}',
      () => bash(who, 'cat ${TMPDIR}/claude-501/x/tasks/abc.output'),
    ],
    [
      'cat a task output in a macOS temp folder',
      () => bash(who, 'cat /var/folders/n6/x/T/claude-501/tasks/a.output'),
    ],
  ])('denies: %s', (_what, run) => {
    const decision = run()
    expect(decision?.permissionDecision).toBe('deny')
    expect(decision?.permissionDecisionReason).toContain('tool-results')
  })
})

describe("the orchestrator's prompts and writes while sealed, by shingles", () => {
  test.each([
    [
      'a quote cut short of its line',
      () => 'Review. Context: Adding width and height attributes to the icon links did not',
    ],
    [
      'a quote in other case and spacing',
      () =>
        'Review. Context: adding   width and HEIGHT attributes to the icon\nlinks did not help.',
    ],
    [
      'the build notes, unhyphenated',
      () => 'Review. The build notes say the width attrs did not help.',
    ],
    ['the sealed store without a slash', () => `Read ${join(stateDir(root, 7), 'sealed')}`],
  ])('denies a prompt with %s', (_what, prompt) => {
    expect(launch(prompt())?.permissionDecision).toBe('deny')
  })

  test.each(['context.md', 'issue.md'])(
    'denies the orchestrator writing sealed text into the job folder (%s)',
    (name) => {
      const decision = call(null, 'Write', { file_path: join(handoff, name), content: NOTES_LINE })
      expect(decision?.permissionDecision).toBe('deny')
      expect(
        call(null, 'Edit', {
          file_path: join(handoff, name),
          old_string: 'a',
          new_string: `x ${NOTES_LINE}`,
        })?.permissionDecision,
      ).toBe('deny')
    },
  )

  test('lets the orchestrator write its own words there', () => {
    expect(
      call(null, 'Write', {
        file_path: join(handoff, 'issue.md'),
        content: '# Add a thing (#7)\n',
      }),
    ).toBeNull()
  })
})
