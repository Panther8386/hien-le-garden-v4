// Tests for the supported TaskSpec composer (A3.4d.3, ADR-AI-009; findings F2, F4 and the
// narrative part of F3).
//
//   node --test test/ai/validate-taskspec.node-test.mjs
//
// Named *.node-test.mjs so Vitest never runs it in workerd. Stage execution is observed only
// through the composer's onStage hook (stage names only). Credential-shaped fixtures are
// SYNTHETIC and assembled at runtime from harmless fragments; the TaskSpec marker line and
// fences are built at runtime too. Nothing is logged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { TASKSPEC_STAGES, createTaskSpecValidator } from '../../scripts/ai/validate-taskspec.mjs';
import { containsHighConfidenceSecret } from '../../scripts/ai/secret-detector.mjs';

const ALL = ['EXTRACT', 'SECRET_SCAN', 'CONTRACT', 'TYPE', 'BUSINESS', 'POLICY'];
const FENCE = '`'.repeat(3);
const MARKER = FENCE + 'json hlg-taskspec';
const BS = String.fromCharCode(92);
const FILE = 'SPEC-AI-001-composer-check.md';
const MAX_MARKDOWN = 2_097_152;
const EXAMPLES = 'docs/ai/contracts/examples/v1/';

const enc = (s) => new TextEncoder().encode(s);
const example = (name) => JSON.parse(readFileSync(EXAMPLES + name, 'utf8'));

// Synthetic secrets (never contiguous in source).
const SK = 's' + 'k-';
const skKey = () => SK + 'proj-' + 'Ab1'.repeat(15);
const ghKey = () => 'gh' + 'p' + '_' + 'Ab1'.repeat(12);

// A valid, policy-passing TaskSpec built from the committed example.
function validSpec() {
  const s = example('task-spec.example.json');
  s.scope = { allowed_paths: ['docs/notes/'], forbidden_paths: [] };
  s.human_gates = [];
  return s;
}

function markdown(payload, { before = '# SPEC-AI-001: Composer check\n\nNarrative text.\n', after = '\nMore narrative.\n' } = {}) {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return before + MARKER + '\n' + json + '\n' + FENCE + '\n' + after;
}

// One shared validator; the hook records the stages of the current call.
let stages = [];
const validator = createTaskSpecValidator({ onStage: (s) => stages.push(s) });
function run(input, fileName = FILE) {
  stages = [];
  const bytes = typeof input === 'string' ? enc(input) : input;
  const result = validator.validateTaskSpecMarkdown(bytes, { fileName });
  return { result, stages: [...stages] };
}

function deepFrozen(v) {
  if (v === null || typeof v !== 'object') return true;
  return Object.isFrozen(v) && Object.values(v).every(deepFrozen);
}

const FAILURE_KEYS = ['code', 'errorCount', 'errors', 'ok', 'stage'];

// ---------------------------------------------------------------- API

test('api: stage list, frozen validator and argument checks', () => {
  assert.deepEqual([...TASKSPEC_STAGES], ALL);
  assert.ok(Object.isFrozen(TASKSPEC_STAGES));
  const v = createTaskSpecValidator();
  assert.ok(Object.isFrozen(v));
  assert.deepEqual(Object.keys(v), ['validateTaskSpecMarkdown']);
  assert.throws(() => createTaskSpecValidator({ onStage: 'x' }), TypeError);
  for (const bad of ['text', null, undefined, [1, 2], new ArrayBuffer(4)]) {
    assert.throws(() => v.validateTaskSpecMarkdown(bad, { fileName: FILE }), TypeError);
  }
  for (const bad of [undefined, 7, null]) {
    assert.throws(() => v.validateTaskSpecMarkdown(enc(markdown(validSpec())), { fileName: bad }), TypeError);
  }
  assert.throws(() => v.validateTaskSpecMarkdown(enc(markdown(validSpec()))), TypeError);
});

// ---------------------------------------------------------------- fail-closed stage matrix

test('matrix A: extraction failure runs EXTRACT only', () => {
  const { result, stages: s } = run('# No machine block here\n');
  assert.deepEqual(s, ['EXTRACT']);
  assert.deepEqual(result, { ok: false, stage: 'EXTRACT', code: 'E_TASKSPEC_NO_BLOCK', errorCount: 0, errors: [] });
  const twice = run(markdown(validSpec()) + markdown(validSpec()));
  assert.deepEqual(twice.stages, ['EXTRACT']);
  assert.equal(twice.result.code, 'E_TASKSPEC_MULTIPLE_BLOCKS');
  assert.equal(typeof twice.result.line, 'number');
});

