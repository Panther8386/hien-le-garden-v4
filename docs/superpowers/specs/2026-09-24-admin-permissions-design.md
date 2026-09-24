# Phân quyền chi tiết cho admin — thiết kế

Ngày: 2026-09-24 · Trạng thái: chờ duyệt · Phần 1/2 của đợt làm mới admin (phần 2: `2026-09-24-admin-ui-refresh-design.md`)

## 1. Mục tiêu

- Thay 4 vai trò cố định trong code (145 lệnh `requireAuth` với danh sách role viết cứng) bằng **mã quyền** kiểm tra ở từng API.
- **Bảng quyền mặc định của từng vai trò** chỉnh được trên giao diện, không cần deploy.
- **Từng user** có thể được *cho thêm* hoặc *chặn* quyền so với vai trò.
- Gộp 4 quyền bổ sung hiện có (`can_manage_room_layout`, `can_add_finance_transaction`, `can_delete_asset`, `can_delete_deposit`) vào mô hình mới.
- **Người quan sát** chỉ còn: xem Vận hành hôm nay, xem Sổ thu chi phần thu — chặn cả giao diện lẫn API.
- Thêm **khoá tạm tài khoản**.
- Làm lại trang Quản lý user thành trang **Phân quyền** (tab Tài khoản / Vai trò).

Ngoài phạm vi: tạo vai trò mới (giữ 4 vai trò), giao diện chung mới (phần 2).

## 2. Nguyên tắc

- **Giữ nguyên hành vi hiện tại.** Bảng quyền seed sao cho mọi user có đúng quyền như trước, *trừ* người quan sát bị siết theo yêu cầu.
- **Quản trị (`admin`) luôn có toàn quyền**, không chỉnh được, không nhận chỉnh riêng — tránh tự khoá mình.
- Nguồn sự thật lúc chạy: bảng `role_permissions` + `user_permission_overrides` trong D1. Danh sách mã quyền hợp lệ (nhãn, nhóm) định nghĩa trong code `lib/permissions.js`.

## 3. Danh mục quyền và mặc định

L = Lễ tân · Q = Quản lý · S = Người quan sát · (Quản trị luôn có tất cả)

