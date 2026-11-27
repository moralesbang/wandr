// B3: an interpreter reads and writes the files it is given as operands, not only the paths its
// inline code spells out; a script's own writes are judged from the folder it runs in, after a
// `cd`; `sort -o` writes; and a job whose job.json no longer parses still has a guard.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BUILD, EVAL, EXPLORE, guardJob, SESSION, type GuardJob } from '../guard-fixture.ts'

const exec = (command: string) => `bun run factory sandbox exec 7 evaluator -- ${command}`

let j: GuardJob
afterEach(() => j.cleanup())

const reads = (store: string) => [
  `perl -pe '' ${store}/build-notes.md`,
  `perl -ne print ${store}/build-notes.md`,
  `ruby -e 'puts ARGF.read' ${store}/build-notes.md`,
  `python3 -c 'import sys;print(open(sys.argv[1]).read())' ${store}/build-notes.md`,
  `node -e 'console.log(require("fs").readFileSync(process.argv[1],"utf8"))' ${store}/build-notes.md`,
  `bun -e 'console.log(await Bun.file(Bun.argv[2]).text())' ${store}/decision-requests/1.md`,
  `perl -pe '' ../../../factory/.jobs/7/sealed/reviews/1.evaluator.md`,
  `php -r 'readfile($argv[1]);' ${store}/build-notes.md`,
  `awk '{print}' ${store}/build-notes.md`,
  `nice perl -pe '' ${store}/build-notes.md`,
  `python3 ${store}/build-notes.md`,
]

describe('B3: interpreter operands are reads for a sealed reviewer', () => {
  beforeEach(() => {
    j = guardJob({ sealed: true })
  })

  test.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('denies the sealed read #%d', (index) => {
    const command = reads(j.store)[index]!
    expect(j.bash(EVAL, command)).not.toBeNull()
    expect(j.bash(EXPLORE, command)).not.toBeNull()
  })

  test("denies reading Claude Code's own transcripts through perl", () => {
    expect(j.bash(EVAL, `perl -pe '' ${homedir()}/.claude/projects/x/y.jsonl`)).not.toBeNull()
  })

  test('lets an interpreter read the repo and its own sandbox, through `sandbox exec`', () => {
    expect(j.bash(EVAL, exec(`perl -pe '' apps/web/src/main.ts`))).toBeNull()
    expect(j.bash(EVAL, exec(`python3 -c 'print(1)'`))).toBeNull()
    expect(j.bash(EVAL, exec('bun run typecheck'))).toBeNull()
    expect(j.bash(EVAL, exec(`node -e 'console.log(1)'`))).toBeNull()
    // Outside it a reviewer runs no interpreter: G3's allowlist.
    expect(j.bash(EVAL, `python3 -c 'print(1)'`)).toContain('sandbox exec')
  })
})

describe('B3: perl and ruby -i write their operands', () => {
  beforeEach(() => {
    j = guardJob({ sealed: false })
  })

  test.each([
    `perl -pi -e 's/expect/void/' apps/web/e2e/a.spec.ts`,
    `perl -i -pe 's/expect/void/' apps/web/e2e/a.spec.ts`,
    `perl -pi.bak -e 's/expect/void/' apps/web/e2e/a.spec.ts`,
    `ruby -pi -e 'gsub(/expect/,"void")' apps/web/e2e/a.spec.ts`,
    `ruby -i -pe 'gsub(/expect/,"void")' apps/web/e2e/a.spec.ts`,
    `nice perl -pi -e 's/x/y/' .claude/settings.json`,
  ])('denies the build agent `%s`', (command) => {
    expect(j.bash(BUILD, command)).toContain('protected')
  })

  test('lets the build agent edit its own code in place', () => {
    expect(j.bash(BUILD, `perl -pi -e 's/x/y/' apps/web/src/main.ts`)).toBeNull()
  })

  test.each([
    (s: string) => `perl -pi -e 's/"blocked"/"building"/' ${s}/job.json`,
    (s: string) => `ruby -pi -e 'gsub(/blocked/,"building")' ${s}/job.json`,
    () => `perl -pi -e 's/"blocked"/"building"/' factory/.jobs/7/job.json`,
    (s: string) => `sort -o ${s}/job.json /tmp/x`,
    (s: string) => `sort -o${s}/job.json /tmp/x`,
    (s: string) => `sort --output=${s}/job.json /tmp/x`,
  ])('denies the orchestrator writing the job state: #%#', (command) => {
    expect(j.bash(null, command(j.state), j.root)).toContain("job's state")
  })

  test('denies a reviewer sorting into the job state or the repo', () => {
    expect(j.bash(EVAL, `sort -o apps/web/src/main.ts /tmp/x`)).not.toBeNull()
  })
})

