# Admin Spec 2 — triển khai và xác minh cục bộ

Ngày 07/10/2026. Chủ dự án cho phép triển khai Spec 2, điều hướng, thành phần chung và Booking / Guest Management trong chat. Đây là ghi nhận triển khai, chưa phải nghiệm thu hay cho phép release.

## Phạm vi đã triển khai

- Nền sáng Lá non, token màu và font Be Vietnam Pro; cập nhật liên kết font trên 28 trang HTML Admin, bao gồm ba mẫu in.
- Các thành phần chung: nút theo nội dung, form, bảng, thẻ trạng thái, hộp thoại, tab và đầu trang. Giữ các class dùng bởi bộ điều khiển hiện có.
- Năm nhóm điều hướng: Vận hành, Khách hàng, Tài chính, Kho & tài sản, Cài đặt. Giữ nguyên điều kiện quyền đơn/kết hợp và URL theo vai trò.
- Sidebar từ 1024px; menu bên trái trên tablet; thanh dưới và menu dạng tấm trượt trên điện thoại. Menu hỗ trợ Esc, bấm ngoài, giữ/trả focus, inert nền và reduced motion.
- Vận hành hôm nay có bốn tab, ghi nhớ hash, phím mũi tên/Home/End, số đếm yêu cầu chờ. Tab mã ưu đãi và nút đặt phòng phụ thuộc quyền hiện có.
- Form đặt phòng hiện có chuyển vào hộp thoại, đóng khi tạo thành công, giữ form và lỗi khi thất bại; giữ nguyên tải lại danh sách. Quản lý khách hàng hiện có được áp dụng nền giao diện và nhóm điều hướng mới; chưa mở rộng nghiệp vụ CRM.
- Không đổi API, dữ liệu, migration, production, hay D4B đang chờ 24 giờ.

## Xác minh

- `node --check` cho ba file JavaScript thay đổi: PASS.
- `npm run build` và `npm run check:dist`: PASS (chạy lại sau sửa cuối).
- `node scripts/check-admin-refresh.mjs`: kiểm tra 390/800/1440px với bốn bộ quyền giả lập. Kiểm tra tab, hash/reload, bàn phím, quyền hiển thị, menu, modal và gửi tạo booking tới API giả lập. Ảnh nằm trong `test-results/admin-refresh/`.
- Kiểm tra khung HTML của toàn bộ trang tại ba kích thước; controller nghiệp vụ không liên quan bị tắt trong kiểm tra này. Đây không thay thế đăng nhập và UAT dữ liệu thật. Ba mẫu in chạy controller thật với dữ liệu giả lập và được chụp chế độ print có nội dung.
- Các yêu cầu Google Fonts bị chặn trong kiểm tra tự động để chạy độc lập mạng; ảnh dùng font dự phòng. Cần xác minh font tải thật khi UAT.
- Vitest toàn bộ: chưa PASS. Lượt đầu báo 55 file passed, 925 tests passed, 25 file failed, 20 tests failed và 19 errors, kèm lỗi workerd/ConnectEx/isolated storage trên Windows. Không coi các lỗi này đã được xử lý hay chứng minh không liên quan thay đổi. Lượt chạy lại một worker không chạy được test vì lỗi module fallback/kết nối của workerd. Log lượt hai: `test-results/admin-refresh/vitest.log`.

## Còn trước nghiệm thu/release

Chạy toàn bộ Vitest trong môi trường hoạt động ổn định; đăng nhập thật từng vai trò trên môi trường kiểm thử, rà luồng đặt phòng, khách hàng, tài chính, kho và phân quyền với dữ liệu đại diện. Chưa ghi nhận các mốc QA/UAT/release COMPLETE và chưa deploy.
