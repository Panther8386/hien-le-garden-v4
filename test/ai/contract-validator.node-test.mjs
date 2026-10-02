// Tests for the contract validator and CLI (A3.3b, ADR-AI-007).
//
//   node --test "test/ai/*.node-test.mjs"
//
// Named *.node-test.mjs so Vitest never runs it in workerd. CLI tests use an OS temp
// directory that is removed afterwards; nothing is written inside the repository.
// Escape sequences are built at runtime (BS/CR/LF) so the source contains no literal
// backslash escapes for JSON test data.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_ARTIFACT_BYTES,
  MAX_ERRORS,
  createContractValidator,
  findDuplicateKey,
  runCli,
} from '../../scripts/ai/validate-contract.mjs';

const BS = String.fromCharCode(92);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

const CLI = fileURLToPath(new URL('../../scripts/ai/validate-contract.mjs', import.meta.url));
const VALIDATOR_SOURCE = readFileSync(CLI, 'utf8');
const EXAMPLE_DIR = new URL('../../docs/ai/contracts/examples/v1/', import.meta.url);
const EXAMPLES = {
  TaskSpec: 'task-spec.example.json',
  ImplementationReport: 'implementation-report.example.json',
  CodeReviewReport: 'code-review-report.example.json',
  SecurityReviewReport: 'security-review-report.example.json',
  SEOReviewReport: 'seo-review-report.example.json',
  EvalReport: 'eval-report.example.json',
  GateDecision: 'gate-decision.example.json',
};

const exampleText = (type) => readFileSync(new URL(EXAMPLES[type], EXAMPLE_DIR), 'utf8');
const exampleObject = (type) => JSON.parse(exampleText(type));
const bytes = (text) => new TextEncoder().encode(text);

const validator = createContractValidator();
const vBytes = (text) => validator.validateContractBytes(bytes(text));

function replaceOnce(text, from, to) {
  assert.ok(text.includes(from), `fixture anchor not found: ${from}`);
  return text.replace(from, to);
}

