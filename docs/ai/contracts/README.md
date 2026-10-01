# HLG AI engineering contracts

Architecture of the machine-readable contract layer. Decisions:
[ADR-AI-004](../adr/ADR-AI-004-machine-readable-engineering-contracts.md) (contracts, validation),
[ADR-AI-005](../adr/ADR-AI-005-deterministic-sha-bound-gates.md) (gates, evidence, SHA),
[ADR-AI-006](../adr/ADR-AI-006-human-approval-evidence.md) (human approval).

**Status (A3.3a):**

- **Exists:** V1 JSON Schemas ([schemas/v1/](schemas/v1/): one common schema and seven
  contract schemas), one valid example per contract ([examples/v1/](examples/v1/)), the trusted
  schema loader (`scripts/ai/contract-schemas.mjs`, Ajv 8.20.0 strict mode, local files only)
  and schema tests (`node --test "test/ai/*.node-test.mjs"`). These tests are not yet run by CI.
- **Not implemented yet:** parsing of untrusted artifact bytes, the validator API and CLI;
  SHA, evidence and approval verification; GateDecision aggregation; GitHub integration.
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

| Layer | Checks |
|---|---|
| Parse | 2 MiB byte cap before decoding; UTF-8 only (no BOM, no NUL, fatal decoding); duplicate keys explicitly rejected; no canonical-byte requirement; unexpected or reserved property names rejected by the closed schemas ([ADR-AI-007](../adr/ADR-AI-007-contract-input-parsing.md)) |
| Schema | `artifact_type`, `schema_version` (integer `1`), required fields, unknown fields rejected, closed enums, 40-hex SHAs, path grammar, bounded strings/arrays |
| Business rules | Cross-field and cross-artifact consistency (IDs unique, references exist, changed files within scope) |
| Security/policy | Secret-like and PII-like values, always-forbidden paths, evidence host allowlist, prose not accepted as deterministic evidence |
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
| A3.3b | Untrusted-input parsing, validator API and CLI | Not started |
| — | CI step running the contract tests | Owner workflow approval; not started |
| A3.4 | Business-rule and security/policy validation; TaskSpec block extraction | — |
| A3.5 | SHA, evidence and ApprovalRef verification | — |
| A3.6 | Deterministic gate aggregator and policy table | — |
| A3.7 | GitHub integration (checks, artifacts) | Workflow permissions approval; identity separation (ADR-AI-006) |