| Mã quyền | Nhãn | L | Q | S |
|---|---|---|---|---|
| **Vận hành & đặt phòng** |||||
| `bookings.view` | Xem đặt phòng, sơ đồ phòng, nhắc việc | ✓ | ✓ | ✓ |
| `bookings.manage` | Tạo / sửa / xác nhận / nhận-trả phòng / huỷ, dịch vụ, thêm cọc, đánh dấu đã dọn | ✓ | ✓ | |
| `bookings.edit_paid_service` | Sửa / xoá dịch vụ đã thanh toán | | | |
| `bookings.deposit_delete` | Xoá cọc | | | |
| `rooms.layout` | Sắp xếp sơ đồ phòng | | | |
| `guests.contact_view` | Xem SĐT / email khách | ✓ | ✓ | |
| `promo.redeem` | Tra mã ưu đãi, đổi mã, nhận quà | ✓ | ✓ | |
| `records.hide` | Ẩn bản ghi khỏi lịch sử, xem bản ghi đã ẩn | | | |
| **Order ăn uống** |||||
| `dine_in.view` | Xem order | ✓ | ✓ | |
| `dine_in.manage` | Tạo / thêm món / đóng / huỷ order | ✓ | ✓ | |
| **Giờ Xanh** |||||
| `gio_xanh.view` | Xem phiên | ✓ | ✓ | |
| `gio_xanh.manage` | Tạo / thêm món / đóng / huỷ phiên | ✓ | ✓ | |
| **Khách hàng** |||||
| `customers.view` | Xem danh sách & chi tiết khách | ✓ | ✓ | |
| `customers.send` | Gửi tin nhắn cho khách | ✓ | ✓ | |
| `templates.view` | Xem template tin nhắn | ✓ | ✓ | |
| `templates.manage` | Tạo / sửa / bật-tắt template | | ✓ | |
| `promo_config.view` | Xem cấu hình khuyến mãi, kho quà, thông báo | ✓ | ✓ | |
| `promo_config.manage` | Sửa cấu hình khuyến mãi, kho quà | | ✓ | |
| **Tài chính** |||||
| `dashboard.view` | Xem tổng quan số liệu | | ✓ | |
| `finance.view_income` | Xem sổ thu chi — phần thu | | ✓ | ✓ |
| `finance.view_all` | Xem toàn bộ sổ thu chi (phần chi, cân đối, biểu đồ) | | ✓ | |
| `finance.create` | Thêm giao dịch | | ✓ | |
| `finance.manage` | Sửa / huỷ giao dịch, chứng từ, số dư đầu kỳ | | ✓ | |
| **Kho & tài sản** |||||
| `assets.view` | Xem tài sản, kho, kiểm kê, hồ sơ nguồn | ✓ | ✓ | |
| `assets.count` | Kiểm kê, ghi phiếu kho | ✓ | ✓ | |
| `assets.manage` | Tạo / sửa tài sản, mở-chốt đợt kiểm kê, đối soát | | ✓ | |
| `assets.delete` | Xoá tài sản | | | |
| `assets.config` | Danh mục, vị trí, lô thực phẩm | | | |
| **Cài đặt** |||||
| `settings.view` | Xem trang Phòng & giá, Bảng giá dịch vụ, Chính sách hoàn cọc | ✓ | ✓ | |
| `settings.rooms` | Sửa giá phòng, ngày lễ | | | |
| `settings.catalog` | Sửa bảng giá dịch vụ, khung giờ, cài đặt đặt trải nghiệm | | | |
| `settings.dine_in_menu` | Sửa menu quán | | | |
| `settings.cancellation_policy` | Sửa chính sách hoàn cọc | | | |
| `settings.finance_categories` | Sửa danh mục thu chi | | | |
| `settings.reminders` | Sửa ngưỡng nhắc việc | | | |
| `audit.view` | Xem nhật ký thao tác | | ✓ | |
| `users.manage` | Quản lý tài khoản, khoá tạm, chỉnh quyền riêng | | ✓ | |
| `users.security` | Đặt lại mật khẩu, tắt 2FA của người khác | | | |

Ghi chú:
- Các ô trống ở cả 3 cột (ví dụ `records.hide`, `settings.*`) là quyền hiện chỉ Quản trị có.
- Chỉnh bảng quyền vai trò **không phải một mã quyền**: chỉ vai trò Quản trị làm được.
- **Chuyển 4 cờ cũ thành chỉnh riêng `grant`**, chỉ cho user có cờ = 1 mà vai trò chưa có quyền đó:
  - `can_manage_room_layout` → `rooms.layout`
  - `can_add_finance_transaction` → `finance.create`
  - `can_delete_asset` → `assets.delete`
  - `can_delete_deposit` → `bookings.deposit_delete`

  User vai trò Quản trị hoặc Người quan sát bị bỏ qua khi chuyển, đúng như hành vi hiện tại (người quan sát không được dùng các cờ này).

### Dữ liệu tham chiếu chỉ cần đăng nhập

Các API sau chỉ trả dữ liệu cấu hình không nhạy cảm và được trang Vận hành cần để hiển thị. Vì vậy chúng chỉ yêu cầu **đã đăng nhập**: `requireAuth(request, env)` không truyền mã quyền.

- GET `catalog`, `catalog/[id]/slot-availability`, `catalog/[id]/slot-templates`
- GET `dine-in-menu`, `holidays`, `cancellation-policy`
- GET `experience-booking-settings`, `reminder-settings`, `availability`

Việc *hiển thị trang* cài đặt tương ứng vẫn yêu cầu `settings.view` (hoặc quyền sửa tương ứng).

## 4. Ánh xạ API → quyền

Quy ước: `R(x)` = `requireAuth(request, env, 'x')`. Mọi dòng dưới thay cho danh sách role hiện tại.

| API | Quyền |
|---|---|
| GET `bookings`, `rooms`, `rooms/layout-log`, `reception/reminders` | `bookings.view` |
| POST `bookings/staff`; `bookings/[id]` (index, cancel, check-in, check-out, confirm, reject, identity); POST `deposits`; `services` + `services/[itemId]`; `rooms/[id]/clean` | `bookings.manage` |
| trong `services/[itemId]`: sửa/xoá dòng `paid` | + `bookings.edit_paid_service` (thay `role !== 'admin'`) |
| DELETE `bookings/[id]/deposits/[depositId]` | `bookings.deposit_delete` |
| PATCH `rooms/reorder` | `rooms.layout` |
| trong GET `bookings`, GET `customers`: che SĐT/email, tìm kiếm không theo SĐT | khi thiếu `guests.contact_view` (thay `role === 'observer'`) |
| `bookings/[id]/hide`, `dine-in-orders/[id]/hide`, `gio-xanh-sessions/[id]/hide`, `finance/transactions/[id]/hide`; tham số `includeHidden=1` | `records.hide` |
| `promo/[code]`, `redeem`, `claim-gift` | `promo.redeem` |
| GET `dine-in-orders`, `dine-in-orders/[id]` | `dine_in.view` |
| POST `dine-in-orders`, `close`, `items`, `items/[itemId]`, `void` | `dine_in.manage` |
| GET `gio-xanh-sessions`, `gio-xanh-sessions/[id]` | `gio_xanh.view` |
| POST `gio-xanh-sessions`, `close`, `items`, `items/[itemId]`, `void` | `gio_xanh.manage` |
| GET `customers` | `customers.view` |
| GET `customers/[id]` (có SĐT/email) | `customers.view` + `guests.contact_view` |
| POST `customers/[id]/send` | `customers.send` |
| GET `templates` | `templates.view` |
| POST/PATCH/DELETE `templates`, `activate`, `deactivate` | `templates.manage` |
| GET `policy`, `gift-inventory`, `notification-settings` | `promo_config.view` |
| POST/DELETE `policy`, POST `gift-inventory` | `promo_config.manage` |
| GET `dashboard/summary` | `dashboard.view` |
| GET `finance/transactions`, `finance/categories`, GET `attachment` | `finance.view_income`; thiếu `finance.view_all` → chỉ dữ liệu `income`, không bản ghi ẩn (thay các nhánh `observer`) |
| GET `finance/summary`, `finance/opening-balance`, `finance/receipts-usage` | `finance.view_all` |
| POST `finance/transactions` | `finance.create` (thay biểu thức `canAdd`) |
| PATCH `finance/transactions/[id]`, `void`, POST/DELETE `attachment`, POST `opening-balance` | `finance.manage` |
| GET mọi `asset-*`, `assets`, ảnh tài sản/dòng kiểm kê | `assets.view` |
| `asset-inventory-lines/[id]` (+ ảnh ghi/xoá), POST `asset-inventory-transactions`, `asset-inventory-transactions/[id]`, PATCH `asset-inventory-batches/[id]` | `assets.count` |
| trong PATCH batch: chuyển sang `counting`/`closed`; ghi dòng khi batch `pending_close`; `includeDeleted=1` | + `assets.manage` (thay kiểm tra role) |
| POST/PATCH `assets`, ảnh tài sản ghi/xoá, POST `asset-inventory-batches`, `refresh-lines`, `asset-source-rows/[id]/reconcile` | `assets.manage` |
| DELETE `assets/[id]` | `assets.delete` |
| POST/PATCH/DELETE `asset-categories`, `asset-locations`, POST `asset-inventory-food-lots` | `assets.config` |
| `rooms/[id]/price`, POST/PATCH/DELETE `holidays` | `settings.rooms` |
| ghi `catalog`, `slot-templates`, PATCH `experience-booking-settings` | `settings.catalog` |
| ghi `dine-in-menu` (index POST, `[id]`, `move`, `move-group`, `rename-group`) | `settings.dine_in_menu` |
| ghi `cancellation-policy` | `settings.cancellation_policy` |
| ghi `finance/categories` (+ `move`) | `settings.finance_categories` |
| PATCH `reminder-settings` | `settings.reminders` |
| GET `audit-log` | `audit.view` |
| `users` (GET/POST), `users/[id]` DELETE, `role`, `permissions`, `lock`, `unlock` | `users.manage` |
| `users/[id]/password`, `users/[id]/disable-2fa` | `users.security` |
| `auth/*` (me, login, 2FA, change-password) | giữ nguyên (chỉ cần đăng nhập) |

Kế hoạch triển khai phải rà lại từng file trong `functions/api` so với bảng này; file nào không khớp dòng nào phải được bổ sung vào bảng trước khi sửa.

## 5. Dữ liệu (migration `0042_permissions.sql`)

```sql
CREATE TABLE role_permissions (
  role TEXT NOT NULL CHECK (role IN ('reception','manager','observer')),
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);
CREATE TABLE user_permission_overrides (
  staff_id INTEGER NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('grant','deny')),
  PRIMARY KEY (staff_id, permission)
);
ALTER TABLE staff_accounts ADD COLUMN locked_at TEXT;
ALTER TABLE staff_accounts ADD COLUMN locked_by TEXT;
-- seed role_permissions theo bảng mục 3
-- chuyển 4 cờ cũ thành overrides 'grant' (mục 3, ghi chú)
```

- 4 cột cờ cũ **không đọc nữa** nhưng chưa xoá trong migration này (xoá ở migration sau khi đã chạy ổn định).
- Xoá user thì xoá luôn các dòng override của user đó (D1 bật khoá ngoại nên `ON DELETE CASCADE` lo việc này; handler DELETE vẫn xoá tường minh trong cùng batch cho rõ ràng).
- Phải chạy migration lên remote **trước** khi merge (theo `BACKEND.md`).

## 6. Kiểm tra quyền lúc chạy

- `lib/permissions.js`:
  - `PERMISSIONS`: danh sách `{ key, label, group }` theo thứ tự hiển thị.
  - `ROLE_DEFAULTS`: chỉ dùng cho test và để đối chiếu seed.
  - `effectivePermissions(role, rolePerms, overrides)`: admin → tất cả; còn lại = quyền của vai trò ∪ quyền `grant` − quyền `deny`.
  - `hasPermission(auth, key)`.
- `lib/auth.js` `getSession`: nạp role, `locked_at`, quyền của vai trò và override trong **một** `DB.batch`. Trả về `auth.permissions` (Set). Tài khoản bị khoá thì trả `null`, dẫn tới lỗi 401.
- `lib/requireAuth.js`: tham số thứ 3 là mã quyền (`string`) hoặc bỏ trống.
  - Không có phiên đăng nhập → 401.
  - Thiếu quyền → 403 `Không đủ quyền`.
  - Bỏ hỗ trợ mảng role. Mọi lệnh gọi phải đổi hết, để test bắt được lệnh nào còn sót.
- `GET /api/auth/me` bỏ 4 trường `can*` và thêm `permissions: string[]`. Mọi JS ở frontend đang đọc `role`/`can*` để ẩn hiện nút phải đổi sang kiểm tra `permissions`. Có khoảng 94 chỗ trong `admin/*.js`.
- Đăng nhập (`auth/login`, `auth/verify-2fa`) với tài khoản bị khoá → 403 `Tài khoản đang bị khoá. Liên hệ quản trị.`

## 7. API quản lý mới

| API | Quyền | Mô tả |
|---|---|---|
| GET `/api/permissions` | `users.manage` | `{ groups:[{label, permissions:[{key,label}]}], roles:{reception:[…],manager:[…],observer:[…]}, canEditRoles }` |
| PUT `/api/roles/:role/permissions` | vai trò admin | Body `{ permissions: [...] }`, thay toàn bộ. `role` ∈ reception/manager/observer. Mã quyền không hợp lệ → 400. |
| GET `/api/users` | `users.manage` | Bổ sung `lockedAt`, `overrideCount`, `totpEnabled`. |
| GET `/api/users/:id/permissions` | `users.manage` | `{ role, overrides:{key:'grant'\|'deny'}, effective:[…] }` |
| PUT `/api/users/:id/permissions` | `users.manage` | Body `{ overrides:{...} }`, thay toàn bộ. |
| POST `/api/users/:id/lock`, `/unlock` | `users.manage` | Khoá: đặt `locked_at`, `locked_by` và xoá mọi phiên của user đó. |

Xoá 4 API cờ cũ: `room-layout-access`, `finance-transaction-access`, `asset-delete-access`, `deposit-delete-access`.

### Quy tắc an toàn (kiểm tra ở server, trả 400/403 kèm thông báo tiếng Việt)

1. Tài khoản vai trò admin chỉ tài khoản admin khác mới được sửa, khoá hoặc xoá. Cũng chỉ admin mới gán hoặc gỡ vai trò admin.
2. Không ai tự khoá, tự xoá, tự đổi vai trò hay tự sửa quyền riêng của chính mình.
3. Người không phải admin chỉ được thêm `grant` mới cho những quyền mà chính họ đang có (grant đã có sẵn của user được giữ nguyên hoặc gỡ bỏ tự do). Họ được `deny` bất kỳ quyền nào.
4. Không được hạ vai trò, khoá hay xoá **admin cuối cùng chưa bị khoá**. Quy tắc này thay cho quy tắc "manager cuối cùng" hiện nay.
5. **Đổi vai trò của một user sẽ xoá hết override của user đó.** Lý do: quyền chỉnh riêng được cấp theo vai trò cũ, không được giữ lại khi đổi vai trò. Ví dụ, lễ tân được cấp "Xoá tài sản" rồi bị hạ xuống người quan sát thì không còn quyền này. Giao diện phải báo trước điều này khi user có override. User vai trò admin luôn không có override.
6. Người không phải admin chỉ được gán một vai trò (khi tạo tài khoản hoặc đổi vai trò) nếu chính họ có toàn bộ quyền của vai trò đó.

### Nhật ký thao tác (audit_log)

Thêm các `action_type` mới và đăng ký vào trang Nhật ký:
- `role_permissions_change`: lưu danh sách quyền cũ và mới.
- `user_permissions_change`: lưu override cũ và mới.
- `account_lock`, `account_unlock`.

## 8. Giao diện trang Phân quyền

URL giữ nguyên (`/manager/users`), tên menu đổi thành **Phân quyền**. Trang theo mockup đã duyệt (`.superpowers/brainstorm/782-1790212890/content/permissions.html`) và dùng giao diện mới của phần 2. Nếu phần 1 được triển khai trước, trang dùng tạm token/CSS của phần 2 đặt trong một file CSS riêng của trang.

**Tab Tài khoản**
- Bên trái là danh sách user. Mỗi user hiện tên, vai trò, trạng thái 2FA, huy hiệu `Đang khoá`, và `+N` là số quyền khác vai trò.
- Nút "+ Tạo tài khoản" mở form gồm tên đăng nhập, mật khẩu ban đầu và vai trò.
- Bấm vào một user để mở phần chi tiết:
  - Chọn vai trò.
  - Các nút Đặt lại mật khẩu và Tắt 2FA (cần `users.security`), Khoá/Mở khoá, Xoá. Xoá phải xác nhận trong hộp thoại ngay trên trang.
  - Danh sách quyền nhóm theo module. Mỗi quyền có ba lựa chọn **Theo vai trò (có/không) / Cho / Chặn**.
  - Dòng nào khác vai trò thì tô nền vàng nhạt và ghi "vai trò: có/không".
  - Chân trang có dòng "N quyền khác vai trò" cùng hai nút Huỷ và **Lưu thay đổi**.
- Không hiện lựa chọn "Cho" với quyền mà người đang thao tác không có (theo quy tắc 3).
- User vai trò admin: thay danh sách quyền bằng dòng "Quản trị có toàn quyền".
- Trên điện thoại, danh sách hiện một cột. Chạm vào user thì mở màn chi tiết toàn trang, có nút quay lại.

**Tab Vai trò** (chỉ hiện với vai trò admin)
- Bảng quyền: các hàng là quyền (nhóm theo module), các cột là Lễ tân / Quản lý / Quan sát / Quản trị.
- Cột Quản trị luôn được tick và bị khoá.
- Thanh dưới hiện "Có N thay đổi chưa lưu" và nút **Lưu bảng quyền**. Nút này gửi một request PUT cho mỗi vai trò bị đổi.
- Ghi chú dưới bảng: thay đổi áp dụng cho mọi user của vai trò, trừ user có chỉnh riêng.
- Trên điện thoại, bảng cuộn ngang và cột "Quyền" được giữ cố định.

Thông báo sau khi lưu: "Đã lưu quyền của thao.letan" / "Đã lưu bảng quyền". Nếu lỗi thì hiện đúng thông báo server trả về.

## 9. Điều hướng và URL

- `nav-drawer.js`: mỗi mục menu gắn một mã quyền thay vì danh sách role. Mục chỉ hiện khi user có quyền đó.
  - Vận hành hôm nay → `bookings.view`
  - Sổ thu chi → `finance.view_income`
  - Tổng quan → `dashboard.view`
  - Kho/tài sản → `assets.view`
  - Order → `dine_in.view`
  - Giờ Xanh → `gio_xanh.view`
  - Khách hàng → `customers.view`
  - Template → `templates.view`
  - Khuyến mãi → `promo_config.view`
  - Bảng giá, Phòng & giá, Chính sách hoàn cọc → `settings.view`
  - Menu quán → `settings.dine_in_menu`
  - Danh mục thu chi → `settings.finance_categories`
  - Nhật ký → `audit.view`
  - Phân quyền → `users.manage`
- Mỗi trang tự kiểm tra quyền xem trang khi tải. Thiếu quyền thì chuyển về trang đầu tiên user được xem.
- `_redirects`: mỗi tiền tố `/manager`, `/reception`, `/observer` đều khai báo **đủ** các trang. Lý do: quyền giờ cấp được cho từng user, nên URL không còn quyết định ai vào được trang nào. Việc chặn do kiểm tra ở trang và ở API đảm nhiệm.

## 10. Kiểm thử

- Vitest:
  - Toàn bộ test hiện có phải qua với bảng quyền mặc định. Chỉ sửa các test của người quan sát ở những chỗ bị siết (tài sản, kho, order, Giờ Xanh, khách hàng, bảng giá...), đổi sang mong đợi 403.
  - Test mới cho `effectivePermissions`: admin, grant, deny, và grant chồng với quyền của vai trò.
  - Test mới cho migration: seed đúng mặc định, chuyển cờ cũ đúng, bỏ qua admin và người quan sát.
  - Mỗi API mới: kiểm tra đủ 5 quy tắc an toàn.
  - Khoá tài khoản: không đăng nhập được, phiên cũ trả 401, mở khoá xong đăng nhập lại được.
  - Người quan sát: trang Vận hành vẫn tải được dữ liệu (gọi thử từng API mà `reception.js` dùng, đều phải trả 200).
  - Sổ thu chi chỉ trả phần thu.
- Kiểm tra bằng tay trên bản chạy local (`npm run dev`):
  - Đăng nhập lần lượt 4 vai trò, đối chiếu menu và nút với bảng quyền.
  - Thử chỉnh riêng quyền cho một user, rồi đăng nhập user đó để xác nhận có hiệu lực.
