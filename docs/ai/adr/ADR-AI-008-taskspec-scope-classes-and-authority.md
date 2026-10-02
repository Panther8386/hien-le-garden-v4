# ADR-AI-008: TaskSpec protected scope policy and authority boundary

- Status: Accepted
- Date: 2026-10-02
- Deciders: Vĩnh (owner)

## Context

A TaskSpec ([ADR-AI-004](ADR-AI-004-machine-readable-engineering-contracts.md)) declares the
repository scope an implementation may touch. Extraction (A3.4a) and business/path validation
(A3.4b, `scripts/ai/taskspec-business.mjs`) exist. Some repository paths carry more authority
than ordinary application code: dependency definitions, database migrations, the production
deploy path and release boundary, and the files that govern the AI agents themselves.

The committed TaskSpec schema offers, for this purpose: `scope.allowed_paths` /
`scope.forbidden_paths`, `declared_changes {package, migration, production_config}` (required
booleans), and `human_gates[].type ∈ {package_change, migration, production, custom}`. It has no
field for authority actions and no typed governance gate.

This ADR fixes the design of the next layer (A3.4c, TaskSpec security/capability policy) before
it is implemented. **Nothing in this ADR is implemented yet.**

## Decision

### Nature of the layer

- A3.4c is **declaration policy only**: it checks that a schema-valid, business-valid TaskSpec
  *declares* what HLG policy requires for the protected scopes it touches.
- A PASS means only "the TaskSpec declaration passes deterministic A3.4c policy validation". It
  does **not** mean approved, human-approved, authorized to execute, authorized to merge,
  authorized to deploy, current or safe.
- **Declaration ≠ approval ≠ execution authority.** A declared human gate is not evidence that a
  human approved anything (ADR-AI-006), and approval is not execution authority (ADR-AI-003).
- **Authority actions remain outside TaskSpec authority**: merge, push to `main`, production
  deploy, remote/production migration, secret changes, GitHub settings, Cloudflare changes,
  webhook changes, real external messages, account/permission changes, deployment deletion. The
  V1 schema cannot represent them, and they never become executable because a path or gate
  validates. Policy does not infer them from prose.

### Protected registry

- The protected registry is **committed trusted data**: a small, explicit, frozen list of paths
  with one category each, not discovered from the filesystem and independent of the OS.
- **No caller-supplied policy** may weaken enforcement: the policy API takes no policy argument.
- Categories and entries (paths use A3.4b lexical Git/Linux semantics; a trailing `/` is a
  directory prefix):

| Category | Entries |
|---|---|
| PACKAGE | `package.json`, `package-lock.json` |
| MIGRATION | `migrations/` |
| PRODUCTION | `wrangler.toml`, `.github/workflows/deploy.yml`, `scripts/build-static.mjs`, `scripts/dist-policy.mjs`, `scripts/check-dist.mjs`, `scripts/probe-private-urls.mjs`, `scripts/check-staging-bindings.mjs` |
| GOVERNANCE | `CLAUDE.md`, `.github/`, `docs/ai/adr/`, `docs/ai/contracts/schemas/`, `docs/ai/specs/`, `scripts/ai/`, `test/ai/` |

### Required declarations per category

| Category | Required when touched |
|---|---|
| PACKAGE | `declared_changes.package === true` **and** at least one `human_gates[].type === "package_change"` |
| MIGRATION | `declared_changes.migration === true` **and** at least one `human_gates[].type === "migration"` |
| PRODUCTION | `declared_changes.production_config === true` **and** at least one `human_gates[].type === "production"` |
| GOVERNANCE | at least one `human_gates[].type === "custom"` |

- **PACKAGE:** this is **not** package approval. Formal approval is an ApprovalRef bound to the
  lockfile blob (ADR-AI-006), verified in a later phase.
- **MIGRATION:** A3.4c does **not** authorize migration execution. Migration `0043` remains
  reserved for TOTP replay protection; A3.4c defines no lexical rule claiming to reserve it (a
  `migrations/` scope covers any file in it). The reservation is enforced by later
  diff/approval enforcement.
- **PRODUCTION:** `production_config` is a repository declaration only. It grants no deploy and
  no production authority.
- **GOVERNANCE — V1 limitation, stated prominently:** the `custom` gate requirement is **only a
  V1 declaration requirement**. It is **not** proof that a governance modification was approved,
  it is **not** sufficient execution authority, and it must **not** be interpreted as permission
  for an agent to modify governance autonomously. `custom` gates are free text, so policy cannot
  tell which custom gate addresses governance. A future schema may add a typed governance gate.

### `declared_changes` consistency (TaskSpec only)

- PACKAGE touched ⇔ `declared_changes.package`; MIGRATION touched ⇔ `declared_changes.migration`;
  PRODUCTION touched ⇔ `declared_changes.production_config`.
