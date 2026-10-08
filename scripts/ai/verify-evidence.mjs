// EvidenceRef verifier (A3.5b.2; ADR-AI-010 D1-D7, D18, D20; owner decisions D25-D28, OD-1..OD-8).
//
// Turns a structurally valid EvidenceRef (an untrusted pointer written by a producer) into a
// verification result, using only TRUSTED CONTEXT supplied by the caller: the repository root,
// the exact expected commit (and base), the GitHub repository id, the accepted events and
// trusted CI snapshot envelopes (hlg.ci-snapshot.v1, assembled by trusted infrastructure). No
// context value is ever taken from an EvidenceRef or a producer report.
//
// Results: { status, code, kind, facts? } with status VERIFIED | INVALID | UNVERIFIABLE | ERROR.
// VERIFIED means "the reference matches trusted facts"; it is not PASS and not approval (a
// verified ci_check may record a failure). Only VERIFIED results carry the verified facts
// as their claim; other statuses never count as evidence.
//
// Fail closed: every resolver call is wrapped; a thrown error, a malformed result or an unknown
// code is ERROR. Exact SHAs are compared with the context before any Git call. Paths pass the
// common L0 policy before Git. readBlob only ever receives the oid that resolveRegularBlob
// returned for the same commit and path. Git access goes through git-object.mjs only (object
// database, no working tree, no replace objects, no lazy fetch). No network access.

import { MAX_BLOB_BYTES, createGitObjectResolver } from './git-object.mjs';
import { repoPathViolations } from './repo-path.mjs';

export const REPO_LINE_MAX_BYTES = 2_097_152;
export const CI_SNAPSHOT_ENVELOPE = 'hlg.ci-snapshot.v1';
export const EVIDENCE_KINDS = Object.freeze([
  'repo_file', 'repo_line', 'git_commit', 'git_diff', 'test', 'ci_check', 'http_probe', 'schema_validation',
]);

const SHA = /^[0-9a-f]{40}$/;
const RANK = { VERIFIED: 0, UNVERIFIABLE: 1, INVALID: 2, ERROR: 3 };
const REGULAR_MODES = new Set(['100644', '100755']);
const CI_CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'action_required']);

if (REPO_LINE_MAX_BYTES > MAX_BLOB_BYTES) throw new Error('verify-evidence: line cap exceeds resolver cap');

