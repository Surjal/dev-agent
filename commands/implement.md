---
description: Deep, autonomous end-to-end development workflow -- target verification, project discovery, Obsidian history, architecture/UX (when needed), research, implementation, testing, visual QA (when available), security/performance/final review, Definition of Done, persistent resumable state, Obsidian write-back
---

Run the full development workflow for this task:

$ARGUMENTS

This plugin's subagents are namespaced — their exact Task `subagent_type` values are
`dev-agent:architect`, `dev-agent:researcher`, `dev-agent:ux-designer`, `dev-agent:developer`,
`dev-agent:frontend-developer`, `dev-agent:tester`, `dev-agent:visual-qa`, `dev-agent:reviewer`.
Always delegate using these fully-qualified names, never the bare word ("researcher", "developer",
etc.) — the bare name does not reliably resolve to a real subagent call and silently falls back to
doing the work inline instead, which defeats the whole point of delegation.

Do not shortcut this by doing the research/design/implementation/testing/review yourself inline,
even when the change looks small. Task size is not a reason to skip delegation — actually call Task
with the `dev-agent:*` subagent_type for every stage that applies, every time.

## Deep Mode (default — this is not an opt-in flag)

Every `/implement` run is Deep Mode. There is no separate "fast mode" — a small bug fix and a new
application both go through the same 15-stage lifecycle below, they just skip more of it (and skip
*explicitly*, see Stage selection). `--deep` is accepted as a no-op for anyone who types it out of
habit; do not treat its absence as license to behave more shallowly.

Full rationale, the token/quality philosophy behind this, and what it changes about how you should
work: `docs/deep-execution.md`. The one-line version: correctness, completeness, and a genuinely
verified Definition of Done matter more than finishing in the fewest tool calls. When something is
ambiguous, investigate it. When something is uncertain, verify it. When something fails, root-cause
it before retrying. Do not stop at "the first thing that appears to work" — inspect whether it
actually satisfies the requirement.

