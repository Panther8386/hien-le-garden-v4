// Tests for the ApprovalRef verifier (A3.5c, ADR-AI-011).
//
//   node --test test/ai/verify-approval.node-test.mjs
//
// Named *.node-test.mjs so Vitest never runs it in workerd. Hermetic: every repository is created
// under mkdtempSync(tmpdir()) and removed afterwards; the HLG repository is never touched.
// Approval snapshots here are synthetic test fixtures supplied through the trusted-context
// interface; a VERIFIED result from a fixture is a computation, never production authority.
// User ids are small synthetic numbers; no real account is referenced.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitObjectResolver } from '../../scripts/ai/git-object.mjs';
import * as approvalModule from '../../scripts/ai/verify-approval.mjs';
import {
  APPROVAL_SNAPSHOT_ENVELOPE,
  APPROVAL_TYPES,
  MAX_REFS,
  createApprovalVerifier,
  parseApprovalCommand,
} from '../../scripts/ai/verify-approval.mjs';

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

// ---------------------------------------------------------------- fixture repository

const SPEC = 'docs/ai/specs/SPEC-AI-001-example.md';
const LOCK = 'package-lock.json';
const MIG_A = 'migrations/0001_a.sql';
const MIG_B = 'migrations/0002_b.sql';
const MIG_DUP = 'migrations/0003_dup.sql';

const repo = makeRepo('hlg-verify-approval-');
const put = (name, data) => {
  const full = path.join(repo.dir, ...name.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, data);
};
// Older commit C1: first version of the spec.
put(SPEC, '# SPEC-AI-001 v1\n');
put(LOCK, '{"lockfileVersion":3}\n');
put(MIG_A, 'CREATE TABLE a (id INTEGER);\n');
put(MIG_B, 'CREATE TABLE b (id INTEGER);\n');
repo.git(['add', SPEC, LOCK, MIG_A, MIG_B]);
repo.git(['commit', '-q', '-m', 'c1']);
const C1 = repo.git(['rev-parse', 'HEAD']);
// Evaluated commit C2: spec changed, duplicate migration content, symlink and gitlink entries.
put(SPEC, '# SPEC-AI-001 v2\n');
put(MIG_DUP, 'CREATE TABLE a (id INTEGER);\n');
repo.git(['add', SPEC, MIG_DUP]);
const linkTarget = repo.git(['hash-object', '-w', '--stdin'], { input: SPEC });
repo.git(['update-index', '--add', '--cacheinfo', `120000,${linkTarget},docs/ai/specs/link.md`]);
repo.git(['update-index', '--add', '--cacheinfo', `160000,${C1},vendor/sub`]);
repo.git(['commit', '-q', '-m', 'c2']);
const C2 = repo.git(['rev-parse', 'HEAD']);
const oid = (commit, p) => repo.git(['rev-parse', `${commit}:${p}`]);
const SPEC_V1 = oid(C1, SPEC);
const SPEC_V2 = oid(C2, SPEC);
const LOCK_OID = oid(C2, LOCK);
const MIG_A_OID = oid(C2, MIG_A);
const MIG_B_OID = oid(C2, MIG_B);
const MISSING = 'deadbeef'.repeat(5);

// ---------------------------------------------------------------- fixture builders

const REPO_ID = 1001;
const PR = 7;
const OWNER_ID = 501;
const OTHER_ID = 502;
const TS = '2026-10-13T00:00:00Z';

const cmd = (type, sha) => `HLG-APPROVE ${type} ${sha}`;
const comment = (id, body, over = {}) => ({
  kind: 'issue_comment', id, author_id: OWNER_ID, author_association: 'OWNER', created_at: TS, updated_at: TS, body, ...over,
});
function snapshot(over = {}) {
  return {
    envelope: APPROVAL_SNAPSHOT_ENVELOPE,
    repository: { id: REPO_ID },
    pull_request: { number: PR, head_sha: C2 },
    freshness: { complete: true, edit_status_reliable: true },
    comments: [
      comment('11', cmd('spec', SPEC_V2)),
      comment('12', `${cmd('package_change', LOCK_OID)}\n`),
      comment('13', cmd('migration', MIG_B_OID)),
      comment('14', cmd('spec', SPEC_V1)),
      comment('15', cmd('migration', MIG_A_OID)),
    ],
    merge: null,
    ...over,
  };
}
const PATHS = { spec: SPEC, package_change: LOCK, migration: [MIG_A, MIG_B] };
function verifier(over = {}) {
  return createApprovalVerifier({
    repoRoot: repo.dir,
    repositoryId: REPO_ID,
    prNumber: PR,
    expectedCommit: C2,
    approverIds: [OWNER_ID],
    objectPaths: PATHS,
    approvalSnapshot: snapshot(),
    ...over,
  });
}
const ref = (approval_type, object_sha, source_id, over = {}) => ({
  approval_type, source: 'github_pr_comment', pr_number: PR, source_id, object_sha, ...over,
});
const specRef = (sha = SPEC_V2, id = '11') => ref('spec', sha, id);
const pick = (r) => [r.status, r.code];

// Resolver stub: answers resolveRegularBlob from a callback.
function stubResolver(answer) {
  const calls = [];
  return {
    calls,
    resolver: {
      resolveRegularBlob: (commit, p) => {
        calls.push([commit, p]);
        return answer(commit, p);
      },
    },
  };
}

// ---------------------------------------------------------------- module surface and purity

test('api: exports only the approved constants, parser and factory', () => {
  assert.deepEqual(Object.keys(approvalModule).sort(), ['APPROVAL_SNAPSHOT_ENVELOPE', 'APPROVAL_TYPES', 'MAX_REFS', 'createApprovalVerifier', 'parseApprovalCommand']);
  assert.equal(APPROVAL_SNAPSHOT_ENVELOPE, 'hlg.approval-snapshot.v1');
  assert.deepEqual([...APPROVAL_TYPES], ['spec', 'package_change', 'migration', 'merge', 'production']);
  assert.ok(Object.isFrozen(APPROVAL_TYPES));
  assert.equal(MAX_REFS, 1024);
  const v = verifier();
  assert.ok(Object.isFrozen(v));
  assert.deepEqual(Object.keys(v), ['verify', 'verifyAll']);
});

