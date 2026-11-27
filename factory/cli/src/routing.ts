// A model proposes the issue's shape; this policy, not the model, chooses its stations.
// Paths are exact files so an expected directory cannot hide an expansion of scope.
import { z } from 'zod'
import { isPrivacyBoundary, isTamperProne, isTestFile, ruleProtecting } from './paths.ts'

const Risk = z.enum(['low', 'normal', 'high'])
type Risk = z.infer<typeof Risk>

export const RepoFile = z
  .string()
  .min(1)
  .refine(
    (path) =>
      [...path].every((char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127) &&
      !/[\\*?[\]{}]/.test(path) &&
      !path.startsWith('/') &&
      !/^[A-Za-z]:/.test(path) &&
      path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    'Use an exact repository-relative file path, without wildcards or traversal.',
  )

const Text = z.string().trim().min(1)
export const RoutingProposal = z.strictObject({
  scope: z.enum(['frontend', 'backend', 'fullstack', 'tooling', 'docs']),
  complexity: z.enum(['small', 'standard', 'uncertain']),
  evidence: z.array(Text).min(1),
  expectedPaths: z.array(RepoFile).min(1),
  behaviorChange: z.boolean(),
  uncertainty: z.array(Text),
  verification: z.array(Text).min(1),
})
export type RoutingProposal = z.infer<typeof RoutingProposal>

export const RoutingPlan = RoutingProposal.extend({
  workflow: z.enum(['light', 'standard', 'reinforced', 'research']),
  risk: Risk,
  reasons: z.array(Text).min(1),
  policyVersion: z.literal('1.4'),
  at: z.iso.datetime(),
})
export type RoutingPlan = z.infer<typeof RoutingPlan>

/** An API boundary, authentication, persistence or public-data promise needs reinforced review. */
export const isHighRiskPath = (path: string) =>
  isPrivacyBoundary(path) ||
  /^apps\/api\/(?:drizzle\/|src\/(?:auth|sessions)(?:\/|\.))/.test(path) ||
  /(?:^|\/)(?:migrations?|auth|session|sessions)(?:\/|\.)/.test(path)

/** Deliberately excludes executable JSX: a path alone cannot prove a code change is cosmetic. */
export const isLightPath = (path: string) =>
  !isTestFile(path) &&
  !ruleProtecting(path) &&
  !isTamperProne(path) &&
  !isHighRiskPath(path) &&
  (path === 'README.md' || /^docs\/.+\.md$/.test(path) || /^apps\/web\/src\/.+\.css$/.test(path))

function pathRisk(declared: Risk, paths: readonly string[]): Risk {
  if (declared === 'high' || paths.some(isHighRiskPath)) return 'high'
  if (declared === 'normal' || paths.some((path) => isTamperProne(path) || ruleProtecting(path)))
    return 'normal'
  return 'low'
}

/** Keep a profile honest when the proposed or observed paths span both product layers. */
function scopeFor(
  proposed: RoutingProposal['scope'],
  paths: readonly string[],
): RoutingProposal['scope'] {
  const frontend = paths.some((path) => path.startsWith('apps/web/'))
  const backend = paths.some((path) => path.startsWith('apps/api/'))
  const shared = paths.some((path) => /^packages\/(?:contract|sharing)\//.test(path))
  if (shared || (frontend && backend) || proposed === 'fullstack') return 'fullstack'
  if (frontend) return 'frontend'
  if (backend) return 'backend'
  if (paths.every((path) => path === 'README.md' || path.startsWith('docs/'))) return 'docs'
  return 'tooling'
}

export function planRouting(input: RoutingProposal, declaredRisk: Risk): RoutingPlan {
  const proposal = RoutingProposal.parse(input)
  const risk = pathRisk(Risk.parse(declaredRisk), proposal.expectedPaths)
  const scope = scopeFor(proposal.scope, proposal.expectedPaths)
  const reasons: string[] = []
  let workflow: RoutingPlan['workflow'] = 'standard'
  if (proposal.complexity === 'uncertain' || proposal.uncertainty.length) {
    workflow = 'research'
    reasons.push('Resolve uncertainty and classify again before implementation.')
  } else if (risk === 'high') {
    workflow = 'reinforced'
    reasons.push('Declared risk or sensitive paths require reinforced review.')
  } else if (
    risk === 'low' &&
    proposal.complexity === 'small' &&
    !proposal.behaviorChange &&
    proposal.expectedPaths.every(isLightPath)
  ) {
    workflow = 'light'
    reasons.push(
      'Small, known, low-risk presentation or documentation change without behavior changes.',
    )
  } else {
    reasons.push(
      'Behavior, executable code, complexity or risk requires independent acceptance tests.',
    )
  }
  if (scope !== proposal.scope) reasons.push(`Paths require the ${scope} profile.`)
  return {
    ...proposal,
    scope,
    workflow,
    risk,
    reasons,
    policyVersion: '1.4',
    at: new Date().toISOString(),
  }
}

/** A growing diff may add controls, never remove them. A research job never becomes a build here. */
export function reassessRouting(input: RoutingPlan, changedPaths: readonly string[]): RoutingPlan {
  const plan = RoutingPlan.parse(input)
  const paths = changedPaths.map((path) => RepoFile.parse(path))
  const risk = pathRisk(plan.risk, paths)
  const outside = paths.filter((path) => !plan.expectedPaths.includes(path))
  const reasons = [...plan.reasons]
  let workflow = plan.workflow
  if (workflow !== 'research') {
    if (risk === 'high') workflow = 'reinforced'
    else if (workflow === 'light' && (outside.length || paths.some((path) => !isLightPath(path))))
      workflow = 'standard'
  }
  if (risk !== plan.risk) reasons.push(`Observed paths raised risk to ${risk}.`)
  if (outside.length) reasons.push(`Paths outside the plan: ${outside.toSorted().join(', ')}.`)
  if (workflow !== plan.workflow) reasons.push(`Observed changes require the ${workflow} workflow.`)
  return {
    ...plan,
    scope: scopeFor(plan.scope, [...plan.expectedPaths, ...paths]),
    risk,
    workflow,
    reasons: [...new Set(reasons)],
  }
}

export const requiresAcceptance = (plan: Pick<RoutingPlan, 'workflow'>) =>
  plan.workflow === 'standard' || plan.workflow === 'reinforced'
