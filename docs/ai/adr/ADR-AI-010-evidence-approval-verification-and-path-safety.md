# ADR-AI-010: Evidence and approval verification, and common repository path safety

- Status: Accepted
- Date: 2026-10-07
- Deciders: Vĩnh (owner)

## Context

V1 contracts already define structural pointers in `docs/ai/contracts/schemas/v1/common.schema.json`:

- **EvidenceRef** — a pointer to inspectable evidence with a `kind` discriminator (`repo_file`,
  `repo_line`, `git_commit`, `git_diff`, `test`, `ci_check`, `http_probe`,
  `schema_validation`). The schema states it is not trusted until verified
  ([ADR-AI-005](ADR-AI-005-deterministic-sha-bound-gates.md)).
- **ApprovalRef** — a pointer to an external human-approval source (`approval_type` ∈ `spec`,
  `package_change`, `migration`, `merge`, `production`) that carries no authority; validity is
  decided by verification code ([ADR-AI-006](ADR-AI-006-human-approval-evidence.md)).
- **Finding** — an AI-authored review observation whose gate impact is derived by policy.

Path grammar exists (`RepoFilePath`, `ScopePath`), and TaskSpec scope paths are additionally
checked by the business layer (including `BR-PATH-TRAILING-DOT`), but other contracts do not
share one path-safety boundary. No code verifies an EvidenceRef or an ApprovalRef.

## Problem

Future agents and gates will consume evidence and approvals. Without a verification boundary:

- evidence could point at a mutable target (branch name, working tree) and be substituted after
  review;
- CI or approval records could belong to a different repository, PR, run or commit;
- an approval could be widened, reused for another action, or survive a content change;
- a producer could present its own output as independently verified;
- a path could escape the repository or alias a protected path (traversal, encodings,
  separators, case, Windows device names, symlinks);
- missing or partial evidence could be read as PASS.

This ADR fixes the design of A3.5 before it is implemented. **Nothing in this ADR is
implemented yet.**

## Decision

### Evidence verification model

1. **Pointer only (D3).** An EvidenceRef carries no trust. Producer-written fields such as
   `verified`, `trusted`, `actor` or `verified_by` never become authority; verification status is
   computed externally by verifier code.
2. **Git object database (D1).** Git-backed evidence is verified against the Git object database,
   never the working tree.
3. **Immutable binding (D5).** Git-backed evidence is bound to an immutable commit (+ path where
   applicable). Branch names are never evidence identity. Non-Git evidence that requires byte
   identity must eventually carry a verifier-checkable digest.
4. **Trusted repository identity (D2).** The repository being verified comes from the trusted
   verifier context, not from producer-written fields. For GitHub, the immutable numeric
   repository id is preferred when trusted infrastructure supplies it; the full name is
   diagnostic only and never overrides the trusted identity. Local verification uses the
   repository supplied by the invoking trusted context. A repository field is **not** added to
   every EvidenceRef.
5. **Exact-head freshness (D6).** Required evidence must match the expected SHA supplied by
   trusted context; a mismatch fails closed. There is no general "docs-only" freshness
   exemption. A tracked record cannot contain CI evidence for the commit that contains it, so
   exact-head CI evidence lives outside that commit (GitHub check/run/comment or a later audit
   record).
6. **CI evidence (D7).** A producer-supplied CI conclusion is not authoritative. A verifier must
   compare the referenced run/check snapshot with the expected repository, SHA, run/check
   identity and attempt/policy. Trusted fetching from GitHub is future infrastructure (A3.7),
   not part of A3.5.
7. **Missing evidence (D20).** A required claim never becomes PASS without evidence. In
   particular, an ImplementationReport requirement status `met` must eventually require at
   least one verifiable evidence reference allowed by policy.

### Approval verification model

1. **Separation (D4).** EvidenceRef ≠ ApprovalRef. Evidence never becomes approval, and approval
   never substitutes for evidence.
2. **Binding (D9).** An approval is bound to exactly one approval type and its defined immutable
   object. Consumer code cannot widen its scope. A commit-bound approval becomes stale after a new
   commit. A blob-bound approval may remain valid while the exact approved blob at the required
   path is unchanged, subject to policy.
3. **Same-PR source (D13).** By default the approval source must belong to the PR being evaluated.
   Cross-PR reuse is not permitted in A3.5; reusable blob approval would need a separate ADR or
   policy change.
