# Deep Execution (v1.4.0)

Reference for `commands/implement.md`'s default behavior — Deep Mode, the 15-stage lifecycle,
persistent execution state, resume, failure recovery, and the token/quality philosophy behind all
of it. Kept out of the always-loaded command prompt for the same reason as `docs/project-boundary.md`
and `docs/obsidian-memory.md`: the operational instructions live in `commands/implement.md`, the
full reasoning and edge cases live here.

## What "Deep Mode" actually changes

Nothing structural — it's a naming and a stance, not a separate code path. Every `/implement` run
before v1.4.0 already did research → plan → implement → test → review, looping on failure. What v1.4
adds is: (1) explicit numbered stages so both the user and a resumed session can see exactly where
execution is, (2) a persistent `.devagent/` record of that progress inside the target project, (3) a
resume mechanism that can pick a session back up after an interruption, and (4) formalized Security/
Performance verdicts inside the existing reviewer stage. There is no "fast mode" alternative — see
Why no fast mode below.

## Why no fast mode

The task that motivated this version is explicit: dev-agent should optimize for correctness,
completeness, and a genuinely verified Definition of Done, not for finishing in the fewest tool
calls. Introducing a "fast" path would mean deciding, per task, which of those guarantees to drop —
that's a worse design than just always running the real lifecycle and letting Stage selection (in
`commands/implement.md`) skip what genuinely doesn't apply to a given task. A bug fix already skips
architect/UX/frontend/visual-qa when they don't apply; that skipping *is* the "fast" behavior for a
small task, arrived at through the same stage-selection logic every task uses, not through a
separate mode with different rules.

## Token / quality philosophy

Spend tokens and tool calls to reduce uncertainty, not to look busy. Concretely:

- Ambiguous scope, unclear requirement, unfamiliar codebase area → investigate before deciding, don't
  guess and hope the reviewer catches it later.
- Uncertain whether a fix actually works → verify it (run the test, read the actual output), don't
  infer success from the diff looking plausible.
- A failure occurs → root-cause it (trace the actual call path, read the actual error) before
  retrying blindly. A second attempt built on the same wrong assumption as the first wastes more
  tokens than the investigation would have.
- Something appears to work → still check it against the actual requirement and the Definition of
  Done categories that apply, rather than treating "it ran without erroring" as equivalent to "it's
  correct."
- Multiple reasonable implementation approaches exist → compare them (even briefly) before picking
  one, rather than defaulting to the first idea that occurred to you.

This is not a license for unbounded exploration with no new information gained — a second `Read` of
a file you already read in full, or a second identical test run with no code change in between, adds
tokens without reducing uncertainty. The test is always "does this specific additional step make the
result more likely to be correct," not "would doing more look more thorough."

## The 15-stage lifecycle

See `commands/implement.md` → Execution stages for the numbered table and exactly what triggers each
stage. Stages 10 (Security) and 11 (Performance) are not separate subagent calls — `agents/
reviewer.md`'s single pass produces a distinct `Security Verdict` and `Performance Verdict`
(`PASS`/`FAIL`/`NOT APPLICABLE`, with evidence) alongside its overall `APPROVED`/`CHANGES REQUIRED`
verdict. This was a deliberate choice over adding `security-reviewer`/`performance-reviewer`
subagents: the task explicitly says not to add agents unless required, the reviewer already reads
the full diff and has full context to judge both, and splitting them into separate Task calls would
mean re-reading the same diff twice for no additional rigor — the checklist in `agents/reviewer.md`
already treats them as first-class categories, just within one call.

## Persistent execution state

`.devagent/` lives inside the **verified target project root** (see `docs/project-boundary.md`),
never in a global or plugin directory — execution state describing project X belongs with project
X, the same reasoning that keeps Obsidian's vault separate from this. It is created by
`commands/implement.md` step 0 (via the ordinary `Write` tool, so it's subject to the exact same
`hooks/project-boundary-guard.cjs` boundary check as any other file dev-agent touches — no special
casing, no exemption).

```
.devagent/
├── state.json     # small, machine-checkable: stage, completed/skipped stages, status
├── plan.md        # the approved plan this execution is working from
├── progress.md    # append-only human-readable log, one entry per stage transition
├── decisions.md   # engineering decisions made during THIS execution, and why
└── failures.md    # meaningful failures: stage, problem, evidence, root cause, fix, verification
```

### `state.json` schema

Deliberately small — `progress.md` carries the narrative detail; `state.json` only needs enough to
know *where* execution is and whether the recorded state is even worth trusting:

