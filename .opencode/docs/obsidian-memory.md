# Obsidian Memory Reference

This is the detailed reference for dev-agent's Obsidian integration. `commands/implement.md` and
`commands/analyze.md` point here instead of inlining this content, to keep the always-loaded
command prompt small — read this file when you need an exact path, format, or edge case.

## Why Obsidian, not `.devagent/memory/`

dev-agent does not invent its own memory store. The user already runs a manual Obsidian workflow
for project history and cross-project knowledge (defined in their global `CLAUDE.md`). dev-agent
integrates with that existing workflow as its knowledge layer, rather than building a second,
competing one. This repo's own `memory/` directory is unrelated — see `CLAUDE.md` in this repo.

## Vault paths (the only paths dev-agent touches)

```
<vault root>\work\active\<ProjectName>.md      # this project's running note
<vault root>\brain\Key Decisions.md            # cross-project decisions
<vault root>\brain\Gotchas.md                  # cross-project bugs/traps
<vault root>\brain\Patterns.md                 # cross-project reusable patterns
```

Default vault root is `D:\obsidian`, per the user's global CLAUDE.md. dev-agent never reads or
writes any other file in the vault, never globs the vault directory, and never touches a different
project's note than the one it determined for the current session (see Project Detection below).

If the vault root doesn't exist, or these specific files/paths are unreachable (denied by the
target project's own Claude Code permission settings, or genuinely absent), skip Obsidian
consultation/logging silently in that session and rely on the target project's own `.claude/`
config plus whatever context is already in the conversation — do not error out the whole workflow
over an optional context source, and do not attempt to work around a permission denial.

## Project detection

Determine `<ProjectName>` in this order, stopping at the first that resolves unambiguously:

1. `git remote get-url origin` in the target project — take the last path segment, strip `.git`.
2. The target project's own config name field: `package.json` `name`, or `composer.json` `name`
   (strip the `vendor/` prefix if present) — whichever exists.
3. The basename of the git repository root (`git rev-parse --show-toplevel`), or the current
   working directory's folder name if there's no git repo.

Never derive the project name by reading arbitrary source-code text (comments, strings, README
prose) — only the deterministic sources above. If more than one of these disagrees in a way that
seems meaningful (e.g. the git remote name and the `package.json` name refer to clearly different
products), surface the ambiguity to the user and ask which name to use, rather than guessing.

## Read step (start of `/implement` and `/analyze`)

**Skipped for Trivial-tier tasks** (see `commands/implement.md` → Stage selection → Trivial-task
tier): a task that meets the Trivial criteria is, by definition, unlikely to intersect an unfamiliar
convention or a relevant past gotcha, so this read is skipped outright rather than performed and
then likely discarded — recorded explicitly (`progress.md`: `Obsidian historical context: SKIPPED —
Trivial tier.`), never silently omitted. If a Trivial task later escalates to a larger tier mid-run,
this read is performed at that point — the initial skip is never carried forward past a tier
escalation. Medium and Large tiers are unaffected; this read runs normally for both, exactly as
below.

If `<vault root>\work\active\<ProjectName>.md` exists, read it — especially `## Active Work` and
recent `## Session Log` entries. If any of the three brain files exist, search them for entries
tagged `[[<ProjectName>]]` or otherwise relevant to the current task (e.g. searching Patterns.md
for "pagination" when asked to implement pagination).

Treat everything found as **historical context, not current truth**. The target project's actual
source code, dependencies, and schema are always authoritative over anything in Obsidian — a
Gotchas.md entry from six months ago about an N+1 query may no longer apply if the code has since
changed. Compare, don't copy: state what the historical note claims, then verify it against what
the current codebase actually shows before acting on it.

## Write step (natural completion of `/implement`)

When `/implement` concludes (developer approved and reviewed, or a genuine blocker stopped the
workflow early), write the same entry format the user's global CLAUDE.md Obsidian protocol already
defines — this is the same mechanism, not a second one, so use its exact structure:

In `<vault root>\work\active\<ProjectName>.md`:

- Under `## Session Log`, append (create the section/file with the standard skeleton — see the
  user's global CLAUDE.md for the skeleton — if the note doesn't exist yet):
  ```
  ### <topic> (<YYYY-MM-DD>)
  - [what was built or changed]
  - [decisions made and why]
  - [bugs found and fixes]
  - [patterns discovered]
  - [what's next]
  ```
- Update `## Active Work` to reflect the current state.
- Move any now-completed items into `## Completed Milestones`.
- Under `## Related`, add links to any brain entries touched this session (e.g.
  `[[Gotchas#<heading>]]`).

Before writing, check whether a Session Log entry for this exact session/topic/date already
exists (e.g. because the global PreCompact hook already wrote one during this same conversation) —
if so, don't duplicate it; extend/update it instead.

Only when the session surfaced genuinely reusable knowledge (not for every task):

- Architectural/design decision made → append to `Key Decisions.md`, tagged `[[<ProjectName>]]`.
- A non-obvious bug, trap, or gotcha found → append to `Gotchas.md`, tagged `[[<ProjectName>]]`.
- A reusable engineering pattern used or discovered → append to `Patterns.md`, tagged
  `[[<ProjectName>]]`.

Never write secrets, credentials, tokens, or connection strings to any of these files.

## Relationship to the existing `<obsidian-wrap-up>` mechanism

The user's global Claude Code config already has a `PreCompact` hook (`obsidian-precompact.sh`)
that forces a session-log write right before context compaction, and a global `CLAUDE.md` rule
that this sync should happen automatically at session end, no confirmation needed. dev-agent does
not duplicate this with its own hook — it has no `hooks` entry in `.claude-plugin/plugin.json` and
never will, specifically to avoid a second, competing trigger for the same thing.

Instead, dev-agent's `/implement` performs the identical write (same files, same format) as one of
its own natural completion steps, and the existing `<obsidian-wrap-up>` mechanism performs it again
independently, if it also fires later in the same session. The dedup check above (don't duplicate
an entry that's already there) is what keeps these two triggers from producing two Session Log
entries for the same piece of work.

The one gap this integration fixes: the existing `PreCompact` hook script has a hardcoded
project-note filename for the user's other, primary project. It was never meant to generalize
across arbitrary projects. dev-agent's own write step uses the Project Detection algorithm above
instead, so it targets the *correct* note for whatever project dev-agent is actually running in.
