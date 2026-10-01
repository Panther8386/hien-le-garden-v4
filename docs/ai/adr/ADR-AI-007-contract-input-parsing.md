# ADR-AI-007: Contract input parsing

- Status: Accepted
- Date: 2026-10-01
- Deciders: Vĩnh (owner)
- Supersedes: the parse-layer rules of [ADR-AI-004](ADR-AI-004-machine-readable-engineering-contracts.md)

## Context

[ADR-AI-004](ADR-AI-004-machine-readable-engineering-contracts.md) described the first pipeline
layer as "JSON parse (byte cap before parse; canonical bytes, so duplicate keys are rejected)".
The A3.0 design also listed a reserved-key rejection (`__proto__`, `constructor`, `prototype`) and
a 256 KiB byte cap.

Before implementing the parser, these rules were re-examined against the committed V1 schemas
and the actual behaviour of Node's `JSON.parse` and Ajv 8.20.0 (probed during design review A3.3b-PRE):

- `JSON.parse` silently keeps the **last** value of a duplicated key, including keys that are
  only equal after escape decoding (`"a"` and `"\u0061"`). A reviver sees only the surviving value.
- `JSON.parse` stores `__proto__` as an ordinary own property and never changes the prototype.
  The closed V1 schemas (`additionalProperties: false` at every object layer) already reject
  `__proto__`, `constructor` and `prototype` wherever they appear. The real hazards are copying
  unvalidated data with `Object.assign` (which does change the prototype) and looking up
  dispatch tables on plain objects (where `"constructor"` resolves through the prototype).
- Requiring canonical bytes (`JSON.stringify(value, null, 2) + "\n"`) would reject valid,
  equivalent JSON (indentation, key order, escapes, CRLF), including hand-written TaskSpec
  blocks. Its only security purpose was duplicate-key detection.
- A schema-valid review report can approach about 1.7 MB, so a 256 KiB or 1 MiB cap would
  contradict the space the V1 schemas permit.

## Decision

The current parse-layer rules for engineering contract input are:

1. **Size:** `MAX_ARTIFACT_BYTES = 2,097,152` (2 MiB), checked on the byte length **before**
   decoding or parsing. This cap is independent of the schema bounds.
2. **Encoding:** UTF-8 only, decoded with a fatal decoder. Rejected: a UTF-8 byte-order mark
   (`EF BB BF`), any raw NUL byte, invalid UTF-8 (which also covers UTF-16 input).
3. **Parsing:** the native `JSON.parse`. Malformed JSON and trailing data are rejected.
4. **Duplicate keys remain forbidden.** They are detected explicitly from the decoded JSON text,
   after a successful parse, by comparing each object's keys as decoded by `JSON.parse`
   (escaped-equivalent keys collide; the same key in sibling objects is allowed).
5. **No canonical byte requirement.** Equivalent valid JSON formatting is accepted. Hashing or
   signing, where needed later, uses the original bytes at the evidence/approval layers.
6. **Reserved names are not globally banned.** Unexpected property names, including
   `__proto__`, `constructor` and `prototype`, are rejected by the closed schemas. Code
   invariants: schema dispatch uses a `Map`; `schema_version` and `artifact_type` are read with
   `Object.hasOwn`; unvalidated artifact data is never copied or merged (no `Object.assign`,
   no deep merge) before schema validation succeeds.
7. **Root object:** a non-null, non-array object whose prototype is `Object.prototype` or `null`.

The parser and validator establish structural validity only. They are **not** authority for SHA
freshness, evidence truth, approval authenticity or gate decisions
([ADR-AI-005](ADR-AI-005-deterministic-sha-bound-gates.md),
[ADR-AI-006](ADR-AI-006-human-approval-evidence.md)).

## Consequences

- One additional component: a small duplicate-key scanner run after `JSON.parse`.
- Producers may format JSON freely; only content and structure matter.
- Failure codes for this layer: `E_TOO_LARGE`, `E_ENCODING`, `E_JSON_PARSE`, `E_DUPLICATE_KEY`,
  `E_NOT_OBJECT`. There is no `E_NON_CANONICAL` and no `E_FORBIDDEN_KEY`.

## Security implications

- Duplicate-key ambiguity between what a human reviews and what a machine enforces is rejected.
- Prototype-related keys cannot pass validation; the copying and dispatch invariants close the
  remaining hazards.
- Silent decoding fallbacks (BOM stripping, replacement characters) cannot change the meaning
  of input.

## Alternatives considered

- Canonical byte equality — rejected (false rejections; duplicate detection solved directly).
- Global reserved-key scanner — rejected (redundant with closed schemas).
- A dedicated strict JSON parser package — rejected (new dependency for a problem solved by a
  small scanner over already-validated JSON).
- Smaller byte caps (256 KiB, 1 MiB) — rejected (contradict the V1 schema space).

## Reversibility

High. The rules are local to the validator; a superseding ADR can change them.
