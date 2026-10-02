# Feature specifications

A spec is the contract a feature is built, reviewed and gated against. Agents implement to the
spec; reviewers and evals check against it. No spec exists yet; this file defines the contract.

## Conventions

- File name: `SPEC-AI-NNN-short-kebab-title.md`. This one Markdown file is the canonical
  TaskSpec document ([ADR-AI-004](../adr/ADR-AI-004-machine-readable-engineering-contracts.md)).
- Status: `Draft` → `Approved` → `Implemented` | `Withdrawn`.
- Implementation starts only from an `Approved` spec; scope changes go back through review.
- The Status line in the narrative header is informational only. It is not approval evidence
  and is never read by validation tooling. Approval of a spec exists only as a verified
  ApprovalRef bound to the Git blob SHA of the whole spec file (ADR-AI-006); approval
  verification is a later phase.

## Machine-readable block

- Each spec file contains **exactly one** fenced machine-readable JSON block (the TaskSpec).
  A file with zero or more than one such block is invalid.
- The machine block is **authoritative for every enforced field** (scope paths, deterministic
  checks, AI eval requirements, human gates, requirement/acceptance IDs, limits).
- The narrative sections are **non-normative** context. They must not duplicate enforceable
  lists; they refer to the machine block instead.
- There is no separate JSON companion file and nothing is generated from the spec.
- The narrative outside the machine block is non-authoritative.
- `deterministic_checks` IDs are structurally validated in V1 (slug format, uniqueness); the
  authoritative check registry is deferred to the future deterministic gate/policy layer.

## Machine-block grammar (V1)

Implemented by `scripts/ai/extract-taskspec.mjs`. The extractor is lexical: it reads bytes and
lines only and does not parse Markdown or JSON. Its payload is then validated by the contract
validator (`validateContractBytes`, [ADR-AI-007](../adr/ADR-AI-007-contract-input-parsing.md)).

- **Opening marker:** a line consisting exactly of three backticks, `json`, one ASCII space,
  `hlg-taskspec` (i.e. `` ```json hlg-taskspec ``). Column 0, no trailing whitespace,
  case-sensitive.
- **Closing fence:** the first later line consisting exactly of three backticks.
- **Line terminators:** a line ends at LF. For marker and fence comparison only, one CR before
  the LF is ignored, so LF, CRLF and mixed files are accepted.
- **Payload:** the exact original bytes from just after the marker line's LF to just before the
  closing fence line. Nothing is normalized (CR, whitespace and escapes are preserved).
- **Counting:** exact markers are counted anywhere in the file, including inside unrelated code
  blocks. Zero markers or more than one marker make the file invalid, so a spec must not quote
  the marker line itself.
- **Near misses rejected:** any other line that, after trimming, starts with a backtick or tilde
  fence and contains `hlg-taskspec` (any case) is rejected as a malformed marker (for example
  indented, trailing whitespace, four backticks, tildes, different case, double space, missing
  `json`). Prose that mentions `hlg-taskspec` without a fence prefix is ignored.
- A closing line that equals three backticks only after removing trailing spaces/tabs is
  rejected; a block with no closing fence or with no payload bytes is rejected. A
  whitespace-only payload is returned and rejected later by JSON parsing.
- **Byte rules for the whole Markdown file** (as ADR-AI-007): at most 2,097,152 bytes, no UTF-8
  BOM, no NUL byte, valid UTF-8. **Payload limit:** at most 1,048,576 bytes.
- Passing extraction says nothing about schema validity, approval or SHA freshness.
  Security/policy validation of TaskSpecs is not implemented yet.

## Business and path validation (V1)

Implemented by `scripts/ai/taskspec-business.mjs` (`validateTaskSpecBusiness`) on a TaskSpec
that has already passed schema validation. It is deterministic and lexical: no filesystem, Git
or network access. Errors carry only a rule ID and a JSON pointer, never values.

- **`BR-FILENAME`:** the caller-supplied file name is a **basename only** (no `/` or `\`) and
  must be exactly `<spec_id>-<slug>.md`, case-sensitive, where `<spec_id>` is the TaskSpec's
  `spec_id` (its grammar is owned by the schema), the slug matches
  `^[a-z0-9]+(?:-[a-z0-9]+)*$` (1–64 characters) and the whole name is at most 100 characters.
  This ties the file to its spec for traceability; it does not prove that a `spec_id` is unique
  across the repository.
- **`BR-ID-UNIQUE`:** IDs are unique within each collection (`requirements`,
  `acceptance_criteria`, `constraints`, `semantic_evals`, `human_gates`), compared as exact
  strings. Each repeat after the first is reported.
- **Paths** are compared as exact, case-sensitive strings (Git semantics), without
  normalization. A scope ending in `/` is a directory prefix (`foo/` covers `foo/` and anything
  beneath it, but not `foo/barista/` from `foo/bar/`); otherwise it is an exact file. A file
  `foo` and a directory `foo/` are different, non-overlapping scopes.
- **`BR-SCOPE-CONFLICT`:** an allowed entry that is identical to, or inside, a forbidden entry
  is rejected (it could never be used). A forbidden entry inside an allowed directory is valid
  narrowing (deny wins at execution time); a forbidden entry that overlaps nothing is valid.
- **`BR-PATH-CASE-AMBIGUOUS`:** two distinct declared paths are rejected when they would refer
  to overlapping or same-named entries only on a case-insensitive filesystem (ASCII case folding
  is used for this check only), e.g. `migrations/` with `Migrations/`, or allowed `Scripts/`
  with forbidden `scripts/ai/`.
- Passing business validation means only "passes deterministic TaskSpec business validation".
  It is not approval, authorization, freshness, mergeability or deployability. Protected-scope,
  human-gate, declared-change and secret policies are a later layer (not implemented).

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
