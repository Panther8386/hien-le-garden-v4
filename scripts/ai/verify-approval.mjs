// ApprovalRef verifier (A3.5c; ADR-AI-011, ADR-AI-006, ADR-AI-010 D9-D13, ADR-AI-005).
//
// Matches an ApprovalRef (an untrusted pointer written by a producer) against TRUSTED CONTEXT
// supplied by the caller when the verifier is constructed: repository id, PR number, expected
// commit, approver allowlist (numeric GitHub user ids), trusted object paths and an approval
// snapshot (hlg.approval-snapshot.v1). Results are VERIFIED | STALE | INVALID | UNVERIFIABLE |
// ERROR.
//
// Threat model: T0, the ApprovalRef and any producer-controlled data, is untrusted and must fail
// closed. T1, the constructor arguments, the Git L1 resolver and this code, is trusted by
// construction: the code path that builds the verifier is responsible for where the snapshot and
// the allowlist came from (ADR-AI-011). No field carries "provenance" or any other trust
// credential. T2, arbitrary JavaScript in the same process, is out of scope.
//
// A result is a computation over caller-supplied data, NOT an authenticated decision and NOT an
// authorization. VERIFIED is snapshot-bound and never authorizes a merge, a migration or a
// deployment. Gates must invoke the verifier themselves, in their own trusted run, and ignore any
// approval status supplied as input (ADR-AI-005). No production VERIFIED result is possible until
// the trusted A3.7 snapshot adapter exists; tests use fixture snapshots through the same
// trusted-context interface. A VERIFIED result never asserts human identity: the source author is
// reported as `source_author_id` only (shared-account limitation, ADR-AI-006).
//
// The verifier is pure apart from Git object reads through the L1 resolver (git-object.mjs): no
// network, no file reads, no environment access, no writes.

import { createGitObjectResolver } from './git-object.mjs';
import { repoPathViolations } from './repo-path.mjs';

export const APPROVAL_SNAPSHOT_ENVELOPE = 'hlg.approval-snapshot.v1';
export const APPROVAL_TYPES = Object.freeze(['spec', 'package_change', 'migration', 'merge', 'production']);
// Upper bound on one verifyAll collection, checked before any element is read.
export const MAX_REFS = 1024;

const SHA = /^[0-9a-f]{40}$/;
const SOURCE_ID = /^[0-9]{1,20}$/;
// ADR-AI-011 grammar: whole body, case-sensitive, single spaces, optional single trailing LF.
const COMMAND = /^HLG-APPROVE (spec|package_change|migration) ([0-9a-f]{40})\n?$/;
const REF_FIELDS = Object.freeze(['approval_type', 'source', 'pr_number', 'source_id', 'object_sha']);
const SOURCES = new Set(['github_pr_comment', 'github_merge', 'github_environment_review']);
// Allowed approval_type → source pairs; every other pair is INVALID.
const PAIRS = new Map([
  ['spec', 'github_pr_comment'],
  ['package_change', 'github_pr_comment'],
  ['migration', 'github_pr_comment'],
  ['merge', 'github_merge'],
  ['production', 'github_environment_review'],
]);
const COMMENT_TYPES = new Set(['spec', 'package_change', 'migration']);
const REGULAR_MODES = new Set(['100644', '100755']);
const MAX_PR_NUMBER = 1_000_000;
const MAX_SNAPSHOT_COMMENTS = 10_000;

