// Deterministic TaskSpec business and path validation (A3.4b; rules in
// docs/ai/specs/README.md).
//
// Input: a TaskSpec object that has already passed schema validation
// (validateContract / validateContractBytes). This layer does not re-check the schema;
// it only adds rules JSON Schema cannot express. Pure: no filesystem, Git, network,
// environment or logging, and the input is only read.
//
// Paths are lexical, exact and case-sensitive (Git semantics): no OS path library, no
// normalization, no lowercasing. ASCII case folding is used only to detect paths that
// would collide on a case-insensitive filesystem. Scope paths must also pass the common
// lexical repository path policy L0 (repo-path.mjs, ADR-AI-010): no segment ending in ".",
// no Windows device name, no ".git" segment, no segment starting with "-". They are
// rejected, never rewritten.
//
// A successful result means only "passes deterministic TaskSpec business validation":
// not approved, authorized, current, mergeable or deployable.
//
// Errors carry only { rule, path } (path: JSON pointer built from schema field names and
// indices); no values from the TaskSpec or the file name are ever returned.

import { repoPathViolations } from './repo-path.mjs';

export const MAX_BUSINESS_ERRORS = 20;

const SLASH = '/';
const BACKSLASH = String.fromCharCode(92);
const MAX_FILE_NAME = 100;
const MAX_SLUG = 64;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_COLLECTIONS = [
  ['requirements', 'id'],
  ['acceptance_criteria', 'id'],
  ['constraints', 'id'],
  ['semantic_evals', 'eval_id'],
  ['human_gates', 'gate_id'],
];

// A scope ending in "/" is a directory prefix; otherwise it is an exact file.
// Case-sensitive, no trailing-slash stripping: "foo" and "foo/" are different scopes.
export function covers(scope, target) {
  if (scope.endsWith(SLASH)) return target === scope || target.startsWith(scope);
  return target === scope;
}

export function overlaps(a, b) {
  return covers(a, b) || covers(b, a);
}

// ---- case-ambiguity helpers: the only place fold/strip are used ----

function foldAscii(p) {
  return p.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

function stripOneSlash(p) {
  return p.endsWith(SLASH) ? p.slice(0, -1) : p;
}

function related(a, b) {
  return covers(a, b) || covers(b, a) || stripOneSlash(a) === stripOneSlash(b);
}

// True when two distinct declared paths would refer to overlapping (or same-named)
// entries on a case-insensitive filesystem but not under exact Git semantics.
export function isCaseAmbiguous(a, b) {
  return a !== b && related(foldAscii(a), foldAscii(b)) && !related(a, b);
}

// Business rule for each common L0 path rule (repo-path.mjs).
const L0_RULES = {
  'PATH-GRAMMAR': 'BR-PATH-GRAMMAR',
  'PATH-TRAILING-DOT': 'BR-PATH-TRAILING-DOT',
  'PATH-DEVICE-NAME': 'BR-PATH-DEVICE-NAME',
  'PATH-GIT-SEGMENT': 'BR-PATH-GIT-SEGMENT',
  'PATH-LEADING-DASH': 'BR-PATH-LEADING-DASH',
};

// ---- rules ----

function fileNameMatchesSpec(fileName, specId) {
  if (fileName.length === 0 || fileName.length > MAX_FILE_NAME) return false;
  if (fileName.includes(SLASH) || fileName.includes(BACKSLASH)) return false;
  const prefix = specId + '-';
  const suffix = '.md';
  if (fileName.length < prefix.length + suffix.length + 1) return false;
  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) return false;
  const slug = fileName.slice(prefix.length, fileName.length - suffix.length);
  return slug.length <= MAX_SLUG && SLUG.test(slug);
}

function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function validateTaskSpecBusiness(spec, { fileName } = {}) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('validateTaskSpecBusiness: spec must be a schema-valid TaskSpec object');
  }
  if (typeof fileName !== 'string') {
    throw new TypeError('validateTaskSpecBusiness: fileName must be a string');
  }

  const found = new Map(); // key "path|rule" -> { rule, path }
  const add = (rule, path) => found.set(`${path}|${rule}`, { rule, path });

  // BR-FILENAME: basename only, exactly spec_id + "-" + slug + ".md".
  if (!fileNameMatchesSpec(fileName, spec.spec_id)) add('BR-FILENAME', '');

  // BR-ID-UNIQUE: within each collection; every repeat after the first is reported.
  for (const [collection, field] of ID_COLLECTIONS) {
    const seen = new Set();
    spec[collection].forEach((item, index) => {
      const id = item[field];
      if (seen.has(id)) add('BR-ID-UNIQUE', `/${collection}/${index}/${field}`);
      else seen.add(id);
    });
  }

  const allowed = spec.scope.allowed_paths;
  const forbidden = spec.scope.forbidden_paths;

  // BR-SCOPE-CONFLICT: an allowed entry identical to, or inside, a forbidden entry can
  // never be used. A forbidden entry inside an allowed directory is valid narrowing.
  allowed.forEach((a, i) => {
    for (const f of forbidden) {
      if (covers(f, a)) add('BR-SCOPE-CONFLICT', `/scope/allowed_paths/${i}`);
    }
  });

  // BR-PATH-CASE-AMBIGUOUS: every pair of distinct entries in allowed-then-forbidden
  // order; reported at the later entry.
  const entries = [
    ...allowed.map((p, i) => ({ p, ptr: `/scope/allowed_paths/${i}` })),
    ...forbidden.map((p, i) => ({ p, ptr: `/scope/forbidden_paths/${i}` })),
  ];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (isCaseAmbiguous(entries[i].p, entries[j].p)) add('BR-PATH-CASE-AMBIGUOUS', entries[j].ptr);
    }
  }

  // Common L0 path policy (ADR-AI-010) for both lists, one error per violated rule per entry,
  // never normalized. BR-PATH-TRAILING-DOT: a segment ending in "." is a Windows alias of the
  // path without the dot (e.g. "CLAUDE.md." -> "CLAUDE.md"). BR-PATH-DEVICE-NAME,
  // BR-PATH-GIT-SEGMENT, BR-PATH-LEADING-DASH: Windows device aliases, Git metadata and
  // option-like segments. BR-PATH-GRAMMAR only fires for input that skipped the schema.
  for (const { p, ptr } of entries) {
    for (const violation of repoPathViolations(p, { directory: true })) add(L0_RULES[violation], ptr);
  }

  if (found.size === 0) return { ok: true };
  const errors = [...found.values()].sort(
    (x, y) => compareCodeUnits(x.path, y.path) || compareCodeUnits(x.rule, y.rule),
  );
  return {
    ok: false,
    code: 'E_TASKSPEC_BUSINESS',
    errorCount: errors.length,
    errors: errors.slice(0, MAX_BUSINESS_ERRORS),
  };
}
