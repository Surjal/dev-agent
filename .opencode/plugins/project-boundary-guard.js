// OpenCode port of hooks/project-boundary-guard.cjs (Claude Code PreToolUse hook).
// Native mechanism: OpenCode plugin `tool.execute.before` hook (see docs/opencode-port.md ->
// Mapping table). Throwing from this hook blocks the tool call -- OpenCode's equivalent of
// Claude Code's {"decision":"block"} PreToolUse response.
//
// PORTED, NOT REWRITTEN: containment/traversal/symlink/Obsidian-exception logic below is the
// same algorithm as the Claude Code guard. Two things could not be ported 1:1 -- see
// docs/opencode-port.md -> Boundary security for the honest gap analysis:
//   1. OpenCode's plugin factory receives `directory` (the project root OpenCode itself resolved)
//      but not a separate "raw session cwd" the way Claude Code's hook input supplies `cwd`
//      independent of the tool call. We treat `directory` as both root and cwd-for-resolution,
//      which is narrower/safer than the Claude version, never looser.
//   2. There is no confirmed equivalent to Claude Code's hard fail-closed guarantee on hook-process
//      startup failure -- if this plugin file itself fails to load, OpenCode's own behavior in that
//      case is undocumented (see docs/opencode-port.md). Node prerequisite doesn't apply; OpenCode
//      plugins run in-process.
//
// Fail-closed within this module: any condition we cannot positively verify throws (blocks),
// mirroring denyUnverified() in the Claude Code guard.

import { realpathSync, statSync } from "node:fs"
import path from "node:path"

const PREFIX = "dev-agent boundary guard"

function norm(p) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

function isInside(root, target) {
  const r = norm(root)
  const t = norm(target)
  return t === r || t.startsWith(r + "/")
}

function realpathDeepest(p) {
  let cur = path.resolve(p)
  const tail = []
  for (;;) {
    try {
      const real = realpathSync(cur)
      return tail.length === 0 ? real : path.resolve(real, ...tail.slice().reverse())
    } catch (err) {
      if (err && err.code === "ENOENT") {
        const parent = path.dirname(cur)
        if (parent === cur) return path.resolve(p)
        tail.push(path.basename(cur))
        cur = parent
        continue
      }
      throw err
    }
  }
}

const VAULT_EXCEPTIONS = ["d:/obsidian/work/active", "d:/obsidian/brain"]
function isVaultException(target) {
  const t = norm(target)
  return VAULT_EXCEPTIONS.some((v) => t === v || t.startsWith(v + "/"))
}

const NULL_DEVICE_RE = /^(\/dev\/(null|stdout|stderr|zero|tty)|nul)$/i
function isNullDeviceToken(token) {
  return NULL_DEVICE_RE.test(token.trim())
}

// Same token/mutating-verb heuristic as the Claude Code guard (docs/project-boundary.md -> Bash
// Safety) -- still a text heuristic, not a shell parser. Same known gaps apply.
const PATH_TOKEN_RE =
  /(?:[A-Za-z]:[\\/][^\s"'|&;<>()]+|(?<![\w./])\/(?:[^\s"'|&;<>/()]+\/?)+|(?:\.\.[\\/])+[^\s"'|&;<>()]*)/g
const MUTATING_RE =
  /(>{1,2}(?!\s*&)|(?:^|[;&|]\s*)(cp|mv|rm|rmdir|del|rd|mkdir|touch|tee|sed\s+-i|perl\s+-i|git\s+(add|commit|checkout|reset|clean|apply|rm|mv)|npm\s+(install|uninstall|init|ci)|pnpm\s+(add|remove|install)|yarn\s+(add|remove)|pip\s+install|dd\s)\b)/i
const CD_RE = /(?:^|[;&|]\s*)cd\s+(?:['"]?)([^\s'";&|]+)/gi

function checkBashCommand(command, cwdReal, root) {
  let m
  CD_RE.lastIndex = 0
  while ((m = CD_RE.exec(command))) {
    const target = m[1]
    if (isNullDeviceToken(target)) continue
    const resolved = realpathDeepest(path.resolve(cwdReal, target))
    if (!isVaultException(resolved) && !isInside(root, resolved)) {
      return `Command changes directory to '${target}' (resolves to '${resolved}'), outside project root '${root}'.`
    }
  }

  if (!MUTATING_RE.test(command)) return null

  const tokens = command.match(PATH_TOKEN_RE) || []
  for (const token of tokens) {
    if (isNullDeviceToken(token)) continue
    let resolved
    try {
      resolved = realpathDeepest(path.resolve(cwdReal, token))
    } catch {
      continue // non-strict, same as the Claude Code guard: a bad heuristic token must not false-block
    }
    if (isVaultException(resolved)) continue
    if (!isInside(root, resolved)) {
      return `Command references path '${token}' (resolves to '${resolved}'), outside project root '${root}'.`
    }
  }
  return null
}

// tool.execute.before input shape per OpenCode plugin docs: (input, output) where
// input.tool is the tool id ("bash", "edit", "write", ...) and output.args holds the tool's
// own arguments (filePath for edit/write, command for bash).
export const ProjectBoundaryGuard = async ({ directory }) => {
  let root
  try {
    if (!statSync(directory).isDirectory()) throw new Error("directory is not a directory")
    root = realpathSync(directory)
  } catch (err) {
    // Fail closed: if we can't even resolve our own root, deny every mutating call.
    root = null
  }

  return {
    "tool.execute.before": async (input, output) => {
      const tool = input.tool
      if (tool !== "bash" && tool !== "edit" && tool !== "write" && tool !== "apply_patch") return

      if (!root) {
        throw new Error(
          `${PREFIX}: project boundary verification failed; tool call blocked fail-closed ` +
            `(project directory '${directory}' could not be resolved). No file was modified.`,
        )
      }

      if (tool === "bash") {
        const command = output?.args?.command
        if (typeof command !== "string" || command === "") {
          throw new Error(`${PREFIX}: bash call had no usable command string; blocked fail-closed.`)
        }
        let violation
        try {
          violation = checkBashCommand(command, root, root)
        } catch {
          throw new Error(`${PREFIX}: command could not be checked against the project boundary; blocked fail-closed.`)
        }
        if (violation) {
          throw new Error(
            `${PREFIX}: target project boundary violation. ${violation} This is a best-effort ` +
              `heuristic check on the command text, not a sandbox -- see docs/project-boundary.md -> Bash Safety.`,
          )
        }
        return
      }

      // edit / write / apply_patch: filePath is the conventional arg name across these tools.
      const filePath = output?.args?.filePath
      if (typeof filePath !== "string" || filePath === "") {
        throw new Error(`${PREFIX}: '${tool}' call had no usable filePath; blocked fail-closed.`)
      }

      let resolved
      try {
        resolved = realpathDeepest(path.resolve(root, filePath))
      } catch {
        throw new Error(`${PREFIX}: target path '${filePath}' could not be resolved; blocked fail-closed.`)
      }

      if (isVaultException(resolved)) return
      if (!isInside(root, resolved)) {
        throw new Error(
          `${PREFIX}: target project boundary violation. '${resolved}' is outside the verified ` +
            `project root '${root}'. If this is a legitimate Obsidian memory write it must go ` +
            `through the documented protocol in docs/obsidian-memory.md.`,
        )
      }
    },
  }
}
