---
name: factory
description: Run the factory job for a GitHub issue, from intake to an open PR or a Decision Request.
argument-hint: <issue-number>
disable-model-invocation: true
---

You are the orchestrator of one factory job, issue `$ARGUMENTS`. You decide which station runs next, merge the reviewers' findings, diagnose a second failed build and raise Decision Requests. The CLI runs every deterministic step: `bun run factory <command> $ARGUMENTS`. Its verdict (exit code and output) is final; never work around a refusal.

`factory/README.md` is the spec. Below, `<n>` is the issue number, `<job>` is the job's folder `factory/.jobs/<n>/` inside the job's worktree, as an absolute path (the `handoff` field `factory start` prints), and `<k>` is the review pass: the job's `rounds` + 1 (`bun run factory status` shows rounds).

## Rules for every agent you launch

- Launch each with the Agent tool, `run_in_background: true`, the `subagent_type` below.
- The prompt holds the issue number, the worktree path, `<job>` and the file paths its task needs. Paths only, never pasted contents, never your own reasoning or opinions about the work.
- Hand an agent only what its inputs allow (`factory/cli/src/visibility.ts`). The test agent never gets implementation plans; reviewers never get `build-notes.md` before their blind pass.
- Each agent ends by reporting what it wrote. Check the files exist before the next step.

## 1. Start

1. Run `bun run factory start $ARGUMENTS --session ${CLAUDE_SESSION_ID}`. It creates or resumes the job and prints the job and, on a resumed blocked job, the user's answers to the last Decision Request. Read the answers: they are the user's decision. If a station already finished (`red` commit set, reviews on disk), continue from the first station not done.
2. Call EnterWorktree with the `worktree` path from the output. Every agent now works there, and neither you nor they can write outside it: every file you or an agent writes goes under `<job>` or elsewhere in the worktree. The job's state (`job.json`, `events.jsonl`) stays in the main checkout, written only by the CLI and the hooks; read it through `bun run factory status`.
3. Done when you are in the worktree and `<job>/issue.md` exists.

## 2. The red

1. Launch `factory-test`. Give it `<job>/issue.md` and `<job>`.
2. Run `bun run factory red <n>`. Exit 0 prints the red commit: go to step 3.
3. Exit 1 prints why the red is rejected. Send the output to the same test agent with SendMessage and rerun `red`. The CLI counts each rejection and refuses a 4th red. After the 3rd rejected red, write a Decision Request and run `factory block` (step 7).
4. If the test agent reports an AC it cannot test through a public contract, raise a Decision Request.

Done when `red` printed a red commit and `<job>/acceptance.md` exists.

## 3. The build loop

A build attempt is one run of `factory-build` until it stops. A job has one budget of 3, for the build loop and the review rounds together. A run counts when it is the first, or a rerun after a red `factory check` or a rejected `factory gate`. A review round's fix run that reaches green costs nothing.

1. Before each counted run, run `bun run factory attempt <n>`. Refused (it would be the 4th): raise a Decision Request.
2. Launch `factory-build` with `<job>/issue.md`, `<job>`, the worktree path, and, for an attempt after the first, the failing check log under `<job>/checks/`, `<job>/build-notes.md`, the latest `<job>/reviews/<k>.findings.md` if a round sent it back, and `<job>/diagnosis.md` if it exists.
3. If the build agent escalates (a public contract, the architecture, an acceptance test, a protected path, or anything outside the ACs), raise a Decision Request with its reason.
4. When it stops, run `bun run factory gate <n>`. Exit 0: go to step 4.
5. Exit 1: the run ended red, and the next run counts. After a first red attempt, repeat from step 1 with the failing output. After a second, diagnose:
   - Read the failing test, the diff (`git diff <base>...HEAD`) and both attempts' notes. Write `<job>/diagnosis.md`: cause, evidence (command, output, `file:line`), the fix to try.
   - A technical cause: run attempt 3 with the diagnosis.
   - A functional ambiguity (the ACs or contracts allow two readings): raise a Decision Request.
6. A third red attempt: raise a Decision Request.

## 4. The review (outer loop)

1. Launch `factory-evaluator` and `factory-test-reviewer` in the same message, both in the background. Each gets the issue, the worktree path, `<job>`, `<k>` and the `<job>/gate.json` path. The test reviewer also gets the gate's removed, skipped and focused tests via that file.
2. Each writes `<job>/reviews/<k>.<role>.blind.md` and stops. Wait for both. Check both files exist.
3. SendMessage each reviewer: the path `<job>/build-notes.md` and the order to write its final report `<job>/reviews/<k>.<role>.md`, first line `Verdict: approve` or `Verdict: changes`.
4. Wait for both final reports.

Done when both final reports exist for pass `<k>`.

## 5. Merge the findings

1. Read both final reports. A finding stays only with evidence: the command, its output, `file:line`. Send one without it back to its reviewer by SendMessage.
2. Both `Verdict: approve`: go to step 6.
3. Otherwise write `<job>/reviews/<k>.findings.md`: one list, duplicates merged, each finding with its evidence and its source reviewer, and the blind-pass findings the build notes explain away kept as they are.
4. Run `bun run factory round <n>`. Refused: raise a Decision Request.
5. Sort each finding:
   - About an acceptance test, same guarantee (a wrong selector, a typo): launch `factory-test` with the finding and the test's path, then run `bun run factory atfix <n> --note "<what changed and why the guarantee is the same>"`. Then rerun the checks: `bun run factory check <n>`. A round whose only findings are such fixes still counts as a round (item 4 ran `round`), and costs no build attempt.
   - About an acceptance test, a different guarantee: raise a Decision Request. After the user authorizes it on the issue, `factory-test` rewrites the test and you run `bun run factory rewrite <n> --note "<the URL of the user's authorizing comment>"`, not `atfix`. Then rerun the checks.
   - Anything else: it goes to the build agent.
6. If any finding is for the build agent, launch `factory-build` with the findings file, with no `attempt` call: the fix run costs nothing if it reaches green. Run the gate. If it ends red, the reruns are counted attempts (step 3). Then review again. If only acceptance-test fixes were found, they still count as the round (item 4 ran `round`): run `bun run factory gate <n>` and go to step 4.

## 6. The PR

1. Write `<job>/summary.md`: what changed and why, in plain words, in English, for a reviewer who has not seen the issue. No test lists (the CLI adds the ACs from `acceptance.md`).
2. Run `bun run factory pr <n>`. It prints the PR URL. A refusal names what is missing; fix that and rerun.
3. End with one line in the terminal: the PR URL and the number of attempts and rounds used.

## 7. A Decision Request

Whenever the job needs the user: write `<job>/decision-requests/draft.md` with these headings, each filled from evidence: Context, Evidence, Alternatives (each with its trade-off), Recommendation, Impact, Risks. It must stand alone: the user answers without opening anything else. Write it in English.

Run `bun run factory block <n> <job>/decision-requests/draft.md`, tell the user in one line in Spanish that job `<n>` is blocked and what is asked, and stop. The user answers on the issue and runs `/factory <n>` again.
