# Runbook phát hành — Phân quyền admin (nhánh `admin-redesign`)

- Nhánh: `admin-redesign`. Code runtime được kiểm thử ở `289cbab` (bằng chứng Linux §3); các commit sau đó chỉ là tài liệu/CI/đóng gói (runbook, `.env.example`, workflows, `scripts/build-static.mjs`, `scripts/check-dist.mjs`, `pages_build_output_dir = "dist"` trong `wrangler.toml`), không đổi code trong `functions/` hay `lib/`. Production hiện tại: `main` = `9675840`.
- Hạ tầng: Cloudflare Pages project `hien-le-garden-v4` (static + Pages Functions), D1 `hien_le_garden_crm` (binding `DB`), R2 `hien-le-garden-finance-receipts` (binding `RECEIPTS`).
- Deploy: `.github/workflows/deploy.yml` khi có push lên `main`: `node scripts/build-static.mjs` → `node scripts/check-dist.mjs` → `wrangler pages deploy dist --project-name=hien-le-garden-v4` (chạy từ repo root để Functions build từ `./functions` + `./lib`).
- Runbook này chỉ là tài liệu. Mọi lệnh `--remote` bên dưới do người vận hành tự chạy, đúng thứ tự, đúng thời điểm. Không lệnh nào trong tài liệu chứa giá trị secret thật: `<...>` là chỗ cần điền.

Quy ước:
- Chạy lệnh trong **Git Bash / WSL / macOS / Linux** (cách trích dẫn `"..."` + `'...'` trong SQL giả định shell POSIX). PowerShell cần sửa lại dấu nháy.
- `npx wrangler ...` dùng wrangler của repo (`^3.78`). Đăng nhập trước bằng `npx wrangler login` với tài khoản có quyền trên project.
- Cột "READ-ONLY" = chỉ `SELECT`/`PRAGMA`, không thay đổi dữ liệu.
- **Không bao giờ deploy từ máy local.** Tuyệt đối không `wrangler pages deploy .` (publish cả thư mục repo, kể cả file chưa track như `.dev.vars`, `.superpowers/`, `graphify-out/`, `Pasted text.txt` …). `npm run deploy` giờ = build → check → `pages deploy dist`: `dist/` chỉ chứa file được git track theo allowlist nên file không track không lọt nữa, nhưng nó lấy nội dung working tree (sửa chưa commit cũng lên) và chạy từ nhánh khác `main` sẽ tạo preview trên D1/R2 production. Deploy production chỉ qua GitHub Actions `deploy.yml` (hoặc chạy lại job đó).

---

## R-1 — Repository files published by Pages deploy (RELEASE BLOCKER, pre-existing)

**Trạng thái: remediation prepared in pipeline; existing production remains exposed until the clean artifact is deployed.** (Đã sửa trong pipeline; production hiện tại vẫn lộ file cho tới khi artifact sạch được deploy.) Phương án chủ dự án chọn: (a) deploy thư mục `dist/` chỉ chứa file public (allowlist). Middleware trả 404 **không** được coi là cách sửa.

Bằng chứng lộ (controller kiểm tra trên production bằng request `HEAD` chỉ đọc, 2026-09-27): các URL sau đều trả **200**:

- `https://hienlegarden.vn/wrangler.toml`
- `https://hienlegarden.vn/BACKEND.md`
- `https://hienlegarden.vn/migrations/0001_init.sql`
- `https://hienlegarden.vn/lib/auth.js`
- `https://hienlegarden.vn/package.json`
- `https://hienlegarden.vn/test/auth.test.js`
- `https://hienlegarden.vn/scripts/seed-manager.js`
- `https://hienlegarden.vn/docs/superpowers/plans/…md`
- `https://hienlegarden.vn/.assetsignore`

Cơ chế lỗi: `deploy.yml` cũ chạy `wrangler pages deploy .` với thư mục gốc repo. Wrangler 3.114 (`pages deploy`) chỉ bỏ qua một danh sách cứng (`_worker.js`, `_redirects`, `_headers`, `_routes.json`, `functions`, `**/.DS_Store`, `**/node_modules`, `**/.git`). `.assetsignore` **không** được Pages đọc (chỉ đường Workers assets dùng), `.gitignore` cũng không. Mọi file được track đều thành static asset public.

Tác động (không đổi): mã nguồn backend, schema, test, script, `package*.json`, D1 database id, tài liệu bảo mật đang công khai trên production. **Không có secret** trong file được track (đã quét).

### Cách sửa đã chuẩn bị (commit trên nhánh này)

- `scripts/build-static.mjs` (`npm run build`): dựng `dist/` chỉ từ file **được git track** (`git ls-files -z`), theo allowlist: file gốc `index.html`, `_redirects`, `favicon.svg`, `favicon-32.png`, `favicon-512.png`, `apple-touch-icon.png`, `manifest.json`, `robots.txt`, `sitemap.xml`, `sw.js`; thư mục `admin/`, `assets/`, `bang-gia/`, `cam-nang/`, `gioi-thieu/`, `tri-an-khach-hang/`, `images/`, `videos/` với allowlist đuôi file (html, css, js, ảnh, video, font). Mục cấp cao nhất mới mà chưa được phân loại public/private → **build lỗi**. File không track (`.dev.vars`, `graphify-out/`, ảnh thử…) không bao giờ vào `dist/`.
- `scripts/check-dist.mjs` (`npm run check:dist`): lỗi nếu `dist/` có đường dẫn riêng tư (`functions/`, `lib/`, `migrations/`, `test/`, `scripts/`, `docs/`, `.github/`, `.superpowers/`, `graphify-out/`, `.git/`, `.env*`, `.dev.vars*`, `wrangler.toml`, `package*.json`, `*.lock`, `*.md`, `README*`, `*.map`, `*.log`, `*.sql`, `*.test.js`, `node_modules/`, `test-results/`, `.assetsignore`, `.gitignore`, `vitest.config.js`) (so khớp không phân biệt hoa/thường: `LIB/`, `Wrangler.toml`, `.ENV` …), **hoặc** có file nằm ngoài allowlist (mục cấp gốc không thuộc `PUBLIC_FILES`/`PUBLIC_DIRS`, hoặc đuôi file không được phép cho thư mục đó: `images/` chỉ ảnh, `videos/` chỉ video + ảnh poster), hoặc thiếu file public bắt buộc. Allowlist dùng chung với build ở `scripts/dist-policy.mjs`. `--self-test` cài 55 file giả (riêng tư, biến thể chữ hoa, ngoài allowlist) vào một bản sao `dist/` và chứng minh check thất bại với từng file.
- `wrangler.toml`: `pages_build_output_dir = "dist"` (một lệnh `wrangler pages deploy` trần cũng nhắm `dist`). Pages Functions vẫn được wrangler build từ `./functions` của thư mục đang chạy (import `../lib/*.js` lúc bundle) → phải chạy wrangler từ **repo root**; `lib/` không bị publish.
- `.github/workflows/deploy.yml`: checkout → Node 22 → `node scripts/build-static.mjs` → `node scripts/check-dist.mjs` → `pages deploy dist --project-name=hien-le-garden-v4`.
- `.github/workflows/test.yml` (PR): job "Release artifact boundary (R-1)" chạy build + check + self-test (chặn merge nếu đỏ).

### Kiểm tra artifact trước merge (local hoặc CI, không chạm production)

```bash
node scripts/build-static.mjs          # in số file/bytes theo thư mục; liệt kê file bị loại (vd images/.DS_Store)
node scripts/check-dist.mjs            # mong đợi: PASS (134 files, 0 private/non-allowlisted paths, 11/11 required assets present)
node scripts/check-dist.mjs --self-test  # mong đợi: self-test: OK (55 planted paths + 3 missing-asset cases detected; clean copy passes)
node scripts/probe-private-urls.mjs --self-test  # mong đợi: self-test: OK (7 cases) — chỉ server giả local
```

Trên PR: job "Release artifact boundary (R-1)" phải xanh.

### Đường deploy duy nhất

Merge vào `main` → `deploy.yml`: build `dist/` → check → `wrangler pages deploy dist` (wrangler ghim `3.114.17` qua `wranglerVersion`). Không deploy từ máy local.

Chỉ `deploy.yml` và `npm run deploy` ép build → check. Các đường tay khác **bỏ qua cổng**:
- `wrangler pages deploy .` — tham số dòng lệnh thắng `pages_build_output_dir` (`args.directory ?? config.pages_build_output_dir`, cli.js ~126832) → vẫn upload **cả thư mục repo** (R-1 lại). `wrangler.toml` không chặn được.
- `wrangler pages deploy` (trần) hoặc `wrangler pages deploy dist` — upload `dist/` đang có trên đĩa: có thể cũ, và **không** chạy `check-dist`.
- `npm run deploy` — build + check rồi deploy: file không track không lọt nữa, nhưng lấy nội dung **working tree** của file được track (sửa chưa commit cũng lên), và chạy từ nhánh khác `main` tạo preview dùng **D1/R2 production** (tới khi có `[env.preview]`).

### Kiểm tra sau deploy (bắt buộc, sau **mọi** deploy production)

Hành vi Pages: `dist/` không có `404.html` cấp cao nhất → Pages coi là single-page app và trả **200 + nội dung `index.html`** cho mọi đường dẫn không tồn tại ("If your project does not include a top-level `404.html` file, Pages assumes that you are deploying a single-page application." — developers.cloudflare.com/pages/configuration/serving-pages/). Vì vậy **không** dùng mã trạng thái (kể cả `HEAD`) để kết luận: một URL riêng tư trả 200 vẫn có thể là trang chủ. Tiêu chí PASS: mã 404/410, **hoặc** 200 với body giống hệt body của `/` (trang fallback) — tức là không phải nội dung file. Mọi mã khác (3xx, 401/403/429, 4xx khác, 5xx) là INCONCLUSIVE. Đã kiểm chứng local bằng `wrangler pages dev dist`: mọi URL riêng tư trả `200 text/html` với body = `index.html` (sha256 trùng).

Chạy trên **cả** domain production và alias `pages.dev` production, bằng script Node (chạy được trên Windows/macOS/Linux, sha256 bằng `node:crypto`; chỉ GET, không gửi thông tin đăng nhập):

```bash
node scripts/probe-private-urls.mjs https://hienlegarden.vn https://hien-le-garden-v4.pages.dev
```

