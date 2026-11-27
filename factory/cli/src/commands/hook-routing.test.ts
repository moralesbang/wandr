import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BUILD, DIAG, EVAL, EXPLORE, guardJob, put, TEST, TR } from '../guard-fixture.ts'
import { planRouting } from '../routing.ts'
import { seal, unseal } from '../seal.ts'
import { writeBlindPass } from '../job-fixture.ts'

let fixture: ReturnType<typeof guardJob> | undefined
afterEach(() => fixture?.cleanup())

const research = () =>
  planRouting(
    {
      scope: 'frontend',
      complexity: 'uncertain',
      expectedPaths: ['apps/web/src/styles.css'],
      evidence: ['The requested layout is not defined.'],
      behaviorChange: false,
      uncertainty: ['Which screen should change?'],
      verification: ['Inspect the affected view.'],
    },
    'low',
  )

describe('routing authority', () => {
  test('only the orchestrator runs route and writes proposals or research', () => {
    fixture = guardJob({ sealed: false })
    expect(
      fixture.bash(null, 'bun run factory route 7 factory/.jobs/7/routing-proposal.json'),
    ).toBeNull()
    for (const who of [BUILD, TEST, EVAL, TR, DIAG, EXPLORE]) {
      expect(
        fixture.bash(who, 'bun run factory route 7 factory/.jobs/7/routing-proposal.json'),
      ).toContain('orchestrator')
      for (const path of ['routing-proposal.json', 'research.md'])
        expect(
          fixture.guard(who, 'Write', { file_path: join(fixture.handoff, path), content: '{}' }),
        ).not.toBeNull()
    }
  })

  test.each(['unclassified', 'research'])(
    '%s job remains read-only outside research handoff',
    (stage) => {
      fixture = guardJob({
        sealed: false,
        job: { routingRequired: true, routing: stage === 'research' ? research() : null },
      })
      expect(fixture.bash(null, 'rg layout apps/web/src')).toBeNull()
      expect(fixture.bash(null, 'git diff')).toBeNull()
      expect(fixture.bash(null, 'bun run factory status')).toBeNull()
      expect(
        fixture.bash(null, 'bun run factory route 7 factory/.jobs/7/routing-proposal.json'),
      ).toBeNull()
      for (const path of ['routing-proposal.json', 'research.md', 'decision-requests/draft.md'])
        expect(
          fixture.guard(null, 'Write', {
            file_path: join(fixture.handoff, path),
            content: 'Evidence',
          }),
        ).toBeNull()
      for (const command of [
        'bun run test',
        'git commit -m fix',
        'git checkout main',
        'bun run factory check 7',
        'echo changed > apps/web/src/main.ts',
      ])
        expect(fixture.bash(null, command)).not.toBeNull()
      expect(
        fixture.guard(null, 'Edit', {
          file_path: join(fixture.worktree, 'apps/web/src/main.ts'),
          old_string: 'x',
          new_string: 'y',
        }),
      ).not.toBeNull()
      expect(
        fixture.guard(BUILD, 'Write', {
          file_path: join(fixture.handoff, 'build-notes.md'),
          content: 'Implemented',
        }),
      ).not.toBeNull()
      expect(
        fixture.guard(null, 'Agent', {
          subagent_type: 'factory-build',
          prompt: 'Implement',
          description: 'build',
        }),
      ).not.toBeNull()
      expect(
        fixture.guard(null, 'Agent', {
          subagent_type: 'Explore',
          prompt: 'Inspect interfaces read-only',
          description: 'explore',
        }),
      ).toBeNull()
    },
  )

  test('routing research and proposals are sealed, guarded and restored', () => {
    fixture = guardJob({ sealed: false })
    for (const path of ['research.md', 'routing-proposal.json'])
      put(
        join(fixture.handoff, path),
        'Sensitive rationale before implementation that must not influence the blind reviewer.',
      )
    seal(fixture.root, 7, { pass: 2, roles: ['evaluator', 'test-reviewer'] })
    for (const path of ['research.md', 'routing-proposal.json']) {
      expect(existsSync(join(fixture.handoff, path))).toBe(false)
      expect(existsSync(join(fixture.store, path))).toBe(true)
      expect(fixture.guard(EVAL, 'Read', { file_path: join(fixture.handoff, path) })).toContain(
        'sealed',
      )
      expect(fixture.bash(EVAL, `cat factory/.jobs/7/${path}`)).toContain('sealed')
      expect(
        fixture.guard(null, 'Agent', {
          subagent_type: 'factory-evaluator',
          prompt: `Read ${path}`,
          description: 'review',
        }),
      ).toContain('names')
      expect(
        fixture.guard(null, 'Write', {
          file_path: join(fixture.handoff, path),
          content: 'New rationale',
        }),
      ).toContain('sealed')
    }
    writeBlindPass(fixture.root, 7, 2, 'evaluator')
    writeBlindPass(fixture.root, 7, 2, 'test-reviewer')
    unseal(fixture.root, 7)
    for (const path of ['research.md', 'routing-proposal.json'])
      expect(existsSync(join(fixture.handoff, path))).toBe(true)
  })
})
