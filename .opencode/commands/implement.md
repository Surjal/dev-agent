---
description: Deep, autonomous end-to-end development workflow -- target verification, project discovery, Obsidian history, architecture/UX (when needed), research, implementation, testing, visual QA (when available), security/performance/final review, Definition of Done, persistent resumable state, Obsidian write-back
agent: build
---

Run the full development workflow for this task:

$ARGUMENTS

This plugin's subagents are OpenCode markdown agents (`.opencode/agents/dev-agent-*.md`, `mode:
subagent`). Delegate to one by calling the **`task` tool** with its agent name (e.g. `dev-agent-developer`,
`dev-agent-researcher`) -- never do the research/design/implementation/testing/review yourself
inline, even when the change looks small. Task size is not a reason to skip delegation -- actually
call the `task` tool for every stage that applies, every time.

## Deep Mode (default -- this is not an opt-in flag)

Every `/implement` run is Deep Mode. There is no separate "fast mode" -- a small bug fix and a new
application both go through the same 15-stage lifecycle below, they just skip more of it (and skip
*explicitly*, see Stage selection). `--deep` is accepted as a no-op for anyone who types it out of
habit; do not treat its absence as license to behave more shallowly.

### Execution philosophy

This is an autonomous, quality-first execution system. Do not optimize for speed, token usage,
number of tool calls, or minimum effort. Prefer: deeper repository investigation, broader reasoning,
inspecting relevant files before modifying them, multiple implementation iterations, comprehensive
testing, visual verification, security analysis, performance analysis, fixing discovered problems,
polishing UX/UI, validating the final result.

The objective is not to produce an answer quickly. The objective is to produce the best complete
working implementation that can reasonably be achieved from the supplied requirements. Continue
working until the Definition of Done (below) is satisfied.

**Arguments**: if `$ARGUMENTS` starts with `--resume` (with or without additional task text after
it), skip straight to Resume below instead of starting at Stage 0. If it starts with `--deep`, strip
that token (it's redundant) and treat the rest as the task text.

## Execution stages

The full lifecycle, in order. Not every stage runs on every task -- see Stage selection below for
which apply; a stage that doesn't apply is explicitly recorded as `SKIPPED -- NOT APPLICABLE`, never
silently omitted.

| # | Stage | What happens |
|---|---|---|
| 0 | Target verification | Establish and verify the project root (below) -- nothing else starts first |
| 1 | Understand request | Read the actual request; don't assume scope |
| 2 | Research & discovery | One `dev-agent-researcher` call that covers both project discovery and the Implementation Plan. Skippable only for a Trivial task per Stage selection below |
| 3 | Historical context | Read the target project's Obsidian note + brain files, if reachable -- skipped for Trivial tier |
| 4 | Architecture | `dev-agent-architect`, if in scope |
| 5 | UX / product design | `dev-agent-ux-designer`, if in scope |
| 6 | *(merged into Stage 2)* | Never a second `dev-agent-researcher` dispatch -- see the note after this table |
| 7 | Implementation | `dev-agent-developer` / `dev-agent-frontend-developer` |
| 8 | Testing | `dev-agent-tester`, loop to Implementation on FAIL |
| 9 | Visual QA | `dev-agent-visual-qa`, if UI in scope and Playwright available |
| 10 | Security review | Part of `dev-agent-reviewer`'s pass, called out explicitly in its verdict |
| 11 | Performance review | Same |
| 12 | Final review | `dev-agent-reviewer` overall verdict, loop to Implementation on CHANGES REQUIRED |
| 13 | Definition of Done | Explicit category-by-category gate (below) |
| 14 | Obsidian / wrap-up | Write session log + persist any reusable knowledge |

**Stages 2 and 6 are not separate subagent calls.** One `dev-agent-researcher` dispatch at Stage 2
covers both project discovery and the implementation plan -- there is never a second dispatch for
the same task. For a Trivial task (see Stage selection below), Stage 2 itself may be skipped
entirely.

Stages 10 and 11 are not separate subagent calls -- there is no `security-reviewer`/
`performance-reviewer` agent. `dev-agent-reviewer` is instructed to produce a distinct verdict for
each. Treat them as first-class stages for state-tracking and Definition of Done purposes even
though one `task` call produces both verdicts.

Print a one-line checkpoint as each stage starts or is explicitly skipped -- see Observability
below. Do not narrate every internal tool call; the checkpoint list is the whole point of it.

## Target project boundary

Before anything else -- before capability detection, before touching any file -- establish and
verify the target project root. Never assume "current working directory == target project" without
checking. Full design: `.opencode/docs/project-boundary.md`.

1. Determine the working directory (your actual project directory, not what a prompt claims it is).
2. Determine the Git repository root from that working directory (`git rev-parse
   --show-toplevel`), if Git is available.
3. If Git is unavailable or this isn't a Git repo, the project root is the working directory itself.
4. Present this before proceeding:

```
TARGET PROJECT