- Kiểm 25 đường dẫn riêng tư (`/wrangler.toml`, `/BACKEND.md`, `/package*.json`, `/.env.example`, `/.dev.vars`, `/migrations/*.sql`, `/lib/*.js`, `/test/…`, `/scripts/…`, `/docs/…`, `/functions/api/auth/login.js`, `/.github/workflows/deploy.yml`, `/.superpowers/`, `/graphify-out/`, `/images/.DS_Store`) và 6 trang public (`/manifest.json`, `/sw.js`, `/robots.txt`, `/admin/admin.css`, `/tri-an-khach-hang/` phải 200 với nội dung khác trang chủ; `/api/public-config` phải JSON).
- `PASS` chỉ khi: 404/410, hoặc 200 với body trùng sha256 của `/` (trang fallback). Redirect **không** được theo. `FAIL`: 200 với body khác trang chủ (có thể là nội dung file). `INCONCLUSIVE` (**không bao giờ** tính là PASS): 3xx, 401/403/429 (WAF, Access, rate limit — có thể che file ở phía sau), mọi 4xx khác, 5xx, lỗi mạng/DNS/TLS/timeout (curl sẽ ra `000`), hoặc `/` không trả 200 (không có mốc so sánh).
- Exit: `0` mọi dòng PASS; `1` có FAIL (**dừng — R-1 chưa sửa**); `3` không FAIL nhưng có INCONCLUSIVE (chạy lại; chưa được kết luận). Dòng cuối: `SUMMARY PASS=… FAIL=… INCONCLUSIVE=…`.
- Script đã tự kiểm bằng `node scripts/probe-private-urls.mjs --self-test` (server giả trên 127.0.0.1: SPA fallback, 404, lộ file, 502, ngắt kết nối, trang chủ 500, host không kết nối được).
- Tuỳ chọn — deployment cũ: lấy URL `<hash>.hien-le-garden-v4.pages.dev` của một deployment trước R-1 từ `npx wrangler pages deployment list --project-name=hien-le-garden-v4 --environment production` (hoặc dashboard) rồi `node scripts/probe-private-urls.mjs https://<hash>.hien-le-garden-v4.pages.dev`. Mong đợi **FAIL** (deployment cũ vẫn chứa file) — dùng để xác nhận mức lộ còn lại và kiểm lại sau khi chủ dự án xoá deployment cũ / bật Access (khi đó mong đợi PASS nếu deployment đã bị xoá = 404; nếu bị Access chặn sẽ ra 302/403 = INCONCLUSIVE — xác nhận Access bằng trình duyệt ẩn danh thay vì probe).

Ngữ nghĩa deployment: mỗi deployment Pages là một bộ file riêng (manifest của đúng thư mục upload — `formData.append("manifest", …)` trong wrangler), và Cloudflare mô tả URL deployment là "atomic and may always be visited in the future". Nên:
- Sau deploy sạch, domain production và alias `hien-le-garden-v4.pages.dev` chỉ phục vụ file của deployment mới.
- Các deployment **cũ** vẫn truy cập được qua URL riêng `<hash>.hien-le-garden-v4.pages.dev` và **vẫn chứa** file riêng tư. Rollback về deployment trước R-1 = lộ lại. Cân nhắc (chủ dự án quyết định): xoá các deployment cũ sau khi deploy sạch đã ổn định (mất điểm rollback), hoặc bật Cloudflare Access cho preview/deployment URLs.

Staging/preview: xem [staging-isolation.md](staging-isolation.md) (thiết kế `[env.preview]` với D1/R2 staging, chưa triển khai).

---

## 1. Release manifest

| Component | Change | Required before deploy | Required during deploy | Verification | Rollback impact |
|---|---|---|---|---|---|
| Migration `0042_permissions.sql` | Tạo `role_permissions`, `user_permission_overrides`; thêm `staff_accounts.locked_at/locked_by`; seed quyền theo vai trò (15/25/2); chuyển 4 cờ cũ thành override `grant` | Backup + bookmark Time Travel; freeze thay đổi tài khoản/quyền; `migrations apply --remote` | Merge ngay sau khi migrate (code mới không chạy được nếu thiếu 0042: mọi request có đăng nhập → 500) | §6 SQL kiểm tra; §8 reconcile | Chỉ thêm (không DROP/UPDATE/DELETE). Code cũ chạy được trên schema mới. Không cần rollback DB |
| Mô hình quyền + API (`lib/permissions.js`, `lib/requireAuth.js`, `/api/permissions`, `/api/roles/:role/permissions`, `/api/users/:id/permissions`) | 38 mã quyền thay cho mảng vai trò cứng; admin luôn có mọi quyền; override grant/deny theo từng tài khoản | 0042 đã chạy remote; có ≥1 admin hoạt động | — | Smoke §12 (Phân quyền, Blocked, override) | Rollback code → mất deny/role-table edit (xem §14) |
| Phân cấp tài khoản FA-1 (`lib/staffGuards.js`) | admin > manager > reception = observer; non-admin chỉ thao tác trên hạng thấp hơn và chỉ gán vai trò thấp hơn; khoá do admin chỉ admin mở | Có admin hoạt động (manager không tạo/nâng manager được nữa) | — | Smoke §12 hierarchy | Rollback code → manager lại thao tác được trên manager |
| Giới hạn thử 2FA FA-2 | Token chờ 2FA xoay vòng, tối đa 5 mã sai / token (`MAX_2FA_ATTEMPTS = 5`) | — | — | Smoke §12 (sai 5 lần → phải đăng nhập lại) | Rollback code → không giới hạn thử |
| Giới hạn booking công khai FA-3 (`POST /api/bookings`) | Body tối đa 16384 byte → 413; email ≤254; guestsCount ≤50 | — | — | Smoke §12 (curl body >16 KiB → 413) | Rollback code → mở lại DoS bộ nhớ/CPU |
| Chuyển trạng thái nguyên tử FA-4/FA-5 | Booking confirm/check-in/check-out/cancel/reject và dine-in close/void dùng câu lệnh có điều kiện; close từ chối tổng tiền cũ | — | — | Smoke §12 booking/order | Rollback code → race condition cũ |
| Guard mutation-by-id cần quyền view | `*.manage` theo id đòi thêm `*.view` của tài nguyên; users password/disable-2fa đòi `users.manage` | — | — | Test tự động; smoke §12 Blocked | Rollback code → nới quyền |
| Bản ghi ẩn → 404 | Bản ghi `is_hidden` trả 404 như không tồn tại nếu thiếu `records.hide` (finance: thêm `finance.view_all`) | — | — | Smoke §12 | Rollback code → lộ bản ghi ẩn theo id |
| Telegram webhook auth + allowlist (`lib/telegramWebhookAuth.js`, `functions/api/telegram/webhook.js`) | Kiểm tra header `X-Telegram-Bot-Api-Secret-Token` (fail closed 401); `/start staff_booking_notify` chỉ từ chat trong `TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS`; audit `notification_destination_change` | Đặt 2 biến; `setWebhook` với `secret_token` **trước** deploy (§9) | — | `getWebhookInfo`; booking test đến đúng chat; deep link khách | Rollback code → webhook lại không xác thực (vẫn chạy vì code cũ bỏ qua header) |
| Turnstile + chống trùng voucher (`functions/api/feedback.js`, `lib/turnstile.js`, `/api/public-config`, `tri-an-khach-hang/index.html`) | Form góp ý cần token Turnstile (fail closed 403); một voucher hiệu lực / SĐT/email (409) | Tạo widget Turnstile; đặt `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | — | Checklist §10, smoke §12 | Rollback code → form lại thành relay email không xác thực |
| Bộ lọc nhật ký thao tác (`functions/api/audit-log/index.js`) | Whitelist lọc thêm `role_permissions_change`, `user_permissions_change`, `account_lock/unlock`, `2fa_*`, `notification_destination_change` | — | — | Smoke §12 audit | Không ảnh hưởng dữ liệu |
| `.gitignore` | Bỏ qua `.dev.vars`, `.dev.vars.*`, `.env`, `.env.*` (trừ `.env.example`), `*.local` | — | — | `git check-ignore -v --no-index .dev.vars` | Không |
| Admin UI / trang Phân quyền (`admin/*.html`, `admin/*.js`, `admin/users.html` tab Vai trò) | Nav và nút theo mã quyền; trang chỉnh quyền vai trò (chỉ admin) + override từng tài khoản; khoá/mở khoá | — | Deploy cùng API (cùng một lần deploy Pages) | Smoke §12 | Rollback cùng code |
| Workflow deploy `.github/workflows/deploy.yml` + `scripts/build-static.mjs`, `scripts/check-dist.mjs`, `wrangler.toml` (`pages_build_output_dir = "dist"`) | Sửa R-1: build `dist/` (allowlist, chỉ file được track) → boundary check → `pages deploy dist` | Job "Release artifact boundary (R-1)" xanh trên PR; repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` còn hiệu lực | Theo dõi run Actions: bước build + check xanh trước bước deploy | §8; probe R-1 (mục R-1) PASS trên `hienlegarden.vn` và `hien-le-garden-v4.pages.dev` | Rollback về deployment trước R-1 làm lộ lại file repo |
| Workflow test `.github/workflows/test.yml` (mới) + `test/vitest.r2-noniso.config.js` | CI cho PR / chạy tay, không secret, không deploy: artifact boundary (build + check + self-test), Vitest isolated trừ 3 file R2, 3 file R2 non-isolated (chặn), R2 isolated (không chặn, hoãn) | — | — | Run xanh trên PR | Không ảnh hưởng production |

---

## 2. Điều kiện tiên quyết

- [ ] Quyền: tài khoản Cloudflare có quyền Pages + D1 + R2 + (nếu dùng) WAF trên zone `hienlegarden.vn`; quyền merge vào `main` trên GitHub; quyền admin bot Telegram (token bot).
- [ ] Công cụ: Node 22, `npm ci` đã chạy trong checkout, `npx wrangler whoami` hiện đúng account; `gh` CLI (tuỳ chọn) để theo dõi Actions; `curl`, `openssl`.
- [ ] Linux test gate đã quyết định (§3).
- [ ] **Khuyến nghị cho chủ dự án (chưa cấu hình trong repo):** bật branch protection cho `main` (GitHub → Settings → Branches/Rulesets) với *required status checks* `Release artifact boundary (R-1)` và `test` của workflow `test.yml`, và "Require a pull request before merging". Thiếu cấu hình này thì các bước "chặn" trong `test.yml` chỉ hiển thị đỏ, **không** ngăn merge. (`deploy.yml` vẫn tự build + check trước khi deploy, nên R-1 được giữ kể cả khi thiếu branch protection.)
- [ ] Preflight admin production đạt (§4): có ít nhất 1 admin đăng nhập được, biết mật khẩu và (nếu bật) có app 2FA.
- [ ] Đã chuẩn bị giá trị cho 6 biến môi trường (§7) — lưu trong trình quản lý mật khẩu, không dán vào chat/ticket.
- [ ] Widget Turnstile đã tạo với hostname production (§10).
- [ ] Đã biết chat id Telegram của nhóm khách sạn đang nhận thông báo (giá trị allowlist, §9f).
- [ ] Đã chọn khung giờ ít khách (ví dụ sáng sớm), có người trực lễ tân được báo trước, có 60 phút theo dõi sau deploy.
- [ ] Người vận hành đọc hết §14 (rollback/roll-forward) trước khi bắt đầu.

---

## 3. Linux test gate

Bằng chứng (nguyên văn từ `.superpowers/sdd/2026-09-24-admin-permissions-plan/release/linux-gate-evidence.md`, 2026-09-27, HEAD `289cbab`):

- Môi trường: WSL2 Ubuntu 26.04.1 LTS, Linux 6.18 x86_64, Node v22.20.0, `git clone` sạch ở `289cbab`, `vitest.config.js` không đổi (isolatedStorage mặc định = true). Phiên bản: `@cloudflare/vitest-pool-workers` 0.5.41, vitest 2.1.9, miniflare 3.20241230.0.
- `npx vitest run test/migrations.test.js` (isolated): **79/79 PASS** (Test Files 1 passed).
- Toàn bộ suite isolated trừ 3 file R2: **80 files / 1488 tests PASS**.
- 3 file dùng R2 isolated: **BLOCKED** — `assetInventoryLines` (7/12 rồi crash), `assetPhotos` (5/14 rồi crash), `financeAttachments` (8/27 rồi crash): `AssertionError: Expected .sqlite, got /tmp/miniflare-*/r2/miniflare-R2BucketObject/<hash>.sqlite-shm` từ `@cloudflare/vitest-pool-workers` `dist/pool/index.mjs:556/572` → "Isolated storage failed". Xảy ra ổn định trên Linux → giới hạn của thư viện 0.5.x với file WAL của R2, không phải lỗi app/assertion.
- 3 file đó chạy **non-isolated** trên Linux: **12/12, 14/14, 27/27 PASS** (chỉ là bằng chứng bổ sung).

Quyết định (chủ dự án): **R2 tests: Linux non-isolated PASS 53/53; isolated mode blocked by test-library limitation; upgrade deferred.** (Không nâng `@cloudflare/vitest-pool-workers`/vitest trong release này; nâng lên ≥ 0.6 + vitest 3 là task tooling riêng.)

Chạy lại gate:

A. CI (không có tác dụng phụ lên production): workflow `.github/workflows/test.yml` chạy tự động trên mọi pull request. Trước khi merge, **chỉ dùng run của pull request** — `workflow_dispatch` (`gh workflow run test.yml`) chỉ hoạt động khi file workflow đã có trên nhánh mặc định `main`.

```bash
gh pr checks <pr-number>                     # trước merge
gh run list --workflow=test.yml --limit 3
gh run watch <run-id>
gh workflow run test.yml --ref <branch>      # chỉ sau khi test.yml đã có trên main
```

Kết quả mong đợi: job "Release artifact boundary (R-1)" xanh; trong job `test`: bước "Vitest isolated (excluding 3 R2 files)" xanh; bước "R2 files non-isolated, one process per file (release evidence, blocking)" xanh (12 + 14 + 27 = 53 tests) — đây là bằng chứng phát hành cho 3 file R2 và **chặn** merge nếu đỏ; bước "R2 isolated verification deferred pending upgrade from @cloudflare/vitest-pool-workers 0.5.x (non-blocking)" có thể đỏ (`continue-on-error`) và không được dùng làm bằng chứng.

B. Local WSL (công thức đã dùng):

```bash
# trong WSL Ubuntu, Node 22 linux-x64 đã có trong PATH
git clone <repo-url> hlg-v4 && cd hlg-v4
git checkout 289cbab
npm ci                       # nếu WSL không có mạng: copy node_modules từ Windows và
                             # cài bản linux: npm ci --ignore-scripts --os=linux --cpu=x64 --libc=glibc
