import { z } from 'zod'

export const CheckStatus = z.enum(['up', 'down']).meta({ id: 'CheckStatus' })
export type CheckStatus = z.infer<typeof CheckStatus>

export const HealthStatus = z
  .object({
    status: CheckStatus,
    checks: z.object({
      database: CheckStatus,
      bucket: CheckStatus,
    }),
  })
  .meta({ id: 'HealthStatus' })
export type HealthStatus = z.infer<typeof HealthStatus>
