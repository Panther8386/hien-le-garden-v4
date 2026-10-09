# SEC-1 — diễn tập khôi phục local, 08/10/2026

**Kết quả: PASS trên D1 local cô lập.** Không thao tác staging hoặc production; chưa bật 2FA cho admin thật.

Source diễn tập: `e3d542b84e3fdc613388883556759a8aff6d06a9`, có tree giống production `5a359f483d4ae72e3b58d43cf6218a7f6ee64859`. Môi trường WSL Ubuntu / Node 22.20.0 / Workers Vitest 2.1.9 / Miniflare D1, áp dụng migration của source. Dùng tài khoản giả riêng và dữ liệu đặt phòng, thu chi giả.

| Kịch bản | Kết quả |
|---|---|
| A: admin duy nhất bị khoá | Login/session bị từ chối trước khôi phục; mở khoá đúng một tài khoản; login và `/api/auth/me` đạt. Bảo vệ admin cuối cùng và tự khoá vẫn hoạt động; admin test vẫn khoá. |
| B: mất mật khẩu | Hash từ hàm ứng dụng; khôi phục và đổi mật khẩu tạm qua endpoint ứng dụng thành công. Mật khẩu, phiên và token 2FA cũ bị từ chối. |
| C: mất thiết bị TOTP | Thu hồi cấu hình, phiên và token chờ của tài khoản giả; đăng ký secret mới qua setup/confirm; đăng nhập với TOTP mới thành công. |
| D: lỗi giữa nhóm thao tác | D1 batch hoàn tác các thay đổi trước câu lệnh lỗi; phiên và token ban đầu còn nguyên. Batch thành công kiểm đúng thứ tự và số dòng ảnh hưởng. |
| Dữ liệu nghiệp vụ và quyền | Nội dung mọi bảng ngoài xác thực/audit được so sánh trước/sau và không đổi, gồm dữ liệu đặt phòng/thu chi giả, quyền và override. Không tạo audit giả cho thao tác trực tiếp. |

Kiểm tra: **4/4** kịch bản khôi phục + **119/119** kiểm tra liên quan (quản trị tài khoản, quyền admin, 2FA) = **123/123 PASS**. Log đã che thông tin nhạy cảm: `test-results/sec1/drill.log`; thông tin môi trường: `test-results/sec1/environment.txt`. Mật khẩu/hash/token/secret được tạo và xử lý trong bộ nhớ, không ghi vào log hay báo cáo.

Chi tiết thao tác và biên bản riêng tư được giữ ngoài repository. Đây là diễn tập endpoint ứng dụng và D1 local; **chưa kiểm qua UI trình duyệt, quyền đăng nhập Cloudflare hay Time Travel trên D1 remote**. Không suy diễn kết quả local thành xác nhận khả năng thao tác bảng điều khiển production.

Bước tiếp theo SEC-2: chủ sở hữu chuẩn bị ứng dụng Authenticator và xác nhận có quyền Cloudflare độc lập cùng hồ sơ khôi phục riêng tư, rồi đăng ký 2FA cho admin đang dùng. Không tự bật 2FA trong SEC-1.
