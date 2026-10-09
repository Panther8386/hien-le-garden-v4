# Checkout nguyên tử — bàn giao staging 09/10/2026

**Hoàn thành trên staging; chưa merge/deploy production.** Báo cáo này cập nhật PR #13 từ dbf9d3e lên **5fa987ca4223aee7b02f6878d398ec0886fb7068**.

- PR: https://github.com/Panther8386/hien-le-garden-v4/pull/13 (draft).
- Deployment staging: `4fef83c6.hien-le-garden-v4.pages.dev`, alias `staging.hien-le-garden-v4.pages.dev`.
- Main kiểm tra sau khi cập nhật PR: `49ef1daeb50df1e6eb05ab73891422892dd00527`; PR chưa merge.
- Không có migration. Các bindings preview được kiểm tra tách biệt production trước deploy, kiểm thử và đọc D1 remote.

## Thay đổi

1. **Lưu trú:** kiểm tra dữ liệu tính tiền, ghi nhật ký checkout, các khoản thu phòng/dịch vụ hoặc chi hoàn cọc, đánh dấu dịch vụ paid, cờ dọn phòng và chuyển booking checked_out trong **một D1 batch**. Bỏ ghi chứng từ ngoài giao dịch và bỏ xoá bù sau lỗi. Ngoài danh sách dịch vụ/cọc/giá phòng, kiểm tra cả loại phòng, ngày và danh sách ngày lễ đã dùng tính giá.
2. **Order ăn uống và Giờ Xanh:** dùng helper `lib/atomicSaleClose.js`; cùng một batch kiểm tra trạng thái/tổng/số dòng, ghi nhật ký, tạo khoản thu và đóng cha cùng liên kết chính xác tới chứng từ vừa tạo. Helper chỉ chọn tên bảng từ allowlist nội bộ. Không dùng truy vấn MAX(id) hoặc xoá chứng từ bù sau lỗi.
3. **Nhật ký:** thêm bộ lọc và nhãn tiếng Việt cho trả phòng/thanh toán và chốt order/Giờ Xanh; hiển thị số tiền, không hiển thị mã yêu cầu nội bộ.

Giao dịch kiểm tra dữ liệu trước khi ghi. Thao tác chốt thua cạnh tranh trả 409 và không ghi gì; dữ liệu đổi phải tải lại. Lỗi SQL ở bất kỳ bước ghi nào làm rollback toàn bộ batch. Đây là đặc tính được mô tả trong [Cloudflare D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), đồng thời được kiểm chứng bằng lỗi thật trong D1 local.

## Kiểm chứng

| Hạng mục | Kết quả |
|---|---|
| Linux Node 22.20, D1 local | 9 bộ / **292/292** đạt |
| Ca mới | **22** ca lỗi ghi, cạnh tranh, mất phản hồi và thay đổi dữ liệu giá/cọc/ngày lễ |
| GitHub run 37894444894 | Hai check bắt buộc test và Release artifact boundary (R-1) đạt |
| CI bắt buộc | 84 file / 1.632 isolated + R2 12/14/27 = **1.685 test đạt** |
| Build/check:dist | 135 file; 15/15 tài sản bắt buộc; đạt |
| Admin artifact alias + immutable | **122/122 khớp** |
| R-1 hai host | **62 PASS / 0 FAIL / 0 INCONCLUSIVE** |
| Hai file source mới trên hai host | **4/4 private** |
| Staging UI | **6/6** luồng thanh toán mobile/PC + **1/1** đối soát nhật ký đạt |
| D1 staging chỉ đọc, liên kết chứng từ | **4/4** order/Giờ Xanh trỏ đúng receipt; total = receipt_amount = posted_total |

Bước R2 isolated thử nghiệm không chặn vẫn gặp lỗi isolated storage của toolchain cũ. Ba bộ R2 bắt buộc chạy riêng đều đạt; không tính bước thử nghiệm vào tổng 1.685.

