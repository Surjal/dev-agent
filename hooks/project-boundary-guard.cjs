#!/usr/bin/env node
'use strict';
// PreToolUse hook (Edit | Write | NotebookEdit | Bash): block file modifications outside the
// current session's verified project root. See docs/project-boundary.md for the full design and
// its honest limitations.
//
// FAIL-CLOSED (v1.3.1). Any condition under which this guard cannot positively verify that the
// operation stays inside the project root results in a DENY, not an allow. That includes
// unreadable/malformed input, a missing or unresolvable cwd, an unexpected tool schema, an
// unresolvable target path, and any unexpected internal exception.
//
// The one deliberate non-error fallback: if `git rev-parse` reports no repository, the root
// becomes the session cwd itself. That is strictly NARROWER than a repo root, so it can only
// over-restrict, never under-restrict, and is therefore safe to treat as verified.
//
// Blocking mechanism is redundant on purpose (both empirically verified against Claude Code
// 2.1.233): a JSON deny on stdout AND exit code 2 with the reason on stderr. Either alone is
// sufficient to reject the tool call; emitting both means a failure to parse the JSON still
// blocks.

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const PREFIX = 'dev-agent boundary guard';

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

function debug(msg) {
  if (!process.env.DEV_AGENT_GUARD_DEBUG) return;
  try {
    fs.appendFileSync(process.env.DEV_AGENT_GUARD_DEBUG, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* diagnostics must never affect the decision */
  }
}

function allow() {
  process.exit(0);
}

function deny(reason) {
  debug(`DENY ${reason}`);
  try {
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      })
    );
  } catch {
    /* fall through to exit 2, which blocks on its own */
  }
  try {
    process.stderr.write(reason + '\n');
  } catch {
    /* same */
  }
  process.exit(2);
}

// A demonstrable boundary violation.
function denyViolation(detail) {
  deny(`${PREFIX}: target project boundary violation. ${detail} No file was modified.`);
}

// The guard could not establish that the operation is in bounds. Fail closed.
function denyUnverified(detail) {
  deny(
    `${PREFIX}: project boundary verification failed; tool call blocked fail-closed (${detail}). ` +
      `No file was modified. This is a safety default: when the boundary cannot be verified the ` +
      `operation is refused rather than allowed. See docs/project-boundary.md.`
  );
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

// Comparison-time normalization only: forward slashes, no trailing slash, lowercased
// (Windows paths are case-insensitive). Never used to rewrite a path that is acted on.
function norm(p) {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// True containment, not string-prefix: "d:/x/project-a" must not match "d:/x/project-ab".
function isInside(root, target) {
  const r = norm(root);
  const t = norm(target);
  return t === r || t.startsWith(r + '/');
}

// Resolve symlinks/junctions for the deepest part of `p` that actually exists, then re-append
// the not-yet-existing tail. Needed because a target of a Write usually does not exist yet, but
// its parent directory may itself be a symlink pointing outside the project.
// `strict`: on a non-ENOENT filesystem error, throw (caller fails closed) rather than guessing.
function realpathDeepest(p, strict) {
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      const real = fs.realpathSync(cur);
      if (tail.length === 0) return real;
      return path.resolve(real, ...tail.slice().reverse());
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        const parent = path.dirname(cur);
        if (parent === cur) return path.resolve(p); // reached a root that does not exist
        tail.push(path.basename(cur));
        cur = parent;
        continue;
      }
      if (strict) throw err;
      return path.resolve(p); // already normalized; loses only symlink resolution
    }
  }
}

const VAULT_EXCEPTIONS = ['d:/obsidian/work/active', 'd:/obsidian/brain'];

function isVaultException(target) {
  const t = norm(target);
  return VAULT_EXCEPTIONS.some((v) => t === v || t.startsWith(v + '/'));
}

// ---------------------------------------------------------------------------
// Project root
// ---------------------------------------------------------------------------

