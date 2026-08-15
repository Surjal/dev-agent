# OpenCode Port (v1.4.1)

`.opencode/` is a separate adapter that reproduces dev-agent's methodology on OpenCode's native
mechanisms. It does not modify anything under `agents/`, `commands/`, `hooks/`, `.claude-plugin/`,
`README.md`, `CLAUDE.md`, or `docs/` (pre-existing files) -- those remain the frozen Claude Code
reference implementation. Built and verified against OpenCode CLI v1.18.10.

## Mapping table

| Claude Code mechanism | OpenCode mechanism |
|---|---|
| Plugin (`.claude-plugin/plugin.json` + `marketplace.json`) | No plugin-manifest concept exists; OpenCode auto-discovers `.opencode/{agents,commands,plugins}/` per-project. No manifest file was added. |
| Subagent `.md` (`agents/*.md`, `tools:` frontmatter) | Agent `.md` (`.opencode/agents/*.md`, `mode: subagent` + `permission: {edit, write, bash}` frontmatter) |
| `Agent` tool, `subagent_type: "dev-agent:x"` | `task` tool, agent name `dev-agent-x` (colon replaced with a hyphen -- OpenCode agent names come from the filename, no namespace separator) |
| `Skill` tool (and the "don't confuse it with Agent" warning in every command) | Not applicable -- OpenCode's `skill` tool is a distinct, unrelated mechanism (loads `SKILL.md` reference docs on demand); there is no equivalent confusion risk to warn against, so that guidance was dropped rather than translated |
| Slash command `.md` (`commands/*.md`, `$ARGUMENTS`) | Command `.md` (`.opencode/commands/*.md`, `agent:` + `description:` frontmatter, `$ARGUMENTS`/`$1`/`$2` placeholders) -- same argument syntax, ported unchanged |
| `PreToolUse` hook (`hooks/hooks.json` + `project-boundary-guard.cjs`), matcher `Edit\|Write\|NotebookEdit\|MultiEdit\|Bash` | Plugin `tool.execute.before` hook (`.opencode/plugins/project-boundary-guard.js`), matched on tool ids `bash`/`edit`/`write`/`apply_patch`. A thrown `Error` blocks the call, OpenCode's equivalent of `{"decision":"block"}` |
| Hook input `cwd` (session's actual working directory, independent of any tool arg) | Plugin factory's `directory` parameter (the project root OpenCode itself resolved). See Boundary security below for why this is not a byte-identical guarantee |
| `NotebookEdit` (Jupyter-specific tool) | No OpenCode equivalent tool exists; nothing to guard |
| Read/Grep/Glob/Bash tool names in `tools:` frontmatter | `read`/`grep`/`glob`/`bash` are always available to every OpenCode agent (no per-tool allow flag needed) -- only `edit`/`write` (and, for completeness, `apply_patch`) are the ones actually gated per read-only vs. read/write agent |

## Files created

```
.opencode/
├── agents/
│   ├── dev-agent-architect.md
│   ├── dev-agent-researcher.md
│   ├── dev-agent-ux-designer.md
│   ├── dev-agent-developer.md
│   ├── dev-agent-frontend-developer.md
│   ├── dev-agent-tester.md
│   ├── dev-agent-visual-qa.md
│   └── dev-agent-reviewer.md
├── commands/
│   ├── analyze.md
│   ├── implement.md
│   ├── review.md
│   └── test.md
├── docs/
│   ├── capabilities.md
│   ├── deep-execution.md
│   ├── first-run-setup.md
│   ├── obsidian-memory.md
│   └── project-boundary.md
└── plugins/
    └── project-boundary-guard.js
docs/opencode-port.md   (this file)
```

No `opencode.json`/`opencode.jsonc` was added -- OpenCode auto-discovers all three `.opencode/`
subdirectories per-project with no registration step, confirmed live (see Validation below).

## Live verification: `.opencode/docs/` mirror (real bug found and fixed)

Live testing against the installed OpenCode CLI found a genuine bug: `.opencode/commands/*.md`
pointed at the top-level `docs/*.md` reference files (`docs/capabilities.md`,
`docs/obsidian-memory.md`, `docs/project-boundary.md`, `docs/first-run-setup.md`), the same way the
Claude Code commands do -- but an OpenCode agent's file access is scoped to the resolved project
root it's given, and this adapter has no guarantee that anything above `.opencode/` is reachable the
same way `docs/` is on the Claude Code side. Fix: mirrored the four referenced docs into
`.opencode/docs/` and repointed `.opencode/commands/analyze.md` / `implement.md` at the local
copies. `docs/deep-execution.md` and this file are still referenced at the top-level path since nothing
in `.opencode/` currently points at them the same way. Keep both copies in sync by hand if the
underlying content changes -- there's no build step that does this automatically.

## Live verification status (honest accounting)

**Confirmed live** against the installed OpenCode CLI (v1.18.10): all 8 agents discoverable
(`opencode agent list`), all 4 commands and the boundary-guard plugin registered
(`opencode debug config`), each agent's `permission` block resolves as authored, and the
`.opencode/docs/` path bug above was found and fixed through real testing.

**Not completed**: a full live run of all 17 verification scenarios (real multi-turn `opencode run`
sessions exercising Trivial/Medium/Large tiers, resume, boundary-block-at-tool-execution-time,
fail-closed-on-plugin-error, Playwright/Obsidian detection, tester/reviewer independence end-to-end)
was attempted but the verification session was interrupted before producing a complete result set.
Treat everything below "Files created" in this document as the last honestly-reported state --
static/structural confirmation plus the one real bug fix above, not a full live-verified pass. A
follow-up live-verification run is still needed before relying on this port for anything beyond
structural correctness.

## `.devagent/` compatibility

Unchanged. `.opencode/commands/implement.md` uses the identical `.devagent/state.json`,
`plan.md`, `progress.md`, `decisions.md`, `failures.md`, `handoffs/research.md`, and
`handoffs/architecture.md` paths/field names as `commands/implement.md`. A `/implement` run started
under Claude Code and resumed under OpenCode (or vice versa) reads the same state files.

## Boundary security -- ported, with one honest gap

The containment/traversal/symlink-resolution/Obsidian-exception algorithm is the same code, ported
to a `tool.execute.before` plugin hook instead of a `PreToolUse` process hook. Verified structurally
(see Validation) that the plugin loads and is wired to the same tool surface (`bash`/`edit`/`write`/
`apply_patch`).

Two gaps could not be closed to full parity, stated plainly rather than glossed over:

1. **No independently-supplied session `cwd`.** Claude Code's hook receives the tool call's actual
   session `cwd` as a value separate from anything the tool arguments claim. OpenCode's plugin
   factory receives `directory` (the project root OpenCode resolved at startup) but the tool-call
   payload itself was not confirmed to carry a second, independent `cwd` per call. The port uses
   `directory` as both root and resolution base. This is narrower/safer than the Claude Code
   version in every case checked (it can only over-restrict, never under-restrict), but it is not a
   confirmed byte-for-byte behavioral match, particularly for a mid-session working-directory change
   inside a single OpenCode session (e.g. a `cd` deep in a monorepo) -- this was not exercised live
   against a real OpenCode agent turn, only structurally.
2. **No confirmed fail-closed guarantee on hook-load failure.** Claude Code's guard is empirically
   verified (per `docs/project-boundary.md`) to fail open only when the hook *process* itself can't
   start (Node missing from PATH) -- every internal condition fails closed. OpenCode plugins run
   in-process rather than as a separate spawned process, so "the hook process fails to start" isn't
   quite the same failure class; but whether an uncaught error while *loading* this plugin module
   (as opposed to inside its hook body, which is wrapped and does throw correctly) still allows
   tool calls through was not verified against a live OpenCode session in this port -- OpenCode's
   own plugin-load-failure behavior is undocumented in the fetched docs. Treat this as an open
   question, not a confirmed guarantee, until verified live.

Both gaps are documented rather than silently assumed away, per this port's explicit instruction not
to claim parity that doesn't exist.

## Validation performed

Real, not just "files exist":

- `env -C <dev-agent repo> opencode agent list` -- confirms all 8 `dev-agent-*` agents are
  discovered and typed `(subagent)`.
- `env -C <dev-agent repo> opencode debug config` -- confirms, structurally, per-agent `permission`
  blocks resolved exactly as authored (`dev-agent-tester`/`dev-agent-researcher`/`dev-agent-reviewer`
  /`dev-agent-architect`/`dev-agent-ux-designer`/`dev-agent-visual-qa`: `edit: deny, write: deny,
  bash: allow`; `dev-agent-developer`/`dev-agent-frontend-developer`: `edit: allow, write: allow,
  bash: allow`), the 4 commands (`analyze`, `implement`, `review`, `test`) registered alongside the
  user's other existing commands, and the boundary-guard plugin loaded alongside the user's other
  existing plugins (`oh-my-opencode-slim`, `crg-plugin.ts`).
- `git status --porcelain` inside the dev-agent repo -- confirms only `.opencode/` (new) appears;
  `agents/`, `commands/`, `hooks/`, `.claude-plugin/`, `README.md`, `CLAUDE.md`, `docs/*.md`
  (pre-existing files) show no modifications.

**Not validated, stated honestly**: no live multi-turn `opencode run` was executed against a real
target project with a real model, so the following are unverified in this port: the `task`
tool actually dispatches to a named subagent and returns its report the way this document assumes;
the plugin's `tool.execute.before` hook actually fires and blocks a real out-of-boundary `edit`/
`write`/`bash` call end-to-end (only its load and static wiring were confirmed); resume behavior
reading a real `.devagent/state.json`; the Trivial/Medium/Large tier selection and researcher<->
architect handoff ordering as executed by an actual model turn; Playwright/Obsidian detection as
executed by an actual model turn (the detection *logic* in `docs/capabilities.md` and
`docs/obsidian-memory.md` is unchanged and platform-agnostic, so it applies as-is, but no live run
exercised it end-to-end on OpenCode). These would require a live model session against a real
target project and were out of scope for what could be verified headlessly in this port.
