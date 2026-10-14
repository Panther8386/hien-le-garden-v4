# ADR-AI-011: ApprovalRef Verification Governance

- Status: Accepted. Result semantics, "Relation to ADR-AI-005" partially superseded by
  [ADR-AI-012](ADR-AI-012-gate-decision-v1-aggregation.md), only for the GateDecision aggregation
  classification of unavailable trusted approval context; the ApprovalRef verifier, its outcome
  contract and all other decisions are unchanged, and the text below is unchanged history.
- Date: 2026-10-12
- Deciders: Vĩnh (owner)

## Context

`ApprovalRef` v1 is defined in
[`common.schema.json`](../contracts/schemas/v1/common.schema.json) (`$defs/ApprovalRef`) as a
structural pointer with exactly five required fields:

| Field | Schema |
|---|---|
| `approval_type` | `spec`, `package_change`, `migration`, `merge`, `production` |
| `source` | `github_pr_comment`, `github_merge`, `github_environment_review` |
| `pr_number` | integer, 1–1,000,000 |
| `source_id` | digit string (1–20 digits) or `null` |
| `object_sha` | `Sha` (40 lowercase hex characters) |

[ADR-AI-006](ADR-AI-006-human-approval-evidence.md) defines approval sources and their bindings
and states that an ApprovalRef carries no authority. [ADR-AI-010](ADR-AI-010-evidence-approval-verification-and-path-safety.md)
defines the verification model (D4, D8–D13, invariants I2, I5, I6, I8, I12) and names slice
A3.5c "ApprovalRef binding verification". [ADR-AI-005](ADR-AI-005-deterministic-sha-bound-gates.md)
defines gate states and that PASS never merges or deploys; [ADR-AI-003](ADR-AI-003-human-production-authority.md)
keeps merge and production actions with humans.

No approval command grammar, approver allowlist or approval verifier exists yet. **This ADR
decides how A3.5c verifies an ApprovalRef. Nothing in it is implemented yet.**

## Problem

Without a precise grammar, a trusted identity source and defined result semantics, a verifier
would have to guess: loose text matching, producer-chosen identities, an allowlist the evaluated
change can edit, unclear handling of edited or missing sources, and results that read like
execution authority.

## Existing contract constraints

- ApprovalRef v1, TaskSpec v1 and GateDecision v1 are unchanged; no schema version bump
  (ADR-AI-010 D23). The verifier enforces rules the schema cannot express (type × source pairs,
  `source_id` nullability).
- Validating an ApprovalRef's shape is not verification, and a verified approval is not
  authorization (ADR-AI-006; ADR-AI-010 I5).
- Approvals are bound to one type and one immutable object, and to the evaluated PR
  (ADR-AI-010 D9, D13; I2, I6).
- Repository identity comes from trusted context (ADR-AI-010 D2, I8); external source data is
  trusted only when obtained by trusted infrastructure (I12).
- Strong human identity is not established (ADR-AI-006; ADR-AI-010 D8, D24).
- `TaskSpec.human_gates[].type` (`package_change`, `migration`, `production`, `custom`) does not
  match the ApprovalRef types: there is no `custom` approval type, and `spec` / `merge` are not
  human-gate types. Gate mapping is left to A3.6 (see Deferred work).

## Decisions

1. **Preserve ApprovalRef v1.** No new fields; no producer-written identity, timestamp, expiry,
   state or authorization field.
2. **Exact command grammar** for comment approvals (section "Approval command grammar").
3. **Trusted approver allowlist** (OD-1). The verifier receives a list of numeric GitHub user ids
   from trusted infrastructure. A tracked repository file may serve as that configuration only
   when its contents are read from an explicitly trusted base ref, never from the PR head being
   evaluated. The default allowlist is empty. No user id is authorized by this ADR or by any
   example. If the source or integrity of the allowlist is uncertain, nothing is VERIFIED. For
   the current personal-account repository, a comment source must satisfy both: its numeric
   `author_id` is in the allowlist, and its `author_association` is `OWNER`. These checks
   establish source eligibility, not human identity.
4. **Five verifier outcomes** (OD-3): `VERIFIED`, `STALE`, `INVALID`, `UNVERIFIABLE`, `ERROR`
   (section "Result semantics").
