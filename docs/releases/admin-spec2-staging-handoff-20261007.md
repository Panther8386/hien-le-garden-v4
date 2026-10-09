# Bàn giao Admin Spec 2 — staging ngày 07/10/2026

> **Mở lại mục nghiệm thu hoàn cọc:** chủ dự án báo chính sách không chạy đúng. Kiểm tra trực tiếp `GET https://staging.hien-le-garden-v4.pages.dev/api/cancellation-policy?public=1` trả `[]`: staging chưa có bậc chính sách chính thức. Code mặc định hoàn 0% khi không có bậc phù hợp. Kết quả thử bậc tạm bên dưới chỉ chứng minh cơ chế tính/ghi hoàn tiền; không chứng minh cấu hình chính sách nghiệp vụ đã sẵn sàng. Chờ chủ dự án xác nhận môi trường/booking bị lỗi và các bậc chính thức; chưa thay đổi chính sách hoặc production.

## Kết quả bổ sung CI và nghiệp vụ — c3b4a67

Hai hạng mục kiểm chứng bổ sung đã hoàn tất trên cùng commit `c3b4a67346222150f99ac9a8f2442367bd9d1730`. Không có sửa đổi tracked trong lượt này; deployment vẫn là `72f13aab`. Kết quả này thay thế các dòng “chưa có CI / chưa chạy nghiệp vụ” ở các phụ lục lịch sử bên dưới. Chủ dự án vẫn là người nghiệm thu cuối cùng.

### GitHub CI

