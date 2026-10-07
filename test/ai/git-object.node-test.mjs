// Tests for the Git object L1 resolver (A3.5b.1, ADR-AI-010 D18).
//
//   node --test test/ai/git-object.node-test.mjs
//
// Named *.node-test.mjs so Vitest never runs it in workerd. Hermetic: every repository is created
// under mkdtempSync(tmpdir()) and removed afterwards; the HLG repository is never touched. Special
// entries (symlink 120000, gitlink 160000) are built with `update-index --cacheinfo`, so no
// filesystem symlink privilege is needed. Test setup runs Git with a GIT_*-free environment.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  GIT_TIMEOUT_MS,
  MAX_BLOB_BYTES,
  createGitObjectResolver,
  runGitProcess,
  sanitizedGitEnv,
} from '../../scripts/ai/git-object.mjs';

const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
  return env;
}

function makeRepo(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  const git = (args, options = {}) =>
    execFileSync(
      'git',
      ['-c', 'user.name=hlg-test', '-c', 'user.email=hlg-test@example.invalid', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args],
      { cwd: dir, env: cleanEnv(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options },
    ).trim();
  git(['init', '-q', '.']);
  return { dir, git };
}

const BIG = 4096;

// Main fixture repository.
const main = makeRepo('hlg-git-object-');
writeFileSync(path.join(main.dir, 'a.txt'), 'line 1\nline 2\nline 3');
writeFileSync(path.join(main.dir, 'run.sh'), '#!/bin/sh\necho ok\n');
writeFileSync(path.join(main.dir, 'Upper.txt'), 'U\n');
writeFileSync(path.join(main.dir, 'my_file-v1.2.txt'), 'punctuation\n');
writeFileSync(path.join(main.dir, 'big.bin'), 'x'.repeat(BIG));
mkdirSync(path.join(main.dir, 'dir'));
writeFileSync(path.join(main.dir, 'dir', 'f.txt'), 'nested\n');
main.git(['add', 'a.txt', 'run.sh', 'Upper.txt', 'my_file-v1.2.txt', 'big.bin', 'dir/f.txt']);
main.git(['update-index', '--chmod=+x', 'run.sh']);
const linkTarget = main.git(['hash-object', '-w', '--stdin'], { input: 'a.txt' });
main.git(['update-index', '--add', '--cacheinfo', `120000,${linkTarget},link`]);
main.git(['commit', '-q', '-m', 'c1']);
const C1 = main.git(['rev-parse', 'HEAD']);
main.git(['update-index', '--add', '--cacheinfo', `160000,${C1},sub`]);
main.git(['commit', '-q', '-m', 'c2']);
const C2 = main.git(['rev-parse', 'HEAD']);
const TREE = main.git(['rev-parse', `${C2}^{tree}`]);
const BLOB_A = main.git(['rev-parse', `${C2}:a.txt`]);
const BLOB_BIG = main.git(['rev-parse', `${C2}:big.bin`]);
main.git(['tag', '-a', 'v1', '-m', 'annotated', C2]);
const TAG = main.git(['rev-parse', 'v1']);
const MISSING = 'deadbeef'.repeat(5);

// Decoy repository whose objects must never leak into the main one.
const decoy = makeRepo('hlg-git-decoy-');
writeFileSync(path.join(decoy.dir, 'decoy.txt'), 'decoy\n');
decoy.git(['add', 'decoy.txt']);
decoy.git(['commit', '-q', '-m', 'decoy']);
const DECOY = decoy.git(['rev-parse', 'HEAD']);

const resolver = createGitObjectResolver({ repoRoot: main.dir });

function countingResolver() {
  const calls = [];
  const r = createGitObjectResolver({
    repoRoot: main.dir,
    runner: (root, args, options) => {
      calls.push({ root, args: [...args] });
      return runGitProcess(root, args, options);
    },
  });
  return { r, calls };
}

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// ---------------------------------------------------------------- API

test('api: resolver is frozen, requires an explicit repoRoot and exposes three operations', () => {
  assert.ok(Object.isFrozen(resolver));
  assert.deepEqual(Object.keys(resolver), ['resolveCommit', 'resolveRegularBlob', 'readBlob']);
  for (const bad of [undefined, '', 7]) assert.throws(() => createGitObjectResolver({ repoRoot: bad }), TypeError);
  assert.throws(() => createGitObjectResolver({ repoRoot: main.dir, runner: 'git' }), TypeError);
  assert.equal(MAX_BLOB_BYTES, 2_097_152);
  assert.ok(Number.isInteger(GIT_TIMEOUT_MS) && GIT_TIMEOUT_MS > 0);
});

// ---------------------------------------------------------------- SHA validation (before Git)

test('sha: abbreviated, uppercase, malformed and empty SHAs fail before Git runs', () => {
  const { r, calls } = countingResolver();
  for (const bad of [C2.slice(0, 12), C2.toUpperCase(), `${C2}0`, C2.slice(0, 39) + 'g', '', ' '.repeat(40), 'HEAD', 'main', null, 42]) {
    assert.deepEqual(r.resolveCommit(bad), { ok: false, code: 'E_GIT_SHA_INVALID' }, String(bad));
    assert.deepEqual(r.resolveRegularBlob(bad, 'a.txt'), { ok: false, code: 'E_GIT_SHA_INVALID' }, String(bad));
    assert.deepEqual(r.readBlob(bad, 10), { ok: false, code: 'E_GIT_SHA_INVALID' }, String(bad));
  }
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------- commit resolution

test('commit: an existing commit resolves; missing, blob, tree and tag objects fail closed', () => {
  assert.deepEqual(resolver.resolveCommit(C2), { ok: true, commit: C2 });
  assert.deepEqual(resolver.resolveCommit(C1), { ok: true, commit: C1 });
  assert.deepEqual(resolver.resolveCommit(MISSING), { ok: false, code: 'E_GIT_OBJECT_MISSING' });
  assert.deepEqual(resolver.resolveCommit(BLOB_A), { ok: false, code: 'E_GIT_NOT_COMMIT', type: 'blob' });
  assert.deepEqual(resolver.resolveCommit(TREE), { ok: false, code: 'E_GIT_NOT_COMMIT', type: 'tree' });
  assert.deepEqual(resolver.resolveCommit(TAG), { ok: false, code: 'E_GIT_NOT_COMMIT', type: 'tag' });
});

test('commit: a tree SHA is rejected before any ls-tree lookup', () => {
  const { r, calls } = countingResolver();
  assert.equal(r.resolveRegularBlob(TREE, 'a.txt').code, 'E_GIT_NOT_COMMIT');
  assert.ok(!calls.some((c) => c.args.includes('ls-tree')));
});

// ---------------------------------------------------------------- regular blob resolution

test('blob: regular 100644 and executable 100755 blobs resolve', () => {
  assert.deepEqual(resolver.resolveRegularBlob(C2, 'a.txt'), { ok: true, commit: C2, path: 'a.txt', mode: '100644', oid: BLOB_A });
  const exe = resolver.resolveRegularBlob(C2, 'run.sh');
  assert.equal(exe.ok, true);
  assert.equal(exe.mode, '100755');
  assert.equal(resolver.resolveRegularBlob(C2, 'dir/f.txt').mode, '100644');
});

test('blob: missing path, tree, symlink and gitlink fail closed', () => {
  assert.deepEqual(resolver.resolveRegularBlob(C2, 'missing.txt'), { ok: false, code: 'E_GIT_PATH_MISSING' });
  assert.deepEqual(resolver.resolveRegularBlob(C2, 'dir/missing.txt'), { ok: false, code: 'E_GIT_PATH_MISSING' });
  assert.deepEqual(resolver.resolveRegularBlob(C2, 'dir'), { ok: false, code: 'E_GIT_NOT_REGULAR_BLOB', mode: '040000' });
  assert.deepEqual(resolver.resolveRegularBlob(C2, 'link'), { ok: false, code: 'E_GIT_NOT_REGULAR_BLOB', mode: '120000' });
  assert.deepEqual(resolver.resolveRegularBlob(C2, 'sub'), { ok: false, code: 'E_GIT_NOT_REGULAR_BLOB', mode: '160000' });
  // The gitlink did not exist yet in C1.
  assert.deepEqual(resolver.resolveRegularBlob(C1, 'sub'), { ok: false, code: 'E_GIT_PATH_MISSING' });
});

test('blob: a case-only different path does not resolve (exact Git path identity)', () => {
  assert.equal(resolver.resolveRegularBlob(C2, 'Upper.txt').ok, true);
  for (const p of ['upper.txt', 'UPPER.TXT', 'A.txt', 'Dir/f.txt']) {
    assert.deepEqual(resolver.resolveRegularBlob(C2, p), { ok: false, code: 'E_GIT_PATH_MISSING' }, p);
  }
});

test('blob: the returned entry must name exactly the requested path, once', () => {
  const entry = (p) => Buffer.from(`100644 blob ${BLOB_A}\t${p}\0`, 'latin1');
  const fake = (lsTreeOutput) =>
    createGitObjectResolver({
      repoRoot: main.dir,
      runner: (root, args, options) => (args[0] === 'ls-tree' ? lsTreeOutput : runGitProcess(root, args, options)),
    });
  assert.deepEqual(fake(entry('A.txt')).resolveRegularBlob(C2, 'a.txt'), { ok: false, code: 'E_GIT_PATH_MISMATCH' });
  assert.deepEqual(fake(Buffer.concat([entry('a.txt'), entry('a.txt')])).resolveRegularBlob(C2, 'a.txt'), { ok: false, code: 'E_GIT_PATH_MISMATCH' });
  assert.deepEqual(fake(Buffer.from('garbage\0')).resolveRegularBlob(C2, 'a.txt'), { ok: false, code: 'E_GIT_OUTPUT_INVALID' });
  assert.deepEqual(fake(Buffer.alloc(0)).resolveRegularBlob(C2, 'a.txt'), { ok: false, code: 'E_GIT_PATH_MISSING' });
});

// L-1: a hand-built (malformed) tree whose 100644 entries point at a tree, a commit, a tag and a
// missing object. ls-tree reports every one of them as "100644 blob" because it derives the type
// from the mode; the resolver must check the referenced object itself.
function malformedCommit() {
  const entry = (mode, name, sha) => Buffer.concat([Buffer.from(`${mode} ${name}\0`, 'latin1'), Buffer.from(sha, 'hex')]);
  const raw = Buffer.concat([
    entry('100644', 'fake-commit', C1),
    entry('100644', 'fake-missing', MISSING),
    entry('100644', 'fake-tag', TAG),
    entry('100644', 'fake-tree', TREE),
    entry('100644', 'real.txt', BLOB_A),
  ]);
  const tree = main.git(['hash-object', '-t', 'tree', '--literally', '-w', '--stdin'], { input: raw });
  return main.git(['commit-tree', tree, '-m', 'malformed']);
}
const BAD = malformedCommit();

test('L-1: ls-tree really reports the malformed entries as regular blobs (fixture check)', () => {
  for (const name of ['fake-tree', 'fake-missing', 'fake-commit', 'fake-tag']) {
    assert.match(main.git(['ls-tree', BAD, '--', name]), /^100644 blob [0-9a-f]{40}\t/, name);
  }
});

test('L-1: resolveRegularBlob confirms the referenced object is an existing blob', () => {
  assert.deepEqual(resolver.resolveRegularBlob(BAD, 'fake-tree'), { ok: false, code: 'E_GIT_NOT_BLOB', type: 'tree' });
  assert.deepEqual(resolver.resolveRegularBlob(BAD, 'fake-missing'), { ok: false, code: 'E_GIT_OBJECT_MISSING' });
  assert.deepEqual(resolver.resolveRegularBlob(BAD, 'fake-commit'), { ok: false, code: 'E_GIT_NOT_BLOB', type: 'commit' });
  assert.deepEqual(resolver.resolveRegularBlob(BAD, 'fake-tag'), { ok: false, code: 'E_GIT_NOT_BLOB', type: 'tag' });
  assert.deepEqual(resolver.resolveRegularBlob(BAD, 'real.txt'), { ok: true, commit: BAD, path: 'real.txt', mode: '100644', oid: BLOB_A });
});

test('L-1: the object check runs after ls-tree on the oid it returned', () => {
  const { r, calls } = countingResolver();
  assert.equal(r.resolveRegularBlob(C2, 'a.txt').ok, true);
  const names = calls.map((c) => c.args[0] + (c.args[1] === '--batch-check' ? ' --batch-check' : ''));
  assert.deepEqual(names, ['cat-file --batch-check', 'ls-tree', 'cat-file --batch-check']);
  assert.equal(calls[2].args.length, 2);
});

test('path: L0-valid punctuation is passed literally, as one argv element after "--"', () => {
  const { r, calls } = countingResolver();
  const res = r.resolveRegularBlob(C2, 'my_file-v1.2.txt');
  assert.equal(res.ok, true);
  const ls = calls.find((c) => c.args[0] === 'ls-tree');
  assert.deepEqual(ls.args, ['ls-tree', '-z', '--full-tree', C2, '--', 'my_file-v1.2.txt']);
  assert.equal(ls.root, main.dir);
});

// ---------------------------------------------------------------- L0 before Git

test('L0: unsafe paths fail closed with zero Git invocations', () => {
  const { r, calls } = countingResolver();
  const cases = {
    'CLAUDE.md.': ['PATH-TRAILING-DOT'],
    CON: ['PATH-DEVICE-NAME'],
    'aux.json': ['PATH-DEVICE-NAME'],
    '.git/config': ['PATH-GIT-SEGMENT'],
    '-rf': ['PATH-LEADING-DASH'],
    '../a.txt': ['PATH-GRAMMAR'],
    '/a.txt': ['PATH-GRAMMAR'],
    'a b.txt': ['PATH-GRAMMAR'],
    'dir/': ['PATH-GRAMMAR'],
    ':(glob)*': ['PATH-GRAMMAR'],
    '': ['PATH-GRAMMAR'],
  };
  for (const [p, violations] of Object.entries(cases)) {
    assert.deepEqual(r.resolveRegularBlob(C2, p), { ok: false, code: 'E_GIT_PATH_UNSAFE', violations }, p);
  }
  assert.deepEqual(r.resolveRegularBlob(C2, 7), { ok: false, code: 'E_GIT_PATH_UNSAFE', violations: ['PATH-GRAMMAR'] });
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------- replace objects

test('replace: a replace ref cannot substitute commits or blob content', () => {
  const evil = main.git(['hash-object', '-w', '--stdin'], { input: 'EVIL CONTENT' });
  main.git(['replace', BLOB_A, evil]);
  const evilCommit = main.git(['commit-tree', TREE, '-m', 'evil']);
  main.git(['replace', C1, evilCommit]);
  try {
    // Plain Git (as a sanity check) does follow the replace ref...
    assert.equal(main.git(['cat-file', 'blob', BLOB_A]), 'EVIL CONTENT');
    // ...the resolver does not.
    const blob = resolver.readBlob(BLOB_A, 1000);
    assert.equal(Buffer.from(blob.bytes).toString('utf8'), 'line 1\nline 2\nline 3');
    assert.deepEqual(resolver.resolveRegularBlob(C2, 'a.txt'), { ok: true, commit: C2, path: 'a.txt', mode: '100644', oid: BLOB_A });
    assert.deepEqual(resolver.resolveRegularBlob(C1, 'sub'), { ok: false, code: 'E_GIT_PATH_MISSING' });
  } finally {
    main.git(['replace', '-d', BLOB_A]);
    main.git(['replace', '-d', C1]);
  }
});

// ---------------------------------------------------------------- environment sanitization

test('env: sanitizedGitEnv removes every GIT_* variable (any case) and sets the three required ones', () => {
  const env = sanitizedGitEnv({
    PATH: '/usr/bin',
    HOME: '/home/x',
    GIT_DIR: '/x',
    git_work_tree: '/y',
    Git_Object_Directory: '/z',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '/w',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.x',
    GIT_CONFIG_VALUE_0: 'y',
    GIT_CONFIG_PARAMETERS: "'a.b'='c'",
    GIT_INDEX_FILE: '/i',
    GIT_REPLACE_REF_BASE: 'refs/x/',
    GIT_NO_REPLACE_OBJECTS: '0',
    GIT_TERMINAL_PROMPT: '1',
    GIT_EXEC_PATH: '/e',
    GIT_SSH_COMMAND: 'evil',
    GIT_NO_LAZY_FETCH: '0',
  });
  assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/home/x', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' });
});

test('env: an inherited GIT_NO_LAZY_FETCH=0 is overridden to 1 for every Git call', () => {
  withEnv({ GIT_NO_LAZY_FETCH: '0', git_no_lazy_fetch: '0' }, () => {
    const env = sanitizedGitEnv();
    assert.equal(env.GIT_NO_LAZY_FETCH, '1');
    assert.equal(Object.keys(env).filter((k) => /^GIT_NO_LAZY_FETCH$/i.test(k)).length, 1);
  });
});

test('env: inherited GIT_DIR, GIT_OBJECT_DIRECTORY and GIT_ALTERNATE_OBJECT_DIRECTORIES are ignored', () => {
  const decoyGit = path.join(decoy.dir, '.git');
  const decoyObjects = path.join(decoyGit, 'objects');
  withEnv({ GIT_DIR: decoyGit }, () => {
    assert.deepEqual(resolver.resolveCommit(C2), { ok: true, commit: C2 });
    assert.deepEqual(resolver.resolveCommit(DECOY), { ok: false, code: 'E_GIT_OBJECT_MISSING' });
  });
  withEnv({ GIT_OBJECT_DIRECTORY: decoyObjects }, () => {
    assert.deepEqual(resolver.resolveCommit(C2), { ok: true, commit: C2 });
    assert.deepEqual(resolver.resolveCommit(DECOY), { ok: false, code: 'E_GIT_OBJECT_MISSING' });
  });
  withEnv({ GIT_ALTERNATE_OBJECT_DIRECTORIES: decoyObjects }, () => {
    assert.deepEqual(resolver.resolveCommit(DECOY), { ok: false, code: 'E_GIT_OBJECT_MISSING' });
  });
  withEnv({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.repositoryformatversion', GIT_CONFIG_VALUE_0: '99' }, () => {
    assert.deepEqual(resolver.resolveCommit(C2), { ok: true, commit: C2 });
  });
  withEnv({ GIT_NO_REPLACE_OBJECTS: '0' }, () => {
    assert.equal(sanitizedGitEnv().GIT_NO_REPLACE_OBJECTS, '1');
  });
});

// ---------------------------------------------------------------- L-2: partial clone, no lazy fetch

// A disposable promisor remote and a blob:none partial clone of it, over file:// (no network).
test('L-2: a missing promisor blob is reported missing and never fetched', () => {
  const server = makeRepo('hlg-git-promisor-src-');
  writeFileSync(path.join(server.dir, 'lazy.txt'), 'lazy content\n');
  server.git(['add', 'lazy.txt']);
  server.git(['commit', '-q', '-m', 'lazy']);
  server.git(['config', 'uploadpack.allowFilter', 'true']);
  server.git(['config', 'uploadpack.allowAnySHA1InWant', 'true']);
  const cloneDir = mkdtempSync(path.join(tmpdir(), 'hlg-git-promisor-clone-'));
  roots.push(cloneDir);
  execFileSync('git', ['clone', '-q', '--no-local', '--filter=blob:none', '--no-checkout', pathToFileURL(server.dir).href, cloneDir], {
    env: cleanEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const inClone = (args, env) => execFileSync('git', args, { cwd: cloneDir, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const head = inClone(['rev-parse', 'HEAD'], cleanEnv());
  const blob = inClone(['rev-parse', 'HEAD:lazy.txt'], cleanEnv());
  const present = () => {
    try {
      inClone(['cat-file', '-e', blob], { ...cleanEnv(), GIT_NO_LAZY_FETCH: '1' });
      return true;
    } catch {
      return false;
    }
  };
  assert.equal(present(), false, 'fixture: the blob must start out missing in the partial clone');

  const clone = createGitObjectResolver({ repoRoot: cloneDir });
  withEnv({ GIT_NO_LAZY_FETCH: '0' }, () => {
    assert.deepEqual(clone.readBlob(blob, 100), { ok: false, code: 'E_GIT_OBJECT_MISSING' });
    assert.deepEqual(clone.resolveRegularBlob(head, 'lazy.txt'), { ok: false, code: 'E_GIT_OBJECT_MISSING' });
  });
  assert.equal(present(), false, 'the resolver must not have fetched the blob');

  // Control: plain Git with lazy fetch allowed does fetch it, so the clone really is a promisor.
  assert.equal(inClone(['cat-file', '-p', blob], cleanEnv()), 'lazy content');
  assert.equal(present(), true);
});

// ---------------------------------------------------------------- working-tree independence

test('worktree: editing or deleting files on disk does not change committed results', () => {
  const file = path.join(main.dir, 'a.txt');
  writeFileSync(file, 'CHANGED ON DISK');
  try {
    assert.equal(Buffer.from(resolver.readBlob(BLOB_A, 100).bytes).toString('utf8'), 'line 1\nline 2\nline 3');
    assert.equal(resolver.resolveRegularBlob(C2, 'a.txt').oid, BLOB_A);
    rmSync(file);
    assert.equal(resolver.resolveRegularBlob(C2, 'a.txt').oid, BLOB_A);
  } finally {
    writeFileSync(file, 'line 1\nline 2\nline 3');
  }
});

// ---------------------------------------------------------------- blob reading

test('read: size is checked before reading; the cap is inclusive; over-cap is rejected', () => {
  const { r, calls } = countingResolver();
  const atCap = r.readBlob(BLOB_BIG, BIG);
  assert.equal(atCap.ok, true);
  assert.equal(atCap.size, BIG);
  assert.equal(atCap.bytes.length, BIG);
  calls.length = 0;
  assert.deepEqual(r.readBlob(BLOB_BIG, BIG - 1), { ok: false, code: 'E_GIT_TOO_LARGE', size: BIG });
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2)), [['cat-file', '--batch-check']]);
  assert.ok(atCap.bytes instanceof Uint8Array);
});

test('read: missing and non-blob objects fail closed; maxBytes is bounded', () => {
  assert.deepEqual(resolver.readBlob(MISSING, 10), { ok: false, code: 'E_GIT_OBJECT_MISSING' });
  assert.deepEqual(resolver.readBlob(C2, MAX_BLOB_BYTES), { ok: false, code: 'E_GIT_NOT_BLOB', type: 'commit' });
  assert.deepEqual(resolver.readBlob(TREE, MAX_BLOB_BYTES), { ok: false, code: 'E_GIT_NOT_BLOB', type: 'tree' });
  for (const bad of [-1, 1.5, MAX_BLOB_BYTES + 1, '10', undefined]) {
    assert.throws(() => resolver.readBlob(BLOB_A, bad), TypeError, String(bad));
  }
  const empty = main.git(['hash-object', '-w', '--stdin'], { input: '' });
  assert.deepEqual({ ...resolver.readBlob(empty, 0), bytes: undefined }, { ok: true, oid: empty, size: 0, bytes: undefined });
});

// ---------------------------------------------------------------- failure handling and determinism

test('failure: Git errors never become success and expose no stderr', () => {
  const broken = createGitObjectResolver({
    repoRoot: main.dir,
    runner: () => {
      throw new Error('fatal: something with /secret/path');
    },
  });
  for (const res of [broken.resolveCommit(C2), broken.resolveRegularBlob(C2, 'a.txt'), broken.readBlob(BLOB_A, 10)]) {
    assert.deepEqual(res, { ok: false, code: 'E_GIT_FAILED' });
  }
  const nowhere = createGitObjectResolver({ repoRoot: path.join(main.dir, 'does-not-exist') });
  assert.deepEqual(nowhere.resolveCommit(C2), { ok: false, code: 'E_GIT_FAILED' });
});

test('determinism: same objects and inputs give deep-equal results', () => {
  const other = createGitObjectResolver({ repoRoot: main.dir });
  for (const [c, p] of [[C2, 'a.txt'], [C2, 'run.sh'], [C2, 'link'], [C2, 'missing.txt'], [MISSING, 'a.txt']]) {
    assert.deepEqual(resolver.resolveRegularBlob(c, p), other.resolveRegularBlob(c, p));
    assert.deepEqual(resolver.resolveRegularBlob(c, p), resolver.resolveRegularBlob(c, p));
  }
});

// ---------------------------------------------------------------- process boundary (static)

test('process: Git runs via execFileSync with an argv array and shell: false only', () => {
  const source = readFileSync('scripts/ai/git-object.mjs', 'utf8');
  // The only process API imported is execFileSync, and it is called once, with argv and no shell.
  const childImports = source.match(/^import .* from 'node:child_process';$/gm);
  assert.deepEqual(childImports, ["import { execFileSync } from 'node:child_process';"]);
  assert.equal(source.match(/execFileSync\(/g).length, 1);
  assert.match(source, /execFileSync\('git', \[\.\.\.GIT_GLOBAL_ARGS, \.\.\.args\]/);
  assert.match(source, /shell: false/);
  assert.match(source, /'--no-replace-objects', '--literal-pathspecs'/);
  for (const forbidden of [/\bexecSync\(/, /\bspawnSync\(/, /\bspawn\(/, /\bfork\(/, /\bexecFile\(/, /shell: true/, /cmd\.exe|powershell|\/bin\/sh|\bbash\b/i, /node:fs|readFileSync|createReadStream/]) {
    assert.ok(!forbidden.test(source), String(forbidden));
  }
});
