# dev-agent

A reusable Claude Code **plugin**: a deep, autonomous AI developer agent. Every `/implement` run
follows the same 15-stage lifecycle by default (Deep Mode — there is no separate fast mode; see
`docs/deep-execution.md`) — target verification, project discovery, Obsidian history, architecture/
UX design when needed, research, implementation, testing, visual QA when available, security/
performance/final review, an explicit Definition of Done, and an Obsidian write-back — looping back
to the relevant agent on test failure or review rejection, with no fixed retry cap. A bug fix skips
most of that pipeline explicitly (`SKIPPED — NOT APPLICABLE`, not silently omitted); a new project or
major feature runs the full **One-Shot Project Builder** path — Architect → Research → UX Design →
Implement (backend + frontend) → Test → **Visual QA (when available)** → Security/Performance/Final
Review — turning a high-level idea into a working, reviewed implementation with minimal
back-and-forth. `/implement` picks which stages a given task actually needs, including whether real
browser QA is even possible in the current environment; see Stage selection in
`commands/implement.md`.

Execution state persists inside the target project (`.devagent/`), so a long-running `/implement`
can survive an interruption — `/implement --resume` re-verifies the target boundary, cross-checks
the recorded state against the real repository (never trusting the state file blindly), and
continues from the actual current stage. See `docs/deep-execution.md`.

Framework-agnostic — the `researcher` agent inspects the target project's own files (`package.json`,
`composer.json`, `requirements.txt`, etc.) to detect its stack rather than assuming one. Verified
against Laravel, React/Vite, and plain Node.js projects; not limited to those.

No custom orchestration engine — this is entirely Claude Code's native plugin/subagent/command
system. See `docs/architecture.md` for the full design.

## Installation

**As a local marketplace (for development or before publishing anywhere):**

```bash
claude plugin marketplace add /path/to/dev-agent
claude plugin install dev-agent@dev-agent
```

**From a git remote**, once this repo is pushed somewhere (e.g. GitHub):

```bash
claude plugin marketplace add https://github.com/surjal/dev-agent
claude plugin install dev-agent@dev-agent
```

Both commands accept `-s/--scope user|project|local` — use `project` to make it available to
everyone who opens that specific project, `user` (the default) to make it available everywhere you
run Claude Code.

## Enabling / disabling

```bash
claude plugin list                # confirm it's installed and enabled
claude plugin details dev-agent   # see its agents/commands and projected token cost
claude plugin disable dev-agent   # turn off without uninstalling
claude plugin enable dev-agent
```

## Configuration

None required. The plugin ships no `userConfig` schema — it works out of the box against any
project once installed and enabled.

## Permissions

The plugin does **not** ship or override any project's `.claude/settings.json` — it can't, since it
runs inside whatever project it's installed into, and that project's own permission rules are what
govern tool use there (native Claude Code behavior, not something this plugin can or should bypass).

What the plugin *does* control, and what travels with it to every project:

- Each read-only agent (`researcher`, `tester`, `reviewer`, `architect`, `ux-designer`,
  `visual-qa`) is defined with `tools: Read, Grep, Glob, Bash` in its frontmatter — no `Edit`/
  `Write` tool is granted to them at all. This is enforced by Claude Code itself, not by the
  agent's own judgment. Each of these agents is also explicitly instructed not to route around the
  missing tools via `Bash` shell redirection (`>`, `cp`, `sed -i`, etc.) — omitting Edit/Write only
  guarantees read-only behavior if the agent doesn't use Bash to write files instead, so the rule is
  written into every read-only agent's prompt, not just implied by the missing tools.
  `architect` and `ux-designer` produce specifications only — they never write application code.
  `visual-qa` runs and inspects the project's existing Playwright tests — it never authors new
  ones (that's `frontend-developer`'s job, same as it already writes `tester`-runnable tests).
- `developer` and `frontend-developer` have `Edit`/`Write` — the only two agents that modify files.

If the target project has its own `.claude/settings.json` with `deny`/`ask` rules (e.g. blocking
`.env` reads or `git push --force`), those still apply on top of the above — install this plugin
into a project with sane permissions already configured for the best safety posture.

