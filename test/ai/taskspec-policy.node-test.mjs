// Tests for TaskSpec security / capability policy (A3.4c, ADR-AI-008).
//
//   node --test test/ai/taskspec-policy.node-test.mjs
//
// Named *.node-test.mjs so Vitest never runs it in workerd. Credential-shaped fixtures are
// SYNTHETIC and assembled at runtime from harmless fragments, so no contiguous
// credential-shaped string exists in this source file; their values are never printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContractValidator } from '../../scripts/ai/validate-contract.mjs';
import { validateTaskSpecBusiness } from '../../scripts/ai/taskspec-business.mjs';
import {
  MAX_POLICY_ERRORS,
  containsHighConfidenceSecret,
  validateTaskSpecPolicy,
} from '../../scripts/ai/taskspec-policy.mjs';
import {
  CATEGORY_REQUIREMENTS,
  INTENTIONAL_OVERLAPS,
  POLICY_CATEGORIES,
  PROTECTED_REGISTRY,
  checkRegistryIntegrity,
} from '../../scripts/ai/taskspec-policy-registry.mjs';

const FILE = 'SPEC-AI-034-policy-test.md';

function spec({ allowed = ['functions/api/example.js'], forbidden = [], declared = {}, gates = [] } = {}) {
  return {
    schema_version: 1,
    artifact_type: 'TaskSpec',
    spec_id: 'SPEC-AI-034',
    title: 'Policy test',
    objective: 'Exercise the policy layer.',
    scope: { allowed_paths: allowed, forbidden_paths: forbidden },
    requirements: [{ id: 'R-01', text: 'A requirement.' }],
    acceptance_criteria: [{ id: 'AC-01', text: 'Accepted.' }],
    constraints: [],
    deterministic_checks: ['build'],
    semantic_evals: [],
    declared_changes: { package: false, migration: false, production_config: false, ...declared },
    human_gates: gates.map((type, i) => ({ gate_id: `HG-0${i + 1}`, type, description: 'Owner review.' })),
    max_iterations: 2,
  };
}

const policy = (s) => validateTaskSpecPolicy(s);
const rules = (r) => (r.ok ? [] : r.errors.map((e) => `${e.rule} ${e.path}`));
const ok = (r, categories) => {
  assert.equal(r.ok, true, JSON.stringify(rules(r)));
  assert.deepEqual(r, { ok: true, protectedCategories: categories });
};

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// ---- synthetic credential fixtures (runtime-assembled; never printed) ----
const F = {
  pem: () => '-'.repeat(5) + 'BEGIN ' + 'RSA ' + 'PRIVATE' + ' KEY' + '-'.repeat(5),
  ghClassic: () => 'gh' + 'p' + '_' + 'Ab1'.repeat(12),
  ghFine: () => 'github' + '_pat_' + 'Ab1_'.repeat(21),
  brevo: () => 'x' + 'keysib' + '-' + 'a1'.repeat(32) + '-' + 'Ab1Cd2Ef3Gh4Ij5K',
  brevoSmtp: () => 'x' + 'smtpsib' + '-' + 'b2'.repeat(32) + '-' + 'Zy9Xw8Vu7Ts6Rq5P',
  telegram: () => '1234' + '56789' + ':' + 'A' + 'A' + 'b1_'.repeat(11),
  bearer: () => 'Author' + 'ization: ' + 'Bear' + 'er ' + 'Ab1.'.repeat(8),
  skKey: () => 's' + 'k-' + 'proj-' + 'Ab1'.repeat(15),
};

// ---------------------------------------------------------------- A. registry

test('registry: exact categories, entries and order (ADR-AI-008)', () => {
  assert.deepEqual([...POLICY_CATEGORIES], ['GOVERNANCE', 'MIGRATION', 'PACKAGE', 'PRODUCTION']);
  assert.deepEqual(
    PROTECTED_REGISTRY.map((e) => `${e.category} ${e.path}`),
    [
      'PACKAGE package.json',
      'PACKAGE package-lock.json',
      'MIGRATION migrations/',
      'PRODUCTION wrangler.toml',
      'PRODUCTION .github/workflows/deploy.yml',
      'PRODUCTION scripts/build-static.mjs',
      'PRODUCTION scripts/dist-policy.mjs',
      'PRODUCTION scripts/check-dist.mjs',
      'PRODUCTION scripts/probe-private-urls.mjs',
      'PRODUCTION scripts/check-staging-bindings.mjs',
      'GOVERNANCE CLAUDE.md',
      'GOVERNANCE .github/',
      'GOVERNANCE docs/ai/adr/',
      'GOVERNANCE docs/ai/contracts/schemas/',
      'GOVERNANCE docs/ai/specs/',
      'GOVERNANCE scripts/ai/',
      'GOVERNANCE test/ai/',
    ],
  );
});

