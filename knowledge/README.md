# Knowledge

How code is written in Wandr. [`docs/`](../docs/) says what Wandr is and why each decision was made, [`docs/05-architecture.md`](../docs/05-architecture.md) above all; this folder says how to write the code that follows from those decisions.

A standard binds every line you write or review in the paths it applies to. Read each one that matches the files you touch before writing them.

| Standard | Applies to |
| --- | --- |
| [`workspace.md`](standards/workspace.md) | Packages, dependencies, `package.json`, `tsconfig*.json`, `turbo.json`, lint and format config, and code that generated files are built from |
| [`web.md`](standards/web.md) | `apps/web/src/**` |
| [`data-layer.md`](standards/data-layer.md) | `apps/web/src/**`: every file that calls the API, defines a query key or uses TanStack Query, and every route loader |
| [`api.md`](standards/api.md) | `apps/api/**`, `packages/contract/**` |
| [`testing.md`](standards/testing.md) | Every test file, and every change to code a test covers |
| [`lint-rules.md`](standards/lint-rules.md) | Code that breaks a convention, yours or another agent's; `packages/oxlint-plugin-wandr/**`, `.oxlintrc.json` |