Obsidian vault access (see Memory below) is not special-cased — it's governed by the same
permission layers as any other file access. If the target project's settings deny reaching outside
its own directory, vault reads/writes fail the same way and dev-agent skips them silently rather
than working around the denial. dev-agent also self-limits regardless of what's technically
permitted: only the one project note and the three named brain files, nothing else in the vault.

Playwright/browser access is likewise never special-cased or auto-granted: `dev-agent:visual-qa`
only runs `npx playwright test` (or the project's own equivalent script) via its existing `Bash`
permission — same rule as everything else it runs, no elevated capability, and it never triggers
an install (see Capability detection below).

## Target project boundary

v1.3.0 adds a `PreToolUse` hook (`hooks/project-boundary-guard.cjs`, auto-loaded via
`hooks/hooks.json`) that runs before every `Edit`/`Write`/`NotebookEdit`/`MultiEdit`/`Bash` tool
call and blocks any that resolve outside the verified target project root — this closes a real
incident found during v1.2.0 testing, where a session working on a throwaway project instead
modified a file in an unrelated real project.

This is genuine tool-layer enforcement, not just an instruction: the hook reads the actual session
`cwd` (supplied by Claude Code, not derived from what the model believes) and the tool call's
actual resolved path, and can block the call outright before it executes. It correctly:

- Blocks writes to a sibling project, a parent directory, or an unrelated tree.
- Resolves `../` relative traversal before checking — including `..` embedded inside an *absolute*
  path (`D:\proj-a\..\proj-b\x`), a real gap found and fixed in v1.3.1 (v1.3.0 only normalized
  relative input).
- Resolves symlinks/junctions before checking, so a link planted inside the project root pointing
  outside it doesn't defeat the containment check.
- Does **not** get fooled by a `project-a` vs. `project-ab` string-prefix — true path containment,
  not `startsWith`.
- Still works when a parent directory's own `CLAUDE.md` describes a different project (Claude
  Code's CLAUDE.md discovery walking up directories doesn't change what the hook checks against).
- Allows the two specific Obsidian paths the existing memory protocol already documents, and
  nothing else outside the project.

**Read this honestly, not optimistically**: this is a best-effort heuristic for `Bash` (it scans
command text for path-like tokens and mutating verbs — it does not parse/execute shell syntax). As
of v1.3.1 the guard **fails closed**: anything it cannot positively verify — malformed input, an
unresolvable path, an internal exception — denies the tool call rather than allowing it (v1.3.0
failed open on these). The one condition still outside its control: if the hook *process itself*
can't start (Node missing from `PATH`, etc.), Claude Code allows the tool call, since the guard
never runs at all — Node is a hard prerequisite for this plugin's safety guarantee, not just its
function. It is not a filesystem-level sandbox. Full design, exact guarantees, and known
limitations: `docs/project-boundary.md`.

## Capability detection

`/implement` detects what the current environment and target project actually support before
picking stages — never assumed, never hardcoded, re-checked every run:

```
CAPABILITIES

Claude Code: available
Frontend: React
Backend: Laravel
Playwright: available
Browser: available
Git: available
GitHub: unavailable
Obsidian: available
```

The one with real behavioral consequences is Playwright: it's "available" only when the **target
project itself** already depends on it (`package.json`/`playwright.config.*`) *and* the package
actually resolves in `node_modules` — never because Playwright happens to be cached or installed
somewhere else on the machine. dev-agent **never** installs Playwright, never downloads browser
binaries, and never edits `package.json` just because Playwright is missing — a project without it
is a normal, expected result, not an error condition. Full detection rules: `docs/capabilities.md`.

## Agents

