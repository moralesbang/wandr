import { z } from 'zod'

export const ErrorCode = z.enum(['bad_request', 'unauthorized', 'not_found', 'internal'])
export type ErrorCode = z.infer<typeof ErrorCode>

export const ErrorBody = z
  .object({
    error: z.object({
      code: ErrorCode,
      message: z.string(),
      issues: z
        .array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
        .optional(),
    }),
  })
  .meta({ id: 'ErrorBody' })
export type ErrorBody = z.infer<typeof ErrorBody>