### Lỗi và cạnh tranh trên local

- Gây lỗi SQLite thật bằng trigger chỉ trong D1 local tại: ghi receipt, cập nhật trạng thái cuối, receipt thứ hai, cập nhật dịch vụ, cờ dọn phòng và chi hoàn cọc. So sánh toàn bộ cha, chứng từ, audit, dịch vụ, cờ dọn trước/sau: không thay đổi. Gỡ trigger rồi thử lại thành công.
- Hai chốt song song: chỉ một thành công; một bộ chứng từ và một audit. Order/Giờ Xanh liên kết đúng receipt.
- Mất phản hồi sau khi D1 đã commit: không xoá chứng từ đã ghi; retry bị chặn bởi trạng thái đã đóng, không thu lần hai. Khi lỗi truyền thông như vậy, phản hồi lỗi không đủ để suy ra rollback; cần tải lại trạng thái. Đây là tình huống khác với lỗi SQL bên trong batch.
- Giữ 8 ca chống lệch tiền/thêm/huỷ sau đóng từ bản trước. Các hook cạnh tranh hiện chạy trước batch, không giả lập từng statement chạy riêng.

### Staging thật

- Booking #29, 390px, tiền mặt: phòng 300.000 + dịch vụ 50.000; receipt #60/#61.
- Booking #30, 1440px, chuyển khoản: cọc 375.000; phòng 300.000 + dịch vụ 50.000; hoàn dư 25.000; receipt #62/#63.
- Giờ Xanh #3/#4: tiền mặt/chuyển khoản, mỗi phiên 10.000; receipt #64/#65.
- Order #2/#3: tiền mặt/chuyển khoản, mỗi order 10.000; receipt #66/#67; UI ghi “Đã thanh toán · Đã kết thúc”.
- Chốt qua giao diện; kiểm tra thêm/huỷ sau đóng và chốt lặp bằng API đều bị từ chối; chứng từ không thay đổi. Mỗi lần chốt có một audit; bộ lọc và nhãn hiển thị đúng.
- **Đồng hồ trình duyệt booking được giả lập đến 02/12/2026** để booking 01→02/12 xuất hiện ở khách đi hôm nay. Máy chủ/D1 chạy thật. Không ép lỗi SQL hoặc dừng tiến trình trên staging; các ca này chạy trong D1 local cô lập.
- Giữ 6 fixture và 8 chứng từ để đối soát; prefix `ATOMIC-5fa987c-1791527964088`. Đã trả cờ dọn phòng #1/#2 do fixture tạo về trạng thái ban đầu. Không đổi chính sách/giá, không tạo tài khoản mới, không ghi dữ liệu production.

## Bằng chứng và giới hạn

Thư mục `test-results/atomic-checkout` chứa log local/CI/deploy, kết quả staging, D1 receipt links, artifact, R-1, ảnh và script kiểm thử. Gói zip chỉ chứa danh sách bằng chứng chọn rõ; không chứa file thông tin đăng nhập.

Ứng dụng/functions/lib/admin/test sạch so với 5fa987c khi deploy. Workspace vẫn có tài liệu SEC-1 sửa từ trước và báo cáo untracked; deploy gắn commit 5fa987c và commit-dirty=true. Dist chỉ chứa tài sản tracked được phép công khai.

Phạm vi nguyên tử ở đây là **checkout/chốt thanh toán**. Chưa chuyển các luồng khác như thêm dịch vụ trả riêng hoặc huỷ booking/hoàn cọc do huỷ sang cùng cơ chế. Chưa bổ sung đối soát trạng thái chứng từ Giờ Xanh sau khi chứng từ bị huỷ về sau. Không tự sửa dữ liệu lịch sử.

Bước tiếp: nghiệm thu staging rồi duyệt merge/phát hành PR #13. Cần kiểm tra đúng head 5fa987c và CI mới nhất trước merge; không cần migration.
