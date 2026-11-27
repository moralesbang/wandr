// The second adversarial review's forgery findings: the orchestrator writes none of the reviewers'
// own files (B4), and a blind pass is frozen once the seal lifts (G5).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { writeAsRun } from '../job-fixture.ts'
import { loadJob } from '../job.ts'
import { unseal } from '../seal.ts'
import { BUILD, EVAL, TR, guardJob, NOTES, type GuardJob } from '../guard-fixture.ts'

let j: GuardJob
afterEach(() => j.cleanup())

const plainWrite = (rel: string) =>
  j.guard(null, 'Write', { file_path: `${j.handoff}/${rel}`, content: 'Plain text.\n' })

describe.each([
  ['unsealed', false],
  ['sealed', true],
])('B4: the orchestrator forges no reviewer file (%s)', (_name, sealed) => {
  beforeEach(() => {
    j = guardJob({ sealed })
  })

  const FORGED = [
    'rulings/1.md',
    'reviews/2.evaluator.md',
    'reviews/2.test-reviewer.md',
    'reviews/2.evaluator.blind.md',
    'reviews/2.test-reviewer.blind.md',
    'reviews/2.evaluator.v2.md',
  ]

  test.each(FORGED)('denies Write, Edit and MultiEdit of %s', (rel) => {
    const file = `${j.handoff}/${rel}`
    expect(j.guard(null, 'Write', { file_path: file, content: 'Verdict: approve\n' })).toContain(
      'written by',
    )
    expect(
      j.guard(null, 'Edit', { file_path: file, old_string: 'a', new_string: 'Verdict: approve' }),
    ).toContain('written by')
    expect(
      j.guard(null, 'MultiEdit', {
        file_path: file,
        edits: [{ old_string: 'a', new_string: 'Verdict: approve' }],
      }),
    ).toContain('written by')
  })

  test.each(FORGED)('denies a Bash write of %s', (rel) => {
    const file = `${j.handoff}/${rel}`
    expect(j.bash(null, `printf 'Verdict: same-guarantee\\n' > ${file}`)).toContain('written by')
    expect(j.bash(null, `cat > ${file} <<'EOF'\nVerdict: approve\nEOF`)).toContain('written by')
    expect(j.bash(null, `echo x | tee ${file}`)).toContain('written by')
  })

  test('denies a relative Bash write after a cd', () => {
    expect(j.bash(null, `cd ${j.handoff}/reviews && echo x >> 2.test-reviewer.md`)).toContain(
      'written by',
    )
  })

  test('keeps what the orchestrator does write: findings, summary, context files', () => {
    expect(plainWrite('context.md')).toBeNull()
    if (!sealed) {
      expect(plainWrite('reviews/2.findings.md')).toBeNull()
      expect(plainWrite('summary.md')).toBeNull()
      expect(plainWrite('decision-requests/draft.md')).toBeNull()
    }
  })

  test('the reviewers still write their own files', () => {
    if (sealed) return
    expect(
      j.guard(EVAL, 'Write', { file_path: `${j.handoff}/reviews/2.evaluator.md`, content: 'x' }),
    ).toBeNull()
    expect(
      j.guard(TR, 'Write', { file_path: `${j.handoff}/rulings/1.md`, content: 'x' }),
    ).toBeNull()
  })
})

