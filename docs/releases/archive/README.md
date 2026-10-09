# Release evidence archive

Reports in the parent directory are versioned in Git. Historical reports describe their exact release/commit; use checkout-production-handoff-20261009.md for current production and artifact-lf-f3-staging-20261009.md for pending F3/F4.

Binary evidence is retained locally under test-results, outside the public build/repository upload. The SHA256 catalog records each package; do not silently replace historical packages. Consolidated archive: `test-results/staging-cleanup/HLG-release-records-20261009.zip`. Its SHA256 is recorded in consolidated-archive-20261009.json. This is a local archive, not proof of an off-device backup; copy it to the owner's chosen backup storage separately.

Credential files, passwords, authentication tokens, TOTP secrets and raw database dumps must not be added to this archive or Git.
