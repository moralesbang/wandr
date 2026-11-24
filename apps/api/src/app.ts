import { OpenAPIHono } from '@hono/zod-openapi'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { env } from './env.ts'
import { cacheControl } from './http/cache-control.ts'
import { notFound, onError, validationHook } from './http/errors.ts'
import { requestLogger } from './http/request-logger.ts'
import { mountSpa } from './http/spa.ts'
import { health } from './routes/health.ts'

export const app = new OpenAPIHono({ defaultHook: validationHook })

app.use(requestLogger())
app.use(cacheControl())
app.use('/api/*', csrf())

app.route('/', health)

// An unknown API path is a JSON 404, never the SPA's index.html.
app.all('/api/*', () => {
  throw new HTTPException(404)
})

if (env.WEB_DIST) mountSpa(app, env.WEB_DIST)

app.notFound(notFound)
app.onError(onError)
