# Target Project Boundary

This is the detailed reference for how dev-agent identifies the project it's working on and
prevents modifying files outside it. `commands/implement.md` → Target project boundary points
here instead of inlining this content, same reasoning as `docs/capabilities.md` and
`docs/obsidian-memory.md`.

## Why this exists

During v1.2.0 testing, a session working on a throwaway test project instead modified a file in
the user's real, unrelated React project (`src/App.jsx`). It was caught and reverted, not
prevented. The exact mechanism was never conclusively established — candidates included Claude
Code's CLAUDE.md auto-discovery pulling in a parent directory's project description, or the model
simply operating on the wrong absolute path. v1.3.0 doesn't try to guess which candidate was
responsible; it closes off all of them at once, using the one thing every candidate has in
common: however confusion happens, a file modification still resolves to one concrete absolute
path, and that path either is or isn't inside the intended project. So v1.3.0 enforces containment
on that concrete path, at the tool layer, independent of why a wrong path might have been proposed.

## Three layers, precisely distinguished

Do not read this as "dev-agent makes it impossible to modify files outside the project." It
doesn't, and no plugin built on Claude Code's current APIs could claim that. Here is exactly what
each layer guarantees:

### 1. Policy / prompt layer (advisory, not enforced)

`commands/implement.md` tells the orchestrator to establish a verified target root and pass it to
subagents. Every agent's Rules section says not to touch files outside its assigned scope. This is
advisory — a well-behaved model follows it, but nothing forces it to, and it did not prevent the
v1.2.0 incident on its own.

### 2. Tool-layer enforcement (the new part — a real, native mechanism)

`hooks/project-boundary-guard.cjs`, registered as a `PreToolUse` hook (matcher
`Edit|Write|NotebookEdit|MultiEdit|Bash`) in `hooks/hooks.json`, auto-discovered by Claude Code's
plugin convention. This runs **before** every matched tool call in the session, reads the tool's
actual parameters (`file_path`/`notebook_path`, or the `command` string) plus the session's actual
`cwd` (supplied by Claude Code itself, not derived from anything the model said), and can genuinely
block the call — Claude Code honors a hook's deny response before the tool executes at all. This is
empirically verified against Claude Code 2.1.233, not assumed: a probe harness fed the running
binary every outcome variant (plain exit 0, exit 1, an uncaught exception, exit 2, a
`decision:"block"` JSON body, a `hookSpecificOutput.permissionDecision:"deny"` body, malformed
JSON, exit 127) and recorded the actual filesystem effect and the actual tool result each produced
— see Fail-Closed Implementation below for what that probe found. Live testing then reproduced a
forced `Edit` (via a filesystem junction into a sibling project — see Test Results) which produced
a real `is_error:true` tool result with the hook's exact reason text, with the target file
independently confirmed byte/mtime-unchanged afterward.

This is genuinely tool-layer, not just policy — it doesn't matter what the model believes the
project is; it matters what the actual invocation's `cwd` was and what absolute path the tool call
resolved to. That's precisely why it defeats the v1.2.0 incident's candidate causes: even if a
parent CLAUDE.md confused the model about "which project", the `Edit` call still carried a
concrete `file_path`, and the hook checks that path against the *real* session `cwd`'s project
root, not against anything the model was thinking.

**What this layer does NOT guarantee:**
- It is a Node.js script the harness invokes per tool call — it is not a filesystem-level
  sandbox (no chroot, no OS-level permission wall).
- The `Bash` check is a best-effort heuristic over the command *text* (see Bash Safety below), not
  a shell-command interpreter. It catches the concrete patterns tested against (absolute paths,
  `../` traversal, `cd` to outside the root, combined with common mutating command names) — it
  does not parse or execute arbitrary shell syntax to determine true effects.
- **As of v1.3.1 the guard is fail-closed**, not fail-open: any condition it cannot positively
  verify — malformed/missing input, an unresolvable `cwd`, an unresolvable target path, a tool
  name it has no verification strategy for, or an internal exception — results in a deny, not an
  allow. See Fail-Closed Implementation below for the full audit of error paths and live proof.
- The matcher only routes tool names it lists. A file-mutating tool added to Claude Code that
  isn't in that list would not reach this hook at all — this was a real, empirically found gap
  (`NotebookEdit`, fixed in v1.3.1; see Fail-Closed Implementation), and the same class of gap
  could recur if a future tool is added and this list isn't updated to match.

### 3. Filesystem-level protection (not provided by this plugin)

True OS-level sandboxing (a chroot, a container, a restricted service account) is outside what a
Claude Code plugin can configure. If you need that guarantee, provide it at the OS/container level
independent of dev-agent — dev-agent's boundary is a tool-layer check, not a substitute for that.

## Target project identification

