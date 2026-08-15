#!/usr/bin/env node
// PreToolUse hook (Edit|Write|Bash): block file modifications outside the current session's
// project root. See docs/project-boundary.md for the full design and its honest limitations.
//
// Fails OPEN (allows the call) on any internal error reading/parsing input, or when the target
// project root can't be determined at all -- this hook augments the existing prompt-layer rules,
// it is not the sole safety mechanism, and a bug in it must not make the plugin unusable.
// Fails CLOSED (blocks) only for the one case it exists to catch: a resolved, concrete target
// path that is demonstrably outside the resolved project root.

const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function allow() {
  process.exit(0);
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

// Normalize for comparison only -- lowercase, forward slashes, no trailing slash.
// Windows paths are case-insensitive; this is a comparison-time normalization, not a path rewrite.
function norm(p) {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// True containment, not string-prefix: "d:/x/project-a" must not match "d:/x/project-ab".
function isInside(root, target) {
  const r = norm(root);
  const t = norm(target);
  return t === r || t.startsWith(r + '/');
}

const VAULT_EXCEPTIONS = [
  'd:/obsidian/work/active',
  'd:/obsidian/brain',
];

function isVaultException(target) {
  const t = norm(target);
  return VAULT_EXCEPTIONS.some((v) => t === v || t.startsWith(v + '/'));
}

function resolveProjectRoot(cwd) {
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) return out;
  } catch {
    // Not a git repo (or git unavailable) -- fall back to cwd itself as the root.
  }
  return cwd;
}

// Matches: Windows absolute (C:\...), Unix absolute (/...), and relative traversal (../..., ..\...).
// A bare relative token with no ".." (e.g. "math.js", "src/foo.js") always resolves under cwd by
// construction -- only these three forms can possibly resolve outside the project root.
const PATH_TOKEN_RE = /(?:[A-Za-z]:[\\/][^\s"'|&;<>]+|(?<![\w./])\/(?:[^\s"'|&;<>/]+\/?)+|(?:\.\.[\\/])+[^\s"'|&;<>]*)/g;
const MUTATING_RE = /(>{1,2}(?!\s*&)|(?:^|[;&|]\s*)(cp|mv|rm|rmdir|del|rd|mkdir|touch|tee|sed\s+-i|perl\s+-i|git\s+(add|commit|checkout|reset|clean|apply|rm|mv)|npm\s+(install|uninstall|init|ci)|pnpm\s+(add|remove|install)|yarn\s+(add|remove)|pip\s+install|dd\s)\b)/i;
const CD_RE = /(?:^|[;&|]\s*)cd\s+(?:['"]?)([^\s'";&|]+)/gi;

function checkBashCommand(command, cwd, root) {
  // Explicit cd to somewhere outside root (relative or absolute): block outright, effects
  // afterward aren't confidently constrained since later relative paths would resolve against it.
  let m;
  CD_RE.lastIndex = 0;
  while ((m = CD_RE.exec(command))) {
    const target = m[1];
    const resolvedCd = path.resolve(cwd, target);
    if (!isVaultException(resolvedCd) && !isInside(root, resolvedCd)) {
      return `cd to '${target}' (resolves to '${resolvedCd}'), which is outside the project root '${root}'`;
    }
  }

  if (!MUTATING_RE.test(command)) return null; // no write-shaped intent detected -- allow

  const matches = command.match(PATH_TOKEN_RE) || [];
  for (const m2 of matches) {
    const resolved2 = path.resolve(cwd, m2);
    if (isVaultException(resolved2)) continue;
    if (!isInside(root, resolved2)) {
      return `command references path '${m2}' (resolves to '${resolved2}'), which is outside the project root '${root}'`;
    }
  }
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return allow(); // can't read/parse input -- fail open, this hook can't do anything useful
  }

  const cwd = input.cwd;
  const toolName = input.tool_name;
  const toolInput = input.tool_input || {};

  if (!cwd || !toolName) return allow();
  if (!['Edit', 'Write', 'Bash'].includes(toolName)) return allow();

  let root;
  try {
    root = resolveProjectRoot(cwd);
  } catch {
    return allow(); // couldn't establish a root at all -- fail open, not fail closed on everything
  }

  if (toolName === 'Edit' || toolName === 'Write') {
    const filePath = toolInput.file_path;
    if (!filePath) return allow();
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    if (isVaultException(resolved)) return allow();
    if (!isInside(root, resolved)) {
      return block(
        `Target project boundary violation: '${resolved}' is outside the verified project root ` +
          `'${root}' (session working directory: '${cwd}'). No file was modified. If this path is ` +
          `intentional (e.g. a legitimate Obsidian memory write), it must go through the ` +
          `documented protocol in docs/obsidian-memory.md, not a direct Edit/Write.`
      );
    }
    return allow();
  }

  if (toolName === 'Bash') {
    const command = toolInput.command;
    if (!command) return allow();
    const violation = checkBashCommand(command, cwd, root);
    if (violation) {
      return block(
        `Target project boundary violation (Bash): ${violation}. Session working directory: ` +
          `'${cwd}'. Command was not executed. This is a best-effort heuristic check on the ` +
          `command text, not a full sandbox -- see docs/project-boundary.md -> Bash Safety.`
      );
    }
    return allow();
  }

  return allow();
}

try {
  main();
} catch {
  allow(); // any unexpected internal error -- fail open, never let this hook hang/crash the session
}
