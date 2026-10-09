# SEC-3 — bàn giao staging, 09/10/2026

**Đạt kiểm thử staging, sẵn sàng duyệt phát hành production. Chưa merge/deploy production.**

- PR: [#12](https://github.com/Panther8386/hien-le-garden-v4/pull/12), draft.
- Source: `19561f0c9f5e1e46992790a30818ebcf7533f196`.
- Staging: `716e1945.hien-le-garden-v4.pages.dev`, alias `staging.hien-le-garden-v4.pages.dev`.
- Migration `0044_login_rate_limits.sql` áp dụng thành công trên D1 staging trước code; guard xác nhận staging tách biệt production.
- Linux local: 1.654 test đạt; sau sửa fixture hết hạn 2FA, 66/66 kiểm tra liên quan đạt. CI run `37870222942` trên head chính xác đạt cả R-1 và Tests.
- Artifact admin: 61/61 file khớp byte với `dist/admin` trên mỗi host, tổng 122/122; R-1 PASS=62, FAIL=0, INCONCLUSIVE=0.

## Nghiệp vụ trên staging thật — 8/8 PASS

1. Tạo observer giả và đăng nhập mật khẩu.
2. Đăng ký TOTP và xác minh challenge thật.
3. Lượt thứ 6 của tài khoản/mạng trả 429 với Retry-After; không cấp token/session mới.
4. Giao diện 390px hiển thị thông báo chờ đúng.
5. Giao diện 1440px hiển thị thông báo chờ đúng; không lỗi JS hoặc tràn ngang.
6. Phiên đã đăng nhập vẫn gọi `/api/auth/me` được khi login bị giới hạn.
7. Ngân sách tổng theo IP chặn việc đổi username để thử tiếp.
8. Chờ hết cửa sổ **5 phút theo thời gian thật**, rồi đăng nhập lại mật khẩu + TOTP thành công. Không chỉnh đồng hồ hoặc sửa bộ đếm trong thử nghiệm.

Thử nghiệm từ `2026-10-09T01:38:28.617Z` tới `01:43:43.721Z` (08:38–08:43 giờ Việt Nam). Observer giả id 5 đã khoá qua API sau khi xong. Không tạo/sửa booking hoặc giao dịch tài chính. Credential và TOTP secret chỉ dùng trong bộ nhớ, không đưa vào báo cáo.

## Xác nhận bổ sung SEC-2

Wrangler đã khôi phục quyền truy cập. Truy vấn D1 production chỉ đọc xác nhận admin id 3 bật 2FA, không khoá; có audit `2fa_enable` lúc `2026-10-08T16:09:26.926Z`. Không đọc secret/token; không ghi dữ liệu production.

## Cổng production

Production chưa có bảng SEC-3 tại lần kiểm tra chỉ đọc trước phát hành. Cần chủ sở hữu duyệt thay đổi luồng đăng nhập đang dùng. Khi được duyệt: áp dụng **migration 0044 production trước code**, xác nhận schema, kiểm lại head/check CI, merge PR #12 để workflow deploy, rồi đối chiếu artifact và kiểm tra health. Không thử vượt ngưỡng trên tài khoản admin thật.

Giới hạn: bảo vệ theo mạng/tài khoản, không chống hoàn toàn botnet nhiều mạng; nhiều người dùng chung IP chịu chung ngưỡng 30/5 phút. Nếu D1 lỗi/thiếu migration, login mới trả 503; phiên hiện có không bị giới hạn này thu hồi. Rollback code cũ giữ bảng mới nhưng bỏ bảo vệ SEC-3, cần ghi nhận rõ.

Bằng chứng: `test-results/sec3/staging-check.json`, `staging-migration.log`, `staging-deploy.log`, `staging-artifact.json`, `staging-r1.log`, `ci-final.json`; SEC-2: `test-results/sec2/production-2fa-verified.json`.
