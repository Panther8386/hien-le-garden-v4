# ADR-AI-012: GateDecision V1 Aggregation and Trust Boundaries

- Status: Accepted
- Date: 2026-10-14
- Deciders: Vĩnh (owner) — accepted 2026-10-14 (D-01; S0-B.1)
- Supersedes (partial): [ADR-AI-011](ADR-AI-011-approval-verification.md), Result semantics,
  "Relation to ADR-AI-005", only for the GateDecision aggregation classification of unavailable
  trusted approval context (SB-2; active from acceptance). The rest of ADR-AI-011, including the
  ApprovalRef verifier and its outcome contract, remains authoritative.

> **Acceptance notice.** This ADR was accepted by the owner on 2026-10-14 as a **design decision
> only**. It records the GateDecision V1 design, the accepted constraints it must respect, the
> owner's design selections and the conditions that remain open. **Nothing in it is implemented**,
> and acceptance authorizes no implementation slice, CI change, publication, enforcement, Git
> operation, migration, merge or production action.
>
> Labels used throughout (the labels record how each decision was reached; their effect after
> acceptance is stated in the second column):
>
> | Label | Meaning |
> |---|---|
> | **ACCEPTED** | Explicitly supported by an accepted repository source (ADR, contract, documentation) |
> | **IMPLEMENTED_FACT** | Verified behaviour of existing code or schema |
> | **APPROVED_IN_CONVERSATION** | Selected by the owner in a review conversation; accepted as design authority with this ADR (ADR-AI-001) |
> | **CONDITIONAL** | Accepted as design authority only subject to the open conditions and other explicit conditions stated in this ADR |
> | **PROPOSED** | Suggested in reviews; **not** approved by this acceptance |
> | **OPEN** | A decision or condition that is still unresolved; **not** decided by this acceptance |
> | **BLOCKED** | Cannot proceed until stated prerequisites exist |

## Context

### Why GateDecision V1 is needed

[ADR-AI-005](ADR-AI-005-deterministic-sha-bound-gates.md) defines the GateDecision states, their
precedence and its invariants, and states that "No gate aggregator exists yet" (ADR-AI-005,
Context). The GateDecision V1 structure exists as a schema
([`gate-decision.schema.json`](../contracts/schemas/v1/gate-decision.schema.json)), but no code
produces it. [ADR-AI-010](ADR-AI-010-evidence-approval-verification-and-path-safety.md) D22 assigns
"GateDecision consumption" to A3.6, and [ADR-AI-011](ADR-AI-011-approval-verification.md) leaves
"the exact GateDecision reason codes" for ApprovalRef outcomes to A3.6 (Result semantics).

### Relationship to existing building blocks

| Building block | What it provides | Status |
|---|---|---|
| TaskSpec (ADR-AI-008, ADR-AI-009) | Extraction, schema, business and policy validation of the spec's machine block | Implemented (A3.4) |
| EvidenceRef verifier (ADR-AI-010) | Per-reference `VERIFIED` / `INVALID` / `UNVERIFIABLE` / `ERROR` results | Implemented ([`scripts/ai/verify-evidence.mjs`](../../../scripts/ai/verify-evidence.mjs)) |
| ApprovalRef verifier (ADR-AI-011) | Per-reference `VERIFIED` / `STALE` / `INVALID` / `UNVERIFIABLE` / `ERROR` results | Implemented ([`scripts/ai/verify-approval.mjs`](../../../scripts/ai/verify-approval.mjs)) |
| Git L1 resolver (ADR-AI-010) | `resolveCommit`, `resolveRegularBlob`, `readBlob`, `resolveCommitTree` | Implemented ([`scripts/ai/git-object.mjs`](../../../scripts/ai/git-object.mjs)); **no changed-path primitive** |
| Contract validator (ADR-AI-007) | `validateContractBytes` over untrusted bytes | Implemented ([`scripts/ai/validate-contract.mjs`](../../../scripts/ai/validate-contract.mjs)) |
| Trusted CI and approval snapshot adapters | Snapshots built by trusted infrastructure | **Not implemented** (A3.7) |
| GateDecision aggregator, occurrence trace, publisher | Deterministic aggregation and publication | **Not implemented** |

The verifiers produce verification results only; they assign no gate outcome (ADR-AI-010 D22).

### Why PR-head code cannot enforce its own governance

[ADR-AI-008](ADR-AI-008-taskspec-scope-classes-and-authority.md) (Security implications,
"Governance self-validation risk") records that a `pull_request` workflow runs the head's own
definitions, so a weakened validator could pass itself, and requires that "before automated
governance gate enforcement is trusted, phases A3.6/A3.7 must evaluate governance-sensitive
changes with trusted base-branch validation logic, or an equivalent independent trust boundary,
plus human review" (**ACCEPTED**). The aggregator and policy table are "security-sensitive paths
that agents may not modify without a human gate" (ADR-AI-005, Security implications;
**ACCEPTED**). The CI workflow [`.github/workflows/test.yml`](../../../.github/workflows/test.yml)
runs on `pull_request` with the PR's own code (**IMPLEMENTED_FACT**). Code added by A3.6 therefore
cannot be an enforcing authority while it runs from the evaluated PR head.

## Source and authority register

Review reports and conversations (the A3.6a design closure, the A3.6a.1 design clarification,
the A3.6b readiness review, the S0-A.2 decision package and Batches 2, 3 and 3.1, all dated
2026-10-14) are **not repository decisions** ([ADR-AI-001](ADR-AI-001-github-system-of-record.md):
"Not canonical: … transient chat history"; [CLAUDE.md](../../../CLAUDE.md) §H). Owner selections
made in those conversations are recorded here as APPROVED_IN_CONVERSATION or CONDITIONAL and became
repository design decisions only through the acceptance of this ADR.

| Requirement or decision | Source | Path / section | Authority | Notes / conflict |
|---|---|---|---|---|
| Only deterministic code produces a GateDecision; a supplied GateDecision is ignored and recomputed | ADR-AI-005 | Decision → Authority | ACCEPTED | |
| PASS means "eligible for human action" only; PASS never merges or deploys | ADR-AI-005; contracts README | Decision → Authority; "GateDecision authority" | ACCEPTED | |
| Precedence `ERROR > FAIL > BLOCKED > WAITING_HUMAN > PASS`; state meanings | ADR-AI-005 | Decision → States and precedence | ACCEPTED | |
| "The decision lists all reasons, not only the winning one" | ADR-AI-005 | States and precedence | ACCEPTED | Met through R2-B (bounded decision plus trace) |
| ERROR covers inputs that are "missing, invalid, unsupported, stale, mixed, conflicting, unverifiable" | ADR-AI-005 | States and precedence (ERROR row) | ACCEPTED | Basis of R1-B |
| Invariants: missing report, invalid schema, unsupported version, stale or mixed SHA, missing required check, deterministic FAIL cannot PASS; approval cannot be invented | ADR-AI-005 | Invariants | ACCEPTED | |
| Git SHA is the freshness authority; expected head/base come from the environment; same-type artifacts or differing SHAs make the decision ERROR | ADR-AI-005 | SHA and freshness | ACCEPTED | |
| `gate_impact` is derived by committed policy; a finding without verified evidence is informational | ADR-AI-005 | Findings | ACCEPTED | |
| Approval bindings: spec → whole spec blob; package → `package-lock.json` blob; migration → migration blob **plus a human personally executing the migration**; merge → head at merge; production today = merge to `main` | ADR-AI-006 | Decision (approval type table) | ACCEPTED | A satisfied migration slot never authorizes running a migration |
| Untrusted bytes: byte cap, canonical parse, duplicate-key rejection | ADR-AI-007 | Decision | ACCEPTED | |
| GOVERNANCE category requires a `custom` human gate; V1 limitation | ADR-AI-008 | Decision → Required declarations per category | ACCEPTED | `custom` has no ApprovalRef type |
| No authoritative deterministic-check registry exists; it "remains for the future gate/policy layer" | ADR-AI-008 | Decision → Checks registry | ACCEPTED | Registry content is OPEN (D-05) |
| Path and case semantics reuse `covers`, `overlaps`, `isCaseAmbiguous`; case ambiguity fails closed | ADR-AI-008 | Decision → Path and case semantics | ACCEPTED | |
| Governance self-validation risk | ADR-AI-008 | Security implications | ACCEPTED | |
| Errors deterministic, bounded, without secret material | ADR-AI-009 | Decision → Error safety | ACCEPTED (composer) | Applied here by analogy |
| Gate consumption belongs to A3.6; precedence unchanged | ADR-AI-010 | D22 | ACCEPTED | |
| Breaking schema changes are bundled into one v2 decision | ADR-AI-010 | D23 | ACCEPTED | GateDecision V1 schema unchanged |
| ApprovalRef outcome semantics; edited comments INVALID; unproven edit status UNVERIFIABLE; a comment missing from a snapshot is not treated as deleted | ADR-AI-011 | Result semantics; Trusted snapshot model; Alternatives considered | ACCEPTED | |
| ApprovalRef → GateDecision mapping column | ADR-AI-011 | Result semantics, "Proposed GateDecision mapping (A3.6, design only)" | PROPOSED inside an accepted ADR | Superseded for A3.6 by R1-B and D-04 below |
| "A trusted approval source that is not yet available stays pending (`WAITING_HUMAN`)" | ADR-AI-011 | Result semantics, "Relation to ADR-AI-005" | ACCEPTED | **Clarification proposed** (see R1-B) |
| GateDecision V1 limits: `reasons` 1–100, `detail` ≤ 300, `inputs` ≤ 10, `required_checks` ≤ 30, `findings` ≤ 600, `approvals` ≤ 10; ApprovalRef appears only in the output | `gate-decision.schema.json` | whole schema | IMPLEMENTED_FACT | No V1 input contract carries ApprovalRef |
| Approval snapshot carries current comment state only (`kind`, `id`, `author_id`, `author_association`, `created_at`, `updated_at`, `body`), at most 10,000 comments | `scripts/ai/verify-approval.mjs` | `copyApprovalSnapshot` | IMPLEMENTED_FACT | No edit history, no deletion record |
| `E_APPROVAL_CONTEXT_MISMATCH` is emitted both for a ref with another PR number and for a snapshot with another repository or PR | `scripts/ai/verify-approval.mjs` | `verifyRef` steps 3 and 6 | IMPLEMENTED_FACT | Classified by stage (OD-B5) |
| CI snapshot `hlg.ci-snapshot.v1`: no workflow identity, no completeness flag, no latest-attempt field; job matched by display name | `scripts/ai/verify-evidence.mjs` | `copySnapshot`, `ci_check` | IMPLEMENTED_FACT | CI snapshot v2 is PROPOSED |
| A3.6 carries deferred findings F6, F8, F9 | contracts README | "Implementation slices", A3.6 row | Documentation | Original A3.4c finding text not in the repository |

