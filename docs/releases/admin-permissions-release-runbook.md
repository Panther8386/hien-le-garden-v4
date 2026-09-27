# Runbook phát hành — Phân quyền admin (nhánh `admin-redesign`)

- Nhánh: `admin-redesign`, HEAD `289cbab`. Production hiện tại: `main` = `9675840`.
- Hạ tầng: Cloudflare Pages project `hien-le-garden-v4` (static + Pages Functions), D1 `hien_le_garden_crm` (binding `DB`), R2 `hien-le-garden-finance-receipts` (binding `RECEIPTS`).
- Deploy: `.github/workflows/deploy.yml` chạy `wrangler pages deploy . --project-name=hien-le-garden-v4` khi có push lên `main`.
- Runbook này chỉ là tài liệu. Mọi lệnh `--remote` bên dưới do người vận hành tự chạy, đúng thứ tự, đúng thời điểm. Không lệnh nào trong tài liệu chứa giá trị secret thật: `<...>` là chỗ cần điền.

Quy ước:
- Chạy lệnh trong **Git Bash / WSL / macOS / Linux** (cách trích dẫn `"..."` + `'...'` trong SQL giả định shell POSIX). PowerShell cần sửa lại dấu nháy.
- `npx wrangler ...` dùng wrangler của repo (`^3.78`). Đăng nhập trước bằng `npx wrangler login` với tài khoản có quyền trên project.
- Cột "READ-ONLY" = chỉ `SELECT`/`PRAGMA`, không thay đổi dữ liệu.

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
| Workflow deploy `.github/workflows/deploy.yml` | **Không đổi** | Repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` còn hiệu lực | Theo dõi run Actions | §8 | — |
| Workflow test `.github/workflows/test.yml` (mới) | CI test cho PR / chạy tay, không secret, không deploy | — | — | Run xanh trên PR | Không ảnh hưởng production |

---

## 2. Điều kiện tiên quyết

- [ ] Quyền: tài khoản Cloudflare có quyền Pages + D1 + R2 + (nếu dùng) WAF trên zone `hienlegarden.vn`; quyền merge vào `main` trên GitHub; quyền admin bot Telegram (token bot).
- [ ] Công cụ: Node 22, `npm ci` đã chạy trong checkout, `npx wrangler whoami` hiện đúng account; `gh` CLI (tuỳ chọn) để theo dõi Actions; `curl`, `openssl`.
- [ ] Linux test gate đã quyết định (§3).
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

Lựa chọn (người dùng quyết định):
1. **Chấp nhận** bằng chứng non-isolated cho 3 file R2 và phát hành (khuyến nghị: rủi ro thấp, 3 file không bị đổi bởi các fix cuối, `beforeEach` reset bảng).
2. Nâng `@cloudflare/vitest-pool-workers` ≥ 0.6 + vitest 3 trong một task tooling riêng, rồi chạy lại isolated (không chặn release này).

Chạy lại gate:

A. CI (không có tác dụng phụ lên production): workflow `.github/workflows/test.yml` chạy tự động trên mọi pull request, hoặc chạy tay:

```bash
gh workflow run test.yml --ref admin-redesign
gh run list --workflow=test.yml --limit 3
gh run watch <run-id>
```

Kết quả mong đợi: bước "Vitest isolated (excluding 3 R2 files)" xanh; bước "R2 isolated — known vitest-pool-workers 0.5.x limitation" có thể đỏ nhưng được đánh dấu `continue-on-error` (job vẫn xanh). Bước đó đỏ chỉ chấp nhận được nếu lỗi là assertion `.sqlite-shm` / "Isolated storage failed", không phải assertion của test.

B. Local WSL (công thức đã dùng):

```bash
# trong WSL Ubuntu, Node 22 linux-x64 đã có trong PATH
git clone <repo-url> hlg-v4 && cd hlg-v4
git checkout 289cbab
npm ci                       # nếu WSL không có mạng: copy node_modules từ Windows và
                             # cài bản linux: npm ci --ignore-scripts --os=linux --cpu=x64 --libc=glibc
