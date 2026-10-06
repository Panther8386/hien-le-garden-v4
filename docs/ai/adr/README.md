# Architecture Decision Records (ADR-AI)

Long-lived engineering/architecture decisions for the HLG AI Platform.
For bounded project/release decisions use [decisions/](../decisions/README.md) instead.

## Conventions

- File name: `ADR-AI-NNN-short-kebab-title.md`, numbers never reused.
- Status: `Proposed` → `Accepted` → (`Superseded by ADR-AI-NNN` | `Deprecated`).
- An accepted ADR is not rewritten; change it by adding a new ADR that supersedes it.
- ADRs are added and changed only through reviewed pull requests.

## Format

```markdown
# ADR-AI-NNN: <Title>

- Status: Proposed | Accepted | Superseded by ADR-AI-NNN | Deprecated
- Date: YYYY-MM-DD
- Deciders: <names/roles>

## Context
## Decision
## Consequences
## Security implications
## Alternatives considered
## Reversibility
```

## Index

| ID | Title | Status |
|---|---|---|
| [ADR-AI-001](ADR-AI-001-github-system-of-record.md) | GitHub and tracked repository artifacts are the system of record | Accepted |
| [ADR-AI-002](ADR-AI-002-deterministic-gates-outrank-ai.md) | Deterministic gates outrank AI judgments | Accepted |
| [ADR-AI-003](ADR-AI-003-human-production-authority.md) | Human authority is required for production | Accepted |
| [ADR-AI-004](ADR-AI-004-machine-readable-engineering-contracts.md) | Machine-readable engineering contracts | Accepted (parse layer superseded by ADR-AI-007) |
| [ADR-AI-005](ADR-AI-005-deterministic-sha-bound-gates.md) | Deterministic, SHA-bound gate decisions | Accepted |
| [ADR-AI-006](ADR-AI-006-human-approval-evidence.md) | Human approval evidence | Accepted |
| [ADR-AI-007](ADR-AI-007-contract-input-parsing.md) | Contract input parsing | Accepted |
| [ADR-AI-008](ADR-AI-008-taskspec-scope-classes-and-authority.md) | TaskSpec protected scope policy and authority boundary | Accepted |
| [ADR-AI-009](ADR-AI-009-taskspec-composition-and-secret-scan.md) | TaskSpec composition and secret-scan trust boundary | Accepted |
