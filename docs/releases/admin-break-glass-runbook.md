# Khôi phục khẩn cấp quyền quản trị (break-glass) — bản công khai

> Tài liệu này mô tả **nguyên tắc và cổng an toàn**. Lệnh, câu SQL và quy trình chi tiết để thực hiện khôi phục **không** nằm trong repo công khai: chúng được giữ trong **runbook vận hành riêng tư** (private operator runbook), ngoài repository.
>
> Detailed executable recovery procedures are maintained separately in the private operator runbook.

Trạng thái: bản thiết kế đã review (SEC-1, 2026-10-06). **Chưa diễn tập** — quy trình chưa được chứng minh vận hành cho tới khi buổi diễn tập ngoài production (mục 12) đạt.

## 1. Mục đích

Khôi phục quyền quản trị CRM khi **không còn tài khoản admin nào đăng nhập được qua ứng dụng** và không thể khôi phục bằng giao diện quản trị thông thường.

## 2. Phạm vi

- Chỉ bao gồm trạng thái xác thực của tài khoản nhân viên: trạng thái khoá, mật khẩu, 2FA (TOTP), phiên đăng nhập và token 2FA đang chờ.
- **Không** bao gồm: dữ liệu nghiệp vụ (đặt phòng, tài chính, góp ý, …), quyền theo vai trò, quyền riêng (override), R2, WAF, cấu hình Cloudflare, deploy, migration.

## 3. Khi nào được dùng break-glass

Chỉ khi **tất cả** điều kiện sau đúng:

1. Không còn admin nào đăng nhập được (đã thử đăng nhập và ghi lại lỗi).
2. Không thể khôi phục qua UI: không còn admin khác dùng được, không còn phiên admin hợp lệ.
3. Chủ sở hữu hệ thống đồng ý rõ ràng (bằng văn bản).

Không dùng break-glass cho tiện, để vượt quy trình duyệt, hoặc cho việc làm được qua UI.

## 4. Kiến trúc xác thực (tóm tắt)

- Đăng nhập bằng tên đăng nhập + mật khẩu; nếu tài khoản bật 2FA thì thêm bước mã TOTP.
- Mật khẩu lưu dưới dạng hash có salt, tạo bởi hàm băm của chính ứng dụng (`lib/auth.js`). Mọi hash dùng khi khôi phục **phải** được tạo bằng đúng hàm này — không tự viết lại thuật toán, không dùng script seed cũ.
- Phiên đăng nhập có hạn; mỗi request kiểm tra phiên còn hạn **và** tài khoản không bị khoá. Quyền được tính lại ở mỗi request.
- Ứng dụng có các lớp bảo vệ: không tự khoá chính mình, chỉ admin thao tác trên admin, không khoá/xoá/hạ vai trò admin cuối cùng còn hoạt động.
- Ứng dụng **không** có chức năng "quên mật khẩu" hay khôi phục qua email. Khi không còn admin dùng được, cách khôi phục duy nhất là thao tác trực tiếp trên cơ sở dữ liệu D1 production bởi chủ tài khoản Cloudflare.

## 5. Điều kiện trước

- Người thực hiện có quyền vào tài khoản Cloudflare quản lý hệ thống (tài khoản Cloudflare nên bật 2FA).
- Máy tin cậy, có bản checkout đúng commit đang chạy production.
- Có sẵn runbook vận hành riêng tư và mẫu biên bản sự cố.

## 6. Cổng an toàn bắt buộc (theo đúng thứ tự)

Không có bất kỳ thao tác ghi nào trước khi qua đủ 8 bước:

1. Xác nhận sự cố thật sự chặn quyền quản trị.
2. Xác nhận đúng tài khoản Cloudflare và đúng project.
3. Xác nhận đúng cơ sở dữ liệu **production** (so khớp tên và id với cấu hình đã theo dõi trong repo) — không nhầm với staging.
4. Ghi lại một **mốc phục hồi D1 (Time Travel)** ngay trước khi thao tác; lưu mốc ở biên bản riêng tư, không lưu trong repo.
5. Chẩn đoán **chỉ bằng truy vấn đọc** (SELECT).
6. Xác định đúng **một** tài khoản mục tiêu là admin vận hành thật, không in tên đăng nhập, hash hay token.
7. Chốt thay đổi **tối thiểu** cần làm (một kịch bản ở mục 7).
8. Chủ sở hữu duyệt rõ ràng; ghi vào biên bản.

## 7. Kịch bản

Nguyên tắc chung: **thay đổi tối thiểu** — chỉ sửa đúng các trường cần cho kịch bản; không đổi vai trò, quyền, override hay dữ liệu nghiệp vụ.

### A. Admin duy nhất bị khoá

- Triệu chứng: đăng nhập báo tài khoản đang bị khoá; không còn admin nào khác chưa khoá.
- Khôi phục: chỉ gỡ trạng thái khoá của đúng tài khoản đó — tương đương thao tác "Mở khoá" của ứng dụng.
- Nếu nghi tài khoản bị chiếm: làm thêm kịch bản B.

### B. Admin duy nhất mất mật khẩu

- Tạo mật khẩu tạm mạnh, ngẫu nhiên, **trên máy tin cậy**; tạo hash bằng hàm băm của ứng dụng; kiểm tra hash khớp trước khi dùng.
- Chỉ thay trường mật khẩu của đúng tài khoản đó.
- **Bắt buộc** thu hồi mọi phiên đăng nhập cũ và token 2FA đang chờ của tài khoản đó — giống chức năng đặt lại mật khẩu của ứng dụng (mật khẩu cũ không còn được tin cậy; nếu bị chiếm, phiên cũ của kẻ tấn công phải mất hiệu lực).
- Mật khẩu tạm và hash không bao giờ được đưa lên dòng lệnh, chat, ticket hay repo; xoá mọi file tạm ngay sau khi dùng.
- Đăng nhập, rồi **đổi mật khẩu ngay** qua giao diện.

### C. Mất thiết bị TOTP (chỉ áp dụng sau khi bật 2FA cho admin vận hành)

- Chỉ gỡ cấu hình 2FA của đúng tài khoản đó — tương đương chức năng tắt 2FA của ứng dụng — và thu hồi token 2FA đang chờ; nếu nghi thiết bị bị đánh cắp, thu hồi cả phiên đăng nhập.
- Đăng nhập bằng mật khẩu và **đăng ký lại 2FA ngay**.

## 8. Tài khoản admin test đã khoá

Tài khoản admin dùng cho kiểm thử là **tài khoản test đã khoá, không phải admin dự phòng**. Mở lại nó chỉ là **phương án cuối cùng** (ví dụ khi cần thao tác khôi phục trên admin vận hành đi qua ứng dụng để có audit). Không nên dùng vì phải kích hoạt lại một tài khoản test và làm tăng bề mặt tấn công; nếu buộc phải dùng, khoá lại ngay sau khi khôi phục và ghi vào biên bản. Luôn ưu tiên khôi phục trực tiếp admin vận hành.

## 9. Kiểm tra sau khôi phục (bắt buộc)

- [ ] Admin vận hành đăng nhập được; `/api/auth/me` trả 200, vai trò admin, đủ quyền.
- [ ] Tài khoản không bị khoá; trạng thái 2FA đúng dự kiến.
- [ ] Phiên đăng nhập: chỉ còn phiên mới; phiên cũ đã bị thu hồi khi kịch bản yêu cầu.
- [ ] Quyền theo vai trò khớp mặc định trong source (không lệch); override không đổi trừ khi chủ ý.
- [ ] Số admin chưa khoá đúng dự kiến; tài khoản test vẫn khoá.
- [ ] Số liệu các bảng nghiệp vụ không bị thao tác khôi phục làm thay đổi.
- [ ] Health production: trang chủ, trang đăng nhập admin, cấu hình công khai bình thường; `/api/auth/me` khi chưa đăng nhập trả 401.

