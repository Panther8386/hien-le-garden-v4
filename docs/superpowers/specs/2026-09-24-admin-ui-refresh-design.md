# Làm mới giao diện admin — thiết kế

Ngày: 2026-09-24 · Trạng thái: đã được chủ dự án cho phép triển khai ngày 07/10/2026 trong chat; chưa nghiệm thu/release · Phần 2/2 (phần 1: `2026-09-24-admin-permissions-design.md`, triển khai trước)

## 1. Mục tiêu

Người dùng phản ánh: giao diện cũ, chức năng sắp xếp lộn xộn, có trang phải cuộn dài, nút quá khổ. Admin được dùng **ngang nhau trên điện thoại (lễ tân) và máy tính (quản lý)**.

Đợt này làm:
1. Hệ thống giao diện mới **nền sáng**, hướng "Lá non" đã chọn.
2. Khung điều hướng mới: menu cố định bên trái trên máy tính, thanh dưới trên điện thoại. Menu được sắp xếp lại nhóm.
3. Trang **Vận hành hôm nay** chia thành tab. Form tạo đặt phòng chuyển thành nút mở hộp thoại.

Ngoài phạm vi, làm ở đợt sau với spec riêng:
- Rút gọn Sổ thu chi, Kho, Bảng giá dịch vụ, Cấu hình khuyến mãi.
- Chế độ tối. Token màu đã tách riêng để thêm sau này dễ dàng.

Không đổi chức năng, API hay URL.

## 2. Nguyên tắc kỹ thuật

- **Giữ tên class hiện có.** Viết lại nội dung `admin.css` để khoảng 28 trang và các file JS không phải đổi DOM, trừ khung điều hướng và trang Vận hành.
- Không thêm bước build, không thêm thư viện UI.
- Font: **Be Vietnam Pro** (400/500/600/700) qua Google Fonts. Thẻ `<link>` font trong mọi trang admin được thay bằng font mới. Admin **bỏ Cormorant Garamond và Inter**.
- Các trang in (`*-print.html`) giữ bố cục in hiện tại. Nếu CSS mới làm hỏng bản in thì thêm quy tắc `@media print` riêng, và phải kiểm tra lại cả 3 trang in.

## 3. Token giao diện

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--bg` | `#FBFCFA` | nền trang |
| `--surface` | `#FFFFFF` | thẻ, bảng, hộp thoại |
| `--side` | `#EEF3EC` | menu trái, hàng nhóm trong bảng |
| `--line` | `#E4E9E2` | viền, đường kẻ |
| `--line-strong` | `#C9D3C6` | viền input, nút phụ |
| `--ink` | `#17281D` | chữ chính |
| `--muted` | `#5E6E63` | chữ phụ, nhãn |
| `--primary` | `#2E6A48` | nút chính, tab đang chọn, focus |
| `--primary-ink` | `#1F4D33` | tên thương hiệu, link |
| `--gold` | `#B8923A` | **chỉ** vạch đánh dấu mục menu đang mở |
| trạng thái chờ | nền `#FCEFD6` / chữ `#8A5A0B` | pending, chờ đóng, cảnh báo |
| trạng thái tốt | `#DDEFE3` / `#1E6B3E` | đã xác nhận, đã thanh toán, trống |
| trạng thái thông tin | `#E3ECF8` / `#2B5590` | đang ở, đang kiểm |
| trạng thái lỗi | `#F8E1DE` / `#A1362B` | huỷ, hết hạn, lỗi, nút xoá |
| trung tính | `#EEF0EE` / `#56605A` | đã trả phòng, nháp, đã dùng |

Mọi lớp `.status-*` và `.room-*` hiện có được ánh xạ vào 5 nhóm trạng thái trên. Thẻ phòng bỏ hiệu ứng "bóng kính" (gradient và đổ bóng), chỉ giữ nền màu trạng thái cùng viền `--line`.

**Chữ**:
- Cỡ chữ: 12 / 13 / **15 (thân)** / 17 / 20 / 24px. Tiêu đề trang dùng 24px đậm 700 với `letter-spacing: -0.01em`.
- Trên điện thoại, tiêu đề trang 20px.
- Input luôn 16px để iOS không tự phóng to khi bấm vào.
- Số tiền và số liệu dùng `font-variant-numeric: tabular-nums`.
- Nhãn không viết IN HOA toàn bộ.

**Hình khối**:
- Bo góc: 6px cho input, nút và thẻ trạng thái. 10px cho thẻ và hộp thoại. Thẻ trạng thái dạng viên thuốc (999px).
- Không dùng bóng đổ, trừ hộp thoại và menu trượt.

