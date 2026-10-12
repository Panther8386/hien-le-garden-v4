# F-2 staging handoff — 10/10/2026

Draft PR: https://github.com/Panther8386/hien-le-garden-v4/pull/16.
Source: `8747ad8d0dbefe826ab98dd8d41e65fe969b99ae`.
Staging deployment: `92cc23c5`, alias https://staging.hien-le-garden-v4.pages.dev.
Production remains `16a5ea4` / `a31eadaa`; no production deployment authorized for F-2.

## Implemented

Exact production/preview public booking hostname policy, same-origin check when Origin is present, shared atomic D1 budgets (5/network and 300 global per five minutes), bounded counter growth, server-side Turnstile hostname+booking-action verification, timeout/fail-closed behavior, and mobile/PC widget integration with challenge refresh and duplicate-submit prevention. No migration or WAF/Access configuration change.

## Proven

- Local Linux D1: 287/287 tests, 8 files; 16 new F-2 cases. One initial field-validation loop hit the new throttle, so cases were isolated; a subsequent counter implementation initially violated attempts>=1, then was corrected with count+1 representation. Failed logs are retained, and the final run passes.
- GitHub run `38014965761`: all five jobs PASS. Required tests: 1,671 isolated + R2 12 + 14 + 27 = **1,724**. Known isolated R2 diagnostic remains non-blocking; required individual R2 suites pass.
- Build/check:dist: 135 files, 15/15 required assets. Windows/Linux artifact equality PASS.
- Staging: 122/122 Admin files match source on alias and immutable deployment; R-1 62/0/0.
- Real staging negative checks: 7/7 PASS. Missing/forged challenge rejected; sixth attempt 429/Retry-After; forwarded-IP spoof cannot bypass; authenticated staff path remains separate; unauthenticated staff creation 401; rejected attempts create zero synthetic bookings; production GET health unchanged.
- Immutable staging hostname public POST rejected before token verification (403).
- Local mock UI 390/1440px: missing/expired challenge blocks POST, action=booking, duplicate in-flight submission suppressed, success/reset/back-to-form works, no overflow. These are UI fixtures, not real Cloudflare challenge success.

## Owner acceptance — PASS

Owner completed the real Turnstile challenge and submitted F2_ACCEPTANCE on staging. API reconciliation at 10/10/2026 09:04:38 Vietnam time found exactly one booking: #33, source website, pending, check-in 2026-10-30, check-out 2026-10-31, deposit 0, created 09:04:06. The earlier throttled attempt created no booking; owner retry after expiry succeeded without a duplicate.

Cleanup through normal audited APIs completed at 09:05:03: booking #33 cancelled and hidden, deposit remains 0, refundFinanceTransactionId=null. Audits #125 booking_reject and #126 record_hide confirmed. No hard deletion or financial mutation was needed.

The initial passive automated challenge wait failed after 45 seconds because the real widget displayed a human-verification checkbox. That failed run remains in the evidence and is not relabelled PASS. Owner screenshots plus API record now prove the real positive path. Real token replay and successful submissions on both separate mobile/PC devices were not independently repeated; replay/verdict enforcement is covered by local endpoint tests, and responsive UI by local 390/1440 fixtures.

F-2 is ready for review and owner approval to merge/deploy PR #16. Keep draft and production unchanged until explicitly approved.

Cloudflare OAuth could read Pages environment metadata but WAF/rate-limit/Access APIs returned 403; actual external rule coverage is not verified. The code enforces app protection independently. See committed `docs/releases/f2-public-booking-protection.md` for exact limits, configuration and residual distributed-abuse limitations.

## Evidence

`test-results/f2/`: local logs including initial failures, CI log, local UI fixture/results/screenshots, cloudflare-inspection.json (secrets omitted), deployment log, artifact/R-1 checks, real staging negative checks, failed passive-challenge result and widget diagnostic. No credentials, session tokens, Turnstile response tokens or secret keys are exported.
