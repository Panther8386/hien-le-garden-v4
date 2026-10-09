# Dine-in payment display — 2026-10-08

Source: `290be8b255570b8789d140b37576979846f021d8`.
Draft PR: https://github.com/Panther8386/hien-le-garden-v4/pull/9
Staging deployment: https://b325cccc.hien-le-garden-v4.pages.dev

## Finding

Read-only production inspection found the three reported orders already closed and linked to matching income receipts: order 8/table 2/160,000 VND/receipt 246 (paid); order 7/table 1/130,000 VND/receipt 245 (paid); order 6/table 13/70,000 VND/receipt 229 (confirmed). The old label “Đã chốt” did not communicate payment completion. No production records were changed.

## Change

History, detail and print display “Đã thanh toán · Đã kết thúc” for closed orders with a matching confirmed/paid income receipt, valid cash/transfer method and no voided_at. Other closed orders display “Đã kết thúc · Cần đối soát thanh toán”. History includes payment method and closure time. Metadata is derived at read time; no schema, financial or order mutations were added.

## Validation

- Linux isolated suite: 81 files / 1,562 tests passed.
- R2 non-isolated suites: 12 + 14 + 27 tests passed; total 1,615.
- Migration diagnostic: 79/79 passed (included in isolated total).
- Build and dist boundary: passed, 135 files.
- Existing Admin browser checks: four roles × three widths passed.
- Live staging: paid history at 390px and 1440px, paid detail, repeated close rejected, voided receipt requires reconciliation while order stays closed; all passed.
- Synthetic staging order 1, receipt 39, 10,000 VND; receipt voided after verification. Synthetic menu item created because staging menu was empty. No real orders altered.

Evidence: `test-results/order-payment/`. Initial Linux attempt failed because the new test incorrectly modeled voiding as status=voided (database allows draft/confirmed/paid); test and reconciliation now use the actual voided_at field. Initial live script stopped before creating an order because staging menu was empty; synthetic menu fixture added and rerun passed. These initial failures remain in the tool history; current logs describe final reruns.

GitHub CI run 37739398696 passed both required jobs: test and Release artifact boundary (R-1), first attempt. Production deployment requires a separate release decision; production remains on the previously deployed Admin/refund release.
