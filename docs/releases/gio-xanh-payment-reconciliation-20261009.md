# Giờ Xanh payment reconciliation — staging handoff, 2026-10-09

Source: `087bfee26fdfc0a384870ddd504e9a44d2c191e6`, draft PR #13. Staging deployment `735472b2`, alias https://staging.hien-le-garden-v4.pages.dev. No migration. Production has not been deployed or changed by this work.

## Behavior

Closed Giờ Xanh sessions show paid only when the linked income receipt is active, confirmed/paid, in the Giờ Xanh category, matches the saved total and current posted items, and has a valid payment method. Otherwise list/detail show “Cần đối soát thanh toán” with the reason. Saved total and receipt ID remain visible. Printing is blocked for sessions requiring review. Reading these statuses never repairs or writes financial data.

## Validation

- Local Linux D1: 302/302 targeted tests, including ten list/detail receipt reconciliation cases.
- GitHub Actions run 37895599912: both required jobs passed; 1,642 isolated tests plus separate R2 12 + 14 + 27 = 1,695 blocking tests. Optional isolated R2 run still has the existing toolchain failure and is non-blocking; separate mandatory suites passed.
- Build/check:dist passed, 135 public files, 15/15 required assets.
- Staging: 9/9 checks passed. Six real UI checkout flows: booking, dine-in, Giờ Xanh, each at 390/1440px with cash/transfer. Correct receipts and refund amounts, duplicate close and late service add/void blocked, six settlement audits verified. Booking departure display uses browser time 2027-01-06; server and D1 are real. Fault injection/rollback cases run only in isolated local D1 tests.
- Two additional Giờ Xanh UI checks voided only this run's synthetic receipts, then verified review status in detail/history/API and blocked invoice printing at both widths. API edge cases such as missing/wrong-category/mismatched receipt are covered locally.
- Admin artifact raw bytes match 122/122 across immutable staging and alias. Private URL probe: 62 PASS / 0 FAIL / 0 INCONCLUSIVE.

Synthetic staging records retained: bookings #31/#32 (receipts #68–#71), Giờ Xanh #5/#6 (receipts #72/#73 intentionally voided), orders #4/#5 (receipts #74/#75). Room cleaning flags created by the two test checkouts were restored. These IDs are staging IDs, unrelated to production bookings with the same numbers.

## Production reconciliation — SELECT only

All query responses report zero rows written. Checked four closed orders, two closed Giờ Xanh sessions, one checked-out booking and deposit caches. Three closed sales reference voided income receipts:

| Record | Saved and posted total | Linked receipt | Finding |
|---|---:|---|---|
| Giờ Xanh #1 | 368,000 VND | #50 | Voided 2026-09-05 |
| Giờ Xanh #3 | 130,000 VND | #55 | Voided 2026-09-06 |
| Order #2 | 35,000 VND | #56 | Voided 2026-09-06 |

No closed-sale missing receipt, amount mismatch or shared receipt reference was found. No checked-out booking with posted unpaid services, paid service with invalid linked receipt, or deposit cache mismatch was found.

Income #51 (300,000), #53 (400,000), #239 (150,000) have no Giờ Xanh session link. Each has a finance_transaction_create audit entry, consistent with direct manual income. These are review candidates, not proven orphan receipts; do not recreate or delete automatically.

The single historical checked-out booking has no booking_checkout audit and no stable checkout receipt linkage. Its service/deposit checks passed, but historical room/refund income cannot be fully attributed per booking from these links alone. This is a reconciliation limitation, not a clean bill for every historical receipt.

No production receipt was restored, recreated, voided or deleted. Next decision: review the three voided receipt cases against actual payments, then approve PR #13 merge/production deployment separately.

Evidence: `test-results/gio-xanh-reconcile/` (staging-check.json, screenshots, CI log, production-readonly.sql/json, production-candidates.json, staging-artifact.json, staging-r1.log).

## Acceptance and production investigation follow-up

Staging acceptance recheck at the same source/deployment: admin artifact still matches 122/122. All six retained synthetic records passed state, payment/receipt and UI checks at 390/1440px, with no business writes. Two bookings remain checked out with posted services paid; two orders remain paid with active matching income; the two Giờ Xanh sessions retain the intentional voided-receipt review warning and cannot print paid invoices. The first acceptance script incorrectly expected a financeTransactionId field in the order detail response; this field is not exposed by that API. The assertion was corrected to inspect the matching finance row, and the rerun passed. Failure evidence was retained; application source was unchanged.

Production verification confirmed:

| Record | Created/closed by | Receipt voided by | Void time (UTC) | Audit |
|---|---|---|---|---|
| Giờ Xanh #1, receipt #50, 368,000 VND | Test1 | Test1 | 2026-09-05 01:30:59.553 | #132 |
| Giờ Xanh #3, receipt #55, 130,000 VND | Test2 | Vinhdx | 2026-09-06 13:26:27.932 | #347 |
| Order #2, receipt #56, 35,000 VND | Test2 | Vinhdx | 2026-09-06 13:26:26.280 | #346 |

Receipts were generated at the same time as closing and match saved/item totals. Voiding is recorded explicitly in audit; this is not evidence of a failed receipt insert. The sales remain closed because finance voiding does not reopen them. All three sale records and receipts are currently hidden. Each receipt has zero effective income under the active-income predicate; combined face value is 533,000 VND. None has an uploaded receipt attachment.

Test1/Test2 attribution, very short opening-to-closing intervals, later voiding and hiding suggest test data, but cannot establish whether physical cash changed hands. Owner confirmation is pending. If confirmed synthetic, retain voided/hidden history without recreating income. If any is real, reconcile against cash/bank evidence before authorizing a financial correction. No automatic repair was performed. Production verification query responses all report zero rows written.

Evidence added: acceptance.mjs/json and screenshots, acceptance-script-failure.json, production-verification.sql/json, production-effective-income.json. Technical staging acceptance passed; production deployment/merge remains a separate decision.
Owner follow-up: all three production cases confirmed test data. Keep voided/hidden history; no financial correction required. PR #13 subsequently released as 809511c / 3a30dc4b; see checkout-production-handoff-20261009.md.