test('purity: imports only Git L1 and L0; no network, file, environment or process access', () => {
  const src = readFileSync(fileURLToPath(new URL('../../scripts/ai/verify-approval.mjs', import.meta.url)), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['./git-object.mjs', './repo-path.mjs']);
  const bannedTokens = [
    'node:fs', 'child_process', 'node:http', 'node:https', 'node:net', 'fetch(', 'fetch\'', 'process.', 'process[', 'require(',
    'import(', 'globalThis', 'readFile', 'execFile', 'spawn',
  ];
  for (const banned of bannedTokens) {
    assert.ok(!src.includes(banned), `must not contain ${banned}`);
  }
});

// ---------------------------------------------------------------- approval command grammar

test('command: exact commands parse, with at most one trailing LF', () => {
  assert.deepEqual({ ...parseApprovalCommand(cmd('spec', SPEC_V2)) }, { ok: true, type: 'spec', sha: SPEC_V2 });
  assert.deepEqual({ ...parseApprovalCommand(`${cmd('package_change', LOCK_OID)}\n`) }, { ok: true, type: 'package_change', sha: LOCK_OID });
  assert.equal(parseApprovalCommand(cmd('migration', MIG_A_OID)).ok, true);
  assert.ok(Object.isFrozen(parseApprovalCommand(cmd('spec', SPEC_V2))));
});

test('command: malformed bodies are rejected', () => {
  const s = SPEC_V2;
  const rejected = [
    `${cmd('spec', s)}\r\n`, `${cmd('spec', s)}\r`, `${cmd('spec', s)}\n\n`, `HLG-APPROVE\tspec ${s}`, `HLG-APPROVE  spec ${s}`,
    `HLG-APPROVE spec  ${s}`, ` ${cmd('spec', s)}`, `${cmd('spec', s)} `, `hlg-approve spec ${s}`, `HLG-APPROVE SPEC ${s}`,
    `HLG-APPROVE spec ${s.toUpperCase()}`, `HLG-APPROVE spec ${s.slice(0, 39)}`, `HLG-APPROVE spec ${s}0`, `> ${cmd('spec', s)}`,
    `\`${cmd('spec', s)}\``, `\`\`\`\n${cmd('spec', s)}\n\`\`\``, `LGTM ${cmd('spec', s)}`, `${cmd('spec', s)} please`,
    `${cmd('spec', s)}\nsecond line`, `HLG-APPROVE merge ${s}`, `HLG-APPROVE production ${s}`, `HLG-APPROVE custom ${s}`,
    `HLG-APPROVE spec`, '', `HLG${String.fromCharCode(0x2011)}APPROVE spec ${s}`, `HLG-APPROVE${String.fromCharCode(0xa0)}spec ${s}`,
  ];
  for (const body of rejected) assert.equal(parseApprovalCommand(body).ok, false, JSON.stringify(body));
  for (const value of [undefined, null, 1, {}, [cmd('spec', s)]]) assert.equal(parseApprovalCommand(value).ok, false);
});

// ---------------------------------------------------------------- VERIFIED paths (fixtures)

test('verified: spec, package_change and migration bound to the exact blobs', () => {
  const v = verifier();
  assert.deepEqual(v.verify(specRef()), {
    status: 'VERIFIED', code: null, approval_type: 'spec',
    facts: { approval_type: 'spec', source: 'github_pr_comment', source_id: '11', pr_number: PR, object_sha: SPEC_V2, path: SPEC, source_author_id: OWNER_ID },
  });
  assert.equal(v.verify(ref('package_change', LOCK_OID, '12')).status, 'VERIFIED');
  const m = v.verify(ref('migration', MIG_B_OID, '13'));
  assert.equal(m.status, 'VERIFIED');
  assert.equal(m.facts.path, MIG_B);
});

test('verified: merge is a post-merge audit record bound to the evaluated head', () => {
  const v = verifier({ approvalSnapshot: snapshot({ merge: { merged: true, head_sha: C2, merge_commit_sha: C1, merged_by_id: OWNER_ID } }) });
  const r = v.verify({ approval_type: 'merge', source: 'github_merge', pr_number: PR, source_id: null, object_sha: C2 });
  assert.deepEqual(pick(r), ['VERIFIED', null]);
  assert.equal(r.facts.source_author_id, OWNER_ID);
  assert.equal(r.facts.source_id, null);
});

// ---------------------------------------------------------------- ApprovalRef shape (T0)

test('ref: exactly five data fields; extra, missing or forged fields are INVALID', () => {
  const v = verifier();
  const base = specRef();
  assert.deepEqual(pick(v.verify({ ...base, provenance: 'trusted_infrastructure' })), ['INVALID', 'E_APPROVAL_REF_INVALID']);
  assert.deepEqual(pick(v.verify({ ...base, snapshot_provenance: 'a3.7_adapter' })), ['INVALID', 'E_APPROVAL_REF_INVALID']);
  assert.deepEqual(pick(v.verify({ ...base, human_approved: true })), ['INVALID', 'E_APPROVAL_REF_INVALID']);
  const { source_id: _omit, ...missing } = base;
  assert.deepEqual(pick(v.verify(missing)), ['INVALID', 'E_APPROVAL_REF_INVALID']);
  const swapped = { approval_type: 'spec', source: 'github_pr_comment', pr_number: PR, sourceId: '11', object_sha: SPEC_V2 };
  assert.deepEqual(pick(v.verify(swapped)), ['INVALID', 'E_APPROVAL_REF_INVALID']);
  for (const bad of [null, undefined, 'ref', 5, [], [base], Object.create({ ...base })]) {
    assert.equal(v.verify(bad).status, 'INVALID');
  }
});