**Arguments**: if `$ARGUMENTS` starts with `--resume` (with or without additional task text after
it), skip straight to Resume below instead of starting at Stage 0. If it starts with `--deep`, strip
that token (it's redundant) and treat the rest as the task text.

## Execution stages

The full lifecycle, in order. Not every stage runs on every task — see Stage selection below for
which apply; a stage that doesn't apply is explicitly recorded as `SKIPPED — NOT APPLICABLE`
(Persistent execution state below), never silently omitted.

| # | Stage | What happens |
|---|---|---|
| 0 | Target verification | Establish and verify the project root (below) — nothing else starts first |
| 1 | Understand request | Read the actual request; don't assume scope |
| 2 | Project discovery | Inspect the real repo: stack, framework, DB, ORM, auth, tests, styling, conventions, routes, schema, API surface — delegated to `dev-agent:researcher` |
| 3 | Historical context | Read the target project's Obsidian note + brain files, if reachable |
| 4 | Architecture | `dev-agent:architect`, if in scope |
| 5 | UX / product design | `dev-agent:ux-designer`, if in scope |
| 6 | Research | `dev-agent:researcher` — always, regardless of stage selection |
| 7 | Implementation | `dev-agent:developer` / `dev-agent:frontend-developer` |
| 8 | Testing | `dev-agent:tester`, loop to Implementation on FAIL |
| 9 | Visual QA | `dev-agent:visual-qa`, if UI in scope and Playwright available |
| 10 | Security review | Part of `dev-agent:reviewer`'s pass, called out explicitly in its verdict |
| 11 | Performance review | Same |
| 12 | Final review | `dev-agent:reviewer` overall verdict, loop to Implementation on CHANGES REQUIRED |
| 13 | Definition of Done | Explicit category-by-category gate (below) |
| 14 | Obsidian / wrap-up | Write session log + persist any reusable knowledge |

Stages 10 and 11 are not separate subagent calls — there is no `security-reviewer`/
`performance-reviewer` agent, and this turn intentionally does not add one (existing agents cover
this; see Agent orchestration in `docs/deep-execution.md` for why a prompt/orchestration change was
preferred over a new agent). `dev-agent:reviewer` is instructed to produce a distinct verdict for
each — see `agents/reviewer.md`. Treat them as first-class stages for state-tracking and Definition
of Done purposes even though one Task call produces both verdicts.

Print a one-line checkpoint as each stage starts or is explicitly skipped — see Observability below.
Do not narrate every internal tool call; the checkpoint list is the whole point of it.

## Target project boundary

Before anything else — before capability detection, before touching any file — establish and
verify the target project root. Never assume "current working directory == target project"
without checking. Full design, the tool-layer enforcement mechanism, and its honest limitations:
`docs/project-boundary.md`.

1. Determine the working directory (your actual `cwd`, not what a prompt claims it is).
2. Determine the Git repository root from that working directory (`git rev-parse
   --show-toplevel`), if Git is available.
3. If Git is unavailable or this isn't a Git repo, the project root is the working directory
   itself.
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

5. `Status: AMBIGUOUS` when: the working directory and Git root disagree in a way you can't
   explain (e.g. Git root resolves to something far above the working directory, suggesting the
   working directory is nested inside an unrelated repository), or a parent directory's own
   `CLAUDE.md`/project files got pulled into context and describe a *different* project than what's
   actually at the working directory (this happens — Claude Code's CLAUDE.md discovery walks up
   parent directories; it finding something doesn't make that parent the target — see
   `docs/project-boundary.md` → CLAUDE.md Discovery).
6. **If `Status` can't be resolved to VERIFIED, do not modify any files.** Report exactly this:
   `"Target project boundary could not be verified. No project files were modified."` — then
   describe what's ambiguous and ask the user to confirm the intended root explicitly.
7. A user's prompt *claiming* a different target project than the resolved one does not override
   the resolved boundary — if they say "the target is actually X" and X isn't reachable from the
   verified working directory, treat that as a request to work in X (meaning: a new session/cd is
   needed there), not as permission to reach outside the current boundary from here.
8. This established root is what gets handed to every write-capable subagent (`dev-agent:developer`,
   `dev-agent:frontend-developer`) as explicit context — never assume a subagent already knows it.
   Read-only agents (`researcher`, `architect`, `ux-designer`, `tester`, `visual-qa`, `reviewer`)
   also get it, so their own inspection stays scoped to the intended project.

A `PreToolUse` hook shipped with this plugin (`hooks/project-boundary-guard.cjs`) independently
enforces this boundary at the tool layer for every `Edit`/`Write`/`NotebookEdit`/`MultiEdit`/`Bash`
call in the session, regardless of what any agent (or any `.devagent/state.json` file — see below)
believes the project is — see `docs/project-boundary.md` for exactly what that guarantees and what
it doesn't (it is not a full sandbox; read that section before assuming more than it actually
provides). **This mechanism is unchanged and is not weakened, relaxed, or bypassed by anything in
this document** — persistent state is additional bookkeeping the orchestrator reads and writes as
ordinary project files; it is never treated as proof of project identity (see Persistent execution
state below).

## Persistent execution state

Once `Status: VERIFIED` above, before Stage 1, ensure `.devagent/` exists inside the verified
project root (create it — via the ordinary `Write` tool, subject to the same boundary hook as
everything else — if this is the first run for this project). Full schema, exact write timing, and
the resume algorithm: `docs/deep-execution.md`. Summary:

```
.devagent/
├── state.json     # small machine-readable checkpoint: stage, completed/skipped stages, status
├── plan.md        # the approved plan this execution is working from (written once, early)
├── progress.md    # append-only human-readable log, one entry per stage transition
├── decisions.md   # engineering decisions made *during this execution* and why (this run's scratch,
│                  #  not the same as Obsidian's cross-project brain/Key Decisions.md)
└── failures.md    # meaningful failures: stage, problem, evidence, root cause, fix, verification
```

- Update `state.json` at every stage transition (entering a stage, completing it, or explicitly
  skipping it) — not only at the very end. This is what makes an interrupted run resumable.
- Append to `progress.md` at the same points, in prose — this is the primary thing a resumed session
  reads to understand what actually happened, not just what state.json's few fields can encode.
