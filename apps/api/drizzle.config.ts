import { defineConfig } from 'drizzle-kit'

// `drizzle-kit generate` reads only the schema; it never connects (API-015).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
})