- Both directions are inconsistencies: touched but `false`, and `true` but untouched.
- GOVERNANCE has no `declared_changes` field in V1.
- Checking the real Git diff against these declarations is later work, not A3.4c.

### Path and case semantics

- A registry entry is **touched** when an allowed entry lexically overlaps it under A3.4b
  semantics (`overlaps()`: either covers the other, including identity).
- A3.4c **reuses** `covers()`, `overlaps()` and `isCaseAmbiguous()` from
  `scripts/ai/taskspec-business.mjs`. There is no second path-normalization or ASCII-folding
  algorithm.
- Case ambiguity between an `allowed_paths` entry and a registry entry (e.g. `Package.json` vs
  `package.json`, `Migrations/` vs `migrations/`) **fails closed**.
- `forbidden_paths` do not independently require protected gates, because they grant nothing. A
  forbidden entry excludes a registry entry only when it covers that entry under `covers()`.

### Checks registry

- `deterministic_checks` are **not** globally interpreted in A3.4c, and **no authoritative
  deterministic-check registry** is introduced; that remains for the future gate/policy layer.

### `protectedCategories`

A future successful policy result may expose `protectedCategories`. It means **only** which
protected repository categories the TaskSpec scope touches. It does **not** mean capability
granted, approval obtained, gate satisfied by a human, execution authorized, merge authorized or
deploy authorized. It is classification metadata only.

### Secret detection

- A3.4c uses **conservative, high-confidence** secret detection only: credential formats with a
  distinctive prefix and fixed structure (e.g. private-key headers, GitHub tokens, and
  credentials of providers HLG actually uses or plans to use). Each provider-specific pattern
  must be justified by an actual HLG integration or the architecture.
- No PII scanner, no entropy scanner, no matching of bare words such as password, secret, token
  or key. Variable names (e.g. `BREVO_API_KEY`) are not secrets.
- Errors never contain matched secret material, fragments, prefixes or lengths; only sanitized
  deterministic metadata.
- **Test fixtures** that resemble credentials are assembled at runtime, so no contiguous
  credential-shaped string is committed to source. No real credential is ever used in tests.

### Error model

- Failure code `E_TASKSPEC_POLICY`; errors keep the minimal shape `{ rule, path }` (paths are JSON
  pointers built from schema field names and indices).
- No secret value or untrusted free-text value appears in errors.
- Deterministic ordering, de-duplication, at most 20 returned errors, `errorCount` = unique total
  before the cap (as A3.4b).
- The exact rule vocabulary is defined by the implementation, consistent with this ADR.

### Fail-closed behaviour

- Protected scope touched with a missing required declaration → fail.
- Protected scope touched with a missing required gate declaration → fail.
- Protected case ambiguity → fail.
- An unknown registry category or an invalid trusted registry → programmer error or
  initialization failure, never PASS.
- Overlapping protected entries of different categories **accumulate** requirements (e.g.
  `.github/workflows/deploy.yml` is both PRODUCTION and GOVERNANCE); a weaker category never
  overrides a stronger one.

## Consequences

- Protected changes become visible and must be declared before implementation; ordinary
  application paths stay unrestricted.
- Governance changes remain dependent on human review in V1 (see Security implications).
- The registry and policy code are themselves GOVERNANCE scope.

## Security implications

### Governance self-validation risk (finding)

A pull request that modifies validator code, the policy registry, AI tests, the CI workflow,
TaskSpec schemas or other governance enforcement may otherwise be evaluated by **the same
modified head code** (a `pull_request` workflow runs the head's definitions). A weakened
validator could pass itself.

Therefore, **before automated governance gate enforcement is trusted**, phases A3.6/A3.7 must
evaluate governance-sensitive changes with trusted base-branch validation logic, or an equivalent
independent trust boundary, **plus human review**. A3.4c alone does not solve this, and this ADR
does not implement that mechanism.

### Other

- Case-insensitive filesystems cannot be used to bypass protected scope (fail-closed ambiguity).
- Secret detection is intentionally narrow; unusual credential formats are not detected.

## Out of scope (later work)

ApprovalRef verification; EvidenceRef verification; blob SHA freshness; actual Git diff
enforcement; actual package diff enforcement; actual migration enforcement; production
execution; deploy authorization; GitHub reviewer identity; human approval verification; gate
aggregation; GitHub API actions; OpenAI calls; agent execution; base-branch governance
validation implementation.

## Alternatives considered

- Never allowing governance paths in a TaskSpec — rejected: governance changes must be
  requestable, under a human gate.
- Caller-supplied policy — rejected: it could weaken enforcement.
- Protecting all of `docs/ai/` or all tests — rejected: too broad for ordinary development.
- A lexical rule reserving migration `0043` — rejected: gives false assurance.

## Reversibility

Medium. The registry and requirements can be changed only by a reviewed change to GOVERNANCE
scope; a typed governance gate requires a schema version change (ADR-AI-004).
