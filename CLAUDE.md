# CLAUDE.md — dev-agent plugin source repo

This repo IS the source of the `dev-agent` Claude Code plugin. The actual runtime behavior that
ships to target projects lives in `agents/*.md` and `commands/*.md` at the repo root (plugin
convention — see `.claude-plugin/plugin.json`) — those files must stay self-contained, since a
target project has no access to this file.

This CLAUDE.md only governs sessions working ON this repo (developing the plugin itself).

## Workflow the plugin implements (see `commands/implement.md` for the authoritative version)

Default (bug fix / small change — unchanged since before `architect`/`ux-designer`/
`frontend-developer` existed):

```
Understand → Research (researcher) → Plan → Implement (developer) → Test (tester)
   → Review (reviewer) → Definition of Done → PASS+APPROVED → done
                        → FAIL / CHANGES REQUIRED → back to developer → Test again
```

Full pipeline (new project / major feature — "One-Shot Project Builder"):

```
Idea → Architect → Research (researcher) → UX Designer → Implement (developer + frontend-developer)
   → Test (tester) → Review (reviewer) → Definition of Done → PASS+APPROVED → done
                    → FAIL / CHANGES REQUIRED → back to the owning implementer → Test again
```

`commands/implement.md` → Stage selection decides which stages a given task actually needs — most
tasks still take the default path. If you change this workflow, edit `commands/implement.md` (what
ships), then reflect the change here for anyone developing the repo.

## Working on this repo

1. Preserve the plugin-standard layout: `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`
   at the root, `agents/*.md` and `commands/*.md` as top-level directories (not nested under `.claude/`).
2. `.claude/settings.json` in this repo governs permissions for sessions working ON this repo only —
   it does not travel with the plugin to target projects. A target project's own safety comes from
   (a) its own settings, and (b) each agent's `tools:` frontmatter allowlist, which does travel with
   the plugin (see `agents/*.md`).
3. `workspace/sample-project/` is an optional local dev fixture for dogfooding the pipeline against
   something real. Nothing in `agents/` or `commands/` may reference it or any other hardcoded
   *target-project* path — the plugin must work against whatever project it's installed into. The
   one intentional exception is the Obsidian vault root (`D:\obsidian`, documented in
   `docs/obsidian-memory.md`) — that's the user's own global config, the same default their
   existing Obsidian workflow already assumes, not a target-project path.
4. After changing an agent or command, re-validate: `claude plugin validate . --strict`.

## Safety (non-negotiable, applies both to this repo and to what the plugin does in target projects)

- Never expose secrets. Never read or commit `.env` files.
- Never delete data or run destructive commands (`rm -rf`, `git reset --hard`, `git push --force`,
  DB drops) without explicit user confirmation.
- Never modify a project outside the one the user is currently pointing the agent at.
- Never assume database schema — inspect migrations/schema files, don't guess column names.
- Never claim a command succeeded without reading its actual output.
- Never hide or soften a test failure to make progress look better than it is.

## Memory

Two separate memory concepts, don't conflate them:

- `memory/` in *this* repo — notes about developing the dev-agent plugin itself (decisions made
  while building it, gotchas found). Not shipped, not read by installed instances of the plugin.
- The user's existing Obsidian vault (`D:\obsidian\work\active\<ProjectName>.md` and
  `D:\obsidian\brain\*.md`) — the actual knowledge layer for whatever target project dev-agent is
  running against. dev-agent does **not** ship its own memory store for target projects; it reads
  and writes the user's existing vault, using their existing note format, and does not add a
  competing hook for it (no `hooks` entry in `.claude-plugin/plugin.json` — the user's global
  `PreCompact` hook already triggers session-log writes; dev-agent's own completion step in
  `commands/implement.md` performs the identical write independently, with a dedup check). See
  `docs/obsidian-memory.md` for the full protocol and `docs/architecture.md` → Memory.

## Commands

`/analyze`, `/implement`, `/test`, `/review` — see `commands/`.
