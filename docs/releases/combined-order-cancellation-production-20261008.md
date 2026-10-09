# Production handoff — 2026-10-08

Owner approved release of PR #9 and #10 in this conversation.

## Version and deployment

- Production main: `73048e8afa0796182bd46610075636ecd029c243`.
- Deployment: `96fc08e6-010d-4b05-9365-d99dd238199e`, https://96fc08e6.hien-le-garden-v4.pages.dev .
- Domain: https://hienlegarden.vn .
- Tested combined source: `819e45475ec430d27c6e487a3afd4f696d49d94b`; `git diff origin/main HEAD` is empty (identical trees).
- PR #9 merged at `09fde55a70fc42768527010cdfb20f75d94dee50`, then PR #10 merged at the production SHA above. Both merge decisions checked exact source SHAs, required checks and expected main SHA.
- Migration `0043_booking_cancellation_origin.sql` applied successfully to production before either deployment; no pending migrations remain.
- Final deployment workflow run `37746068356` succeeded. Intermediate PR #9 deployment workflow `37745880416` succeeded before final release.
- Previous known production `9bcd7349` / `babe39d` and older `76b21a60` remain listed for rollback. Additive nullable migration is compatible with prior code; no schema reversal was performed.

## Released behavior

- Completed dine-in orders show paid/ended when their linked confirmed/paid income receipt matches the order total and is not voided. Other closed orders require payment reconciliation. History includes payment method and closure timestamp; detail and print show payment status.
- Hotel rejection of a pending booking refunds 100% of its deposit regardless of customer cancellation tiers.
- Guest-requested cancellation of pending or confirmed bookings uses the configured policy, based on the received calendar date in Vietnam time (UTC+7).
- Admin captures reason, phone/Zalo/in-person contact source and request received time. History includes origin, reason, received time and processing actor. Original deposit income is retained and a refund expense is created atomically when needed.
- Existing confirmed-booking API clients without request metadata remain compatible: current processing time and unknown source are recorded. New UI supplies the full record. No customer self-service flow or outbound messaging added.
- No backfill or automatic additional refunds for previously cancelled bookings. No production business records were mutated by verification.

## Evidence

- Combined Linux gate: 81 files / 1,575 tests + R2 suites 12 + 14 + 27 = **1,628 passed**. Migration diagnostic 79/79 is included in isolated suite total.
- Combined GitHub CI run `37745152385`: test and Release artifact boundary (R-1) passed.
- Build/dist boundary passed (135 files). Four-role / three-width Admin regression checks passed.
- Live staging: five original cancellation scenarios verified through UI and ledger (hotel 100%; guest pending 0/50/100%; confirmed guest 50%). Combined staging read-only checks confirmed those records and both booking/order UI at 390px and 1440px. See cancellation-origin and combined-release evidence folders.
- After final production deployment, **61/61 Admin files** match production main byte-for-byte on both the main domain and immutable deployment.
- R-1 post-deploy probe: **PASS=62, FAIL=0, INCONCLUSIVE=0**. Three new private source paths were checked separately on both hosts and remained unavailable (SPA fallback).
- Production health: `/` 200, `/admin/login` 200, `/api/public-config` 200, unauthenticated `/api/auth/me` 401.
- Production login renders at 390px and 1440px without overflow or runtime errors. No production login or synthetic booking/payment mutation was used for acceptance.
- Policy remains >=7 days 100%, >=3 days 50%. Below the configured minimum defaults to 0%.
- Read-only production reconciliation: orders 6/7/8 remain closed, receipts 229/245/246 match 70,000/130,000/160,000 VND; no receipt is voided. Query records zero rows written.
- Final production verification finished `2026-10-08T07:56:21.390Z`.

Machine-readable logs/results and screenshots: `test-results/combined-release/`. No passwords, session tokens or local credential files are part of the handoff package.

## Remaining items outside this release

SEC-1 recovery drill, production admin 2FA, login rate limiting, flaky 2FA test, tab scrolling and CRLF/LF normalization remain separate work. Staging has explicitly named synthetic test records; booking #19 remained pending after an initial stale-list test script failure. Cleanup remains separate from production release. D4B.4 already returned 404 after its 24-hour threshold; this release did not modify deleted deployments.
