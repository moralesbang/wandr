import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sql'
import { env } from '../env.ts'
import * as schema from './schema.ts'

export const db = drizzle(env.DATABASE_URL, { schema, casing: 'snake_case' })

export const pingDatabase = () => db.execute(sql`select 1`)