npx vitest run test/migrations.test.js
npx vitest run --exclude test/assetInventoryLines.test.js --exclude test/assetPhotos.test.js --exclude test/financeAttachments.test.js
# 3 file R2: non-isolated, mỗi file một process (chạy chung một process thì dữ liệu giữa các file lẫn nhau)
for f in test/assetInventoryLines.test.js test/assetPhotos.test.js test/financeAttachments.test.js; do
  npx vitest run --config test/vitest.r2-noniso.config.js "$f"
done
```

Test chỉ dùng miniflare local (D1/R2 giả lập trong `/tmp`), không chạm D1/R2 thật.

---

## 4. Preflight admin production (READ-ONLY)

Mục đích: sau release, chỉ admin mới quản lý được manager, mở khoá tài khoản do admin khoá, và sửa bảng quyền vai trò. Phải chắc chắn có admin hoạt động **trước** khi migrate. Không bao giờ `SELECT password_hash` hay `totp_secret`.

Trạng thái migration hiện tại (phải chỉ còn `0042_permissions.sql` chưa áp dụng):

```bash
npx wrangler d1 migrations list hien_le_garden_crm --remote
```

Admin hoạt động — **trước migration** (chưa có cột `locked_at`):

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT id, username, role, created_at, totp_enabled FROM staff_accounts WHERE role = 'admin' ORDER BY id"
```

Admin hoạt động — **sau migration**:

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT id, username, role, created_at, totp_enabled FROM staff_accounts WHERE role = 'admin' AND locked_at IS NULL ORDER BY id"
```

Số tài khoản theo vai trò:

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT role, COUNT(*) AS n FROM staff_accounts GROUP BY role ORDER BY role"
```

Người đang giữ 4 cờ cũ, theo vai trò (số này là "kỳ vọng" cho bước chuyển đổi §6):

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT role, COUNT(*) AS accounts, SUM(can_manage_room_layout) AS room_layout, SUM(can_add_finance_transaction) AS finance_tx, SUM(can_delete_asset) AS asset_delete, SUM(can_delete_deposit) AS deposit_delete FROM staff_accounts GROUP BY role ORDER BY role"
```

Chi tiết từng tài khoản giữ cờ (lưu kết quả để đối chiếu):

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT id, username, role, can_manage_room_layout, can_add_finance_transaction, can_delete_asset, can_delete_deposit FROM staff_accounts WHERE can_manage_room_layout = 1 OR can_add_finance_transaction = 1 OR can_delete_asset = 1 OR can_delete_deposit = 1 ORDER BY id"
```

Admin đã bật 2FA:

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT id, username FROM staff_accounts WHERE role = 'admin' AND totp_enabled = 1 ORDER BY id"
```

Tiêu chí đạt:
- [ ] ≥ 1 admin; người vận hành **đã đăng nhập thử** bằng admin đó trên production (với code cũ) trong 24 giờ trước release.
- [ ] Nếu admin bật 2FA: điện thoại có app authenticator ở bên cạnh.
- [ ] Nếu 0 admin → **NO-GO**: tạo/nâng một admin bằng code cũ trước (qua UI hiện tại), rồi lặp lại preflight.
- [ ] Ghi lại (không chứa PII ngoài username) các con số ở trên vào biên bản release.

---

## 5. Backup

File export chứa PII khách, hash mật khẩu và secret TOTP: lưu **ngoài repo**, quyền 600, không commit, không gửi qua chat.

```bash
umask 077
BK="$HOME/hlg-backups"          # chọn thư mục KHÔNG đồng bộ đám mây (không nằm trong OneDrive/Dropbox)
mkdir -p "$BK"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
npx wrangler d1 export hien_le_garden_crm --remote --output="$BK/hien_le_garden_crm-$TS-pre0042.sql"
```

Trên Git Bash/Windows, `umask`/`chmod` không có tác dụng trên NTFS (sẽ không thấy `-rw-------`); thay vào đó đặt file trong thư mục chỉ tài khoản của bạn đọc được và kiểm tra `$HOME` không bị OneDrive đồng bộ (Known Folder Move). Trên WSL/Linux/macOS, quyền 600 áp dụng bình thường.

Lưu ý: export có thể làm chậm/chặn request tới DB trong lúc chạy — làm trong khung giờ ít khách, ngay trước khi migrate.

Kiểm tra file backup:

```bash
F="$BK/hien_le_garden_crm-$TS-pre0042.sql"
test -s "$F" && echo "non-empty OK"
ls -l "$F"                                                   # kích thước > 0 (quyền -rw------- trên Linux/macOS)
grep -cE 'CREATE TABLE "?staff_accounts"?[ (]' "$F"          # phải >= 1 (tên có thể có nháy kép do RENAME ở 0007)
grep -cE 'CREATE TABLE "?bookings"?[ (]' "$F"                # phải >= 1
grep -cE 'INSERT INTO "?staff_accounts"?[ (]' "$F"           # bằng tổng số tài khoản ở §4
```

So số dòng: đếm `INSERT` của `staff_accounts` trong file phải bằng tổng `COUNT(*)` ở §4. Migration 0007 dựng lại bảng bằng `ALTER TABLE … RENAME TO staff_accounts`, nên SQLite lưu (và export ghi) `CREATE TABLE "staff_accounts"(…)` có nháy kép — các biểu thức grep trên chấp nhận cả hai dạng. Chỉ đọc file, không sửa. Không mở file bằng công cụ đồng bộ đám mây.

D1 Time Travel — ghi lại bookmark ngay trước migrate:

```bash
npx wrangler d1 time-travel info hien_le_garden_crm
```

Ghi `bookmark` và thời điểm UTC vào biên bản. Thời gian lưu giữ của Time Travel phụ thuộc gói Cloudflare — kiểm tra trong tài liệu/dashboard, không giả định. Khôi phục (`wrangler d1 time-travel restore hien_le_garden_crm --bookmark=<bookmark>`) **ghi đè toàn bộ DB và mất mọi ghi sau bookmark** (booking, order, voucher mới) — chỉ dùng như biện pháp cuối, xem §14.

---

## 6. Migration 0042

### 6.1 Freeze (bắt đầu ít nhất 15 phút trước migrate, kết thúc sau reconcile §8)

Lý do: sau khi 0042 chạy, code cũ vẫn ghi vào 4 cột cờ cũ và cột `role`, nhưng code mới chỉ đọc override → quyền bị thu hồi trong khoảng này sẽ **vẫn còn** sau deploy (audit C-MIG-1).

Tin nhắn gửi nhóm nhân viên (Zalo/Telegram nội bộ):

> Thông báo bảo trì hệ thống quản lý Hiền Lê Garden: từ **[giờ bắt đầu]** đến khoảng **[giờ kết thúc]** hôm nay, vui lòng **không** tạo/xoá tài khoản, **không** đổi vai trò, **không** bật/tắt quyền (sắp xếp phòng, thêm giao dịch, xoá tài sản, xoá cọc), **không** đổi mật khẩu người khác. Nhận/trả phòng, order, thu chi vẫn làm bình thường. Có thể bị đăng xuất 1 lần — đăng nhập lại là được. Sau bảo trì, menu có thể thay đổi theo quyền của từng người; nếu thiếu chức năng cần dùng, báo quản trị viên. Cảm ơn mọi người.

Người có quyền quản lý tài khoản (admin/manager) xác nhận đã đọc.

### 6.2 Áp dụng

```bash
npx wrangler d1 migrations list hien_le_garden_crm --remote     # chỉ 0042_permissions.sql chưa áp dụng
npx wrangler d1 migrations apply hien_le_garden_crm --remote    # wrangler hỏi xác nhận → y
npx wrangler d1 migrations list hien_le_garden_crm --remote     # "No migrations to apply" / không còn mục nào
```

Kết quả mong đợi của `apply`: một bảng liệt kê `0042_permissions.sql` với trạng thái ✅. Nếu báo lỗi → **dừng**, không merge, xem §14 hàng "Migration fails before deploy".

### 6.3 Kiểm tra sau migration (READ-ONLY)

Bảng mới tồn tại (2 dòng):

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('role_permissions', 'user_permission_overrides') ORDER BY name"
```

