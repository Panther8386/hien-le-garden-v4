# ADR-AI-001: GitHub and tracked repository artifacts are the system of record

- Status: Accepted
- Date: 2026-10-01
- Deciders: Vĩnh (owner)

## Context

AI-assisted work produces a lot of material: chat sessions, agent memory, scratchpads, local
plan files in ignored directories. Until now, important decisions for this repository often
existed only there. That material is not reviewable, not durable, not shared, and may contain
reasoning that was later abandoned. Future agents starting cold cannot rely on it.

## Decision

Canonical engineering records belong in **tracked repository files and GitHub artifacts**,
not in chat history or ignored local agent directories.

Canonical:

- approved architecture (`docs/ai/architecture/`);
- ADRs (`docs/ai/adr/`);
- feature specs (`docs/ai/specs/`);
- concise implementation reports;
- review and eval evidence;
- gate decisions where applicable (`docs/ai/decisions/` or PR records);
- Git commit, pull request and CI check history.

Not canonical:

- raw chain-of-thought / reasoning traces;
- scratch prompts;
- local temporary analysis;
- ignored agent state (e.g. `.superpowers/`, memory stores, scratchpads);
- transient chat history.

## Consequences

- A decision that is not written into a tracked artifact is not yet a decision of record.
- Agents must read `CLAUDE.md` and `docs/ai/` rather than rely on remembered context.
- Some extra writing effort per change; kept small by preferring concise reports.

## Security implications

- Everything committed is durable and visible to repository readers: no secret values, no
  customer PII, no raw transcripts that might contain either.
- Reviewing records via PR gives a human check on what becomes canonical.

## Alternatives considered

- Chat history / agent memory as the record — rejected: not reviewable, not durable, not shared.
- External wiki — rejected for V1: separates decisions from the code and its review history.

## Reversibility

High. Records can be moved later (e.g. to a wiki) through a superseding ADR; Git history keeps
the originals.
