---
description: Full pipeline for a dev task -- capability detection, architect (if needed), research, design (if needed), implement, test, visual QA (if available), review, iterate on failure
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
enforces this boundary at the tool layer for every `Edit`/`Write`/`Bash` call in the session,
regardless of what any agent believes the project is — see `docs/project-boundary.md` for exactly
what that guarantees and what it doesn't (it is not a full sandbox; read that section before
assuming more than it actually provides).

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
the cost of always invoking the full pipeline is needless overhead on every trivial request.

## Decision making

Across every stage, decide rather than ask, in this order — stop at the first source that resolves
it: (1) current project conventions, (2) the user's explicit requirements, (3) this project's own
Obsidian history, (4) cross-project Obsidian patterns/decisions, (5) framework best practices,
(6) sensible defaults. Ask the user only when a decision is genuinely business-critical or unsafe
to infer — never for things the hierarchy already resolves (e.g. which CSS framework, when the
project already uses one; whether to validate input — obviously yes). `dev-agent:architect` applies
this same hierarchy when writing its spec — see `agents/architect.md`.

## Steps

Establish Target project boundary above first, with `Status: VERIFIED`, before step 0.

0. Determine `<ProjectName>` and check the user's Obsidian vault for relevant historical context
   (`D:\obsidian\work\active\<ProjectName>.md` and the three `D:\obsidian\brain\*.md` files) —
   see `docs/obsidian-memory.md` for the exact project-detection algorithm, paths, and how to
   weigh historical notes against current codebase evidence. Skip silently if the vault or those
   specific files aren't reachable.
1. Run Capability detection above and present the CAPABILITIES report.
2. Understand the request. Inspect the project yourself first (stack, structure) — don't assume.
   Apply Stage selection above and state which stages you're running and why, briefly.
3. If `architect` is in scope: delegate to `dev-agent:architect`, hand its full specification to
   every later stage instead of re-summarizing it yourself. If any `Open Questions` in its output
   are genuinely business-critical, ask the user before proceeding; otherwise proceed.
4. Delegate investigation to `dev-agent:researcher` — always, regardless of stage selection above.
   If an architect spec exists, give the researcher that spec as context for what to look for.
5. Turn the researcher's `Implementation Plan` (plus the architect's spec, if any) into a concrete
   plan. If the plan looks risky or ambiguous, surface that to the user before proceeding rather
   than guessing.
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
10. If the tester's verdict is FAIL: send the failure output back to whichever of
    `dev-agent:developer` / `dev-agent:frontend-developer` owns the failing area to fix, then
    re-run `dev-agent:tester`. Repeat until PASS or until you hit a genuine blocker (e.g. missing
    credentials, ambiguous requirement, conflicting constraint) — in which case stop and ask the
    user.
11. If `visual-qa` is in scope (UI in scope and Playwright available), delegate to
    `dev-agent:visual-qa` once the tester reports PASS. If its `Overall Result` is FAIL: send its
    findings back to `dev-agent:frontend-developer` to fix, then re-run `dev-agent:tester` and
    `dev-agent:visual-qa` again (in that order) — the same failure-recovery loop as tester, just one
    stage further. Repeat until PASS or a genuine blocker. Never send known visual-qa failures
    straight to `reviewer` — the loop closes here first.
12. Once `tester` is PASS (and `visual-qa` is PASS or was never in scope), delegate to
    `dev-agent:reviewer`.
13. If the reviewer's verdict is CHANGES REQUIRED: send the specific issues back to whichever
    implementer owns them, then re-run `dev-agent:tester` (and `dev-agent:visual-qa`, if it was in
    scope) and `dev-agent:reviewer` again. Repeat until APPROVED or a genuine blocker.
14. Run the Definition of Done gate below. A reviewer APPROVED is necessary but not sufficient —
    walk through every applicable category explicitly before declaring the task complete.
15. Give the user a concise final report: what changed, what was tested, the review verdict, the
    Definition of Done result (including whether visual-qa ran, passed, or was skipped and why),
    and any remaining concerns flagged as non-blocking.
16. Perform the Obsidian write step from `docs/obsidian-memory.md`: append a Session Log entry to
    `D:\obsidian\work\active\<ProjectName>.md`, update Active Work / Completed Milestones / Related,
    and — only if the session surfaced genuinely reusable knowledge — append to the relevant
    `Key Decisions.md` / `Gotchas.md` / `Patterns.md` brain file, tagged `[[<ProjectName>]]`. A
    visual-qa finding is only brain-worthy if it's a reusable gotcha/pattern/decision, not a
    one-off bug — don't dump every browser-test result into the brain. Check first whether an
    entry for this session already exists (e.g. written by the existing `<obsidian-wrap-up>`
    PreCompact hook already) and extend rather than duplicate it. Never write secrets, credentials,
    or tokens there. Skip silently if the vault isn't reachable.

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
- **Performance** — no N+1 queries introduced, no unnecessary requests, pagination where a list
  could grow unbounded, indexes where a new query pattern needs one.
- **Security** — authentication and authorization enforced (not just present), input validation at
  every trust boundary, no injection risk (SQL/command/XSS), CSRF protection where the framework
  needs it, safe file-upload handling if applicable, no secrets committed or logged.
- **Quality** — tests exist and pass, the project builds, lint/type-checking passes where the
  project has it configured, the reviewer's findings were actually addressed, not just acknowledged.

Never report success without an actual PASS from the tester and APPROVED from the reviewer. If you
stop early due to a blocker, say so explicitly and explain what's needed to continue.