const tmp = mkdtempSync(path.join(tmpdir(), 'hlg-contract-cli-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function runNode(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function oneJsonLine(stdout) {
  const lines = stdout.split(LF).filter((l) => l !== '');
  assert.equal(lines.length, 1, `expected exactly one stdout line, got ${lines.length}`);
  return JSON.parse(lines[0]);
}

// ---------------------------------------------------------------- valid input

for (const type of Object.keys(EXAMPLES)) {
  test(`valid: ${type} example as bytes`, () => {
    const r = validator.validateContractBytes(readFileSync(new URL(EXAMPLES[type], EXAMPLE_DIR)));
    assert.equal(r.ok, true);
    assert.equal(r.artifactType, type);
    assert.equal(r.schemaVersion, 1);
    assert.equal(typeof r.value, 'object');
  });
}

test('valid: in-memory object and result shapes', () => {
  const ok = validator.validateContract(exampleObject('TaskSpec'));
  assert.deepEqual(Object.keys(ok), ['ok', 'artifactType', 'schemaVersion', 'value']);
  const bad = validator.validateContract([]);
  assert.deepEqual(Object.keys(bad), ['ok', 'code', 'errorCount', 'errors']);
  assert.deepEqual(bad, { ok: false, code: 'E_NOT_OBJECT', errorCount: 0, errors: [] });
});

test('valid: null-prototype root object is accepted', () => {
  const src = exampleObject('TaskSpec');
  const o = Object.create(null);
  for (const k of Object.keys(src)) o[k] = src[k];
  assert.equal(validator.validateContract(o).ok, true);
});

test('validator object is frozen and schemas compile exactly once', async () => {
  const { compileContractSchemas } = await import('../../scripts/ai/contract-schemas.mjs');
  let calls = 0;
  const v = createContractValidator({ compile: () => { calls++; return compileContractSchemas(); } });
  assert.ok(Object.isFrozen(v));
  v.validateContractBytes(bytes(exampleText('TaskSpec')));
  v.validateContractBytes(bytes(exampleText('GateDecision')));
  assert.equal(calls, 1);
});

test('createContractValidator throws on an internal compile fault', () => {
  assert.throws(() => createContractValidator({ compile: () => { throw new Error('schema fault'); } }), /schema fault/);
});

// ---------------------------------------------------------------- byte boundary

test('bytes: MAX_ARTIFACT_BYTES is exactly 2 MiB', () => {
  assert.equal(MAX_ARTIFACT_BYTES, 2097152);
  assert.equal(MAX_ERRORS, 20);
});

test('bytes: more than 2 MiB is E_TOO_LARGE (checked before decoding)', () => {
  const big = new Uint8Array(MAX_ARTIFACT_BYTES + 1); // all NUL: size must win over encoding
  assert.equal(validator.validateContractBytes(big).code, 'E_TOO_LARGE');
});

test('bytes: exactly 2 MiB passes the size stage', () => {
  const head = '{"pad":"';
  const tail = '"}';
  const text = head + 'x'.repeat(MAX_ARTIFACT_BYTES - head.length - tail.length) + tail;
  assert.equal(bytes(text).length, MAX_ARTIFACT_BYTES);
  assert.equal(vBytes(text).code, 'E_UNSUPPORTED_VERSION');
});

test('bytes: UTF-8 BOM is E_ENCODING', () => {
  const body = bytes(exampleText('TaskSpec'));
  const withBom = new Uint8Array(body.length + 3);
  withBom.set([0xef, 0xbb, 0xbf]);
  withBom.set(body, 3);
  assert.equal(validator.validateContractBytes(withBom).code, 'E_ENCODING');
});

test('bytes: invalid UTF-8 is E_ENCODING', () => {
  assert.equal(validator.validateContractBytes(Uint8Array.from([0x7b, 0xc3, 0x28, 0x7d])).code, 'E_ENCODING');
});

test('bytes: UTF-16LE input is E_ENCODING', () => {
  assert.equal(validator.validateContractBytes(Buffer.from(exampleText('TaskSpec'), 'utf16le')).code, 'E_ENCODING');
});

test('bytes: raw NUL byte is E_ENCODING', () => {
  assert.equal(validator.validateContractBytes(Uint8Array.from([0x7b, 0x00, 0x7d])).code, 'E_ENCODING');
});

test('bytes: unsupported API input type throws TypeError', () => {
  assert.throws(() => validator.validateContractBytes('{}'), TypeError);
  assert.throws(() => validator.validateContractBytes(new ArrayBuffer(2)), TypeError);
  assert.throws(() => validator.validateContractBytes(null), TypeError);
});

// ---------------------------------------------------------------- parse

test('parse: malformed JSON, trailing data and empty bytes are E_JSON_PARSE', () => {
  assert.equal(vBytes('{"a":').code, 'E_JSON_PARSE');
  assert.equal(vBytes('{} {}').code, 'E_JSON_PARSE');
  assert.equal(validator.validateContractBytes(new Uint8Array(0)).code, 'E_JSON_PARSE');
});

// ---------------------------------------------------------------- duplicate keys

test('duplicates: duplicate top-level artifact_type is E_DUPLICATE_KEY', () => {
  const text = '{"artifact_type":"GateDecision",' + exampleText('TaskSpec').slice(1);
  const r = vBytes(text);
  assert.equal(r.code, 'E_DUPLICATE_KEY');
  assert.deepEqual(r.errors, [{ path: '', keyword: 'duplicateKey' }]);
});

test('duplicates: nested duplicate reports the enclosing object path', () => {
  const text = replaceOnce(exampleText('TaskSpec'), '"scope": {', '"scope": { "forbidden_paths": [],');
  const r = vBytes(text);
  assert.equal(r.code, 'E_DUPLICATE_KEY');
  assert.equal(r.errors[0].path, '/scope');
});

test('duplicates: duplicate inside an object in an array', () => {
  const text = replaceOnce(exampleText('TaskSpec'), '{ "id": "R-01",', '{ "id": "R-09", "id": "R-01",');
  const r = vBytes(text);
  assert.equal(r.code, 'E_DUPLICATE_KEY');
  assert.equal(r.errors[0].path, '/requirements/0');
});

test('duplicates: escaped-equivalent keys collide ("a" vs escaped a)', () => {
  const text = '{"a":1,"' + BS + 'u0061":2}';
  assert.equal(JSON.parse(text).a, 2); // JSON.parse alone silently keeps the last value
  assert.deepEqual(findDuplicateKey(text), { path: '' });
  assert.equal(vBytes(text).code, 'E_DUPLICATE_KEY');
});

test('duplicates: duplicate key name is never returned', () => {
  const text = '{"secret_sk-ABC123":1,"secret_sk-ABC123":2}';
  const r = vBytes(text);
  assert.equal(r.code, 'E_DUPLICATE_KEY');
  assert.ok(!JSON.stringify(r).includes('secret'));
});

test('duplicates: not a duplicate', () => {
  assert.equal(findDuplicateKey('{"x":{"a":1},"y":{"a":2},"z":[{"a":1},{"a":2}]}'), null);
  assert.equal(findDuplicateKey('{"a":"a","b":"' + BS + '"a' + BS + '":1"}'), null);
  assert.equal(findDuplicateKey('{"a":"{,}[]:","b":"x' + BS + BS + '","c":1}'), null);
  assert.equal(findDuplicateKey('{"k' + BS + '"ey":1,"k":2}'), null);
  assert.equal(findDuplicateKey('[1,"a",{"a":[{"a":{}}]}]'), null);
});

// ---------------------------------------------------------------- root model

test('root: non-object roots are E_NOT_OBJECT', () => {
  for (const text of ['[]', 'null', '"s"', '1', 'true']) assert.equal(vBytes(text).code, 'E_NOT_OBJECT', text);
});

test('root: class instance is E_NOT_OBJECT', () => {
  class Artifact {
    constructor() {
      Object.assign(this, exampleObject('TaskSpec'));
    }
  }
  assert.equal(validator.validateContract(new Artifact()).code, 'E_NOT_OBJECT');
});

// ---------------------------------------------------------------- dispatch

test('dispatch: unsupported schema_version', () => {
  const set = (v) => {
    const o = exampleObject('TaskSpec');
    o.schema_version = v;
    return validator.validateContract(o).code;
  };
  assert.equal(set(2), 'E_UNSUPPORTED_VERSION');
  assert.equal(set('1'), 'E_UNSUPPORTED_VERSION');
  assert.equal(set(1.5), 'E_UNSUPPORTED_VERSION');
  const missing = exampleObject('TaskSpec');
  delete missing.schema_version;
  assert.equal(validator.validateContract(missing).code, 'E_UNSUPPORTED_VERSION');
});

test('dispatch: inherited-only schema_version is not accepted (Object.hasOwn)', () => {
  const o = exampleObject('TaskSpec');
  delete o.schema_version;
  Object.prototype.schema_version = 1;
  try {
    assert.equal(o.schema_version, 1);
    assert.equal(validator.validateContract(o).code, 'E_UNSUPPORTED_VERSION');
  } finally {
    delete Object.prototype.schema_version;
  }
});

test('dispatch: unknown artifact_type (including prototype names) is E_UNKNOWN_TYPE', () => {
  for (const t of ['Unknown', 'constructor', '__proto__', 'toString', 7, null]) {
    const o = exampleObject('TaskSpec');
    o.artifact_type = t;
    assert.equal(validator.validateContract(o).code, 'E_UNKNOWN_TYPE', String(t));
  }
  const missing = exampleObject('TaskSpec');
  delete missing.artifact_type;
  assert.equal(validator.validateContract(missing).code, 'E_UNKNOWN_TYPE');
});

// ---------------------------------------------------------------- schema + reserved keys

test('schema: ordinary schema-invalid artifact is E_SCHEMA_INVALID with sanitized errors', () => {
  const o = exampleObject('TaskSpec');
  o.max_iterations = 99;
  const r = validator.validateContract(o);
  assert.equal(r.code, 'E_SCHEMA_INVALID');
  assert.deepEqual(r.errors, [{ path: '/max_iterations', keyword: 'maximum' }]);
  assert.equal(r.errorCount, 1);
});

test('schema: reserved names are rejected by closed schemas without polluting prototypes', () => {
  const protoNames = Object.getOwnPropertyNames(Object.prototype).sort();
  const cases = [];
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    cases.push(['TaskSpec top level', '{"' + key + '":{"polluted":true},' + exampleText('TaskSpec').slice(1)]);
    cases.push([
      'Finding',
      replaceOnce(exampleText('SecurityReviewReport'), '"finding_id": "F-001",', '"' + key + '": {"polluted":true}, "finding_id": "F-001",'),
    ]);
    cases.push([
      'EvidenceRef',
      replaceOnce(exampleText('ImplementationReport'), '"kind": "repo_line",', '"' + key + '": {"polluted":true}, "kind": "repo_line",'),
    ]);
  }
  for (const [where, text] of cases) {
    const r = vBytes(text);
    assert.equal(r.code, 'E_SCHEMA_INVALID', where);
    assert.ok(r.errors.some((e) => e.keyword === 'additionalProperties'), where);
  }
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), protoNames);
});