| Agent | Role | Tools |
|---|---|---|
| `architect` | Turns a high-level idea/major feature into a structured spec: goals, roles, permissions, features, journeys, pages, APIs, data model, business rules, auth, architecture, testing/deployment/non-functional requirements | `Read, Grep, Glob, Bash` (no edit) |
| `researcher` | Investigates architecture, traces execution flow, finds root cause, proposes a plan | `Read, Grep, Glob, Bash` (no edit) |
| `ux-designer` | Turns the architect's spec into an intentional UI/UX design system — IA, layouts, components, every UI state, responsive/accessibility — extends an existing design system rather than replacing it | `Read, Grep, Glob, Bash` (no edit) |
| `developer` | Implements the approved plan (backend/general), smallest correct diff, follows existing conventions | `Read, Edit, Write, Grep, Glob, Bash` |
| `frontend-developer` | Implements the ux-designer's design system in the project's actual detected frontend stack — layouts, pages, components, all UI states, responsive, accessibility | `Read, Edit, Write, Grep, Glob, Bash` |
| `tester` | Detects and runs the project's real test/build/lint tooling, verdicts PASS/FAIL | `Read, Grep, Glob, Bash` (no edit) |
| `visual-qa` | Runs the project's existing Playwright tests, inspects screenshots/console/network evidence, checks functional/visual/responsive/UX-state/accessibility behavior in a real browser. Only invoked when Playwright is genuinely available. Never authors new test files. | `Read, Grep, Glob, Bash` (no edit) |
| `reviewer` | Senior-engineer review: correctness/architecture/security/performance/maintainability/testing, verdicts APPROVED/CHANGES REQUIRED | `Read, Grep, Glob, Bash` (no edit) |

Once installed, these are namespaced Task subagents: `dev-agent:architect`, `dev-agent:researcher`,
`dev-agent:ux-designer`, `dev-agent:developer`, `dev-agent:frontend-developer`, `dev-agent:tester`,
`dev-agent:visual-qa`, `dev-agent:reviewer`. The bundled commands already delegate using the
fully-qualified names — if you write your own prompt that delegates manually, use the qualified
name too, since the bare word ("researcher", etc.) does not reliably resolve once installed as a
plugin.

Not every task uses every agent — `/implement` selects which stages apply based on the task's
actual scope *and* detected capabilities (see Stage selection in `commands/implement.md`). A bug
fix still only invokes `researcher` → `developer` → `tester` → `reviewer`, exactly as before;
`architect`/`ux-designer`/`frontend-developer` only join in for new projects or UI-shaped feature
work, and `visual-qa` only joins in when there's UI in scope **and** Playwright is genuinely
available in the target project — never invoked for a backend-only task, and explicitly reported
as **"Visual QA skipped: browser automation capability unavailable"** rather than silently omitted
when UI is in scope but Playwright isn't.

## Commands

| Command | Does |
|---|---|
| `/analyze <task>` | Investigation only, via `researcher`, no changes made |
| `/implement <task>` | Deep Mode by default (see `docs/deep-execution.md`) — runs whichever of the 15 stages the task needs (bug fix → the original 4-stage loop; new project/major feature → the full architect→...→reviewer pipeline), retrying on test failure or review rejection, with no fixed retry cap |
| `/implement --resume` | Re-verify the target boundary, read `.devagent/state.json`, cross-check it against the actual repository, and continue from the real current stage |
| `/implement --deep <task>` | Same as plain `/implement` — accepted as a no-op for explicitness, since Deep Mode is always on |
| `/test` | Run `tester` against the current working-tree changes |
| `/review` | Run `reviewer` against the current working-tree changes |

## Examples

**Laravel**
```
/analyze Find the performance problems in the booking module.
```

**React**
```
/implement Add pagination to the users table.
```

**Node.js**
```
/review Review the authentication changes in this project.
```

**Any project, safe dry-run**
```
/analyze Analyze this project and identify three potential performance problems without modifying any files.
```

**Frontend change, with real browser QA (only if the project has Playwright)**
```
/implement Fix the mobile nav menu -- it overflows the viewport on small screens.
```
`researcher` → `ux-designer` → `frontend-developer` → `tester` → `visual-qa` (runs the project's
existing Playwright tests at its own breakpoints, screenshots the actual failure) → `reviewer`. If
the project has no Playwright, the same pipeline runs minus `visual-qa`, and the report says so
explicitly instead of pretending browser QA happened.