Cột mới (phải thấy `locked_at`, `locked_by`):

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "PRAGMA table_info(staff_accounts)"
```

Migration đã ghi nhận:

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 3"
```

Số quyền theo vai trò — mong đợi đúng `manager 25`, `observer 2`, `reception 15`, **không** có dòng `admin`:

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT role, COUNT(*) AS n FROM role_permissions GROUP BY role ORDER BY role"
```

Danh sách khớp chính xác với `ROLE_DEFAULTS` trong `lib/permissions.js` — mong đợi **0 dòng**:

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "WITH expected(role, permission) AS (VALUES ('reception','bookings.view'),('reception','bookings.manage'),('reception','guests.contact_view'),('reception','promo.redeem'),('reception','dine_in.view'),('reception','dine_in.manage'),('reception','gio_xanh.view'),('reception','gio_xanh.manage'),('reception','customers.view'),('reception','customers.send'),('reception','templates.view'),('reception','promo_config.view'),('reception','assets.view'),('reception','assets.count'),('reception','settings.view'),('manager','bookings.view'),('manager','bookings.manage'),('manager','guests.contact_view'),('manager','promo.redeem'),('manager','dine_in.view'),('manager','dine_in.manage'),('manager','gio_xanh.view'),('manager','gio_xanh.manage'),('manager','customers.view'),('manager','customers.send'),('manager','templates.view'),('manager','promo_config.view'),('manager','assets.view'),('manager','assets.count'),('manager','settings.view'),('manager','templates.manage'),('manager','promo_config.manage'),('manager','dashboard.view'),('manager','finance.view_income'),('manager','finance.view_all'),('manager','finance.create'),('manager','finance.manage'),('manager','assets.manage'),('manager','audit.view'),('manager','users.manage'),('observer','bookings.view'),('observer','finance.view_income')) SELECT 'missing' AS kind, role, permission FROM (SELECT role, permission FROM expected EXCEPT SELECT role, permission FROM role_permissions) UNION ALL SELECT 'extra', role, permission FROM (SELECT role, permission FROM role_permissions EXCEPT SELECT role, permission FROM expected)"
```

Tham chiếu (đã sắp xếp):
- reception (15): `assets.count, assets.view, bookings.manage, bookings.view, customers.send, customers.view, dine_in.manage, dine_in.view, gio_xanh.manage, gio_xanh.view, guests.contact_view, promo.redeem, promo_config.view, settings.view, templates.view`
- manager (25): reception + `assets.manage, audit.view, dashboard.view, finance.create, finance.manage, finance.view_all, finance.view_income, promo_config.manage, templates.manage, users.manage`
- observer (2): `bookings.view, finance.view_income`

Override sau chuyển đổi — tổng hợp. Mong đợi: chỉ vai trò `reception`/`manager`, chỉ `effect = grant`, chỉ 4 mã `rooms.layout`, `finance.create`, `assets.delete`, `bookings.deposit_delete`; `finance.create` chỉ ở `reception`; số lượng khớp các cột SUM ở §4 (trừ `finance_tx` của manager/admin/observer và mọi cờ của admin/observer, vốn không được chuyển):

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT s.role, o.permission, o.effect, COUNT(*) AS n FROM user_permission_overrides o JOIN staff_accounts s ON s.id = o.staff_id GROUP BY s.role, o.permission, o.effect ORDER BY s.role, o.permission"
```

Đối soát cờ ↔ override (**reconciliation query**, dùng lại ở §8) — mong đợi **0 dòng**:

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "WITH expected AS (SELECT id AS staff_id, 'rooms.layout' AS permission FROM staff_accounts WHERE can_manage_room_layout = 1 AND role IN ('reception','manager') UNION ALL SELECT id, 'finance.create' FROM staff_accounts WHERE can_add_finance_transaction = 1 AND role = 'reception' UNION ALL SELECT id, 'assets.delete' FROM staff_accounts WHERE can_delete_asset = 1 AND role IN ('reception','manager') UNION ALL SELECT id, 'bookings.deposit_delete' FROM staff_accounts WHERE can_delete_deposit = 1 AND role IN ('reception','manager')), actual AS (SELECT staff_id, permission FROM user_permission_overrides WHERE effect = 'grant') SELECT 'missing_grant' AS kind, e.staff_id, s.username, s.role, e.permission FROM (SELECT * FROM expected EXCEPT SELECT * FROM actual) e JOIN staff_accounts s ON s.id = e.staff_id UNION ALL SELECT 'extra_grant', a.staff_id, s.username, s.role, a.permission FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) a JOIN staff_accounts s ON s.id = a.staff_id ORDER BY 2"
```

Override bất thường — mong đợi **0 dòng** ngay sau migration:

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT o.staff_id, s.username, s.role, o.permission, o.effect FROM user_permission_overrides o LEFT JOIN staff_accounts s ON s.id = o.staff_id WHERE s.id IS NULL OR s.role IN ('admin','observer') OR o.effect <> 'grant' OR o.permission NOT IN ('rooms.layout','finance.create','assets.delete','bookings.deposit_delete') OR (o.permission = 'finance.create' AND s.role <> 'reception')"
```

Không tài khoản nào bị khoá — mong đợi `0`:

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT COUNT(*) AS locked FROM staff_accounts WHERE locked_at IS NOT NULL OR locked_by IS NOT NULL"
```

Nếu bất kỳ kiểm tra nào lệch → **NO-GO cho merge**, dừng và phân tích (xem §14). Không sửa bằng SQL tay khi chưa quyết định.

---

## 7. Biến môi trường

Đặt trong Cloudflare dashboard → Workers & Pages → `hien-le-garden-v4` → Settings → Variables and Secrets (chọn Production / Preview), hoặc bằng CLI. **Biến/secret của Pages chỉ có hiệu lực từ lần deploy kế tiếp.** Local dev dùng `.dev.vars` (đã bị git-ignore); `.env.example` ở gốc repo liệt kê tên biến.

| Name | Secret or plain | Scope (Production/Preview) | Required | Fail behavior when missing | Set command (placeholder) |
|---|---|---|---|---|---|
| `BREVO_API_KEY` | Secret | Production (**đã có sẵn** — chỉ đặt nếu `pages secret list` không có); Preview chỉ khi có môi trường preview tách DB (§10) | Có (email voucher, gửi email khách) | `sendPromoEmail` nhận lỗi từ Brevo → log `Brevo send failed <status>`; form góp ý **vẫn tạo voucher (201)**, `message_log.status = 'failed'`; gửi email từ trang Khách hàng thất bại | `npx wrangler pages secret put BREVO_API_KEY --project-name=hien-le-garden-v4` (nhập `<brevo-api-key>` khi được hỏi) |
| `TELEGRAM_BOT_TOKEN` | Secret | Production (**đã có sẵn** — chỉ đặt nếu thiếu, tránh gõ nhầm token đang chạy) | Có | Mọi lệnh gửi Telegram lỗi → log `Telegram send failed` / `Telegram send threw`; booking vẫn được tạo nhưng **không có thông báo** cho lễ tân; khách không nhận mã qua deep link | `npx wrangler pages secret put TELEGRAM_BOT_TOKEN --project-name=hien-le-garden-v4` |
| `TELEGRAM_WEBHOOK_SECRET` | Secret (1–256 ký tự `A-Z a-z 0-9 _ -`) | Production | Có | Webhook trả **401 cho mọi update (fail closed)** → deep link khách `/start <id>` và `/start staff_booking_notify` ngừng hoạt động; `getWebhookInfo.last_error_message` báo 401. Thông báo booking mới (gửi đi) **không** bị ảnh hưởng | xem §9 (đọc từ biến, pipe vào `wrangler pages secret put TELEGRAM_WEBHOOK_SECRET`) |
| `TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS` | Không bí mật (chat id) nhưng **đặt bằng `pages secret put`** (xem ghi chú) | Production | Có (nếu muốn đổi nơi nhận) | Rỗng/không đặt → **đổi nơi nhận bị tắt**: `/start staff_booking_notify` bị bỏ qua im lặng; nơi nhận đang lưu trong `notification_settings` vẫn nhận thông báo bình thường | `printf '%s' '<hotel-chat-id>' \| npx wrangler pages secret put TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS --project-name=hien-le-garden-v4` (nhiều id: phân tách bằng dấu phẩy) |
| `TURNSTILE_SITE_KEY` | Public (không bí mật) nhưng **đặt bằng `pages secret put`** (xem ghi chú) | Production; Preview nếu test form ở preview | Có | `/api/public-config` trả `{"turnstileSiteKey": null}` → widget không hiện → không có token → **mọi lần gửi góp ý 403** | `npx wrangler pages secret put TURNSTILE_SITE_KEY --project-name=hien-le-garden-v4` (nhập `<turnstile-site-key>`) |
| `TURNSTILE_SECRET_KEY` | Secret | Production; Preview nếu test form ở preview | Có | `verifyTurnstile` trả false → **`POST /api/feedback` 403 cho mọi request (fail closed)**, trước khi chạm DB/Brevo | `npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name=hien-le-garden-v4` |

Bindings (không phải biến): `DB` → D1 `hien_le_garden_crm`, `RECEIPTS` → R2 `hien-le-garden-finance-receipts`, khai báo trong `wrangler.toml` — xem cảnh báo §10.

Ghi chú:
- **Vì sao đặt cả biến không bí mật bằng `pages secret put`:** `wrangler.toml` có `pages_build_output_dir`, nên Cloudflare Pages coi `wrangler.toml` là nguồn cấu hình cho biến thường (plain vars): biến thường trên dashboard có thể bị khoá hoặc bị thay bằng `[vars]` (hiện không có) ở mỗi lần deploy bằng wrangler → `TURNSTILE_SITE_KEY` rỗng (mọi góp ý 403) hoặc allowlist rỗng (im lặng). Secret không bị ảnh hưởng. Code đọc `env.X` như nhau cho secret và biến thường. (Phương án khác: thêm `[vars]` vào `wrangler.toml` — thay đổi config cần review, chưa làm.)
- **Cổng kiểm tra bắt buộc sau deploy:** `curl -s https://hienlegarden.vn/api/public-config` phải trả `turnstileSiteKey` **khác null**; `npx wrangler pages secret list --project-name=hien-le-garden-v4` phải liệt kê đủ 6 tên.
- `wrangler pages secret put` mặc định ghi vào môi trường **production**. Wrangler 3.114 chấp nhận cờ ẩn `--env preview` (không hiện trong `--help`); nếu không chắc, dùng dashboard → tab Preview.
- Kiểm tra tên (không lộ giá trị): `npx wrangler pages secret list --project-name=hien-le-garden-v4`.
- Không bao giờ dán giá trị thật vào dòng lệnh; nhập khi wrangler hỏi, hoặc pipe từ biến đã `read -s` (§9).

