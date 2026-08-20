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
4. Create the first manager account:
   - `node scripts/seed-manager.js <username> <password>`
   - Run the printed `INSERT` with `wrangler d1 execute hien_le_garden_crm --remote --command "<sql>"`
   - Create a reception account the same way, with `reception` as the 3rd argument.
5. Create the Telegram bot via @BotFather, set its webhook to `https://<your-domain>/api/telegram/webhook`:
   - `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-domain>/api/telegram/webhook"`
6. Verify the sending domain in Brevo so `sender.email` in `lib/email.js` is authorized.
7. Deploy: connect this repo to a Cloudflare Pages project (Cloudflare dashboard → Pages → Create → Connect to Git). No custom domain is required — Cloudflare gives every project a free `<project-name>.pages.dev` URL; add a custom domain later if wanted (Pages → Custom domains).

## Local development

```bash
npm install
npm run dev    # wrangler pages dev . --d1=DB — serves the whole site + API from one local server
npm test        # Vitest — API/logic tests against a local D1
```

Before `npm run dev` can serve real data, apply migrations to the local D1 once:

```bash
wrangler d1 migrations apply hien_le_garden_crm --local
```

The root Playwright suite (`npm test` from the `hien-le-garden` repo root) covers the survey/admin pages against a static server; it mocks every `/api/*` call via `page.route()`, so it does not exercise the live Functions/D1 — that's what this repo's own Vitest suite is for.

## Deploy

```bash
npm run deploy   # wrangler pages deploy .
```

In production, Cloudflare Pages deploys automatically on every push to this repo's default branch once the project is connected — the same domain serves both the static site and `/api/*`.
