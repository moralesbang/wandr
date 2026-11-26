import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { summarizeTranscript } from './usage.ts'

const fixtures = join(import.meta.dir, 'usage-fixtures', 'job13')
const transcript = (name: string) => readFileSync(join(fixtures, name), 'utf8')

const line = (
  id: string,
  usage: Record<string, unknown>,
  model = 'claude-opus-5-5',
  effort: string | null = 'high',
) =>
  JSON.stringify({
    type: 'assistant',
    message: { id, model, usage },
    ...(effort ? { effort } : {}),
  })

const MILLION = 1_000_000

// The numbers come from a real job, and are the ones the user computed by hand from the same
// transcripts: a wrong price, a double count or a missed line moves one of them.
describe('job #13, the evidence the cost rule was written against', () => {
  const runs = [
    ['main.jsonl', 'orchestrator', 1.57, 'claude-opus-5-5', 'high'],
    ['agent-a97330887a0a40f7a.jsonl', 'test reviewer', 1.09, 'claude-opus-5-5', 'high'],
    ['agent-aa7cbc602fa17ef99.jsonl', 'evaluator', 0.95, 'claude-opus-5-5', 'high'],
    ['agent-ad0edbae6a57faccb.jsonl', 'evaluator', 0.85, 'claude-opus-5-5', 'high'],
    ['agent-ab366458ff23b9b46.jsonl', 'test reviewer', 0.79, 'claude-opus-5-5', 'high'],
    ['agent-a4111c9ac2f859365.jsonl', 'build', 0.19, 'claude-sonnet-5-5', 'medium'],
    ['agent-a397a590949d17b71.jsonl', 'test', 0.14, 'claude-sonnet-5-5', 'medium'],
    ['agent-a2daecb604a3c8a61.jsonl', 'test', 0.07, 'claude-sonnet-5-5', 'medium'],
    ['agent-a0cee599615572029.jsonl', 'test', 0.04, 'claude-sonnet-5-5', 'medium'],
  ] as const

  test.each(runs)(
    '%s (%s) costs about $%d, with its model and effort',
    (file, _who, usd, model, effort) => {
      const run = summarizeTranscript(transcript(file))
      expect(Math.abs(run.usd - usd)).toBeLessThan(0.01)
      expect(Object.keys(run.models)).toEqual([model])
      expect(Object.keys(run.efforts)).toEqual([effort])
      expect(run.unpriced).toEqual([])
    },
  )

  test('the job costs $5.69 in all', () => {
    const files = readdirSync(fixtures).filter((name) => name.endsWith('.jsonl'))
    expect(files).toHaveLength(runs.length)
    const total = files.reduce((sum, file) => sum + summarizeTranscript(transcript(file)).usd, 0)
    expect(Math.abs(total - 5.69)).toBeLessThan(0.01)
  })
})

describe('summarizeTranscript', () => {
  test('a line a transcript repeats is counted once', () => {
    const once = line('msg_1', { input_tokens: 1000, output_tokens: 100 })
    const run = summarizeTranscript([once, once, once].join('\n'))
    expect(run.messages).toBe(1)
    expect(run.tokens.input).toBe(1000)
  })

  test('prices input, output and cache reads per million tokens', () => {
    const run = summarizeTranscript(
      line('msg_1', {
        input_tokens: MILLION,
        output_tokens: MILLION,
        cache_read_input_tokens: MILLION,
      }),
    )
    expect(run.usd).toBeCloseTo(4 + 20 + 0.2, 6)
  })

  test('a 5-minute cache write costs 1.25 times the input price', () => {
    const run = summarizeTranscript(
      line('msg_1', { cache_creation: { ephemeral_5m_input_tokens: MILLION } }),
    )
    expect(run.usd).toBeCloseTo(4 * 1.25, 6)
    expect(run.tokens.cacheWrite5m).toBe(MILLION)
  })

  test('a 1-hour cache write costs twice the input price', () => {
    const run = summarizeTranscript(
      line('msg_1', { cache_creation: { ephemeral_1h_input_tokens: MILLION } }),
    )
    expect(run.usd).toBeCloseTo(4 * 2, 6)
    expect(run.tokens.cacheWrite1h).toBe(MILLION)
  })

  test('a cache write with no breakdown is priced as a 5-minute one', () => {
    const run = summarizeTranscript(line('msg_1', { cache_creation_input_tokens: MILLION }))
    expect(run.usd).toBeCloseTo(4 * 1.25, 6)
  })

  test('a model without a price is reported as unpriced, not as free', () => {
    const run = summarizeTranscript(
      [
        line('msg_1', { output_tokens: MILLION }, 'claude-opus-5-5'),
        line('msg_2', { output_tokens: MILLION }, 'claude-mystery-9'),
      ].join('\n'),
    )
    expect(run.usd).toBeCloseTo(20, 6)
    expect(run.unpriced).toEqual(['claude-mystery-9'])
    expect(run.tokens.output).toBe(2 * MILLION)
  })

  test('counts the messages of each model and effort a run used', () => {
    const run = summarizeTranscript(
      [
        line('msg_1', { output_tokens: 1 }, 'claude-opus-5-5', 'high'),
        line('msg_2', { output_tokens: 1 }, 'claude-sonnet-5-5', 'medium'),
        line('msg_3', { output_tokens: 1 }, 'claude-sonnet-5-5', 'medium'),
      ].join('\n'),
    )
    expect(run.models).toEqual({ 'claude-opus-5-5': 1, 'claude-sonnet-5-5': 2 })
    expect(run.efforts).toEqual({ high: 1, medium: 2 })
  })

  test('skips what it cannot read and keeps the rest', () => {
    const run = summarizeTranscript(
      [
        '{"type":"assistant","message":{"id":"msg_0","usa',
        'not json at all',
        JSON.stringify({ type: 'user', message: { content: 'hello' } }),
        JSON.stringify({ type: 'assistant', message: { id: 'msg_x', usage: 'oops' } }),
        line('msg_1', { output_tokens: 10 }),
      ].join('\n'),
    )
    expect(run.messages).toBe(1)
    expect(run.tokens.output).toBe(10)
  })

  test('a line with no effort adds no effort', () => {
    const run = summarizeTranscript(line('msg_1', { output_tokens: 1 }, 'claude-opus-5-5', null))
    expect(run.efforts).toEqual({})
    expect(run.messages).toBe(1)
  })
})