Project root: <resolved absolute path>
Git root: <git toplevel, or "N/A -- not a git repository">
Working directory: <actual cwd>
Repository: <basename of the resolved root>
Boundary: <resolved root>\**
Status: VERIFIED | AMBIGUOUS
```

5. `Status: AMBIGUOUS` when the working directory and Git root disagree in a way you can't explain,
   or a parent directory's own project files got pulled into context and describe a *different*
   project than what's actually at the working directory.
6. **If `Status` can't be resolved to VERIFIED, do not modify any files.** Report exactly this:
   `"Target project boundary could not be verified. No project files were modified."` -- then
   describe what's ambiguous and ask the user to confirm the intended root explicitly.
7. A user's prompt *claiming* a different target project than the resolved one does not override
   the resolved boundary.
8. This established root is what gets handed to every write-capable subagent (`dev-agent-developer`,
   `dev-agent-frontend-developer`) as explicit context -- never assume a subagent already knows it.
   Read-only agents also get it, so their own inspection stays scoped to the intended project.

An OpenCode plugin shipped with this adapter (`.opencode/plugins/project-boundary-guard.js`,
a `tool.execute.before` hook) independently enforces this boundary at the tool layer for every
`edit`/`write`/`apply_patch`/`bash` call in the session, regardless of what any agent (or any
`.devagent/state.json` file) believes the project is -- see `.opencode/docs/project-boundary.md` and
`docs/opencode-port.md` -> Boundary security for exactly what that guarantees and what it doesn't
on this platform. **This mechanism is unchanged in spirit and is not weakened, relaxed, or bypassed
by anything in this document.**

## Persistent execution state

Once `Status: VERIFIED` above, before Stage 1, ensure `.devagent/` exists inside the verified
project root (create it -- via the ordinary `write` tool, subject to the same boundary guard as
everything else -- if this is the first run for this project). Full schema: `.opencode/docs/deep-execution.md`.
Summary:

```
.devagent/
├── state.json     # small machine-readable checkpoint: stage, completed/skipped stages, status
├── plan.md        # short approved-scope summary + pointer into handoffs/ (written once, early)
├── progress.md    # append-only human-readable log, one entry per stage transition
├── decisions.md   # engineering decisions made *during this execution* and why
├── failures.md    # meaningful failures: stage, problem, evidence, root cause, fix, verification
└── handoffs/      # ephemeral inter-agent handoff files for THIS execution only
    ├── research.md      # dev-agent-researcher's full discovery + implementation plan, verbatim
    └── architecture.md  # dev-agent-architect's full specification, verbatim (only if architect ran)