## Decision status summary

| Item | Status | Section |
|---|---|---|
| R1-B — trusted-context classification | APPROVED_IN_CONVERSATION | R1-B |
| R2-B — bounded GateDecision plus occurrence trace (architecture) | APPROVED_IN_CONVERSATION | R2-B |
| D-04 — approval reason mapping | APPROVED_IN_CONVERSATION | D-04 |
| OD-B4 — spec rename is not automatically tampering | APPROVED_IN_CONVERSATION (rename rule only) | OD-B4 |
| D-07 — GOVERNANCE precedence | APPROVED_IN_CONVERSATION | States and precedence |
| OD-B5 — approval evaluation stages A–E and rules | APPROVED_IN_CONVERSATION | OD-B5 |
| OD-B3 — reason-to-level policy | CONDITIONAL (C3) | OD-B3 |
| OD-B6 — occurrence bound and invariants | CONDITIONAL (C2, C4) | R2-B |
| Publication principle publish → verify → finalize | APPROVED_IN_CONVERSATION (principle); details PROPOSED (C5) | Publication protocol |
| S0A5-1 — decision projection: one reason per distinct non-PASS code (Option A) | CONDITIONAL (C5) | R2-B (decision projection); PASS |
| P1-a — `detail` grammar with full SHA-256 identifiers | CONDITIONAL (C5) | R2-B (decision projection); PASS |
| P1-b — PASS representation | APPROVED_IN_CONVERSATION | R2-B (decision projection); PASS |
| S0A5-2, P2-a, P2-b — slot binding by trusted head blob (S-H); only assigned candidates are verified; identical migration blobs | APPROVED_IN_CONVERSATION | OD-B5 |
| S0A5-3 — two layers (normalized occurrences, diagnostic ledger) | APPROVED_IN_CONVERSATION (principle) | R2-B (layer 1, layer 2, bounds, invariants) |
| P3-a — independent violation identity | APPROVED_IN_CONVERSATION | R2-B (layer 1, layer 2, bounds, invariants) |
| P3-b — lossless indexed groups (Option B) | APPROVED_IN_CONVERSATION | R2-B (layer 1, layer 2, bounds, invariants) |
| P3-c — rejection of invalid duplicate records | CONDITIONAL | R2-B (layer 1, layer 2, bounds, invariants) |
| P3-d — symbolic bounds only | CONDITIONAL (C4) | R2-B (layer 1, layer 2, bounds, invariants) |
| P3-e — completeness invariants I0–I8 | CONDITIONAL (C5, C6) | R2-B (layer 1, layer 2, bounds, invariants) |
| P3-f — one subject per EvidenceRef | APPROVED_IN_CONVERSATION | R2-B (layer 1, layer 2, bounds, invariants) |
| S0A6.1-D1 — `COUNT` as an exact JavaScript safe integer | CONDITIONAL | R2-B (decision projection) |
| S0A6.1-D2 — `KIND` from a closed, versioned, trusted registry (list itself PROPOSED) | CONDITIONAL | R2-B (decision projection) |
| S0A6.1-D3 — duplicate rules without contract authority remain OPEN | APPROVED_IN_CONVERSATION | R2-B (layer 2, duplicate records) |
| D-01 — accept this ADR | ACCEPTED (2026-10-14, S0-B.1), design authority only | Header; Consequences |
| SB-1 — support for accepting this ADR as a design decision, after S0-A.6.3, an independent review and a separate S0-B authorization | Prerequisites met (S0-A.6.3; independent review with notes; S0-B.1) | Consequences |
| SB-2 — partial supersession of ADR-AI-011 ("Relation to ADR-AI-005" sentence, GateDecision aggregation only) | APPROVED_IN_CONVERSATION; active from acceptance | Header; R1-B |
| SB-3 — controlled deferrals with deadlines | CONDITIONAL | Controlled deferrals |
| SB-4 — targeted clarifications (test wording, C5 obligations, authorization boundary) | APPROVED_IN_CONVERSATION | Test strategy; Open conditions; Consequences |
| SB-5 — handling of deferred findings F6, F8, F9 | CONDITIONAL | Deferred findings F6, F8, F9 |
| Trace contract details, CI snapshot v2, numeric limits | PROPOSED | as referenced |
| Candidate cap K, count-plus-first compaction, G8/G9, any numeric bound for layer 2 | NOT APPROVED | — |
| D-05, D-06, D-08, D-09, OD-B2, OD-B7, OD-B8, F6/F8/F9 | OPEN | Remaining owner decisions |
| Enforcement, merge to `main`, production | BLOCKED | Security and rollout |

## Scope

**Design scope** (accepted with this ADR as the frame for the decisions below; it authorizes no
implementation, and details labelled PROPOSED or OPEN elsewhere keep that status):

- **GateDecision V1** — one deterministic decision per evaluation, conforming to the existing V1
  schema with no schema change.
- **Trusted inputs** — trusted context (T1) and untrusted artifacts (T0) as defined below.
- **Policy mapping** — a versioned, committed policy table (`policy_version` 1).
- **Aggregation without side effects** — the aggregator performs no network, environment or file
  write access. Git object reads go through an **injected** Git L1 resolver, as in the A3.5
  verifiers; the default resolver runs the `git` executable as a subprocess
  (`scripts/ai/git-object.mjs`), which is the only permitted I/O. Git objects are integrity-bound
  by SHA, but object content from the evaluated head remains T0.
- **Deterministic output** — identical inputs yield an identical decision, except `run_id` and
  `created_at`, which come from trusted run metadata.
- **Occurrence trace** — R2-B.
- **Shadow evaluation** — computing and displaying results with no effect on any action.
- **Enforcement exclusion** — enforcement is out of scope and BLOCKED.

**Currently authorized implementation scope: none.** Each implementation slice needs its own
owner authorization (see Implementation slices).

## Trust boundaries

Terminology follows ADR-AI-011 (Trust boundaries): **T0** untrusted producer data; **T1** trusted
verifier code, Git objects and trusted context, trusted by construction; **T2** same-process
malicious code, out of scope.

| Boundary | Origin | Class | Required validation | Failure behaviour | Authority |
|---|---|---|---|---|---|
| TaskSpec | Spec file at the evaluated head | T0 | Extraction, schema, business, policy (ADR-AI-008/009) and a verified spec approval | ERROR or per OD-B4 | None |
| Reports (Implementation, Review, Eval) | Producer bytes | T0 | `validateContractBytes`; SHA binding to trusted head/base | ERROR (ADR-AI-005) | None |
| EvidenceRef | Producer | T0 ref; verifier result T1 | `createEvidenceVerifier` | R1-B and OD-B3 | None |
| Approval candidates | Trusted approval snapshot only (OD-B5) | T1 fields; comment body text is human-written and used only through the command grammar | Stages A–E | R1-B, D-04 | **None** (ADR-AI-011; CLAUDE.md §G) |
| Producer approval claims | — | No V1 input channel exists | Ignored | — | None |
| Git identity and SHA binding | Event payload and Git L1 | T1 | Full SHAs; L1 resolver | ERROR / STALE (ADR-AI-005) | None |
| Git object content at the evaluated head | Local object database | T0 content, integrity-bound by SHA | L1 resolver, L0 path safety | ERROR on missing or malformed objects | None |
| CI snapshots | Trusted adapter (A3.7, not implemented) | T1 only when built by trusted infrastructure; fixtures in tests and shadow | v1 envelope today; v2 PROPOSED | OD-B3 | None |
| Policy source revision | Must be a trusted revision | T1 on a trusted revision; **T0 when read from the PR head** (ADR-AI-008) | Self-checks on load | ERROR | None |
| Human authorization | Owner | Outside the system | Only through a verified approval for gate purposes | — | Humans only (ADR-AI-003) |
| Shadow output | CI job running PR code | Non-authoritative | Labelled SHADOW / FIXTURE / NON-AUTHORITATIVE | — | None |