**One-Shot Project Builder (new project or major feature)**
```
/implement Build a gas dealer management system with a public map and admin dashboard.
```
This runs the full pipeline: `architect` produces a spec (roles, entities, APIs, pages, auth,
business rules), `researcher` checks it against the actual project, `ux-designer` designs the UI,
`developer` and `frontend-developer` implement backend and frontend respectively, then
`tester`/`reviewer` validate — with the Definition of Done gate (see below) before it's called done.

## Definition of Done

`/implement` doesn't declare a task complete just because the reviewer said APPROVED. It walks a
checklist of the categories that actually apply to what was touched: **Product** (requirements/user
journeys/edge cases), **Frontend** — three parts: code-level checks, **Browser-based QA**, and
Responsive QA (only if UI was touched), **Backend** (API contracts, validation, authorization, error
handling, DB relationships — only if backend was touched), **Performance** (N+1 queries, pagination,
indexes), **Security** (auth enforcement, input validation, injection/XSS/CSRF, file uploads,
secrets), **Quality** (tests pass, build passes, lint/type-check, reviewer findings addressed).

Browser-based QA is always one of exactly two states: **`PASS`** (visual-qa genuinely ran and found
nothing blocking) or **`SKIPPED — capability unavailable`** (Playwright wasn't available) — a skip
is never silently upgraded to a pass. For a project where Playwright *is* available and UI changed,
Browser-based QA is normally required (i.e. must genuinely run and pass) before final approval; for
a backend-only task it isn't applicable at all. See `commands/implement.md` → Definition of Done
for the full list.

## Memory: Obsidian integration

dev-agent doesn't invent its own memory store — it plugs into the Obsidian vault workflow you
already run (defined in your global `CLAUDE.md`), using your existing note format:

```
D:\obsidian\work\active\<ProjectName>.md   # this project's running note
D:\obsidian\brain\Key Decisions.md         # cross-project decisions
D:\obsidian\brain\Gotchas.md               # cross-project bugs/traps
D:\obsidian\brain\Patterns.md              # cross-project reusable patterns
```

- **`/implement` and `/analyze` read** the project's note and the brain files at the start of a
  task, if relevant — always as historical context to check against the current codebase, never as
  a substitute for reading the current code. A gotcha from six months ago may no longer apply.
- **`/implement` writes**, at natural completion: a `## Session Log` entry, `## Active Work` /
  `## Completed Milestones` / `## Related` updates, and — only when something is genuinely
  reusable — a brain-file entry tagged `[[<ProjectName>]]`. `/analyze` never writes (read-only, like
  everything else it does).
- **`<ProjectName>` is detected deterministically**: git remote → `package.json`/`composer.json`
  `name` field → repo/directory name. Never parsed from arbitrary source text.
- **No competing hook.** Your existing global `PreCompact` hook already forces a session-log write
  (the `<obsidian-wrap-up>` block). dev-agent ships no hooks of its own — its write step performs
  the same write independently and checks for an existing entry first, so you don't get duplicate
  Session Log entries when both fire in the same session.
- The dev-agent repo's own `memory/` folder is unrelated (plugin dev notes only, never touched by
  an installed instance).

Full protocol, exact formats, and edge cases: `docs/obsidian-memory.md`. No vector database,
embeddings, or external database is introduced by this — plain Markdown, read/grepped directly, is
the first memory layer; semantic search is a possible later addition, not part of this.

## Troubleshooting

