import { sql } from 'drizzle-orm'
import {
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

// The data model of docs/05-architecture.md §6. Deletions cascade the way the
// sharing rules say: a deleted walk takes its link with it, and a deleted find
// leaves its link's selection.

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow()

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull().unique(),
    passwordHash: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [check('users_email_lowercase', sql`${table.email} = lower(${table.email})`)],
)

export const sessions = pgTable(
  'sessions',
  {
    // Lucia's recipe: a random ID, and only a hash of the session's secret.
    id: text().primaryKey(),
    secretHash: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
)

export const walks = pgTable(
  'walks',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    walkedOn: date().notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('walks_user_id_idx').on(table.userId)],
)

export const finds = pgTable(
  'finds',
  {
    id: uuid().primaryKey().defaultRandom(),
    walkId: uuid()
      .notNull()
      .references(() => walks.id, { onDelete: 'cascade' }),
    lat: doublePrecision().notNull(),
    lng: doublePrecision().notNull(),
    note: text(),
    // One photo per find; its files live in the bucket under photos/<photoId>/.
    photoId: uuid(),
    createdAt: createdAt(),
  },
  (table) => [
    index('finds_walk_id_idx').on(table.walkId),
    check('finds_note_or_photo', sql`${table.note} is not null or ${table.photoId} is not null`),
  ],
)

export const routePoints = pgTable(
  'route_points',
  {
    // A point keeps its ID across route edits, so a link's ends can follow it.
    id: uuid().primaryKey().defaultRandom(),
    walkId: uuid()
      .notNull()
      .references(() => walks.id, { onDelete: 'cascade' }),
    seq: integer().notNull(),
    lat: doublePrecision().notNull(),
    lng: doublePrecision().notNull(),
  },
  (table) => [index('route_points_walk_id_seq_idx').on(table.walkId, table.seq)],
)

export const links = pgTable('links', {
  id: uuid().primaryKey().defaultRandom(),
  walkId: uuid()
    .notNull()
    .unique()
    .references(() => walks.id, { onDelete: 'cascade' }),
  token: text().notNull().unique(),
  // No stretch when the route has fewer than two points.
  startPointId: uuid().references(() => routePoints.id, { onDelete: 'set null' }),
  endPointId: uuid().references(() => routePoints.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
})

export const linkFinds = pgTable(
  'link_finds',
  {
    linkId: uuid()
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    findId: uuid()
      .notNull()
      .references(() => finds.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.linkId, table.findId] })],
)
