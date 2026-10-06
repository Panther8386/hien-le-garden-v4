# ADR-AI-009: TaskSpec composition and secret-scan trust boundary

- Status: Accepted
- Date: 2026-10-06
- Deciders: Vĩnh (owner)

## Context

The TaskSpec layers exist as separate functions: lexical extraction
(`scripts/ai/extract-taskspec.mjs`, A3.4a), contract parsing and schema validation
(`scripts/ai/validate-contract.mjs`, [ADR-AI-007](ADR-AI-007-contract-input-parsing.md)),
business/path validation (`scripts/ai/taskspec-business.mjs`, A3.4b) and declaration policy
(`scripts/ai/taskspec-policy.mjs`, A3.4c, [ADR-AI-008](ADR-AI-008-taskspec-scope-classes-and-authority.md)).
No module composes them, and nothing scans the Markdown narrative for secrets.

The independent A3.4c security review left three findings open that this composition must
address:

- **F2 (MEDIUM):** policy trusts its precondition that the TaskSpec is business-valid. Called
  directly, it can pass input that business validation would reject.
- **F3 (MEDIUM):** the high-confidence `sk-` detector has demonstrated quadratic worst-case
  behaviour. Its exposure is limited today by schema string bounds (at most 2000 characters),
  but narrative scanning would apply it to the whole Markdown file.
- **F4 (LOW):** off-schema keys become relevant if schema validation is bypassed before policy.

Contract validation selects the schema from the `artifact_type` declared by the payload itself,
so a contract-valid payload is not necessarily a TaskSpec.

This ADR fixes the design of A3.4d before it is implemented. **Nothing in this ADR is implemented
yet**, and it does not remediate F2, F3 or F4.

## Decision

### 1. One supported entry point

- A3.4d consumers use **one supported TaskSpec composer**, expected as
  `scripts/ai/validate-taskspec.mjs` with a factory such as `createTaskSpecValidator(...)`
  returning `validateTaskSpecMarkdown(bytes, { fileName })`. Exact names and signatures are
  implementation work.
- The individual stage functions (business, policy and others) may stay exported for unit tests
  and internal implementation, but they are **not supported consumer entry points**.
- Future CI must enforce this import boundary.

### 2. Input representation

- The composer accepts raw **`Uint8Array`** only, not a string, so there is one representation
  of the input.
- It reuses the existing extractor byte/decode contract: maximum Markdown size
  **2,097,152 bytes** (`MAX_TASKSPEC_MARKDOWN_BYTES`), measured as `bytes.length` **before**
  decoding; no UTF-8 BOM; no NUL byte; fatal UTF-8 decoding.
- No new normalization: no newline, Unicode or whitespace normalization of the input.

### 3. Composition order and trust states

```
EXTRACT → SECRET_SCAN → CONTRACT → TYPE → BUSINESS → POLICY → RESULT
```

| After stage | Trust state established |
|---|---|
| EXTRACT | Bounded (≤ 2,097,152 bytes), valid UTF-8 Markdown without BOM or NUL, with exactly one TaskSpec block (payload bytes ≤ 1,048,576) |
| SECRET_SCAN | No high-confidence secret found in the complete Markdown |
| CONTRACT | Payload passes ADR-AI-007 parsing and the schema of the artifact type it declares |
| TYPE | The contract-valid artifact is a TaskSpec |
| BUSINESS | Business-valid TaskSpec (A3.4b) |
| POLICY | Policy-valid TaskSpec declaration (A3.4c, ADR-AI-008) |
| RESULT | Validation success only (see §10) |

TYPE is a required stage: CONTRACT chooses the schema from `artifact_type` supplied by the
payload, so contract-valid alone does not prove the artifact is a TaskSpec.

### 4. Secret-scan position

- SECRET_SCAN runs **after a successful EXTRACT and before CONTRACT**.
- Secret detection protects **every structurally extractable submission**, not only valid
  TaskSpecs. A contract, type, business or policy failure must not prevent detection of a secret
  already present in the submitted Markdown.
- EXTRACT stays first because it already establishes bounded bytes, valid encoding, the BOM/NUL
  constraints and a single TaskSpec block, which bounds the attack surface before scanning.

### 5. Whole-Markdown coverage

- SECRET_SCAN covers the **complete** successfully extracted Markdown artifact, including the
  raw text of the TaskSpec block.
- POLICY-level secret detection over parsed TaskSpec strings remains as **defense in depth**,
  including representations that only become detectable after JSON decoding (for example JSON
  escape sequences).
- No new secret formats are defined; detection stays high-confidence only (ADR-AI-008).

### 6. One shared detector

- A3.4d uses **one shared high-confidence secret detector**, expected as
  `scripts/ai/secret-detector.mjs`. Narrative scanning and TaskSpec policy scanning reuse the
  same detector semantics; there are no two diverging implementations.
- Import compatibility of `containsHighConfidenceSecret` from `taskspec-policy.mjs` is preserved
  where this does not weaken the trust boundary.

### 7. F3 complexity requirement