## 4. Thành phần

- **Nút**:
  - Rộng theo nội dung, **không kéo full chiều ngang**. Riêng nút trong hộp thoại trên màn dưới 640px thì full chiều ngang.
  - Chiều cao 36px trên máy tính, 40px trên màn cảm ứng (`pointer: coarse`).
  - 4 kiểu:
    - `button` mặc định: nút chính, nền `--primary`.
    - `.btn-secondary`: nền trắng, viền `--line-strong`.
    - `.btn-danger` (mới): chữ và viền màu đỏ lỗi.
    - `.btn-ghost` (mới): không viền.
  - Có trạng thái `:disabled`.
  - Focus hiện viền `2px solid var(--primary)` với `outline-offset: 2px` trên mọi phần tử tương tác.
- **Form**:
  - Nhãn nằm trên ô nhập, cỡ 13px, màu `--muted`.
  - Ô nhập cao 40px, viền `--line-strong`, nền trắng.
  - Giữ nguyên `.form-row` và `.form-row-4`.
- **Bảng**:
  - Nền trắng, đầu bảng màu `--muted` cỡ 13px, không màu vàng.
  - Dòng cách nhau bằng `--line`, hover đổi nền `--bg`.
  - Giữ nguyên `.table-scroll`.
- **Thẻ** (`.booking-card`, `.dine-order-card`, `.gio-xanh-card`, `.stat-card`, `.template-card`): nền trắng, viền `--line`, bo 10px, không bóng.
- **Hộp thoại** (`.confirm-overlay`, `.confirm-box`): nền trắng, lớp phủ `rgba(23,40,29,.45)`. Trên điện thoại dưới 640px, hộp thoại hiện như một tấm trượt từ dưới lên, có thể cuộn.
- **Tab** (mới, `.tabs` + `.tab`):
  - Gạch chân 2px `--primary` dưới tab đang chọn.
  - Tab có thể kèm số đếm (`.tab-count`, nền trạng thái chờ).
  - Thanh tab cuộn ngang được trên điện thoại.
  - Thay cho `.tab-btn`, nhưng vẫn giữ style cho `.tab-btn` cũ để các trang chưa làm lại không bị vỡ.
- **Đầu trang** (mới, `.page-head`): tiêu đề nằm bên trái, nút hành động chính nằm bên phải, tự xuống dòng khi màn hẹp.
- **Khung nội dung**:
  - `.page` giờ rộng theo không gian còn lại, tối đa 1280px, lề 24px trên máy tính và 16px trên điện thoại.
  - Class `.page-wide` được giữ lại nhưng không còn tác dụng.
  - Trang đăng nhập và các trang form ngắn (đổi mật khẩu, bảo mật) dùng class mới `.page-narrow`, rộng tối đa 480px.

## 5. Khung điều hướng (`nav-drawer.js` viết lại, giữ tên file)

Menu mới, nhóm theo tần suất dùng. Mục nào user không có quyền thì ẩn; nhóm nào không còn mục nào thì ẩn cả nhóm.

| Nhóm | Mục |
|---|---|
| Vận hành | 🛎️ Hôm nay · 🍽️ Order ăn uống · 🌿 Giờ Xanh |
| Khách hàng | 👥 Khách hàng · ✉️ Template tin nhắn · 🎁 Khuyến mãi & quà |
| Tài chính | 📊 Tổng quan số liệu · 💵 Sổ thu chi |
| Kho & tài sản | 📦 Kho · 📋 Kiểm kê tài sản · 🏷️ Danh mục tài sản · 📄 Hồ sơ nguồn · 🗂️ Danh mục & vị trí |
| Cài đặt | 🛏️ Phòng & giá · 💰 Bảng giá dịch vụ · 🍴 Menu quán · 🔄 Chính sách hoàn cọc · 🧾 Danh mục thu chi · 🔑 Phân quyền · 📜 Nhật ký thao tác |

- **Từ 1024px trở lên**:
  - Menu trái cố định, rộng 232px, nền `--side`.
  - Tên "Hiền Lê Garden" ở trên cùng.
  - Mục đang mở có nền trắng và vạch vàng 3px bên trái.
  - Cuối menu hiện tên user, vai trò, cùng các link Đổi mật khẩu, Bảo mật và Đăng xuất.
  - Menu tự cuộn khi dài.
