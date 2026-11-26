# Build the Wandr factory, V1

You are building the first version of Wandr's software factory: the process that takes a GitHub issue to an open pull request with agents. Read `CLAUDE.md` first and follow it; talk with the user in Spanish, write everything in the repo in English.

## Why it exists

The user's main goal is to **learn** to build a factory by iterating on it: a deliberately small V1, then a V2 when a real need shows up, and so on. Every version stays on record so the project shows where it started and what each step improved. Build the smallest V1 that works end to end; every idea beyond it goes to the V2 candidates list, not into the code.

**The user decides.** Take no decision without asking: every choice not listed under "Decided" below goes to the user as a question that stands on its own, with your recommendation first and the trade-off of each option. For any external fact, use serious primary sources (official docs, papers, vendor engineering blogs), never forums, and cite them.

## Decided

| Topic | Decision |
| --- | --- |
| Intake | GitHub issues. An issue form `.github/ISSUE_TEMPLATE/factory.yml` requires a description and numbered acceptance criteria (AC1, AC2…). The factory takes only issues with the label `factory:ready`, which the user sets. |
| Where files live | `factory/` at the repo root: `README.md`, `cli/` (the CLI), `versions/`. The skill in `.claude/skills/factory/SKILL.md`, the agents in `.claude/agents/`. Everything lives in the repo. |
| Job state | One JSON per job in `factory/.jobs/`, gitignored. The CLI also moves the issue's labels (`factory:ready` → `factory:building` → `factory:pr-open`, plus a blocked state) so GitHub shows where each job stands. |
| Concurrency | Up to 3 jobs at a time, **one Claude session per job**: the user runs `/factory 42` in up to three terminals; the CLI refuses a fourth. |
| Skill | One skill only, `/factory`: the orchestrator of one job. It runs in the main session, because a background subagent has no Agent tool and can't spawn the test and build agents. |
| Subagents | Each runs in the background. |
| Deterministic actions | A CLI in **TypeScript on Bun** (the repo's runtime; no new toolchain, no build step, `Bun.$` for git and gh, tested with `bun test`). The CLI is the shell backbone: the skill runs CLI subcommands for every deterministic step and reasons only about the rest. |
| Worktree | The CLI creates it: `factory start 42` makes `.claude/worktrees/42-<slug>` on branch `feat/42-<slug>`; both agents work there. The CLI owns branch naming and cleanup. |
| V1 flow | Issue → **test agent** writes failing tests and commits them (the red commit) → **build agent**, in another context, implements until green → the CI checks run locally → PR. The user reviews and merges. No plan gate and no automated review in V1. |
| Tests vs implementation | Tests are **frozen but visible**: the build agent may read and run them, never edit them. The CLI checks that the build's diff touches no test file and fails if it does. |
| Hollow tests | V1 defends with a **verified red**: at the red commit the CLI runs the new tests and rejects any that already pass; at the green commit all must pass. Traceability per AC, mutation testing and a reviewer agent are V2 candidates. |
| Models | Haiku explores code, Sonnet writes code (test and build agents), Opus does what matters: the orchestrator and the diagnosis of a failed build. |
| `factory/README.md` | Explains the flow **visually** first (diagrams of the stations, the job's states and labels, who runs each step), then the commands. It describes the current version only. |
| Versions | Each version is a git tag (`factory-v1`) plus `factory/versions/v1.md`: the need that motivated it, what it does, what the user learned, and the V2 candidates. `factory/versions/` is an explicit exception to the repo rule that docs hold only the current definition; record that exception in `CLAUDE.md`. |

## Open: settle with the user before designing

1. **What counts as a valid red.** If the module under test doesn't exist yet, the whole test file fails on import, so every test "fails" even if it asserts nothing. Options on the table: (a) the test agent writes stubs with the signatures (throwing "not implemented" or returning an empty value) so the file loads, and the CLI reads a JUnit report to require each new test to fail on an assertion, not on an import or syntax error; (b) any failure counts. The user asked you to **research this** before they decide: the TDD literature on "failing for the right reason" (Beck, Freeman & Pryce), and whether `bun test` and Vitest report assertion failures apart from load errors in their JUnit output. Bring findings with sources and a recommendation.
2. **Retries and diagnosis.** The user asked for a **concrete example** before deciding: walk one job through a build that doesn't reach green (what the agent sees, what the orchestrator does, when the user hears about it). Options on the table: (a) 2 Sonnet attempts, then the Opus orchestrator diagnoses and relaunches once, then the job is blocked and the user is told; (b) the same with a fresh-context Opus subagent diagnosing; (c) 1 attempt, then the user decides.
3. Anything else the design needs that isn't decided above, for example: whether the CLI follows `knowledge/standards/workspace.md` (it lives outside `apps/` and `packages/`), the CLI's subcommands, the PR body (link `Closes #<n>`), how the user learns a job finished or is blocked, how the local checks match CI (`.github/workflows/ci.yml`).

## How to run this session

1. Read `README.md`, `docs/02-mvp-scope.md`, `docs/05-architecture.md`, `knowledge/README.md` and the standards it lists for the paths you'll touch, and `.github/workflows/ci.yml`. Read the Claude Code docs on skills and subagents (code.claude.com/docs/en/skills, /sub-agents, /agents) to confirm the constraints above still hold: background subagents' tool set, the `model` field in agent frontmatter, `${CLAUDE_SKILL_DIR}`, `allowed-tools`.
2. Settle every open item with the user. Done when no question remains.
3. Write `factory/README.md` with the flow diagrams and show it to the user for approval before writing code. Done when the user approves it.
4. Build V1 on a branch with a PR (code reaches `main` only through a PR with passing checks): the issue form, the labels, the CLI with its tests, the skill, the agents, `.gitignore` for `factory/.jobs/`, `factory/versions/v1.md`, the `CLAUDE.md` exception. Done when the CLI's tests pass and the PR's checks are green.
5. Prove it end to end with the user on one small real issue: from `factory:ready` to an open PR. Record what happened in `factory/versions/v1.md`. Tag `factory-v1` after the user merges.
6. Delete this file (`FACTORY_PROMPT.md`) in the same PR: the README and `versions/v1.md` replace it.

## Already found (sources)

- Claude Code: a background subagent loses the Agent tool, so it can't spawn subagents; custom subagents spawned from the main session start in the background; permission prompts from background subagents surface in the main session; `isolation: worktree` creates `.claude/worktrees/<name>` on a `worktree-<name>` branch, which is why the CLI creates the worktree instead. [Subagents](https://code.claude.com/docs/en/sub-agents), [Skills](https://code.claude.com/docs/en/skills), [Run agents in parallel](https://code.claude.com/docs/en/agents).
- TDD with Claude: write tests from expected input/output, say it's TDD so it doesn't write mock implementations, run them and confirm they fail, commit them, then implement without changing them. [Anthropic, Claude Code best practices](https://www.anthropic.com/research/claude-code-best-practices).
- Hollow tests (V2 material): Meta's ACH keeps an LLM-written test only if it kills a mutant ([arXiv:2501.12862](https://arxiv.org/abs/2501.12862)); Google runs mutation testing only on the diff, at code review ([Practical Mutation Testing at Scale](https://arxiv.org/pdf/2102.11378)). StrykerJS supports Vitest officially ([StrykerJS 7](https://stryker-mutator.io/blog/announcing-stryker-js-7/)); `bun test` only through community plugins, and its TypeScript checker reportedly fails on TypeScript 7, which this repo uses.
- Shell vs a structured language: the [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html) advises leaving shell once a script passes ~100 lines or has non-trivial control flow.
- `gh issue list --json number,title,labels --jq …` for intake: [gh issue list](https://cli.github.com/manual/gh_issue_list).
- The earlier factory draft (testing gaps, lanes, Codex as a second opinion) is in git at commit `3fa12a1`, `docs/factory-draft.md`: material for V2 candidates, not for V1.