At the start of `/implement` (`commands/implement.md` → Target project boundary):

1. **Working directory** — the session's actual `cwd`. Never assumed to equal "the project" without
   the checks below.
2. **Git root** — `git rev-parse --show-toplevel` from that working directory, if the directory is
   inside a Git repository.
3. **Project root** — the Git root if one was found; the working directory itself otherwise.
4. **Status** — `VERIFIED` when working directory and Git root relationship makes sense (working
   directory is at or inside the Git root, or there's no Git root and the working directory is
   used directly); `AMBIGUOUS` when they disagree unexpectedly, or when parent-directory
   instruction discovery describes a different project than what's actually at the working
   directory.
5. **Fail-safe**: if status can't be resolved to `VERIFIED`, no files are modified — see Fail-Safe
   Behavior.

This produces the `TARGET PROJECT` block shown in `commands/implement.md`.

## Canonical paths and containment semantics

Two paths are compared by canonical containment, not string-prefix:

- Normalize: lowercase, backslashes to forward slashes, no trailing slash (Windows paths are
  case-insensitive; this is comparison-time only, never a rewrite of the actual path used).
- `target` is inside `root` iff `target === root` or `target.startsWith(root + '/')`.

The `+ '/'` is what prevents the prefix-attack class the task specifically called out:
`d:/projects/project-a` must not match `d:/projects/project-ab`, because `"project-ab"` doesn't
start with `"project-a/"` — the character after `project-a` in the target is `b`, not a separator.
Verified directly (`hooks/project-boundary-guard.cjs` unit test T3, and live Test 4 below).

All target paths — relative *and* absolute — are resolved via `path.resolve(cwd, target)` before
the containment check, then symlink/junction-resolved via `fs.realpathSync` for the deepest part of
the path that actually exists. Resolving unconditionally, not only for relative input, is what
makes `../` traversal visible to the check rather than silently ignored, including when it's
embedded inside an absolute path (`D:\proj-a\..\proj-b\file.js` is absolute, but still contains a
traversal segment). **v1.3.0 only ran `path.resolve` on paths not already absolute** — an absolute
path containing `..` was compared to the root as-is, unnormalized, so `..` never collapsed and the
containment check could pass on a path that plainly wasn't inside the root. Found live during
v1.3.1 hardening (a probe script fed exactly this shape and observed the unpatched code return
`isInside = true`), fixed by resolving every path unconditionally, and covered by a dedicated unit
test (`absolute path containing .. (v1.3.0 bypass)`) so it can't silently regress. The
`fs.realpathSync` step additionally defeats a symlink/junction planted inside the project root that
points outside it (verified live in Test 4 below via a Windows directory junction).

## Boundary rules — examples

Given target project `D:\projects\project-a`:

**Allowed**: `D:\projects\project-a\src\App.jsx`, `D:\projects\project-a\package.json`,
`D:\projects\project-a\tests\foo.test.js` — all resolve inside the root.

**Forbidden, and blocked by the hook**: `D:\projects\project-b\src\App.jsx` (sibling),
`D:\projects\project-a\..\project-b\file.js` (resolves outside via traversal),
`C:\Users\ACER\other-project\file.js` (unrelated tree), `C:\Users\ACER\CLAUDE.md` (a project's own
config file, not application source dev-agent should ever touch), `D:\obsidian\brain\file.md`
**unless** it matches the Obsidian Exception below.

## Bash safety

Per the task's own framing: enumerating every possible mutating shell command is not attempted.
Instead, the hook:

1. Extracts path-like tokens from the command text: Windows absolute (`C:\...`), Unix absolute
   (`/...`), and relative traversal (`../...`, `..\...`).
2. Resolves each against the actual session `cwd`.
3. If a `cd` target resolves outside the root, blocks outright — effects after a `cd` elsewhere
   aren't confidently constrained, so this doesn't wait to see if something bad follows.
4. Otherwise, only blocks if a resolved path is outside the root **and** the command matches a
   known mutating pattern (redirects `>`/`>>`, `cp`, `mv`, `rm`, `sed -i`, `perl -i`, `tee`,
   `git add/commit/checkout/reset/clean/apply/rm/mv`, package-manager install/init commands, etc.)
   — a command that merely *reads* something outside the root (e.g. `cat ../other/file`) is not
   what this layer exists to stop, and flagging it would just be noise.

**Path tokens exclude `(` and `)`** (added in v1.4.1, alongside the null-device exemption below):
parentheses are shell metacharacters (command substitution `$(...)`, grouping), never legitimately
part of a bare path. Found live during v1.4.0 resume testing: a completely benign `basename
"$(git rev-parse --show-toplevel 2>/dev/null)"` was falsely blocked because the matched token was
`/dev/null)` (the closing paren from the substitution got swallowed into the token), which then
failed the null-device exemption's exact-match check below. Verified this doesn't create a bypass:
a real outside path wrapped in `$(echo ...)` is still resolved and denied (unit test `excluding )
from path tokens does not let a paren-adjacent outside path slip through`) — excluding `)` from the
token's character class only ever truncates a match earlier, at the paren; a truncated absolute path
prefix still resolves outside the root exactly the same as the full one would.