**Invariant (ACCEPTED, ADR-AI-005, ADR-AI-011, CLAUDE.md §G):** a VERIFIED reference or a PASS
GateDecision never independently authorizes push, merge, deploy, migration or production
mutation.

## GateDecision states and precedence

**ACCEPTED** (ADR-AI-005): `ERROR > FAIL > BLOCKED > WAITING_HUMAN > PASS`. ERROR: inputs cannot
be trusted or evaluated. FAIL: a required deterministic rule or check failed, not waivable through
the gate. BLOCKED: blocking finding, semantic threshold or explicit human rejection. WAITING_HUMAN:
a required human decision is pending. PASS: all requirements met, eligible for human action. The
decision is the highest level among its reasons, and all reasons are retained (through R2-B).

**PASS (P1-b, APPROVED_IN_CONVERSATION).** PASS is emitted only when the normalized occurrence set
is empty and every trusted-input check has passed. It is then represented by exactly one reason:
`code` `ALL_REQUIREMENTS_MET`, `detail` `trace=<run_id>`. PASS remains eligibility for human action
only (ADR-AI-005).

**D-07 — GOVERNANCE (APPROVED_IN_CONVERSATION).** A change whose actual changed paths touch any
GOVERNANCE registry entry (under `covers`/`overlaps` semantics, with case ambiguity failing
closed, ADR-AI-008) cannot PASS in V1 without a trusted, verifiable `custom` governance gate, and
no such gate exists in V1. Such a decision always carries at least one `APPROVAL_PENDING` reason
for the governance gate. ERROR, FAIL or BLOCKED reasons, when present, take precedence over
WAITING_HUMAN. Classification uses the actual diff, never producer declarations.

## R1-B — Trusted-context classification

**Status: APPROVED_IN_CONVERSATION.**

| Condition | Decision level |
|---|---|
| Missing, broken, stale or invalid trusted verification context (CI or approval) | ERROR |
| Genuinely missing human approval | WAITING_HUMAN |
| Human approval source or type without an accepted verifier (`production`, `custom`), when the context itself is valid | WAITING_HUMAN |
| ApprovalRef STALE | WAITING_HUMAN |
| ApprovalRef INVALID | FAIL, evaluated at the required-slot level (OD-B5) |
| Approval verifier ERROR | ERROR |

**Clarification of ADR-AI-011 (active from acceptance on 2026-10-14).** ADR-AI-011 (Result
semantics, "Relation to ADR-AI-005") states that "a trusted approval source that is not yet
available stays pending (`WAITING_HUMAN`), which can never be `PASS`". With the acceptance of this
ADR, that sentence is clarified as follows for gate aggregation:

> An approval source that is unsupported in V1 (`production`) or not yet applicable (`merge` before
> merge), or a human gate without an accepted verifier (`custom`), stays pending (`WAITING_HUMAN`)
> when the verification context is valid. A failure of the trusted verification context — missing,
> incomplete, unfresh or head-mismatched approval snapshot; unavailable allowlist; unknown edit
> status; missing trusted object-path list; oversized bound object; repository or PR mismatch of
> the snapshot — is an untrusted gate input and makes the decision `ERROR` under ADR-AI-005.

The body of ADR-AI-011 is not modified. Its verifier outcomes and contract are unchanged. The
clarification took effect with the acceptance of this ADR (see C6).

**Supersession mechanism (SB-2, APPROVED_IN_CONVERSATION).** The owner selected a partial
supersession of ADR-AI-011, limited to the sentence above and only for the GateDecision aggregation
classification of unavailable trusted approval context, declared in this ADR's header. Following the
ADR-AI-004 / ADR-AI-007 precedent, ADR-AI-011's status line and the ADR index carry a
partial-supersession annotation (S0-B.1). ADR-AI-011 remains Accepted; the ApprovalRef verifier and
its contract are not changed, and the rest of ADR-AI-011 remains authoritative.

## D-04 — Approval reason mapping

**Status: APPROVED_IN_CONVERSATION.** Uses existing V1 reason codes only.

| Situation (after OD-B5 stages) | `approvals[].status` | Reason | Level |
|---|---|---|---|
| Required slot with at least one VERIFIED candidate | `verified` (one entry, lowest `source_id`) | — | — |
| Required slot without VERIFIED but with an assigned INVALID candidate | `rejected` | `UNVERIFIABLE_APPROVAL` | FAIL |
| Required slot without an assigned VERIFIED or INVALID candidate (no candidate, or only stale or unrelated commands) | `missing` or not listed | `APPROVAL_PENDING` | WAITING_HUMAN |
| Slot whose source or gate has no accepted verifier (`production`, `custom`), valid context | `pending` or not listed | `APPROVAL_PENDING` | WAITING_HUMAN |
| Trusted-context failure (stage A) | — | `INVALID_INPUT` | ERROR |
| Duplicate or conflicting trusted snapshot data (`E_APPROVAL_SNAPSHOT_DUPLICATE`) | — | `CONFLICTING_INPUT` | ERROR |
| Other approval verifier ERROR | — | `INVALID_INPUT` | ERROR |

`UNVERIFIABLE_APPROVAL` is used for INVALID approvals because it is the only approval-related
FAIL-level code in the V1 enum; its name does not mean that verification was impossible.
`detail` carries the verifier's `E_APPROVAL_*` code and safe, grammar-constrained identifiers only
(approval type, slot identifier, digit-only `source_id`). Comment bodies, names and free text are
never copied. A slot without a candidate never produces a fabricated ApprovalRef.

## OD-B5 — Approval evaluation

**Status: APPROVED_IN_CONVERSATION** for stages A–E and the rules below. The detailed slot model
is PROPOSED.

**Stage A — trusted approval context.** Before any verifier call, the aggregator validates its own
copy of the trusted approval snapshot: non-empty allowlist; snapshot present;
`freshness.complete === true`; `freshness.edit_status_reliable === true`; repository id, PR number
and head SHA equal to trusted context. Any failure yields `INVALID_INPUT` (ERROR).

**Stage B — candidate selection.** Candidates come only from the trusted snapshot: comment kind
`issue_comment`, `author_id` in the trusted allowlist, `author_association === 'OWNER'`, and a
current body that parses under the ADR-AI-011 command grammar. Other comments are ignored and
produce no reason. Approval candidates are never accepted through an undeclared producer input
channel (no V1 input contract carries ApprovalRef).

**Stage C — slot assignment (S-H, APPROVED_IN_CONVERSATION).** A candidate is assigned to a
required slot only when its command SHA equals the trusted Git blob id of that slot's path at the
current head, for a slot of the same approval type. A candidate whose SHA matches several slots
(identical blobs) is assigned to each of them. Unassigned candidates affect no slot. The trusted
base blob of a slot path may be used only to label an unassigned candidate in diagnostics (for
example "previous version"); it never establishes or implies an approval.

**Stage D — verification (APPROVED_IN_CONVERSATION).** Only assigned candidates are verified, by
the existing ADR-AI-011 verifier, unchanged, as an ApprovalRef `{approval_type,
github_pr_comment, pr_number (trusted context), source_id (comment id), object_sha}` built from the
trusted snapshot record, with all slot paths of the candidate's type as trusted object paths.
Unassigned candidates are never verified, so a command for a type without a required slot cannot
produce `E_APPROVAL_OBJECT_PATH_UNKNOWN`; that code after assignment is an internal inconsistency
(`INVALID_INPUT`, ERROR).

**Stage E — slot evaluation.** Per the D-04 table.

**Rules (APPROVED_IN_CONVERSATION):**

- A slot with at least one VERIFIED candidate is satisfied. There is no "latest command wins" rule.
- An edited comment whose current body parses is a candidate; the verifier reports INVALID
  (`E_APPROVAL_SOURCE_EDITED`).
- An edited comment whose current body does not parse is ignored; its earlier content is never
  inferred.
- The owner recovers by posting a new, valid, unedited approval command.
- Third-party comments cannot force FAIL (they are filtered in stage B).
- `E_APPROVAL_CONTEXT_MISMATCH` is classified by processing stage, not by diagnostic string: after
  stage A it can only indicate an internal inconsistency and yields `INVALID_INPUT`. The verifier's
  V1 contract is unchanged.
- Deletion or rename of a migration file yields `INVALID_INPUT` (ERROR) until an accepted migration
  policy exists.
- Approval output exceeding the V1 capacity of 10 entries yields ERROR (`INVALID_INPUT`); the list
  is never silently truncated, and all slots are recorded in the trace.
- A satisfied migration slot never authorizes executing a migration (ADR-AI-006).

