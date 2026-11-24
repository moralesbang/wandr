import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { db } from './client.ts'

// Railway's pre-deploy command: the new release starts only once this exits 0.
await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname })
await db.$client.close()
console.log('Migrations applied')
