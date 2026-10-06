# HLG AI engineering contracts

Architecture of the machine-readable contract layer. Decisions:
[ADR-AI-004](../adr/ADR-AI-004-machine-readable-engineering-contracts.md) (contracts, validation),
[ADR-AI-005](../adr/ADR-AI-005-deterministic-sha-bound-gates.md) (gates, evidence, SHA),
[ADR-AI-006](../adr/ADR-AI-006-human-approval-evidence.md) (human approval),
[ADR-AI-007](../adr/ADR-AI-007-contract-input-parsing.md) (input parsing).

**Status (A3.4d complete):**

- **Exists:** V1 JSON Schemas ([schemas/v1/](schemas/v1/): one common schema and seven
  contract schemas), one valid example per contract ([examples/v1/](examples/v1/)), the trusted
  schema loader (`scripts/ai/contract-schemas.mjs`, Ajv 8.20.0 strict mode, local files only),
  and the parser/validator and CLI (`scripts/ai/validate-contract.mjs`):
  `node scripts/ai/validate-contract.mjs <file>` (exit 0 valid, 1 invalid, 2 usage/I/O,
  3 internal). Input rules per ADR-AI-007: 2 MiB byte cap, UTF-8 only, duplicate keys
  rejected, no canonical-byte requirement.
- **TaskSpec machine-block extraction** exists (`scripts/ai/extract-taskspec.mjs`, lexical
  only; grammar in [specs/README.md](../specs/README.md)).
- **TaskSpec business and path validation** exists (`scripts/ai/taskspec-business.mjs`; rules
  in [specs/README.md](../specs/README.md)).
- **TaskSpec security / capability policy** exists (`scripts/ai/taskspec-policy.mjs`, trusted
  registry `scripts/ai/taskspec-policy-registry.mjs`; ADR-AI-008). It is declaration policy
  only: a pass is not approval or authority, and `protectedCategories` is classification
  metadata only.
- **Tests:** `test/ai/*.node-test.mjs`. PR CI (`.github/workflows/test.yml`, job `test`, step
  "AI contract tests (node:test)") runs seven test files: contract-schema, contract-validator,
  TaskSpec extractor, TaskSpec business, TaskSpec policy, secret detector and TaskSpec composer,
  one per `node --test` call with an existence check (`set -e`, `test -f`). Verified on Linux
  in A3.3c, A3.4a and A3.4b; for A3.4c the step passed on PR #5 at exact SHA
  `8144004702d2532d7cbe0fe0b8b1e2eb739f6134` (workflow "Tests", run 37435892253,
  `pull_request`, attempt 1; checks `test` and "Release artifact boundary (R-1)" both success).
  For A3.4d the seven-file step passed on PR #6 (see below). Each piece of evidence applies to
  its SHA only.
- **A3.4c closeout:** implementation, independent security review, remediation of finding F1
  (HIGH, Windows trailing-dot path aliases; fixed by `BR-PATH-TRAILING-DOT` in `8ff7dbe`,
  re-reviewed with no bypass found), CI enforcement and Linux CI evidence are complete.
  PR #5 remains Draft; no merge or deployment authority is granted. Other review findings
  remain open or deferred (see the slice table).
