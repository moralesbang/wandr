// The third adversarial review's G7: the writes of a protected path (an acceptance test, a rule
// path, a frozen blind pass) a Bash command can make besides `>` and `tee`. The gate catches what
// is committed; this closes the window before the commit. The paths below are best effort: what
// can't be told from the command text (a patch's own targets, a script written then run, a glob
// of acceptance tests beside their code under a copied folder) stays with the gate.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { BUILD, DIAG, EVAL, TEST, guardJob, put, type GuardJob } from '../guard-fixture.ts'
import { PROTECTED_DIRS, protectedFromBuild } from '../paths.ts'
import { writeBlindPass, freezeBlindPass } from '../job-fixture.ts'
import { unseal } from '../seal.ts'

let j: GuardJob
beforeEach(() => {
  j = guardJob({ sealed: false })
  for (const dir of PROTECTED_DIRS) mkdirSync(`${j.worktree}/${dir}`, { recursive: true })
})
afterEach(() => j.cleanup())

const P = 'apps/web/e2e/a.spec.ts'
const FROZEN = () => `${j.handoff}/reviews/2.evaluator.blind.md`

describe('G7: the build agent’s Bash writes of a protected acceptance test', () => {
  test.each([
    `rsync /tmp/x ${P}`,
    `rsync -a /tmp/x/ apps/web/e2e/`,
    `rsync -av -e ssh /tmp/x/ apps/web/e2e`,
    `ditto /tmp/x ${P}`,
    `ditto /tmp/x apps/web/e2e`,
    `exec 3> ${P}`,
    `exec 3>> ${P}`,
    `exec > ${P}`,
    `ed -s ${P} <<< w`,
    `ex -sc 'w' -c q ${P}`,
    `vi -es +w ${P}`,
    `vim -es -c 'w' ${P}`,
    `awk 'BEGIN{print "" > "${P}"}'`,
    `awk 'BEGIN { printf "x" >> "${P}" }'`,
    `gawk 'BEGIN{print "y" > "knowledge/README.md"}'`,
    `git rm ${P}`,
    `git rm -r apps/web/e2e`,
    `git rm -f -- ${P}`,
    `git mv ${P} apps/web/e2e/b.spec.ts`,
    `git mv apps/web/e2e apps/web/e2e-old`,
    `git checkout HEAD~1 -- ${P}`,
    `git checkout HEAD~1 -- apps/web/e2e`,
    `git checkout main -- .`,
    `git restore --source=HEAD~1 ${P}`,
    `git restore --source HEAD~1 apps/web/e2e`,
    `git restore -s main .`,
    `tar xf /tmp/t.tar -C apps/web/e2e`,
    `tar -xzf /tmp/t.tgz --directory=apps/web/e2e`,
    `tar xf /tmp/t.tar -C knowledge`,
    `cd apps/web/e2e && tar xf /tmp/t.tar`,
    `unzip -o /tmp/z.zip -d apps/web/e2e`,
    `cd apps/web/e2e && unzip /tmp/z.zip`,
    `patch ${P} < /tmp/p`,
    `patch -p0 ${P} < /tmp/p`,
    `patch --input=/tmp/p ${P}`,
    `cp /tmp/x apps/web/e2e`,
    `cp /tmp/x apps/web/e2e/`,
    `mv /tmp/x apps/web/e2e`,
    `mv apps/web/e2e apps/web/e2e-old`,
    `rm -rf apps/web/e2e`,
    `rm -rf knowledge factory`,
    `cd apps/web && rm -rf e2e`,
    `chmod 000 ${P}`,
    `chmod -R u-w apps/web/e2e`,
    `curl -o ${P} http://x`,
    `curl --output ${P} http://x`,
    `wget -O ${P} http://x`,
    'find apps/web/e2e -delete',
    'find apps/web/e2e -type f -exec rm {} +',
    'find apps/web/e2e -name x -delete',
  ])('denies the build agent `%s`', (command) => {
    expect(j.bash(BUILD, command)).toContain('protected')
  })

  test('judges a copy into a folder by the name it gives the file', () => {
    mkdirSync(`${j.worktree}/apps/api/src/routes`, { recursive: true })
    expect(j.bash(BUILD, 'cp /tmp/walks.acceptance.test.ts apps/api/src/routes')).toContain(
      'protected',
    )
    expect(j.bash(BUILD, 'cp /tmp/walks.ts apps/api/src/routes')).toBeNull()
    expect(j.bash(BUILD, 'cp /tmp/walks.ts apps/api/src/routes/')).toBeNull()
  })

  test('denies the test agent the rule paths the same ways, and lets it write acceptance tests', () => {
    expect(j.bash(TEST, 'rsync /tmp/x .github/workflows/ci.yml')).toContain('protected')
    expect(j.bash(TEST, 'git rm -r .github/workflows')).toContain('protected')
    expect(j.bash(TEST, 'rm -rf knowledge')).toContain('protected')
    expect(j.bash(TEST, `rsync /tmp/x ${P}`)).toBeNull()
    expect(j.bash(TEST, 'tar xf /tmp/t.tar -C apps/web/e2e')).toBeNull()
    expect(j.bash(TEST, `ed -s ${P} <<< w`)).toBeNull()
  })

  test('denies a diagnose agent every write outside diagnosis.md', () => {
    expect(j.bash(DIAG, `rsync /tmp/x apps/web/src/main.ts`)).not.toBeNull()
    expect(j.bash(DIAG, `git rm apps/web/src/main.ts`)).not.toBeNull()
  })

  test('still lets the build agent work', () => {
    for (const command of [
      'rsync -a /tmp/x/ apps/web/src/',
      'cp /tmp/x apps/web/src/new.ts',
      'rm -rf apps/web/dist',
      'rm -rf node_modules/.cache',
      'git rm apps/web/src/old.ts',
      'find apps -name x.tsbuildinfo -delete',
      'find apps -name "*.log" -type f -exec rm {} +',
      'git mv apps/web/src/a.ts apps/web/src/b.ts',
      'git checkout -- .',
      'git checkout -- apps/web/src/main.ts',
      'git restore .',
      'git restore --staged apps/web/src/main.ts',
      'git checkout HEAD~1 -- apps/web/src/main.ts',
      `awk '{print $1}' apps/web/src/main.ts`,
      `awk '$1 > 5 { print $1 }' apps/web/src/main.ts`,
      'chmod +x apps/web/src/main.ts',
      'tar xf /tmp/t.tar -C apps/web/src',
      'curl -o apps/web/src/x.json http://localhost:3100/health',
      'ed -s apps/web/src/main.ts <<< w',
      'mkdir -p apps/web/src/x',
    ]) {
      expect(j.bash(BUILD, command)).toBeNull()
    }
  })

  test('PROTECTED_DIRS holds only folders that protect what is directly under them', () => {
    for (const dir of PROTECTED_DIRS) expect(protectedFromBuild(`${dir}/_`)).not.toBeNull()
  })
})