---

## 8. Trình tự deploy (có mốc thời gian)

Thứ tự bắt buộc: **freeze → backup → migrate → deploy ngay → reconcile**. Code mới trên DB chưa migrate = mọi trang admin 500; code cũ trên DB đã migrate = chạy được (0042 chỉ thêm), nên migrate trước.

| Mốc | Việc | Ghi chú |
|---|---|---|
| Trước ngày release | R-1: job "Release artifact boundary (R-1)" xanh trên PR; `deploy.yml` trên nhánh đã là bản build `dist/` → check → `pages deploy dist` | Xem mục R-1. Production hết lộ file ngay ở deploy đầu tiên của artifact sạch (chính lần merge này, hoặc một lần deploy riêng trước đó nếu chủ dự án chọn tách) |
| T−1 ngày | Preflight §4, chuẩn bị giá trị §7, widget Turnstile, soạn sẵn rule WAF §11 (**chưa bật**); ghi lại thời lượng thực tế của một run `deploy.yml` gần nhất (tab Actions) để ước lượng mốc T0 + x; PR đã được duyệt và merge được (không chờ review/required check) | "~5–10 phút" bên dưới chỉ là ước lượng — `deploy.yml` cài wrangler mỗi lần chạy |
| T−30 phút | Đọc nơi nhận hiện tại (READ-ONLY, §9f) và **xác nhận với khách sạn** đó đúng là nhóm của khách sạn; đặt biến/secret production §7 (có hiệu lực ở deploy kế tiếp, code cũ bỏ qua) | Bao gồm `TELEGRAM_WEBHOOK_SECRET`, allowlist = chat id đã xác nhận. Không allowlist một chat chưa xác nhận |
| T−20 phút | Telegram §9 bước a–c: `setWebhook` với `secret_token` (code cũ bỏ qua header) | Kiểm tra `getWebhookInfo` không lỗi |
| T−15 phút | Gửi thông báo freeze §6.1 | |
| T−5 phút | Backup §5 (export + bookmark Time Travel), kiểm tra file | |
| T0 | `migrations apply --remote` §6.2 + kiểm tra §6.3 | Nếu lệch → dừng |
| T0 + ≤5 phút | Merge PR `admin-redesign` → `main` (GitHub UI, "Create a merge commit") → `deploy.yml` tự chạy | Không để khoảng cách dài giữa migrate và merge |
| T0 + ~5–10 phút | Xác nhận deploy xong (bên dưới) | |
| Ngay sau đó | Reconcile: chạy lại truy vấn đối soát §6.3 (mong đợi 0 dòng) + truy vấn "override bất thường" | Dòng nào xuất hiện = có người đổi quyền bằng UI cũ trong cửa sổ → sửa bằng trang Phân quyền mới |
| Tiếp | Probe R-1 (`scripts/probe-private-urls.mjs`, exit 0 trên cả 2 host), `public-config` khác null, Telegram §9 bước d–h, Turnstile check production §10 (phần production), smoke §12 | |
| Sau smoke test | Bật rule WAF §11 (hoặc bật sớm hơn chỉ khi có ngoại lệ cho IP của người vận hành) | Tránh tự chặn IP khách sạn trong lúc smoke test |
| +60 phút | Theo dõi §13; kết thúc freeze bằng tin nhắn "Đã xong bảo trì"; khối "Release accepted" §15 | |

Xác nhận deploy đã xong:

```bash
gh run list --workflow=deploy.yml --branch main --limit 3      # run mới nhất: completed / success
gh run watch <run-id>                                           # hoặc xem tab Actions trên GitHub
npx wrangler pages deployment list --project-name=hien-le-garden-v4 --environment production
```

- Deployment production mới nhất phải có commit = merge commit vừa tạo (hoặc HEAD `main`).
- Trên trình duyệt: mở `https://hienlegarden.vn/admin/login.html` (tải lại cứng), đăng nhập admin → menu mới có mục Phân quyền/Vai trò trong trang Tài khoản.
- **Cổng bắt buộc:** `curl -s https://hienlegarden.vn/api/public-config` → `{"turnstileSiteKey":"<...>"}` (**không null**) chứng tỏ code mới + biến mới đã có hiệu lực. Null → đặt lại `TURNSTILE_SITE_KEY` bằng `pages secret put` (§7) và chạy lại job deploy.
- **Cổng bắt buộc:** `node scripts/probe-private-urls.mjs https://hienlegarden.vn https://hien-le-garden-v4.pages.dev` (mục R-1) → exit 0, `SUMMARY … FAIL=0 INCONCLUSIVE=0`. Exit 3 (INCONCLUSIVE, ví dụ lỗi mạng) **không** phải PASS: chạy lại. Trong log run `deploy.yml`, bước "Boundary check dist/" phải in `PASS` trước bước deploy.

---

## 9. Telegram — trình tự không gián đoạn

Nguyên lý: code cũ **không** đọc header `X-Telegram-Bot-Api-Secret-Token`; code mới **bắt buộc** header khớp. Vì vậy đăng ký `secret_token` với Telegram **trước** deploy: trong khoảng giữa, code cũ vẫn nhận update (bỏ qua header); ngay khi code mới lên, header đã có sẵn.

Vệ sinh shell (áp dụng cho cả mục này). Các lệnh dưới đây dành cho **bash** (Git Bash, WSL, Linux; trên macOS chạy `bash` trước — zsh dùng `setopt HIST_IGNORE_SPACE` và `read -s "?prompt"`):

```bash
export HISTCONTROL=ignorespace:ignoredups   # lệnh bắt đầu bằng dấu cách sẽ không vào history
umask 077
# Không bao giờ: echo "$TG_TOKEN", set -x, dán secret vào URL gõ tay, lưu vào file trong repo.
```

(a) Nhập token bot và sinh secret (chỉ gồm ký tự hợp lệ `A-Z a-z 0-9 _ -`; hex thoả điều kiện):

```bash
 read -rs -p "Telegram bot token: " TG_TOKEN; echo
 TG_SECRET="$(openssl rand -hex 32)"
```

Lưu `TG_SECRET` vào trình quản lý mật khẩu (dán trực tiếp từ clipboard nếu cần: `printf '%s' "$TG_SECRET" | clip.exe` trên WSL / `pbcopy` trên macOS — không in ra màn hình). Trên Windows, lịch sử clipboard (Win+V, đồng bộ đám mây) có thể giữ secret: xoá lịch sử clipboard sau khi dán.

(0) Ghi lại URL webhook hiện tại (để dùng lại đúng URL):

```bash
 printf 'url = "https://api.telegram.org/bot%s/getWebhookInfo"\n' "$TG_TOKEN" | curl -sS -K -
```

Token được đưa vào curl qua `-K -` (stdin), không nằm trong tham số dòng lệnh nên không lộ trong `ps`/history. Mong đợi `"url":"https://hienlegarden.vn/api/telegram/webhook"` (hoặc domain production thật đang dùng). Ghi lại cả `max_connections`, `ip_address`, `allowed_updates` nếu có — `setWebhook` đặt lại các giá trị không truyền về mặc định, nên nếu khác mặc định phải truyền lại ở bước (c).

(b) Đặt secret cho production (có hiệu lực ở lần deploy kế tiếp):

```bash
 printf '%s' "$TG_SECRET" | npx wrangler pages secret put TELEGRAM_WEBHOOK_SECRET --project-name=hien-le-garden-v4
```

Đồng thời đặt allowlist `TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS = <hotel-chat-id>` bằng `pages secret put` (§7). Giá trị lấy **ngay bây giờ (T−30)** bằng truy vấn READ-ONLY ở bước (f), rồi **xác nhận với khách sạn** (ví dụ gửi tin thử vào nhóm hoặc so với chat id admin đã biết) rằng đó đúng là nhóm của khách sạn. Nếu không xác nhận được (có thể nơi nhận đã bị chiếm trước bản fix) → **không** đưa id đó vào allowlist; dùng chat id đã biết chắc của khách sạn.

(c) Đăng ký lại webhook với cùng `secret_token` — **trước khi deploy**:

```bash
 printf 'url = "https://api.telegram.org/bot%s/setWebhook"\n' "$TG_TOKEN" \
   | curl -sS -K - \
       --data-urlencode "url=https://hienlegarden.vn/api/telegram/webhook" \
       --data-urlencode "secret_token=$TG_SECRET"
```

Mong đợi `{"ok":true,"result":true,"description":"Webhook was set"}`. Lưu ý: `secret_token` nằm trong tham số `--data-urlencode` (thấy được trong `ps` trên máy nhiều người dùng trong tích tắc). Nếu máy dùng chung, ghi tham số vào file tạm quyền 600 rồi dùng `curl -K <file>` và xoá file ngay sau đó:

```bash
 F="$(mktemp)"; chmod 600 "$F"
 printf 'url = "https://api.telegram.org/bot%s/setWebhook"\ndata-urlencode = "url=https://hienlegarden.vn/api/telegram/webhook"\ndata-urlencode = "secret_token=%s"\n' "$TG_TOKEN" "$TG_SECRET" > "$F"
 curl -sS -K "$F"; shred -u "$F" 2>/dev/null || rm -f "$F"
```

Kiểm tra lại `getWebhookInfo` (bước 0): `url` đúng, `last_error_message` rỗng hoặc lỗi cũ (thời điểm `last_error_date` trước bước c). Lưu ý: `getWebhookInfo` **không** cho biết `secret_token` đã được đặt hay chưa — bằng chứng thành công ở bước này chỉ là `"ok":true` của `setWebhook`; xác nhận thật là ở bước (e) sau deploy (không có 401).

(d) Deploy (merge vào `main`, §8).

(e) Sau deploy, `getWebhookInfo`:
- `url` = `https://hienlegarden.vn/api/telegram/webhook`
- `pending_update_count` = 0 hoặc giảm dần (không tăng mãi)
- `last_error_message` không chứa `401 Unauthorized` với `last_error_date` sau thời điểm deploy. Nếu có 401 → secret đã đặt ≠ secret đã đăng ký: lặp lại (b) + (c) với cùng một giá trị và deploy lại (biến chỉ có hiệu lực khi deploy); hoặc chỉ lặp lại (c) với giá trị đã đặt ở (b).