test('matrix B: a narrative secret stops at SECRET_SCAN with the approved envelope', () => {
  const { result, stages: s } = run(markdown(validSpec(), { before: 'Key: ' + skKey() + '\n' }));
  assert.deepEqual(s, ['EXTRACT', 'SECRET_SCAN']);
  assert.deepEqual(result, {
    ok: false,
    stage: 'SECRET_SCAN',
    code: 'E_TASKSPEC_SECRET',
    errorCount: 1,
    errors: [{ rule: 'SEC-NARRATIVE-SECRET', path: '' }],
  });
});

test('matrix C: malformed JSON and schema-invalid payloads stop at CONTRACT', () => {
  const malformed = run(markdown('{ "schema_version": 1, '));
  assert.deepEqual(malformed.stages, ['EXTRACT', 'SECRET_SCAN', 'CONTRACT']);
  assert.equal(malformed.result.stage, 'CONTRACT');
  assert.equal(malformed.result.code, 'E_JSON_PARSE');

  const missing = validSpec();
  delete missing.title;
  const invalid = run(markdown(missing));
  assert.deepEqual(invalid.stages, ['EXTRACT', 'SECRET_SCAN', 'CONTRACT']);
  assert.equal(invalid.result.code, 'E_SCHEMA_INVALID');
  assert.ok(invalid.result.errorCount >= 1);

  const dup = run(markdown('{"schema_version":1,"schema_version":1}'));
  assert.deepEqual(dup.stages, ['EXTRACT', 'SECRET_SCAN', 'CONTRACT']);
  assert.equal(dup.result.code, 'E_DUPLICATE_KEY');
});

test('matrix D / TYPE: every committed non-TaskSpec example passes CONTRACT and stops at TYPE', () => {
  const names = readdirSync(EXAMPLES).filter((n) => n.endsWith('.example.json') && n !== 'task-spec.example.json');
  assert.ok(names.length >= 6);
  for (const name of names) {
    const { result, stages: s } = run(markdown(example(name)));
    assert.deepEqual(s, ['EXTRACT', 'SECRET_SCAN', 'CONTRACT', 'TYPE'], name);
    assert.deepEqual(result, { ok: false, stage: 'TYPE', code: 'E_TASKSPEC_WRONG_TYPE', errorCount: 0, errors: [] }, name);
  }
});

test('matrix E / F2: business-invalid TaskSpecs (incl. F1 trailing dot) never reach POLICY', () => {
  const trailing = validSpec();
  trailing.scope.allowed_paths = ['CLAUDE.md.'];
  const e = run(markdown(trailing));
  assert.deepEqual(e.stages, ['EXTRACT', 'SECRET_SCAN', 'CONTRACT', 'TYPE', 'BUSINESS']);
  assert.deepEqual(e.result, {
    ok: false,
    stage: 'BUSINESS',
    code: 'E_TASKSPEC_BUSINESS',
    errorCount: 1,
    errors: [{ rule: 'BR-PATH-TRAILING-DOT', path: '/scope/allowed_paths/0' }],
  });

  const conflict = validSpec();
  conflict.scope = { allowed_paths: ['docs/a.md'], forbidden_paths: ['docs/'] };
  const caseAmb = validSpec();
  caseAmb.scope = { allowed_paths: ['migrations/', 'Migrations/'], forbidden_paths: [] };
  const dupIds = validSpec();
  dupIds.requirements.push({ id: 'R-01', text: 'Duplicate.' });
  for (const [spec, fileName] of [[conflict, FILE], [caseAmb, FILE], [dupIds, FILE], [validSpec(), 'wrong-name.md']]) {
    const { result, stages: s } = run(markdown(spec), fileName);
    assert.deepEqual(s, ['EXTRACT', 'SECRET_SCAN', 'CONTRACT', 'TYPE', 'BUSINESS']);
    assert.equal(result.stage, 'BUSINESS');
    assert.ok(!s.includes('POLICY'));
  }
});