**OS null/stream devices are exempt from the containment check** (`/dev/null`, `/dev/stdout`,
`/dev/stderr`, `/dev/zero`, `/dev/tty`, Windows `NUL`), matched on the raw command token before any
path resolution. Found live during v1.4.0 testing: `path.resolve` on Windows treats a leading `/` as
"root of the current drive," so `npm test > /dev/null 2>&1` resolved to `D:\dev\null` and was flagged
as outside the project — an extremely common, entirely harmless output-suppression pattern was
being falsely blocked. A write to `/dev/null` discards the data; it is not a project file under any
definition, so exempting it carries no boundary risk (unlike the Obsidian exception, which allows
writes to real files outside the project — this exemption allows a construct that touches no
filesystem path at all). Verified this doesn't create a bypass: a command combining a `/dev/null`
redirect with a genuine out-of-root mutation in the same line is still denied (unit test `/dev/null
exemption does not mask a real outside mutation in the same command`).

**Explicitly not covered, stated plainly rather than glossed over**: a script (Python, Node, a
shell script) invoked with no path literally visible in the Bash command line, but which internally
writes somewhere else, is invisible to a text-level heuristic. Generated files, build tool output
directories configured elsewhere, and sufficiently obfuscated commands are the same category of
gap. This is why the policy layer (agents are told not to do this) and this heuristic layer are
both present — defense in depth, not a single claimed-perfect gate. Be particularly cautious
running unfamiliar scripts, generated tooling, or third-party build steps inside the target
project; the boundary hook's Bash coverage is best-effort for the common cases, not exhaustive.

## Git safety

The hook computes `root` from `git rev-parse --show-toplevel` at the *actual* `cwd` every single
tool call — it does not cache or trust a value computed once at session start, so it can't be
fooled by a session whose `cwd` legitimately changes mid-task. If the working directory is a
subdirectory of a larger repository with no `.git` of its own (a monorepo package, for example),
the resolved root is the repository root — this is intentional and safe (it's still all the same
repository the user is already working in), verified live in Test 8 below. If the working
directory has its own nested `.git` inside a larger repo, the resolved root is the narrower nested
repo — also safe, since narrower is strictly more restrictive, never less.

The orchestrator additionally surfaces both values in the `TARGET PROJECT` block (Git root vs.
Working directory) so a human reviewing the output can independently sanity-check them; it does
not silently pick one without showing both.

## Subagent isolation

The verified target root is explicit context handed to every write-capable subagent
(`dev-agent:developer`, `dev-agent:frontend-developer`) and every read-only agent, per
`commands/implement.md` step 8 under Target project boundary. This is policy-layer (a subagent
could in principle ignore it), but the tool-layer hook applies uniformly to every tool call in the
session regardless of which agent (main orchestrator or any subagent) issued it — subagents don't
get a separate, unguarded execution context. Verified in Test 2/6/7 below: forced write/edit
attempts from a subagent context were blocked identically to attempts from the main session.

## Obsidian exception

The target project boundary is a default, not an absolute rule with zero exceptions — the existing
Obsidian memory protocol (`docs/obsidian-memory.md`) is a deliberate, narrowly-scoped exception,
not a hole in the boundary:

- The hook explicitly allows `D:\obsidian\work\active\**` and `D:\obsidian\brain\**` (the exact
  paths the Obsidian protocol documents), and nothing else under the vault.