(f) Nơi nhận thông báo đặt phòng vs allowlist (READ-ONLY):

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT id, booking_notify_chat_id, updated_at FROM notification_settings ORDER BY id DESC LIMIT 1"
```

Giá trị phải là chat id của nhóm khách sạn và nằm trong `TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS`. Nếu khác (có thể đã bị chiếm trước bản fix): từ nhóm khách sạn gửi `/start staff_booking_notify` cho bot (giờ chỉ chat trong allowlist mới đổi được) và kiểm tra audit `notification_destination_change`.

(g) Tạo booking test (§12) → thông báo đến **đúng** nhóm khách sạn.

(h) Deep link khách: gửi góp ý test có chọn Telegram (§12) → bấm link mở bot → bot gửi mã voucher; `message_log` có dòng `channel='telegram'`, `status='success'`.

Kết thúc: `unset TG_TOKEN TG_SECRET`.

---

## 10. Turnstile — kiểm tra trên preview, và cảnh báo binding

### CẢNH BÁO: preview dùng DB/R2 production

`wrangler.toml` khai báo `[[d1_databases]]` (`hien_le_garden_crm`, id `bf3ed73c-…`) và `[[r2_buckets]]` (`hien-le-garden-finance-receipts`) ở cấp cao nhất, không có `[env.preview]`. Với Pages, cấu hình này áp dụng cho **mọi môi trường**, nên một preview deployment (ví dụ `wrangler pages deploy dist --branch=admin-redesign`) sẽ:
- chạy **code mới trên DB production** — nếu 0042 chưa migrate: mọi route có đăng nhập 500 (không có bảng `role_permissions`, không có cột `locked_at`);
- khi test form góp ý: tạo **voucher thật**, gửi **email thật** qua Brevo, ghi `message_log` thật; test booking tạo booking thật + Telegram thật.

Do đó **không** deploy preview của nhánh này lên project hiện tại cho tới khi preview có binding riêng. Thiết kế chi tiết và khuyến nghị (phương án `[env.preview]` trong cùng project, đã kiểm chứng trong mã wrangler; guard so sánh DB id staging ≠ production): [staging-isolation.md](staging-isolation.md). Tóm tắt các lựa chọn (không tạo gì trong release này — người dùng quyết định):

1. **(Khuyến nghị) `[env.preview]` trong cùng project** — chi tiết ở [staging-isolation.md](staging-isolation.md). Tạo D1 `hien_le_garden_crm_staging` và R2 `hien-le-garden-finance-receipts-staging`; thêm khối `[env.preview]` với `d1_databases`/`r2_buckets` riêng vào `wrangler.toml` (**thay đổi cấu hình cần duyệt**, chưa làm trong release này).
   - **Không** gán binding trên Dashboard: khi `wrangler.toml` có `pages_build_output_dir`, file này là nguồn sự thật, dashboard chỉ xem (đã kiểm chứng). `d1_databases`/`r2_buckets` không kế thừa từ cấp cao nhất.
   - Cổng bắt buộc trước mọi test preview: `node scripts/check-staging-bindings.mjs` phải exit 0 (hôm nay exit 2 = preview dùng binding production). Khi chưa có `[env.preview]`, cờ `--env preview` **lặng lẽ dùng binding PRODUCTION** (cli.js ~86633–86646): không chạy lệnh remote nào có `--env preview` trừ khi guard vừa exit 0.
   - Migrations staging: `npx wrangler d1 migrations apply hien_le_garden_crm_staging --env preview --remote`. **Không bao giờ** dùng binding `DB` hay tên `hien_le_garden_crm` mà không có `--env preview` (đó là D1 production).
   - Secret preview: đặt lại **mọi** secret bằng `npx wrangler pages secret put <NAME> --project-name=hien-le-garden-v4 --env preview` (checklist ở staging-isolation.md §4). `pages secret put` **không có `--env` ghi vào production**. Bot Telegram staging riêng; **không** đặt `BREVO_API_KEY` (gửi thất bại an toàn, không giả định Brevo có sandbox); Turnstile = widget staging riêng hoặc key test.
2. **Project staging riêng** (ví dụ `hien-le-garden-v4-staging`): D1/R2 riêng; deploy từ một `git clone` **sạch** vào thư mục tạm trống (không phải thư mục làm việc, `git status --ignored` không có gì thêm), sửa `wrangler.toml` trong bản clone đó trỏ tới DB/bucket staging, rồi `npm run build && npm run check:dist && npx wrangler pages deploy dist --project-name=hien-le-garden-v4-staging`. Không commit `wrangler.toml` đã sửa. Cảnh báo: deploy project staging bằng `wrangler.toml` của repo (không sửa) sẽ gắn **binding production** vào staging (wrangler 3.114 `pages deploy` không nhận `--config`).
3. **Chỉ test local**: `npm run dev` (build `dist/` rồi `wrangler pages dev dist`) với D1 local (`wrangler d1 migrations apply hien_le_garden_crm --local`), `.dev.vars` chứa key test Cloudflare hoặc site key/secret của **widget staging riêng** có hostname `localhost` (không dùng widget production), **không** có `BREVO_API_KEY` (email sẽ log `failed`, voucher vẫn tạo local). Không chạm production. Xoá `.dev.vars` (hoặc thay secret thật bằng test key) sau khi test xong; `.dev.vars` không bao giờ vào `dist/` (không được track), nhưng vẫn không deploy từ máy local.

### Checklist Turnstile (chạy trên preview đã tách binding, staging, hoặc local; phần "production" chạy sau deploy)

Widget Turnstile **production** (dashboard → Turnstile): chỉ `hienlegarden.vn`, `www.hienlegarden.vn`. **Không bao giờ** thêm hostname preview/`*.pages.dev`/`localhost` vào widget production, kể cả tạm thời: `lib/turnstile.js` không kiểm `hostname` trong kết quả siteverify, nên site key production dùng được ở `localhost` = ai cũng lấy được token hợp lệ cho production. Test ở preview/staging/local dùng **widget staging riêng** (hostname `hien-le-garden-v4.pages.dev` — Turnstile tự cho phép mọi subdomain — và/hoặc `localhost`), hoặc key test của Cloudflare (site `1x00000000000000000000AA` / secret `1x0000000000000000000000000000000AA` luôn pass; `2x…` luôn fail) — chỉ trong `.dev.vars` hoặc secret `--env preview`, không bao giờ ở production.

| # | Kiểm tra | Mong đợi | PASS/FAIL |
|---|---|---|---|
| 1 | `GET /api/public-config` | `{"turnstileSiteKey":"<site key đúng>"}`, `Cache-Control: no-store` | |
| 2 | Mở `/tri-an-khach-hang/` | Widget hiện trong `#turnstileWidget`, không lỗi console "invalid domain"/"invalid sitekey" | |
| 3 | Gửi form hợp lệ | 201, trả mã voucher; đúng **1** dòng `feedback_responses` mới | |
| 4 | Email (nếu có Brevo ở môi trường này) | Nhận email voucher; `message_log` `channel='email'`, `status='success'` | |
| 5 | Gửi lại cùng SĐT/email khi voucher còn hiệu lực (token mới) | **409**, thông báo "Bạn đã nhận ưu đãi…", không có mã, không có email, không có dòng mới | |
| 6 | POST thiếu `turnstileToken` (curl) | 403 "Xác minh chống spam không thành công…" | |
| 7 | Token sai (`turnstileToken: "invalid"`) | 403 | |
| 8 | Dùng lại token đã dùng ở #3 | 403 (siteverify từ chối token dùng lại) | |
| 9 | Token hết hạn (để widget > 5 phút rồi gửi, hoặc token cũ) | 403 | |
| 10 | Fail closed: môi trường thiếu `TURNSTILE_SECRET_KEY` | 403 với mọi request; không có dòng DB mới | |
| 11 | Body sai JSON | 400 | |

Mẫu curl cho #6–#7 (không tạo dữ liệu vì bị chặn trước DB; thay `<host>`):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "https://<host>/api/feedback" -H "Content-Type: application/json" --data '{"guestName":"TEST","phone":"0900000000","rating":5,"consentGiven":true,"wantsTelegram":true}'
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "https://<host>/api/feedback" -H "Content-Type: application/json" --data '{"guestName":"TEST","phone":"0900000000","rating":5,"consentGiven":true,"wantsTelegram":true,"turnstileToken":"invalid"}'
```

---

## 11. Đề xuất WAF rate limiting

**Thời điểm bật:** sau khi smoke test §12 xong (smoke test gửi khoảng 10–15 POST login/2FA từ một IP trong vài phút — vượt ngưỡng dưới đây và sẽ chặn cả nhân viên/khách dùng chung IP khách sạn trong 10 phút). Nếu muốn bật trước, thêm ngoại lệ (skip) cho IP của người vận hành trong khung release và gỡ ngay sau đó.

**So khớp đường dẫn:** dùng tiền tố (`starts_with(http.request.uri.path, "/api/bookings")`) hoặc `matches`, không dùng so sánh bằng — `/api/bookings/` (thêm dấu `/`) hay đường dẫn khác hoa/thường có thể lọt qua phép so sánh `eq`. Query string không nằm trong `http.request.uri.path` nên không ảnh hưởng. Lưu ý tiền tố `/api/bookings` với method POST cũng khớp các POST của nhân viên dưới `/api/bookings/<id>/...` (xác nhận, nhận phòng…) — chấp nhận được với ngưỡng theo IP ở giờ thấp điểm, hoặc dùng `matches "^/api/bookings/?$"` nếu gói hỗ trợ regex.

Khả năng rate limiting của Cloudflare (số rule, khoảng thời gian đếm, đặc tính đếm như IP/header, thời gian chặn, kiểu hành động) **phụ thuộc gói** của zone `hienlegarden.vn`. Trước khi cấu hình, mở Security → WAF → Rate limiting rules và xem các giá trị được phép; điều chỉnh bảng dưới cho khớp. Không coi các con số dưới đây là giới hạn gói.

| Path | Method | Suggested threshold | Window | Key | Action | Rationale |
|---|---|---|---|---|---|---|
| `/api/auth/login` (tiền tố) | POST | 10 requests | 10 phút | IP | Block 10 phút | Vài nhân viên, thường đăng nhập 1–2 lần/ca; 10 cho phép gõ sai vài lần kể cả khi nhiều máy lễ tân chung một IP NAT; đủ chặn dò mật khẩu |
| `/api/auth/verify-2fa` (tiền tố) | POST | 10 requests | 10 phút | IP | Block 10 phút | Code đã giới hạn 5 mã sai/token; WAF chặn việc xin token mới liên tục để dò tiếp |
| `/api/feedback` (tiền tố) | POST | 5 requests | 10 phút | IP | Block 10 phút | Khách thật gửi 1 lần (lần 2 đã bị 409); 5 chừa chỗ cho lỗi mạng/Turnstile; hạn chế relay email |
| `/api/bookings` (`^/api/bookings/?$` nếu có regex, không thì tiền tố) | POST | 5 requests | 10 phút | IP | Block 10 phút | Khách đặt 1–2 yêu cầu; chặn spam booking + Telegram. `GET /api/bookings` là của nhân viên, không nằm trong rule |

Lưu ý:
- Khách dùng 4G có thể chung IP (CGNAT). Nếu lễ tân báo khách bị chặn, nâng ngưỡng feedback/booking lên 10.
- "Managed Challenge" không hữu ích cho `fetch()` JSON (trình duyệt không giải được challenge trong fetch) — với API nên dùng Block.
- Nếu gói cho phép chọn thời gian đếm ngắn hơn (ví dụ chỉ 10 giây/1 phút), quy đổi tương ứng (ví dụ 3 request/1 phút) và ghi rõ vào biên bản.

Phương án khi chỉ có **1 rule**: gộp 4 đường dẫn, đếm chung theo IP:

```
(http.request.method eq "POST" and (starts_with(lower(http.request.uri.path), "/api/auth/login") or starts_with(lower(http.request.uri.path), "/api/auth/verify-2fa") or starts_with(lower(http.request.uri.path), "/api/feedback") or starts_with(lower(http.request.uri.path), "/api/bookings")))
```

(Nếu trình soạn biểu thức của gói không hỗ trợ `lower()`/`starts_with()`, dùng `matches` với regex tương đương hoặc liệt kê cả dạng có `/` cuối.)

Ngưỡng đề xuất: 15 request / 10 phút / IP, Block 10 phút (đăng nhập + 2FA của một ca vài người ≈ 4–8 request; một khách góp ý + đặt phòng ≈ 2–3). Hạn chế: đếm chung nên nhân viên thử sai nhiều ở quầy có thể tự chặn cả booking từ cùng IP (hiếm).

Kiểm tra sau khi bật: Security → Events lọc theo rule; không có sự kiện chặn IP của khách sạn trong giờ làm việc.

---

## 12. Smoke test production (PASS/FAIL)

Dùng tài khoản test riêng khi có thể — **[TẠO DỮ LIỆU: dòng `staff_accounts` + audit]** (tạo bằng admin, đặt tên `test-release-<ngày>`, xoá ở cuối). Trang góp ý bị service worker (`sw.js`) cache: test form trong **cửa sổ ẩn danh** hoặc tải lại cứng, nếu không lần tải đầu có thể là trang cũ không có widget → 403. WAF chưa bật trong lúc smoke test (§11). Bài test tạo dữ liệu production được đánh dấu **[TẠO DỮ LIỆU]** kèm cách dọn. Không chụp màn hình có SĐT/email khách.

### Lộ file repo (R-1)

| # | Kiểm tra | Mong đợi | PASS/FAIL |
|---|---|---|---|
| R1 | `node scripts/probe-private-urls.mjs https://hienlegarden.vn https://hien-le-garden-v4.pages.dev` (mục R-1) | exit 0: `FAIL=0 INCONCLUSIVE=0` (riêng tư: 404/410 hoặc 200 với body = trang fallback `/`; public: 200 đúng nội dung) | |