**Slot model (PROPOSED):** `spec:<spec path>` (always required); `package_change:package-lock.json`
(diff touches PACKAGE); `migration:<path>` per added or modified migration file; `production` (diff
touches PRODUCTION or `production_config` is declared; not satisfiable in V1); `custom:HG-NN` per
custom human gate (not satisfiable in V1); no merge slot before merge.

**Limitations (recorded):**

- The snapshot holds current comment state only; earlier comment contents cannot be reconstructed.
- Comment flooding beyond the snapshot limit on a public repository yields ERROR; mitigation is an
  A3.7 obligation (C1).
- **Identical migration blobs (V1 limitation, APPROVED_IN_CONVERSATION).** When two migration
  slots have the same blob:
  - with no matching approval, both slots are `APPROVAL_PENDING`;
  - a matching approval is assigned to both slots, and the verifier, which receives all migration
    slot paths, reports INVALID (`E_APPROVAL_SCOPE_AMBIGUOUS`); both slots fail
    (`UNVERIFIABLE_APPROVAL`).
  Under this V1 binding model no candidate for that blob can become VERIFIED, because every such
  candidate matches both slot paths; posting another matching command does not help. A VERIFIED
  approval is never inferred. Recovery requires distinct, verifiable object identities for the
  slots or a future, separately approved policy. The general D-04 rule (a slot with at least one
  VERIFIED candidate is satisfied) is unchanged for all other slots.
- Edit detection compares timestamps as strings; timestamp normalization is an A3.7 obligation (C1).
- The trusted approval snapshot adapter does not exist yet (A3.7).

## OD-B4 — Spec identity

**Status:** the rename rule is APPROVED_IN_CONVERSATION; the rest of the decision tree is PROPOSED.

- **Rename (APPROVED_IN_CONVERSATION).** A rename in which exactly one spec file carries the
  evaluated `spec_id` and its file name matches that `spec_id` is not automatically
  `SPEC_TAMPERED`. Approval must be renewed against the current object identity (path and blob)
  under OD-B5. This grants no general permission to rename protected governance files; GOVERNANCE
  rules (D-07) still apply.
- **Ordinary content edits** require renewed approval (ADR-AI-006, ACCEPTED); old approvals become
  STALE → `APPROVAL_PENDING`. An edit is never `SPEC_TAMPERED`.
- **PROPOSED tampering conditions** (subject to the S1 changed-path primitive): deletion of the
  evaluated spec without a unique replacement; a duplicate `spec_id` introduced by the change
  (including ASCII case-only collisions under `isCaseAmbiguous`); a change of the spec file from a
  regular blob to another object mode; a `spec_id` in the machine block that differs from the file
  name or from the base version at the same path → `SPEC_TAMPERED` (FAIL).
- **Evaluation-context errors, not tampering (PROPOSED):** spec absent at both base and head;
  malformed spec bytes or machine block; a pre-existing duplicate or non-regular object;
  unavailable Git objects → `INVALID_INPUT` (ERROR); report `spec_id` differing from the evaluated
  spec → `CONFLICTING_INPUT` (ERROR).
- Changes to other spec files are handled by GOVERNANCE and scope rules, not by `SPEC_TAMPERED`.

## OD-B3 — Reason-to-level policy

**Status: CONDITIONAL** (open condition C3). All 18 V1 reason codes, from the schema enum:

| Code | Level | Trigger | Emitted in V1 |
|---|---|---|---|
| `INVALID_INPUT` | ERROR | Invalid bytes, schema or business rules; verifier ERROR; trusted-context failure (R1-B); limits exceeded; unknown check id; required job absent without a provably complete CI inventory; run `cancelled` or `action_required`; migration deletion or rename | Yes |
| `UNSUPPORTED_VERSION` | ERROR | Unsupported `schema_version` or envelope | Yes |
| `MISSING_REPORT` | ERROR | Required report absent | Yes |
| `STALE_SHA` | ERROR | Input SHA differs from trusted head/base; head moved | Yes |
| `MIXED_SHA` | ERROR | Inputs carry differing SHAs | Yes |
| `CONFLICTING_INPUT` | ERROR | Same-type reports; duplicate jobs or runs; duplicate trusted snapshot data; threshold or `spec_id` mismatch | Yes |
| `INCOMPLETE_REPORT` | ERROR | Report lacks rows required by the TaskSpec; `met` without VERIFIED evidence; declared files differ from the actual diff | Yes |
| `CHECK_FAILED` | FAIL | Required job concluded `failure` or `timed_out`; requirement `not_met` or `partially_met` | Yes |
| `MISSING_CHECK` | FAIL | Required job absent, `skipped` or `neutral` in a **provably complete** trusted CI inventory | Only with a complete trusted snapshot (proposed v2) or fixtures |
| `SCOPE_VIOLATION` | FAIL | Actual changed path outside scope, forbidden, case-ambiguous, unrepresentable, or protected without declaration | Yes (requires S1) |
| `SPEC_TAMPERED` | FAIL | OD-B4 tampering conditions | Yes (requires S1) |
| `UNVERIFIABLE_APPROVAL` | FAIL | Required slot without VERIFIED but with an assigned INVALID candidate | Yes |
| `BLOCKING_FINDING` | BLOCKED | `gate_impact = blocking` by policy | When review reports are enabled |
| `EVAL_BELOW_THRESHOLD` | BLOCKED | Score below the TaskSpec threshold (producer `result` ignored) | When `semantic_evals` exist |
| `HUMAN_REJECTED` | BLOCKED | Requires a trusted human-rejection source | **No** (no such source in V1) |
| `PREVIOUS_BLOCKING_UNACKNOWLEDGED` | BLOCKED | Requires stable Finding identity (ADR-AI-010 D21, D23) | **No** |
| `APPROVAL_PENDING` | WAITING_HUMAN | Slot without candidate or with STALE only; `production`, `custom` and GOVERNANCE gates | Yes |
| `ALL_REQUIREMENTS_MET` | PASS | Sole reason, only when every required condition is met | Yes |

Absence of evidence is never treated as a verified failure. GOVERNANCE restrictions (D-07) apply
in addition to this table.

**CI snapshot v2 (PROPOSED, not implemented).** A trusted CI snapshot proves inventory completeness
only if it carries: repository id; workflow id and path; event; head SHA and head repository id;
run id, run attempt and latest attempt (equal); completed status; a job list whose length equals
the reported total, with `inventory.complete === true`; and `fetch.fetched_after_completion ===
true`. Trust comes only from the trusted adapter channel (A3.7); the data carries no signature.
Duplicate snapshots for one run attempt yield ERROR; several runs for one workflow, event and head
yield `CONFLICTING_INPUT`.

## R2-B — Decision projection, occurrences and diagnostic ledger

**R2-B (APPROVED_IN_CONVERSATION):** GateDecision V1 stays bounded by its schema. A separately
designed trace preserves every diagnostic occurrence. No reason or occurrence is silently lost, and
the GateDecision V1 schema is not changed. Missing, corrupt, mismatched or incomplete trace data
never yields a decision treated as complete.

### Decision projection (S0A5-1, P1-a: CONDITIONAL; P1-b: APPROVED_IN_CONVERSATION)

- The V1 reason object has exactly two fields, `code` (18-value enum) and `detail` (string of at
  most 300 characters, no pattern), and `reasons` holds 1–100 entries
  (`gate-decision.schema.json`, IMPLEMENTED_FACT). No count, marker or trace field exists, and none
  is added.
- `reasons` contains **exactly one entry per distinct non-PASS code** present among the layer-1
  occurrences (Option A), ordered by decision level and then by the code's position in the schema
  enum. At most 17 entries can occur (at most 15 in V1, because `HUMAN_REJECTED` and
  `PREVIOUS_BLOCKING_UNACKNOWLEDGED` are not emitted), which fits the limit of 100.