npx vitest run test/migrations.test.js
npx vitest run --exclude test/assetInventoryLines.test.js --exclude test/assetPhotos.test.js --exclude test/financeAttachments.test.js
npx vitest run test/assetInventoryLines.test.js test/assetPhotos.test.js test/financeAttachments.test.js   # biết trước có thể BLOCKED
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
mkdir -p "$HOME/hlg-backups"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
npx wrangler d1 export hien_le_garden_crm --remote --output="$HOME/hlg-backups/hien_le_garden_crm-$TS-pre0042.sql"
```

Lưu ý: export có thể làm chậm/chặn request tới DB trong lúc chạy — làm trong khung giờ ít khách, ngay trước khi migrate.

Kiểm tra file backup:

```bash
F="$HOME/hlg-backups/hien_le_garden_crm-$TS-pre0042.sql"
test -s "$F" && echo "non-empty OK"
ls -l "$F"                                  # kích thước > 0, quyền -rw-------
grep -c "CREATE TABLE staff_accounts" "$F"  # phải >= 1
grep -c "CREATE TABLE bookings" "$F"        # phải >= 1
grep -c "INSERT INTO \"staff_accounts\"\|INSERT INTO staff_accounts" "$F"   # xấp xỉ số tài khoản ở §4
```

So số dòng: đếm `INSERT` của `staff_accounts` trong file phải bằng tổng `COUNT(*)` ở §4 (cú pháp tên bảng trong file export có thể có hoặc không có dấu nháy — lệnh grep trên bắt cả hai). Không mở file bằng công cụ đồng bộ đám mây.

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
| `BREVO_API_KEY` | Secret | Production; Preview chỉ khi có môi trường preview tách DB (§10) | Có (email voucher, gửi email khách) | `sendPromoEmail` nhận lỗi từ Brevo → log `Brevo send failed <status>`; form góp ý **vẫn tạo voucher (201)**, `message_log.status = 'failed'`; gửi email từ trang Khách hàng thất bại | `npx wrangler pages secret put BREVO_API_KEY --project-name=hien-le-garden-v4` (nhập `<brevo-api-key>` khi được hỏi) |
| `TELEGRAM_BOT_TOKEN` | Secret | Production | Có | Mọi lệnh gửi Telegram lỗi → log `Telegram send failed` / `Telegram send threw`; booking vẫn được tạo nhưng **không có thông báo** cho lễ tân; khách không nhận mã qua deep link | `npx wrangler pages secret put TELEGRAM_BOT_TOKEN --project-name=hien-le-garden-v4` |
| `TELEGRAM_WEBHOOK_SECRET` | Secret (1–256 ký tự `A-Z a-z 0-9 _ -`) | Production | Có | Webhook trả **401 cho mọi update (fail closed)** → deep link khách `/start <id>` và `/start staff_booking_notify` ngừng hoạt động; `getWebhookInfo.last_error_message` báo 401. Thông báo booking mới (gửi đi) **không** bị ảnh hưởng | xem §9 (đọc từ biến, pipe vào `wrangler pages secret put TELEGRAM_WEBHOOK_SECRET`) |
| `TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS` | Plain (chat id, không phải bí mật; đặt là secret cũng được) | Production | Có (nếu muốn đổi nơi nhận) | Rỗng/không đặt → **đổi nơi nhận bị tắt**: `/start staff_booking_notify` bị bỏ qua im lặng; nơi nhận đang lưu trong `notification_settings` vẫn nhận thông báo bình thường | Dashboard → Variables → `TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS` = `<hotel-chat-id>` (nhiều id: phân tách bằng dấu phẩy) |
| `TURNSTILE_SITE_KEY` | Plain (public) | Production; Preview nếu test form ở preview | Có | `/api/public-config` trả `{"turnstileSiteKey": null}` → widget không hiện → không có token → **mọi lần gửi góp ý 403** | Dashboard → Variables → `TURNSTILE_SITE_KEY` = `<turnstile-site-key>` |
| `TURNSTILE_SECRET_KEY` | Secret | Production; Preview nếu test form ở preview | Có | `verifyTurnstile` trả false → **`POST /api/feedback` 403 cho mọi request (fail closed)**, trước khi chạm DB/Brevo | `npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name=hien-le-garden-v4` |

Bindings (không phải biến): `DB` → D1 `hien_le_garden_crm`, `RECEIPTS` → R2 `hien-le-garden-finance-receipts`, khai báo trong `wrangler.toml` — xem cảnh báo §10.

Ghi chú:
- `wrangler pages secret put` mặc định ghi vào môi trường **production**. Với Preview, dùng dashboard (tab Preview) hoặc kiểm tra `npx wrangler pages secret put --help` để biết cờ chọn môi trường của phiên bản wrangler đang dùng.
- Kiểm tra tên (không lộ giá trị): `npx wrangler pages secret list --project-name=hien-le-garden-v4`.
- Không bao giờ dán giá trị thật vào dòng lệnh; nhập khi wrangler hỏi, hoặc pipe từ biến đã `read -s` (§9).

---

## 8. Trình tự deploy (có mốc thời gian)

Thứ tự bắt buộc: **freeze → backup → migrate → deploy ngay → reconcile**. Code mới trên DB chưa migrate = mọi trang admin 500; code cũ trên DB đã migrate = chạy được (0042 chỉ thêm), nên migrate trước.

| Mốc | Việc | Ghi chú |
|---|---|---|
| T−1 ngày | Preflight §4, chuẩn bị giá trị §7, widget Turnstile, WAF §11 (có thể bật trước) | Code cũ không bị ảnh hưởng bởi WAF |
| T−30 phút | Đặt biến/secret production §7 (có hiệu lực ở deploy kế tiếp, code cũ bỏ qua) | Bao gồm `TELEGRAM_WEBHOOK_SECRET` |
| T−20 phút | Telegram §9 bước a–c: `setWebhook` với `secret_token` (code cũ bỏ qua header) | Kiểm tra `getWebhookInfo` không lỗi |
| T−15 phút | Gửi thông báo freeze §6.1 | |
| T−5 phút | Backup §5 (export + bookmark Time Travel), kiểm tra file | |
| T0 | `migrations apply --remote` §6.2 + kiểm tra §6.3 | Nếu lệch → dừng |
| T0 + ≤5 phút | Merge PR `admin-redesign` → `main` (GitHub UI, "Create a merge commit") → `deploy.yml` tự chạy | Không để khoảng cách dài giữa migrate và merge |
| T0 + ~5–10 phút | Xác nhận deploy xong (bên dưới) | |
| Ngay sau đó | Reconcile: chạy lại truy vấn đối soát §6.3 (mong đợi 0 dòng) + truy vấn "override bất thường" | Dòng nào xuất hiện = có người đổi quyền bằng UI cũ trong cửa sổ → sửa bằng trang Phân quyền mới |
| Tiếp | Telegram §9 bước d–h, Turnstile check production §10 (phần production), smoke §12 | |
| +60 phút | Theo dõi §13; kết thúc freeze bằng tin nhắn "Đã xong bảo trì" | |

Xác nhận deploy đã xong:

```bash
gh run list --workflow=deploy.yml --branch main --limit 3      # run mới nhất: completed / success
gh run watch <run-id>                                           # hoặc xem tab Actions trên GitHub
npx wrangler pages deployment list --project-name=hien-le-garden-v4 --environment production
```

- Deployment production mới nhất phải có commit = merge commit vừa tạo (hoặc HEAD `main`).
- Trên trình duyệt: mở `https://hienlegarden.vn/admin/login.html` (tải lại cứng), đăng nhập admin → menu mới có mục Phân quyền/Vai trò trong trang Tài khoản.
- `curl -s https://hienlegarden.vn/api/public-config` → `{"turnstileSiteKey":"<...>"}` (không null) chứng tỏ code mới + biến mới đã có hiệu lực.

