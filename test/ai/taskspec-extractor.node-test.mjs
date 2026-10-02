// Tests for the TaskSpec machine-block extractor (A3.4a). Extraction only: no JSON,
// schema, business or policy rules are tested here.
//
//   node --test test/ai/taskspec-extractor.node-test.mjs
//
// Named *.node-test.mjs so Vitest never runs it in workerd. Control characters and
// escapes are built at runtime (CR/LF/TAB/BS) rather than written literally.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TASKSPEC_BLOCK_BYTES,
  MAX_TASKSPEC_MARKDOWN_BYTES,
  TASKSPEC_FENCE,
  TASKSPEC_MARKER,
  extractTaskSpecBlock,
} from '../../scripts/ai/extract-taskspec.mjs';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const CRLF = CR + LF;
const TAB = String.fromCharCode(9);
const FENCE = '`'.repeat(3);

const enc = (s) => new TextEncoder().encode(s);
const extract = (s) => extractTaskSpecBlock(enc(s));
const doc = (lines, eol = LF) => lines.join(eol);

const PAYLOAD_LINES = ['{', '  "schema_version": 1,', '  "artifact_type": "TaskSpec"', '}'];

function canonical(eol = LF) {
  return doc(['# SPEC-AI-001: Example', '', 'Narrative.', '', TASKSPEC_MARKER, ...PAYLOAD_LINES, TASKSPEC_FENCE, '', 'More prose.', ''], eol);
}

// ---------------------------------------------------------------- constants

test('constants: exact marker, fence and size limits', () => {
  assert.equal(TASKSPEC_MARKER, FENCE + 'json hlg-taskspec');
  assert.equal(TASKSPEC_FENCE, FENCE);
  assert.equal(MAX_TASKSPEC_MARKDOWN_BYTES, 2097152);
  assert.equal(MAX_TASKSPEC_BLOCK_BYTES, 1048576);
});

// ---------------------------------------------------------------- valid extraction

test('valid: canonical block with LF returns exact payload bytes and line numbers', () => {
  const r = extract(canonical(LF));
  assert.equal(r.ok, true);
  assert.deepEqual(r.bytes, enc(PAYLOAD_LINES.join(LF) + LF));
  assert.equal(r.startLine, 5);
  assert.equal(r.endLine, 10);
});

test('valid: CRLF file returns the raw payload bytes including CR (no normalization)', () => {
  const r = extract(canonical(CRLF));
  assert.equal(r.ok, true);
  assert.deepEqual(r.bytes, enc(PAYLOAD_LINES.join(CRLF) + CRLF));
  assert.equal(r.startLine, 5);
  assert.equal(r.endLine, 10);
});

test('valid: mixed LF/CRLF lines are accepted and preserved byte-for-byte', () => {
  const md = 'intro' + CRLF + TASKSPEC_MARKER + CRLF + '{' + LF + '"a": 1' + CRLF + '}' + LF + TASKSPEC_FENCE + CRLF;
  const r = extract(md);
  assert.equal(r.ok, true);
  assert.deepEqual(r.bytes, enc('{' + LF + '"a": 1' + CRLF + '}' + LF));
});

test('valid: extracted bytes equal the exact source slice', () => {
  const md = canonical(CRLF);
  const src = enc(md);
  const r = extractTaskSpecBlock(src);
  const head = enc(doc(['# SPEC-AI-001: Example', '', 'Narrative.', '', TASKSPEC_MARKER], CRLF) + CRLF).length;
  assert.deepEqual(r.bytes, src.slice(head, head + r.bytes.length));
});

test('api: returned bytes are a copy (mutating either side does not affect the other)', () => {
  const src = enc(canonical());
  const original = Uint8Array.from(src);
  const r = extractTaskSpecBlock(src);
  assert.notEqual(r.bytes.buffer, src.buffer);
  r.bytes.fill(0x41);
  assert.deepEqual(src, original);
  const again = extractTaskSpecBlock(src);
  const snapshot = Uint8Array.from(again.bytes);
  src.fill(0x42);
  assert.deepEqual(again.bytes, snapshot);
});

test('valid: prose and unrelated js/tilde code blocks before and after are ignored', () => {
  const md = doc([
    'Some prose mentioning hlg-taskspec without a fence.',
    FENCE + 'js',
    'const before = "{";',
    FENCE,
    TASKSPEC_MARKER,
    '{}',
    TASKSPEC_FENCE,
    FENCE + 'js',
    'const after = "}";',
    FENCE,
    '~~~',
    'tilde block',
    '~~~',
    '',
  ]);
  const r = extract(md);
  assert.equal(r.ok, true);
  assert.deepEqual(r.bytes, enc('{}' + LF));
});

test('valid: closing fence on the last line without a trailing newline', () => {
  const r = extract(TASKSPEC_MARKER + LF + '{}' + LF + TASKSPEC_FENCE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.bytes, enc('{}' + LF));
});

