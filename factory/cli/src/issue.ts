// Reading an issue written with .github/ISSUE_TEMPLATE/factory.yml.

export type AcceptanceCriterion = { id: string; text: string }

export type ParsedCriteria =
  | { ok: true; criteria: AcceptanceCriterion[] }
  | { ok: false; reason: string }

const SECTION = /^###\s+Acceptance criteria\s*$/im
const CRITERION = /^\s*(?:[-*]\s+)?\*{0,2}AC(\d+)\*{0,2}\s*[:.)-]\s*(.+?)\s*$/i

/** The numbered acceptance criteria (AC1, AC2…) under the form's "Acceptance criteria" heading. */
export function parseCriteria(body: string): ParsedCriteria {
  const start = body.search(SECTION)
  if (start === -1) {
    return { ok: false, reason: 'The issue has no "Acceptance criteria" section.' }
  }
  const afterHeading = body.slice(start).split('\n').slice(1)
  const nextHeading = afterHeading.findIndex((line) => /^#{1,3}\s/.test(line))
  const section = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading)

  const criteria: AcceptanceCriterion[] = []
  for (const line of section) {
    const match = CRITERION.exec(line)
    if (match) criteria.push({ id: `AC${match[1]}`, text: match[2] ?? '' })
  }
  if (criteria.length === 0) {
    return { ok: false, reason: 'The acceptance criteria are not numbered AC1, AC2…' }
  }
  const outOfOrder = criteria.find((criterion, index) => criterion.id !== `AC${index + 1}`)
  if (outOfOrder) {
    return {
      ok: false,
      reason: `The acceptance criteria must be numbered AC1, AC2… in order; found ${outOfOrder.id} at position ${criteria.indexOf(outOfOrder) + 1}.`,
    }
  }
  return { ok: true, criteria }
}

/** A branch-safe slug of the issue's title: lowercase, kebab-case, at most 40 characters. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.slice(0, 40).replace(/-+$/, '') || 'issue'
}