describe('G7: a frozen blind pass', () => {
  beforeEach(() => {
    j.cleanup()
    j = guardJob({ plan: { evaluator: 'review', 'test-reviewer': 'review' } })
    writeBlindPass(j.root, 7, 2, 'evaluator')
    writeBlindPass(j.root, 7, 2, 'test-reviewer')
    unseal(j.root, 7)
  })

  test.each([
    (f: string) => `rsync /tmp/x ${f}`,
    (f: string) => `ditto /tmp/x ${f}`,
    (f: string) => `exec 3> ${f}`,
    (f: string) => `ed -s ${f} <<< w`,
    (f: string) => `ex -sc 'w' -c q ${f}`,
    (f: string) => `awk 'BEGIN{print "y" > "${f}"}'`,
    (f: string) => `git rm ${f}`,
    (f: string) => `git mv ${f} ${f}.bak`,
    (f: string) => `git checkout HEAD~1 -- ${f}`,
    (f: string) => `git restore --source=HEAD~1 ${f}`,
    (f: string) => `patch ${f} < /tmp/p`,
    (f: string) => `curl -o ${f} http://x`,
    (f: string) => `chmod 000 ${f}`,
  ])('denies the evaluator and the orchestrator `#%#`', (command) => {
    expect(j.bash(EVAL, command(FROZEN()))).not.toBeNull()
    expect(j.bash(null, command(FROZEN()), j.root)).toContain('frozen')
  })

  test('the tests above freeze nothing by themselves', () => {
    put(`${j.handoff}/reviews/3.evaluator.blind.md`, 'x\n')
    freezeBlindPass(j.root, 7, 'reviews/3.evaluator.blind.md')
    expect(
      j.bash(null, `rsync /tmp/x ${j.handoff}/reviews/3.evaluator.blind.md`, j.root),
    ).toContain('frozen')
  })
})
