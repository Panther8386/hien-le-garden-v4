# Staging cleanup and evidence archive — 2026-10-09

Scope: staging only (`hien_le_garden_crm_staging`, database `1e91a577-df12-4ff7-8730-c022be25a3c9`). Binding guard passed before remote operations. No production requests, writes, deployments or account changes were used in this cleanup. Staging code remains F3/F4 `b3d4366 / fd2ff6e5`; production remains `809511c / 3a30dc4b`.

## Completed through authenticated application APIs

52 audited operations, zero hard deletes:

- Locked three `spec2_62a7c90_*` manager/reception/observer accounts, IDs 2/3/4. Their sessions were revoked; postcheck found zero sessions. SEC-3 test observer ID 5 was already locked and has zero sessions. Staging admin ID 1 remains unlocked and unchanged.
- Rejected synthetic pending booking #19 using the hotel cancellation rule: 100% of its 50,000 VND deposit refunded through new confirmed expense #76 (`hoan_coc`). The booking is cancelled/hidden, with `cancellation_origin=hotel`. Original deposit remains historical; this is not deposit deletion.
- Hid all 32 clearly tagged synthetic bookings (16 cancelled, 16 checked out), all five closed synthetic orders and all six closed synthetic Giờ Xanh sessions.
- Hid five already-voided receipts (#39/#52/#53/#72/#73). No visible voided receipts remain. Active receipts were neither voided nor deleted.

Postcheck: all 43 sales/booking records retained and hidden, no pending/open fixture among those records. Audit contains three account_lock, one booking_reject and 48 record_hide entries. Finance count changed from 74 to 75 only because of the 50,000 refund; face value increased from 8,120,000 to 8,170,000. This total combines income and expense and is not net revenue.

Active synthetic finance history is intentionally retained as test evidence, so staging financial reports are not reset to zero. Use “show hidden” with the admin account to reopen acceptance fixtures for inspection. Future tests should create freshly tagged fixtures rather than depend on visible historical ones. No menu, room, policy, price or other unclassified configuration was changed. Cloudflare preview deployment deletion is outside this cleanup.

## Evidence and storage

Before/after inventories, cleanup script/result and verification SQL are retained in `test-results/staging-cleanup/`. No password/hash/session token or TOTP secret was exported. An initial postcheck SELECT used a nonexistent refund_amount column; it failed without writes, was corrected to join the refund receipt, and the successful result is retained. This was a verification query error, not an application failure.

Reports and SHA256 catalog are versioned under `docs/releases/`; pre-existing evidence zip packages are retained locally, unchanged. `docs/releases/archive/evidence-catalog-20261009.json` identifies exact package paths, sizes and hashes. A consolidated local archive is linked by archive/README.md; evidence binaries are not published to the public Git repository.

Related release: F3/F4 remains draft PR #14, not approved for production by this cleanup. Historical production Giờ Xanh #1/#3 and order #2 are owner-confirmed test data, already voided/hidden; no action needed or performed there.