- Append to `decisions.md` only for a genuine engineering decision with more than one reasonable
  option (e.g. "reused the existing `<DataTable>` component instead of building a new paginated
  list, because the project already has one and the ux-designer's spec didn't require a different
  pattern"). Don't log routine, single-option work.
- Append to `failures.md` only for a **meaningful** failure — one that took real investigation to
  root-cause, or that could plausibly recur. A test that failed once because of an obvious typo you
  fixed in the same breath is not meaningful; a test that failed because of a subtle interaction
  with existing middleware, requiring you to trace through several files to find the real cause, is.
  Include: stage, problem, evidence (the actual error/output), root cause, fix, verification (how
  you confirmed the fix actually resolved it). Check this file before starting Implementation or
  re-investigating a failure — if the same class of failure already has an entry from earlier in
  *this* execution, don't re-derive the investigation from scratch.
- `.devagent/` is an ordinary directory inside the target project — it is covered by the same
  `hooks/project-boundary-guard.cjs` boundary as every other file there (see Target project boundary
  above), not a special or exempt location. It is not gitignored automatically by dev-agent — that
  would mean editing a file (`.gitignore`) the user didn't ask you to touch; mention to the user that
  they may want to add it to their own `.gitignore` if they don't want execution state committed,
  but don't do it for them unasked.
- On natural completion (Definition of Done passed, or a genuine blocker stopped the workflow),
  set `state.json`'s `status` to `complete` or `blocked` — never leave it at `in_progress` when the
  session is actually finished, since that's exactly the signal a future `--resume` uses to know
  whether there's anything to resume.

## Resume (`/implement --resume`)

1. Run Target project boundary above exactly as normal — a resume never skips or weakens
   verification. The freshly-verified root is authoritative regardless of anything a state file
   claims.
2. Read `.devagent/state.json` if it exists. If it doesn't, there is nothing to resume — say so and
   ask whether to start a fresh `/implement` for this task.
3. **Cross-check, don't trust**: compare `state.json`'s recorded `targetRoot`/`gitRoot` against the
   root you just verified in step 1. If they disagree, this state file describes a different
   checkout or a different project than the one you're actually in right now — treat it as stale,
   say so explicitly, and don't resume from it (start fresh, or ask the user which is intended).
4. Read `plan.md`, the tail of `progress.md`, and `failures.md` for context on what was being built
   and what's already failed once.
5. **Inspect the actual repository** — don't take `state.json`'s `stage`/`completedStages` at face
   value. If it claims a stage is complete, verify: do the files it should have produced actually
   exist and look plausible? Does `git status`/`git diff` show work consistent with that stage
   having happened? If it claims "testing complete, PASS", does the test suite still actually pass
   right now (code can have drifted since the last run)?
6. **The repository is authoritative over the state file.** If they disagree — state says a stage is
   done but the repo doesn't show it, or vice versa — trust what's actually on disk, correct
   `state.json` to match reality, and note the discrepancy in `progress.md` before continuing. Do
   not blindly resume into a later stage than the evidence supports.
7. Continue execution from the real current stage, running the normal stage logic below exactly as
   if you'd reached it in a single continuous run — the numbered stages and their loop-on-failure
   behavior don't change based on whether this is a fresh run or a resume.

## Observability

At each stage start (or explicit skip), print one concise line — not a paragraph, not a tool-call
transcript:

```
[3/15] Historical context — reading D:\obsidian\work\active\<ProjectName>.md
[5/15] UX / product design — SKIPPED (no UI in scope)
[8/15] Testing — FAIL, retrying (attempt 2)
```

Number out of however many stages actually apply this run (count skipped stages too, so the total
is stable within a run) — count from Target verification (1) through Obsidian/wrap-up (last), i.e.
up to 15 including the boundary check itself as stage 1 of the printed sequence. Do not flood the
user with every internal tool call between checkpoints; this line is the whole observability
surface, not a supplement to a running commentary.

## Capability detection

Before stage selection, run the capability checks in `docs/capabilities.md` and present the result:

```
CAPABILITIES

Claude Code: available
Frontend: <framework or "none">
Backend: <framework or "none">
Playwright: available | unavailable
Browser: available | unavailable
Git: available | unavailable
GitHub: available | unavailable
Obsidian: available | unavailable
```

This is read-only detection — never install Playwright, never install browser binaries, never edit
`package.json` because Playwright happens to be missing. "Playwright: unavailable" is a normal,
expected result for most projects, not an error. See `docs/capabilities.md` for exactly what
"available" requires (the target project's own dependency manifest, not anything cached elsewhere
on the machine).

## Project discovery (Stage 2)

Before architecture/research proper, get a real picture of what already exists — the repository is
authoritative, the user's description of their own stack is not assumed correct. Delegate this to
`dev-agent:researcher` (see `agents/researcher.md` → Project discovery for the exact checklist it
works from: language, framework, package manager, frontend/backend framework, database, ORM, auth
approach, testing framework, styling system, existing component library, build system, deployment
config, environment config, existing docs, existing conventions, existing routes, existing DB
schema, existing API structure). For a small, well-scoped bug fix this can be a lighter pass focused
on the area actually touched — don't force a full inventory of an entire large codebase for a
one-line fix; use judgment on depth, but don't skip the step entirely, since even a small fix can be
derailed by an unexpected convention (e.g. the project uses a repository pattern you'd otherwise
bypass).

## Stage selection

Not every task needs every stage. Decide which apply *before* starting, based on the actual scope
of the request and the capabilities just detected — the four-stage core (`researcher` →
`developer` → `tester` → `reviewer`) is the default for anything that isn't a new project or a
major feature with a UI:

| Task shape | Stages |
|---|---|
| Backend-only change, bug fix, migration, script | `researcher` → `developer` → `tester` → `reviewer` (no architect, no UX, no frontend-developer, no visual-qa) |
| Frontend change, Playwright available | `researcher` → `ux-designer` → `frontend-developer` → `tester` → `visual-qa` → `reviewer` |
| Frontend change, Playwright unavailable | `researcher` → `ux-designer` → `frontend-developer` → `tester` → `reviewer` (visual-qa skipped — report it explicitly, see below) |
| Full application (new project, or a feature big enough to need a real spec) | `architect` → `researcher` → `ux-designer` → `developer` → `frontend-developer` → `tester` → `visual-qa` (if Playwright available) → `reviewer` |

`visual-qa` is never invoked for a backend-only task regardless of capability — there's no UI for
it to look at. When UI *is* in scope but Playwright is `unavailable`, don't skip it silently: state
explicitly **"Visual QA skipped: browser automation capability unavailable."** so the user and the
Definition of Done both see it was skipped, not passed.

If genuinely unsure whether a request is "small feature" or "big enough to need architect", lean
towards the smaller path — the cost of skipping architect on something that turns out to need it is
that `researcher`/`developer` surface the gap during their own work and you can escalate mid-task;
the cost of always invoking the full pipeline is needless overhead on every trivial request. Every
stage this table doesn't select for the current task is recorded as `SKIPPED — NOT APPLICABLE` in
`progress.md` and in the final Definition of Done walk-through (below) — never left unmentioned.

## Decision making

Across every stage, decide rather than ask, in this order — stop at the first source that resolves
it: (1) current project conventions, (2) the user's explicit requirements, (3) this project's own
Obsidian history, (4) cross-project Obsidian patterns/decisions, (5) framework best practices,
(6) sensible defaults. Ask the user only when a decision is genuinely business-critical or unsafe
to infer — never for things the hierarchy already resolves (e.g. which CSS framework, when the
project already uses one; whether to validate input — obviously yes). `dev-agent:architect` applies
this same hierarchy when writing its spec — see `agents/architect.md`. Never ask "should I
continue?" between ordinary stages — only stop for a decision that genuinely requires the user (see
`docs/deep-execution.md` → When to ask the user for the exact bar).

