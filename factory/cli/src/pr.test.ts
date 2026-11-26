import { describe, expect, test } from 'bun:test'
import { makeJob } from './job-fixture.ts'
import { approves, prBody } from './commands/pr.ts'

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
