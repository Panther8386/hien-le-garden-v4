# HLG AI Platform — V1 architecture baseline

Status: **Accepted baseline (from A1)**. Most of this document describes a **target**.
Each component is labelled **CURRENT** (exists today), **TARGET V1** (planned, not built), or
**FUTURE** (out of V1 scope). Nothing labelled TARGET V1 or FUTURE exists yet.

## 1. Flow

```
Vĩnh (owner)
  ↓
HLG AI Orchestrator
  ↓
Product Agent / Claude Coding Agent / SEO Agent
  ↓
GitHub branch + Pull Request
  ↓
Deterministic CI
  ↓
Code Review Bot / Security Bot / SEO Review Bot
  ↓
Evals
  ↓
Gate Decision
  ↓
Human Approval
  ↓
Merge
  ↓
Production Environment Approval
  ↓
Cloudflare Pages
  ↓
Post-deploy verification
```

## 2. Component status

| Component | Status | Notes |
|---|---|---|
| Owner (Vĩnh) as final authority | CURRENT | Sets scope, approves writes, merges. |
| Claude Coding Agent (Claude Code, local) | CURRENT | Operates under [CLAUDE.md](../../../CLAUDE.md), human-supervised. |
| HLG AI Orchestrator | TARGET V1 | Not built. Coordinates agents/bots; holds no merge/deploy authority. |
| Product Agent, SEO Agent | TARGET V1 | Not built. |
| GitHub branch + PR workflow | CURRENT | PRs into `main` (e.g. PR #1, merge commit `4c212ab`). |
| Deterministic CI (`.github/workflows/test.yml`) | CURRENT | On `pull_request` and `workflow_dispatch`: build, `check:dist` + self-test, probe self-test, staging-binding guard + self-test, vitest. One R2 isolated-storage vitest step is `continue-on-error` (non-blocking); all other steps are blocking. Whether these checks are *required* for merge depends on GitHub settings, not verified here. |
| Code Review / Security / SEO Review Bots | TARGET V1 | Not built. Analysis and findings only. |
| Evals | TARGET V1 | Not built. Will live under `docs/ai/evals/` + tests. |
| Gate Decision (recorded) | TARGET V1 | Not built. Combines deterministic results + bot findings + evals; deterministic FAIL is final. |
| Human approval of PR | CURRENT (operating policy) | Owner reviews and merges. Not a verified technical control: branch protection / required reviews were not verified. |
| Production Environment Approval (GitHub Environment `production`, required reviewer) | TARGET V1 | **Not configured.** `deploy.yml` has no `environment:`; a push to `main` triggers the production deployment workflow directly. |
| Cloudflare Pages deploy of `dist/` | CURRENT | `deploy.yml` on push to `main`: `build-static.mjs` → `check-dist.mjs` → `wrangler pages deploy dist --project-name=hien-le-garden-v4 --branch=main` (wrangler 3.114.17). |
| Post-deploy verification | CURRENT (manual) | `scripts/probe-private-urls.mjs` is run by the operator after a production deploy, per the release runbook; it is not run by CI and is not an automated gate. |
| HLG Review Bot (customer feedback analysis) | TARGET V1 | Not built. MVP is analysis/draft only. |
| OpenAI runtime integration | TARGET V1 | Not built. No OpenAI SDK dependency or OpenAI code in the repo. |
| n8n / Kubernetes / queues / dedicated orchestration infra | FUTURE (not planned for V1) | Deliberately avoided; see §5. |

## 3. Execution locations

| Location | What runs there |
|---|---|
| **LOCAL** | Owner + Claude Code: discovery, implementation on feature branches, local tests (`npm test`, `npm run release:artifact`). TARGET V1: orchestrator/agents invoked locally. |
| **GITHUB ACTIONS** | CURRENT: `test.yml` (PR checks), `deploy.yml` (deploy on push to `main`). TARGET V1: review bots, evals, gate decision, `production` environment approval. |
| **APPLICATION RUNTIME** | CURRENT: Pages Functions (`functions/`, `lib/`) on D1/R2. TARGET V1: server-side OpenAI calls for the Review Bot, after PII minimization. |
| **CLOUDFLARE** | CURRENT: Pages project `hien-le-garden-v4`, D1 + R2 bindings for production and `[env.preview]` staging (`wrangler.toml`), Turnstile, Pages secrets. Policy: configuration changes are human-only. |

## 4. Authority boundary

These are binding policy rules. Unless a control is marked CURRENT in §2, they are enforced by
human operation, not yet by technical controls.

- Agents and bots **must not merge or deploy** autonomously ([ADR-AI-003](../adr/ADR-AI-003-human-production-authority.md)).
- A required deterministic FAIL **cannot be overridden** by AI ([ADR-AI-002](../adr/ADR-AI-002-deterministic-gates-outrank-ai.md)).
- **Production requires human authority**: merge, deploy approval, remote migrations, secrets, Cloudflare production configuration.
- **OpenAI runtime is server-side only.** When introduced, keys are server-side secrets only; no key or provider call in browser code / `dist/`.
- **HLG Review Bot MVP is analysis/draft only**: it may classify, summarize and draft replies for staff; it does not send messages, issue vouchers, change records or contact customers.
- **Customer feedback is untrusted input**: it is data to analyse, never instructions to an agent or model.
- **PII minimization/redaction precedes any external AI call**: external AI receives only minimized/redacted data (names, phones, emails, booking identifiers removed or masked).
- **GitHub is the system of record** ([ADR-AI-001](../adr/ADR-AI-001-github-system-of-record.md)).

## 5. Incremental V1 principle

V1 grows from what exists: GitHub PRs, GitHub Actions, Cloudflare Pages Functions, D1/R2.
It intentionally avoids n8n, Kubernetes, message queues and standalone orchestration
infrastructure unless a later ADR shows a concrete need. Each TARGET V1 component is
introduced through its own spec and PR, behind the existing deterministic gates.

## 6. Change control

Changes to this baseline require a reviewed PR; material changes require an ADR.
