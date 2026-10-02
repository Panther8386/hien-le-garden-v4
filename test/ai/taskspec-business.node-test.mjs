// Tests for TaskSpec business and path validation (A3.4b). The validator assumes a
// schema-valid TaskSpec; schema, extraction and policy rules are tested elsewhere.
//
//   node --test test/ai/taskspec-business.node-test.mjs
//
// Named *.node-test.mjs so Vitest never runs it in workerd. No filesystem access: the
// TaskSpec fixture is built inline. The backslash is built at runtime (BS).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BUSINESS_ERRORS,
  covers,
  isCaseAmbiguous,
  overlaps,
  validateTaskSpecBusiness,
} from '../../scripts/ai/taskspec-business.mjs';

const BS = String.fromCharCode(92);
const FILE = 'SPEC-AI-034-task-validation.md';

function baseSpec() {
  return {
    schema_version: 1,
    artifact_type: 'TaskSpec',
    spec_id: 'SPEC-AI-034',
    title: 'Example task',
    objective: 'Example objective.',
    scope: { allowed_paths: ['scripts/', 'docs/ai/specs/README.md'], forbidden_paths: ['scripts/ai/'] },
    requirements: [
      { id: 'R-01', text: 'First requirement.' },
      { id: 'R-02', text: 'Second requirement.' },
    ],
    acceptance_criteria: [{ id: 'AC-01', text: 'Accepted when tests pass.' }],
    constraints: [{ id: 'C-01', category: 'security', text: 'No network.' }],
    deterministic_checks: ['build'],
    semantic_evals: [{ eval_id: 'EV-01', description: 'Quality.', threshold: 0.5 }],
    declared_changes: { package: false, migration: false, production_config: false },
    human_gates: [{ gate_id: 'HG-01', type: 'custom', description: 'Owner review.' }],
    max_iterations: 3,
  };
}

const check = (spec, fileName = FILE) => validateTaskSpecBusiness(spec, { fileName });
const withScope = (allowed, forbidden) => {
  const s = baseSpec();
  s.scope = { allowed_paths: allowed, forbidden_paths: forbidden };
  return s;
};
const rules = (r) => (r.ok ? [] : r.errors.map((e) => `${e.rule} ${e.path}`));

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// ---------------------------------------------------------------- valid baseline

test('valid: baseline TaskSpec passes with exactly { ok: true }', () => {
  assert.deepEqual(check(baseSpec()), { ok: true });
});

// ---------------------------------------------------------------- BR-FILENAME

test('filename: valid names', () => {
  assert.deepEqual(check(baseSpec(), 'SPEC-AI-034-task-validation.md'), { ok: true });
  assert.deepEqual(check(baseSpec(), 'SPEC-AI-034-1-x.md'), { ok: true });
  assert.deepEqual(check(baseSpec(), 'SPEC-AI-034-' + 'a'.repeat(64) + '.md'), { ok: true });
});

const badNames = {
  'spec_id mismatch (longer number)': 'SPEC-AI-0341-x.md',
  'spec_id mismatch (other spec)': 'SPEC-AI-035-task.md',
  malformed: 'task-validation.md',
  'uppercase slug': 'SPEC-AI-034-Task.md',
  'lowercase spec prefix': 'spec-ai-034-task.md',
  'missing slug (dash)': 'SPEC-AI-034-.md',
  'missing slug (no dash)': 'SPEC-AI-034.md',
  'slug with double dash': 'SPEC-AI-034-a--b.md',
  'slug with underscore': 'SPEC-AI-034-a_b.md',
  'uppercase extension': 'SPEC-AI-034-task.MD',
  'wrong extension': 'SPEC-AI-034-task.markdown',
  'no extension': 'SPEC-AI-034-task',
  'path-like': 'docs/ai/specs/SPEC-AI-034-task.md',
  backslash: 'specs' + BS + 'SPEC-AI-034-task.md',
  'traversal-like': '../SPEC-AI-034-task.md',
  empty: '',
  'slug over 64': 'SPEC-AI-034-' + 'a'.repeat(65) + '.md',
  'over 100 chars': 'SPEC-AI-034-' + 'a-'.repeat(43) + 'a.md',
};
for (const [name, fileName] of Object.entries(badNames)) {
  test(`filename: ${name} is BR-FILENAME at ""`, () => {
    const r = check(baseSpec(), fileName);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, [{ rule: 'BR-FILENAME', path: '' }]);
    assert.equal(r.errorCount, 1);
  });
}

