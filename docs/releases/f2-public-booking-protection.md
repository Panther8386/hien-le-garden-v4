# F-2 public booking protection

Scope: anonymous `POST /api/bookings` and the website booking modal. Staff creation remains at permissioned `POST /api/bookings/staff` and does not use the anonymous budget. No new migration: shared counters reuse migration 0044.

## Request path

Actual HTTPS request hostname and optional Origin must match the configured exact host policy. Forwarded host/origin headers cannot authorize a foreign deployment. Production accepts `hienlegarden.vn,www.hienlegarden.vn`; preview accepts only `staging.hien-le-garden-v4.pages.dev`. Production immutable and project `pages.dev` hostnames cannot submit directly. This policy covers public booking POST, not every endpoint or static page.

Reserve D1 budgets atomically, before parsing the bounded 16 KiB body and calling external verification. Five attempts per Cloudflare network identity per fixed five-minute window; IPv6 shares /64 and IPv4-mapped addresses share IPv4 identity. Missing proxy metadata shares a restrictive bucket. Do not trust client X-Forwarded-For.

At most 300 verification slots globally per five-minute window. A network already blocked cannot drain the global budget. Once global slots are exhausted, new network counter rows are not created. Prune expired counters in bounded batches. Keys are SHA-256 digests with separate booking namespaces; login/password budgets remain independent. Global counter stores count+1 to meet the existing attempts>=1 schema constraint.

Validate fields, then require a single-use Turnstile token whose Siteverify success is exactly true, hostname matches both TURNSTILE_ALLOWED_HOSTNAMES and the request hostname, and action is exactly `booking`. Feedback tokens cannot authorize bookings. Verification timeout is 10 seconds; network/storage/misconfiguration fails closed. No booking or Telegram notification is produced when rejected. The existing feedback verifier remains compatible without a required action.

Return 429 with Retry-After on throttling, 403 for rejected token/host, 503 for missing host policy or unavailable counter storage. UI explains verification/retry, preserves contact alternatives, refreshes the challenge after expiry and server responses, and disables duplicate submission while in flight. An uncertain network result asks the guest to contact staff before resubmitting.

## Configuration and release

`PUBLIC_BOOKING_ALLOWED_HOSTNAMES` is versioned separately in production and preview wrangler vars. Exact hostnames only; no wildcard, URL, port or public suffix. To add another preview, configure its exact host and a matching Turnstile widget/allowlist deliberately; arbitrary preview URLs are denied.

Retain existing per-environment `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_ALLOWED_HOSTNAMES`. Do not expose or commit the secret. Do not use Cloudflare dummy test keys on live environments. Before release verify the real staging widget can submit with action=booking and the secret allowlist includes that exact staging hostname; production allowlist must include the public custom domains.

Read-only Cloudflare inspection on 10/10/2026 confirmed Pages production/preview have separate Turnstile variables and public site keys. OAuth could not read zone WAF/rate-limit or Access rules (403), so no claim is made about their current coverage and no such rule was changed. App protection does not depend on those external rules. Global cap bounds work but is not a distributed-bot immunity guarantee and may limit legitimate traffic during a large attack; customer phone/Zalo alternatives remain available.

## Validation

Local real D1 tests cover concurrency, globally bounded storage, blocked-network isolation, expiry, token replay/verdict, action/hostname mismatch, preview isolation, spoofed headers and fail-closed storage/verification. Existing booking/staff/feedback/login/password/Telegram tests are included. Separate local mock UI checks verify mobile/desktop challenge states and duplicate-submit prevention; mocks are not evidence of a real Cloudflare challenge pass.

Source references: [Cloudflare server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [widget rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/), [Pages custom-domain redirects](https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/).