test('matrix F: a policy-invalid TaskSpec runs all six stages and fails at POLICY', () => {
  const { result, stages: s } = run(markdown(example('task-spec.example.json')));
  assert.deepEqual(s, ALL);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'POLICY');
  assert.equal(result.code, 'E_TASKSPEC_POLICY');
  assert.ok(result.errors.some((e) => e.rule === 'POL-GATE-GOVERNANCE'));
});

test('matrix G: a valid TaskSpec runs every stage exactly once and passes', () => {
  const { result, stages: s } = run(markdown(validSpec()));
  assert.deepEqual(s, ALL);
  assert.deepEqual(Object.keys(result), ['ok', 'spec', 'protectedCategories', 'startLine', 'endLine']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.protectedCategories, []);
  assert.equal(result.startLine, 4);
  assert.deepEqual(result.spec, validSpec());

  const gov = validSpec();
  gov.scope.allowed_paths = ['scripts/ai/'];
  gov.human_gates = [{ gate_id: 'HG-01', type: 'custom', description: 'Owner review of governance change.' }];
  assert.deepEqual(run(markdown(gov)).result.protectedCategories, ['GOVERNANCE']);
});

// ---------------------------------------------------------------- F4: schema-first

test('F4: off-schema keys fail at CONTRACT; BUSINESS and POLICY never run', () => {
  const root = validSpec();
  root.zz_extra = 'value';
  const nested = validSpec();
  nested.scope.zz_extra = ['x'];
  const proto = '{"__proto__":{"polluted":true},' + JSON.stringify(validSpec()).slice(1);
  for (const payload of [root, nested, proto]) {
    const { result, stages: s } = run(markdown(payload));
    assert.deepEqual(s, ['EXTRACT', 'SECRET_SCAN', 'CONTRACT']);
    assert.equal(result.code, 'E_SCHEMA_INVALID');
  }
  assert.equal({}.polluted, undefined);
});

test('F4: an off-schema key with visible secret material stops at SECRET_SCAN', () => {
  const s = validSpec();
  s.zz_extra = skKey();
  const r = run(markdown(s));
  assert.deepEqual(r.stages, ['EXTRACT', 'SECRET_SCAN']);
  assert.equal(r.result.code, 'E_TASKSPEC_SECRET');
});

test('F4: an off-schema key whose secret appears only after JSON decoding stops at CONTRACT', () => {
  const s = validSpec();
  s.zz_extra = 'PLACEHOLDER';
  const escaped = BS + 'u0073' + 'k-proj-' + 'Ab1'.repeat(15); // JSON escape of the first character
  const text = markdown(JSON.stringify(s).replace('PLACEHOLDER', escaped));
  assert.equal(containsHighConfidenceSecret(text), false); // not visible in the raw Markdown
  const r = run(text);
  assert.deepEqual(r.stages, ['EXTRACT', 'SECRET_SCAN', 'CONTRACT']);
  assert.equal(r.result.code, 'E_SCHEMA_INVALID');
});

test('defense in depth: a schema-valid TaskSpec with a JSON-escaped secret fails at POLICY (POL-SECRET)', () => {
  const s = validSpec();
  s.objective = 'Use PLACEHOLDER here.';
  const escaped = BS + 'u0073' + 'k-proj-' + 'Ab1'.repeat(15);
  const r = run(markdown(JSON.stringify(s).replace('PLACEHOLDER', escaped)));
  assert.deepEqual(r.stages, ALL);
  assert.deepEqual(r.result.errors, [{ rule: 'POL-SECRET', path: '/objective' }]);
});

// ---------------------------------------------------------------- encoding boundary (Option A)

