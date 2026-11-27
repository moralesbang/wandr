// The merged findings go to the build agent as the reviewers' words. A findings file that copies the
// build notes hands the build's own reasoning back as if a reviewer had found it.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeJob } from '../job-fixture.ts'
import { loadJob, saveJob } from '../job.ts'
import { Refusal } from './common.ts'
import { round, sharedPhrase } from './lifecycle.ts'

describe('sharedPhrase', () => {
  const notes = 'The icon links needed width and height attributes, so I added them to the head.'

  test.each([
    [
      'eight words in a row',
      'Finding: the icon links needed width and height attributes, then',
      'the icon links needed width and height attributes,',
    ],
    [
      'the whole run, past eight words',
      'Finding: the icon links needed width and height attributes, so check',
      'the icon links needed width and height attributes, so',
    ],
    [
      'across case and line breaks',
      'THE ICON LINKS\nneeded   WIDTH and height\tattributes, then',
      'the icon links needed width and height attributes,',
    ],
    ['seven words only', 'Finding: the icon links needed width and height. Nothing else.', null],
    ['the same words in another order', 'height and width attributes needed the icon links', null],
    ['nothing in common', 'F1: the manifest declares the wrong type.', null],
  ])('%s', (_name, findings, phrase) => {
    expect(sharedPhrase(findings, notes, 8)).toBe(phrase)
  })
})

describe('factory round', () => {
  let root = ''
  let handoff = ''
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'factory-round-'))
    const worktree = join(root, 'tree')
    handoff = join(worktree, 'factory', '.jobs', '7')
    mkdirSync(join(handoff, 'reviews'), { recursive: true })
    saveJob(root, makeJob({ worktree }))
    writeFileSync(
      join(handoff, 'build-notes.md'),
      '# Notes\n\nAdding width and height attributes to the icon links did not help.\n',
    )
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  test('is refused without the merged findings of the pass', () => {
    expect(() => round(root, 7)).toThrow(Refusal)
    expect(loadJob(root, 7)?.rounds).toBe(0)
  })

  test('is refused, naming the phrase, when the findings copy the build notes', () => {
    writeFileSync(
      join(handoff, 'reviews', '1.findings.md'),
      '# Findings\n\nF1: adding width and height attributes to the icon links did not help.\n',
    )
    expect(() => round(root, 7)).toThrow(
      '"adding width and height attributes to the icon links did not help."',
    )
    expect(loadJob(root, 7)?.rounds).toBe(0)
  })

  test('counts the round when the findings are the reviewers own words', () => {
    writeFileSync(
      join(handoff, 'reviews', '1.findings.md'),
      '# Findings\n\nF1 (test reviewer): AC4 samples moss at one point only; icons.spec.ts:88.\n',
    )
    expect(round(root, 7).rounds).toBe(1)
  })
})