test('filename: non-string fileName or missing options throws TypeError', () => {
  assert.throws(() => validateTaskSpecBusiness(baseSpec(), { fileName: undefined }), TypeError);
  assert.throws(() => validateTaskSpecBusiness(baseSpec(), { fileName: 42 }), TypeError);
  assert.throws(() => validateTaskSpecBusiness(baseSpec()), TypeError);
});

// ---------------------------------------------------------------- BR-ID-UNIQUE

const idCases = [
  ['requirements', 'id', { id: 'R-01', text: 'dup' }, '/requirements/2/id'],
  ['acceptance_criteria', 'id', { id: 'AC-01', text: 'dup' }, '/acceptance_criteria/1/id'],
  ['constraints', 'id', { id: 'C-01', category: 'privacy', text: 'dup' }, '/constraints/1/id'],
  ['semantic_evals', 'eval_id', { eval_id: 'EV-01', description: 'dup', threshold: 0.1 }, '/semantic_evals/1/eval_id'],
  ['human_gates', 'gate_id', { gate_id: 'HG-01', type: 'migration', description: 'dup' }, '/human_gates/1/gate_id'],
];
for (const [collection, , dup, ptr] of idCases) {
  test(`ids: duplicate in ${collection} is BR-ID-UNIQUE at the repeat`, () => {
    const s = baseSpec();
    s[collection].push(dup);
    assert.deepEqual(rules(check(s)), [`BR-ID-UNIQUE ${ptr}`]);
  });
}

test('ids: three copies give two violations (second and third)', () => {
  const s = baseSpec();
  s.requirements = [
    { id: 'R-05', text: 'a' },
    { id: 'R-05', text: 'b' },
    { id: 'R-05', text: 'c' },
  ];
  assert.deepEqual(rules(check(s)), ['BR-ID-UNIQUE /requirements/1/id', 'BR-ID-UNIQUE /requirements/2/id']);
});

test('ids: exact-string comparison (R-01 and R-001 are distinct)', () => {
  const s = baseSpec();
  s.requirements = [
    { id: 'R-01', text: 'a' },
    { id: 'R-001', text: 'b' },
  ];
  assert.deepEqual(check(s), { ok: true });
});

// ---------------------------------------------------------------- covers / overlaps

test('covers: approved directory and file semantics (case-sensitive, no slash stripping)', () => {
  const table = [
    ['foo/', 'foo/', true],
    ['foo/', 'foo/bar', true],
    ['foo/', 'foo/bar/', true],
    ['foo/', 'foo/bar.js', true],
    ['foo/bar/', 'foo/barista/file.js', false],
    ['foo/', 'foo', false],
    ['foo', 'foo/', false],
    ['foo', 'foo/bar', false],
    ['foo/bar.js', 'foo/bar.js', true],
    ['foo/', 'Foo/bar', false],
    ['Foo', 'foo', false],
  ];
  for (const [scope, target, expected] of table) assert.equal(covers(scope, target), expected, `${scope} ${target}`);
});

test('overlaps: symmetric, covers-based; file foo and directory foo/ are disjoint', () => {
  assert.equal(overlaps('scripts/', 'scripts/ai/'), true);
  assert.equal(overlaps('scripts/ai/', 'scripts/'), true);
  assert.equal(overlaps('docs/x.md', 'docs/x.md'), true);
  assert.equal(overlaps('foo', 'foo/'), false);
  assert.equal(overlaps('foo/', 'foo'), false);
  assert.equal(overlaps('foo/bar/', 'foo/barista/'), false);
  assert.equal(overlaps('src/', 'lib/'), false);
});