test('encoding: invalid UTF-8, BOM, NUL and oversize input are rejected by EXTRACT before SECRET_SCAN', () => {
  const valid = enc(markdown(validSpec()));
  const withPrefix = (prefix) => {
    const out = new Uint8Array(prefix.length + valid.length);
    out.set(prefix, 0);
    out.set(valid, prefix.length);
    return out;
  };
  const cases = {
    'invalid sequence': withPrefix([0xc3, 0x28]),
    'lone continuation byte': withPrefix([0x80]),
    'overlong encoding': withPrefix([0xc0, 0xaf]),
    'encoded surrogate': withPrefix([0xed, 0xa0, 0x80]),
    'truncated sequence at end': (() => { const b = new Uint8Array(valid.length + 1); b.set(valid); b[valid.length] = 0xe2; return b; })(),
    BOM: withPrefix([0xef, 0xbb, 0xbf]),
    NUL: withPrefix([0x41, 0x00]),
  };
  for (const [name, bytes] of Object.entries(cases)) {
    const { result, stages: s } = run(bytes);
    assert.deepEqual(s, ['EXTRACT'], name);
    assert.deepEqual(result, { ok: false, stage: 'EXTRACT', code: 'E_ENCODING', errorCount: 0, errors: [] }, name);
  }
  const big = run(new Uint8Array(MAX_MARKDOWN + 1).fill(0x61));
  assert.deepEqual(big.stages, ['EXTRACT']);
  assert.equal(big.result.code, 'E_TOO_LARGE');
});

test('encoding: the byte cap is on bytes, not string length (multibyte input)', () => {
  const base = markdown(validSpec(), { after: '\n' });
  const unit = 'Hiền Lê '; // multibyte UTF-8
  const units = Math.floor((MAX_MARKDOWN - enc(base).length) / enc(unit).length) + 1;
  const text = base + unit.repeat(units);
  assert.ok(enc(text).length > MAX_MARKDOWN && text.length < MAX_MARKDOWN);
  const { result, stages: s } = run(text);
  assert.deepEqual(s, ['EXTRACT']);
  assert.equal(result.code, 'E_TOO_LARGE');
});

test('encoding: for valid UTF-8, SECRET_SCAN judges the text decoded from the same bytes', () => {
  const extractorDecode = (b) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b);
  const inputs = [
    markdown(validSpec(), { before: 'Hiền Lê Garden — ghi chú 🌿\n' + skKey() + '\n' }),
    markdown(validSpec(), { after: '\nĐoạn cuối ' + ghKey() + ' ✓\n' }),
    markdown(validSpec(), { before: 'Tách: ' + SK + 'proj-' + 'Ab1'.repeat(7) + 'ề' + 'Ab1'.repeat(8) + '\n' }),
    markdown(validSpec(), { before: 'Không có bí mật nào ở đây. 日本語 テキスト\n' }),
    markdown(validSpec()),
  ];
  const verdicts = [];
  for (const text of inputs) {
    const bytes = enc(text);
    const { result, stages: s } = run(bytes);
    const expected = containsHighConfidenceSecret(extractorDecode(bytes));
    assert.equal(result.stage === 'SECRET_SCAN', expected);
    assert.ok(s.includes('SECRET_SCAN'));
    verdicts.push(expected);
  }
  assert.deepEqual(verdicts, [true, true, false, false, false]);
});

test('encoding: an unexpected failure of the second decode fails closed at SECRET_SCAN', () => {
  const Real = globalThis.TextDecoder;
  let created = 0;
  globalThis.TextDecoder = class extends Real {
    constructor(...args) {
      super(...args);
      this.n = ++created;
    }
    decode(...args) {
      if (this.n === 2) throw new TypeError('simulated decode failure');
      return super.decode(...args);
    }
  };
  let outcome;
  try {
    outcome = run(markdown(validSpec()));
  } finally {
    globalThis.TextDecoder = Real;
  }
  assert.equal(created >= 2, true);
  assert.deepEqual(outcome.stages, ['EXTRACT', 'SECRET_SCAN']);
  assert.deepEqual(outcome.result, { ok: false, stage: 'SECRET_SCAN', code: 'E_ENCODING', errorCount: 0, errors: [] });
});

// ---------------------------------------------------------------- narrative scan

test('narrative: secrets before, after and inside the raw block are found; clean input passes', () => {
  const inside = validSpec();
  inside.objective = 'Token ' + ghKey() + ' must never be committed.';
  const cases = [
    [markdown(validSpec(), { before: ghKey() + '\n' }), true],
    [markdown(validSpec(), { after: '\nFooter ' + skKey() + '\n' }), true],
    [markdown(inside), true],
    [markdown(validSpec(), { before: 'Mention of BREVO_API_KEY and sk- prefix rules only.\n' }), false],
  ];
  for (const [text, secret] of cases) {
    const { result, stages: s } = run(text);
    if (secret) {
      assert.deepEqual(s, ['EXTRACT', 'SECRET_SCAN']);
      assert.equal(result.code, 'E_TASKSPEC_SECRET');
    } else {
      assert.deepEqual(s, ALL);
      assert.equal(result.ok, true);
    }
  }
});

