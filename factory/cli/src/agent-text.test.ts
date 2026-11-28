// Value record (T-009). Guarantee: the text of a factory agent's file does not steer it to an
// action the guard denies or the machine can't do. Defect caught: job #15's writers read "redirect
// their output into a file you can read (a reviewer's sandbox)", copied from the reviewers' files,
// and wrote to Claude Code's scratchpad (denied three times); the test agent read "with a timeout"
// as GNU `timeout`, which macOS lacks, twice. No acceptance test gives either: both are wording of
// a prompt, not behavior of the CLI. Level: the agent files as text.

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..', '..')
const AGENTS_DIR = join(REPO, '.claude', 'agents')
const SKILL_DIR = join(REPO, '.claude', 'skills', 'factory')

const agents = readdirSync(AGENTS_DIR)
  .filter((name) => name.startsWith('factory-') && name.endsWith('.md'))
  .map((name) => {
    const text = readFileSync(join(AGENTS_DIR, name), 'utf8')
    const tools = /^tools:\s*(.*)$/m.exec(text)?.[1] ?? ''
    return {
      name,
      text,
      writes: /\b(Edit|Write)\b/.test(tools),
      // Only a reviewer is given a sandbox, and its file says how to make one.
      sandbox: text.includes('factory sandbox'),
    }
  })

describe('agent text', () => {
  test('the factory agents are found, writers and reviewers both', () => {
    expect(agents.some((a) => a.writes && !a.sandbox)).toBe(true)
    expect(agents.some((a) => a.sandbox)).toBe(true)
  })

  test.each(agents.filter((a) => a.writes && !a.sandbox).map((a) => [a.name, a.text] as const))(
    '%s has no sandbox, so its file names none',
    (_name, text) => {
      expect(text).not.toMatch(/sandbox/i)
    },
  )

  const files = [
    ...agents.map((a) => [a.name, a.text] as const),
    ...readdirSync(AGENTS_DIR)
      .filter((name) => name.endsWith('.md') && !name.startsWith('factory-'))
      .map((name) => [name, readFileSync(join(AGENTS_DIR, name), 'utf8')] as const),
    ...readdirSync(SKILL_DIR, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith('.md'))
      .map((name) => [`skill ${name}`, readFileSync(join(SKILL_DIR, name), 'utf8')] as const),
  ]

  test.each(files)(
    '%s says "with the Bash tool\'s timeout parameter", not "with a timeout"',
    (_n, text) => {
      const sentences = text.split(/(?<=[.;:])\s|\n/)
      const bare = sentences.filter((s) => /with a timeout/i.test(s) && !s.includes('Bash tool'))
      expect(bare).toEqual([])
    },
  )
})