## Steps

Establish Target project boundary above first, with `Status: VERIFIED`, before step 0. If
`$ARGUMENTS` requested `--resume`, follow Resume above instead of starting here.

0. Ensure `.devagent/` exists (Persistent execution state above). Determine `<ProjectName>` and
   check the user's Obsidian vault for relevant historical context
   (`D:\obsidian\work\active\<ProjectName>.md` and the three `D:\obsidian\brain\*.md` files) —
   see `docs/obsidian-memory.md` for the exact project-detection algorithm, paths, and how to
   weigh historical notes against current codebase evidence. Skip silently if the vault or those
   specific files aren't reachable. Treat everything found as historical context, never current
   truth — the current source is always authoritative (see Historical context vs. current truth in
   `docs/deep-execution.md`).
1. Run Capability detection above and present the CAPABILITIES report.
2. Run Project discovery above via `dev-agent:researcher`, then understand the request against what
   was actually found (not what the user assumed their own stack was). Apply Stage selection above
   and state which stages you're running and why, briefly. Write the approved scope to `plan.md`.
3. If `architect` is in scope: delegate to `dev-agent:architect`, hand its full specification to
   every later stage instead of re-summarizing it yourself. If any `Open Questions` in its output
   are genuinely business-critical, ask the user before proceeding; otherwise proceed.