---

## 9. Telegram — trình tự không gián đoạn

Nguyên lý: code cũ **không** đọc header `X-Telegram-Bot-Api-Secret-Token`; code mới **bắt buộc** header khớp. Vì vậy đăng ký `secret_token` với Telegram **trước** deploy: trong khoảng giữa, code cũ vẫn nhận update (bỏ qua header); ngay khi code mới lên, header đã có sẵn.

Vệ sinh shell (áp dụng cho cả mục này):

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

Lưu `TG_SECRET` vào trình quản lý mật khẩu (dán trực tiếp từ clipboard nếu cần: `printf '%s' "$TG_SECRET" | clip.exe` trên WSL / `pbcopy` trên macOS — không in ra màn hình).

(0) Ghi lại URL webhook hiện tại (để dùng lại đúng URL):

```bash
 printf 'url = "https://api.telegram.org/bot%s/getWebhookInfo"\n' "$TG_TOKEN" | curl -sS -K -
```

Token được đưa vào curl qua `-K -` (stdin), không nằm trong tham số dòng lệnh nên không lộ trong `ps`/history. Mong đợi `"url":"https://hienlegarden.vn/api/telegram/webhook"` (hoặc domain production thật đang dùng).

(b) Đặt secret cho production (có hiệu lực ở lần deploy kế tiếp):

```bash
 printf '%s' "$TG_SECRET" | npx wrangler pages secret put TELEGRAM_WEBHOOK_SECRET --project-name=hien-le-garden-v4
```

