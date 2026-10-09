// Git object resolver, layer L1 (ADR-AI-010 D18; owner decisions D25-D27).
//
// Establishes LOCAL Git facts only, read from the Git object database of an explicit, trusted
// repository root: that a full SHA names a commit object, that an exact path in that commit is a
// regular blob (mode 100644 or 100755) with a given object id, the immutable bytes of a blob, and
// the root tree object id recorded in a commit (A3.5b.1T).
// It never claims that a commit belongs to a GitHub repository or PR, is trusted, was produced by
// a given person, passed CI or is approved; those facts come from trusted context in later
// layers. The working tree is never read.
//
// Boundary rules:
//   - SHAs must be full 40-character lowercase hex before Git runs (no abbreviations).
//   - Paths pass the common lexical policy L0 (repo-path.mjs) before Git runs.
//   - Git runs through execFileSync with an argv array and shell: false, in the trusted repoRoot,
//     with a finite timeout and output bound, and an environment from which every GIT_* variable
//     is removed (GIT_DIR, GIT_OBJECT_DIRECTORY, GIT_ALTERNATE_OBJECT_DIRECTORIES, GIT_CONFIG_*,
//     ...). GIT_NO_REPLACE_OBJECTS=1, GIT_TERMINAL_PROMPT=0 and GIT_NO_LAZY_FETCH=1 are then set,
//     and every call passes --no-replace-objects, so replace refs cannot substitute objects and a
//     partial clone never fetches a missing object from a remote.
//   - A regular-blob entry is confirmed against the referenced object itself, which must exist
//     locally and be of type blob.
//   - Path lookup uses --literal-pathspecs, --full-tree and "--" before the path, and the single
//     returned entry must name exactly the requested path.
//
// Results are { ok: true, ... } or { ok: false, code, ... } with stable codes. Raw Git output or
// stderr is never part of a semantic result.

import { execFileSync } from 'node:child_process';
import { repoPathViolations } from './repo-path.mjs';

export const GIT_TIMEOUT_MS = 30_000;
export const MAX_BLOB_BYTES = 2_097_152;
export const MAX_COMMIT_BYTES = 2_097_152;
const LS_TREE_MAX_BUFFER = 64 * 1024;
const BATCH_CHECK_MAX_BUFFER = 4 * 1024;
const FULL_SHA = /^[0-9a-f]{40}$/;
const GIT_GLOBAL_ARGS = ['--no-replace-objects', '--literal-pathspecs'];
const REGULAR_BLOB_MODES = new Set(['100644', '100755']);

// Copy of `env` without any GIT_* variable (any case), plus the two required settings.
export function sanitizedGitEnv(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (!/^GIT_/i.test(key)) out[key] = value;
  }
  out.GIT_NO_REPLACE_OBJECTS = '1';
  out.GIT_TERMINAL_PROMPT = '0';
  // Partial clones: never fetch a missing promisor object from a remote; a missing object is a
  // local fact (missing), not something to retrieve.
  out.GIT_NO_LAZY_FETCH = '1';
  return out;
}

