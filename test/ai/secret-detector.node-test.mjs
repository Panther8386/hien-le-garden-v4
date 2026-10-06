// Tests for the shared high-confidence secret detector (A3.4d.2, ADR-AI-009, finding F3).
//
//   node --test test/ai/secret-detector.node-test.mjs
//
// Named *.node-test.mjs so Vitest never runs it in workerd. Every credential-shaped fixture is
// SYNTHETIC and assembled at runtime from harmless fragments; no real credential is used and
// no contiguous credential-shaped string is committed. Nothing is logged.
//
// Equivalence method: the new detector is compared with a TEST-ONLY LEGACY ORACLE (the exact
// pre-remediation pattern set) on hand-written edge cases, systematic grids and deterministic
// generated corpora (fixed-seed PRNG, bounded lengths and counts). The legacy oracle is only
// ever run on short inputs; the large adversarial inputs run against the new detector only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { containsHighConfidenceSecret as detect } from '../../scripts/ai/secret-detector.mjs';
import { containsHighConfidenceSecret as policyExport } from '../../scripts/ai/taskspec-policy.mjs';

// ---------------------------------------------------------------- TEST-ONLY LEGACY ORACLE
// Exact copy of the detector as it was in scripts/ai/taskspec-policy.mjs at cd59725 (before
// A3.4d.2), including the quadratic `sk-` regex. Test-only: never imported by production code.

const DASH5 = '-'.repeat(5);
const LEGACY_TOKEN_CHARS = 'A-Za-z0-9._~+/-';
const LEGACY_PATTERNS = [
  new RegExp(`${DASH5}BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY${DASH5}`),
  new RegExp('(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36}(?![A-Za-z0-9])'),
  new RegExp('(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{80,}'),
  new RegExp('(?<![A-Za-z0-9_])x(?:key|smtp)sib-[0-9a-f]{64}-[A-Za-z0-9]{16}(?![A-Za-z0-9])'),
  new RegExp('(?<![0-9])[0-9]{8,10}:AA[A-Za-z0-9_-]{33}(?![A-Za-z0-9_-])'),
  new RegExp(
    `Authorization:[ \\t]*Bearer[ \\t]+(?=[${LEGACY_TOKEN_CHARS}]*[0-9])(?=[${LEGACY_TOKEN_CHARS}]*[A-Za-z])[${LEGACY_TOKEN_CHARS}]{20,}`,
    'i',
  ),
  new RegExp('(?<![A-Za-z0-9_])sk-(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{40,}'),
];
const MAX_ORACLE_INPUT = 4096; // the oracle is quadratic on adversarial input: keep it small
function legacyOracle(text) {
  assert.ok(text.length <= MAX_ORACLE_INPUT, 'legacy oracle input too large');
  return LEGACY_PATTERNS.some((re) => re.test(text));
}

function same(text) {
  assert.equal(detect(text), legacyOracle(text), `divergence at length ${text.length}`);
}

// ---------------------------------------------------------------- deterministic PRNG

const SEED = 0x20261006;
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- synthetic fixtures

const SK = 's' + 'k-';
const F = {
  pem: () => DASH5 + 'BEGIN ' + 'RSA ' + 'PRIVATE' + ' KEY' + DASH5,
  pemPlain: () => DASH5 + 'BEGIN ' + 'PRIVATE' + ' KEY' + DASH5,
  ghClassic: () => 'gh' + 'p' + '_' + 'Ab1'.repeat(12),
  ghOther: () => 'gh' + 's' + '_' + 'Zz9'.repeat(12),
  ghFine: () => 'github' + '_pat_' + 'Ab1_'.repeat(20),
  brevo: () => 'x' + 'keysib' + '-' + 'a1'.repeat(32) + '-' + 'Ab1Cd2Ef3Gh4Ij5K',
  brevoSmtp: () => 'x' + 'smtpsib' + '-' + 'b2'.repeat(32) + '-' + 'Zy9Xw8Vu7Ts6Rq5P',
  telegram: () => '1234' + '56789' + ':' + 'A' + 'A' + 'b1_'.repeat(11),
  bearer: () => 'Author' + 'ization: ' + 'Bear' + 'er ' + 'Ab1.'.repeat(5),
  skKey: () => SK + 'proj-' + 'Ab1'.repeat(15),
};

