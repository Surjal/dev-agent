# Capability Detection Reference

Detailed reference for `commands/implement.md` and `commands/analyze.md`'s capability-detection
step — kept out of the always-loaded command prompts to save tokens, same reasoning as
`docs/obsidian-memory.md`.

## Why detection, not a permanent agent

Capability detection is a handful of cheap, read-only checks (a few `command -v`/`--version`
calls, a couple of file/dependency-manifest reads). It doesn't need its own subagent, its own
context window, or its own orchestration step beyond "run these checks once, early, and remember
the results for the rest of the session." The orchestrator runs it directly, the same way it
already inspects the project directly before delegating to `researcher`.

## What gets detected, and how

Every check below is **read-only** — inspecting what's already there, never installing, never
modifying a manifest, never downloading a browser. If a check can't produce a confident answer
without taking an action (installing something, running an ambiguous command), the answer is
"unavailable" — capability detection never guesses generously.

| Capability | How it's determined |
|---|---|
| Claude Code | Always `available` — you're running inside it. |
| Frontend framework | Reuse `agents/researcher.md` → Stack detection (marker files: `package.json` + framework deps, `vite.config.*`, etc.). `none` if the project has no frontend. |
| Backend framework | Same marker-file detection, backend side (`composer.json`/`artisan`, `requirements.txt`+`fastapi`, `package.json`+`express`, etc.). `none` if there's no backend in scope. |
| Node / npm / pnpm / yarn / bun | `command -v <tool>` (or `where` on Windows) — report each that resolves; irrelevant/omit for non-JS projects. |
| Git | `git --version` succeeds and the target directory is a git repo (`git rev-parse --git-dir`). |
| GitHub | `gh --version` succeeds **and** `gh auth status` reports an authenticated account. Either failing → `unavailable`. |
| Test runner | Reuse `agents/tester.md`'s own detection (npm scripts, `phpunit`/`pest`, `pytest`, etc.) — surfaced explicitly in the capability report rather than only discovered later when `tester` runs. |
| Playwright | See below — its own subsection, since it's the one with behavioral consequences. |
| Browser | Currently derived 1:1 from Playwright (see below) — listed as a separate row because a future browser-automation technology could satisfy it without Playwright specifically; the plugin doesn't hardcode "browser == Playwright" as a permanent assumption, just as the current one. |
| Obsidian | Vault root (default `D:\obsidian`) plus the specific note/brain-file paths reachable — same probe `docs/obsidian-memory.md` already defines. `unavailable` if the vault root or those specific files can't be read (missing, or denied by the target project's permissions). |

### Playwright detection — the one with consequences, so precise

Playwright is `available` for a task only when **both** are true:

1. The **target project itself** already depends on it: `package.json` lists `@playwright/test` or
   `playwright` under `dependencies`/`devDependencies`, **or** a `playwright.config.*` file exists
   at the project root.
2. `npx --no-install playwright --version` (or the project's own equivalent script, e.g.
   `npm run <playwright-script> -- --version` if one exists) actually succeeds — confirming the
   package is really installed in `node_modules`, not just listed in `package.json` with a stale
   lockfile.

If either check fails, Playwright is `unavailable` for this task — **full stop, do not try to make
it available**. Specifically never, as part of detection or as a reaction to it being unavailable:

- `npm install playwright` / `npm install @playwright/test` / any package manager equivalent
- `npx playwright install` (browser binary download)
- Any edit to `package.json` "because Playwright was missing"

This is deliberately conservative: Playwright being installed *somewhere on the user's machine*
(a global cache, another project) does not make it "available" for *this* project — availability
is scoped to what the current project can already run without dev-agent changing anything. A
machine that has Playwright's browser binaries cached from unrelated prior use is not evidence the
current project can run Playwright tests; only the current project's own dependency manifest is.

The sole exception to "never install" anywhere in this document is the one-time First-run setup
check (`docs/first-run-setup.md`), which runs once per project, before this detection step, and
only installs Playwright after explicit user confirmation. Detection itself, every time it runs
after that, remains exactly as conservative as described above.

### Browser detection

For the current implementation, "Browser: available" is the same signal as "Playwright: available"
— there's no other browser-automation path implemented yet. `dev-agent:visual-qa` is the one that
actually confirms browsers launch in practice (by running real tests); capability detection only
reports whether the *precondition* for that (Playwright wired into this project) holds.

## Report format

Present detected capabilities in exactly this shape before stage selection, so the user and every
downstream agent see the same picture:

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

Values are never hardcoded or assumed from a prior session — run the checks every time
`/implement` starts, since the target project (and therefore its capabilities) changes between
invocations of a reusable plugin. `/analyze` is investigation-only and doesn't branch on
Playwright/frontend-implementation capability, so it doesn't need the full report — it still
consults Obsidian (see `docs/obsidian-memory.md`), just not this capability list.

## Consequences downstream

- **`frontend-developer`**: if Playwright is `available`, it's responsible for writing the
  Playwright test files (`*.spec.ts` or the project's existing convention) alongside the UI it
  implements — the same way it already writes `tester`-runnable tests today. If Playwright is
  `unavailable`, it implements the UI without Playwright specs; regular tests (via `tester`) still
  apply.
- **`dev-agent:visual-qa`**: only invoked when Playwright is `available` (see Stage selection in
  `commands/implement.md`). It runs and inspects existing/newly-written Playwright tests — it does
  not author new ones itself (it has no `Edit`/`Write`, matching every other read-only agent in
  this plugin).
- **Definition of Done**: Browser-based QA is `PASS` or `SKIPPED — capability unavailable`, never
  silently upgraded to `PASS` when it was actually skipped.
