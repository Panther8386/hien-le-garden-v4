#!/usr/bin/env node
// Validator and CLI for V1 HLG AI engineering contracts (ADR-AI-004, ADR-AI-007).
//
//   node scripts/ai/validate-contract.mjs <file>
//
// Pipeline for untrusted bytes (ADR-AI-007), in this order:
//   byte length (<= MAX_ARTIFACT_BYTES) -> no UTF-8 BOM -> no NUL byte -> fatal UTF-8
//   decode -> JSON.parse -> duplicate-key scan -> root object -> schema_version ->
//   artifact_type -> compiled schema from scripts/ai/contract-schemas.mjs (the only
//   schema source; the artifact never selects a path, $id, URL or module).
//
// Structural validity only: not proof of SHA freshness, evidence truth, approval
// authenticity or a gate decision (ADR-AI-005, ADR-AI-006).
//
// stdout: exactly one JSON line. Errors carry only a sanitized JSON path and the Ajv
// keyword, never artifact values or property names.
// Exit: 0 valid, 1 invalid artifact, 2 usage or file I/O, 3 internal validator fault.
// Requires installed devDependencies (ajv); without them Node fails before this runs.

import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION, compileContractSchemas } from './contract-schemas.mjs';

export const MAX_ARTIFACT_BYTES = 2_097_152;
export const MAX_ERRORS = 20;

const BACKSLASH = String.fromCharCode(92);
const SAFE_PATH = /^[A-Za-z0-9_/~-]{0,200}$/;

function failure(code, errors = []) {
  return { ok: false, code, errorCount: errors.length, errors: errors.slice(0, MAX_ERRORS) };
}

function sanitizePath(p) {
  return typeof p === 'string' && SAFE_PATH.test(p) ? p : '<redacted>';
}

function pointerSegment(seg) {
  return String(seg).replaceAll('~', '~0').replaceAll('/', '~1');
}

// Duplicate-key scan over text that JSON.parse has already accepted, so every string
// and container is well formed. Iterative (explicit stack), skips string contents, and
// decodes each key with JSON.parse so escaped-equivalent keys collide. Returns
// { path } (sanitized JSON pointer of the object holding the duplicate) or null; the
// key itself is never returned.
export function findDuplicateKey(text) {
  const stack = []; // { type: 'object', keys: Set, expectKey, key } | { type: 'array', index }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === BACKSLASH ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && top.type === 'object' && top.expectKey) {
        const key = JSON.parse(text.slice(i, j + 1));
        if (top.keys.has(key)) {
          const segments = stack.slice(0, -1).map((f) => (f.type === 'object' ? f.key : f.index));
          return { path: sanitizePath(segments.map((s) => '/' + pointerSegment(s)).join('')) };
        }
        top.keys.add(key);
        top.key = key;
        top.expectKey = false;
      }
      i = j;
    } else if (ch === '{') {
      stack.push({ type: 'object', keys: new Set(), expectKey: true, key: null });
    } else if (ch === '[') {
      stack.push({ type: 'array', index: 0 });
    } else if (ch === '}' || ch === ']') {
      stack.pop();
    } else if (ch === ',') {
      const top = stack[stack.length - 1];
      if (top.type === 'object') top.expectKey = true;
      else top.index++;
    }
  }
  return null;
}

function normalizeErrors(ajvErrors) {
  const seen = new Map();
  for (const e of ajvErrors || []) {
    const entry = { path: sanitizePath(e.instancePath), keyword: String(e.keyword) };
    seen.set(`${entry.path} ${entry.keyword}`, entry);
  }
  return [...seen.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0,
  );
}

