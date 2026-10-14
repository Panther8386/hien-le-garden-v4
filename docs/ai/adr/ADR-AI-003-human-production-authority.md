# ADR-AI-003: Human authority is required for production

- Status: Accepted
- Date: 2026-10-01
- Deciders: Vĩnh (owner)

## Context

Production for Hiền Lê Garden is the Cloudflare Pages project `hien-le-garden-v4` with its
production D1 database and R2 bucket, serving real guests and staff. Repository evidence:
`.github/workflows/deploy.yml` triggers the production deployment on every push to `main` and
defines no approval step, so merging into `main` is effectively the production release action. AI agents will increasingly prepare
changes, and a wrong autonomous action here is customer-facing and may be irreversible
(data, messages, vouchers).

## Decision

No agent may autonomously:

- merge to `main`;
- approve a production deployment;
- run a production (remote) migration;
- change production secrets;
- change Cloudflare production configuration;
- perform any irreversible or customer-facing action.

These require an explicit human decision by the owner (or a human the owner delegates to).
Agents may prepare, verify and recommend; humans authorize.

### V1 intention (TARGET, not yet configured)

A GitHub Environment named `production` with a required human reviewer will gate the deploy
job, separating "merge" from "deploy to production".

**This control does not exist today.** Until it is configured, production authority rests on
operating policy: humans retain authority over merging to `main`, and agents must treat merging
as a production action. This ADR does not claim any branch protection, required review or
Environment approval is technically enforced; none has been verified.

## Consequences

- Agent workflows stop at "PR ready + evidence"; humans merge.
- Configuring the `production` environment is a future, human-performed GitHub settings change.
- Slower than full automation; accepted for a small business with real customers.

## Security implications

- Limits blast radius of agent error, prompt injection or credential misuse.
- Agent credentials (when introduced) must not carry merge, deploy-approval or production
  configuration permissions.

## Alternatives considered

- Autonomous merge after green checks — rejected: customer-facing risk, no human checkpoint.
- Autonomous deploy with automatic rollback — rejected for V1: D1/R2 writes and sent messages
  are not rolled back by redeploying code.

## Reversibility

Medium. Delegating specific low-risk actions later would need a superseding ADR with explicit scope.
