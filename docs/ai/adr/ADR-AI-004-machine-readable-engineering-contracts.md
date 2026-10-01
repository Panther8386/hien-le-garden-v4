# ADR-AI-004: Machine-readable engineering contracts

- Status: Accepted. Parse-layer rules (byte cap, canonical bytes, duplicate and reserved keys)
  superseded by [ADR-AI-007](ADR-AI-007-contract-input-parsing.md); the text below is unchanged history.
- Date: 2026-10-01
- Deciders: Vĩnh (owner)

## Context

HLG AI Platform agents, review bots, evals and the gate must exchange structured, validated
artifacts instead of free-form chat (ADR-AI-001). At the time of this decision the repository
has no schema validator as a direct dependency (direct devDependencies: `vitest`,
`@cloudflare/vitest-pool-workers`, `wrangler`, `@playwright/test`), first-party code validates
by hand, and the Vitest suite runs inside workerd rather than Node. Engineering contracts are
consumed by Node tooling (local orchestrator, GitHub Actions), not by the application runtime.

**Nothing in this ADR is implemented yet.** No schema, validator or contract test exists.

## Decision

### Contract set (V1)

Seven engineering contract types:
`TaskSpec`, `ImplementationReport`, `CodeReviewReport`, `SecurityReviewReport`,
`SEOReviewReport`, `EvalReport`, `GateDecision`.
GateDecision rules are in [ADR-AI-005](ADR-AI-005-deterministic-sha-bound-gates.md);
approval evidence in [ADR-AI-006](ADR-AI-006-human-approval-evidence.md).

### Definition format and validator

- **JSON Schema draft 2020-12** is the canonical contract-definition format.
- **Target validator: Ajv (`Ajv2020`), used in Node tooling only** — never in the Workers
  application runtime. Intended options: strict mode, all errors, no type coercion, no
  defaults, no `$data`, no remote schema loading, no format plugin (formats use `pattern`).
- **Ajv is approved architecturally but is NOT installed and NOT authorized for installation
  by this ADR.** Adding it requires a separate, owner-approved package-change phase. Running
  contract tests in CI requires a separate, owner-approved workflow change.
- Rejected: a custom JSON Schema interpreter (security-critical correctness owned in-house),
  Zod (JavaScript-only definitions; the copy in `package-lock.json` is transitive, not an
  approved dependency), handwritten per-contract validation (definition/code drift).

### Strict schema rules

- Every artifact declares `artifact_type` (const per schema) and `schema_version`.
- `schema_version` is the **integer `1`**. Validators accept only exact members of their
  supported set; missing, older, future or non-integer versions are rejected (fail closed).
  Because unknown fields are rejected, every schema change is breaking, so no minor version
  level is used.
- Unknown fields are rejected at every level (`additionalProperties: false`).
- All strings and arrays are bounded (`maxLength`, `maxItems`), including evidence counts.
- Enums are closed. Git commit references are exactly 40 lowercase hex characters.
- Repository paths are repository-relative POSIX paths: no leading `/`, no `\`, no `.` or `..`
  segments, no `//`, no glob characters. Paths are rejected, never silently normalized.
  **No globs in V1**: an entry is an exact file or a directory prefix ending in `/`.
- Contracts contain no executable expressions, no raw chain-of-thought or transcripts, no
  secret values and no customer PII.

### Validation pipeline

```
JSON parse (byte cap before parse; canonical bytes, so duplicate keys are rejected)
  → schema validation          (structure of one artifact)
  → business-rule validation   (cross-field / cross-artifact meaning)
  → security/policy validation (secrets, PII, forbidden paths, evidence hosts)
  → SHA/evidence validation    (Git and GitHub reality)
  → deterministic aggregation  (ADR-AI-005)
```

Each layer fails closed; an artifact failing any layer is treated as invalid.

### TaskSpec representation

- The canonical TaskSpec is one Markdown file, `docs/ai/specs/SPEC-AI-NNN-slug.md`, containing
  **exactly one** fenced machine-readable JSON block.
- The machine block is authoritative for every enforced field. The narrative is
  non-normative context. There is no separate JSON companion file and nothing is generated.
- Details: [specs/README.md](../specs/README.md).

### Review Bot separation

Review Bot runtime outputs (customer-feedback analysis) use separate application schemas in a
different trust domain. Only conventions (closed enums, bounds, unknown-field rejection) are
shared with engineering contracts; no schema files are shared.

## Consequences

- One definition source per contract; no schema/validator drift.
- A package-change phase and a workflow-change phase must precede validator code and CI tests.
- Contract test files must not match the Vitest include pattern, so they are not run in workerd.
- Every schema change bumps `schema_version`; old artifacts are short-lived (SHA-bound, ADR-AI-005).

## Security implications

- Unknown-field rejection and closed enums prevent smuggled control fields (e.g. a
  producer-authored `blocking` or `human_approved`).
- Bounded sizes and pre-parse byte caps limit resource abuse; canonical bytes defeat
  duplicate-key ambiguity.
- A dependency (Ajv) enlarges the supply-chain surface; it is limited to development tooling
  and must be pinned exactly when approved.

## Alternatives considered

- Custom JSON Schema subset interpreter — rejected (correctness risk owned in-house; its main
  motivation, workerd compatibility, does not apply to Node tooling).
- Zod — rejected (not portable as data; would need conversion for other consumers).
- Handwritten validation — rejected except as a fallback if the package is declined.
- Separate Markdown spec plus JSON file — rejected (dual-source drift).

## Reversibility

Medium. The schemas are standard JSON Schema; the validator engine can be swapped without
changing them. Changing the TaskSpec representation requires a superseding ADR.