test('ref: field values outside the v1 schema are INVALID', () => {
  const v = verifier();
  const cases = [
    { approval_type: 'custom' }, { approval_type: 'SPEC' }, { source: 'slack' }, { pr_number: 0 }, { pr_number: 1_000_001 },
    { pr_number: '7' }, { pr_number: 7.5 }, { source_id: 11 }, { source_id: '' }, { source_id: 'a1' }, { source_id: '1'.repeat(21) },
    { object_sha: SPEC_V2.toUpperCase() }, { object_sha: SPEC_V2.slice(0, 12) }, { object_sha: null }, { object_sha: { sha: SPEC_V2 } },
  ];
  for (const over of cases) assert.equal(v.verify({ ...specRef(), ...over }).status, 'INVALID', JSON.stringify(over));
});

test('ref: accessors and Proxies are read through descriptors, never invoked; throwing traps are ERROR', () => {
  const v = verifier();
  let calls = 0;
  const withGetter = { ...specRef() };
  Object.defineProperty(withGetter, 'object_sha', { enumerable: true, get: () => { calls++; return SPEC_V2; } });
  assert.deepEqual(pick(v.verify(withGetter)), ['INVALID', 'E_APPROVAL_REF_NOT_DATA']);
  assert.equal(calls, 0);
  const viaGet = new Proxy(specRef(), { get: (t, k) => (k === 'object_sha' ? SPEC_V1 : t[k]) });
  assert.equal(v.verify(viaGet).status, 'VERIFIED', 'the get trap is never consulted');
  const throwing = new Proxy(specRef(), { ownKeys() { throw new Error('trap'); } });
  assert.deepEqual(pick(v.verify(throwing)), ['ERROR', 'E_APPROVAL_REF_UNREADABLE']);
  const { proxy, revoke } = Proxy.revocable(specRef(), {});
  revoke();
  assert.deepEqual(pick(v.verify(proxy)), ['ERROR', 'E_APPROVAL_REF_UNREADABLE']);
  assert.deepEqual(pick(v.verify({ ...specRef(), [Symbol('x')]: 1 })), ['INVALID', 'E_APPROVAL_REF_INVALID']);
});

test('ref: type × source matrix and source_id nullability', () => {
  const v = verifier({ approvalSnapshot: snapshot({ merge: { merged: true, head_sha: C2, merge_commit_sha: C1, merged_by_id: OWNER_ID } }) });
  const sources = ['github_pr_comment', 'github_merge', 'github_environment_review'];
  const allowed = { spec: 'github_pr_comment', package_change: 'github_pr_comment', migration: 'github_pr_comment', merge: 'github_merge', production: 'github_environment_review' };
  for (const type of APPROVAL_TYPES) {
    for (const source of sources) {
      if (allowed[type] === source) continue;
      const r = v.verify({ approval_type: type, source, pr_number: PR, source_id: '11', object_sha: SPEC_V2 });
      assert.deepEqual(pick(r), ['INVALID', 'E_APPROVAL_TYPE_SOURCE_INVALID'], `${type}/${source}`);
    }
  }
  assert.deepEqual(pick(v.verify(specRef(SPEC_V2, null))), ['INVALID', 'E_APPROVAL_TYPE_SOURCE_INVALID']);
  const mergeWithId = { approval_type: 'merge', source: 'github_merge', pr_number: PR, source_id: '11', object_sha: C2 };
  assert.deepEqual(pick(v.verify(mergeWithId)), ['INVALID', 'E_APPROVAL_TYPE_SOURCE_INVALID']);
});

// ---------------------------------------------------------------- production and merge restrictions

test('production: always UNVERIFIABLE, even with a complete snapshot and a matching command', () => {
  const v = verifier({ approvalSnapshot: snapshot({ comments: [comment('20', cmd('spec', C2))] }) });
  for (const sourceId of ['20', null]) {
    const r = v.verify({ approval_type: 'production', source: 'github_environment_review', pr_number: PR, source_id: sourceId, object_sha: C2 });
    assert.deepEqual(pick(r), ['UNVERIFIABLE', 'E_APPROVAL_SOURCE_UNSUPPORTED']);
    assert.equal(r.facts, undefined);
  }
});

test('merge: not merged, wrong head, wrong merger or missing merge record are never VERIFIED', () => {
  const mergeRef = (sha = C2) => ({ approval_type: 'merge', source: 'github_merge', pr_number: PR, source_id: null, object_sha: sha });
  const at = (merge, sha) => pick(verifier({ approvalSnapshot: snapshot({ merge }) }).verify(mergeRef(sha)));
  assert.deepEqual(at(null), ['UNVERIFIABLE', 'E_APPROVAL_NOT_MERGED']);
  assert.deepEqual(at({ merged: false, head_sha: null, merge_commit_sha: null, merged_by_id: null }), ['UNVERIFIABLE', 'E_APPROVAL_NOT_MERGED']);
  assert.deepEqual(at({ merged: true, head_sha: C1, merge_commit_sha: C2, merged_by_id: OWNER_ID }), ['INVALID', 'E_APPROVAL_MERGE_MISMATCH']);
  assert.deepEqual(at({ merged: true, head_sha: C2, merge_commit_sha: C1, merged_by_id: OTHER_ID }), ['INVALID', 'E_APPROVAL_MERGE_MISMATCH']);
  assert.deepEqual(at({ merged: true, head_sha: C2, merge_commit_sha: C1, merged_by_id: null }), ['INVALID', 'E_APPROVAL_MERGE_MISMATCH']);
  assert.deepEqual(at({ merged: true, head_sha: C1, merge_commit_sha: C2, merged_by_id: OWNER_ID }, C1), ['INVALID', 'E_APPROVAL_MERGE_MISMATCH']);
});

