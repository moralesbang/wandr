# Wandr

Wandr is a portfolio project: a web map journal for walks, built to practice senior software engineering with AI-assisted development. The user is product owner, architect, designer and reviewer; you implement. Why it exists: [`README.md`](README.md).

## Working with the user

- Talk with the user in Spanish. Write everything that lives in the repo in English: code, comments, docs, knowledge, commit messages, branch and PR text.
- Judge every proposal by whether it shows a senior engineering decision a reviewer can verify (the map editor, the private/public boundary, tests that defend the privacy promise), ahead of feature breadth.
- This is not a pitch: docs cover the product and the engineering decisions, and leave out market analysis and competitors.
- When talking with the user, give every doc code (M5, S4, P3, §5) its meaning in plain words in the same sentence, e.g. "S3 (undo in the route editor, an optional extra cut if time runs short)". Questions to the user stand on their own: they answer without opening the docs.

## Code

- Before writing or reviewing code under `apps/` or `packages/`, read [`knowledge/README.md`](knowledge/README.md) and every standard it lists for the paths you touch. When the user settles a new convention, record it there as a standard.
- When code breaks a convention in `knowledge/` or the architecture, yours or another agent's, turn the convention into a lint error following [`knowledge/standards/lint-rules.md`](knowledge/standards/lint-rules.md).
- Code reaches `main` only through a pull request with passing checks: branch first, then open the PR.

## Docs

- Commit and push docs-only changes straight to `main`, no branch, until the user says otherwise.
- Each doc holds the current definition only. When a decision changes, rewrite the doc as if the previous version never existed, with no version labels or "what changed" sections; git keeps the history. Exception: `factory/versions/` holds one dated record per factory version, history by design. Every factory change (the CLI, the `factory watch` page and its events, the skill, the agents, the hooks) goes in the record of the version it ships in, in the same PR.
- Read before acting:
  - [`docs/01-product-brief.md`](docs/01-product-brief.md) before proposing product changes.
  - [`docs/02-mvp-scope.md`](docs/02-mvp-scope.md) before planning or estimating work.
  - [`docs/03-design-brief.md`](docs/03-design-brief.md) before writing UI copy or visual design.
  - [`docs/04-flows.md`](docs/04-flows.md) before designing or building a screen.
  - [`docs/05-architecture.md`](docs/05-architecture.md) before writing code or changing how a part is built.