test('registry: every category is mapped to its required declarations', () => {
  assert.deepEqual(CATEGORY_REQUIREMENTS, {
    GOVERNANCE: { declaredChange: null, gateType: 'custom' },
    MIGRATION: { declaredChange: 'migration', gateType: 'migration' },
    PACKAGE: { declaredChange: 'package', gateType: 'package_change' },
    PRODUCTION: { declaredChange: 'production_config', gateType: 'production' },
  });
});

test('registry: deeply frozen; mutation throws in strict mode', () => {
  for (const o of [POLICY_CATEGORIES, PROTECTED_REGISTRY, CATEGORY_REQUIREMENTS, INTENTIONAL_OVERLAPS]) assert.ok(Object.isFrozen(o));
  for (const e of PROTECTED_REGISTRY) assert.ok(Object.isFrozen(e));
  for (const r of Object.values(CATEGORY_REQUIREMENTS)) assert.ok(Object.isFrozen(r));
  assert.throws(() => { PROTECTED_REGISTRY.push({ path: 'x', category: 'PACKAGE' }); }, TypeError);
  assert.throws(() => { PROTECTED_REGISTRY[0].path = 'other.json'; }, TypeError);
  assert.throws(() => { CATEGORY_REQUIREMENTS.PACKAGE.gateType = 'custom'; }, TypeError);
  assert.throws(() => { delete CATEGORY_REQUIREMENTS.GOVERNANCE; }, TypeError);
});

test('registry: integrity passes for the committed data', () => {
  assert.equal(checkRegistryIntegrity(PROTECTED_REGISTRY, CATEGORY_REQUIREMENTS, INTENTIONAL_OVERLAPS), true);
});

test('registry: integrity rejects duplicates, case ambiguity, unknown categories, undeclared overlaps, missing mappings', () => {
  const reg = (...extra) => [...PROTECTED_REGISTRY.map((e) => ({ ...e })), ...extra];
  const check = (r, req = CATEGORY_REQUIREMENTS, ov = INTENTIONAL_OVERLAPS) => () => checkRegistryIntegrity(r, req, ov);
  assert.throws(check(reg({ path: 'package.json', category: 'PRODUCTION' })), /duplicate/);
  assert.throws(check(reg({ path: 'Migrations/', category: 'MIGRATION' })), /case ambiguity/);
  assert.throws(check(reg({ path: 'x.txt', category: 'SECRETS' })), /unknown category/);
  assert.throws(check(reg({ path: 'scripts/ai/policy.mjs', category: 'PRODUCTION' })), /undeclared overlap/);
  assert.throws(check(reg(), CATEGORY_REQUIREMENTS, []), /undeclared overlap/);
  const noGov = { ...CATEGORY_REQUIREMENTS };
  delete noGov.GOVERNANCE;
  assert.throws(check(reg(), noGov), /requirement mapping/);
  assert.throws(check([]), /non-empty/);
});

test('registry: the only overlap is .github/ over deploy.yml, with different categories', () => {
  assert.deepEqual(INTENTIONAL_OVERLAPS, [['.github/', '.github/workflows/deploy.yml']]);
  const cats = (p) => PROTECTED_REGISTRY.filter((e) => e.path === p).map((e) => e.category);
  assert.deepEqual(cats('.github/'), ['GOVERNANCE']);
  assert.deepEqual(cats('.github/workflows/deploy.yml'), ['PRODUCTION']);
});

test('registry and policy contain no migration 0043 rule', () => {
  for (const f of ['scripts/ai/taskspec-policy.mjs', 'scripts/ai/taskspec-policy-registry.mjs']) {
    assert.ok(!readFileSync(f, 'utf8').includes('0043'), f);
  }
});

// ---------------------------------------------------------------- baseline validity

test('baseline fixture is schema-valid, business-valid and policy-valid', () => {
  const s = spec();
  const r = createContractValidator().validateContract(structuredClone(s));
  assert.equal(r.ok, true);
  assert.deepEqual(validateTaskSpecBusiness(s, { fileName: FILE }), { ok: true });
  ok(policy(s), []);
});