// ---------------------------------------------------------------- allowlist and author

test('allowlist: absent or empty allowlist fails closed', () => {
  for (const approverIds of [undefined, []]) {
    assert.deepEqual(pick(verifier({ approverIds }).verify(specRef())), ['UNVERIFIABLE', 'E_APPROVAL_ALLOWLIST_UNAVAILABLE']);
  }
});

test('author: numeric allowlist membership AND OWNER association are both required', () => {
  const at = (over, approverIds = [OWNER_ID]) =>
    pick(verifier({ approverIds, approvalSnapshot: snapshot({ comments: [comment('11', cmd('spec', SPEC_V2), over)] }) }).verify(specRef()));
  assert.deepEqual(at({}), ['VERIFIED', null]);
  assert.deepEqual(at({ author_id: OTHER_ID }), ['INVALID', 'E_APPROVAL_UNAUTHORIZED_ACTOR']);
  for (const association of ['MEMBER', 'COLLABORATOR', 'CONTRIBUTOR', 'NONE', 'owner']) {
    assert.deepEqual(at({ author_association: association }), ['INVALID', 'E_APPROVAL_UNAUTHORIZED_ACTOR'], association);
  }
  assert.deepEqual(at({}, [OTHER_ID]), ['INVALID', 'E_APPROVAL_UNAUTHORIZED_ACTOR']);
});

// ---------------------------------------------------------------- context, replay and freshness

test('context: other PR, repository, head or commit is never VERIFIED (replay)', () => {
  const v = verifier();
  assert.deepEqual(pick(v.verify({ ...specRef(), pr_number: 8 })), ['INVALID', 'E_APPROVAL_CONTEXT_MISMATCH']);
  const otherRepo = verifier({ approvalSnapshot: snapshot({ repository: { id: 9999 } }) });
  assert.deepEqual(pick(otherRepo.verify(specRef())), ['INVALID', 'E_APPROVAL_CONTEXT_MISMATCH']);
  const otherPr = verifier({ approvalSnapshot: snapshot({ pull_request: { number: 8, head_sha: C2 } }) });
  assert.deepEqual(pick(otherPr.verify(specRef())), ['INVALID', 'E_APPROVAL_CONTEXT_MISMATCH']);
  const oldHead = verifier({ approvalSnapshot: snapshot({ pull_request: { number: PR, head_sha: C1 } }) });
  assert.deepEqual(pick(oldHead.verify(specRef())), ['UNVERIFIABLE', 'E_APPROVAL_SNAPSHOT_HEAD_MISMATCH']);
  // The same comment evaluated at another commit binds to that commit's blob.
  const atC1 = verifier({ expectedCommit: C1, approvalSnapshot: snapshot({ pull_request: { number: PR, head_sha: C1 } }) });
  assert.deepEqual(pick(atC1.verify(specRef())), ['STALE', 'E_APPROVAL_STALE']);
});

test('freshness: a matching head alone never establishes freshness', () => {
  const at = (snap) => pick(verifier({ approvalSnapshot: snap }).verify(specRef()));
  assert.deepEqual(at(undefined), ['UNVERIFIABLE', 'E_APPROVAL_SOURCE_MISSING']);
  const { freshness: _f, ...noFreshness } = snapshot();
  assert.deepEqual(at(noFreshness), ['UNVERIFIABLE', 'E_APPROVAL_SNAPSHOT_UNFRESH']);
  for (const complete of [false, 'true', 1, null, undefined]) {
    assert.deepEqual(at(snapshot({ freshness: { complete, edit_status_reliable: true } })), ['UNVERIFIABLE', 'E_APPROVAL_SNAPSHOT_UNFRESH'], String(complete));
  }
  for (const reliable of [false, 'true', undefined]) {
    assert.deepEqual(at(snapshot({ freshness: { complete: true, edit_status_reliable: reliable } })), ['UNVERIFIABLE', 'E_APPROVAL_EDIT_STATUS_UNKNOWN'], String(reliable));
  }
});

test('freshness: producer timestamps and freshness claims in the ref are not accepted', () => {
  const v = verifier({ approvalSnapshot: snapshot({ freshness: { complete: false, edit_status_reliable: true } }) });
  assert.deepEqual(pick(v.verify({ ...specRef(), fetched_at: TS })), ['INVALID', 'E_APPROVAL_REF_INVALID']);
  assert.deepEqual(pick(v.verify({ ...specRef(), freshness: true })), ['INVALID', 'E_APPROVAL_REF_INVALID']);
  assert.deepEqual(pick(v.verify(specRef())), ['UNVERIFIABLE', 'E_APPROVAL_SNAPSHOT_UNFRESH']);
});

// ---------------------------------------------------------------- source records

test('source: missing in a complete snapshot is INVALID; duplicates are ERROR; only issue comments count', () => {
  const v = verifier();
  assert.deepEqual(pick(v.verify(specRef(SPEC_V2, '999'))), ['INVALID', 'E_APPROVAL_SOURCE_NOT_FOUND']);
  const dup = verifier({ approvalSnapshot: snapshot({ comments: [comment('11', cmd('spec', SPEC_V2)), comment('11', cmd('spec', SPEC_V2))] }) });
  assert.deepEqual(pick(dup.verify(specRef())), ['ERROR', 'E_APPROVAL_SNAPSHOT_DUPLICATE']);
  for (const kind of ['review_comment', 'review', 'commit_comment']) {
    const other = verifier({ approvalSnapshot: snapshot({ comments: [comment('11', cmd('spec', SPEC_V2), { kind })] }) });
    assert.deepEqual(pick(other.verify(specRef())), ['INVALID', 'E_APPROVAL_SOURCE_NOT_FOUND'], kind);
  }
  // A review comment with the same id does not create ambiguity with the issue comment.
  const mixed = verifier({ approvalSnapshot: snapshot({ comments: [comment('11', cmd('spec', SPEC_V2)), comment('11', 'x', { kind: 'review_comment' })] }) });
  assert.equal(mixed.verify(specRef()).status, 'VERIFIED');
});

