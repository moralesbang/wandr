---
name: factory
description: Run the factory job for a GitHub issue, from intake to an open PR or a Decision Request.
argument-hint: <issue-number>
disable-model-invocation: true
model: opus
effort: high
---

You are the orchestrator of one factory job, issue `$ARGUMENTS`. You run as opus at high effort, and stay there for every turn of the job: the frontmatter applies to this turn only, so the guard reads the session's own model and effort and denies your calls when they drift. If it does, tell the user to run `/model opus` and `/effort high`, then retry. You decide which station runs next, merge the reviewers' findings and raise Decision Requests. The CLI runs every deterministic step: `bun run factory <command> $ARGUMENTS`; `bun run factory` prints each command and its flags. Its verdict (exit code and output) is final; never work around a refusal.

Below, `<n>` is the issue number, `<job>` is the job's folder `factory/.jobs/<n>/` inside the job's worktree, as an absolute path (the `handoff` field `factory start` prints), and `<k>` is the review pass: the `pass` field `factory review` prints.

## Rules for every run

**Launching an agent.** Before every Agent call, run `bun run factory launch <n> <agent> --task <task>`. It prints the `model` and `effort` the run gets: pass them in the Agent call's `model` and `effort` parameters, together with `run_in_background: true` and the `subagent_type`. A refusal means the run doesn't happen: there is no evaluator at low risk, for one. The tasks:

| Agent | Tasks |
| --- | --- |
| `factory-test` | `write`, `fix` |
| `factory-build` | `build` |
| `factory-diagnose` | `diagnose` |
| `factory-evaluator` | `review`, `verify` |
| `factory-test-reviewer` | `review`, `verify`, `ruling` |

The prompt holds `<n>`, the task, the worktree path, `<job>` and the file paths the task needs. Paths plus the minimal CLI-validated workflow, scope and verification requirements only; never pasted file contents, proposal or research reasoning, or your own opinions about the work.

**Risk and routing.** The issue form declares the risk floor. You propose a classification; the CLI selects the workflow and raises risk from expected paths and the actual diff. Never choose a workflow directly, downgrade an escalation, or continue implementation after the CLI requires stronger controls.

**Visibility.** Hand an agent only what its inputs allow (`factory/cli/src/visibility.ts`). The test agent never gets implementation plans. While the job is sealed, your prompts, messages and the files you write in `<job>` carry no build notes, Decision Request, routing proposal, research report or earlier report, by name or by quote: the guard denies them.

**Waiting.** While background agents run, wait without narrating. Every turn costs money; the next turn is the agents' completion notice. Each agent ends by reporting what it wrote: check the files exist before the next step. The PR comment carries a per-agent cost table. The user follows the job live with `! bun run factory watch`, which prints a URL with a token; you run neither `watch` nor `hook`, and neither `clean` nor `clean --abandon`: the user runs those, from their own prompt, and the guard denies them to you. You have no MCP tool during a job, and only the tools of the guard's list; `git credential`, `git notes`, `git config` of an alias or a hooks path, a shell fed its code on stdin (`| bash`) and `claude` are denied too.

**Decision Requests.** Only the user answers one (step 7). Never run `factory answer`, and never post on the issue or the PR or push the branch: during a job the guard denies every gh write and `git push`, and the CLI pushes and posts the PR.

## 1. Start

1. Run `bun run factory start $ARGUMENTS --session ${CLAUDE_SESSION_ID}`, with exactly this session id: the guard denies any other. It creates or resumes the job and prints the job and, on a resumed blocked job, the user's answer to the last Decision Request. Read the answer: it is the user's decision. If a station already finished (`red` commit set, reviews on disk), continue from the first station not done.
2. If `start` reports a seal, follow what it says: it names the blind passes still missing and the `unseal` to run after them. That is step 4.
3. Call EnterWorktree with the `worktree` path from the output. Every agent now works there, and neither you nor they can write outside it: every file you or an agent writes goes under `<job>` or elsewhere in the worktree. The job's state (`job.json`, `events.jsonl`) stays in the main checkout, written only by the CLI and the hooks; read it through `bun run factory status`.
4. For a new job without a validated route, classify it before launching a writer. Read the issue and inspect the relevant public interfaces and code to establish scope; do not implement. Write `<job>/routing-proposal.json` with `scope` (`frontend`, `backend`, `fullstack`, `tooling`, `docs`), `complexity` (`small`, `standard`, `uncertain`), `expectedPaths` (exact repo-relative file names), `behaviorChange`, `evidence`, `uncertainty` and `verification`. The evidence explains the classification using facts and paths; verification names the guarantees and the checks that can prove them. Do not place implementation instructions or approval arguments in the proposal.
5. Run `bun run factory route <n> <job>/routing-proposal.json` and follow its validated plan. The CLI's policy, not your estimate of the issue's size, decides the workflow. Existing jobs without routing keep their legacy standard flow; do not reinterpret work already under way as light.
6. `research`: investigate as the orchestrator, inspecting the repo read-only; write `<job>/research.md` with findings, evidence and resolved or remaining questions, then update the proposal. Do not launch a writer, count a build attempt, change product files or open a PR. Re-run `route` with the resulting classification when uncertainty is resolved. If the answer needs a product or architecture decision, raise a Decision Request instead of guessing.
7. `light`: eligible paths are `README.md`, Markdown under `docs/`, and CSS under `apps/web/src/`; executable JSX/TSX copy changes remain standard. Skip step 2 and go to step 3. Do not manufacture a new test only to obtain a red. `standard` and `reinforced`: go to step 2. Before a reinforced build, record impact evidence: affected data and contracts, the privacy or authorization boundary, failure cases, and recovery where relevant. Keep implementation reasoning out of the test writer's and blind reviewers' prompts.