// ---------------------------------------------------------------- API / compatibility

test('api: taskspec-policy re-exports the shared detector (same function)', () => {
  assert.equal(policyExport, detect);
});

test('api: non-string input throws TypeError (legacy behaviour preserved)', () => {
  for (const v of [42, null, undefined, {}, [], true, new String('text')]) {
    assert.throws(() => detect(v), { name: 'TypeError', message: 'containsHighConfidenceSecret: text must be a string' });
  }
});

test('api: result is a plain boolean and repeated calls are stateless', () => {
  const inputs = [F.skKey(), 'plain text', F.ghClassic(), '', F.bearer(), SK + 'a'];
  const first = inputs.map(detect);
  for (const r of first) assert.equal(typeof r, 'boolean');
  for (let round = 0; round < 3; round++) assert.deepEqual([...inputs].reverse().map(detect).reverse(), first);
  assert.deepEqual(first, [true, false, true, false, true, false]);
});

// ---------------------------------------------------------------- all patterns

test('patterns: every supported class is detected alone and embedded in prose', () => {
  for (const [name, make] of Object.entries(F)) {
    for (const text of [make(), 'prefix text ' + make() + ' suffix text', 'line one\n' + make() + '\nline three']) {
      assert.equal(detect(text), true, name);
      same(text);
    }
  }
});

test('patterns: bare words, variable names, placeholders and near misses do not trigger', () => {
  for (const text of [
    '',
    'password secret token key api_key credentials',
    'OPENAI_API_KEY TELEGRAM_BOT_TOKEN BREVO_API_KEY TURNSTILE_SECRET_KEY CLOUDFLARE_API_TOKEN',
    'someone@example.com +84 912 345 678',
    'Authorization: Bearer <token>',
    'Authorization: Bearer your-access-token-goes-here',
    SK + 'abcdefghij'.repeat(5),
    SK + 'Ab1'.repeat(10),
    'docs/ai/specs/SPEC-AI-001-skeleton-key-token-handling.md',
    'gh' + 'p' + '_' + 'Ab1'.repeat(11) + 'Ab',
    'gh' + 'x' + '_' + 'Ab1'.repeat(12),
    'x' + 'keysib' + '-' + 'a1'.repeat(31) + '-' + 'Ab1Cd2Ef3Gh4Ij5K',
    '1234' + '56789' + ':' + 'B' + 'B' + 'b1_'.repeat(11),
    DASH5 + 'BEGIN ' + 'PUBLIC' + ' KEY' + DASH5,
  ]) {
    assert.equal(detect(text), false, 'false positive');
    same(text);
  }
});

