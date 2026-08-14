---
description: Full pipeline for a dev task -- architect (if needed), research, design (if needed), implement, test, review, iterate on failure
---

Run the full development workflow for this task:

$ARGUMENTS

This plugin's subagents are namespaced — their exact Task `subagent_type` values are
`dev-agent:architect`, `dev-agent:researcher`, `dev-agent:ux-designer`, `dev-agent:developer`,
`dev-agent:frontend-developer`, `dev-agent:tester`, `dev-agent:reviewer`. Always delegate using
these fully-qualified names, never the bare word ("researcher", "developer", etc.) — the bare name
does not reliably resolve to a real subagent call and silently falls back to doing the work inline
instead, which defeats the whole point of delegation.

Do not shortcut this by doing the research/design/implementation/testing/review yourself inline,
even when the change looks small. Task size is not a reason to skip delegation — actually call Task
with the `dev-agent:*` subagent_type for every stage that applies, every time.

## Stage selection

Not every task needs every stage. Decide which of the seven apply *before* starting, based on the
actual scope of the request — the four-stage core (`researcher` → `developer` → `tester` →
`reviewer`) is the default for anything that isn't a new project or a major feature with a UI:

| Task shape | Stages |
|---|---|
| Bug fix, small change, backend-only work, a migration, a script | `researcher` → `developer` → `tester` → `reviewer` (the default — no architect, no UX, no frontend-developer) |
| New page/UI feature on an existing app, using existing backend | `researcher` → `ux-designer` → `frontend-developer` → `tester` → `reviewer` (no architect unless it implies new entities/APIs, no backend `developer` unless the API needs changing too) |
| New API/entity with no new UI (backend-only feature) | `researcher` → `developer` → `tester` → `reviewer` (no architect for a small addition; no ux-designer/frontend-developer — nothing to design) |
| New project, or a feature big enough to need a real spec (new entities *and* new UI *and* new roles/permissions, etc.) | `architect` → `researcher` → `ux-designer` → `developer` → `frontend-developer` → `tester` → `reviewer` (the full pipeline) |

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

0. Determine `<ProjectName>` and check the user's Obsidian vault for relevant historical context
   (`D:\obsidian\work\active\<ProjectName>.md` and the three `D:\obsidian\brain\*.md` files) —
   see `docs/obsidian-memory.md` for the exact project-detection algorithm, paths, and how to
   weigh historical notes against current codebase evidence. Skip silently if the vault or those
   specific files aren't reachable.
1. Understand the request. Inspect the project yourself first (stack, structure) — don't assume.
   Apply Stage selection above and state which stages you're running and why, briefly.
2. If `architect` is in scope: delegate to `dev-agent:architect`, hand its full specification to
   every later stage instead of re-summarizing it yourself. If any `Open Questions` in its output
   are genuinely business-critical, ask the user before proceeding; otherwise proceed.
3. Delegate investigation to `dev-agent:researcher` — always, regardless of stage selection above.
   If an architect spec exists, give the researcher that spec as context for what to look for.
4. Turn the researcher's `Implementation Plan` (plus the architect's spec, if any) into a concrete
   plan. If the plan looks risky or ambiguous, surface that to the user before proceeding rather
   than guessing.
5. If `ux-designer` is in scope: delegate to `dev-agent:ux-designer` with the architect's spec (or
   a description of the requested UI change if there's no architect stage this time). Carry its
   design system forward to `frontend-developer`.
6. If backend/general implementation is needed: delegate to `dev-agent:developer`, handing it the
   plan (and architect spec, if any) verbatim.
7. If frontend implementation is needed: delegate to `dev-agent:frontend-developer`, handing it the
   plan, the architect spec (if any), and the ux-designer's design system (if any).
8. Delegate validation to `dev-agent:tester`.
9. If the tester's verdict is FAIL: send the failure output back to whichever of `dev-agent:developer` /
   `dev-agent:frontend-developer` owns the failing area to fix, then re-run `dev-agent:tester`.
   Repeat until PASS or until you hit a genuine blocker (e.g. missing credentials, ambiguous
   requirement, conflicting constraint) — in which case stop and ask the user.
10. Once the tester reports PASS, delegate to `dev-agent:reviewer`.
11. If the reviewer's verdict is CHANGES REQUIRED: send the specific issues back to whichever
    implementer owns them, then re-run `dev-agent:tester` and `dev-agent:reviewer` again. Repeat
    until APPROVED or a genuine blocker.
12. Run the Definition of Done gate below. A reviewer APPROVED is necessary but not sufficient —
    walk through every applicable category explicitly before declaring the task complete.
13. Give the user a concise final report: what changed, what was tested, the review verdict, the
    Definition of Done result, and any remaining concerns flagged as non-blocking.
14. Perform the Obsidian write step from `docs/obsidian-memory.md`: append a Session Log entry to
    `D:\obsidian\work\active\<ProjectName>.md`, update Active Work / Completed Milestones / Related,
    and — only if the session surfaced genuinely reusable knowledge — append to the relevant
    `Key Decisions.md` / `Gotchas.md` / `Patterns.md` brain file, tagged `[[<ProjectName>]]`. Check
    first whether an entry for this session already exists (e.g. written by the existing
    `<obsidian-wrap-up>` PreCompact hook already) and extend rather than duplicate it. Never write
    secrets, credentials, or tokens there. Skip silently if the vault isn't reachable.

## Definition of Done

The task is not done merely because code was written and the reviewer said APPROVED. Before the
final report, explicitly check every category that applies to what was actually touched this task
(skip a category entirely, and say so, if that layer wasn't touched — e.g. a pure backend task has
no Frontend category to check):

- **Product** — requirements actually implemented, user journeys complete end-to-end, edge cases
  handled (not just the happy path the tester happened to check).
- **Frontend** *(if UI was touched)* — responsive across mobile/tablet/desktop, loading/empty/error/
  success states present, form validation, accessibility, consistent with the existing design
  system (or the ux-designer's new one).
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