test('source: a missing comment in an incomplete snapshot is never treated as deleted', () => {
  const v = verifier({ approvalSnapshot: snapshot({ comments: [], freshness: { complete: false, edit_status_reliable: true } }) });
  assert.deepEqual(pick(v.verify(specRef())), ['UNVERIFIABLE', 'E_APPROVAL_SNAPSHOT_UNFRESH']);
});

test('source: an edited comment is INVALID when edit metadata is reliable', () => {
  const v = verifier({ approvalSnapshot: snapshot({ comments: [comment('11', cmd('spec', SPEC_V2), { updated_at: '2026-10-13T00:00:01Z' })] }) });
  assert.deepEqual(pick(v.verify(specRef())), ['INVALID', 'E_APPROVAL_SOURCE_EDITED']);
});

test('source: the command must match the ref type and object SHA exactly', () => {
  const at = (body) => pick(verifier({ approvalSnapshot: snapshot({ comments: [comment('11', body)] }) }).verify(specRef()));
  assert.deepEqual(at(cmd('package_change', SPEC_V2)), ['INVALID', 'E_APPROVAL_COMMAND_MISMATCH']);
  assert.deepEqual(at(cmd('spec', SPEC_V1)), ['INVALID', 'E_APPROVAL_COMMAND_MISMATCH']);
  assert.deepEqual(at(`Approved. ${cmd('spec', SPEC_V2)}`), ['INVALID', 'E_APPROVAL_COMMAND_MISMATCH']);
  assert.deepEqual(at(`${cmd('spec', SPEC_V2)}\r\n`), ['INVALID', 'E_APPROVAL_COMMAND_MISMATCH']);
  assert.deepEqual(at('LGTM'), ['INVALID', 'E_APPROVAL_COMMAND_MISMATCH']);
});

// ---------------------------------------------------------------- Git object binding

test('binding: an approval for an older blob version is STALE; cross-TaskSpec replay is never VERIFIED', () => {
  const v = verifier();
  assert.deepEqual(pick(v.verify(specRef(SPEC_V1, '14'))), ['STALE', 'E_APPROVAL_STALE']);
  // A spec approval replayed against another spec path binds to that file's blob.
  const other = verifier({ objectPaths: { ...PATHS, spec: MIG_A } });
  assert.deepEqual(pick(other.verify(specRef())), ['STALE', 'E_APPROVAL_STALE']);
});

test('binding: paths come only from trusted context', () => {
  const at = (objectPaths, r = specRef()) => pick(verifier({ objectPaths }).verify(r));
  assert.deepEqual(at({}), ['UNVERIFIABLE', 'E_APPROVAL_OBJECT_PATH_UNKNOWN']);
  assert.deepEqual(at(undefined), ['UNVERIFIABLE', 'E_APPROVAL_OBJECT_PATH_UNKNOWN']);
  assert.deepEqual(at({ spec: SPEC }, ref('package_change', LOCK_OID, '12')), ['UNVERIFIABLE', 'E_APPROVAL_OBJECT_PATH_UNKNOWN']);
  assert.deepEqual(at({ migration: [] }, ref('migration', MIG_B_OID, '13')), ['UNVERIFIABLE', 'E_APPROVAL_OBJECT_PATH_UNKNOWN']);
});

test('binding: symlinks, gitlinks and missing paths are INVALID; missing objects are ERROR', () => {
  const at = (spec) => pick(verifier({ objectPaths: { spec } }).verify(specRef()));
  assert.deepEqual(at('docs/ai/specs/link.md'), ['INVALID', 'E_APPROVAL_NOT_REGULAR_BLOB']);
  assert.deepEqual(at('vendor/sub'), ['INVALID', 'E_APPROVAL_NOT_REGULAR_BLOB']);
  assert.deepEqual(at('docs/ai/specs/missing.md'), ['INVALID', 'E_APPROVAL_PATH_MISSING']);
  const absent = verifier({ expectedCommit: MISSING, approvalSnapshot: snapshot({ pull_request: { number: PR, head_sha: MISSING } }) });
  assert.deepEqual(pick(absent.verify(specRef())), ['ERROR', 'E_APPROVAL_OBJECT_UNAVAILABLE']);
});

test('migration: exactly one matching trusted path; ambiguity fails closed; no default path', () => {
  const v = verifier({ objectPaths: { migration: [MIG_A, MIG_B, MIG_DUP] } });
  assert.deepEqual(pick(v.verify(ref('migration', MIG_A_OID, '15'))), ['INVALID', 'E_APPROVAL_SCOPE_AMBIGUOUS']);
  const b = v.verify(ref('migration', MIG_B_OID, '13'));
  assert.equal(b.status, 'VERIFIED');
  assert.equal(b.facts.path, MIG_B);
  const none = verifier({ objectPaths: { migration: [MIG_B] } });
  assert.deepEqual(pick(none.verify(ref('migration', MIG_A_OID, '15'))), ['STALE', 'E_APPROVAL_STALE']);
  // A Git L1 failure on any listed path decides the result, even when another path matches.
  const broken = verifier({ objectPaths: { migration: [MIG_B, 'migrations/9999_missing.sql'] } });
  assert.deepEqual(pick(broken.verify(ref('migration', MIG_B_OID, '13'))), ['INVALID', 'E_APPROVAL_PATH_MISSING']);
});

// ---------------------------------------------------------------- resolver failures