// Git L1 failure codes. Repository and Git failures stay ERROR; anything not listed is ERROR
// E_APPROVAL_RESOLVER_UNKNOWN_CODE. No Git output is ever copied.
const GIT_CODE_MAP = new Map([
  ['E_GIT_SHA_INVALID', ['INVALID', 'E_APPROVAL_SHA_INVALID']],
  ['E_GIT_PATH_UNSAFE', ['INVALID', 'E_APPROVAL_PATH_UNSAFE']],
  ['E_GIT_NOT_COMMIT', ['INVALID', 'E_APPROVAL_NOT_COMMIT']],
  ['E_GIT_PATH_MISSING', ['INVALID', 'E_APPROVAL_PATH_MISSING']],
  ['E_GIT_NOT_REGULAR_BLOB', ['INVALID', 'E_APPROVAL_NOT_REGULAR_BLOB']],
  ['E_GIT_NOT_BLOB', ['INVALID', 'E_APPROVAL_NOT_BLOB']],
  ['E_GIT_TOO_LARGE', ['UNVERIFIABLE', 'E_APPROVAL_TOO_LARGE']],
  ['E_GIT_OBJECT_MISSING', ['ERROR', 'E_APPROVAL_OBJECT_UNAVAILABLE']],
  ['E_GIT_PATH_MISMATCH', ['ERROR', 'E_APPROVAL_PATH_MISMATCH']],
  ['E_GIT_FAILED', ['ERROR', 'E_APPROVAL_GIT_FAILED']],
  ['E_GIT_OUTPUT_INVALID', ['ERROR', 'E_APPROVAL_GIT_OUTPUT_INVALID']],
  ['E_GIT_COMMIT_MALFORMED', ['ERROR', 'E_APPROVAL_OBJECT_MALFORMED']],
  ['E_GIT_NOT_TREE', ['ERROR', 'E_APPROVAL_OBJECT_MALFORMED']],
]);
const RESOLVER_THREW = 'E_APPROVAL_RESOLVER_THREW';
const RESOLVER_MALFORMED = 'E_APPROVAL_RESOLVER_MALFORMED';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPosInt = (v) => Number.isSafeInteger(v) && v > 0;
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const isSha = (v) => typeof v === 'string' && SHA.test(v);
const isPrimitive = (v) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

function result(status, code, type, facts) {
  return Object.freeze(facts ? { status, code, approval_type: type, facts: deepFreeze(facts) } : { status, code, approval_type: type });
}

function fromGit(failure, type) {
  if (failure.evidence) return result('ERROR', failure.evidence, type);
  const mapped = typeof failure.code === 'string' && GIT_CODE_MAP.get(failure.code);
  return mapped ? result(mapped[0], mapped[1], type) : result('ERROR', 'E_APPROVAL_RESOLVER_UNKNOWN_CODE', type);
}

// ---- approval command (ADR-AI-011 grammar) ----

// Pure; never throws. Returns a frozen { ok: true, type, sha } only for an exact command body.
export function parseApprovalCommand(body) {
  if (typeof body !== 'string') return Object.freeze({ ok: false });
  const m = COMMAND.exec(body);
  return m ? Object.freeze({ ok: true, type: m[1], sha: m[2] }) : Object.freeze({ ok: false });
}

// ---- T0: stable, data-only ApprovalRef snapshot ----

// Returns { ref } (frozen null-prototype copy with exactly the five fields) or { fail }. Each
// producer property is read once through its descriptor; accessors are never invoked; a throwing
// Proxy trap propagates to verify().
function snapshotRef(input) {
  const invalid = (code) => ({ __proto__: null, fail: result('INVALID', code, null) });
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return invalid('E_APPROVAL_REF_INVALID');
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return invalid('E_APPROVAL_REF_INVALID');
  const keys = Reflect.ownKeys(input);
  if (keys.length !== REF_FIELDS.length) return invalid('E_APPROVAL_REF_INVALID');
  const ref = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string') return invalid('E_APPROVAL_REF_NOT_DATA');
    const d = Reflect.getOwnPropertyDescriptor(input, key);
    if (d === undefined || !Object.hasOwn(d, 'value') || d.enumerable !== true) return invalid('E_APPROVAL_REF_NOT_DATA');
    if (!REF_FIELDS.includes(key) || !isPrimitive(d.value)) return invalid('E_APPROVAL_REF_INVALID');
    ref[key] = d.value;
  }
  return { __proto__: null, ref: Object.freeze(ref) };
}

// ---- T1: trusted context validation (construction time; violations are caller bugs) ----

function bad(what) {
  throw new TypeError(`createApprovalVerifier: ${what}`);
}

function checkTrustedPath(path, name) {
  if (typeof path !== 'string' || repoPathViolations(path).length > 0) bad(`${name} must be a safe repository path`);
  return path;
}

