// "Who sees what", as data: each agent's inputs, the moment each becomes visible, and what it may
// write. factory watch flags reads against it; the guard hook enforces the writes.
//
// A target is a path in one of three areas: `job` (the job's handoff folder, factory/.jobs/<n>/
// inside its worktree), `repo` (the rest of the worktree) or `outside` (anything else, the main
// checkout and its copy of the job's folder included).

import { join } from 'node:path'
import { isAcceptanceTest, protectedFromBuild, ruleProtecting } from './paths.ts'
import { reviewerRole, verifierMayRead } from './review-plan.ts'

export type Area = 'repo' | 'job' | 'outside'
export type Target = { area: Area; path: string }

const AGENTS = [
  'factory-test',
  'factory-build',
  'factory-evaluator',
  'factory-test-reviewer',
  'factory-diagnose',
] as const
export type AgentType = (typeof AGENTS)[number]

export const isFactoryAgent = (type: string): type is AgentType =>
  (AGENTS as readonly string[]).includes(type)

/** When an input becomes visible: from the agent's start, or once its blind first pass is written. */
type Moment = 'start' | 'after-blind-pass'

export type Input = {
  label: string
  /** Globs prefixed by their area: `repo:docs/**`, `job:issue.md`. */
  paths: readonly string[]
  from: Moment
}

const ISSUE: Input = { label: 'The issue', paths: ['job:issue.md'], from: 'start' }
const INSTRUCTIONS: Input = {
  label: 'Instructions',
  paths: ['repo:CLAUDE.md', 'repo:knowledge/README.md'],
  from: 'start',
}
const CHECKS: Input = { label: 'Check results', paths: ['job:checks/**'], from: 'start' }
const BUILD_NOTES: Input = {
  label: 'Build notes',
  paths: ['job:build-notes.md'],
  from: 'after-blind-pass',
}

// What repeats or cites the build agent's reasoning, so a reviewer sees it only after its blind
// pass, like the notes: a Decision Request restates the build's escalation, and an earlier round's
// final reports and merged findings were written after reading the notes. `factory seal` moves all
// of it out of the worktree for the blind pass (seal.ts).
const DECISION_REQUESTS: Input = {
  label: 'Decision Requests',
  paths: ['job:decision-requests/**'],
  from: 'after-blind-pass',
}
const FINDINGS: Input = {
  label: 'Merged findings',
  paths: ['job:reviews/*.findings.md'],
  from: 'after-blind-pass',
}
const ORCHESTRATOR_NOTES: Input = {
  label: "The orchestrator's diagnosis, summary and routing research",
  paths: ['job:diagnosis.md', 'job:summary.md', 'job:research.md', 'job:routing-proposal.json'],
  from: 'after-blind-pass',
}

/** A reviewer's disposable checkout, made by `factory sandbox`, inside the job's folder. */
const sandboxGlob = (role: string) => `sandbox/${role}/**`

const reviewer = (role: 'evaluator' | 'test-reviewer'): Input[] => [
  ISSUE,
  INSTRUCTIONS,
  // The diff against main, the whole suite, the architecture, knowledge/ and the contracts all live
  // in the worktree: a reviewer reads any of it.
  { label: 'The repo at the branch', paths: ['repo:**'], from: 'start' },
  CHECKS,
  { label: 'The gate and its test changes', paths: ['job:gate.json'], from: 'start' },
  // The test agent's map from each AC to its tests: written before the build, so nothing in it
  // comes from the build notes.
  { label: 'The AC map', paths: ['job:acceptance.md'], from: 'start' },
  { label: 'Its own blind passes', paths: [`job:reviews/*.${role}.blind.md`], from: 'start' },
  { label: 'Its own sandbox', paths: [`job:${sandboxGlob(role)}`], from: 'start' },
  BUILD_NOTES,
  { label: 'Its own final reports', paths: [`job:reviews/*.${role}.md`], from: 'after-blind-pass' },
  FINDINGS,
  DECISION_REQUESTS,
  ORCHESTRATOR_NOTES,
]

const INPUTS: Record<AgentType, readonly Input[]> = {
  'factory-test': [
    ISSUE,
    INSTRUCTIONS,
    {
      label: 'Public contracts',
      paths: [
        'repo:docs/04-flows.md',
        'repo:docs/03-design-brief.md',
        'repo:packages/contract/**',
        'repo:apps/api/openapi.json',
      ],
      from: 'start',
    },
    {
      label: 'Public interfaces',
      paths: [
        'repo:packages/*/src/index.ts',
        'repo:apps/web/src/routes/**',
        'repo:apps/web/src/route-tree.gen.ts',
        'repo:apps/web/src/api/schema.gen.ts',
      ],
      from: 'start',
    },
    {
      label: 'Testing standard',
      paths: ['repo:knowledge/standards/testing.md'],
      from: 'start',
    },
    {
      label: 'Test infrastructure',
      paths: [
        'repo:**/*.test.ts',
        'repo:**/*.test.tsx',
        'repo:apps/web/e2e/**',
        'repo:**/package.json',
        'repo:**/tsconfig*.json',
        'repo:apps/web/playwright.config.ts',
        'repo:apps/web/vite.config.ts',
        'repo:apps/web/src/test-setup.ts',
        'repo:apps/api/.env.test',
        'repo:bunfig.toml',
        'repo:docker-compose.yml',
      ],
      from: 'start',
    },
    { label: 'Its own handoff', paths: ['job:acceptance.md'], from: 'start' },
  ],
  'factory-build': [
    ISSUE,
    { label: 'The repo and knowledge/', paths: ['repo:**'], from: 'start' },
    CHECKS,
    { label: 'Its own notes', paths: ['job:build-notes.md'], from: 'start' },
    {
      label: 'Findings and diagnosis',
      paths: ['job:reviews/*.findings.md', 'job:diagnosis.md'],
      from: 'start',
    },
  ],
  'factory-evaluator': reviewer('evaluator'),
  'factory-test-reviewer': [
    ...reviewer('test-reviewer'),
    // A ruling on an acceptance-test fix: the uncommitted diff is in the repo.
    { label: 'Its own rulings', paths: ['job:rulings/**'], from: 'start' },
  ],
  // Diagnoses a second failed build: sees what the evaluator sees after its blind pass, from the
  // start, since it has no blind pass of its own.
  'factory-diagnose': [
    ISSUE,
    INSTRUCTIONS,
    { label: 'The repo at the branch', paths: ['repo:**'], from: 'start' },
    { label: "The job's folder", paths: ['job:**'], from: 'start' },
  ],
}