function padTo(text, total) {
  const bytes = enc(text).length;
  assert.ok(bytes <= total);
  const line = 'lorem ipsum dolor sit amet\n';
  const n = total - bytes;
  return text + line.repeat(Math.floor(n / line.length)) + 'x'.repeat(n % line.length);
}

test('narrative: a safe 2,097,152-byte Markdown passes; a secret at its very end is found', () => {
  const safe = padTo(markdown(validSpec()), MAX_MARKDOWN);
  assert.equal(enc(safe).length, MAX_MARKDOWN);
  const ok = run(safe);
  assert.deepEqual(ok.stages, ALL);
  assert.equal(ok.result.ok, true);

  const tail = '\n' + skKey();
  const withSecret = padTo(markdown(validSpec()), MAX_MARKDOWN - tail.length) + tail;
  assert.equal(enc(withSecret).length, MAX_MARKDOWN);
  const found = run(withSecret);
  assert.deepEqual(found.stages, ['EXTRACT', 'SECRET_SCAN']);
  assert.equal(found.result.code, 'E_TASKSPEC_SECRET');
});

// ---------------------------------------------------------------- error safety

test('error safety: a secret failure exposes no fixture, fragment, line content or excerpt', () => {
  for (const key of [skKey(), ghKey()]) {
    const text = markdown(validSpec(), { before: 'Zebra narrative line with ' + key + ' inside.\n' });
    const { result } = run(text);
    const out = JSON.stringify(result);
    assert.deepEqual(Object.keys(result).sort(), FAILURE_KEYS);
    for (const frag of [key, key.slice(0, 8), key.slice(-8), 'Zebra', 'narrative', 'inside', 'proj', 'Ab1', String(key.length)]) {
      assert.ok(!out.includes(frag), 'leak');
    }
  }
});

test('error safety: no failure result contains narrative text or local paths', () => {
  const marker = 'QuokkaNarrativeMarker';
  const wrongType = example('gate-decision.example.json');
  const missing = validSpec();
  delete missing.title;
  const trailing = validSpec();
  trailing.scope.allowed_paths = ['CLAUDE.md.'];
  const inputs = [
    '# ' + marker + '\n',
    markdown(validSpec(), { before: marker + ' ' + skKey() + '\n' }),
    markdown(missing, { before: marker + '\n' }),
    markdown(wrongType, { before: marker + '\n' }),
    markdown(trailing, { before: marker + '\n' }),
    markdown(example('task-spec.example.json'), { before: marker + '\n' }),
  ];
  const cwd = process.cwd();
  for (const text of inputs) {
    const { result } = run(text);
    assert.equal(result.ok, false);
    const out = JSON.stringify(result);
    assert.ok(!out.includes(marker));
    assert.ok(!out.includes(cwd) && !out.includes(cwd.replaceAll(BS, '/')));
    for (const key of Object.keys(result)) assert.ok([...FAILURE_KEYS, 'line'].includes(key), key);
  }
});

// ---------------------------------------------------------------- determinism

test('determinism: identical input gives deep-equal results across calls and validators', () => {
  const trailing = validSpec();
  trailing.scope.allowed_paths = ['CLAUDE.md.'];
  const inputs = [
    '# none\n',
    markdown(validSpec(), { before: skKey() + '\n' }),
    markdown('{ broken'),
    markdown(example('eval-report.example.json')),
    markdown(trailing),
    markdown(example('task-spec.example.json')),
    markdown(validSpec()),
  ];
  const other = createTaskSpecValidator();
  for (const text of inputs) {
    const a = JSON.stringify(run(text).result);
    const b = JSON.stringify(run(text).result);
    const c = JSON.stringify(other.validateTaskSpecMarkdown(enc(text), { fileName: FILE }));
    assert.equal(a, b);
    assert.equal(a, c);
  }
});

// ---------------------------------------------------------------- deep freeze and input purity