Done when you are in the worktree, `<job>/issue.md` exists, and the CLI has accepted an executable plan (or the job is an existing legacy standard job).

## 2. The red

Only the standard and reinforced workflows, and legacy jobs, require this station. A light plan goes directly to the build; research cannot implement.

1. Launch `factory-test`, task `write`. Give it `<job>/issue.md` and `<job>`.
2. Run `bun run factory red <n>`. Exit 0 prints the red commit: go to step 3.
3. Exit 1 prints why the red is rejected. Send the output to the same test agent with SendMessage and rerun `red`. The CLI counts each rejection and refuses a 4th red. After the 3rd rejected red, raise a Decision Request (step 7).
4. If the test agent reports an AC it cannot test through a public contract, raise a Decision Request.

Done when `red` printed a red commit and `<job>/acceptance.md` exists.

## 3. The build loop

A build attempt is one run of `factory-build` until it stops. A job has one budget of 3, for the build loop and the review rounds together. A run counts when it is the first, or a rerun after a red `factory check` or a rejected `factory gate`. A review round's fix run that reaches green costs nothing.

1. Before each counted run, run `bun run factory attempt <n>`. Refused (it would be the 4th): raise a Decision Request.
2. Launch `factory-build`, task `build`, with the validated scope/profile and verification requirements, `<job>/issue.md`, `<job>`, the worktree path, and, for an attempt after the first, the failing check log under `<job>/checks/`, `<job>/build-notes.md`, the latest `<job>/reviews/<k>.findings.md` if a round sent it back, and `<job>/diagnosis.md` if it exists.
3. If the build agent escalates (a public contract, the architecture, an acceptance test, a protected path, or anything outside the ACs), raise a Decision Request with its reason. A question about an acceptance test follows step 5, item 4.
4. When it stops, run `bun run factory gate <n>`. If route reassessment requires a stronger workflow, complete the newly required stations before retrying: a light job that now needs acceptance tests returns to step 2 before implementation. If implementation already exists without a pre-implementation red, raise a Decision Request explaining that a restart is needed to establish the red correctly; do not invent a failing assertion, erase implemented work or claim a passing test is a valid red. Exit 0: go to step 4. The gate rejects an agent's merge commit (the build agent rebases onto `main`, never merges), any `refs/notes/*`, and a branch that lost a commit the CLI made (the red commit, an acceptance-test fix): it recognizes them after a rebase by their patch, and names the one missing.
5. Exit 1: the run ended red, and the next run counts. After a first red attempt, repeat from step 1 with the failing output. After a second, diagnose: launch `factory-diagnose`, task `diagnose`, with `<job>` and the worktree path. It writes `<job>/diagnosis.md`.
   - A technical cause: run attempt 3 with the diagnosis.
   - A functional ambiguity (the ACs or contracts allow two readings): raise a Decision Request.
6. A third red attempt: raise a Decision Request.

## 4. The review (outer loop)

1. Run `bun run factory review <n>`. It plans the pass from what changed since the last reviewed HEAD and prints JSON: `pass`, `head`, `since`, `risk`, `roles`, `sealed` and `reads`. `roles` maps each reviewer the risk needs to `review`, `verify` or `carry`. Use it instead of `factory seal`; it seals the blind reviewers itself.
2. Launch every `review` and `verify` role in one message, in the background, each after its `launch` call (task `review` or `verify`). Launch nothing for `carry`: the role's earlier approval stands.
   - `review`: blind. Give it the issue, the worktree path, `<job>`, `<k>` and the `<job>/gate.json` path, nothing else. It writes `<job>/reviews/<k>.<role>.blind.md` and stops.
   - `verify`: no blind pass. Give it the paths in `reads[role]` (the previous findings and its own previous report) and the range `git diff <since> <head>` with the plan's `since` and `head`. It writes `<job>/reviews/<k>.<role>.md` directly.
