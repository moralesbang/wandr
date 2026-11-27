# Wandr

A web map journal for walks. After a walk, you place what caught your eye on a map, each find with a note or a photo, and optionally draw the route you want to repeat. When you want to, you share only the finds and the stretch you choose, through a link that opens without an account and that you can revoke at any time.

A portfolio project, built to practice senior software engineering with AI-assisted development. The [factory](factory/README.md), the agentic system that takes an issue to a pull request, is half of the project: its first goal is to show how such a system is built while the whole project is managed with AI.

## Docs

- [Product brief](docs/01-product-brief.md): the problem, who it's for and what Wandr does.
- [MVP scope](docs/02-mvp-scope.md): what the MVP includes and leaves out, and how it's verified.
- [Design brief](docs/03-design-brief.md): how Wandr feels, speaks and looks, and the UX problems its design must solve.
- [Flows](docs/04-flows.md): the MVP's screens, how people move through them, and what each shows in every state.
- [Architecture](docs/05-architecture.md): how Wandr is built, its data and API, and why each piece was chosen.
- [Knowledge](knowledge/README.md): the standards its code is written to.

## Run it locally

You need [Bun](https://bun.sh) 1.4, Node 26 (oxlint's plugin runs in it) and Docker.

```sh
bun install
cp apps/api/.env.example apps/api/.env
bun run services     # Postgres and an S3-compatible bucket, in Docker
bun run db:migrate
bun run dev          # the API on :3000, the SPA on Vite's port
```

| Command | What it does |
| --- | --- |
| `bun run lint` · `bun run typecheck` · `bun run test` · `bun run build` | What CI runs on every pull request |
| `bun run e2e` | Playwright against the built SPA served by the API |
| `bun run format` | oxfmt over the repo |
| `bun run codegen` | Regenerates `apps/api/openapi.json` and the SPA's API types; commit both |
| `bun run --cwd apps/api db:generate` | A new migration from the Drizzle schema |
