# Wandr

Wandr is a portfolio project: a web map journal for walks, built to practice senior software engineering with AI-assisted development. The user is product owner, architect, designer and reviewer; you implement. Why it exists: [`README.md`](README.md).

## Working with the user

- Judge every proposal by whether it shows a senior engineering decision a reviewer can verify (the map editor, the private/public boundary, tests that defend the privacy promise), ahead of feature breadth.
- This is not a pitch: docs cover the product and the engineering decisions, and leave out market analysis and competitors.
- When talking with the user, give every doc code (M5, S4, P3, §5) its meaning in plain words in the same sentence, e.g. "S3 (undo in the route editor, an optional extra cut if time runs short)". Questions to the user stand on their own: they answer without opening the docs.

## Docs

- Write docs in English.
- Commit and push docs-only changes straight to `main`, no branch, until the user says otherwise.
- Each doc holds the current definition only. When a decision changes, rewrite the doc as if the previous version never existed, with no version labels or "what changed" sections; git keeps the history.
- Read before acting:
  - [`docs/01-product-brief.md`](docs/01-product-brief.md) before proposing product changes.
  - [`docs/02-mvp-scope.md`](docs/02-mvp-scope.md) before planning or estimating work.
  - [`docs/00-identity.md`](docs/00-identity.md) before writing UI copy or visual design.