function copyObjectPaths(input) {
  if (input === undefined) return Object.freeze({});
  if (!isPlainObject(input)) bad('objectPaths must be an object');
  const p = { ...input };
  const out = {};
  if (p.spec !== undefined) out.spec = checkTrustedPath(p.spec, 'objectPaths.spec');
  if (p.package_change !== undefined) out.package_change = checkTrustedPath(p.package_change, 'objectPaths.package_change');
  if (p.migration !== undefined) {
    if (!Array.isArray(p.migration)) bad('objectPaths.migration must be an array');
    const list = [...p.migration].map((path, i) => checkTrustedPath(path, `objectPaths.migration[${i}]`));
    if (new Set(list).size !== list.length) bad('objectPaths.migration must not repeat a path');
    out.migration = Object.freeze(list);
  }
  return Object.freeze(out);
}

function copyApproverIds(input) {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) bad('approverIds must be an array of positive integers');
  const ids = [...input];
  if (!ids.every(isPosInt)) bad('approverIds must be an array of positive integers');
  return Object.freeze(ids);
}

// Each level is shallow-copied first (one read per field); only the copy is validated and used.
function copyApprovalSnapshot(input) {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) bad(`approvalSnapshot must be an ${APPROVAL_SNAPSHOT_ENVELOPE} envelope`);
  const s = { ...input };
  if (s.envelope !== APPROVAL_SNAPSHOT_ENVELOPE) bad(`approvalSnapshot must be an ${APPROVAL_SNAPSHOT_ENVELOPE} envelope`);
  if (!isPlainObject(s.repository)) bad('approvalSnapshot.repository must be an object');
  const repository = { ...s.repository };
  if (!isPosInt(repository.id)) bad('approvalSnapshot.repository.id must be a positive integer');
  if (!isPlainObject(s.pull_request)) bad('approvalSnapshot.pull_request must be an object');
  const pr = { ...s.pull_request };
  if (!isPosInt(pr.number) || pr.number > MAX_PR_NUMBER) bad('approvalSnapshot.pull_request.number is out of range');
  if (!isSha(pr.head_sha)) bad('approvalSnapshot.pull_request.head_sha must be a full lowercase SHA');
  // OD-A: trusted-caller assertions; only the literal value true counts.
  let freshness = { complete: false, edit_status_reliable: false };
  if (s.freshness !== undefined) {
    if (!isPlainObject(s.freshness)) bad('approvalSnapshot.freshness must be an object');
    const f = { ...s.freshness };
    freshness = { complete: f.complete === true, edit_status_reliable: f.edit_status_reliable === true };
  }
  if (!Array.isArray(s.comments)) bad('approvalSnapshot.comments must be an array');
  if (s.comments.length > MAX_SNAPSHOT_COMMENTS) bad('approvalSnapshot.comments is too large');
  const comments = [...s.comments].map((input, k) => {
    if (!isPlainObject(input)) bad(`approvalSnapshot.comments[${k}] must be an object`);
    const c = { ...input };
    if (!isNonEmptyString(c.kind)) bad(`approvalSnapshot.comments[${k}].kind must be a string`);
    if (typeof c.id !== 'string' || !SOURCE_ID.test(c.id)) bad(`approvalSnapshot.comments[${k}].id must be a digit string`);
    if (!isPosInt(c.author_id)) bad(`approvalSnapshot.comments[${k}].author_id must be a positive integer`);
    if (!isNonEmptyString(c.author_association)) bad(`approvalSnapshot.comments[${k}].author_association must be a string`);
    if (!isNonEmptyString(c.created_at) || !isNonEmptyString(c.updated_at)) bad(`approvalSnapshot.comments[${k}] timestamps must be strings`);
    if (typeof c.body !== 'string') bad(`approvalSnapshot.comments[${k}].body must be a string`);
    return Object.freeze({
      kind: c.kind, id: c.id, author_id: c.author_id, author_association: c.author_association,
      created_at: c.created_at, updated_at: c.updated_at, body: c.body,
    });
  });
  let merge = null;
  if (s.merge !== null && s.merge !== undefined) {
    if (!isPlainObject(s.merge)) bad('approvalSnapshot.merge must be an object or null');
    const m = { ...s.merge };
    if (typeof m.merged !== 'boolean') bad('approvalSnapshot.merge.merged must be a boolean');
    if (m.head_sha !== null && !isSha(m.head_sha)) bad('approvalSnapshot.merge.head_sha must be a SHA or null');
    if (m.merge_commit_sha !== null && !isSha(m.merge_commit_sha)) bad('approvalSnapshot.merge.merge_commit_sha must be a SHA or null');
    if (m.merged_by_id !== null && !isPosInt(m.merged_by_id)) bad('approvalSnapshot.merge.merged_by_id must be a positive integer or null');
    merge = Object.freeze({ merged: m.merged, head_sha: m.head_sha, merge_commit_sha: m.merge_commit_sha, merged_by_id: m.merged_by_id });
  }
  return Object.freeze({
    repository: Object.freeze({ id: repository.id }),
    pull_request: Object.freeze({ number: pr.number, head_sha: pr.head_sha }),
    freshness: Object.freeze(freshness),
    comments: Object.freeze(comments),
    merge,
  });
}

