# Quality

How the factory decides a build is done: two kinds of tests with different authors, a red that proves the acceptance tests can fail, gates the agents can't change, and budgets that stop a job instead of letting it loop.

## Two kinds of tests

| | Acceptance tests | Technical tests |
| --- | --- | --- |
| Question | Did we build the right thing? | Did we build it right? |
| Source of truth | The issue's ACs and the public contracts | Technical contracts, invariants and implementation risks |
| Named | `*.acceptance.test.ts(x)`; every test in `apps/web/e2e/` | `*.test.ts(x)` |
| Author | Test agent, before implementation, in the red commit | Build agent, during implementation |
| Who changes them | The test agent: on a test reviewer's same-guarantee ruling, or with the user's authorization when the guarantee changes | The build agent, as long as no existing guarantee weakens |
| Defended by | The verified red, then green at the end | The value check, then the test reviewer |

The name keeps an acceptance test protected after its job, so no later build agent can weaken a guarantee the user approved. Both kinds follow [`knowledge/standards/testing.md`](../../knowledge/standards/testing.md): the value check (T-009) and "guarantees, not test count" (T-010) bind every test.

## Scope profiles

The route's scope specializes the same agents; it doesn't create a second hierarchy or force a frontend task to build a backend. Choose the least expensive test level that proves the guarantee.

| Scope | Context and verification |
| --- | --- |
| Frontend | The design and flow contracts, component states, accessible interactions; browser evidence when the guarantee needs a browser |
| Backend | API contracts, persistence, errors, ownership and privacy; real-service tests under the testing standard |
| Full stack | Both, plus evidence that client and server integrate through the public contract |
| Tooling | The tool's contract, failure modes and regression checks; protected-rule edits still escalate |
| Docs | Consistency with the current definition, links, examples and executable instructions |

On the light workflow the test reviewer checks the actual result against every AC and whether the claim of no behavior change holds; a missing new test is not by itself a defect. Its AC-to-evidence mapping stands in for the test agent's.

## A valid red

