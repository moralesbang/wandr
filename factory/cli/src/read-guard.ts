// The guard's policy for reads and searches (Read, Grep, Glob) and for the prompts the orchestrator
// gives the agents it launches (Agent).

import { allow, type Policy } from './policy.ts'

export const readPolicy: Policy = () => allow

export const agentPolicy: Policy = () => allow