4. Delegate investigation to `dev-agent:researcher` — always, regardless of stage selection above.
   If an architect spec exists, give the researcher that spec as context for what to look for.
5. Turn the researcher's `Implementation Plan` (plus the architect's spec, if any) into a concrete
   plan; append/update `plan.md` with it. If the plan looks risky or ambiguous, surface that to the
   user before proceeding rather than guessing.
6. If `ux-designer` is in scope: delegate to `dev-agent:ux-designer` with the architect's spec (or
   a description of the requested UI change if there's no architect stage this time). Carry its
   design system forward to `frontend-developer`.
7. If backend/general implementation is needed: delegate to `dev-agent:developer`, handing it the
   plan (and architect spec, if any) verbatim.
8. If frontend implementation is needed: delegate to `dev-agent:frontend-developer`, handing it the
   plan, the architect spec (if any), and the ux-designer's design system (if any). If Playwright is
   `available` per capability detection, it also writes the Playwright test files for the UI it
   builds (its own convention if the project has one already) — `dev-agent:visual-qa` runs them
   later, it doesn't author them.
9. Delegate validation to `dev-agent:tester`.
10. If the tester's verdict is FAIL: check `failures.md` for a matching prior entry from this
    execution first, then send the failure output back to whichever of `dev-agent:developer` /
    `dev-agent:frontend-developer` owns the failing area to fix, then re-run `dev-agent:tester`.
    Repeat while genuine progress is being made and failures are actionable — there is no fixed
    retry limit (see Iteration below) — until PASS or until you hit a genuine blocker (e.g. missing
    credentials, ambiguous requirement, conflicting constraint) — in which case stop and ask the
    user. Log a meaningful failure to `failures.md` per Persistent execution state above.
11. If `visual-qa` is in scope (UI in scope and Playwright available), delegate to
    `dev-agent:visual-qa` once the tester reports PASS. If its `Overall Result` is FAIL: send its
    findings back to `dev-agent:frontend-developer` to fix, then re-run `dev-agent:tester` and
    `dev-agent:visual-qa` again (in that order) — the same failure-recovery loop as tester, just one
    stage further. Repeat until PASS or a genuine blocker. Never send known visual-qa failures
    straight to `reviewer` — the loop closes here first.
12. Once `tester` is PASS (and `visual-qa` is PASS or was never in scope), delegate to
    `dev-agent:reviewer`, which produces Security, Performance, and an overall verdict in one pass
    (see Execution stages above — stages 10-12 are one Task call, not three).
13. If the reviewer's verdict is CHANGES REQUIRED, or its Security/Performance findings flag
    anything blocking: send the specific issues back to whichever implementer owns them, then
    re-run `dev-agent:tester` (and `dev-agent:visual-qa`, if it was in scope) and `dev-agent:reviewer`
    again. Repeat until APPROVED (with no blocking security/performance findings) or a genuine
    blocker. If the same category of review issue recurs after a fix (not a new issue, the same one
    still present), that's a signal to stop iterating blindly and re-enter Architecture/Research
    instead — see Iteration below.
14. Run the Definition of Done gate below. A reviewer APPROVED is necessary but not sufficient —
    walk through every applicable category explicitly before declaring the task complete. Update
    `state.json`'s `status` to `complete` (Definition of Done passed) or `blocked` (a genuine
    blocker stopped things) — never leave it `in_progress` at the end of a session.
15. Give the user a concise final report: what changed, what was tested, the review verdict, the
    Definition of Done result (including whether visual-qa ran, passed, or was skipped and why),
    and any remaining concerns flagged as non-blocking. Never say "complete"/"done" unless the
    Definition of Done gate actually passed — see No false completion in `docs/deep-execution.md`.
    If a genuine blocker stopped things early, report `INCOMPLETE` and the exact blocking reason.