// Compiles the trusted schemas once. Throws only if compilation fails (internal fault).
// `compile` is injectable for tests; it defaults to the trusted loader.
export function createContractValidator({ compile = compileContractSchemas } = {}) {
  const dispatch = new Map(compile().validators);

  function validateContract(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return failure('E_NOT_OBJECT');
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return failure('E_NOT_OBJECT');

    const version = Object.hasOwn(value, 'schema_version') ? value.schema_version : undefined;
    if (!Number.isInteger(version) || version !== SCHEMA_VERSION) return failure('E_UNSUPPORTED_VERSION');

    const type = Object.hasOwn(value, 'artifact_type') ? value.artifact_type : undefined;
    if (typeof type !== 'string' || !dispatch.has(type)) return failure('E_UNKNOWN_TYPE');

    const validate = dispatch.get(type);
    if (validate(value)) return { ok: true, artifactType: type, schemaVersion: SCHEMA_VERSION, value };
    return failure('E_SCHEMA_INVALID', normalizeErrors(validate.errors));
  }

  function validateContractBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('validateContractBytes: bytes must be a Uint8Array');
    if (bytes.length > MAX_ARTIFACT_BYTES) return failure('E_TOO_LARGE');
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return failure('E_ENCODING');
    if (bytes.includes(0)) return failure('E_ENCODING');

    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return failure('E_ENCODING');
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      return failure('E_JSON_PARSE');
    }
    const duplicate = findDuplicateKey(text);
    if (duplicate) return failure('E_DUPLICATE_KEY', [{ path: duplicate.path, keyword: 'duplicateKey' }]);
    return validateContract(value);
  }

  return Object.freeze({ validateContract, validateContractBytes });
}

// lstat (no symlinks, regular files only), then open and fstat the descriptor, then a
// bounded read of at most MAX_ARTIFACT_BYTES + 1 bytes so growth after the stat is
// caught. Accepted residual risk: the lstat/open race (no portable O_NOFOLLOW).
function readArtifact(file) {
  let st;
  try {
    st = lstatSync(file);
  } catch {
    return { code: 'E_IO' };
  }
  if (st.isSymbolicLink() || !st.isFile()) return { code: 'E_IO' };

  let fd;
  try {
    fd = openSync(file, 'r');
  } catch {
    return { code: 'E_IO' };
  }
  try {
    const fst = fstatSync(fd);
    if (!fst.isFile()) return { code: 'E_IO' };
    if (fst.size > MAX_ARTIFACT_BYTES) return { code: 'E_TOO_LARGE' };
    const buf = Buffer.alloc(MAX_ARTIFACT_BYTES + 1);
    let total = 0;
    while (total < buf.length) {
      const n = readSync(fd, buf, total, buf.length - total, null);
      if (n === 0) break;
      total += n;
    }
    if (total > MAX_ARTIFACT_BYTES) return { code: 'E_TOO_LARGE' };
    return { bytes: buf.subarray(0, total) };
  } catch {
    return { code: 'E_IO' };
  } finally {
    closeSync(fd);
  }
}

function line(obj) {
  return JSON.stringify(obj) + '\n';
}

function internal(err) {
  const msg = String(err && err.message ? err.message : err).replace(/[^ -~]/g, ' ').slice(0, 300);
  return { exitCode: 3, stdout: line({ ok: false, code: 'E_INTERNAL' }), stderr: `validate-contract: internal error: ${msg}\n` };
}

// Pure CLI core: returns { exitCode, stdout, stderr } instead of writing, so it can be
// tested in process. `createValidator` is injectable for tests only.
export function runCli(args, { createValidator = createContractValidator } = {}) {
  if (args.length !== 1 || args[0] === '' || args[0].startsWith('-')) {
    return {
      exitCode: 2,
      stdout: line({ ok: false, code: 'E_USAGE' }),
      stderr: 'usage: node scripts/ai/validate-contract.mjs <file>\n',
    };
  }

  let validator;
  try {
    validator = createValidator();
  } catch (err) {
    return internal(err);
  }

  const read = readArtifact(args[0]);
  if (read.code) {
    return { exitCode: read.code === 'E_TOO_LARGE' ? 1 : 2, stdout: line({ ok: false, code: read.code }), stderr: '' };
  }

  let result;
  try {
    result = validator.validateContractBytes(read.bytes);
  } catch (err) {
    return internal(err);
  }
  if (result.ok) {
    return {
      exitCode: 0,
      stdout: line({ ok: true, artifact_type: result.artifactType, schema_version: result.schemaVersion }),
      stderr: '',
    };
  }
  return {
    exitCode: 1,
    stdout: line({ ok: false, code: result.code, error_count: result.errorCount, errors: result.errors }),
    stderr: '',
  };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const invoked = path.resolve(process.argv[1]);
  const self = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self;
}

if (isMainModule()) {
  const { exitCode, stdout, stderr } = runCli(process.argv.slice(2));
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exitCode = exitCode;
}