- `detail` grammar (CONDITIONAL until schema tests and manifest verification exist):

  ```
  detail      := "n=" COUNT ";first=" SUBJECT [ ";diag=" ECODE ] ";trace=" RUNID
  PASS detail := "trace=" RUNID
  ```

  Token constraints (PROPOSED, part of the CONDITIONAL grammar):

  | Token | Definition | Maximum characters |
  |---|---|---|
  | `COUNT` | Exact number of layer-1 occurrences for the code (S0A6.1-D1) | 16 |
  | `SUBJECT` | `KIND ":" ID` | 16 + 1 + 71 |
  | `KIND` | A token from the closed, versioned KIND registry (S0A6.1-D2) | 16 |
  | `ID` | A schema-constrained identifier of at most 41 characters (for example `CheckId`, `SpecId`, `R-NN`, `HG-NN`), or `sha256:` followed by 64 lowercase hex of the identifier for paths and any long or unconstrained identifier | 71 |
  | `ECODE` | `E_` followed by 1–62 characters from `[A-Z0-9_]` (the longest existing verifier code has 34 characters) | 64 |
  | `RUNID` | The decision's `run_id` (`RunId` in `common.schema.json`, ASCII, at most 64) | 64 |

  `SUBJECT` is the smallest layer-1 subject for the code under a deterministic total order;
  **truncated hashes are not used**, because short prefixes can be collided deliberately. Every
  token is ASCII, so the character count measured by the schema (Unicode code points) equals the
  UTF-8 byte count; a `detail` that would contain a non-ASCII character is an evaluation failure.

  **`COUNT` (S0A6.1-D1, APPROVED_IN_CONVERSATION — CONDITIONAL).**

  - `COUNT` is the exact number of layer-1 occurrences for the reason code.
  - It is a nonnegative JavaScript safe integer: at most `Number.MAX_SAFE_INTEGER` =
    9007199254740991 (16 digits).
  - It is encoded as canonical ASCII base-10 digits with no leading zero, except for the value
    zero itself. (Under the decision projection an entry exists only for a code with at least one
    occurrence, so a `reasons` entry never carries `n=0`.)
  - No rounding, saturation, truncation or loss of integer precision is allowed. If the count
    cannot be computed or represented exactly, the evaluation fails closed (see Evaluation
    failure); no ERROR GateDecision and no trusted completion marker are fabricated.
  - This is a representation constraint (kind A below). It approves no processing, occurrence,
    ledger, byte or memory limit (kinds B and C).
  - Schema and boundary tests are required before S3.

  **`KIND` (S0A6.1-D2, APPROVED_IN_CONVERSATION — CONDITIONAL).**

  - `KIND` is selected only from a closed, versioned registry at the trusted policy revision; the
    registry is never taken authoritatively from the evaluated PR head.
  - Tokens use grammar-constrained ASCII characters (PROPOSED character set: `[a-z0-9-]`) and are
    at most 16 characters long.
  - An unknown `KIND` is rejected (evaluation failure); it is never silently mapped to another kind.
  - Any addition, removal or rename of a `KIND` requires policy review, grammar review and tests.
  - The exact list remains **PROPOSED**. Candidates from review: `input`, `report`, `requirement`,
    `acceptance`, `evidence`, `eval`, `finding`, `check`, `slot`, `path`, `spec`,
    `approval-context`, `policy`.

  **Length argument (design calculation, not an executed test).** Fixed parts: `n=` 2, `;first=` 7,
  `KIND` 16, `:` 1, `ID` 71, `;diag=` 6, `ECODE` 64, `;trace=` 7, `RUNID` 64, a total of 238
  characters. With `COUNT` at most 16 digits (D1), a `detail` is at most 238 + 16 = **254**
  characters, below the schema limit of 300; a PASS `detail` (`trace=` 6 + `RUNID` 64) is at most
  70 characters. All tokens are ASCII, so these character counts equal UTF-8 byte counts. The
  calculation depends on D1, on the 16-character `KIND` limit (D2), on the 71-character `ID` rule
  and on the 64-character `ECODE` and `RunId` limits; the earlier figure of 244 (6-digit `COUNT`)
  is superseded.

  Three kinds of limit are distinct and must not be confused:

  | Kind | Concerns | Status |
  |---|---|---|
  | A. Representation limits | Whether a `detail` string fits the V1 schema (300 characters) | Fixed by the schema; the grammar argument above |
  | B. Occurrence-processing limits | How many occurrences or violations an evaluation may produce (P, J, c, N) | **None approved** (C4) |
  | C. Trace, ledger byte and memory limits | Size of the trace and ledger and evaluation memory | **None approved** (C4, C5) |

  A limit of kind A never implies a limit of kind B or C. `COUNT` and identifiers are never
  truncated; when a value cannot be represented, the evaluation fails (see Evaluation failure).
- `run_id` is a correlation key only and proves no integrity. Trust in a decision requires the
  manifest digests (see Trace, manifest and integrity obligations).

### Layer 1 — normalized occurrences

**OD-B6 (CONDITIONAL, open conditions C2 and C4).** A layer-1 occurrence is a unique `(code,
subject kind, subject id)` triple, the projection of one or more independent violations.
Every EvidenceRef has its own subject identity (**P3-f, APPROVED_IN_CONVERSATION**): failing
EvidenceRefs of one requirement are never collapsed into one subject. Layer 1 feeds the decision
projection only; it is not the traceability mechanism. `detail` uses only grammar-constrained
identifiers and `E_*` codes, never T0 text. Recompute equivalence excludes `run_id` and
`created_at`. Output that fails schema validation is never emitted.

Conditional layer-1 bound:

> **N ≤ 2,989 + 3P**, where P is the number of changed-path entries in the proposed no-renames
> representation (a rename counts as one deletion plus one addition).

The bound holds only under these **required design invariants** (not implemented facts):

| ID | Invariant |
|---|---|
| G1 | The number of input artifacts is bounded (proposed: at most 10). |
| G2 | `MIXED_SHA` produces at most one global occurrence. |
| G3 | Each requirement, eval, finding and check subject produces a bounded number of occurrences (proposed: at most 2). |
| G4 | Each evidence reference and each declared-file subject produces a bounded number of occurrences (proposed: at most 1). |
| G5 | Approval slots, the approval context and the approval capacity check produce a bounded number of occurrences (proposed: one per slot, one for context, one for capacity). |
| G6 | Each changed path produces at most one layer-1 `SCOPE_VIOLATION` occurrence and a bounded total of layer-1 occurrences (proposed: at most 3); every independent scope violation of the path remains in layer 2. |
| G7 | Errors during error handling throw; they never recursively produce occurrences. |

- The layer-1 bound is conditional and not verified by implementation. The counting argument and
  the invariants require review and tests (C4). The layer-1 bound says nothing about the size of
  layer 2.

### Layer 2 — diagnostic ledger

**Independent violation (P3-a, APPROVED_IN_CONVERSATION).** An independent violation is
identified by `(rule_id, tuple of source locators)`:

- `rule_id` is a fixed identifier of a deterministic policy rule.
- A source locator is `(source_id, locator)`. `source_id` is a trusted, deterministic identity:
  the SHA-256 digest of validated artifact bytes, a Git object id, or a trusted record id from a
  trusted snapshot (job id, comment id). `locator` is an RFC 6901 JSON Pointer into the validated
  artifact, a TaskSpec entry index, or a full repository path.
- Locators within a tuple are in canonical order (by `source_id`, then `locator`, byte-wise).
- Each distinct entry that makes a rule fail (for example each matching `forbidden_paths` entry) is
  part of a distinct independent violation.
- Repeated deterministic evaluation of the same rule on the same locators is the same violation,
  not a new one.

**Ledger form (P3-b, APPROVED_IN_CONVERSATION).** Layer 2 uses lossless indexed groups: a group
entry `(code, subject, rule_id)` lists every locator tuple of its violations, so that flattening
the ledger yields exactly the set of independent violations. Every independent violation is
representable and reconstructible from the ledger itself. Count-plus-first-entry compaction is
**rejected** as a substitute for full violation identity. Ledger entries carry rule ids, locators,
`E_*` codes and source digests only; values from sources are never copied.

**Violation mapping (PROPOSED, part of P3-a/P3-b).** Every independent violation v has a
deterministic mapping to exactly one reason code `code(v)`, one normalized subject `subject(v)`,
one rule identity `rule_id(v)` and one canonical locator tuple `loc(v)`. Each `rule_id` belongs to
exactly one reason code in the versioned policy, and `subject(v)` is a deterministic function of
`rule_id(v)` and `loc(v)`. The ledger must satisfy:

- **Partition:** the groups `(code, subject, rule_id)` partition the violations; every violation
  appears in exactly one group, under its own `code(v)` and `subject(v)`, and in no other group.
- **No omission, no duplication:** flattening the groups yields each violation exactly once.
- **Stable ordering:** groups are ordered by code rank, subject and `rule_id`; locator tuples within
  a group in canonical order; flattening is therefore reproducible byte for byte.
- **Projection:** the layer-1 occurrence set equals `{(code(v), subject(v))}` over all violations.

Two properties are distinct:

- **Structural ledger consistency** (partition, ordering, projection, agreement with the decision
  and the manifest digests) can be checked from the decision, trace and manifest alone.
- **Full source completeness** (every violation that the policy produces from the bound inputs is in
  the ledger) can be shown only by independent deterministic recomputation at the trusted policy
  revision (I8).

**Duplicate records (P3-c, CONDITIONAL).** Invalid duplicate input records are rejected, never
deduplicated, and every duplicate locator is recorded:

| Duplicate | Contract basis | Result |
|---|---|---|
| Duplicate JSON keys in an artifact | ADR-AI-007 (ACCEPTED) | Artifact rejected at parse → `INVALID_INPUT` |
| Two artifacts of the same type in one input set | ADR-AI-005, SHA and freshness (ACCEPTED) | `CONFLICTING_INPUT` (ERROR) |
| Duplicate TaskSpec ids (requirements, acceptance criteria, gates, evals) | `BR-ID-UNIQUE` (`scripts/ai/taskspec-business.mjs`) | TaskSpec invalid → `INVALID_INPUT` |
| Duplicate entries in `allowed_paths`, `forbidden_paths`, `deterministic_checks`, `files.*`, `migration_changes` | `uniqueItems` in the TaskSpec and ImplementationReport schemas | Schema invalid → `INVALID_INPUT` |
| Duplicate trusted snapshot entries (same comment id; several CI snapshots for one run attempt) | Verifier codes `E_APPROVAL_SNAPSHOT_DUPLICATE`, `E_EVIDENCE_SNAPSHOT_DUPLICATE` | `CONFLICTING_INPUT` (ERROR) |
| Several jobs with the same display name in one run | Verifier code `E_EVIDENCE_CHECK_AMBIGUOUS`; OD-B3 | `CONFLICTING_INPUT` (ERROR) |
| Duplicate requirement rows in an ImplementationReport; duplicate `finding_id` within a review report | **No existing contract rule** | PROPOSED: `CONFLICTING_INPUT` (ERROR); OPEN until approved |