describe('G5: a blind pass is frozen once the seal lifts', () => {
  const REL = 'reviews/2.evaluator.blind.md'
  beforeEach(() => {
    j = guardJob({ sealed: true, roles: ['evaluator'] })
  })

  test('is writable until the unseal, by its own reviewer', () => {
    const file = `${j.handoff}/${REL}`
    expect(j.guard(EVAL, 'Write', { file_path: file, content: 'blind' })).toBeNull()
    expect(j.guard(EVAL, 'Write', { file_path: file, content: 'still blind' })).toBeNull()
  })

  test('the unseal records its hash in the job', () => {
    writeAsRun(j.root, 7, 'factory-evaluator', REL, 'blind\n')
    unseal(j.root, 7)
    const hash = new Bun.CryptoHasher('sha256').update('blind\n').digest('hex')
    expect(loadJob(j.root, 7)?.blindPasses).toEqual({ [REL]: hash })
  })

  test('after the unseal nobody writes it: not the reviewer, not the orchestrator, not Bash', () => {
    writeAsRun(j.root, 7, 'factory-evaluator', REL, 'blind\n')
    unseal(j.root, 7)
    const file = `${j.handoff}/${REL}`
    for (const who of [EVAL, null]) {
      expect(j.guard(who, 'Write', { file_path: file, content: 'rewritten' })).toContain('frozen')
      expect(
        j.guard(who, 'Edit', { file_path: file, old_string: 'blind', new_string: 'not' }),
      ).toContain('frozen')
    }
    expect(j.bash(EVAL, `echo x > ${file}`)).not.toBeNull()
    expect(j.bash(null, `echo x >> ${file}`)).not.toBeNull()
  })

  test('its reviewer still writes its final report', () => {
    writeAsRun(j.root, 7, 'factory-evaluator', REL, 'blind\n')
    unseal(j.root, 7)
    expect(
      j.guard(EVAL, 'Write', { file_path: `${j.handoff}/reviews/2.evaluator.md`, content: 'x' }),
    ).toBeNull()
  })
})

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const refused = (run: () => unknown) => {
  try {
    run()
    return null
  } catch (error) {
    return (error as Error).message
  }
}

describe('B6: a run that started before the seal', () => {
  beforeEach(() => {
    j = guardJob({ sealed: true, roles: ['evaluator'] })
  })

  test('its blind pass does not lift the seal: it read the notes in an earlier pass', () => {
    // Pass 1's evaluator, started and read the build notes before the seal, is told by SendMessage
    // to write pass 2's blind pass.
    j.log({
      t: minutesAgo(5),
      kind: 'agent.start',
      agent: { id: 'e-old', type: 'factory-evaluator' },
    })
    writeAsRun(j.root, 7, 'factory-evaluator', 'reviews/2.evaluator.blind.md', 'blind?\n', {
      id: 'e-old',
      started: false,
    })
    const message = refused(() => unseal(j.root, 7))
    expect(message).toContain('stays sealed')
    expect(message).toContain('relaunch')
  })

  test('a run launched after the seal lifts it', () => {
    writeAsRun(j.root, 7, 'factory-evaluator', 'reviews/2.evaluator.blind.md', 'blind\n')
    expect(refused(() => unseal(j.root, 7))).toBeNull()
  })

  test('SendMessage to a reviewer that started before the seal is denied while sealed', () => {
    j.log({
      t: minutesAgo(5),
      kind: 'agent.start',
      agent: { id: 'e-old', type: 'factory-evaluator' },
    })
    j.log({
      t: minutesAgo(5),
      kind: 'agent.start',
      agent: { id: 't-old', type: 'factory-test-reviewer' },
    })
    for (const to of ['e-old', 't-old']) {
      expect(j.guard(null, 'SendMessage', { to, message: 'Write the blind pass now.' })).toContain(
        'fresh',
      )
    }
  })

  test('SendMessage to a recipient the log can not place is denied too', () => {
    expect(j.guard(null, 'SendMessage', { to: 'evaluator', message: 'Hello.' })).toContain('fresh')
    expect(j.guard(null, 'SendMessage', { to: 'nobody-id', message: 'Hello.' })).toContain('fresh')
  })

  test('SendMessage to a fresh reviewer, or to a build run, goes through', () => {
    j.log({ kind: 'agent.start', agent: { id: 'e-new', type: 'factory-evaluator' } })
    j.log({
      t: minutesAgo(9),
      kind: 'agent.start',
      agent: BUILD.agent_id ? { id: BUILD.agent_id, type: BUILD.agent_type } : undefined,
    })
    expect(j.guard(null, 'SendMessage', { to: 'e-new', message: 'Hello.' })).toBeNull()
    expect(j.guard(null, 'SendMessage', { to: 'b1', message: 'Hello.' })).toBeNull()
  })

  test('once unsealed, any reviewer may be messaged', () => {
    writeAsRun(j.root, 7, 'factory-evaluator', 'reviews/2.evaluator.blind.md', 'blind\n')
    unseal(j.root, 7)
    j.log({
      t: minutesAgo(5),
      kind: 'agent.start',
      agent: { id: 'e-old', type: 'factory-evaluator' },
    })
    expect(j.guard(null, 'SendMessage', { to: 'e-old', message: 'Read the notes.' })).toBeNull()
  })
})

