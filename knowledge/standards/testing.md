# Testing

## Purpose

Make the privacy promise and the map editor's rule provable: each is defended by tests a reviewer can read, run on every pull request. The strategy is in [`docs/05-architecture.md` §11](../../docs/05-architecture.md#11-testing).

## Scope

Applies to every test file (`*.test.ts`, `*.test.tsx`, `apps/web/e2e/**`) and to every change to code a test below covers.

**MUST**, **MUST NOT**, **SHOULD** and **MAY** follow RFC 2119.

## Where and with what

### T-001 — One runner per workspace

Tests in `apps/api` and `packages/` MUST run with `bun test`; tests in `apps/web/src` with Vitest; end-to-end tests in `apps/web/e2e/` with Playwright.

### T-002 — Tests sit beside their code

A unit, API or component test MUST sit next to the file it tests, named `<file>.test.ts(x)`.

## Rules written as tables

### T-003 — One case per row

A rule the docs write as a table or a list of cases MUST be tested with `test.each`, one case per row, named after the row: the tools table in [`docs/04-flows.md` §2](../../docs/04-flows.md#2-the-map-editor) for `resolveGesture`, and the stretch rules in [`docs/02-mvp-scope.md` §5](../../docs/02-mvp-scope.md#5-surfaces-and-sharing-rules) for `packages/sharing`.

## API

### T-004 — Against real services

API tests MUST call the app through `app.request()` against the Postgres and MinIO that `docker compose` starts. They MUST NOT mock the database or the bucket. Every test starts from empty tables.

### T-005 — The privacy tests

These MUST exist and pass before M1, M3 or M6 is done:

- **Ownership:** for every journal route in `openapi.json`, account B gets 404 for what account A owns.
- **Allowlist:** the keys of a shared response equal the allowed set exactly.
- **Location:** a photo with GPS, once stored, has no location metadata when read back from the bucket.
- **Links:** editing a selected find shows on the link and adding a find doesn't; inserting a point inside the stretch shows and outside it doesn't; deleting an end moves the edge inward; after a revoke, the page and its photos return 404; the photo of an unselected find is never reachable through the link.

### T-006 — A new route joins the ownership test

A new journal route MUST be reached by the ownership test. If its path or body needs data the test can't derive from `openapi.json`, extend the test's fixtures in the same change.

## SPA

### T-007 — Components are tested by what the user sees

Component tests MUST query by role and accessible name, and cover every state the screen has in the flows: loading shapes aside, at least the content, empty, error and not found.

### T-008 — The demo is one end-to-end test

The [scope's demo](../../docs/02-mvp-scope.md#2-the-demo-this-scope-must-deliver) MUST run as one Playwright test with two browser contexts, the walker's and the friend's, and every journal page MUST pass an axe check in light and dark mode.
