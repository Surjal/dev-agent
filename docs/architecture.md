# Architecture

## Overview

`dev-agent` is a Claude Code **plugin** — an orchestration layer built entirely on Claude Code's
native plugin, subagent, and slash-command mechanisms. No custom orchestration engine, no external
process, no scripting layer sits between the user and the agents. Once installed, whatever Claude
Code session is running inside the *target project* becomes the orchestrator, driven by the
instructions in `commands/implement.md` (or a plain-language request, less reliably).

```
Target project (e.g. C:\Projects\LaravelApp, C:\Projects\MERNApp, ...)
  │
  ▼
Claude Code session running there, with dev-agent installed and enabled
  │
  ▼
Orchestrator (this session, driven by commands/implement.md)
  │
  ├─▶ architect          (read-only — only for a new project or a major feature)
  ├─▶ researcher         (read-only — always)
  ├─▶ ux-designer        (read-only — only when UI is in scope)
  ├─▶ developer          (read/write — backend/general implementation)
  ├─▶ frontend-developer (read/write — only when UI is in scope)
  ├─▶ tester             (read-only, runs commands)
  └─▶ reviewer           (read-only)
```

Not every stage runs on every task — `commands/implement.md` → Stage selection decides which apply.
A bug fix still only invokes `researcher` → `developer` → `tester` → `reviewer`, unchanged from
before `architect`/`ux-designer`/`frontend-developer` existed; those three only join in for a new
project or a feature that genuinely needs a spec and/or new UI (the "One-Shot Project Builder"
path).

Because the plugin is installed independently of any one project, the same `agents/` and
`commands/` ship unchanged to a Laravel app, a React app, a plain Node service, or anything else —
`researcher` and `frontend-developer` are each responsible for detecting what they're actually
looking at (see `agents/researcher.md` → Stack detection and `agents/frontend-developer.md` →
Stack detection).

## Why native plugin/subagent mechanisms, not custom code

Claude Code already provides:

- **Plugins** (`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`): a distributable
  unit that bundles agents and commands and can be installed into any project via `claude plugin
  install`, independent of that project's own files.
- **Subagents** (`agents/*.md`, top-level in the plugin, per plugin convention): a name,
  description, allowed tool list, and system prompt. The orchestrating session invokes one by name
  and gets back a final report; the subagent runs in its own context window, isolated from the
  orchestrator's.
- **Tool scoping per subagent**: `researcher`, `tester`, `reviewer`, `architect`, and `ux-designer`
  are given `Read, Grep, Glob, Bash` only (no `Edit`/`Write`) — enforcing "read-only" at the
  tool-permission level, not by asking the model nicely. This scoping is baked into the plugin and
  travels with it to every installation.
- **Slash commands** (`commands/*.md`, top-level in the plugin): reusable prompt templates
  (`/analyze`, `/implement`, `/test`, `/review`) that pre-load the right delegation instructions —
  self-contained, since a target project has no access to this plugin repo's own `CLAUDE.md`.

Given all of this, a custom "orchestration engine" would only duplicate what the CLI already does.
The only content this project contains is agent/command Markdown and plugin manifests — no bespoke
scripts implement control flow.

## Orchestrator

The orchestrating session's behavior is defined by `commands/implement.md` (invoked via
`/implement`, or approximated when a development task is described in plain language). Responsibilities:

1. Check the target project's Obsidian vault note (and brain files) for anything relevant, if
   reachable (see Memory below).
2. Understand the user's request without assuming the target stack.
3. Inspect the project directly for a first pass (stack markers, structure).
4. **Stage selection**: decide which of the seven stages this task actually needs — the default is
   the original four (`researcher` → `developer` → `tester` → `reviewer`); `architect`,
   `ux-designer`, and `frontend-developer` join in only when the task is a new project, or a
   feature big enough to need a real spec and/or touches UI. See `commands/implement.md` → Stage
   selection for the exact decision table.
5. If in scope, delegate to `architect` first — everything downstream works from its spec instead
   of a re-derived summary. Any genuinely business-critical open question it raises gets asked to
   the user before proceeding.
6. Delegate deeper investigation to `researcher` — always, even for "simple" tasks, regardless of
   whether `architect` ran.
7. Turn the researcher's plan (plus the architect's spec, if any) into an approved plan (surfacing
   risk/ambiguity to the user first if needed).
8. If UI is in scope, delegate to `ux-designer` for a design system before implementation starts.
9. Delegate backend/general implementation to `developer` and/or UI implementation to
   `frontend-developer`, per Stage selection, handing each the relevant upstream spec(s).
10. Delegate validation to `tester`.
11. On FAIL, loop: whichever implementer owns the failure (fix) → `tester` (re-validate) — until
    PASS or a genuine blocker.
12. On PASS, delegate to `reviewer`.
13. On CHANGES REQUIRED, loop: implementer (fix) → `tester` → `reviewer` — until APPROVED or a
    genuine blocker.
14. Run the Definition of Done gate (see below) — APPROVED is necessary but not sufficient.
15. Report to the user: concise summary, verdicts, Definition of Done result, remaining concerns.
16. Persist anything worth remembering to the Obsidian vault (see Memory below).