// ---------------------------------------------------------------- error sanitization

test('sanitization: no artifact key names or values in errors', () => {
  const o = exampleObject('TaskSpec');
  o['secret_sk-ABC123'] = 'value-should-not-leak';
  o.scope.allowed_paths = ['/etc/passwd'];
  const r = vBytes(JSON.stringify(o));
  assert.equal(r.code, 'E_SCHEMA_INVALID');
  const out = JSON.stringify(r);
  for (const leak of ['secret', 'sk-ABC123', 'value-should-not-leak', 'passwd']) assert.ok(!out.includes(leak), leak);
  for (const e of r.errors) assert.deepEqual(Object.keys(e), ['path', 'keyword']);
});

test('sanitization: deterministic order, cap of 20, total errorCount kept', () => {
  const o = exampleObject('TaskSpec');
  o.requirements = Array.from({ length: 50 }, () => ({ id: 'bad', text: 't' }));
  const a = validator.validateContract(o);
  const b = validator.validateContract(structuredClone(o));
  assert.deepEqual(a, b);
  assert.equal(a.errorCount, 50);
  assert.equal(a.errors.length, MAX_ERRORS);
  const keys = a.errors.map((e) => `${e.path} ${e.keyword}`);
  assert.deepEqual(keys, [...keys].sort());
});

