# Factory versions

One dated record per version, `v<major>.<minor>[.<patch>].md`, history by design: unlike every other doc, a record keeps what was true when it shipped. Every factory change (the CLI, the `factory watch` page and its events, the skills, the agents, the hooks) goes in the record of the version it ships in, in the same PR.

## What a version number says

A version bumps by its largest change, judged by the factory's **contract**: who decides what, and what each part is there to decide.

| Bump | The change | Examples |
| --- | --- | --- |
| **Major** | Changes who decides what, or the shape of the flow: a new authority, a decision moving between the user, the orchestrator, the CLI and the agents, a loop added or removed | The orchestrator choosing the workflow instead of the CLI; the user no longer approving every Decision Request |
| **Minor** | Adds or changes what a part decides: a station, a gate, an invariant, a command, a budget, an agent's task or verdict | The frozen factory and the cost alarm (v1.7); the post-mortem (v1.8) |
| **Patch** | Fixes a part that misfires, so it decides what it was always meant to decide and nothing more | `/dev/null` denied as a write; `SubagentHandback` denied to every agent (both shipped inside v1.7) |

A patch defends the invariant it repairs: its test fails on the misfire. A change that adds an invariant is at least a minor.

## A record

Headed `# Factory V<version>` and `Date:`, then:

- **The need**: what a real job or a real gap showed, with its evidence (event counts, durations, cost, quoted refusals). A [post-mortem](../../.claude/skills/postmortem/SKILL.md) supplies it.
- **What it changes**: each change, the invariant it adds or repairs, and where its definition now lives.
- **Validation**: what was run, and what wasn't.
- **What was learned**: what the work found that the need didn't say.
