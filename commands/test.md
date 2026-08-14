---
description: Run the tester agent against current working tree changes
---

Use the `dev-agent:tester` subagent (its exact Task `subagent_type`, not the bare word "tester" — this plugin's agents are namespaced) to validate the current state of the project (uncommitted changes plus any context given below), and report its PASS/FAIL verdict verbatim to the user.

$ARGUMENTS

Do not modify any files based on the result — if it's FAIL, report the failure and ask whether to send it to the `dev-agent:developer` subagent to fix.
