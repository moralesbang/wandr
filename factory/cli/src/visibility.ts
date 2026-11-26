// "Who sees what", as data: each agent's inputs, the moment each becomes visible, and what it may
// write. factory watch flags reads against it; the guard hook enforces the writes.
//
// A target is a path in one of three areas: `job` (the job's handoff folder, factory/.jobs/<n>/
// inside its worktree), `repo` (the rest of the worktree) or `outside` (anything else, the main
// checkout and its copy of the job's folder included).

import { isAcceptanceTest, protectedFromBuild, ruleProtecting } from './paths.ts'

export type Area = 'repo' | 'job' | 'outside'
export type Target = { area: Area; path: string }

export const AGENTS = [
  'factory-test',
  'factory-build',
  'factory-evaluator',
  'factory-test-reviewer',
] as const
export type AgentType = (typeof AGENTS)[number]

export const isFactoryAgent = (type: string): type is AgentType =>
  (AGENTS as readonly string[]).includes(type)

/** When an input becomes visible: from the agent's start, or once its blind first pass is written. */
export type Moment = 'start' | 'after-blind-pass'

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

const reviewer = (role: 'evaluator' | 'test-reviewer'): Input[] => [
  ISSUE,
  INSTRUCTIONS,
  // The diff against main, the whole suite, the architecture, knowledge/ and the contracts all live
  // in the worktree: a reviewer reads any of it.
  { label: 'The repo at the branch', paths: ['repo:**'], from: 'start' },
  CHECKS,
  { label: 'The gate and its test changes', paths: ['job:gate.json'], from: 'start' },
  { label: 'Its own reports', paths: [`job:reviews/*.${role}*.md`], from: 'start' },
  BUILD_NOTES,
]

export const INPUTS: Record<AgentType, readonly Input[]> = {
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
  'factory-test-reviewer': reviewer('test-reviewer'),
}

const matches = (glob: string, target: Target) => {
  const [area, pattern] = glob.split(/:(.*)/s) as [string, string]
  return area === target.area && new Bun.Glob(pattern).match(target.path)
}

export type ReadVerdict = { ok: true; input: string } | { ok: false; reason: string }

/**
 * The breach rule: a read is fine only if the target is one of the agent's inputs and that input
 * is visible at this moment.
 */
export function classifyRead(
  agent: AgentType,
  target: Target,
  state: { blindPassWritten: boolean },
): ReadVerdict {
  if (target.area === 'outside') {
    return { ok: false, reason: `Read outside the job's worktree and folder: ${target.path}` }
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

export type WriteVerdict = { ok: true } | { ok: false; reason: string }

const deny = (reason: string): WriteVerdict => ({ ok: false, reason })

/** What each agent may write: the "May write" column of factory/README.md. */
export function classifyWrite(agent: string, target: Target): WriteVerdict {
  if (target.area === 'outside') {
    return deny(
      `Write outside the job's worktree and folder: ${target.path}. Work in the worktree.`,
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
    case 'factory-evaluator':
    case 'factory-test-reviewer': {
      const role = agent.replace('factory-', '')
      const own = new Bun.Glob(`reviews/*.${role}*.md`)
      return target.area === 'job' && own.match(target.path)
        ? { ok: true }
        : deny(
            `A reviewer writes only its own reports, reviews/<pass>.${role}[.blind].md in the job folder. Report the problem as a finding instead.`,
          )
    }
    default:
      return deny(`${agent} is not a factory agent and may not write during a job.`)
  }
}
