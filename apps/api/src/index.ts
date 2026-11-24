import { app } from './app.ts'
import { env } from './env.ts'

const server = Bun.serve({ port: env.PORT, fetch: app.fetch })

console.log(`Wandr is listening on port ${server.port}`)

process.on('SIGTERM', async () => {
  await server.stop()
  process.exit(0)
})
