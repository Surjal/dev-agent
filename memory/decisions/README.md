# Decisions Memory

Notes about developing the dev-agent plugin itself only. In a target project, the installed plugin
uses the user's Obsidian vault instead (`D:\obsidian\brain\Key Decisions.md`) — see
`docs/obsidian-memory.md`.

One Markdown file per significant architecture/technical decision, named `YYYY-MM-DD-short-slug.md`.

Each entry should record:

- The decision made
- Why (constraints, tradeoffs considered, alternatives rejected)
- Which project it applies to (link to `../projects/<slug>.md`)
- Date

Do not store credentials, tokens, API keys, or connection strings here.
