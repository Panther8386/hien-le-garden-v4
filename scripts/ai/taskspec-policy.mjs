// Deterministic TaskSpec security / capability policy (A3.4c, ADR-AI-008).
//
// Input: a TaskSpec that already passed schema validation and A3.4b business validation.
// This is declaration policy only: it checks that the TaskSpec declares what HLG policy
// requires for the protected scopes it touches, and that it embeds no high-confidence
// credential material. A PASS is not approval, not a satisfied human gate, and grants no
// execution, merge or deploy authority. Declaration != approval != execution authority.
//
// The protected registry is trusted committed data (taskspec-policy-registry.mjs); callers
// cannot supply or weaken policy. Path semantics are A3.4b's covers / overlaps /
// isCaseAmbiguous, reused, not reimplemented. Secret detection is the shared detector
// (secret-detector.mjs). Pure: no filesystem, Git, network, environment or logging; the
// input is only read.
//
// Errors carry only { rule, path } (JSON pointer from schema field names and indices).
// No matched text, credential fragments, lengths or free-text values are ever returned.

import { containsHighConfidenceSecret } from './secret-detector.mjs';
import { covers, overlaps } from './taskspec-business.mjs';
import { CATEGORY_REQUIREMENTS, PROTECTED_REGISTRY, isProtectedPathCaseAlias } from './taskspec-policy-registry.mjs';

// High-confidence credential formats are owned by the shared detector (ADR-AI-009);
// re-exported here for import compatibility.
export { containsHighConfidenceSecret };

export const MAX_POLICY_ERRORS = 20;

const TYPED_CATEGORIES = ['MIGRATION', 'PACKAGE', 'PRODUCTION'];
const SAFE_POINTER = /^[A-Za-z0-9_/~-]{0,200}$/;

function pointerSegment(seg) {
  return String(seg).replaceAll('~', '~0').replaceAll('/', '~1');
}

function sanitizePointer(p) {
  return SAFE_POINTER.test(p) ? p : '<redacted>';
}

function collectSecretPointers(value, pointer, out) {
  if (typeof value === 'string') {
    if (containsHighConfidenceSecret(value)) out.push(sanitizePointer(pointer));
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collectSecretPointers(v, `${pointer}/${i}`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) collectSecretPointers(value[key], `${pointer}/${pointerSegment(key)}`, out);
  }
}

function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function validateTaskSpecPolicy(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('validateTaskSpecPolicy: spec must be a schema- and business-valid TaskSpec object');
  }
  const allowed = spec.scope.allowed_paths;
  const forbidden = spec.scope.forbidden_paths;
  const declared = spec.declared_changes;
  const gateTypes = new Set(spec.human_gates.map((g) => g.type));
  if (declared === null || typeof declared !== 'object') {
    throw new TypeError('validateTaskSpecPolicy: declared_changes must be an object');
  }

  const found = new Map(); // "path|rule" -> { rule, path }
  const add = (rule, path) => found.set(`${path}|${rule}`, { rule, path });
  const allowedPtr = (i) => `/scope/allowed_paths/${i}`;

  // Case ambiguity against protected paths fails closed regardless of forbidden entries
  // (registry helper, the single source for protected case aliases).
  allowed.forEach((a, i) => {
    if (isProtectedPathCaseAlias(a)) add('POL-PROTECTED-CASE', allowedPtr(i));
  });

  // Protected touches (A3.4b overlaps), minus registry entries fully excluded by a forbidden
  // entry (covers).
  const touched = new Map(); // category -> Set(allowed index)
  for (const { path: protectedPath, category } of PROTECTED_REGISTRY) {
    if (forbidden.some((f) => covers(f, protectedPath))) continue;
    allowed.forEach((a, i) => {
      if (overlaps(a, protectedPath)) {
        if (!touched.has(category)) touched.set(category, new Set());
        touched.get(category).add(i);
      }
    });
  }

  // PACKAGE / MIGRATION / PRODUCTION: declared_changes consistency (both directions) and the
  // typed human gate declaration.
  for (const category of TYPED_CATEGORIES) {
    const { declaredChange, gateType } = CATEGORY_REQUIREMENTS[category];
    const fieldPtr = `/declared_changes/${declaredChange}`;
    const isTouched = touched.has(category);
    const isDeclared = declared[declaredChange] === true;
    if (isTouched !== isDeclared) add('POL-DECLARED-CHANGE', fieldPtr);
    if ((isTouched || isDeclared) && !gateTypes.has(gateType)) {
      const rule = `POL-GATE-${category}`;
      if (isTouched) for (const i of touched.get(category)) add(rule, allowedPtr(i));
      else add(rule, fieldPtr);
    }
  }

  // GOVERNANCE: V1 requires at least one custom gate declaration. The description is never
  // read; a custom gate is not approval.
  if (touched.has('GOVERNANCE') && !gateTypes.has(CATEGORY_REQUIREMENTS.GOVERNANCE.gateType)) {
    for (const i of touched.get('GOVERNANCE')) add('POL-GATE-GOVERNANCE', allowedPtr(i));
  }

  // High-confidence credential material anywhere in the TaskSpec (pointer only).
  const secretPointers = [];
  collectSecretPointers(spec, '', secretPointers);
  for (const p of secretPointers) add('POL-SECRET', p);

  if (found.size === 0) {
    return { ok: true, protectedCategories: [...touched.keys()].sort(compareCodeUnits) };
  }
  const errors = [...found.values()].sort((x, y) => compareCodeUnits(x.path, y.path) || compareCodeUnits(x.rule, y.rule));
  return { ok: false, code: 'E_TASKSPEC_POLICY', errorCount: errors.length, errors: errors.slice(0, MAX_POLICY_ERRORS) };
}
