# ADR-AI-006: Human approval evidence

- Status: Accepted
- Date: 2026-10-01
- Deciders: Vĩnh (owner)

## Context

Gate decisions ([ADR-AI-005](ADR-AI-005-deterministic-sha-bound-gates.md)) need evidence that a
human approved specific objects. Repository facts at the time of this decision:

- Pull requests are authored by the repository owner account (`Panther8386`). GitHub does not
  let a PR author approve their own PR, so an approving PR review is not available.
- Commit authorship does not show who approved anything; agents create commits too.
- The only GitHub Environment is `github-pages`. **No `production` Environment exists.**
- **The agent performs Git/GitHub actions (commits, pushes) under the same repository-owner
  identity that Vĩnh uses.**

## Decision

### What is never approval evidence

Agent-written fields such as `human_approved`, `approved_by`, `actor`, `producer` or `verified`
are **never** authoritative approval evidence. They are metadata. Commit authorship is not
approval evidence.

### ApprovalRef

An `ApprovalRef` only points to an external source (approval type, source kind, source
identifier, bound object). It carries no authority itself. **Verification code** fetches the
source from GitHub and decides validity. A producer can never mark an approval verified.

### Current V1 approach

Approval commands in GitHub PR comments, using an exact command format, bound to immutable
objects and verified from GitHub source data (comment author, association, unedited state,
exact text, bound object hash):

| Approval type | Current V1 source | Bound to | Invalidated by |
|---|---|---|---|
| SPEC_APPROVAL | Owner-authored approval command | Blob SHA of the whole spec file | Any change to the spec file; editing the comment |
| PACKAGE_CHANGE_APPROVAL | Approval command | Blob SHA of `package-lock.json` | Any lockfile change; editing the comment |
| MIGRATION_APPROVAL | Approval command **plus** a human personally executing the remote migration | Blob SHA of the migration file | Any change to the file; editing the comment |
| IMPLEMENTATION / MERGE | The human merge action itself | PR head SHA at merge | — |
| PRODUCTION | CURRENT: the deploy workflow runs after a merge to `main` (policy: a human merges) | Merge commit | — |

**TARGET (not implemented):** a GitHub `production` Environment with required human approval,
separating merge from production deploy. It does not exist today.

Timestamps are audit metadata; binding to blob/commit SHAs determines validity.

### Limitation: no strong human/agent identity separation (unresolved)

**CURRENT HLG V1 DOES NOT YET HAVE STRONG HUMAN/AGENT IDENTITY SEPARATION.**

- Because the agent acts under the same owner identity, **an OWNER login alone is NOT proof
  that Vĩnh personally acted.**
- Approval comments are currently a **policy-enforced human ceremony**: **agents are forbidden
  by this ADR from creating, editing or posting approval commands**, consistent with the human
  authority rules of [ADR-AI-003](ADR-AI-003-human-production-authority.md) and
  [CLAUDE.md](../../../CLAUDE.md) §G. (CLAUDE.md does not yet name approval commands
  explicitly; adding that line is a follow-up change.)
- This is **not** equivalent to cryptographically or technically separated human authority.
  The identity problem is not solved by this ADR.

**Future requirement:** before automated gate integration (planned slice A3.7) can claim strong
human-approval verification, HLG must establish agent identity separation (for example a
distinct agent identity without comment or merge permissions) or another independent
human-authentication mechanism. Until then, approval verification proves only that a
correctly bound command exists from the owner account.

## Consequences

- Approvals are precise (bound to exact file contents) and automatically invalidated by change.
- Implementation and production authority remain human actions (ADR-AI-003), not records.
- Approval verification needs read access to GitHub; local-only runs can check bindings but
  rely on GitHub data for authorship.

## Security implications

- Forged approval fields in agent artifacts have no effect.
- Residual risk: an agent misusing the shared owner identity could post a well-formed approval
  command. Mitigated today only by policy and by the agent lacking GitHub API tooling; closed
  only by the future identity separation above.

## Alternatives considered

- Approving PR review — not available while the owner authors PRs.
- Commit authorship — rejected (not evidence of approval).
- Tracked decision files as authority — rejected (agents can write files); they may mirror
  approvals for readability but are not authoritative.
- GitHub Environment approval — TARGET for production; not configured.

## Reversibility

High. When identity separation or an Environment exists, a superseding ADR can strengthen the
sources without changing the ApprovalRef concept.
