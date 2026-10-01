// Schema tests for the V1 HLG AI contracts (A3.3a): strict compilation, the committed
// examples, and structural rejections.
//
//   node --test "test/ai/*.node-test.mjs"
//
// Named *.node-test.mjs so Vitest's default include (**/*.{test,spec}.?(c|m)[jt]s?(x))
// never picks it up: these are pure Node tooling tests and must not run in workerd.
//
// Schema validity is structural only. A schema-valid GateDecision saying PASS is NOT an
// authoritative decision, and a schema-valid EvidenceRef/ApprovalRef is NOT verified
// evidence or approval (ADR-AI-005, ADR-AI-006).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020, { MissingRefError } from 'ajv/dist/2020.js';
import { AJV_OPTIONS, COMMON_SCHEMA, CONTRACTS, compileContractSchemas } from '../../scripts/ai/contract-schemas.mjs';

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

const { ajv, validators } = compileContractSchemas();

function example(artifactType) {
  return JSON.parse(readFileSync(new URL(EXAMPLES[artifactType], EXAMPLE_DIR), 'utf8'));
}

function validate(artifactType, value) {
  const fn = validators.get(artifactType);
  const ok = fn(value);
  return { ok, keywords: (fn.errors || []).map((e) => e.keyword) };
}

// Mutates a fresh copy of the committed example and expects a rejection,
// optionally by a specific Ajv keyword.
function assertRejects(artifactType, mutate, keyword) {
  const value = structuredClone(example(artifactType));
  mutate(value);
  const { ok, keywords } = validate(artifactType, value);
  assert.equal(ok, false, `${artifactType}: expected rejection`);
  if (keyword) assert.ok(keywords.includes(keyword), `expected keyword "${keyword}", got [${keywords.join(', ')}]`);
}

function assertAccepts(artifactType, mutate) {
  const value = structuredClone(example(artifactType));
  mutate(value);
  const { ok, keywords } = validate(artifactType, value);
  assert.equal(ok, true, `${artifactType}: expected acceptance, got [${keywords.join(', ')}]`);
}

const SHA_B = 'b'.repeat(40);

// ---------------------------------------------------------------- A. compilation

test('A: common + all 7 contract schemas compile under strict mode', () => {
  assert.equal(typeof ajv.getSchema(COMMON_SCHEMA.id), 'function');
  assert.equal(CONTRACTS.length, 7);
  assert.equal(validators.size, 7);
  for (const { artifactType, id } of CONTRACTS) {
    assert.equal(typeof validators.get(artifactType), 'function', artifactType);
    assert.equal(typeof ajv.getSchema(id), 'function', id);
  }
});

test('A: contract ids and artifact types are unique', () => {
  assert.equal(new Set(CONTRACTS.map((c) => c.id)).size, 7);
  assert.equal(new Set(CONTRACTS.map((c) => c.artifactType)).size, 7);
});

test('A: unknown schema keyword is rejected under strict mode', () => {
  const strict = new Ajv2020({ ...AJV_OPTIONS });
  assert.throws(() => strict.compile({ type: 'object', notAKeyword: 1 }), /strict mode: unknown keyword/);
});