- **A3.4d closeout (TaskSpec composer, ADR-AI-009):** complete.
  - Supported entry point: `createTaskSpecValidator().validateTaskSpecMarkdown(bytes, { fileName })`
    (`scripts/ai/validate-taskspec.mjs`). Stage order EXTRACT → SECRET_SCAN → CONTRACT → TYPE →
    BUSINESS → POLICY → RESULT; the first failing stage ends validation. Shared linear
    high-confidence secret detector: `scripts/ai/secret-detector.mjs`.
  - Findings: F2 (business must run before policy) **closed** — independent review PASS,
    composer/business/TYPE behaviour validated, exact-head Linux CI PASS. F3 (linear `sk-`
    detection) **closed** — shared detector reviewed, linear `sk-` handling established, the
    secret-detector suite ran in the successful fail-closed Linux step. F4 (schema-first
    ordering) **closed** — independent review PASS, composer and import-boundary behaviour
    validated, the composer suite ran in the successful fail-closed Linux step, R-1 PASS.
    Review findings C3-1, C3-2, R3-1, R4-1, R4-2 and R4-3 are closed.
  - Linux CI evidence: PR #6, workflow "Tests", run 37474931828, `pull_request`, exact head
    `0a7b6c25f31c5f05981ff1117bb5586c9cf15d6e`, conclusion success; checks `test` and
    "Release artifact boundary (R-1)" both PASS. GitHub-hosted `ubuntu-latest`, Node 22
    configured via `actions/setup-node@v4`. Per-suite Linux test counts, the exact Node patch
    version and the result of the individual symlink assertion are not available from
    unauthenticated evidence (symlink detail: UNKNOWN); closure rests on the successful
    fail-closed step and workflow.
  - Closure is an owner decision on that evidence. PR #6 remains Draft and unmerged; no merge,
    deployment or production authority is granted, and no production change was made.
- **Not implemented yet:** SHA freshness; evidence trust;
  approval verification; deterministic GateDecision aggregation; base-branch validation of
  governance-sensitive changes; GitHub integration.
- Schema validity is structural only: a schema-valid GateDecision (even one saying PASS) is not
  an authoritative decision, and a schema-valid EvidenceRef or ApprovalRef is not verified.

## Purpose

Let agents, review bots, evals and the gate exchange validated structured artifacts instead of
free-form chat, so that decisions are reproducible from tracked definitions and SHA-bound inputs.

## Contract types and trust

| Contract | Producer | Main consumers | Trust | Authority |
|---|---|---|---|---|
| TaskSpec | Agent may draft; owner approves | Coding Agent, reviewers, gate | High once approval is verified | Defines scope only; never grants production authority |
| ImplementationReport | Claude Coding Agent | Reviewers, gate, human | Low (self-report) | Advisory; its test claims are not gate evidence |
| CodeReviewReport | Code Review Bot (AI) | Gate, human | Observations | Advisory; gate impact derived by policy |
| SecurityReviewReport | Security Bot (AI) | Gate, human | Observations | Advisory; gate impact derived by policy |
| SEOReviewReport | SEO Review Bot (AI) | Gate, human | Observations | Advisory; gate impact derived by policy |
| EvalReport | CI (deterministic section); AI evals (semantic section) | Gate | Deterministic section high when CI-produced; semantic advisory | Deterministic section feeds the gate; semantic never overrides it |
| GateDecision | Deterministic aggregation code only | Human, PR checks | Derived, reproducible | A result, not an authority: PASS never merges or deploys |

## Validation pipeline

```
JSON parse → schema → business rules → security/policy → SHA/evidence → deterministic aggregation
```

For a TaskSpec file the supported composer runs EXTRACT → SECRET_SCAN → CONTRACT (parse and
schema) → TYPE → BUSINESS → POLICY, failing closed at the first failing stage
([ADR-AI-009](../adr/ADR-AI-009-taskspec-composition-and-secret-scan.md),
[specs/README.md](../specs/README.md)).

| Layer | Checks |
|---|---|
| Parse | 2 MiB byte cap before decoding; UTF-8 only (no BOM, no NUL, fatal decoding); duplicate keys explicitly rejected; no canonical-byte requirement; unexpected or reserved property names rejected by the closed schemas ([ADR-AI-007](../adr/ADR-AI-007-contract-input-parsing.md)) |
| Schema | `artifact_type`, `schema_version` (integer `1`), required fields, unknown fields rejected, closed enums, 40-hex SHAs, path grammar, bounded strings/arrays |
| Business rules | Cross-field and cross-artifact consistency (IDs unique, references exist, changed files within scope) |
| Security/policy | High-confidence secret formats only (no PII, entropy or bare-word scanning; [ADR-AI-008](../adr/ADR-AI-008-taskspec-scope-classes-and-authority.md)), always-forbidden paths, evidence host allowlist, prose not accepted as deterministic evidence |
| SHA/evidence | Referenced commits, paths and lines exist; all inputs bound to the expected head/base; approvals verified at source |
| Aggregation | Deterministic GateDecision (ADR-AI-005) |

