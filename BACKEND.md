# Hiền Lê Garden v4 — backend (checkout survey + loyalty codes)

The marketing site (`index.html`, `bang-gia/`, `gioi-thieu/`, `cam-nang/`,
`tri-an-khach-hang/`) and the CRM backend (`functions/`, `lib/`) are one
Cloudflare Pages project — same domain, same deploy. `wrangler.toml` sets
`pages_build_output_dir = "."` (the whole v4 folder), with `.assetsignore`
keeping backend/dev-only files (`lib/`, `test/`, `migrations/`, `wrangler.toml`,
`package.json`, `node_modules/`, …) out of the public static upload.

See `docs/specs/2026-08-19-v4-crm-loyalty-design.md` (in the `hien-le-garden`
repo) for the original design. Originally built as a separate
`crm.hienlegarden.vn` project; merged into this repo so the whole site is a
single Cloudflare Pages deployment.

## One-time setup

1. `wrangler d1 create hien_le_garden_crm` — copy the returned `database_id` into `wrangler.toml`.
2. `wrangler d1 migrations apply hien_le_garden_crm --remote`
3. Set secrets:
   - `wrangler pages secret put BREVO_API_KEY`
   - `wrangler pages secret put TELEGRAM_BOT_TOKEN`
   - `wrangler pages secret put TELEGRAM_WEBHOOK_SECRET` — a long random string you generate (e.g. `openssl rand -hex 32`; Telegram allows 1–256 chars of `A-Z a-z 0-9 _ -`). The webhook rejects every request (401) whose `X-Telegram-Bot-Api-Secret-Token` header does not match it, and rejects everything if it is unset (fail closed).
   - `wrangler pages secret put TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS` (set it with `pages secret put` even though it is not secret: `wrangler.toml` has `pages_build_output_dir`, so it owns plain vars and dashboard plain vars may not persist) — comma-separated Telegram chat ids allowed to change where new-booking notifications (guest name + phone) are sent, e.g. `-100xxxxxxxxxx,123456789`. Only a chat in this list can run `/start staff_booking_notify`; from any other chat (or if the variable is unset/empty) the command is silently ignored. Changes are recorded in the audit log (`notification_destination_change`).
   - `wrangler pages secret put TURNSTILE_SECRET_KEY` and `wrangler pages secret put TURNSTILE_SITE_KEY` (public value, stored as a secret for the same reason) — see "Public feedback form: bot protection" below. **Without both, the guest feedback form (`/tri-an-khach-hang/`) rejects every submission (403, fail closed).**
4. Create the first manager account:
   - `node scripts/seed-manager.js <username> <password>`
   - Run the printed `INSERT` with `wrangler d1 execute hien_le_garden_crm --remote --command "<sql>"`
   - Create a reception account the same way, with `reception` as the 3rd argument.
5. Create the Telegram bot via @BotFather, set its webhook to `https://<your-domain>/api/telegram/webhook` **with the same `secret_token` as `TELEGRAM_WEBHOOK_SECRET`**:
   - `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-domain>/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET value>"`
   - **Deploy requirement:** whenever `TELEGRAM_WEBHOOK_SECRET` is first set or rotated, re-run this `setWebhook` call with the matching `secret_token`. A webhook registered without it (or with an old value) gets every update rejected with 401 — guest deep links (`/start <feedbackId>`) and `/start staff_booking_notify` stop working until it is re-registered. Check with `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` (`last_error_message` shows 401s). Never commit or paste the real values. Right after deploy, also check that the stored destination (`wrangler d1 execute hien_le_garden_crm --remote --command "SELECT booking_notify_chat_id FROM notification_settings"`) is a known hotel chat, and correct it if not: this fix blocks new takeovers but does not reset a destination hijacked before it.
   - To find a chat id for the allowlist: add the bot to the group, send any message, and read `message.chat.id` from `getUpdates` (temporarily `deleteWebhook` first, then re-run `setWebhook` with `secret_token`), or ask an existing admin who knows the id already stored in `notification_settings`.
