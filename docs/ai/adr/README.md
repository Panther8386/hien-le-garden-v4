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