The first six rows restate behaviour that existing parsers, schemas, business validators and
verifiers already enforce; this ADR adds no authority to them, and that handling is retained.

**S0A6.1-D3 (APPROVED_IN_CONVERSATION).** The last row has no accepted contract rule. Duplicate
requirement rows in an ImplementationReport and duplicate `finding_id` values within one review
report therefore remain **OPEN**: the `CONFLICTING_INPUT` mapping shown is a proposal, not
accepted policy; no new schema requirement is introduced; invalid records are never silently
deduplicated; and a separate owner decision is required before S3 if new duplicate rules are to be
enforced.

### Bounds (P3-d, CONDITIONAL)

- **No numeric limit is approved** for changed paths (P), CI jobs (J), approval comments (c),
  ledger entries, trace bytes or memory. The earlier candidates (P ≤ 5,000, N ≤ 20,000, trace ≤
  10 MiB) remain unapproved, and a layer-2 bound of the form `3,457 + 7P` is **not** approved.
- A finite unconditional bound cannot be stated today: P has no accepted limit (S1), the v1 CI
  snapshot does not limit its `jobs` array, and the 10,000-comment snapshot limit is an
  implementation fact, not accepted policy.
- An illustrative, **unverified** candidate from review is
  `V ≤ 5a + 3,180 + J + s + c + (321 + |R|)·P` (a input artifacts, s approval slots, |R| protected
  registry entries). It must be re-derived from the schemas and the actual rule cardinalities
  before any use.
- Any limit overflow is an evaluation failure (see Evaluation failure); nothing is truncated.

### Evaluation failure (PROPOSED clarification)

An **evaluated ERROR decision** and an **evaluation failure** are different:

- An evaluated ERROR decision is a complete, schema-valid GateDecision whose reasons include ERROR
  codes (for example trusted-context failures under R1-B, or approval output above 10 entries). It
  follows the normal publication protocol.
- An evaluation failure is any overflow, unrepresentable value, internal inconsistency or exception
  that prevents a complete, schema-valid decision and a complete trace from being produced.

For an evaluation failure:

- no GateDecision, trace or manifest completion marker is issued as authoritative;
- no ERROR GateDecision is fabricated to stand in for the failed evaluation;
- any artifact already written is partial and is never consumed as complete;
- the failure is reported only through the operational status of the trusted CI job or publisher;
- the failure never becomes PASS or WAITING_HUMAN;
- shadow constraints are unchanged: a shadow run reports the failure as a non-authoritative job
  failure.

### Completeness invariants (P3-e, CONDITIONAL)

| ID | Invariant |
|---|---|
| I0 | The manifest lists the digests of every input artifact and trusted snapshot, the head and base SHAs, and the trusted policy revision. |
| I1 | Every validated record has a unique `(source_id, locator)`. |
| I2 | The set of independent violations V is defined by applying the policy rules at the trusted revision to the validated records. |
| I3 | Flattening the ledger yields exactly V (no missing and no extra violations). |
| I4 | The layer-1 occurrence set is exactly the projection of V onto `(code, subject)`. |
| I5 | For each code, the decision's `n=` equals its layer-1 occurrence count and `first=` is its smallest subject; the decision's codes are exactly the codes with occurrences; an empty occurrence set yields PASS only. |
| I6 | The decision level is the highest level among its codes. |
| I7 | The manifest binds the digests of the decision and the trace; a consumer checks I4–I6 against the trace. |
| I8 | Completeness of the ledger (I2, I3) is established only by independent deterministic recomputation at the trusted policy revision over the digest-bound inputs. |

These invariants distinguish four properties:

- **Internal consistency** of decision, trace and manifest (I4–I7) can be checked by a consumer.
- **Integrity of source bindings** (I0, I1) relies on digests and on trusted snapshot channels.
- **Completeness of the ledger** (I2, I3) cannot be shown by the manifest alone.
- **Independent recomputation** (I8) at a trusted revision is the only completeness proof; it
  requires a trusted evaluator (C6).

A manifest digest alone never proves that all violations were recorded.

### Trace, manifest and integrity obligations (PROPOSED)

Candidate envelopes `hlg.gate-trace.v1` (layer-1 occurrences, layer-2 ledger, completeness
indicator accepted only as literal `true`) and `hlg.gate-manifest.v1` (repository, PR, base and
head SHA, run id and attempt, policy revision, input digests, decision and trace digests). The
decision references neither; the trace references the decision digest; the manifest references
both, so there is no circular hash dependency. Hash inputs are domain-separated by envelope name.
Fields, serialization, bounds and retention are open (C5).

## Publication protocol

**Principle: APPROVED_IN_CONVERSATION** — publish → verify → finalize.

- The GateDecision and its occurrence trace are bound by verified digests.
- A completion marker is issued only by a trusted publisher after verifying the complete pair.
- A consumer verifies the current PR head and the run attempt before relying on a decision.
- Partial uploads are never treated as a complete decision.
- GitHub Actions artifact uploads are not atomic.
- Shadow runs cannot issue trusted completion markers.
- `run_id` correlates the decision, trace and manifest; it is not an integrity proof.
- Verified digests establish internal consistency and binding, not ledger completeness; completeness
  requires independent recomputation at a trusted policy revision (I8).
- An evaluation failure produces no completion marker and is reported only through the trusted CI
  job's or publisher's operational status (see Evaluation failure).

The exact decision, trace and manifest schemas, serialization, retention, publisher identity and
the A3.7 implementation remain PROPOSED (C5).

## OD-B1 … OD-B9 decision register

Provenance: OD-B1 … OD-B9 were defined in conversation-only reports (A3.6a section 13, refined in
A3.6a.1); the summaries below are faithful to those reports.