const matches = (glob: string, target: Target) => {
  const [area, pattern] = glob.split(/:(.*)/s) as [string, string]
  return area === target.area && new Bun.Glob(pattern).match(target.path)
}

type ReadVerdict = { ok: true; input: string } | { ok: false; reason: string }

type ReadState = {
  blindPassWritten: boolean
  /**
   * The reader is a reviewer planned to verify in this pass: it has no blind pass, and reads the
   * previous merged findings and its own previous final report (review-plan.ts verifierMayRead).
   */
  verifying?: boolean
}

/**
 * The breach rule: a read is fine only if the target is one of the agent's inputs and that input
 * is visible at this moment.
 */
export function classifyRead(agent: AgentType, target: Target, state: ReadState): ReadVerdict {
  if (target.area === 'outside') {
    return { ok: false, reason: `Read outside the job's worktree and folder: ${target.path}` }
  }
  const role = reviewerRole(agent)
  if (state.verifying && role && target.area === 'job' && verifierMayRead(role, target.path)) {
    return { ok: true, input: 'Previous findings and its own report (verify pass)' }
  }
  const input = INPUTS[agent].find((candidate) =>
    candidate.paths.some((glob) => matches(glob, target)),
  )
  if (!input) {
    return { ok: false, reason: `${target.path} is not one of ${agent}'s inputs` }
  }
  if (input.from === 'after-blind-pass' && !state.blindPassWritten) {
    return {
      ok: false,
      reason: `${agent} read ${input.label.toLowerCase()} before writing its blind first pass`,
    }
  }
  return { ok: true, input: input.label }
}

type WriteVerdict = { ok: true } | { ok: false; reason: string }

const deny = (reason: string): WriteVerdict => ({ ok: false, reason })

/** The worktree folder where the test and build agents keep scratch output; gitignored. */
export const SCRATCH_DIR = '.scratch'

/**
 * What each agent may write: the "May write" column of factory/README.md. `worktree` lets the
 * denial of a write outside it name the scratch folder the test and build agents write to instead.
 */
export function classifyWrite(agent: string, target: Target, worktree?: string): WriteVerdict {
  if (target.area === 'outside') {
    const scratch =
      worktree && (agent === 'factory-test' || agent === 'factory-build')
        ? ` Scratch output goes in ${join(worktree, SCRATCH_DIR)}/.`
        : ''
    return deny(
      `Write outside the job's worktree and folder: ${target.path}. Work in the worktree.${scratch}`,
    )
  }
  switch (agent) {
    case 'factory-test': {
      if (target.area === 'job') {
        return target.path === 'acceptance.md'
          ? { ok: true }
          : deny('The test agent writes only acceptance.md in the job folder.')
      }
      const rule = ruleProtecting(target.path)
      if (rule && !isAcceptanceTest(target.path)) {
        return deny(
          `${target.path} is protected (${rule}). Raise it with the orchestrator instead of changing it.`,
        )
      }
      return { ok: true }
    }
    case 'factory-build': {
      if (target.area === 'job') {
        return target.path === 'build-notes.md'
          ? { ok: true }
          : deny('The build agent writes only build-notes.md in the job folder.')
      }
      const protection = protectedFromBuild(target.path)
      return protection
        ? deny(
            `${target.path} is protected (${protection}). Stop and escalate to the orchestrator instead of changing it.`,
          )
        : { ok: true }
    }
    case 'factory-diagnose':
      return target.area === 'job' && target.path === 'diagnosis.md'
        ? { ok: true }
        : deny('The diagnosis agent writes only diagnosis.md in the job folder.')
    case 'factory-evaluator':
    case 'factory-test-reviewer': {
      const role = agent.replace('factory-', '')
      const own = [`reviews/*.${role}*.md`, sandboxGlob(role), `sandbox/${role}`]
      const ruling = role === 'test-reviewer' && /^rulings\/\d+\.md$/.test(target.path)
      return target.area === 'job' &&
        (ruling || own.some((glob) => new Bun.Glob(glob).match(target.path)))
        ? { ok: true }
        : deny(
            `A reviewer writes only its own reports, reviews/<pass>.${role}[.blind].md in the job folder, ${role === 'test-reviewer' ? 'the ruling factory ruling names (rulings/<m>.md), ' : ''}and anything in its own sandbox, sandbox/${role}/ (factory sandbox <n> ${role}). Report the problem as a finding instead.`,
          )
    }
    default:
      return deny(`${agent} is not a factory agent and may not write during a job.`)
  }
}