test('valid: payload is not parsed (non-JSON content is returned unchanged)', () => {
  const r = extract(doc([TASKSPEC_MARKER, 'not json at all', TASKSPEC_FENCE, '']));
  assert.equal(r.ok, true);
  assert.deepEqual(r.bytes, enc('not json at all' + LF));
});

test('valid: whitespace-only payload is returned (rejected later by the JSON layer)', () => {
  const r = extract(doc([TASKSPEC_MARKER, '   ', TASKSPEC_FENCE, '']));
  assert.equal(r.ok, true);
  assert.deepEqual(r.bytes, enc('   ' + LF));
});

// ---------------------------------------------------------------- marker counting

test('markers: no marker is E_TASKSPEC_NO_BLOCK', () => {
  assert.deepEqual(extract('# Title' + LF + 'prose' + LF), { ok: false, code: 'E_TASKSPEC_NO_BLOCK' });
  assert.deepEqual(extract(''), { ok: false, code: 'E_TASKSPEC_NO_BLOCK' });
});

test('markers: two adjacent markers are E_TASKSPEC_MULTIPLE_BLOCKS at the second marker line', () => {
  const md = doc(['prose', TASKSPEC_MARKER, TASKSPEC_MARKER, '{}', TASKSPEC_FENCE, '']);
  assert.deepEqual(extract(md), { ok: false, code: 'E_TASKSPEC_MULTIPLE_BLOCKS', line: 3 });
});

test('markers: a second marker after the first block closes is E_TASKSPEC_MULTIPLE_BLOCKS', () => {
  const md = doc([TASKSPEC_MARKER, '{}', TASKSPEC_FENCE, 'prose', TASKSPEC_MARKER, '{}', TASKSPEC_FENCE, '']);
  assert.deepEqual(extract(md), { ok: false, code: 'E_TASKSPEC_MULTIPLE_BLOCKS', line: 5 });
});

test('markers: plain prose mentioning hlg-taskspec is ignored', () => {
  assert.deepEqual(extract('The hlg-taskspec block is below.' + LF + 'json hlg-taskspec' + LF), { ok: false, code: 'E_TASKSPEC_NO_BLOCK' });
});

test('markers: an exact marker inside an unrelated code block still counts (documented)', () => {
  const md = doc([FENCE + 'md', TASKSPEC_MARKER, FENCE, TASKSPEC_MARKER, '{}', TASKSPEC_FENCE, '']);
  assert.deepEqual(extract(md), { ok: false, code: 'E_TASKSPEC_MULTIPLE_BLOCKS', line: 4 });
});

// ---------------------------------------------------------------- malformed markers

const malformed = {
  indented: '   ' + TASKSPEC_MARKER,
  'trailing space': TASKSPEC_MARKER + ' ',
  'trailing tab': TASKSPEC_MARKER + TAB,
  'four backticks': '`' + TASKSPEC_MARKER,
  tilde: '~~~json hlg-taskspec',
  'uppercase JSON': FENCE + 'JSON hlg-taskspec',
  'uppercase name': FENCE + 'json HLG-TASKSPEC',
  'double space': FENCE + 'json  hlg-taskspec',
  'missing json': FENCE + 'hlg-taskspec',
};
for (const [name, line] of Object.entries(malformed)) {
  test(`malformed marker (${name}) is E_TASKSPEC_MARKER_MALFORMED with its line`, () => {
    const md = doc(['prose', line, '{}', TASKSPEC_FENCE, '']);
    assert.deepEqual(extract(md), { ok: false, code: 'E_TASKSPEC_MARKER_MALFORMED', line: 2 });
  });
}

// ---------------------------------------------------------------- fences

test('fences: missing closing fence is E_TASKSPEC_UNCLOSED_BLOCK at the marker line', () => {
  assert.deepEqual(extract(doc(['prose', TASKSPEC_MARKER, '{}', ''])), { ok: false, code: 'E_TASKSPEC_UNCLOSED_BLOCK', line: 2 });
});

test('fences: marker on the last line is E_TASKSPEC_UNCLOSED_BLOCK', () => {
  assert.deepEqual(extract('prose' + LF + TASKSPEC_MARKER), { ok: false, code: 'E_TASKSPEC_UNCLOSED_BLOCK', line: 2 });
});

test('fences: closing fence with trailing whitespace is E_TASKSPEC_FENCE_MALFORMED', () => {
  assert.deepEqual(extract(doc([TASKSPEC_MARKER, '{}', TASKSPEC_FENCE + ' ', ''])), { ok: false, code: 'E_TASKSPEC_FENCE_MALFORMED', line: 3 });
  assert.deepEqual(extract(doc([TASKSPEC_MARKER, '{}', TASKSPEC_FENCE + TAB, ''])), { ok: false, code: 'E_TASKSPEC_FENCE_MALFORMED', line: 3 });
});