test('resolver: exceptions, malformed answers and unknown codes are ERROR, never VERIFIED', () => {
  const real = createGitObjectResolver({ repoRoot: repo.dir });
  const cases = [
    [() => { throw new Error('boom /secret/path'); }, 'E_APPROVAL_RESOLVER_THREW'],
    [() => null, 'E_APPROVAL_RESOLVER_MALFORMED'],
    [() => ({ ok: 'true' }), 'E_APPROVAL_RESOLVER_MALFORMED'],
    [(c, p) => ({ ...real.resolveRegularBlob(c, p), commit: C1 }), 'E_APPROVAL_RESOLVER_MALFORMED'],
    [(c, p) => ({ ...real.resolveRegularBlob(c, p), path: LOCK }), 'E_APPROVAL_RESOLVER_MALFORMED'],
    [(c, p) => ({ ...real.resolveRegularBlob(c, p), mode: '120000' }), 'E_APPROVAL_RESOLVER_MALFORMED'],
    [(c, p) => ({ ...real.resolveRegularBlob(c, p), oid: 'abc' }), 'E_APPROVAL_RESOLVER_MALFORMED'],
    [() => ({ ok: false, code: 'E_GIT_SOMETHING_NEW' }), 'E_APPROVAL_RESOLVER_UNKNOWN_CODE'],
    [() => ({ ok: false, code: 'E_GIT_FAILED', stderr: 'secret' }), 'E_APPROVAL_GIT_FAILED'],
    [() => ({ ok: false, code: 'E_GIT_OUTPUT_INVALID' }), 'E_APPROVAL_GIT_OUTPUT_INVALID'],
    [() => ({ ok: false, code: 'E_GIT_PATH_MISMATCH' }), 'E_APPROVAL_PATH_MISMATCH'],
    [() => ({ ok: false, code: 'E_GIT_OBJECT_MISSING' }), 'E_APPROVAL_OBJECT_UNAVAILABLE'],
  ];
  for (const [answer, code] of cases) {
    const { resolver } = stubResolver(answer);
    const r = verifier({ resolver }).verify(specRef());
    assert.deepEqual(r, { status: 'ERROR', code, approval_type: 'spec' });
    assert.ok(!JSON.stringify(r).includes('secret'));
  }
});

test('resolver: no Git access happens before the T0 and context checks pass', () => {
  const { calls, resolver } = stubResolver(() => { throw new Error('must not be called'); });
  const v = verifier({ resolver });
  v.verify({ ...specRef(), pr_number: 8 });
  v.verify({ ...specRef(), extra: 1 });
  verifier({ resolver, approverIds: [] }).verify(specRef());
  verifier({ resolver, approvalSnapshot: undefined }).verify(specRef());
  v.verify(specRef(SPEC_V2, '999'));
  assert.equal(calls.length, 0);
  const real = createGitObjectResolver({ repoRoot: repo.dir });
  const spy = stubResolver((c, p) => real.resolveRegularBlob(c, p));
  assert.equal(verifier({ resolver: spy.resolver }).verify(specRef()).status, 'VERIFIED');
  assert.deepEqual(spy.calls, [[C2, SPEC]]);
});

// ---------------------------------------------------------------- trusted context validation (T1)

test('context: malformed trusted context throws TypeError at construction', () => {
  const bad = [
    { repoRoot: '' }, { repositoryId: 0 }, { repositoryId: '1001' }, { prNumber: 0 }, { prNumber: 1_000_001 },
    { expectedCommit: C2.slice(0, 7) }, { expectedCommit: C2.toUpperCase() }, { approverIds: 501 }, { approverIds: ['501'] },
    { approverIds: [0] }, { objectPaths: 'x' }, { objectPaths: { spec: '../x.md' } }, { objectPaths: { spec: '.git/config' } },
    { objectPaths: { spec: 'docs/CON.md' } }, { objectPaths: { migration: MIG_A } }, { objectPaths: { migration: [MIG_A, MIG_A] } },
    { approvalSnapshot: {} }, { approvalSnapshot: { ...snapshot(), envelope: 'hlg.approval-snapshot.v2' } },
    { approvalSnapshot: { ...snapshot(), repository: { id: '1001' } } }, { approvalSnapshot: { ...snapshot(), pull_request: { number: PR, head_sha: 'x' } } },
    { approvalSnapshot: { ...snapshot(), comments: {} } }, { approvalSnapshot: { ...snapshot(), comments: [comment(11, 'x')] } },
    { approvalSnapshot: { ...snapshot(), comments: [comment('11', 'x', { author_id: '501' })] } },
    { approvalSnapshot: { ...snapshot(), comments: [comment('11', 'x', { kind: '' })] } },
    { approvalSnapshot: { ...snapshot(), comments: [comment('11', 5)] } },
    { approvalSnapshot: { ...snapshot(), freshness: 'complete' } },
    { approvalSnapshot: { ...snapshot(), merge: { merged: 'yes', head_sha: null, merge_commit_sha: null, merged_by_id: null } } },
    { approvalSnapshot: '{"envelope":"hlg.approval-snapshot.v1"}' },
    { resolver: {} },
  ];
  for (const over of bad) assert.throws(() => verifier(over), TypeError, JSON.stringify(over));
});

test('context: unknown constructor options (for example provenance labels) confer nothing', () => {
  const v = verifier({ provenance: 'trusted_infrastructure', approvers: { ids: [OTHER_ID], provenance: 'trusted_base_ref' } });
  const r = v.verify(specRef());
  assert.equal(r.status, 'VERIFIED');
  assert.ok(!JSON.stringify(r).includes('provenance'));
  const noIds = verifier({ approverIds: [], approvers: { ids: [OWNER_ID], provenance: 'trusted_infrastructure' } });
  assert.deepEqual(pick(noIds.verify(specRef())), ['UNVERIFIABLE', 'E_APPROVAL_ALLOWLIST_UNAVAILABLE']);
});

// ---------------------------------------------------------------- determinism and immutability

