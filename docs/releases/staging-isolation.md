# Tách staging/preview khỏi production (thiết kế — chưa triển khai)

Trạng thái: **thiết kế, chưa tạo tài nguyên nào**. `wrangler.toml` hiện chỉ có binding cấp cao nhất (production). Tài liệu này mô tả cách tách, để chủ dự án duyệt trước khi tạo D1/R2/bot/widget staging.

Quy tắc bắt buộc (quyết định của chủ dự án): preview/staging phải tách khỏi D1/R2 production; **không** chạy bất kỳ test preview nào có tác dụng phụ trên binding production.

Nguồn đã kiểm chứng: wrangler 3.114.17 trong `node_modules` (`wrangler-dist/cli.js`) và tài liệu Cloudflare (trích dẫn bên dưới, đọc ngày 2026-09-28).

---

## 1. Hiện trạng và rủi ro

- `wrangler.toml` khai báo `[[d1_databases]]` (`DB` → `hien_le_garden_crm`, id `bf3ed73c-…`) và `[[r2_buckets]]` (`RECEIPTS` → `hien-le-garden-finance-receipts`) ở cấp cao nhất, **không có** `[env.preview]`.
- Khi thiếu `[env.preview]`, Pages dùng cấu hình cấp cao nhất cho cả preview. Tài liệu Cloudflare: "If an environment section is absent, the top-level configuration applies to that environment." (developers.cloudflare.com/pages/functions/wrangler-configuration/).
- Trong code: `pages deploy` chọn môi trường theo nhánh — `isProduction = project.production_branch === branch; const env6 = isProduction ? "production" : "preview"` (cli.js ~126198), rồi đọc cấu hình với `env: env6` (`readPagesConfig({ ...args, env: env6 })`). Nếu `rawConfig.env.preview` không tồn tại và đây là cấu hình Pages, `activeEnv` giữ nguyên cấp cao nhất (cli.js ~86630–86672). Binding gửi lên nằm trong metadata của Functions bundle: `bindings: getBindings(config, { pages: true })` (cli.js ~124216).
- Hệ quả: **mọi** preview deployment hiện nay (`wrangler pages deploy dist --branch=<khác main>`, hoặc `npm run deploy` chạy từ nhánh khác `main`) chạy trên **D1/R2 production**.

## 2. Wrangler xử lý `[env.preview]` thế nào (đã kiểm chứng)

- Tên môi trường hợp lệ cho Pages chỉ có `preview` và `production`: `validatePagesEnvironmentNames` báo lỗi với tên khác ("The supported named-environments for Pages are \"preview\" and \"production\"", cli.js ~89666). Tài liệu: "Unlike Workers Environments, `production` and `preview` are the only two options available."
- `name` phải ở cấp cao nhất (`validateProjectName`: "in Pages, environments target the same project", cli.js ~89655) → **một** wrangler.toml chỉ trỏ tới **một** project.
- Khoá **không kế thừa** (`notInheritable`, cli.js ~86264): `vars`, `d1_databases`, `r2_buckets`, `kv_namespaces`, `durable_objects`, `services`, `queues.producers`, `hyperdrive`, `vectorize`, `analytics_engine_datasets`, `ai`. Khi `[env.preview]` tồn tại mà thiếu một khoá này, wrangler trả `rawEnv[field] ?? defaultValue` (mảng rỗng) và chỉ cảnh báo `"<field>" exists at the top level, but not on "env.preview"` — tức là binding đó **biến mất** ở preview, **không** rơi về binding production. Tài liệu: "if any one non-inheritable key is overridden for any environment … all non-inheritable keys must also be specified in the environment configuration."
- Khoá **kế thừa**: `name`, `pages_build_output_dir`, `compatibility_date`, `compatibility_flags`, `send_metrics`, `limits`, `placement`, `upload_source_maps`.
- Kết luận: `[env.preview]` ghi đè **sạch** `d1_databases`/`r2_buckets` cho preview deployment; không binding nào bị kế thừa từ cấp cao nhất. Production (không có `[env.production]`) tiếp tục dùng cấp cao nhất — không đổi.
- `wrangler pages dev` và Vitest đọc cấu hình **không** có env (cấp cao nhất) — chỉ dùng miniflare local, không ảnh hưởng.
- Khi có `pages_build_output_dir`, wrangler.toml là nguồn sự thật: "You will be able to see, but not edit, the same fields when you log into the Cloudflare dashboard." → không gán binding preview trên dashboard được; phải qua `[env.preview]`.

## 3. Phương án

### (A) `[env.preview]` trong cùng project `hien-le-garden-v4` — **khuyến nghị**

