# Lint rules

## Purpose

Turn the architecture's conventions into lint errors, so a broken convention fails CI instead of relying on a reviewer to catch it. Each time an agent breaks a convention, the codebase learns to reject it.

## Scope

Applies whenever you find code, yours or another agent's, written or under review, that breaks a rule in `knowledge/` or a decision in [`docs/05-architecture.md`](../../docs/05-architecture.md); and to every file under `packages/oxlint-plugin-wandr/` and to `.oxlintrc.json`.

**MUST**, **MUST NOT**, **SHOULD** and **MAY** follow RFC 2119.

## Steps

Fix the violation itself as usual. Then, for the convention it broke:

1. **Decide if it's lintable.** It is when the violation shows in the syntax of one file: an import, a call, a name, a file's location. When it needs types, runtime data or several files at once, it isn't: tell the user, and name the test or review step that covers it instead. Done for this convention.
2. **Look for a native rule.** Check oxlint's rules (`bunx oxlint --rules`) for one that, configured, rejects the violation, such as `no-restricted-imports` with an override per folder. If one does, use it and go to step 5.
3. **Write a custom rule** in `packages/oxlint-plugin-wandr/`, the project's local plugin, never published:
   - The rule lives in `src/rules/<rule-name>.ts`, is exported from the plugin's index, and is referenced as `wandr/<rule-name>`.
   - Its message names the standard's rule ID and the fix: `"TanStack Query is imported only inside src/api/ (data-layer DL-002). Use a resource hook."`
4. **Test it** in `src/rules/<rule-name>.test.ts` with the `RuleTester` from `oxlint/plugins-dev`, run by `bun test`. The tests MUST hold:
   - **valid** cases: code that follows the convention, including code that looks close to a violation and isn't;
   - **invalid** cases: the violation that was found, and each other form it can take, every one asserting its `messageId`;
   - **edge cases**: the boundaries of the rule's paths (a file just inside and just outside the allowed folder), type-only imports, re-exports, aliased and dynamic imports, test files and generated files, whichever the rule can meet.
5. **Configure it as `error`** in `.oxlintrc.json`, scoped with `overrides` to the paths its convention applies to. A rule MUST NOT be set to `warn` or `off`.
6. **Make the codebase pass.** Run `turbo run lint` across the repo and fix every existing violation in the same change.
7. **Link it from its standard.** Under the standard's rule, add one line: `Enforced by \`wandr/<rule-name>\`` or `Enforced by oxlint's \`<rule>\``.

The convention is done when its rule fails on every invalid case, passes on every valid one, is set to `error`, and `turbo run lint` passes on the whole repo.

## CI

`turbo run lint` and the plugin's tests run in CI on every pull request, and CI is a required check on `main`: a lint error blocks the merge.
