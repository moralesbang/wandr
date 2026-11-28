# Factory invariants

## Purpose

The factory's acceptance criteria. Each invariant is a guarantee the factory gives whatever the agents do: the mechanism that enforces it, and the tests that defend it. A change to the factory is judged against this list, and a factory test earns its place by the invariant it defends. How the factory works and why: [`factory/README.md`](../../factory/README.md).

## Scope

Applies to `factory/**`, `.claude/agents/**`, `.claude/skills/factory/**` and `.claude/settings.json`, and to every test under `factory/cli/`.

**MUST**, **MUST NOT**, **SHOULD** and **MAY** follow RFC 2119. Paths below are relative to `factory/cli/src/` unless they start at the repo root.

## Tests

### FT-001 — An invariant's test is an acceptance test

A factory test that defends an invariant MUST be named `*.acceptance.test.ts`, so the gate's protection of acceptance tests covers it, and MUST name the invariant's id in its `describe` (`describe('FI-004: …')`). Every other factory test is technical and MUST carry a T-009 value record ([`testing.md`](testing.md)): the defect it would catch, and why no acceptance test already catches it.

### FT-002 — Every invariant stays defended

Every invariant below MUST be defended by at least one acceptance test, except one marked *not enforced yet*. A change that removes an invariant's last test, or adds an invariant, changes this file in the same pull request.

## Authority

### FI-001 — Only the user decides

Only the user starts a job (`factory:ready`), answers a Decision Request, merges, or accepts a changed factory under a job: the guard denies `answer`, `watch` and `refreeze` to every tool call, and a command the user types with `!` fires no hook. The model never writes the user's reply (FI-028).

