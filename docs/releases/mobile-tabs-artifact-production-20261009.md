# F4/F3 PR #14 — production handoff, 2026-10-09

Owner approved merge to close the quality release before security branches. PR #14 merged as `f60aac2f61714db8497d7173159ad7294131d6b9`; source HEAD `45dc1e8edce7e1d9f0bdcc20c86eb1730bab40d0`, same tree. The functional F3/F4 source is `b3d4366`; the last source commit adds release documentation only.

Deployment workflow `37925212658` succeeded. Production deployment `0b406cb0` at https://hienlegarden.vn; completed 2026-10-09 11:41 UTC (18:41 Vietnam). No migration required. No changes to functions/, lib/ or migrations/ relative to previous main `809511c`.

## Released and verified

- F4: selected reception tab scrolls fully into view at 390px, including hash navigation, keyboard, permission refresh and resize. Directional swipe hint appears when tabs extend outside the strip; hidden when all fit on desktop. Page scroll position is preserved.
- F3: .gitattributes LF policy and byte-wise CRLF normalization for public text; binary assets unchanged. CI independently builds Windows/Linux and compares deterministic file paths/sizes/SHA256.
- Latest PR HEAD CI `37900043900`: all five jobs passed, including Windows/Linux artifact equality. Earlier functional-head run `37898815527` also proved 135/135 identical files.
- Staging previously passed ten local browser checks and 4/4 real staging checks after F3. No authenticated business mutation was used to verify production.
- Production: 122/122 Admin files match merged Git blobs on domain and immutable deployment; public health/auth boundary and 390/1440px login render passed.
- R-1 production probe: 62 PASS / 0 FAIL / 0 INCONCLUSIVE. Attributes, manifest tooling and archive catalog remain private.

Evidence: test-results/mobile-tabs/production-verification.json, production-r1.log; test-results/deposit-reconcile/production-release-14.json, production-merge-14.json and production-deploy-113802386810.log.

A supplemental raw-byte download of every public path was stopped and is not counted as verification: platform-consumed paths such as _redirects are not served as their source file and media downloads add no evidence for these text-only changes. Cross-platform 135-file equality is the CI build result, distinct from the verified 122 Admin HTTP responses.

Previous `3a30dc4b / 809511c` retained as rollback reference; no deployment deleted. Release evidence/catalog and audited staging cleanup records are now included through PR #14. Raw evidence bundles remain local, not uploaded to the public repository.

Next: security fixes in a separate branch based on main `f60aac2`. First self-password-change session/pending-2FA revocation and audit, then public-booking anti-abuse/hostname policy, as detailed in security-backlog-review-20261009.md. No security backend fixes are included in this release.
