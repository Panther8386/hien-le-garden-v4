# SEC-7 staging handoff — 2026-10-10

Source: `b5177969f70a2444a312489cc868b609c2ab9159`. Draft PR #17 is stacked on draft F-2 PR #16. Neither is merged; production deployment is not authorized yet.

Staging deployment: `99c01b21`, alias https://staging.hien-le-garden-v4.pages.dev . D1/R2 preview isolation guard passed; no migration.

- Local Linux focused checks: 12 files / 352 tests passed.
- GitHub Actions run 38016211469: all five jobs successful. 1,685 isolated tests plus R2 release checks 12 + 14 + 27 = **1,738 passed**. The separate non-blocking R2 isolated compatibility check remains deferred under the existing pool version; it is not counted as passing.
- Build/boundary: 135 files, 15/15 required assets. Windows/Linux artifact equality passed in CI.
- Staging admin files: 122/122 raw-byte comparisons match across immutable deployment and alias.
- Staging source probe: PASS=62, FAIL=0, INCONCLUSIVE=0.
- Live staff booking #34: exactly one `booking_create` audit #127, correct authenticated actor and entity ID, no guest contact/name in audit. Booking cancelled and hidden, deposit 0, no refund transaction.
- Live observer account #13: exactly one `account_create` audit #128, correct authenticated actor/ID, role-only summary, no target login/password. Test account locked after verification.
- Both audit filters and Vietnamese action labels passed at 390px and 1440px.
- Live website acceptance at 02:18:17Z: owner submitted `SEC7_ACCEPTANCE` via real Turnstile. Exactly one website booking #35 and one `booking_create` audit #132; actor `website:anonymous`, matching entity/source, no guest name/contact in audit. Booking cancelled and hidden after verification; no deposit/refund transaction. This completes positive staging acceptance for all three creation paths.

Evidence is under `test-results/sec7/`: local-tests.log, ci-test.log, ci-jobs.json, staging.json, ui.json/screenshots, staging-artifact.json, staging-r1.log and website-acceptance.json. Run website-acceptance.mjs after the owner submits the fixture: it verifies the audit before cancelling/hiding this named synthetic booking. Never add credentials to the evidence package.

Release gate: obtain owner approval to merge F-2 and SEC-7 together and deploy production. Existing historical audits are not backfilled.
