import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BUILD, TEST, guardJob, type GuardJob } from '../guard-fixture.ts'

let j: GuardJob
beforeEach(() => {
  j = guardJob({ sealed: false })
})
afterEach(() => j.cleanup())

// Commands the test agent ran in job 15, copied from its event log.
const PATCH_FORMAT =
  'python3 - <<\'EOF\'\np=\'apps/web/e2e/fallbacks.spec.ts\'\ns=open(p).read()\ns=s.replace("""const scriptPath =""","""// The mark is the Contour icon: an image served from /favicon.svg that decoded.\nasync function expectContourIcon(mark: Locator) {\n  await expect\n    .poll(() =>\n      mark.evaluate((el) => {\n        const img = el as HTMLImageElement\n        return {\n          path: new URL(img.currentSrc || img.src, location.href).pathname,\n          decoded: img.complete && img.naturalWidth > 0,\n        }\n      }),\n    )\n    .toEqual({ path: \'/favicon.svg\', decoded: true })\n}\n\nconst scriptPath =""",1)\ns=s.replace("""          await expect(mark).toBeVisible()\n          const box = await mark""","""          await expect(mark).toBeVisible()\n          await expectContourIcon(mark)\n          const box = await mark""",1)\ns=s.replace("""    await expect(loadingMark(page)).toBeVisible()\n    await expect(spikeControls(page)).toHaveCount(0)""","""    await expect(loadingMark(page)).toBeVisible()\n    await expectContourIcon(loadingMark(page))\n    await expect(spikeControls(page)).toHaveCount(0)""",1)\nopen(p,\'w\').write(s)\nEOF\nbunx oxfmt apps/web/e2e/fallbacks.spec.ts && bunx oxlint --deny-warnings apps/web/e2e/fallbacks.spec.ts; grep -n "expectContourIcon\\|expect(" apps/web/e2e/fallbacks.spec.ts | sed -n 1,200p | grep -n "Contour\\|poll\\|toEqual\\|toBeCloseTo\\|innerText\\|sizeOf" '
const PATCH_FORMAT_AND_GREP =
  'python3 - <<\'EOF\'\np=\'apps/web/e2e/fallbacks.spec.ts\'\ns=open(p).read()\ns=s.replace("""const scriptPath =""","""// The mark is the Contour icon: an image served from /favicon.svg that decoded.\nasync function expectContourIcon(mark: Locator) {\n  await expect\n    .poll(() =>\n      mark.evaluate((el) => {\n        const img = el as HTMLImageElement\n        return {\n          path: new URL(img.currentSrc || img.src, location.href).pathname,\n          decoded: img.complete && img.naturalWidth > 0,\n        }\n      }),\n    )\n    .toEqual({ path: \'/favicon.svg\', decoded: true })\n}\n\nconst scriptPath =""",1)\ns=s.replace("""          await expect(mark).toBeVisible()\n          const box = await mark""","""          await expect(mark).toBeVisible()\n          await expectContourIcon(mark)\n          const box = await mark""",1)\ns=s.replace("""    await expect(loadingMark(page)).toBeVisible()\n    await expect(spikeControls(page)).toHaveCount(0)""","""    await expect(loadingMark(page)).toBeVisible()\n    await expectContourIcon(loadingMark(page))\n    await expect(spikeControls(page)).toHaveCount(0)""",1)\nopen(p,\'w\').write(s)\nEOF\nbunx oxfmt apps/web/e2e/fallbacks.spec.ts && bunx oxlint --deny-warnings apps/web/e2e/fallbacks.spec.ts; grep -n "expectContourIcon\\|toEqual({ path\\|toBeCloseTo\\|innerText()).trim\\|expectColor(await\\|spikeControls(page)).toHaveCount\\|loadingMark(page)).toHaveCount(0)" apps/web/e2e/fallbacks.spec.ts'
const PATCH_ACCEPTANCE = (handoff: string) => String.raw`cd ${handoff} && python3 - <<'EOF'
import re
s=open('acceptance.md').read()
s=re.sub(r'(e2e/fallbacks\.spec\.ts:)(\d+)',lambda m:m.group(1)+str(int(m.group(2))+(1 if int(m.group(2))>=294 else 0)),s)
open('acceptance.md','w').write(s)
EOF
sed -n 52,80p acceptance.md`

const misread = (reason: string | null) => {
  expect(reason ?? '').not.toContain('sandboxes')
  expect(reason ?? '').not.toContain('walk')
  expect(reason ?? '').not.toContain('=294')
  expect(reason ?? '').not.toContain('writes only acceptance.md')
}

describe("FI-013: an interpreter's heredoc body is data; a shell's is parsed as shell", () => {
  test('python3 with a TypeScript string body is no sandbox walk', () => {
    misread(j.bash(TEST, PATCH_FORMAT))
    misread(j.bash(TEST, PATCH_FORMAT_AND_GREP))
  })

  test('python3 with `>=294` in its body is no write to a file named =294', () => {
    misread(j.bash(TEST, PATCH_ACCEPTANCE(j.handoff), j.handoff))
  })

  test('a shell fed a heredoc still has its body judged as shell', () => {
    const body = `bash <<'EOF'\nrm -rf factory/.jobs\nEOF`
    expect(j.bash(BUILD, body)).not.toBeNull()
    expect(j.bash(TEST, body)).not.toBeNull()
  })
})

describe('FI-013: a bare assignment runs no program', () => {
  test('before routing, an assignment is not judged as `env`', () => {
    j.cleanup()
    j = guardJob({ sealed: false, job: { routingRequired: true, routing: null } })
    const lone = j.bash(null, 'FOO=1')
    expect(lone ?? '').not.toContain('`env`')
    const reason = j.bash(null, 'J=factory/.jobs/7; ls $J; cat $J/issue.md')
    expect(reason ?? '').not.toContain('`env`')
  })
})