4. **Stale vs unverifiable (D12).** A structurally valid approval that was valid for an earlier
   exact commit but is stale because the evaluated commit changed is treated as **absent**:
   `WAITING_HUMAN`, not `ERROR`. An approval that is forged-shaped or mismatched in context
   (wrong repository, PR, type, object, author or source) is **unverifiable** and fails closed.
5. **Session authority excluded (D10).** No ApprovalRef types are added for push, PR creation or
   mark-ready; these remain owner/session authority, not gate inputs. ApprovalRef is never a
   mechanism that lets an agent execute an operation.
6. **Merge and production stay separate (D11).** They remain distinct approval scopes; PASS
   authorizes neither. Migration, deployment and secret/config changes remain human-executed
   operations ([ADR-AI-003](ADR-AI-003-human-production-authority.md)).

### Human-identity limitation

A3.5 may verify an approval's **binding and source-record structure**. It does **not** prove that
Vĩnh personally performed an action (D8). The shared `Panther8386` account remains a known
limitation, and no cryptographic human-authentication claim is made. Strong separation of agent
identities is likewise not solved by A3.5 (D24): declared-role separation may later be checked
against trusted policy, but there is no account-level or cryptographic separation. Finding F9
(producer/verifier self-validation) stays deferred to the governance/identity slices.

### Common path-safety layers

**L0 — lexical (D14–D17).** One shared, pure, OS-independent policy for contract paths. Paths are
**accepted or rejected, never normalized** into a safe-looking form. Canonical paths are:

- repository-relative, ASCII only, forward-slash separated;
- no leading slash, no empty segment, no `.` or `..` segment;
- no backslash, no percent encoding, no NUL or control characters.

Additionally rejected:

- a segment ending in `.`;
- a segment that is a Windows reserved device name, case-insensitively and also with an
  extension: at least `CON`, `PRN`, `AUX`, `NUL`, `COM0`–`COM9`, `LPT0`–`LPT9` (D15). The
  implementation must verify the exact Windows alias semantics with tests before broadening or
  narrowing this set;
- a `.git` segment, case-insensitively;
- a segment beginning with `-` (D17). As defence in depth, Git and other process invocations use
  argv without shell interpolation and an explicit `--` where supported.

Where classification or authority depends on a path, protected-registry comparisons check
case-insensitive ambiguity (D16). Paths are not lowercased globally; Git object lookup stays
exact.

**L1 — Git object database (D18).** For Git-backed path evidence, L0 runs first; the commit and
path are then resolved through Git object storage. Where file evidence is expected, only regular
blobs are accepted. Symlinks (mode `120000`), gitlinks/submodules (mode `160000`), a tree where a
blob is expected, and missing objects or paths are rejected.

**L2 — filesystem (D19).** Filesystem safety (realpath, Windows junctions/reparse points, dev/ino
semantics, parent-chain checks, creating non-existing outputs, TOCTOU) is separate from evidence
verification. A3.5 evidence verification does not depend on L2. L2 requires a later
implementation spike and does not block A3.5a–c.

### Finding closure (D21)

A producer's assertion alone never closes a finding. The future closure model must be able to
require fix evidence, independent review, exact-head CI and scope-dependent human approval.
`WAIVED` ≠ `CLOSED`. The detailed Finding v2 schema is a later decision.

### Gate boundary (D22)

GateDecision consumption remains A3.6. A3.5 provides verification primitives and results only.
Precedence is unchanged: `ERROR` > `FAIL` > `BLOCKED` > `WAITING_HUMAN` > `PASS`, and PASS means
only "eligible for human action" ([ADR-AI-005](ADR-AI-005-deterministic-sha-bound-gates.md)).

## Accepted invariants

These are decisions, not implementation facts; none is implemented by this ADR.

| ID | Invariant |
|---|---|
| I1 | Evidence is bound to immutable content identity. |
| I2 | Approval is bound to immutable target identity. |
| I3 | EvidenceRef ≠ ApprovalRef. |
| I4 | A producer cannot self-verify. |
| I5 | PASS ≠ authority. |
| I6 | Approval scope cannot be widened. |
| I7 | A SHA mismatch fails closed. |
| I8 | Repository identity comes from trusted verifier context. |
| I9 | Unsafe or unverifiable paths fail closed. |
| I10 | Finding closure cannot rest solely on producer assertion. |
| I11 | Git evidence verification never reads the working tree. |
| I12 | External source snapshots count as trusted only when obtained by trusted infrastructure. |
| I13 | Exact-head CI evidence cannot be contained in the same commit it proves. |
| I14 | Missing evidence for a required claim is never PASS. |
| I15 | L0 path semantics are deterministic and OS-independent. |