**`/analyze` or `/implement` isn't recognized** — confirm the plugin is enabled: `claude plugin
list`. If it's not listed, re-run the install command. If it's listed but a command still 404s,
restart the Claude Code session — plugin changes need a fresh session to take effect.

**Agents aren't being delegated to (the main session does the work itself)** — this is a model
judgment call, not a hard gate. Explicitly say "use the researcher subagent to investigate this
first" if it skips the step; `/analyze` and `/implement` already say this, but a plain-language
request might not trigger delegation as reliably.

**Tester reports no test suite found** — that's a real finding, not a bug. Add project tests, or
tell `/implement` what command to use to validate the change if the project has an unconventional
setup.

**Permission prompts for every tool call** — the target project's workspace probably hasn't gone
through Claude Code's trust dialog yet. Run `claude` (interactive, no `-p`) once in that project's
root and accept the trust prompt.

**Session Log entry didn't appear in the vault** — check the vault root (`D:\obsidian` by default)
actually exists and is reachable from the target project's session; dev-agent skips vault writes
silently rather than failing the whole task if it isn't. Also check `<ProjectName>` resolved to
what you expected — see `docs/obsidian-memory.md` → Project detection.

**Visual QA always skipped even though the project has Playwright** — check `package.json` lists
`@playwright/test`/`playwright` *and* `npx --no-install playwright --version` actually succeeds
(confirms it's really installed in `node_modules`, not just declared). A stale lockfile or a
`node_modules` that hasn't been installed yet both read as "unavailable" by design — dev-agent will
never run the install for you. Run your project's own install step, then re-run `/implement`.

**Visual QA created/modified a `playwright.config.*`** — this shouldn't happen; `visual-qa` has no
`Edit`/`Write` tools at all. If you see this, it means `frontend-developer` created it as part of
writing tests for a project that had none — check whether that's actually what you wanted, since
adding a first-time Playwright setup is a bigger step than adding a test to an existing one.

**Duplicate-looking Session Log entries** — check whether both the global `PreCompact` hook and
dev-agent's own write step fired in the same session; the dedup check compares by session/topic/date
and should merge them, but if the topics were phrased differently between the two triggers it may
not recognize them as the same entry. Manually merge if this happens and consider whether the two
descriptions can be made consistent.

## Architecture

See `docs/architecture.md` for the full design: why this is built entirely on native Claude Code
plugin/subagent/command mechanisms (no custom orchestration code), the safety model, the memory
model, the capability-detection model, and planned extensions (GitHub integration, RAG, deployment
agent). See `docs/deep-execution.md` for Deep Mode, the 15-stage lifecycle, persistent execution
state, and resume.

## Development

This repo *is* the plugin source. If you're modifying it:

```
dev-agent/
├── .claude-plugin/
│   ├── plugin.json        # plugin manifest
│   └── marketplace.json   # local marketplace manifest (source: "./")
├── agents/                # the 8 subagents — top-level, not under .claude/
├── commands/              # the 4 slash commands — top-level, not under .claude/
├── hooks/
│   ├── hooks.json               # auto-discovered PreToolUse registration
│   └── project-boundary-guard.cjs  # the boundary enforcement hook itself
├── docs/
│   ├── architecture.md
│   ├── obsidian-memory.md    # full Obsidian integration protocol
│   ├── capabilities.md       # full capability-detection reference (Playwright, etc.)
│   ├── project-boundary.md   # full target-project-boundary reference
│   └── deep-execution.md     # Deep Mode, stages, persistent state, resume, failure recovery
├── memory/                # notes about developing THIS plugin (not shipped)
├── workspace/sample-project/  # optional local dogfood fixture, gitignored
└── .claude/settings.json  # permissions for sessions working ON this repo only
```

After any change to `agents/` or `commands/`, validate the manifest:

```bash
claude plugin validate . --strict
```

See `CLAUDE.md` for the rules that govern development of this repo specifically.

## Roadmap

- [x] Persistent execution context / resume (v1.4.0) — `.devagent/` inside the target project
      (`state.json`, `plan.md`, `progress.md`, `decisions.md`, `failures.md`); `/implement --resume`
      re-verifies the boundary and cross-checks state against the actual repository rather than
      trusting it. See `docs/deep-execution.md`.
- [ ] A second browser-automation backend for `visual-qa` (e.g. Chrome DevTools MCP), for
      environments without Playwright but with a connected browser MCP server — the capability
      model already treats "Browser" as separate from "Playwright" specifically to allow this
      without redesigning `visual-qa` or `commands/implement.md`.
- [ ] Semantic search over the Obsidian vault, if plain keyword search stops scaling (explicitly deferred for now)
- [ ] RAG-based retrieval for large codebases the researcher can't fully read in one pass
- [ ] GitHub integration subagent (PRs, issues) via an MCP server
- [ ] Database-schema-aware subagent for projects with migrations
- [ ] Deployment subagent, gated behind explicit confirmation