// ---------------------------------------------------------------- B. protected paths

test('paths: exact protected file, covering directory, and protected directory covering a file', () => {
  ok(policy(spec({ allowed: ['package.json'], declared: { package: true }, gates: ['package_change'] })), ['PACKAGE']);
  ok(policy(spec({ allowed: ['migrations/0001_example.sql'], declared: { migration: true }, gates: ['migration'] })), ['MIGRATION']);
  ok(policy(spec({ allowed: ['scripts/ai/new-tool.mjs'], gates: ['custom'] })), ['GOVERNANCE']);
  const r = policy(spec({ allowed: ['scripts/'], declared: { production_config: true }, gates: ['production'] }));
  assert.deepEqual(rules(r), ['POL-GATE-GOVERNANCE /scope/allowed_paths/0']);
});

test('paths: unrelated ordinary path touches nothing', () => {
  ok(policy(spec({ allowed: ['functions/api/', 'lib/', 'index.html', 'docs/ai/architecture/'] })), []);
});

test('paths: forbidden entry fully covering a protected entry excuses it; partial overlap does not', () => {
  ok(
    policy(spec({ allowed: ['scripts/'], forbidden: ['scripts/ai/'], declared: { production_config: true }, gates: ['production'] })),
    ['PRODUCTION'],
  );
  const partial = policy(spec({ allowed: ['scripts/'], forbidden: ['scripts/ai/sub/'], declared: { production_config: true }, gates: ['production'] }));
  assert.deepEqual(rules(partial), ['POL-GATE-GOVERNANCE /scope/allowed_paths/0']);
  const prodStill = policy(spec({ allowed: ['scripts/'], forbidden: ['scripts/ai/'], gates: [] }));
  assert.deepEqual(rules(prodStill), ['POL-DECLARED-CHANGE /declared_changes/production_config', 'POL-GATE-PRODUCTION /scope/allowed_paths/0']);
});

test('paths: file vs directory lexical distinction (migrations file is not migrations/)', () => {
  ok(policy(spec({ allowed: ['migrations'] })), []);
  ok(policy(spec({ allowed: ['docs/ai/adr'] })), []);
});

// ---------------------------------------------------------------- C. case ambiguity

test('case: exact-case protected paths are touches, not ambiguity', () => {
  const r = policy(spec({ allowed: ['package.json'] }));
  assert.ok(!rules(r).some((x) => x.startsWith('POL-PROTECTED-CASE')));
});

const caseCases = {
  'package file': 'Package.json',
  'migration directory': 'Migrations/',
  'migration same-name file': 'Migrations',
  'ancestor (governance)': 'Scripts/',
  'governance descendant': 'Scripts/AI/x.mjs',
  'governance file': 'claude.md',
  'production file': 'Wrangler.toml',
};
for (const [name, path] of Object.entries(caseCases)) {
  test(`case: ${name} is POL-PROTECTED-CASE`, () => {
    const r = policy(spec({ allowed: ['lib/x.js', path], gates: ['custom', 'production'] }));
    assert.ok(rules(r).includes('POL-PROTECTED-CASE /scope/allowed_paths/1'), JSON.stringify(rules(r)));
  });
}

test('case: unrelated paths differing in case are not flagged; forbidden paths are not compared', () => {
  ok(policy(spec({ allowed: ['Lib/Helper.js', 'docs/Guide.md'] })), []);
  ok(policy(spec({ forbidden: ['Migrations/', 'Package.json'] })), []);
});

// ---------------------------------------------------------------- D-F. typed categories

