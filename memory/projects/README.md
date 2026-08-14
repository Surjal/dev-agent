# Projects Memory

This directory holds notes about developing the dev-agent plugin itself only. It is **not** used
when dev-agent runs against a target project — that memory lives in the user's Obsidian vault
(`D:\obsidian\work\active\<ProjectName>.md` and `D:\obsidian\brain\*.md`), not in a directory like
this one inside the target project. See `docs/obsidian-memory.md` and `docs/architecture.md` →
Memory for why.

One Markdown file per project, named `<project-slug>.md`.

Each file should record, for that project:

- Detected stack (framework, language, package manager)
- Directory layout notes that aren't obvious from the tree
- Project-specific conventions (naming, testing approach, commit style)
- Known issues / tech debt the agent has previously identified
- Links to relevant decisions in `../decisions/`

Do not store credentials, tokens, API keys, or connection strings here.

## Migration note

This directory is Markdown-only by design (v1). When replaced by Postgres + a vector store + RAG,
each file here becomes a row/document with the same fields — no redesign of the agents themselves
is required, since the orchestrator only ever needs a "read project memory" / "write project memory"
capability, not direct file access. See `docs/architecture.md` → Memory.
