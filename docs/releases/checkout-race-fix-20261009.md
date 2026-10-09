# Sửa lệch tiền khi checkout — 09/10/2026

Trạng thái tại lúc sửa local: chưa commit, push hoặc deploy. Nền mã nguồn HEAD 19561f0 (cùng cây với main 49ef1da). Không có migration. Cập nhật sau: bản dbf9d3e đã push, PR #13 và staging f12ec754 đạt; xem `checkout-staging-handoff-20261009.md`. Chưa merge/deploy production.

## Hành vi

- Checkout lưu trú chụp danh sách dòng dịch vụ (id, số tiền, trạng thái dòng, trạng thái thanh toán), tổng chưa trả và dữ liệu cọc/giá phòng. Trong cùng giao dịch D1, chỉ ghi audit checkout, đánh dấu dịch vụ đã trả, đánh dấu phòng cần dọn và đóng booking nếu dữ liệu vẫn khớp. Mỗi lần checkout có mã riêng trong audit để các thao tác thuộc cùng một lần chốt. Dữ liệu đổi thì trả 409, dọn các khoản thu/chi vừa tạo của riêng yêu cầu đó và yêu cầu tải lại.
- Giờ Xanh kiểm tra lại tổng dịch vụ ngay trong lệnh đóng phiên. Tổng thay đổi thì trả 409, xoá khoản thu tạm vừa tạo và giữ phiên mở.
- Thêm dịch vụ từ Menu Quán hoặc Bảng giá dịch vụ chỉ ghi được khi booking còn confirmed/checked_in. Thêm dòng Giờ Xanh chỉ ghi khi phiên còn open.
- Huỷ dòng dịch vụ kiểm tra lại trạng thái booking/phiên và trạng thái dòng ngay trong giao dịch ghi audit, huỷ khoản thu liên kết (nếu có) và huỷ dòng. Không cho sửa dịch vụ sau checkout, kể cả tài khoản có quyền xem bản ghi ẩn.
- Nếu thao tác dịch vụ thắng trước, checkout phải tải lại tổng mới; nếu checkout thắng trước, thao tác dịch vụ bị từ chối. Không dùng khoá dài qua nhiều HTTP request.

## Kiểm chứng

- Linux/WSL Node 22.20, D1 local cô lập: 6 bộ kiểm thử, **247/247 đạt**.
- 8 ca mới: thêm/huỷ dịch vụ trong lúc chốt ở cả hai luồng; chốt từ chối không để lại khoản thu hoặc đánh dấu paid/cleaning; thử lại chốt đúng tổng mới; thêm/huỷ sau khi thao tác khác đóng bị từ chối và không ghi audit/thu sai.
- Thêm kiểm tra records.hide không cho phép huỷ dịch vụ của booking đã checkout. Giữ bài kiểm tra quyền xem bản ghi ẩn trên booking còn hoạt động.
- Build 135 file đạt; check:dist 15/15 đạt; git diff --check đạt.
- Bằng chứng: test-results/checkout-audit/fix-tests.log và test/checkoutSettlementRaces.test.js. Log baseline.log/races.log giữ nguyên bằng chứng lỗi trước sửa.

## Giới hạn và bước phát hành

Chưa kiểm thử bản sửa qua UI staging, chưa chạy CI GitHub, chưa deploy. Production không thay đổi.

Việc đưa toàn bộ ghi thu/chi và đổi trạng thái vào cùng một giao dịch vẫn là hạng mục riêng: các khoản thu/chi hiện được ghi trước giao dịch đóng và dọn khi xung đột/lỗi. Bản sửa xử lý hai lỗi cạnh tranh đã tái hiện, chưa giải quyết rủi ro tiến trình bị ngắt trước bước dọn khoản thu tạm.

Bước tiếp theo: review/commit riêng các file bản sửa, mở PR chạy CI, kiểm thử staging; sau khi đạt mới triển khai production.
