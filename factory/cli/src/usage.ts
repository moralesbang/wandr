// Tokens, models, efforts and cost of one agent run, read from its Claude Code transcript (JSONL).
// The transcript format is internal to Claude Code and may change, so every field is optional
// and a line that doesn't parse is skipped: a usage report may come out poorer, never throw.
// Only numbers and model names leave this file, never the conversation.

import { z } from 'zod'
import { priceOf } from './prices.ts'

export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

export type RunUsage = {
  /** Distinct assistant messages counted. */
  messages: number
  /** Messages per model and per effort level the run used. */
  models: Record<string, number>
  efforts: Record<string, number>
  tokens: Tokens
  /** The cost of the priced models' tokens only; see `unpriced`. */
  usd: number
  /** Models with tokens but no price: their cost is unknown, not zero. */
  unpriced: string[]
}

const count = z.number().optional()
const Line = z.looseObject({
  type: z.string(),
  effort: z.string().optional(),
  message: z
    .looseObject({
      id: z.string().optional(),
      model: z.string().optional(),
      usage: z
        .looseObject({
          input_tokens: count,
          output_tokens: count,
          cache_read_input_tokens: count,
          cache_creation_input_tokens: count,
          cache_creation: z
            .looseObject({ ephemeral_5m_input_tokens: count, ephemeral_1h_input_tokens: count })
            .optional(),
        })
        .optional(),
    })
    .optional(),
})
type Message = { model: string; effort?: string; tokens: Tokens }

const MILLION = 1_000_000
/** Claude Code names the placeholder it records for an error it made up; it has no cost. */
const SYNTHETIC = '<synthetic>'

function toMessage(line: z.infer<typeof Line>): Message | null {
  const { message } = line
  const usage = message?.usage
  if (line.type !== 'assistant' || !usage || !message.model || message.model === SYNTHETIC) {
    return null
  }
  const written = usage.cache_creation_input_tokens ?? 0
  const split = usage.cache_creation
  return {
    model: message.model,
    ...(line.effort ? { effort: line.effort } : {}),
    tokens: {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      // Without the breakdown, the shorter and cheaper lifetime is the assumption.
      cacheWrite5m: split ? (split.ephemeral_5m_input_tokens ?? 0) : written,
      cacheWrite1h: split?.ephemeral_1h_input_tokens ?? 0,
    },
  }
}

/** The run a transcript records, each message counted once however often its line repeats. */
export function summarizeTranscript(text: string): RunUsage {
  // A transcript repeats a message's line (one per content block); the last copy is kept.
  const byId = new Map<string, Message>()
  let anonymous = 0
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      continue
    }
    const line = Line.safeParse(json)
    if (!line.success) continue
    const message = toMessage(line.data)
    if (message) byId.set(line.data.message?.id ?? `line-${anonymous++}`, message)
  }

  const run: RunUsage = {
    messages: byId.size,
    models: {},
    efforts: {},
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    usd: 0,
    unpriced: [],
  }
  for (const { model, effort, tokens } of byId.values()) {
    run.models[model] = (run.models[model] ?? 0) + 1
    if (effort) run.efforts[effort] = (run.efforts[effort] ?? 0) + 1
    for (const kind of Object.keys(tokens) as (keyof Tokens)[]) run.tokens[kind] += tokens[kind]
    const price = priceOf(model)
    if (!price) {
      if (!run.unpriced.includes(model)) run.unpriced.push(model)
      continue
    }
    run.usd +=
      (tokens.input * price.input +
        tokens.output * price.output +
        tokens.cacheRead * price.cacheRead +
        tokens.cacheWrite5m * price.input * 1.25 +
        tokens.cacheWrite1h * price.input * 2) /
      MILLION
  }
  return run
}

/** The run's usage as the log keeps it, or null when the transcript can't be read. */
export function usageOf(path: string, readText: (path: string) => string | null): RunUsage | null {
  const text = readText(path)
  return text === null ? null : summarizeTranscript(text)
}
