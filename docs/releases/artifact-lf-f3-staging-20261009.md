# F3 artifact reproducibility — staging, 2026-10-09

Source `b3d43664dadd608b3ee9f58986b46a0120cdc68a`, draft PR #14 includes F4 and F3. Staging deployment `fd2ff6e5`. Production remains `809511c / 3a30dc4b`; no merge or production deployment performed.

## Change

`.gitattributes` enforces LF for auto-detected text and explicitly marks binary assets. Existing tracked index text was already LF, so no blanket renormalization or unrelated source churn was needed. Build normalizes CRLF to LF byte-wise for public HTML/CSS/JS/SVG/JSON/TXT/XML and `_redirects`, preserving other bytes/encoding and leaving binary files unchanged. `.gitattributes` is explicitly private in the release policy.

CI independently builds the same PR merge source on Windows and Ubuntu. Each emits a deterministic file path/size/SHA256 manifest. A dependent job compares both manifests and fails on any difference. This job is part of the workflow; repository branch-protection required-check settings were not changed.

## Evidence

- Local differential builds: 5/5 passed for LF/CRLF HTML, redirects, UTF-8 SVG, binary preservation and exclusion of private attributes.
- Build/check:dist: PASS, 135 files, 15/15 required assets.
- CI run 37898815527: all five jobs successful, including Windows/Linux artifact equality; **135/135 files identical** by size and SHA256.
- Staging Admin artifact: **122/122** raw-byte matches across alias and immutable deployment.
- Real staging F4 recheck: 4/4 PASS at 390px and desktop; no business writes. Previous ten local F4 browser cases remain applicable.

Normalizing CRLF changes the byte hashes of affected text artifacts compared with older Windows builds; semantic content is unchanged. Compare released files to the built manifest/canonical LF Git source, not an unnormalized dirty Windows working copy. No API or schema changes.

Evidence in test-results/mobile-tabs/: f3-local.json, windows-f3-manifest.json, f3-ci-equality.log, f3-staging-result.json, f3-staging-deploy.log, staging-artifact.json. Next: owner acceptance/approval of PR #14 before production release.
