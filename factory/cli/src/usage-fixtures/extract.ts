// Builds a usage fixture from a real Claude Code session, keeping only what the cost is computed
// from: for every assistant line its type, message id, model, the token counts of its usage and
// its effort, and for every
// subagent the agent type and model its meta.json names. No conversation content is copied.
// Duplicate lines are kept on purpose: the tests deduplicate by message id.
//
// Usage: bun src/usage-fixtures/extract.ts <session.jsonl> <outDir>
// The subagents' transcripts are read from <session>/subagents/, as Claude Code lays them out.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

type Json = Record<string, unknown>

export function reduceTranscript(text: string): string {
  const kept: string[] = []
  for (const line of text.split('\n')) {
    let parsed: Json
    try {
      parsed = JSON.parse(line) as Json
    } catch {
      continue
    }
    if (parsed.type !== 'assistant') continue
    const message = (parsed.message ?? {}) as Json
    const usage = (message.usage ?? {}) as Json
    kept.push(
      JSON.stringify({
        type: 'assistant',
        message: {
          id: message.id,
          model: message.model,
          usage: {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_read_input_tokens: usage.cache_read_input_tokens,
            cache_creation_input_tokens: usage.cache_creation_input_tokens,
            cache_creation: usage.cache_creation,
          },
        },
        effort: parsed.effort,
      }),
    )
  }
  return `${kept.join('\n')}\n`
}

export function reduceMeta(text: string): string {
  const meta = JSON.parse(text) as Json
  return JSON.stringify({ agentType: meta.agentType, model: meta.model, effort: meta.effort })
}

if (import.meta.main) {
  const [session, out] = process.argv.slice(2)
  if (!session || !out) throw new Error('Usage: extract.ts <session.jsonl> <outDir>')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'main.jsonl'), reduceTranscript(readFileSync(session, 'utf8')))
  const subagents = join(session.replace(/\.jsonl$/, ''), 'subagents')
  for (const name of readdirSync(subagents)) {
    const text = readFileSync(join(subagents, name), 'utf8')
    if (name.endsWith('.jsonl')) writeFileSync(join(out, name), reduceTranscript(text))
    else if (name.endsWith('.meta.json')) writeFileSync(join(out, basename(name)), reduceMeta(text))
  }
}
