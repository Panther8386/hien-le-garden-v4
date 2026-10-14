# ADR-AI-002: Deterministic gates outrank AI judgments

- Status: Accepted
- Date: 2026-10-01
- Deciders: Vĩnh (owner)

## Context

The platform will add AI reviewers and agents next to existing deterministic checks
(`.github/workflows/test.yml`: build, `check:dist` boundary + self-test, probe self-test,
staging-binding guard, tests). AI output is probabilistic and can be wrong or manipulated
(e.g. by injected text). Deterministic checks encode hard requirements, such as keeping private
files out of the published artifact.

## Decision

**A required deterministic FAIL can never be converted into PASS by an AI agent.**

Deterministic gates include, for example:

- build;
- tests;
- artifact boundary (`check:dist`);
- schema validation;
- permission tests;
- migration safety checks.

AI may explain, triage or propose fixes for a failure. It cannot waive, skip, mark as flaky,
downgrade, or reinterpret a required check as passing. Only a fix that makes the check pass,
or a human-approved, reviewed change to the check itself, resolves a failure.

AI findings may *add* blocking conditions; they never *remove* deterministic ones.

## Consequences

- Gate decisions are ordered: deterministic results first; AI findings only on top.
- Agents must not edit tests or checks to make them pass without that change being in approved scope.
- Retries of a failing check are bounded and do not change its verdict.

## Security implications

- Prevents prompt injection or model error from bypassing security-relevant checks
  (artifact boundary, permissions, migrations).
- Changes to the checks themselves are security-sensitive and require human review.

## Alternatives considered

- AI may override "low-risk" failures — rejected: the risk classification itself would be AI judgment.
- Equal weighting of AI and deterministic results — rejected for the same reason.

## Reversibility

Medium. Relaxing this rule would require a superseding ADR approved by the owner.