test('freeze: the returned TaskSpec is deeply frozen and cannot be mutated', () => {
  const { result } = run(markdown(validSpec()));
  assert.ok(deepFrozen(result.spec));
  assert.throws(() => { result.spec.title = 'changed'; }, TypeError);
  assert.throws(() => { result.spec.scope.allowed_paths.push('CLAUDE.md'); }, TypeError);
  assert.throws(() => { result.spec.declared_changes.package = true; }, TypeError);
});

test('purity: the caller-owned input bytes are not modified', () => {
  const bytes = enc(markdown(validSpec(), { before: ghKey() + '\n' }));
  const copy = bytes.slice();
  run(bytes);
  run(enc(markdown(validSpec())));
  assert.deepEqual(bytes, copy);
});

// ---------------------------------------------------------------- observation hook

test('hook: receives only the stage name, and a throwing hook never yields ok:true', () => {
  const seen = [];
  const v = createTaskSpecValidator({ onStage: (...args) => seen.push(args) });
  assert.equal(v.validateTaskSpecMarkdown(enc(markdown(validSpec())), { fileName: FILE }).ok, true);
  assert.deepEqual(seen, ALL.map((s) => [s]));
  for (const stage of ALL) {
    const thrower = createTaskSpecValidator({
      onStage: (s) => {
        if (s === stage) throw new Error('hook failure');
      },
    });
    assert.throws(() => thrower.validateTaskSpecMarkdown(enc(markdown(validSpec())), { fileName: FILE }), /hook failure/);
  }
});

// ---------------------------------------------------------------- byte snapshot (C3-1)

// A safe Markdown whose bytes a hook can "poison" in place (same length) in three ways that
// would each change the outcome if a stage read the caller's array: break the marker line
// (EXTRACT), inject a secret into a placeholder (SECRET_SCAN), and widen the scope to a
// protected path (POLICY).
function poisonable() {
  const key = skKey();
  const text = markdown(validSpec(), { before: 'Note: ' + 'P'.repeat(key.length) + '\n' });
  const poison = (bytes) => {
    const at = (needle) => {
      const s = new TextDecoder().decode(bytes);
      const i = s.indexOf(needle);
      assert.ok(i >= 0, 'poison anchor missing');
      return enc(s.slice(0, i)).length; // byte offset (ASCII before the anchors anyway)
    };
    bytes.set(enc('~~~'), at(MARKER)); // malformed marker
    bytes.set(enc(key), at('P'.repeat(key.length))); // narrative secret
    bytes.set(enc('migrations/'), at('docs/notes/')); // protected scope (same length)
  };
  return { text, poison };
}

test('snapshot: the poisoned bytes really change the outcome when validated directly', () => {
  const { text, poison } = poisonable();
  const bytes = enc(text);
  poison(bytes);
  const { result, stages: s } = run(bytes);
  assert.deepEqual(s, ['EXTRACT']);
  assert.equal(result.code, 'E_TASKSPEC_MARKER_MALFORMED');
});

test('snapshot: mutating the caller bytes in any stage hook cannot change the result', () => {
  for (const kind of ['Uint8Array', 'Buffer']) {
    for (const stage of ALL) {
      const { text, poison } = poisonable();
      const bytes = kind === 'Buffer' ? Buffer.from(text) : enc(text);
      const seen = [];
      const v = createTaskSpecValidator({
        onStage: (s) => {
          seen.push(s);
          if (s === stage) poison(bytes);
        },
      });
      const result = v.validateTaskSpecMarkdown(bytes, { fileName: FILE });
      assert.deepEqual(seen, ALL, `${kind} ${stage}`);
      assert.equal(result.ok, true, `${kind} ${stage}`);
      assert.deepEqual(result.protectedCategories, [], `${kind} ${stage}`);
      assert.deepEqual([...result.spec.scope.allowed_paths], ['docs/notes/']);
      // The composer neither restores nor otherwise touches the caller's memory.
      assert.ok(new TextDecoder().decode(bytes).includes('migrations/'), `${kind} ${stage}`);
    }
  }
});

test('snapshot: a narrative secret removed by the SECRET_SCAN hook is still found', () => {
  const key = skKey();
  const text = markdown(validSpec(), { before: 'Leak: ' + key + '\n' });
  const bytes = Buffer.from(text);
  const v = createTaskSpecValidator({
    onStage: (s) => {
      if (s === 'SECRET_SCAN') bytes.fill(0x78, 6, 6 + key.length); // overwrite with "x"
    },
  });
  const result = v.validateTaskSpecMarkdown(bytes, { fileName: FILE });
  assert.equal(result.stage, 'SECRET_SCAN');
  assert.equal(result.code, 'E_TASKSPEC_SECRET');
  assert.ok(!new TextDecoder().decode(bytes).includes(key));
});

