// Tests for TaskSpec business and path validation (A3.4b) and the common repository path
// policy L0 (A3.5a, scripts/ai/repo-path.mjs, ADR-AI-010). The validator assumes a
// schema-valid TaskSpec; schema, extraction and policy rules are tested elsewhere (policy
// is imported only for the F1 layer-contract and protected-case tests).
//
//   node --test test/ai/taskspec-business.node-test.mjs
//
// Named *.node-test.mjs so Vitest never runs it in workerd. TaskSpec fixtures are built
// inline; the only files read are the V1 common schema and repo-path.mjs (to check that the
// L0 grammar matches the schema and that the module stays pure). The backslash is built at
// runtime (BS).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REPO_FILE_PATH_PATTERN,
  REPO_PATH_MAX_LENGTH,
  SCOPE_PATH_PATTERN,
  isSafeRepoPath,
  repoPathViolations,
} from '../../scripts/ai/repo-path.mjs';
import { isProtectedPathCaseAlias } from '../../scripts/ai/taskspec-policy-registry.mjs';
import {
  MAX_BUSINESS_ERRORS,
  covers,
  isCaseAmbiguous,
  overlaps,
  validateTaskSpecBusiness,
} from '../../scripts/ai/taskspec-business.mjs';
import { validateTaskSpecPolicy } from '../../scripts/ai/taskspec-policy.mjs';

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

// ---------------------------------------------------------------- BR-PATH-TRAILING-DOT (F1)

// Schema-valid scope paths that Windows resolves to protected entries by stripping the
// trailing dot. Before this rule they passed business and policy validation.
const F1_PROBES = [
  'CLAUDE.md.',
  'package.json.',
  'wrangler.toml.',
  'scripts/ai./taskspec-policy.mjs',
  'migrations./0044_x.sql',
  '.github./workflows/deploy.yml',
  'docs/ai/adr./ADR-AI-009.md',
];
const TRAILING_DOT_SHAPES = ['docs/ai/adr./', 'a./b/c', 'a./b./c.', 'a..', 'x/.../y'];
const DOT_CONTROLS = [
  '.github/',
  '.github/workflows/deploy.yml',
  'docs/ai/',
  'file.name',
  'foo.bar/baz.txt',
  'a/.b/c',
  '.env.example',
  'migrations/',
  'CLAUDE.md',
];

for (const p of [...F1_PROBES, ...TRAILING_DOT_SHAPES]) {
  test(`trailing dot: allowed ${JSON.stringify(p)} is BR-PATH-TRAILING-DOT`, () => {
    const r = check(withScope([p], []));
    assert.equal(r.code, 'E_TASKSPEC_BUSINESS');
    assert.deepEqual(r.errors, [{ rule: 'BR-PATH-TRAILING-DOT', path: '/scope/allowed_paths/0' }]);
    assert.equal(r.errorCount, 1);
  });
}

test('trailing dot: forbidden entries are rejected with the forbidden pointer', () => {
  for (const p of [...F1_PROBES, ...TRAILING_DOT_SHAPES]) {
    assert.deepEqual(rules(check(withScope(['src/'], [p]))), ['BR-PATH-TRAILING-DOT /scope/forbidden_paths/0'], p);
  }
});

test('trailing dot: a forbidden alias never stands in for excluding the canonical path', () => {
  // "CLAUDE.md." does not cover "CLAUDE.md"; the forbidden entry is rejected rather than
  // being accepted as an apparent exclusion.
  assert.deepEqual(rules(check(withScope(['CLAUDE.md'], ['CLAUDE.md.']))), ['BR-PATH-TRAILING-DOT /scope/forbidden_paths/0']);
  assert.deepEqual(rules(check(withScope(['scripts/'], ['scripts/ai./']))), ['BR-PATH-TRAILING-DOT /scope/forbidden_paths/0']);
});

test('trailing dot: controls with inner or leading dots stay valid in both lists', () => {
  for (const p of DOT_CONTROLS) {
    assert.deepEqual(check(withScope([p], [])), { ok: true }, `allowed ${p}`);
    assert.deepEqual(check(withScope(['src/'], [p])), { ok: true }, `forbidden ${p}`);
  }
});

test('trailing dot: only offending entries are reported, at their own index', () => {
  const r = check(withScope(['docs/', 'src/', 'a./b', 'lib/file.name'], ['x/', 'y./', 'z.txt']));
  assert.deepEqual(rules(r), ['BR-PATH-TRAILING-DOT /scope/allowed_paths/2', 'BR-PATH-TRAILING-DOT /scope/forbidden_paths/1']);
  assert.equal(r.errorCount, 2);
});

