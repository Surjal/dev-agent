# First-Run Setup Reference

Detailed reference for the one-time onboarding check `commands/implement.md` and
`commands/analyze.md` (and their OpenCode equivalents under `.opencode/commands/`) run before
Capability detection — kept out of the always-loaded command prompts, same reasoning as
`docs/obsidian-memory.md` and `docs/capabilities.md`.

## Gate

`.devagent/.onboarded` inside the target project root. If it exists, this whole step is skipped
silently — already asked once for this project, never re-asked. If it doesn't exist, this is the
first `/implement` or `/analyze` run for this project; run the checks below, then write it.

This runs **after** Target project boundary is `VERIFIED` (same as every other step) and **before**
Capability detection. It runs once per **project** (the marker lives inside that project's own
`.devagent/`), not once per session — it persists across every future invocation for that project,
same lifetime as the rest of `.devagent/`.

## What it asks

### Playwright

Only ask if **both**: the project has a detected frontend framework (Capability detection's
Frontend check, run early to decide this) **and** Playwright is currently `unavailable` per
`docs/capabilities.md`'s detection rules. If the project has no frontend, or Playwright is already
available, there is nothing to ask — record `not-applicable` / `already-available` and move on
silently.

Ask exactly once, plainly:

```
This project has a frontend but no working Playwright setup, so Visual QA can't run yet.
Install Playwright now? (npm install -D @playwright/test && npx playwright install, or this
project's own package manager equivalent) [y/n]
```

- **Yes**: run the install command via `Bash` (same tool-layer boundary guard as every other Bash
  call — no special exemption), then re-run the Playwright availability check from
  `docs/capabilities.md` to confirm it actually resolved — don't assume success just because the
  command exited 0. Report the real outcome (installed and verified, or installed but still not
  resolving — in which case treat Playwright as `unavailable` for this run and say why).
- **No**: record the decision, don't ask again for this project. `Playwright: unavailable` proceeds
  exactly as it already does today — a normal, expected result, not an error.

This is the **only** place in the entire workflow where dev-agent installs Playwright, and it only
does so after this explicit, one-time, per-project confirmation — every other mention of Playwright
detection elsewhere in this plugin (`docs/capabilities.md`, `commands/implement.md`'s Capability
detection step) still never installs anything on its own initiative.

### Obsidian

Only ask if the vault root (default `D:\obsidian`, per `docs/obsidian-memory.md`) or the specific
project/brain-file paths it defines aren't reachable. If they're already reachable, record
`already-available` and move on silently.

Ask exactly once:

```
No Obsidian vault found at D:\obsidian (or the paths docs/obsidian-memory.md expects aren't
reachable from this project). Provide a different vault root to use for this project, or
skip Obsidian memory here? [path / skip]
```

- **Path given**: verify it's reachable and has (or can have) the `work/active/` and `brain/`
  structure `docs/obsidian-memory.md` expects; if so, record it in `.devagent/.onboarded` as this
  project's vault root override, and use it for every future Obsidian step this project runs
  instead of the `D:\obsidian` default — without asking again. If it's not reachable either, say so
  and fall back to `skip` for this run (still don't error out the workflow over it).
- **Skip**: record the decision, never ask again for this project. Every Obsidian step in
  `/implement`/`/analyze` proceeds exactly as it already does when the vault is unreachable today —
  silent skip, no error.

## Marker file

```json
{
  "askedAt": "<ISO date>",
  "playwright": "installed | skipped | not-applicable | already-available",
  "obsidian": "configured | skipped | not-applicable | already-available",
  "obsidianVaultRoot": "<path, only present if the user supplied a non-default root>"
}
```

Written via the ordinary `Write` tool, subject to the same project-boundary guard as every other
file write. This file is separate from `.devagent/state.json` — it's a one-time onboarding record,
not part of the per-execution stage/progress tracking, so it must not be overwritten or reset by
`/implement --resume` or any other step.

## Invariants this must never violate

- Never installs anything **without** this explicit, one-time, per-project confirmation — no
  generous "just in case" installs, ever.
- Never re-asks, never re-installs, never re-prompts once `.devagent/.onboarded` exists — even if
  the recorded answer was "skip." The user revisits the decision by deleting or editing that file
  themselves; dev-agent doesn't nag.
- Never touches the real global vault unless the user is the one running this — this step never
  fabricates or assumes a vault path beyond what `docs/obsidian-memory.md` already documents as the
  default, and only overrides it when the user explicitly supplies one.
- Still goes through the same tool-layer boundary enforcement as everything else — this step has no
  special exemption from `hooks/project-boundary-guard.cjs` (Claude) or the equivalent OpenCode
  boundary plugin.