test('snapshot: a Buffer view over shared memory is snapshotted, not aliased', () => {
  const text = markdown(validSpec());
  const backing = Buffer.alloc(text.length + 16, 0x20);
  backing.write(text, 8);
  const view = backing.subarray(8, 8 + text.length); // shares memory with backing
  const v = createTaskSpecValidator({
    onStage: (s) => {
      if (s === 'CONTRACT') backing.write('"schema_version": 7', 8 + text.indexOf('"schema_version": 1'));
    },
  });
  const result = v.validateTaskSpecMarkdown(view, { fileName: FILE });
  assert.equal(result.ok, true);
  assert.equal(result.spec.schema_version, 1);
  assert.ok(new TextDecoder().decode(view).includes('"schema_version": 7'));
});

test('reentrancy: nested calls on the same validator use independent snapshots', () => {
  const { text, poison } = poisonable();
  const outer = enc(text);
  const innerText = markdown(validSpec(), { before: ghKey() + '\n' });
  let inner;
  let fired = false;
  const v = createTaskSpecValidator({
    onStage: (s) => {
      if (!fired && s === 'SECRET_SCAN') {
        fired = true;
        poison(outer);
        inner = v.validateTaskSpecMarkdown(enc(innerText), { fileName: FILE });
      }
    },
  });
  const result = v.validateTaskSpecMarkdown(outer, { fileName: FILE });
  assert.equal(result.ok, true);
  assert.equal(inner.stage, 'SECRET_SCAN');
  assert.equal(inner.code, 'E_TASKSPEC_SECRET');
  const again = v.validateTaskSpecMarkdown(enc(text), { fileName: FILE });
  assert.equal(again.ok, true);
});

// ---------------------------------------------------------------- supported entry point (F2)