export function createApprovalVerifier({
  repoRoot,
  repositoryId,
  prNumber,
  expectedCommit,
  approverIds,
  objectPaths,
  approvalSnapshot,
  resolver,
} = {}) {
  if (!isNonEmptyString(repoRoot)) bad('repoRoot must be a non-empty string');
  if (!isPosInt(repositoryId)) bad('repositoryId must be a positive integer');
  if (!isPosInt(prNumber) || prNumber > MAX_PR_NUMBER) bad('prNumber is out of range');
  if (!isSha(expectedCommit)) bad('expectedCommit must be a full lowercase SHA');
  const approvers = copyApproverIds(approverIds);
  const paths = copyObjectPaths(objectPaths);
  const snapshot = copyApprovalSnapshot(approvalSnapshot);
  const git = resolver === undefined ? createGitObjectResolver({ repoRoot }) : resolver;
  if (!isPlainObject(git) || typeof git.resolveRegularBlob !== 'function') bad('resolver must provide resolveRegularBlob');
  const allowlisted = (id) => approvers.includes(id);

  // Never let a resolver exception or malformed answer look like success.
  function call(path) {
    let r;
    try {
      r = git.resolveRegularBlob(expectedCommit, path);
    } catch {
      return { __proto__: null, ok: false, evidence: RESOLVER_THREW };
    }
    if (!isPlainObject(r) || typeof r.ok !== 'boolean') return { __proto__: null, ok: false, evidence: RESOLVER_MALFORMED };
    if (!r.ok) return { __proto__: null, ok: false, code: r.code };
    const { commit, path: rPath, mode, oid } = r;
    if (commit !== expectedCommit || rPath !== path || !isSha(oid) || !REGULAR_MODES.has(mode)) {
      return { __proto__: null, ok: false, evidence: RESOLVER_MALFORMED };
    }
    return { __proto__: null, ok: true, oid };
  }

  function verifyComment(ref) {
    const type = ref.approval_type;
    const matches = snapshot.comments.filter((c) => c.kind === 'issue_comment' && c.id === ref.source_id);
    if (matches.length === 0) return result('INVALID', 'E_APPROVAL_SOURCE_NOT_FOUND', type);
    if (matches.length > 1) return result('ERROR', 'E_APPROVAL_SNAPSHOT_DUPLICATE', type);
    const comment = matches[0];
    if (!allowlisted(comment.author_id) || comment.author_association !== 'OWNER') {
      return result('INVALID', 'E_APPROVAL_UNAUTHORIZED_ACTOR', type);
    }
    if (!snapshot.freshness.edit_status_reliable) return result('UNVERIFIABLE', 'E_APPROVAL_EDIT_STATUS_UNKNOWN', type);
    if (comment.updated_at !== comment.created_at) return result('INVALID', 'E_APPROVAL_SOURCE_EDITED', type);
    const command = parseApprovalCommand(comment.body);
    if (!command.ok || command.type !== type || command.sha !== ref.object_sha) {
      return result('INVALID', 'E_APPROVAL_COMMAND_MISMATCH', type);
    }
    const candidates = type === 'migration' ? paths.migration : paths[type] === undefined ? undefined : [paths[type]];
    if (candidates === undefined || candidates.length === 0) return result('UNVERIFIABLE', 'E_APPROVAL_OBJECT_PATH_UNKNOWN', type);
    // Every trusted path is resolved; any Git L1 failure decides the result.
    const matching = [];
    for (const path of candidates) {
      const r = call(path);
      if (!r.ok) return fromGit(r, type);
      if (r.oid === ref.object_sha) matching.push(path);
    }
    if (matching.length > 1) return result('INVALID', 'E_APPROVAL_SCOPE_AMBIGUOUS', type);
    if (matching.length === 0) return result('STALE', 'E_APPROVAL_STALE', type);
    return result('VERIFIED', null, type, {
      approval_type: type,
      source: ref.source,
      source_id: ref.source_id,
      pr_number: ref.pr_number,
      object_sha: ref.object_sha,
      path: matching[0],
      source_author_id: comment.author_id,
    });
  }

  function verifyMerge(ref) {
    const type = ref.approval_type;
    const merge = snapshot.merge;
    if (merge === null || merge.merged !== true) return result('UNVERIFIABLE', 'E_APPROVAL_NOT_MERGED', type);
    if (merge.head_sha !== ref.object_sha || ref.object_sha !== expectedCommit || !allowlisted(merge.merged_by_id)) {
      return result('INVALID', 'E_APPROVAL_MERGE_MISMATCH', type);
    }
    return result('VERIFIED', null, type, {
      approval_type: type,
      source: ref.source,
      source_id: null,
      pr_number: ref.pr_number,
      object_sha: ref.object_sha,
      source_author_id: merge.merged_by_id,
    });
  }

  function verifyRef(ref) {
    const type = APPROVAL_TYPES.includes(ref.approval_type) ? ref.approval_type : null;
    // 1. Exact v1 shape and type × source pair.
    if (type === null || !SOURCES.has(ref.source) || !Number.isSafeInteger(ref.pr_number) || ref.pr_number < 1
      || ref.pr_number > MAX_PR_NUMBER || !(ref.source_id === null || (typeof ref.source_id === 'string' && SOURCE_ID.test(ref.source_id)))
      || !isSha(ref.object_sha)) {
      return result('INVALID', 'E_APPROVAL_REF_INVALID', type);
    }
    if (PAIRS.get(type) !== ref.source) return result('INVALID', 'E_APPROVAL_TYPE_SOURCE_INVALID', type);
    if (COMMENT_TYPES.has(type) && ref.source_id === null) return result('INVALID', 'E_APPROVAL_TYPE_SOURCE_INVALID', type);
    if (type === 'merge' && ref.source_id !== null) return result('INVALID', 'E_APPROVAL_TYPE_SOURCE_INVALID', type);
    // 2. Production has no trusted source in V1.
    if (type === 'production') return result('UNVERIFIABLE', 'E_APPROVAL_SOURCE_UNSUPPORTED', type);
    // 3. Same PR.
    if (ref.pr_number !== prNumber) return result('INVALID', 'E_APPROVAL_CONTEXT_MISMATCH', type);
    // 4. Allowlist (empty → nothing can be verified).
    if (approvers.length === 0) return result('UNVERIFIABLE', 'E_APPROVAL_ALLOWLIST_UNAVAILABLE', type);
    // 5. Trusted snapshot present and asserted complete; a matching head alone is not freshness.
    if (snapshot === undefined) return result('UNVERIFIABLE', 'E_APPROVAL_SOURCE_MISSING', type);
    if (!snapshot.freshness.complete) return result('UNVERIFIABLE', 'E_APPROVAL_SNAPSHOT_UNFRESH', type);
    // 6. Snapshot context.
    if (snapshot.repository.id !== repositoryId || snapshot.pull_request.number !== prNumber) {
      return result('INVALID', 'E_APPROVAL_CONTEXT_MISMATCH', type);
    }
    if (snapshot.pull_request.head_sha !== expectedCommit) return result('UNVERIFIABLE', 'E_APPROVAL_SNAPSHOT_HEAD_MISMATCH', type);
    // 7–8. Source-specific checks.
    return type === 'merge' ? verifyMerge(ref) : verifyComment(ref);
  }

  function verify(input) {
    let snap;
    try {
      snap = snapshotRef(input);
    } catch {
      return result('ERROR', 'E_APPROVAL_REF_UNREADABLE', null);
    }
    if (snap.fail) return snap.fail;
    try {
      return verifyRef(snap.ref);
    } catch {
      return result('ERROR', 'E_APPROVAL_INTERNAL', APPROVAL_TYPES.includes(snap.ref.approval_type) ? snap.ref.approval_type : null);
    }
  }

  // Never throws. A real Array (or a Proxy of one) whose length, read once, is a safe integer from
  // 0 to MAX_REFS; each element is read once through its own property descriptor. Only data
  // elements are verified: an accessor element is never invoked and is INVALID (stricter than the
  // A3.5b EvidenceRef verifier). Results are stored as own data properties.
  function verifyAll(refs) {
    let length;
    try {
      if (!Array.isArray(refs)) return rejectCollection('E_APPROVAL_COLLECTION_INVALID');
      length = refs.length;
    } catch {
      return rejectCollection('E_APPROVAL_COLLECTION_UNREADABLE');
    }
    if (!Number.isSafeInteger(length) || length < 0) return rejectCollection('E_APPROVAL_COLLECTION_INVALID');
    if (length > MAX_REFS) return rejectCollection('E_APPROVAL_COLLECTION_TOO_LARGE');
    const results = [];
    for (let i = 0; i < length; i++) {
      let r;
      try {
        const d = Reflect.getOwnPropertyDescriptor(refs, i);
        if (d === undefined) r = result('INVALID', 'E_APPROVAL_REF_MISSING', null);
        else if (Object.hasOwn(d, 'value')) r = verify(d.value);
        // An accessor element (getter and/or setter) is T0 code: never invoked, fails closed.
        else r = result('INVALID', 'E_APPROVAL_REF_NOT_DATA', null);
      } catch {
        r = result('ERROR', 'E_APPROVAL_REF_UNREADABLE', null);
      }
      let stored = false;
      try {
        stored = Reflect.defineProperty(results, i, { __proto__: null, value: r, writable: false, enumerable: true, configurable: false });
      } catch {
        stored = false;
      }
      if (!stored) return rejectCollection('E_APPROVAL_INTERNAL');
    }
    return aggregate(results, length);
  }

  return Object.freeze({ verify, verifyAll });
}