`factory red` accepts the red only if each new or changed acceptance test file passes lint and format (the worktree's own `oxlint --deny-warnings` and `oxfmt --check`, as CI runs them), loaded, ran at least one test, and every test fails on an assertion. A file CI would reject is no red to build on: the build agent can't fix it, so it would cost an acceptance-test fix later. One rejection names every problem at once, each with its file and the command that fixes or checks it.

Vitest and Playwright run with the factory's own reporters ([`cli/src/reporters/`](../cli/src/reporters/)), which write one JSON report in a common shape; `bun test` has no custom-reporter API, so the CLI converts its JUnit report. What counts as an assertion failure:

| Runner | Accepted | Rejected besides the common cases |
| --- | --- | --- |
| `bun test` (JUnit, converted) | `type="AssertionError"` | A file missing from the report (a load error) |
| Vitest | An error named `AssertionError` | A load error on the file's module |
| Playwright | A failed step of the `expect` category | A file with no test in the run |

In every runner a thrown error, a timeout, a load error, a skipped test, a passing test and a file with no test reject the red. So scaffolding is stubs with the right signature that return an empty value and never throw, plus empty routes or screens; an end-to-end test asserts an element is visible before acting on it.

## The two loops and their budgets

**Inner loop: one build attempt.** The build agent implements, runs `factory check`, diagnoses and fixes until green or it stops. Before it finishes it reverts every change that had no effect on the result, so it delivers only changes that worked.

**Outer loop: one round.** The reviewers the risk needs report findings, the fixes are made, a review pass checks them. Every finding carries its evidence: the command, its output, `file:line`.

**A review is proportional to what changed and to the risk.** `factory review` plans each pass ([`review-plan.ts`](../cli/src/review-plan.ts)):

- The first pass is a full blind `review` by every reviewer the risk needs.
- A later pass is a `verify` (the previous findings against the new diff, no blind pass) when every non-test file changed since the previous pass's `HEAD` is named, as `path` or `path:line`, in that pass's merged findings and the risk didn't rise; the evaluator verifies a product fix and carries its approval only past a change of tests. Anything else is a full blind `review` again. Job #15's pass 2 changed the one file its first finding cited, plus three tests, and ran two full blind reviews.
- **The CLI's checks are the evidence for the suite.** A reviewer cites the `factory check` log for the gated `HEAD` and runs in its sandbox only targeted commands (one test file, one spec, one mutation); the guard denies a whole-suite run there.
- **A reviewer run has a budget of `sandbox exec` commands**, fixed by its task and the risk (`SANDBOX_BUDGET` in the file above; the plan prints each reviewer's number). The guard counts them per run from the event log and denies the one past it: the reviewer writes its report with the evidence it has and lists what it couldn't check as a finding. A ruling has none. Each command is killed after 5 minutes.
- **Mutation checks** are the test reviewer's, out of the same budget: none at low risk, at most 2 at normal (aimed at the ACs whose assertions look weakest), as many as needed at high.

The budgets block, never extend. Each refusal leads to a Decision Request.

| Budget | Counts | Past it |
| --- | --- | --- |
| 3 rejected reds | Each rejection by `factory red` | `red` refuses a 4th |
| 3 build attempts, shared by both loops | The first build run (after the red, or after the validated plan when light); a rerun after a red `check` or a rejected `gate`; a rerun because a round's fix run didn't reach green. A round's fix run that reaches green costs nothing | `attempt` refuses a 4th |
| 3 rounds with findings | Each `factory round`, acceptance-test fixes included | `round` refuses a 4th |

| Attempt | Who runs it | With |
| --- | --- | --- |
| 1 | Build agent, fresh context | The issue, the routing profile and the red commit when required |
| 2 | Build agent, fresh context | The failing output and attempt 1's notes |
| — | The diagnosis agent | The failing test, the diff, both attempts' notes. A technical cause goes to attempt 3; a functional ambiguity straight to a Decision Request |
| 3 | Build agent, fresh context | The diagnosis |

## The gates

The guard judges each call; `factory check` runs the CI commands; `factory gate` judges the branch before any reviewer sees it; `factory pr` opens the PR only when the gate passed on `HEAD`, every report approves and every blind pass is unchanged since the unseal.

**The CLI's commits survive.** Every commit the CLI made (the red commit, each acceptance-test fix and rewrite) must still be in the branch, as the commit itself or, after a rebase onto `main`, as a commit with the same patch: the CLI records each one's `git patch-id --stable`, and the gate recognizes them by that patch, never by a message trailer, which anyone can write. A branch that lost one is refused with the `git cherry-pick` that restores it.

Every other commit of the job:

- **has no message body.** A build commit is a subject line and trailers only; its reasons go in `build-notes.md`, which the seal protects, while a body would carry them past the seal in `git log`. The gate also expires the reflogs of `HEAD` and the branch, so a body amended away stays unreadable.
- **is not a merge.** A merge's own diff is empty, which would hide its changes from the gate; agents rebase onto `main`.
- **leaves no git note**, since `git log --show-notes` would carry it past the seal.
- **touches no protected path.** The acceptance tests and the rule paths (`RULE_PATHS` in [`cli/src/paths.ts`](../cli/src/paths.ts): CI, lint and format, TypeScript, test runners and the task graph, and `CLAUDE.md`, `knowledge/`, `factory/`, `.claude/`). The test agent may write acceptance tests but no rule path. `package.json` and `vite.config.ts` aren't protected, because dependencies and plugins change legitimately; the evaluator checks them for tampering. Commits already on `main` aren't the job's. A job that needs a protected change escalates with a Decision Request.

**The local checks** are the steps of [`ci.yml`](../../.github/workflows/ci.yml), run with `CI=1` in the worktree, each step's script handed to `bash --noprofile --norc -eo pipefail -c` as one argument, as GitHub Actions runs it, so its newlines and `$VAR`s reach bash untouched. Every job shares one test database, bucket and Playwright port, so a machine-wide lock lets one job run checks (or `red`) at a time. They share one Docker stack too: `docker-compose.yml` names its project `wandr` and holds no host path, so `bun run services` from any worktree reuses the same containers instead of fighting over ports 5432 and 9000.

## Acceptance-test findings

A finding about an acceptance test has one path, and the orchestrator never decides which kind it is:

1. The test agent (task `fix`) changes the test and leaves the change uncommitted.
2. `factory ruling` hashes that diff and names the ruling file.
3. A fresh test reviewer (task `ruling`, never a message to a running one) writes `Verdict: same-guarantee` or `Verdict: changed-guarantee`, the hash unchanged, and its reasoning. In doubt it rules `changed-guarantee`.
4. **same-guarantee**: `factory atfix --ruling` commits the fix if the hash matches the diff and the log shows the reviewer's own run wrote the ruling. The PR lists it.
5. **changed-guarantee**: a Decision Request. Once the user answers, either the answer accepts the fix as ruled (`atfix` without `--ruling`) or the test agent makes the change the answer authorizes (`rewrite`). The PR lists a rewrite apart, under "Authorized guarantee changes".

When acceptance-test fixes are a round's only findings, the round still counts, but no build attempt does.

## Decision Requests

Whenever a job needs the user (an escalation, a spent budget, a changed guarantee), the orchestrator writes a request that stands alone: Context, Evidence, Alternatives, Recommendation, Impact, Risks. `factory block` keeps it in `<job>/decision-requests/`, labels the issue `factory:blocked`, and the orchestrator puts it to the user as a question (below). Nothing is posted on the issue. A request is never raised between `review` and `unseal`.

- **The orchestrator asks, and only the user answers.** After `factory block` it calls `AskUserQuestion` with the request's question, one option per Alternative and its recommendation first; the user can always write their own answer. A `PostToolUse` hook records the reply from the call's result into the job state and the event log, and the orchestrator resumes in the same session with `factory start`. The guard denies a call that carries `answers` or `annotations`, so the model can't answer for the user ([why](isolation.md#the-guard)); `! bun run factory answer <n> "<text>"` from the user's own prompt still works.
- **A blocked job doesn't move.** Every command that moves it refuses, and `start` refuses until the latest request has an answer.
- **One answer authorizes one commit**: a `rewrite`, or an `atfix` when the request was raised on a changed-guarantee ruling. The commit quotes the answer, carries the trailer `Authorized-By: factory answer …`, and uses it up. An answer to any other request authorizes no test change.