test('determinism: repeated verification gives deep-equal, independent results', () => {
  const v = verifier();
  const refs = [specRef(), specRef(SPEC_V1, '14'), ref('migration', MIG_B_OID, '13'), { ...specRef(), pr_number: 8 }];
  for (const r of refs) {
    const a = v.verify(r);
    const b = v.verify(r);
    const c = verifier().verify(r);
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
    if (a.facts) assert.notEqual(a.facts, b.facts);
  }
});

test('immutability: results are deeply frozen; caller inputs are copied and never modified', () => {
  const approverIds = [OWNER_ID];
  const objectPaths = { spec: SPEC, migration: [MIG_A, MIG_B] };
  const snap = snapshot();
  const v = verifier({ approverIds, objectPaths, approvalSnapshot: snap });
  const r0 = specRef();
  const before = JSON.stringify(r0);
  const r = v.verify(r0);
  assert.equal(JSON.stringify(r0), before);
  assert.ok(!Object.isFrozen(r0));
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.facts));
  assert.throws(() => { r.facts.path = 'x'; }, TypeError);
  assert.throws(() => { r.status = 'INVALID'; }, TypeError);
  // Mutating trusted inputs after construction has no effect.
  approverIds.length = 0;
  objectPaths.spec = MIG_A;
  snap.comments[0].body = 'LGTM';
  snap.freshness.complete = false;
  snap.pull_request.head_sha = C1;
  assert.deepEqual(v.verify(specRef()), r);
});

// ---------------------------------------------------------------- no authority

function allKeys(value, out = []) {
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

test('authority: a synthetic fixture VERIFIED carries no authorization, identity or provenance claim', () => {
  const v = verifier({ approvalSnapshot: snapshot({ merge: { merged: true, head_sha: C2, merge_commit_sha: C1, merged_by_id: OWNER_ID } }) });
  const results = [
    v.verify(specRef()),
    v.verify(ref('package_change', LOCK_OID, '12')),
    v.verify({ approval_type: 'merge', source: 'github_merge', pr_number: PR, source_id: null, object_sha: C2 }),
  ];
  const all = v.verifyAll([specRef(), ref('migration', MIG_B_OID, '13')]);
  assert.equal(all.status, 'VERIFIED');
  for (const r of [...results, all]) {
    const keys = allKeys(r);
    for (const k of keys) {
      assert.ok(!/authori|permit|allow|human|approved_by|merge_ok|deploy|migrat(e|ion)_ok|provenance|trusted/i.test(k), `unexpected key ${k}`);
    }
    assert.ok(!keys.some((k) => typeof r[k] === 'function'));
  }
  assert.deepEqual(Object.keys(results[0]), ['status', 'code', 'approval_type', 'facts']);
  assert.deepEqual(Object.keys(results[0].facts).sort(), ['approval_type', 'object_sha', 'path', 'pr_number', 'source', 'source_author_id', 'source_id']);
});

// ---------------------------------------------------------------- verifyAll

const VERIFIED_REF = () => specRef();
const STALE_REF = () => specRef(SPEC_V1, '14');
const INVALID_REF = () => ({ ...specRef(), pr_number: 8 });
const UNVERIFIABLE_REF = () => ({ approval_type: 'production', source: 'github_environment_review', pr_number: PR, source_id: null, object_sha: C2 });
const ERROR_REF = () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
};

test('verifyAll: precedence ERROR > INVALID > UNVERIFIABLE > STALE > VERIFIED; empty is never VERIFIED', () => {
  const v = verifier();
  const empty = v.verifyAll([]);
  assert.deepEqual([empty.status, empty.code, empty.results.length], ['UNVERIFIABLE', 'E_APPROVAL_NONE', 0]);
  assert.equal(v.verifyAll([VERIFIED_REF()]).status, 'VERIFIED');
  assert.equal(v.verifyAll([VERIFIED_REF(), STALE_REF()]).status, 'STALE');
  assert.equal(v.verifyAll([STALE_REF(), UNVERIFIABLE_REF()]).status, 'UNVERIFIABLE');
  assert.equal(v.verifyAll([UNVERIFIABLE_REF(), INVALID_REF()]).status, 'INVALID');
  const mixed = v.verifyAll([VERIFIED_REF(), STALE_REF(), UNVERIFIABLE_REF(), INVALID_REF(), ERROR_REF()]);
  assert.equal(mixed.status, 'ERROR');
  assert.deepEqual({ ...mixed.counts }, { VERIFIED: 1, STALE: 1, UNVERIFIABLE: 1, INVALID: 1, ERROR: 1 });
  assert.deepEqual(mixed.results.map((r) => r.status), ['VERIFIED', 'STALE', 'UNVERIFIABLE', 'INVALID', 'ERROR']);
  assert.ok(Object.isFrozen(mixed) && Object.isFrozen(mixed.results) && Object.isFrozen(mixed.counts));
});

test('verifyAll: randomized aggregate invariant', () => {
  const v = verifier();
  const makers = [VERIFIED_REF, STALE_REF, INVALID_REF, UNVERIFIABLE_REF, ERROR_REF, null];
  const rank = { VERIFIED: 0, STALE: 1, UNVERIFIABLE: 2, INVALID: 3, ERROR: 4 };
  let seed = 0x5eed;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let round = 0; round < 150; round++) {
    const length = rand(6);
    const refs = [];
    refs.length = length;
    for (let i = 0; i < length; i++) {
      const make = makers[rand(makers.length)];
      if (make) refs[i] = make();
    }
    const r = v.verifyAll(refs);
    assert.equal(r.results.length, length);
    const statuses = r.results.map((x) => x.status);
    const expected = length === 0 ? 'UNVERIFIABLE' : statuses.reduce((a, s) => (rank[s] > rank[a] ? s : a), 'VERIFIED');
    assert.equal(r.status, expected, JSON.stringify(statuses));
    if (r.status === 'VERIFIED') assert.ok(length > 0 && statuses.every((s) => s === 'VERIFIED'));
  }
});