// ---------------------------------------------------------------- BR-SCOPE-CONFLICT

test('conflict: forbidden narrower than allowed directory is valid narrowing', () => {
  assert.deepEqual(check(withScope(['scripts/'], ['scripts/ai/'])), { ok: true });
});

test('conflict: allowed file under forbidden directory fails at the allowed entry', () => {
  assert.deepEqual(rules(check(withScope(['docs/a.md', 'scripts/x.js'], ['scripts/']))), ['BR-SCOPE-CONFLICT /scope/allowed_paths/1']);
});

test('conflict: identical allowed and forbidden entries fail', () => {
  assert.deepEqual(rules(check(withScope(['docs/'], ['docs/']))), ['BR-SCOPE-CONFLICT /scope/allowed_paths/0']);
});

test('conflict: unrelated forbidden entry is valid', () => {
  assert.deepEqual(check(withScope(['scripts/'], ['migrations/', '.github/'])), { ok: true });
});

test('conflict: allowed file foo with forbidden directory foo/ is valid (disjoint)', () => {
  assert.deepEqual(check(withScope(['foo'], ['foo/'])), { ok: true });
});

test('conflict: an allowed entry covered by several forbidden entries is reported once', () => {
  const r = check(withScope(['a/b/c.js'], ['a/', 'a/b/', 'a/b/c.js']));
  assert.deepEqual(rules(r), ['BR-SCOPE-CONFLICT /scope/allowed_paths/0']);
  assert.equal(r.errorCount, 1);
});

// ---------------------------------------------------------------- case ambiguity

const ambiguous = [
  ['migrations/', 'Migrations/'],
  ['Docs/x.md', 'docs/'],
  ['Foo', 'foo/'],
  ['README.md', 'readme.md'],
  ['Scripts/', 'scripts/ai/'],
];
const notAmbiguous = [
  ['docs/', 'docs/A.md'],
  ['docs/a.md', 'docs/B.md'],
  ['src/', 'lib/'],
  ['foo', 'foo/'],
  ['docs/', 'docs/'],
];

test('case: required ambiguous pairs (both orders)', () => {
  for (const [a, b] of ambiguous) {
    assert.equal(isCaseAmbiguous(a, b), true, `${a} ${b}`);
    assert.equal(isCaseAmbiguous(b, a), true, `${b} ${a}`);
  }
});

test('case: required non-ambiguous pairs (both orders)', () => {
  for (const [a, b] of notAmbiguous) {
    assert.equal(isCaseAmbiguous(a, b), false, `${a} ${b}`);
    assert.equal(isCaseAmbiguous(b, a), false, `${b} ${a}`);
  }
});

test('case: covers/overlaps never fold or strip (separation from ambiguity logic)', () => {
  assert.equal(covers('Scripts/', 'scripts/ai/x.js'), false);
  assert.equal(overlaps('Scripts/', 'scripts/ai/'), false);
  assert.equal(overlaps('Foo', 'foo/'), false);
  assert.equal(isCaseAmbiguous('Scripts/', 'scripts/ai/'), true);
});

test('case: allowed Scripts/ with forbidden scripts/ai/ (deny-bypass) is rejected at the forbidden entry', () => {
  assert.deepEqual(rules(check(withScope(['Scripts/'], ['scripts/ai/']))), ['BR-PATH-CASE-AMBIGUOUS /scope/forbidden_paths/0']);
});

test('case: ambiguity within allowed_paths is reported at the later entry', () => {
  assert.deepEqual(rules(check(withScope(['migrations/', 'docs/', 'Migrations/'], []))), [
    'BR-PATH-CASE-AMBIGUOUS /scope/allowed_paths/2',
  ]);
});

