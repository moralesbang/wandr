import { describe, expect, test } from 'bun:test'
import {
  RepoFile,
  RoutingPlan,
  RoutingProposal,
  planRouting,
  reassessRouting,
  requiresAcceptance,
  type RoutingProposal as Proposal,
} from './routing.ts'

const proposal = (changes: Partial<Proposal> = {}): Proposal => ({
  scope: 'frontend',
  complexity: 'small',
  evidence: ['The issue changes the spacing token in one stylesheet.'],
  expectedPaths: ['apps/web/src/styles.css'],
  behaviorChange: false,
  uncertainty: [],
  verification: ['Run CI and inspect the spacing in both themes.'],
  ...changes,
})

describe('routing policy', () => {
  test.each([
    ['low', {}, 'light'],
    ['normal', {}, 'standard'],
    ['high', {}, 'reinforced'],
    ['low', { behaviorChange: true }, 'standard'],
    ['low', { complexity: 'standard' }, 'standard'],
    ['low', { complexity: 'uncertain' }, 'research'],
    ['high', { uncertainty: ['The ownership rule is unresolved.'] }, 'research'],
    ['low', { expectedPaths: ['apps/web/src/routes/index.tsx'] }, 'standard'],
    ['low', { expectedPaths: ['docs/04-flows.md'] }, 'light'],
    ['low', { expectedPaths: ['README.md'] }, 'light'],
    ['low', { expectedPaths: ['knowledge/standards/testing.md'] }, 'standard'],
    ['low', { expectedPaths: ['factory/README.md'] }, 'standard'],
    ['low', { expectedPaths: ['apps/web/src/styles.test.ts'] }, 'standard'],
    ['low', { expectedPaths: ['apps/web/package.json'] }, 'standard'],
    ['low', { expectedPaths: ['apps/api/src/routes/walks.ts'] }, 'reinforced'],
    ['normal', { expectedPaths: ['apps/api/src/db/schema.ts'] }, 'reinforced'],
    ['low', { expectedPaths: ['apps/api/drizzle/0001_walks.sql'] }, 'reinforced'],
    ['low', { expectedPaths: ['apps/api/src/auth.ts'] }, 'reinforced'],
    ['low', { expectedPaths: ['apps/api/src/sessions/session.ts'] }, 'reinforced'],
    ['low', { expectedPaths: ['packages/contract/src/walk.ts'] }, 'reinforced'],
    ['low', { expectedPaths: ['packages/sharing/src/stretch.ts'] }, 'reinforced'],
  ] as [
    'low' | 'normal' | 'high',
    Partial<Proposal>,
    'light' | 'standard' | 'reinforced' | 'research',
  ][])('risk %s, proposal %j selects %s', (risk, changes, workflow) => {
    const planned = planRouting(proposal(changes), risk)
    expect(planned.workflow).toBe(workflow)
    expect(RoutingPlan.safeParse(planned).success).toBe(true)
    expect(requiresAcceptance(planned)).toBe(workflow === 'standard' || workflow === 'reinforced')
  })

  test('paths correct a mistaken frontend profile and raise risk before agents run', () => {
    const planned = planRouting(
      proposal({ expectedPaths: ['apps/api/src/routes/walks.ts'] }),
      'low',
    )
    expect(planned.scope).toBe('backend')
    expect(planned.risk).toBe('high')
    expect(planned.reasons).toContain('Paths require the backend profile.')
  })

  test('an unexpected stylesheet escalates light work even though the path is cosmetic', () => {
    const planned = planRouting(proposal(), 'low')
    const observed = reassessRouting(planned, ['apps/web/src/other.css'])
    expect(observed.workflow).toBe('standard')
    expect(observed.expectedPaths).toEqual(planned.expectedPaths)
    expect(observed.reasons).toContain('Paths outside the plan: apps/web/src/other.css.')
  })

  test('sensitive scope expands the profile and controls; later deletions never lower them', () => {
    const planned = planRouting(proposal(), 'low')
    const observed = reassessRouting(planned, [
      'apps/web/src/styles.css',
      'apps/api/src/db/schema.ts',
    ])
    expect(observed.workflow).toBe('reinforced')
    expect(observed.risk).toBe('high')
    expect(observed.scope).toBe('fullstack')
    const later = reassessRouting(observed, ['apps/web/src/styles.css'])
    expect(later.workflow).toBe('reinforced')
    expect(later.risk).toBe('high')
    expect(later.scope).toBe('fullstack')
    expect(reassessRouting(observed, ['apps/api/src/db/schema.ts'])).toEqual(observed)
  })

  test('research requires explicit reclassification instead of becoming implementation from its diff', () => {
    const planned = planRouting(proposal({ complexity: 'uncertain' }), 'low')
    const observed = reassessRouting(planned, ['apps/api/src/db/schema.ts'])
    expect(observed.workflow).toBe('research')
    expect(observed.risk).toBe('high')
    expect(requiresAcceptance(observed)).toBe(false)
  })

  test('unchanged work retains its plan, timestamp and reasons', () => {
    const planned = planRouting(proposal(), 'low')
    expect(reassessRouting(planned, planned.expectedPaths)).toEqual(planned)
    expect(reassessRouting(planned, [])).toEqual(planned)
  })

  test.each([
    '',
    '/tmp/file.css',
    '../style.css',
    'apps/../file.css',
    './README.md',
    'docs/**',
    'apps/web/',
    'apps//web.css',
    'C:/docs/readme.md',
    'docs/file\n.md',
    'docs\\readme.md',
  ])('rejects unsafe or broad expected path %j', (path) => {
    expect(RepoFile.safeParse(path).success).toBe(false)
    expect(RoutingProposal.safeParse(proposal({ expectedPaths: [path] })).success).toBe(false)
  })

  test.each([
    { evidence: [] },
    { evidence: [' '] },
    { expectedPaths: [] },
    { verification: [] },
    { verification: [''] },
    { uncertainty: [''] },
    { workflow: 'light' },
  ])('refuses incomplete evidence or model-selected workflow %j', (changes) => {
    expect(RoutingProposal.safeParse({ ...proposal(), ...changes }).success).toBe(false)
  })
})