// Production runner: argv only, no shell, explicit cwd, sanitized environment, bounded output.
// Returns stdout as a Buffer; throws on a non-zero exit, timeout or oversized output.
export function runGitProcess(repoRoot, args, { input, maxBuffer = LS_TREE_MAX_BUFFER } = {}) {
  return execFileSync('git', [...GIT_GLOBAL_ARGS, ...args], {
    cwd: repoRoot,
    env: sanitizedGitEnv(),
    input,
    maxBuffer,
    timeout: GIT_TIMEOUT_MS,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

const fail = (code, extra = {}) => ({ ok: false, code, ...extra });

// `runner` is injectable for tests only (counting or spying on calls); it receives the same
// (repoRoot, args, options) as runGitProcess.
export function createGitObjectResolver({ repoRoot, runner = runGitProcess } = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('createGitObjectResolver: repoRoot must be a non-empty string');
  }
  if (typeof runner !== 'function') throw new TypeError('createGitObjectResolver: runner must be a function');

  const git = (args, options) => {
    try {
      return { ok: true, out: runner(repoRoot, args, options) };
    } catch {
      return { ok: false };
    }
  };

  // Object type and size via `cat-file --batch-check` (prints "<sha> missing" for an unknown
  // object instead of failing), for a full SHA only.
  function objectInfo(sha) {
    const r = git(['cat-file', '--batch-check'], { input: `${sha}\n`, maxBuffer: BATCH_CHECK_MAX_BUFFER });
    if (!r.ok) return fail('E_GIT_FAILED');
    const line = Buffer.from(r.out).toString('latin1').replace(/\n$/, '');
    if (line === `${sha} missing`) return fail('E_GIT_OBJECT_MISSING');
    const m = /^([0-9a-f]{40}) (commit|tree|blob|tag) ([0-9]+)$/.exec(line);
    if (!m || m[1] !== sha) return fail('E_GIT_OUTPUT_INVALID');
    return { ok: true, type: m[2], size: Number(m[3]) };
  }

  function resolveCommit(sha) {
    if (typeof sha !== 'string' || !FULL_SHA.test(sha)) return fail('E_GIT_SHA_INVALID');
    const info = objectInfo(sha);
    if (!info.ok) return info;
    if (info.type !== 'commit') return fail('E_GIT_NOT_COMMIT', { type: info.type });
    return { ok: true, commit: sha };
  }

  // Root tree of an exact commit object. The commit is type-checked first (no ref, tag or
  // peeling), read through the same runner, and must be byte-for-byte the size batch-check
  // reported. Its header (up to the first blank line) must start with exactly one
  // "tree <40 lowercase hex>" line and contain no other tree line. The tree object itself must
  // exist locally and be of type tree.
  function resolveCommitTree(sha) {
    if (typeof sha !== 'string' || !FULL_SHA.test(sha)) return fail('E_GIT_SHA_INVALID');
    const info = objectInfo(sha);
    if (!info.ok) return info;
    if (info.type !== 'commit') return fail('E_GIT_NOT_COMMIT', { type: info.type });
    if (info.size > MAX_COMMIT_BYTES) return fail('E_GIT_TOO_LARGE', { size: info.size });
    const r = git(['cat-file', 'commit', sha], { maxBuffer: Math.max(info.size, 1) + 1 });
    if (!r.ok) return fail('E_GIT_FAILED');
    const raw = Buffer.from(r.out);
    if (raw.length !== info.size) return fail('E_GIT_OUTPUT_INVALID');
    const text = raw.toString('latin1');
    const end = text.indexOf('\n\n');
    if (end === -1) return fail('E_GIT_COMMIT_MALFORMED');
    const header = text.slice(0, end).split('\n');
    const m = /^tree ([0-9a-f]{40})$/.exec(header[0]);
    if (!m || header.slice(1).some((line) => line.startsWith('tree '))) return fail('E_GIT_COMMIT_MALFORMED');
    const treeOid = m[1];
    const tree = objectInfo(treeOid);
    if (!tree.ok) return tree;
    if (tree.type !== 'tree') return fail('E_GIT_NOT_TREE', { type: tree.type });
    return { ok: true, commit: sha, treeOid };
  }

  function resolveRegularBlob(commit, path) {
    if (typeof commit !== 'string' || !FULL_SHA.test(commit)) return fail('E_GIT_SHA_INVALID');
    if (typeof path !== 'string') return fail('E_GIT_PATH_UNSAFE', { violations: ['PATH-GRAMMAR'] });
    const violations = repoPathViolations(path);
    if (violations.length > 0) return fail('E_GIT_PATH_UNSAFE', { violations });

    const c = resolveCommit(commit);
    if (!c.ok) return c;

    const r = git(['ls-tree', '-z', '--full-tree', commit, '--', path], { maxBuffer: LS_TREE_MAX_BUFFER });
    if (!r.ok) return fail('E_GIT_FAILED');
    const entries = Buffer.from(r.out)
      .toString('latin1')
      .split('\0')
      .filter((e) => e.length > 0);
    if (entries.length === 0) return fail('E_GIT_PATH_MISSING');
    if (entries.length !== 1) return fail('E_GIT_PATH_MISMATCH');
    const m = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40})\t(.*)$/s.exec(entries[0]);
    if (!m) return fail('E_GIT_OUTPUT_INVALID');
    const [, mode, type, oid, returnedPath] = m;
    // Byte-exact comparison (L0 paths are ASCII, so latin1 decoding is lossless here).
    if (returnedPath !== path) return fail('E_GIT_PATH_MISMATCH');
    if (type !== 'blob' || !REGULAR_BLOB_MODES.has(mode)) return fail('E_GIT_NOT_REGULAR_BLOB', { mode });
    // ls-tree derives "blob" from the entry's mode; a malformed tree can point a 100644 entry
    // at a tree, commit, tag or missing object. Confirm the referenced object itself.
    const target = objectInfo(oid);
    if (!target.ok) return target;
    if (target.type !== 'blob') return fail('E_GIT_NOT_BLOB', { type: target.type });
    return { ok: true, commit, path, mode, oid };
  }

  function readBlob(oid, maxBytes) {
    if (typeof oid !== 'string' || !FULL_SHA.test(oid)) return fail('E_GIT_SHA_INVALID');
    if (!Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_BLOB_BYTES) {
      throw new TypeError(`readBlob: maxBytes must be an integer from 0 to ${MAX_BLOB_BYTES}`);
    }
    const info = objectInfo(oid);
    if (!info.ok) return info;
    if (info.type !== 'blob') return fail('E_GIT_NOT_BLOB', { type: info.type });
    if (info.size > maxBytes) return fail('E_GIT_TOO_LARGE', { size: info.size });
    const r = git(['cat-file', 'blob', oid], { maxBuffer: Math.max(info.size, 1) + 1 });
    if (!r.ok) return fail('E_GIT_FAILED');
    const bytes = new Uint8Array(r.out);
    if (bytes.length !== info.size) return fail('E_GIT_OUTPUT_INVALID');
    return { ok: true, oid, size: info.size, bytes };
  }

  return Object.freeze({ resolveCommit, resolveRegularBlob, readBlob, resolveCommitTree });
}
