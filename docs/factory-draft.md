# Wandr — Factory (draft)

**Status:** Draft, no decisions taken
**Date:** November 24, 2026
**Related:** [`02-mvp-scope.md`](./02-mvp-scope.md) · [`05-architecture.md`](./05-architecture.md) · [`knowledge/`](../knowledge/README.md)

The blueprint of the process that takes each item of the scope, from a Must to a later Should or Could, through to a merged pull request. Everything it needs lives in this repository: skills, agents and Claude Code configuration under `.claude/`, the rules under `knowledge/`. Claude is enough to run it; Codex is an optional second opinion ([§6](#6-second-opinion-claude-by-default-codex-optional)).

---

## 1. Where testing stands today

| Layer | Runner | Covers today |
| --- | --- | --- |
| Unit, packages | `bun test` | `packages/sharing`: `pointsInStretch`, one case per row |
| Unit, SPA logic | Vitest | `resolveGesture`, route edits, tap detection; the tools table row by row |
| API integration | `bun test` through `app.request()` against real Postgres and RustFS in Docker (`wandr_test`, `wandr-test`); a preload applies the migrations | Health, cache headers, path redaction |
| Components | Vitest, jsdom, Testing Library, queried by role | The health status |
| End to end | Playwright against the built SPA served by the API on :3100, Pixel 7 and iPhone 15 profiles | Home page, deep link vs unknown API path |
| Lint rules | `node --test` with oxlint's `RuleTester` | `wandr/no-cross-feature-imports` |

Gaps against [`testing.md`](../knowledge/standards/testing.md):

1. No helper empties the tables or the bucket between API tests (T-004).
2. No fixtures for accounts and sessions, so no account A and account B to test ownership with.
3. The ownership test that walks every journal route in `openapi.json` doesn't exist yet (T-005, T-006).
4. No axe check in Playwright (T-008).
5. No single local command that runs what CI runs: lint, typecheck, test, build, format check and the generated-files check.

## 2. The unit of work

A **work order**: one vertical slice of a scope item, small enough for one pull request. M6 (sharing), for example, splits into selection and preview, creating and revoking the link, and the shared page.

## 3. Stations

```
02-mvp-scope ─► 1 Intake ─► 2 Plan ─►[G1]─► 3 Red tests ─►[G2*]─► 4 Build
   ─► 5 Local checks ─► 6 Review ─► 7 PR + CI ─►[G3: merge] ─► 8 Close
```

Gates G1, G2 and G3 are the user's. `*` G2 applies only to the privacy lane ([§4](#4-lanes)).

| Station | What it does | Leaves with |
| --- | --- | --- |
| 0. Setup (once, before M1) | Closes the gaps in [§1](#1-where-testing-stands-today); adds `.claude/settings.local.json` to `.gitignore` | A local command equal to CI; the privacy test harness |
| 1. Intake | Picks the next item by the scope's rules: Musts first, Shoulds from the bottom of their list up, Coulds only after the checkpoint. An item not in the scope enters only after the scope changes. Splits it into slices. | Ordered slices |
| 2. Plan | Maps each acceptance criterion to a test and its layer; lists the paths touched and the `knowledge/` standards they bring; the contract and migration changes; open questions. | The work order |
| 3. Red tests | Writes the failing tests and commits them. They are frozen: the build doesn't change them without going back through the gate. | A red commit |
| 4. Build | In a worktree on `feat/<id>-<slug>`: contract, migration, API, codegen, data layer, UI. | A green commit |
| 5. Local checks | What CI runs, plus the affected end-to-end tests | All green locally |
| 6. Review | A fresh-context reviewer checks the diff against the work order and the standards; each broken convention becomes a lint rule ([`lint-rules.md`](../knowledge/standards/lint-rules.md)). UI changes get a browser check at 360 px, light and dark, keyboard only. | Findings fixed |
| 7. PR | The description traces each criterion to its test; CI green | A pull request ready to merge |
| 8. Close | Marks the item done; a new convention goes to `knowledge/`, a changed decision rewrites its doc | The repo up to date |

## 4. Lanes

Lanes change the gates, not the stations.

| Lane | Items | Extra |
| --- | --- | --- |
| Privacy | M1, M3, M6, and any change to `/api/shared`, the projection, photos or auth | The user reviews the tests before the build (G2); T-005 and T-006 pass |
| Map editor | M4, C1, C3 | The tools table tested row by row; checked by hand on a real phone |
| Standard | Everything else | — |

## 5. What lives in the repo

- `.claude/skills/`: one skill per station (intake, plan, build, review, ship) and one that runs them in order for a scope item.
- `.claude/agents/`: planner, test writer, implementer, reviewer, UI checker; each with a fresh context and the fewest tools it needs.
- `.claude/settings.json`: permissions, and hooks that block editing generated files, migrations already on `main`, and frozen tests during the build.
- `knowledge/` stays the single source of the rules: agents read it, nothing copies it.

Items after the MVP enter the same way: the scope changes first, then intake. Only their order and their lane differ.

## 6. Second opinion: Claude by default, Codex optional

Some stations ask for a second opinion from a fresh context. Its executor is a Claude agent by default; a model from another family makes different mistakes, so where Codex is connected it takes these points instead.

| Station | Second opinion | Mode |
| --- | --- | --- |
| 2. Plan | Which acceptance criterion has no test? Which standard is missing? | Read only |
| 3. Red tests, privacy lane | Find an implementation that passes the tests and still leaks; if one exists, a test is missing | Read only |
| 4. Build | Rescue: after N failed attempts to reach green, another executor tries in the same worktree | Write |
| 6. Review | Reviews the diff against the work order and the standards, beside the Claude reviewer | Read only |

- **The repo holds the prompts**, model-agnostic, so both executors answer the same question in the same shape.
- **Connecting Codex** is the Codex plugin installed for the user plus one line in `.claude/settings.local.json`, which is never committed: `{ "env": { "WANDR_CODEX": "1" } }`. Removing the line disconnects it. The project's `.claude/settings.json` never names Codex.
- **The fallback is automatic.** Without Codex, or when it fails or runs out of quota, the point runs with Claude. Without Codex, the rescue is a new Claude implementer given the failed attempts' log, then the user.
- **Rules for both executors:**
  1. A second opinion is input, not a verdict: Claude checks each finding against the code before acting on it, and an unchecked finding blocks nothing. It never commits, opens a pull request or passes a gate.
  2. Who writes doesn't review: if one executor rescued a build, the other reviews it.
  3. Read only, except the rescue, which writes only in its work order's worktree.
  4. CI runs no model: the required check stays lint, typecheck, tests and build.
- **To check in setup:** whether a project skill can call the Codex plugin's `review` and `adversarial-review`, or only its rescue agent. If not, the skill calls the `codex` CLI directly.

## 7. Open decisions

1. **Where a work order lives:** a GitHub issue linked from the pull request, a file in the repo, or only the pull request's description.
2. **G1, the plan's approval:** every lane, or only the privacy and map editor lanes.
3. **Parallel work:** one work order building and the next one planning, or more.
4. **Codex in review:** every pull request, or only the privacy and map editor lanes.
5. **Rescue:** automatic after N failed attempts (2 proposed), or only when the user asks.
6. **The Codex plugin's stop-time review gate:** off, since the factory calls the second opinion at its own points.
