# Sửa hoàn cọc khi từ chối yêu cầu — 07/10/2026

## Đã triển khai production theo phê duyệt của chủ dự án

- Chủ dự án đã duyệt triển khai cùng giao diện Admin mới trong PR #8.
- PR #8 đã merge, commit `babe39da560346b3228a66f3b3348310ce9bc5d1`, chứa bản sửa đã kiểm thử `c988c816214060c9f52f3651816c0e28f8de4eb7`. Diff giữa hai tree rỗng.
- [Workflow production 37618872550](https://github.com/Panther8386/hien-le-garden-v4/actions/runs/37618872550) completed / success.
- Cloudflare Production / main: `9bcd7349-32d5-4e27-8662-97c901649fc2`, https://9bcd7349.hien-le-garden-v4.pages.dev ; domain https://hienlegarden.vn .
- Sau deploy: **61/61 tệp Admin trên domain production khớp byte với Git blob của commit merge**. CI Linux xuất LF nên so với Git blob, không với artifact CRLF cục bộ.
- `/`, `/admin/login`, `/api/public-config` trả 200; `/api/auth/me` không đăng nhập trả 401. Giao diện đăng nhập mobile 390 và desktop 1440 không tràn ngang hoặc lỗi JavaScript.
- Chính sách production giữ nguyên ≥7 ngày/100%, ≥3 ngày/50%. Không thêm/sửa chính sách production, không có migration mới.
- Probe trên domain production và deployment mới: **62 PASS / 0 FAIL / 0 INCONCLUSIVE**. Không kiểm deployment D4B cũ.
- Không tự đăng nhập hoặc thực hiện hoàn tiền thử trên production. Nghiệp vụ hoàn cọc đã kiểm thật trên staging #17 trước deploy. **Không sửa booking #33 hay khoản thu 50.000**; chủ dự án tự xử lý.
- Bằng chứng mới: `production-release-status.json`, `production-merge.json`, `production-deploy-jobs.json`, `production-deploy-112783799731.log`, `production-verification.json`, `production-verification.log`, `production-private-probe.log`, ảnh production login tại `test-results/refund-fix/`.

Phần bên dưới ghi lại bàn giao staging trước phê duyệt production; những dòng “chưa merge / chưa deploy production” là lịch sử đã được cập nhật bởi mục này.

---

## Phiên bản

- Commit: `c988c816214060c9f52f3651816c0e28f8de4eb7`, nhánh `admin-redesign`, đã push.
- [PR #8](https://github.com/Panther8386/hien-le-garden-v4/pull/8) vẫn draft, chưa merge; PR bao gồm cả giao diện Admin Spec 2 trước đó.
- Staging cố định: https://3caebc90.hien-le-garden-v4.pages.dev ; đăng nhập: https://staging.hien-le-garden-v4.pages.dev/admin .
- Production chưa được deploy. Không sửa booking #33 hoặc giao dịch thu 50.000 đồng; chủ dự án tự xử lý khoản thu đó.

## Nguyên nhân và thay đổi

Booking production #33 đã nhận cọc 50.000 nhưng còn `pending`. Thao tác `reject` chuyển sang `cancelled` mà không áp dụng chính sách, không ghi tỷ lệ hoàn hoặc khoản chi. Chính sách production đã có ≥7 ngày hoàn 100%, ≥3 ngày hoàn 50%.

Hai endpoint `reject` và `cancel` nay dùng chung cơ chế hoàn cọc. Server tính mức hoàn; khi có tiền hoàn phải chọn tiền mặt/chuyển khoản. Khoản chi, trạng thái và nhật ký được ghi trong một D1 batch có điều kiện trạng thái/số cọc; lỗi ghi dữ liệu rollback toàn bộ, thao tác thua cuộc không sinh khoản hoàn. Không có migration mới.

Giao diện Từ chối mở hộp thoại hiển thị mức hoàn và phương thức; tải lại chính sách khi mở, không biến lỗi tải chính sách thành hoàn 0%. Có chặn gửi trùng, thông báo kết quả và mức hoàn trong lịch sử. Khoản thu ban đầu được giữ, khoản hoàn là một khoản chi riêng.

## Kiểm chứng

- Linux: 81 file / **1.555 tests** isolated + R2 **12 + 14 + 27**, tổng **84 file / 1.608 tests đạt**. 74 focused tests đạt, gồm 10 regression mới: mốc 8/7/6/3/2 ngày, thiếu phương thức, không cọc, hai yêu cầu đồng thời, số cọc thay đổi và lỗi ghi audit rollback.
- Artifact: build, check:dist (135 file, 15 tài nguyên bắt buộc), kiểm giao diện 4 vai trò × 3 kích thước và shell/in đạt.
- [GitHub CI run 37617871539](https://github.com/Panther8386/hien-le-garden-v4/actions/runs/37617871539), attempt 1: **success**, head đúng commit; job `test` và `Release artifact boundary (R-1)` đạt. Bước R2 isolated tùy chọn vẫn cần đọc log riêng; gate R2 dùng cấu hình non-isolated hiện có.
- Staging #17: yêu cầu pending 15–16/10/2026, thu cọc 50.000 qua UI, từ chối hiển thị hoàn 100%, thiếu phương thức bị chặn, chọn chuyển khoản hoàn thành công. Thu #37: 50.000; chi `hoan_coc` #38: 50.000. Hủy lại trả 400, không tạo thêm giao dịch; lịch sử hiển thị hoàn 100%; không lỗi JavaScript. Không giả lập đồng hồ.
- Staging đã được cấu hình thật hai bậc 7 ngày/100%, 3 ngày/50% theo chính sách chủ dự án xác nhận trên production. Đây là cấu hình giữ lại cho nghiệm thu, không phải bậc tạm 20.000 ngày của lượt thử cũ.
- Lượt UI đầu bấm Từ chối trước khi render lại số cọc nên preview còn 0; script được sửa để chờ `Cọc: 50.000` rồi chạy lại trên cùng booking, không thu cọc thêm. Kết quả ban đầu lưu `live-refund-initial-refresh.json`.

Bằng chứng: `test-results/refund-fix/`, ảnh `refund-dialog.png`, `refund-history.png`, log Linux, CI, kết quả JSON và manifest artifact. Kết quả staging áp dụng cho bản sửa này, không thay thế nghiệm thu production. Muốn đưa lên production cần quyết định riêng: merge PR #8 (kèm Spec 2), hoặc tách hotfix trên main rồi kiểm thử lại bản tách. Không thao tác D4B.