test('trailing dot: one error per entry even with several dotted segments', () => {
  const r = check(withScope(['a./b./c.'], ['d./e.']));
  assert.deepEqual(rules(r), ['BR-PATH-TRAILING-DOT /scope/allowed_paths/0', 'BR-PATH-TRAILING-DOT /scope/forbidden_paths/0']);
  assert.equal(r.errorCount, 2);
});

test('trailing dot: coexists with existing rules, sorted by path then rule', () => {
  const r = check(withScope(['CLAUDE.md.', 'Docs/x.md', 'docs/', 'scripts/a./x.js'], ['scripts/']));
  assert.deepEqual(rules(r), [
    'BR-PATH-TRAILING-DOT /scope/allowed_paths/0',
    'BR-PATH-CASE-AMBIGUOUS /scope/allowed_paths/2',
    'BR-PATH-TRAILING-DOT /scope/allowed_paths/3',
    'BR-SCOPE-CONFLICT /scope/allowed_paths/3',
  ]);
  assert.equal(r.errorCount, 4);
});

test('trailing dot: a case-ambiguous dotted pair reports both rules', () => {
  assert.deepEqual(rules(check(withScope(['Migrations./'], ['migrations./']))), [
    'BR-PATH-TRAILING-DOT /scope/allowed_paths/0',
    'BR-PATH-CASE-AMBIGUOUS /scope/forbidden_paths/0',
    'BR-PATH-TRAILING-DOT /scope/forbidden_paths/0',
  ]);
});