The orchestrator never implements directly and never declares success without both an actual PASS
and an actual APPROVED verdict having been produced by the respective subagents in this session,
and without the Definition of Done gate having actually been walked through.

## Decision making

Across every stage, the orchestrator (and `architect` specifically, when writing its spec) decides
rather than asks, in this order: (1) current project conventions, (2) the user's explicit
requirements, (3) this project's own Obsidian history, (4) cross-project Obsidian patterns/
decisions, (5) framework best practices, (6) sensible defaults. The user is asked only when a
decision is genuinely business-critical (can't be inferred from the project or safely defaulted)
— not for anything the hierarchy above already resolves. This is what keeps the One-Shot Project
Builder from turning "build a gas dealer management system" into twenty clarifying questions before
any work starts.

## Definition of Done

A reviewer verdict of APPROVED means the diff is sound; it doesn't by itself mean the feature is
finished. `commands/implement.md` → Definition of Done adds an explicit gate the orchestrator walks
before reporting completion, checking only the categories that apply to what was actually touched:
Product (requirements/journeys/edge cases), Frontend (responsive/states/validation/accessibility/
design consistency), Backend (API contracts/validation/authorization/error handling/relationships),
Performance (N+1/pagination/indexes), Security (auth enforcement/injection/CSRF/uploads/secrets),
Quality (tests/build/lint/reviewer findings addressed). A pure backend task skips the Frontend
category entirely (and says so), rather than the gate being force-fit onto work that never touched
a UI.

## Specialized agents

| Agent | Tools | Can modify files? | Purpose |
|---|---|---|---|
| `architect` | Read, Grep, Glob, Bash | No | Turn a high-level idea/major feature into a structured spec — goals, roles, permissions, features, journeys, pages, APIs, data model, business rules, auth, architecture, testing/deployment/non-functional requirements |
| `researcher` | Read, Grep, Glob, Bash | No | Detect stack, understand the problem, trace root cause, propose a plan |
| `ux-designer` | Read, Grep, Glob, Bash | No | Turn the architect's spec into an intentional UI/UX design system, extending any existing design system rather than replacing it |
| `developer` | Read, Edit, Write, Grep, Glob, Bash | Yes | Implement the approved plan (backend/general), smallest correct diff, follow existing conventions |
| `frontend-developer` | Read, Edit, Write, Grep, Glob, Bash | Yes | Implement the ux-designer's design system in the project's actual detected frontend stack |
| `tester` | Read, Grep, Glob, Bash | No | Detect and run the project's real test/build/lint tooling, verdict PASS/FAIL |
| `reviewer` | Read, Grep, Glob, Bash | No | Senior-engineer review: correctness, architecture, security, performance, maintainability, test coverage, verdict APPROVED/CHANGES REQUIRED |

Read-only agents have no `Edit`/`Write` tool at all — this is enforced by Claude Code's
per-subagent tool allowlist, not by prompt instruction alone, and this scoping travels with the
plugin to every project it's installed into. `architect` and `ux-designer` are read-only by the
same principle as `researcher`: they specify, they don't implement — application code is always
written by `developer` or `frontend-developer`.

## Agent communication

Subagents don't talk to each other directly. The orchestrator is the only party that sees every
agent's output; it decides what to hand to the next agent and reformats/trims as needed (e.g. it
passes the tester's `## Errors` section verbatim to the developer on a FAIL, rather than the
developer re-running tests itself to discover them). This keeps each subagent's context small and
focused, and keeps the loop-control logic (retry, escalate, stop) in one place.

## Workflow

See the diagram in the Overview and `commands/implement.md` for the authoritative rules. In short:
no step is skipped, and the loop back to `developer` on failure is bounded by "genuine blocker"
detection — the orchestrator must stop and ask the user rather than retry indefinitely against an
ambiguous requirement or a missing credential.

## Memory

dev-agent does not ship its own memory store for target projects. It integrates with the user's
existing Obsidian vault instead — a workflow they already run manually, already defined in their
global `CLAUDE.md`. Building a second, parallel memory system would mean two sources of truth for
the same information; instead:

```
Target project (source code, deps, config, schema — always authoritative)
      │
      └── dev-agent
              │
              ▼
      D:\obsidian  (historical context, read + write)
              │
      ┌───────┼────────┬──────────┐
      ▼       ▼         ▼         ▼
  work\active\   brain\Key      brain\      brain\
  <ProjectName>  Decisions.md   Gotchas.md  Patterns.md
       .md
```

Full protocol (project detection, exact paths, read/write steps, format) is in
`docs/obsidian-memory.md` — kept out of this file and out of the always-loaded command prompts to
save tokens, per the same reasoning real-world plugins use for reference material.

In short:

- **Read**, at the start of `/implement` and `/analyze`: the project's own vault note plus the
  three brain files, filtered to what's relevant, always treated as historical context to verify
  against current code — never as current truth.