### Xác thực

| # | Kiểm tra | Mong đợi | PASS/FAIL |
|---|---|---|---|
| A1 | Admin đăng nhập (có 2FA nếu bật) | Vào được, thấy mọi menu | |
| A2 | Nhập sai mật khẩu 1 lần | 401, thông báo lỗi, không khoá | |
| A3 | 2FA: nhập sai mã 5 lần liên tiếp | 4 lần đầu báo còn lượt; lần 5 buộc đăng nhập lại (token chờ bị huỷ) | |
| A4 | Manager, reception, observer đăng nhập | Vào được, menu đúng quyền vai trò | |
| A5 | Đăng xuất | Session hết, về trang login | |

### Phân quyền

| # | Kiểm tra | Mong đợi | PASS/FAIL |
|---|---|---|---|
| P1 | Admin mở Tài khoản → tab Vai trò | Thấy 3 vai trò với 15/25/2 quyền | |
| P2 | Observer mở trực tiếp URL trang Tài sản/Khách hàng | Bị chặn (không có dữ liệu), API 403 | |
| P3 | Override: admin cấp `rooms.layout` cho tài khoản test reception | Tài khoản test sắp xếp được sơ đồ phòng; gỡ override → mất quyền (có thể cần tải lại trang) | |
| P4 | Override deny: admin chặn `customers.view` cho tài khoản test | Menu Khách hàng biến mất, API 403; gỡ deny sau test | |
| P5 | Hierarchy: manager thử đổi vai trò/khoá một manager khác | 403 | |
| P6 | Hierarchy: manager tạo tài khoản vai trò manager | 403 (chỉ admin) | |
| P7 | Chỉ admin sửa bảng quyền vai trò | Manager không thấy/không lưu được (403) | |
| P8 | Người giữ cờ cũ (danh sách §4) | Vẫn có quyền tương ứng (ví dụ xoá cọc) | |

### Khoá / mở khoá **[TẠO DỮ LIỆU: audit]**

| # | Kiểm tra | Mong đợi | PASS/FAIL |
|---|---|---|---|
| L1 | Admin khoá tài khoản test | Session của tài khoản test bị đá ra (request kế tiếp 401); đăng nhập bị từ chối | |
| L2 | Manager thử mở khoá tài khoản do admin khoá | 403 | |
| L3 | Admin mở khoá | Tài khoản test đăng nhập lại được | |

### Đặt phòng

| # | Kiểm tra | Mong đợi | PASS/FAIL |
|---|---|---|---|
| B1 | Body quá lớn (không tạo dữ liệu) | **413** | |
| B2 | **[TẠO DỮ LIỆU]** Đặt phòng từ trang chủ, tên `TEST RELEASE <giờ>`, SĐT test của khách sạn, ghi chú "TEST — xoá" | 201; Telegram đến đúng nhóm khách sạn | |
| B3 | Nhân viên: xác nhận → nhận phòng → trả phòng trên booking test (hoặc: xác nhận → huỷ) | Mỗi bước thành công 1 lần; bấm lặp nhanh không tạo trạng thái sai | |
| B4 | Dọn: huỷ (nếu chưa) rồi Ẩn booking test (người có `records.hide`) | Booking biến khỏi lịch sử; tài khoản không có `records.hide` mở theo id → 404 | |

Lệnh B1 (tạo body ~20 KiB, không ghi DB vì bị chặn trước khi parse):

```bash
PAD="$(head -c 20000 /dev/zero | tr '\0' 'a')"
printf '{"guestName":"TEST","phone":"0900000000","notes":"%s"}' "$PAD" \
  | curl -sS -o /dev/null -w "%{http_code}\n" -X POST "https://hienlegarden.vn/api/bookings" -H "Content-Type: application/json" --data-binary @-
# mong đợi: 413
```

Lưu ý: booking test có thể được tính vào báo cáo (doanh thu 0 nếu huỷ trước check-in). Ưu tiên chuỗi xác nhận → huỷ; chỉ làm check-in/check-out nếu không phát sinh thu chi.

### Góp ý / voucher **[TẠO DỮ LIỆU: voucher + email thật]**

| # | Kiểm tra | Mong đợi | PASS/FAIL |
|---|---|---|---|
| F1 | Mục 1–2, 6–7 của checklist §10 trên production | Như §10 | |
| F2 | Gửi góp ý bằng SĐT/email nội bộ khách sạn, chọn Telegram | 201, mã voucher; email đến; deep link Telegram gửi mã (§9h) | |
| F3 | Gửi lại cùng SĐT | 409, không mã mới | |

Dọn: không xoá bằng SQL. Ghi id feedback test vào biên bản; voucher tự hết hạn theo chính sách. Nếu cần vô hiệu ngay → quyết định riêng (không có trong runbook).

### Thu chi / order / Giờ Xanh (không phá huỷ)

| # | Kiểm tra | Mong đợi | PASS/FAIL |
|---|---|---|---|
| O1 | Manager mở Sổ thu chi | Thấy thu + chi + cân đối | |
| O2 | Observer mở Sổ thu chi | Chỉ phần thu | |
| O3 | Reception không có `finance.create` | Không có nút thêm giao dịch; reception có cờ cũ (§4) thì có | |
| O4 | Mở danh sách order ăn uống, chi tiết 1 order đã đóng | Hiển thị đúng, không lỗi | |
| O5 | Mở Giờ Xanh, chi tiết 1 phiên | Hiển thị đúng | |
| O6 | Mở 1 chứng từ thu chi (R2) | Tải được file | |

### Nhật ký thao tác

| # | Kiểm tra | Mong đợi | PASS/FAIL |
|---|---|---|---|
| U1 | Lọc `account_lock`, `account_unlock`, `user_permissions_change` | Thấy các thao tác ở P3/P4/L1/L3 với đúng người thực hiện | |
| U2 | Lọc `notification_destination_change` | Có dòng nếu đã đổi nơi nhận ở §9f | |
| U3 | Không có mật khẩu/token/secret trong cột giá trị | Đúng | |

Dọn cuối: gỡ mọi override test, xoá tài khoản test (người dùng `users.manage`), xác nhận bằng truy vấn đối soát §6.3 (các dòng `extra_grant` còn lại chỉ là thay đổi hợp lệ đã ghi nhận).

---

## 13. Theo dõi 30–60 phút đầu

Log realtime (chỉ đọc; không lưu file log chứa SĐT/email ra ngoài máy, không bật log body):

```bash
npx wrangler pages deployment tail --project-name=hien-le-garden-v4 --environment production --format pretty
# lọc lỗi:
npx wrangler pages deployment tail --project-name=hien-le-garden-v4 --environment production --status error
# lọc chuỗi cụ thể:
npx wrangler pages deployment tail --project-name=hien-le-garden-v4 --environment production --search "Telegram send failed"
```

(Kiểm tra cờ bằng `npx wrangler pages deployment tail --help` nếu phiên bản wrangler khác.) Dashboard: Workers & Pages → project → Deployments → deployment production → Functions → Real-time logs.

Theo dõi:
- [ ] HTTP 5xx: mong đợi 0. Nhiều 500 trên `/api/*` có đăng nhập → nghi thiếu migration/`D1_ERROR` → §14.
- [ ] 401/403 tăng đột biến: 401 trên `/api/telegram/webhook` → secret lệch (§9e); 403 trên `/api/feedback` → Turnstile (§10); 403 trên trang admin → quyền vai trò/override (so với §6.3).
- [ ] 404 tăng trên by-id admin → người dùng thiếu `records.hide` với bản ghi ẩn (đúng thiết kế) hoặc bookmark link cũ.
- [ ] Chuỗi log: `Telegram send failed`, `Telegram send threw`, `Brevo send failed`, `Brevo send threw`, `Turnstile siteverify HTTP error`, `Turnstile siteverify failed`, `Telegram webhook error`, `D1_ERROR`.
- [ ] Telegram `getWebhookInfo` sau 15 và 60 phút (§9e).

Đếm khối lượng (READ-ONLY, không lấy cột PII):

```bash
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT COUNT(*) AS bookings_last_hour FROM bookings WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')"
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT COUNT(*) AS feedback_last_hour FROM feedback_responses WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')"
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT channel, status, COUNT(*) AS n FROM message_log WHERE sent_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour') GROUP BY channel, status"
npx wrangler d1 execute hien_le_garden_crm --remote --command "SELECT action_type, COUNT(*) AS n FROM audit_log WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour') GROUP BY action_type ORDER BY n DESC"
```