const emptyCounts = () => ({ VERIFIED: 0, STALE: 0, UNVERIFIABLE: 0, INVALID: 0, ERROR: 0 });

function rejectCollection(code) {
  return Object.freeze({ status: 'ERROR', code, results: Object.freeze([]), counts: Object.freeze(emptyCounts()) });
}

// OD-C precedence: ERROR > INVALID > UNVERIFIABLE > STALE > VERIFIED. No default status: VERIFIED
// only when there is at least one result and every result is VERIFIED; an unexpected status counts
// as ERROR.
function aggregate(results, length) {
  const counts = emptyCounts();
  if (results.length !== length) {
    return Object.freeze({ status: 'ERROR', code: 'E_APPROVAL_INTERNAL', results: Object.freeze(results), counts: Object.freeze(counts) });
  }
  for (let i = 0; i < length; i++) {
    const status = Object.hasOwn(results, i) ? results[i].status : undefined;
    if (status === 'VERIFIED' || status === 'STALE' || status === 'UNVERIFIABLE' || status === 'INVALID') counts[status]++;
    else counts.ERROR++;
  }
  let status;
  let code = null;
  if (length === 0) {
    status = 'UNVERIFIABLE';
    code = 'E_APPROVAL_NONE';
  } else if (counts.ERROR > 0) status = 'ERROR';
  else if (counts.INVALID > 0) status = 'INVALID';
  else if (counts.UNVERIFIABLE > 0) status = 'UNVERIFIABLE';
  else if (counts.STALE > 0) status = 'STALE';
  else if (counts.VERIFIED === length) status = 'VERIFIED';
  else status = 'ERROR'; // unreachable while every status is counted above; kept to fail closed
  return Object.freeze({ status, code, results: Object.freeze(results), counts: Object.freeze(counts) });
}