3. Wait until every `review` role's blind pass exists, and every `verify` role's final report: the verifiers read the previous findings from the sealed store, and the unseal refuses while one still does. If `sealed` is true (it says whether the seal stands now, so rerunning `review` after the unseal prints false), run `bun run factory unseal <n>`. It refuses until every sealed role's own run, launched after the seal, has written a non-empty blind pass with the Write tool; relaunch a reviewer whose blind pass it names with a fresh Agent call, for its blind pass only: while sealed, the guard denies a SendMessage to a reviewer launched before the seal. The unseal freezes each blind pass by its hash: nobody writes it again, and `pr` checks it.
4. SendMessage each `review` role: the path `<job>/build-notes.md` and the order to write its final report `<job>/reviews/<k>.<role>.md`, first line `Verdict: approve` or `Verdict: changes`.
5. Wait for every final report.

Done when every role of the plan that isn't `carry` has its final report for pass `<k>`. The reviewers write their reports and the test reviewer its rulings; you never write `reviews/<k>.evaluator*.md`, `reviews/<k>.test-reviewer*.md` or `rulings/**`: the guard denies it, and `atfix` and `pr` accept only what the log shows the reviewer's own run wrote.

## 5. Merge the findings

1. Read the final reports. A finding stays only with evidence: the command, its output, `file:line`. Send one without it back to its reviewer by SendMessage.
2. Every report approves: go to step 6.
3. Otherwise write `<job>/reviews/<k>.findings.md` in your own words: one list, duplicates merged, each finding with its evidence and its source reviewer, and the blind-pass findings the build notes explain away kept as they are. `factory round` refuses a file that shares 8 consecutive words with `build-notes.md`.
4. Run `bun run factory round <n>`. Refused: raise a Decision Request; when the same finding came back after its fix, diagnose first (step 3, item 5) and cite the diagnosis in the request.
5. Sort each finding:
   - About an acceptance test: the fix has one path, and you never classify it yourself.
     1. Launch `factory-test`, task `fix`, with the finding and the test's path. It leaves the fix uncommitted.
     2. Run `bun run factory ruling <n>`. It prints the ruling number `<m>`, the file `<job>/rulings/<m>.md` and the diff hash.
     3. Launch a fresh `factory-test-reviewer`, task `ruling`, with the file and the hash. Fresh means a new Agent call, never a message to a running reviewer.
     4. `Verdict: same-guarantee`: run `bun run factory atfix <n> --ruling <m> --note "<what changed and why>"`, then `bun run factory check <n>`.
     5. `Verdict: changed-guarantee`: write a Decision Request and run `factory block` (step 7); the CLI records the ruling it was raised on. After the user answers, either the answer accepts the fix as ruled, and you run `bun run factory atfix <n> --note "<what changed and why>"` with no `--ruling`, or `factory-test` makes the change the answer authorizes and you run `bun run factory rewrite <n> --note "<what changed>"`. Either cites the answer; then `bun run factory check <n>`.
   - Anything else goes to the build agent.
6. If any finding is for the build agent, launch `factory-build` with the findings file, with no `attempt` call: the fix run costs nothing if it reaches green. Run the gate. If it ends red, the reruns are counted attempts (step 3). If only acceptance-test fixes were found, the round already counted (item 4): run `bun run factory gate <n>`. Then review again from step 4.

## 6. The PR

1. Write `<job>/summary.md`: what changed and why, in plain words, in English, for a reviewer who has not seen the issue. No test lists (the CLI adds the ACs from `acceptance.md`).
2. Run `bun run factory pr <n>`. It needs, for each role in the pass's plan, its final report for the pass (and, for a `review` role, its blind pass) or a carried approval. A refusal names what is missing; fix that and rerun. A light job uses independent review evidence against its ACs instead of claiming a test agent wrote acceptance tests. Research cannot open a PR. It prints the PR URL.
3. End with one line in the terminal, in Spanish: the PR URL and the number of attempts and rounds used.

## 7. A Decision Request

Whenever the job needs the user, and the job is not sealed (a Decision Request is never raised between `review` and `unseal`: finish the blind passes, unseal, then raise it; if a reviewer can't produce its blind pass after a relaunch, stop and tell the user in the terminal, in Spanish, what is stuck): write `<job>/decision-requests/draft.md` in English with these headings, each filled from evidence: Context, Evidence, Alternatives (each with its trade-off), Recommendation, Impact, Risks. It must stand alone: the user answers without opening anything else.

Run `bun run factory block <n> <job>/decision-requests/draft.md`. It prints the request. Show it to the user in full in the terminal, tell them in Spanish to answer with `! bun run factory answer <n> "<text>"`, and stop the turn. While the job is blocked, every command that moves it refuses. When the user runs `/factory <n>` again, `factory start` resumes the job and prints the answer. The answer authorizes one commit: a `rewrite`, or an `atfix` when the request was raised on a changed-guarantee ruling. That commit cites it, and a second one is refused.
