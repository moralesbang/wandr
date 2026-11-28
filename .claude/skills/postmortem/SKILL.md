---
name: postmortem
description: Post-mortem of a factory job: where its unexpected friction came from, whether the evidence was enough, an audit of the factory against current practice, and a versioned plan of fixes.
argument-hint: <issue-number>
disable-model-invocation: true
model: opus
effort: high
---

You run the post-mortem of factory job `$ARGUMENTS`, finished or still running. You find its **unexpected friction**, place each piece in the **layer** that caused it, judge whether the evidence was enough to tell, set beside it a blind audit of the factory against current practice, and, once the user has understood that, propose a plan of fixes, each sized as a factory version. You change no factory file: the plan is the output, and it ships later as a version, through its own PR.

Talk with the user in Spanish; write files in English. Run in a session bound to no job: a job's own session is under its guard, which denies this work.

Below, `<n>` is the issue number, `<main>` the main checkout (`git rev-parse --path-format=absolute --git-common-dir`, without its `/.git`), `<state>` the job's state folder `<main>/factory/.jobs/<n>/`, and `<handoff>` the job's folder in its worktree, `<worktree>/factory/.jobs/<n>/` with `worktree` from `<state>/job.json`.

## What you look for

**Friction** is anything that cost the job time, money or the user's attention: a refusal, a retry, a wait, a rerun, a relaunch, a workaround, the user stepping in. It is **expected** when the factory's design intends it, and you can quote the sentence in `factory/README.md` or `factory/docs/` that does: a red rejected because the test passed, a gate rejecting a real failure, a Decision Request on a real ambiguity. Everything else is **unexpected**, and it is what the post-mortem is for.

Each unexpected piece has one **layer**, the place a fix would go:

| Layer | What it is | Its signal |
| --- | --- | --- |
| **Rules** | What the guard and the CLI's policies allow: `bash-policy.ts`, `write-guard.ts`, `read-guard.ts`, `visibility.ts`, `risk.ts`, `routing.ts`, the invariants in `knowledge/standards/factory-invariants.md` | `*.denied`, `freeze.denied`; a refusal that names a rule |
| **Skill** | The orchestrator's instructions, `.claude/skills/factory/SKILL.md` | The orchestrator does what the skill says, and that is the wrong thing, or the skill is silent where it had to choose |
| **Agents** | The agents' instructions, `.claude/agents/factory-*.md`, and their runs | An agent's run, its reads, its reports, its relaunches |
| **Deterministic** | The CLI's commands and checks, the hooks, Docker, the sandboxes | A crash, a wrong plan, a timeout, a `hook-errors.log` line, a step that needed a hand |

