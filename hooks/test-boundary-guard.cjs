#!/usr/bin/env node
'use strict';
// Focused unit tests for hooks/project-boundary-guard.cjs.
// Run: node hooks/test-boundary-guard.cjs
//
// Each case feeds a hook payload on stdin and asserts the process outcome:
//   ALLOW = exit 0, no deny payload
//   DENY  = exit 2 and a deny payload on stdout
// Deliberately small: no framework, no fixtures directory, no watch mode.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const GUARD = path.join(__dirname, 'project-boundary-guard.cjs');

// Real directories are required: the guard resolves cwd and target paths on disk.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'boundary-guard-'));
const ROOT = path.join(TMP, 'project-a');
const SIBLING = path.join(TMP, 'project-ab'); // prefix-attack sibling
const OUTSIDE = path.join(TMP, 'outside');
for (const d of [ROOT, path.join(ROOT, 'src'), SIBLING, OUTSIDE]) fs.mkdirSync(d, { recursive: true });

// ROOT must be its own git repository. os.tmpdir() on this machine lives under the user's home
// directory, which is itself a git repo -- without this, `git rev-parse --show-toplevel` would
// correctly resolve the root to the home directory and every "outside" fixture would be inside it.
spawnSync('git', ['init', '-q'], { cwd: ROOT });
spawnSync('git', ['init', '-q'], { cwd: SIBLING });
// OUTSIDE must also be its own repo for the wrong-cwd test below: without this, git would walk up
// from OUTSIDE to the enclosing TMP/home-directory repo, which (since ROOT lives under the same
// TMP) would legitimately widen the root to include ROOT -- a false failure of the test, not a
// bypass of the guard (this is exactly the monorepo-widening behavior the guard is supposed to have).
spawnSync('git', ['init', '-q'], { cwd: OUTSIDE });

let pass = 0;
let fail = 0;