test('trailing dot: more than 20 violations returns 20 sorted with the full errorCount', () => {
  const allowed = Array.from({ length: 25 }, (_, i) => `d${i}./`);
  const r = check(withScope(allowed, []));
  assert.equal(r.errorCount, 25);
  assert.equal(r.errors.length, MAX_BUSINESS_ERRORS);
  assert.ok(r.errors.every((e) => e.rule === 'BR-PATH-TRAILING-DOT'));
  const keys = r.errors.map((e) => e.path);
  assert.deepEqual(keys, [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
});

test('trailing dot: errors contain no path values', () => {
  const r = check(withScope([...F1_PROBES], ['docs/ai/adr./']));
  assert.equal(r.ok, false);
  const out = JSON.stringify(r);
  for (const leak of ['CLAUDE', 'package', 'wrangler', 'taskspec-policy', '0044', 'deploy', 'ADR-AI', 'adr.', '.github']) {
    assert.ok(!out.includes(leak), leak);
  }
});

// F1 layer contract: a schema-valid alias path stops at BUSINESS and is never presented
// to A3.4c policy as a business-valid TaskSpec. Policy itself is unchanged.
function businessThenPolicy(spec) {
  const business = check(spec);
  if (!business.ok) return { stage: 'BUSINESS', result: business };
  return { stage: 'POLICY', result: validateTaskSpecPolicy(spec) };
}

test('F1 layer contract: every confirmed alias path is rejected before policy', () => {
  for (const p of F1_PROBES) {
    const { stage, result } = businessThenPolicy(withScope([p], []));
    assert.equal(stage, 'BUSINESS', p);
    assert.deepEqual(result.errors, [{ rule: 'BR-PATH-TRAILING-DOT', path: '/scope/allowed_paths/0' }], p);
  }
});

test('F1 layer contract: the canonical paths still reach policy and are classified', () => {
  const claude = businessThenPolicy(withScope(['CLAUDE.md'], []));
  assert.equal(claude.stage, 'POLICY');
  assert.deepEqual(claude.result, { ok: true, protectedCategories: ['GOVERNANCE'] });
  const wrangler = businessThenPolicy(withScope(['wrangler.toml'], []));
  assert.equal(wrangler.stage, 'POLICY');
  assert.equal(wrangler.result.ok, false);
  assert.ok(wrangler.result.errors.some((e) => e.rule === 'POL-GATE-PRODUCTION'));
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

// ---------------------------------------------------------------- common path policy L0 (A3.5a)

const l0 = (p, options) => repoPathViolations(p, options);

test('L0: grammar patterns and length limit are identical to the V1 common schema', () => {
  const defs = JSON.parse(readFileSync('docs/ai/contracts/schemas/v1/common.schema.json', 'utf8')).$defs;
  assert.equal(REPO_FILE_PATH_PATTERN, defs.RepoFilePath.pattern);
  assert.equal(SCOPE_PATH_PATTERN, defs.ScopePath.pattern);
  assert.equal(REPO_PATH_MAX_LENGTH, defs.RepoFilePath.maxLength);
  assert.equal(REPO_PATH_MAX_LENGTH, defs.ScopePath.maxLength);
  assert.equal(defs.RepoFilePath.minLength, 1);
});

test('L0: the module is pure (no imports, platform, environment, filesystem or process use)', () => {
  const source = readFileSync('scripts/ai/repo-path.mjs', 'utf8');
  for (const forbidden of [/^\s*import\s/m, /\bimport\(/, /\brequire\(/, /\bprocess\./, /node:/, /\bfs\./, /\bpath\.(?:resolve|join|normalize)/]) {
    assert.ok(!forbidden.test(source), String(forbidden));
  }
});

test('L0: measured A3.5-PRE cases', () => {
  const cases = [
    ['CLAUDE.md.', ['PATH-TRAILING-DOT']],
    ['...', ['PATH-TRAILING-DOT']],
    ['CON', ['PATH-DEVICE-NAME']],
    ['aux.json', ['PATH-DEVICE-NAME']],
    ['LPT1.md', ['PATH-DEVICE-NAME']],
    ['.git/config', ['PATH-GIT-SEGMENT']],
    ['-rf', ['PATH-LEADING-DASH']],
    ['Claude.md', []], // lexically fine; rejected as a protected case alias (below)
  ];
  for (const [p, expected] of cases) {
    assert.deepEqual(l0(p), expected, p);
    assert.deepEqual(l0(p, { directory: true }), expected, `${p} (scope)`);
  }
  assert.equal(isProtectedPathCaseAlias('Claude.md'), true);
});

test('L0: trailing-dot segments are rejected, never trimmed', () => {
  for (const p of ['CLAUDE.md.', 'foo./bar', 'a/b...', 'x.', 'a/.b./c', 'docs/ai/adr./x.md']) {
    assert.deepEqual(l0(p), ['PATH-TRAILING-DOT'], p);
  }
  assert.deepEqual(l0('docs/ai/adr./', { directory: true }), ['PATH-TRAILING-DOT']);
});

test('L0: Windows device names are rejected case-insensitively, bare or with an extension', () => {
  const names = ['CON', 'PRN', 'AUX', 'NUL'];
  for (let d = 0; d <= 9; d++) names.push(`COM${d}`, `LPT${d}`);
  for (const name of names) {
    const mixed = name[0] + name.slice(1).toLowerCase();
    for (const p of [name, name.toLowerCase(), mixed, `${name}.txt`, `${name.toLowerCase()}.tar.gz`, `dir/${name}`, `dir/${name}.md/x`]) {
      assert.deepEqual(l0(p), ['PATH-DEVICE-NAME'], p);
    }
  }
  for (const p of ['con', 'CON.txt', 'aux.json', 'LPT1.md', 'com9.log']) assert.deepEqual(l0(p), ['PATH-DEVICE-NAME'], p);
  assert.deepEqual(l0('CON/', { directory: true }), ['PATH-DEVICE-NAME']);
});

test('L0: device-name lookalikes that are not reserved stay valid', () => {
  for (const p of ['console.md', 'con-tent.md', 'contrib/x', 'comx.md', 'com10.txt', 'lpt.md', 'lpt10', 'nul1.md', 'auxiliary/x', 'prnt', 'x.con', 'docs/aux-notes.md']) {
    assert.deepEqual(l0(p), [], p);
  }
});

test('L0: a .git segment is rejected at any depth and in any case', () => {
  for (const p of ['.git', '.git/config', '.GIT/config', 'foo/.git/config', 'a/b/.Git', 'a/.gIt/b/c']) {
    assert.deepEqual(l0(p), ['PATH-GIT-SEGMENT'], p);
  }
  assert.deepEqual(l0('.git/', { directory: true }), ['PATH-GIT-SEGMENT']);
  for (const p of ['.gitignore', '.github/workflows/test.yml', 'git/x', 'x.git/y', '.gitattributes', 'a/.git-blame-ignore-revs']) {
    assert.deepEqual(l0(p), [], p);
  }
});

test('L0: segments starting with "-" are rejected', () => {
  for (const p of ['-rf', 'foo/-bar', '--help/file', 'a/-', 'a/-b/c.md']) assert.deepEqual(l0(p), ['PATH-LEADING-DASH'], p);
  for (const p of ['a-b/c', 'x/y-', 'docs/specs/SPEC-AI-001-x.md']) assert.deepEqual(l0(p), [], p);
});

test('L0: several rules on one path are reported once each, sorted', () => {
  assert.deepEqual(l0('-x/.git/CON./aux.md'), ['PATH-DEVICE-NAME', 'PATH-GIT-SEGMENT', 'PATH-LEADING-DASH', 'PATH-TRAILING-DOT']);
  assert.deepEqual(l0('a./b./CON/nul.txt'), ['PATH-DEVICE-NAME', 'PATH-TRAILING-DOT']);
});

test('L0: the V1 grammar and length limit are preserved (no broadening)', () => {
  const grammarFailures = ['', '/abs/x', '../x', 'a/../b', './x', 'a//b', 'a' + BS + 'b', 'C:/x', 'a b', 'a/b c', 'ü.md', 'a%2Fb', 'x*', 'a/b/', 'a?b'];
  for (const p of grammarFailures) assert.deepEqual(l0(p), ['PATH-GRAMMAR'], JSON.stringify(p));
  assert.deepEqual(l0('a'.repeat(REPO_PATH_MAX_LENGTH)), []);
  assert.deepEqual(l0('a'.repeat(REPO_PATH_MAX_LENGTH + 1)), ['PATH-GRAMMAR']);
  assert.deepEqual(l0('a'.repeat(REPO_PATH_MAX_LENGTH - 1) + '/', { directory: true }), []);
  assert.deepEqual(l0('a'.repeat(REPO_PATH_MAX_LENGTH) + '/', { directory: true }), ['PATH-GRAMMAR']);
  // A directory marker is only accepted in the ScopePath form.
  assert.deepEqual(l0('docs/'), ['PATH-GRAMMAR']);
  assert.deepEqual(l0('docs/', { directory: true }), []);
});

test('L0: ordinary repository paths are accepted', () => {
  for (const p of [
    'CLAUDE.md',
    'package.json',
    'docs/ai/specs/README.md',
    'docs/ai/adr/ADR-AI-010-evidence-approval-verification-and-path-safety.md',
    'scripts/ai/validate-taskspec.mjs',
    'test/ai/repo-path_check.node-test.mjs',
    '.github/workflows/test.yml',
    '.env.example',
    'migrations/0042_x.sql',
    'a/.b/c',
    'foo.bar/baz.txt',
  ]) {
    assert.deepEqual(l0(p), [], p);
    assert.equal(isSafeRepoPath(p), true, p);
  }
  for (const p of ['scripts/ai/', '.github/', 'docs/']) assert.equal(isSafeRepoPath(p, { directory: true }), true, p);
});

test('L0: deterministic regardless of call order, and rejects non-strings', () => {
  const inputs = ['CLAUDE.md.', 'CON', '.git/config', '-rf', 'docs/x.md', '', 'aux.json'];
  const first = inputs.map((p) => l0(p));
  for (let round = 0; round < 3; round++) assert.deepEqual([...inputs].reverse().map((p) => l0(p)).reverse(), first);
  for (const v of [undefined, null, 1, ['CON'], { path: 'x' }]) assert.throws(() => repoPathViolations(v), TypeError);
});

test('protected case aliases come from the registry and match POL-PROTECTED-CASE', () => {
  const aliases = ['Claude.md', 'claude.md', 'Package.json', 'Migrations/', 'MIGRATIONS/0001_x.sql', 'Scripts/AI/x.mjs', '.GITHUB/workflows/test.yml', 'Wrangler.toml'];
  const clean = ['CLAUDE.md', 'package.json', 'migrations/', 'docs/notes.md', 'scripts/other.mjs', 'readme.md'];
  for (const p of aliases) assert.equal(isProtectedPathCaseAlias(p), true, p);
  for (const p of clean) assert.equal(isProtectedPathCaseAlias(p), false, p);
  for (const p of [...aliases, ...clean]) {
    const r = validateTaskSpecPolicy(withScope([p], []));
    const flagged = !r.ok && r.errors.some((e) => e.rule === 'POL-PROTECTED-CASE');
    assert.equal(flagged, isProtectedPathCaseAlias(p), p);
  }
});

test('business: L0 rules apply to allowed and forbidden scope paths with their own rule IDs', () => {
  assert.deepEqual(rules(check(withScope(['docs/CON.md'], []))), ['BR-PATH-DEVICE-NAME /scope/allowed_paths/0']);
  assert.deepEqual(rules(check(withScope(['src/'], ['.git/']))), ['BR-PATH-GIT-SEGMENT /scope/forbidden_paths/0']);
  assert.deepEqual(rules(check(withScope(['-rf'], []))), ['BR-PATH-LEADING-DASH /scope/allowed_paths/0']);
  assert.deepEqual(rules(check(withScope(['src/', 'x/-a./aux.md'], []))), [
    'BR-PATH-DEVICE-NAME /scope/allowed_paths/1',
    'BR-PATH-LEADING-DASH /scope/allowed_paths/1',
    'BR-PATH-TRAILING-DOT /scope/allowed_paths/1',
  ]);
  // Input that skipped the schema is still caught.
  assert.deepEqual(rules(check(withScope(['../x'], []))), ['BR-PATH-GRAMMAR /scope/allowed_paths/0']);
  const out = JSON.stringify(check(withScope(['docs/CON.md', '-secretname'], ['.git/'])));
  for (const leak of ['CON', 'secretname', '.git']) assert.ok(!out.includes(leak), leak);
});