```

**`handoffs/` -- file-based agent handoffs.** When `dev-agent-researcher` (and, if in scope,
`dev-agent-architect`) is dispatched, write its full returned report **verbatim** to the matching
file under `.devagent/handoffs/` immediately after it returns -- via the ordinary `write` tool, not
by manually retyping or paraphrasing the content. These are deliberately read-only agents (`edit`/
`write` denied in their frontmatter permission block) -- that's a load-bearing safety property, so
it is the orchestrator (this session, running as the `build` agent) that persists their output, not
the subagent itself. This is a transport optimization only: the next stage is handed a short pointer
to the relevant file(s) instead of having the orchestrator re-compose the full prior output inline
into a large prompt. Not created at all for a Trivial-tier task.

- Update `state.json` at every stage transition (entering a stage, completing it, or explicitly
  skipping it) -- not only at the very end. This is what makes an interrupted run resumable.
- Append to `progress.md` at the same points, in prose.
- `plan.md` is a **short** approved-scope summary (task, tier, a one-line pointer to the relevant
  file(s) under `handoffs/`) -- not a second full copy of the researcher's plan or the architect's
  spec.
- Append to `decisions.md` only for a genuine engineering decision with more than one reasonable
  option. Don't log routine, single-option work.
- Append to `failures.md` only for a **meaningful** failure -- one that took real investigation to
  root-cause, or that could plausibly recur. Include: stage, problem, evidence, root cause, fix,
  verification. Check this file before starting Implementation or re-investigating a failure.
- `.devagent/` is an ordinary directory inside the target project -- it is covered by the same
  boundary guard as every other file there. It is not gitignored automatically by dev-agent -- that
  would mean editing a file the user didn't ask you to touch; mention to the user that they may want
  to add it to their own `.gitignore` if they don't want execution state committed, but don't do it
  for them unasked.
- On natural completion, set `state.json`'s `status` to `complete` or `blocked` -- never leave it at
  `in_progress` when the session is actually finished.

## Resume (`/implement --resume`)

1. Run Target project boundary above exactly as normal -- a resume never skips or weakens
   verification. The freshly-verified root is authoritative regardless of anything a state file
   claims.
2. Read `.devagent/state.json` if it exists. If it doesn't, there is nothing to resume -- say so
   and ask whether to start a fresh `/implement` for this task.
3. **Cross-check, don't trust**: compare `state.json`'s recorded `targetRoot`/`gitRoot` against the
   root you just verified in step 1. If they disagree, this state file describes a different
   checkout or a different project -- treat it as stale, say so explicitly, and don't resume from it.
4. Read `plan.md`, the tail of `progress.md`, and `failures.md` for context on what was being built
   and what's already failed once.
5. **Inspect the actual repository** -- don't take `state.json`'s `stage`/`completedStages` at face
   value. If it claims a stage is complete, verify: do the files it should have produced actually
   exist and look plausible? Does `git status`/`git diff` show work consistent with that stage
   having happened? If it claims "testing complete, PASS", does the test suite still actually pass
   right now?
6. **The repository is authoritative over the state file.** If they disagree, trust what's actually
   on disk, correct `state.json` to match reality, and note the discrepancy in `progress.md` before
   continuing. Do not blindly resume into a later stage than the evidence supports.
7. **Handoff files get the same "verify, don't blindly trust" treatment**: if `state.json` claims
   `research`/`architecture` completed and the matching file under `.devagent/handoffs/` exists,
   reuse it. But if `state.json` claims a stage completed and its handoff file is **missing**, that
   is itself a stale/incomplete-state signal -- regenerate only that missing stage (re-dispatch the
   one agent whose handoff is absent), not the whole pipeline.
8. Continue execution from the real current stage, running the normal stage logic below exactly as
   if you'd reached it in a single continuous run.

## First-run setup

Immediately after Persistent execution state above (once `.devagent/` exists) and before Capability
detection, check `.devagent/.onboarded`. If it's missing, this is the first `/implement` or
`/analyze` run for this project -- run the one-time Playwright/Obsidian setup check in
`.opencode/docs/first-run-setup.md`, then write the marker. If it already exists, skip this step entirely and
silently -- never re-ask, never re-install, on any later run. This step is not part of Resume: a
resumed run skips it exactly as it would if `.devagent/.onboarded` already existed.

## Observability

At each stage start (or explicit skip), print one concise line:

```
[3/15] Historical context -- reading D:\obsidian\work\active\<ProjectName>.md
[3/15] Historical context -- SKIPPED (Trivial tier)
[5/15] UX / product design -- SKIPPED (no UI in scope)
[8/15] Testing -- FAIL, retrying (attempt 2)
```

Number out of however many stages actually apply this run. Do not flood the user with every
internal tool call between checkpoints.

## Capability detection

Before stage selection, run the capability checks in `.opencode/docs/capabilities.md` and present the result:

```
CAPABILITIES