- Draft PR [#8 — admin-redesign → main](https://github.com/Panther8386/hien-le-garden-v4/pull/8), xác minh **chưa merge**.
- [Tests run 37606475483](https://github.com/Panther8386/hien-le-garden-v4/actions/runs/37606475483): **completed / success, attempt 2**, head SHA đúng c3b4a67.
- Job `test` và `Release artifact boundary (R-1)` đều đạt; isolated 1.545 và ba R2 non-isolated 12 + 14 + 27 là các gate bắt buộc.
- Lần 1 thất bại một test `test/auth.test.js:95` (token TTL 10 ms, chờ 30 ms nhưng còn trả staffId). Lượt chạy lại cùng mã nguồn đạt; đây là dấu hiệu kiểm thử phụ thuộc thời gian chưa ổn định, chưa có sửa chữa nguyên nhân trong bản này. Log lần 1 được giữ nguyên.
- Bước R2 isolated tùy chọn vẫn có lỗi storage ở log lượt 2 và được workflow `continue-on-error` cho phép. Không tính bước này là PASS thực chất, không cộng vào 1.598 gate đã đạt.
- GitHub connector thiếu quyền ghi (403); PR và retry được thực hiện qua xác thực Git sẵn có. Không cần cấp thêm quyền hoặc đăng nhập trình duyệt.

### Nghiệp vụ staging

Lượt API đạt với booking giả **#10, #11, #12**; không dùng khách thật hay thanh toán qua ngân hàng:

| Kịch bản | Kết quả |
|---|---|
| Cọc → nhận phòng → dịch vụ đã/chưa thanh toán → trả phòng thu thêm | #10 đạt; tiền phòng 300.000, cọc 100.000, thu phòng còn 200.000 và dịch vụ 50.000 |
| Cọc dư → nhận phòng → dịch vụ → trả phòng hoàn dư | #11 đạt; tiền phòng 300.000, cọc 400.000, dịch vụ chưa trả 50.000, hoàn 50.000 |
| Hủy booking có cọc và hoàn cọc | #12 đạt; cọc 200.000, hoàn 200.000; hủy lần hai bị từ chối |
| Không cho trả phòng trùng | Hai booking đã trả phòng từ chối lần trả tiếp theo |
| Đối chiếu tài chính | 9 giao dịch confirmed; thu 970.000, chi 250.000, ròng 720.000 = hai tiền phòng 600.000 + dịch vụ 120.000 |
| Khách hàng và override | Observer mặc định 403; grant `customers.view` có hiệu lực trên phiên đang đăng nhập, tìm tên giả trả 0 bản ghi; deny trả 403; khôi phục overrides gốc và đối chiếu khớp |

Chính sách staging ban đầu không hoàn cọc cho ngày thử. Đã thêm tạm một bậc chỉ áp dụng khi còn ít nhất **20.000 ngày** trước check-in (cho booking 2099), hoàn 100%; sau lượt thử xóa bậc này và đối chiếu toàn bộ chính sách khớp trước thử. Không sửa bậc chính sách có sẵn. Phòng thử ban đầu trống/sạch được trả về sạch; các booking và giao dịch giả được giữ làm dấu vết kiểm chứng.

Lượt giao diện thực **booking #16** đạt: tạo booking trong hộp thoại → lưu cọc 100.000 → Check-in → chuyển tab Đặt phòng → thêm dịch vụ 25.000 × 2 → mở hộp thoại Check-out → chọn chuyển khoản → xác nhận trả phòng. Kết quả thu phòng 500.000 và dịch vụ 50.000, booking `checked_out`, dịch vụ `paid`; hoàn tất `2026-10-07T11:11:25.402Z`. Riêng để hiện danh sách khách đi, đồng hồ **trình duyệt** được giả lập sang ngày trả; đồng hồ server và tất cả API staging giữ nguyên, không mock phản hồi nghiệp vụ. Không phải một đợt lưu trú qua đêm thực tế.

Phạm vi khách hàng lượt này là tìm kiếm danh sách và phân quyền/override; chưa kiểm chi tiết liên hệ của một khách giả có dữ liệu hoặc gửi tin nhắn. Không gửi email/Telegram. Các lần thử ban đầu và lỗi bộ chọn/điều hướng của script được lưu riêng; đã sửa kịch bản kiểm thử, không sửa mã ứng dụng hoặc nới assertion để có kết quả đạt. Booking thử các lượt trước cũng đã kết thúc/hủy qua API dọn dẹp.

### Bằng chứng mới

`business-staging-result.json`, `business-staging.log`, `business-ui-staging-result.json`, `business-ui-staging.log`, ảnh trong `business-screens/` và `business-ui-screens/`, `github-ci-result.json`, `github-pr.json`, log CI lần 1 và lượt cuối tại `test-results/admin-refresh/`. Gói cập nhật có hậu tố **`c3b4a67-acceptance`**, giữ nguyên ZIP bàn giao trước. Báo cáo này vẫn là file cục bộ chưa commit để không đổi SHA bản đã kiểm chứng; mã nguồn staging không thay đổi. Không merge PR, deploy production hoặc kiểm D4B.4.

---

## Phụ lục cập nhật — c3b4a67, 07/10/2026 16:47 (Việt Nam)

Phụ lục này thay thế thông tin phiên bản hiện hành bên dưới; phần báo cáo gốc được giữ làm lịch sử của `621234c`. Bốn file từng chưa commit đã nằm trong commit `c3b4a67346222150f99ac9a8f2442367bd9d1730`, hiện cũng là HEAD local. Theo review được chủ dự án gửi, commit này đã push lên `origin/admin-redesign`; lượt xác minh này không kiểm tra lại trạng thái remote.

- Phiên bản xác minh: `c3b4a67346222150f99ac9a8f2442367bd9d1730`.
- Staging cố định: https://72f13aab.hien-le-garden-v4.pages.dev ; alias UAT: https://staging.hien-le-garden-v4.pages.dev/admin .
- Manifest SHA256: `8826df588980882b38ed5d94f996601502ec4fcbead008899eff66cc2d989f34` (135 file; tracked source sạch tại thời điểm dựng).
- Linux chạy lại từ Git archive của c3b4a67: 80 file / 1.545 tests đạt, cộng R2 12 + 14 + 27 = **83 file / 1.598 tests đạt**.
- Build, check:dist, self-test dist, staging guard và probe self-test đạt.
- Giao diện artifact: 4 vai trò × 3 kích thước đạt; kiểm tra chặn gửi trùng, hash của tab bị giới hạn quyền, số đếm chờ, bàn phím, menu và tràn ngang từng tab đạt.
- Staging thật: 61/61 tệp Admin khớp SHA256 artifact; 4 vai trò đăng nhập, quyền mặc định, tab responsive, menu và kiểm soát API đạt. Booking giả số **3** được tạo bằng UI rồi hủy, không cọc/hoàn tiền. Hoàn tất lúc `2026-10-07T09:47:28.755Z`.
- Kiểm tra đường dẫn riêng tư trên alias và deployment mới: **62 PASS / 0 FAIL / 0 INCONCLUSIVE**.
- Bằng chứng mới ở `test-results/admin-refresh/`; bằng chứng gốc được giữ riêng tại `verified-621234c/` và ZIP gốc. Gói cập nhật mang hậu tố `c3b4a67`.

Giới hạn còn lại: **chưa chạy/xác minh GitHub Actions CI** cho c3b4a67; Linux cục bộ không thay thế bằng chứng CI. Chưa chạy đầy đủ luồng cọc → nhận phòng → dịch vụ → trả phòng, hoàn cọc và override. F3 (chuẩn hóa xuống dòng), F4 (gợi ý cuộn tab) và F5 không có sửa đổi trong lượt này. SHA256 xác nhận đúng artifact đã deploy, không tuyên bố build trên mọi hệ điều hành sẽ giống byte. Chưa nghiệm thu production; không thực hiện thao tác D4B.4 đang chờ.

---

Trạng thái: **sẵn sàng cho Claude review độc lập và chủ dự án UAT trên staging**. Chưa nghiệm thu production, chưa merge/push GitHub và chưa deploy production. Hướng giao diện đã được chủ dự án duyệt trong chat.

## Phiên bản cần review

| Mục | Giá trị |
|---|---|
| Release | `HLG-ADMIN-SPEC2-20261007` |
| Commit nguồn cuối, cục bộ | `621234caf84a14a75f131a9522175fb67c385632` |
| Nhánh cục bộ | `admin-redesign` |
| Commit nền | `73cdad80371949d94c13ececeab52bbde6774502` |
| Commit triển khai ban đầu | `62a7c9015e322f38ed45bd7c316b20893dbf59c7` |
| Staging để đăng nhập/UAT | https://staging.hien-le-garden-v4.pages.dev/admin |
| Deployment cố định của bản cuối | https://bb874542.hien-le-garden-v4.pages.dev |
| Deployment UUID | `bb874542-0bf9-4213-a519-cd35851c8007` |
| Môi trường / nhánh deploy | **Preview / staging** |
| Manifest artifact | `test-results/admin-refresh/release-manifest.json` |
| SHA256 manifest | `03f58d193dffc2d6a0f71c3e4075cd70b0cf7872f734299075e9ac0f05b2dde3` |

Review đúng diff `73cdad80371949d94c13ececeab52bbde6774502..621234caf84a14a75f131a9522175fb67c385632`. Hai commit đều đã có trong Git cục bộ. Chưa có GitHub PR hay exact-head GitHub CI cho bản này; bằng chứng kiểm thử là lượt Linux WSL cục bộ trên source archive của commit cuối.

**Lưu ý tại thời điểm đóng gói:** sau lượt kiểm thử/deploy cuối, workspace xuất hiện chỉnh sửa chưa commit ở `admin/reception.html`, `admin/reception.js`, `admin/tabs.js` và `scripts/check-admin-refresh.mjs`. Các chỉnh sửa này được giữ nguyên, không nằm trong commit `621234c`, patch bàn giao hoặc staging đã xác minh. Không dùng working tree hiện tại để suy ra nội dung đã qua kiểm thử. `sourceTrackedClean: true` trong manifest ghi nhận thời điểm tạo manifest trước khi có những chỉnh sửa mới này.

Alias staging có thể đổi khi deploy tiếp; URL deployment cố định và commit đầy đủ ở trên là mốc đối chiếu. Khi thử Turnstile, dùng alias staging vì widget được giới hạn hostname này.

## Thay đổi

- Nền sáng Lá non và font Be Vietnam Pro trên 28 trang HTML Admin; thành phần chung cho nút, form, bảng, trạng thái, thẻ, hộp thoại và tab.
- Năm nhóm điều hướng theo công việc; sidebar desktop, menu tablet, thanh truy cập nhanh/mobile sheet. Giữ nguyên quyền đơn/kết hợp, URL và server-side authorization.
- Vận hành hôm nay chia bốn tab, giữ hash khi tải lại, bàn phím, số lượng booking chờ và hộp thoại đặt phòng mới.
- Quản lý khách hàng hiện có nhận nền giao diện/điều hướng mới; chưa mở rộng nghiệp vụ CRM.
- Không đổi API, migrations, schema hoặc nghiệp vụ backend.

## Hai vấn đề đã phát hiện và sửa

1. **Bản dựng thiếu `admin/tabs.js`**: file mới chưa được Git theo dõi nên builder theo allowlist bỏ qua. Đã đưa file vào commit; bổ sung tài nguyên Admin bắt buộc và missing-asset self-test. Kiểm thử trình duyệt hiện chạy trên `dist/`, không còn chỉ chạy trên source.
2. **Sơ đồ phòng tràn ngang ở 390px khi font thật tải được**: `white-space: nowrap` trên ô bảng chú thích làm bảng rộng khoảng 420px. Commit cuối cho phép chú thích xuống dòng trên điện thoại; thêm kiểm tra tràn ngang ở **từng tab**, rồi kiểm tra lại staging thật.

Lượt staging ban đầu ở `7362981a` không phải bản bàn giao cuối. Bằng chứng phát hiện lỗi ban đầu được giữ tại `test-results/admin-refresh/initial-62a7c90/`.

## Kết quả kiểm tra trên bản cuối

| Kiểm tra | Kết quả |
|---|---|
| Linux isolated, trừ 3 file R2 theo workflow hiện có | **80 file / 1.545 tests PASS**, không unhandled errors |
| R2 `assetInventoryLines`, non-isolated, process riêng | **12/12 PASS** |
| R2 `assetPhotos`, non-isolated, process riêng | **14/14 PASS** |
| R2 `financeAttachments`, non-isolated, process riêng | **27/27 PASS** |
| Tổng release test gates | **83 file / 1.598 tests PASS** |
| Migration diagnostic Linux | 79/79 PASS; đã nằm trong tổng suite, không cộng lần hai |
| Build + boundary check | **135 file, 15/15 required assets, PASS** |
| Boundary self-test | **55 planted paths + 4 missing-asset cases PASS** |
| Staging binding guard / self-test | **PASS / 19 cases PASS** |
| Probe self-test | **39 cases PASS** |
| Giao diện trên artifact, dữ liệu giả lập | **4 bộ quyền mặc định × 390/800/1440px PASS**; từng tab/hash/reload/bàn phím/focus/menu/modal/create |
| Khung HTML và bản in | 28 trang × 3 kích thước; ba mẫu in có dữ liệu giả lập. Các controller nghiệp vụ ngoài phạm vi tắt khi kiểm tra khung HTML |
| Đối chiếu bản deploy | **61/61 file Admin khớp SHA256 artifact** |
| Staging thật | **Admin, Manager, Reception, Observer × 390/800/1440px PASS**; từng tab, font thật, quyền mặc định, menu, không tràn ngang/JS errors/API 5xx |
| Khách hàng / quyền API trên staging | Admin/Manager/Reception GET customers 200; Observer 403; Observer bị chặn create booking và users bằng 403 |
| Booking staging thật | Booking **#2**, tạo qua UI rồi huỷ qua API, không cọc và refund=0; giữ bản ghi giả đã huỷ làm bằng chứng |
| Auth staging | Chưa đăng nhập → 401; đăng nhập và logout thật từng vai trò; sau logout → 401 |
| Source boundary trên alias + deployment mới | **PASS=62 / FAIL=0 / INCONCLUSIVE=0** trong phạm vi probe hiện có |
| D1 staging migrations | Không có migration cần áp dụng; không chạy apply |

Linux: WSL Ubuntu, Node v22.20.0; tái sử dụng dependencies Linux có package-lock SHA256 khớp dự án (`0c103b780191fc8b2c069a5bf0661f1fef7db5daf17ce4beae0d0927dfb2081c`). Source của mỗi lượt được tách từ Git archive vào thư mục tạm mới.

**Giới hạn:** npm/Vitest mặc định trên Windows vẫn gặp lỗi workerd/module fallback và isolated storage WAL; không nâng cấp dependencies hoặc sửa test để che lỗi. Ba file R2 sử dụng gate non-isolated đã có trong `.github/workflows/test.yml`; chưa khẳng định R2 isolated-storage đã được sửa. Chưa có GitHub CI. Staging smoke không thay thế UAT đầy đủ cọc/dịch vụ/check-in/check-out/hoàn cọc, vốn đã có endpoint tests và cần Claude kiểm tra độc lập.

## Tài khoản và dữ liệu staging

- Admin: dùng tài khoản staging có sẵn; thông tin chỉ ở `.superpowers/staging/staging-admin.local.txt` (git-ignored).
- Ba tài khoản giả: `spec2_62a7c90_manager`, `spec2_62a7c90_reception`, `spec2_62a7c90_observer`. Prefix giữ theo bản đầu để không tạo thêm tài khoản ở lượt cuối. Mật khẩu ngẫu nhiên nằm trong `.superpowers/staging/admin-spec2-accounts.local.json` (git-ignored), không có trong báo cáo/ZIP/Git.
- Booking giả #1 của lượt đầu và #2 của lượt cuối đều đã huỷ, không có cọc/hoàn tiền. Tên có marker `STAGING SPEC2`; không sử dụng thông tin khách thật.
- Preview chỉ có ba secret Turnstile; không có secret Brevo/Telegram. Không thử gửi tin nhắn/email.
- D1 `hien_le_garden_crm_staging`, R2 `hien-le-garden-finance-receipts-staging`; guard xác nhận khác production.
- Danh sách deployment trước/sau xác nhận production vẫn ở `76b21a60-0f8a-42a3-a8ac-0815044ce274`, source `4c212ab`, branch `main`. Không deploy hay mutate production. Không request lại deployment D4B cũ đang chờ 24h.
- Các file có sẵn ngoài phạm vi (`Pasted text.txt`, `docs/roadmap/`, `graphify-out/`, ảnh phòng chưa tracked) không được đưa vào commit/artifact.

## Việc bàn giao Claude

1. Review diff của **commit cuối nêu trên**, tập trung giữ nguyên permission contracts, URL, DOM ids và hành vi API.
2. Kiểm tra độc lập bàn phím/focus, tab hash, menu theo quyền và responsive, đặc biệt sơ đồ phòng ở 390px với font thật.
3. Dùng tài khoản staging thử nghiệp vụ booking: cọc → nhận phòng → dịch vụ → trả phòng; huỷ/hoàn cọc; khách hàng; quyền giới hạn/overrides. Chỉ dữ liệu giả trên staging.
4. Đối chiếu log và manifest; ghi finding theo mức độ, cách tái hiện và commit liên quan. Không coi báo cáo này là independent review PASS.
5. Chủ dự án UAT và duyệt release riêng sau khi finding được xử lý. Chưa được merge/deploy production từ báo cáo này.

## Bằng chứng

Trong `test-results/admin-refresh/`: `release-manifest.json`, `linux-environment.txt`, `linux-isolated.log`, ba `linux-*.log` R2, `artifact-ui.log`, `dist-check.log`, `dist-selftest.log`, `staging-bindings*.log`, `staging-guard-selftest.log`, `probe-selftest.log`, `staging-migrations.log`, `staging-deploy.log`, `deployments-before.log`, `deployments-after.log`, `preview-secret-names.log`, `live-staging.log`, `live-staging-result.json`, `staging-private-probe.log` và ảnh trong `staging-screens/`.

Gói bàn giao `test-results/admin-refresh/HLG-ADMIN-SPEC2-20261007-handoff.zip` chứa báo cáo, patch nguồn của hai commit, manifest, log cuối và ảnh staging; không chứa mật khẩu/token/cookie, source tar, dữ liệu production hoặc thư mục riêng `.superpowers`.
