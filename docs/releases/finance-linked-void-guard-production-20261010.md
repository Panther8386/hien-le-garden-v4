# Bảo vệ chứng từ liên kết — production 10/10/2026

Đã phát hành theo phê duyệt chủ sở hữu: migration 0045 → merge PR #18 → workflow deploy production.

| Hạng mục | Kết quả |
|---|---|
| PR | #18 merged; source ce689fa2b192bdbd1129f5cceb177d02f24c3f39 |
| Main / release | a8392f3c7ac954c2a49e40ac3fb6fa45de97524a |
| Deployment | 6e4074b5-cc06-40c4-acd1-22cb4a596def, production, success |
| URL | https://6e4074b5.hien-le-garden-v4.pages.dev / https://hienlegarden.vn |
| Workflow | 38025666944, completed / success |
| CI trước merge | 5/5 success: test, R-1, Windows/Linux artifact, F3 equality |
| Migration | Chỉ 0045_checkout_receipt_booking.sql được áp dụng trên production; cột nullable và index đã kiểm lại bằng SELECT |
| File Admin | 61/61 khớp Git trên mỗi host, tổng 122/122 |
| Probe R-1 | PASS=62, FAIL=0, INCONCLUSIVE=0 |
| Health | /, /admin/login, /api/public-config: 200; /api/auth/me: 401 |
| UI | Login và booking modal 390px/1440px, Turnstile khởi tạo, không lỗi JS hoặc tràn ngang; không gửi booking |

Thời điểm xác minh deployment: 10/10/2026 11:54 giờ Việt Nam. D1 schema verification rows_written=0, changed_db=false. Không tạo booking, thu/chi hay tài khoản thử trên production. Cột checkout_booking_id đang có 0 giá trị được điền tại thời điểm kiểm: đúng với migration không backfill; hành vi ghi liên kết đã được kiểm bằng checkout local và nghiệm thu staging.

Hành vi/phạm vi và bằng chứng staging: finance-linked-void-guard-staging-20261010.md. Chặn huỷ riêng chứng từ liên kết; ngoại lệ cọc booking đã huỷ/chưa hoàn cần xác nhận cảnh báo rồi xoá cọc tại lịch sử. Chứng từ cũ thiếu liên kết/audit đủ tin cậy cần rà thủ công; không tự ghép khoản thu nhập tay.

Rollback ứng dụng: release cbc81c8d06057c3f27034ee32df384fda92e69a2 / deployment d4f0c06b. Giữ migration 0045 khi rollback vì chỉ thêm cột nullable/index, bản cũ không phụ thuộc cột mới. Không xoá cột hoặc phục hồi toàn bộ D1 để rollback ứng dụng.

Bằng chứng: test-results/finance-void-guard/release-inspect.json, merge.json, release-status.json, cloudflare-state.json, production-verification.json, production-r1.log và staging-result.json. Hồ sơ lưu local; chưa commit các báo cáo/roadmap riêng vào Git.