- A write to any *other* path under `D:\obsidian\` is still blocked — verified directly (unit test
  T9): a path like `D:\obsidian\some-other-note.md` is not covered by the exception and is treated
  like any other out-of-project path.
- This does not generalize to "anything vault-adjacent is fine" — only those two specific
  subdirectories, matching exactly what `docs/obsidian-memory.md` already documents as the
  legitimate write targets.
- **Known coupling, stated honestly**: the exception list is a literal `D:\obsidian` path baked
  into the hook, matching the documented default vault root. If a user's actual vault root differs
  from that default, the hook's exception list needs updating to match — it isn't derived
  automatically from wherever `docs/obsidian-memory.md`'s protocol is actually configured to write.

## Fail-safe behavior

If the target project root cannot be confidently established (Status stays `AMBIGUOUS`), the
orchestrator does not proceed with modifications — it reports exactly:

> Target project boundary could not be verified. No project files were modified.

If a specific requested modification resolves outside the established boundary, it is not
redirected, not silently skipped-and-continued — the orchestrator reports the exact path and why
it's outside the boundary, and stops for that specific action (the rest of a task can still
proceed if the out-of-boundary request was one part of a larger set of changes).

## Autonomous execution — this is not a permission-prompt system

Normal modifications *inside* the verified boundary are not gated behind additional confirmation —
the hook is silent (allows, no output) for every in-boundary call, which is most of them. Only
out-of-boundary attempts produce a block. This preserves dev-agent's core premise (minimal
babysitting for a normal task) while adding a hard stop for the one class of action that shouldn't
need human review to catch: a concrete path outside the project.

## Fail-closed guarantee (v1.3.1)

The guard's decision function has exactly three branches: `allow` (the operation is positively
verified inside the root, or is a documented Obsidian exception), `denyViolation` (a resolved,
concrete path is demonstrably outside the root), and `denyUnverified` (the guard could not
positively establish either of the above). There is no code path that reaches neither `allow` nor
one of the two deny branches: a top-level `try`, an `uncaughtException` handler, and a catch inside
the stdin read all route to `denyUnverified` rather than letting the process exit 0 by default.
Audited error paths, each with its own unit test in `hooks/test-boundary-guard.cjs`: unreadable
stdin, empty stdin, invalid JSON, a JSON value that isn't an object, a missing/non-string
`tool_name`, a tool name the guard has no verification strategy for, a missing/non-string `cwd`, a
`cwd` that doesn't exist or isn't a directory, a missing/non-object `tool_input`, a missing/null
target-path field, an unresolvable target path, a `Bash` payload with no command string, a failure
inside the Bash heuristic itself, and an uncaught exception thrown anywhere in `main()`. Verified
live as well, not just at the unit level: Test 12 temporarily made the real, installed hook throw
unconditionally, ran a genuine legitimate in-project `Edit` through a live session, and confirmed
the tool call was denied and the target file was left byte/mtime-identical — then the hook was
restored and the full unit suite re-run clean.

The one deliberate non-error path that is *not* a fail-closed case: if `git rev-parse` reports "not
a repository," the root falls back to the session `cwd` itself. This is not a failure to verify —
it is a narrower, strictly more restrictive root than a repo root would be, so it cannot cause an
under-restriction and is treated as verified rather than unverified.

## Known limitations (stated plainly, not glossed over)

- **Bash coverage is heuristic, not a parser.** See Bash Safety — obfuscated commands, scripts that
  write via internal logic with no path in the command line, and sufficiently unusual shell syntax
  are not guaranteed to be caught. This did not change in v1.3.1 and is not solvable by a
  fail-closed policy: the guard can only deny what it can see in the command text.
- **The hook fails closed on internal error (changed in v1.3.1 — previously failed open).** See
  Fail-Closed Guarantee above. The tradeoff moved deliberately: an internal bug or an unusual
  environment now denies a tool call that might have been legitimate, rather than silently
  allowing one that might not have been. For an autonomous coding agent this is the correct
  direction — a false block costs a retry or a manual step; a false allow can silently modify the
  wrong project.
- **A crashed *hook process* (not a thrown JS exception, but the process failing to even start —
  e.g. Node missing from `PATH`, or the hook script file itself missing) is outside this script's
  control.** Empirically verified against Claude Code 2.1.233: when the configured hook command
  itself cannot run, Claude Code allows the tool call rather than blocking it — there is no code in
  this repository that runs in that scenario, because the guard's own process never started. This
  is a real remaining fail-open path and is called out explicitly rather than glossed over: the
  fail-closed guarantee above covers every condition *inside* `project-boundary-guard.cjs`, not the
  case where the hook command never executes at all. Practical mitigation: Node.js is a hard
  prerequisite for this plugin (documented in README.md); if it disappears from `PATH` mid-session
  the loss of enforcement is silent, so treat "Node available" as part of this plugin's safety
  precondition, not just its functional one.
- **The matcher list is a hardcoded set of tool names**, not a "match everything mutating" rule —
  see Tool-Layer Enforcement above. `NotebookEdit`/`MultiEdit` were added in v1.3.1 after being
  found live to bypass the v1.3.0 guard entirely (the matcher didn't list them, so the hook never
  ran); a future Claude Code tool that mutates files under a name not in this list would have the
  same gap until the matcher is updated.
- **The vault-exception path is hardcoded to the documented default.** See Obsidian Exception above.
- **This does not replace the policy layer.** Agents are still told not to touch out-of-scope
  files; the hook is a backstop for when that instruction alone isn't enough, verified to be
  necessary by the very incident that motivated this work.
- **Full shell/OS sandboxing is out of scope.** See Three Layers above — this is tool-layer
  enforcement within Claude Code's own tool-call mechanism, not a filesystem-level guarantee.
