// Tests for the EvidenceRef verifier (A3.5b.2, ADR-AI-010).
//
//   node --test test/ai/verify-evidence.node-test.mjs
//
// Named *.node-test.mjs so Vitest never runs it in workerd. Hermetic: every repository is created
// under mkdtempSync(tmpdir()) and removed afterwards; the HLG repository is never touched. Special
// entries (symlink 120000, gitlink 160000) are built with `update-index --cacheinfo`. Test setup
// runs Git with a GIT_*-free environment. CI facts come from in-memory trusted snapshots only.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGitObjectResolver, runGitProcess } from '../../scripts/ai/git-object.mjs';
import {
  CI_SNAPSHOT_ENVELOPE,
  EVIDENCE_KINDS,
  MAX_REFS,
  REPO_LINE_MAX_BYTES,
  createEvidenceVerifier,
} from '../../scripts/ai/verify-evidence.mjs';

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

// ---------------------------------------------------------------- fixture

const MAX = REPO_LINE_MAX_BYTES;
const repo = makeRepo('hlg-verify-evidence-');
const put = (name, data) => {
  const full = path.join(repo.dir, ...name.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, data);
};

// Base commit C1.
put('mod.txt', 'old\n');
put('del.txt', 'gone\n');
put('same.txt', 'same\n');
put('mode.sh', '#!/bin/sh\necho ok\n');
put('flip', 'regular in base\n');
repo.git(['add', 'mod.txt', 'del.txt', 'same.txt', 'mode.sh', 'flip']);
const linkTarget = repo.git(['hash-object', '-w', '--stdin'], { input: 'same.txt' });
repo.git(['update-index', '--add', '--cacheinfo', `120000,${linkTarget},link`]);
repo.git(['commit', '-q', '-m', 'c1']);
const C1 = repo.git(['rev-parse', 'HEAD']);

// Head commit C2.
put('mod.txt', 'new\n');
put('add.txt', 'added\n');
put('lines3.txt', 'a\nb\nc');
put('lf.txt', 'a\nb\n');
put('crlf.txt', 'a\r\nb\r\n');
put('cr.txt', 'a\rb\rc');
put('empty.txt', '');
put('blank.txt', 'a\n\n\n');
put('bom.txt', Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0a]));
put('nulbyte.txt', Buffer.from([0x61, 0x00, 0x62, 0x0a]));
put('bad-utf8.txt', Buffer.from([0x61, 0xc3, 0x28, 0x0a]));
put('max.txt', Buffer.alloc(MAX, 0x78));
put('over.txt', Buffer.alloc(MAX + 1, 0x78));
put('dir/f.txt', 'nested\n');
put('test/x.node-test.mjs', "import { test } from 'node:test';\n");
repo.git(['rm', '-q', '--cached', 'del.txt', 'flip']);
repo.git(['add', 'mod.txt', 'add.txt', 'lines3.txt', 'lf.txt', 'crlf.txt', 'cr.txt', 'empty.txt', 'blank.txt', 'bom.txt', 'nulbyte.txt', 'bad-utf8.txt', 'max.txt', 'over.txt', 'dir/f.txt', 'test/x.node-test.mjs']);
repo.git(['update-index', '--chmod=+x', 'mode.sh']);
repo.git(['update-index', '--add', '--cacheinfo', `120000,${linkTarget},flip`]);
repo.git(['update-index', '--add', '--cacheinfo', `160000,${C1},sub`]);
repo.git(['commit', '-q', '-m', 'c2']);
const C2 = repo.git(['rev-parse', 'HEAD']);
const oidAt = (commit, p) => repo.git(['rev-parse', `${commit}:${p}`]);
const BLOB_SAME = oidAt(C2, 'same.txt');
const MISSING = 'deadbeef'.repeat(5);

const verifier = createEvidenceVerifier({ repoRoot: repo.dir, expectedCommit: C2, expectedBase: C1 });

function countingVerifier(context = {}) {
  const calls = [];
  const resolver = createGitObjectResolver({
    repoRoot: repo.dir,
    runner: (root, args, options) => {
      calls.push([...args]);
      return runGitProcess(root, args, options);
    },
  });
  const v = createEvidenceVerifier({ repoRoot: repo.dir, expectedCommit: C2, expectedBase: C1, resolver, ...context });
  return { v, calls };
}

const file = (p, commit = C2) => ({ kind: 'repo_file', commit, path: p });
const lines = (p, start, end, commit = C2) => ({ kind: 'repo_line', commit, path: p, start_line: start, end_line: end });
const diff = (p, base = C1, head = C2) => ({ kind: 'git_diff', base_commit: base, head_commit: head, path: p });
const pick = (r) => [r.status, r.code];

// ---------------------------------------------------------------- API and purity

test('api: verifier is frozen with verify and verifyAll; constants are fixed', () => {
  assert.ok(Object.isFrozen(verifier));
  assert.deepEqual(Object.keys(verifier), ['verify', 'verifyAll']);
  assert.equal(REPO_LINE_MAX_BYTES, 2_097_152);
  assert.equal(CI_SNAPSHOT_ENVELOPE, 'hlg.ci-snapshot.v1');
  assert.deepEqual([...EVIDENCE_KINDS], ['repo_file', 'repo_line', 'git_commit', 'git_diff', 'test', 'ci_check', 'http_probe', 'schema_validation']);
  assert.ok(Object.isFrozen(EVIDENCE_KINDS));
});

test('api: invalid trusted context throws TypeError at construction', () => {
  const base = { repoRoot: repo.dir, expectedCommit: C2 };
  const bad = [
    { ...base, repoRoot: '' },
    { ...base, repoRoot: 7 },
    { ...base, expectedCommit: undefined },
    { ...base, expectedCommit: C2.slice(0, 12) },
    { ...base, expectedCommit: C2.toUpperCase() },
    { ...base, expectedBase: 'main' },
    { ...base, repositoryId: 0 },
    { ...base, repositoryId: '1339459456' },
    { ...base, repositoryId: 1.5 },
    { ...base, acceptedEvents: [] },
    { ...base, acceptedEvents: [''] },
    { ...base, acceptedEvents: 'pull_request' },
    { ...base, ciSnapshots: {} },
    { ...base, resolver: {} },
    { ...base, resolver: { resolveCommit() {}, resolveRegularBlob() {} } },
    { ...base, resolver: { resolveCommit() {}, resolveRegularBlob() {}, readBlob() {} } },
    { ...base, resolver: null },
  ];
  for (const ctx of bad) assert.throws(() => createEvidenceVerifier(ctx), TypeError, JSON.stringify(ctx));
  assert.throws(() => createEvidenceVerifier(), TypeError);
});