OpenCode: available
Frontend: <framework or "none">
Backend: <framework or "none">
Playwright: available | unavailable
Browser: available | unavailable
Git: available | unavailable
GitHub: available | unavailable
Obsidian: available | unavailable
```

This is read-only detection -- never install Playwright, never install browser binaries, never edit
`package.json` because Playwright happens to be missing. The one exception is the one-time First-run
setup step above, which may install Playwright, but only after explicit per-project user
confirmation the first time `/implement` runs against this project -- never here, and never again
after that first ask.

## Project discovery (Stage 2)

Delegate this to `dev-agent-researcher` in the same call that also produces the Implementation Plan
-- see `agents/dev-agent-researcher.md` -> Project discovery for the exact checklist. For a small,
well-scoped bug fix this can be a lighter pass focused on the area actually touched. Don't skip this
step entirely for anything above the Trivial tier.

## Stage selection

Not every task needs every stage. Decide which apply *before* starting, based on the actual scope of
the request and the capabilities just detected:

| Task shape | Stages |
|---|---|
| Trivial, unambiguous, single-location change (see below) | `developer` -> `tester` -> `reviewer` (researcher skipped) |
| Backend-only change, bug fix, migration, script | `researcher` -> `developer` -> `tester` -> `reviewer` (no architect, no UX, no frontend-developer, no visual-qa) |
| Frontend change, Playwright available | `researcher` -> `ux-designer` -> `frontend-developer` -> `tester` -> `visual-qa` -> `reviewer` |
| Frontend change, Playwright unavailable | `researcher` -> `ux-designer` -> `frontend-developer` -> `tester` -> `reviewer` (visual-qa skipped -- report it explicitly) |
| Full application (new project, or a feature big enough to need a real spec) | `architect` -> `researcher` -> `ux-designer` -> `developer` -> `frontend-developer` -> `tester` -> `visual-qa` (if Playwright available) -> `reviewer` |

`visual-qa` is never invoked for a backend-only task regardless of capability. When UI *is* in scope
but Playwright is `unavailable`, don't skip it silently: state explicitly **"Visual QA skipped:
browser automation capability unavailable."**

### Trivial-task tier -- skipping `researcher` entirely

Skip `researcher` (go straight to `developer`) only when **all** of the following hold:
- The task already names a specific, unambiguous change -- a typo, a copy/string/constant tweak, an
  off-by-one or comparison-operator fix, a one-line null/bounds check -- with no design decision
  left to make about *how* to implement it, only *where*.
- The change is confined to a single file (or a couple of directly related files) -- no cross-file
  convention research is plausibly needed.
- Nothing about the fix could plausibly touch security, data model, or a shared/widely-called
  function whose behavior other callers depend on.

If genuinely unsure whether a task is Trivial or needs the full core, default to the core.
`dev-agent-developer` still reads every file it touches in full before editing, per its own standing
rule. If that read surfaces something the task description didn't, `developer` must stop and report
back rather than guess; the orchestrator then dispatches `researcher` before continuing.

**Obsidian historical context is also skipped for Trivial tier** (Stage 3). Record the skip
explicitly -- `progress.md` gets `Obsidian historical context: SKIPPED -- Trivial tier.` and
`state.json`'s `skippedStages` includes `history`. **If a Trivial task escalates mid-run**, the
orchestrator must perform the Obsidian read at that point, before continuing with `researcher`.

If genuinely unsure whether a request is "small feature" or "big enough to need architect", lean
towards the smaller path. Every stage this table doesn't select for the current task is recorded as
`SKIPPED -- NOT APPLICABLE` in `progress.md` and in the final Definition of Done walk-through.

## Decision making

Across every stage, decide rather than ask, in this order -- stop at the first source that resolves
it: (1) current project conventions, (2) the user's explicit requirements, (3) this project's own
Obsidian history, (4) cross-project Obsidian patterns/decisions, (5) framework best practices, (6)
sensible defaults. Ask the user only when a decision is genuinely business-critical or unsafe to
infer.

## Steps

Establish Target project boundary above first, with `Status: VERIFIED`, before step 0. If
`$ARGUMENTS` requested `--resume`, follow Resume above instead of starting here.

0. Ensure `.devagent/` exists (Persistent execution state above), then run First-run setup above.
1. Run Capability detection above and present the CAPABILITIES report.
2. Apply Stage selection above against the actual request and the capabilities just detected. State
   which stages you're running and why, briefly.
3. Determine `<ProjectName>` and, **unless Trivial tier applies**, check the user's Obsidian vault
   for relevant historical context (`D:\obsidian\work\active\<ProjectName>.md` and the three
   `D:\obsidian\brain\*.md` files) -- see `.opencode/docs/obsidian-memory.md`. Skip silently if the vault or
   those specific files aren't reachable. **If Trivial tier applies**, skip this read and record it
   explicitly.
4. **If Trivial**: skip straight to step 7 -- no `researcher`, no `architect`, no `ux-designer`, no
   `handoffs/` directory. Write the task description itself to `plan.md` as the approved scope.
   **Otherwise**, both `researcher` and (if in scope) `architect` run, but the *order* between them
   depends on which Stage selection row matched:

   **Case A -- `researcher` runs before `architect`** (the default order -- every Stage selection
   row except "Full application"): call the `task` tool with agent `dev-agent-researcher` for
   Stage 2. When it returns, write its full report **verbatim** to `.devagent/handoffs/research.md`
   (a single `write` call -- don't retype or summarize it into your own prose). Update `plan.md`
   with a short pointer. If the plan looks risky or ambiguous, surface that to the user before
   proceeding. Then, if `architect` is in scope: call the `task` tool with agent
   `dev-agent-architect` with a **concise** prompt -- the task description plus a pointer to
   `.devagent/handoffs/research.md` -- do not manually re-compose researcher's findings inline;
   architect has read access and reads the file itself. When it returns, write its full
   specification **verbatim** to `.devagent/handoffs/architecture.md`. If any `Open Questions` are
   genuinely business-critical, ask the user before proceeding.

   **Case B -- `architect` runs before `researcher`** ("Full application" row): call the `task` tool
   with agent `dev-agent-architect` first, with the task description only -- `.devagent/handoffs/
   research.md` does not exist yet, and the dispatch prompt must not claim otherwise. When it
   returns, write its full specification **verbatim** to `.devagent/handoffs/architecture.md`. If
   any `Open Questions` are genuinely business-critical, ask the user before proceeding. Then call
   the `task` tool with agent `dev-agent-researcher` with a pointer to `.devagent/handoffs/
   architecture.md`. If researcher reported a conflict with `architecture.md`, surface it to the
   user before proceeding rather than picking a side silently.
6. If `ux-designer` is in scope: call the `task` tool with agent `dev-agent-ux-designer` with a
   pointer to `.devagent/handoffs/architecture.md` (or a description of the requested UI change if
   there's no architect stage this time). Carry its design system forward to `frontend-developer`
   inline (its own report is small enough that a `handoffs/` file isn't needed for it specifically).
7. If backend/general implementation is needed: call the `task` tool with agent
   `dev-agent-developer` with a **concise** prompt: the specific task/outcome required, a pointer to
   `.devagent/handoffs/research.md` and `.devagent/handoffs/architecture.md` (whichever exist this
   run), and the standing instruction to read them itself, independently verify against the current
   repository before editing, and escalate if a handoff conflicts with what it actually finds on
   disk. For a Trivial task there are no handoff files; the prompt is just the task description from
   step 4.
8. If frontend implementation is needed: call the `task` tool with agent
   `dev-agent-frontend-developer` with the same concise, pointer-based prompt shape as step 7 (task/
   outcome + pointers to whichever of `research.md`/`architecture.md` exist + the ux-designer's
   design system). If Playwright is `available` per capability detection, it also writes the
   Playwright test files for the UI it builds -- `dev-agent-visual-qa` runs them later, it doesn't
   author them.
9. Call the `task` tool with agent `dev-agent-tester` -- always, on every tier including Trivial.
   Hand it whatever test/build/lint command(s) `dev-agent-developer` (or `dev-agent-frontend-
   developer`) already reported running in its own output, as a hint -- it still independently
   executes the command(s) itself.
10. If the tester's verdict is FAIL: check `failures.md` for a matching prior entry from this
    execution first, then send the failure output back to whichever of `dev-agent-developer` /
    `dev-agent-frontend-developer` owns the failing area to fix, then re-run `dev-agent-tester`.
    Repeat while genuine progress is being made and failures are actionable -- there is no fixed
    retry limit -- until PASS or until you hit a genuine blocker, in which case stop and ask the
    user. Log a meaningful failure to `failures.md`. A FAIL on a Trivial task is itself evidence the
    task wasn't as trivial as assumed -- consider escalating to `dev-agent-researcher` before the
    next fix attempt rather than retrying blind.
11. If `visual-qa` is in scope (UI in scope and Playwright available), call the `task` tool with
    agent `dev-agent-visual-qa` once the tester reports PASS. If its `Overall Result` is FAIL: send
    its findings back to `dev-agent-frontend-developer` to fix, then re-run `dev-agent-tester` and
    `dev-agent-visual-qa` again (in that order). Repeat until PASS or a genuine blocker. Never send
    known visual-qa failures straight to `reviewer`.
12. Once `tester` is PASS (and `visual-qa` is PASS or was never in scope), call the `task` tool with
    agent `dev-agent-reviewer` -- always, on every tier including Trivial -- which produces
    Security, Performance, and an overall verdict in one pass. If `.devagent/handoffs/
    architecture.md` exists, mention its path as available context for judging architecture fit.
13. If the reviewer's verdict is CHANGES REQUIRED, or its Security/Performance findings flag
    anything blocking: send the specific issues back to whichever implementer owns them, then
    re-run `dev-agent-tester` (and `dev-agent-visual-qa`, if it was in scope) and `dev-agent-
    reviewer` again. Repeat until APPROVED (with no blocking security/performance findings) or a
    genuine blocker. If the same category of review issue recurs after a fix, that's a signal to
    stop iterating blindly and re-enter Architecture/Research instead -- see Iteration below.
14. Run the Definition of Done gate below -- always, on every tier including Trivial. A reviewer
    APPROVED is necessary but not sufficient -- walk through every applicable category explicitly
    before declaring the task complete. Update `state.json`'s `status` to `complete` or `blocked` --
    never leave it `in_progress` at the end of a session.
15. Give the user a concise final report: what changed, what was tested, the review verdict, the
    Definition of Done result, whether Obsidian historical context was read or skipped and why, and
    any remaining concerns flagged as non-blocking. Never say "complete"/"done" unless the
    Definition of Done gate actually passed. If a genuine blocker stopped things early, report
    `INCOMPLETE` and the exact blocking reason.
16. Perform the Obsidian write step from `.opencode/docs/obsidian-memory.md`: append a Session Log entry to
    `D:\obsidian\work\active\<ProjectName>.md`, update Active Work / Completed Milestones / Related,
    and -- only if the session surfaced genuinely reusable knowledge -- append to the relevant
    `Key Decisions.md` / `Gotchas.md` / `Patterns.md` brain file, tagged `[[<ProjectName>]]`. Check
    first whether an entry for this session already exists and extend rather than duplicate it.
    Never write secrets, credentials, or tokens there. Skip silently if the vault isn't reachable.

## Iteration

There is no fixed "try N times and give up" limit -- a serious implementation may legitimately need
several fix/test cycles. Keep iterating on Testing/Visual QA/Review loops while genuine progress is
visible and failures are actionable. **Stop iterating blindly** and re-enter Research/Architecture
instead when repeated attempts hit the same root cause without resolving it. Never mistake "still
failing after several attempts" alone for a blocker -- only stop for the user on a genuine blocker
(missing credential, business-critical ambiguity, destructive-operation authorization, conflicting
explicit requirements).

## Definition of Done

The task is not done merely because code was written and the reviewer said APPROVED. Before the
final report, explicitly check every category that applies to what was actually touched this task
(skip a category entirely, and say so, if that layer wasn't touched):

- **Product** -- requirements actually implemented, user journeys complete end-to-end, edge cases
  handled.
- **Frontend** *(if UI was touched)* -- three parts, each with its own state:
  - *Code-level frontend checks* -- form validation, accessibility markup, consistency with the
    existing design system. `PASS`/`FAIL`.
  - *Browser-based QA* -- `dev-agent-visual-qa`'s result: `PASS`, or `SKIPPED -- capability
    unavailable` if Playwright wasn't available. **Never report this as PASS when it was actually
    skipped.**
  - *Responsive QA* -- mobile/tablet/desktop behavior, confirmed by `visual-qa` if it ran (`PASS`/
    `FAIL`/`SKIPPED`), otherwise a code-level check of the CSS/breakpoints against the ux-designer
    spec.
- **Backend** *(if backend was touched)* -- API contracts match the spec, input validation,
  authorization checks on every new endpoint, error handling, database relationships correct.
- **Database** *(if schema/migrations were touched)* -- migrations correct and reversible where the
  project's convention expects that, relationships correct, indexes considered for new query
  patterns. `SKIPPED -- NOT APPLICABLE` if no schema change was involved.
- **Testing** -- relevant automated tests pass, and the important flows this task touched are
  actually verified.
- **Security** -- authentication and authorization enforced, input validation at every trust
  boundary, no injection risk, safe file-upload handling if applicable, no secrets committed or
  logged, no insecure defaults introduced. `dev-agent-reviewer`'s Security verdict is what this
  category reports.
- **Performance** -- no N+1 queries introduced, no unnecessary requests, pagination where a list
  could grow unbounded, indexes where a new query pattern needs one, no obviously wasteful
  client-side re-renders for frontend work. `dev-agent-reviewer`'s Performance verdict is what this
  category reports.
- **Quality** -- tests exist and pass, the project builds, lint/type-checking passes where the
  project has it configured, the reviewer's findings were actually addressed, not just acknowledged.
- **Documentation** -- architecturally significant decisions recorded (`.devagent/decisions.md` and,
  where genuinely reusable, Obsidian's `Key Decisions.md`), Obsidian updated per the existing
  protocol (stage 16 above).

Never report success without an actual PASS from the tester and APPROVED from the reviewer (with no
blocking Security/Performance findings). If you stop early due to a blocker, say so explicitly,
report `INCOMPLETE`, and explain what's needed to continue.
