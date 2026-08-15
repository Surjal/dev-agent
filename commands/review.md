---
description: Run the reviewer agent against current working tree changes
---

Use the `dev-agent:reviewer` subagent — call the `Agent` tool with `subagent_type: "dev-agent:reviewer"` (not the bare word "reviewer", and not the `Skill` tool — this plugin's agents are namespaced) — to review the current diff (`git diff`, plus any staged/committed changes relevant to the task below) for correctness, architecture, security, performance, and maintainability.

$ARGUMENTS

Report the reviewer's verdict verbatim to the user. Do not modify any files based on the result — if it's CHANGES REQUIRED, report the issues and ask whether to send them to the `dev-agent:developer` subagent to fix.