5. **Edited, missing and stale sources** (OD-2): an edited comment with reliable trusted metadata
   is `INVALID`; a comment absent from a sufficiently fresh and complete trusted snapshot is
   `INVALID`; an absent, incomplete, stale or freshness-unproven snapshot is `UNVERIFIABLE`; an
   approval bound to an obsolete object version is `STALE`. A snapshot whose head SHA matches is
   not by itself proof of freshness, and a comment missing from an incomplete snapshot is never
   treated as deleted.
6. **Snapshot-bound verification.** `VERIFIED` means a trusted source record matches the
   ApprovalRef and the immutable object binding **within the verified snapshot context**. It does
   not establish that the approval is still valid now.
7. **Merge is post-merge audit only; production is unsupported in V1** (section "Merge and
   production restrictions").
8. **Pure verifier.** No network access, no GitHub writes, no Git writes, no secrets, no merge,
   deploy or migration capability.
9. **Implementation branch (planning only, OD-6).** A3.5c may use
   `feature/hlg-ai-approval-verification`, stacked on the A3.5b branch. This ADR does not create
   it.

## Approval command grammar

A PR comment is an approval command only if its **entire body** matches (ABNF, byte-exact):

```abnf
; %s"..." marks case-sensitive literals (RFC 7405)
command   = %s"HLG-APPROVE" SP type SP sha [LF]
type      = %s"spec" / %s"package_change" / %s"migration"
sha       = 40hexlow
hexlow    = %x30-39 / %x61-66        ; 0-9, a-f
SP        = %x20                     ; exactly one space
LF        = %x0A                     ; at most one, only at the end
```

- ASCII only; exactly one line; case-sensitive.
- No CR (no CRLF normalization), tabs, other whitespace, leading or trailing spaces, Markdown
  wrapper (quote, code span or fence), prefix, suffix or extra lines.
- The whole body is compared; there is no search and no substring match.
- `merge` and `production` are never comment command types.
- The `type` token must equal `approval_type` and the `sha` token must equal `object_sha`.

Agents never create, post, edit or delete approval commands. This ADR contains the grammar
only, with placeholders, and no command is posted anywhere as part of it.

## Trust boundaries

| Level | Contents | Treatment |
|---|---|---|
| T0 (untrusted) | ApprovalRefs, TaskSpecs, any producer-controlled JSON | Must fail closed |
| T1 (trusted) | The verifier, Git L1 (`scripts/ai/git-object.mjs`), trusted verifier context (repository id, PR number, expected commit, object paths, approver allowlist), trusted policy, approval snapshots assembled by trusted infrastructure | Trusted |
| T2 (out of scope) | Hostile JavaScript mutating the same process (globals, builtins, module bindings) | Not defended |

This is the same boundary used by the A3.5b EvidenceVerifier (`scripts/ai/verify-evidence.mjs`).
No runtime builtin-tamper guards are added.

## Approval source and type matrix

| `approval_type` | Allowed `source` | `source_id` | V1 verification |
|---|---|---|---|
| `spec` | `github_pr_comment` | required | Yes |
| `package_change` | `github_pr_comment` | required | Yes |
| `migration` | `github_pr_comment` | required | Yes |
| `merge` | `github_merge` | must be `null` | Post-merge audit only |
| `production` | `github_environment_review` | — | Unsupported: always `UNVERIFIABLE` |

Every other type/source combination is `INVALID`.

## Trusted snapshot model

Approval sources are supplied to the verifier as an in-memory trusted snapshot assembled by
trusted infrastructure (A3.7). Proposed envelope `hlg.approval-snapshot.v1`:

```text
{
  envelope: 'hlg.approval-snapshot.v1',
  repository: { id },
  pull_request: { number, head_sha },
  freshness: { complete, ... },          // established by the A3.7 adapter
  comments: [ { id, author_id, author_association, created_at, updated_at, body } ],
  merge: null | { merged, head_sha, merge_commit_sha, merged_by_id }
}
```

- The verifier validates the envelope at construction (malformed → error at construction),
  copies the fields it uses and freezes them.
- A snapshot describes the source at fetch time only. It never proves current GitHub state.
- The exact freshness fields are defined with the A3.7 adapter. Until a snapshot carries
  adapter-established proof of completeness and freshness, the verifier cannot return
  `VERIFIED` for any source (it returns `UNVERIFIABLE`); see the freshness clarification under
  "Snapshot freshness and revocation" for how A3.5c tests supply such snapshots.
- `created_at` / `updated_at` are used only to detect edits, never as freshness authority
  (ADR-AI-005: timestamps are audit metadata).

## Verification algorithm

Per ApprovalRef, after taking a data-only snapshot of the ref (A3.5b pattern):

1. Shape and type × source pair valid → otherwise `INVALID`.
2. `approval_type === 'production'` → `UNVERIFIABLE` (`E_APPROVAL_SOURCE_UNSUPPORTED`).
3. `pr_number === context.prNumber` → otherwise `INVALID` (`E_APPROVAL_CONTEXT_MISMATCH`).
4. Allowlist present from trusted context and integrity established → otherwise `UNVERIFIABLE`.
5. Trusted snapshot present, complete and fresh → otherwise `UNVERIFIABLE`
   (`E_APPROVAL_SOURCE_MISSING` / `E_APPROVAL_SNAPSHOT_UNFRESH`).
6. Snapshot `repository.id === context.repositoryId` and `pull_request.number ===
   context.prNumber` → otherwise `INVALID` (`E_APPROVAL_CONTEXT_MISMATCH`).
   `pull_request.head_sha !== context.expectedCommit` → `UNVERIFIABLE`.
7. **Comment sources** (`spec`, `package_change`, `migration`):
   1. Exactly one comment with `id === source_id`. None in a complete, fresh snapshot →
      `INVALID` (`E_APPROVAL_SOURCE_NOT_FOUND`); more than one → `ERROR`
      (`E_APPROVAL_SNAPSHOT_DUPLICATE`).
   2. `author_id` is in the allowlist **and** `author_association === 'OWNER'` → otherwise
      `INVALID` (`E_APPROVAL_UNAUTHORIZED_ACTOR`).
   3. Edit status established by reliable trusted metadata, and the comment is unedited.
      Edited → `INVALID` (`E_APPROVAL_SOURCE_EDITED`); edit status not reliably established →
      `UNVERIFIABLE`.
   4. Body matches the grammar, with `type === approval_type` and `sha === object_sha` →
      otherwise `INVALID` (`E_APPROVAL_COMMAND_MISMATCH`).
   5. Object binding through Git L1 at `context.expectedCommit`, using paths **only** from
      trusted context:
      - `spec`: the single trusted spec file path;
      - `package_change`: the trusted lockfile path (`package-lock.json` per ADR-AI-006);
      - `migration`: the trusted list of migration paths for the evaluated change. Every listed
        path is resolved. Exactly one listed path must hold a regular blob equal to
        `object_sha`. Two or more matching paths → `INVALID` (`E_APPROVAL_SCOPE_AMBIGUOUS`). No
        matching path → `STALE`; no path is chosen by default (for example, the first listed
        path is never assumed). An empty or missing trusted list → `UNVERIFIABLE`
        (`E_APPROVAL_OBJECT_PATH_UNKNOWN`).
   6. Git L1 failures map as in A3.5b (missing object → `ERROR`; symlink, gitlink or missing
      path → `INVALID`). A failure on any resolved path decides the result, even if another
      listed migration path matches.
   7. The resolved blob (for `migration`, the single matching blob) equals `object_sha` →
      `VERIFIED`; otherwise `STALE` (`E_APPROVAL_STALE`): a matching command exists for a
      different object version.
8. **Merge source:** `merge === null` or `merge.merged !== true` → `UNVERIFIABLE`
   (`E_APPROVAL_NOT_MERGED`). `merge.head_sha === object_sha === context.expectedCommit` and
   `merged_by_id` in the allowlist → `VERIFIED`; otherwise `INVALID`.
9. Any unexpected exception → `ERROR`.

`verifyAll` follows A3.5b: bounded collection (`MAX_REFS`), elements read once by own index,
explicit aggregation, an empty list never `VERIFIED`.

## Result semantics

| Outcome | Meaning | Proposed GateDecision mapping (A3.6, design only) |
|---|---|---|
| `VERIFIED` | A trusted source record matches the ref and the immutable binding within the verified snapshot context | `verified` |
| `STALE` | A matching command exists, bound to an obsolete object version | `missing` → `WAITING_HUMAN` |
| `INVALID` | Forged, mismatched, edited, unauthorized, ambiguous or not found in a complete, fresh snapshot | `rejected` → `FAIL` |
| `UNVERIFIABLE` | Trusted source or policy absent, incomplete, stale, freshness unproven, comment edit status unproven, trusted migration path list missing, or source unsupported | `pending` → `WAITING_HUMAN` |
| `ERROR` | Inconsistent trusted data or internal failure | `ERROR` |

This mapping does not modify GateDecision. **Clarification of ADR-AI-010 D12** (not a rewrite):
D12's "stale … treated as absent" corresponds to `STALE`; D12's "forged-shaped or mismatched in
context … unverifiable and fails closed" corresponds to `INVALID` here. The verifier's
`UNVERIFIABLE` is a different, narrower meaning: the trusted data needed to decide is not
available. **Relation to ADR-AI-005:** its rule that untrustworthy or unverifiable gate inputs
make a decision `ERROR` covers corrupt, conflicting or invalid gate inputs; a trusted approval
source that is not yet available stays pending (`WAITING_HUMAN`), which can never be `PASS`. The
exact GateDecision reason codes for these outcomes are decided in A3.6.

Facts on `VERIFIED` are factual source metadata only, for example `approval_type`, `source`,
`source_id`, `pr_number`, `object_sha`, `path`, `source_author_id`. No result field asserts human
identity (`human_approved` or similar) or authorization.

## Snapshot freshness and revocation

**Snapshot-bound verification** (A3.5c): deterministic matching against supplied trusted data. It
can produce `VERIFIED` only when every required binding and source check passes, and it carries
no execution authority.

**Current authorization** (outside A3.5c): requires independently established snapshot
freshness plus the relevant human authorization and execution policies. It cannot be inferred
from `VERIFIED` alone.

There is no revocation command in V1. An approval stops being verifiable when its comment is
edited, when it is removed from a complete and fresh snapshot, or when the bound object changes.

**Freshness clarification.** A snapshot whose `pull_request.head_sha` equals the expected commit
is necessary but not sufficient evidence of source freshness. Completeness, provenance and
freshness count only when established by the trusted infrastructure (T1) that assembled the
snapshot; a `freshness` field, boolean or timestamp that a producer (T0) supplies or can
influence — in an ApprovalRef, a producer report or a snapshot not assembled by trusted
infrastructure — establishes nothing. When these properties are unavailable or unproven, the
verifier returns `UNVERIFIABLE`, never `VERIFIED`. The verifier is pure and cannot itself check
where a snapshot came from: provenance is an obligation on its trusted caller. The trusted
adapter contract that establishes these properties belongs to A3.7 and is not implemented here.
A3.5c tests supply fixture snapshots through the trusted-context interface to exercise both the
`UNVERIFIABLE` and the `VERIFIED` paths; no production caller may supply a snapshot that was not
assembled by the A3.7 adapter, so no production `VERIFIED` result is possible until A3.7 exists.
`VERIFIED` remains snapshot-bound and never authorizes a merge, a migration or a deployment.

Obligations of the future A3.7 adapter:

- retrieve sources through trusted infrastructure;
- paginate completely;
- record freshness and fetch-time provenance;
- detect deleted and edited comments reliably;
- record source identity and the relevant permissions;
- check consistency with the repository, PR and head under evaluation;
- fail closed on incomplete or outdated data.

A3.5c adds no network fetching.

## Merge and production restrictions

- `merge` (`github_merge`) records a completed merge for post-merge audit. It can never be a
  prerequisite of the merge it records and never authorizes a merge.
- `production` has no trusted source in V1 and is always `UNVERIFIABLE`. A TaskSpec with a
  `production` human gate therefore cannot be satisfied by an ApprovalRef in V1. Nothing in this
  ADR authorizes deployment.
- A `migration` approval verifies a binding only. It never authorizes an agent to execute a
  migration; remote migrations remain human-executed (ADR-AI-003, ADR-AI-006).

## Security invariants

| ID | Invariant |
|---|---|
| AV1 | An ApprovalRef never grants authority; verifier results contain no execution or authorization field. |
| AV2 | `VERIFIED` requires a trusted complete and fresh source, an eligible source author, a reliably unedited comment (for comment sources), an exact command match and a matching immutable object. |
| AV3 | Identity, repository, PR, paths and allowlist come only from trusted context; the allowlist never comes from the evaluated PR head. |
| AV4 | Command matching is whole-body and byte-exact; no substring search and no normalization. |
| AV5 | `STALE`, `INVALID`, `UNVERIFIABLE` and `ERROR` are never `VERIFIED`; an empty list is never `VERIFIED`. |
| AV6 | `production` is always `UNVERIFIABLE` in V1; `merge` is never a prerequisite of the merge it records. |
| AV7 | A snapshot never proves current GitHub state; `VERIFIED` is snapshot-bound. |
| AV8 | The verifier is pure: no network, no writes, no secrets. |
| AV9 | No result is labelled as human approval; source metadata is factual (`source_author_id`). |
| AV10 | An ambiguous migration binding fails closed; no path is guessed. |
| AV11 | An empty or integrity-uncertain allowlist yields no `VERIFIED` approval. |

## Residual risks

- **HIGH — shared-account impersonation.** An agent or another actor operating through an
  allowlisted GitHub account can produce a command indistinguishable from a genuine human
  approval. Therefore `VERIFIED` is never called `human_approved`, the `OWNER` association is
  not treated as proof of a human action, agents must not be given GitHub comment-write
  credentials for approval workflows (today's shared owner identity, ADR-AI-006, does not
  enforce this technically), and agents never create, post, edit or delete approval commands.
  Closing this risk needs future infrastructure: separate identities, a protected approval
  channel, or independently controlled infrastructure.
- **MEDIUM — snapshot freshness.** A comment edited or deleted after the snapshot was taken is
  not visible to A3.5c; this is the A3.7 freshness obligation.
- **LOW — cross-TaskSpec replay** yields `STALE` (`WAITING_HUMAN`) rather than `INVALID`; it is
  never `VERIFIED`.
- **LOW — edit detection** depends on trusted metadata semantics that the A3.7 adapter must
  confirm.
- **LOW — usability.** A command that a client stores with CR (CRLF) is rejected; the human
  posts a new command.

## Consequences

- Approval binding and source structure become machine-checkable; human identity does not.
- TaskSpecs with `production` or `custom` human gates cannot be satisfied by an ApprovalRef in V1.
- Editing an approval comment, or changing the bound file, requires a new command.
- An approval verifier cannot report `VERIFIED` until trusted infrastructure supplies a
  complete, fresh snapshot and a trusted allowlist.

## Deferred work

- A3.5c: verifier implementation (`scripts/ai/verify-approval.mjs` and its tests), then Linux CI
  wiring.
- A3.6: GateDecision mapping, including the `human_gates` / ApprovalRef type mismatch and the
  always-required spec approval.
- A3.7: trusted snapshot adapter (retrieval, pagination, freshness, edit/delete detection,
  identity and permissions), agent-identity separation, a production approval source.
- Bundled v2 decision (ADR-AI-010 D23): ApprovalRef `object_path`, a governance approval type.

## Alternatives considered

- New producer-written ApprovalRef fields (repository, approver, timestamps, expiry, state) —
  rejected: they carry no authority and would require a schema bump (ADR-AI-010 D23).
- Fetching GitHub inside the verifier — rejected: trusted fetching is A3.7 infrastructure.
- Substring or case-insensitive command matching — rejected: enables injection and ambiguity.
- `OWNER` association alone, or an allowlist read from the PR head — rejected: the evaluated
  change could make itself eligible.
- Treating a comment missing from any snapshot as deleted — rejected: an incomplete snapshot
  would turn into false `INVALID` results or hide gaps.
- A revocation command in V1 — not adopted; editing, removal and object change cover V1.

## Reversibility

Medium. The grammar, outcomes and matrix can be changed only by a superseding ADR; adding fields
to ApprovalRef needs the bundled v2 schema decision (ADR-AI-004, ADR-AI-010 D23).

## References

- [ADR-AI-003](ADR-AI-003-human-production-authority.md) — human production authority
- [ADR-AI-005](ADR-AI-005-deterministic-sha-bound-gates.md) — deterministic, SHA-bound gates
- [ADR-AI-006](ADR-AI-006-human-approval-evidence.md) — human approval evidence
- [ADR-AI-010](ADR-AI-010-evidence-approval-verification-and-path-safety.md) — evidence and approval verification
- [`common.schema.json`](../contracts/schemas/v1/common.schema.json) — `ApprovalRef`, `Sha`
- [`task-spec.schema.json`](../contracts/schemas/v1/task-spec.schema.json) — `human_gates`
- [`gate-decision.schema.json`](../contracts/schemas/v1/gate-decision.schema.json) — `approvals`
- `scripts/ai/git-object.mjs`, `scripts/ai/verify-evidence.mjs` — Git L1 and the A3.5b verifier
