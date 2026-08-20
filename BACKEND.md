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
7. Create the Pages project itself with `wrangler pages project create hien-le-garden-v4 --production-branch=main`, then do a first deploy with `wrangler pages deploy .` (see Deploy below for what runs this automatically on every push). No custom domain is required — Cloudflare gives every project a free `<project-name>.pages.dev` URL; add a custom domain later if wanted (Pages project → Custom domains).

   **Pitfall:** Cloudflare's dashboard "Workers & Pages → Create" flow can create a **Workers** project instead of a **Pages** project even when connecting the same repo — Workers can't run this project (it needs Pages' `functions/`-directory routing and `.assetsignore`-based static asset handling). If the dashboard flow is used and the resulting project's build settings show `Deploy command: npx wrangler deploy` (no "pages"), that's a Workers project — delete it (`wrangler delete --name <name>`, run from a directory with no `wrangler.toml`) and create the Pages project via CLI as above instead.

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

## Deploy

Automatic: `.github/workflows/deploy.yml` runs `wrangler pages deploy .` on every push to `main`, via `cloudflare/wrangler-action`. Needs two repo secrets (Settings → Secrets and variables → Actions):
- `CLOUDFLARE_API_TOKEN` — create at Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template.
- `CLOUDFLARE_ACCOUNT_ID` — shown in `wrangler whoami`, or the dashboard URL (`dash.cloudflare.com/<account-id>/...`).

Manual (e.g. for a one-off deploy without waiting on CI):

```bash
npm run deploy   # wrangler pages deploy .
```

Either way, the same domain serves both the static site and `/api/*` — no CORS, no separate backend deployment.