// Resolver failure codes. Anything not listed (including E_GIT_PATH_MISMATCH, E_GIT_FAILED,
// E_GIT_OUTPUT_INVALID and malformed or thrown results) is ERROR.
const GIT_CODE_MAP = {
  E_GIT_SHA_INVALID: ['INVALID', 'E_EVIDENCE_SHA_INVALID'],
  E_GIT_PATH_UNSAFE: ['INVALID', 'E_EVIDENCE_PATH_UNSAFE'],
  E_GIT_NOT_COMMIT: ['INVALID', 'E_EVIDENCE_NOT_COMMIT'],
  E_GIT_PATH_MISSING: ['INVALID', 'E_EVIDENCE_PATH_MISSING'],
  E_GIT_NOT_REGULAR_BLOB: ['INVALID', 'E_EVIDENCE_NOT_REGULAR_BLOB'],
  E_GIT_NOT_BLOB: ['INVALID', 'E_EVIDENCE_NOT_BLOB'],
  E_GIT_OBJECT_MISSING: ['ERROR', 'E_EVIDENCE_OBJECT_UNAVAILABLE'],
  E_GIT_TOO_LARGE: ['UNVERIFIABLE', 'E_EVIDENCE_TOO_LARGE'],
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPosInt = (v) => Number.isSafeInteger(v) && v > 0;
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

function result(status, code, kind, facts) {
  const r = { status, code, kind };
  if (facts) r.facts = Object.freeze(facts);
  return Object.freeze(r);
}

function fromGit(failure, kind) {
  const mapped = Object.hasOwn(GIT_CODE_MAP, failure.code) ? GIT_CODE_MAP[failure.code] : ['ERROR', 'E_EVIDENCE_GIT_ERROR'];
  return result(mapped[0], mapped[1], kind);
}

// ---- trusted context validation (construction time; violations are caller bugs) ----

function requireSha(value, name) {
  if (typeof value !== 'string' || !SHA.test(value)) throw new TypeError(`createEvidenceVerifier: ${name} must be a full lowercase SHA`);
}

function copySnapshot(s, i) {
  const bad = (what) => {
    throw new TypeError(`createEvidenceVerifier: ciSnapshots[${i}] ${what}`);
  };
  if (!isPlainObject(s) || s.envelope !== CI_SNAPSHOT_ENVELOPE) bad(`must be an ${CI_SNAPSHOT_ENVELOPE} envelope`);
  if (!isPlainObject(s.repository) || !isPosInt(s.repository.id)) bad('repository.id must be a positive integer');
  const r = s.run;
  if (!isPlainObject(r)) bad('run must be an object');
  if (!isPosInt(r.id) || !isPosInt(r.run_attempt)) bad('run.id and run.run_attempt must be positive integers');
  if (!isNonEmptyString(r.event) || !isNonEmptyString(r.status)) bad('run.event and run.status must be strings');
  if (!(r.conclusion === null || typeof r.conclusion === 'string')) bad('run.conclusion must be a string or null');
  if (typeof r.head_sha !== 'string' || !SHA.test(r.head_sha)) bad('run.head_sha must be a full lowercase SHA');
  if (!isPosInt(r.head_repository_id)) bad('run.head_repository_id must be a positive integer');
  if (r.check_suite_id !== undefined && !isPosInt(r.check_suite_id)) bad('run.check_suite_id must be a positive integer');
  if (!Array.isArray(s.jobs)) bad('jobs must be an array');
  const jobs = s.jobs.map((j, k) => {
    if (!isPlainObject(j)) bad(`jobs[${k}] must be an object`);
    if (!isPosInt(j.id) || !isPosInt(j.run_id) || !isPosInt(j.run_attempt)) bad(`jobs[${k}] id, run_id and run_attempt must be positive integers`);
    if (!isNonEmptyString(j.name) || !isNonEmptyString(j.status)) bad(`jobs[${k}] name and status must be strings`);
    if (!(j.conclusion === null || typeof j.conclusion === 'string')) bad(`jobs[${k}].conclusion must be a string or null`);
    if (typeof j.head_sha !== 'string' || !SHA.test(j.head_sha)) bad(`jobs[${k}].head_sha must be a full lowercase SHA`);
    if (j.check_suite_id !== undefined && !isPosInt(j.check_suite_id)) bad(`jobs[${k}].check_suite_id must be a positive integer`);
    return Object.freeze({
      id: j.id, run_id: j.run_id, run_attempt: j.run_attempt, name: j.name, status: j.status,
      conclusion: j.conclusion, head_sha: j.head_sha, check_suite_id: j.check_suite_id,
    });
  });
  // Copy only the fields decisions use; `fetched` and other audit metadata are not kept.
  return Object.freeze({
    repository: Object.freeze({ id: s.repository.id }),
    run: Object.freeze({
      id: r.id, run_attempt: r.run_attempt, event: r.event, status: r.status, conclusion: r.conclusion,
      head_sha: r.head_sha, head_repository_id: r.head_repository_id, check_suite_id: r.check_suite_id,
    }),
    jobs: Object.freeze(jobs),
  });
}

export function createEvidenceVerifier({
  repoRoot,
  expectedCommit,
  expectedBase,
  repositoryId,
  acceptedEvents = ['pull_request'],
  ciSnapshots = [],
  resolver,
} = {}) {
  if (!isNonEmptyString(repoRoot)) throw new TypeError('createEvidenceVerifier: repoRoot must be a non-empty string');
  requireSha(expectedCommit, 'expectedCommit');
  if (expectedBase !== undefined) requireSha(expectedBase, 'expectedBase');
  if (repositoryId !== undefined && !isPosInt(repositoryId)) {
    throw new TypeError('createEvidenceVerifier: repositoryId must be a positive integer');
  }
  if (!Array.isArray(acceptedEvents) || acceptedEvents.length === 0 || !acceptedEvents.every(isNonEmptyString)) {
    throw new TypeError('createEvidenceVerifier: acceptedEvents must be a non-empty array of strings');
  }
  if (!Array.isArray(ciSnapshots)) throw new TypeError('createEvidenceVerifier: ciSnapshots must be an array');
  const snapshots = Object.freeze(ciSnapshots.map(copySnapshot));
  const events = new Set(acceptedEvents);
  const git = resolver === undefined ? createGitObjectResolver({ repoRoot }) : resolver;
  if (!isPlainObject(git) || !['resolveCommit', 'resolveRegularBlob', 'readBlob'].every((m) => typeof git[m] === 'function')) {
    throw new TypeError('createEvidenceVerifier: resolver must provide resolveCommit, resolveRegularBlob and readBlob');
  }

  // INFO-3: never let a resolver exception or malformed answer look like success.
  function call(method, ...args) {
    let r;
    try {
      r = git[method](...args);
    } catch {
      return { ok: false, code: 'E_RESOLVER_THREW' };
    }
    if (!isPlainObject(r) || typeof r.ok !== 'boolean') return { ok: false, code: 'E_RESOLVER_MALFORMED' };
    return r;
  }

  function checkSha(value, expected, kind) {
    if (typeof value !== 'string' || !SHA.test(value)) return result('INVALID', 'E_EVIDENCE_SHA_INVALID', kind);
    if (value !== expected) return result('INVALID', 'E_EVIDENCE_SHA_MISMATCH', kind);
    return null;
  }

  function checkPath(value, kind) {
    if (typeof value !== 'string') return result('INVALID', 'E_EVIDENCE_REF_INVALID', kind);
    if (repoPathViolations(value).length > 0) return result('INVALID', 'E_EVIDENCE_PATH_UNSAFE', kind);
    return null;
  }

  function commitFacts(commit, kind) {
    const r = call('resolveCommit', commit);
    if (!r.ok) return { fail: fromGit(r, kind) };
    if (r.commit !== commit) return { fail: result('ERROR', 'E_EVIDENCE_GIT_ERROR', kind) };
    return { commit };
  }

  // Regular blob at commit/path; the returned entry must describe exactly what was asked.
  function blobFacts(commit, path, kind) {
    const r = call('resolveRegularBlob', commit, path);
    if (!r.ok) return { fail: fromGit(r, kind), code: r.code };
    if (r.commit !== commit || r.path !== path || typeof r.oid !== 'string' || !SHA.test(r.oid) || !REGULAR_MODES.has(r.mode)) {
      return { fail: result('ERROR', 'E_EVIDENCE_GIT_ERROR', kind) };
    }
    return { commit, path, mode: r.mode, oid: r.oid };
  }

  function lineCount(bytes) {
    let n = 0;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) n++;
    if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) n++;
    return n;
  }

  const handlers = {
    repo_file(ref) {
      const k = 'repo_file';
      const bad = checkSha(ref.commit, expectedCommit, k) || checkPath(ref.path, k);
      if (bad) return bad;
      const b = blobFacts(ref.commit, ref.path, k);
      if (b.fail) return b.fail;
      return result('VERIFIED', null, k, { commit: b.commit, path: b.path, mode: b.mode, oid: b.oid });
    },

    repo_line(ref) {
      const k = 'repo_line';
      const bad = checkSha(ref.commit, expectedCommit, k) || checkPath(ref.path, k);
      if (bad) return bad;
      if (!isPosInt(ref.start_line) || !isPosInt(ref.end_line)) return result('INVALID', 'E_EVIDENCE_REF_INVALID', k);
      if (ref.start_line > ref.end_line) return result('INVALID', 'E_EVIDENCE_LINE_RANGE', k);
      const b = blobFacts(ref.commit, ref.path, k);
      if (b.fail) return b.fail;
      // INFO-4: read exactly the oid resolved for this commit and path.
      const r = call('readBlob', b.oid, REPO_LINE_MAX_BYTES);
      if (!r.ok) return fromGit(r, k);
      if (r.oid !== b.oid || !(r.bytes instanceof Uint8Array) || r.size !== r.bytes.length || r.size > REPO_LINE_MAX_BYTES) {
        return result('ERROR', 'E_EVIDENCE_GIT_ERROR', k);
      }
      const bytes = r.bytes;
      if (bytes.includes(0)) return result('INVALID', 'E_EVIDENCE_NOT_TEXT', k);
      try {
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        return result('INVALID', 'E_EVIDENCE_NOT_TEXT', k);
      }
      const lines = lineCount(bytes);
      if (ref.end_line > lines) return result('INVALID', 'E_EVIDENCE_LINE_OUT_OF_BOUNDS', k);
      return result('VERIFIED', null, k, {
        commit: b.commit, path: b.path, mode: b.mode, oid: b.oid, line_count: lines, start_line: ref.start_line, end_line: ref.end_line,
      });
    },

    git_commit(ref) {
      const k = 'git_commit';
      const bad = checkSha(ref.commit, expectedCommit, k);
      if (bad) return bad;
      const c = commitFacts(ref.commit, k);
      if (c.fail) return c.fail;
      return result('VERIFIED', null, k, { commit: c.commit });
    },

    git_diff(ref) {
      const k = 'git_diff';
      if (expectedBase === undefined) return result('UNVERIFIABLE', 'E_EVIDENCE_BASE_UNKNOWN', k);
      const bad = checkSha(ref.base_commit, expectedBase, k) || checkSha(ref.head_commit, expectedCommit, k);
      if (bad) return bad;
      if (!(ref.path === null || typeof ref.path === 'string')) return result('INVALID', 'E_EVIDENCE_REF_INVALID', k);
      if (ref.path !== null) {
        const unsafe = checkPath(ref.path, k);
        if (unsafe) return unsafe;
      }
      const base = commitFacts(ref.base_commit, k);
      if (base.fail) return base.fail;
      const head = commitFacts(ref.head_commit, k);
      if (head.fail) return head.fail;
      if (ref.path === null) {
        if (ref.base_commit === ref.head_commit) return result('INVALID', 'E_EVIDENCE_DIFF_EMPTY', k);
        return result('VERIFIED', null, k, { base_commit: ref.base_commit, head_commit: ref.head_commit, path: null });
      }
      const side = (commit) => {
        const b = blobFacts(commit, ref.path, k);
        if (!b.fail) return { state: 'BLOB', mode: b.mode, oid: b.oid };
        if (b.code === 'E_GIT_PATH_MISSING') return { state: 'ABSENT' };
        if (b.code === 'E_GIT_NOT_REGULAR_BLOB') return { state: 'SPECIAL' };
        return { state: b.fail.status === 'ERROR' ? 'UNAVAILABLE' : 'BROKEN', fail: b.fail };
      };
      const from = side(ref.base_commit);
      const to = side(ref.head_commit);
      for (const s of [from, to]) if (s.state === 'UNAVAILABLE') return result('ERROR', 'E_EVIDENCE_OBJECT_UNAVAILABLE', k);
      for (const s of [from, to]) if (s.state === 'BROKEN') return s.fail;
      if (from.state === 'SPECIAL' || to.state === 'SPECIAL') return result('UNVERIFIABLE', 'E_EVIDENCE_DIFF_UNSUPPORTED_ENTRY', k);
      const facts = (change) => ({
        base_commit: ref.base_commit,
        head_commit: ref.head_commit,
        path: ref.path,
        change,
        base: from.state === 'BLOB' ? { mode: from.mode, oid: from.oid } : null,
        head: to.state === 'BLOB' ? { mode: to.mode, oid: to.oid } : null,
      });
      if (from.state === 'ABSENT' && to.state === 'ABSENT') return result('INVALID', 'E_EVIDENCE_DIFF_PATH_ABSENT', k);
      if (from.state === 'ABSENT') return result('VERIFIED', null, k, facts('added'));
      if (to.state === 'ABSENT') return result('VERIFIED', null, k, facts('deleted'));
      if (from.oid === to.oid && from.mode === to.mode) return result('INVALID', 'E_EVIDENCE_DIFF_UNCHANGED', k);
      return result('VERIFIED', null, k, facts('modified'));
    },

    test(ref) {
      const k = 'test';
      const bad = checkSha(ref.commit, expectedCommit, k) || checkPath(ref.file, k);
      if (bad) return bad;
      if (!isNonEmptyString(ref.name)) return result('INVALID', 'E_EVIDENCE_REF_INVALID', k);
      const b = blobFacts(ref.commit, ref.file, k);
      if (b.fail) return b.fail;
      // The test file exists, but its outcome needs trusted CI evidence (not available in V1).
      return result('UNVERIFIABLE', 'E_EVIDENCE_TEST_OUTCOME_UNVERIFIED', k);
    },

    ci_check(ref) {
      const k = 'ci_check';
      if (ref.provider !== 'github_actions') return result('INVALID', 'E_EVIDENCE_PROVIDER_MISMATCH', k);
      if (!isNonEmptyString(ref.check_name) || typeof ref.workflow_run_id !== 'string' || !/^[0-9]{1,20}$/.test(ref.workflow_run_id)
        || !isPosInt(ref.run_attempt) || !CI_CONCLUSIONS.has(ref.conclusion)) {
        return result('INVALID', 'E_EVIDENCE_REF_INVALID', k);
      }
      const bad = checkSha(ref.commit, expectedCommit, k);
      if (bad) return bad;
      if (repositoryId === undefined) return result('UNVERIFIABLE', 'E_EVIDENCE_REPOSITORY_UNKNOWN', k);
      const matches = snapshots.filter((s) => String(s.run.id) === ref.workflow_run_id && s.run.run_attempt === ref.run_attempt);
      if (matches.length === 0) return result('UNVERIFIABLE', 'E_EVIDENCE_SNAPSHOT_MISSING', k);
      if (matches.length > 1) return result('ERROR', 'E_EVIDENCE_SNAPSHOT_DUPLICATE', k);
      const snap = matches[0];
      if (snap.repository.id !== repositoryId) return result('INVALID', 'E_EVIDENCE_REPOSITORY_MISMATCH', k);
      if (snap.run.head_repository_id !== snap.repository.id) return result('UNVERIFIABLE', 'E_EVIDENCE_FORK', k);
      if (snap.run.head_sha !== ref.commit) return result('INVALID', 'E_EVIDENCE_SHA_MISMATCH', k);
      if (!events.has(snap.run.event)) return result('UNVERIFIABLE', 'E_EVIDENCE_EVENT_NOT_ACCEPTED', k);
      if (snap.run.status !== 'completed') return result('UNVERIFIABLE', 'E_EVIDENCE_CI_INCOMPLETE', k);
      const jobs = snap.jobs.filter((j) => j.name === ref.check_name);
      if (jobs.length === 0) return result('INVALID', 'E_EVIDENCE_CHECK_NOT_FOUND', k);
      if (jobs.length > 1) return result('INVALID', 'E_EVIDENCE_CHECK_AMBIGUOUS', k);
      const job = jobs[0];
      const suiteMismatch = job.check_suite_id !== undefined && snap.run.check_suite_id !== undefined && job.check_suite_id !== snap.run.check_suite_id;
      if (job.run_id !== snap.run.id || job.run_attempt !== snap.run.run_attempt || job.head_sha !== snap.run.head_sha || suiteMismatch) {
        return result('ERROR', 'E_EVIDENCE_SNAPSHOT_INCONSISTENT', k);
      }
      if (job.status !== 'completed') return result('UNVERIFIABLE', 'E_EVIDENCE_CI_INCOMPLETE', k);
      if (job.conclusion !== ref.conclusion) return result('INVALID', 'E_EVIDENCE_CONCLUSION_MISMATCH', k);
      return result('VERIFIED', null, k, {
        run_id: snap.run.id, run_attempt: snap.run.run_attempt, check_name: job.name, conclusion: job.conclusion, head_sha: snap.run.head_sha,
      });
    },

    http_probe() {
      return result('UNVERIFIABLE', 'E_EVIDENCE_KIND_UNSUPPORTED', 'http_probe');
    },

    schema_validation() {
      return result('UNVERIFIABLE', 'E_EVIDENCE_KIND_UNSUPPORTED', 'schema_validation');
    },
  };

  function verify(ref) {
    try {
      if (!isPlainObject(ref) || typeof ref.kind !== 'string') return result('INVALID', 'E_EVIDENCE_REF_INVALID', null);
      if (!EVIDENCE_KINDS.includes(ref.kind)) return result('INVALID', 'E_EVIDENCE_KIND_UNKNOWN', null);
      return handlers[ref.kind](ref);
    } catch {
      return result('ERROR', 'E_EVIDENCE_INTERNAL', isPlainObject(ref) && EVIDENCE_KINDS.includes(ref.kind) ? ref.kind : null);
    }
  }

  function verifyAll(refs) {
    if (!Array.isArray(refs)) throw new TypeError('verifyAll: refs must be an array');
    const counts = { VERIFIED: 0, INVALID: 0, UNVERIFIABLE: 0, ERROR: 0 };
    if (refs.length === 0) {
      return Object.freeze({ status: 'UNVERIFIABLE', code: 'E_EVIDENCE_NONE', results: Object.freeze([]), counts: Object.freeze(counts) });
    }
    const results = refs.map(verify);
    let status = 'VERIFIED';
    for (const r of results) {
      counts[r.status]++;
      if (RANK[r.status] > RANK[status]) status = r.status;
    }
    return Object.freeze({ status, code: null, results: Object.freeze(results), counts: Object.freeze(counts) });
  }

  return Object.freeze({ verify, verifyAll });
}