Đồng thời đặt allowlist `TELEGRAM_BOOKING_NOTIFY_ALLOWED_CHAT_IDS = <hotel-chat-id>` (§7) — giá trị là chat id của nhóm khách sạn đang nhận thông báo (lấy từ `SELECT booking_notify_chat_id FROM notification_settings` ở bước f, sau khi xác nhận đó đúng là nhóm khách sạn).

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

Kiểm tra lại `getWebhookInfo` (bước 0): `url` đúng, `last_error_message` rỗng hoặc lỗi cũ (thời điểm `last_error_date` trước bước c).

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

`wrangler.toml` khai báo `[[d1_databases]]` (`hien_le_garden_crm`, id `bf3ed73c-…`) và `[[r2_buckets]]` (`hien-le-garden-finance-receipts`) ở cấp cao nhất, không có `[env.preview]`. Với Pages, cấu hình này áp dụng cho **mọi môi trường**, nên một preview deployment (ví dụ `wrangler pages deploy . --branch=admin-redesign`) sẽ:
- chạy **code mới trên DB production** — nếu 0042 chưa migrate: mọi route có đăng nhập 500 (không có bảng `role_permissions`, không có cột `locked_at`);
- khi test form góp ý: tạo **voucher thật**, gửi **email thật** qua Brevo, ghi `message_log` thật; test booking tạo booking thật + Telegram thật.

Do đó **không** deploy preview của nhánh này lên project hiện tại cho tới khi preview có binding riêng. Các lựa chọn (không tạo gì trong release này — người dùng quyết định):

1. **Binding riêng cho Preview trong cùng project.** Tạo D1 `hien_le_garden_crm_preview` và R2 `hien-le-garden-finance-receipts-preview`; áp dụng migrations cho D1 preview; rồi gán vào Preview:
   - Dashboard: Workers & Pages → `hien-le-garden-v4` → Settings → Bindings → chọn **Preview** → D1 `DB` = DB preview, R2 `RECEIPTS` = bucket preview.
   - Lưu ý: khi `wrangler.toml` có `pages_build_output_dir`, Cloudflare có thể coi file này là nguồn cấu hình và khoá chỉnh binding trên dashboard. Khi đó cách duy nhất là thêm khối `[env.preview]` với `d1_databases`/`r2_buckets` riêng vào `wrangler.toml` — đây là **thay đổi cấu hình cần duyệt**, chưa làm trong release này.
   - Đặt biến Preview: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (widget có hostname preview), **không** đặt `BREVO_API_KEY` production (hoặc dùng key sandbox), **không** đặt `TELEGRAM_BOT_TOKEN` production.
2. **Project staging riêng** (ví dụ `hien-le-garden-v4-staging`): D1/R2 riêng; deploy từ một bản copy tạm của repo (ngoài repo) có `wrangler.toml` trỏ tới DB/bucket staging, `npx wrangler pages deploy . --project-name=hien-le-garden-v4-staging`. Không commit `wrangler.toml` đã sửa.
3. **Chỉ test local**: `npx wrangler pages dev .` với D1 local (`wrangler d1 migrations apply hien_le_garden_crm --local`), `.dev.vars` chứa site key/secret thật của một widget có hostname `localhost`, **không** có `BREVO_API_KEY` (email sẽ log `failed`, voucher vẫn tạo local). Không chạm production.

### Checklist Turnstile (chạy trên preview đã tách binding, staging, hoặc local; phần "production" chạy sau deploy)

Widget Turnstile (dashboard → Turnstile): hostnames `hienlegarden.vn`, `www.hienlegarden.vn`, và hostname preview/staging nếu test ở đó (ví dụ `<branch>.hien-le-garden-v4.pages.dev` — Turnstile nhận domain, kiểm tra trong dashboard cách khai báo subdomain `*.pages.dev`), hoặc `localhost` cho phương án 3. Gỡ hostname preview/localhost khỏi widget production sau khi test xong nếu dùng chung widget.

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

Khả năng rate limiting của Cloudflare (số rule, khoảng thời gian đếm, đặc tính đếm như IP/header, thời gian chặn, kiểu hành động) **phụ thuộc gói** của zone `hienlegarden.vn`. Trước khi cấu hình, mở Security → WAF → Rate limiting rules và xem các giá trị được phép; điều chỉnh bảng dưới cho khớp. Không coi các con số dưới đây là giới hạn gói.

