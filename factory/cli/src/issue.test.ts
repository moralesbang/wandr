import { describe, expect, test } from 'bun:test'
import { parseCriteria, slugify } from './issue.ts'

const issue = (criteria: string) =>
  `### Description\n\nSomething.\n\n### Acceptance criteria\n\n${criteria}\n`

describe('parseCriteria', () => {
  test('reads AC1..ACn in order', () => {
    const parsed = parseCriteria(issue('AC1: a walk can be saved\nAC2: a walk can be deleted'))
    expect(parsed).toEqual({
      ok: true,
      criteria: [
        { id: 'AC1', text: 'a walk can be saved' },
        { id: 'AC2', text: 'a walk can be deleted' },
      ],
    })
  })

  test('accepts bullets and bold ids', () => {
    const parsed = parseCriteria(issue('- **AC1**: first\n- **AC2**: second'))
    expect(parsed.ok && parsed.criteria.map((c) => c.id)).toEqual(['AC1', 'AC2'])
  })

  test('stops at the next heading', () => {
    const body = `${issue('AC1: first')}\n### Notes\n\nAC2: not a criterion\n`
    const parsed = parseCriteria(body)
    expect(parsed.ok && parsed.criteria).toHaveLength(1)
  })

  test('refuses an issue without the section', () => {
    const parsed = parseCriteria('### Description\n\nAC1: x')
    expect(parsed.ok).toBe(false)
  })

  test('refuses criteria that are not numbered', () => {
    expect(parseCriteria(issue('- it works')).ok).toBe(false)
  })

  test('refuses criteria out of order', () => {
    const parsed = parseCriteria(issue('AC2: second\nAC1: first'))
    expect(parsed.ok).toBe(false)
  })

  test('refuses a gap in the numbering', () => {
    expect(parseCriteria(issue('AC1: first\nAC3: third')).ok).toBe(false)
  })
})

describe('slugify', () => {
  test('makes a kebab-case branch-safe slug', () => {
    expect(slugify('Add: Walk Photos (v2)!')).toBe('add-walk-photos-v2')
  })

  test('cuts at 40 characters without a trailing dash', () => {
    const slug = slugify('word '.repeat(30))
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
  })

  test('strips accents', () => {
    expect(slugify('Caminata por el parque Chapultepec áéí')).toBe(
      'caminata-por-el-parque-chapultepec-aei',
    )
  })

  test('falls back to "issue" when nothing is left', () => {
    expect(slugify('!!!')).toBe('issue')
  })
})
