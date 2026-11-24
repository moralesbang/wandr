# Workspace

## Purpose

Keep the monorepo's shape the one [`docs/05-architecture.md` §4](../../docs/05-architecture.md#4-repository) describes: two apps, packages only where both apps need them, one version of each dependency, and generated files that always match the code.

## Scope

Applies to every change that adds or moves a package, adds a dependency, touches a `package.json`, `tsconfig*.json`, `turbo.json`, `bunfig.toml` or lint and format config, or changes code that a generated file is built from.

**MUST**, **MUST NOT**, **SHOULD** and **MAY** follow RFC 2119.

## Packages

### WS-001 — A package needs two consumers

A new package under `packages/` MUST be used by both `apps/web` and `apps/api`; the lint plugin and the TypeScript configuration count, since both apps are linted and compiled with them. Code one app uses lives in that app.

### WS-002 — Apps never import each other

An app MUST NOT depend on another app. `apps/web` reads the API's shape only from its generated types ([WS-005](#ws-005--generated-files-are-committed-never-edited)).

#### Rationale

`apps/api` holds the database schema and the server's secrets. If the SPA could import from it, the private/public boundary would rest on discipline instead of the dependency graph.

### WS-003 — `packages/sharing` stays pure

`packages/sharing` MUST hold pure functions only: no I/O, no database, no React, no time or randomness.

## Dependencies

### WS-004 — Added where used, versioned in the catalog

A dependency MUST be added to the `package.json` of the workspace that imports it, never to the root's. A dependency used by more than one workspace MUST take its version from the root catalog (`"react": "catalog:"`). `bunfig.toml` keeps `linker = "isolated"`.

## Generated files

### WS-005 — Generated files are committed, never edited

`apps/api/openapi.json` and the SPA's generated API types MUST be regenerated with `turbo run codegen` whenever a route or a contract schema changes, and committed in the same change. They MUST NOT be edited by hand. CI fails when they don't match the code.

## TypeScript, lint and format

### WS-006 — One strict configuration

Every workspace MUST extend `packages/tsconfig`, which sets `strict` and `noUncheckedIndexedAccess`. A workspace MUST NOT loosen either.

### WS-007 — oxlint and oxfmt pass before commit

Code MUST pass `turbo run lint` (oxlint) and the oxfmt check before it's committed. A rule is disabled only on its line, with a comment saying why.

### WS-008 — File names in kebab-case

Every source file MUST be named in kebab-case (`find-marker.tsx`, `use-delete-walk.ts`), whatever it exports. Route files follow TanStack Router's naming (`$walkId.tsx`, `_journal/`).
