# SEC-3 — giới hạn đăng nhập

## Hành vi

`POST /api/auth/login` trước đây có thể thử mật khẩu liên tục. Bản sửa đặt ngân sách **5 lượt / tài khoản / mạng trong 5 phút**, cộng **30 lượt / mạng trong 5 phút** để hạn chế đổi username. IPv4 dùng địa chỉ đơn; IPv6 nhóm theo /64, chuẩn hoá địa chỉ và IPv4-mapped IPv6. Chỉ dùng `CF-Connecting-IP`; không tin `X-Forwarded-For`/`X-Real-IP`. Thiếu hoặc sai metadata dùng ngân sách chung hạn chế, không bỏ qua.

Mọi lượt có body hợp lệ đều tính, kể cả đăng nhập đúng và cấp challenge 2FA. Thành công không xoá bộ đếm, tránh cấp lại challenge vô hạn. Giới hạn 5 mã sai/challenge hiện có của verify-2fa được giữ nguyên. Vượt ngưỡng trả 429, thông báo chờ bằng tiếng Việt và `Retry-After`; không cấp session/token. Cửa sổ bắt đầu ở lượt đầu, không kéo dài vì tiếp tục bấm. Không đổi `locked_at`, không khoá tài khoản trên mọi IP; mạng khác có ngân sách riêng. Đây chưa phải giải pháp chống botnet phân tán nhiều mạng.

Bộ đếm dùng D1 chung, đặt chỗ nguyên tử trước truy vấn tài khoản/PBKDF2. IP đã hết ngân sách không tạo thêm bucket username khi attacker đổi tên liên tục. Keys là SHA-256, không ghi IP/username thô, mật khẩu hoặc token; digest không được xem là ẩn danh tuyệt đối. Dọn tối đa 100 dòng hết hạn mỗi request qua expiry index; dòng hết hạn có thể tồn tại cho tới lượt đăng nhập tiếp theo. Không ghi mỗi lượt thử vào audit. Khi D1 lỗi hoặc thiếu migration, trả 503/Retry-After 60 giây, không âm thầm bỏ bảo vệ; các phiên đã đăng nhập không bị bộ giới hạn này thu hồi.

## Kiểm tra local

- 15 test hành vi mới: ngưỡng, đồng thời, username rotation và tăng trưởng storage, IP riêng, tài khoản khác, tài khoản không tồn tại, cấp challenge 2FA, reset đúng hạn, header giả, thiếu metadata, IPv6 /64, IPv4-mapped, lỗi DB và body lỗi, dọn dữ liệu.
- Linux Node 22.20.0: 82 file / 1.601 test isolated + R2 12 + 14 + 27 = **1.654 PASS**.
- Giao diện trình duyệt 390px và 1440px: **6/6 PASS**, phản hồi API giả lập 429/503/2FA; không lỗi JS hoặc tràn ngang. Đây không phải test staging thật.
- Lượt đầu phát hiện `node:net.isIP` không có trên Workers runtime đang dùng; đã thay bằng kiểm tra IPv4 và URL parser IPv6, chạy lại đạt. Log lần đầu được giữ riêng.

## Cổng phát hành

**Chưa phát hành.** Cần CI trên PR, migration `0044_login_rate_limits.sql` lên staging **trước** code mới, rồi kiểm thử login/429/chờ hết hạn/2FA trên staging bằng tài khoản giả. Công cụ Cloudflare đang có lỗi quyền D1 7403; chủ sở hữu đang đăng nhập lại Wrangler. Không tạo dữ liệu hoặc gây rate limit lên tài khoản production.

Sau staging đạt mới xem xét phát hành production. Production cũng phải áp dụng migration trước code; workflow deploy hiện tại không tự áp dụng migration. Migration chỉ thêm bảng/index, tương thích code cũ; rollback code cũ giữ bảng nhưng bỏ giới hạn ứng dụng, phải ghi rõ trạng thái bảo vệ. Không xoá bảng trong rollback thông thường.

Tham chiếu chính thức: [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/), [CF-Connecting-IP và giới hạn với Worker subrequests](https://developers.cloudflare.com/fundamentals/reference/http-headers/). Trust boundary là Cloudflare ingress và các Worker cùng zone do chủ hệ thống kiểm soát.

## CI và test hết hạn — cập nhật 09/10/2026

Draft PR #12, nguồn ban đầu `6ef3cbb`: R-1 PASS; Tests trượt đúng test cũ `auth.test.js` “returns null once the token has expired” (1.600/1.601 isolated đạt). Đã sửa fixture test dùng thời điểm hết hạn quá khứ rõ ràng thay vì TTL 10ms/chờ 30ms. Không sửa logic token hoặc thời hạn vận hành. Kiểm tra local liên quan sau sửa: 5 file / **66/66 PASS**. Cần CI lại trên head mới; staging vẫn chờ quyền Wrangler.