test('A: unresolvable remote $ref fails closed without any network access', () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls++;
    throw new Error('network access attempted');
  };
  try {
    const strict = new Ajv2020({ ...AJV_OPTIONS });
    // .invalid is reserved (RFC 2606) and can never resolve; no loadSchema is configured.
    assert.throws(
      () =>
        strict.compile({
          $id: 'urn:hlg:ai-contract:test:remote-ref',
          type: 'object',
          properties: { x: { $ref: 'https://schemas.example.invalid/remote.schema.json' } },
        }),
      (err) => err instanceof MissingRefError,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------- B. valid examples

for (const artifactType of Object.keys(EXAMPLES)) {
  test(`B: ${artifactType} example validates`, () => {
    const value = example(artifactType);
    assert.equal(value.schema_version, 1);
    assert.equal(value.artifact_type, artifactType);
    const { ok, keywords } = validate(artifactType, value);
    assert.equal(ok, true, `errors: [${keywords.join(', ')}]`);
  });
}

test('B: a schema-valid PASS GateDecision is structural only (not an authoritative decision)', () => {
  assertAccepts('GateDecision', (v) => {
    v.decision = 'PASS';
    v.reasons = [{ code: 'ALL_REQUIREMENTS_MET', detail: '' }];
  });
});

test('B: .github/ is accepted as a ScopePath directory prefix', () => {
  assertAccepts('TaskSpec', (v) => { v.scope.allowed_paths = ['.github/', '.github/workflows/test.yml']; });
});

// ---------------------------------------------------------------- C. invalid structure

test('C: missing required field', () => {
  assertRejects('TaskSpec', (v) => { delete v.objective; }, 'required');
});

for (const artifactType of Object.keys(EXAMPLES)) {
  test(`C: ${artifactType} rejects unknown top-level field and metadata bag`, () => {
    assertRejects(artifactType, (v) => { v.extra = 1; }, 'additionalProperties');
    assertRejects(artifactType, (v) => { v.meta = {}; }, 'additionalProperties');
  });
}

test('C: unknown nested field', () => {
  assertRejects('TaskSpec', (v) => { v.scope.extra = []; }, 'additionalProperties');
  assertRejects('ImplementationReport', (v) => { v.files.renamed = []; }, 'additionalProperties');
});

test('C: wrong artifact_type', () => {
  assertRejects('TaskSpec', (v) => { v.artifact_type = 'GateDecision'; }, 'const');
});

test('C: schema_version must be the integer 1', () => {
  assertRejects('TaskSpec', (v) => { v.schema_version = 2; }, 'const');
  assertRejects('TaskSpec', (v) => { v.schema_version = 0; }, 'const');
  assertRejects('TaskSpec', (v) => { v.schema_version = '1'; }, 'type');
  assertRejects('TaskSpec', (v) => { delete v.schema_version; }, 'required');
});

test('C: SHA must be 40 lowercase hex characters', () => {
  assertRejects('ImplementationReport', (v) => { v.result_commit = 'bbbbbbb'; }, 'pattern');
  assertRejects('ImplementationReport', (v) => { v.result_commit = 'B'.repeat(40); }, 'pattern');
});

for (const bad of ['/x', 'C:/x', 'a\\b', '../x', './x', 'a/*.js', 'a//b', 'a/../b', 'a/./b', '']) {
  test(`C: path ${JSON.stringify(bad)} is rejected as ScopePath and RepoFilePath`, () => {
    assertRejects('TaskSpec', (v) => { v.scope.allowed_paths = [bad]; });
    assertRejects('ImplementationReport', (v) => { v.files.changed = [bad]; });
  });
}

test('C: RepoFilePath rejects a directory prefix (trailing slash)', () => {
  assertRejects('ImplementationReport', (v) => { v.files.changed = ['scripts/ai/']; }, 'pattern');
});

test('C: bad enum', () => {
  assertRejects('CodeReviewReport', (v) => { v.findings[0].severity = 'urgent'; }, 'enum');
  assertRejects('EvalReport', (v) => { v.deterministic[0].result = 'MEETS_THRESHOLD'; }, 'enum');
});

test('C: review reports only accept their own finding categories', () => {
  assertRejects('SecurityReviewReport', (v) => { v.findings[0].category = 'correctness'; }, 'enum');
  assertRejects('CodeReviewReport', (v) => { v.findings[0].category = 'authz'; }, 'enum');
  assertRejects('SEOReviewReport', (v) => { v.findings[0].category = 'injection'; }, 'enum');
});

test('C: oversized string', () => {
  assertRejects('TaskSpec', (v) => { v.title = 'x'.repeat(121); }, 'maxLength');
  assertRejects('TaskSpec', (v) => { v.scope.allowed_paths = ['a'.repeat(241)]; }, 'maxLength');
});

test('C: oversized array', () => {
  assertRejects('TaskSpec', (v) => {
    v.scope.allowed_paths = Array.from({ length: 101 }, (_, i) => `docs/file-${i}.md`);
  }, 'maxItems');
  assertRejects('CodeReviewReport', (v) => {
    v.findings = Array.from({ length: 201 }, () => structuredClone(v.findings[0]));
  }, 'maxItems');
});

for (const field of ['blocking', 'gate_impact', 'decision', 'override', 'force_pass', 'ignore_failure']) {
  test(`C: producer-authored Finding.${field} is rejected`, () => {
    assertRejects('SecurityReviewReport', (v) => { v.findings[0][field] = false; }, 'additionalProperties');
  });
}

for (const field of ['override', 'force_pass', 'ignore_failure', 'manual_override', 'waive_failure']) {
  test(`C: GateDecision.${field} is rejected`, () => {
    assertRejects('GateDecision', (v) => { v[field] = true; }, 'additionalProperties');
  });
}

test('C: EvidenceRef unknown kind', () => {
  assertRejects('ImplementationReport', (v) => {
    v.requirements[0].evidence = [{ kind: 'screenshot', commit: SHA_B }];
  });
});

test('C: EvidenceRef missing required field', () => {
  assertRejects('ImplementationReport', (v) => { delete v.requirements[0].evidence[0].end_line; }, 'required');
});

test('C: EvidenceRef verified:true is rejected', () => {
  assertRejects('ImplementationReport', (v) => { v.requirements[0].evidence[0].verified = true; }, 'additionalProperties');
});

test('C: human approval cannot be embedded as EvidenceRef', () => {
  assertRejects('ImplementationReport', (v) => {
    v.requirements[0].evidence = [{ kind: 'human_approval', commit: SHA_B }];
  });
});

test('C: http_probe target must be an allowlisted HLG host', () => {
  const probe = (target) => (v) => {
    v.requirements[0].evidence = [{ kind: 'http_probe', target, outcome: 'pass', body_sha256: null, run_id: v.run_id }];
  };
  assertAccepts('ImplementationReport', probe('https://hienlegarden.vn/robots.txt'));
  assertRejects('ImplementationReport', probe('https://example.com/x'));
  assertRejects('ImplementationReport', probe('https://hienlegarden.vn.evil.example/x'));
  assertRejects('ImplementationReport', probe('http://hienlegarden.vn/'));
});

test('C: ApprovalRef verified and actor are rejected', () => {
  assertRejects('GateDecision', (v) => { v.approvals[0].approval.verified = true; }, 'additionalProperties');
  assertRejects('GateDecision', (v) => { v.approvals[0].approval.actor = 'someone'; }, 'additionalProperties');
});

test('C: TaskSpec cannot carry status or approval fields', () => {
  assertRejects('TaskSpec', (v) => { v.status = 'Approved'; }, 'additionalProperties');
  assertRejects('TaskSpec', (v) => { v.approved_by = 'someone'; }, 'additionalProperties');
});

test('C: ImplementationReport cannot carry reasoning or transcript fields', () => {
  for (const field of ['reasoning', 'chain_of_thought', 'prompt', 'transcript', 'hidden_analysis']) {
    assertRejects('ImplementationReport', (v) => { v[field] = 'x'; }, 'additionalProperties');
  }
});

test('C: EvalReport has no human_acceptance or overall verdict', () => {
  assertRejects('EvalReport', (v) => { v.human_acceptance = []; }, 'additionalProperties');
  assertRejects('EvalReport', (v) => { v.verdict = 'PASS'; }, 'additionalProperties');
});

test('C: producer kind is fixed per contract', () => {
  assertRejects('GateDecision', (v) => { v.producer.kind = 'agent'; }, 'const');
  assertRejects('EvalReport', (v) => { v.producer.kind = 'agent'; }, 'const');
});