const typed = [
  { cat: 'PACKAGE', field: 'package', gate: 'package_change', paths: ['package.json', 'package-lock.json'] },
  { cat: 'MIGRATION', field: 'migration', gate: 'migration', paths: ['migrations/', 'migrations/0042_permissions.sql'] },
  {
    cat: 'PRODUCTION',
    field: 'production_config',
    gate: 'production',
    paths: [
      'wrangler.toml',
      'scripts/build-static.mjs',
      'scripts/dist-policy.mjs',
      'scripts/check-dist.mjs',
      'scripts/probe-private-urls.mjs',
      'scripts/check-staging-bindings.mjs',
    ],
  },
];
for (const { cat, field, gate, paths } of typed) {
  for (const p of paths) {
    test(`${cat}: ${p} satisfied with declared flag and ${gate} gate`, () => {
      ok(policy(spec({ allowed: [p], declared: { [field]: true }, gates: [gate] })), [cat]);
    });
  }
  test(`${cat}: missing declared flag`, () => {
    assert.deepEqual(rules(policy(spec({ allowed: [paths[0]], gates: [gate] }))), [`POL-DECLARED-CHANGE /declared_changes/${field}`]);
  });
  test(`${cat}: missing ${gate} gate reported at the touching allowed path`, () => {
    assert.deepEqual(rules(policy(spec({ allowed: ['lib/a.js', paths[0]], declared: { [field]: true } }))), [
      `POL-GATE-${cat} /scope/allowed_paths/1`,
    ]);
  });
  test(`${cat}: declared true but untouched (and no gate) reported at the declared field`, () => {
    assert.deepEqual(rules(policy(spec({ declared: { [field]: true } }))), [
      `POL-DECLARED-CHANGE /declared_changes/${field}`,
      `POL-GATE-${cat} /declared_changes/${field}`,
    ]);
    assert.deepEqual(rules(policy(spec({ declared: { [field]: true }, gates: [gate] }))), [`POL-DECLARED-CHANGE /declared_changes/${field}`]);
  });
  test(`${cat}: a gate of another type does not satisfy ${gate}`, () => {
    const other = gate === 'custom' ? 'production' : 'custom';
    assert.deepEqual(rules(policy(spec({ allowed: [paths[0]], declared: { [field]: true }, gates: [other] }))), [
      `POL-GATE-${cat} /scope/allowed_paths/0`,
    ]);
  });
}

test('PACKAGE: a directory scope covering package files is not possible at root; nested package.json is ordinary', () => {
  ok(policy(spec({ allowed: ['tools/package.json'] })), []);
});

test('MIGRATION: success carries classification only, no execution authority', () => {
  const r = policy(spec({ allowed: ['migrations/'], declared: { migration: true }, gates: ['migration'] }));
  assert.deepEqual(Object.keys(r), ['ok', 'protectedCategories']);
});

// ---------------------------------------------------------------- G. governance

const governancePaths = [
  'CLAUDE.md',
  '.github/workflows/test.yml',
  'docs/ai/adr/ADR-AI-009-x.md',
  'docs/ai/contracts/schemas/v1/task-spec.schema.json',
  'docs/ai/specs/SPEC-AI-001-example.md',
  'scripts/ai/taskspec-policy.mjs',
  'test/ai/taskspec-policy.node-test.mjs',
];
for (const p of governancePaths) {
  test(`GOVERNANCE: ${p} requires a custom gate declaration`, () => {
    assert.deepEqual(rules(policy(spec({ allowed: [p] }))), ['POL-GATE-GOVERNANCE /scope/allowed_paths/0']);
    ok(policy(spec({ allowed: [p], gates: ['custom'] })), ['GOVERNANCE']);
  });
}

test('GOVERNANCE: custom gate description is never interpreted', () => {
  const s = spec({ allowed: ['CLAUDE.md'], gates: ['custom'] });
  s.human_gates[0].description = 'anything at all';
  ok(policy(s), ['GOVERNANCE']);
});

// ---------------------------------------------------------------- H. multi-category

test('multi-category: deploy.yml requires production declaration, production gate AND custom gate', () => {
  const p = '.github/workflows/deploy.yml';
  ok(policy(spec({ allowed: [p], declared: { production_config: true }, gates: ['production', 'custom'] })), ['GOVERNANCE', 'PRODUCTION']);
  assert.deepEqual(rules(policy(spec({ allowed: [p], declared: { production_config: true }, gates: ['production'] }))), [
    'POL-GATE-GOVERNANCE /scope/allowed_paths/0',
  ]);
  assert.deepEqual(rules(policy(spec({ allowed: [p], declared: { production_config: true }, gates: ['custom'] }))), [
    'POL-GATE-PRODUCTION /scope/allowed_paths/0',
  ]);
  assert.deepEqual(rules(policy(spec({ allowed: [p], gates: ['production', 'custom'] }))), [
    'POL-DECLARED-CHANGE /declared_changes/production_config',
  ]);
});

test('multi-category: .github/ directory touches both GOVERNANCE and PRODUCTION', () => {
  ok(policy(spec({ allowed: ['.github/'], declared: { production_config: true }, gates: ['custom', 'production'] })), ['GOVERNANCE', 'PRODUCTION']);
});

// ---------------------------------------------------------------- I. declared_changes (both directions)