| ID | Subject | Status |
|---|---|---|
| OD-B1 | Check registry and CI snapshot identity: job-level registry (`artifact_boundary`, `test_suite` in `.github/workflows/test.yml`, event `pull_request`) bound by workflow path, event and job name; CI snapshot v2 for enforcement | OPEN (D-05) |
| OD-B2 | Required reports: ImplementationReport always; EvalReport when `semantic_evals` is non-empty; review reports only when enabled by trusted policy | OPEN |
| OD-B3 | Reason-to-level policy | CONDITIONAL (C3) |
| OD-B4 | Spec identity | Rename rule APPROVED_IN_CONVERSATION; remainder PROPOSED |
| OD-B5 | Approval evaluation | APPROVED_IN_CONVERSATION (stages, rules and S-H slot binding); slot model PROPOSED |
| OD-B6 | Determinism, layer-1 occurrences and bounds; layer-2 ledger per P3-a … P3-f | CONDITIONAL (C2, C4, C5) |
| OD-B7 | Shadow constraints: fixtures only; SHADOW / FIXTURE / NON-AUTHORITATIVE labels; read-only permissions; no status, comment, approval or deployment action; no required-check promotion; separate authorization for workflow changes | OPEN |
| OD-B8 | Enforcement prerequisites | OPEN; enforcement BLOCKED |
| OD-B9 | EvidenceRef collection-accessor hardening | Completed outside this ADR as A3.5b.3 (`f8880ab` on PR #7, merge `103da26` on PR #20), separately authorized |

## Remaining owner decisions

All items except D-01 are **OPEN**.

| ID | Question | Needed before |
|---|---|---|
| D-01 | Accept, amend or reject this ADR — **ACCEPTED** 2026-10-14 (S0-B.1), design authority only | — |
| D-05 / OD-B1 | Check registry and CI snapshot identity | S2 |
| D-06 | Evidence kinds that can support a requirement marked `met` (today `test`, `http_probe` and `schema_validation` can never be VERIFIED) | S2 |
| D-08 | Slice names and order; whether S1 may proceed independently of S0-B | S1 |
| D-09 | Separate CI maintenance slice (R2 isolated step exit 1, Node 20 action deprecation, `ubuntu-latest` migration), outside A3.6 | — |
| OD-B2 | Required reports for policy v1 | S2 |
| OD-B7 | Shadow constraints | S4/S5 |
| OD-B8 | Enforcement prerequisites and sequencing | Enforcement |
| F6/F8/F9 | Recover or define the deferred findings (deferral recorded under SB-5; none closed) | Per SB-3 deadlines |
| Duplicates without contract basis | Whether new rules are enforced for duplicate ImplementationReport requirement rows and duplicate `finding_id` within a review report (PROPOSED: `CONFLICTING_INPUT`); kept OPEN by S0A6.1-D3 | S3 |
| KIND list | The exact KIND registry entries and character set (the registry principle is CONDITIONAL under S0A6.1-D2) | S3 |

## Deferred findings F6, F8, F9

The repository contains only one-line descriptions (contracts README, A3.6 row): F6 "protect
deterministic-check configuration", F8 "governance-specific gate", F9 "producer/verifier
separation" (also ADR-AI-010, "producer/verifier self-validation"). They originate from the A3.4c
independent security review (ADR-AI-009 Context; commit `cd59725`), whose full text is not a
repository source (**source coverage UNVERIFIED**).

**SB-5 (APPROVED_IN_CONVERSATION — CONDITIONAL):**

| Finding | Subject | Handling |
|---|---|---|
| F6 | Protect deterministic-check configuration | Partial obligations before S2 (the check registry lives in GOVERNANCE-protected policy code); remaining protection before enforcement |
| F8 | Governance-specific gate | Deferred to a separately authorized V2 design (ADR-AI-010 D23); in V1 a GOVERNANCE change cannot PASS (D-07) |
| F9 | Producer/verifier identity separation | Deferred to A3.7 and the enforcement prerequisites |

None of F6, F8 or F9 is closed. Enforcement remains BLOCKED until they are resolved.

## Controlled deferrals

**SB-3 (APPROVED_IN_CONVERSATION — CONDITIONAL).** The following items are deferred with the stated
deadline. A deferral never means approval of the deferred policy, and every open condition C1–C6
is preserved.

| Deadline | Deferred items |
|---|---|
| Before S1 | D-08 slice sequencing and separate implementation authorization; C2 Git changed-path semantics and an accepted limit for P |
| Before S2 | D-05 / OD-B1 trusted check registry and CI identity; D-06 eligible evidence kinds; OD-B2 required reports; the applicable F6 protection |
| Before S3 | OD-B4 proposed spec identity conditions; OD-B5 proposed slot model; duplicate rules without contract authority (S0A6.1-D3); exact KIND registry and character set (S0A6.1-D2); C5 trace and manifest design; canonical SUBJECT/ID preimage and ordering; GateDecision `spec_id` provenance; `approvals[]` representation rules; required schema, grammar and boundary tests; applicable C4 bounds and resource limits |
| Before S4/S5 | OD-B7 shadow constraints and workflow authorization |
| Before enforcement | C1, C3, C6, OD-B8 and I8; a trusted evaluator and independent recomputation; F8, F9 and the remaining F6; branch protection and the other accepted prerequisites |
| Outside A3.6 | D-09 |

## Open conditions

| ID | Condition | Resolved by |
|---|---|---|
| C1 | Trusted approval snapshot adapter: retrieval, pagination, freshness, comment identity and metadata, edit and deletion semantics, timestamp normalization, comment-body size limits, an accepted comment-count limit (c), and mitigation of comment flooding | A3.7 |
| C2 | Git L1 changed-path primitive and classification (no renames; mode, symlink and gitlink entries; L0 on every path; an accepted limit for P), the required-slot inventory, and trusted head and base blob resolution for S-H slot binding and spec identity | S1 |
| C3 | CI completeness: trusted CI snapshot v2 (proposed) with an accepted job-count limit (J), and mandatory tests for every OD-B3 mapping, including incomplete-inventory, `cancelled`, `skipped` and `neutral` cases | S2/S3 tests; snapshot v2 in A3.7 |
| C4 | Re-derivation of symbolic bounds for layer 1 and layer 2 from schemas and actual rule cardinalities, tests for G1–G7, measured UTF-8 canonical byte size, memory limits, and any numeric limits (none approved; the `COUNT` safe-integer representation of S0A6.1-D1 implies none) | S1/S3 |
| C5 | Schema-tested `detail` grammar, including `COUNT` boundary tests (S0A6.1-D1) and the approved KIND registry (S0A6.1-D2); trace and manifest contract (layer 1, layer 2, digests, binding); trusted publication and verification; retention; consumer checks I4–I7; and the SB-4 design obligations listed below | Separate design slice before S3; trusted publisher in A3.7 |
| C6 | A trusted evaluator for independent recomputation (I8); governance protection of the policy and aggregator; all enforcement prerequisites (OD-B8), including branch protection. (The ADR-AI-011 clarification under R1-B was accepted with this ADR in S0-B.1; the remaining parts of C6 stay open.) | Trusted evaluator and enforcement prerequisites before any enforcement |

**C5 design obligations (SB-4, APPROVED_IN_CONVERSATION).** These are design obligations to be
resolved in the C5 design slice before S3, not finalized policies:

- the canonical byte encoding of the preimage used for SUBJECT and ID hashing;
- domain separation where required, so that identifiers of different kinds cannot be confused;
- deterministic subject ordering, stating whether ordering applies before or after normalization
  and hashing;
- traceability from every hashed display identifier to its original trusted source locators;
- the provenance of the GateDecision's required `spec_id`, for valid TaskSpecs and for invalid or
  missing TaskSpecs; `spec_id` values are never invented, and when the required `spec_id` cannot
  be established the result is an evaluation failure, not a fabricated schema-valid ERROR
  decision;
- rules for when `approvals[]` may contain `missing` or `pending` entries within the existing V1
  schema; an ApprovalRef is never fabricated when no real source exists.

Merge to `main` and production remain BLOCKED by these conditions and by existing policy
(CLAUDE.md §B, §E).

## Implementation slices

Slice naming and order are PROPOSED until owner approval (D-08). Each slice requires separate owner
authorization; this ADR authorizes none.

| Slice | Content | Expected files (if determinable) | Depends on |
|---|---|---|---|
| S0-A | Draft this ADR | This file; ADR index; contracts README link | — |
| S0-B | Owner review and acceptance — local documentation acceptance done (S0-B.1); Git operations (S0-B.2) not authorized | This file; ADR-AI-011 status line; ADR index | S0-A |
| S1 | Git L1 `listChangedPaths(base, head)` with a bounded P | `scripts/ai/git-object.mjs`, `test/ai/git-object.node-test.mjs` | None (may be independent of S0-B; not authorized here) |
| S2 | Gate policy v1 (registry, required reports, reason → level, limits) | New `scripts/ai/gate-policy.mjs` and tests | S0-B |
| S3 | Aggregator and occurrence trace | New `scripts/ai/gate-decision.mjs` and tests | S0-B, S1, S2, C5 design |
| S4 | CI integration of new suites | `.github/workflows/test.yml` (GOVERNANCE) | S1–S3 |
| S5 | Shadow evaluation on fixtures | `.github/workflows/test.yml` | S4, OD-B7 |

## Test strategy

Proposed test categories (none implemented):

- **Valid input:** a complete fixture yields PASS only when every requirement is met.
- **Missing, stale or conflicting inputs:** missing reports or checks; STALE approvals; old or mixed
  SHAs; duplicate reports, jobs, runs or snapshot entries.
- **Malformed bytes:** invalid JSON, duplicate keys, reserved keys, size limits (ADR-AI-007).
- **Accessors and Proxies:** the aggregator accepts bytes and frozen trusted context only; accessor
  or Proxy context fails closed without invoking producer code.
- **Determinism and mutation resistance:** permuted inputs give identical output; inputs modified
  after the call do not change the result.
- **Approval stages:** each stage A failure; third-party commands ignored; edited command parsing →
  FAIL unless another VERIFIED exists; edited non-command ignored; recovery by a new command;
  capacity above 10; `CONTEXT_MISMATCH` after stage A.
- **Slot binding (S-H):** candidate matching a head blob is assigned and verified; candidate for a
  previous head blob or an unrelated blob is not verified and leaves the slot pending; command for
  a type without a slot causes no ERROR; one VERIFIED plus one INVALID candidate satisfies the
  slot; identical migration blobs without approval → both pending; with one or several matching
  approvals → both fail via `E_APPROVAL_SCOPE_AMBIGUOUS`, never VERIFIED.
- **Decision projection:** one entry per distinct non-PASS code; `detail` of the worst-case length
  accepted by the schema and one character more rejected; extra fields rejected; ASCII only; PASS
  as a single `trace=<run_id>` entry; `n=` equals the layer-1 count and `first=` the smallest
  subject.
- **Diagnostic ledger — A. independent violation identity:** one path violating several scope
  rules; several failing EvidenceRefs of one requirement (separate subjects); two findings at
  different array positions remain distinct by source locator (whatever their `finding_id`); jobs
  sharing a display name keep distinct trusted job ids; many candidates for one slot; same code and
  subject with different rules or locators; source text never copied; flattening the ledger
  reconstructs the violation set losslessly.
- **Diagnostic ledger — B. duplicates already rejected by accepted contracts:** duplicate JSON
  keys; two artifacts of the same type; duplicate TaskSpec ids (`BR-ID-UNIQUE`); `uniqueItems`
  violations; duplicate trusted snapshot entries; several jobs with one display name in a run —
  each rejected as listed under Duplicate records, with every duplicate locator recorded.
- **Diagnostic ledger — C. proposed duplicate rules (not enforced):** duplicate ImplementationReport
  requirement rows and duplicate `finding_id` values within one review report. Tests that assert a
  rejection outcome for these cases are written only after a separate owner policy decision before
  S3 (S0A6.1-D3); until then no test or implementation treats them as enforced.
- **Spec identity:** each OD-B4 branch, including rename with renewed approval.
- **CI completeness:** v1 snapshot with a missing job → ERROR; v2 fixtures for `MISSING_CHECK`,
  `skipped`, `neutral`, `cancelled`, `action_required`, `failure`, `timed_out`.
- **Occurrence bound:** worst-case inputs for every G1–G7 term; property tests that N never exceeds
  the bound; overflow fails closed.
- **Publication:** crash between stages, stale attempts, forged completion markers, missing trace,
  digest mismatch, boundary-size payloads.
- **Evaluation failure:** overflow, unrepresentable `COUNT` or identifier, non-ASCII `detail` and
  internal inconsistency each produce no authoritative artifact and no fabricated ERROR decision;
  partial artifacts are rejected by consumers.
- **`COUNT` boundaries (before S3):** 0 encoded as `0`; 1; `Number.MAX_SAFE_INTEGER` encoded as
  `9007199254740991` and accepted by the schema in a worst-case `detail` of 254 characters; a
  count above the safe-integer range → evaluation failure; no leading zeros, no exponent, sign or
  separators.
- **`KIND` registry:** every registered token matches the KIND grammar and has at most 16
  characters; an unknown `KIND` → evaluation failure; the registry is read from the trusted policy
  revision, not from the evaluated head.
- **Ledger mapping:** every violation appears in exactly one group; flattening is reproducible;
  each `rule_id` maps to one code; projection equals the layer-1 occurrence set.
- **No side effects and shadow-only non-authority.**
- **Windows/Linux parity.**

## Security and rollout

- No production enforcement.
- No PR-head self-authorization (ADR-AI-008).
- No automatic GitHub or Cloudflare mutation; no status, comment, approval or deployment action.
- No migration; a migration approval never authorizes running a migration.
- No automatic human approval; agents never create, post, edit or delete approval commands
  (CLAUDE.md §G; ADR-AI-011).
- No implicit promotion from shadow to enforcement.
- No inferred approval: a VERIFIED approval comes only from an assigned candidate verified by the
  ADR-AI-011 verifier; ambiguous candidates are never VERIFIED.
- Fail closed: any limit overflow or unrepresentable value is an evaluation failure; no
  authoritative decision, trace or completion marker is issued and no ERROR decision is fabricated;
  no truncation; a missing, corrupt, partial or mismatched trace or manifest prevents
  authoritative consumption.
- No source values in diagnostics: `detail` and ledger entries hold only grammar-constrained
  identifiers, locators, rule ids, digests and `E_*` codes.
- Shared owner account remains an accepted HIGH residual risk (ADR-AI-011, Residual risks).

## Consequences

**Authorization boundary (SB-4).** Acceptance of ADR-AI-012 establishes design authority only. It
does not authorize S1–S5, CI changes, publication, enforcement, commit, push, merge, deploy,
migration or production actions. Every mutation requires separate owner authorization.

**SB-1 (APPROVED_IN_CONVERSATION — CONDITIONAL; prerequisites met).** The owner supported
accepting this ADR as a design decision only after S0-A.6.3 was completed, the revised ADR passed
independent review, and the owner separately authorized S0-B acceptance. These prerequisites were
met (S0-A.6.3; independent review with notes; S0-B.1 authorization), and the owner accepted the ADR
on 2026-10-14 (D-01).

With acceptance: recorded decisions are the design basis against which separately authorized
slices may later be proposed; the ADR-AI-011 clarification is in effect for gate aggregation
(SB-2); CONDITIONAL decisions remain subject to their conditions; PROPOSED details and OPEN
decisions keep their status; and the open conditions and controlled deferrals are explicit
obligations. No aggregation code is written until a slice is separately authorized.

## Alternatives considered

- Implementing directly from conversation-level designs — excluded by ADR-AI-001 (accepted).
- A GateDecision schema change in V1 — excluded by ADR-AI-010 D23 (accepted).
- Silent truncation beyond 100 reasons — excluded by ADR-AI-005 ("lists all reasons", accepted).
- Per-code aggregation as the only traceability mechanism, or forcing ERROR on overflow — not
  selected (R2-B selected in conversation).
- Treating unavailable approval context as pending (keeping ADR-AI-011 wording unchanged) — not
  selected (R1-B selected in conversation).
- Verifying all comments before filtering — not selected: third-party comments would yield INVALID
  results and allow forced FAIL.
- Failing on any INVALID approval regardless of slot — not selected: an owner edit would cause a
  permanent FAIL.
- Treating migration deletion or rename as `SCOPE_VIOLATION` — not selected: no accepted migration
  policy exists.
- Verifying unassigned approval candidates — not selected: commands for types without a slot would
  yield `E_APPROVAL_OBJECT_PATH_UNKNOWN` and an ERROR caused by the owner's own comment.
- Inferring approvals from base blobs or earlier history — not selected: no historical identity is
  invented.
- Truncated hashes in `detail` — not selected: short prefixes can be collided deliberately.
- Count-plus-first-entry compaction in the ledger — rejected: it loses independent violations
  (P3-b).
- Deduplicating invalid duplicate input records — rejected: duplicates are rejected with all their
  locators (P3-c).
- Step-level check identities — open alternative under OD-B1 (requires a CI snapshot that binds
  steps and a workflow change).

## Reversibility

Medium. As an accepted ADR, it changes only through a superseding ADR under the ADR conventions;
CONDITIONAL, PROPOSED and OPEN items are resolved by later owner decisions recorded in the
repository.

## Acceptance checklist

State at acceptance on 2026-10-14. A checked item is complete; an unchecked item records an
accepted deferral or a decision that remains OPEN.

Completed:

- [x] D-01: this ADR accepted as a design decision (S0-B.1).
- [x] Owner-confirmed APPROVED_IN_CONVERSATION items accepted as design authority (R1-B, R2-B,
      D-04, OD-B4 rename rule, D-07, OD-B5 stages and rules, S0A5-2, P1-b, P2-a, P2-b, S0A5-3,
      P3-a, P3-b, P3-f, S0A6.1-D3, SB-2, SB-4, publication principle).
- [x] ADR-AI-011 clarification (R1-B) in effect; ADR-AI-011 status line and the ADR index annotated
      for the partial supersession (SB-2, S0-B.1).
- [x] Independent review of the S0-A.6.3 revision completed, with notes (SB-1).
- [x] Separate owner authorization for S0-B.1 (local documentation acceptance) recorded.

Accepted only with conditions (still subject to C1–C6 and the conditions stated in this ADR):

- [ ] OD-B3 and OD-B6 (C2, C3, C4).
- [ ] S0A5-1, P1-a, P3-c, P3-d, P3-e, S0A6.1-D1, S0A6.1-D2 (KIND registry principle), SB-3, SB-5.

Remaining OPEN or deferred (not decided by this acceptance):

- [ ] Exact KIND registry entries and character set — unresolved until S3.
- [ ] New duplicate rules for ImplementationReport requirement rows and `finding_id` within a
      report — OPEN until a separate owner decision before S3.
- [ ] Numeric limits — no cap for P, J, c, trace bytes, ledger entries or memory is approved;
      re-derivation under C4.
- [ ] D-05 / OD-B1, D-06, OD-B2 — deferred to before S2.
- [ ] D-08 — deferred to before S1.
- [ ] OD-B7 — deferred to before S4/S5.
- [ ] OD-B8 — open; enforcement remains BLOCKED.
- [ ] D-09 — outside A3.6.
- [ ] F6, F8, F9 — unresolved and deferred (SB-5); source text UNVERIFIED; none closed.
- [ ] C1–C6 — open conditions (the R1-B clarification part of C6 is in effect; the rest is open).

Not authorized by this acceptance:

- S0-B.2 Git operations (staging, commit, push, pull request) for these documents.
- S1–S5 and any CI change.
- Enforcement, merge to `main` and production, which remain BLOCKED.

## References

- [ADR-AI-001](ADR-AI-001-github-system-of-record.md), [ADR-AI-003](ADR-AI-003-human-production-authority.md),
  [ADR-AI-005](ADR-AI-005-deterministic-sha-bound-gates.md), [ADR-AI-006](ADR-AI-006-human-approval-evidence.md),
  [ADR-AI-007](ADR-AI-007-contract-input-parsing.md), [ADR-AI-008](ADR-AI-008-taskspec-scope-classes-and-authority.md),
  [ADR-AI-009](ADR-AI-009-taskspec-composition-and-secret-scan.md),
  [ADR-AI-010](ADR-AI-010-evidence-approval-verification-and-path-safety.md), [ADR-AI-011](ADR-AI-011-approval-verification.md)
- [Contracts README](../contracts/README.md);
  [`gate-decision.schema.json`](../contracts/schemas/v1/gate-decision.schema.json)
- [`scripts/ai/verify-evidence.mjs`](../../../scripts/ai/verify-evidence.mjs),
  [`scripts/ai/verify-approval.mjs`](../../../scripts/ai/verify-approval.mjs),
  [`scripts/ai/git-object.mjs`](../../../scripts/ai/git-object.mjs),
  [`scripts/ai/validate-contract.mjs`](../../../scripts/ai/validate-contract.mjs),
  [`.github/workflows/test.yml`](../../../.github/workflows/test.yml)
