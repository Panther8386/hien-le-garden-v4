# Feature specifications

A spec is the contract a feature is built, reviewed and gated against. Agents implement to the
spec; reviewers and evals check against it. No spec exists yet; this file defines the contract.

## Conventions

- File name: `SPEC-AI-NNN-short-kebab-title.md`.
- Status: `Draft` → `Approved` → `Implemented` | `Withdrawn`.
- Implementation starts only from an `Approved` spec; scope changes go back through review.

## Required sections

```markdown
# SPEC-AI-NNN: <Title>

- ID: SPEC-AI-NNN
- Status: Draft | Approved | Implemented | Withdrawn
- Owner: <name>

## Problem
## Scope
## Non-goals
## Requirements
## Security / privacy
   (data handled, PII, secrets, untrusted inputs, external AI calls and redaction)
## Acceptance criteria
## Deterministic tests
   (tests/checks that must pass; these are blocking — ADR-AI-002)
## AI eval requirements (if applicable)
   (eval set, metrics, thresholds; evals never override deterministic tests)
## Migration impact
   (new/changed D1 migrations; remote apply requires human approval)
## Deployment impact
   (bindings, secrets by name only, config, rollout/rollback)
## Human gates
   (which steps need explicit human approval — ADR-AI-003)
```
