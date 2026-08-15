---
description: Run the reviewer agent against current working tree changes
agent: build
---

Use the `task` tool with agent `dev-agent-reviewer` to review the current diff (`git diff`, plus any staged/committed changes relevant to the task below) for correctness, architecture, security, performance, and maintainability.

$ARGUMENTS

Report the reviewer's verdict verbatim to the user. Do not modify any files based on the result -- if it's CHANGES REQUIRED, report the issues and ask whether to send them to the `dev-agent-developer` agent to fix.