- **Write**, at the natural completion of `/implement`: a Session Log entry in the project's vault
  note (same format the user's existing Obsidian workflow already uses), Active
  Work/Completed-Milestones/Related updates, and — only when something is genuinely reusable — a
  brain-file entry tagged `[[<ProjectName>]]`.
- **Project detection** is deterministic: git remote → project config `name` field → repo/directory
  name, never parsed from arbitrary source text. See `docs/obsidian-memory.md` → Project detection.
- **No competing hook**: the user's global `PreCompact` hook already forces a session-log write via
  a literal `<obsidian-wrap-up>` block; dev-agent's plugin manifest has no `hooks` entry and never
  will. `/implement`'s own write step performs the identical write independently and checks for an
  existing entry first, so the two triggers don't produce duplicate Session Log entries.
- No credentials, tokens, or secrets are ever written to the vault — an explicit instruction in
  `commands/implement.md`, since the vault lives outside any target project's own
  `.claude/settings.json` and can't be relied on to block it at the tool layer (see Safety model).

This repo's own `memory/` directory is unrelated — it holds notes about developing the dev-agent
plugin itself and is never read by an installed instance of the plugin, and never receives
target-project data.

### Planned future work: RAG/semantic search over the vault

Explicitly deferred. No vector database, embeddings, or external database is introduced by this
integration — the Obsidian vault (plain Markdown, read/grepped directly) is the first memory layer.
If the vault grows large enough that keyword search over it stops being sufficient, semantic search
over the same files would slot in at the Read step above without changing what gets written or
where — the vault stays the source of truth either way.

## Safety model

Enforced at two layers, one of which travels with the plugin and one of which doesn't:

1. **Tool-permission layer, travels with the plugin**: each read-only agent's `tools:` frontmatter
   omits `Edit`/`Write` entirely — the model cannot bypass this with clever phrasing, because the
   tool call itself doesn't exist for that agent, in any project it's installed into.
2. **Tool-permission layer, local to the target project**: if the target project has its own
   `.claude/settings.json` with `deny`/`ask` rules (blocking `rm -rf`, `git push --force`, `.env`
   reads, etc.), those apply on top of (1). This plugin does not and cannot ship or override a
   target project's permission configuration — that would mean one plugin dictating another
   project's security policy, which Claude Code's model correctly doesn't allow. This repo's own
   `.claude/settings.json` only governs sessions developing *this* plugin.
3. **Prompt layer** (each agent's Rules section, `commands/*.md`): never expose secrets, never
   assume schema, never claim untested success, never hide failures, ask before destructive ops,
   prefer reversible changes.

Obsidian vault access follows the same two tool-permission layers as anything else the orchestrator
touches — it is not special-cased or given elevated access. If the target project's own permission
settings deny reads/writes outside its own directory tree, vault access fails the same way any
other out-of-project file access would, and dev-agent skips it silently rather than trying to work
around the denial (see `docs/obsidian-memory.md`). dev-agent also self-limits scope regardless of
what's technically permitted: it only ever touches the one project note and the three named brain
files, never globs or reads the rest of the vault, and never writes secrets there.

Read-only agents (`researcher`, `tester`, `reviewer`) additionally have no `Edit`/`Write` tool at
all, so "never modifies files" is structural, not just instructed, everywhere the plugin runs.

## Future extensions

This structure is meant to grow without a redesign — `architect`, `ux-designer`, and
`frontend-developer` were added this way, without touching `researcher`/`developer`/`tester`/
`reviewer` or breaking the original 4-stage path:

- **Visual QA (next recommended capability)** → a `qa-browser`-style subagent using Playwright/
  Chrome MCP tools, invoked after `frontend-developer` and before (or as part of) `tester`, to
  actually look at what got built: does it render, is it responsive at the breakpoints
  `ux-designer` specified, do the loading/empty/error states really appear. Deliberately not built
  yet — everything up to this point (architect spec, UX spec, frontend implementation, tests,
  review) can be validated without a browser; this is the first capability that genuinely needs one.
- **Persistent memory** → the Obsidian integration (see Memory above) already replaces what would
  have been a custom store; a further step (Postgres + vector store + RAG) would sit behind the
  same read/write interface `commands/implement.md` already uses, without changing the agents.
- **RAG** → add a `researcher`-adjacent retrieval step (or a new `retriever` subagent) that queries
  a vector store before/alongside filesystem search; slot it into the Research step of the
  workflow.
- **GitHub integration** → add an `agents/github.md` subagent (or extend `developer`) scoped to
  PR/issue tools via an MCP server; the orchestrator gains an "open PR" step after Review passes.
- **Databases** → add a `dba`-style read-only subagent for schema inspection, kept separate from
  `developer` so schema assumptions stay checked.
- **Deployment tools** → add a `deployer` subagent, gated behind explicit user confirmation per the
  Safety Model, invoked only after Review is APPROVED.
- **Additional specialized agents** — each new capability should be a new `agents/*.md` file (at
  the plugin's top level, not nested under `.claude/`) with the narrowest tool allowlist that does
  the job, following the same read-only-unless-necessary pattern used here.