6. Verify the sending domain in Brevo so `sender.email` in `lib/email.js` is authorized.
7. Create the Pages project itself with `wrangler pages project create hien-le-garden-v4 --production-branch=main`, then do a first deploy with `wrangler pages deploy .` (see Deploy below for what runs this automatically on every push). No custom domain is required — Cloudflare gives every project a free `<project-name>.pages.dev` URL; add a custom domain later if wanted (Pages project → Custom domains).

   **Pitfall:** Cloudflare's dashboard "Workers & Pages → Create" flow can create a **Workers** project instead of a **Pages** project even when connecting the same repo — Workers can't run this project (it needs Pages' `functions/`-directory routing and `.assetsignore`-based static asset handling). If the dashboard flow is used and the resulting project's build settings show `Deploy command: npx wrangler deploy` (no "pages"), that's a Workers project — delete it (`wrangler delete --name <name>`, run from a directory with no `wrangler.toml`) and create the Pages project via CLI as above instead.

## Public feedback form: bot protection

`POST /api/feedback` is public and issues a discount voucher, so it is protected by:

1. **Cloudflare Turnstile.** The page (`tri-an-khach-hang/index.html`) reads the public site key from `GET /api/public-config` (`{ turnstileSiteKey }`, no auth, nothing else) and renders the widget; the token is sent as `turnstileToken`. The server (`lib/turnstile.js`) verifies it with siteverify before any DB access or email. Missing secret, missing/invalid/replayed token, or any siteverify error → `403` (fail closed).
   - Deploy config (Pages project → Settings → Variables and Secrets, Production and Preview):
     - `TURNSTILE_SITE_KEY` — public value; set it with `wrangler pages secret put TURNSTILE_SITE_KEY` (see the plain-vars note above). After deploy, `GET /api/public-config` must return a non-null `turnstileSiteKey`.
     - `TURNSTILE_SECRET_KEY` — secret (`wrangler pages secret put TURNSTILE_SECRET_KEY`). Never commit it.
   - Create the widget in Cloudflare dashboard → Turnstile, with the production hostname(s) (`hienlegarden.vn`, `www.hienlegarden.vn`, and the `*.pages.dev` preview host if previews should accept feedback).
   - Local dev: put Cloudflare's documented always-pass test keys in `.dev.vars` (site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`); never use them in production.
2. **One active voucher per guest.** A new voucher is not issued while the same phone (digits only, `84…` or `0084…` → `0…`) or the same email (trim + lowercase) already has an `unused`, unexpired voucher — the insert is a single `INSERT … SELECT … WHERE NOT EXISTS (…)` statement, and a duplicate gets `409` without any code. After that voucher is used or expires, the guest can get a new one.
3. **Rate limiting is not done in code** (it would need a new table or a Workers rate-limit binding). **Recommended:** a Cloudflare WAF rate-limiting rule (Security → WAF → Rate limiting rules) for `POST` requests to `/api/feedback` and `/api/bookings`, e.g. at most 5 requests per 10 minutes per IP, action Block (or Managed Challenge).

## Local development

```bash
npm install
npm run dev    # wrangler pages dev . --d1=DB — serves the whole site + API from one local server
npm test        # Vitest, auto-retrying — see note below
```

**Windows-only test flakiness:** `@cloudflare/vitest-pool-workers` occasionally
crashes on Windows before finishing a run — a SQLite WAL temp-file race while
tearing down its isolated D1 storage snapshot, or workerd's Node-compat layer
misresolving vitest's `vite-node/client` import. Neither is a real test
failure (never a "N failed" — only a crash). `npm test` runs
`scripts/test-with-retry.js`, which retries on that class of crash and exits
immediately on a genuine assertion failure. Use `npm run test:once` to see a
single raw `vitest run` invocation if you're debugging the flake itself. This
only affects local Windows runs — GitHub Actions CI runs on Linux, where it
doesn't occur, and the deploy workflow doesn't run this suite anyway.

Before `npm run dev` can serve real data, apply migrations to the local D1 once:

```bash
wrangler d1 migrations apply hien_le_garden_crm --local
```

The root Playwright suite (`npm test` from the `hien-le-garden` repo root) covers the survey/admin pages against a static server; it mocks every `/api/*` call via `page.route()`, so it does not exercise the live Functions/D1 — that's what this repo's own Vitest suite is for.

## Phân quyền

Mã quyền (permission keys) là nguồn sự thật cho việc kiểm tra quyền trong `lib/requireAuth.js` — không còn mảng vai trò hard-code. Danh mục mã quyền, nhãn hiển thị và mặc định seed theo vai trò nằm ở `lib/permissions.js` (`PERMISSION_GROUPS`, `ROLE_DEFAULTS`). Lúc chạy, quyền thật của một tài khoản = quyền mặc định của vai trò (bảng `role_permissions`, chỉnh được qua trang Phân quyền, chỉ Quản trị) cộng/trừ override riêng theo tài khoản (bảng `user_permission_overrides`). Quản trị (`admin`) luôn có mọi quyền, không override.

Thêm một quyền mới:
1. Thêm mã quyền vào nhóm phù hợp trong `PERMISSION_GROUPS` (`lib/permissions.js`).
2. Thêm mã đó vào migration seed (`migrations/0042_permissions.sql`, hoặc migration mới nếu `0042` đã chạy remote) cho những vai trò cần có quyền này mặc định.
3. Áp dụng migration cho D1 **remote** trước khi merge nhánh vào `main` — xem "Applying a new migration to production" bên dưới; code đã deploy mà đọc mã quyền chưa được seed sẽ coi như chưa cấp quyền cho ai.

4 cột cờ cũ trên bảng `staff_accounts` (`can_manage_room_layout`, `can_add_finance_transaction`, `can_delete_asset`, `can_delete_deposit`) vẫn còn trong schema nhưng không còn được code đọc — đã chuyển thành override tương ứng (`rooms.layout`, `finance.create`, `assets.delete`, `bookings.deposit_delete`) trong `user_permission_overrides` bởi migration `0042`.

## Deploy

Release of the admin permissions branch (migration 0042, Telegram webhook secret, Turnstile, WAF, smoke tests, rollback): follow [docs/releases/admin-permissions-release-runbook.md](docs/releases/admin-permissions-release-runbook.md).

Automatic: `.github/workflows/deploy.yml` runs `wrangler pages deploy .` on every push to `main`, via `cloudflare/wrangler-action`. Needs two repo secrets (Settings → Secrets and variables → Actions):
- `CLOUDFLARE_API_TOKEN` — create at Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template.
- `CLOUDFLARE_ACCOUNT_ID` — shown in `wrangler whoami`, or the dashboard URL (`dash.cloudflare.com/<account-id>/...`).

**Do not deploy manually from a working checkout** (`npm run deploy` / `wrangler pages deploy .`). `pages deploy` uploads every file in the directory except a small hard-coded list. It does not read `.gitignore` or `.assetsignore`, so it also publishes local untracked and ignored files (`.dev.vars`, `.superpowers/`, `graphify-out/`, `.claude/`, `.wrangler-local-state/`, …) as public assets. Run from a non-`main` branch, it also creates a preview deployment bound to the production D1/R2. To redeploy, re-run the GitHub Actions deploy job instead: `gh run rerun <run-id>`, or "Re-run jobs" in the Actions tab.

Known issue R-1 (release blocker, pre-existing): even the CI deploy publishes tracked non-public files (`lib/`, `migrations/`, `test/`, `docs/`, `wrangler.toml`, `package.json`, this file). See the R-1 section of the release runbook.

The same domain serves both the static site and `/api/*` — no CORS, no separate backend deployment.

### Applying a new migration to production

Migrations under `migrations/` are **not** applied automatically — `wrangler d1 migrations apply` only runs against `--local` (via the Vitest setup) or when invoked manually against `--remote`. Before merging a branch that adds a migration, apply it to the real database first:

```bash
wrangler d1 migrations apply hien_le_garden_crm --remote
```

Do this *before* the merge lands on `main` and triggers the auto-deploy — the live code queries the new tables directly (e.g. `functions/api/feedback.js`'s promo-email send reads `message_templates`), so deploying ahead of the migration breaks guest-facing flows, not just new admin endpoints.