Việc bảo mật tiếp theo: thay mật khẩu tạm, bật lại/đăng ký lại 2FA nếu đã gỡ, xem lại phiên đăng nhập và nhật ký, xem lại quyền truy cập Cloudflare, ghi biên bản.

## 10. Giới hạn audit và biên bản sự cố

> ⚠ **Thao tác trực tiếp trên D1 bỏ qua hoàn toàn nhật ký audit (`audit_log`) của ứng dụng.** Audit chỉ được ghi bởi các API của ứng dụng.

Vì vậy:

- **Mọi** lần break-glass bắt buộc có **biên bản sự cố riêng tư** (không lưu trong repo công khai), tối thiểu: thời gian UTC, người thực hiện, người duyệt, triệu chứng, kịch bản, mốc phục hồi, thay đổi đã làm (đã che giá trị nhạy cảm) và số dòng bị ảnh hưởng, kết quả kiểm tra mục 9, nguyên nhân gốc, việc tiếp theo.
- **Không** tự tạo dòng `audit_log` bằng tay: ứng dụng không có cơ chế audit cho break-glass, và dòng audit bịa ra làm sai lệch nhật ký.
- Break-glass không bao giờ được thực hiện âm thầm.

## 11. Rollback

1. Ưu tiên đảo ngược đúng trường vừa sửa khi an toàn (ví dụ khoá lại qua UI nếu đã mở nhầm). Không khôi phục hash mật khẩu cũ.
2. Khôi phục toàn bộ D1 bằng Time Travel là **phương án cuối cùng**: nó ghi đè cả cơ sở dữ liệu về thời điểm mốc và **làm mất mọi thao tác ghi hợp lệ sau mốc** (đặt phòng, order, voucher, …). Cần chủ sở hữu duyệt riêng.

## 12. Diễn tập (chỉ ngoài production)

**Không bao giờ diễn tập break-glass trên production.** Diễn tập trên D1 local hoặc staging cô lập, với tài khoản riêng cho diễn tập, phải chứng minh:

- [ ] Gỡ khoá tài khoản admin hoạt động; lớp bảo vệ admin cuối cùng vẫn đúng.
- [ ] Khôi phục mật khẩu bằng hash tạo từ hàm băm của ứng dụng đăng nhập được.
- [ ] Phiên cũ bị thu hồi (token cũ bị từ chối).
- [ ] Token 2FA đang chờ bị thu hồi đúng.
- [ ] Khôi phục TOTP (sau khi có 2FA) và đăng ký lại hoạt động.
- [ ] Hành vi khi chạy nhiều câu lệnh trong một lần thực thi (thứ tự, tính nguyên tử, số dòng ảnh hưởng) đúng như runbook riêng tư mô tả.
- [ ] Không có thay đổi dữ liệu nghiệp vụ.

## 13. Cấm

- Đổi vai trò hoặc quyền; tạo admin mới hay xoá tài khoản bằng thao tác trực tiếp trên cơ sở dữ liệu.
- Sửa dữ liệu nghiệp vụ.
- Thao tác nhầm môi trường (staging ↔ production).
- Đưa mật khẩu, hash, token, mốc phục hồi vào dòng lệnh, chat, ticket hoặc repo.
- Dùng script seed cũ để tạo hash.
- Tắt tạm các lớp bảo vệ trong code để "mở đường".
- Diễn tập trên production.

## 14. Lịch sử sửa đổi / diễn tập

| Ngày | Phiên bản | Loại (soạn / sửa / diễn tập) | Môi trường | Người thực hiện | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| 2026-10-06 | 1.0 | soạn | — | — | Đã review thiết kế (SEC-1); chưa diễn tập | Chi tiết thực thi ở runbook riêng tư |
