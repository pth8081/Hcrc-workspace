# Phiên bản hiện tại

**1.90.1** — đã merge vào `main` (nguồn: `server/package.json`, field `version`, cũng là số hiển thị ở
badge góc màn hình + `/api/health`).

## Cập nhật gần nhất (PR #199 → #200, nhánh `claude/chao-ban-oo5ijl`)

Xử lý nốt 4 mục "Thấp" bị bỏ qua ở đợt rà soát trước (PR #196/#197) — không phải bug rõ ràng, cần quyết
định nghiệp vụ, nay xử lý theo hướng an toàn/hợp lý nhất:

1. `lib/workflowEngine.js` — gắn cờ `adminOverride:true` vào đúng dòng lịch sử duyệt khi admin dùng đặc
   quyền bỏ qua điều kiện "đủ approver" để Duyệt hộ 1 bước — trước đây không có dấu vết nào phân biệt lượt
   này với 1 lượt duyệt bình thường (khó truy vết khi có tranh chấp/audit sau này).
2. `lib/createValidation.js` + `routes/create.js` — kiểm trùng mã (code) quét thêm cả Thùng Rác, chặn hồ
   sơ mới dùng lại mã của 1 hồ sơ đã xoá (cả nhánh kiểm trùng chung lẫn nhánh tự tính mã phiên bản tài
   liệu docs). Thêm tham số `trashedItems` TUỲ CHỌN (mặc định rỗng) — không đổi hành vi bất kỳ lời gọi cũ
   nào, chỉ `routes/create.js` (đường thật) mới truyền dữ liệu thật vào.
3. `lib/recordStore.js` + `routes/trash.js` — khôi phục 1 phiên bản tài liệu/phụ lục hợp đồng từ Thùng Rác
   giờ tự động cố khôi phục luôn các thành viên còn lại cùng "họ" (đối xứng với việc xoá đã cascade cả họ
   vào Thùng Rác cùng lúc) — trước đây phải tự khôi phục từng phiên bản 1, dễ bỏ sót, để tài liệu hiện ra
   với lịch sử phiên bản bị đứt quãng. Best-effort: 1 thành viên phụ lỗi không làm hỏng lượt khôi phục
   chính.
4. `lib/recordActions.js` + `routes/records.js` — `mergeReportPeriodByTasks()` trả thêm cảnh báo (KHÔNG
   lưu vào dữ liệu kỳ) khi kỳ liền trước theo thời gian chưa đóng nhưng vẫn phải dùng 1 kỳ CLOSED xa hơn
   làm mốc tính phạm vi — trước đây âm thầm dùng mốc thay thế, không ai biết có khoảng trống/chồng lấn ở
   ranh giới 2 kỳ.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường, không thêm dependency
mới — chỉ copy code + `pm2 restart`.

Đã kiểm thử: 37 file `tests/test-*.js` pass (36 file cũ + 1 file mới `test-audit-round3-lowfixes.js`, 18
kịch bản riêng đợt này).

## Trước đó (PR #196 → #197, nhánh `claude/chao-ban-oo5ijl`)

Tiếp tục rà soát bảo mật chuyên sâu (đợt 2) sau PR #193/#194 — 6 agent audit song song rà lại toàn bộ
ứng dụng tìm phát hiện Medium/Low còn sót. Trong quá trình rà, phát hiện thêm **7 lỗ hổng thực chất
nghiêm trọng hơn mức Medium** (đánh giá lại thành High vì là biến thể/mở rộng trực tiếp của các lỗ hổng
Critical/High đã vá ở PR #193) — vá toàn bộ cùng ~20 phát hiện Medium/Low xác nhận:

**Đánh giá lại thành High (đã vá):** (1) `fileUrl` không được validate ở hầu hết module (docs/submissions/
contracts/carRegs/officeReqs/itPriceApprovals, cả tạo lẫn sửa — PR #193 chỉ vá 3 field) — mở lại cả stored
XSS lẫn giả mạo fileUrl để vượt kiểm quyền theo hồ sơ. (2) Custom field kiểu file/multifile (Biểu Mẫu tuỳ
chỉnh) không được `lib/fileAuthz.js` kiểm tra — fail-open, ai đăng nhập cũng đọc được. (3) Hồ sơ trong
Thùng Rác lộ file NHIỀU hơn trước khi xoá, và xoá vĩnh viễn chưa từng xoá file vật lý trên đĩa. (4) Duyệt
Đề Nghị Thanh Toán bỏ qua khung xác thực lại `approverAuthLevel` mà 9 module khác đều bắt buộc. (5)
`ADMIN_ONLY_KEYS` thiếu 5 danh mục quản trị. (6) Stored XSS qua `javascript:` URI trong link video đào
tạo. (7) Route mutation Góc Chia Sẻ bỏ qua kiểm quyền xem — lộ nội dung bài đang ẩn/chờ duyệt.

**~20 phát hiện Medium/Low:** race điều kiện tạo trùng ngân sách theo kỳ, thiếu kiểm trạng thái luồng giá
IT, thiếu validate assignedTo/deadline/username ở Công Việc và Biên Bản Họp, tồn kho Đồng Phục bỏ qua
điều chỉnh HONG/HUY/MAT, chống zip-bomb thiếu ở luồng import Excel người dùng, email quan hệ mở gửi được
tới địa chỉ bất kỳ, mã OTP dùng `Math.random()` thay vì CSPRNG, và nhiều mục khác.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường, không thêm dependency
mới — chỉ copy code + `pm2 restart`.

Đã kiểm thử: 36 file `tests/test-*.js` pass (30 file cũ + 6 file mới riêng đợt này, ~190 kịch bản).

## Trước đó (PR #193 → #194, nhánh `claude/chao-ban-oo5ijl`)

Rà soát bảo mật chuyên sâu (6 agent song song rà toàn bộ nghiệp vụ/chức năng/an toàn thông tin), vá **9
lỗ hổng mức Critical/High** (Medium/Low để lại cho đợt sau):

**Critical:** (1) `carRegs`/`officeReqs` ép cứng `status/currentStep/history` phía server khi tạo mới —
chặn payload tự khai `APPROVED` để bỏ qua luồng duyệt. (2) `ADMIN_ONLY_KEYS` thiếu `itPriceDeptWorkflows`
— vá lỗ hổng user thường ghi đè được quy trình duyệt giá IT. (3) `recordViewScope.js` bỏ sót export
`canViewItServiceRenewal`/`filterItServiceRenewalsForUser` — vá lộ dữ liệu Gia Hạn Dịch Vụ CNTT qua
`GET /api/data` VÀ lỗi có thể sập cả server khi tải file liên quan. (4) Chặn xoá đề nghị thanh toán đã có
đợt xác nhận (`confirmed`), tránh thanh toán trùng. (5) Validate URL file đính kèm (Góc Chia Sẻ/Tuyển
Dụng), chặn `javascript:` URI (XSS lưu trữ).

**High:** (1) `/uploads` (Khung Xem Bảo Vệ) thêm kiểm quyền theo hồ sơ — trước đây chỉ cần đăng nhập là
đọc được mọi file; tách riêng luật "Xem" và "Tải" (`lib/fileAuthz.js`, mode `view`/`download`) để không
chặn nhầm người chỉ có quyền Xem. (2) `paymentRequests` lọc theo phòng ban ở `GET /api/data` (trước đây
lộ toàn bộ). (3) Sanitize bình luận đang kiểm duyệt (Góc Chia Sẻ) ở mọi route mutation, không chỉ GET.
(4) Chống zip-bomb khi đọc file Excel (6 luồng import) — ngân sách giải nén + đọc dạng streaming.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường, không thêm dependency
mới — chỉ copy code + `pm2 restart`.

Đã kiểm thử: 30 file `tests/test-*.js` pass (27 file cũ + 3 file mới), gồm thực nghiệm chứng minh zip-bomb
crash code cũ nhưng bị chặn an toàn ở code đã vá.

## Trước đó (PR #191, nhánh `claude/chao-ban-oo5ijl`)

Tính năng: **HCRC Đồng Hành (hỏi & đáp) + module Nhân Sự mới**

Thêm tab "HCRC Đồng Hành" trong module Truyền Thông — nhân viên gửi câu hỏi về chế độ/quy định công ty,
xem lại câu hỏi + phản hồi của CHÍNH MÌNH (hộp thư riêng tư 1-1, không phải bảng tin công khai). Thêm
module mới "Nhân Sự" (top-level, độc lập), hiện có đúng 1 tab con "Quản Lý & Phản Hồi Ý Kiến" để bộ phận
Nhân Sự xem toàn bộ câu hỏi và trả lời. Quyền: 1 quyền phẳng duy nhất `nhanSuManage` — vừa là quyền vào
module, vừa là quyền trả lời (chưa tách theo tab vì module chỉ có 1 tab). Mô hình 1 hỏi – 1 đáp, kết thúc
(không trao đổi qua lại nhiều lượt); không gửi email khi Nhân Sự phản hồi — chỉ badge "chưa đọc" trong
app (`hrFeedback.employeeUnread` — cờ đã-đọc/chưa-đọc bền vững đầu tiên trong hệ thống, mọi badge khác từ
trước tới nay đều chiếu trực tiếp từ trạng thái hiện tại của bản ghi).

**Deploy impact:** không đổi `server/sql/schema.sql` (dữ liệu mới nằm trong JSON qua `MIGRATED_COLLECTIONS`,
tự động di trú khi khởi động), không thêm biến môi trường, không thêm/đổi `dependencies` — chỉ copy code +
`pm2 restart` như bình thường.

Đã kiểm thử: 27 file `tests/test-*.js` pass, bao gồm 1 file test mới viết riêng cho tính năng này (12 kịch
bản, có kiểm tra riêng tư cốt lõi — nhân viên khác không thấy câu hỏi của người khác), cộng demo trực quan
Playwright trên giao diện thật.

## Trước đó (PR #189, nhánh `claude/chao-ban-oo5ijl`)

Tính năng: **Trường Nhóm Quyền cho form tạo Nhân Viên Siêu Thị (Đồng Phục)**

Thêm field `scope: 'STORE'` cho Nhóm Phân Quyền (checkbox "Chỉ dùng cho Siêu Thị" + badge 🏪), seed 1
nhóm mặc định (kèm migration cho DB thật đang chạy). Form rút gọn "Quản Lý Nhân Viên Siêu Thị" thêm
dropdown bắt buộc "Nhóm Quyền", chỉ lọc đúng nhóm scope STORE, tự chọn sẵn nhóm mặc định. Server
re-validate lại groupId + scope trước khi tính perms — không tin field perms nào từ client.

**Deploy impact:** có 1 migration tự động chạy khi server khởi động (idempotent, không cần thao tác
thủ công) — chỉ cần copy code + `pm2 restart` như bình thường.

Đã kiểm thử: 27 file `tests/test-*.js` (543 kịch bản) pass, cộng demo trực quan Playwright trên giao
diện thật.

## Trước đó (PR #187, nhánh `claude/chao-ban-oo5ijl`)

Fix nhỏ: `renderUniformIssueEmployeeOptions()` (ô "Cấp Đồng Phục Cho Nhân Viên") thêm điều kiện
`posType !== 'HO'` để chắc chắn loại tài khoản HO khỏi danh sách, phòng trường hợp `dept` trùng tên với
1 siêu thị. Đã kiểm tra không dùng `=== 'STORE'` (sẽ ẩn mất nhân viên cũ chưa có field `posType`).

## Trước đó (PR #185, nhánh `claude/chao-ban-oo5ijl`)

Tính năng: **Bảo mật tài khoản khoá + Sửa/Import danh mục + Sub-tab Quản Lý Nhân Viên Siêu Thị**

| PR | Version | Nội dung |
|----|---------|----------|
| [#185](https://github.com/pth8081/vpdt-dms/pull/185) | 1.87.0 | (1) Lọc tài khoản đã khoá khỏi mọi ô chọn tài khoản hệ thống (không đổi dữ liệu cũ). (2) Cảnh báo admin khi khoá 1 tài khoản đang là người duyệt được chỉ định tên ở bước hiện tại của hồ sơ đang chờ (9 module workflow). (3) Nút Sửa (rename có cascade) + import Excel/CSV hàng loạt cho Danh Mục Siêu Thị; vá lỗ hổng `stores`/`jobTitles` trước đây không nằm trong `ADMIN_ONLY_KEYS`. (4) Sub-tab "Quản Lý Nhân Viên Siêu Thị" trong module Đồng Phục (chỉ HO/uniformManage) — tạo/khoá 1 chiều tài khoản nhân viên siêu thị qua route riêng, kèm danh mục Chức Danh (Siêu Thị) tách riêng khỏi Chức Danh (HO). |

Đã kiểm thử: 26 file `tests/test-*.js` (532 kịch bản) pass, bao gồm 1 file test mới viết riêng cho tính
năng này (29 kịch bản, bao phủ cả 4 yêu cầu).

## Trước đó (PR #181 → #183, nhánh `claude/chao-ban-oo5ijl`)

Tính năng: **Văn Bản Trình — Bộ phận Trợ Lý/Thư Ký đề xuất thay thế toàn bộ tờ trình**

| PR | Version | Nội dung |
|----|---------|----------|
| [#181](https://github.com/pth8081/vpdt-dms/pull/181) | 1.86.0 | Tính năng chính: ở bước Bộ phận Trợ Lý/Thư Ký, nút "Yêu Cầu Bổ Sung" mở hộp lựa chọn — Hủy (luồng cũ) / Đồng ý (upload tệp thay thế, người trình xác nhận). |
| [#182](https://github.com/pth8081/vpdt-dms/pull/182) | 1.86.1 | Fix: form upload tệp tự đóng khi thiếu tệp (phát hiện qua kiểm thử giao diện thật). |
| [#183](https://github.com/pth8081/vpdt-dms/pull/183) | 1.86.2 | Gắn tên tệp trực tiếp vào từng dòng lịch sử để lưu vết đầy đủ (đề xuất/đồng ý/từ chối). |

Đã kiểm thử: 25 file `tests/test-*.js` (525+ kịch bản) pass sau mỗi lần merge, cộng thêm 2 vòng kiểm tra
trực quan trên giao diện thật (Playwright, click UI thật) xác nhận toàn bộ luồng chạy đúng cả 2 nhánh.

## Deploy impact
- Không đổi `server/sql/schema.sql`.
- Không thêm biến môi trường mới.
- Không thêm/đổi `dependencies` trong `server/package.json` (chỉ đổi field `version`).
- Chỉ cần copy code + `pm2 restart` theo quy trình cập nhật hiện có.

---
_File này được cập nhật thủ công mỗi lần merge — xem lịch sử commit trên GitHub để biết chi tiết đầy đủ hơn._
