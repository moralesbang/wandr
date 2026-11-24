import { app } from './app.ts'

// `turbo run codegen`: writes the contract every route declares (API-002, WS-005).
const document = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: { title: 'Wandr API', version: '0.0.0' },
})

await Bun.write(
  new URL('../openapi.json', import.meta.url),
  `${JSON.stringify(document, null, 2)}\n`,
)
