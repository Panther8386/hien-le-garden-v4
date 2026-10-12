# Open security backlog review — 2026-10-09

Status update 2026-10-10: both self-password findings below (session/2FA revocation and missing guessing budget/audit) were resolved by PR #15, source `da45596`, production merge `16a5ea4`, deployment `a31eadaa`. The endpoint now reserves 5 attempts/account across sessions/networks and 30/network per five minutes before current-password verification, returns 429/Retry-After, and fails closed if counters are unavailable. Real staging expiry/revocation/audit checks passed. See `sec56-production-20261010.md`. The original findings below remain as historical review evidence, not current open defects.

F-2 is implemented and accepted on staging in draft PR #16 (`8747ad8`), but owner has explicitly deferred merge/production deployment. Creation audits (SEC-7) remain open.

Reviewed source HEAD `45dc1e8edce7e1d9f0bdcc20c86eb1730bab40d0`; scoped API/auth files are unchanged from production main `809511c`. This is a scoped backlog review, not a penetration-test certificate or a complete system audit. No application fixes, account/financial mutations, WAF/Access changes or production deployment were made.

## Findings and priority

### P1 — Self password change leaves old sessions and pending 2FA valid

`functions/api/auth/change-password.js:29` updates only password_hash. It neither deletes sessions/pending_2fa_tokens nor writes audit. `lib/auth.js:getSession` checks token expiry/account lock, not a password generation. Local D1 reproduction: create another session and pending 2FA token, change password successfully, then both still resolve to the account. An already-stolen session can remain useful until its original expiry (session TTL is 12 hours); the pending token still needs valid TOTP but can finish an old-password login within its TTL.

Fix first: atomically update the password, revoke all sessions and pending 2FA tokens, and write a self-password-change audit without secrets. Clear the browser cookie and require login again. Guard concurrent credential changes with the expected stored hash and test concurrent in-flight login/token issuance so revocation cannot be bypassed by a late write. Admin-driven reset already revokes both session types in a batch; self-change should meet the same security property.

### P1 — F-2 public booking relies on external protection

`functions/api/bookings/index.js:31` checks body size (16 KiB) and input fields, then inserts and may notify Telegram. There is no Turnstile verification, app request budget or hostname restriction in this endpoint. Local D1 reproduction: seven anonymous requests on the production deployment hostname created seven bookings without any challenge. No real HTTP POST was sent to production or staging.

Impact: automated spam, database growth, admin queue and notification abuse if requests reach the handler. This is not proof that a configured zone WAF rule currently fails; current dashboard rules were not queried/revalidated.

Fix as one release scope with hostname handling: enforce a shared bounded app budget before expensive actions, verify Turnstile with the correct server-side hostname/action checks, and validate allowed production/preview request hosts separately. Keep staff booking API permissioned and outside the anonymous budget. Test burst/concurrency, missing/forged tokens, unknown hosts, preview binding isolation, fail-closed dependency handling and ordinary customer submissions.

### P2 — SEC-5/6 password endpoint has no guessing budget or change audit

Local D1 reproduction: seven wrong current-password submissions all returned 400, with zero login_rate_limits entries. Existing SEC-3 protects `/api/auth/login`, not self password change. Authentication is required to reach this endpoint, so this is not anonymous password guessing.

Add per-account/network throttling for current-password verification, bounded JSON/password lengths and a security audit for successful changes. Session revocation above is higher priority. Do not record submitted passwords, hashes, OTPs or session tokens in audit/logs.

### P2 — Missing creation audits

Public booking creation (`functions/api/bookings/index.js:80`), staff booking creation (`functions/api/bookings/staff.js:81`) and user creation (`functions/api/users/index.js:65`) insert rows without an audit entry. Local reproductions confirmed zero audits after public booking and account creation. Staff booking absence was confirmed by source inspection; it was not separately reproduced.

This is an accountability gap, not a demonstrated permission bypass. Existing user-role hierarchy and users.manage checks are present. Add atomic insert + audit for booking_create/account_create, clearly distinguish anonymous website events from staff actors, and avoid copying guest contact or password data into audit text. Tests should prove audit failure cannot leave an unlogged privileged account created.

## pages.dev — confirmed reachability, no demonstrated auth bypass

GET-only probe at `3a30dc4b.hien-le-garden-v4.pages.dev`: public-config 200, auth/me 401, bookings 401. On hienlegarden.vn the same statuses apply. Project alias hien-le-garden-v4.pages.dev redirects all three routes to the custom domain (301), while the immutable deployment URL does not. Thus alias redirection alone is not closure of direct deployment access. R-1 source exposure is a separate issue and remains closed by the release artifact boundary.

Official Cloudflare guidance treats custom-domain redirects and Access coverage as explicit configuration: https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/ and https://developers.cloudflare.com/pages/platform/known-issues/. Default preview Access coverage must not be assumed to protect every production hostname. Review actual Access/WAF settings before choosing a configuration change; app-level anti-abuse must remain effective wherever the handler is reachable.

## What is already supported / limitations

- Session cookies are HttpOnly/Secure/SameSite=Strict; current-password verification is required for self change; locked accounts are rejected by getSession. These do not substitute for session revocation.
- SEC-3 login rate limiting exists in application code; password-reset by an authorized admin already batches credential change/revocations/audit. No claim is made that all authentication endpoints were exhaustively audited.
- SEC-1 local drill passed previously. Remote Time Travel/Cloudflare recovery drill remains unproven; schedule separately with a staging-only plan and backup/recovery evidence.
- No destructive or authenticated production tests were performed. No live booking spam, login brute force or 2FA attempts were run.

## Validation and execution order

Four local D1 reproduction tests passed by asserting current vulnerable behavior; this means findings were reproduced, **not that security passed**. Evidence: test-results/security-review/local-tests.log, source.tar/overlay.tar, reproduction.test.js and GET-only read-only-probe.json. Source archive includes synthetic test credentials only; it is not added to the public artifact/repository.

1. Fix self-password-change revocation/audit with local concurrency tests, then staging acceptance.
2. Fix F-2 anonymous booking protection and production/preview host policy together; inspect WAF/Access before changes.
3. Add creation audits; complete password endpoint budget/size limits (can accompany step 1).
4. Plan SEC-1 remote recovery drill; review other remaining controls separately.

F3/F4 PR #14 remains pending production acceptance/merge. These findings are in unchanged backend code; do not silently expand that quality release into a security release. Implement security fixes in a separate branch/PR after scope approval.