16. Perform the Obsidian write step from `docs/obsidian-memory.md`: append a Session Log entry to
    `D:\obsidian\work\active\<ProjectName>.md`, update Active Work / Completed Milestones / Related,
    and — only if the session surfaced genuinely reusable knowledge — append to the relevant
    `Key Decisions.md` / `Gotchas.md` / `Patterns.md` brain file, tagged `[[<ProjectName>]]`. A
    visual-qa finding is only brain-worthy if it's a reusable gotcha/pattern/decision, not a
    one-off bug — don't dump every browser-test result into the brain. Check first whether an
    entry for this session already exists (e.g. written by the existing `<obsidian-wrap-up>`
    PreCompact hook already) and extend rather than duplicate it. Never write secrets, credentials,
    or tokens there. Skip silently if the vault isn't reachable. `.devagent/decisions.md` entries
    that are genuinely reusable beyond this one execution are what should get promoted to
    `Key Decisions.md` here — the two files serve different scopes (this run vs. cross-project).

## Iteration

There is no fixed "try N times and give up" limit — a serious implementation may legitimately need
several fix/test cycles. Keep iterating on Testing/Visual QA/Review loops while genuine progress is
visible and failures are actionable. **Stop iterating blindly** and re-enter Architecture/Research
(stage 4/6) instead when repeated attempts hit the same root cause without resolving it — that's a
signal the current approach, not the current diff, is wrong. Never mistake "still failing after
several attempts" alone for a blocker — only stop for the user on a genuine blocker (missing
credential, business-critical ambiguity, destructive-operation authorization, conflicting explicit
requirements) as defined in `docs/deep-execution.md` → When to ask the user.

## Definition of Done

The task is not done merely because code was written and the reviewer said APPROVED. Before the
final report, explicitly check every category that applies to what was actually touched this task
(skip a category entirely, and say so, if that layer wasn't touched — e.g. a pure backend task has
no Frontend category to check):

- **Product** — requirements actually implemented, user journeys complete end-to-end, edge cases
  handled (not just the happy path the tester happened to check).
- **Frontend** *(if UI was touched)* — three parts, each with its own state:
  - *Code-level frontend checks* — form validation, accessibility markup, consistency with the
    existing design system (or the ux-designer's new one). `PASS`/`FAIL`.
  - *Browser-based QA* — `dev-agent:visual-qa`'s result: `PASS`, or `SKIPPED — capability
    unavailable` if Playwright wasn't available. **Never report this as PASS when it was actually
    skipped** — a skip is a legitimate, expected outcome for a project without Playwright, but it
    is not the same thing as a browser having actually confirmed the UI works. For a project where
    Playwright *is* available and UI was changed, Browser-based QA should normally be required
    (i.e. genuinely run and PASS) before final approval, not skipped by convenience.
  - *Responsive QA* — mobile/tablet/desktop behavior, confirmed by `visual-qa` if it ran (`PASS`/
    `FAIL`/`SKIPPED`), otherwise a code-level check of the CSS/breakpoints against the ux-designer
    spec.
- **Backend** *(if backend was touched)* — API contracts match the spec, input validation,
  authorization checks on every new endpoint, error handling, database relationships correct.
- **Database** *(if schema/migrations were touched)* — migrations correct and reversible where the
  project's convention expects that, relationships correct, indexes considered for new query
  patterns. `SKIPPED — NOT APPLICABLE` if no schema change was involved.
- **Testing** — relevant automated tests pass, and the important flows this task touched are
  actually verified, not merely "the suite as a whole didn't get worse."
- **Security** — authentication and authorization enforced (not just present), input validation at
  every trust boundary, no injection risk (SQL/command/XSS/CSRF), safe file-upload handling if
  applicable, no secrets committed or logged, no insecure defaults introduced. `dev-agent:reviewer`'s
  Security verdict (`PASS`/`FAIL`/`NOT APPLICABLE`, with evidence) is what this category reports.
- **Performance** — no N+1 queries introduced, no unnecessary requests, pagination where a list
  could grow unbounded, indexes where a new query pattern needs one, no obviously wasteful
  client-side re-renders for frontend work. `dev-agent:reviewer`'s Performance verdict is what this
  category reports.
- **Quality** — tests exist and pass, the project builds, lint/type-checking passes where the
  project has it configured, the reviewer's findings were actually addressed, not just acknowledged.
- **Documentation** — architecturally significant decisions recorded (`.devagent/decisions.md` and,
  where genuinely reusable, Obsidian's `Key Decisions.md`), Obsidian updated per the existing
  protocol (stage 16 above).

Never report success without an actual PASS from the tester and APPROVED from the reviewer (with no
blocking Security/Performance findings). If you stop early due to a blocker, say so explicitly,
report `INCOMPLETE`, and explain what's needed to continue — see No false completion in
`docs/deep-execution.md`.
