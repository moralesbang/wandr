// Extracts the replay fixture from a job's event log: the CLI's steps, and the reviewers' runs,
// reads, searches, Bash commands and blind-pass writes. It keeps commands and paths only, and puts
// /repo in place of the main checkout's root so the fixture names no machine.
//
//   bun src/replay-fixtures/extract.ts <events.jsonl> <main checkout root> > src/replay-fixtures/job13-reviewers.jsonl

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type { FactoryEvent } from '../events.ts'

const [file, root] = Bun.argv.slice(2)
if (!file || !root) {
  console.error('Usage: bun src/replay-fixtures/extract.ts <events.jsonl> <main checkout root>')
  process.exit(2)
}

const REVIEWER = /^factory-(evaluator|test-reviewer)$/
const BLIND_PASS = /^reviews\/\d+\.(evaluator|test-reviewer)\.blind\.md$/
// Claude Code names a project's folders after its path: /a/b becomes -a-b. The log cuts a command at
// 300 characters, so a path cut short still names the home folder.
const slug = (path: string) => path.replaceAll('/', '-')
const anonymize = (text: string) =>
  text
    .replaceAll(root, '/repo')
    .replaceAll(slug(root), '-repo')
    .replaceAll(homedir(), '/home/dev')
    .replaceAll(slug(homedir()), '-home-dev')

const kept: FactoryEvent[] = []
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue
  const event = JSON.parse(line) as FactoryEvent
  const base = { t: event.t, job: event.job, source: event.source, kind: event.kind }
  if (event.source === 'cli') {
    const worktree = event.detail?.worktree
    kept.push(
      event.kind === 'job.started' && typeof worktree === 'string'
        ? { ...base, detail: { worktree: anonymize(worktree) } }
        : base,
    )
    continue
  }
  if (!event.agent || !REVIEWER.test(event.agent.type)) continue
  const agent = { agent: event.agent }
  const target = event.target
    ? { target: { ...event.target, path: anonymize(event.target.path) } }
    : {}
  switch (event.kind) {
    case 'agent.start':
    case 'agent.stop':
      kept.push({ ...base, ...agent })
      break
    case 'read':
      kept.push({ ...base, ...agent, ...target })
      break
    case 'search':
      kept.push({
        ...base,
        ...agent,
        ...target,
        detail: { tool: event.detail?.tool, pattern: event.detail?.pattern },
      })
      break
    case 'bash':
      kept.push({
        ...base,
        ...agent,
        detail: { command: anonymize(String(event.detail?.command)) },
      })
      break
    case 'write':
      if (event.target && BLIND_PASS.test(event.target.path))
        kept.push({ ...base, ...agent, ...target })
      break
    default:
      break
  }
}
process.stdout.write(kept.map((event) => JSON.stringify(event)).join('\n') + '\n')
