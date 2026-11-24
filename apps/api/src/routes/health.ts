import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { type CheckStatus, HealthStatus } from '@wandr/contract'
import { pingDatabase } from '../db/client.ts'
import { pingBucket } from '../photos/bucket.ts'

const TIMEOUT_MS = 2000

const check = async (name: string, probe: () => Promise<unknown>): Promise<CheckStatus> => {
  try {
    await Promise.race([
      probe(),
      Bun.sleep(TIMEOUT_MS).then(() => Promise.reject(new Error('timed out'))),
    ])
    return 'up'
  } catch (error) {
    console.error(`health: ${name} is down (${error instanceof Error ? error.name : 'unknown'})`)
    return 'down'
  }
}

const route = createRoute({
  method: 'get',
  path: '/api/health',
  summary: 'Whether the API, its database and its bucket answer',
  responses: {
    200: {
      description: 'Everything answers',
      content: { 'application/json': { schema: HealthStatus } },
    },
    503: {
      description: 'The database or the bucket doesn’t answer',
      content: { 'application/json': { schema: HealthStatus } },
    },
  },
})

export const health = new OpenAPIHono().openapi(route, async (c) => {
  const [database, bucket] = await Promise.all([
    check('database', pingDatabase),
    check('bucket', pingBucket),
  ])
  const status: CheckStatus = database === 'up' && bucket === 'up' ? 'up' : 'down'
  return status === 'up'
    ? c.json({ status, checks: { database, bucket } }, 200)
    : c.json({ status, checks: { database, bucket } }, 503)
})