// Repository enforcement, not a language-level sandbox: production JavaScript outside the
// allowlist must neither reference the business/policy modules by a literal specifier nor
// mention the stage entry functions. Before matching, the source is normalized: JavaScript
// string escapes (hex and both Unicode escape forms) and percent-escapes are decoded, and specifiers
// are compared case-insensitively, so literal variants such as `?query`, `#hash`, `%2D` and
// case changes are caught. Computed or concatenated specifiers (e.g. built from variables)
// cannot be detected by this bounded check and are left to code review.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'test', 'images', 'videos', '.wrangler', '.superpowers']);
const HEX = '[0-9a-fA-F]';
const JS_ESCAPE = new RegExp(`${BS}${BS}x(${HEX}{2})|${BS}${BS}u${BS}{(${HEX}{1,6})${BS}}|${BS}${BS}u(${HEX}{4})`, 'g');
const PERCENT = new RegExp(`%(${HEX}{2})`, 'g');
const MODULE_REF = /['"`/]taskspec-(business|policy)(?:\.mjs)?(?:[?#][^'"`\n]*)?['"`]/g;
const STAGE_FN = /\bvalidateTaskSpec(Business|Policy)\b/g;

function normalizeSource(source) {
  const codePoint = (hex) => {
    const n = parseInt(hex, 16);
    return n <= 0x10ffff ? String.fromCodePoint(n) : '';
  };
  return source
    .replace(JS_ESCAPE, (_, x, braced, u) => codePoint(x || braced || u))
    .replace(PERCENT, (_, h) => codePoint(h));
}

function boundaryHits(source) {
  const text = normalizeSource(source);
  return {
    refs: uniqueSortedOf([...text.toLowerCase().matchAll(MODULE_REF)].map((m) => m[1])),
    fns: uniqueSortedOf([...text.matchAll(STAGE_FN)].map((m) => m[1])),
  };
}

function uniqueSortedOf(values) {
  return [...new Set(values)].sort();
}
const EXPECTED = {
  'scripts/ai/validate-taskspec.mjs': { refs: ['business', 'policy'], fns: ['Business', 'Policy'] },
  'scripts/ai/taskspec-business.mjs': { refs: [], fns: ['Business'] },
  'scripts/ai/taskspec-policy.mjs': { refs: ['business'], fns: ['Policy'] },
  'scripts/ai/taskspec-policy-registry.mjs': { refs: ['business'], fns: [] },
};

function productionSources(dir = '.', out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(dir === '.' ? '' : dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) productionSources(rel, out);
    } else if (/\.(?:m|c)?js$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

test('boundary: only the composer consumes validateTaskSpecBusiness / validateTaskSpecPolicy', () => {
  const files = productionSources();
  assert.ok(files.length > 100, 'scan found too few production sources');
  for (const required of Object.keys(EXPECTED)) assert.ok(files.includes(required), required);
  for (const root of ['functions/', 'lib/', 'admin/', 'scripts/']) {
    assert.ok(files.some((f) => f.startsWith(root)), root);
  }
  const violations = [];
  for (const file of files) {
    const { refs, fns } = boundaryHits(readFileSync(file, 'utf8'));
    const expected = EXPECTED[file] || { refs: [], fns: [] };
    if (JSON.stringify(refs) !== JSON.stringify(expected.refs) || JSON.stringify(fns) !== JSON.stringify(expected.fns)) {
      violations.push(file);
    }
  }
  assert.deepEqual(violations, []);
});

test('boundary: the check detects every literal specifier form, including C3-2 variants', () => {
  const P = './scripts/ai/taskspec-';
  const moduleOnly = [
    // Existing forms (specifier only; the identifier is avoided on purpose).
    `import { x } from '${P}policy.mjs';`,
    `import { x as y } from '${P}business.mjs';`,
    `import * as b from "${P}business";`,
    `import d from '../taskspec-policy.mjs';`,
    `import 'taskspec-policy.mjs';`,
    `export { x } from './taskspec-business.mjs';`,
    `export * from "./taskspec-policy";`,
    `const m = await import('${P}policy.mjs');`,
    'const m = await import(`./taskspec-business.mjs`);',
    `const r = require('${P}policy');`,
    // C3-2: query, hash, percent-encoded hyphen (both cases), case variants.
    `import { x } from '${P}policy.mjs?v=1';`,
    `import { x } from '${P}business.mjs#frag';`,
    `import { x } from '${P}policy?x';`,
    `import { x } from './scripts/ai/taskspec%2Dpolicy.mjs';`,
    `import { x } from './scripts/ai/taskspec%2dbusiness.mjs';`,
    `import { x } from './scripts/ai/TaskSpec-Policy.MJS';`,
    `import { x } from './scripts/ai/TASKSPEC-BUSINESS';`,
    // Further literal encodings decoded by the same normalization.
    `import { x } from './scripts/ai/taskspec-policy%2Emjs';`,
    `import { x } from './scripts/ai/taskspec${BS}x2dpolicy.mjs';`,
    `import { x } from './scripts/ai/taskspec${BS}u002dbusiness.mjs';`,
    `import { x } from './scripts/ai/taskspec${BS}u{2d}policy.mjs';`,
  ];
  for (const s of moduleOnly) assert.ok(boundaryHits(s).refs.length === 1, s);
  for (const s of ['const fn = lib.validateTaskSpecPolicy;', 'validateTaskSpecBusiness(spec)']) {
    assert.ok(boundaryHits(s).fns.length === 1, s);
  }
  for (const s of [
    "import x from './taskspec-policy-registry.mjs';",
    "import x from './taskspec-policyx.mjs';",
    "import x from './my-taskspec-business.mjs';",
    '// taskspec-policy rules are described in the specs README',
    "import x from './validate-taskspec.mjs';",
  ]) {
    assert.deepEqual(boundaryHits(s), { refs: [], fns: [] }, s);
  }
});

test('boundary: computed specifiers are a documented limitation of this check', () => {
  const computed = "const name = 'policy'; await import('./taskspec-' + name + '.mjs');";
  assert.deepEqual(boundaryHits(computed).refs, []);
});

// ---------------------------------------------------------------- fixture safety

test('fixture safety: composer and this test contain no contiguous credential-shaped string', () => {
  for (const f of ['scripts/ai/validate-taskspec.mjs', 'test/ai/validate-taskspec.node-test.mjs']) {
    assert.equal(containsHighConfidenceSecret(readFileSync(f, 'utf8')), false, f);
  }
});