test('declared_changes: consistency in both directions for all typed categories', () => {
  const r = policy(spec({ allowed: ['package.json'], declared: { migration: true, production_config: true }, gates: ['package_change', 'migration', 'production'] }));
  assert.deepEqual(rules(r), [
    'POL-DECLARED-CHANGE /declared_changes/migration',
    'POL-DECLARED-CHANGE /declared_changes/package',
    'POL-DECLARED-CHANGE /declared_changes/production_config',
  ]);
});

// ---------------------------------------------------------------- J. secrets

for (const [name, make] of Object.entries(F)) {
  test(`secrets: ${name} class is detected`, () => {
    assert.equal(containsHighConfidenceSecret(make()), true);
    assert.equal(containsHighConfidenceSecret('prefix text ' + make() + ' suffix text'), true);
  });
}

test('secrets: detected in nested strings and in a path, reported by pointer only', () => {
  const s = spec({ allowed: ['docs/' + F.ghClassic() + '.md'] });
  s.requirements[0].text = 'Use ' + F.brevo() + ' here.';
  s.objective = 'Key: ' + F.pem();
  const r = policy(s);
  assert.deepEqual(rules(r), [
    'POL-SECRET /objective',
    'POL-SECRET /requirements/0/text',
    'POL-SECRET /scope/allowed_paths/0',
  ]);
});

test('secrets: serialized result contains no matched text, prefix fragment or length', () => {
  for (const make of Object.values(F)) {
    const value = make();
    const s = spec();
    s.title = value.slice(0, 120);
    s.objective = value;
    const out = JSON.stringify(policy(s));
    for (const frag of [value, value.slice(0, 8), value.slice(-8), 'gh' + 'p_', 'x' + 'keysib', 'BEGIN', 'Bearer', 's' + 'k-', String(value.length)]) {
      assert.ok(!out.includes(frag), 'leak');
    }
    for (const e of JSON.parse(out).errors) assert.deepEqual(Object.keys(e), ['rule', 'path']);
  }
});

test('secrets: bare words, variable names, emails, phones and names do not trigger', () => {
  for (const text of [
    'password secret token key api_key credentials',
    'OPENAI_API_KEY TELEGRAM_BOT_TOKEN BREVO_API_KEY TURNSTILE_SECRET_KEY CLOUDFLARE_API_TOKEN',
    'someone@example.com',
    '+84 912 345 678 and 0912345678',
    'Nguyễn Văn A, Hiền Lê Garden',
    'Authorization: Bearer <token>',
    'Authorization: Bearer your-access-token-goes-here',
    'sk-' + 'abcdefghij'.repeat(5),
    'docs/ai/specs/SPEC-AI-001-skeleton-key-token-handling.md',
  ]) {
    assert.equal(containsHighConfidenceSecret(text), false, 'false positive');
  }
  const s = spec();
  s.objective = 'Rotate the TELEGRAM_BOT_TOKEN secret; contact someone@example.com or +84 912 345 678.';
  ok(policy(s), []);
});

test('secrets: near misses do not trigger', () => {
  for (const text of [
    'gh' + 'p' + '_' + 'Ab1'.repeat(11) + 'Ab',
    'gh' + 'x' + '_' + 'Ab1'.repeat(12),
    'x' + 'keysib' + '-' + 'a1'.repeat(31) + '-' + 'Ab1Cd2Ef3Gh4Ij5K',
    '1234' + '56789' + ':' + 'B' + 'B' + 'b1_'.repeat(11),
    '-'.repeat(5) + 'BEGIN ' + 'PUBLIC' + ' KEY' + '-'.repeat(5),
    's' + 'k-' + 'Ab1'.repeat(10),
  ]) {
    assert.equal(containsHighConfidenceSecret(text), false, 'near miss triggered');
  }
});

test('secrets: helper rejects non-string input', () => {
  assert.throws(() => containsHighConfidenceSecret(42), TypeError);
});

// ---------------------------------------------------------------- K. error model

