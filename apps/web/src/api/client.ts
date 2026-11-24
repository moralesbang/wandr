import { notFound } from '@tanstack/react-router'
import createClient from 'openapi-fetch'
import type { paths } from './schema.gen'

// Same origin as the SPA: Hono serves both (docs/05-architecture.md §2).
export const api = createClient<paths>({ baseUrl: '' })

export class ApiError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`The API answered ${status}`)
    this.name = 'ApiError'
    this.status = status
  }
}

type ApiResult<Data> = { data?: Data; response: Response }

// The only place a response becomes data or an error (data-layer DL-011): a 404
// is the route's "not found", anything else that isn't ok is an ApiError.
export const unwrap = async <Data>(request: Promise<ApiResult<Data>>): Promise<Data> => {
  const { data, response } = await request
  if (response.status === 404) throw notFound()
  if (!response.ok || data === undefined) throw new ApiError(response.status)
  return data
}
