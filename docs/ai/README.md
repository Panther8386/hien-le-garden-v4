# docs/ai — HLG AI engineering governance

Tracked home for how AI-assisted engineering is governed in the Hiền Lê Garden repository:
architecture, decisions, specifications and the evidence behind them.

## Purpose

Future HLG AI Platform work must not depend on chat history or on local/ignored agent files.
Anything a future contributor (human or agent) needs in order to understand *what was decided,
why, and on what evidence* belongs here, in Git, reviewed through pull requests.

## System of record

The repository and its GitHub lifecycle are the system of record
([ADR-AI-001](adr/ADR-AI-001-github-system-of-record.md)):

- tracked files under `docs/ai/` (architecture, ADRs, specs, decisions, concise reports);
- Git commits, pull requests, CI check results and reviews.

Chat history, scratchpads, ignored directories (e.g. `.superpowers/`) and agent memory stores
are working material only. If something there matters, write the conclusion here.

## Structure

| Path | Contents |
|---|---|
| [architecture/](architecture/) | Platform architecture baselines. Baseline: [HLG-AI-PLATFORM-V1.md](architecture/HLG-AI-PLATFORM-V1.md) |
| [adr/](adr/README.md) | Architecture Decision Records — long-lived engineering decisions (`ADR-AI-NNN`) |
| [specs/](specs/README.md) | Feature specifications — the contract a feature is built and reviewed against |
| [decisions/](decisions/README.md) | Bounded project/release/product decision records |
| `evals/` | *Future.* AI evaluation definitions and results. Not created yet. |

Existing pre-AI-platform plans/specs remain in `docs/superpowers/` and release runbooks in
`docs/releases/`; they are not moved by this governance foundation.

## What belongs here

- Approved decisions and their reasons.
- Specifications and acceptance criteria.
- Evidence: test/check results, review findings with references, eval results.
- Concise implementation or review reports.

## What must NOT be committed

- Transient chain-of-thought / reasoning traces.
- Scratchpads, draft prompts, local temporary analysis.
- Raw agent conversations or transcripts.
- Secret values or customer PII (see [CLAUDE.md](../../CLAUDE.md) §F).

## Relationship with CLAUDE.md

[CLAUDE.md](../../CLAUDE.md) is the short **operational policy** agents must follow in this
repository (branch, git, production, secrets, stop conditions). `docs/ai/` holds the
**architecture and decisions** that policy is based on. If they conflict, stop and resolve the
conflict through a reviewed change; do not pick one silently.
