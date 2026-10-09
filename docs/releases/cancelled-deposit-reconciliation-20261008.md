# Cancelled deposit reconciliation — 2026-10-08

Reviewed and continued from Claude's uncommitted branch `fix/deposit-delete-cancelled`, based on production `73048e8`.

Source commit: `e3d542b84e3fdc613388883556759a8aff6d06a9`.
PR: https://github.com/Panther8386/hien-le-garden-v4/pull/11 .
Staging: https://cb742bf8.hien-le-garden-v4.pages.dev .

## Review finding and resulting change

Claude's eligibility checks were retained: a cancelled booking can remove an active deposit only if its linked income receipt is already voided, no booking refund is linked and the caller has bookings.deposit_delete plus bookings.view. Hidden-record access remains enforced. Checked-out bookings, live/missing income receipts and refunded bookings remain blocked.

Independent review found the deposit void was committed before a separate batch updated total/audit. A later failure could leave a voided deposit and stale total. The endpoint now performs the guarded total decrement, deposit void, audit insert and optional receipt void in one atomic D1 batch. Each subsequent write is gated by changes() from the prior write. Guards recheck parent status, refund eligibility, active deposit, amount, finance link and sufficient total. Original income void metadata is preserved. No schema migration is needed.

Admin history shows remaining deposit and “Xoá cọc đã huỷ thu” when eligible. Live receipts and refunded bookings show why removal is blocked. Existing deposit deletion behavior for pending/confirmed/checked-in bookings is retained with atomicity and state-race protection.

## Validation

- Linux final run: 81 files / 1,586 isolated tests passed; R2 non-isolated suites 12 + 14 + 27 passed; total **1,639**.
- 11 added tests: Claude's 7 plus audit-failure rollback, concurrent reconciliation, stale refund guard and checkout race guard. Migration diagnostic 79/79 passed (included in isolated count).
- Initial Linux attempt stopped with an unhandled workerd/undici connection closure (80 files / 1,575 tests reported); same source rerun passed completely. Original attempt log preserved.
- GitHub CI run 37752421473 passed both required jobs on first attempt.
- Build/dist passed, 135 files. Existing four-role / three-width Admin browser checks passed.
- Actual staging UI at 390px and 1440px: before voiding income, removal is blocked; operator voids income in Finance UI, then removes the deposit from cancelled booking history. Deposit total becomes 0, deposit list empty, no new finance row, original void actor/time retained; duplicate DELETE returns 400.
- Staging bookings #25/#26, deposit lines #22/#23, finance receipts #52/#53 used for positive fixtures. Each operation has exactly one deposit_delete audit. Read-only UI check of refunded fixture #24 confirms the blocked message and absent removal button.
- Production read-only inspection confirms #32/#33 are cancelled with 50,000 remaining each; deposit lines #4/#5 link to voided income receipts #254/#255, with no refund link. Query wrote zero rows. No automatic deletion of these production deposits was performed.

Machine-readable evidence: `test-results/deposit-reconcile/`.

## Release

User requested review and continued deployment. PR #11 merged as `5a359f483d4ae72e3b58d43cf6218a7f6ee64859`; its tree matches the tested source exactly. Production deployment bb55372c-7da8-4ecf-a19a-194af6bac4c2 (https://bb55372c.hien-le-garden-v4.pages.dev) succeeded via workflow run 37753065679. Both production and deployment Admin assets match main 61/61; R-1 probe passed 62/0/0. Public health and policy checks passed. Prior production 96fc08e6 / 73048e8 remains available for rollback. The owner will remove #32/#33 through the UI after release; no direct SQL correction is planned.

D4B.4 was already closed with recorded 404 evidence; no additional HEAD was sent during this task.
