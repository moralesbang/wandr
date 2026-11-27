import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LAUNCH_TABLE, launchSetting, ORCHESTRATOR } from './launch.ts'

// The agent files' own model and effort are what a run gets when the orchestrator's Agent call
// passes none: they must say what `factory launch` says for the agent's primary task at normal
// risk. The per-launch parameters override them for every other task and risk.

const REPO = join(import.meta.dir, '..', '..', '..')
const AGENTS_DIR = join(REPO, '.claude', 'agents')
const SKILL = join(REPO, '.claude', 'skills', 'factory', 'SKILL.md')

const PRIMARY_TASK: Record<string, string> = {
  'factory-test': 'write',
  'factory-build': 'build',
  'factory-evaluator': 'review',
  'factory-test-reviewer': 'review',
  'factory-diagnose': 'diagnose',
}

/** The `key: value` lines between the file's two `---` fences. */
function frontmatter(path: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(path, 'utf8'))
  if (!match) throw new Error(`${path} has no frontmatter`)
  return Object.fromEntries(
    match[1]!.split('\n').flatMap((line) => {
      const at = line.indexOf(':')
      return at === -1 ? [] : [[line.slice(0, at).trim(), line.slice(at + 1).trim()]]
    }),
  )
}

describe('agent frontmatter', () => {
  test('every agent in the launch table has a file, and every file an entry', () => {
    const files = readdirSync(AGENTS_DIR)
      .filter((name) => /^factory-.*\.md$/.test(name))
      .map((name) => name.replace(/\.md$/, ''))
      .toSorted()
    expect(files).toEqual(Object.keys(LAUNCH_TABLE).toSorted())
  })

  test('every agent has a primary task', () => {
    expect(Object.keys(PRIMARY_TASK).toSorted()).toEqual(Object.keys(LAUNCH_TABLE).toSorted())
  })

  test.each(Object.entries(PRIMARY_TASK))('%s matches its %s row at normal risk', (agent, task) => {
    const setting = launchSetting(agent, task, 'normal')
    if (!setting.ok) throw new Error(setting.reason)
    const meta = frontmatter(join(AGENTS_DIR, `${agent}.md`))
    expect({ name: meta.name, model: meta.model, effort: meta.effort }).toEqual({
      name: agent,
      model: setting.model,
      effort: setting.effort,
    })
  })

  test('the skill runs as the orchestrator setting', () => {
    const meta = frontmatter(SKILL)
    expect({ model: meta.model, effort: meta.effort }).toEqual(ORCHESTRATOR)
  })
})
