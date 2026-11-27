import { describe, expect, test } from 'bun:test'
import { makeJob } from './job-fixture.ts'
import { approves, lightAcceptance, prBody, prComment, usageTable } from './commands/pr.ts'
import type { FactoryEvent } from './events.ts'

describe('approves', () => {
  test('a report whose first line is "Verdict: approve" approves', () => {
    expect(approves('Verdict: approve\n\nAll good.')).toBe(true)
  })

  test('leading blank lines do not matter', () => {
    expect(approves('\n\nVerdict: approve')).toBe(true)
  })

  test('"Verdict: changes" does not approve', () => {
    expect(approves('Verdict: changes\n\nVerdict: approve')).toBe(false)
  })

  test('an approve mentioned after the first line does not count', () => {
    expect(approves('Summary first\nVerdict: approve')).toBe(false)
  })
})

describe('prBody', () => {
  const parts = { summary: 'Did it.', acceptance: 'AC1 -> test' }

  test('closes the issue', () => {
    expect(prBody(makeJob({ number: 42 }), parts)).toContain('Closes #42')
  })

  test('stays under the length GitHub accepts, whatever the summary size', () => {
    const body = prBody(makeJob(), { ...parts, summary: 'x'.repeat(100_000) })
    expect(body.length).toBeLessThan(65_536)
    expect(body).toContain('…(cut')
  })

  test('says None when no acceptance test was fixed', () => {
    expect(prBody(makeJob(), parts)).toContain('None.')
  })

  test('lists authorized guarantee changes apart from the fixes', () => {
    const job = makeJob({
      rewrites: [{ commit: 'abcdef123', note: 'https://example.com/c/1', at: '2026-01-01' }],
    })
    const body = prBody(job, parts)
    expect(body).toContain('## Authorized guarantee changes')
    expect(body).toContain('abcdef1: https://example.com/c/1')
  })

  test('has no authorized-changes section when nothing was rewritten', () => {
    expect(prBody(makeJob(), parts)).not.toContain('Authorized guarantee changes')
  })
})

const usage = (usd: number, over: Record<string, unknown> = {}) => ({
  messages: 2,
  models: { 'claude-opus-5-5': 2 },
  efforts: { high: 2 },
  tokens: { input: 12, output: 3400, cacheRead: 250_000, cacheWrite5m: 1000, cacheWrite1h: 500 },
  usd,
  unpriced: [],
  ...over,
})
const event = (agent: { id: string; type: string } | undefined, detail: unknown): FactoryEvent => ({
  t: 'now',
  job: 7,
  source: 'hook',
  ...(agent ? { agent } : {}),
  kind: 'usage',
  detail: detail as Record<string, unknown>,
})

describe('usageTable and prComment', () => {
  const reviewer = { id: 'a97330887a0a40f7a', type: 'factory-test-reviewer' }

  test('one row per run with its model, effort and cost, and a total', () => {
    const table = usageTable([event(undefined, usage(1.5)), event(reviewer, usage(1.09))])
    expect(table).toContain(
      '| orchestrator | claude-opus-5-5 | high | 12 | 3.4k | 250k | 1.5k | $1.50 |',
    )
    expect(table).toContain('| factory-test-reviewer (a973308) |')
    expect(table).toContain('| **Total** | | | | | | | **$2.59** |')
  })

  test('a run that stopped twice counts once, at its latest total', () => {
    const table = usageTable([event(reviewer, usage(0.5)), event(reviewer, usage(0.9))])
    expect(table?.match(/factory-test-reviewer/g)).toHaveLength(1)
    expect(table).toContain('**$0.90**')
  })

  test('an unpriced model is named, not counted as $0', () => {
    const table = usageTable([event(reviewer, usage(0, { unpriced: ['claude-mystery-9'] }))])
    expect(table).toContain('$0.00 + unpriced (claude-mystery-9)')
  })

  test('several models in one run are listed with their message counts', () => {
    const table = usageTable([
      event(reviewer, usage(1, { models: { 'claude-opus-5-5': 2, 'claude-sonnet-5-5': 1 } })),
    ])
    expect(table).toContain('claude-opus-5-5 ×2, claude-sonnet-5-5 ×1')
  })

  test('no usage logged, no table and no heading', () => {
    expect(usageTable([])).toBeNull()
    const comment = prComment({
      buildNotes: 'notes',
      pass: 2,
      evaluator: 'E',
      testReviewer: 'T',
      usage: null,
    })
    expect(comment).not.toContain('Cost per agent')
    expect(comment).toContain('Evaluator, final report (pass 2)')
  })

  test('the table leads the comment, so a long report cannot cut it off', () => {
    const comment = prComment({
      buildNotes: 'x'.repeat(100_000),
      pass: 1,
      evaluator: 'E',
      testReviewer: 'T',
      usage: 'TABLE',
    })
    expect(comment.indexOf('TABLE')).toBeLessThan(comment.indexOf('Build notes'))
    expect(comment.length).toBeLessThan(65_536)
  })
})

describe('lightweight acceptance evidence', () => {
  const issue =
    '### Acceptance criteria\n\nAC1: The title is readable.\nAC2: Dark mode has the correct contrast.\n'
  test('uses each independent observation in issue order', () => {
    expect(
      lightAcceptance(
        issue,
        'Verdict: approve\n\nAC2: Checked the dark theme in the browser.\nAC1: Compared the rendered title with the issue.',
      ),
    ).toBe(
      'AC1: Compared the rendered title with the issue.\nAC2: Checked the dark theme in the browser.',
    )
  })
  test('refuses an approving report that omits an acceptance criterion', () => {
    expect(() => lightAcceptance(issue, 'Verdict: approve\nAC1: Verified.')).toThrow('AC2')
  })
  test('refuses blank mappings and ambiguous duplicates', () => {
    expect(() => lightAcceptance(issue, 'AC1: \nAC2: Verified.')).toThrow('AC1')
    expect(() => lightAcceptance(issue, 'AC1: One.\nAC1: Two.\nAC2: Checked.')).toThrow(
      'repeats AC1',
    )
  })
  test('refuses an issue without parseable acceptance criteria', () => {
    expect(() => lightAcceptance('# An issue', 'Verdict: approve')).toThrow('Cannot verify')
  })
})
