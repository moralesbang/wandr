// The guard's policy for Bash commands, from the orchestrator and from every agent.

import { allow, type Policy } from './policy.ts'

export const bashPolicy: Policy = () => allow