```toml
# (minh hoạ — chưa thêm vào wrangler.toml; điền id thật sau khi tạo tài nguyên staging)
[env.preview]

[[env.preview.d1_databases]]
binding = "DB"
database_name = "hien_le_garden_crm_staging"
database_id = "<STAGING_D1_ID>"          # PHẢI khác bf3ed73c-96de-494c-a3f9-e905f2bf8c48
migrations_dir = "migrations"

[[env.preview.r2_buckets]]
binding = "RECEIPTS"
bucket_name = "hien-le-garden-finance-receipts-staging"
```

Ưu điểm:
- Sửa luôn lỗ hổng hiện tại: preview **mặc định** dùng staging, kể cả preview tạo nhầm (chạy `npm run deploy` từ nhánh khác `main`).
- Một file cấu hình, một artifact `dist/` giống hệt production; không cần sửa `wrangler.toml` trong bản clone.
- Secret theo môi trường có sẵn: `wrangler pages secret put <NAME> --project-name=hien-le-garden-v4 --env preview` (lệnh `pages secret` có `--env` với `choices: ["production","preview"]`; mặc định production).

Nhược điểm / cách chặn:
- Deploy với `--branch=main` (nhánh production) vẫn là production → staging luôn deploy với `--branch=staging` (hoặc tên nhánh khác `main`) và kiểm tra dòng "environment" trong output.
- Preview URL công khai trên `*.hien-le-garden-v4.pages.dev` → bật Cloudflare Access cho preview deployments (Pages → Settings → "Enable access policy") nếu staging chứa dữ liệu thật.
- Thêm binding mới ở cấp cao nhất sau này phải thêm cả vào `[env.preview]` (nếu không, preview mất binding đó — an toàn, không lộ production). Guard §5 kiểm tra việc này.

### (B) Project staging riêng (`hien-le-garden-v4-staging`)

- `name` bắt buộc ở cấp cao nhất, `pages deploy --project-name=…-staging` dùng **wrangler.toml của repo** → nếu deploy bằng file này, project staging nhận **binding production** (không có env nào tên "staging"; wrangler 3.114 `pages deploy` từ chối `--config` — "Pages does not support custom paths for the Wrangler configuration file" — và từ chối `--env` — "Use the --branch flag to target your production or preview branch" (cli.js ~126801–126812); nó luôn đọc wrangler.toml tìm từ cwd).
- Muốn dùng (B) an toàn phải: deploy từ một thư mục khác chứa wrangler.toml staging riêng (hoặc sinh file đó trong CI), hoặc vẫn dùng `[env.preview]`/`[env.production]` trong file đó. Nhiều bước thủ công hơn, dễ quên hơn (A); lợi ích duy nhất là domain/secret tách hẳn khỏi project production.
- Chỉ chọn (B) nếu cần staging có "production branch" riêng (ví dụ test hành vi chỉ có ở môi trường production).

**Khuyến nghị: (A)** — ít bước tay nhất, và biến trạng thái mặc định của preview từ "production DB" thành "staging DB".

## 4. Chi tiết từng thành phần (cho phương án A)

Các bước dưới đây do chủ dự án chạy khi đã duyệt; tài liệu này không tạo gì.

### D1 staging
- Tạo: `npx wrangler d1 create hien_le_garden_crm_staging` → lấy `database_id`, điền vào `[env.preview]`.
- Migrations: `npx wrangler d1 migrations apply hien_le_garden_crm_staging --remote` (tên DB staging, **không bao giờ** `hien_le_garden_crm`). Kiểm tra trước bằng `npx wrangler d1 migrations list hien_le_garden_crm_staging --remote`.
- Dữ liệu: seed tài khoản test bằng `scripts/seed-manager.js` trỏ DB staging; không copy dữ liệu khách production.

### R2 staging
- `npx wrangler r2 bucket create hien-le-garden-finance-receipts-staging`; điền `bucket_name` vào `[env.preview]`.

### Biến môi trường / secret theo môi trường
Đặt cho preview bằng `npx wrangler pages secret put <NAME> --project-name=hien-le-garden-v4 --env preview` (giá trị gõ ở prompt, không đưa vào tham số dòng lệnh/history). Kiểm tra: `npx wrangler pages secret list --project-name=hien-le-garden-v4 --env preview`.

| Biến | Preview/staging | Ghi chú |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Token của **bot staging riêng** (tạo bằng @BotFather) | Không bao giờ dùng token bot production |
| `TELEGRAM_WEBHOOK_SECRET` | Secret riêng cho staging | `setWebhook` của bot staging với `url=https://staging.hien-le-garden-v4.pages.dev/api/telegram/webhook` (alias nhánh) + `secret_token` này |
| `TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS` | Chỉ chat staging (nhóm test) | Không allowlist nhóm khách sạn. Nơi nhận thông báo booking đọc từ bảng `notification_settings` của **DB staging** (`functions/api/bookings/index.js`) nên không chạm nhóm production |
| `BREVO_API_KEY` | **Không đặt** (khuyến nghị) | Xem Brevo bên dưới |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Widget staging riêng, hoặc key test | Xem Turnstile bên dưới |