test('patterns: length and boundary edges of the fixed-structure formats', () => {
  const cases = [
    // GitHub classic: exactly 36 after the prefix, not followed by an alphanumeric.
    ['gh' + 'p_' + 'a1B'.repeat(12), true],
    ['gh' + 'p_' + 'a1B'.repeat(12).slice(0, 35), false],
    ['gh' + 'p_' + 'a1B'.repeat(12) + 'c', false],
    ['x' + 'gh' + 'p_' + 'a1B'.repeat(12), false],
    ['_' + 'gh' + 'p_' + 'a1B'.repeat(12), false],
    ['-' + 'gh' + 'p_' + 'a1B'.repeat(12), true],
    // GitHub fine-grained: 80 or more after the prefix.
    ['github' + '_pat_' + 'a'.repeat(80), true],
    ['github' + '_pat_' + 'a'.repeat(79), false],
    ['a' + 'github' + '_pat_' + 'a'.repeat(80), false],
    // Brevo: 64 lowercase hex, dash, 16 alphanumerics.
    ['x' + 'keysib-' + 'f'.repeat(64) + '-' + 'A'.repeat(16), true],
    ['x' + 'keysib-' + 'f'.repeat(63) + '-' + 'A'.repeat(16), false],
    ['x' + 'keysib-' + 'F'.repeat(64) + '-' + 'A'.repeat(16), false],
    ['x' + 'keysib-' + 'f'.repeat(64) + '-' + 'A'.repeat(17), false],
    // Telegram: 8-10 digits not preceded by a digit, ':AA', 33 characters.
    ['1234' + '5678' + ':AA' + 'b'.repeat(33), true],
    ['1234' + '567' + ':AA' + 'b'.repeat(33), false],
    ['1234' + '567890' + ':AA' + 'b'.repeat(33), true],
    ['1234' + '5678901' + ':AA' + 'b'.repeat(33), false],
    ['1234' + '5678' + ':AA' + 'b'.repeat(32), false],
    ['1234' + '5678' + ':AA' + 'b'.repeat(34), false],
    // Authorization: 20 or more token characters with a digit and a letter (case-insensitive).
    ['author' + 'ization: bearer ' + 'a1'.repeat(10), true],
    ['Author' + 'ization:\tBearer\t' + 'a1'.repeat(10), true],
    ['Author' + 'ization: Bearer ' + 'a1'.repeat(9) + 'a', false],
    ['Author' + 'ization: Bearer ' + 'ab'.repeat(10), false],
    ['Author' + 'ization: Bearer ' + '12'.repeat(10), false],
    // PEM: header with optional uppercase words before PRIVATE KEY.
    [DASH5 + 'BEGIN ' + 'EC ' + 'OPENSSH ' + 'PRIVATE' + ' KEY' + DASH5, true],
    [DASH5 + 'BEGIN ' + 'ec ' + 'PRIVATE' + ' KEY' + DASH5, false],
    [DASH5.slice(1) + 'BEGIN ' + 'PRIVATE' + ' KEY' + DASH5, false],
  ];
  for (const [text, expected] of cases) {
    assert.equal(detect(text), expected, `edge case length ${text.length}`);
    same(text);
  }
});

// ---------------------------------------------------------------- sk- (F3) equivalence

test('sk: 39 / 40 / 41 run characters, digit and uppercase requirements', () => {
  const run = (n, digit, upper) => {
    const body = Array.from({ length: n }, () => 'a');
    if (digit) body[0] = '7';
    if (upper) body[n - 1] = 'Q';
    return body.join('');
  };
  for (const n of [0, 1, 38, 39, 40, 41, 42, 80]) {
    for (const digit of [false, true]) {
      for (const upper of [false, true]) {
        const text = SK + run(n, digit && n > 0, upper && n > 1);
        const expected = n >= 40 && digit && upper;
        assert.equal(detect(text), expected, `n=${n} digit=${digit} upper=${upper}`);
        same(text);
      }
    }
  }
});

// F3-R1 (independent review, LOW): the only uppercase letter is exactly A or Z and the only
// digit is exactly 0 or 9, at 39 / 40 / 41 run characters. Fails if A-Z or 0-9 were narrowed.
test('sk: range endpoints A, Z, 0 and 9 as the only qualifying characters', () => {
  for (const upper of ['A', 'Z']) {
    for (const digit of ['0', '9']) {
      for (const n of [39, 40, 41]) {
        const lower = 'q'.repeat(n - 2);
        for (const body of [upper + digit + lower, lower + digit + upper, digit + lower + upper]) {
          const text = SK + body;
          assert.equal(detect(text), n >= 40, `upper=${upper} digit=${digit} n=${n}`);
          same(text);
        }
      }
    }
  }
  // Each endpoint alone, with the other requirement met by a mid-range character.
  for (const [ch, other] of [['A', '5'], ['Z', '5'], ['0', 'M'], ['9', 'M']]) {
    assert.equal(detect(SK + ch + other + 'q'.repeat(38)), true, ch);
    assert.equal(detect(SK + ch + 'q'.repeat(39)), false, ch + ' alone');
  }
});

