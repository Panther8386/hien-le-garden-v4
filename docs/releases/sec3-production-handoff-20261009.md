# SEC-3 — phát hành production, 09/10/2026

**Hoàn tất.** Chủ sở hữu đã duyệt áp dụng migration rồi merge PR #12 để deploy production.

| Hạng mục | Kết quả |
|---|---|
| PR | #12 đã merge |
| Source đã kiểm thử | `19561f0c9f5e1e46992790a30818ebcf7533f196` |
| Production main | `49ef1daeb50df1e6eb05ab73891422892dd00527`; Git tree giống source đã kiểm thử |
| Deployment | `https://05eceea6.hien-le-garden-v4.pages.dev` và `https://hienlegarden.vn` |
| Migration | `0044_login_rate_limits.sql` áp dụng production **trước merge/deploy**, bảng và index được xác minh |
| CI | `37870222942`: R-1 và Tests PASS; Linux 1.654 test đạt |
| Deploy | workflow `37871442452`, job `113630226206`: SUCCESS |
| Staging | `716e1945`, 8/8 kiểm tra thực tế PASS, gồm hết 5 phút thật rồi đăng nhập lại với TOTP; observer giả id 5 đã khoá |
| Artifact production | 61/61 file admin khớp byte với Git blob `49ef1da` trên mỗi host, tổng 122/122 |
| R-1 production | PASS=62, FAIL=0, INCONCLUSIVE=0; kiểm tra thêm migration/helper/function SEC-3 đều không phục vụ source |
| Health | `/`, `/admin/login`, `/api/public-config`: 200; `/api/auth/me` không đăng nhập: 401 |
| PC/mobile | Trang đăng nhập 390px và 1440px không lỗi JS hoặc tràn ngang |

Giới hạn đã có hiệu lực: 5 lượt/tài khoản/mạng và 30 lượt/mạng mỗi 5 phút; IPv6 theo /64. Vượt ngưỡng trả 429 và thời gian chờ. Tính cả lượt đăng nhập đúng/cấp challenge, không reset sau thành công. Không đổi trạng thái khoá tài khoản. D1 lỗi trả 503, không âm thầm bỏ bảo vệ. Không chống hoàn toàn botnet nhiều mạng; người dùng cùng IP chia sẻ ngân sách tổng.

Production chỉ được áp dụng migration và phát hành code; không tạo tài khoản giả, không thử mật khẩu sai hoặc vượt giới hạn trên admin thật, không thao tác booking/thu chi. Hành vi hết hạn/429/TOTP được kiểm trên staging cùng tree mã. SEC-2 đã được D1 kiểm chứng độc lập: admin id 3 bật 2FA, không khoá, audit tương ứng.

Rollback khả dụng trước đợt này: `bb55372c` / `5a359f4`; không xoá deployment cũ trong lần phát hành. Nếu rollback code, giữ bảng migration 0044 vì tương thích code cũ; phải ghi rõ SEC-3 sẽ mất hiệu lực khi quay về code cũ. Không rollback toàn bộ D1 vì bảng mới không đòi thay đổi dữ liệu nghiệp vụ.

Bằng chứng tại `test-results/sec3/`: `production-migration.log`, `production-schema.json`, `production-verification.json`, `production-r1.log`, `ci-final.json`, `staging-check.json`. Thông tin merge/deploy từ GitHub lưu riêng cùng gói chứng cứ production. Báo cáo này chỉ chứa dữ liệu không nhạy cảm.

Tiếp theo: F4 tab ở 390px, F3 chuẩn hoá CRLF/LF, rồi dọn staging và lưu hồ sơ phát hành. Test 2FA chập chờn đã được sửa trong PR #12.