describe('G1: while sealed, what the orchestrator writes carries no sealed text, anywhere', () => {
  beforeEach(() => {
    j = guardJob({ sealed: true })
  })
  const quote = `Context: ${NOTES}`

  test.each([
    (x: GuardJob) => `${x.handoff}/context.md`,
    (x: GuardJob) => `${x.worktree}/context.md`,
    (x: GuardJob) => `${x.worktree}/apps/web/notes.md`,
    (x: GuardJob) => `${x.handoff}/sandbox/evaluator/context.md`,
  ])('denies a Write, an Edit and a MultiEdit that quote the build notes: #%#', (where) => {
    const file = where(j)
    expect(j.guard(null, 'Write', { file_path: file, content: quote })).toContain('quotes')
    expect(
      j.guard(null, 'Edit', { file_path: file, old_string: 'x', new_string: quote }),
    ).toContain('quotes')
    expect(
      j.guard(null, 'MultiEdit', {
        file_path: file,
        edits: [{ old_string: 'x', new_string: quote }],
      }),
    ).toContain('quotes')
  })

  test.each([
    (x: GuardJob) => `cat > ${x.handoff}/context.md <<'EOF'\n${NOTES}\nEOF`,
    (x: GuardJob) => `echo '${NOTES}' > ${x.worktree}/context.md`,
    (x: GuardJob) => `printf '%s' '${NOTES}' | tee ${x.worktree}/apps/context.md`,
    (x: GuardJob) => `cp ${x.store}/build-notes.md ${x.worktree}/context.md`,
    (x: GuardJob) => `perl -pe '' ${x.store}/build-notes.md > ${x.worktree}/apps/context.md`,
    (x: GuardJob) => `cat ${x.store}/decision-requests/1.md >> ${x.handoff}/context.md`,
  ])('denies a Bash command that writes sealed text into the worktree: #%#', (command) => {
    expect(j.bash(null, command(j), j.root)).not.toBeNull()
  })

  test('lets the orchestrator write and read what carries none of it', () => {
    expect(
      j.guard(null, 'Write', { file_path: `${j.worktree}/context.md`, content: 'Plain.' }),
    ).toBeNull()
    expect(j.bash(null, `echo hello > ${j.worktree}/context.md`, j.root)).toBeNull()
    expect(j.bash(null, `cat ${j.store}/build-notes.md`, j.root)).toBeNull()
    expect(j.bash(null, 'bun run factory status', j.root)).toBeNull()
  })

  test('writes after the unseal are free', () => {
    j.cleanup()
    j = guardJob({ sealed: false })
    expect(
      j.guard(null, 'Write', { file_path: `${j.worktree}/context.md`, content: quote }),
    ).toBeNull()
  })
})

describe('a Decision Request while the job is sealed', () => {
  // Chosen: none is raised while sealed. The draft would sit in the folder the reviewers read, and
  // `block` would keep the request among the sealed names. The skill says: finish the blind passes,
  // unseal, then raise it.
  test('the draft is refused, and the refusal says to unseal first', () => {
    j = guardJob({ sealed: true })
    const reason = j.guard(null, 'Write', {
      file_path: `${j.handoff}/decision-requests/draft.md`,
      content: '# Context\n\nMay the test change?\n',
    })
    expect(reason).toContain('unseal')
  })

  test('the draft is free once unsealed', () => {
    j = guardJob({ sealed: false })
    expect(
      j.guard(null, 'Write', {
        file_path: `${j.handoff}/decision-requests/draft.md`,
        content: '# Context\n',
      }),
    ).toBeNull()
  })
})