test('errors: exact code, {rule,path} shape, sorting, de-duplication', () => {
  const r = policy(spec({ allowed: ['Package.json', 'package.json', '.github/', 'migrations/x.sql'], declared: { production_config: true } }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_TASKSPEC_POLICY');
  assert.deepEqual(rules(r), [
    'POL-DECLARED-CHANGE /declared_changes/migration',
    'POL-DECLARED-CHANGE /declared_changes/package',
    'POL-PROTECTED-CASE /scope/allowed_paths/0',
    'POL-GATE-PACKAGE /scope/allowed_paths/1',
    'POL-GATE-GOVERNANCE /scope/allowed_paths/2',
    'POL-GATE-PRODUCTION /scope/allowed_paths/2',
    'POL-GATE-MIGRATION /scope/allowed_paths/3',
  ]);
  assert.equal(r.errorCount, 7);
  for (const e of r.errors) assert.deepEqual(Object.keys(e), ['rule', 'path']);
});

test('errors: more than 20 unique violations returns 20 with the full errorCount', () => {
  const allowed = Array.from({ length: 25 }, (_, i) => `scripts/ai/tool-${String(i).padStart(2, '0')}.mjs`);
  const r = policy(spec({ allowed }));
  assert.equal(r.errorCount, 25);
  assert.equal(r.errors.length, MAX_POLICY_ERRORS);
  assert.equal(MAX_POLICY_ERRORS, 20);
  const keys = r.errors.map((e) => `${e.path} ${e.rule}`);
  assert.deepEqual(keys, [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
});

test('errors: no untrusted values (paths, titles, gate descriptions) in output', () => {
  const s = spec({ allowed: ['scripts/ai/LeakName-tool.mjs', 'Migrations/'] });
  s.title = 'Sensitive title text';
  s.human_gates = [{ gate_id: 'HG-01', type: 'migration', description: 'Sensitive gate text' }];
  const out = JSON.stringify(policy(s));
  for (const leak of ['LeakName', 'Migrations', 'Sensitive', 'SPEC-AI']) assert.ok(!out.includes(leak), leak);
});

// ---------------------------------------------------------------- L. purity / preconditions

test('purity: deep-frozen input works, is unchanged, repeated results identical', () => {
  const good = deepFreeze(spec({ allowed: ['.github/workflows/deploy.yml'], declared: { production_config: true }, gates: ['production', 'custom'] }));
  const snapshot = structuredClone(good);
  assert.deepEqual(policy(good), policy(good));
  assert.deepEqual(good, snapshot);
  const bad = deepFreeze(spec({ allowed: ['Package.json', 'scripts/'] }));
  const badSnapshot = structuredClone(bad);
  assert.deepEqual(policy(bad), policy(bad));
  assert.deepEqual(bad, badSnapshot);
});

test('preconditions: programmer misuse throws and never returns ok:true', () => {
  for (const v of [null, undefined, 'spec', 7, []]) assert.throws(() => validateTaskSpecPolicy(v), TypeError);
  for (const key of ['scope', 'human_gates', 'declared_changes']) {
    const s = spec();
    delete s[key];
    assert.throws(() => validateTaskSpecPolicy(s), TypeError, key);
  }
  const s = spec();
  delete s.scope.forbidden_paths;
  assert.throws(() => validateTaskSpecPolicy(s), TypeError);
});

// ---------------------------------------------------------------- M. success metadata

test('success metadata: protectedCategories sorted, fixed vocabulary, classification only', () => {
  const r = policy(
    spec({
      allowed: ['package.json', 'migrations/', 'wrangler.toml', 'CLAUDE.md'],
      declared: { package: true, migration: true, production_config: true },
      gates: ['package_change', 'migration', 'production', 'custom'],
    }),
  );
  assert.deepEqual(r, { ok: true, protectedCategories: ['GOVERNANCE', 'MIGRATION', 'PACKAGE', 'PRODUCTION'] });
  for (const c of r.protectedCategories) assert.ok(POLICY_CATEGORIES.includes(c));
  const forbiddenKeys = /approv|authori|permit|permission|allowedToDeploy|canMerge|canDeploy|execute|capab/i;
  for (const k of Object.keys(r)) assert.ok(!forbiddenKeys.test(k), k);
});

// ---------------------------------------------------------------- fixture safety

test('fixture safety: no committed A3.4c source contains a contiguous credential-shaped string', () => {
  for (const f of [
    'scripts/ai/taskspec-policy.mjs',
    'scripts/ai/taskspec-policy-registry.mjs',
    'test/ai/taskspec-policy.node-test.mjs',
    'docs/ai/specs/README.md',
    'docs/ai/contracts/README.md',
    'docs/ai/adr/ADR-AI-008-taskspec-scope-classes-and-authority.md',
  ]) {
    assert.equal(containsHighConfidenceSecret(readFileSync(f, 'utf8')), false, f);
  }
});