## Strict schema principles

JSON Schema draft 2020-12; unknown fields rejected everywhere; explicit `artifact_type`;
`schema_version` integer `1` with exact-match support; bounded strings and arrays; closed enums;
repository-relative paths without `..`, absolute paths, backslashes or globs (V1 entries are
exact files or directory prefixes ending in `/`); no executable expressions; no raw
chain-of-thought, secrets or customer PII.

## EvidenceRef

A pointer to an independently inspectable source: repository file or line at a SHA, Git
commit, Git diff, test, CI check, allowlisted HTTP probe, schema-validation result. Producers
may point at evidence; **verification decides whether it holds**. Prose is never sufficient for
a deterministic PASS.

## ApprovalRef

A pointer to an external human-approval source (e.g. a PR comment approval command bound to a
blob SHA, or a merge event). It carries no authority; verification code decides validity.
Agent-written fields such as `human_approved` or `approved_by` are never approval evidence.
Current limitation: no strong human/agent identity separation (ADR-AI-006).

## SHA and staleness

- Git SHA is the freshness authority; timestamps are audit metadata.
- Contracts bind to `base_commit`, `source_commit` and (ImplementationReport) `result_commit`;
  the expected head/base come from the environment.
- After a new commit (or a moved base) earlier reports are stale and must be regenerated.
- One decision uses inputs from one explicit run; mixed SHAs or duplicate artifact types make
  the decision ERROR.

## Storage lifecycle (target)

| Artifact | Location |
|---|---|
| Schemas, gate policy, approver allowlist | Tracked repository |
| TaskSpec | Tracked `docs/ai/specs/SPEC-AI-NNN-slug.md` + approval comment on the PR |
| ImplementationReport | PR body summary; full JSON as a GitHub Actions artifact or local transient file |
| Review reports, EvalReport | Actions artifact + self-contained PR/Check summary (not committed) |
| GateDecision | GitHub Check summary + Actions artifact; `DEC-NNN` record only for release-level decisions |

High-volume run outputs are not committed (ADR-AI-001).

## GateDecision authority

Produced only by deterministic code. Precedence: ERROR > FAIL > BLOCKED > WAITING_HUMAN > PASS.
AI cannot override a deterministic FAIL, cannot set `blocking`/`gate_impact`, and cannot create
approvals. PASS is eligibility for human action only.

## Review Bot separation

Review Bot runtime output (customer-feedback analysis) uses separate application schemas in a
different trust domain. Only conventions are shared with engineering contracts.

## Implementation slices

| Slice | Content | Prerequisite / status |
|---|---|---|
| A3.1 | ADRs and this documentation | Done |
| A3.2 | Add Ajv as an exact-pinned devDependency (isolated commit) | Done (ajv 8.20.0) |
| A3.3a | Common + seven schemas, examples, trusted loader, schema tests | Done |
| A3.3b | Untrusted-input parsing, validator API and CLI (ADR-AI-007) | Done |
| A3.3c | CI step running the contract tests | Done (Linux CI verified) |
| A3.4a | TaskSpec machine-block extractor and tests | Done (Linux CI verified) |
| A3.4b | TaskSpec business and path validation and tests | Done (Linux CI verified) |
| A3.4c | TaskSpec security / capability policy and tests (ADR-AI-008) | Done (Linux CI verified on Draft PR #5 at `8144004`, run 37435892253) |
| A3.4d | End-to-end TaskSpec composition | Done (Linux CI verified on Draft PR #6 at `0a7b6c2`, run 37474931828); F2, F3, F4 closed |
| A3.5 | SHA, evidence and ApprovalRef verification | Common path safety for ImplementationReport / EvidenceRef / Finding paths before repository paths are trusted |
| A3.6 | Deterministic gate aggregator and policy table | Deferred findings F6 (protect deterministic-check configuration), F8 (governance-specific gate), F9 (producer/verifier separation) |
| A3.7 | GitHub integration (checks, artifacts) | Workflow permissions approval; identity separation (ADR-AI-006); F6/F8/F9 as for A3.6 |
