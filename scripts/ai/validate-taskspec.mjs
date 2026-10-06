// Supported TaskSpec validation entry point (A3.4d, ADR-AI-009).
//
// Composes the existing layers in one mandatory, fail-closed order:
//   EXTRACT -> SECRET_SCAN -> CONTRACT -> TYPE -> BUSINESS -> POLICY -> RESULT
// The first failing stage ends validation; no later stage runs, there is no partial PASS and
// no fallback. A thrown error is never a success.
//
// Consumers use createTaskSpecValidator().validateTaskSpecMarkdown(bytes, { fileName }).
// The stage functions stay exported from their modules for unit tests, but they are not
// supported consumer entry points; the import boundary is enforced by
// test/ai/validate-taskspec.node-test.mjs in CI. This is repository enforcement, not a
// language-level sandbox.
//
// A PASS means only "passes deterministic TaskSpec validation": not approval, merge,
// deployment or production authority (ADR-AI-003, ADR-AI-006, ADR-AI-008).
//
// Pure apart from compiling the trusted schemas once per validator: no network, environment
// or logging. Results carry codes, rules and pointers only, never input text.

import { extractTaskSpecBlock } from './extract-taskspec.mjs';
import { containsHighConfidenceSecret } from './secret-detector.mjs';
import { validateTaskSpecBusiness } from './taskspec-business.mjs';
import { validateTaskSpecPolicy } from './taskspec-policy.mjs';
import { createContractValidator } from './validate-contract.mjs';

export const TASKSPEC_STAGES = Object.freeze(['EXTRACT', 'SECRET_SCAN', 'CONTRACT', 'TYPE', 'BUSINESS', 'POLICY']);

const TASKSPEC_ARTIFACT_TYPE = 'TaskSpec';

function failure(stage, code, errors = [], errorCount = errors.length) {
  return { ok: false, stage, code, errorCount, errors };
}

// JSON.parse output is a tree (no cycles), so plain recursion terminates.
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// onStage (optional, for tests): called with the stage name just before that stage runs.
// It receives nothing else, so it cannot alter inputs or results or skip a stage; if it
// throws, the error propagates and validation never returns ok: true.
export function createTaskSpecValidator({ onStage } = {}) {
  if (onStage !== undefined && typeof onStage !== 'function') {
    throw new TypeError('createTaskSpecValidator: onStage must be a function');
  }
  const contract = createContractValidator();
  const enter = (stage) => {
    if (onStage) onStage(stage);
  };

  function validateTaskSpecMarkdown(bytes, { fileName } = {}) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('validateTaskSpecMarkdown: bytes must be a Uint8Array');
    if (typeof fileName !== 'string') throw new TypeError('validateTaskSpecMarkdown: fileName must be a string');

    // EXTRACT: authoritative byte/decode gate (size, BOM, NUL, fatal UTF-8) and the single
    // machine block.
    enter('EXTRACT');
    const extracted = extractTaskSpecBlock(bytes);
    if (!extracted.ok) {
      const result = failure('EXTRACT', extracted.code);
      if (extracted.line !== undefined) result.line = extracted.line;
      return result;
    }

    // SECRET_SCAN: the complete Markdown, including the raw machine block.
    enter('SECRET_SCAN');
    let markdown;
    try {
      // EXTRACT has already validated these exact bytes. This decoder MUST stay semantically
      // identical to the extractor's UTF-8 decoder (fatal, ignoreBOM); it exists only to give
      // SECRET_SCAN the whole-Markdown text.
      markdown = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return failure('SECRET_SCAN', 'E_ENCODING');
    }
    if (containsHighConfidenceSecret(markdown)) {
      return failure('SECRET_SCAN', 'E_TASKSPEC_SECRET', [{ rule: 'SEC-NARRATIVE-SECRET', path: '' }]);
    }

    // CONTRACT: ADR-AI-007 parsing and schema validation of the extracted block bytes.
    enter('CONTRACT');
    const parsed = contract.validateContractBytes(extracted.bytes);
    if (!parsed.ok) return failure('CONTRACT', parsed.code, parsed.errors, parsed.errorCount);

    // TYPE: the schema was selected by the payload's own artifact_type.
    enter('TYPE');
    if (parsed.artifactType !== TASKSPEC_ARTIFACT_TYPE) return failure('TYPE', 'E_TASKSPEC_WRONG_TYPE');
    const spec = deepFreeze(parsed.value);

    // BUSINESS and POLICY receive this same frozen object.
    enter('BUSINESS');
    const business = validateTaskSpecBusiness(spec, { fileName });
    if (!business.ok) return failure('BUSINESS', business.code, business.errors, business.errorCount);

    enter('POLICY');
    const policy = validateTaskSpecPolicy(spec);
    if (!policy.ok) return failure('POLICY', policy.code, policy.errors, policy.errorCount);

    return {
      ok: true,
      spec,
      protectedCategories: policy.protectedCategories,
      startLine: extracted.startLine,
      endLine: extracted.endLine,
    };
  }

  return Object.freeze({ validateTaskSpecMarkdown });
}
