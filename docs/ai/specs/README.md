# Feature specifications

A spec is the contract a feature is built, reviewed and gated against. Agents implement to the
spec; reviewers and evals check against it. No spec exists yet; this file defines the contract.

## Conventions

- File name: `SPEC-AI-NNN-short-kebab-title.md`. This one Markdown file is the canonical
  TaskSpec document ([ADR-AI-004](../adr/ADR-AI-004-machine-readable-engineering-contracts.md)).
- Status: `Draft` → `Approved` → `Implemented` | `Withdrawn`.
- Implementation starts only from an `Approved` spec; scope changes go back through review.

## Machine-readable block

- Each spec file contains **exactly one** fenced machine-readable JSON block (the TaskSpec).
  A file with zero or more than one such block is invalid.
- The machine block is **authoritative for every enforced field** (scope paths, deterministic
  checks, AI eval requirements, human gates, requirement/acceptance IDs, limits).
- The narrative sections are **non-normative** context. They must not duplicate enforceable
  lists; they refer to the machine block instead.
- There is no separate JSON companion file and nothing is generated from the spec.
- The exact block marker and TaskSpec schema are defined when the contract schemas are
  implemented; until then no spec should rely on a particular marker.

## Approval binding

- Spec approval binds to the **Git blob SHA of the whole file** (narrative and machine block)
  ([ADR-AI-006](../adr/ADR-AI-006-human-approval-evidence.md)).
- **Any modification of the spec file invalidates its approval.**
- The Coding Agent may not modify its approved TaskSpec; a scope change needs a new approval.

## Required narrative sections

```markdown
# SPEC-AI-NNN: <Title>

- ID: SPEC-AI-NNN
- Status: Draft | Approved | Implemented | Withdrawn
- Owner: <name>

## Problem
## Scope
   (summary only; enforceable paths live in the machine block)
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
## Machine block
   (exactly one fenced JSON TaskSpec block)
```