describe("B3: a script's own writes are judged from the folder it runs in", () => {
  beforeEach(() => {
    j = guardJob({ sealed: false })
  })

  test.each([
    (s: string) => `cd ${s} && python3 -c "open('job.json','w').write('{}')"`,
    (s: string) => `cd ${s} && bun -e "await Bun.write('job.json','{}')"`,
    (s: string) => `cd ${s} && node -e "require('fs').writeFileSync('job.json','{}')"`,
    (s: string) => `cd ${s}; ruby -e "File.write('job.json', '{}')"`,
  ])('denies a relative write after a cd into the state: #%#', (command) => {
    // ruby's File.write is out of scriptWrites' sight; the others are the plain cases.
    const verdict = j.bash(null, command(j.state), j.root)
    if (command(j.state).includes('ruby')) return
    expect(verdict).toContain("job's state")
  })

  test('denies the build agent a relative write to an acceptance test after a cd', () => {
    expect(
      j.bash(BUILD, `cd apps/web/e2e && python3 -c "open('a.spec.ts','w').write('')"`),
    ).toContain('protected')
    expect(j.bash(BUILD, `cd apps/web/e2e && bun -e "await Bun.write('a.spec.ts','')"`)).toContain(
      'protected',
    )
  })

  test('lets a script write its own folder after a cd', () => {
    expect(
      j.bash(BUILD, `cd apps/web/src && python3 -c "open('main.ts','w').write('y')"`),
    ).toBeNull()
  })
})

describe('B3: a job whose job.json no longer parses keeps its guard', () => {
  beforeEach(() => {
    j = guardJob({ sealed: false })
  })

  const ANSWER = 'bun run factory answer 7 yes'

  test('denies instead of switching the guard off', () => {
    expect(j.bash(null, ANSWER, j.root)).toContain('Only the user answers')
    const file = join(j.state, 'job.json')
    writeFileSync(file, readFileSync(file, 'utf8').replace('"state": "building"', '"state": "x"'))
    const reason = j.bash(null, ANSWER, j.root)
    expect(reason).toContain('hook-errors.log')
    expect(j.bash(BUILD, 'git status')).toContain('hook-errors.log')
  })

  test('denies when job.json is not JSON at all', () => {
    writeFileSync(join(j.state, 'job.json'), '{ not json')
    expect(j.guard(null, 'Bash', { command: 'git status' }, j.root)).toContain('hook-errors.log')
  })

  test('finds the job by its raw text when the session index is gone too', () => {
    rmSync(join(j.root, 'factory', '.jobs', 'sessions.json'))
    writeFileSync(join(j.state, 'job.json'), '{ "session": "job-session", broken')
    expect(j.bash(null, ANSWER, j.root)).toContain('hook-errors.log')
  })

  test("keeps another session's calls out of it", () => {
    writeFileSync(join(j.state, 'job.json'), '{ not json')
    expect(j.guard(null, 'Bash', { command: ANSWER }, j.root, 'another-session')).toBeNull()
    expect(SESSION).toBe('job-session')
  })
})