// Returns a verified, realpath-resolved root, or null if a root was reported but is unusable.
function resolveProjectRoot(cwdReal) {
  let out = '';
  try {
    out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: cwdReal,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    // Not a git repository, or git unavailable. cwd is a strictly narrower root -- safe.
    return cwdReal;
  }
  if (!out) return cwdReal;
  try {
    if (!fs.statSync(out).isDirectory()) return null;
    return fs.realpathSync(out);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bash heuristic
// ---------------------------------------------------------------------------
// This is a heuristic on the command text, NOT a shell parser and NOT a sandbox. It reliably
// catches path-bearing mutations. A script whose internal logic computes a destination that never
// appears in the command text is not visible to it. Documented in docs/project-boundary.md.

// Windows absolute (C:\...), POSIX absolute (/...), and relative traversal (../..., ..\...).
// A bare relative token with no ".." always resolves under cwd by construction.
// Excludes "(" and ")" from token characters: they're shell metacharacters (command substitution
// $(...), grouping), never legitimately part of a bare path -- without this exclusion, a path
// immediately followed by a closing paren (e.g. "$(cmd 2>/dev/null)") swallows the ")" into the
// matched token, which then fails an exact-match check like NULL_DEVICE_RE below. Found live in
// v1.4.0/v1.4.1 testing: a completely benign `$(git rev-parse ... 2>/dev/null)` was falsely blocked
// because the matched token was "/dev/null)", not "/dev/null".
const PATH_TOKEN_RE =
  /(?:[A-Za-z]:[\\/][^\s"'|&;<>()]+|(?<![\w./])\/(?:[^\s"'|&;<>/()]+\/?)+|(?:\.\.[\\/])+[^\s"'|&;<>()]*)/g;
const MUTATING_RE =
  /(>{1,2}(?!\s*&)|(?:^|[;&|]\s*)(cp|mv|rm|rmdir|del|rd|mkdir|touch|tee|sed\s+-i|perl\s+-i|git\s+(add|commit|checkout|reset|clean|apply|rm|mv)|npm\s+(install|uninstall|init|ci)|pnpm\s+(add|remove|install)|yarn\s+(add|remove)|pip\s+install|dd\s)\b)/i;
const CD_RE = /(?:^|[;&|]\s*)cd\s+(?:['"]?)([^\s'";&|]+)/gi;

// The OS null/stream devices are not project files under any definition -- a write to /dev/null
// discards the data, it never touches a filesystem path this guard needs to protect. Matched on
// the raw token text (never resolved via path.resolve/realpath first): Windows resolves a leading
// "/" as "root of the current drive", so "/dev/null" would otherwise resolve to "D:\dev\null" and
// be flagged as outside the project -- a real false positive found live in v1.4.0 testing, where
// the extremely common `command > /dev/null 2>&1` pattern blocked an entirely legitimate command.
const NULL_DEVICE_RE = /^(\/dev\/(null|stdout|stderr|zero|tty)|nul)$/i;

function isNullDeviceToken(token) {
  return NULL_DEVICE_RE.test(token.trim());
}

function checkBashCommand(command, cwdReal, root) {
  // An explicit cd outside the root is blocked outright: after it, later relative paths in the
  // same command would resolve against a directory this guard did not verify.
  let m;
  CD_RE.lastIndex = 0;
  while ((m = CD_RE.exec(command))) {
    const target = m[1];
    if (isNullDeviceToken(target)) continue;
    const resolved = realpathDeepest(path.resolve(cwdReal, target), false);
    if (!isVaultException(resolved) && !isInside(root, resolved)) {
      return `Command changes directory to '${target}' (resolves to '${resolved}'), which is outside the project root '${root}'.`;
    }
  }

  if (!MUTATING_RE.test(command)) return null; // no write-shaped intent detected

  const tokens = command.match(PATH_TOKEN_RE) || [];
  for (const token of tokens) {
    if (isNullDeviceToken(token)) continue;
    // Non-strict: a heuristic token may not be a real path at all, and a filesystem error while
    // probing it must not turn a legitimate command into a false block. Normalization (which is
    // what defeats "..") has already happened via path.resolve.
    const resolved = realpathDeepest(path.resolve(cwdReal, token), false);
    if (isVaultException(resolved)) continue;
    if (!isInside(root, resolved)) {
      return `Command references path '${token}' (resolves to '${resolved}'), which is outside the project root '${root}'.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Tools this guard knows how to verify, and the tool_input field holding their target path.
const PATH_TOOLS = {
  Edit: 'file_path',
  Write: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

function main() {
  let raw;
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return denyUnverified('hook input could not be read from stdin');
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return denyUnverified('hook input was empty');
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return denyUnverified('hook input was not valid JSON');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return denyUnverified('hook input was not a JSON object');
  }

  const toolName = input.tool_name;
  if (typeof toolName !== 'string' || toolName === '') {
    return denyUnverified('hook input contained no usable tool_name');
  }

  const isBash = toolName === 'Bash';
  const pathField = PATH_TOOLS[toolName];
  if (!isBash && !pathField) {
    // The hook matcher only routes file-mutating tools here, so an unrecognized name means the
    // guard is out of date with the tool surface. Refuse rather than wave it through.
    return denyUnverified(
      `tool '${toolName}' reached the boundary guard, which has no verification strategy for it`
    );
  }

  const cwd = input.cwd;
  if (typeof cwd !== 'string' || cwd === '') {
    return denyUnverified('hook input contained no session working directory (cwd)');
  }

  let cwdReal;
  try {
    if (!fs.statSync(cwd).isDirectory()) {
      return denyUnverified(`session working directory '${cwd}' is not a directory`);
    }
    cwdReal = fs.realpathSync(cwd);
  } catch {
    return denyUnverified(`session working directory '${cwd}' could not be resolved`);
  }

  const toolInput = input.tool_input;
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return denyUnverified(`tool_input for '${toolName}' was missing or was not an object`);
  }

  const root = resolveProjectRoot(cwdReal);
  if (!root) {
    return denyUnverified('the project root reported by git could not be resolved on disk');
  }

  if (pathField) {
    const filePath = toolInput[pathField];
    if (typeof filePath !== 'string' || filePath === '') {
      return denyUnverified(`'${toolName}' provided no usable ${pathField}`);
    }

    let resolved;
    try {
      // path.resolve normalizes ".." even when filePath is already absolute. Resolving only
      // relative paths (the v1.3.0 behaviour) let "D:\proj-a\..\proj-b\x" pass the containment
      // check unnormalized.
      resolved = realpathDeepest(path.resolve(cwdReal, filePath), true);
    } catch {
      return denyUnverified(`the target path '${filePath}' could not be resolved`);
    }

    if (isVaultException(resolved)) return allow();
    if (!isInside(root, resolved)) {
      return denyViolation(
        `'${resolved}' is outside the verified project root '${root}' (session working ` +
          `directory: '${cwdReal}'). If this is a legitimate Obsidian memory write it must go ` +
          `through the documented protocol in docs/obsidian-memory.md.`
      );
    }
    return allow();
  }

  // Bash
  const command = toolInput.command;
  if (typeof command !== 'string' || command === '') {
    return denyUnverified("'Bash' provided no usable command string");
  }

  let violation;
  try {
    violation = checkBashCommand(command, cwdReal, root);
  } catch {
    return denyUnverified('the command could not be checked against the project boundary');
  }
  if (violation) {
    return denyViolation(
      `${violation} Session working directory: '${cwdReal}'. The command was not executed. ` +
        `This is a best-effort heuristic check on the command text, not a sandbox -- see ` +
        `docs/project-boundary.md -> Bash Safety.`
    );
  }
  return allow();
}

// Any unexpected internal error must block, never allow.
process.on('uncaughtException', (err) => {
  denyUnverified(`unexpected internal error (${(err && err.code) || 'exception'})`);
});

try {
  main();
} catch (err) {
  denyUnverified(`unexpected internal error (${(err && err.code) || 'exception'})`);
}
