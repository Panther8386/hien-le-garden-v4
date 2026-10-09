# Checkout and Giờ Xanh — production release 2026-10-09

PR #13 merged with owner approval. Source `087bfee26fdfc0a384870ddd504e9a44d2c191e6`; merged main `809511c1f6661cfd7c950a0c902673246a960ba6`. Source and merge trees are identical. GitHub deployment workflow `37896588574` succeeded. Production deployment: `3a30dc4b`, serving https://hienlegarden.vn. No migration required.

## Released behavior

- Booking checkout records room/service income, any deposit refund, service payment state, room cleaning flag, audit and final booking state in one D1 batch.
- Dine-in and Giờ Xanh commit income, audit, closed state and receipt link atomically. SQL failure rolls back; stale or duplicate close cannot add income. Service add/void is guarded against checkout races.
- Giờ Xanh list/detail derives paid/review status from the linked receipt, saved amount and posted services; invalid or voided receipts display the reason and block paid invoice printing.

## Verification

- Required CI passed at source: 1,642 isolated + R2 12/14/27 = 1,695 blocking tests. Existing optional isolated-R2 toolchain issue remains non-blocking.
- Staging: 9/9 checks plus acceptance recheck of all six retained records at mobile/desktop widths. Details in gio-xanh-payment-reconciliation-20261009.md.
- Production: 122/122 admin files match merged Git blobs across custom domain and immutable deployment. New helper/function paths remain private on both hosts.
- Production R-1 probe: 62 PASS, 0 FAIL, 0 INCONCLUSIVE.
- Public homepage, login and public-config return 200; unauthenticated auth/me returns 401. Login renders at 390/1440px without JS errors or horizontal overflow.
- Production business mutations were not used for verification. The same SELECT queries confirm three historical test records and their audits are unchanged; all responses report zero rows written.

## Historical test records

Owner explicitly confirmed Giờ Xanh #1/#3 and order #2 are test data. Linked income #50/#55/#56 totals 533,000 VND face value; all receipts are voided and hidden, all sales hidden. Effective income is zero. Retain the audit/history; do not recreate receipts or reopen these sales.

Historical booking room/refund receipt attribution remains limited by old missing checkout audit/linkage. Three manually created Giờ Xanh income rows #51/#53/#239 remain business-review candidates; this release does not repair historical data automatically.

## Rollback and evidence

Previous production deployment `05eceea6` / commit `49ef1daeb50df1e6eb05ab73891422892dd00527` is the rollback reference. No deployment was deleted. Rolling back removes these checkout/reconciliation improvements; no schema rollback is needed.

Evidence: test-results/gio-xanh-reconcile/production-verification-release.json, production-r1.log, production-after-release.json; test-results/deposit-reconcile/production-release-13.json, production-merge-13.json and production-deploy-113709214293.log. Production release uses GitHub main, excluding unrelated local edits/untracked reports.