function run(payload) {
  const res = spawnSync(process.execPath, [GUARD], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, DEV_AGENT_GUARD_DEBUG: '' },
  });
  const denied = res.status === 2 || /"permissionDecision"\s*:\s*"deny"/.test(res.stdout || '');
  return { denied, status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function check(name, payload, expected) {
  const r = run(payload);
  const actual = r.denied ? 'DENY' : 'ALLOW';
  if (actual === expected) {
    pass++;
    console.log(`  PASS  ${name}  (${actual})`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  expected ${expected}, got ${actual} (exit ${r.status})`);
    if (r.stdout) console.log(`        stdout: ${r.stdout.slice(0, 200)}`);
  }
}

function edit(file_path, cwd = ROOT) {
  return { cwd, tool_name: 'Edit', tool_input: { file_path } };
}
function write(file_path, cwd = ROOT) {
  return { cwd, tool_name: 'Write', tool_input: { file_path } };
}
function bash(command, cwd = ROOT) {
  return { cwd, tool_name: 'Bash', tool_input: { command } };
}

console.log('\nboundary guard unit tests\n');

console.log('in-bounds (must ALLOW):');
check('edit file inside root', edit(path.join(ROOT, 'src', 'a.js')), 'ALLOW');
check('write new file inside root', write(path.join(ROOT, 'src', 'new.js')), 'ALLOW');
check('relative path inside root', edit('src/a.js'), 'ALLOW');
check('relative path that stays inside via ..', edit('src/../src/a.js'), 'ALLOW');
check('bash non-mutating command', bash('npm test'), 'ALLOW');
check('bash mutating inside root', bash('touch src/x.js'), 'ALLOW');
check('bash redirect inside root', bash('echo hi > src/out.txt'), 'ALLOW');
check('bash cd inside root', bash('cd src && npm test'), 'ALLOW');
check('bash redirect to /dev/null (v1.4.0 false positive)', bash('npm test > /dev/null 2>&1'), 'ALLOW');
check('bash redirect stderr to /dev/null', bash('npm test 2>/dev/null'), 'ALLOW');
check('bash cd to /dev/null (nonsensical but must not crash/misresolve)', bash('cd /dev/null'), 'ALLOW');
check('bash tee to /dev/null', bash('echo hi | tee /dev/null'), 'ALLOW');
check('bash redirect to Windows NUL', bash('npm test > NUL 2>&1'), 'ALLOW');
check(
  '/dev/null inside command substitution with trailing paren (v1.4.1 false positive)',
  bash('basename "$(git rev-parse --show-toplevel 2>/dev/null)"'),
  'ALLOW'
);
check(
  '/dev/null with trailing semicolon',
  bash('npm test 2>/dev/null; echo done'),
  'ALLOW'
);

console.log('\nout-of-bounds (must DENY):');
check('edit absolute path outside', edit(path.join(OUTSIDE, 'f.txt')), 'DENY');
check('write absolute path outside', write(path.join(OUTSIDE, 'f.txt')), 'DENY');
check('sibling prefix attack project-ab', edit(path.join(SIBLING, 'f.txt')), 'DENY');
check('relative .. traversal', edit('../outside/f.txt'), 'DENY');
check('deep relative traversal', edit('src/../../outside/f.txt'), 'DENY');
// The v1.3.0 bug: absolute path containing ".." was never normalized before containment check.
check(
  'absolute path containing .. (v1.3.0 bypass)',
  edit(path.join(ROOT, '..', 'outside', 'f.txt')),
  'DENY'
);
check(
  'absolute path with .. into prefix sibling',
  edit(`${ROOT}${path.sep}..${path.sep}project-ab${path.sep}f.txt`),
  'DENY'
);
check('bash cp to outside via relative', bash('cp package.json ../outside/copy.json'), 'DENY');
check('bash cp to outside via absolute', bash(`cp package.json ${OUTSIDE}\\copy.json`), 'DENY');
check('bash redirect outside', bash(`echo pwned > ${OUTSIDE}\\pwned.txt`), 'DENY');
check('bash cd outside', bash('cd ../outside && rm -rf .'), 'DENY');
check(
  '/dev/null exemption does not mask a real outside mutation in the same command',
  bash(`cp package.json ${OUTSIDE}\\copy.json 2>/dev/null`),
  'DENY'
);
check(
  'excluding ) from path tokens does not let a paren-adjacent outside path slip through',
  bash(`cp package.json $(echo ${OUTSIDE}\\evil.json)`),
  'DENY'
);

console.log('\nobsidian exception:');
check('obsidian work/active allowed', write('D:\\obsidian\\work\\active\\Proj.md'), 'ALLOW');
check('obsidian brain allowed', write('D:\\obsidian\\brain\\Gotchas.md'), 'ALLOW');
check('obsidian other path denied', write('D:\\obsidian\\some-other-file.md'), 'DENY');
check('obsidian vault root denied', write('D:\\obsidian\\secrets.md'), 'DENY');
check('obsidian prefix attack denied', write('D:\\obsidian\\brain-evil\\x.md'), 'DENY');

console.log('\nfail-closed: malformed / unverifiable input (must DENY):');
check('empty stdin', '', 'DENY');
check('not json', 'this is not json', 'DENY');
check('json array not object', '[]', 'DENY');
check('json null', 'null', 'DENY');
check('missing tool_name', { cwd: ROOT, tool_input: { file_path: 'a.js' } }, 'DENY');
check('missing cwd', { tool_name: 'Edit', tool_input: { file_path: 'a.js' } }, 'DENY');
check('cwd does not exist', edit('a.js', path.join(TMP, 'no-such-dir')), 'DENY');
check('cwd is a file not a dir', edit('a.js', GUARD), 'DENY');
check('missing tool_input', { cwd: ROOT, tool_name: 'Edit' }, 'DENY');
check('tool_input not an object', { cwd: ROOT, tool_name: 'Edit', tool_input: 'nope' }, 'DENY');
check('Edit with no file_path', { cwd: ROOT, tool_name: 'Edit', tool_input: {} }, 'DENY');
check('Edit with null file_path', edit(null), 'DENY');
check('Bash with no command', { cwd: ROOT, tool_name: 'Bash', tool_input: {} }, 'DENY');
check('unknown tool reaching the guard', { cwd: ROOT, tool_name: 'FutureWriteTool', tool_input: {} }, 'DENY');
check('NotebookEdit outside root', { cwd: ROOT, tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(OUTSIDE, 'n.ipynb') } }, 'DENY');
check('NotebookEdit inside root', { cwd: ROOT, tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(ROOT, 'n.ipynb') } }, 'ALLOW');
check('MultiEdit outside root', { cwd: ROOT, tool_name: 'MultiEdit', tool_input: { file_path: path.join(OUTSIDE, 'f.js') } }, 'DENY');
check('MultiEdit inside root', { cwd: ROOT, tool_name: 'MultiEdit', tool_input: { file_path: path.join(ROOT, 'src', 'a.js') } }, 'ALLOW');

console.log('\nwrong cwd / stated-target does not override real cwd:');
// A session sitting in OUTSIDE cannot write into ROOT just because a prompt claims ROOT is the
// target -- the guard only ever trusts the payload's own cwd field.
check('edit into a different project than the real cwd', edit(path.join(ROOT, 'src', 'a.js'), OUTSIDE), 'DENY');

console.log('\nsymlink / junction escape (must DENY):');
{
  const linkPath = path.join(ROOT, 'linked-out');
  try {
    fs.symlinkSync(OUTSIDE, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    check(
      'path through a junction planted inside root, pointing outside',
      edit(path.join(linkPath, 'escape.js')),
      'DENY'
    );
  } catch (err) {
    console.log(`  SKIP  junction/symlink test -- could not create link (${err.code || err.message})`);
  }
}

// Simulated internal failure: the guard must block, not wave the call through.
console.log('\nfail-closed: simulated internal error (must DENY):');
{
  const broken = path.join(TMP, 'broken-guard.cjs');
  const src = fs.readFileSync(GUARD, 'utf8').replace(
    'function main() {',
    'function main() {\n  throw new Error("simulated internal failure");'
  );
  fs.writeFileSync(broken, src);
  const res = spawnSync(process.execPath, [broken], {
    input: JSON.stringify(edit(path.join(ROOT, 'src', 'a.js'))),
    encoding: 'utf8',
  });
  const denied = res.status === 2 || /"permissionDecision"\s*:\s*"deny"/.test(res.stdout || '');
  if (denied) {
    pass++;
    console.log('  PASS  thrown exception inside main -> DENY');
  } else {
    fail++;
    console.log(`  FAIL  thrown exception inside main -> expected DENY, got exit ${res.status}`);
  }
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
