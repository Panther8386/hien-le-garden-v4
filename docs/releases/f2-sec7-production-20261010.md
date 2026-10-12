# F-2 / SEC-7 production release — 2026-10-10

Owner approved merging PR #16 and #17 and deploying together. PR #17 was merged into the F-2 branch first, so only the final PR #16 merge to main triggered production deployment.

- Production source: `cbc81c8d06057c3f27034ee32df384fda92e69a2`.
- Combined PR source: `619e8ebeb1f89d9faec33f169a44ea4cbfff9dfc`; Git tree identical to accepted SEC-7 staging source `b5177969f70a2444a312489cc868b609c2ab9159` and final main.
- Deployment: `d4f0c06b`, https://d4f0c06b.hien-le-garden-v4.pages.dev ; live https://hienlegarden.vn . GitHub deployment run `38016698403` succeeded.
- Rollback: previous production `16a5ea4365321a699ba91ddc573f8395a48536a6`, deployment `a31eadaa`. No migration required for this release; existing rate-limit table is reused.

F-2 adds server-side shared booking budgets, trusted host/origin checks and real Turnstile validation with booking action/hostname, plus customer UI submission guards. SEC-7 atomically records creation audits for website bookings, staff bookings and staff accounts. Historical audit records are not backfilled.

Validation:

- Combined CI run `38016595516`: all five jobs passed, including boundary and Windows/Linux equality; 1,685 isolated tests + R2 release checks 12/14/27 = 1,738 tests passed. Existing optional isolated R2 compatibility check remains deferred, not counted as passing.
- Staging positive acceptance of all three creation paths: staff booking #34/audit #127, account #13/audit #128, owner website booking #35/audit #132. Test bookings cancelled/hidden without financial entries; account locked.
- Production: all 61 Admin files match Git blobs on both domain and immutable deployment (122/122). Homepage matches merged source after two exact Cloudflare email-obfuscation transformations are normalized.
- Production public health: `/`, `/admin/login`, `/api/public-config` return 200; `/api/auth/me` returns 401. Unauthenticated password-change and creation-audit access return 401.
- Production mobile 390px and PC 1440px: login renders, booking modal initializes real Turnstile, no JavaScript page errors or page overflow. No form submission, authenticated account/booking mutation, or financial mutation performed on production during verification.
- Production source exposure probe: PASS=62, FAIL=0, INCONCLUSIVE=0.

Evidence: `test-results/f2-sec7-release/` (merge responses, final state, CI/deploy logs, verification JSON/screenshots, source exposure probe). Initial homepage hash check failed because Cloudflare wrapped the public mailto and injected its email decoder; the first result and HTML comparison are retained. The verification was corrected to normalize only those two inspected transformations and passed.

Production positive business creation remains covered by matching accepted staging code/configuration; no real customer booking was fabricated in production. Existing independent Cloudflare edge limits were not changed. Rollback remains available if monitoring shows a functional regression.