test('sk: systematic grid of boundaries, compositions and suffixes matches the legacy oracle', () => {
  const before = ['', 'a', 'Z', '5', '_', '-', ' ', '.', ':', '/', '\n', '\t', 'é'];
  const bodies = [];
  for (const n of [0, 1, 39, 40, 41]) {
    bodies.push('a'.repeat(n));
    bodies.push('7' + 'a'.repeat(Math.max(0, n - 1)));
    bodies.push('Q' + 'a'.repeat(Math.max(0, n - 1)));
    bodies.push(('7Q' + 'a'.repeat(n)).slice(0, n));
    bodies.push(('a'.repeat(n) + 'Q7').slice(-n || n));
    bodies.push(('-_'.repeat(n)).slice(0, Math.max(0, n - 2)) + '7Q');
  }
  const after = ['', ' ', '.', 'x', 'Q', '7', '-', '_', '\n', ':'];
  let count = 0;
  let positives = 0;
  for (const b of before) {
    for (const body of bodies) {
      for (const a of after) {
        const text = b + SK + body + a;
        same(text);
        if (detect(text)) positives++;
        count++;
      }
    }
  }
  assert.ok(count > 2000 && positives > 100 && positives < count, `grid ${count} / ${positives}`);
});

test('sk: several prefixes inside one token run', () => {
  const ok40 = 'Ab1'.repeat(14); // 42 run chars with digit and uppercase
  const cases = [
    [SK + SK + SK + ok40, true],
    [SK + 'a'.repeat(10) + '-' + SK + ok40, true],
    ['x' + SK + 'a'.repeat(10) + '-' + SK + ok40, true], // outer blocked, inner valid
    ['x' + SK + ok40, false], // only candidate blocked by a letter
    ['_' + SK + ok40, false],
    ['9' + SK + ok40, false],
    ['-' + SK + ok40, true],
    [SK + 'a'.repeat(50) + '-' + SK + 'a'.repeat(30), false], // no digit/uppercase anywhere
    [SK + 'Q'.repeat(20) + '-' + SK + '7'.repeat(20), true], // whole run from the first prefix
    [SK + 'a'.repeat(5) + 'x' + SK + ok40, true], // inner prefix after a letter is blocked, outer succeeds
    ['x' + SK + 'a'.repeat(5) + 'x' + SK + ok40, false], // both blocked
    [SK + 'Ab1'.repeat(13) + ' ' + SK + ok40, true], // first run 39 chars fails, second run succeeds
    [SK + 'Ab1'.repeat(13) + ' ' + SK + 'ab'.repeat(30), false],
  ];
  for (const [text, expected] of cases) {
    assert.equal(detect(text), expected, `multi-prefix length ${text.length}`);
    same(text);
  }
});

test('sk: prefix at start, at end and truncated prefixes', () => {
  for (const text of [SK, 's', 'sk', 'k-', 'x' + SK, SK + 'Ab1'.repeat(14), 'text ' + SK, 'text ' + SK + 'Ab1'.repeat(14)]) {
    same(text);
  }
  assert.equal(detect('text ' + SK), false);
  assert.equal(detect('text ' + SK + 'Ab1'.repeat(14)), true);
});

const SEGMENTS = [
  SK, 'sk', 's', 'k', '-', '_', 'A', 'Q', 'a', 'z', '0', '7', ' ', '\n', '.', ':', 'x',
  'a' + SK, '_' + SK, '9' + SK, '-' + SK,
  'aaaaaaaaaa', 'QQQQQQQQQQ', '0123456789', 'Ab1Cd2Ef3G', 'abcdefghij', '-_-_-_-_-_',
];
const GENERATED_SEGMENT_CASES = 20000;
const GENERATED_CHAR_CASES = 10000;

test(`sk: ${GENERATED_SEGMENT_CASES} generated segment strings (seed 0x20261006) match the legacy oracle`, () => {
  const rnd = mulberry32(SEED);
  let positives = 0;
  let maxLen = 0;
  for (let i = 0; i < GENERATED_SEGMENT_CASES; i++) {
    const parts = 1 + Math.floor(rnd() * 20);
    let text = '';
    for (let j = 0; j < parts; j++) text += SEGMENTS[Math.floor(rnd() * SEGMENTS.length)];
    same(text);
    if (detect(text)) positives++;
    maxLen = Math.max(maxLen, text.length);
  }
  // Coverage, not semantics: both outcomes must be well represented in the corpus.
  assert.ok(positives > 200 && positives < GENERATED_SEGMENT_CASES - 200, `positives ${positives}`);
  assert.ok(maxLen <= 20 * 12);
});

