import type { Hook } from '@hono/zod-openapi'
import type { ErrorBody, ErrorCode } from '@wandr/contract'
import type { Env, ErrorHandler, NotFoundHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'

const errorBody = (code: ErrorCode, message: string, issues?: ErrorBody['error']['issues']) => ({
  error: { code, message, ...(issues && { issues }) },
})

const CODES: Partial<Record<number, ErrorCode>> = {
  400: 'bad_request',
  401: 'unauthorized',
  404: 'not_found',
}

const MESSAGES: Record<ErrorCode, string> = {
  bad_request: 'Some fields need another look.',
  unauthorized: 'Sign in to continue.',
  not_found: 'Not found.',
  internal: 'Something went wrong.',
}

// Request validation fails here, with every issue, before a handler runs (API-011).
export const validationHook: Hook<unknown, Env, string, unknown> = (result, c) => {
  if (result.success) return
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.filter((key) => typeof key !== 'symbol'),
    message: issue.message,
  }))
  return c.json(errorBody('bad_request', MESSAGES.bad_request, issues), 400)
}

// Missing, not yours, revoked or unknown: the same body every time (API-004).
export const notFound: NotFoundHandler = (c) =>
  c.json(errorBody('not_found', MESSAGES.not_found), 404)

export const onError: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    const code = CODES[err.status]
    return code ? c.json(errorBody(code, MESSAGES[code]), err.status) : err.getResponse()
  }
  // The stack without its message: a driver's message can quote the values it was given.
  const frames = err.stack?.split('\n').slice(1).join('\n') ?? ''
  console.error(`${err.name}\n${frames}`)
  return c.json(errorBody('internal', MESSAGES.internal), 500)
}
