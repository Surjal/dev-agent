---
description: Investigate a task/bug read-only via the researcher agent, no code changes
---

Use the `dev-agent:researcher` subagent — call the `Agent` tool with `subagent_type: "dev-agent:researcher"` (not the bare word "researcher", and not the `Skill` tool — this plugin's agents are namespaced) — to investigate the following request without modifying any files:

$ARGUMENTS

Before delegating, briefly state what stack/framework you expect this project to use and why (based on marker files), so the researcher's findings can be sanity-checked against it.

If relevant to the request, check the user's Obsidian vault for historical context first — see
`docs/obsidian-memory.md` for the project-detection algorithm and exact paths
(`D:\obsidian\work\active\<ProjectName>.md`, `D:\obsidian\brain\*.md`). Skip silently if unreachable.
Treat anything found as historical context to compare against current code, never as a substitute
for actually reading the current code. This is read-only, same as everything else `/analyze` does —
no vault writes here.

After the researcher reports back, present its findings to the user in the researcher's own section format — don't compress away the file:line evidence.

Do not proceed to implementation. This command is investigation-only.
