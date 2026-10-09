# Booking cancellation origin — staging handoff

Source: `f6dd14d7d8b7ca5fd740fd745b09027da1e87ce3`.
PR: https://github.com/Panther8386/hien-le-garden-v4/pull/10 (draft, unmerged).
Deployment: https://693fa1cb.hien-le-garden-v4.pages.dev

## Approved behavior

- Hotel rejects a pending booking: refund 100% of its deposit, independent of cancellation tiers.
- Guest requests cancellation: staff records the request through Admin for pending or confirmed bookings. Refund uses configured tiers and the received calendar date in Vietnam (UTC+7), not the processing date.
- UI collects reason, contact source (phone/Zalo/in person) and received timestamp, previews the refund and requires a refund payment method when needed.
- Persist origin, source, received timestamp, processing timestamp and actor. History shows the request record and applied refund percentage. Existing atomic refund/booking/audit batch and duplicate protection remain.
- No customer self-service cancellation or outbound messaging added. Confirmed-booking API callers without request metadata remain compatible: processing time is used and source is recorded as unknown. New UI always supplies metadata. Existing cancelled bookings are not reinterpreted or refunded automatically.

## Validation

- Linux: 81 files / 1,568 isolated tests; R2 suites 12+14+27; total 1,621 passed.
- Migration diagnostic 79/79 passed (already included in isolated total). Migration 0043 applied only to staging.
- Build and dist boundary passed (135 files). Admin responsive shell checks passed on the initial implementation; final five live UI cancellation scenarios passed on the source SHA above.
- Live staging UI: hotel rejection at two days refunded 50,000/50,000; guest request at two/four/eight days refunded 0/25,000/50,000. Widths 390 and 1440px covered. Ledger transactions matched and duplicate requests were rejected.
- Confirmed guest booking #24 cancelled via UI at four days: 25,000 refund and complete history verified.
- Unit coverage includes guest pending 7/3-day boundaries, delayed processing, Vietnam midnight, invalid/future/pre-booking timestamps and source, duplicate cancellation; existing races and audit rollback tests pass.
- GitHub CI run 37744417632: test and Release artifact boundary (R-1) both passed on first attempt.

Evidence: `test-results/cancellation-origin/` (logs, UI screenshots, live results and CI results).

## Test data and limitations

Synthetic staging bookings #18–#24 were created. #19 remains pending with a 50,000 synthetic deposit after the first script attempt failed to reload its list. That script failure was fixed (same-page navigation did not reload new data), and its evidence remains in live-cancellation-attempt1 files. Final four-scenario run used #20–#23 and passed. #18 and #20–#24 are cancelled. Production was not modified.

## Production release requirement

Apply migration `0043_booking_cancellation_origin.sql` to the verified production database **before** deploying this code: booking listing reads its new columns. Changes are nullable additions and compatible with old application code. Keep PR #9 (order display) as a separate reviewed change; this branch starts from production main `babe39d` and does not contain PR #9. Obtain owner release approval before merging/deploying. If both are released, resolve any overlapping reception code against the final merged source and validate that release candidate.
