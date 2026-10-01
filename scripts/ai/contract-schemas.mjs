// Trusted loader for the V1 HLG AI contract JSON Schemas (ADR-AI-004).
//
// Loads ONLY the committed schema files listed below, from
// docs/ai/contracts/schemas/v1/ next to this repository checkout: no network, no
// loadSchema, no environment configuration, no artifact-controlled path or $id.
// One strict Ajv2020 instance registers the common definitions and eagerly
// compiles every contract schema, so a broken schema fails immediately.
//
// Schema validity is structural only. It does not prove that a commit exists or is
// current, that evidence holds, that an approval is authentic, or that a
// GateDecision is correct (ADR-AI-005, ADR-AI-006). Parsing untrusted bytes,
// dispatch and the CLI are a separate layer (A3.3b).
//
// Node >= 18. Dependency: ajv (devDependency, exact version in package.json).

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

export const SCHEMA_VERSION = 1;

export const AJV_OPTIONS = Object.freeze({
  strict: true,
  strictRequired: true,
  strictTypes: true,
  strictTuples: true,
  allErrors: true,
  discriminator: true,
  validateFormats: false,
});

const SCHEMA_DIR = new URL('../../docs/ai/contracts/schemas/v1/', import.meta.url);

export const COMMON_SCHEMA = Object.freeze({
  file: 'common.schema.json',
  id: 'urn:hlg:ai-contract:v1:common',
});

// artifact_type -> committed schema. The only way a schema is selected.
export const CONTRACTS = Object.freeze([
  Object.freeze({ artifactType: 'TaskSpec', file: 'task-spec.schema.json', id: 'urn:hlg:ai-contract:v1:task-spec' }),
  Object.freeze({ artifactType: 'ImplementationReport', file: 'implementation-report.schema.json', id: 'urn:hlg:ai-contract:v1:implementation-report' }),
  Object.freeze({ artifactType: 'CodeReviewReport', file: 'code-review-report.schema.json', id: 'urn:hlg:ai-contract:v1:code-review-report' }),
  Object.freeze({ artifactType: 'SecurityReviewReport', file: 'security-review-report.schema.json', id: 'urn:hlg:ai-contract:v1:security-review-report' }),
  Object.freeze({ artifactType: 'SEOReviewReport', file: 'seo-review-report.schema.json', id: 'urn:hlg:ai-contract:v1:seo-review-report' }),
  Object.freeze({ artifactType: 'EvalReport', file: 'eval-report.schema.json', id: 'urn:hlg:ai-contract:v1:eval-report' }),
  Object.freeze({ artifactType: 'GateDecision', file: 'gate-decision.schema.json', id: 'urn:hlg:ai-contract:v1:gate-decision' }),
]);

function readSchema(file, expectedId) {
  const schema = JSON.parse(readFileSync(new URL(file, SCHEMA_DIR), 'utf8'));
  if (schema.$id !== expectedId) {
    throw new Error(`contract-schemas: ${file} has $id ${JSON.stringify(schema.$id)}, expected ${expectedId}`);
  }
  return schema;
}

// Returns { ajv, validators } where validators maps artifact_type -> compiled
// validate function. Throws on any schema defect (missing file, wrong $id, schema
// not matching its mapping, strict-mode violation, unresolvable $ref).
export function compileContractSchemas() {
  const ajv = new Ajv2020({ ...AJV_OPTIONS });
  ajv.addSchema(readSchema(COMMON_SCHEMA.file, COMMON_SCHEMA.id));
  if (typeof ajv.getSchema(COMMON_SCHEMA.id) !== 'function') {
    throw new Error('contract-schemas: common schema failed to compile');
  }

  const validators = new Map();
  for (const { artifactType, file, id } of CONTRACTS) {
    const schema = readSchema(file, id);
    if (schema.properties?.artifact_type?.const !== artifactType) {
      throw new Error(`contract-schemas: ${file} artifact_type const does not match ${artifactType}`);
    }
    if (schema.properties?.schema_version?.const !== SCHEMA_VERSION) {
      throw new Error(`contract-schemas: ${file} schema_version const is not ${SCHEMA_VERSION}`);
    }
    validators.set(artifactType, ajv.compile(schema));
  }
  return { ajv, validators };
}