test('verifyAll: malformed collections, limits, sparse arrays and proxies fail closed', () => {
  const v = verifier();
  const rejected = (r, code) => {
    assert.deepEqual([r.status, r.code, r.results.length], ['ERROR', code, 0]);
    assert.ok(Object.isFrozen(r));
  };
  for (const bad of [undefined, null, {}, 'refs', { length: 1, 0: VERIFIED_REF() }]) rejected(v.verifyAll(bad), 'E_APPROVAL_COLLECTION_INVALID');
  for (const length of [-1, NaN, undefined, null, 'abc', 1.5, Infinity]) {
    rejected(v.verifyAll(new Proxy([INVALID_REF()], { get: (t, k) => (k === 'length' ? length : t[k]) })), 'E_APPROVAL_COLLECTION_INVALID');
  }
  rejected(v.verifyAll(new Proxy([], { get: (t, k) => (k === 'length' ? MAX_REFS + 1 : t[k]) })), 'E_APPROVAL_COLLECTION_TOO_LARGE');
  rejected(v.verifyAll(new Array(2 ** 32 - 1)), 'E_APPROVAL_COLLECTION_TOO_LARGE');
  const { proxy, revoke } = Proxy.revocable([VERIFIED_REF()], {});
  revoke();
  rejected(v.verifyAll(proxy), 'E_APPROVAL_COLLECTION_UNREADABLE');
  const sparse = v.verifyAll([VERIFIED_REF(), , VERIFIED_REF()]); // eslint-disable-line no-sparse-arrays
  assert.equal(sparse.status, 'INVALID');
  assert.deepEqual(pick(sparse.results[1]), ['INVALID', 'E_APPROVAL_REF_MISSING']);
  const refs = [VERIFIED_REF()];
  refs[Symbol.iterator] = function* fake() { yield INVALID_REF(); };
  assert.equal(v.verifyAll(refs).status, 'VERIFIED');
  const throwingIndex = new Proxy([VERIFIED_REF(), VERIFIED_REF()], {
    getOwnPropertyDescriptor(t, k) {
      if (k === '1') throw new Error('trap');
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
  });
  const t = v.verifyAll(throwingIndex);
  assert.deepEqual(t.results.map((x) => x.code), [null, 'E_APPROVAL_REF_UNREADABLE']);
  assert.equal(t.status, 'ERROR');
  const full = v.verifyAll(Array.from({ length: 3 }, VERIFIED_REF));
  assert.equal(full.counts.VERIFIED, 3);
});

// ---------------------------------------------------------------- SEC-A3.5c-01: accessor elements

test('SEC-A3.5c-01: collection element accessors are never executed and fail closed', () => {
  const v = verifier();
  const log = [];
  const refs = [];
  // Getter returning a valid ApprovalRef.
  Object.defineProperty(refs, 0, { enumerable: true, get: () => { log.push('valid'); return specRef(); } });
  // Getter with side effects.
  Object.defineProperty(refs, 1, { enumerable: true, get: () => { log.push('side'); globalThis.__approvalSideEffect = true; return specRef(); } });
  // Getter that throws.
  Object.defineProperty(refs, 2, { enumerable: true, get: () => { log.push('throw'); throw new Error('boom'); } });
  // Setter-only descriptor.
  Object.defineProperty(refs, 3, { enumerable: true, set: () => { log.push('set'); } });
  const r = v.verifyAll(refs);
  assert.deepEqual(log, [], 'no accessor function may run');
  assert.equal(globalThis.__approvalSideEffect, undefined);
  assert.deepEqual(r.results.map((x) => [x.status, x.code]), [
    ['INVALID', 'E_APPROVAL_REF_NOT_DATA'],
    ['INVALID', 'E_APPROVAL_REF_NOT_DATA'],
    ['INVALID', 'E_APPROVAL_REF_NOT_DATA'],
    ['INVALID', 'E_APPROVAL_REF_NOT_DATA'],
  ]);
  assert.equal(r.status, 'INVALID');
});

test('SEC-A3.5c-01: a mixed collection with valid refs and an accessor never aggregates to VERIFIED', () => {
  const v = verifier();
  let calls = 0;
  const refs = [specRef(), ref('migration', MIG_B_OID, '13')];
  Object.defineProperty(refs, 2, { enumerable: true, get: () => { calls++; return specRef(); } });
  refs.push(ref('package_change', LOCK_OID, '12'));
  const r = v.verifyAll(refs);
  assert.equal(calls, 0);
  assert.notEqual(r.status, 'VERIFIED');
  assert.equal(r.status, 'INVALID');
  assert.deepEqual(r.results.map((x) => x.status), ['VERIFIED', 'VERIFIED', 'INVALID', 'VERIFIED']);
  assert.deepEqual({ ...r.counts }, { VERIFIED: 3, STALE: 0, UNVERIFIABLE: 0, INVALID: 1, ERROR: 0 });
  // Precedence is unchanged: an ERROR element still wins over the accessor's INVALID.
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  const withError = [proxy];
  Object.defineProperty(withError, 1, { enumerable: true, get: () => { calls++; return specRef(); } });
  assert.equal(v.verifyAll(withError).status, 'ERROR');
  assert.equal(calls, 0);
});

test('SEC-A3.5c-01: a Proxy collection reporting an accessor descriptor never runs its getter', () => {
  const v = verifier();
  let calls = 0;
  const target = [specRef()];
  const px = new Proxy(target, {
    getOwnPropertyDescriptor(t, k) {
      if (k === '0') return { get: () => { calls++; return specRef(); }, enumerable: true, configurable: true };
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
  });
  const r = v.verifyAll(px);
  assert.equal(calls, 0);
  assert.deepEqual(pick(r.results[0]), ['INVALID', 'E_APPROVAL_REF_NOT_DATA']);
  assert.equal(r.status, 'INVALID');
});
