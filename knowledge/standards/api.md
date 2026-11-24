# API

## Purpose

Keep the privacy promise in the backend: every journal access scoped by its owner, every shared page read through the public projection, nothing shared kept, and every route on the OpenAPI contract. The decisions behind these rules are in [`docs/05-architecture.md`](../../docs/05-architecture.md).

## Scope

Applies to every file under `apps/api/` and `packages/contract/`.

**MUST**, **MUST NOT**, **SHOULD** and **MAY** follow RFC 2119.

## Layout

### API-001 — One place for each kind of code

```
src/
  app.ts           the OpenAPIHono app: middleware, routes, error handler, static files
  env.ts           the validated environment
  routes/          one file per resource: auth, walks, finds, photos, route, links, shared
  db/              Drizzle schema and the owner-scoped query functions
  auth/            sessions and password hashing
  photos/          the photo pipeline and storage
  projection/      projectWalk
drizzle/           generated SQL migrations
```

## Contract

### API-002 — Every route is on the contract

Every route MUST be declared with `createRoute`, using request and response schemas from `packages/contract`, and registered on the `OpenAPIHono` app, so it appears in `openapi.json`. Regenerate and commit the generated files with it (`workspace.md` WS-005).

## Journal

### API-003 — Every journal query filters by owner

Every database read and write behind a journal route MUST go through a function in `db/` that takes the session's `userId` and filters by it in the same query. A route handler MUST NOT query a journal table directly.

#### Good
```ts
export const findWalk = (userId: string, walkId: string) =>
  db.query.walks.findFirst({ where: and(eq(walks.id, walkId), eq(walks.userId, userId)) })
```

#### Bad
```ts
const walk = await db.query.walks.findFirst({ where: eq(walks.id, walkId) })
if (walk?.userId !== userId) throw new HTTPException(403)
```

### API-004 — Missing and not yours are the same 404

A resource that doesn't exist, isn't the user's, or sits behind a revoked or unknown link MUST get 404 with the same body. A route MUST NOT return 403.

## Sharing

### API-005 — Shared routes read only through the projection

Routes under `/api/shared/` and `share-preview` MUST build their response with `projectWalk` and MUST NOT query walks, finds or route points themselves. `projectWalk`'s result MUST pass through `PublicWalk.parse()` before it's returned.

### API-006 — No ID leaves through a shared response

A shared response MUST NOT carry a walk, find, photo, point, link or user ID. Shared photos are addressed by the find's position on the link: `/api/shared/:token/finds/:index/photo`.

### API-007 — The stretch comes from `packages/sharing`

The projection and the route save MUST compute the stretch with `pointsInStretch` and `resolveStretch` from `packages/sharing`.

### API-008 — Nothing shared is cached

Responses under `/s/` and `/api/shared/` MUST send `Cache-Control: no-store`. A photo served to its owner MUST send `Cache-Control: private`.

## Photos

### API-009 — The original is never stored

An uploaded photo MUST be checked by its first bytes (JPEG, PNG or WebP) and its size (10 MB at most), rotated by its orientation tag, stripped of all metadata, and stored only as its two WebP versions under `photos/<photoId>/`. The uploaded original MUST NOT be written anywhere.

### API-010 — No signed URLs

Photos MUST be served by Hono after its checks. The bucket stays private and the API MUST NOT hand out signed URLs.

#### Rationale

A signed URL works until it expires; a revoke must reach every photo on the next request.

## Requests and errors

### API-011 — One error path

Errors MUST go through the app's error handler: 400 with the validation issues, 401 for a journal route without a session, 404 as in API-004. Handlers throw; they don't build error responses themselves.

### API-012 — Writes pass the CSRF check

Hono's `csrf()` middleware MUST run on every route that writes.

## Configuration, logs and migrations

### API-013 — The environment through `env.ts`

Code MUST read configuration only from `env.ts`, which validates `process.env` with zod at startup. A new variable is added to `env.ts` and `.env.example` together.

### API-014 — Logs hold no secret

Logs MUST NOT contain a link token, a session cookie, a password or a note's text. The request logger redacts paths under `/s/` and `/api/shared/`.

### API-015 — Migrations are generated and final

Schema changes MUST go through `drizzle-kit generate`, with the SQL committed. A migration that has reached `main` MUST NOT be edited; a fix is a new migration. Nothing is pushed to a database without a migration.