## Schema and version strategy (D23)

- A3.5a and A3.5b avoid a `schema_version` bump unless implementation proves it unavoidable.
  Breaking changes are not drip-fed.
- Potential breaking changes are bundled into one deliberate v2 decision later (ADR-AI-004:
  every schema change is breaking). Candidate v2 items, recorded as **future decisions, not
  facts**: ApprovalRef `object_path`; `finding_closure` / `finding_waiver`; a governance approval
  type; a `schema_validation` digest; stable Finding identity and closure; GateDecision evidence
  reason codes.

## Failure semantics

- Verification results are deterministic and fail closed: unsafe paths, SHA or repository
  mismatches, unresolvable Git objects, unexpected object modes, and context-mismatched or
  forged-shaped approvals are failures, never PASS.
- A stale-but-structurally-valid approval is treated as absent (`WAITING_HUMAN`).
- Missing required evidence is never PASS.
- Error codes follow existing conventions (`E_*` codes with rule/pointer details, no input
  values); exact names are decided in the implementation slices.

## Security consequences

- Evidence substitution (branch names, working-tree edits, other commits, other runs, replaced
  artifacts) is addressed by immutable binding and exact-head checks against trusted context.
- Approval reuse across actions, PRs, repositories or commits is addressed by type/object binding,
  same-PR sources and stale-means-absent semantics.
- Path aliasing (traversal, encodings, separators, case, Windows device names, trailing dots,
  option-like segments, symlinked Git objects) is addressed by L0 and L1. Filesystem-level escapes
  (junctions, TOCTOU) remain open until the L2 spike.
- **Residual:** no proof of human identity (shared account); no trusted GitHub fetching until
  A3.7; no strong agent-identity separation (F9).

## Alternatives considered

- Verifying evidence against the working tree — rejected: mutable, not reproducible (D1).
- A producer-supplied repository field in every EvidenceRef — rejected: the producer would choose
  the repository being trusted (D2).
- A "docs-only" freshness exemption — rejected: a weaker rule that is easy to misapply (D6).
- Normalizing unsafe paths into canonical form — rejected: normalization hides aliasing; reject
  instead (D14).
- ApprovalRef types for push, PR creation and mark-ready — rejected: session authority, not gate
  inputs (D10).
- Allowing cross-PR reuse of blob approvals — rejected for A3.5 (D13).
- Treating stale approvals as `ERROR` — rejected: a stale approval is absent, not forged (D12).
- Blocking A3.5 on filesystem (L2) safety — rejected: evidence verification does not need it
  (D19).
- Introducing v2 schema changes slice by slice — rejected: bundle them in one decision (D23).

## Deferred work

- L2 filesystem spike (junctions/reparse points, dev/ino, parent chain, non-existing outputs,
  TOCTOU).
- Trusted GitHub fetching of runs, checks, comments and merge events (A3.7).
- Human-identity authentication and agent-identity separation (F9, A3.6/A3.7).
- Finding v2 (closure, waiver, stable identity) and the bundled v2 schema decision.
- GateDecision consumption and aggregation governance (A3.6).

## Implementation slicing

| Slice | Content | Depends on |
|---|---|---|
| A3.5a | Common repository path L0 | — |
| A3.5b | EvidenceRef verification / Git L1 | A3.5a |
| A3.5c | ApprovalRef binding verification | A3.5a |
| A3.5d | ImplementationReport / Finding integration and the deliberate v2 decision | A3.5b, A3.5c |
| A3.6 | GateDecision consumption / aggregation governance | A3.5 |
| A3.7 | Trusted GitHub fetching, stronger identity, production governance | A3.6 |
| L2 spike | Filesystem safety | separate; may occur later; does not block A3.5a–c |

## Non-goals

- No merge, deployment, migration or secret/config authority; PASS never authorizes them.
- No authentication of human or agent identities.
- No trusted network fetching in A3.5.
- No filesystem write-safety in A3.5a–c.
- No change to earlier ADRs or to the V1 schemas by this ADR.

## Reversibility

Medium. These boundaries can be changed only by a reviewed change to GOVERNANCE scope and a
superseding ADR; the v2 schema items require an explicit schema-version decision (ADR-AI-004).