test('purity: the verifier imports no filesystem, process or network module', () => {
  const src = readFileSync(fileURLToPath(new URL('../../scripts/ai/verify-evidence.mjs', import.meta.url)), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./git-object.mjs', './repo-path.mjs']);
  for (const banned of ['node:fs', 'child_process', 'node:http', 'node:net', 'fetch(', 'process.env', 'require(']) {
    assert.ok(!src.includes(banned), `must not contain ${banned}`);
  }
});

test('dispatch: malformed refs and unknown kinds are INVALID; unsupported kinds are UNVERIFIABLE', () => {
  for (const ref of [null, undefined, 'repo_file', [], 42, {}, { kind: 1 }]) {
    assert.deepEqual(pick(verifier.verify(ref)), ['INVALID', 'E_EVIDENCE_REF_INVALID']);
  }
  for (const kind of ['approval', '__proto__', 'constructor', 'toString', 'REPO_FILE']) {
    assert.deepEqual(pick(verifier.verify({ kind })), ['INVALID', 'E_EVIDENCE_KIND_UNKNOWN']);
  }
  assert.deepEqual(pick(verifier.verify({ kind: 'http_probe', target: 'https://hienlegarden.vn/', outcome: 'pass', body_sha256: null, run_id: 'r' })), ['UNVERIFIABLE', 'E_EVIDENCE_KIND_UNSUPPORTED']);
  assert.deepEqual(pick(verifier.verify({ kind: 'schema_validation', artifact_type: 'task_spec', run_id: 'r', schema_version: 1, outcome: 'valid' })), ['UNVERIFIABLE', 'E_EVIDENCE_KIND_UNSUPPORTED']);
});

test('dispatch: an accessor property is rejected without being called', () => {
  let called = 0;
  const hostile = { kind: 'repo_file', path: 'same.txt' };
  Object.defineProperty(hostile, 'commit', { enumerable: true, get() { called++; throw new Error('boom'); } });
  assert.deepEqual(verifier.verify(hostile), { status: 'INVALID', code: 'E_EVIDENCE_REF_NOT_DATA', kind: null });
  assert.equal(called, 0);
});

test('results are frozen and carry null code only when VERIFIED', () => {
  const ok = verifier.verify(file('same.txt'));
  assert.ok(Object.isFrozen(ok) && Object.isFrozen(ok.facts));
  assert.equal(ok.code, null);
  const bad = verifier.verify(file('missing.txt'));
  assert.ok(Object.isFrozen(bad));
  assert.notEqual(bad.code, null);
  assert.equal(bad.facts, undefined);
});

// ---------------------------------------------------------------- repo_file

test('repo_file: a regular blob at the exact expected commit is VERIFIED with object facts', () => {
  assert.deepEqual(verifier.verify(file('same.txt')), {
    status: 'VERIFIED', code: null, kind: 'repo_file', facts: { commit: C2, path: 'same.txt', mode: '100644', oid: BLOB_SAME },
  });
  assert.equal(verifier.verify(file('mode.sh')).facts.mode, '100755');
  assert.equal(verifier.verify(file('dir/f.txt')).status, 'VERIFIED');
});

test('repo_file: SHA binding is exact and is checked before any Git call', () => {
  const { v, calls } = countingVerifier();
  assert.deepEqual(pick(v.verify(file('same.txt', C1))), ['INVALID', 'E_EVIDENCE_SHA_MISMATCH']);
  for (const sha of [C2.slice(0, 7), C2.toUpperCase(), `${C2}0`, 'HEAD', 'main', null, 5]) {
    assert.deepEqual(pick(v.verify({ kind: 'repo_file', commit: sha, path: 'same.txt' })), ['INVALID', 'E_EVIDENCE_SHA_INVALID'], String(sha));
  }
  // undefined is not a JSON value; the snapshot rejects it before any field check.
  assert.deepEqual(pick(v.verify({ kind: 'repo_file', commit: undefined, path: 'same.txt' })), ['INVALID', 'E_EVIDENCE_REF_INVALID']);
  assert.equal(calls.length, 0);
});

test('repo_file: unsafe paths are rejected by L0 before any Git call', () => {
  const { v, calls } = countingVerifier();
  for (const p of ['../same.txt', '/same.txt', 'dir/../same.txt', './same.txt', '.git/config', 'dir/.GIT/x', 'same.txt.', 'CON', 'dir/nul.txt', '-same.txt', 'a\\b', '', 'dir/']) {
    assert.deepEqual(pick(v.verify(file(p))), ['INVALID', 'E_EVIDENCE_PATH_UNSAFE'], JSON.stringify(p));
  }
  assert.deepEqual(pick(v.verify(file(7))), ['INVALID', 'E_EVIDENCE_REF_INVALID']);
  assert.equal(calls.length, 0);
});

test('repo_file: missing, special and directory entries are INVALID', () => {
  assert.deepEqual(pick(verifier.verify(file('missing.txt'))), ['INVALID', 'E_EVIDENCE_PATH_MISSING']);
  assert.deepEqual(pick(verifier.verify(file('del.txt'))), ['INVALID', 'E_EVIDENCE_PATH_MISSING']);
  assert.deepEqual(pick(verifier.verify(file('Same.txt'))), ['INVALID', 'E_EVIDENCE_PATH_MISSING']);
  assert.deepEqual(pick(verifier.verify(file('link'))), ['INVALID', 'E_EVIDENCE_NOT_REGULAR_BLOB']);
  assert.deepEqual(pick(verifier.verify(file('sub'))), ['INVALID', 'E_EVIDENCE_NOT_REGULAR_BLOB']);
  assert.deepEqual(pick(verifier.verify(file('dir'))), ['INVALID', 'E_EVIDENCE_NOT_REGULAR_BLOB']);
});

test('repo_file: an unavailable or non-commit expected commit is not VERIFIED', () => {
  const absent = createEvidenceVerifier({ repoRoot: repo.dir, expectedCommit: MISSING });
  assert.deepEqual(pick(absent.verify(file('same.txt', MISSING))), ['ERROR', 'E_EVIDENCE_OBJECT_UNAVAILABLE']);
  const blob = createEvidenceVerifier({ repoRoot: repo.dir, expectedCommit: BLOB_SAME });
  assert.deepEqual(pick(blob.verify(file('same.txt', BLOB_SAME))), ['INVALID', 'E_EVIDENCE_NOT_COMMIT']);
});

test('working tree: edits and deletions after the commit have no effect', () => {
  writeFileSync(path.join(repo.dir, 'lf.txt'), 'changed\nin\nthe\nworktree\nonly\n');
  unlinkSync(path.join(repo.dir, 'same.txt'));
  try {
    assert.equal(verifier.verify(file('same.txt')).facts.oid, BLOB_SAME);
    assert.deepEqual(pick(verifier.verify(lines('lf.txt', 1, 3))), ['INVALID', 'E_EVIDENCE_LINE_OUT_OF_BOUNDS']);
    assert.equal(verifier.verify(lines('lf.txt', 1, 2)).status, 'VERIFIED');
  } finally {
    writeFileSync(path.join(repo.dir, 'lf.txt'), 'a\nb\n');
    writeFileSync(path.join(repo.dir, 'same.txt'), 'same\n');
  }
});

// ---------------------------------------------------------------- repo_line

test('repo_line: line counts follow LF bytes of the committed blob', () => {
  const cases = [
    ['lines3.txt', 3],
    ['lf.txt', 2],
    ['crlf.txt', 2],
    ['cr.txt', 1],
    ['blank.txt', 3],
    ['bom.txt', 1],
    ['max.txt', 1],
  ];
  for (const [p, count] of cases) {
    const ok = verifier.verify(lines(p, 1, count));
    assert.equal(ok.status, 'VERIFIED', p);
    assert.equal(ok.facts.line_count, count, p);
    assert.equal(ok.facts.oid, oidAt(C2, p), p);
    assert.deepEqual(pick(verifier.verify(lines(p, 1, count + 1))), ['INVALID', 'E_EVIDENCE_LINE_OUT_OF_BOUNDS'], p);
  }
  assert.deepEqual(pick(verifier.verify(lines('empty.txt', 1, 1))), ['INVALID', 'E_EVIDENCE_LINE_OUT_OF_BOUNDS']);
  assert.equal(verifier.verify(lines('lines3.txt', 2, 2)).status, 'VERIFIED');
});

test('repo_line: invalid ranges are rejected before any Git call', () => {
  const { v, calls } = countingVerifier();
  assert.deepEqual(pick(v.verify(lines('lines3.txt', 3, 2))), ['INVALID', 'E_EVIDENCE_LINE_RANGE']);
  for (const [s, e] of [[0, 1], [1, 0], [1.5, 2], ['1', 2], [1, null], [-1, 1], [1, Number.MAX_SAFE_INTEGER + 1]]) {
    assert.deepEqual(pick(v.verify(lines('lines3.txt', s, e))), ['INVALID', 'E_EVIDENCE_REF_INVALID'], `${s}-${e}`);
  }
  assert.deepEqual(pick(v.verify(lines('lines3.txt', 1, 1, C1))), ['INVALID', 'E_EVIDENCE_SHA_MISMATCH']);
  assert.equal(calls.length, 0);
});

test('repo_line: NUL bytes and invalid UTF-8 are not text', () => {
  assert.deepEqual(pick(verifier.verify(lines('nulbyte.txt', 1, 1))), ['INVALID', 'E_EVIDENCE_NOT_TEXT']);
  assert.deepEqual(pick(verifier.verify(lines('bad-utf8.txt', 1, 1))), ['INVALID', 'E_EVIDENCE_NOT_TEXT']);
});

test('repo_line: exactly 2 MiB is read; one byte more is UNVERIFIABLE', () => {
  assert.equal(verifier.verify(lines('max.txt', 1, 1)).status, 'VERIFIED');
  assert.deepEqual(pick(verifier.verify(lines('over.txt', 1, 1))), ['UNVERIFIABLE', 'E_EVIDENCE_TOO_LARGE']);
  // repo_file does not read content, so size does not matter there.
  assert.equal(verifier.verify(file('over.txt')).status, 'VERIFIED');
});

test('repo_line: special entries and missing paths are INVALID', () => {
  assert.deepEqual(pick(verifier.verify(lines('link', 1, 1))), ['INVALID', 'E_EVIDENCE_NOT_REGULAR_BLOB']);
  assert.deepEqual(pick(verifier.verify(lines('missing.txt', 1, 1))), ['INVALID', 'E_EVIDENCE_PATH_MISSING']);
});

// ---------------------------------------------------------------- INFO-4: oid binding

function spyResolver(overrides = {}) {
  const real = createGitObjectResolver({ repoRoot: repo.dir });
  const calls = [];
  const wrap = (name) => (...args) => {
    calls.push([name, ...args]);
    return overrides[name] ? overrides[name](real, ...args) : real[name](...args);
  };
  return {
    calls,
    resolver: {
      resolveCommit: wrap('resolveCommit'),
      resolveRegularBlob: wrap('resolveRegularBlob'),
      readBlob: wrap('readBlob'),
      resolveCommitTree: wrap('resolveCommitTree'),
    },
  };
}

const spyVerifier = (overrides) => {
  const s = spyResolver(overrides);
  return { ...s, v: createEvidenceVerifier({ repoRoot: repo.dir, expectedCommit: C2, expectedBase: C1, resolver: s.resolver }) };
};

test('INFO-4: readBlob receives exactly the oid resolved for the commit and path, with the 2 MiB cap', () => {
  const { v, calls } = spyVerifier();
  assert.equal(v.verify(lines('lines3.txt', 1, 3)).status, 'VERIFIED');
  assert.deepEqual(calls, [
    ['resolveRegularBlob', C2, 'lines3.txt'],
    ['readBlob', oidAt(C2, 'lines3.txt'), 2_097_152],
  ]);
});

test('INFO-4: a resolver answer for another commit, path, mode or oid is ERROR', () => {
  const lie = (patch) => ({ resolveRegularBlob: (real, c, p) => ({ ...real.resolveRegularBlob(c, p), ...patch }) });
  for (const patch of [{ commit: C1 }, { path: 'lf.txt' }, { mode: '120000' }, { mode: '040000' }, { oid: 'abc' }, { oid: undefined }]) {
    const { v } = spyVerifier(lie(patch));
    assert.deepEqual(pick(v.verify(lines('lines3.txt', 1, 1))), ['ERROR', 'E_EVIDENCE_RESOLVER_MALFORMED'], JSON.stringify(patch));
    assert.deepEqual(pick(v.verify(file('lines3.txt'))), ['ERROR', 'E_EVIDENCE_RESOLVER_MALFORMED'], JSON.stringify(patch));
  }
  const readLies = [
    (real, oid, max) => ({ ...real.readBlob(oid, max), oid: BLOB_SAME }),
    (real, oid, max) => ({ ...real.readBlob(oid, max), size: 1 }),
    (real, oid, max) => ({ ...real.readBlob(oid, max), bytes: 'a\nb\nc' }),
    (real, oid, max) => ({ ...real.readBlob(oid, max), bytes: [0x61] }),
    () => ({ ok: true, oid: oidAt(C2, 'lines3.txt'), size: MAX + 1, bytes: new Uint8Array(MAX + 1) }),
  ];
  for (const readBlob of readLies) {
    const { v } = spyVerifier({ readBlob });
    assert.deepEqual(pick(v.verify(lines('lines3.txt', 1, 1))), ['ERROR', 'E_EVIDENCE_RESOLVER_MALFORMED']);
  }
  const { v } = spyVerifier({ resolveCommit: (real, c) => ({ ...real.resolveCommit(c), commit: C1 }) });
  assert.deepEqual(pick(v.verify({ kind: 'git_commit', commit: C2 })), ['ERROR', 'E_EVIDENCE_RESOLVER_MALFORMED']);
});

// ---------------------------------------------------------------- INFO-3: resolver failures

test('INFO-3: thrown, malformed or unknown resolver results are ERROR, never VERIFIED', () => {
  const answers = [
    () => {
      throw new Error('git exploded');
    },
    () => null,
    () => undefined,
    () => 'ok',
    () => ({}),
    () => ({ ok: 'true' }),
    () => [true],
    () => ({ ok: false }),
    () => ({ ok: false, code: 'E_GIT_SOMETHING_NEW' }),
    () => ({ ok: false, code: 'E_GIT_PATH_MISMATCH' }),
    () => ({ ok: false, code: 'E_GIT_FAILED' }),
    () => ({ ok: false, code: 'E_GIT_OUTPUT_INVALID' }),
    () => ({ ok: false, code: 'toString' }),
  ];
  const refs = [file('same.txt'), lines('lines3.txt', 1, 1), { kind: 'git_commit', commit: C2 }, diff('mod.txt'), diff(null), { kind: 'test', commit: C2, file: 'test/x.node-test.mjs', name: 't' }];
  // Which resolver methods each ref depends on (by index into refs).
  const uses = {
    resolveCommit: [2, 3],
    resolveRegularBlob: [0, 1, 3, 5],
    readBlob: [1],
    resolveCommitTree: [4],
  };
  for (const [method, used] of Object.entries(uses)) {
    for (const answer of answers) {
      const { v } = spyVerifier({ [method]: answer });
      for (const ref of used.map((i) => refs[i])) {
        const r = v.verify(ref);
        assert.equal(r.status, 'ERROR', `${method} ${answer} ${ref.kind}`);
        assert.notEqual(r.status, 'VERIFIED');
        // A resolver exception is contained by the verifier's call wrapper, not by the outer guard.
        assert.notEqual(r.code, 'E_EVIDENCE_INTERNAL', `${method} ${answer} ${ref.kind}`);
      }
    }
  }
});

test('INFO-3: resolver failure codes map to the agreed statuses', () => {
  const expectations = [
    ['E_GIT_SHA_INVALID', 'INVALID', 'E_EVIDENCE_SHA_INVALID'],
    ['E_GIT_PATH_UNSAFE', 'INVALID', 'E_EVIDENCE_PATH_UNSAFE'],
    ['E_GIT_OBJECT_MISSING', 'ERROR', 'E_EVIDENCE_OBJECT_UNAVAILABLE'],
    ['E_GIT_NOT_COMMIT', 'INVALID', 'E_EVIDENCE_NOT_COMMIT'],
    ['E_GIT_PATH_MISSING', 'INVALID', 'E_EVIDENCE_PATH_MISSING'],
    ['E_GIT_NOT_REGULAR_BLOB', 'INVALID', 'E_EVIDENCE_NOT_REGULAR_BLOB'],
    ['E_GIT_NOT_BLOB', 'INVALID', 'E_EVIDENCE_NOT_BLOB'],
    ['E_GIT_TOO_LARGE', 'UNVERIFIABLE', 'E_EVIDENCE_TOO_LARGE'],
    ['E_GIT_PATH_MISMATCH', 'ERROR', 'E_EVIDENCE_PATH_MISMATCH'],
    ['E_GIT_FAILED', 'ERROR', 'E_EVIDENCE_GIT_FAILED'],
    ['E_GIT_OUTPUT_INVALID', 'ERROR', 'E_EVIDENCE_GIT_OUTPUT_INVALID'],
    ['E_GIT_COMMIT_MALFORMED', 'ERROR', 'E_EVIDENCE_OBJECT_MALFORMED'],
    ['E_GIT_NOT_TREE', 'ERROR', 'E_EVIDENCE_OBJECT_MALFORMED'],
    ['E_GIT_SOMETHING_NEW', 'ERROR', 'E_EVIDENCE_RESOLVER_UNKNOWN_CODE'],
    ['toString', 'ERROR', 'E_EVIDENCE_RESOLVER_UNKNOWN_CODE'],
    [undefined, 'ERROR', 'E_EVIDENCE_RESOLVER_UNKNOWN_CODE'],
  ];
  for (const [code, status, evidence] of expectations) {
    const { v } = spyVerifier({ resolveRegularBlob: () => ({ ok: false, code }) });
    assert.deepEqual(pick(v.verify(file('same.txt'))), [status, evidence], code);
  }
});

// ---------------------------------------------------------------- git_commit

test('git_commit: exact expected commit is VERIFIED; others are not', () => {
  assert.deepEqual(verifier.verify({ kind: 'git_commit', commit: C2 }), { status: 'VERIFIED', code: null, kind: 'git_commit', facts: { commit: C2 } });
  const { v, calls } = countingVerifier();
  assert.deepEqual(pick(v.verify({ kind: 'git_commit', commit: C1 })), ['INVALID', 'E_EVIDENCE_SHA_MISMATCH']);
  assert.deepEqual(pick(v.verify({ kind: 'git_commit', commit: C2.slice(0, 10) })), ['INVALID', 'E_EVIDENCE_SHA_INVALID']);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------- git_diff

test('git_diff: transition matrix', () => {
  const change = (p) => {
    const r = verifier.verify(diff(p));
    return r.status === 'VERIFIED' ? ['VERIFIED', r.facts.change] : pick(r);
  };
  assert.deepEqual(change('mod.txt'), ['VERIFIED', 'modified']);
  assert.deepEqual(change('mode.sh'), ['VERIFIED', 'modified']);
  assert.deepEqual(change('del.txt'), ['VERIFIED', 'deleted']);
  assert.deepEqual(change('add.txt'), ['VERIFIED', 'added']);
  assert.deepEqual(change('dir/f.txt'), ['VERIFIED', 'added']);
  assert.deepEqual(change('same.txt'), ['INVALID', 'E_EVIDENCE_DIFF_UNCHANGED']);
  assert.deepEqual(change('never.txt'), ['INVALID', 'E_EVIDENCE_DIFF_PATH_ABSENT']);
  assert.deepEqual(change('link'), ['UNVERIFIABLE', 'E_EVIDENCE_DIFF_UNSUPPORTED_ENTRY']);
  assert.deepEqual(change('flip'), ['UNVERIFIABLE', 'E_EVIDENCE_DIFF_UNSUPPORTED_ENTRY']);
  assert.deepEqual(change('sub'), ['UNVERIFIABLE', 'E_EVIDENCE_DIFF_UNSUPPORTED_ENTRY']);
  assert.deepEqual(change('dir'), ['UNVERIFIABLE', 'E_EVIDENCE_DIFF_UNSUPPORTED_ENTRY']);
});

test('git_diff: facts record both sides exactly', () => {
  const m = verifier.verify(diff('mode.sh')).facts;
  assert.deepEqual(m.base, { mode: '100644', oid: oidAt(C1, 'mode.sh') });
  assert.deepEqual(m.head, { mode: '100755', oid: oidAt(C2, 'mode.sh') });
  assert.equal(m.base.oid, m.head.oid);
  const a = verifier.verify(diff('add.txt')).facts;
  assert.equal(a.base, null);
  const d = verifier.verify(diff('del.txt')).facts;
  assert.equal(d.head, null);
});

test('git_diff: whole-commit diff (null path)', () => {
  assert.deepEqual(verifier.verify(diff(null)), {
    status: 'VERIFIED', code: null, kind: 'git_diff',
    facts: { base_commit: C1, head_commit: C2, path: null, base_tree: repo.git(['rev-parse', `${C1}^{tree}`]), head_tree: repo.git(['rev-parse', `${C2}^{tree}`]) },
  });
  const same = createEvidenceVerifier({ repoRoot: repo.dir, expectedCommit: C2, expectedBase: C2 });
  assert.deepEqual(pick(same.verify(diff(null, C2, C2))), ['INVALID', 'E_EVIDENCE_DIFF_UNCHANGED']);
});

test('git_diff: both SHAs bind to trusted context before any Git call', () => {
  const { v, calls } = countingVerifier();
  assert.deepEqual(pick(v.verify(diff('mod.txt', C2, C1))), ['INVALID', 'E_EVIDENCE_SHA_MISMATCH']);
  assert.deepEqual(pick(v.verify(diff('mod.txt', C1, C1))), ['INVALID', 'E_EVIDENCE_SHA_MISMATCH']);
  assert.deepEqual(pick(v.verify(diff('mod.txt', C2, C2))), ['INVALID', 'E_EVIDENCE_SHA_MISMATCH']);
  assert.deepEqual(pick(v.verify(diff('mod.txt', 'main', C2))), ['INVALID', 'E_EVIDENCE_SHA_INVALID']);
  assert.deepEqual(pick(v.verify(diff('../mod.txt'))), ['INVALID', 'E_EVIDENCE_PATH_UNSAFE']);
  assert.deepEqual(pick(v.verify(diff(5))), ['INVALID', 'E_EVIDENCE_REF_INVALID']);
  assert.deepEqual(pick(v.verify(diff(undefined))), ['INVALID', 'E_EVIDENCE_REF_INVALID']);
  const noBase = countingVerifier({ expectedBase: undefined });
  assert.deepEqual(pick(noBase.v.verify(diff('mod.txt'))), ['UNVERIFIABLE', 'E_EVIDENCE_BASE_UNKNOWN']);
  assert.equal(calls.length + noBase.calls.length, 0);
});

test('git_diff: a malformed blob on one side is INVALID; an error on either side wins', () => {
  const notBlob = (side) => ({
    resolveRegularBlob: (real, c, p) => (c === side ? { ok: false, code: 'E_GIT_NOT_BLOB', type: 'tree' } : real.resolveRegularBlob(c, p)),
  });
  assert.deepEqual(pick(spyVerifier(notBlob(C1)).v.verify(diff('mod.txt'))), ['INVALID', 'E_EVIDENCE_NOT_BLOB']);
  const mixed = {
    resolveRegularBlob: (real, c) => (c === C1 ? { ok: false, code: 'E_GIT_NOT_BLOB' } : { ok: false, code: 'E_GIT_OBJECT_MISSING' }),
  };
  assert.deepEqual(pick(spyVerifier(mixed).v.verify(diff('mod.txt'))), ['ERROR', 'E_EVIDENCE_OBJECT_UNAVAILABLE']);
  const specialAndError = {
    resolveRegularBlob: (real, c) => (c === C1 ? { ok: false, code: 'E_GIT_NOT_REGULAR_BLOB', mode: '120000' } : { ok: false, code: 'E_GIT_FAILED' }),
  };
  assert.deepEqual(pick(spyVerifier(specialAndError).v.verify(diff('mod.txt'))), ['ERROR', 'E_EVIDENCE_GIT_FAILED']);
});

// ---------------------------------------------------------------- test kind

test('test: an existing test file is still UNVERIFIABLE without a trusted outcome', () => {
  const t = { kind: 'test', commit: C2, file: 'test/x.node-test.mjs', name: 'suite > case' };
  assert.deepEqual(pick(verifier.verify(t)), ['UNVERIFIABLE', 'E_EVIDENCE_TEST_OUTCOME_UNVERIFIED']);
  assert.deepEqual(pick(verifier.verify({ ...t, file: 'test/none.mjs' })), ['INVALID', 'E_EVIDENCE_PATH_MISSING']);
  assert.deepEqual(pick(verifier.verify({ ...t, commit: C1 })), ['INVALID', 'E_EVIDENCE_SHA_MISMATCH']);
  assert.deepEqual(pick(verifier.verify({ ...t, file: '.git/hooks/x' })), ['INVALID', 'E_EVIDENCE_PATH_UNSAFE']);
  assert.deepEqual(pick(verifier.verify({ ...t, name: '' })), ['INVALID', 'E_EVIDENCE_REF_INVALID']);
});

// ---------------------------------------------------------------- partial clone: no lazy fetch

test('unavailable objects in a blob:none partial clone are ERROR and are never fetched', () => {
  const server = makeRepo('hlg-verify-promisor-src-');
  writeFileSync(path.join(server.dir, 'lazy.txt'), 'v1\n');
  server.git(['add', 'lazy.txt']);
  server.git(['commit', '-q', '-m', 'base']);
  const base = server.git(['rev-parse', 'HEAD']);
  writeFileSync(path.join(server.dir, 'lazy.txt'), 'v2\n');
  server.git(['add', 'lazy.txt']);
  server.git(['commit', '-q', '-m', 'head']);
  const head = server.git(['rev-parse', 'HEAD']);
  server.git(['config', 'uploadpack.allowFilter', 'true']);
  server.git(['config', 'uploadpack.allowAnySHA1InWant', 'true']);
  const cloneDir = mkdtempSync(path.join(tmpdir(), 'hlg-verify-promisor-clone-'));
  roots.push(cloneDir);
  execFileSync('git', ['clone', '-q', '--no-local', '--filter=blob:none', '--no-checkout', pathToFileURL(server.dir).href, cloneDir], {
    env: cleanEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const inClone = (args) => execFileSync('git', args, { cwd: cloneDir, env: { ...cleanEnv(), GIT_NO_LAZY_FETCH: '1' }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const blob = inClone(['rev-parse', `${head}:lazy.txt`]);
  const present = () => {
    try {
      inClone(['cat-file', '-e', blob]);
      return true;
    } catch {
      return false;
    }
  };
  assert.equal(present(), false, 'fixture: the blob must start out missing');

  const v = createEvidenceVerifier({ repoRoot: cloneDir, expectedCommit: head, expectedBase: base });
  withEnv({ GIT_NO_LAZY_FETCH: '0' }, () => {
    assert.deepEqual(pick(v.verify({ kind: 'repo_file', commit: head, path: 'lazy.txt' })), ['ERROR', 'E_EVIDENCE_OBJECT_UNAVAILABLE']);
    assert.deepEqual(pick(v.verify({ kind: 'repo_line', commit: head, path: 'lazy.txt', start_line: 1, end_line: 1 })), ['ERROR', 'E_EVIDENCE_OBJECT_UNAVAILABLE']);
    assert.deepEqual(pick(v.verify({ kind: 'git_diff', base_commit: base, head_commit: head, path: 'lazy.txt' })), ['ERROR', 'E_EVIDENCE_OBJECT_UNAVAILABLE']);
    assert.equal(v.verify({ kind: 'git_commit', commit: head }).status, 'VERIFIED');
    assert.equal(v.verify({ kind: 'git_diff', base_commit: base, head_commit: head, path: null }).status, 'VERIFIED');
  });
  assert.equal(present(), false, 'the verifier must not have fetched the blob');
});

// ---------------------------------------------------------------- ci_check

const REPO_ID = 1339459456;
const RUN_ID = 37564043431;

function snapshot({ run = {}, jobs, repository = {} } = {}) {
  const r = {
    id: RUN_ID,
    run_attempt: 1,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    head_sha: C2,
    head_repository_id: REPO_ID,
    workflow_path: '.github/workflows/test.yml',
    check_suite_id: 900,
    ...run,
  };
  const job = (name, extra = {}) => ({
    id: 5000 + name.length,
    run_id: r.id,
    run_attempt: r.run_attempt,
    name,
    status: 'completed',
    conclusion: 'success',
    head_sha: r.head_sha,
    check_suite_id: r.check_suite_id,
    ...extra,
  });
  return {
    envelope: CI_SNAPSHOT_ENVELOPE,
    repository: { id: REPO_ID, full_name: 'owner/repo', ...repository },
    run: r,
    jobs: jobs ? jobs.map(([name, extra]) => job(name, extra)) : [job('test'), job('build')],
    fetched: '2026-10-08T00:00:00Z',
  };
}

const ci = (over = {}) => ({
  kind: 'ci_check',
  provider: 'github_actions',
  check_name: 'test',
  workflow_run_id: String(RUN_ID),
  run_attempt: 1,
  commit: C2,
  conclusion: 'success',
  ...over,
});

function ciVerifier(ciSnapshots, context = {}) {
  const s = spyResolver();
  const v = createEvidenceVerifier({
    repoRoot: repo.dir,
    expectedCommit: C2,
    repositoryId: REPO_ID,
    ciSnapshots,
    resolver: s.resolver,
    ...context,
  });
  return { v, calls: s.calls };
}

test('ci_check: a matching trusted snapshot is VERIFIED with facts and no Git access', () => {
  const { v, calls } = ciVerifier([snapshot()]);
  assert.deepEqual(v.verify(ci()), {
    status: 'VERIFIED', code: null, kind: 'ci_check',
    facts: { run_id: RUN_ID, run_attempt: 1, check_name: 'test', conclusion: 'success', head_sha: C2 },
  });
  assert.equal(calls.length, 0);
});

test('ci_check: a matching failure conclusion is VERIFIED as a failure, never PASS', () => {
  const { v } = ciVerifier([snapshot({ run: { conclusion: 'failure' }, jobs: [['test', { conclusion: 'failure' }]] })]);
  const r = v.verify(ci({ conclusion: 'failure' }));
  assert.equal(r.status, 'VERIFIED');
  assert.equal(r.facts.conclusion, 'failure');
  assert.deepEqual(pick(v.verify(ci({ conclusion: 'success' }))), ['INVALID', 'E_EVIDENCE_CONCLUSION_MISMATCH']);
});

test('ci_check: ref-level checks', () => {
  const { v } = ciVerifier([snapshot()]);
  assert.deepEqual(pick(v.verify(ci({ provider: 'circleci' }))), ['INVALID', 'E_EVIDENCE_PROVIDER_MISMATCH']);
  assert.deepEqual(pick(v.verify(ci({ commit: C1 }))), ['INVALID', 'E_EVIDENCE_SHA_MISMATCH']);
  for (const over of [{ workflow_run_id: RUN_ID }, { workflow_run_id: '-1' }, { workflow_run_id: '' }, { run_attempt: 0 }, { run_attempt: '1' }, { conclusion: 'PASS' }, { conclusion: 'success ' }, { check_name: '' }]) {
    assert.deepEqual(pick(v.verify(ci(over))), ['INVALID', 'E_EVIDENCE_REF_INVALID'], JSON.stringify(over));
  }
});

test('ci_check: without a trusted repository id nothing is verified', () => {
  const { v } = ciVerifier([snapshot()], { repositoryId: undefined });
  assert.deepEqual(pick(v.verify(ci())), ['UNVERIFIABLE', 'E_EVIDENCE_REPOSITORY_UNKNOWN']);
});

test('ci_check: snapshot selection by exact run id and attempt', () => {
  const two = [snapshot({ run: { conclusion: 'failure' }, jobs: [['test', { conclusion: 'failure' }]] }), snapshot({ run: { run_attempt: 2 } })];
  const { v } = ciVerifier(two);
  assert.equal(v.verify(ci({ run_attempt: 1, conclusion: 'failure' })).status, 'VERIFIED');
  assert.equal(v.verify(ci({ run_attempt: 2 })).status, 'VERIFIED');
  assert.deepEqual(pick(v.verify(ci({ run_attempt: 1 }))), ['INVALID', 'E_EVIDENCE_CONCLUSION_MISMATCH']);
  assert.deepEqual(pick(v.verify(ci({ run_attempt: 3 }))), ['UNVERIFIABLE', 'E_EVIDENCE_SNAPSHOT_MISSING']);
  assert.deepEqual(pick(v.verify(ci({ workflow_run_id: `0${RUN_ID}` }))), ['UNVERIFIABLE', 'E_EVIDENCE_SNAPSHOT_MISSING']);
  assert.deepEqual(pick(v.verify(ci({ workflow_run_id: '1' }))), ['UNVERIFIABLE', 'E_EVIDENCE_SNAPSHOT_MISSING']);
  assert.deepEqual(pick(ciVerifier([]).v.verify(ci())), ['UNVERIFIABLE', 'E_EVIDENCE_SNAPSHOT_MISSING']);
  assert.deepEqual(pick(ciVerifier([snapshot(), snapshot()]).v.verify(ci())), ['ERROR', 'E_EVIDENCE_SNAPSHOT_DUPLICATE']);
});

test('ci_check: repository, fork, head, event and status gates', () => {
  const at = (s, ref = ci(), ctx) => pick(ciVerifier([s], ctx).v.verify(ref));
  assert.deepEqual(at(snapshot({ repository: { id: 1 } })), ['INVALID', 'E_EVIDENCE_REPOSITORY_MISMATCH']);
  assert.deepEqual(at(snapshot({ run: { head_repository_id: 42 } })), ['UNVERIFIABLE', 'E_EVIDENCE_FORK']);
  assert.deepEqual(at(snapshot({ run: { head_sha: C1 } })), ['INVALID', 'E_EVIDENCE_SHA_MISMATCH']);
  assert.deepEqual(at(snapshot({ run: { event: 'push' } })), ['UNVERIFIABLE', 'E_EVIDENCE_EVENT_NOT_ACCEPTED']);
  assert.deepEqual(at(snapshot({ run: { event: 'pull_request_target' } })), ['UNVERIFIABLE', 'E_EVIDENCE_EVENT_NOT_ACCEPTED']);
  assert.deepEqual(at(snapshot({ run: { event: 'push' } }), ci(), { acceptedEvents: ['push'] }), ['VERIFIED', null]);
  assert.deepEqual(at(snapshot({ run: { status: 'in_progress', conclusion: null } })), ['UNVERIFIABLE', 'E_EVIDENCE_CI_INCOMPLETE']);
});

test('ci_check: job matching is exact and unambiguous', () => {
  const at = (s, ref = ci()) => pick(ciVerifier([s]).v.verify(ref));
  assert.deepEqual(at(snapshot(), ci({ check_name: 'Test' })), ['INVALID', 'E_EVIDENCE_CHECK_NOT_FOUND']);
  assert.deepEqual(at(snapshot(), ci({ check_name: 'test ' })), ['INVALID', 'E_EVIDENCE_CHECK_NOT_FOUND']);
  assert.deepEqual(at(snapshot({ jobs: [['test'], ['test']] })), ['INVALID', 'E_EVIDENCE_CHECK_AMBIGUOUS']);
  assert.deepEqual(at(snapshot({ jobs: [['test', { status: 'queued', conclusion: null }]] })), ['UNVERIFIABLE', 'E_EVIDENCE_CI_INCOMPLETE']);
  assert.deepEqual(at(snapshot({ jobs: [['test', { conclusion: 'cancelled' }]] })), ['INVALID', 'E_EVIDENCE_CONCLUSION_MISMATCH']);
});

test('ci_check: a job that does not belong to the run is ERROR', () => {
  const at = (extra) => pick(ciVerifier([snapshot({ jobs: [['test', extra]] })]).v.verify(ci()));
  for (const extra of [{ run_id: RUN_ID + 1 }, { run_attempt: 2 }, { head_sha: C1 }, { check_suite_id: 901 }]) {
    assert.deepEqual(at(extra), ['ERROR', 'E_EVIDENCE_SNAPSHOT_INCONSISTENT'], JSON.stringify(extra));
  }
});

test('ci_check: malformed envelopes throw TypeError at construction', () => {
  const mutate = (fn) => {
    const s = snapshot();
    fn(s);
    return s;
  };
  const bad = [
    null,
    [],
    mutate((s) => (s.envelope = 'hlg.ci-snapshot.v2')),
    mutate((s) => delete s.envelope),
    mutate((s) => (s.repository = { id: 0 })),
    mutate((s) => (s.repository.id = String(REPO_ID))),
    mutate((s) => (s.run.id = String(RUN_ID))),
    mutate((s) => (s.run.run_attempt = 0)),
    mutate((s) => (s.run.head_sha = C2.slice(0, 7))),
    mutate((s) => (s.run.head_sha = C2.toUpperCase())),
    mutate((s) => delete s.run.head_repository_id),
    mutate((s) => (s.run.conclusion = undefined)),
    mutate((s) => (s.run.event = '')),
    mutate((s) => (s.run.check_suite_id = '900')),
    mutate((s) => (s.jobs = {})),
    mutate((s) => (s.jobs[0] = null)),
    mutate((s) => delete s.jobs[0].name),
    mutate((s) => (s.jobs[0].conclusion = 1)),
    mutate((s) => (s.jobs[0].run_id = String(RUN_ID))),
    mutate((s) => (s.jobs[0].head_sha = 'x')),
  ];
  for (const s of bad) {
    assert.throws(() => createEvidenceVerifier({ repoRoot: repo.dir, expectedCommit: C2, repositoryId: REPO_ID, ciSnapshots: [s] }), TypeError);
  }
});

test('ci_check: snapshots are copied at construction; later caller mutation has no effect', () => {
  const s = snapshot();
  const list = [s];
  const { v } = ciVerifier(list);
  s.jobs[0].conclusion = 'failure';
  s.run.head_sha = C1;
  s.repository.id = 1;
  list.push(snapshot());
  assert.equal(v.verify(ci()).status, 'VERIFIED');
  assert.deepEqual(pick(v.verify(ci({ conclusion: 'failure' }))), ['INVALID', 'E_EVIDENCE_CONCLUSION_MISMATCH']);
});

// ---------------------------------------------------------------- verifyAll

test('verifyAll: an empty evidence list is never VERIFIED', () => {
  const r = verifier.verifyAll([]);
  assert.equal(r.status, 'UNVERIFIABLE');
  assert.equal(r.code, 'E_EVIDENCE_NONE');
  assert.deepEqual(r.results, []);
  assert.ok(Object.isFrozen(r));
  // Non-arrays (including array-likes) are a frozen ERROR aggregate, never an empty success.
  for (const bad of [undefined, null, {}, 'refs', { length: 0 }, { length: 1, 0: file('same.txt') }]) {
    const r = verifier.verifyAll(bad);
    assert.deepEqual([r.status, r.code, r.results.length], ['ERROR', 'E_EVIDENCE_COLLECTION_INVALID', 0]);
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.results) && Object.isFrozen(r.counts));
  }
});

test('verifyAll: precedence ERROR > INVALID > UNVERIFIABLE > VERIFIED, input order and counts kept', () => {
  const ok = file('same.txt');
  const unverifiable = { kind: 'http_probe' };
  const invalid = file('same.txt', C1);
  const error = new Proxy({}, { ownKeys() { throw new Error('x'); } });

  assert.equal(verifier.verifyAll([ok, ok]).status, 'VERIFIED');
  assert.equal(verifier.verifyAll([ok, unverifiable]).status, 'UNVERIFIABLE');
  assert.equal(verifier.verifyAll([unverifiable, invalid, ok]).status, 'INVALID');
  const all = verifier.verifyAll([ok, error, invalid, unverifiable]);
  assert.equal(all.status, 'ERROR');
  assert.equal(all.code, null);
  assert.deepEqual(all.results.map((r) => r.status), ['VERIFIED', 'ERROR', 'INVALID', 'UNVERIFIABLE']);
  assert.deepEqual({ ...all.counts }, { VERIFIED: 1, INVALID: 1, UNVERIFIABLE: 1, ERROR: 1 });
  assert.ok(Object.isFrozen(all) && Object.isFrozen(all.results) && Object.isFrozen(all.counts));
});

// ---------------------------------------------------------------- A3.5b.2R F1: stable EvidenceRef snapshot

// Valid refs for every Git-backed kind, plus ci_check (verified against a trusted snapshot).
function validRefs() {
  return [
    file('same.txt'),
    lines('lines3.txt', 1, 3),
    { kind: 'git_commit', commit: C2 },
    diff('mod.txt'),
    diff(null),
    ci(),
  ];
}
// Alternative values a hostile getter swaps in after the first read.
const SWAP = {
  kind: 'git_commit',
  commit: C1,
  path: 'lf.txt',
  start_line: 99,
  end_line: 99,
  base_commit: C2,
  head_commit: C1,
  provider: 'other',
  check_name: 'build',
  workflow_run_id: '1',
  run_attempt: 2,
  conclusion: 'failure',
};

test('F1: the original getter exploit (trusted SHA first, another commit later) is never VERIFIED', () => {
  let reads = 0;
  const ref = { kind: 'repo_file', path: 'same.txt' };
  Object.defineProperty(ref, 'commit', { enumerable: true, get: () => (reads++ === 0 ? C2 : C1) });
  const r = verifier.verify(ref);
  assert.notEqual(r.status, 'VERIFIED');
  assert.deepEqual(pick(r), ['INVALID', 'E_EVIDENCE_REF_NOT_DATA']);
  assert.equal(reads, 0, 'the producer accessor must never be invoked');
});

test('F1: a changing getter on any field of any kind is rejected and never invoked', () => {
  const v = ciVerifier([snapshot()], { expectedBase: C1 }).v;
  for (const base of validRefs()) {
    assert.equal(v.verify(base).status, 'VERIFIED', `fixture ${base.kind}`);
    for (const field of Object.keys(base)) {
      let reads = 0;
      const ref = { ...base };
      const first = ref[field];
      const second = Object.hasOwn(SWAP, field) && SWAP[field] !== first ? SWAP[field] : null;
      Object.defineProperty(ref, field, { enumerable: true, configurable: true, get: () => (reads++ === 0 ? first : second) });
      const r = v.verify(ref);
      assert.deepEqual(pick(r), ['INVALID', 'E_EVIDENCE_REF_NOT_DATA'], `${base.kind}.${field}`);
      assert.equal(reads, 0, `${base.kind}.${field}`);
    }
  }
});

test('F1: setter-only, non-enumerable and symbol-keyed properties are not data', () => {
  const withSetter = { kind: 'git_commit' };
  Object.defineProperty(withSetter, 'commit', { enumerable: true, set() {} });
  assert.deepEqual(pick(verifier.verify(withSetter)), ['INVALID', 'E_EVIDENCE_REF_NOT_DATA']);
  const hidden = { kind: 'git_commit' };
  Object.defineProperty(hidden, 'commit', { enumerable: false, value: C2 });
  assert.deepEqual(pick(verifier.verify(hidden)), ['INVALID', 'E_EVIDENCE_REF_NOT_DATA']);
  assert.deepEqual(pick(verifier.verify({ kind: 'git_commit', commit: C2, [Symbol('x')]: 1 })), ['INVALID', 'E_EVIDENCE_REF_NOT_DATA']);
});

test('F1: Proxy traps are read once through descriptors; throwing traps are ERROR', () => {
  // A get trap is never consulted: values come from own property descriptors.
  let gets = 0;
  const viaGet = new Proxy({ kind: 'git_commit', commit: C2 }, {
    get(t, k) {
      gets++;
      return k === 'commit' ? C1 : t[k];
    },
  });
  const r1 = verifier.verify(viaGet);
  assert.deepEqual(r1.facts, { commit: C2 });
  assert.equal(gets, 0);

  // A descriptor trap that changes its answer is consulted exactly once per key.
  const seen = new Map();
  const flipping = new Proxy({ kind: 'repo_file', commit: C2, path: 'same.txt' }, {
    getOwnPropertyDescriptor(t, k) {
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      const d = Reflect.getOwnPropertyDescriptor(t, k);
      if (k === 'commit' && n > 1) d.value = C1;
      return d;
    },
  });
  const r2 = verifier.verify(flipping);
  assert.equal(r2.status, 'VERIFIED');
  assert.equal(r2.facts.commit, C2);
  assert.deepEqual([...seen.values()], [1, 1, 1]);

  // Throwing or revoked proxies fail closed.
  const target = { kind: 'git_commit', commit: C2 };
  for (const trap of ['ownKeys', 'getPrototypeOf', 'getOwnPropertyDescriptor']) {
    const p = new Proxy(target, {
      [trap]() {
        throw new Error('trap');
      },
    });
    assert.deepEqual(verifier.verify(p), { status: 'ERROR', code: 'E_EVIDENCE_REF_UNREADABLE', kind: null }, trap);
  }
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();
  assert.deepEqual(pick(verifier.verify(proxy)), ['ERROR', 'E_EVIDENCE_REF_UNREADABLE']);
  const dupKeys = new Proxy(target, { ownKeys: () => ['kind', 'kind'] });
  assert.deepEqual(pick(verifier.verify(dupKeys)), ['ERROR', 'E_EVIDENCE_REF_UNREADABLE']);
});

test('F1: prototype-inherited values are never trusted', () => {
  const inherited = Object.create({ kind: 'git_commit', commit: C2 });
  assert.deepEqual(pick(verifier.verify(inherited)), ['INVALID', 'E_EVIDENCE_REF_INVALID']);
  class Ref {
    constructor() {
      this.kind = 'git_commit';
      this.commit = C2;
    }
  }
  assert.deepEqual(pick(verifier.verify(new Ref())), ['INVALID', 'E_EVIDENCE_REF_INVALID']);
  // Prototype pollution cannot supply a missing field.
  Object.prototype.commit = C2;
  try {
    assert.deepEqual(pick(verifier.verify({ kind: 'git_commit' })), ['INVALID', 'E_EVIDENCE_SHA_INVALID']);
    assert.deepEqual(pick(verifier.verify({ kind: 'repo_file', path: 'same.txt' })), ['INVALID', 'E_EVIDENCE_SHA_INVALID']);
  } finally {
    delete Object.prototype.commit;
  }
});

test('F1: only flat JSON primitives are accepted; ordinary JSON refs still verify', () => {
  for (const value of [{ toString: () => C2 }, [C2], () => C2, 1n, undefined, Symbol('s')]) {
    assert.deepEqual(pick(verifier.verify({ kind: 'git_commit', commit: value })), ['INVALID', 'E_EVIDENCE_REF_INVALID'], typeof value);
  }
  const many = { kind: 'git_commit', commit: C2 };
  for (let i = 0; i < 40; i++) many[`x${i}`] = i;
  assert.deepEqual(pick(verifier.verify(many)), ['INVALID', 'E_EVIDENCE_REF_INVALID']);

  const parsed = JSON.parse(JSON.stringify(lines('lines3.txt', 2, 3)));
  assert.equal(verifier.verify(parsed).status, 'VERIFIED');
  const bare = Object.assign(Object.create(null), { kind: 'git_commit', commit: C2 });
  assert.equal(verifier.verify(bare).status, 'VERIFIED');
});

test('F1: the caller-owned EvidenceRef is not modified', () => {
  const ref = lines('lines3.txt', 1, 2);
  const before = JSON.stringify(ref);
  verifier.verify(ref);
  verifier.verifyAll([ref, ref]);
  assert.equal(JSON.stringify(ref), before);
  assert.equal(Object.isFrozen(ref), false);
  assert.equal(Object.isExtensible(ref), true);
});

// ---------------------------------------------------------------- A3.5b.2R F2: null-path diff by root tree

test('F2: two different commits with an identical root tree are DIFF_UNCHANGED', () => {
  const tree = repo.git(['rev-parse', `${C2}^{tree}`]);
  const EMPTY = repo.git(['commit-tree', tree, '-p', C2, '-m', 'empty']);
  assert.notEqual(EMPTY, C2);
  const v = createEvidenceVerifier({ repoRoot: repo.dir, expectedCommit: EMPTY, expectedBase: C2 });
  assert.deepEqual(pick(v.verify(diff(null, C2, EMPTY))), ['INVALID', 'E_EVIDENCE_DIFF_UNCHANGED']);
  // Path-specific semantics are unchanged: every path is unchanged too.
  assert.deepEqual(pick(v.verify(diff('mod.txt', C2, EMPTY))), ['INVALID', 'E_EVIDENCE_DIFF_UNCHANGED']);
});

test('F2: different root trees are VERIFIED with verified tree facts from both exact commits', () => {
  const { v, calls } = spyVerifier();
  const r = v.verify(diff(null));
  assert.equal(r.status, 'VERIFIED');
  assert.equal(r.facts.base_tree, repo.git(['rev-parse', `${C1}^{tree}`]));
  assert.equal(r.facts.head_tree, repo.git(['rev-parse', `${C2}^{tree}`]));
  assert.notEqual(r.facts.base_tree, r.facts.head_tree);
  assert.deepEqual(calls, [['resolveCommitTree', C1], ['resolveCommitTree', C2]]);
  calls.length = 0;
  v.verify(diff('mod.txt'));
  assert.ok(!calls.some((c) => c[0] === 'resolveCommitTree'), 'path-specific diffs do not use root trees');
});

test('F2: missing, malformed or non-commit objects on either side are not VERIFIED', () => {
  const tree = repo.git(['rev-parse', `${C2}^{tree}`]);
  const raw = (body) => repo.git(['hash-object', '-t', 'commit', '-w', '--literally', '--stdin'], { input: body });
  const ident = 'hlg-test <hlg-test@example.invalid> 0 +0000';
  const danglingTree = raw(`tree ${MISSING}\nauthor ${ident}\ncommitter ${ident}\n\nm\n`);
  const duplicateTree = raw(`tree ${tree}\ntree ${tree}\nauthor ${ident}\ncommitter ${ident}\n\nm\n`);
  const at = (base, head) => pick(createEvidenceVerifier({ repoRoot: repo.dir, expectedCommit: head, expectedBase: base }).verify(diff(null, base, head)));
  assert.deepEqual(at(MISSING, C2), ['ERROR', 'E_EVIDENCE_OBJECT_UNAVAILABLE']);
  assert.deepEqual(at(C1, MISSING), ['ERROR', 'E_EVIDENCE_OBJECT_UNAVAILABLE']);
  assert.deepEqual(at(danglingTree, C2), ['ERROR', 'E_EVIDENCE_OBJECT_UNAVAILABLE']);
  assert.deepEqual(at(C1, duplicateTree), ['ERROR', 'E_EVIDENCE_OBJECT_MALFORMED']);
  assert.deepEqual(at(BLOB_SAME, C2), ['INVALID', 'E_EVIDENCE_NOT_COMMIT']);
});

test('F2: malformed, foreign or thrown resolveCommitTree answers are ERROR', () => {
  const real = createGitObjectResolver({ repoRoot: repo.dir });
  const lies = [
    (c) => ({ ...real.resolveCommitTree(c), treeOid: real.resolveCommitTree(c).treeOid.toUpperCase() }),
    (c) => ({ ...real.resolveCommitTree(c), treeOid: real.resolveCommitTree(c).treeOid.slice(0, 39) }),
    (c) => ({ ...real.resolveCommitTree(c), treeOid: undefined }),
    (c) => ({ ...real.resolveCommitTree(c), commit: c === C1 ? C2 : C1 }),
    () => ({ ok: true }),
    () => ({ ok: 1, treeOid: MISSING }),
  ];
  for (const lie of lies) {
    const { v } = spyVerifier({ resolveCommitTree: (_, c) => lie(c) });
    assert.deepEqual(pick(v.verify(diff(null))), ['ERROR', 'E_EVIDENCE_RESOLVER_MALFORMED'], String(lie));
  }
  const thrower = spyVerifier({
    resolveCommitTree: () => {
      throw new Error('boom');
    },
  }).v;
  assert.deepEqual(pick(thrower.verify(diff(null))), ['ERROR', 'E_EVIDENCE_RESOLVER_THREW']);
  // The same tree reported for both sides is caught as unchanged, never VERIFIED.
  const sameTree = spyVerifier({ resolveCommitTree: (_, c) => ({ ok: true, commit: c, treeOid: MISSING }) }).v;
  assert.deepEqual(pick(sameTree.verify(diff(null))), ['INVALID', 'E_EVIDENCE_DIFF_UNCHANGED']);
});

test('F2: without trusted expectedBase a null-path diff is UNVERIFIABLE with no Git call', () => {
  const { v, calls } = countingVerifier({ expectedBase: undefined });
  assert.deepEqual(pick(v.verify(diff(null))), ['UNVERIFIABLE', 'E_EVIDENCE_BASE_UNKNOWN']);
  const bound = countingVerifier();
  assert.deepEqual(pick(bound.v.verify(diff(null, C2, C1))), ['INVALID', 'E_EVIDENCE_SHA_MISMATCH']);
  assert.equal(calls.length + bound.calls.length, 0);
});

// ---------------------------------------------------------------- A3.5b.2R F5: diagnostics

test('F5: failures keep distinct diagnostic codes and never leak Git output', () => {
  const secret = 'fatal: /home/secret/path token=abc';
  const cases = [
    [
      () => {
        throw new Error(secret);
      },
      'E_EVIDENCE_RESOLVER_THREW',
    ],
    [() => ({ ok: false, code: 'E_GIT_FAILED', stderr: secret }), 'E_EVIDENCE_GIT_FAILED'],
    [() => ({ ok: false, code: 'E_GIT_OUTPUT_INVALID', message: secret }), 'E_EVIDENCE_GIT_OUTPUT_INVALID'],
    [() => ({ ok: false, code: 'E_GIT_OBJECT_MISSING', detail: secret }), 'E_EVIDENCE_OBJECT_UNAVAILABLE'],
    [() => ({ ok: false, code: 'E_GIT_PATH_MISMATCH' }), 'E_EVIDENCE_PATH_MISMATCH'],
    [() => ({ ok: false, code: secret }), 'E_EVIDENCE_RESOLVER_UNKNOWN_CODE'],
    [() => secret, 'E_EVIDENCE_RESOLVER_MALFORMED'],
  ];
  for (const [answer, code] of cases) {
    const { v } = spyVerifier({ resolveRegularBlob: answer });
    const r = v.verify(file('same.txt'));
    assert.deepEqual(r, { status: 'ERROR', code, kind: 'repo_file' });
    assert.ok(!JSON.stringify(r).includes('secret'));
  }
  // A Git error on one side of a path diff keeps its own diagnostic.
  const oneSide = spyVerifier({
    resolveRegularBlob: (real, c, p) => (c === C2 ? { ok: false, code: 'E_GIT_OUTPUT_INVALID' } : real.resolveRegularBlob(c, p)),
  }).v;
  assert.deepEqual(pick(oneSide.verify(diff('mod.txt'))), ['ERROR', 'E_EVIDENCE_GIT_OUTPUT_INVALID']);
});

// ---------------------------------------------------------------- A3.5b.2R F7: deeply immutable facts

function assertDeepFrozen(value, where) {
  if (value === null || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value), where);
  for (const [k, v] of Object.entries(value)) assertDeepFrozen(v, `${where}.${k}`);
}

test('F7: every VERIFIED result is deeply frozen, including nested git_diff sides', () => {
  const v = ciVerifier([snapshot()], { expectedBase: C1 }).v;
  const refs = [...validRefs(), diff('add.txt'), diff('del.txt'), diff('mode.sh')];
  for (const ref of refs) {
    const r = v.verify(ref);
    assert.equal(r.status, 'VERIFIED', ref.kind);
    assertDeepFrozen(r, ref.kind);
  }
  assertDeepFrozen(v.verifyAll(refs), 'verifyAll');
});

test('F7: attempts to rewrite nested facts throw and change nothing', () => {
  const r = verifier.verify(diff('mode.sh'));
  const before = JSON.stringify(r);
  const attempts = [
    () => { r.facts.head.oid = MISSING; },
    () => { r.facts.head.mode = '100644'; },
    () => { r.facts.base = null; },
    () => { r.facts.change = 'unchanged'; },
    () => { r.status = 'INVALID'; },
    () => { delete r.facts.head; },
    () => Object.defineProperty(r.facts.head, 'extra', { value: 1 }),
  ];
  for (const attempt of attempts) assert.throws(attempt, TypeError);
  assert.equal(JSON.stringify(r), before);
  // Results are independent: a later verify returns equal, separate objects.
  const again = verifier.verify(diff('mode.sh'));
  assert.deepEqual(again, r);
  assert.notEqual(again.facts.head, r.facts.head);
});

// ---------------------------------------------------------------- A3.5b.2R post-review regressions

test('verifyAll: refs are read by index, never through an overridden iterator', () => {
  const evil = { kind: 'git_commit', commit: 'f'.repeat(40) };
  const refs = [evil];
  refs[Symbol.iterator] = function* iterate() {
    yield { kind: 'git_commit', commit: C2 };
  };
  const all = verifier.verifyAll(refs);
  assert.equal(all.status, 'INVALID');
  assert.equal(all.results.length, 1);
  assert.deepEqual(pick(all.results[0]), ['INVALID', 'E_EVIDENCE_SHA_MISMATCH']);
});

test('verifyAll: an unreadable element is a per-item ERROR and keeps its position', () => {
  const refs = [file('same.txt'), null, file('same.txt')];
  Object.defineProperty(refs, 1, {
    get() {
      throw new Error('element');
    },
  });
  const all = verifier.verifyAll(refs);
  assert.equal(all.status, 'ERROR');
  assert.deepEqual(all.results.map((r) => [r.status, r.code]), [['VERIFIED', null], ['ERROR', 'E_EVIDENCE_REF_UNREADABLE'], ['VERIFIED', null]]);
});

test('last resort: a resolver result whose fields throw is ERROR E_EVIDENCE_INTERNAL, never VERIFIED', () => {
  const throwing = () => ({
    get ok() {
      throw new Error('field');
    },
  });
  for (const [method, ref] of [
    ['resolveCommit', { kind: 'git_commit', commit: C2 }],
    ['resolveRegularBlob', file('same.txt')],
    ['readBlob', lines('lines3.txt', 1, 1)],
    ['resolveCommitTree', diff(null)],
  ]) {
    const { v } = spyVerifier({ [method]: throwing });
    assert.deepEqual(v.verify(ref), { status: 'ERROR', code: 'E_EVIDENCE_INTERNAL', kind: ref.kind }, method);
  }
});

// ---------------------------------------------------------------- A3.5b.2R.1: evidence collections

const INVALID_REF = () => ({ kind: 'git_commit', commit: C1 }); // SHA mismatch: INVALID
const UNVERIFIABLE_REF = () => ({ kind: 'http_probe' });
const ERROR_REF = () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy; // unreadable: ERROR
};
// Verifier whose Git answers are instant, for large collections (git_commit refs are VERIFIED).
function fastVerifier() {
  return createEvidenceVerifier({
    repoRoot: repo.dir,
    expectedCommit: C2,
    expectedBase: C1,
    resolver: {
      resolveCommit: (c) => ({ ok: true, commit: c }),
      resolveRegularBlob: () => ({ ok: false, code: 'E_GIT_FAILED' }),
      readBlob: () => ({ ok: false, code: 'E_GIT_FAILED' }),
      resolveCommitTree: () => ({ ok: false, code: 'E_GIT_FAILED' }),
    },
  });
}
const VERIFIED_REF = () => ({ kind: 'git_commit', commit: C2 });
// Proxy over a real array that reports `length` as given and counts reads.
function lengthProxy(items, length) {
  const reads = { length: 0, index: 0 };
  const proxy = new Proxy(items, {
    get(t, k) {
      if (k === 'length') {
        reads.length++;
        return typeof length === 'function' ? length(reads.length) : length;
      }
      if (typeof k === 'string' && /^[0-9]+$/.test(k)) reads.index++;
      return t[k];
    },
  });
  return { proxy, reads };
}
const rejected = (r, code) => {
  assert.equal(r.status, 'ERROR');
  assert.equal(r.code, code);
  assert.equal(r.results.length, 0);
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.results) && Object.isFrozen(r.counts));
};

test('M-1: a Proxy with one INVALID ref and a malformed length is never VERIFIED', () => {
  assert.equal(verifier.verifyAll([INVALID_REF()]).status, 'INVALID', 'fixture');
  for (const length of [-1, NaN, undefined, null, 'abc', '1', 1.5, -0.5, true, {}, 1n]) {
    const { proxy, reads } = lengthProxy([INVALID_REF()], length);
    const r = verifier.verifyAll(proxy);
    assert.notEqual(r.status, 'VERIFIED', String(length));
    rejected(r, 'E_EVIDENCE_COLLECTION_INVALID');
    assert.equal(reads.length, 1);
    assert.equal(reads.index, 0, 'no element is read for a rejected collection');
  }
});

test('L-1: oversized lengths are rejected before any element is read or allocated', () => {
  for (const length of [MAX_REFS + 1, 2 ** 32 - 1, Number.MAX_SAFE_INTEGER]) {
    const { proxy, reads } = lengthProxy([VERIFIED_REF()], length);
    rejected(verifier.verifyAll(proxy), 'E_EVIDENCE_COLLECTION_TOO_LARGE');
    assert.equal(reads.index, 0);
  }
  for (const length of [Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 2 ** 53]) {
    const { proxy, reads } = lengthProxy([VERIFIED_REF()], length);
    rejected(verifier.verifyAll(proxy), 'E_EVIDENCE_COLLECTION_INVALID');
    assert.equal(reads.index, 0);
  }
  // A real, sparse array of the maximum array length is also rejected without iteration.
  rejected(verifier.verifyAll(new Array(2 ** 32 - 1)), 'E_EVIDENCE_COLLECTION_TOO_LARGE');
  const over = [];
  over.length = MAX_REFS + 1;
  rejected(verifier.verifyAll(over), 'E_EVIDENCE_COLLECTION_TOO_LARGE');
});

test('L-1: huge lengths stay bounded in a memory-limited child process', () => {
  const moduleUrl = pathToFileURL(fileURLToPath(new URL('../../scripts/ai/verify-evidence.mjs', import.meta.url))).href;
  const script = `
    const { createEvidenceVerifier } = await import(${JSON.stringify(moduleUrl)});
    const v = createEvidenceVerifier({ repoRoot: '.', expectedCommit: '${C2}' });
    const out = [];
    for (const n of [2 ** 32 - 1, 1e9, Number.MAX_SAFE_INTEGER, Infinity]) {
      const p = new Proxy([], { get: (t, k) => (k === 'length' ? n : t[k]) });
      const r = v.verifyAll(p);
      out.push(r.status + ':' + r.code + ':' + r.results.length);
    }
    const real = v.verifyAll(new Array(2 ** 32 - 1));
    out.push(real.status + ':' + real.code + ':' + real.results.length);
    console.log(out.join(','));
  `;
  const started = Date.now();
  const child = execFileSync(process.execPath, ['--max-old-space-size=32', '--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(
    child.trim(),
    [
      'ERROR:E_EVIDENCE_COLLECTION_TOO_LARGE:0',
      'ERROR:E_EVIDENCE_COLLECTION_TOO_LARGE:0',
      'ERROR:E_EVIDENCE_COLLECTION_TOO_LARGE:0',
      'ERROR:E_EVIDENCE_COLLECTION_INVALID:0',
      'ERROR:E_EVIDENCE_COLLECTION_TOO_LARGE:0',
    ].join(','),
  );
  assert.ok(Date.now() - started < 30_000);
});

test('MAX_REFS: exactly MAX_REFS refs are verified; one more is rejected', () => {
  assert.equal(MAX_REFS, 1024);
  const v = fastVerifier();
  const full = Array.from({ length: MAX_REFS }, VERIFIED_REF);
  const ok = v.verifyAll(full);
  assert.equal(ok.status, 'VERIFIED');
  assert.equal(ok.results.length, MAX_REFS);
  assert.equal(ok.counts.VERIFIED, MAX_REFS);
  full.push(VERIFIED_REF());
  rejected(v.verifyAll(full), 'E_EVIDENCE_COLLECTION_TOO_LARGE');
});

test('aggregate: empty, single and mixed collections', () => {
  const v = fastVerifier();
  const empty = v.verifyAll([]);
  assert.deepEqual([empty.status, empty.code, empty.results.length], ['UNVERIFIABLE', 'E_EVIDENCE_NONE', 0]);
  assert.deepEqual([v.verifyAll([VERIFIED_REF()]).status, v.verifyAll([VERIFIED_REF()]).code], ['VERIFIED', null]);
  assert.equal(v.verifyAll([INVALID_REF()]).status, 'INVALID');
  assert.equal(v.verifyAll([UNVERIFIABLE_REF()]).status, 'UNVERIFIABLE');
  assert.equal(v.verifyAll([ERROR_REF()]).status, 'ERROR');
  const mixed = v.verifyAll([VERIFIED_REF(), UNVERIFIABLE_REF(), INVALID_REF(), ERROR_REF()]);
  assert.equal(mixed.status, 'ERROR');
  assert.deepEqual({ ...mixed.counts }, { VERIFIED: 1, INVALID: 1, UNVERIFIABLE: 1, ERROR: 1 });
});

test('aggregate invariant: VERIFIED iff non-empty and every result is VERIFIED (randomized)', () => {
  const v = fastVerifier();
  const makers = [VERIFIED_REF, INVALID_REF, UNVERIFIABLE_REF, ERROR_REF, null];
  let seed = 0x5eed;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let round = 0; round < 300; round++) {
    const length = rand(7);
    const refs = [];
    refs.length = length;
    for (let i = 0; i < length; i++) {
      const make = makers[rand(makers.length)];
      if (make) refs[i] = make(); // null maker leaves a hole
    }
    const r = v.verifyAll(refs);
    assert.equal(r.results.length, length);
    const statuses = r.results.map((x) => x.status);
    const expected =
      length === 0 ? 'UNVERIFIABLE'
        : statuses.includes('ERROR') ? 'ERROR'
          : statuses.includes('INVALID') ? 'INVALID'
            : statuses.includes('UNVERIFIABLE') ? 'UNVERIFIABLE'
              : 'VERIFIED';
    assert.equal(r.status, expected, JSON.stringify(statuses));
    if (r.status === 'VERIFIED') assert.ok(length > 0 && statuses.every((s) => s === 'VERIFIED'));
  }
});

test('L-2: holes are INVALID per index and inherited index values are ignored', () => {
  const v = fastVerifier();
  const sparse = [VERIFIED_REF(), , VERIFIED_REF()]; // eslint-disable-line no-sparse-arrays
  const r = v.verifyAll(sparse);
  assert.equal(r.status, 'INVALID');
  assert.deepEqual(r.results.map((x) => [x.status, x.code]), [['VERIFIED', null], ['INVALID', 'E_EVIDENCE_REF_MISSING'], ['VERIFIED', null]]);
  assert.equal(v.verifyAll(new Array(3)).status, 'INVALID');

  let polluted;
  let pollutedLengthOnly;
  Object.defineProperty(Array.prototype, '1', { value: VERIFIED_REF(), configurable: true, writable: true });
  Object.defineProperty(Array.prototype, '0', { value: VERIFIED_REF(), configurable: true, writable: true });
  try {
    polluted = v.verifyAll([VERIFIED_REF(), , VERIFIED_REF()]); // eslint-disable-line no-sparse-arrays
    const onlyLength = [];
    onlyLength.length = 2;
    pollutedLengthOnly = v.verifyAll(onlyLength);
  } finally {
    delete Array.prototype[0];
    delete Array.prototype[1];
    // Array.prototype is an Array: defining indexes grew its length, which delete does not undo.
    Array.prototype.length = 0;
  }
  assert.equal(polluted.status, 'INVALID');
  assert.deepEqual(pick(polluted.results[1]), ['INVALID', 'E_EVIDENCE_REF_MISSING']);
  assert.equal(pollutedLengthOnly.status, 'INVALID');
  assert.equal(pollutedLengthOnly.counts.INVALID, 2);
});

test('collections: throwing traps are per-index ERROR; unreadable collections are ERROR', () => {
  const v = fastVerifier();
  const target = [VERIFIED_REF(), VERIFIED_REF()];
  const throwOnIndex = new Proxy(target, {
    get(t, k) {
      if (k === '1') throw new Error('index');
      return t[k];
    },
  });
  // Elements are read through own descriptors, so a throwing get trap is never reached.
  const a = v.verifyAll(throwOnIndex);
  assert.equal(a.status, 'VERIFIED');
  assert.equal(a.results.length, 2);
  const throwOnOwn = new Proxy(target, {
    getOwnPropertyDescriptor(t, k) {
      if (k === '0') throw new Error('own');
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
  });
  const b = v.verifyAll(throwOnOwn);
  assert.deepEqual(b.results.map((x) => x.status), ['ERROR', 'VERIFIED']);
  assert.equal(b.status, 'ERROR');

  const { proxy, revoke } = Proxy.revocable([VERIFIED_REF()], {});
  revoke();
  rejected(v.verifyAll(proxy), 'E_EVIDENCE_COLLECTION_UNREADABLE');
  const lengthThrows = new Proxy([VERIFIED_REF()], {
    get(t, k) {
      if (k === 'length') throw new Error('length');
      return t[k];
    },
  });
  rejected(v.verifyAll(lengthThrows), 'E_EVIDENCE_COLLECTION_UNREADABLE');
});

test('collections: length is read once even when a Proxy changes it between reads', () => {
  const v = fastVerifier();
  const { proxy, reads } = lengthProxy([VERIFIED_REF()], (n) => (n === 1 ? 1 : 1e9));
  const r = v.verifyAll(proxy);
  assert.equal(reads.length, 1);
  assert.equal(r.status, 'VERIFIED');
  assert.equal(r.results.length, 1);
  const shrinking = lengthProxy([VERIFIED_REF()], (n) => (n === 1 ? 2 : 0));
  const s = v.verifyAll(shrinking.proxy);
  assert.equal(shrinking.reads.length, 1);
  assert.equal(s.status, 'INVALID', 'the reported second element does not exist');
  assert.deepEqual(pick(s.results[1]), ['INVALID', 'E_EVIDENCE_REF_MISSING']);
});

test('collections: frozen arrays and frozen refs verify normally and are not modified', () => {
  const v = fastVerifier();
  const refs = Object.freeze([Object.freeze(VERIFIED_REF()), Object.freeze(VERIFIED_REF())]);
  const r = v.verifyAll(refs);
  assert.equal(r.status, 'VERIFIED');
  assert.equal(r.results.length, 2);
  assert.notEqual(r.results, refs);
  assertDeepFrozen(r, 'verifyAll');
  const bad = Object.freeze([Object.freeze(INVALID_REF())]);
  assert.equal(v.verifyAll(bad).status, 'INVALID');
});

test('collections: each element is read once, through a single own-descriptor read', () => {
  const v = fastVerifier();
  const traps = [];
  // A Proxy whose descriptor and get traps disagree: only the descriptor is consulted.
  const disagreeing = new Proxy([, ], { // eslint-disable-line no-sparse-arrays
    getOwnPropertyDescriptor(t, k) {
      traps.push(`gopd:${String(k)}`);
      return k === '0' ? { value: INVALID_REF(), writable: true, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(t, k);
    },
    get(t, k) {
      traps.push(`get:${String(k)}`);
      return k === '0' ? VERIFIED_REF() : t[k];
    },
  });
  const r = v.verifyAll(disagreeing);
  assert.equal(r.status, 'INVALID');
  assert.deepEqual(traps, ['get:length', 'gopd:0']);
  // An own accessor element runs exactly once; a setter-only element is not a ref.
  let gets = 0;
  const refs = [];
  Object.defineProperty(refs, 0, { enumerable: true, get: () => { gets++; return VERIFIED_REF(); } });
  Object.defineProperty(refs, 1, { enumerable: true, set() {} });
  const a = v.verifyAll(refs);
  assert.equal(gets, 1);
  assert.deepEqual(a.results.map((x) => [x.status, x.code]), [['VERIFIED', null], ['INVALID', 'E_EVIDENCE_REF_INVALID']]);
});