In the skill and the agents, tell the **instruction** (the text was wrong, missing or ambiguous) from the **behavior** (the text was clear and the model didn't follow it): the first is fixed in the text, the second by turning the instruction into a rule or a gate the model can't skip. Friction that sits in no layer of the factory, an ambiguous issue or Claude Code itself, is named as such and kept out of the plan.

## 1. Gather the evidence

Read each source and mark it found, missing or gone:

- `<state>/job.json` and `<state>/events.jsonl`: the state and the log, kept after a clean. What each event holds: [`operating.md`](../../../factory/docs/operating.md#watching-a-job).
- `<state>/` besides: `runs/`, `red/`, `install.log`, `sandbox/`, `pr-body.md`, `pr-comment.md` (the cost per agent); and `<main>/factory/.jobs/hook-errors.log`.
- `<handoff>`: the issue, the proposal, the acceptance map, the build notes, `checks/`, `gate.json`, `reviews/`, `rulings/`, `diagnosis.md`, `decision-requests/`. A clean removes it with the worktree.
- The transcripts, the only record of what each model read and thought: `find ~/.claude/projects -name '<session>.jsonl'` with `session` from `job.json`, and beside it `<session>/subagents/agent-<id>.jsonl`, one per agent run.
- GitHub: `gh issue view <n>`, the PR from `job.json`, the branch's commits.
- The factory the job ran under: the latest record in `factory/versions/` merged before `startedAt`, and any `factory.changed` or `factory.accepted` event.

Done when every source is marked, and each one gone or missing is named with what it would have held.

## 2. Launch the blind readings

Launch two agents in one message, each with `run_in_background: true`:

- `postmortem-timing`, the pace verdict, output `<state>/postmortem-timing.md`.
- `postmortem-audit`, the factory against current practice, output `<state>/postmortem-audit.md`.

Each prompt holds only `<n>`, `<state>` and its output path: no finding, timeline or opinion of yours, so each reading stays blind to yours. Go on with step 3 while they run, and read their files only in step 5.

## 3. Find the friction

Build the timeline from `events.jsonl` (`jq` over `t`, `kind`, `agent.id`, `detail`), then walk it. Each candidate goes to the transcripts until its cause is a fact: the command, the refusal's text, the file and line of the rule or instruction behind it. Ask "why" until the answer is a line of the factory a fix would change, or something outside it.

For each piece of friction, write down: what happened (time, event, quoted evidence), what it cost (minutes, dollars, the user's interventions), expected or unexpected (for expected, the doc sentence that intends it), the layer, instruction or behavior where that applies, and the cause.

Done when every denial, every rejection, every relaunch, every retry of the same command, every gap of 5 minutes or more with no event, every line in `hook-errors.log` and every step the user took outside the orchestrator's questions is accounted for: as friction with its cause, or as expected with its sentence.

## 4. Judge the evidence

Every question step 3 asked was **settled** by a record, **inferred** from indirect signs, or **unanswered**. For each one inferred or unanswered, name the **evidence gap**: what was missing (an event kind, a field, a duration, a file a clean removed) and where recording it belongs. Then the verdict: **enough**, **enough with gaps** or **not enough** to place the job's friction in its layers. Each gap is friction of the factory's observability, and it goes to the plan like any other.

## 5. Write the report

Read `<state>/postmortem-timing.md` and `<state>/postmortem-audit.md` once both exist.

- **The pace.** Cross it with your timeline: where the pace verdict and your friction agree, and where they disagree, with the evidence each side rests on.
- **The audit.** Check each citation's domain against the agent's source list in [`postmortem-audit.md`](../../agents/postmortem-audit.md#sources), and drop each change resting on an off-list source. Then cross the rest with your friction: a change that removes the part behind a piece of friction answers both, and a fix of yours that adds a part where the audit says remove one is a disagreement.

Neither reading overrules yours, nor yours them: a disagreement is a question for the user.

Write `<state>/postmortem.md`, in English:

- **Summary**: the job, its outcome, its minutes and cost, the pace verdict, the evidence verdict.
- **Friction**: one entry per piece from step 3, unexpected first, grouped by layer.
- **Pace**: the timing agent's verdict and the cross: agreements and disagreements.
- **Audit**: the auditor's verdict, its changes (removals, edits, additions) and what it keeps, each with its source, any change dropped for an off-list source, and the cross with your friction.
- **Evidence**: the sources and their marks, each question and how it was settled, the gaps.

Done when the file exists and every entry in it cites its evidence.

## 6. Explain it

In Spanish, in plain words, every doc code given its meaning in the same sentence:

1. **The layers, by a hypothetical.** For each layer with unexpected friction in this job, one invented example of a generic job, the smallest that shows how friction in that layer arises and why its fix lives there, labeled as invented.
2. **This job's friction.** Each real piece, in the same order: what happened, what it cost, its layer and its cause, with the evidence in a sentence.
3. **The pace.** The verdict, actual against ideal, and where it agrees or disagrees with your reading.
4. **The audit.** What the factory does well, then each removal, edit and addition: what it changes, what it saves, who says so and when, and where it meets this job's friction.
5. **The evidence.** Its verdict and each gap.

Then ask whether it is clear or what they want to dig into, and end your turn. Answer their questions from the evidence, and go to step 7 only once they confirm they understood.

## 7. The plan

One entry per unexpected piece of friction, per evidence gap and per audit change the user wants to keep:

- **Fix**: the change, the files it touches, and the invariant it adds or repairs (an `FI-` id in `knowledge/standards/factory-invariants.md`, or a new one).
- **Layer**: the lowest one that stops it recurring; a behavior that ignored clear text becomes a rule or a gate.
- **Proof**: the test that fails on this job's case today and passes with the fix; for a removal, the test that still defends the guarantee the removed part held.
- **Bump**: major, minor or patch by [the contract](../../../factory/versions/README.md#what-a-version-number-says), with the reason in one sentence.

Then group the entries into versions: each version takes the bump of its largest change, the next number after the latest record in `factory/versions/`. Present the plan in Spanish, and append it to `<state>/postmortem.md` as **Plan**, revised to what the user approves.

Done when the user has approved the plan or set it aside. Each approved version's **The need** starts from this report's evidence.
