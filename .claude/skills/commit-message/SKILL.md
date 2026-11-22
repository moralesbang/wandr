---
name: commit-message
description: Writes git commit messages in Conventional Commits 1.0.0 format. Use when committing, or drafting or rewording a commit message.
model: haiku
effort: low
---

Write the message for the **staged** change (`git diff --staged`; fall back to `git diff` only if nothing is staged). Committing is a separate decision: run `git commit` only when the user asked for a commit.

## Shape

```
<type>[(<scope>)][!]: <description>

[body]

[footer(s)]
```

Blank line between header, body and footers. Every line of the body and footers wraps at 72 columns.

## Header

- **type**, lowercase, one of:
  - `feat` adds a capability (SemVer MINOR)
  - `fix` repairs a bug (SemVer PATCH)
  - `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- **scope**: optional noun naming the area touched, in parentheses: `fix(parser):`. Reuse scopes already present in `git log --oneline`.
- **description**: imperative mood, lowercase first letter, no trailing period, header ≤ 72 chars total. It states the _outcome_ of the change ("define approved MVP domain model"), not the activity ("updated files").

Pick the type by the change's dominant intent. A diff that spans two intents is two commits: say so and propose the split.

## Body

Optional. Write it when the _why_ is not obvious from the header: the motivation, the constraint, the alternative rejected. The diff already shows the _what_.

## Footers

`Token: value` or `Token #value`, one per line, tokens hyphenated (`Reviewed-by:`, `Refs: #123`, `Co-Authored-By:`). Keep any attribution trailer the session requires as the last footer.

## Breaking changes

Mark one in either or both places:

- `!` right before the colon: `feat(api)!: drop v1 endpoints`
- a footer `BREAKING CHANGE: <what breaks and how to migrate>` (uppercase, exact spelling; `BREAKING-CHANGE` also valid)

Any type can be breaking; breaking means SemVer MAJOR.

## Done

The message is done when every rule above holds: type from the list, header ≤ 72 chars in imperative mood, body only where it adds _why_, breaking change marked if the diff removes or changes public behaviour. Output the message in a code block, or pass it to `git commit` via a heredoc when committing.