// ---------------------------------------------------------------- no canonical byte rule

test('equivalent JSON formatting is accepted (no canonical byte requirement)', () => {
  const o = exampleObject('GateDecision');
  const reversed = Object.fromEntries(Object.entries(o).reverse());
  for (const text of [
    JSON.stringify(o),
    JSON.stringify(o, null, 4),
    JSON.stringify(reversed, null, 2),
    JSON.stringify(o, null, 2).split(LF).join(CR + LF),
  ]) {
    assert.equal(vBytes(text).ok, true);
  }
});

// ---------------------------------------------------------------- CLI (spawned)

const validFile = path.join(tmp, 'valid.json');
const invalidFile = path.join(tmp, 'invalid.json');
writeFileSync(validFile, exampleText('TaskSpec'));
writeFileSync(invalidFile, JSON.stringify({ ...exampleObject('TaskSpec'), extra: 1 }));

test('cli: valid file exits 0 with one JSON line and empty stderr', () => {
  const r = runNode([validFile]);
  assert.equal(r.status, 0);
  assert.deepEqual(oneJsonLine(r.stdout), { ok: true, artifact_type: 'TaskSpec', schema_version: 1 });
  assert.equal(r.stderr, '');
});

test('cli: invalid artifact exits 1 with one JSON line and empty stderr', () => {
  const r = runNode([invalidFile]);
  assert.equal(r.status, 1);
  const out = oneJsonLine(r.stdout);
  assert.equal(out.code, 'E_SCHEMA_INVALID');
  assert.equal(r.stderr, '');
});

test('cli: oversize file exits 1 with E_TOO_LARGE', () => {
  const big = path.join(tmp, 'big.json');
  writeFileSync(big, Buffer.alloc(MAX_ARTIFACT_BYTES + 1, 0x20));
  const r = runNode([big]);
  assert.equal(r.status, 1);
  assert.equal(oneJsonLine(r.stdout).code, 'E_TOO_LARGE');
});

test('cli: missing file and directory exit 2 with E_IO', () => {
  for (const target of [path.join(tmp, 'missing.json'), tmp]) {
    const r = runNode([target]);
    assert.equal(r.status, 2, target);
    assert.equal(oneJsonLine(r.stdout).code, 'E_IO');
  }
});

test('cli: usage errors exit 2 with E_USAGE', () => {
  for (const args of [[], [validFile, validFile], ['-x']]) {
    const r = runNode(args);
    assert.equal(r.status, 2, JSON.stringify(args));
    assert.equal(oneJsonLine(r.stdout).code, 'E_USAGE');
  }
});

test('cli: symlink exits 2 with E_IO', (t) => {
  const link = path.join(tmp, 'link.json');
  try {
    symlinkSync(validFile, link);
  } catch (err) {
    if (process.platform === 'win32' && err.code === 'EPERM') {
      t.skip('symlink creation requires privilege on this Windows host');
      return;
    }
    throw err;
  }
  const r = runNode([link]);
  assert.equal(r.status, 2);
  assert.equal(oneJsonLine(r.stdout).code, 'E_IO');
});

test('cli: all seven examples exit 0', () => {
  for (const file of Object.values(EXAMPLES)) {
    const r = runNode([fileURLToPath(new URL(file, EXAMPLE_DIR))]);
    assert.equal(r.status, 0, file);
  }
});

test('cli: internal validator fault exits 3 with E_INTERNAL (in process)', () => {
  const r = runCli([validFile], { createValidator: () => { throw new Error('schema fault'); } });
  assert.equal(r.exitCode, 3);
  assert.deepEqual(oneJsonLine(r.stdout), { ok: false, code: 'E_INTERNAL' });
  assert.match(r.stderr, /internal error: schema fault/);
});

// ---------------------------------------------------------------- import / network invariant

test('validator imports only node:fs, node:path, node:url and the trusted loader', () => {
  const specifiers = [...VALIDATOR_SOURCE.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual([...specifiers].sort(), ['./contract-schemas.mjs', 'node:fs', 'node:path', 'node:url']);
  for (const forbidden of ['node:http', 'node:https', 'node:net', 'node:tls', 'node:child_process', 'fetch(', 'loadSchema', 'import(', 'new Ajv', "from 'ajv"]) {
    assert.ok(!VALIDATOR_SOURCE.includes(forbidden), forbidden);
  }
});
