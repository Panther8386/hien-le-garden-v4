// Trusted protected-scope registry for TaskSpec policy (A3.4c, ADR-AI-008).
//
// Committed data only: never built from the filesystem, never supplied by callers.
// Paths use A3.4b lexical Git/Linux semantics (exact, case-sensitive; a trailing "/" is a
// directory prefix). Everything exported here is deeply frozen, and the registry is checked
// for integrity when this module loads: an invalid registry throws, so policy can never
// pass on top of it.
//
// A category here is classification only. Touching a protected category requires certain
// TaskSpec declarations (CATEGORY_REQUIREMENTS); a declaration is not approval and grants no
// execution, merge or deploy authority (ADR-AI-008).

import { isCaseAmbiguous, overlaps } from './taskspec-business.mjs';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// Fixed vocabulary, sorted (code-unit order).
export const POLICY_CATEGORIES = deepFreeze(['GOVERNANCE', 'MIGRATION', 'PACKAGE', 'PRODUCTION']);

// Order is the ADR-AI-008 order and is part of the contract (tests assert it).
export const PROTECTED_REGISTRY = deepFreeze([
  { path: 'package.json', category: 'PACKAGE' },
  { path: 'package-lock.json', category: 'PACKAGE' },
  { path: 'migrations/', category: 'MIGRATION' },
  { path: 'wrangler.toml', category: 'PRODUCTION' },
  { path: '.github/workflows/deploy.yml', category: 'PRODUCTION' },
  { path: 'scripts/build-static.mjs', category: 'PRODUCTION' },
  { path: 'scripts/dist-policy.mjs', category: 'PRODUCTION' },
  { path: 'scripts/check-dist.mjs', category: 'PRODUCTION' },
  { path: 'scripts/probe-private-urls.mjs', category: 'PRODUCTION' },
  { path: 'scripts/check-staging-bindings.mjs', category: 'PRODUCTION' },
  { path: 'CLAUDE.md', category: 'GOVERNANCE' },
  { path: '.github/', category: 'GOVERNANCE' },
  { path: 'docs/ai/adr/', category: 'GOVERNANCE' },
  { path: 'docs/ai/contracts/schemas/', category: 'GOVERNANCE' },
  { path: 'docs/ai/specs/', category: 'GOVERNANCE' },
  { path: 'scripts/ai/', category: 'GOVERNANCE' },
  { path: 'test/ai/', category: 'GOVERNANCE' },
]);

// Declarations required when a category is touched. declaredChange is the
// declared_changes field that must be true (GOVERNANCE has none in V1); gateType is the
// human_gates[].type that must be declared at least once.
export const CATEGORY_REQUIREMENTS = deepFreeze({
  GOVERNANCE: { declaredChange: null, gateType: 'custom' },
  MIGRATION: { declaredChange: 'migration', gateType: 'migration' },
  PACKAGE: { declaredChange: 'package', gateType: 'package_change' },
  PRODUCTION: { declaredChange: 'production_config', gateType: 'production' },
});

// The only permitted overlaps between registry entries. Their requirements accumulate.
export const INTENTIONAL_OVERLAPS = deepFreeze([['.github/', '.github/workflows/deploy.yml']]);

// Throws TypeError describing the first integrity violation; returns true otherwise.
export function checkRegistryIntegrity(registry, requirements, intentionalOverlaps) {
  const categories = new Set(POLICY_CATEGORIES);
  if (!Array.isArray(registry) || registry.length === 0) throw new TypeError('registry: must be a non-empty array');
  for (const category of categories) {
    const req = requirements[category];
    if (!req || typeof req.gateType !== 'string') throw new TypeError(`registry: no requirement mapping for ${category}`);
  }
  for (const key of Object.keys(requirements)) {
    if (!categories.has(key)) throw new TypeError('registry: requirement mapping for unknown category');
  }
  const seen = new Set();
  for (const entry of registry) {
    if (!entry || typeof entry.path !== 'string' || entry.path.length === 0) throw new TypeError('registry: invalid entry path');
    if (!categories.has(entry.category)) throw new TypeError('registry: unknown category');
    if (seen.has(entry.path)) throw new TypeError('registry: duplicate path');
    seen.add(entry.path);
  }
  const allowedPairs = new Set(intentionalOverlaps.map(([a, b]) => `${a}|${b}`));
  for (let i = 0; i < registry.length; i++) {
    for (let j = i + 1; j < registry.length; j++) {
      const a = registry[i];
      const b = registry[j];
      if (isCaseAmbiguous(a.path, b.path)) throw new TypeError('registry: internal case ambiguity');
      if (overlaps(a.path, b.path)) {
        const declared = allowedPairs.has(`${a.path}|${b.path}`) || allowedPairs.has(`${b.path}|${a.path}`);
        if (!declared) throw new TypeError('registry: undeclared overlap');
        if (a.category === b.category) throw new TypeError('registry: overlapping entries must differ in category');
      }
    }
  }
  return true;
}

// Fail fast at load: an invalid trusted registry must never reach policy evaluation.
checkRegistryIntegrity(PROTECTED_REGISTRY, CATEGORY_REQUIREMENTS, INTENTIONAL_OVERLAPS);