(`created_at`/`sent_at` được lưu dạng ISO UTC từ `new Date().toISOString()`; so sánh chuỗi hoạt động đúng với định dạng này.) So với lượng bình thường; booking/feedback = 0 trong giờ cao điểm là dấu hiệu form hỏng.

---

## 14. Rollback / roll-forward

Nguyên tắc:
- 0042 **chỉ thêm** (CREATE/ALTER ADD/INSERT). Code cũ (`9675840`) chạy được trên schema mới → **không bao giờ cần rollback DB** vì lý do schema.
- **Ưu tiên roll-forward** (sửa nhỏ + deploy lại) khi code mới đã được dùng.
- Rollback code về `9675840` **sau khi** người dùng đã thao tác bằng code mới là **hồi quy bảo mật**: code cũ không lọc `locked_at` (tài khoản bị khoá đăng nhập lại được), bỏ qua override deny và chỉnh sửa bảng quyền vai trò, observer lấy lại quyền cũ, 4 cờ cũ (không được code mới cập nhật) sống lại với giá trị trước migration; webhook Telegram lại không xác thực; form góp ý lại không có Turnstile; FA-1..FA-5 mở lại.
- Nếu buộc phải rollback code: trước đó đổi mật khẩu các tài khoản đang bị khoá (thay cho khoá), đồng bộ 4 cờ cũ theo override hiện tại qua UI cũ ngay sau rollback, và ghi biên bản.
- Rollback code: Cloudflare dashboard → Workers & Pages → project → Deployments → deployment production trước đó → "Rollback to this deployment" (nhanh nhất), hoặc `git revert -m 1 <merge-commit>` rồi push lên `main` (qua PR). Nếu revert merge, lần merge lại sau này cần revert-của-revert (nếu không git coi các commit cũ đã có mặt). Kiểm tra biến môi trường sau rollback (deployment cũ không dùng các biến mới, không hại).
- **Không bao giờ deploy tay từ máy local.** Không bao giờ `wrangler pages deploy .` (publish cả thư mục repo — R-1). `npm run deploy` chỉ deploy `dist/` (file được track) nhưng dùng nội dung working tree và, nếu chạy từ nhánh khác `main`, tạo preview trên DB production. Cách deploy lại duy nhất: chạy lại job GitHub Actions (`gh run rerun <run-id>` hoặc nút "Re-run jobs" trong tab Actions), hoặc push/merge commit mới lên `main`.
- **Rollback và R-1:** mọi deployment production **trước** lần deploy `dist/` đầu tiên vẫn chứa file repo riêng tư. "Rollback to this deployment" về một deployment như vậy làm lộ lại toàn bộ file R-1 (và URL `<hash>.hien-le-garden-v4.pages.dev` của chúng luôn còn truy cập được). Nếu phải rollback code về trước release này, ưu tiên `git revert` + deploy qua CI (vẫn build `dist/`) thay vì rollback trên dashboard; nếu buộc phải rollback trên dashboard, ghi nhận là lộ lại R-1 và roll-forward sớm.
- Time Travel restore chỉ khi dữ liệu bị hỏng — mất mọi ghi sau bookmark. Restore về bookmark trước 0042 **sau khi đã deploy** cũng xoá bảng/cột 0042 và dòng 0042 trong `d1_migrations` → code mới trả 500: phải rollback code trước, hoặc áp dụng lại 0042 ngay sau restore.

| Failure point | Safe action | DB rollback needed? | Code rollback safe? | Data reconciliation |
|---|---|---|---|---|
| Migration lỗi trước deploy | Không merge. Code cũ tiếp tục chạy. Kiểm tra trạng thái bằng §6.3 (`sqlite_master`, `PRAGMA table_info`, `d1_migrations`). Nếu áp dụng dở dang: phân tích, rồi chọn (a) hoàn tất thủ công các câu lệnh còn thiếu và ghi `d1_migrations`, hoặc (b) Time Travel restore về bookmark §5 (freeze đang bật nên mất ít ghi) | Chỉ khi áp dụng dở dang và chọn (b) | Không cần (chưa deploy) | So số booking/order trước–sau nếu restore |
| Migration OK, deploy lỗi (Actions đỏ) | Code cũ vẫn chạy trên schema mới (an toàn). Giữ freeze. Sửa nguyên nhân (secret Actions, lỗi mạng) → chạy lại job (`gh run rerun <id>` / "Re-run jobs"). **Không** deploy từ máy local | Không | Không liên quan | Chạy đối soát §6.3 ngay trước khi deploy lại (bắt thay đổi cờ bằng UI cũ) |
| Deploy OK, smoke test lỗi | Phân loại: lỗi hiển thị/1 quyền → sửa quyền bằng trang Phân quyền hoặc roll-forward fix. Lỗi 500 diện rộng → kiểm tra 0042 + log; nếu không sửa được trong 30 phút và chưa ai đổi quyền/khoá bằng code mới → rollback code chấp nhận được | Không | Có điều kiện: an toàn **chỉ khi** chưa có khoá/deny/sửa bảng vai trò bằng code mới (kiểm tra `audit_log` action `account_lock`, `user_permissions_change`, `role_permissions_change`) | Sau rollback: đối chiếu cờ cũ với override |
| Telegram lỗi (401 trong getWebhookInfo, không có thông báo) | Roll-forward: đặt lại secret = giá trị đã đăng ký (§9b) + deploy lại, hoặc `setWebhook` lại với secret đang có (§9c). Token sai → đặt lại `TELEGRAM_BOT_TOKEN` + deploy | Không | Không cần; rollback chỉ vì Telegram là không tương xứng | Update Telegram bị 401 sẽ được Telegram gửi lại trong một thời gian; kiểm tra `pending_update_count`; hỏi lễ tân booking nào không có thông báo (xem trang Lễ tân) |
| Turnstile lỗi (mọi góp ý 403) | Roll-forward: kiểm tra `public-config`, hostname widget, cặp site/secret key, deploy lại sau khi sửa biến. Tạm thời: lễ tân ghi nhận góp ý thủ công | Không | Không nên (mở lại relay email) | Không có dữ liệu sai; chỉ mất lượt góp ý trong thời gian lỗi |
| Admin/phân quyền lỗi (admin không đăng nhập được, quyền sai) | Admin khác đăng nhập sửa; kiểm tra `locked_at` của admin, `role_permissions` (§6.3). Không có admin nào vào được → sửa bằng SQL có kiểm soát (quyết định tại chỗ, có biên bản) hoặc roll-forward | Không | Chỉ khi chưa có thay đổi bảo mật bằng code mới | Ghi lại mọi sửa SQL tay vào biên bản |
| Phát hiện lỗi sau khi người dùng đã thay đổi bảo mật bằng code mới (khoá, deny, sửa vai trò) | **Roll-forward** (fix + deploy). Không rollback code | Không | **Không** — hồi quy bảo mật (xem trên) | Không cần |

Tiêu chí STOP / GO trong quá trình:
- STOP trước migrate: không có admin đăng nhập được; backup rỗng hoặc không có DDL của `staff_accounts` (grep §5, chấp nhận tên có nháy kép); `migrations list` còn file khác ngoài 0042; R-1 chưa sửa.
- STOP trước merge: bất kỳ kiểm tra §6.3 nào lệch; migration lỗi.
- ROLLBACK xem xét (≤30 phút sau deploy): 5xx diện rộng không giải thích được **và** chưa có thay đổi bảo mật bằng code mới.
- Ngoài các trường hợp trên: roll-forward.

---

## 15. GO / NO-GO

GO chỉ khi tất cả đều ✓:

- [ ] **R-1:** job "Release artifact boundary (R-1)" xanh trên PR (build + check + self-test); `deploy.yml` là bản `pages deploy dist`. Production chỉ hết lộ sau deploy — kiểm ở khối "Release accepted".
- [ ] Pages production branch = `main`; project là Direct Upload (không có Git integration — nếu có, việc push nhánh/mở PR tự build preview trên DB production).
- [ ] PR đã được duyệt và merge được ngay trước khi migrate: mọi required check (`Release artifact boundary (R-1)`, `test`) **đã xanh**, không còn chờ review.
- [ ] Branch protection `main` yêu cầu 2 check trên (§2), hoặc chủ dự án ghi nhận quyết định chưa bật.
- [ ] `CLOUDFLARE_API_TOKEN` (repo secret) còn hiệu lực — run `deploy.yml` gần nhất thành công; đã ghi thời lượng run.
- [ ] Linux gate: 79/79 migrations + 80 files/1488 tests PASS isolated; R2 tests: Linux non-isolated PASS 53/53; isolated mode blocked by test-library limitation; upgrade deferred (§3); run `test.yml` trên PR xanh (gồm bước R2 non-isolated chặn).
- [ ] PR `admin-redesign` → `main` đã review, không có commit ngoài phạm vi.
- [ ] Preflight §4: ≥1 admin đăng nhập được (đã thử), 2FA sẵn sàng.
- [ ] 6 biến §7 đã đặt cho Production (kiểm tra bằng `pages secret list` + dashboard).
- [ ] Telegram §9 a–c xong: `setWebhook` với `secret_token` OK, `getWebhookInfo` không lỗi mới.
- [ ] Widget Turnstile có hostname production; checklist §10 đã chạy trên môi trường **không** dùng DB production (hoặc quyết định chỉ kiểm tra trên production sau deploy).
- [ ] Rule WAF §11 đã soạn sẵn, sẽ bật sau smoke test (hoặc có ngoại lệ IP người vận hành; hoặc quyết định hoãn có ghi nhận).
- [ ] Không có preview deployment nào của nhánh này trên project production.
- [ ] Freeze đã thông báo và được xác nhận.
- [ ] Backup §5 hợp lệ + bookmark Time Travel đã ghi.
- [ ] Người vận hành rảnh 60 phút sau deploy; lễ tân biết khung bảo trì.

NO-GO nếu bất kỳ mục nào ở trên chưa đạt, hoặc: đang cao điểm khách, không liên lạc được người có token bot Telegram, hoặc không ai có quyền Cloudflare để rollback.

Release accepted (sau deploy) chỉ khi:

- [ ] Probe R-1: `node scripts/probe-private-urls.mjs https://hienlegarden.vn https://hien-le-garden-v4.pages.dev` exit 0 (`FAIL=0 INCONCLUSIVE=0`).
- [ ] `/api/public-config` trả site key khác null.
- [ ] Đối soát §6.3 không có dòng nào không giải thích được.
- [ ] Mọi mục §12 PASS (hoặc FAIL đã có quyết định ghi nhận).
- [ ] §13 sạch trong 60 phút; WAF đã bật.
- [ ] Đã dọn dữ liệu test; đã thông báo kết thúc freeze.

Sau release (ghi biên bản): giờ migrate, merge commit, deployment id, kết quả §6.3/§12, sự cố và cách xử lý, thời điểm kết thúc freeze.
