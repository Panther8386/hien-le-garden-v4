# Kiểm tra checkout — 09/10/2026

Nguồn kiểm tra: HEAD 19561f0, cùng cây mã nguồn với production main 49ef1da. Chỉ kiểm tra mã nguồn và D1 local cô lập; không tạo hoặc sửa giao dịch production. Chưa chạy lại toàn bộ giao diện ba luồng trên staging trong lần kiểm tra này.

## Kết luận

Chưa đủ điều kiện xác nhận cả ba luồng hoàn thiện. Luồng thông thường có kiểm thử đạt; hai tình huống thay đổi dịch vụ trong lúc chốt tái hiện được sai lệch tiền.

| Luồng | Kết quả |
|---|---|
| Lưu trú | Checkout tính tiền phòng, trừ cọc, thu dịch vụ và hoàn cọc dư đã có kiểm thử. Tuy nhiên dịch vụ thêm sau bước đọc tổng vẫn bị đánh dấu đã trả mà không được thu đủ. |
| Order ăn uống | Có kiểm tra lại tổng khi chốt, chặn thay đổi đồng thời và phân biệt đã thanh toán/cần đối soát theo chứng từ. Chưa xác nhận lại toàn bộ UI staging trong lần này. |
| Giờ Xanh | Có chốt phiên và tạo khoản thu, nhưng thiếu kiểm tra lại tổng khi chốt; lịch sử chỉ ghi “Đã chốt”, chưa phản ánh tình trạng chứng từ thanh toán. |

## Bằng chứng local

- 5 bộ kiểm thử hiện có: 238/238 đạt (bookingLifecycle, bookingTransitionRaces, bookingServiceItems, dineInOrders, gioXanhSessions).
- Hai kiểm thử bổ sung kiểm tra bất biến tài chính đều thất bại, xác nhận lỗi:
  - Giờ Xanh: thêm 25.000 giữa lúc đọc tổng và ghi thu; tổng dịch vụ 155.000 nhưng phiên đóng và khoản thu vẫn 130.000.
  - Lưu trú: thêm 25.000 giữa lúc đọc tổng và ghi thu; 75.000 dịch vụ bị đánh dấu paid nhưng servicesDue chỉ 50.000; fixture không có cọc dư.
- Bằng chứng: `test-results/checkout-audit/baseline.log`, `races.log`, `checkoutAudit.test.js`.
- Đây là xen kẽ thao tác có kiểm soát tại ranh giới ghi DB, không phải thử tải. Chưa kết luận dữ liệu production đã lệch.

## Hướng xử lý theo ưu tiên

1. Chặn checkout lưu trú và chốt Giờ Xanh khi các giá trị dùng tính tiền thay đổi; mọi cập nhật dịch vụ phải kiểm tra phiên/booking còn mở ngay lúc ghi. Trả lỗi xung đột để nhân viên tải lại và xác nhận số tiền mới.
2. Đưa tạo thu/chi và đổi trạng thái vào cùng giao dịch nguyên tử. Hiện các endpoint tạo khoản thu trước rồi cập nhật trạng thái, dựa vào dọn dẹp khi lỗi; sự cố giữa các bước có thể để lại khoản thu rời. Đây là rủi ro từ cấu trúc mã, chưa tái hiện sự cố tiến trình.
3. Giờ Xanh cần kiểm tra chứng từ liên kết và hiển thị đã thanh toán/cần đối soát, gồm trường hợp chứng từ bị huỷ hoặc sai số tiền.
4. Sau sửa: chạy lại hai ca tái hiện, kiểm thử cạnh tranh thêm/xoá dịch vụ và chốt hai lần; kiểm thử lỗi giữa các bước ghi. Chạy giao diện staging cho tiền mặt/chuyển khoản, cọc đủ/thiếu/dư, dịch vụ trả riêng và trả khi checkout, chứng từ bị huỷ. Đối soát số tiền và số lượng chứng từ, không chỉ trạng thái HTTP.
5. Đối soát production chỉ đọc trước khi quyết định xử lý dữ liệu lịch sử; không tự tạo khoản thu bù hoặc sửa chứng từ.

Không sửa mã ứng dụng, merge hay deploy trong đợt kiểm tra này.