test('fences: empty block is E_TASKSPEC_EMPTY_BLOCK at the marker line', () => {
  assert.deepEqual(extract(doc(['prose', TASKSPEC_MARKER, TASKSPEC_FENCE, ''])), { ok: false, code: 'E_TASKSPEC_EMPTY_BLOCK', line: 2 });
});

// ---------------------------------------------------------------- byte rules

test('bytes: UTF-8 BOM is E_ENCODING', () => {
  const body = enc(canonical());
  const withBom = new Uint8Array(body.length + 3);
  withBom.set([0xef, 0xbb, 0xbf]);
  withBom.set(body, 3);
  assert.deepEqual(extractTaskSpecBlock(withBom), { ok: false, code: 'E_ENCODING' });
});

test('bytes: NUL byte is E_ENCODING', () => {
  const src = enc(canonical());
  src[2] = 0;
  assert.deepEqual(extractTaskSpecBlock(src), { ok: false, code: 'E_ENCODING' });
});

test('bytes: invalid UTF-8 is E_ENCODING', () => {
  assert.deepEqual(extractTaskSpecBlock(Uint8Array.from([0x23, 0xc3, 0x28, 0x0a])), { ok: false, code: 'E_ENCODING' });
});

test('bytes: Markdown larger than 2 MiB is E_TOO_LARGE (checked before anything else)', () => {
  const big = new Uint8Array(MAX_TASKSPEC_MARKDOWN_BYTES + 1); // all NUL: size must win
  assert.deepEqual(extractTaskSpecBlock(big), { ok: false, code: 'E_TOO_LARGE' });
});

test('bytes: Markdown of exactly 2 MiB passes the size stage', () => {
  const md = TASKSPEC_MARKER + LF + '{}' + LF + TASKSPEC_FENCE + LF;
  const padded = md + 'x'.repeat(MAX_TASKSPEC_MARKDOWN_BYTES - enc(md).length);
  assert.equal(enc(padded).length, MAX_TASKSPEC_MARKDOWN_BYTES);
  assert.equal(extract(padded).ok, true);
});

test('bytes: payload larger than 1 MiB is E_TASKSPEC_BLOCK_TOO_LARGE at the marker line', () => {
  const over = 'x'.repeat(MAX_TASKSPEC_BLOCK_BYTES); // plus its LF = 1 MiB + 1 byte
  const md = 'prose' + LF + TASKSPEC_MARKER + LF + over + LF + TASKSPEC_FENCE + LF;
  assert.ok(enc(md).length < MAX_TASKSPEC_MARKDOWN_BYTES);
  assert.deepEqual(extract(md), { ok: false, code: 'E_TASKSPEC_BLOCK_TOO_LARGE', line: 2 });
});

test('bytes: payload of exactly 1 MiB is accepted', () => {
  const exact = 'x'.repeat(MAX_TASKSPEC_BLOCK_BYTES - 1); // plus its LF = exactly 1 MiB
  const r = extract(TASKSPEC_MARKER + LF + exact + LF + TASKSPEC_FENCE + LF);
  assert.equal(r.ok, true);
  assert.equal(r.bytes.length, MAX_TASKSPEC_BLOCK_BYTES);
});

test('api: non-Uint8Array input throws TypeError', () => {
  assert.throws(() => extractTaskSpecBlock('text'), TypeError);
  assert.throws(() => extractTaskSpecBlock(new ArrayBuffer(4)), TypeError);
  assert.throws(() => extractTaskSpecBlock(null), TypeError);
});

test('failures never include input text', () => {
  const secretish = 'sk-' + 'A'.repeat(40);
  for (const md of [
    doc([secretish, TASKSPEC_MARKER + ' ', '']),
    doc([TASKSPEC_MARKER, secretish, '']),
    doc([TASKSPEC_MARKER, secretish, TASKSPEC_FENCE + ' ', '']),
  ]) {
    const r = extract(md);
    assert.equal(r.ok, false);
    assert.ok(!JSON.stringify(r).includes('sk-'));
    for (const key of Object.keys(r)) assert.ok(['ok', 'code', 'line'].includes(key), key);
  }
});

// ---------------------------------------------------------------- invariants

test('extractor never calls JSON.parse (runtime check across success and failure paths)', () => {
  const realParse = JSON.parse;
  let calls = 0;
  JSON.parse = () => {
    calls++;
    throw new Error('JSON.parse must not be called by the extractor');
  };
  try {
    assert.equal(extract(canonical(CRLF)).ok, true);
    assert.equal(extract(doc([TASKSPEC_MARKER, '{}', ''])).ok, false);
    assert.equal(extract(doc(['  ' + TASKSPEC_MARKER, ''])).ok, false);
  } finally {
    JSON.parse = realParse;
  }
  assert.equal(calls, 0);
});

test('extractor function body references no JSON parser, Ajv or contract validator', () => {
  const body = extractTaskSpecBlock.toString();
  for (const forbidden of ['JSON.parse', 'Ajv', 'validateContract', 'fetch(', 'import(', 'require(']) {
    assert.ok(!body.includes(forbidden), forbidden);
  }
});