```json
{
  "version": 1,
  "targetRoot": "D:\\dev-agent-tests\\my-app",
  "gitRoot": "D:\\dev-agent-tests\\my-app",
  "task": "Add pagination to the users table",
  "stage": "implementation",
  "completedStages": ["target-verification", "understand", "discovery"],
  "skippedStages": ["history", "architecture", "ux"],
  "status": "in_progress",
  "iteration": 1,
  "lastUpdated": "2026-08-15T08:12:00+05:45"
}
```

- `stage` values are the kebab-case stage names from the Execution stages table (`target-verification`,
  `understand`, `discovery`, `history`, `architecture`, `ux`, `research`, `implementation`, `testing`,
  `visual-qa`, `review` — covering stages 10-12 together, since they're one Task call — `definition-of-done`,
  `wrap-up`).
- `completedStages` vs `skippedStages` is the field that makes resume actually safe: without it, a
  resumed session can't tell "UX hasn't been reached yet" from "UX was deliberately skipped because
  this is a backend-only task" — both would otherwise look identical (absent from a single
  `completedStages` list). This is the one deliberate departure from a minimal "just track current
  stage" schema, and it exists because that distinction is load-bearing for Resume step 6 below.
- `iteration` counts retries within the *current* stage (e.g. how many tester fix-cycles have
  happened) — reset to 0 on entering a new stage, not a running total across the whole execution.
  It exists to support the "stop iterating blindly, re-enter architecture" rule (see Iteration in
  `commands/implement.md`), not to enforce a hard cap.
- `status` is one of `in_progress`, `blocked`, or `complete`. Never left at `in_progress` when a
  session actually ends — see Persistent execution state in `commands/implement.md`.
- `targetRoot`/`gitRoot` are recorded for the cross-check in Resume below — **they are never treated
  as proof of project identity**. The live boundary check (`docs/project-boundary.md`) is always
  re-run on every `/implement` invocation, resume or not, and is authoritative; these fields exist so
  a resumed session can *notice* when a state file doesn't match the project it's actually sitting
  in, not so it can skip re-verifying.

### `plan.md`, `progress.md`, `decisions.md`, `failures.md`

Plain Markdown, human-readable, no fixed schema beyond what `commands/implement.md`'s Persistent
execution state section already specifies (what goes in each, when to append, what counts as
"meaningful" for `failures.md`). These are written *for* a human or a resumed session to read
directly — deliberately not JSON, since the content is prose (a plan, a narrative log, a decision's
reasoning), not structured data a program needs to parse. `state.json` is the only file with a fixed
shape, because it's the only one a resume needs to compare programmatically (stage names, status)
rather than just read.

### `.devagent/decisions.md` vs. Obsidian's `Key Decisions.md`

