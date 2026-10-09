# Checkout: bàn giao staging — 09/10/2026

**Bản sửa dbf9d3e đã đạt CI và kiểm thử staging. Chưa merge/deploy production.** Cập nhật tiếp theo: PR #13 hiện là 5fa987c với checkout nguyên tử ở cả ba luồng; xem `atomic-checkout-staging-20261009.md`. Các số liệu dưới đây giữ nguyên cho bản dbf9d3e.

- PR draft #13: https://github.com/Panther8386/hien-le-garden-v4/pull/13
- Source: `dbf9d3e774a3a80925dd011add6d32b4e53c949c`
- Staging deployment: `f12ec754.hien-le-garden-v4.pages.dev`; alias `staging.hien-le-garden-v4.pages.dev`.
- Không có migration. Production main vẫn `49ef1daeb50df1e6eb05ab73891422892dd00527` tại lần kiểm tra.

## Phạm vi sửa

Checkout lưu trú kiểm tra lại các dòng dịch vụ, trạng thái thanh toán, cọc và dữ liệu phòng dùng tính tiền trước khi ghi các tác động trong giao dịch D1. Giờ Xanh kiểm tra lại tổng ngay trong lệnh đóng. Nếu thay đổi đồng thời làm dữ liệu không khớp, trả 409 và yêu cầu tải lại; dọn khoản thu/chi tạm do riêng yêu cầu này tạo.

Thêm/huỷ dịch vụ ở cả hai luồng kiểm tra trạng thái cha ngay lúc ghi. Nếu checkout thắng trước, không ghi dịch vụ/audit/huỷ thu từ yêu cầu đến muộn. Nếu dịch vụ thay đổi trước, checkout kiểm tra lại trước khi chốt.

## Kết quả

| Kiểm tra | Kết quả |
|---|---|
| Local D1, 6 bộ liên quan | 247/247 đạt; gồm 8 ca cạnh tranh mới |
| GitHub CI run 37873732998 | test và Release artifact boundary (R-1) đạt |
| CI bắt buộc | 83 file / 1.610 test; R2 chạy riêng 12 + 14 + 27; tổng 1.663 đạt |
| Artifact admin trên immutable + alias | 122/122 file khớp dist |
| R-1 trên hai host staging | PASS=62, FAIL=0, INCONCLUSIVE=0 |
| UI 390px/1440px, dữ liệu staging thật | 4/4 kịch bản đạt, không có lỗi JavaScript |

CI còn bước R2 isolated thử nghiệm không chặn: lỗi isolated storage của bộ công cụ cũ vẫn xuất hiện. Ba bộ R2 chạy riêng bắt buộc đều đạt; không tính bước thử nghiệm này vào 1.663 test.

### Lưu trú

- Booking giả #27, mobile, tiền mặt: thu phòng 300.000 + dịch vụ 50.000; không hoàn. Đã thêm và huỷ dòng 25.000 trước checkout, dòng này vẫn voided; dòng 50.000 thành paid.
- Booking giả #28, PC, chuyển khoản: cọc 375.000, phòng 300.000, dịch vụ 50.000; hoàn cọc dư 25.000, không ghi thêm thu dịch vụ.
- Checkout qua nút trên UI. Sau checkout, API thêm dịch vụ đã trả, huỷ dòng và checkout lần hai đều bị chặn; sổ thu chi không thay đổi. Chứng từ #54–#57.
- **Chỉ đồng hồ trình duyệt giả lập tới 21/11/2026** để các booking 20→21/11 hiện trong mục khách đi hôm nay. Máy chủ, API, D1 và ghi thu/chi chạy thật. Đây không phải kiểm tra thời gian máy chủ qua đêm.
- Cờ cần dọn của phòng #1/#2 do booking giả tạo đã được trả lại qua chức năng clean. Không thay đổi giá phòng hoặc chính sách hoàn cọc.

### Giờ Xanh

- Phiên giả #1 mobile/tiền mặt và #2 PC/chuyển khoản: thêm món và chốt qua UI, mỗi phiên thu 10.000, đúng tổng posted. Chứng từ #58/#59.
- Sau khi đóng, thêm dòng, huỷ dòng, chốt lần hai đều bị chặn; không thêm chứng từ hoặc đổi tổng.
- Tình huống xen kẽ chính xác trong lúc server đọc/ghi được kiểm chứng bằng D1 local; staging xác nhận giao diện, ghi tiền thật và chặn thao tác sau đóng, không khẳng định đã ép đúng cửa sổ cạnh tranh trên máy chủ staging.

## Dữ liệu và bằng chứng

Giữ 4 fixture đã hoàn tất để đối soát: booking #27/#28 và Giờ Xanh #1/#2, cùng 6 chứng từ #54–#59. Không tạo tài khoản mới. Không sửa/xoá dữ liệu production. Prefix fixture `CHECKOUT-dbf9d3e-1791512460712`.

Bằng chứng trong `test-results/checkout-audit`: `pr.json`, `ci.json`, `github-test.log`, `fix-tests.log`, `staging-check.json`, `staging-check.log`, `staging-artifact.json`, `staging-r1.log`, `staging-deploy.log`, ảnh 390/1440 và script kiểm thử. Các file chứa mật khẩu không được đưa vào gói.

Ứng dụng/functions/test sạch so với commit dbf9d3e khi deploy; workspace còn thay đổi tài liệu SEC-1 có sẵn và báo cáo chưa tracked. Deployment được gắn commit dbf9d3e, `commit-dirty=true` để phản ánh workspace; dist chỉ lấy tài sản tracked. Các thay đổi tài liệu không được phát hành công khai.

## Giới hạn và bước tiếp

Chưa đưa tạo thu/chi và chuyển trạng thái vào cùng một giao dịch; rủi ro tiến trình bị ngắt trước bước dọn khoản thu tạm vẫn là hạng mục riêng. Chưa bổ sung đối soát chứng từ/trạng thái thanh toán cho Giờ Xanh. Chưa tuyên bố cả ba luồng checkout đã hoàn thiện toàn bộ.

Đề nghị nghiệm thu bản sửa trên staging, sau đó duyệt merge PR #13 và phát hành production. Không cần migration; cần kiểm tra CI còn đạt trên đúng head, main không thay đổi ngoài dự kiến, rồi kiểm tra lại deployment mới và đường dẫn riêng tư sau phát hành.