- **Mechanism:** `bash-policy.ts` (`answerDenied`, the user's commands), `commands/start.ts` (the label), `commands/answer.ts`, `commands/refreeze.ts`.
- **Defended by:** `bash-policy.test.ts`, `commands/hook-launchers.test.ts`, `commands/answer.test.ts`, `commands/start.test.ts`, `commands/freeze.acceptance.test.ts` (`refreeze`).

### FI-028 — The user's reply is the user's, whatever the channel

A Decision Request's answer, and the yes that lets a job be cleaned or abandoned, reach the job state only as the user's own reply to the orchestrator's `AskUserQuestion`, recorded by the `PostToolUse` hook from `tool_response`, or from the user's own prompt (`! bun run factory answer`). The guard denies an `AskUserQuestion` call that carries `answers` or `annotations`; every agent but the orchestrator has no such tool. A `factory clean` runs only against a yes to the question `factory confirm` worded, one clean per yes. One answer authorizes one commit, as before (FI-007).

- **Mechanism:** `commands/hook-answer.ts` (`repliesOf`, `hookAnswer`), `commands/answer.ts`, `commands/confirm.ts`, `commands/hook.ts` (`askPolicy`, `confirmation.used`), `bash-policy.ts` (`cleanVerdict`, `answerDenied`), `.claude/settings.json` (the hook).
- **Defended by:** `commands/answer-channel.acceptance.test.ts`.

### FI-002 — Only the CLI writes to GitHub

During a job no tool call pushes, posts, labels or reads the user's credentials; the CLI does all of it. No agent runs `gh` at all.

- **Mechanism:** `bash-policy.ts` (gh writes, HTTP to GitHub, `git push`, `git credential`).
- **Defended by:** `bash-policy.test.ts` ("GitHub, during a job"), `commands/hook-git.test.ts`, `commands/hook-launchers.test.ts`.

### FI-003 — Each actor runs only its own factory commands

The orchestrator moves the job; a build, test or diagnosis agent runs only `check` and `status`; a reviewer only `status` and the sandbox of its own role, in its own job. No tool call runs `factory hook`, which would forge events, or rebinds the job to another session.

- **Mechanism:** `bash-policy.ts` (`factoryVerdict`, `hookDenied`, the session check).
- **Defended by:** `bash-policy.test.ts`, `commands/hook-seal.test.ts` ("gh and the seal commands"), `commands/hook-launchers.test.ts`, `commands/hook-dashdash.test.ts`.

### FI-004 — A blocked job doesn't move

While a Decision Request has no answer, every command that moves the job refuses, `start` included.

- **Mechanism:** `job.ts` (`unlessBlocked`), `commands/common.ts` (`refuseWhileBlocked`), `commands/start.ts`.
- **Defended by:** `commands/blocked.test.ts`, `commands/start.test.ts`.

### FI-023 — A job is judged against what the user wrote

A job starts only on an open issue whose ACs are numbered AC1, AC2… in order and whose Risk field is `low`, `normal` or `high`: the ACs are what the acceptance tests and the reviewers check, and the Risk is the floor no route lowers.

- **Mechanism:** `commands/start.ts`, `issue.ts` (`parseCriteria`, `parseRisk`).
- **Defended by:** `issue.test.ts`, `commands/start.test.ts`.

## Tests as judges

### FI-005 — An agent can't change what judges it

No build agent writes an acceptance test or a rule path (`RULE_PATHS`); no test agent writes a rule path; no agent commits a change to one past the gate.

- **Mechanism:** `visibility.ts` (`classifyWrite`), `paths.ts`, `bash-policy.ts` (protected writes in Bash), `commands/gate.ts` (protected paths), `commands/red.ts` (a red with a rule change).
- **Defended by:** `visibility.test.ts`, `commands/hook-protected.test.ts`, `bash-policy.test.ts`, `paths.test.ts`, `commands/gate.test.ts`.

### FI-006 — Acceptance tests are red before implementation

On a workflow that requires them, the build starts only after a red commit in which every new or changed acceptance test passes lint and format, ran, and failed on an assertion.

- **Mechanism:** `commands/red.ts`, `junit.ts`, `report.ts`, `reporters/`, `launch.ts` (no build before the red), `commands/gate.ts` (no gate without the red).
- **Defended by:** `commands/red.test.ts`, `junit.test.ts`, `report.test.ts`, `launch.test.ts`, `commands/gate.test.ts`.

### FI-007 — An acceptance guarantee changes only with the user's answer

An acceptance-test fix is committed only on a same-guarantee ruling a fresh test reviewer's own run wrote on the same diff hash, or on the user's answer to a Decision Request. One answer authorizes one commit, and the commit holds acceptance tests only. The CLI commits the test agent's work; the test agent and the reviewers commit nothing.

- **Mechanism:** `commands/ruling.ts`, `commands/lifecycle.ts` (`atfix`, `rewrite`), `commands/answer.ts`, `bash-policy.ts` (who commits).
- **Defended by:** `commands/ruling.test.ts`, `commands/lifecycle.test.ts`, `commands/blocked.test.ts`.

## Isolation

### FI-008 — A blind pass is blind, and final

A reviewer's blind pass is written before the build notes, Decision Requests, diagnosis, summary, routing proposal, research or earlier reports are visible to it, and can't change once they are. While sealed, those files are out of the worktree and the job's other commands refuse.

- **Mechanism:** `seal.ts`, `commands/review.ts`, `read-guard.ts`, `write-guard.ts` (the frozen pass), `commands/pr.ts` (the hashes), `visibility.ts` (the moments).
- **Defended by:** `seal.test.ts`, `commands/hook-seal.test.ts`, `commands/hook-forge.test.ts`, `commands/hook-protected.test.ts`, `commands/pr-plan.test.ts`, `commands/review.test.ts`, `commands/hook-verify.test.ts`, `visibility.test.ts`.

### FI-009 — A reviewer's verdict is its own run's

A blind pass, final report or ruling counts only if the event log shows that reviewer's own run wrote it with the Write tool, after the seal or the ruling it answers. The orchestrator never writes one, and a run launched before the seal is never messaged while sealed.

- **Mechanism:** `seal.ts` (`blindPassProblem`), `commands/pr.ts`, `commands/ruling.ts`, `write-guard.ts`, `read-guard.ts` (messages while sealed), `bash-policy.ts` (a blind pass written from Bash).
- **Defended by:** `seal.test.ts`, `commands/ruling.test.ts`, `commands/pr-plan.test.ts`, `commands/hook-forge.test.ts`.

### FI-010 — The build's reasoning reaches reviewers only through the notes

No build commit has a message body, is a merge or leaves a git note; the reflogs are expired; while sealed, the orchestrator's prompts and writes quote no sealed material; merged findings share no 8-word phrase with the build notes.

- **Mechanism:** `commands/gate.ts`, `read-guard.ts` and `write-guard.ts` (sealed text), `bash-policy.ts` (sealed text, `git notes`), `phrases.ts`, `commands/lifecycle.ts` (`round`).
- **Defended by:** `commands/gate.test.ts`, `commands/hook-forge.test.ts`, `commands/hook-seal.test.ts`, `commands/round.test.ts`.

### FI-011 — The two reviewers judge independently

Each reviewer runs servers, builds and tests only in its own sandbox, with its own port, database and bucket; it never reads the other's sandbox or its blind pass before writing its own, and never moves the shared repository.

- **Mechanism:** `sandbox.ts`, `read-guard.ts`, `bash-policy.ts` (the reviewer's allowlist, the services check, git outside the sandbox).
- **Defended by:** `sandbox.test.ts`, `commands/hook-sandbox.test.ts`, `commands/hook-walks.test.ts`, `commands/hook-isolation.test.ts`, `commands/hook-reviewer-runs.test.ts`, `commands/hook-search.test.ts`, `commands/hook-git.test.ts`, `visibility.test.ts`.

### FI-012 — Agents stay in the job's worktree

No agent reads or writes the main checkout, the job's state, Claude Code's own files or `/proc`; every path is judged where it leads, symlinks resolved.

- **Mechanism:** `read-guard.ts`, `write-guard.ts`, `visibility.ts`, `paths.ts` (`canonical`).
- **Defended by:** `visibility.test.ts`, `commands/hook.test.ts`, `bash-policy.test.ts`.

### FI-013 — The guard fails closed inside a job

Inside a job, a call the guard can't judge is denied: an error, a tool with no policy (every MCP tool; an agent's `SubagentHandback`, which carries only its report, is the one allowed), a command whose program or factory subcommand it can't read from the text (`env -S`, a `$VAR`, a shell fed its code on stdin, `bun -e` loading the CLI), a git setting that would run a command later, a `claude` session, and a job whose state no longer parses.

- **Mechanism:** `commands/hook.ts`, `bash-policy.ts`.
- **Defended by:** `commands/hook.test.ts`, `commands/hook-shells.test.ts`, `commands/hook-launchers.test.ts`, `commands/hook-operands.test.ts`, `commands/hook-isolation.test.ts`, `commands/hook-handback.test.ts`.

## Gates

### FI-014 — The CLI's commits survive a rebase

The gate refuses a branch that lost a commit the CLI made, recognized by its recorded patch id, never by its message; the guard denies the agents' resets, `rebase --onto` and amends that would drop one.

- **Mechanism:** `commands/gate.ts` (`lostCliCommits`), `bash-policy.ts`.
- **Defended by:** `commands/gate.test.ts`, `commands/hook-git.test.ts`.

### FI-015 — The PR opens only on a green, reviewed HEAD

`factory pr` opens the PR only when the gate passed on `HEAD` (the last checks green on its tree, a clean tree), the review pass was planned on that `HEAD` and the current route, every role of the plan approves or carries an approval, and every blind pass is unchanged since the unseal.

- **Mechanism:** `commands/pr.ts`, `commands/gate.ts`, `commands/review.ts`, `review-plan.ts`.
- **Defended by:** `commands/pr-plan.test.ts`, `pr.test.ts`, `commands/gate.test.ts`, `commands/review.test.ts`, `review-plan.test.ts`.

### FI-016 — The local checks are CI's

`factory check` runs the steps of `ci.yml` as GitHub Actions runs them, under a machine-wide lock, so a green check means what a green CI means.

- **Mechanism:** `checks.ts`, `commands/check.ts`.
- **Defended by:** `checks.test.ts`, `playwright-config.test.ts`.

### FI-017 — Budgets block, never extend

A job gets 3 rejected reds, 3 build attempts and 3 rounds with findings; the next one refuses and the job goes to the user.

- **Mechanism:** `job.ts` (`MAX_RED_REJECTIONS`, `MAX_BUILD_ATTEMPTS`, `MAX_ROUNDS`), `commands/lifecycle.ts`, `commands/red.ts`.
- **Defended by:** `job.test.ts`, `commands/round.test.ts`, `commands/red.test.ts`.

### FI-018 — Routing never lowers a control

The declared risk is a floor; the diff only escalates the plan; a confirmed route, or one under execution, can't be replaced; light work needs low risk and only light-eligible paths; until a route is executable the repo is read-only; the stations a route requires can't be skipped (no test writer or red on light, no build before a required red, no review on a stale route).

- **Mechanism:** `routing.ts`, `risk.ts`, `commands/route.ts`, `launch.ts`, `commands/review.ts`, `commands/pr.ts`, `write-guard.ts`, `read-guard.ts`, `bash-policy.ts` (read-only before routing).
- **Defended by:** `routing.test.ts`, `risk.test.ts`, `commands/route.test.ts`, `commands/hook-routing.test.ts`, `launch.test.ts`, `commands/review.test.ts`, `commands/pr-plan.test.ts`, `commands/gate.test.ts`.

### FI-019 — The CLI fixes each run's model and effort

An agent runs only with the model and effort `LAUNCH_TABLE` gives its task at the job's risk; a run the table doesn't hold (an evaluator at low risk) doesn't happen. The orchestrator runs `ORCHESTRATOR` (Opus at high effort). The guard enforces both: it denies the orchestrator's calls while the main session's latest assistant message ran another model or effort, and an Agent call for a factory agent that doesn't carry its plan. A plan is `factory launch`'s `launch.planned` event, named by an id; the call's prompt starts with the `header` line `factory launch` printed, and the call's agent, task, model and effort must be the plan's. One plan authorizes one launch.

- **Mechanism:** `launch.ts` (`LAUNCH_TABLE`, `ORCHESTRATOR`, `LAUNCH_HEADER`), `orchestrator-guard.ts` (`orchestratorSetting`, `launchPolicy`), `commands/hook.ts` (`launch.authorized`).
- **Defended by:** `commands/hook-orchestrator.acceptance.test.ts`, `launch.test.ts`, `agent-frontmatter.test.ts`.

### FI-024 — A factory agent launches only Explore, on Haiku

Every subagent of a job may launch one kind of subagent: `Explore`, with `model: haiku`. Any other type (`general-purpose`, another factory agent) and any other Explore model, or none, is denied: an agent's `tools: Agent(Explore)` allowlist doesn't constrain it, and an unpinned launch takes whatever model its type defaults to.

- **Mechanism:** `orchestrator-guard.ts` (`launchPolicy`), `commands/hook.ts`.
- **Defended by:** `commands/hook-orchestrator.acceptance.test.ts`.

### FI-029 — Docker is up before a job starts or its checks run

`factory start` and `factory check` begin with `docker info`. On a Mac with Docker Desktop installed they open it and wait up to about 90 seconds; elsewhere, and in CI, they only check. Either way a Docker that isn't there refuses with what to do.

- **Mechanism:** `docker.ts` (`ensureDocker`), `commands/start.ts`, `commands/check.ts`.
- **Defended by:** `docker.acceptance.test.ts`, `commands/start.test.ts`.

### FI-030 — A pass after a fix reviews the fix

A review pass after the first is a `verify` when every non-test file changed since the previous pass is named in that pass's merged findings and the risk didn't rise; anything else is a full blind review. A change of tests alone keeps its rules (the evaluator's approval carries).

- **Mechanism:** `review-plan.ts` (`planRoles`), `commands/review.ts`.
- **Defended by:** `commands/review-budget.acceptance.test.ts`, `review-plan.test.ts`, `commands/review.test.ts`.

### FI-031 — A reviewer run spends a bounded number of sandbox commands

Each reviewer run has a budget of `factory sandbox exec` commands fixed by its task and the risk (`SANDBOX_BUDGET`); the guard counts them per run from the event log and denies the one past it, and denies a whole-suite run inside the sandbox. Each command is killed after 5 minutes.

- **Mechanism:** `review-plan.ts` (`SANDBOX_BUDGET`, `sandboxBudget`), `bash-policy.ts` (`factoryVerdict`, `wholeSuite`), `commands/hook.ts` (`sandbox.exec`), `sandbox.ts` (`runInSandbox`).
- **Defended by:** `commands/review-budget.acceptance.test.ts`, `commands/hook-sandbox.test.ts`.

### FI-025 — Inside a job the orchestrator launches only the factory's agents and Explore

While a job's session is bound to it (from `factory start --session` until its folder is cleaned, in any state, `pr_open` included), the orchestrator's Agent calls are the factory's agents, each with its plan (FI-019), and `Explore` on Haiku. Any other type, `general-purpose` included, is denied, so unrelated work can't ride on a job's session.

- **Mechanism:** `orchestrator-guard.ts` (`launchPolicy`), `commands/hook.ts`, `job.ts` (`locateSession`).
- **Defended by:** `commands/hook-orchestrator.acceptance.test.ts`.

## Record

### FI-020 — The event log is the CLI's and the hooks'

A job's state and event log are written only by the CLI and Claude Code's hooks, in the main checkout, out of every agent's reach.

- **Mechanism:** `write-guard.ts`, `bash-policy.ts` (`stateDenied`, `hookDenied`), `read-guard.ts`.
- **Defended by:** `bash-policy.test.ts` ("the job's state"), `commands/hook.test.ts`.

### FI-021 — What an agent sees is shown to the user

`factory watch` marks every read outside an agent's inputs, or before they became visible, and every denial, against `visibility.ts`; only the holder of the token it printed sees the page.

- **Mechanism:** `annotate.ts`, `watch/state.ts`, `watch/server.ts`.
- **Defended by:** `annotate.test.ts`, `watch/state.test.ts`, `watch/panels.test.ts`, `watch/server.test.ts`.

### FI-026 — The factory is frozen in the main checkout while a job is active

While any job is `building` or `blocked`, no Claude Code session of the repo, bound to a job or not, writes the files that define how a job runs (`FACTORY_FILES`: the CLI, the skill, the factory agents, `.claude/settings.json`, the root `package.json` and `bun.lock`) in the main checkout or moves that checkout's HEAD or working tree. Work in another worktree is free, and a session bound to no job gets no other verdict and never fails closed.

- **Mechanism:** `freeze.ts` (`freezeVerdict`), `paths.ts` (`FACTORY_FILES`), `commands/hook.ts` (`hookGuard`), `job.ts` (`mainRoot`: the main checkout from any worktree).
- **Defended by:** `commands/freeze.acceptance.test.ts`, `job.test.ts` (`mainRoot`).

### FI-027 — A job is judged by the factory it started with

`factory start` records a hash of each of those files, uncommitted changes included. While the job is active every CLI command on it and every guard verdict of its session compares the current files with the record and refuses on a mismatch, naming the files. A job resumed with no record gets one. Only the user accepts the new files (`refreeze`).

- **Mechanism:** `freeze.ts` (`factoryFingerprint`, `fingerprintVerdict`), `commands/common.ts` (`requireUnchangedFactory`), `main.ts`, `commands/start.ts`, `commands/hook.ts`.
- **Defended by:** `commands/freeze.acceptance.test.ts`.

### FI-022 — The factory under change never judges itself

A job that changes the factory is judged by the main checkout's CLI, hooks and agents, never by the copy it edits. *Not enforced yet: the factory lane adds it.*

- **Mechanism:** none yet.
- **Defended by:** none yet.

## Unmapped

Refusals that defend no invariant above. Each is kept for now; the user judges whether it is an invariant, an operational limit or a candidate to remove.

| Refusal | Where | Kind |
| --- | --- | --- |
| A command without its arguments (an issue number, `--session`, the proposal or Decision Request file, `--ruling`, `--pass`, the answer's text, a sandbox role) | `main.ts`, `commands/sandbox.ts`, `sandbox-names.ts`, `commands/answer.ts` | Usage |
| No job for the issue; `answer` when no request is open | `commands/common.ts`, `commands/answer.ts` | Usage |
| `atfix` or `rewrite` without `--note`; nothing changed | `commands/lifecycle.ts` | Record |
| 3 jobs already building | `job.ts` (`canStartAnother`) | Operational: shared test database, bucket and port |
| `start` on a job whose PR is open or whose worktree is gone | `commands/start.ts` | Operational |
| `pr` without `summary.md` or `acceptance.md`; a light job's report without one evidence line per AC | `commands/pr.ts` | Record |
| `seal` while sealed, for a pass not under way, or for a role that isn't a reviewer; `unseal` when not sealed, onto a file written while sealed, or with unrecorded files in the store | `seal.ts` | Consistency of the seal's own state |
| `clean` of an unmerged PR; `clean --abandon` with an open or merged PR (also when `job.json` can't be read, from the branch it can find) | `commands/lifecycle.ts` | Protects work the user hasn't closed |
| `confirm` without `clean` or `abandon`; a stale `watch.json` | `main.ts`, `watch/background.ts` | Usage |
| `bun install` or a sandbox migration failed; no `.env.test` to reach a sandbox's services | `commands/start.ts`, `sandbox.ts` | Environment |