### Telegram
- Bot staging + chat staging riêng; webhook staging trỏ URL alias preview; **không bao giờ** thêm bot staging vào nhóm production, không `setWebhook` bot production sang URL preview.

### Brevo (đã kiểm tra `lib/email.js`)
- `sendPromoEmail` luôn gọi `https://api.brevo.com/v3/smtp/email` với header `'api-key': env.BREVO_API_KEY`. Khi biến không đặt, header thành chuỗi `"undefined"` → Brevo trả lỗi xác thực → hàm log `Brevo send failed <status>` và trả `false` (mọi exception cũng trả `false`).
- Ở `functions/api/feedback.js`, voucher đã được INSERT **trước** khi gửi email ("the voucher already exists; a Brevo failure is logged, not fatal"), rồi ghi `message_log` với `status='failed'`. `functions/api/customers/[id]/send.js` và `functions/api/telegram/webhook.js` cũng ghi `'failed'`.
- Vậy bỏ trống `BREVO_API_KEY` ở staging: gửi thất bại an toàn, voucher vẫn tạo, `message_log` = `failed`. Lưu ý: vẫn có một request ra Brevo (bị từ chối), không có email nào được gửi. Không giả định Brevo có sandbox. Nếu cần test email thật: dùng một API key riêng và chỉ gửi tới hộp thư test do mình kiểm soát.

### Turnstile
- Cloudflare test keys (developers.cloudflare.com/turnstile/troubleshooting/testing/), dùng được trên mọi domain kể cả `localhost`:
  - Site key `1x00000000000000000000AA` (luôn pass, widget hiện), `2x00000000000000000000AB` (luôn fail).
  - Secret `1x0000000000000000000000000000000AA` (luôn pass), `2x0000000000000000000000000000000AA` (luôn fail), `3x0000000000000000000000000000000AA` ("token already spent").
  - "Production secret keys will reject the dummy token." → dùng cặp test cho test tự động (always-pass / always-fail); **không** dùng trong production.
- Test trình duyệt thật (widget thật): tạo widget staging riêng với hostname `hien-le-garden-v4.pages.dev` — tài liệu: "adding a hostname automatically authorizes all of its subdomains", nên phủ cả `staging.hien-le-garden-v4.pages.dev` và `<hash>.hien-le-garden-v4.pages.dev`. Không thêm hostname preview vào widget production.

## 5. Guard chống cấu hình nhầm (chạy trước mọi test trên staging)

Mục tiêu: dừng ngay nếu preview trỏ tới DB/bucket production, hoặc thiếu `[env.preview]`.

```bash
# chạy từ repo root; chỉ đọc wrangler.toml, không gọi mạng
node -e '
const t = require("fs").readFileSync("wrangler.toml", "utf8");
const PROD_DB = "bf3ed73c-96de-494c-a3f9-e905f2bf8c48";
const PROD_BUCKET = "hien-le-garden-finance-receipts";
const i = t.indexOf("[env.preview]");
if (i < 0) { console.error("FAIL: no [env.preview] — preview would use PRODUCTION D1/R2"); process.exit(1); }
const prev = t.slice(i);
const ids = [...prev.matchAll(/database_id\s*=\s*"([^"]+)"/g)].map(m => m[1]);
const buckets = [...prev.matchAll(/bucket_name\s*=\s*"([^"]+)"/g)].map(m => m[1]);
if (!ids.length || ids.includes(PROD_DB)) { console.error("FAIL: preview D1 missing or equals production"); process.exit(1); }
if (!buckets.length || buckets.includes(PROD_BUCKET)) { console.error("FAIL: preview R2 missing or equals production"); process.exit(1); }
console.log("OK: preview D1", ids, "R2", buckets);
'
```

Và sau mỗi lần deploy staging: output của `wrangler pages deploy` phải ghi môi trường **Preview** và alias `staging.hien-le-garden-v4.pages.dev`; trên dashboard, deployment đó hiện binding `DB` = `hien_le_garden_crm_staging`. Nếu thấy "Production" → dừng, không test.

## 6. Quy trình staging đề xuất (sau khi duyệt và tạo tài nguyên)

1. Thêm `[env.preview]` (PR riêng, review) — chạy guard §5 trong CI.
2. Tạo D1/R2 staging, áp migrations staging, đặt secret `--env preview`.
3. Deploy staging (artifact giống production): `npm run build && npm run check:dist && npx wrangler pages deploy dist --project-name=hien-le-garden-v4 --branch=staging`.
4. Test: checklist Turnstile, booking + Telegram staging, góp ý (email `failed`), R-1 probe trên alias staging.
5. Không bao giờ chạy test có ghi dữ liệu trên `hienlegarden.vn` / `hien-le-garden-v4.pages.dev` ngoài smoke test production đã liệt kê trong runbook.