Different scope, not a duplicate memory system. `.devagent/decisions.md` is this *execution's*
scratch record — every non-trivial choice made while building this specific task, useful mid-run and
on resume, discarded in relevance once the task ships (though the file itself isn't deleted).
Obsidian's `brain/Key Decisions.md` (see `docs/obsidian-memory.md`) is the cross-project, long-term
knowledge layer — only the subset of `.devagent/decisions.md` entries that are genuinely reusable
beyond this one task get promoted there, at stage 14/16 (Obsidian wrap-up). Most execution-local
decisions never make that cut, and that's correct — not every choice made while building one feature
is a lesson worth remembering six months from now on a different project.

### Not gitignored automatically

`.devagent/` is ordinary project content once created — dev-agent does not edit the target project's
`.gitignore` to hide it, since that's a file the user didn't ask dev-agent to touch. If a user doesn't
want execution state committed, they add it to their own `.gitignore`; dev-agent's final report can
mention this as a suggestion but never does it unasked.

## Resume (`/implement --resume`)

See `commands/implement.md` → Resume for the operational steps. The principle underneath all of
them: **the repository is authoritative, `state.json` is a hint.** A state file can be stale (a
different session, a manually reverted commit, code that changed after the last checkpoint) in ways
nothing inside the file itself can detect — only comparing it against the real repository can. This
mirrors exactly the same "trust what's actually there, not what a claim says" principle that governs
`docs/project-boundary.md`'s tool-layer enforcement: a state file claiming `targetRoot` is a
particular path is no more trustworthy than a prompt claiming the target project is a particular
path — both get checked against reality, never taken as given.

Concretely, "inspect the actual repository" (Resume step 5) means: if `state.json` says a stage
completed, look for the evidence a human reviewer would look for — do the expected files exist, does
`git diff`/`git status` show work consistent with it, does a claimed "tests passing" checkpoint still
actually pass right now. Disagreement is resolved in the repository's favor, and the discrepancy gets
logged to `progress.md` rather than silently corrected and forgotten — a state file that was
frequently wrong is itself a signal worth a human noticing.

## Failure recovery

Two related but distinct mechanisms:

1. **Within a single stage's retry loop** (`commands/implement.md` steps 10/11/13): fix → re-test →
   repeat, with no fixed iteration cap — see Iteration in `commands/implement.md` for exactly when
   that becomes "stop and re-architect" instead of "keep trying the same class of fix."
2. **Across the whole execution, via `.devagent/failures.md`**: a meaningful failure (one that took
   real investigation, or that could plausibly recur) gets a permanent record — stage, problem,
   evidence, root cause, fix, verification. Before investigating a new failure, check whether this
   file already has a matching entry from earlier in *this same execution* — if the same class of
   problem already has a root cause on record, don't re-derive it from scratch. This is explicitly
   scoped to non-trivial failures; logging every transient test flake or an obvious one-line typo fix
   would make the file noise, not signal, defeating its purpose.

## When to ask the user

Only for a decision that genuinely requires a human, not as a checkpoint ritual between ordinary
stages:

- An ambiguous business requirement where the different readings lead to materially different
  outcomes (not "which of two equally-valid technical approaches", which the Decision hierarchy in
  `commands/implement.md` already resolves without asking).
- A destructive operation requiring explicit authorization (matches this plugin's standing safety
  rules — never run destructive commands without confirmation).
- A missing external credential or configuration value dev-agent has no way to infer or generate.
- A legal/compliance-shaped question (e.g. data-retention requirements) outside engineering judgment.
- Production deployment authorization.
- Two architectures with materially different business implications (cost, vendor lock-in, migration
  effort) — not "two architectures with the same implications, different aesthetic preference."

Never ask "should I continue?", "should I run the tests now?", or "should I fix this?" — those are
ordinary development work the Decision hierarchy and this document's philosophy already resolve
autonomously. Asking after every stage defeats the entire point of Deep Mode.

## No false completion

Never report a task "complete"/"done" if any of the following is true: tests are failing, the
reviewer's verdict is `CHANGES REQUIRED`, a major stated requirement is visibly missing, Visual QA
found a critical issue that wasn't subsequently fixed and re-verified, or the reviewer's Security or
Performance verdict is `FAIL` and wasn't subsequently resolved. In any of these cases, report
`INCOMPLETE` and the exact blocking reason — never soften a real blocker into an implied success to
make the report read better.

## Limitations, stated honestly

- **State is prompt-driven, not process-driven.** `.devagent/state.json` is read and written by the
  orchestrating model following these instructions — there is no independent script enforcing that a
  checkpoint actually gets written at every transition the way `hooks/project-boundary-guard.cjs`
  independently enforces the project boundary at the tool layer. A session that's interrupted between
  "did the work" and "wrote the checkpoint" can leave `state.json` behind reality; Resume's "the
  repository is authoritative" rule exists specifically to cover this gap, not to pretend it can't
  happen.
- **Resume quality depends on how much was actually written to `progress.md`/`plan.md`** during the
  original run — a resume reading a thin log has less to work from than one reading a detailed one.
  This document instructs writing at every transition, but there's no mechanical guarantee a given
  session followed that instruction faithfully.
- **`.devagent/` is protected by the same boundary hook as everything else, which means it inherits
  that hook's own stated limitations** (heuristic Bash coverage, a hook process that fails to start
  fails open) — see `docs/project-boundary.md` → Known limitations. Nothing about persistent state
  changes those; it's an ordinary consumer of the existing mechanism, not a new one.
- **No agent count increase.** Security/Performance stages are folded into `dev-agent:reviewer`
  rather than split into dedicated subagents. This keeps the review focused on one coherent read of
  the diff, but it does mean a single reviewer call is doing more work than before — if that call's
  own context becomes a bottleneck for a very large diff, that's a real tradeoff of this design
  choice, not a hidden cost.
- **The 15-stage count in Observability is nominal**, not load-bearing — it exists to give the user a
  sense of progress, not as a hard contract. Not every task will show exactly 15 checkpoints; a
  resumed run picking up mid-lifecycle shows fewer, and that's expected.
