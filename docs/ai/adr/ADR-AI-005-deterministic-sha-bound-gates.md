# ADR-AI-005: Deterministic, SHA-bound gate decisions

- Status: Accepted
- Date: 2026-10-01
- Deciders: Vĩnh (owner)

## Context

[ADR-AI-002](ADR-AI-002-deterministic-gates-outrank-ai.md) states that deterministic gates
outrank AI judgment, and [ADR-AI-003](ADR-AI-003-human-production-authority.md) that humans hold
production authority. The contract layer ([ADR-AI-004](ADR-AI-004-machine-readable-engineering-contracts.md))
needs a gate model that makes both machine-enforceable. **No gate aggregator exists yet.**

## Decision

### Authority

- **GateDecision is produced only by deterministic code** (a pure aggregation function over an
  explicit set of validated inputs). The same inputs always yield the same decision.
- AI must never author an authoritative final gate decision. A GateDecision supplied as an
  input is ignored and recomputed.
- **PASS means "eligible for human action" only. PASS never merges or deploys.**

### States and precedence

**ERROR > FAIL > BLOCKED > WAITING_HUMAN > PASS**

| State | Meaning |
|---|---|
| ERROR | Inputs cannot be trusted or evaluated (missing, invalid, unsupported, stale, mixed, conflicting, unverifiable). |
| FAIL | A required deterministic rule or check failed. **Cannot be waived through the gate**; only a fix, or a human-reviewed change to the check itself, resolves it. |
| BLOCKED | Machine checks pass, but a policy-governed blocking finding, a required semantic threshold, or an explicit human rejection prevents progress. |
| WAITING_HUMAN | Machine gates pass, but a required human decision is pending. |
| PASS | All requirements met; eligible for human action. |

FAIL and BLOCKED stay separate: they differ in remedy and waivability. The decision lists all
reasons, not only the winning one.

### Invariants

- A missing required report cannot PASS.
- An invalid schema cannot PASS.
- An unsupported schema version cannot PASS.
- A stale SHA cannot PASS.
- Mixed SHAs cannot PASS.
- A missing required deterministic check cannot PASS.
- A deterministic FAIL cannot PASS, and AI cannot override it.
- Human approval cannot be invented by AI (see [ADR-AI-006](ADR-AI-006-human-approval-evidence.md)).

### Findings

- AI reviewers may report: `severity`, `category`, `title`, `summary`, location, `evidence`,
  `confidence`, `recommendation`.
- AI must not control `blocking` or `gate_impact`. Finding schemas have **no producer-authored
  `blocking` field**; one is rejected as an unknown field.
- `gate_impact` (`informational` / `non_blocking` / `blocking`) is derived by deterministic,
  versioned, committed policy from reviewer type, category, severity and whether the evidence
  verified. A finding without verified evidence is informational.
- `confidence` never determines gate authority.
- A human may waive a blocking AI finding through verified approval evidence; nobody can waive
  a deterministic FAIL through the gate.

### Evidence

- `EvidenceRef` points to independently inspectable sources: repository file or line at a SHA,
  Git commit, Git diff, test, CI check, allowlisted HTTP probe, schema-validation result.
- **Trust comes from verification, not from producer identity.** A producer may point at
  evidence; verification code decides whether it holds.
- Arbitrary prose is never sufficient evidence for a deterministic PASS.
- Human approvals are a separate structure, `ApprovalRef` (ADR-AI-006), not an EvidenceRef type.

### SHA and freshness

- **Git SHA is the freshness authority. Timestamps are audit metadata only.**
- Contracts bind to `base_commit`, `source_commit` (the commit reviewed/evaluated) and, for
  implementation reports, `result_commit`. The expected head and base come from the
  environment (CI event payload or local Git), not from the artifacts.
- After a new commit, reports for the previous SHA are **stale** and cannot be reused. A moved
  base likewise requires re-evaluation. Stale or invalid inputs make the decision ERROR.
- Inputs to one decision come from one explicit run; two artifacts of the same type in one
  input set, or inputs with differing SHAs, make the decision ERROR.

## Consequences

- Gate results are reproducible and auditable from their inputs.
- Re-running reviews and evals after every new commit is required.
- Reviewer bots gain no authority by what they assert; policy changes are reviewed code changes.

## Security implications

- Prompt injection, forged PASS, stale replay and mixed-SHA aggregation cannot move a decision
  toward PASS.
- The policy table and aggregator are security-sensitive paths that agents may not modify
  without a human gate.

## Alternatives considered

- AI-authored gate decisions — rejected (ADR-AI-002).
- Merging FAIL and BLOCKED — rejected (different waivability).
- Producer-set `blocking` flags or confidence-based blocking — rejected (gives AI authority).
- Timestamp-based freshness — rejected (not tied to the code under review).

## Reversibility

Medium. Changing precedence, waivability or freshness rules requires a superseding ADR.
