# SEC-5/6 — self password change

Source: `da4559675aad0b433b2a9b2b2775e65c154d7025`, draft [PR #15](https://github.com/Panther8386/hien-le-garden-v4/pull/15), separate from merged PR #14.
Staging deployment: `f1c1384c`, alias `https://staging.hien-le-garden-v4.pages.dev`.
Production remains `f60aac2` / `0b406cb0`. No production mutation or merge is authorized by this handoff.

## Behavior

- A successful self password change atomically updates the credential, deletes every own session and pending 2FA challenge, and appends `account_password_change` audit without password/hash/OTP/token values. Audit failure rolls back the entire transition.
- Clears the session cookie and shows a login link. Other staff sessions remain unchanged.
- Guarded session/challenge issuance prevents login and 2FA requests already in flight from reviving access after the change. Competing password changes have exactly one winner.
- Reserves separate D1 budgets before verifying the current password: 5 attempts per authenticated account across sessions/networks, 30 per network, fixed 5-minute window. Returns 429 with Retry-After; storage failure returns 503 rather than bypassing protection.
- JSON body maximum 4 KiB, new password 8–256 characters, current password maximum 256 characters. No new migration; reuses migration 0044.

## Validation

- Local Linux D1: 122 tests / 10 files pass; includes 13 added security cases (18 change-password tests total).
- GitHub run `37926428492`: five jobs successful. Required tests: 1,655 isolated + R2 12 + 14 + 27 = **1,708**. The known isolated R2 diagnostic remains non-blocking; its isolation errors are retained in the log, while all required individual R2 runs pass.
- Build/check:dist pass; Windows/Linux artifact equality pass.
- Staging static artifact: 122/122 admin files match source build on alias/immutable deployment. R-1 probe: 62 PASS / 0 FAIL / 0 inconclusive.
- Real staging mobile 390px and PC 1440px: successful change, two old sessions return 401, old pending 2FA token returns 401, old password rejected, new password plus TOTP works.
- Five wrong current-password guesses permitted for verification; sixth blocked by 429, UI explains wait, existing session remains valid.
- Natural five-minute expiry PASS; correct password change succeeds and revokes current session. Exactly three successful-change audits for the final three fixtures, no submitted passwords; Vietnamese audit filter works. All three final fixtures locked, plus four interrupted fixtures locked. Final browser checks: 5/5 PASS (2026-10-10 01:32:41Z). See staging-check.json and readonly-verification.json.

## Evidence and limits

Evidence directory: `test-results/sec56/` (CI logs/jobs, patch, local results, deployment log, artifact comparison, R-1 log, browser screenshots and staging results). No credentials or TOTP secrets are included.

Initial browser runs were interrupted at Playwright's response-body read; successful response headers alone were not counted as acceptance. Their result snapshots are retained. The completed script verifies the UI and real follow-up API behavior instead; synthetic accounts from interrupted runs are locked.

Direct staging D1 inspection is unavailable: Wrangler returns Cloudflare 7403. Session revocation is verified through real 401 responses, account cleanup through the users API, and audits through the audit API/UI. No claim of a final direct SQL row-count check is made.

Next: review and approve PR #15 merge/production release after final staging evidence passes. Public booking anti-abuse (F-2), creation audits (SEC-7), and remote recovery rehearsal (SEC-1R) remain separate backlog items.