- **Từ 640 đến 1023px**: thanh trên cùng có tên thương hiệu và nút ☰. Bấm nút thì cùng menu đó trượt ra từ bên trái.
- **Dưới 640px**:
  - Thanh dưới cố định gồm tối đa 4 mục đầu tiên user có quyền, theo thứ tự ưu tiên Hôm nay → Order → Giờ Xanh → Khách hàng → Sổ thu chi, cộng thêm nút **☰ Thêm**.
  - Nút Thêm mở toàn bộ menu dạng tấm trượt từ dưới lên.
  - Người quan sát chỉ thấy Hôm nay, Sổ thu chi và nút Thêm.
  - Thanh dưới cộng thêm `env(safe-area-inset-bottom)`, và nội dung trang chừa khoảng trống tương ứng ở dưới.
- **Truy cập & chuyển động**:
  - Menu trượt đóng được bằng phím Esc hoặc bấm ra ngoài, và giữ focus bên trong khi mở.
  - Chuyển động trượt tắt khi hệ thống bật `prefers-reduced-motion`.
- Mục menu đang mở được xác định theo trang hiện tại, như cách làm hiện nay. URL giữ theo tiền tố vai trò.

## 6. Trang Vận hành hôm nay

**Đầu trang**:
- Tiêu đề "Vận hành hôm nay". Bên phải là nút **+ Đặt phòng mới**, chỉ hiện khi có `bookings.manage`. Trên điện thoại nút rút gọn thành "+ Đặt".
- Bấm nút mở form tạo đặt phòng hiện có (`#newBookingForm`, giữ nguyên trường và logic) trong hộp thoại dạng `form-overlay`.
- Tạo thành công thì đóng hộp thoại và làm mới danh sách.

**Các tab** (URL hash giữ tab đang chọn, tải lại trang vẫn ở tab đó):

| Tab | Hash | Nội dung (các khối hiện có, giữ nguyên id) | Điều kiện hiện |
|---|---|---|---|
| Việc cần làm (số đếm = số booking "Cần xử lý") | `#viec` | Nhắc việc hôm nay (dạng thanh nổi bật màu chờ ở đầu tab) · Cần xử lý · Hôm nay (nhận/trả) | `bookings.view` |
| Đặt phòng | `#dat-phong` | Đã xác nhận (sắp tới) · Đang ở · Lịch sử đặt phòng | `bookings.view` |
| Sơ đồ phòng | `#so-do` | Trạng thái phòng + chú thích + lịch sử sắp xếp | `bookings.view` |
| Tra mã ưu đãi | `#uu-dai` | Tra cứu & đổi mã ưu đãi | `promo.redeem` |

- **Trên máy tính (từ 1024px)**, tab Việc cần làm chia 2 cột: "Cần xử lý" bên trái, "Hôm nay" bên phải. Nhắc việc nằm trên, trải hết bề ngang.
- Bỏ emoji và dấu "+" khỏi tiêu đề khối: "🔔 Nhắc việc hôm nay" thành "Nhắc việc hôm nay".
- **Code**:
  - Logic chuyển tab nằm trong file mới `admin/tabs.js`, dùng chung cho các trang sau này.
  - Cách dùng: gắn `data-tabs` và `data-tab-panel="viec"` trong HTML, JS chỉ bật tắt thuộc tính `hidden`.
  - Tab dùng `role="tablist"`/`role="tab"`/`aria-selected` và chuyển bằng phím mũi tên.
- `reception.js` chỉ đổi phần cần thiết: mở/đóng hộp thoại tạo đặt phòng, cập nhật số đếm trên tab. Các hàm render giữ nguyên, vì các khối vẫn giữ id cũ.

## 7. Kiểm thử và nghiệm thu

- Chạy `npm run dev`, đăng nhập bằng từng vai trò, rồi chụp màn hình ở 3 cỡ 390px, 800px và 1440px cho các trang: Vận hành hôm nay (đủ 4 tab), Sổ thu chi, Kho, Phân quyền, Đăng nhập, cùng 1 trang in.
- **Rà từng trang** trong khoảng 28 trang: không vỡ bố cục, không còn nút kéo full màn hình (trừ trong hộp thoại trên điện thoại), bảng cuộn ngang được.
- **Bàn phím**: đi hết menu bằng Tab/Enter, chuyển tab bằng phím mũi tên, đóng hộp thoại bằng Esc.
- **Độ tương phản**:
  - Chữ `--ink` và `--muted` trên `--bg` đạt tối thiểu WCAG AA 4.5:1.
  - Chữ trắng trên nền `--primary` cũng đạt AA.
  - 5 cặp màu trạng thái đều đạt AA.
- Toàn bộ test Vitest vẫn phải qua (phần này không đổi API).