- The current `sk-` detector has demonstrated quadratic worst-case behaviour (repeated `sk-`
  prefixes in one token run make each attempt rescan the rest of the run).
- Requirement: **bounded, linear scanning** under the existing 2,097,152-byte bound.
- Preferred design: prefix search plus a deterministic token-run scan, rather than relying solely
  on the existing regex. Exact code belongs to A3.4d.2.
- Semantic compatibility with the existing high-confidence detector must be demonstrated by
  equivalence tests.

### 8. Fail closed

- Every stage is mandatory. A failure at a stage prevents every later stage:
  EXTRACT failure → nothing later runs; SECRET_SCAN failure → no CONTRACT/TYPE/BUSINESS/POLICY;
  CONTRACT failure → no TYPE/BUSINESS/POLICY; TYPE failure → no BUSINESS/POLICY;
  BUSINESS failure → no POLICY; POLICY failure → no successful result.
- No best-effort continuation, no partial PASS, no silent fallback. A thrown error is never a
  success.

### 9. Immutability

- The validated TaskSpec passed between security-sensitive stages must not be mutable by
  consumers between validation and use.
- Intended A3.4d implementation contract: the parsed TaskSpec is deep-frozen after TYPE, before
  BUSINESS.

### 10. Authority

- A composer PASS means only "passes deterministic TaskSpec validation". It grants **no**
  approval, merge authority, deployment authority or production mutation authority.
- Human approval (ADR-AI-006), human production authority (ADR-AI-003) and later gate
  aggregation (ADR-AI-005) are unchanged. Declaration ≠ approval ≠ execution authority
  (ADR-AI-008).

### Error safety

- Secret material never appears in errors: no value, fragment, matching line or narrative
  excerpt.
- Errors expose only safe location metadata and fit the existing error-envelope conventions
  (rule or code plus a safe location, deterministic order, bounded count).
- Output is deterministic for the same input.
- Exact narrative error aggregation (per-line reporting, sorting and caps) is finalized in the
  composer/security implementation slice, after the shared detector exists with equivalence
  evidence.

## Finding status

| Finding | Status |
|---|---|
| F2 | **OPEN** |
| F3 | **OPEN** |
| F4 | **OPEN** |

This ADR establishes the design needed to remediate them. Closure still requires
implementation, tests, an independent adversarial security review and Linux CI evidence on the
exact PR head.

## Consequences

- Consumers get one fail-closed path; direct stage calls are unsupported outside tests.
- Every extractable submission is scanned for secrets, including invalid TaskSpecs.
- The secret detector moves to one shared module; policy keeps its rules and import surface.
- The documented composition order in `docs/ai/specs/README.md` (extraction → schema → business
  → policy) is superseded by §3 and must be updated with the implementation.
- The composer, detector and their tests are GOVERNANCE scope (`scripts/ai/`, `test/ai/`).

## Security implications

- **Schema / business bypass (F2, F4):** to be addressed by mandatory ordering in one entry
  point plus a CI-enforced import boundary; direct calls remain possible in tests and are not
  supported. Both findings stay open until implemented and verified.
- **Algorithmic complexity (F3):** the input bound alone is insufficient (quadratic at 2 MiB);
  linear detection is required before narrative scanning ships. F3 stays open until
  implemented and verified.
- **Secret leakage through errors:** prevented by the error-safety rules above.
- **Residual:** a file rejected by EXTRACT (for example a malformed marker) is not scanned, so a
  secret in it is not reported although the file is rejected. Secrets in formats outside the
  high-confidence set are not detected (ADR-AI-008).
- The governance self-validation risk recorded in ADR-AI-008 is unchanged by this ADR.

## Compatibility

- Existing policy rules, error codes, ordering, the 20-error cap and the seven high-confidence
  secret formats are unchanged.
- The F1 trailing-dot rule (`BR-PATH-TRAILING-DOT`) and allowed/forbidden symmetry are unchanged.
- The existing five AI test suites must keep passing without weakened assertions.
- Any intentional semantic change to existing behaviour requires separate owner approval.

## Out of scope (later work)

- Common path safety for ImplementationReport, EvidenceRef and Finding paths: its trust boundary
  begins at **A3.5** and it is not designed here.
- ApprovalRef and SHA verification (A3.5); F6, F8 and F9 (A3.6/A3.7); gate aggregation;
  producer/verifier identity separation; GitHub integration authority; merge automation;
  deployment automation; a composer CLI.

## Alternatives considered

- Secret scan after POLICY — rejected: any earlier failure would hide a secret already present.
- Secret scan before EXTRACT — rejected: input would not yet be bounded and decoded.
- Accepting decoded strings as well as bytes — rejected: two representations, ambiguous size
  limits.
- Only a size bound for F3 — rejected: still quadratic at 2,097,152 bytes.
- Making stage functions private — rejected for now: breaks unit-level tests; a CI-enforced
  import boundary gives the same consumer guarantee.

## Reversibility

Medium. The order and boundary can be changed only by a reviewed change to GOVERNANCE scope and a
superseding ADR.