| Path | Method | Suggested threshold | Window | Key | Action | Rationale |
|---|---|---|---|---|---|---|
| `/api/auth/login` | POST | 10 requests | 10 phút | IP | Block 10 phút | Vài nhân viên, thường đăng nhập 1–2 lần/ca; 10 cho phép gõ sai vài lần kể cả khi nhiều máy lễ tân chung một IP NAT; đủ chặn dò mật khẩu |
| `/api/auth/verify-2fa` | POST | 10 requests | 10 phút | IP | Block 10 phút | Code đã giới hạn 5 mã sai/token; WAF chặn việc xin token mới liên tục để dò tiếp |
| `/api/feedback` | POST | 5 requests | 10 phút | IP | Block 10 phút | Khách thật gửi 1 lần (lần 2 đã bị 409); 5 chừa chỗ cho lỗi mạng/Turnstile; hạn chế relay email |
| `/api/bookings` | POST | 5 requests | 10 phút | IP | Block 10 phút | Khách đặt 1–2 yêu cầu; chặn spam booking + Telegram. `GET /api/bookings` là của nhân viên, không nằm trong rule |

Lưu ý:
- Khách dùng 4G có thể chung IP (CGNAT). Nếu lễ tân báo khách bị chặn, nâng ngưỡng feedback/booking lên 10.
- "Managed Challenge" không hữu ích cho `fetch()` JSON (trình duyệt không giải được challenge trong fetch) — với API nên dùng Block.
- Nếu gói cho phép chọn thời gian đếm ngắn hơn (ví dụ chỉ 10 giây/1 phút), quy đổi tương ứng (ví dụ 3 request/1 phút) và ghi rõ vào biên bản.

Phương án khi chỉ có **1 rule**: gộp 4 đường dẫn, đếm chung theo IP:

```
(http.request.method eq "POST" and http.request.uri.path in {"/api/auth/login" "/api/auth/verify-2fa" "/api/feedback" "/api/bookings"})
```

Ngưỡng đề xuất: 15 request / 10 phút / IP, Block 10 phút (đăng nhập + 2FA của một ca vài người ≈ 4–8 request; một khách góp ý + đặt phòng ≈ 2–3). Hạn chế: đếm chung nên nhân viên thử sai nhiều ở quầy có thể tự chặn cả booking từ cùng IP (hiếm).

Kiểm tra sau khi bật: Security → Events lọc theo rule; không có sự kiện chặn IP của khách sạn trong giờ làm việc.

---

## 12. Smoke test production (PASS/FAIL)

Dùng tài khoản test riêng khi có thể (tạo bằng admin, đặt tên `test-release-<ngày>`, xoá ở cuối). Bài test tạo dữ liệu production được đánh dấu **[TẠO DỮ LIỆU]** kèm cách dọn. Không chụp màn hình có SĐT/email khách.

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
- Rollback code: Cloudflare dashboard → Workers & Pages → project → Deployments → deployment production trước đó → "Rollback to this deployment" (nhanh nhất), hoặc `git revert -m 1 <merge-commit>` rồi push lên `main` (qua PR). Kiểm tra biến môi trường sau rollback (deployment cũ không dùng các biến mới, không hại).
- Time Travel restore chỉ khi dữ liệu bị hỏng — mất mọi ghi sau bookmark.

