import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { db } from '../db/client.ts'

await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname })
