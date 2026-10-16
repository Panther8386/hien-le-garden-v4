# Đơn dịch vụ (ăn uống theo yêu cầu, sự kiện, đặt tiệc) và phiếu báo giá — Thiết kế

Ngày: 2026-10-15 · Trạng thái: chờ chủ dự án duyệt spec · Nền: `main` `bfdd211`

## 1. Mục tiêu

Hiền Lê Garden cần tiếp nhận, nhận cọc, tất toán và huỷ các đơn dịch vụ đặt trước ngoài lưu trú (ăn uống theo yêu cầu, tổ chức sự kiện, đặt tiệc), in phiếu báo giá chuyên nghiệp, và giữ doanh thu tách đúng theo từng mảng (Lưu trú, Bếp Hiền Lê, Hiền Lê Drinks, Ẩm thực liên kết…).

Thành công khi:

- Lễ tân/quản lý lập đơn (độc lập hoặc gắn booking lưu trú), nhận cọc, tất toán hoặc huỷ trong Admin.
- Mọi khoản thu/chi phát sinh từ đơn nằm đúng danh mục doanh thu của mảng và luôn khớp với đơn.
- Xem được "trong đó là tiền cọc" cho cả đơn dịch vụ và booking lưu trú.
- Luồng lưu trú, trả phòng và cọc lưu trú đang chạy không bị thay đổi hành vi.

## 2. Các quyết định đã chốt

| # | Quyết định |
|---|---|
| D1 | Đơn có thể đứng độc lập hoặc gắn một booking lưu trú (chỉ để tham chiếu). |
| D2 | Tiền cọc ghi thẳng vào doanh thu của mảng (danh mục thu), nhận diện là cọc qua liên kết với đơn. Không tạo danh mục `tien_coc`; phương án B cũ bị huỷ. |
| D3 | Một đơn gồm nhiều dòng, mỗi dòng thuộc một mảng. Cọc ghi vào **mảng chính** do nhân viên chọn. Ràng buộc: tổng cọc ≤ giá trị mảng chính. **Không đổi được mảng chính khi đơn còn cọc hiệu lực (`deposit_amount > 0`)** — bổ sung 15/10/2026 sau kiểm tra chéo F1: khoản thu cọc đã ghi theo mảng cũ, nếu đổi mảng thì tất toán trừ cọc ở mảng mới và lệch doanh thu từng mảng. Muốn đổi khi cọc ghi nhầm: xoá cọc (quyền `refund`) rồi đổi. |
| D4 | Giai đoạn này chỉ nhân viên nhập trong Admin; form công khai trên website để sau. |
| D5 | Dòng đơn nhập tự do: mô tả · số lượng · đơn giá · mảng. |
| D6 | Đơn gắn booking tất toán riêng; khi trả phòng chỉ cảnh báo nếu đơn liên kết chưa tất toán. |
| D7 | Huỷ: nhân viên nhập số tiền hoàn (0 → tổng cọc), lý do bắt buộc, có audit; không có quy tắc tự động. |
| D8 | Thêm quyền `service_orders.view`, `service_orders.manage`, `service_orders.refund`, `settings.quote_template` (danh mục 38 → 42). |
| D9 | Huỷ đơn có cọc luôn cần `service_orders.refund`, kể cả khi hoàn 0đ. Xoá cọc ghi nhầm cần `service_orders.refund`. |
| D10 | Có phiếu báo giá in (A4) và trang cài đặt mẫu phiếu trong nhóm Cài đặt. |
| D11 | Khoản thu/chi đang liên kết với nghiệp vụ không được sửa loại, danh mục, số tiền, trạng thái hay ngày ở màn Thu chi; chỉ sửa ghi chú. |
| D12 | Phát hành 2 PR: PR A (guard sửa thu chi) trước, PR B (phân hệ Đơn dịch vụ) sau. |

Ngoài phạm vi: form công khai trên website, chọn nhanh từ menu/danh mục dịch vụ, quản lý chi phí đối tác, gửi Telegram/email, mở lại đơn đã tất toán/huỷ, chia cọc theo tỷ lệ giữa các mảng.

## 3. PR A — Guard sửa khoản thu chi liên kết

Hiện trạng (`main` `bfdd211`): `PATCH /api/finance/transactions/:id` (`finance.manage`) cho phép đổi `type`, `category`, `amount`, `status`, `transaction_date` của mọi khoản chưa huỷ, kể cả khoản do trả phòng, cọc, hoàn cọc, order, Giờ Xanh, dịch vụ booking tạo ra. Guard `blockedFinanceLinks` (`lib/financeVoidGuard.js`) hiện chỉ áp dụng ở `void.js`.

Thay đổi:

- Nếu khoản thoả `blockedFinanceLinks` **hoặc** `cancelledDepositLink`, PATCH chỉ chấp nhận thay đổi `note`. Mọi trường khác khác giá trị hiện tại → 400 "Khoản này gắn với nghiệp vụ; chỉ sửa được ghi chú".
- Kiểm tra lại điều kiện trong chính câu `UPDATE` (guard trong SQL) để không bị lách bởi một liên kết mới xuất hiện giữa preflight và ghi.
- Audit `finance_transaction_update` giữ nguyên định dạng.
- Giao diện `admin/finance.js`: với khoản liên kết, khoá các ô trừ ghi chú và hiện nhãn nguồn.

Test: với từng loại liên kết hiện có (trả phòng theo `checkout_booking_id` và theo audit, order, Giờ Xanh, dịch vụ booking, hoàn cọc booking, cọc booking chưa huỷ/đã huỷ có hoàn, cọc booking đã huỷ chưa hoàn) — đổi số tiền/danh mục/loại/trạng thái/ngày bị chặn, đổi ghi chú được; khoản nhập tay vẫn sửa đủ trường; tranh chấp (liên kết xuất hiện sau preflight) bị chặn.

Không cần migration.

## 4. PR B — Phân hệ Đơn dịch vụ

### 4.1 Dữ liệu — migration `0046_service_orders.sql`

Chỉ thêm bảng, cột tuỳ chọn và dòng mới. Code cũ vẫn chạy được trên schema mới, nhưng sau khi đơn đã phát sinh thu chi thì code cũ **không** giữ guard cho các khoản đó — xem phương án rollback ở §6.

`service_orders`

| Cột | Kiểu / ràng buộc |
|---|---|
| `id` | INTEGER PK |
| `order_type` | TEXT NOT NULL CHECK IN (`an_uong_theo_yeu_cau`, `su_kien`, `dat_tiec`, `khac`) |
| `customer_name`, `phone` | TEXT NOT NULL |
| `organization`, `note`, `venue_note` | TEXT |
| `event_date` | TEXT NOT NULL (YYYY-MM-DD) |
| `event_time` | TEXT (HH:MM) |
| `guest_count` | INTEGER CHECK (> 0) |
| `booking_id` | INTEGER REFERENCES bookings(id) |
| `primary_category` | TEXT NOT NULL (slug danh mục thu) |
| `deposit_amount` | INTEGER NOT NULL DEFAULT 0 (tổng cọc còn hiệu lực) |
| `quote_valid_days` | INTEGER NOT NULL (lấy từ cài đặt khi tạo) |
| `requested_deposit` | INTEGER NOT NULL DEFAULT 0 (cọc đề nghị in trên phiếu) |
| `status` | TEXT NOT NULL CHECK IN (`draft`, `confirmed`, `settled`, `cancelled`) DEFAULT `draft` |
| `created_by/_at`, `updated_by/_at`, `confirmed_by/_at`, `settled_by/_at` | TEXT |
| `settlement_payment_method` | TEXT CHECK IN (`cash`, `transfer`) |
| `cancelled_by/_at`, `cancellation_origin` CHECK IN (`hotel`, `guest`), `cancel_reason` | TEXT |
| `refund_amount` | INTEGER |
| `refund_finance_transaction_id` | INTEGER REFERENCES finance_transactions(id) |
| `is_hidden` | INTEGER NOT NULL DEFAULT 0 |

Index: `(status, event_date)`, `(booking_id)`.

`service_order_items`: `id`, `order_id` NOT NULL REFERENCES service_orders(id), `description` TEXT NOT NULL, `quantity` INTEGER NOT NULL CHECK (> 0), `unit_price` INTEGER NOT NULL CHECK (≥ 0), `finance_category` TEXT NOT NULL, `display_order` INTEGER NOT NULL DEFAULT 0. Index `(order_id)`. Thành tiền = `quantity × unit_price` (tính, không lưu).

`service_order_deposits`: theo mẫu `booking_deposits` — `id`, `order_id`, `amount` CHECK (> 0), `payment_method` CHECK IN (`cash`, `transfer`), `note`, `finance_transaction_id`, `created_by/_at`, `voided_by/_at`. Index `(order_id)`.

`finance_transactions`: thêm `service_order_id INTEGER REFERENCES service_orders(id)` (nullable) và index. Mọi khoản thu/chi do đơn tạo ra mang giá trị này.

`quote_settings`: lưu theo phiên bản như `reminder_settings` (mỗi lần lưu thêm một dòng, đọc dòng mới nhất). Cột: `business_name`, `address`, `hotline`, `email`, `website`, `default_valid_days` (mặc định 7), `default_deposit_percent` (mặc định 30), `tax_note` ("Giá trên chưa bao gồm thuế VAT"), `cancellation_terms` ("Tiền cọc được hoàn hoặc giữ lại theo thoả thuận khi huỷ dịch vụ; vui lòng báo trước tối thiểu 7 ngày."), `footer_note`, `bank_name`, `bank_account`, `bank_holder` (trống mặc định), `updated_by`, `updated_at`. Dòng khởi tạo dùng thông tin công khai trên website (Hiền Lê Garden; Tổ Dân Phố 6 Bờ Đập, Nam Gia Nghĩa, Lâm Đồng; 0968 987 311; hello@hienlegarden.vn; hienlegarden.vn).

Quyền: `INSERT OR IGNORE` vào `role_permissions` — reception: `service_orders.view`, `service_orders.manage`; manager: thêm `service_orders.refund`, `settings.quote_template`; observer: `service_orders.view`. Cập nhật `lib/permissions.js` (`PERMISSION_GROUPS`, `ROLE_DEFAULTS`) khớp.

### 4.2 Vòng đời và thu chi

Trạng thái: `draft` → `confirmed` → `settled`; `draft`/`confirmed` → `cancelled`. Không mở lại.

Giá trị mảng `c` = Σ thành tiền các dòng có `finance_category = c`. Giá trị mảng chính `P` = giá trị mảng `primary_category`.

| Thao tác | Điều kiện | Thu chi | Quyền |
|---|---|---|---|
| Tạo | — | — | manage |
| Sửa thông tin, dòng, mảng chính | `draft`/`confirmed`; sau khi sửa `deposit_amount ≤ P`; đổi mảng chính chỉ khi `deposit_amount = 0` (kiểm ở preflight; trong câu lệnh ghi, cọc phát sinh giữa chừng bị chặn bởi điều kiện ghim `deposit_amount` sẵn có → 409, kèm điều kiện `primary_category = mới OR deposit_amount = 0` làm lớp chặn dự phòng) | — | manage |
| Chốt | `draft` → `confirmed`; ≥ 1 dòng | — | manage |
| Nhận cọc | `draft`/`confirmed`; `deposit_amount + amount ≤ P` | Thu · `primary_category` · "Cọc đơn #id — tên" | manage |
| Xoá cọc ghi nhầm | `draft`/`confirmed`; cọc chưa xoá | Huỷ khoản thu của cọc đó | **refund** |
| Tất toán | `confirmed`; chọn hình thức thanh toán | Mỗi mảng `c` có giá trị > 0 một khoản thu: `c ≠ primary` → giá trị `c`; `c = primary` → `P − deposit_amount` (bỏ qua nếu = 0). Ghi chú "Tất toán đơn #id — tên" | manage |
| Huỷ, không cọc | `draft`/`confirmed`; nguồn huỷ + lý do bắt buộc | — | manage |
| Huỷ, có cọc | như trên + `refund_amount` (0 → `deposit_amount`), lý do bắt buộc; nếu > 0 chọn hình thức thanh toán | Nếu `refund_amount > 0`: Chi · `hoan_coc` · "Hoàn cọc đơn #id — tên". Phần cọc không hoàn giữ nguyên là doanh thu mảng chính | **refund** (kể cả hoàn 0đ) |
| Ẩn khỏi lịch sử | `settled`/`cancelled` | — | `records.hide` |

Mọi khoản thu/chi có `service_order_id`, `transaction_date` = ngày thao tác, `status = 'confirmed'`.

Ràng buộc kỹ thuật cho mọi thao tác ghi:

- Một batch D1 nguyên tử: các khoản thu chi + thay đổi đơn/dòng/cọc + audit. Audit chỉ ghi khi câu `UPDATE` chính thắng (mẫu `cancelBooking`/`atomicSaleClose`).
- Guard trong SQL theo `status`, `deposit_amount`, và snapshot các dòng (chuỗi JSON các dòng theo `id`) đã đọc lúc preflight; lệch → 409 "Đơn vừa thay đổi, vui lòng tải lại".
- Khoản thu cọc và dòng `service_order_deposits` liên kết bằng `last_insert_rowid()` trong cùng batch.
- `primary_category` và `finance_category` phải là danh mục thu đang hoạt động (`lib/financeCategories.js`) **khi được chọn mới**. Danh mục bị tắt sau đó vẫn được giữ trên các dòng đã lưu và vẫn dùng khi tất toán (giống quy tắc sửa khoản thu chi hiện có); sửa một dòng sang danh mục khác thì danh mục mới phải đang hoạt động.
- `booking_id` (nếu có) phải tồn tại và người dùng được phép xem (`canSeeHidden`).

Audit: `service_order_create`, `service_order_update`, `service_order_confirm`, `service_order_deposit`, `service_order_deposit_delete`, `service_order_settle` (new_value JSON số tiền theo mảng), `service_order_cancel` (nguồn, lý do, số hoàn), `service_order_hide`, `quote_settings_update`. Không chép SĐT, thông tin chuyển khoản vào audit; `entity_label` = "Đơn #id".

`lib/financeVoidGuard.js`: thêm `OR finance_transactions.service_order_id IS NOT NULL` vào `blockedFinanceLinks` → chặn huỷ lẻ và (nhờ PR A) sửa lẻ các khoản của đơn.

### 4.3 API (`functions/api/service-orders/`)

| Endpoint | Quyền |
|---|---|
| `GET /api/service-orders?status=&type=&from=&to=&q=&includeHidden=` | view (`includeHidden` cần `records.hide`) |
| `POST /api/service-orders` | manage |
| `GET /api/service-orders/:id` (kèm dòng, cọc, khoản thu chi liên kết) | view |
| `PATCH /api/service-orders/:id` | manage |
| `POST /api/service-orders/:id/confirm` | manage |
| `POST /api/service-orders/:id/deposits` | manage |
| `DELETE /api/service-orders/:id/deposits/:depositId` | refund |
| `POST /api/service-orders/:id/settle` | manage |
| `POST /api/service-orders/:id/cancel` | manage nếu `deposit_amount = 0`, ngược lại refund |
| `PATCH /api/service-orders/:id/hide` | records.hide |
| `GET /api/quote-settings` | settings.view hoặc service_orders.view |
| `PUT /api/quote-settings` | settings.quote_template |

Mọi endpoint ghi yêu cầu thêm `service_orders.view`; thiếu quyền xem hoặc đơn bị ẩn với người không có `records.hide` → 404 như không tồn tại. Body qua `readJsonBody` có giới hạn kích thước; giới hạn độ dài trường văn bản (tên/đơn vị 200, ghi chú 2.000, mô tả dòng 500, cài đặt mỗi trường 1.000); số lượng 1–100.000, đơn giá 0–1.000.000.000, tổng đơn ≤ 10.000.000.000; tối đa 100 dòng mỗi đơn.

`GET /api/bookings` (danh sách) bổ sung `serviceOrders: [{ id, status }]` cho booking có đơn liên kết.

`GET /api/finance/transactions` bổ sung cho mỗi khoản `source`: `{ kind: 'service_order_deposit' | 'service_order_settle' | 'service_order_refund' | 'booking_deposit' | null, refId }` và tham số `depositsOnly=1` (khoản cọc của đơn và của booking).

### 4.4 Giao diện

- `admin/service-orders.html` + `.js` — nhóm **Vận hành** (sau Giờ Xanh), hiện khi có `service_orders.view`; URL gọn theo vai trò như các trang khác (`_redirects`, `nav-drawer.js`). Hai tab qua `tabs.js`: **Sắp diễn ra** (`draft`/`confirmed`, theo ngày, lọc loại) và **Lịch sử** (`settled`/`cancelled`, phân trang, tìm tên/SĐT, hiện đã ẩn cho `records.hide`).
- Thẻ đơn: loại, ngày giờ, khách/đơn vị, số khách, tổng, đã cọc, còn lại, trạng thái, liên kết booking.
- Hộp thoại tạo/sửa (chặn gửi trùng, giữ form khi lỗi): thông tin khách, loại, ngày giờ, số khách, khu vực/yêu cầu, gắn booking (danh sách booking `confirmed`/`checked_in`), mảng chính, cọc đề nghị (mặc định = làm tròn 1.000đ của tổng × % cài đặt, sửa được), hiệu lực báo giá, bảng dòng (thêm/xoá), tổng theo mảng, tổng đơn, cảnh báo cọc > mảng chính.
- Chi tiết đơn: danh sách cọc + form nhận cọc; nút xoá cọc chỉ hiện với `refund`; Chốt đơn; Tất toán (xem trước các khoản sẽ ghi theo mảng, chọn hình thức); Huỷ (nguồn, lý do bắt buộc, số hoàn — khi đơn có cọc chỉ người có `refund` mới mở được hộp thoại huỷ); In báo giá.
- `admin/service-order-quote.html` + `.js` — mẫu in A4 theo kiểu các mẫu in hiện có: phần đầu cơ sở (từ cài đặt), "PHIẾU BÁO GIÁ", số `BG-<năm lập>-<id 4 chữ số>`, ngày lập (= ngày tạo đơn), hiệu lực đến (= ngày lập + `quote_valid_days`), khách hàng, thông tin dịch vụ, bảng STT · Nội dung · SL · Đơn giá · Thành tiền, tổng cộng + bằng chữ, cọc đề nghị / đã cọc / còn lại, dòng thuế, điều khoản huỷ, thông tin chuyển khoản (chỉ khi đã có), ghi chú cuối, hai ô ký. Không hiện mảng doanh thu. Không in cho đơn đã huỷ.
- `admin/quote-settings.html` + `.js` — nhóm **Cài đặt**; xem với `settings.view`, sửa với `settings.quote_template`; nút "Xem trước phiếu" dùng đơn mẫu giả lập (không ghi dữ liệu).
- `admin/reception.js`: thẻ booking có nhãn "Có đơn dịch vụ #…" (link); hộp thoại trả phòng cảnh báo nếu có đơn liên kết `draft`/`confirmed` (không chặn, không đổi request trả phòng).
- `admin/finance.js`: nhãn nguồn trên mỗi khoản; bộ lọc "Chỉ khoản cọc"; khoá ô với khoản liên kết (PR A).
- Mọi nội dung hiển thị và in qua `textContent`. Responsive 390/800/1440px theo chuẩn Spec 2.
- `scripts/dist-policy.mjs`: thêm các file admin mới vào `REQUIRED`.

## 5. Kiểm thử

- API: tạo/sửa/chốt/nhận cọc/xoá cọc/tất toán/huỷ ở mọi trạng thái hợp lệ và không hợp lệ; quyền đủ/thiếu cho từng thao tác (gồm huỷ có cọc hoàn 0đ cần `refund`); 404 khi thiếu quyền xem hoặc bị ẩn; ràng buộc cọc ≤ mảng chính (nhận cọc, sửa dòng); đổi mảng chính bị từ chối khi còn cọc, được phép khi cọc = 0 hoặc đã xoá hết cọc, cọc phát sinh sau preflight → 409; luồng cọc → chốt → tất toán ghi tổng thu theo từng mảng đúng bằng tổng dòng; tất toán ghi đúng từng mảng và trừ đúng cọc ở mảng chính; tranh chấp hai thao tác cùng lúc → đúng một thắng, không ghi trùng; dữ liệu cũ (snapshot lệch) → 409; audit lỗi → rollback toàn bộ; danh mục không hoạt động / sai loại bị từ chối; giới hạn đầu vào.
- Guard thu chi: khoản của đơn không huỷ/sửa lẻ được; khoản nhập tay không bị ảnh hưởng.
- Migration: chạy lại không lỗi; `role_permissions` khớp `ROLE_DEFAULTS`; danh mục 42 mã; dữ liệu cũ không đổi.
- `GET /api/finance/transactions`: `source` và `depositsOnly` đúng cho cọc đơn và cọc booking.
- Giao diện (`scripts/check-admin-refresh.mjs` mở rộng): 4 vai trò × 3 kích thước cho trang đơn và trang cài đặt; luồng tạo → cọc → chốt → tất toán, và huỷ có hoàn; phiếu báo giá ở chế độ in; nút bị ẩn đúng theo quyền.
- Cổng: Linux đầy đủ (isolated + R2), CI 5 job, staging (mỗi luồng một lần với dữ liệu giả), production chỉ đọc sau deploy (health, R-1, migration, quyền).

## 6. Phát hành và rollback

1. PR A → CI → staging → chủ dự án duyệt → merge/deploy → kiểm tra chỉ đọc.
2. PR B → CI → staging (áp `0046` trên staging trước) → chủ dự án duyệt → áp `0046` trên production trước khi merge → merge/deploy → kiểm tra chỉ đọc.

Rollback (sửa 15/10/2026 sau kiểm tra chéo F2). Không xoá migration, không phục hồi toàn bộ D1, không xoá giao dịch.

- **Mặc định sau khi đã áp 0046 (kể cả khi chưa có giao dịch nào từ đơn):** dùng **bản rollback tương thích 0046** (nhánh `rollback/service-orders-0046-compat`). `COUNT` giao dịch có `service_order_id` bằng 0 **không đủ** chứng minh deploy nguyên PR A là an toàn. Còn dữ liệu đơn trong các bảng mới, và còn các dòng quyền `service_orders.*`/`settings.quote_template` đã seed: bản PR A không biết các mã này, nên chỉ cần lưu quyền vai trò một lần là chúng bị xoá, và migration không chạy lại để bù.
- **Đã phát sinh giao dịch từ đơn:** **tuyệt đối không** deploy nguyên bản PR A. Code PR A không nhận diện `service_order_id`, nên khoản cọc/tất toán/hoàn cọc của đơn sẽ sửa số tiền và huỷ riêng được trong Thu chi (đã tái hiện bằng test). Phải deploy **bản rollback tương thích 0046** = PR A + file migration `0046` + danh mục 4 mã quyền + guard `service_order_id IS NOT NULL` trong `blockedFinanceLinks`. Bản này không có API/trang đơn dịch vụ; dữ liệu đơn giữ nguyên trong D1. Trang Phân quyền vẫn hiện các ô `service_orders.*` và `settings.quote_template` dù chưa có chức năng đi kèm — cố ý, để việc lưu quyền không xoá các dòng 0046 đã seed.
- **Trong thời gian rollback:** tạm dừng mọi thao tác tiền của đơn dịch vụ. Không nhập tay khoản thu/chi thay cho cọc/tất toán/hoàn của đơn, để tránh ghi trùng khi bật lại. Khoản của đơn vẫn hiện và vẫn bị khoá trong Thu chi.
- **Kiểm chứng:** `test/serviceOrderRollbackGuard.test.js` qua trên PR B và trên bản tương thích, trượt trên PR A + 0046.

## 7. Rủi ro và giới hạn

- Doanh thu theo mảng lệch tạm thời giữa lúc nhận cọc và lúc tất toán (toàn bộ cọc ở mảng chính) — đã được chấp nhận (D3).
- Chi phí trả đối tác (Ẩm thực liên kết) vẫn nhập tay ở Thu chi.
- Thông tin chuyển khoản do chủ dự án nhập trong trang cài đặt; không lưu trong repo.
- PR A thay đổi hành vi màn Thu chi: khoản liên kết chỉ còn sửa được ghi chú; sửa sai phải đi qua nghiệp vụ gốc hoặc huỷ/nhập bù có kiểm soát.