test(`sk: ${GENERATED_CHAR_CASES} generated character strings (seed 0x20261007) match the legacy oracle`, () => {
  const alphabet = ['s', 'k', '-', 'A', 'Z', 'a', 'z', '0', '1', '9', '_', ' ', '\n', '.', ':'];
  const rnd = mulberry32(SEED + 1);
  for (let i = 0; i < GENERATED_CHAR_CASES; i++) {
    const len = Math.floor(rnd() * 96);
    let text = '';
    for (let j = 0; j < len; j++) text += alphabet[Math.floor(rnd() * alphabet.length)];
    same(text);
  }
});

// ---------------------------------------------------------------- large adversarial input (new detector only)

const MAX_MARKDOWN = 2_097_152; // MAX_TASKSPEC_MARKDOWN_BYTES; ASCII, so characters = bytes
const BOUND_MS = 2000; // coarse: the legacy detector needs minutes on the sk- shapes below
const fill = (unit) => unit.repeat(Math.ceil(MAX_MARKDOWN / unit.length)).slice(0, MAX_MARKDOWN);

function timed(text) {
  const t0 = performance.now();
  const result = detect(text);
  return { result, ms: performance.now() - t0 };
}

test('large: 2,097,152-character adversarial inputs complete within a coarse bound with no match', () => {
  const shapes = {
    'sk- repeated (lowercase only)': fill(SK),
    'sk- with digit, no uppercase': fill(SK + '1-'),
    'sk- with uppercase, no digit': fill(SK + 'Q-'),
    'blocked sk- candidates': fill('a' + SK),
    'Authorization header repeated': fill('Author' + 'ization: Bearer abcdefghij '),
    'PEM header words': DASH5 + 'BEGIN ' + fill('AB ').slice(11),
    'digits and :AA repeated': fill('1234' + '5678:AA'),
    'GitHub classic prefix repeated': fill('gh' + 'p_'),
    'plain prose': fill('lorem ipsum dolor sit amet '),
  };
  for (const [name, text] of Object.entries(shapes)) {
    assert.equal(text.length, MAX_MARKDOWN, name);
    const { result, ms } = timed(text);
    assert.equal(result, false, name);
    assert.ok(ms < BOUND_MS, `${name}: ${Math.round(ms)} ms`);
  }
});

test('large: a secret at the start or the end of a 2,097,152-character adversarial input is found', () => {
  const key = F.skKey();
  const tail = ' ' + key;
  const atEnd = fill(SK).slice(0, MAX_MARKDOWN - tail.length) + tail;
  const atStart = key + ' ' + fill(SK).slice(0, MAX_MARKDOWN - key.length - 1);
  for (const text of [atEnd, atStart]) {
    assert.equal(text.length, MAX_MARKDOWN);
    const { result, ms } = timed(text);
    assert.equal(result, true);
    assert.ok(ms < BOUND_MS, `${Math.round(ms)} ms`);
  }
});

// ---------------------------------------------------------------- no leakage / no logging

test('leakage: the detector writes nothing to the console or standard streams', () => {
  const calls = [];
  const saved = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    saved[m] = console[m];
    console[m] = () => calls.push(m);
  }
  const savedOut = process.stdout.write;
  const savedErr = process.stderr.write;
  process.stdout.write = () => calls.push('stdout') || true;
  process.stderr.write = () => calls.push('stderr') || true;
  try {
    for (const make of Object.values(F)) detect('context ' + make() + ' context');
    detect(fill(SK).slice(0, 10000));
  } finally {
    for (const m of Object.keys(saved)) console[m] = saved[m];
    process.stdout.write = savedOut;
    process.stderr.write = savedErr;
  }
  assert.deepEqual(calls, []);
});

// ---------------------------------------------------------------- fixture safety

test('fixture safety: detector, policy and this test contain no contiguous credential-shaped string', () => {
  for (const f of ['scripts/ai/secret-detector.mjs', 'scripts/ai/taskspec-policy.mjs', 'test/ai/secret-detector.node-test.mjs']) {
    assert.equal(detect(readFileSync(f, 'utf8')), false, f);
  }
});