| Failure point | Safe action | DB rollback needed? | Code rollback safe? | Data reconciliation |
|---|---|---|---|---|
| Migration lỗi trước deploy | Không merge. Code cũ tiếp tục chạy. Kiểm tra trạng thái bằng §6.3 (`sqlite_master`, `PRAGMA table_info`, `d1_migrations`). Nếu áp dụng dở dang: phân tích, rồi chọn (a) hoàn tất thủ công các câu lệnh còn thiếu và ghi `d1_migrations`, hoặc (b) Time Travel restore về bookmark §5 (freeze đang bật nên mất ít ghi) | Chỉ khi áp dụng dở dang và chọn (b) | Không cần (chưa deploy) | So số booking/order trước–sau nếu restore |
| Migration OK, deploy lỗi (Actions đỏ) | Code cũ vẫn chạy trên schema mới (an toàn). Giữ freeze. Sửa nguyên nhân (secret Actions, lỗi mạng) → chạy lại job (`gh run rerun <id>`) hoặc `npm run deploy` từ `main` | Không | Không liên quan | Chạy đối soát §6.3 ngay trước khi deploy lại (bắt thay đổi cờ bằng UI cũ) |
| Deploy OK, smoke test lỗi | Phân loại: lỗi hiển thị/1 quyền → sửa quyền bằng trang Phân quyền hoặc roll-forward fix. Lỗi 500 diện rộng → kiểm tra 0042 + log; nếu không sửa được trong 30 phút và chưa ai đổi quyền/khoá bằng code mới → rollback code chấp nhận được | Không | Có điều kiện: an toàn **chỉ khi** chưa có khoá/deny/sửa bảng vai trò bằng code mới (kiểm tra `audit_log` action `account_lock`, `user_permissions_change`, `role_permissions_change`) | Sau rollback: đối chiếu cờ cũ với override |
| Telegram lỗi (401 trong getWebhookInfo, không có thông báo) | Roll-forward: đặt lại secret = giá trị đã đăng ký (§9b) + deploy lại, hoặc `setWebhook` lại với secret đang có (§9c). Token sai → đặt lại `TELEGRAM_BOT_TOKEN` + deploy | Không | Không cần; rollback chỉ vì Telegram là không tương xứng | Update Telegram bị 401 sẽ được Telegram gửi lại trong một thời gian; kiểm tra `pending_update_count`; hỏi lễ tân booking nào không có thông báo (xem trang Lễ tân) |
| Turnstile lỗi (mọi góp ý 403) | Roll-forward: kiểm tra `public-config`, hostname widget, cặp site/secret key, deploy lại sau khi sửa biến. Tạm thời: lễ tân ghi nhận góp ý thủ công | Không | Không nên (mở lại relay email) | Không có dữ liệu sai; chỉ mất lượt góp ý trong thời gian lỗi |
| Admin/phân quyền lỗi (admin không đăng nhập được, quyền sai) | Admin khác đăng nhập sửa; kiểm tra `locked_at` của admin, `role_permissions` (§6.3). Không có admin nào vào được → sửa bằng SQL có kiểm soát (quyết định tại chỗ, có biên bản) hoặc roll-forward | Không | Chỉ khi chưa có thay đổi bảo mật bằng code mới | Ghi lại mọi sửa SQL tay vào biên bản |
| Phát hiện lỗi sau khi người dùng đã thay đổi bảo mật bằng code mới (khoá, deny, sửa vai trò) | **Roll-forward** (fix + deploy). Không rollback code | Không | **Không** — hồi quy bảo mật (xem trên) | Không cần |

Tiêu chí STOP / GO trong quá trình:
- STOP trước migrate: không có admin đăng nhập được; backup rỗng/thiếu `CREATE TABLE staff_accounts`; `migrations list` còn file khác ngoài 0042.
- STOP trước merge: bất kỳ kiểm tra §6.3 nào lệch; migration lỗi.
- ROLLBACK xem xét (≤30 phút sau deploy): 5xx diện rộng không giải thích được **và** chưa có thay đổi bảo mật bằng code mới.
- Ngoài các trường hợp trên: roll-forward.

---

## 15. GO / NO-GO

GO chỉ khi tất cả đều ✓:

- [ ] Linux gate: 79/79 migrations + 80 files/1488 tests PASS isolated; quyết định về 3 file R2 đã ghi nhận (§3); run `test.yml` trên PR xanh.
- [ ] PR `admin-redesign` → `main` đã review, không có commit ngoài phạm vi.
- [ ] Preflight §4: ≥1 admin đăng nhập được (đã thử), 2FA sẵn sàng.
- [ ] 6 biến §7 đã đặt cho Production (kiểm tra bằng `pages secret list` + dashboard).
- [ ] Telegram §9 a–c xong: `setWebhook` với `secret_token` OK, `getWebhookInfo` không lỗi mới.
- [ ] Widget Turnstile có hostname production; checklist §10 đã chạy trên môi trường **không** dùng DB production (hoặc quyết định chỉ kiểm tra trên production sau deploy).
- [ ] WAF §11 đã cấu hình (hoặc quyết định hoãn có ghi nhận).
- [ ] Không có preview deployment nào của nhánh này trên project production.
- [ ] Freeze đã thông báo và được xác nhận.
- [ ] Backup §5 hợp lệ + bookmark Time Travel đã ghi.
- [ ] Người vận hành rảnh 60 phút sau deploy; lễ tân biết khung bảo trì.

NO-GO nếu bất kỳ mục nào ở trên chưa đạt, hoặc: đang cao điểm khách, không liên lạc được người có token bot Telegram, hoặc không ai có quyền Cloudflare để rollback.

Sau release (ghi biên bản): giờ migrate, merge commit, deployment id, kết quả §6.3/§12, sự cố và cách xử lý, thời điểm kết thúc freeze.
