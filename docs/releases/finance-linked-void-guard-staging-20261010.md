# Bảo vệ chứng từ liên kết — staging 10/10/2026

PR #18: https://github.com/Panther8386/hien-le-garden-v4/pull/18

Source: ce689fa2b192bdbd1129f5cceb177d02f24c3f39. Staging deployment e1cc45bc; alias https://staging.hien-le-garden-v4.pages.dev. Chưa merge, chưa áp dụng migration hoặc deploy production.

## Hành vi

- Chặn huỷ riêng trong Thu chi đối với chứng từ liên kết cọc booking còn hiệu lực/đã hoàn cọc, dịch vụ, khoản hoàn, order ăn uống và phiên Giờ Xanh. Không tự mở lại nghiệp vụ đã kết thúc.
- Cọc booking đã huỷ, chưa hoàn: bắt buộc xác nhận cảnh báo. Sau huỷ thu, người dùng xoá cọc đã huỷ thu tại Lịch sử đặt phòng. Đây là sửa ghi nhận sai, không phải thao tác hoàn tiền thật.
- Kiểm lại liên kết trong câu UPDATE; audit chỉ được ghi nếu UPDATE thắng. Không ghi đè người/thời điểm huỷ khi gửi trùng.
- Migration 0045 thêm checkout_booking_id và index. Checkout mới ghi mã booking cùng giao dịch nguyên tử. Chứng từ checkout cũ có audit JSON khớp chính xác thời điểm, người tạo, ghi chú, danh mục và số tiền cũng bị chặn. Không backfill khoản thu nhập tay.
- Chứng từ cũ không có liên kết hoặc audit đủ tin cậy vẫn cần rà soát thủ công. Không suy đoán nguồn chỉ từ tên khách.

## Kiểm chứng

Linux Node 22.20: Thu chi 95/95, booking endpoints 95/95, atomic checkout 22/22, checkout races 8/8, order 63/63, Giờ Xanh 75/75. Có kiểm thử liên kết phát sinh sau preflight và kiểm tra checkout thực sự lưu mã booking. Build 135 file, check:dist 15/15 đạt. Windows gặp lỗi storage D1 trong runtime kiểm thử; đã chạy lại Linux đạt.

GitHub CI trên ce689fa: test, R-1, hai artifact Windows/Linux và F3 đều success.

Staging: guard tách biệt D1/R2 đạt; chỉ migration 0045 được áp dụng trên D1 staging. 6/6 kiểm tra đạt: chặn order; chặn Giờ Xanh; khoản thu ghi tay huỷ một lần; cọc đã huỷ yêu cầu xác nhận; cảnh báo thật qua giao diện; xoá cọc đưa số ghi nhận về 0. Booking thử và khoản thu thử đã ẩn, khoản thu đã huỷ nên không còn doanh thu hiệu lực.

Các lần script đầu dừng vì dùng trường mã chứng từ không có trong API list, thiếu phòng cụ thể và dùng sai trường mã cọc trong response. Đã sửa script; booking thử bị gián đoạn đã đối soát và ẩn trước khi chạy lại đạt. Không đổi chính sách huỷ để thử.

Bằng chứng: test-results/finance-void-guard/staging-result.json, staging-attempt2.json, staging-attempt3.json, github-state.json. Không chứa mật khẩu, token hoặc chứng từ thật.

## Phát hành cần duyệt

Áp dụng migration 0045 trên production trước khi merge PR #18 và deploy. Migration chỉ thêm cột nullable/index, không sửa số liệu cũ. Sau deploy, kiểm tra health, R-1, file giao diện và trạng thái liên kết chỉ đọc. Production hiện giữ bản cbc81c8 / d4f0c06b.