test('case: non-ambiguous declarations pass', () => {
  assert.deepEqual(check(withScope(['docs/', 'docs/A.md', 'src/'], ['lib/', 'docs/B/'])), { ok: true });
});

// ---------------------------------------------------------------- error model

test('errors: multiple rules together, sorted by path then rule, de-duplicated', () => {
  const s = withScope(['Docs/x.md', 'docs/', 'scripts/a.js'], ['scripts/', 'docs/']);
  s.requirements.push({ id: 'R-02', text: 'dup' });
  const r = check(s, 'bad-name.md');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_TASKSPEC_BUSINESS');
  assert.deepEqual(rules(r), [
    'BR-FILENAME ',
    'BR-ID-UNIQUE /requirements/2/id',
    'BR-PATH-CASE-AMBIGUOUS /scope/allowed_paths/1',
    'BR-SCOPE-CONFLICT /scope/allowed_paths/1',
    'BR-SCOPE-CONFLICT /scope/allowed_paths/2',
    'BR-PATH-CASE-AMBIGUOUS /scope/forbidden_paths/1',
  ]);
  assert.equal(r.errorCount, 6);
  for (const e of r.errors) assert.deepEqual(Object.keys(e), ['rule', 'path']);
});

test('errors: more than 20 unique violations returns 20 with the full errorCount', () => {
  const s = baseSpec();
  s.requirements = Array.from({ length: 50 }, (_, i) => ({ id: 'R-09', text: `t${i}` }));
  const r = check(s);
  assert.equal(r.errorCount, 49);
  assert.equal(r.errors.length, MAX_BUSINESS_ERRORS);
  assert.equal(MAX_BUSINESS_ERRORS, 20);
  const keys = r.errors.map((e) => e.path);
  const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(keys, sorted);
});

test('errors: output contains no file name, spec_id, ID, path or text values', () => {
  const s = withScope(['LeakDir/secret-file.md', 'leakdir/'], ['Zebra-forbidden/', 'zebra-forbidden/']);
  s.requirements = [
    { id: 'R-77', text: 'sensitive requirement text' },
    { id: 'R-77', text: 'another sensitive text' },
  ];
  s.title = 'Sensitive title';
  const r = check(s, 'SPEC-AI-999-leak-check-name.md');
  assert.equal(r.ok, false);
  const out = JSON.stringify(r);
  for (const leak of ['LeakDir', 'leakdir', 'secret-file', 'Zebra', 'zebra', 'R-77', 'sensitive', 'Sensitive', 'leak-check', 'SPEC-AI']) {
    assert.ok(!out.includes(leak), leak);
  }
});

// ---------------------------------------------------------------- purity / preconditions

test('purity: deep-frozen input validates, is unchanged, and results repeat exactly', () => {
  const spec = deepFreeze(baseSpec());
  const snapshot = structuredClone(spec);
  const first = check(spec);
  const second = check(spec);
  assert.deepEqual(first, { ok: true });
  assert.deepEqual(second, first);
  assert.deepEqual(spec, snapshot);

  const bad = deepFreeze(withScope(['Docs/x.md', 'docs/', 'scripts/a.js'], ['scripts/', 'docs/']));
  const badSnapshot = structuredClone(bad);
  assert.deepEqual(check(bad, 'x.md'), check(bad, 'x.md'));
  assert.deepEqual(bad, badSnapshot);
});

test('preconditions: non-object spec throws TypeError', () => {
  for (const v of [null, undefined, 'spec', 7, []]) assert.throws(() => validateTaskSpecBusiness(v, { fileName: FILE }), TypeError);
});

test('preconditions: malformed deeper object never returns ok:true', () => {
  const noScope = baseSpec();
  delete noScope.scope;
  assert.throws(() => check(noScope), TypeError);
  const noRequirements = baseSpec();
  delete noRequirements.requirements;
  assert.throws(() => check(noRequirements), TypeError);
  const noForbidden = baseSpec();
  delete noForbidden.scope.forbidden_paths;
  assert.throws(() => check(noForbidden), TypeError);
});
