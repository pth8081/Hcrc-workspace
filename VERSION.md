# Phiên bản hiện tại

**6.9** — đã merge vào `main` (nguồn: `server/package.json`, field `version`, cũng là số hiển thị ở badge
góc màn hình + `/api/health`). Từ v2.0 trở đi đổi sang định dạng `MAJOR.MINOR` (không còn semver 3 phần
kiểu `1.100.0`) — xem quy tắc đánh version trong `CLAUDE.md`. Đúng theo quy tắc MINOR chạy 0-9 trong
`CLAUDE.md`: sau `6.8` tăng MINOR lên `6.9`.

## Cập nhật gần nhất — Fix: nút Duyệt/Từ chối Phê Duyệt Giá ở màn "Phê Duyệt" tổng hợp không phản ứng gì

Người dùng báo lỗi thật: mở màn "Phê Duyệt" tổng hợp (Approval Hub, gộp hồ sơ chờ duyệt từ mọi module),
bấm nút Duyệt cho 1 hồ sơ Phê Duyệt Giá (Hỗ Trợ IT) — không có phản ứng gì, không mở được bảng chi tiết để
xem giá rồi mới quyết định duyệt.

**Nguyên nhân**: `getMyPendingApprovals()` (`public/index.html`) nối dây nút Duyệt/Từ chối của hồ sơ
`itPriceApprovals` tới hàm `runItPriceAction` — hàm này **không hề tồn tại** ở bất kỳ đâu trong code (có
thể sót lại từ 1 lần refactor trước, dự định viết nhưng chưa từng viết). Bấm nút gọi `data-op="runItPriceAction"`
qua cơ chế `bindCspDelegation()` chung, không tìm thấy hàm nên không làm gì cả — không báo lỗi rõ ràng cho
người dùng thấy.

**Fix**: đổi hành động của dòng Phê Duyệt Giá trong Approval Hub từ cặp nút "Duyệt/Từ chối" trực tiếp
(kiểu Tài liệu/Hợp đồng) sang mở thẳng modal chi tiết (`openItPriceModal`) — ĐÚNG khuôn với Văn bản
trình/Đăng ký xe/Mua Bán-Sửa Chữa/VPP/Ngân Sách (đều cần xem bảng chi tiết trước khi quyết định, không
duyệt "mù" ngay tại danh sách). Modal chi tiết đã có sẵn đầy đủ nút Duyệt/Từ chối/Yêu Cầu Bổ Sung thật
(`renderItPriceModalControls()`, gọi đúng `approveItPrice()`/`rejectItPrice()` đã hoạt động tốt từ trước) —
chỉ cần trỏ đúng nút ở Approval Hub tới modal đó, không viết logic duyệt/từ chối mới.

**Verify**: syntax/dup-id check khớp đúng baseline (không đổi). Thêm 5 kịch bản mới vào
`tests/test-approval-hub.js` (Playwright thật, chạy code thật của `index.html`) — xác nhận dòng Phê Duyệt
Giá chỉ còn đúng 1 nút, nút đó nối tới 1 hàm THẬT SỰ tồn tại (chặn tái phát lỗi "hàm không tồn tại"), đúng
là `openItPriceModal`, bấm vào thực sự mở được modal, và modal mở ra có đủ nút Duyệt/Từ chối thật hoạt
động được. Cả 30/30 kịch bản trong file PASS. Chạy lại toàn bộ `tests/test-*.js` (47 file) — vẫn 2 lỗi
known-flaky đã biết từ trước (cần SQL Server thật), không phát sinh regression nào khác.

**Deploy-impact**: KHÔNG đổi `sql/schema.sql`, KHÔNG đổi `.env.example`, KHÔNG thêm `dependencies` mới —
chỉ copy code + `pm2 restart`.

## Trước đó — Fix: "Đánh dấu cột trước khi tải" báo sai lỗi "Không khớp được cột nào" khi file thật có dòng trống phía trên dòng tiêu đề

Người dùng báo lỗi thật khi dùng tính năng "Đánh dấu cột trước khi tải" (module Hỗ Trợ IT > Phê Duyệt Giá,
mới thêm ở bản `6.7`): tick chọn cột có thật trong bảng dữ liệu (VD "CT khuyến mãi") nhưng bấm "Tải file đã
đánh dấu" lại báo lỗi "Không khớp được cột nào cần đánh dấu với tệp gốc trên đĩa".

**Nguyên nhân**: route `POST /api/it-price/:id/download-marked` (`routes/priceFile.js`) đọc dòng tiêu đề
cột bằng cách giả định CỨNG dòng 1 vật lý (`worksheet.getRow(1)`) là dòng tiêu đề. Nhưng bộ đọc file gốc
lúc parse ban đầu (`lib/priceFileParser.js` qua `lib/xlsxSafeRead.js::streamFirstSheetRows`, mặc định
`includeEmpty:false`) lại coi dòng KHÔNG-TRỐNG ĐẦU TIÊN là dòng tiêu đề — nếu file Excel thật có 1 dòng
trống hoặc tiêu đề phụ (VD dòng tên bảng/công ty để trống ở các cột dữ liệu) phía TRÊN dòng tiêu đề cột
thật, dòng tiêu đề cột không nằm ở dòng 1 vật lý. Route `download-marked` đọc nhầm dòng trống đó làm tiêu
đề, không tìm thấy tên cột nào để so khớp, nên báo "Không khớp được cột nào" dù cột đã chọn tồn tại thật
trong file.

**Fix**: `routes/priceFile.js` — dò lại dòng tiêu đề THẬT bằng ĐÚNG quy ước `row.hasValues` (dòng
không-trống đầu tiên) thay vì giả định dòng 1, khớp chính xác cách `streamFirstSheetRows` đã dùng lúc parse
ban đầu. Đồng thời sửa vòng lặp tô màu cột chỉ tô từ dòng tiêu đề thật trở xuống (không tô nhầm lên dòng
trống/tiêu đề phụ phía trên nếu có).

**Verify**: `node -c routes/priceFile.js` OK. Thêm 1 kịch bản mới vào `tests/test-itprice-download.js` mô
phỏng đúng file thật có 1 dòng trống ở dòng 1 rồi mới tới dòng tiêu đề cột ở dòng 2 — xác nhận route vẫn dò
đúng cột, tô đúng từ dòng tiêu đề thật trở xuống, không tô nhầm dòng trống, không mất dữ liệu. Chạy lại cả
file `tests/test-itprice-download.js` (18/18 PASS) và toàn bộ `tests/test-*.js` (47 file) — vẫn 2 lỗi
known-flaky đã biết từ trước (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, cần SQL Server
thật không có trong sandbox unit-test), không phát sinh regression nào khác.

**Deploy-impact**: KHÔNG đổi `sql/schema.sql`, KHÔNG đổi `.env.example`, KHÔNG thêm `dependencies` mới —
chỉ copy code + `pm2 restart`.

## Trước đó — Hỗ Trợ IT > Phê Duyệt Giá: tách Bán Lẻ/Bán Buôn, giới hạn tải file, đánh dấu cột, khoá khẩn cấp lúc IT đang xử lý

6 cải thiện cho module "Hỗ Trợ IT" > "Phê Duyệt Giá" (`itPriceApprovals`), đã research kỹ code hiện có +
chốt hướng thiết kế với người dùng trước khi làm (không thêm cờ quyền phẳng mới, mở rộng đúng cấu hình
"ai duyệt bước nào theo phòng ban" có sẵn sang thêm 1 chiều loại giá):

- **Mục 1 — Tách `priceType` (RETAIL/WHOLESALE) + 2 sub-tab con**: `lib/createValidation.js`
  (`itPriceApprovals.extraValidate`) bắt buộc `priceType` hợp lệ khi tạo (400 nếu thiếu/sai).
  `public/index.html` — thêm 2 nút sub-tab con "🏷️ Bán Lẻ"/"🏪 Bán Buôn" trong tab Phê Duyệt Giá
  (`setItPriceSubTab()`, mặc định RETAIL), mỗi sub-tab dùng CHUNG 1 form tạo nhưng tự động gắn đúng
  `priceType` theo sub-tab đang mở (không có dropdown chọn tay, tránh chọn nhầm) — lọc danh sách + đếm
  dashboard theo `(item.priceType || 'RETAIL') === activeSubTab`, hồ sơ CŨ chưa có field này tự rơi vào
  Bán Lẻ, không cần script migrate dữ liệu.
- **Mục 2/3 — Giới hạn tải: chỉ file đã phê duyệt, cả IT lẫn người duyệt phòng ban đều tải được đúng file
  đó**: viết `resolveApprovedFileId()`/`resolveApprovedFileUrl()` DÙNG CHUNG (`lib/recordActions.js`) —
  MIRROR đúng fallback đã có sẵn ở client cho hồ sơ CŨ APPROVED trước khi có `approvedFileId` (chưa từng
  có yêu cầu bổ sung từ IT thì coi file cuối cùng là file đã duyệt, khác thì không file nào đủ tin cậy).
  `lib/fileAuthz.js` (`authorizeFileAccess()`, nhánh `owning.itPrice`, `mode==='download'`) — sau khi
  `canViewItPriceApproval()` pass, kiểm thêm `fileUrl` phải khớp đúng file đã duyệt mới cho tải (403 nếu
  không khớp); `mode==='view'` (Khung Xem Bảo Vệ) GIỮ NGUYÊN không đổi. Client (`renderItPriceModal()`)
  chỉ hiện nút "⬇️ Tải file gốc" cho đúng file khớp (mirror `resolveApprovedFileIdClient()`), file khác
  vẫn xem được bảng dữ liệu đầy đủ, chỉ ẩn nút tải.
- **Mục 4 — Đánh dấu cột trước khi tải (tô xanh da trời nhạt, giữ NGUYÊN đủ mọi cột)**: route mới
  `POST /api/it-price/:id/download-marked` (`routes/priceFile.js`) — tự kiểm lại quyền
  (`canViewItPriceApproval()`) + xác định đúng file đã duyệt (dùng lại `resolveApprovedFileUrl()`, không
  tin riêng client), đọc file gốc từ đĩa bằng `exceljs` (`workbook.xlsx.load()`, có thêm lớp phòng thủ
  zip-bomb `assertDecompressedSizeWithinBudget()` dù file đã qua kiểm 1 lần lúc tải lên), dò lại cột theo
  TÊN (khớp `normalizeHeader()` dùng chung với `lib/priceFileParser.js`, không tin lại vị trí suy ra lúc
  parse ban đầu vì có thể lệch nếu nộp qua Mẫu Giá), tô `fill` màu `FFBFDFF5` cho TOÀN BỘ cell (header +
  dữ liệu) của các cột được chọn, sinh buffer MỚI theo từng request — KHÔNG bao giờ ghi đè file gốc trên
  đĩa. `public/index.html` — nút "📋 Đánh dấu cột trước khi tải" mở box checkbox (tick đổi nền xanh da
  trời nhạt ngay lúc chọn), nút "⬇️ Tải file đã đánh dấu" gọi route mới, song song với link tải file gốc
  hiện có (không bắt buộc phải đánh dấu mới tải được).
- **Mục 5 — Khoá "🚨 Từ Chối Khẩn" khi IT đang xử lý ("Tôi đang xử lý" đã bấm, `applyClaimedBy` có giá
  trị) — ÁP DỤNG CHO MỌI NGƯỜI, KỂ CẢ ADMIN**: `public/index.html` (điều kiện hiện nút,
  `renderItPriceModalControls()`) thêm `&& !p.applyClaimedBy` ĐỘC LẬP với nhánh admin của
  `isFinalStepApproverOfItPriceClient()`. `lib/recordActions.js`
  (`requestItPriceEmergencyReject()`) thêm chặn cứng NGAY ĐẦU HÀM (trước mọi nhánh có thể cho admin bỏ
  qua): `item.applyClaimedBy` có giá trị → 409, không có ngoại lệ nào cho `user.perms?.admin`.
- **Mục 6 — Tách cấu hình duyệt theo dept × loại giá, tương thích ngược cấu hình cũ**: `defaults.js` —
  `itPriceDeptWorkflows` đổi cấu trúc từ `{dept: {workflowId,approvers}}` (CŨ, phẳng) sang lồng thêm 1
  cấp `{dept: {RETAIL:{...}, WHOLESALE:{...}}}`. `lib/workflowEngine.js` — hàm mới
  `resolveItPriceDeptWorkflowConfig(map, dept, priceType)`: cấu hình CŨ (phẳng, không có nhánh
  RETAIL/WHOLESALE) coi TOÀN BỘ là RETAIL, WHOLESALE coi như chưa cấu hình (null, không throw) — CHỈ sửa
  ĐÚNG nhánh `resolveWfConfig` của `itPriceApprovals` trong `MODULE_CONFIGS`, không đụng module khác dùng
  chung file (`docs`/`carRegs`/`officeReqs`/`budgetEntries`/...). `public/index.html`
  (`WORKFLOW_TAB` entry `ITPRICE`) — thêm cờ `priceTypeNested` (khác `hasTypes` thường của Văn Bản Trình,
  vì thứ tự lồng NGƯỢC: dept-ngoài/loại-trong thay vì loại-ngoài/dept-trong), 2 sub-tab "Bán Lẻ"/"Bán
  Buôn" trong màn cấu hình admin để gán người duyệt riêng cho từng tổ hợp phòng ban × loại giá — khi admin
  lần đầu cấu hình loại thứ 2 cho 1 phòng ban đang có cấu hình phẳng cũ, tự chuyển cấu hình cũ đó thành
  nhánh RETAIL trước khi ghi thêm (không mất dữ liệu).

**Verify integrity**: `node -c` toàn bộ file server sửa (`lib/fileAuthz.js`, `lib/recordActions.js`,
`lib/createValidation.js`, `lib/workflowEngine.js`, `lib/priceFileParser.js`, `lib/xlsxSafeRead.js`,
`defaults.js`, `routes/priceFile.js`) OK. Script kiểm `public/index.html` (parse 4 script block, quét
trùng `id=`, đếm div mở/đóng) khớp đúng baseline pre-existing (13 dup-id đã biết từ trước, lệch div=5
không đổi) — không phát sinh thêm.

**Test tự động**: mở rộng `tests/test-it-support.js` (Playwright + mock backend chạy CODE THẬT của
`lib/recordActions.js`/`lib/workflowEngine.js`) — thêm 4 kịch bản: tạo hồ sơ RETAIL/WHOLESALE từ đúng
sub-tab + lọc đúng danh sách theo sub-tab; cấu hình lồng dept×priceType (dept "Marketing" mới) — người
duyệt Bán Lẻ/Bán Buôn KHÔNG duyệt chéo được nhau; hồ sơ CŨ mock trực tiếp (không `priceType`) vẫn lọc
đúng vào Bán Lẻ; "Từ Chối Khẩn" bị khoá khi `applyClaimedBy` có giá trị — test riêng case ADMIN cũng bị
chặn, mở khoá lại sau khi IT huỷ nhận việc. Viết mới `tests/test-itprice-download.js` (thuần Node, lib
thật + Express router thật, không mock lại logic) — 17 kịch bản: giới hạn tải file theo mode
'download'/'view', fallback file đã duyệt cho hồ sơ cũ (cả 2 nhánh có/không từng có yêu cầu bổ sung từ
IT), `resolveItPriceDeptWorkflowConfig()` với cấu hình phẳng/lồng/chưa cấu hình, `applyWorkflowAction()`
thật với hồ sơ thiếu `priceType`, và route `download-marked` thật (file `.xlsx` thật trên đĩa) — tô đúng
cột, giữ nguyên dữ liệu, KHÔNG ghi đè file gốc (so sánh hash trước/sau), chặn người ngoài phạm vi/hồ sơ
chưa duyệt/columnKeys không hợp lệ. Cả 2 file PASS 100%. Chạy toàn bộ `tests/test-*.js` (47 file) —
giữ nguyên 2 file known-flaky đã biết từ trước (`test-audit-fixes-batch1.js`/
`test-audit-round2-cluster1.js`, cần SQL Server thật không có trong sandbox unit-test, xác nhận lỗi
GIỐNG HỆT baseline trước khi sửa qua diff log), còn lại đều PASS — không phát sinh regression cho các
module khác dùng chung `resolveWfConfig`/`MODULE_CONFIGS` ở `lib/workflowEngine.js`.

**Demo Playwright thật** (server.js + SQL Server thật qua Docker container `vpdt-mssql`, tài khoản demo
`itSupport`/`itManage`/2 người duyệt phòng ban `totpEnabled:false`; tài khoản admin BẮT BUỘC lần đầu qua
màn thiết lập TOTP — tự động hoàn tất bằng `otplib` tính đúng mã 6 số từ secret hiện trên màn, dùng 1
page RIÊNG giữ đăng nhập XUYÊN SUỐT cho admin để tránh đúng bug 401-ở-lượt-đăng-nhập-kế-tiếp đã biết,
không đăng nhập lại admin lần 2 trong cả phiên demo): admin cấu hình 2 người duyệt TÁCH RIÊNG cho Bán
Lẻ/Bán Buôn của phòng ban thật ("Phòng Kế Toán") → tạo 1 hồ sơ Bán Lẻ + 1 hồ sơ Bán Buôn từ đúng 2
sub-tab, xác nhận đúng người duyệt hiện lên theo đúng loại, người duyệt Bán Buôn thử duyệt hồ sơ Bán Lẻ
bị chặn (và ngược lại) → người duyệt Bán Lẻ yêu cầu bổ sung, người đề xuất tải tệp bổ sung (append-only,
2 tệp) rồi duyệt xong → xác nhận CHỈ file đã duyệt (tệp bổ sung, tệp cuối) tải được, tệp gốc bị chặn 403 —
đúng cho CẢ tài khoản IT lẫn tài khoản người duyệt → đánh dấu 2 cột rồi tải, đọc lại bằng `exceljs` xác
nhận tô ĐÚNG 2 cột đã chọn (cả header lẫn dữ liệu), 2 cột còn lại không bị tô, không mất dòng/cột/dữ liệu
nào → IT bấm "Tôi đang xử lý" → xác nhận nút "🚨 Từ Chối Khẩn" biến mất + server chặn cứng gọi thẳng API,
đúng cho CẢ người duyệt bước cuối LẪN tài khoản admin (không có bypass) → mock 1 hồ sơ CŨ trực tiếp
(không `priceType`) vẫn hiện đúng ở sub-tab Bán Lẻ, không lọt sang Bán Buôn. 36/36 kiểm tra PASS, chụp 16
ảnh màn hình minh hoạ từng bước.

**Deploy-impact**: KHÔNG đổi `sql/schema.sql` (`itPriceApprovals` lưu payload JSON blob trong
`dbo.Records`, field mới `priceType` chỉ là thay đổi code) — KHÔNG cần chạy lại schema. KHÔNG thêm biến
môi trường mới (`.env.example` không đổi). KHÔNG thêm `dependencies` mới (`exceljs` đã có sẵn từ trước
cho `lib/priceFileParser.js`, route mới dùng lại đúng gói đó). Chỉ cần copy code + `pm2 restart`.

## Trước đó — Đăng nhập: nhớ tài khoản trên thiết bị (kiểu SeABank) — ẩn ô gõ tên, "Tài khoản khác", bỏ "Quên mật khẩu"

Màn hình đăng nhập (`#loginSection`, `public/index.html`) đổi theo flow app SeABank tham chiếu: sau lần
đăng nhập **thành công đầu tiên** trên 1 thiết bị — bằng **bất kỳ phương thức nào** (mật khẩu thường,
mật khẩu + TOTP bước 2, hay vân tay/Face ID) — hệ thống tự "nhớ" tài khoản đó (username + tên hiển thị)
trong `localStorage` của trình duyệt. Lần mở lại sau đó, màn đăng nhập tự ẩn hẳn ô gõ Tên đăng nhập, chỉ
hiện tên đầy đủ người dùng + nút **"Tài khoản khác"** (đổi sang tài khoản khác khi cần, máy dùng chung)
+ ô Mật khẩu như bình thường. Bỏ hẳn dòng footer "Quên mật khẩu hoặc chưa có tài khoản? Liên hệ Phòng
CNTT.".

App trước đó đã có sẵn 1 phần cơ chế này nhưng bị giới hạn hẹp — chỉ ghi nhớ lúc người dùng chủ động vào
Hồ Sơ Cá Nhân đăng ký vân tay/Face ID, và chỉ hiện UI "đã nhớ" khi trình duyệt hỗ trợ WebAuthn (gộp nhầm
2 điều kiện độc lập). Đợt này MỞ RỘNG cơ chế có sẵn ra áp dụng cho MỌI lượt đăng nhập thành công, và tách
đúng 2 điều kiện hiển thị UI:

- **Mở rộng việc "nhớ" ra mọi lượt đăng nhập, lưu cả tên hiển thị** — đổi định dạng lưu trong
  `localStorage` từ raw string sang JSON `{username, name}`. Đổi tên hàm cho đúng ngữ nghĩa mới:
  `getRememberedWebauthnUsername()`/`setRememberedWebauthnUsername()` → `getRecognizedLogin()`/
  `setRecognizedLogin(username, name)` — **giữ NGUYÊN key `localStorage`** (`vpdt_webauthn_username`) để
  không mất dữ liệu đã lưu trên máy người dùng thật. `getRecognizedLogin()` bọc try/catch quanh
  `JSON.parse`: nếu giá trị cũ trong `localStorage` là raw string (định dạng TRƯỚC đợt này), parse lỗi
  thì coi thẳng chuỗi đó là username (fallback `{username: raw, name: raw}`) — tương thích ngược, không
  vỡ trạng thái "đã nhớ" của thiết bị đang dùng. Gọi `setRecognizedLogin(user.username, user.name)` ngay
  đầu `proceedAfterAuth(user)` — điểm hội tụ chung của cả 3 luồng đăng nhập (`login()`,
  `submitTotpLoginStep()`, `loginWithBiometric()`) nên chỉ cần sửa đúng 1 chỗ.
- **Tách điều kiện hiển thị UI "đã nhớ" khỏi việc trình duyệt có hỗ trợ WebAuthn hay không** —
  `initRememberedLoginUser()` giờ chỉ còn phụ thuộc "có tài khoản đã nhớ" (bỏ `&& canShowBiometricLogin()`
  khỏi điều kiện hiện UI); nút vân tay/Face ID vẫn ẩn/hiện độc lập theo `canShowBiometricLogin()` như cũ.
  Dòng hiển thị tên ưu tiên `recognized.name || recognized.username` (tên đầy đủ, fallback username cho
  dữ liệu cũ chưa có tên).
- **HTML**: đổi label nút `#btnSwitchLoginUser` từ "Đăng nhập tên khác" → "Tài khoản khác" (giữ nguyên
  `data-op="switchLoginUser"`, không đụng CSP delegation).
- **Bỏ hẳn "Quên mật khẩu"**: xoá dòng `<div class="loginpage-card-foot">Quên mật khẩu hoặc chưa có tài
  khoản? Liên hệ Phòng CNTT.</div>` ở footer màn đăng nhập.

**Demo Playwright thật** (server + SQL Server thật, tài khoản demo non-admin `totpEnabled:false`, KHÔNG
dùng admin+TOTP theo pattern tránh bug 401 đã biết): xoá `localStorage` (thiết bị mới) → xác nhận hiện ô
gõ tên bình thường → đăng nhập bằng MẬT KHẨU thường → tải lại trang sau khi logout → xác nhận đúng UI
"đã nhớ" (ẩn ô gõ tên, hiện TÊN ĐẦY ĐỦ, nút "Tài khoản khác") → bấm "Tài khoản khác" → ô gõ tên hiện lại
trống, focus → gõ lại tên cũ đăng nhập lại vẫn hoạt động → xác nhận footer không còn "Quên mật khẩu" →
đăng ký 1 thiết bị vân tay ảo (CDP virtual authenticator) → logout/tải lại → UI "đã nhớ" + nút vân tay
đều hiện đúng, đăng nhập vân tay vẫn hoạt động với tài khoản đã nhớ → test tương thích ngược: set thủ
công `localStorage.setItem('vpdt_webauthn_username', 'someuser')` (raw string định dạng CŨ) rồi tải lại
→ không vỡ, UI "đã nhớ" vẫn hiện đúng (hiển thị = username vì dữ liệu cũ không có tên đầy đủ). Toàn bộ
các bước đều PASS. Dọn tài khoản demo sau khi test xong.

**Regression**: 46/46 file `tests/test-*.js` PASS (bao gồm 2 file known-flaky
`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, xác nhận PASS qua log dù không tự thoát
tiến trình).

**Deploy-impact**: KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — chỉ sửa `public/index.html` (client thuần). Chỉ cần copy code + `pm2 restart`.

## Trước đó — Vá 3 lỗi thiếu validate picker + bỏ dấu tìm kiếm toàn hệ thống + Task module đổi sang picker chuẩn

4 mục sửa lỗi/cải thiện đã research và duyệt phương án trước:

- **Mục 1-2 — thiếu chặn "phải chọn từ gợi ý" ở "Người Phụ Trách"**: `submitOperationStoreOpening()`
  (`vsoPersonInChargeInput`/`vsoPersonInChargeUsername`) và `submitOperationRepair()`
  (`vrPersonInChargeInput`/`vrPersonInChargeUsername`, `public/index.html`) trước đây chỉ đọc hidden
  username mà KHÔNG đối chiếu lại text đã gõ — gõ tự do không chọn từ gợi ý âm thầm gửi rỗng
  (`personInCharge: ''`) thay vì báo lỗi. Thêm chặn đúng khuôn `carAssignedDriver` đã có sẵn: gõ có chữ
  nhưng chưa chọn đúng → alert chặn lại; để trống vẫn hợp lệ (field vẫn optional như trước).
- **Mục 3 — cùng lỗi ở "Người Nghiệm Thu"**: `submitOperationWorkItemForm()`
  (`owiAcceptorInput`/`owiAcceptorUsername`) — thêm chặn tương tự.
- **Mục 3b (server) — `acceptorUsername` chưa đối chiếu tài khoản thật**: `createOperationWorkItem()` /
  `editOperationWorkItem()` (`lib/recordActions.js`) trước đây chỉ `String(payload.acceptorUsername)`
  không kiểm tra có phải tài khoản active thật hay không (khác `resolveOperationPersonInChargeUsername()`
  ở `lib/createValidation.js` đã làm đúng chuẩn này cho `personInCharge`). Thêm hàm mới
  `resolveOperationAcceptorUsername(rawUsername, users)` cùng khuôn — đối chiếu `users` active, throw 400
  rõ ràng nếu gửi username không khớp tài khoản nào; rỗng vẫn hợp lệ (không bắt buộc, giữ hành vi cũ).
- **Mục 4 — bỏ dấu tiếng Việt khi tìm kiếm, áp dụng 2 điểm TRUNG TÂM**: `sddRenderRows()` và
  `renderDropdown()` (bên trong `renderPeopleMultiSelect()`) — trước đây so khớp
  `label.toLowerCase().includes(query)` không bỏ dấu, gõ không dấu ("nguyen") không ra kết quả có dấu
  ("Nguyễn"). Áp dụng `stripVnDiacritics()` (hàm bỏ dấu đã có sẵn từ trước, dùng chung với
  `deriveAbbr()`) cho CẢ query lẫn label trước khi so sánh. Sửa đúng 2 điểm trung tâm này tự động áp dụng
  cho TOÀN BỘ ~12 điểm dùng `sddSetOptions` + 6 điểm dùng `renderPeopleMultiSelect` trong hệ thống, không
  cần sửa từng nơi gọi riêng lẻ.
- **Mục 5 — Module "Giao Việc" (Task) đổi từ `<select>`/`<select multiple>` native sang chuẩn picker
  `sdd*`/`renderPeopleMultiSelect()`**: phạm vi CHỈ 2 ô chọn người (không đụng state machine/subtask/gia
  hạn/accept — mọi logic nghiệp vụ khác của Task giữ nguyên).
  - "Người Nhận" (1 người, chế độ CREATE/EDIT): `<select id="taskAssigneeInput">` → ô tìm-gõ-chọn `sdd*`
    (`#taskAssigneeSingleWrap`, dùng chung dropdown `#systemUsersDatalist`), hidden
    `#taskAssigneeUsername` lưu username thật — thêm chặn "phải chọn từ gợi ý" cùng khuôn Mục 1-3.
  - Chế độ ASSIGN (gán nhiều người nhận cùng lúc cho việc tự sinh từ Văn bản trình/Biên bản họp):
    `<select multiple>` → multi-select `renderPeopleMultiSelect()` riêng (`#taskAssigneeMultiWrap` +
    `#taskAssigneeMultiPicker`, checkbox ẩn class `task-assignee-multi`) — 2 khối UI (single/multi) tồn
    tại song song trong cùng modal, ẩn/hiện theo chế độ (`setTaskAssigneeMode()`).
  - "Người Phối Hợp" (multi, dùng chung cả 3 chế độ): `<select multiple id="taskCollaboratorsInput">` →
    `renderPeopleMultiSelect()` (`#taskCollaboratorsPicker`, checkbox ẩn class `task-collaborator`,
    `populateTaskCollaboratorsSelect()`).
  - Cập nhật `openCreateTaskModal()`/`openAssignTaskModal()`/`openEditTaskModal()`/`confirmCreateTask()`
    đọc/ghi đúng qua cơ chế mới; `tests/test-task.js` cập nhật helper `createManualTask()` dùng
    `setTaskAssigneeSingle()`/`pmsAdd()` thay thao tác trực tiếp lên `<select>` cũ.

**Verify integrity**: `node --check lib/recordActions.js` OK; parse thử 3 script block `public/index.html`
OK; scan trùng `id=` không phát sinh thêm (chỉ còn đúng baseline pre-existing đã biết); đếm div mở/đóng
khớp đúng baseline (không lệch thêm do đổi cấu trúc `<select>` → `renderPeopleMultiSelect()`).

**Xác nhận qua demo Playwright thật (server.js + SQL Server thật, tài khoản non-admin
`totpEnabled:false`)**: gõ tự do không chọn gợi ý ở cả 3 field (Người Phụ Trách x2, Người Nghiệm Thu) →
alert chặn đúng; chọn đúng từ dropdown → lưu thành công. Tạo 2 tài khoản demo tên gần giống ("Nguyễn Văn
Test1"/"Test2"), gõ KHÔNG DẤU ("nguyen van test") ở picker → ra đúng cả 2 kết quả CÓ DẤU (trước đây không
ra gì). Task module: tạo task mới qua ô sdd* + 1 người phối hợp qua multi-picker mới → lưu đúng; mở chế độ
ASSIGN xác nhận đúng multi-picker hiện/ẩn, chọn 2 người tick đúng 2 checkbox, submit phản hồi đúng nghiệp
vụ (task đã có người nhận, không phải lỗi picker); mở chế độ EDIT xác nhận prefill đúng người nhận hiện
tại qua ô sdd* single, sửa lưu thành công. Dọn sạch dữ liệu + tài khoản demo sau khi test xong.

**Regression**: 46/46 file `tests/test-*.js` PASS (bao gồm 2 file known-flaky
`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, xác nhận PASS qua log dù không tự thoát
tiến trình) + `tests/test-task.js` (11/11 scenario) đã cập nhật khớp cơ chế picker mới.

**Deploy-impact**: KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — chỉ sửa `public/index.html`, `lib/recordActions.js`, `tests/test-task.js`. Chỉ cần copy code +
`pm2 restart`.

## Trước đó — Vận Hành > Siêu Thị: Chi Phí Phê Duyệt, Danh Mục Đầu Tư, Thực Hiện linh hoạt, bỏ phê duyệt nội bộ

Đơn giản hoá + linh hoạt hoá luồng lập hồ sơ → lập ngân sách → thực hiện công việc của 2 loại hồ sơ
`operationStoreOpenings` ("Mở Mới Siêu Thị") / `operationRepairs` ("Sửa Chữa Siêu Thị") trong module Vận
Hành > 🏬 Siêu Thị. 8 mục (A→H):

- **A — Đổi label "Chi Phí Phê Duyệt"**: đổi tên hiển thị "Ngân Sách Dự Kiến"/"Dự Toán Chi Phí" →
  "Chi Phí Phê Duyệt" ở form tạo, form "Bổ Sung", hiển thị chi tiết hồ sơ, header cột bảng danh sách —
  CHỈ đổi label, giữ nguyên field kỹ thuật (`estimatedBudget`/`amount`).
- **B — Bỏ bắt buộc Kỳ Thực Hiện**: công việc GỐC giờ tạo được KHÔNG CẦN chọn Kỳ Thực Hiện
  (`periodId` optional — `lib/recordActions.js createOperationWorkItem()`); nếu CÓ chọn vẫn giữ nguyên
  luật cũ (kỳ phải "Đang thực hiện"). `public/index.html renderOwiPeriodField()` đổi option đầu thành
  "-- Không thuộc kỳ nào --", bỏ cảnh báo bắt buộc; nút "➕ Thêm Công Việc Gốc" hiện luôn khi có quyền,
  không còn phụ thuộc đã có kỳ đang chạy.
- **C — "Người Phụ Trách" (`personInCharge`): ô gõ tên tự do → ô chọn tài khoản hệ thống thật** (pattern
  `sdd*`): đổi Ý NGHĨA field có sẵn cho `operationStoreOpenings`, thêm MỚI HOÀN TOÀN cho `operationRepairs`
  (trước đây chưa từng có). Server: `resolveOperationPersonInChargeUsername()`
  (`lib/createValidation.js`) dùng ở cả tạo (`extraValidate`) lẫn sửa "Bổ Sung"
  (`editOperationStoreOpeningDraft`/`editOperationRepairDraft`, `lib/recordActions.js`) — lưu thêm
  `personInChargeName` (snapshot tên hiển thị). Tương thích ngược: hồ sơ cũ còn tên tự do, mọi nơi hiển
  thị ưu tiên `personInChargeName || personInCharge`.
- **D — "Nghiệm thu ngay" / "Nghiệm thu sau N ngày"** (`acceptanceMode`/`acceptanceDelayDays` trên
  `operationWorkItems`, mặc định IMMEDIATE): CHỈ hiển thị cột "Dự Kiến Nghiệm Thu" để NHẮC (badge cam nếu
  quá hạn), KHÔNG tự động chuyển trạng thái, KHÔNG cần cron job — `completedAt` server tự set lúc chuyển
  "Đang nghiệm thu", ngày dự kiến tính ở client (`computeOperationWorkItemExpectedAcceptanceDate()`).
- **E — Nhiều người phụ trách 1 công việc + quyền sửa theo "Người Phụ Trách" hồ sơ gốc**: `assignedTo`
  đổi `string|null` → `string[]|null` (multi-select `renderPeopleMultiSelect()`, khớp mảng song song
  `assignedToName`) — 2 bản `workItemAssignees()`/`isWorkItemAssignee()` (server `lib/recordActions.js`
  + client `public/index.html`, không shared lib giữa 2 phía) thay mọi so sánh trực tiếp cũ (quyền cập
  nhật tiến độ, `hasOwnWorkItemInSource()`, hiển thị danh sách, gate tab). Quyền SỬA công việc (không
  phải tạo/xoá) mở rộng cho đúng `personInCharge` của hồ sơ gốc qua `assertCanManageOperationWorkItem()`
  — route sửa (`POST /operationWorkItems/:id/edit`) load thêm `sourceRecord` để đối chiếu.
- **F — "Dự toán" → "Danh mục đầu tư"**: đơn giản hoá cột `estimateItems[]` từ
  `{name,unit,qty,unitPrice,amount,note}` (7 cột, tự tính Thành Tiền = SL×Đơn Giá) → `{content,description,
  amount,note}` (5 cột: STT/Nội Dung/Mô Tả/Chi Phí/Lưu Ý, Chi Phí nhập trực tiếp) — tương thích ngược
  `content: it.content ?? it.name ?? ''` khi load hồ sơ cũ. Thêm khối **"Chi Phí Còn Lại"** = Chi Phí Phê
  Duyệt − tổng Danh mục đầu tư, tính LIVE mỗi lần thêm/sửa/xoá dòng, số âm hiển thị đỏ — KHÔNG chặn submit
  khi vượt ngân sách, chỉ cảnh báo trực quan. Đồng bộ thuật ngữ "Dự toán" → "Danh mục đầu tư" toàn bộ UI
  trong phạm vi module Siêu Thị (không đụng module Ngân Sách/Budget, tên trùng ngẫu nhiên).
- **G — Tự động mở "Danh mục đầu tư" ngay sau khi lập hồ sơ**: `submitOperationStoreOpening()`/
  `submitOperationRepair()` tự chuyển sang tab "Danh mục đầu tư" + mở modal cho hồ sơ vừa tạo, không cần
  người dùng tự tìm lại.
- **H — Bỏ phê duyệt nội bộ cho module Siêu Thị** (bổ sung giữa chừng theo yêu cầu người dùng): hồ sơ
  Mở Mới/Sửa Chữa giờ `status: 'APPROVED'` NGAY lúc tạo (không qua `PENDING`/chờ ai duyệt —
  `lib/createValidation.js`), Danh mục đầu tư lưu là `estimateStatus: 'APPROVED'` NGAY (không qua workflow
  duyệt riêng — `submitOperationEstimate()`, `lib/recordActions.js`), nút "Gửi phê duyệt"/"Gửi Duyệt
  Danh Mục Đầu Tư" đổi thành "💾 Lưu Hồ Sơ"/"💾 Lưu Danh Mục Đầu Tư". Toàn bộ luồng lập hồ sơ → Danh mục
  đầu tư → Thực hiện → Nghiệm thu giờ 1 tài khoản duy nhất tự làm hết, không cần tài khoản thứ 2 "duyệt".
  KHÔNG đụng `operationOrders` ("📦 Phê Duyệt Đơn Hàng") — luồng phê duyệt RIÊNG, tách biệt hoàn toàn, vẫn
  giữ nguyên quy trình duyệt cũ.

**2 bug thật phát hiện qua demo Playwright chạy trên app thật (ngoài phạm vi 8 mục A-H, đã tự sửa vì nhỏ
và rõ ràng)**:
1. `dbo.OperationWorkItems.SourceId` tạo kiểu `INT` (tối đa ~2.1 tỷ) trong khi giá trị luôn là id kiểu
   `Date.now()` (mili-giây từ epoch, ~1.7 nghìn tỷ — vượt trần INT ngay lập tức) — khiến MỌI lần tạo công
   việc Thực hiện thật sự luôn lỗi 500 trên SQL Server thật (chỉ không lộ ra trước đây vì bộ test hiện có
   chạy qua mock backend không đi qua kiểu dữ liệu SQL thật). Sửa `sql/schema.sql` (`INT` → `BIGINT`,
   kèm khối `ALTER COLUMN` tự chạy an toàn nhiều lần cho DB đã tồn tại) + `lib/operationWorkItemStore.js`
   (`sql.Int` → `sql.BigInt` ở mọi chỗ bind `sourceId`).
2. Modal "Bổ Sung" (`#bosungEditModal`, dùng chung 7 module kể cả `operationStoreOpenings`/
   `operationRepairs`) chưa từng được `bindCspDelegation()` bọc — sau đợt CSP siết `scriptSrcAttr:
   'none'` (bản 6.3), nút "Hủy"/"📤 Lưu & Gửi Lại" của TOÀN BỘ modal này (mọi module dùng chung, không
   riêng Siêu Thị) đã âm thầm không phản hồi khi bấm; chỉ lộ ra khi thêm ô picker "Người Phụ Trách" mới
   (Mục C) dùng `data-op-change` trong modal chưa được bọc dispatcher. Đã thêm
   `bindCspDelegation('bosungEditModal')`.

**Xác nhận qua demo Playwright thật (server.js + SQL Server thật, tài khoản non-admin
`totpEnabled:false`)**: lập hồ sơ Mở Mới (chọn Người Phụ Trách qua picker) → tự động chuyển tab + mở
modal Danh mục đầu tư (Mục G); nhập item, xác nhận "Chi Phí Còn Lại" live (kể cả vượt ngân sách hiển thị
đỏ, không chặn submit) → Lưu (Mục H, tự APPROVED); tạo công việc GỐC không chọn Kỳ (Mục B); tạo công việc
2 người phụ trách (Mục E) + "Nghiệm thu sau 3 ngày" (Mục D), cập nhật tiến độ, xác nhận cột ngày dự kiến;
lập hồ sơ Sửa Chữa xác nhận field Người Phụ Trách MỚI (Mục C); đăng nhập bằng chính `personInCharge`
(không có quyền hệ thống) — sửa được đúng công việc thuộc hồ sơ của mình, không tạo/xoá được. Dọn sạch dữ
liệu + 2 tài khoản demo sau khi test xong.

**Regression**: 46/46 file `tests/test-*.js` PASS (1030 scenario, 0 FAIL — bao gồm 2 file known-flaky
`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, xác nhận PASS qua log dù không tự thoát
tiến trình).

**Deploy-impact:** `sql/schema.sql` CÓ đổi (chỉ 1 cột `SourceId` của `dbo.OperationWorkItems` từ `INT`
→ `BIGINT`, tự ALTER an toàn khi chạy lại — **bắt buộc chạy lại `schema.sql` khi deploy đợt này**, nếu
không mọi lần tạo công việc Thực hiện mới sẽ tiếp tục lỗi 500). KHÔNG thêm biến môi trường mới, KHÔNG
thêm `dependencies` mới — mọi field nghiệp vụ mới khác (`personInCharge`/`personInChargeName`,
`assignedTo[]`, `acceptanceMode`/`acceptanceDelayDays`/`completedAt`, `estimateItems[]` cấu trúc mới) đều
lưu trong payload JSON blob sẵn có, không cần đổi cột nào khác.

## Trước đó — 🎉 HOÀN TẤT DỰ ÁN CSP: gỡ 'unsafe-inline' khỏi scriptSrcAttr — CSP nghiêm ngặt đã có hiệu lực thật sự

Bước CUỐI CÙNG trong toàn bộ chuỗi ~24+ đợt chuyển đổi CSP (23 module nghiệp vụ + ~8 đợt hạ tầng dùng
chung: H+I/G/C/B/D/F/E/A — xem các mục "Trước đó" bên dưới). Tất cả các đợt trước chỉ CHUYỂN ĐỔI cách
gắn event handler (`onclick=`/`onchange=`/`oninput=`/`onsubmit=` → `data-op*` + `bindCspDelegation()`)
nhưng CSP header vẫn còn mở `'unsafe-inline'` cho `scriptSrcAttr` suốt thời gian đó — nghĩa là dù có sót
1 điểm `onclick=` nào chưa convert, trình duyệt vẫn ÂM THẦM CHO CHẠY, không lộ ra lỗi gì. Đợt này mới thực
sự là bài kiểm tra thật: siết `scriptSrcAttr` từ `["'unsafe-inline'"]` xuống `["'none'"]` trong
`lib/securityHeaders.js` — CHỈ 1 dòng đổi, không đụng `scriptSrc`/`styleSrc`/directive nào khác (2 directive
đó vẫn cần `'unsafe-inline'` vì lý do khác hẳn — toàn bộ logic JS nằm trong khối `<script>` inline của
`index.html`, và style dùng `style="..."` + Tailwind rộng khắp — ngoài phạm vi dự án CSP `onclick` này).

- **`lib/securityHeaders.js`**: `scriptSrcAttr: ["'unsafe-inline'"]` → `scriptSrcAttr: ["'none'"]`. Cập
  nhật lại đoạn comment đầu file mô tả đúng lý do/trạng thái mới (trước đây giải thích tại sao PHẢI mở, giờ
  giải thích tại sao ĐÃ CÓ THỂ siết lại).
- **Verify tĩnh trước khi đổi header**: grep lại toàn bộ `public/index.html` loại trừ dòng comment `//` —
  xác nhận **0 (KHÔNG)** `onclick=`/`onchange=`/`oninput=`/`onsubmit=` dạng attribute HTML sống còn sót (chỉ
  còn ~13 chuỗi khớp nằm trong comment lịch sử mô tả lại pattern cũ, không phải attribute thật).
- **Demo Playwright thật — CSP nghiêm ngặt có hiệu lực thật sự lần đầu tiên**: khởi động lại server thật
  (SQL Server + `node server.js`), xác nhận header response thật qua `curl -sI` (`script-src-attr 'none'`,
  không còn `unsafe-inline'` ở đó). Tạo 4 demo user non-admin mới (`totpEnabled:false`, quyền khác nhau: Giám
  Đốc/Trưởng Phòng/Nhân Viên Kinh Doanh/Kế Toán — KHÔNG dùng tài khoản admin+TOTP có sẵn) ghi trực tiếp vào
  `AppData.users`, test qua **19 module/luồng** bằng trình duyệt Chromium thật: Dashboard (+ modal Tuỳ
  chỉnh), Approval Hub, Tài Liệu, Văn Bản Trình, Truyền Thông (Nhịp Sống HCRC), Hợp Đồng (Phê Duyệt + Quản
  Lý), Điều Hành (Công Việc, Biên Bản Họp, Báo Cáo Định Kỳ), Hành Chính (Phòng Họp, Đăng Ký Xe, Văn Phòng
  Phẩm), Tổng Hợp (Mua Bán, Thanh Toán, Ngân Sách), Báo Cáo, `profileModal` (2 tài khoản khác nhau), luồng
  đăng nhập (4 tài khoản) — tổng 43 thao tác click thành công.
  - **Phát hiện quan trọng khi tự kiểm chứng cách bắt CSP violation**: `page.on('console')` của Playwright
    CHỈ bắt được `Runtime.consoleAPICalled` (do JS gọi `console.*()` trực tiếp) — CSP violation là
    `Log.entryAdded` nguồn `"security"` do CHÍNH TRÌNH DUYỆT phát ra, hoàn toàn KHÔNG đi qua Console API nên
    `page.on('console')` KHÔNG BAO GIỜ thấy được (tự xác nhận bằng 1 sanity check: chèn thẳng 1 nút có
    `onclick=` thô vào trang thật, bấm — handler bị chặn đúng như kỳ vọng, nhưng `page.on('console')` im
    lặng; chỉ khi mở phiên CDP riêng + `Log.enable` mới bắt được đúng message browser thật: `Refused to
    execute inline event handler because it violates the following Content Security Policy directive:
    "script-src-attr 'none'"...`). Nếu chỉ dùng `page.on('console')` như cách làm mặc định, demo sẽ báo
    "0 violation" SAI dù có sót lỗi thật — đã sửa lại toàn bộ demo dùng CDP `Log.entryAdded` (lọc theo
    `entry.source === 'security'`, không phụ thuộc khớp text) trước khi kết luận.
  - **Kết quả**: dùng đúng cơ chế CDP `Log.entryAdded` xác nhận **0 (KHÔNG) CSP violation nào** trong suốt
    43 thao tác qua 4 tài khoản — mọi entry `cdp-log` ghi nhận được đều nguồn `"network"` (Google Fonts bị
    chặn mạng ngoài, `/api/auth/me` 401 lúc chưa đăng nhập, `/api/captcha` 404 vì CAPTCHA chưa bật — cả 3
    đều KHÔNG liên quan CSP). 0 `pageerror` chưa bắt. Dọn sạch 4 demo user ngay sau khi test xong.
- **Full regression**: chạy lại toàn bộ 46 file `tests/test-*.js` (kể cả 2 file known-flaky
  `test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js` chạy riêng, xác nhận PASS qua log dù không tự
  thoát) — **46/46 file OK, 0 FAIL**.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — chỉ 2 file thay đổi: `lib/securityHeaders.js` (server, 1 dòng CSP header) + `public/index.html`
(client, chỉ đổi comment mô tả — không đổi hành vi runtime). **Đây LÀ 1 thay đổi HÀNH VI QUAN TRỌNG dù
không phải bước deploy đặc biệt**: sau khi deploy, nếu người dùng thấy BẤT KỲ nút bấm nào không phản ứng, đó
có thể là CSP đang chặn 1 điểm sót nào đó — cần mở Console trình duyệt (F12) kiểm tra dòng `Refused to
execute inline event handler ... script-src-attr` và báo lại NGAY để xử lý, thay vì coi là lỗi nghiệp vụ
thông thường.

**Còn lại:** RỖNG — **dự án CSP `unsafe-inline` remediation đã HOÀN TẤT 100%**: toàn bộ event handler inline
đã chuyển sang `data-op*`, và CSP header giờ THỰC SỰ chặn mọi `onclick=`/`onchange=`/`oninput=`/`onsubmit=`
attribute sống sót hay bị chèn sau này (XSS injection qua attribute không còn tự thực thi được).

## Trước đó — CSP hạ tầng dùng chung, đợt A (cuối cùng đợt convert): `buildActionCell()`/pagination/`buildDashboardCardsHTML()` — HOÀN TẤT TOÀN BỘ ĐỢT CONVERT `data-op*`

Đợt cuối cùng của toàn bộ dự án dọn `unsafe-inline`. Tiếp tục đợt E (`#officeSection`/`#officeProcessModal`/
`#signedUploadModal`, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển 7 hàm **hạ tầng lõi dùng chung**
(không phải 1 module nghiệp vụ riêng) được gọi từ ~18-20 module khác nhau trong toàn hệ thống:
`getListPageState()`/`goToListPage()`/`changeListPageSize()`/`paginateList()`/`buildPaginationBoxHTML()`/
`buildActionCell()`/`buildDashboardCardsHTML()` — rủi ro cao nhất toàn dự án vì sai sót ở đây có thể làm im
lặng nút "Thao Tác" ở gần như MỌI module.

- **8 điểm** `onclick`/`onchange` chuyển sang `data-op*` (đúng ước lượng ban đầu):
  - `buildDashboardCardsHTML()` (1 điểm): `onclick="${onClickFnName}('${c.key}')"` → `data-op="${onClickFnName}"
    data-arg0="${c.key}"` (tên hàm điều phối nội suy động, `c.key` luôn là chuỗi enum tĩnh — khớp đúng pattern
    đã dùng thành công ở đợt D/E).
  - `paginateList()` (5 điểm, trong khối "thanh phân trang" `«‹1 2 3›»`): 5 nút `onclick="goToListPage('${moduleKey}',
    N, '${renderFnName}')"` → `data-op="goToListPage" data-arg0="${moduleKey}" data-arg1="N" data-arg2="${renderFnName}"`
    (mọi tham số đều literal xác định lúc build chuỗi HTML).
  - `buildPaginationBoxHTML()` (1 điểm): `<select onchange="changeListPageSize('${moduleKey}', this.value, '${renderFnName}')">`
    → `data-op-change="changeListPageSize" data-arg0="${moduleKey}" data-arg-value="1" data-arg2="${renderFnName}"`
    (slot `data-arg-value` có sẵn thay `this.value`, không cần wrapper).
  - `buildActionCell()` (1 điểm — dropdown "Khác ▾"): `onchange="if(this.value){ dispatcherFn(id, this.value); }
    this.selectedIndex=0;"` — biểu thức `if` + 2 lệnh, KHÔNG phải 1 lời gọi hàm đơn nên **PHẢI viết 1 wrapper
    mới**: `handleActionCellDispatch(selectEl, dispatcherFnName, id)` (gọi `window[dispatcherFnName](id,
    selectEl.value)` nếu có chọn, rồi tự `selectEl.selectedIndex = 0`), bind qua `data-op-change="handleActionCellDispatch"
    data-arg-el="0" data-arg1="${dispatcherFnName}" data-arg2="${id}"` — `selectEl` ở vị trí tham số 0 đúng thứ tự
    khai báo hàm (cùng quy ước `data-arg-el` đã dùng ở `updateMinutesDirectiveFieldMultiSelect()`/`onVppHeadcountInput()`
    từ các đợt trước).
- **1 wrapper mới duy nhất**: `handleActionCellDispatch()` — không phát sinh điểm phức tạp nào khác ngoài đã
  liệt kê ở trên (rà lại toàn bộ 3 hàm `buildActionCell`/`paginateList`/`buildDashboardCardsHTML` xác nhận không
  còn `this.checked` hay biểu thức runtime nào khác).
- **Không thêm `bindCspDelegation` mới nào** — 7 hàm này chỉ SINH ra chuỗi HTML được `innerHTML` vào các gốc
  (`docSection`, `submissionSection`, `taskSection`, `contractSection`, `meetingSection`, `carSection`,
  `licenseSection`, `vppSection`... 18+ gốc) đã được `bindCspDelegation()` phủ tới từ các đợt 1-23/B-I trước đó
  — xác nhận bằng demo thực tế qua 8 module khác nhau bên dưới, tất cả nút/dropdown mới convert đều hoạt động
  đúng mà không cần gắn thêm listener nào.
- **Không đụng** cách các module GỌI `buildActionCell()`/`paginateList()`/`buildDashboardCardsHTML()` (chỉ sửa
  BÊN TRONG định nghĩa 7 hàm) — không đụng `#genericConfirmModal`/`#viewDocModal`/Dashboard/Approval Hub/
  `profileModal`/Office (đã xong ở các đợt trước).

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Integrity check tĩnh: script `<script>` chính `node --check` sạch; đếm `<div>` mở/đóng giữ nguyên
  `2653/2648`; rà `id=` trùng khớp đúng baseline đã biết trước đó (`bsDept`/`bsTitle`/`bsReason`/`bsType`/
  `bsFile`/`bsSupplier`/`bsNote`/`bsStoreName`/`bsAmount`/`systemUsersDatalist`/`Y`/`${base}` không lỗi;
  `${o.id}`/`${w.id}`/`${f.id}` bình thường, toàn bộ pre-existing từ các đợt trước) — **grep toàn file xác nhận
  0 (KHÔNG) `onclick=`/`onchange=`/`oninput=`/`onsubmit=` còn sót trong toàn bộ `public/index.html`** (13 chuỗi
  còn khớp grep đều nằm trong dòng comment `//` mô tả lịch sử, không phải attribute HTML sống) — **đây là mục
  tiêu cuối cùng của TOÀN BỘ dự án CSP, đã đạt 100%**.
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật, KHÔNG dùng tài khoản demo admin+TOTP) —
  dùng tài khoản đã seed sẵn `sep_duyet` (Ban Giám Đốc, **KHÔNG phải admin, `totpEnabled:false`**, đã có sẵn
  quyền duyệt phẳng rộng — `meetingApprove`/`contractApprove`/`paymentManage`/`officeBuy`/`officeFix` — cùng
  approver mặc định `deptWorkflows['Phòng IT']`/`submissionDeptWorkflows['Phòng IT']`/`carDeptWorkflows['Phòng
  IT']` đã seed từ `defaults.js`); cấp tạm thêm 7 quyền phẳng (`taskView`/`taskEdit`/`taskDelete`/`taskDownload`/
  `licenseCreate`/`licenseApprove`/`licenseView`) + 1 cấu hình `vppDeptWorkflows['Phòng IT']` (workflow 1 bước,
  approver `sep_duyet`) — cả 2 thay đổi là THUẦN CỘNG THÊM (không ghi đè field nào có sẵn), gỡ lại đúng các key
  đã thêm ngay sau khi test xong; dữ liệu demo (12 tài liệu + 12 giấy phép + 3 tờ trình + 3 đăng ký xe + 3 lịch
  họp + 2 công việc + 3 hợp đồng + 3 đăng ký VPP, tổng 41 bản ghi) ghi trực tiếp qua `lib/recordStore.js`/
  `lib/taskStore.js` (`insertRecord()`/`insertTask()`), KHÔNG qua API admin-only, KHÔNG đăng nhập bằng bất kỳ
  tài khoản admin nào — test đầy đủ qua UI thật (Playwright, Chromium headless) rồi dọn sạch 100% dữ liệu +
  cấu hình demo ngay sau khi xong (`deleteRecordById()`/`deleteTaskById()`, xoá file placeholder đã tải lên):
  - **8 module** demo qua: **Tài Liệu (Doc)**, **Giấy Phép (License)**, **Phòng Họp (Meeting)**, **Công Việc
    (Task)**, **Văn Bản Trình (Submission)**, **Hợp Đồng (Contract)**, **Đăng Ký Xe (Car)**, **Văn Phòng Phẩm —
    Đăng Ký (VPP Registration)**.
  - Mỗi module: xác nhận nút "Thao Tác" chính (primary) hoạt động đúng — Doc/License/Meeting/Task/Contract
    (dropdown) đều xác nhận network request THẬT gửi đúng tới server (`POST /api/workflow/docs/:id/approve`,
    `POST /api/records/licenses/:id/approve`, `POST /api/meetings/:id/approve`, `POST /api/records/tasks/:id/accept`,
    `POST /api/workflow/contracts/:id/approve`... đều 200), Submission/Car/VPP xác nhận primary mở đúng modal xử
    lý (`#submissionProcessModal`/`#carProcessModal`/`#vppRegModal`).
  - Dropdown "Khác ▾" test ở TỪNG module trên (License/Meeting/Contract/Doc/Task/Car): chọn 1 mục phụ (reject/
    Hủy/Duyệt/detail/viewSlip) → xác nhận thực thi đúng hàm điều phối module (qua `handleActionCellDispatch()`
    mới) → dropdown tự trả về `selectedIndex=0` NGAY sau khi dispatch (đúng hành vi cũ), kể cả khi hành động sau
    đó làm re-render lại cả dòng (Meeting Hủy/Contract Duyệt xoá luôn dropdown khỏi dòng do đổi trạng thái —
    xác nhận bằng chính việc dòng cũ biến mất đúng lúc, tương đương reset).
  - Pagination test ở **2 danh sách khác nhau** (Doc 12 bản ghi demo, License 12 bản ghi demo): `changeListPageSize`
    đổi đúng 5/10/20 dòng-mỗi-trang cập nhật lại số trang tổng; `goToListPage` chuyển đúng trang 2/3 và trang
    cuối, nút "›" tự `disabled` đúng khi chỉ còn 1 trang.
  - Dashboard card (`buildDashboardCardsHTML`, module Doc): bấm 1 thẻ ("Chờ Duyệt: Tài Liệu Mới") lọc đúng danh
    sách qua `data-op` mới, không phát sinh lỗi console.
  - **0 lỗi `CSP dispatch: không tìm thấy hàm`** trong console suốt toàn bộ demo (35/35 kiểm tra Playwright PASS
    sau khi sửa vài lỗi TÍNH SẴN trong kịch bản test — không phải lỗi sản phẩm — như modal xác nhận
    `#genericConfirmModal` cần bấm "Đồng Ý" mới bắn API, hay dữ liệu demo phân trang rơi sang trang 2 do sort
    mới-nhất-trước).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — xem chi tiết ở khối kết quả cuối báo cáo hội
  thoại (46/46 file OK, 0 FAIL, 2 file known-flaky quen thuộc chạy riêng xác nhận PASS qua log).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác. **Sau đợt này, TOÀN BỘ dự án chuyển đổi CSP đã HOÀN
TẤT 100%** — bước cuối cùng còn lại (gỡ `'unsafe-inline'` khỏi `lib/securityHeaders.js`) là 1 đợt RIÊNG, có
rủi ro production cao nhất, do người điều phối thực hiện sau, kèm 1 vòng full regression + demo toàn hệ thống
lần cuối trước khi bật CSP nghiêm ngặt thật sự.

**Còn lại:** RỖNG — đã hoàn tất 100% việc chuyển đổi `onclick`/`onchange`/`oninput`/`onsubmit` inline sang
`data-op*` trong toàn bộ `public/index.html`, sẵn sàng gỡ `'unsafe-inline'` khỏi CSP header
(`lib/securityHeaders.js`) ở 1 đợt riêng do người điều phối thực hiện.

## Trước đó — CSP module Office - đợt E: `#officeSection` + `#officeProcessModal` + `#signedUploadModal`

Tiếp tục đợt F (`#profileModal`, xem mục "Trước đó" ngay bên dưới) — đợt này **KHÔNG phải hạ tầng dùng
chung** mà là **1 module nghiệp vụ nguyên vẹn chưa từng convert** trong 23 đợt module trước: "Tổng Hợp"
(Đề Xuất Mua Bán/Sửa Chữa/Thanh Toán, còn gọi "Văn Phòng") — coi như module thứ 24, đúng khuôn các đợt
module 1-23. Cả 3 gốc **`#officeSection`**, **`#officeProcessModal`**, **`#signedUploadModal`** đều **CHƯA
TỪNG** được `bindCspDelegation()` phủ tới.

- **26 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*` (đúng ước lượng ban đầu):
  - **`#officeSection`** (18 điểm):
    - Tĩnh (10): 3 nút chuyển sub-tab `setOfficeSubTab('MUA_BAN'|'SUA_CHUA'|'PAYMENT')`; `<form id="officeForm"
      data-op-submit="submitOfficeReq">` (hàm tự gọi `e.preventDefault()` sẵn, không cần
      `data-op-prevent-default`); nút "➕ Thêm Hạng Mục" (`addOfficeItemRow`); 4 bộ lọc `onchange` (Phòng
      Ban/Trạng Thái/Từ Ngày/Đến Ngày) + 1 ô tìm kiếm `oninput`, tất cả gọi chung `onOfficeFilterChange()`.
    - Động (8), trong `renderOfficeItemsTable()` (bảng nhiều hạng mục theo Mẫu BM-TS01, chỉ dùng cho phân
      hệ Mua Sắm): 5 ô input mỗi dòng (Tên tài sản/Model/ĐVT/Số lượng/Đơn giá) đổi từ
      `oninput="updateOfficeItemField(${idx}, 'field', this.value)"` sang `data-op-input="updateOfficeItemField"
      data-arg0="${idx}" data-arg1="field" data-arg-value="2"` (tham số thứ 3 là `this.value` runtime nên
      dùng slot `data-arg-value`, không cần viết wrapper riêng vì slot đặc biệt đã sẵn có); nút "✕" xoá dòng
      (`removeOfficeItemRow(idx)`); cộng 2 điểm trong `renderOfficeReqs()` — nút chính "✍️ Xử lý/Duyệt" hoặc
      "👁️ Xem chi tiết" (2 nhánh cùng gọi `runOfficeAction(o.id, 'process')`, cùng khuôn `data-op`). Khối phụ
      "Khác ▾" (dropdown `<select>` trong ô Thao Tác) vẫn dùng `buildActionCell()`/`a.onclick` cũ nguyên vẹn —
      để dành đợt A cuối cùng, KHÔNG đụng.
  - **`#officeProcessModal`** (5 điểm): 2 nút đóng "✕"/"Đóng" cùng gọi `closeOfficeProcessModal()`; 3 nút
    hành động động trong `#officeModalActionBtns` (renderer trong `openOfficeProcessModal()`) gọi
    `confirmProcessOfficeReq('REJECT'|'REQUEST_CHANGES'|'APPROVE')`.
  - **`#signedUploadModal`** (2 điểm, dùng CHUNG cho Hợp đồng lẫn Mua Bán/Sửa Chữa/Đầu Tư qua
    `openSignedUploadModal(module, id)` — trigger mở modal đã có `data-op` từ nhánh `runOfficeAction` ở trên
    nên gốc này chỉ có đúng 2 điểm tĩnh): nút "Hủy" (`closeSignedUploadModal`), nút "Tải Lên"
    (`submitSignedUpload`).
- **Không viết wrapper mới nào** — điểm duy nhất có tham số runtime (`this.value` trong bảng hạng mục) đã
  giải quyết bằng slot `data-arg-value` có sẵn, không cần hàm `...FromInput()`/`...FromCheckbox()` riêng.
- **3 gốc `bindCspDelegation` MỚI**: `officeSection`, `officeProcessModal`, `signedUploadModal` (thêm ngay
  sau khối bind của đợt F, `bindCspDelegation('profileModal')`).
- **Không đụng** `buildActionCell()`/`paginateList()`/`buildPaginationBoxHTML()`/`buildDashboardCardsHTML()`
  (hạ tầng lõi dùng chung nhiều module — để dành đợt A cuối cùng, sau đợt này KHÔNG còn đợt module nào khác
  ngoài đợt A).

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Integrity check tĩnh: 2 script `<script>` bị sửa đều `node --check` sạch; đếm `<div>` mở/đóng giữ nguyên
  `2653/2648`; rà `id=` trùng khớp đúng baseline đã biết trước đó (`bsDept`/`bsTitle`/`bsReason`/`bsType`/
  `bsFile`/`bsSupplier`/`bsNote`/`bsStoreName`/`bsAmount`/`systemUsersDatalist`/`Y`/`${base}` không lỗi;
  `${o.id}`/`${w.id}`/`${f.id}` bình thường, toàn bộ pre-existing từ các đợt trước); grep xác nhận **0**
  `onclick=`/`onchange=`/`oninput=`/`onsubmit=` còn sót liên quan Office/`signedUploadModal` trong toàn file.
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật) — tạo 1 tài khoản demo tạm
  `csp_demo_office` (**KHÔNG phải admin, `totpEnabled:false`, `mustChangePassword:false`**, quyền
  `officeBuy`/`officeFix`/`officeCreate`/`officeView`/`paymentManage` phạm vi 1 phòng ban demo — vì
  `officeBuyDeptWorkflows`/`officeFixDeptWorkflows` lúc đó đang rỗng `{}` nên còn cấu hình tạm 1 dept-workflow
  1 bước gán chính tài khoản demo làm approver, ghi trực tiếp qua `appData.js`/`recordStore.js`, KHÔNG qua
  API admin-only, KHÔNG đăng nhập bằng bất kỳ tài khoản admin nào) — test đầy đủ qua UI thật, dọn sạch toàn
  bộ dữ liệu + cấu hình demo ngay sau khi xong:
  - Tạo đề xuất **Mua Bán** (bảng nhiều hạng mục Mẫu BM-TS01, xác nhận `updateOfficeItemField()` qua
    `data-op-input`/`data-arg-value` tính đúng Tổng Dự Toán realtime) và đề xuất **Sửa Chữa** (form 1 dòng
    Số Lượng/Dự Toán/Nhà Cung Cấp + 1 trường bổ sung bắt buộc riêng của phân hệ) — cả 2 gửi thành công qua
    `data-op-submit="submitOfficeReq"`.
  - Lọc theo Trạng Thái (`onchange` → `data-op-change`) và từ khoá (`oninput` → `data-op-input`) — đúng số
    dòng khớp mỗi lượt lọc.
  - Mở `#officeProcessModal` qua `runOfficeAction(id,'process')`, duyệt 1 hồ sơ Sửa Chữa qua nút
    "✅ Phê Duyệt & Chuyển Bước" (`confirmProcessOfficeReq('APPROVE')` → `showConfirmModal` → API
    `POST /api/workflow/officeReqs/:id/approve` → 200) — trạng thái chuyển đúng "✅ Đã phê duyệt", modal
    đóng qua `closeOfficeProcessModal()`.
  - Tải lên "Tài liệu ký" qua `#signedUploadModal` (`openSignedUploadModal('officeReqs', id)` từ dropdown
    "Khác ▾" → `data-op="submitSignedUpload"` → `POST /api/records/officeReqs/:id/upload-signed` → 200) —
    xác nhận nút "💰 Chuyển Sang Thanh Toán" (`startOfficePaymentAction`) chỉ xuất hiện ĐÚNG lúc sau khi có
    `signedFileUrl` (trước đó không có), bấm nút này chuyển trạng thái thanh toán "Chờ thanh toán"
    (`POST /api/records/officeReqs/:id/start-payment` → 200) và hồ sơ xuất hiện đúng ở sub-tab "💰 Thanh Toán".
  - Xem "👁️ Xem Phiếu" (`viewOfficeApprovalSlip`) — watermark "PHÊ DUYỆT TRÊN HỆ THỐNG / HCRC WORKSPACE"
    hiện đúng trong `#viewDocModal`; xem "👁️ Xem Tài Liệu Ký" (`viewOfficeSignedFile` → `openFileProtectedView`,
    dùng file PDF hợp lệ tối giản để PDF.js vẽ thật) — mở đúng Khung Xem Bảo Vệ với tiêu đề/nhãn phòng
    ban/người tạo đúng dữ liệu.
  - 0 lỗi JS console liên quan CSP dispatch (`CSP dispatch: không tìm thấy hàm`) trong toàn bộ demo; dọn demo
    xong: xoá 2 hồ sơ `officeReqs` + 2 `paymentRequests` phát sinh (`deleteRecordById()`, cả 2 collection đã
    SQL-backed trong `MIGRATED_COLLECTIONS`), xoá file vật lý đã tải lên (`uploads/...`), gỡ cấu hình
    dept-workflow demo (khôi phục lại `{}` như trước test), xoá tài khoản `csp_demo_office`.
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 46/46 file OK, 0 FAIL trong mọi kịch bản; đúng
  2 file known-flaky quen thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js` — hoàn tất
  toàn bộ kịch bản 14/14 và 20/20 nhưng tiến trình Node không tự thoát ngay) đều được chạy riêng với
  timeout 170-180s và xác nhận PASS qua log kết thúc đúng ngay dòng kết quả cuối.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

## Trước đó — CSP hạ tầng dùng chung, đợt F: `#profileModal` (Hồ Sơ Cá Nhân)

Tiếp tục đợt D (`#dashboardSection`/`#dashboardCustomizeModal`/`#approvalHubSection`, xem mục "Trước đó"
ngay bên dưới) — đợt này chuyển gốc **`#profileModal`** (modal "⚙️ Cá Nhân Hóa & Cập Nhật Thông Tin" — đổi
mật khẩu/mã PIN phê duyệt/vân tay-Face ID (WebAuthn)/xác thực 2 lớp (TOTP)/cài đặt PWA), gốc này **CHƯA
TỪNG** được `bindCspDelegation()` phủ tới dù nút mở modal ở `#userHeader` (`data-op="openProfileModal"`) đã
convert từ đợt trước đó.

- **17 điểm** `onclick`/`onsubmit` chuyển sang `data-op*` (ước lượng ban đầu ~18, rà thực tế grep lại ra
  17 — không có điểm nào dùng `this.checked`/biểu thức runtime phức tạp trong modal này nên không cần viết
  wrapper mới):
  - **Khung modal + chuyển tab** (6 điểm): nút "✕" đóng modal, 5 nút chuyển sub-tab
    (`setProfileSubTab('INFO'|'PASSWORD'|'PIN'|'WEBAUTHN'|'TOTP')`, tham số literal qua `data-arg0`).
  - **Tab Thông Tin** (2 điểm): `<form data-op-submit="savePersonalInfo">` (hàm tự gọi `e.preventDefault()`
    sẵn nên không cần `data-op-prevent-default`) + nút "Hủy" (`closeProfileModal`).
  - **Tab Đổi Mật Khẩu** (2 điểm): `<form data-op-submit="changeMyPassword">` (cũng tự
    `preventDefault()` sẵn) + nút "Hủy" (`closeProfileModal`).
  - **Tab Mã PIN** (1 điểm): nút "🔑 Cập Nhật Mã PIN" (`changeMyApprovalPin`).
  - **Tab Vân Tay/Face ID (WebAuthn)** (2 điểm): nút "➕ Đăng Ký Thiết Bị Này" (`registerBiometricDevice`,
    tĩnh) cộng **1 sink động** trong `renderWebauthnDeviceList()` (`#pfWebauthnListWrap`) — nút "🗑️ Gỡ" mỗi
    thiết bị đổi từ `onclick="deleteBiometricDevice('${c.id}')"` sang `data-op="deleteBiometricDevice"
    data-arg0="${c.id}"`, cùng khuôn `deleteAdminBiometricDevice()` ở màn Sửa Người Dùng đã convert từ đợt
    trước (không phải điểm mới trong đợt này, chỉ đối chiếu để xác nhận đúng khuôn).
  - **Tab Xác Thực 2 Lớp (TOTP)** (3 điểm): "Chép" khoá thủ công (`copyPfTotpRevealKey`, chỉ clipboard,
    không gọi API), "Hiện Mã QR" cho máy Authenticator thứ 2 (`revealTotpSecretForNewDevice`, xác nhận bằng
    mật khẩu — KHÔNG liên quan luồng verify OTP), "🗑️ Gỡ Xác Thực 2 Lớp" (`removeMyTotp`, xác nhận bằng mật
    khẩu — cũng KHÔNG verify OTP).
  - **Khối Cài Đặt Ứng Dụng (PWA)** (1 điểm): nút "⬇️ Cài Đặt Ngay" (`triggerPwaInstall`).
- **1 gốc `bindCspDelegation` MỚI**: `profileModal` (thêm ngay sau khối bind của đợt D,
  `bindCspDelegation('approvalHubSection')`).
- **Không đụng** Office module (`buildActionCell()` dùng chung, để dành đợt E) hay
  `buildActionCell()`/`paginateList()`/`buildDashboardCardsHTML()` (để dành đợt A cuối cùng).

**Lưu ý bảo mật khi convert**: modal này liên quan trực tiếp tới bảo mật tài khoản (đổi mật khẩu/PIN/vân
tay/TOTP) — chỉ đổi attribute HTML sang `data-op`, **không sửa bất kỳ dòng logic nghiệp vụ/validate/luồng
xác thực nào** bên trong các hàm JS đang được gọi (`changeMyPassword`/`changeMyApprovalPin`/
`registerBiometricDevice`/`deleteBiometricDevice`/`revealTotpSecretForNewDevice`/`removeMyTotp`... giữ
nguyên 100% thân hàm).

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Integrity check tĩnh: script `<script>` chính `node --check` sạch; đếm `<div>` mở/đóng giữ nguyên
  `2653/2648`; rà `id=` trùng khớp đúng baseline đã biết trước đó (`bsDept`/`bsTitle`/`bsReason`/`bsType`/
  `bsFile`/`bsSupplier`/`bsNote`/`bsStoreName`/`bsAmount`/`systemUsersDatalist`/`Y`/`${base}` không lỗi;
  `${o.id}`/`${w.id}`/`${f.id}` bình thường, toàn bộ pre-existing từ các đợt trước); grep xác nhận 0
  `onclick=`/`onsubmit=` còn sót trong toàn bộ `#profileModal` (dòng ~7676-7830) và tại sink động
  `renderWebauthnDeviceList()`.
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật) — tạo 1 tài khoản demo tạm
  `demo_profilef` (**KHÔNG phải admin, `totpEnabled:false`** — tránh đúng bug 401 TOTP thật chưa fix, xem
  cảnh báo dưới đây), `perms.approverAuthLevel:'PIN'` để tab Mã PIN hiện tự nhiên; dùng CDP virtual
  WebAuthn authenticator (`WebAuthn.addVirtualAuthenticator`, đặt tạm `WEBAUTHN_RP_ID=localhost` trong
  `.env` local — chỉ cấu hình máy demo, không commit, revert lại ngay sau demo) để test THẬT cả luồng đăng
  ký + xoá thiết bị vân tay, không chỉ giả lập lỗi môi trường:
  - Mở modal qua `data-op="openProfileModal"`, chuyển đủ cả 4 sub-tab (PIN/WEBAUTHN/TOTP force-hiện qua
    console để kiểm tra wiring/PWA luôn hiển thị sẵn dưới đáy modal).
  - Lưu thông tin cá nhân thật (`PATCH /api/auth/me` → 200), đổi mật khẩu thật (`PATCH /api/auth/me` → 200,
    xác nhận qua alert "Đổi mật khẩu thành công" + modal tự đóng đúng như code gốc), đặt mã PIN thật
    (`POST /api/auth/change-pin` → 200).
  - Đăng ký thiết bị vân tay THẬT qua virtual authenticator (`POST .../register-options` → 200,
    `POST .../register-verify` → 200), xác nhận `#pfWebauthnListWrap` hiện đúng thiết bị vừa đăng ký, bấm
    nút "🗑️ Gỡ" động (`data-op="deleteBiometricDevice" data-arg0` mới convert) → `DELETE
    .../credentials/:id` → 200, danh sách về lại rỗng.
  - **Tab TOTP: tuyệt đối không đụng bug 401 đã biết** — vì `#pfTotpSection` chỉ hiện thật cho admin đã có
    `totpEnabled:true` (tức là đã "setup xong"), test đợt này CHỦ ĐỘNG force-hiện tab qua console (không đi
    qua luồng thiết lập/đăng nhập TOTP thật) trên chính tài khoản demo không-admin, rồi bấm "Hiện Mã QR"
    (nhận đúng lỗi nghiệp vụ "Tài khoản chưa thiết lập xác thực 2 lớp" — xác nhận wiring `data-op` gọi đúng
    hàm/đúng API, không phải lỗi CSP) và "Chép" (clipboard đọc lại đúng giá trị vừa chép) — **không hoàn tất
    verify OTP thật, không đăng nhập lại bằng tài khoản admin+TOTP nào**.
  - 0 lỗi JS console liên quan CSP dispatch (`CSP dispatch: không tìm thấy hàm`) trong toàn bộ demo; dọn demo
    xong: xoá tài khoản `demo_profilef`, revert `.env` về đúng bản gốc.
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 46/46 file OK, 0 FAIL trong mọi kịch bản; đúng
  2 file known-flaky quen thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js` — hoàn tất
  toàn bộ kịch bản 14/14 và 20/20 nhưng tiến trình Node không tự thoát ngay) đều được chạy riêng với
  timeout 180s và xác nhận PASS qua log kết thúc đúng ngay dòng kết quả cuối.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác. (Biến `WEBAUTHN_RP_ID` chỉ đặt tạm trên máy demo để
test, không phải thay đổi cần deploy — môi trường thật đặt biến này theo domain thật riêng khi cần bật tính
năng vân tay, không liên quan đợt này.)

**Còn lại:** ước tính còn khoảng **37-38 điểm**, chia thành các đợt riêng sẽ làm sau, rủi ro tăng dần theo
thứ tự dự kiến:
- **E** — Office module (`buildActionCell()`/dropdown "Khác ▾" dùng chung nhiều module, ~26 điểm).
- **A** — rủi ro cao nhất, để dành sau cùng — `buildActionCell()`/`paginateList()`+
  `buildPaginationBoxHTML()`/`buildDashboardCardsHTML()` (hạ tầng lõi dùng ở gần như mọi module).

Chỉ khi hết sạch toàn bộ mới gỡ `'unsafe-inline'` khỏi CSP header (`lib/securityHeaders.js`).

## Trước đó — CSP hạ tầng dùng chung, đợt D: Dashboard + Approval Hub, tái cấu trúc `action.onclick` → `action.fn`/`action.args`

Tiếp tục đợt B (`#genericConfirmModal`, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển 3 gốc **CHƯA
TỪNG** được `bindCspDelegation()` phủ tới: **`#dashboardSection`**, **`#dashboardCustomizeModal`**,
**`#approvalHubSection`** (hộp thư duyệt tổng hợp gộp hồ sơ chờ duyệt từ gần như MỌI module nghiệp vụ có
quy trình phê duyệt). **Đây là đợt tái cấu trúc, không chỉ convert cơ học** — sink quan trọng nhất của
Approval Hub (`onclick="${a.onclick}"`, mỗi `a.onclick` là 1 chuỗi JS tự do build sẵn) phải đổi cấu trúc dữ
liệu nguồn trước khi convert được sang `data-op`/`data-argN`.

- **10 điểm** `onclick`/`onchange`/`oninput` chuyển sang `data-op*`:
  - **`#dashboardSection`** (3 điểm): nút "⚙️ Tuỳ chỉnh" (`openDashboardCustomizeModal`, literal); thẻ
    dashboard động trong `#dashboardStatsGrid` (`renderDashboard()` → `handleDashboardCardClick('${c.key}')`,
    `data-arg0` nội suy literal lúc build); thẻ tin tức động trong `#dashboardNewsContainer`
    (`renderDashboardNews()` → 3 lời gọi nối tiếp `switchTab('internal')|setInternalSubTab('${p.type}')|
    viewInternalPostDetail(${p.id})`, mọi tham số literal nên dùng `data-op-seq` thay vì viết wrapper riêng).
  - **`#dashboardCustomizeModal`** (2 điểm): nút "Đóng" tĩnh (`closeDashboardCustomizeModal`, literal);
    checkbox động trong `#dashboardCustomizeList` (`openDashboardCustomizeModal()` →
    `onDashboardCustomizeToggle(key, this.checked)` — tham số thứ 2 là `this.checked` runtime, KHÔNG truyền
    thẳng qua `data-argN` được, dùng `data-arg-el` nhận cả phần tử checkbox + 1 wrapper mới đọc `.checked`).
  - **`#approvalHubSection`** (5 điểm): 3 dropdown lọc + 1 ô tìm kiếm (`approvalHubFilterStatus`/
    `approvalHubFilterRange`/`approvalHubFilterType` → `data-op-change="renderApprovalHub"`,
    `approvalHubSearch` → `data-op-input="renderApprovalHub"`) cộng **1 sink render generic**: nút
    Duyệt/Từ chối/Xem trong `#approvalHubTableBody` — xem mục tái cấu trúc bên dưới.
- **1 hàm wrapper mới**: `onDashboardCustomizeToggleFromCheckbox(key, checkboxEl)` (đọc `checkboxEl.checked`
  rồi gọi lại `onDashboardCustomizeToggle(key, checked)` gốc — cùng khuôn các wrapper `...FromCheckbox()`
  khác đã có sẵn trong hệ thống, vd `updateBudgetTemplateFieldRequiredFromCheckbox()`).
- **3 gốc `bindCspDelegation` MỚI**: `dashboardSection`, `dashboardCustomizeModal`, `approvalHubSection`
  (thêm ngay sau khối bind của đợt B) — cả 3 gốc này trước đó CHƯA TỪNG được bind ở bất kỳ đợt nào trước
  đây, dù cả 3 đã tồn tại từ lâu và Approval Hub đặc biệt gộp dữ liệu từ ~9 module khác nhau.

**TÁI CẤU TRÚC — `action.onclick` (chuỗi JS tự do) → `action.fn` + `action.args` (có cấu trúc) ở 33 nơi
định nghĩa action** (ước lượng ban đầu ~29, rà `grep -c 'onclick:'` thực tế ra 33): rải khắp
`getMyPendingApprovals()`/`getMyProcessedApprovals()` — Tài liệu/Văn bản trình/Đăng ký xe/Mua Bán/Sửa Chữa/
VPP/Giá IT/Ngân Sách/Hợp đồng x2 luồng (Phê Duyệt + Tài liệu ký)/Phòng họp/Góc chia sẻ/Bình luận bị gắn
cờ/Giấy phép/Thanh toán/Từ chối khẩn Giá IT/Vận Hành x5 (Đơn hàng/Mở mới/Sửa chữa/Dự toán Mở mới/Dự toán
Sửa chữa). Xác nhận trước khi sửa: **mọi tham số ở cả 33 nơi đều là id/enum literal đã có giá trị cụ thể
lúc build** (không có `this.value`/`this.checked`/biểu thức runtime phức tạp) — script Python tự viết
(regex `onclick: \`fn(args)\`` → tách từng arg theo dấu phẩy ở độ sâu ngoặc 0, gỡ `${...}` cho arg là biến,
giữ nguyên arg là chuỗi literal) convert cơ học toàn bộ 33 nơi sang `fn: 'tenHam', args: [...]`, có **1 lỗi
duy nhất do script gây ra và đã tự phát hiện + sửa tay ngay**: `gotoApprovalHubOrigin('${cfg.type}')` (biến
`cfg.type` lồng trong dấu nháy đơn bên trong template literal) bị script hiểu nhầm literal `args:
['${cfg.type}']` thay vì `args: [cfg.type]` — sửa lại đúng thành biến trước khi verify. Sink render tại
`renderApprovalHub()` đổi từ `onclick="${a.onclick}"` sang generic `data-op="${escapeHtml(a.fn)}"` + vòng lặp
build `data-arg${i}` theo đúng độ dài mảng `a.args` (không hard-code số lượng tham số, khớp mọi action có
0-2 tham số tuỳ loại). **KHÔNG đụng** `buildActionCell()`/`paginateList()`/`buildDashboardCardsHTML()` (hạ
tầng dùng chung để dành đợt A cuối cùng) hay Office module/`#profileModal` (đợt E/F riêng).

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Integrity check tĩnh: 3 script `<script>` đều `node --check` sạch; đếm `<div>` mở/đóng giữ nguyên
  `2653/2648`; rà `id=` trùng khớp đúng baseline đã biết trước đó (`bsDept`/`bsTitle`/`bsReason`/`bsType`/
  `bsFile`/`bsSupplier`/`bsNote`/`bsStoreName`/`bsAmount`/`systemUsersDatalist`/`Y`/`${base}` không lỗi;
  `${o.id}`/`${w.id}`/`${f.id}` bình thường, toàn bộ pre-existing từ các đợt trước); grep xác nhận **0 field
  `onclick:` còn sót** trong khối định nghĩa action (12247-12690) và **0 sink `onclick="${a.onclick}"`** còn
  sót trong toàn file.
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật) — tạo 1 tài khoản demo tạm
  `demo_cspd` (`totpEnabled:false`, `mustChangePassword:false`, không phải admin, chỉ cấp đúng quyền cần
  test — `meetingApprove`/`licenseApprove`/`approverAuthLevel:'NONE'`) + 1 phòng ban demo tạm với quy trình
  1 bước riêng (không đụng cấu hình phòng ban thật đang dùng), 5 hồ sơ PENDING qua `insertRecord()`
  (`lib/recordStore.js`) trải **5 module khác nhau** — Tài liệu, Đăng ký xe, Văn bản trình, Giấy phép, Phòng
  họp — xoá lại toàn bộ ngay sau demo:
  - **Dashboard**: click 2 loại thẻ khác nhau ("Công việc cần xử lý" luôn hiện + "Tài liệu chờ duyệt" hiện
    vì có hồ sơ demo) qua `data-op="handleDashboardCardClick"` — điều hướng đúng sang tab tương ứng cả 2
    lần; mở modal tuỳ biến (`data-op="openDashboardCustomizeModal"`), un-tick 1 checkbox — xác nhận
    `onDashboardCustomizeToggleFromCheckbox()` đọc đúng `this.checked` qua `data-arg-el` (state đổi đúng,
    tick lại + đóng modal qua `data-op="closeDashboardCustomizeModal"` khôi phục nguyên trạng).
  - **Approval Hub** qua **5 module**: **Giấy phép** (DIRECT-fire `runLicenseAction` qua `genericConfirmModal`
    đã bind sẵn từ đợt B → `POST /api/records/licenses/:id/approve` status 200); **Phòng họp** (DIRECT-fire
    `approveMeeting`, KHÔNG qua modal xác nhận nào → `POST /api/meetings/:id/approve` status 200); **Văn bản
    trình** (MODAL-launcher `openProcessSubmissionModal` → mở đúng `#submissionProcessModal`, gốc đã bind từ
    đợt module Văn Bản Trình trước đây); **Đăng ký xe** (MODAL-launcher `openCarProcessModal` → mở đúng
    `#carProcessModal`, gốc đã bind từ đợt module Xe); **Tài liệu** (DIRECT-fire `runDocAction` qua
    `withApprovalAuth()` mức `NONE` → `POST /api/workflow/docs/:id/approve` status 200) — cộng xác nhận bộ
    lọc Loại (`data-op-change`) và ô tìm kiếm (`data-op-input`) đều lọc đúng danh sách theo dữ liệu thật.
  - 19/19 kiểm tra demo PASS, 0 lỗi JS console trong toàn bộ demo.
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 46/46 file OK, 0 FAIL trong mọi kịch bản
  (bao gồm cập nhật `tests/test-approval-hub.js` để khớp assertion mới: đọc `data-op`/`data-arg0`/
  `data-arg1` thay vì `onclick` cũ trên nút hàng Tài liệu); đúng 2 file known-flaky quen thuộc
  (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js` — hoàn tất toàn bộ kịch bản (14/14 và 20/20)
  nhưng tiến trình Node không tự thoát ngay, hạ tầng test có sẵn từ trước, không liên quan thay đổi lần này)
  đều được xác nhận pass qua log kết thúc đúng ngay dòng kết quả cuối.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML) + `tests/test-approval-hub.js`
(chỉ test), deploy an toàn chỉ với copy code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** ước tính còn khoảng **54-55 điểm** (giảm từ ~64-65 sau đợt này), chia thành các đợt riêng sẽ
làm sau, rủi ro tăng dần theo thứ tự dự kiến:
- **F** — `#profileModal` (~18 điểm).
- **E** — Office module (`buildActionCell()`/dropdown "Khác ▾" dùng chung nhiều module, ~26 điểm).
- **A** — rủi ro cao nhất, để dành sau cùng — `buildActionCell()`/`paginateList()`+
  `buildPaginationBoxHTML()`/`buildDashboardCardsHTML()` (hạ tầng lõi dùng ở gần như mọi module).

Chỉ khi hết sạch toàn bộ mới gỡ `'unsafe-inline'` khỏi CSP header (`lib/securityHeaders.js`).

## Trước đó — CSP hạ tầng dùng chung, đợt B: `#genericConfirmModal` + fix bug thiếu `bindCspDelegation`

Tiếp tục đợt C (`#viewDocModal`, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển **`#genericConfirmModal`**,
modal xác nhận Đồng Ý/Hủy DÙNG CHUNG cho **~53 lời gọi `showConfirmModal()`** trải khắp gần hết hệ thống
(Văn Bản Trình, Hợp Đồng, Văn Phòng, Ngân Sách, Giá IT, Giấy Phép, VPP, Đào Tạo, Đồng Phục, Biên Bản Họp,
Nhân Sự...). **Đây KHÔNG chỉ là CSP hardening thuần — đợt này còn phát hiện và fix 1 lỗ hổng bind CÓ THẬT
(xem mục riêng bên dưới), dù may mắn chưa từng ảnh hưởng tới bất kỳ luồng nào đã lên production.**

- **9 điểm** `onclick`/`onchange` chuyển sang `data-op*`:
  - **Định nghĩa tĩnh modal** (3 điểm): nút "✕" và nút "Hủy" ở chân modal (cả 2 gọi `closeGenericConfirmModal`),
    nút `#genericConfirmOkBtn` (`runConfirmedAction`).
  - **Luồng Trợ Lý/Thư Ký xử lý tờ trình** (6 điểm, DUY NHẤT trong ~53 lời gọi `showConfirmModal()` còn tự
    soạn `bodyHTML` có control tương tác bên trong — xem khảo sát bên dưới): `openTroLyThuKyBoSungChoice()`
    (2 nút lựa chọn "Đồng Ý — Thay Thế Toàn Bộ Tờ Trình" / "Hủy — Gửi Bình Luận Bổ Sung", cả 2 đều
    `onclick="closeGenericConfirmModal(); <hàm khác>(...)"` — chuyển `data-op-seq` vì mọi tham số đều thành
    literal sau khi template string render), `openTroLyThuKyProposeFileForm()` (nút "Gửi Đề Xuất Cho Người
    Trình" → `confirmTroLyThuKyProposeFile`), `openResolveFileProposalModal()` (nút "Xem" tệp đề xuất →
    `viewFileProposalAttachment`; 2 nút "Tôi Đồng Ý"/"Tôi Không Đồng Ý" → `confirmResolveFileProposal(id, true/
    false)` — tham số boolean thứ 2 KHÔNG truyền thẳng qua `data-argN` được (chuỗi `"false"` vẫn truthy trong
    JS, xem `cspCoerceArg()`), tách 2 hàm wrapper `confirmResolveFileProposalAgree(id)`/
    `confirmResolveFileProposalDisagree(id)` cùng khuôn `untogglePrAggEntry()` đã dùng ở đợt Báo Cáo Định Kỳ).
- **2 hàm wrapper mới**: `confirmResolveFileProposalAgree(subId)`, `confirmResolveFileProposalDisagree(subId)`
  (lý do ở trên).
- **1 gốc `bindCspDelegation` MỚI**: `genericConfirmModal` (thêm ngay sau khối bind của đợt C).

**FIX BUG THẬT — `#genericConfirmModal` CHƯA TỪNG có `bindCspDelegation()`**: rà exhaustive TOÀN BỘ ~53 lời
gọi `showConfirmModal()` còn lại trong hệ thống (kể cả `bodyHTML` có template literal LỒNG NHAU, dùng script
Python tự viết để tách đúng ranh giới backtick lồng thay vì regex đơn giản dễ cắt nhầm) — xác nhận: **KHÔNG
module nào khác (Submission/Contract/Office/Budget/IT Price/License/VPP/Training/Uniform/Meeting/HR ở các đợt
module 1-23 trước đây) từng đặt `data-op`/`onclick`/`onchange` bên trong `bodyHTML` tự soạn của riêng mình** —
mọi luồng khác chỉ dùng `bodyHTML` thuần văn bản (không control tương tác nào) + 2 nút Đồng Ý/Hủy MẶC ĐỊNH của
modal, hành động thật nằm trong callback JS `onConfirm` (không phải attribute HTML nên không cần `data-op`,
không bị ảnh hưởng bởi thiếu bind). **Kết luận: lỗ hổng bind là CÓ THẬT (root chưa từng được
`bindCspDelegation()` phủ tới suốt nhiều đợt module trước), nhưng KHÔNG có nạn nhân thực tế nào trên
production** — nạn nhân DUY NHẤT tồn tại là chính 6 điểm `data-op`/`data-op-seq` vừa convert ở luồng Trợ
Lý/Thư Ký TRONG đợt này. Xác minh bằng demo Playwright TRƯỚC/SAU thật (không chỉ suy luận từ code):
tạm comment `bindCspDelegation('genericConfirmModal')`, chạy lại đúng luồng Trợ Lý/Thư Ký — bấm nút "Đồng Ý —
Thay Thế Toàn Bộ Tờ Trình" **không phản ứng gì** (modal đứng yên ở màn chọn cũ, tiêu đề không đổi); khôi phục
dòng bind, chạy lại — bấm đúng nút đó **chuyển đúng sang form đề xuất tệp thay thế** (tiêu đề đổi thành "📤
Thay Thế Toàn Bộ Tờ Trình"). Bằng chứng rõ ràng lỗi tồn tại thật và đã được fix đúng bằng 1 dòng bind.

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Integrity check tĩnh: 3 script `<script>` đều `node --check` sạch; đếm `<div>` mở/đóng giữ nguyên
  `2653/2648`; rà `id=` trùng khớp đúng baseline đã biết trước đó (`systemUsersDatalist`, `bsTitle`, `bsDept`,
  `bsFile`, `bsType`, `bsReason`, `bsAmount`, `bsSupplier`, `bsNote`, `bsStoreName`, `Y`,
  `${base}`/`${o.id}`/`${w.id}`/`${f.id}` — toàn bộ pre-existing từ các đợt trước, không phải lỗi mới do đợt
  này gây ra).
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật) qua **3 luồng đại diện khác nhau**,
  dùng `withLockedAppDataValue('users', ...)` + `insertRecord()` (`lib/recordStore.js` — `submissions`/
  `licenses` đã migrate sang `dbo.Records`, không còn ở AppData) tạo 3 tài khoản demo tạm không-admin
  (`demoCspBReq`, `demoCspBTroLy`, `demoCspBApp`, đều `totpEnabled:false`) + 1 tờ trình snapshot sẵn ở đúng
  bước lớp Trợ Lý/Thư Ký + 1 giấy phép APPROVED — xoá lại toàn bộ ngay sau demo:
  - **Luồng đã dùng `data-op` sẵn trong `bodyHTML` (bug fix)**: luồng Trợ Lý/Thư Ký đầy đủ — Bổ Sung → chọn
    Thay Thế Toàn Bộ → tải tệp thay thế thật + ghi chú → Gửi Đề Xuất (nút `data-op="confirmTroLyThuKyProposeFile"`)
    → alert thành công → đăng nhập lại bằng người trình → mở "📄 Xác Nhận Thay Thế" → nút "👁️ Xem" (`data-op=
    "viewFileProposalAttachment"`) mở đúng `#viewDocModal` → nhập lý do → "Tôi Đồng Ý" (`data-op=
    "confirmResolveFileProposalAgree"`, wrapper mới) → alert thành công, hồ sơ quay lại PENDING bước 1 đúng
    quy trình `RESOLVE_FILE_PROPOSAL`.
  - **Luồng `bodyHTML` PLAIN (không control tương tác — không bị ảnh hưởng bởi thiếu bind, chỉ xác nhận vẫn
    chạy đúng sau khi thêm bind)**: Giấy Phép "🔄 Đánh Dấu Đang Gia Hạn" — mở modal xác nhận văn bản thuần;
    bấm "✕" (định nghĩa tĩnh, `data-op="closeGenericConfirmModal"`) → đóng, KHÔNG đổi trạng thái; mở lại, bấm
    "Đồng Ý" (`#genericConfirmOkBtn`, `data-op="runConfirmedAction"`) → trạng thái đổi đúng thành "🔵 Đang gia
    hạn".
  - 0 lỗi JS console ngoài các lỗi mạng nền không liên quan (proxy egress chặn Google Fonts/reCAPTCHA khi
    chạy headless, không phải lỗi ứng dụng) trong toàn bộ demo trên.
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 46/46 file OK, 0 FAIL trong mọi kịch bản; đúng
  2 file known-flaky quen thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js` — hoàn tất toàn
  bộ kịch bản (14/14 và 20/20) nhưng tiến trình Node không tự thoát ngay, hạ tầng test có sẵn từ trước, không
  liên quan thay đổi lần này) đều được xác nhận pass qua log kết thúc đúng ngay dòng kết quả cuối.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** ước tính còn khoảng **64-65 điểm** (giảm từ ~74 sau đợt này), chia thành các đợt riêng sẽ làm
sau, rủi ro tăng dần theo thứ tự dự kiến:
- **D** — Dashboard/"Approval Hub" (`buildDashboardCardsHTML()`/`#approvalHubSection`).
- **F** — `#profileModal` (~18 điểm).
- **E** — Office module (`buildActionCell()`/dropdown "Khác ▾" dùng chung nhiều module, ~26 điểm).
- **A** — rủi ro cao nhất, để dành sau cùng — `buildActionCell()`/`paginateList()`+
  `buildPaginationBoxHTML()`/dashboard-card (hạ tầng lõi dùng ở gần như mọi module).

Chỉ khi hết sạch toàn bộ mới gỡ `'unsafe-inline'` khỏi CSP header (`lib/securityHeaders.js`).

## Trước đó — CSP hạ tầng dùng chung, đợt C: `#viewDocModal` dùng chung

Tiếp tục đợt G (login wall/must-change-password/TOTP setup wall, xem mục "Trước đó" ngay bên dưới) — đợt
này chuyển **`#viewDocModal`**, khung xem tệp/quy trình "an toàn" (Frame Protected Viewer) dùng CHUNG cho
RẤT NHIỀU module khác nhau trong toàn hệ thống, không riêng module nào:

- **4 điểm** `onclick` chuyển sang `data-op*`, cả 4 đều nằm NGAY TRONG định nghĩa tĩnh của modal (không
  đụng tới nội dung `#viewModalContent` do JS dựng động, và không đụng nút mở modal ở từng module — những
  nút đó thuộc phạm vi module gốc, phần lớn đã convert ở các đợt module trước): nút "✕" đóng modal
  (`closeViewDocModal`), nút "🖨️ In" (`printViewModalContent`), nút "🖨️ In có watermark"
  (`printWordWithWatermark`), nút "Đóng" ở chân modal (`closeViewDocModal`, điểm thứ 2 gọi cùng hàm).
- **Không cần hàm wrapper mới nào** — cả 4 hàm xử lý đều không nhận tham số (gọi thẳng không có `data-argN`).
- **1 gốc `bindCspDelegation` MỚI**: `viewDocModal` (thêm ngay sau khối bind của đợt G) — gốc này trước đó
  CHƯA có `bindCspDelegation` nào phủ tới dù modal đã tồn tại từ lâu và được hàng chục hàm module khác mở ra.
- **Khảo sát phạm vi ảnh hưởng** (không sửa code ở các điểm này, chỉ xác nhận modal vẫn hoạt động đúng khi
  mở từ nhiều nguồn khác nhau): modal được mở qua `document.getElementById('viewDocModal').classList.remove
  ('hidden')` từ ít nhất 11 hàm khác nhau — `openFileProtectedView()` (hàm dùng chung xem tệp đính kèm
  THẬT, gọi từ `viewDoc()` [Tài Liệu], `viewLicenseFile()` [Giấy Phép], `viewSubmissionAttachment()`/
  `viewFileProposalAttachment()`/`viewSubmissionExtraFile()` [Văn Bản Trình], `viewContractSignedFile()`
  [Hợp Đồng], `viewOfficeSignedFile()` [Tổng Hợp], `viewOperationAttachment()` [Vận Hành, dùng chung nhiều
  "kind"], `viewPrCurrentSlideFile()` [Báo Cáo Định Kỳ]) và các hàm tự dựng HTML "phiếu hệ thống" rồi mở
  thẳng modal — `previewSubmissionWorkflow()`/`previewContractApprovalWorkflow()` (xem trước quy trình phê
  duyệt ngay trên form tạo, chưa cần hồ sơ đã lưu), `viewSubmissionApprovalSlip()`/`viewCarApprovalSlip()`/
  `viewOfficeApprovalSlip()` (Phiếu Phê Duyệt tự dựng), `viewContractDetails()`, `viewMeetingMinutesDetails()`
  (Biên Bản Họp).
- **Không phát hiện lỗi nghiệp vụ thật nào trong lúc demo các điểm này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Integrity check tĩnh trước khi demo: 3/4 script `<script>` (không kể script `type="module"` PDF.js vốn
  luôn báo lỗi cú pháp giả khi `node --check` một mình vì cú pháp `import` — không liên quan CSP) đều `node
  --check` sạch; đếm `<div>` mở/đóng giữ nguyên `2653/2648` (chỉ sửa thuộc tính, không thêm/bớt thẻ); rà
  `id=` trùng khớp đúng baseline đã biết trước đó (`systemUsersDatalist`, `bsTitle`, `bsDept`, `bsFile`,
  `bsType`, `bsReason`, `bsAmount`, `bsSupplier`, `bsNote`, `bsStoreName`, `Y`, `${base}`/`${o.id}`/`${w.id}`/
  `${f.id}` — toàn bộ pre-existing từ các đợt trước, không phải lỗi mới do đợt này gây ra).
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật) qua **4 module đại diện có luồng mở
  `#viewDocModal` khác hẳn nhau**: tạo 1 tài khoản demo tạm `demo_csp_c` (`totpEnabled:false`,
  `mustChangePassword:false`, không phải admin, chỉ cấp đúng quyền cần test — `uploadAll`/`viewDraftAll`/
  `viewApprovedAll`/`docDownload.all` [Tài Liệu], `submissionView`/`submissionCreate`/`submissionDownload.all`
  [Văn Bản Trình], `contractView`/`contractCreate`/`contractDownload.all` [Hợp Đồng], `licenseCreate`/
  `licenseView` [Giấy Phép] — qua `withLockedAppDataValue('users', ...)`) — xoá lại ngay sau demo cùng toàn
  bộ dữ liệu demo:
  - **Văn Bản Trình** (`previewSubmissionWorkflow()` — dựng HTML "phiếu" từ ngay trạng thái FORM, không cần
    hồ sơ đã lưu): chọn Phòng Ban Trình + Loại Tờ Trình trên form tạo, bấm "🔍 Xem Quy Trình" — modal hiện
    đúng danh sách bước duyệt; bấm "🖨️ In" (`printViewModalContent`, nút này KHÔNG bị ẩn ở luồng "phiếu tự
    dựng" — chỉ luồng xem tệp thật qua `openFileProtectedView()` mới ẩn) — chạy không lỗi JS; đóng qua nút
    "✕" (`closeViewDocModal`) — đóng đúng.
  - **Hợp Đồng** (`previewContractApprovalWorkflow()`, cùng khuôn "phiếu tự dựng"): chọn Phòng Ban Quản Lý
    trên form tạo, bấm "🔍 Xem Quy Trình" — modal hiện đúng; bấm "🖨️ In" — chạy không lỗi JS; đóng qua nút
    "Đóng" ở chân modal (điểm `closeViewDocModal` thứ 2, khác nút X đã test ở trên) — đóng đúng.
  - **Tài Liệu** (`viewDoc()` → `openFileProtectedView()`, luồng xem TỆP PDF thật qua PDF.js): tải lên 1 tệp
    PDF thật, hồ sơ vào trạng thái chờ duyệt nên bảng chỉ hiện nút "📋 Chi tiết" (`runDocAction(id,'view')` →
    `viewDocDetails()` → `#docDetailModal`, đã bind từ đợt trước) — bấm vào, trong bảng lịch sử phiên bản bấm
    "👁️ Xem" (`viewDoc`, điểm dùng chung đã convert từ đợt module Tài Liệu) — `#viewDocModal` mở đúng, PDF
    render thật qua PDF.js hiện đúng nội dung; xác nhận nút "🖨️ In" VÀ "🖨️ In có watermark" đều bị ẩn đúng
    (theo code: PDF luôn ẩn cả 2 nút In); đóng qua nút "✕" (`closeViewDocModal`) — đóng đúng, không chặn thao
    tác phía sau (`#docDetailModal` vẫn tương tác được bình thường).
  - **Giấy Phép** (`viewLicenseFile()` → `openFileProtectedView()`, luồng xem TỆP .docx thật qua mammoth.js):
    tải lên 1 tệp .docx thật, hồ sơ chờ duyệt nên vào qua "📋 Chi tiết" (`runLicenseAction(id,'view')` →
    `viewLicenseDetails()` → `#licenseDetailModal`) → "👁️ Xem" (`viewLicenseFile`) — modal mở đúng, nội dung
    .docx render thật qua mammoth.js hiện đúng; nút "🖨️ In có watermark" hiện đúng (chỉ .docx mới hiện, khớp
    code `kind==='word'`) — bấm thử (`printWordWithWatermark`) — chạy không lỗi JS; đóng qua nút "Đóng" ở
    chân modal — đóng đúng, không chặn thao tác phía sau.
  - 0 lỗi JS console (`page.on('pageerror')`) trong toàn bộ 4 luồng demo trên.
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 46/46 file OK, 0 FAIL trong mọi kịch bản; đúng
  2 file known-flaky quen thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js` — hoàn tất
  toàn bộ kịch bản (14/14 và 20/20) nhưng tiến trình Node không tự thoát ngay khi chạy dồn, kể cả chạy riêng
  lẻ với timeout 180s — hạ tầng test có sẵn từ trước, không liên quan thay đổi lần này) đều được xác nhận
  pass qua log kết thúc đúng ngay dòng kết quả cuối.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** ước tính còn khoảng **74 điểm** (giảm từ ~78 sau đợt này), chia thành các đợt riêng sẽ làm
sau, rủi ro tăng dần theo thứ tự dự kiến:
- **B** — `#genericConfirmModal` (modal xác nhận dùng chung nhiều module).
- **D** — Dashboard/"Approval Hub" (`buildDashboardCardsHTML()`/`#approvalHubSection`).
- **F** — `#profileModal` (~18 điểm).
- **E** — Office module (`buildActionCell()`/dropdown "Khác ▾" dùng chung nhiều module, ~26 điểm).
- **A** — rủi ro cao nhất, để dành sau cùng — `buildActionCell()`/`paginateList()`+
  `buildPaginationBoxHTML()`/dashboard-card (hạ tầng lõi dùng ở gần như mọi module).

Chỉ khi hết sạch toàn bộ mới gỡ `'unsafe-inline'` khỏi CSP header (`lib/securityHeaders.js`).

## Trước đó — CSP hạ tầng dùng chung, đợt G: login wall + must-change-password + TOTP setup wall

Tiếp tục đợt H+I (sidebar/approvalAuthModal/bosungEditModal, xem mục "Trước đó" ngay bên dưới) — đợt này
chuyển **trang đăng nhập + 2 modal "tường chặn" bắt buộc trước khi vào hệ thống**, độc lập hoàn toàn với
mọi module nghiệp vụ khác:

- **12 điểm** `onclick`/`onchange`/`onsubmit` chuyển sang `data-op*`:
  - **`#loginSection`** (5 điểm): form đăng nhập chính (`onsubmit` → `login`, dùng
    `data-op-prevent-default="1"` vì `login()` không tự nhận `event`/không tự gọi `e.preventDefault()`
    — khác các form khác đã convert trước đó luôn tự `e.preventDefault()` trong hàm xử lý), nút "Đăng nhập
    tên khác" (`switchLoginUser`), nút quay lại bước mật khẩu từ bước TOTP (`cancelTotpLoginStep`), nút
    "↻" lấy CAPTCHA khác (`refreshCaptcha`), nút đăng nhập vân tay/Face ID (`loginWithBiometric`).
  - **`#mustChangePasswordModal`** (2 điểm): `onsubmit` (`submitMustChangePassword`), nút "Đăng Xuất"
    (`logout`).
  - **`#totpSetupWallModal`** (5 điểm): nút "Chép" mã thiết lập thủ công (`copyTotpManualKey`), `onsubmit`
    bước xác nhận mã 6 số (`submitTotpSetupVerify`), nút "Đăng Xuất" (`logout`, dòng riêng — khác vị trí với
    dòng ở `#mustChangePasswordModal`), checkbox xác nhận đã lưu mã khôi phục (wrapper mới — xem dưới), nút
    "Tiếp Tục Vào Hệ Thống" (`completeTotpSetupWall`).
- **1 hàm wrapper mới** do runtime `data-op*` chưa hỗ trợ trực tiếp:
  - `setTotpBackupConfirmState(checkboxEl)` — checkbox "Tôi đã lưu lại các mã khôi phục" gọi thẳng
    `onchange="document.getElementById('totpSetupContinueBtn').disabled = !this.checked"`, là phép GÁN DOM
    trực tiếp chứ không phải 1 lời gọi hàm đơn; cũng không map thẳng qua `data-arg-value` được vì checkbox
    cần `.checked` chứ không phải `.value` (slot `data-arg-value` đọc `el.value`, luôn là `"on"`/giá trị
    thuộc tính `value` bất kể tick hay không). Dùng `data-arg-el="0"` để nhận thẳng phần tử checkbox, wrapper
    tự đọc `.checked` rồi gán `disabled` cho `#totpSetupContinueBtn`.
- **3 gốc `bindCspDelegation` MỚI**: `loginSection`, `mustChangePasswordModal`, `totpSetupWallModal` (thêm
  ngay sau khối bind của đợt H+I, cạnh các lời gọi hiện có) — cả 3 gốc trước đó CHƯA có `bindCspDelegation`
  nào phủ tới.
- **Không phát hiện lỗi nghiệp vụ thật nào trong lúc demo các điểm này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Integrity check tĩnh trước khi demo: 4 script `<script>` đều `node --check` sạch; đếm `<div>` mở/đóng giữ
  nguyên `2653/2648` (chỉ sửa thuộc tính, không thêm/bớt thẻ); rà `id=` trùng khớp đúng baseline đã biết
  trước đó (`systemUsersDatalist`, `bsTitle`, `bsDept`, `bsFile`, `bsType`, `bsReason`, `bsAmount`,
  `bsSupplier`, `bsNote`, `bsStoreName`, `Y`, `${base}`/`${o.id}`/`${w.id}`/`${f.id}` — toàn bộ pre-existing
  từ các đợt trước, không phải lỗi mới do đợt này gây ra).
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật) — vì đây LÀ luồng đăng nhập, dùng
  ĐÚNG luồng thật thay vì unhide DOM: tạo 3 tài khoản demo tạm (`demo_cspg_normal`,
  `demo_cspg_mustchange`, `demo_cspg_totpwall`) qua `withLockedAppDataValue('users', ...)`, xoá lại ngay sau
  demo cùng cách (xác nhận lại tổng số user về đúng 505 như trước demo). **Cố tình KHÔNG dùng tài khoản demo
  admin+TOTP thật đã setup xong sẵn có trong DB** (tránh đúng bug 401 admin+TOTP thật đã ghi nhận ở lúc
  đăng nhập lại sau khi hoàn tất thiết lập — bug này KHÔNG thuộc phạm vi đợt CSP):
  - `demo_cspg_normal` (`totpEnabled:false`, `mustChangePassword:false`, không phải admin): đăng nhập qua
    UI thật (gõ tài khoản/mật khẩu, bấm nút Đăng nhập qua `data-op-submit="login"`) — vào thẳng
    `#dashboardSection`, `#loginSection` ẩn đúng.
  - `demo_cspg_mustchange` (`mustChangePassword:true`): đăng nhập — `#mustChangePasswordModal` hiện đúng;
    đổi mật khẩu qua UI thật (`data-op-submit="submitMustChangePassword"`) — modal ẩn lại, vào thẳng
    `#dashboardSection` ngay sau đó (không cần đăng nhập lại lần 2).
  - `demo_cspg_totpwall` (`perms.admin:true`, `totpEnabled:false`, không có `webauthnCredentials` — đúng
    điều kiện `perms.admin && !totpEnabled` suy ra ở `openTotpSetupWall()`/client, xem `proceedAfterAuth()`):
    đăng nhập — `#totpSetupWallModal` hiện đúng ở bước QR; bấm nút "Chép" (`data-op="copyTotpManualKey"`) —
    chạy không lỗi. **Theo đúng yêu cầu, KHÔNG hoàn tất full TOTP setup + đăng nhập lại** (tránh dính bug 401
    đã biết) — thay vào đó chuyển thẳng sang bước "đã lưu mã khôi phục" bằng JS (chỉ để lộ đúng khối DOM sẵn
    có trong modal, không giả lập kết quả server) rồi thao tác CLICK/CHECK THẬT (Playwright) trên checkbox
    xác nhận: tick → nút "Tiếp Tục Vào Hệ Thống" (`#totpSetupContinueBtn`) chuyển từ `disabled` sang bấm
    được đúng qua `data-op-change="setTotpBackupConfirmState"` + `data-arg-el="0"`; bỏ tick lại → nút
    `disabled` lại đúng — xác nhận wrapper hoạt động đúng cả 2 chiều, đây là điểm JS phức tạp nhất của đợt.
  - Không lỗi JS console mới liên quan tới thay đổi (chỉ lỗi mạng nền quen thuộc trước lúc đăng nhập: font
    CDN ngoài bị chặn bởi sandbox mạng, `/api/auth/me` 401 lúc kiểm tra phiên đăng nhập cũ, `/api/captcha`
    404 do CAPTCHA tắt — không liên quan tới đợt này, đã xác nhận lại danh sách URL lỗi giống hệt nhau ở
    trang trắng chưa đăng nhập).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 46/46 file OK, 0 FAIL trong mọi kịch bản; đúng
  2 file known-flaky quen thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js` — hoàn tất
  toàn bộ kịch bản (14/14 và 20/20) nhưng tiến trình Node không tự thoát ngay khi chạy dồn, kể cả chạy riêng
  lẻ với timeout 120-180s — hạ tầng test có sẵn từ trước, không liên quan thay đổi lần này) đều được xác
  nhận pass qua log kết thúc đúng ngay dòng kết quả cuối.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** ước tính còn khoảng **78 điểm** (giảm từ ~90 sau đợt này), chia thành các đợt riêng sẽ làm
sau, rủi ro tăng dần theo thứ tự dự kiến:
- **C** — Office module (`buildActionCell()`/dropdown "Khác ▾" dùng chung nhiều module, ~26 điểm).
- **B** — `#profileModal` (~18 điểm).
- **D** — `#viewDocModal` (modal xem file bảo vệ dùng chung nhiều module).
- **F** — `#genericConfirmModal` (modal xác nhận dùng chung nhiều module).
- **E** — Dashboard/"Approval Hub" (`buildDashboardCardsHTML()`/`#approvalHubSection`).
- **A** — rủi ro cao nhất, để dành sau cùng — `buildActionCell()`/`paginateList()`+
  `buildPaginationBoxHTML()`/dashboard-card (hạ tầng lõi dùng ở gần như mọi module).

Chỉ khi hết sạch toàn bộ mới gỡ `'unsafe-inline'` khỏi CSP header (`lib/securityHeaders.js`).

## Trước đó — CSP hạ tầng dùng chung, đợt H+I: sidebar/approvalAuthModal/bosungEditModal + dọn các điểm sót trong module đã convert

Sau khi 23/23 module nghiệp vụ đã convert xong (đợt trước, xem mục "Trước đó" ngay bên dưới), đây là đợt
đầu tiên trong loạt "dọn hạ tầng dùng chung" — phần cuối cùng còn lại trước khi gỡ hẳn `'unsafe-inline'`
khỏi CSP header (`lib/securityHeaders.js`). Gộp 2 đợt rủi ro thấp nhất (H+I) theo phân loại của 1 lượt
research quét toàn bộ điểm `onclick`/`onchange`/`oninput`/`onsubmit` còn sót:

- **23 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`:
  - **Sidebar hamburger mobile** (2 điểm, độc lập không thuộc module nào): nút ☰ ở `#mobileTopBar`
    (`toggleMobileSidebar`) và lớp nền mờ `#sidebarBackdrop` (`closeMobileSidebar`) — cả 2 sống NGOÀI
    `#userHeader` (chính là `<aside>` sidebar, không phải wrapper toàn app) nên chưa có gốc
    `bindCspDelegation` nào phủ tới, phải thêm 2 gốc mới.
  - **`#approvalAuthModal`** (4 điểm — modal xác thực mật khẩu/OTP/PIN trước khi Duyệt, dùng chung cho 7
    module qua `withApprovalAuth()`): đóng modal (nút X và nút "Huỷ", cùng `closeApprovalAuthModal`), gửi
    lại mã OTP (`sendApprovalOtp(true)` — literal `true` giữ nguyên qua `data-arg0="true"`, đúng tiền lệ
    đã dùng ở `setAllPermTreeNodes` đợt trước, không cần wrapper), xác nhận (`confirmApprovalAuth`).
  - **`#bosungEditModal`** (3 điểm — modal "Sửa & Gửi Lại" dùng chung cho Tài Liệu/Đăng Ký Xe/Mua Bán-Sửa
    Chữa-Đầu Tư/Văn Bản Trình khi hồ sơ bị trả về NHÁP): đóng modal (nút X và nút "Hủy", cùng
    `closeBosungEditModal`), lưu & gửi lại (`confirmBosungResubmit`).
  - **Các điểm lẻ sót lại trong module ĐÃ convert xong** (root cha đã có `bindCspDelegation` từ đợt trước
    — chỉ sửa đúng hàm, không cần bind mới): `renderDeptContactsTable()` trong `systemSection` (4 điểm —
    sửa tên/email người phụ trách theo phòng ban `updateDeptContactField`, xoá/thêm dòng
    `removeDeptContact`/`addDeptContact`); `renderVppDeptHeadcountTable()` trong `vppSection` (1 điểm —
    `onVppHeadcountInput(this)` nhận thẳng phần tử input qua `data-arg-el`, KHÔNG cần wrapper vì slot này
    vốn sinh ra đúng để thay `this` nguyên vẹn); `renderWfSubmissionTypeTabs()`/`addStepRow()` trong
    `systemSection` (2 điểm — đổi tab loại tờ trình `switchWfSubmissionType`, xoá dòng bước quy trình cần
    1 wrapper mới — xem dưới); `buildModuleTabNotesHTML()` trong `systemSection` (1 điểm —
    `jumpToPermField`); `renderTestBuilderQuestions()` trong `internalTrainingLmsSection` (module Đào Tạo,
    1 điểm — đổi loại câu hỏi `tbUpdateQuestionField`); `renderCareerPaths()` cũng trong
    `internalTrainingLmsSection` (1 điểm — tra cứu nhân viên theo username `renderCpEmployeeStageLookup`).
  - **Widget dùng chung nhỏ** (4 điểm, root đích đều đã bind từ trước): `renderCrossTabBar()` (thanh tab
    chéo module, dùng ở Điều Hành/Hành Chính — `switchTab`), `renderPeopleMultiSelect()` (ô chọn nhiều
    người dùng chung cho Nhóm Phê Duyệt Trình/HĐ và Nhóm Phân Quyền — `pmsAdd`/`pmsRemove` + `pmsFilter`
    qua `data-op-input`; riêng `onfocus="pmsFilter(...)"` trên cùng ô KHÔNG đụng tới — nằm ngoài 4 loại
    thuộc tính (`onclick`/`onchange`/`oninput`/`onsubmit`) mà đợt quét 109 điểm ban đầu bao quát, để dành
    xử lý riêng khi tới lượt).
- **1 hàm wrapper mới** do runtime `data-op*` chưa hỗ trợ trực tiếp:
  - `removeStepRow(btn)` — nút "✕ Xóa" 1 dòng bước quy trình gọi thẳng 2 lệnh liên tiếp trên `this`
    (`this.parentElement.remove(); reindexStepRows();`), không map được vào 1 lời gọi hàm đơn cho
    `data-op`; wrapper nhận thẳng nút qua `data-arg-el` rồi tự làm cả 2 việc.
- **4 gốc `bindCspDelegation` MỚI**: `mobileTopBar`, `sidebarBackdrop`, `approvalAuthModal`,
  `bosungEditModal` (thêm ngay sau khối bind của đợt 23, cạnh các lời gọi hiện có). Các điểm còn lại trong
  nhóm "lẻ sót lại"/"widget dùng chung" đều rơi vào root đã bind sẵn (`systemSection`, `vppSection`,
  `internalTrainingLmsSection`, `meetingSection`/`carSection`/`vppSection`/`uniformSection`,
  `submissionSection`/`contractSection`) nên không cần bind thêm.
- **Không phát hiện lỗi nghiệp vụ thật nào trong lúc demo các điểm này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Integrity check tĩnh trước khi demo: 4 script `<script>` đều `node --check` sạch; đếm `<div>` mở/đóng
  giữ nguyên `2653/2648` (chỉ sửa thuộc tính, không thêm/bớt thẻ); rà `id=` trùng khớp đúng baseline đã
  biết trước đó (`systemUsersDatalist`, `bsTitle`, `bsDept`, `bsFile`, `bsType`, `bsReason`, `bsAmount`,
  `bsSupplier`, `bsNote`, `bsStoreName`, `Y` — toàn bộ pre-existing từ các đợt trước, không phải lỗi mới do
  đợt này gây ra).
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật), chia thành 5 script nhỏ theo
  nhóm chức năng — dùng đúng 1 tài khoản demo tạm `demo_csp_hi01`, **không phải** tài khoản `admin` có
  sẵn (tránh hẳn bug 401 admin+TOTP thật đã ghi nhận, dù DB dev hiện `totpEnabled=false` cho `admin`),
  `totpEnabled:false`, chỉ cấp quyền nghiệp vụ cần test (`submissionCreate`/`submissionView`/`vppManage`/
  `trainingManage`/`nhanSuManage`/`moduleAccess` theo module test tới) — **1 ngoại lệ có ghi chú rõ**: vì
  `#systemSection` tự nó gate cứng theo `currentUser.perms.admin === true` ngay ở `switchTab()` (không có
  cờ quyền riêng lẻ nào thay được), 5/23 điểm (`renderDeptContactsTable`/`renderPeopleMultiSelect` ở
  `groupMembersPicker`/`renderWfSubmissionTypeTabs`+`addStepRow`/`buildModuleTabNotesHTML`) được xác minh
  bằng cách unhide đúng khối `systemSection`/`workflowSection`/từng `adminSubXxx` liên quan qua JS (KHÔNG
  gán `perms.admin` cho tài khoản demo — chỉ hiện lại đúng khối DOM client, mọi API nghiệp vụ các hàm này
  gọi vẫn chịu đúng permission check phía server như cũ) rồi thao tác CLICK THẬT (Playwright) trên phần
  tử vừa hiện — vẫn là click thật, DOM thật, `bindCspDelegation` thật, chỉ khác đường VÀO màn hình:
  - Sidebar: đăng nhập viewport hẹp (mobile) — bấm ☰ mở sidebar (`toggleMobileSidebar`, xác nhận class
    `.mobile-sidebar-open`), bấm ra lớp nền mờ đóng lại (`closeMobileSidebar`).
  - Điều Hành > Hành Chính (VPP): mở Kỳ Đăng Ký, sửa tay 1 dòng "Số Nhân Sự" — xác nhận đúng ô "Ngân Sách
    Phòng Ban" của dòng đó cập nhật (10.100.000đ → 7.000.000đ), không render lại cả bảng.
  - `renderCrossTabBar()` ở nhóm Hành Chính — bấm sang tab "Phòng họp" từ VPP, xác nhận `#meetingSection`
    hiện đúng.
  - Đào Tạo > Ngân Hàng Câu Hỏi — thêm 1 câu hỏi, đổi loại (1 đáp án/nhiều đáp án) qua `<select>` vừa
    chuyển — xác nhận `tbQuestions[0].type` đổi đúng. Đào Tạo > Lộ Trình Thăng Tiến — gõ username vào ô
    tra cứu quản lý — xác nhận `renderCpEmployeeStageLookup` chạy đúng.
  - `systemSection` (unhide qua JS, xem ghi chú trên): thêm/sửa/xoá người phụ trách theo phòng ban; ô
    chọn nhiều người `groupMembersPicker` (Nhóm Phân Quyền, 500+ candidate thật) — lọc/thêm/xoá 1 người
    qua chip; đổi tab loại tờ trình trong cấu hình Quy Trình Văn Bản Trình; thêm/xoá dòng bước quy trình —
    xác nhận `removeStepRow` xoá đúng dòng + đánh lại số thứ tự "Bước 1:"; bấm "Đi tới →" ở 1 khối quyền
    có tab con — xác nhận mở đúng `<details>` + thêm class `.perm-tree-jump-highlight`.
  - Văn Bản Trình (đăng nhập THẬT, không unhide): tạo 1 tờ trình, tick lớp "Xin ý kiến" trong dropdown
    "Phê duyệt" (đã seed tạm `submissionApprovalGroups.XIN_Y_KIEN=[demo_csp_hi01]` để có candidate thật
    cho `renderPeopleMultiSelect()` — xoá lại ngay sau demo) — xác nhận widget hiện đúng, lọc/thêm/xoá chip
    hoạt động ngay TRONG form tạo thật (không chỉ ở `groupMembersPicker`), rồi bỏ tick lại trước khi gửi;
    trình 2 tờ trình test — tờ #1: gán tạm `demo_csp_hi01` làm 1 trong 2 đồng phê duyệt bước 1 phòng "Phòng
    IT" (`WF_1STEP`, giữ nguyên `sep_duyet` — xoá lại ngay sau demo) + set `approverAuthLevel:'PASSWORD'`
    cho tài khoản demo, bấm "✍️ Bút phê / Duyệt" → "✅ Phê Duyệt" → `withApprovalAuth()` mở đúng
    `#approvalAuthModal` với khối mật khẩu hiện đúng — nhập lại mật khẩu, bấm "✅ Xác Nhận & Duyệt"
    (`confirmApprovalAuth`) — server xác thực đúng mật khẩu + ghi nhận phê duyệt vào `history` (chờ đồng
    phê duyệt còn lại của `sep_duyet` do cố tình gán 2 người cho bước test này); tờ #2: người duyệt yêu cầu
    bổ sung (`processSubmission('REQUEST_CHANGES')`) → hồ sơ về NHÁP → mở `openBosungEditModal('submissions',
    id)` → sửa nội dung → "📤 Lưu & Gửi Lại" (`confirmBosungResubmit`) → quay lại hàng chờ duyệt bước 1
    thành công; đóng `#bosungEditModal` bằng nút X riêng biệt — đóng đúng. Kiểm thêm nhánh OTP_EMAIL của
    `#approvalAuthModal` (đổi tạm `approverAuthLevel` phía client để không cần cấu hình DB) — mở modal tự
    gửi mã lần đầu, bấm "↻ Gửi lại mã" (`sendApprovalOtp(true)`) — request tới đúng server thật (log
    server xác nhận có lượt gửi email mới, dù SMTP sandbox không kết nối được ra ngoài nên tự timeout —
    không liên quan CSP); đóng qua cả nút X và nút "Huỷ" — cả 2 đều đóng đúng, không chạy nhầm hành động
    đang chờ.
  - Không lỗi JS console mới liên quan tới thay đổi (chỉ lỗi mạng nền quen thuộc trước lúc đăng nhập: font
    CDN ngoài bị chặn bởi sandbox mạng, `/api/auth/me` 401 lúc kiểm tra phiên đăng nhập cũ, `/api/captcha`
    404 do CAPTCHA tắt — không liên quan tới đợt này). Toàn bộ dữ liệu demo (6 tờ trình `[DEMO CSP]...`,
    1 người dùng `demo_csp_hi01`, việc gán tạm approver + `submissionApprovalGroups.XIN_Y_KIEN`) đã xoá/
    khôi phục lại đúng bản gốc ngay sau demo, xác nhận lại qua truy vấn DB.
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 46/46 file OK (tổng 1019 kịch bản/assertion,
  0 FAIL), đúng 2 file known-flaky quen thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`
  — hoàn tất toàn bộ kịch bản (14/14 và 20/20) nhưng tiến trình Node không tự thoát, kể cả chạy riêng lẻ
  với timeout 180s — hạ tầng test có sẵn từ trước, không liên quan thay đổi lần này) đều được xác nhận
  pass qua log kết thúc đúng ngay dòng kết quả cuối.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** đây là đợt ĐẦU TIÊN trong loạt dọn hạ tầng dùng chung (không còn thuộc "mỗi module 1 đợt"
nữa) — ước tính còn khoảng **90 điểm**, chia thành các đợt riêng sẽ làm sau, rủi ro tăng dần: Office module
(`buildActionCell()`/dropdown "Khác ▾" dùng chung nhiều module, ~26 điểm), `#profileModal` (~18 điểm),
màn login/TOTP-wall (`#loginTotpStepWrap`/`#totpSetupWall`..., ~12 điểm), `#viewDocModal`,
`#genericConfirmModal`, Dashboard/"Approval Hub" (`buildDashboardCardsHTML()`/`#approvalHubSection`), và
cuối cùng — rủi ro cao nhất, để dành sau cùng — `buildActionCell()`/`paginateList()`+
`buildPaginationBoxHTML()`/dashboard-card (hạ tầng lõi dùng ở gần như mọi module). Chỉ khi hết sạch toàn
bộ mới gỡ `'unsafe-inline'` khỏi CSP header (`lib/securityHeaders.js`).

## Trước đó — CSP unsafe-inline: đợt 23/N (CUỐI CÙNG) — module Báo Cáo Định Kỳ

Tiếp tục đợt 22 (Tài Liệu, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển toàn bộ module **Báo Cáo
Định Kỳ** (`#periodicReportSection` — 4 sub-tab Nhập Báo Cáo/Kỳ Báo Cáo/Tổng Hợp/Đã Phát Hành trong 1
section, cộng modal Trình Chiếu Toàn Màn Hình sống ngoài section) — **ĐÂY LÀ MODULE CUỐI CÙNG CÒN LẠI**,
hoàn tất toàn bộ 23 đợt chuyển đổi `onclick`/`onchange`/`oninput`/`onsubmit` sang `data-op*`:

- **43 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`:
  - **`#periodicReportSection`** (23 điểm tĩnh): 4 nút chuyển sub-tab (`setPeriodicReportSubTab`), form
    Nhập Báo Cáo (đổi kỳ `onPrEntryPeriodChange`, đổi hình thức PPTX/PDF `onPrEntryModeChange` × 2, chọn
    tệp `.pptx`/PDF nhận thẳng `event` thật qua `data-arg-event` — `onPrEntryPptxFileChange`/
    `onPrEntryPdfFilesChange`, Lưu Nháp/Gửi Báo Cáo `savePrEntryDraft`/`submitPrEntry`), form Tạo Kỳ Báo
    Cáo (`onsubmit` → `createReportPeriod`, checkbox "Áp dụng TẤT CẢ phòng ban" → `toggleScopeGroup` dùng
    chung), khối Tổng Hợp (đổi kỳ cần tổng hợp, 3 nút Tổng Hợp Theo Báo Cáo/Lưu Chỉnh Sửa/Phát Hành/Hủy
    Phát Hành, 3 nút song song cho khối Ghép PDF, nút Đối Chiếu Theo Công Việc).
  - **`renderPrItemsTable()`/`renderPrAggEntriesList()`/`renderPrAggOrderList()`/
    `renderPrAggPdfEntriesList()`/`renderPrAggCompilation()`/`renderPrPublishedTable()`** (dòng động —
    19 điểm): xoá dòng bảng Công Việc/Kế Hoạch (tên hàm xoá `${removeFn}` vốn ĐỘNG giữa `removePrItemRow`/
    `removePrAggItemRow` tuỳ nơi gọi — nay đưa thẳng literal đã tính sẵn vào `data-op`, không còn cần
    `escapeHtml()` lồng chuỗi JS), thêm dòng (`addPrAggItemRow`), sửa nháp báo cáo (`editPrEntryDraft`),
    tick chọn báo cáo PPTX/PDF vào bản tổng hợp (2 wrapper mới — xem dưới), sắp thứ tự/bỏ chọn
    (`movePrAggEntry`, wrapper `untogglePrAggEntry` — xem dưới), sửa từng slide (tiêu đề/nội dung/dòng
    PowerPoint đọc được — `updatePrAggSlideField`/`updatePrAggPptxBodyLines`/`syncPrAggSlideItems` qua
    `data-arg-value`), sắp/xoá slide (`movePrAggSlide`/`removePrAggSlide`/`removePrAggSlideFile`), nút
    Trình Chiếu/Tải PDF/Xem PDF Toàn Màn Hình ở bảng Đã Phát Hành (`openPrSlideshow`/`downloadPrPdf` nhận
    thẳng nút `this` qua `data-arg-el`/`openPrPdfFullscreen`).
  - **`#prSlideshowModal`** (Trình Chiếu Báo Cáo Định Kỳ toàn màn hình, sống NGOÀI section, dùng chung cho
    cả 2 chế độ SLIDES/PDF — 1 điểm tĩnh đóng + 2 nút điều hướng `‹`/`›`, cộng 1 điểm dựng động trong
    `buildPrFileBlockHTML()` — nút xem tệp đính kèm của slide đang hiện, `viewPrCurrentSlideFile`).
- **3 hàm wrapper mới** do runtime `data-op*` chưa hỗ trợ trực tiếp:
  - `onPrAggEntryCheckboxChange(entryId, el)`/`onPrAggPdfEntryCheckboxChange(entryId, el)` — 2 checkbox
    tick báo cáo PPTX/PDF vào bản tổng hợp đọc `this.checked` (không có slot `data-arg` cho `.checked`,
    chỉ có `data-arg-value`/`data-arg-el`/`data-arg-event`), nhận thẳng phần tử checkbox qua `data-arg-el`
    rồi tự đọc `el.checked`.
  - `untogglePrAggEntry(entryId)` — nút ✕ bỏ chọn ở khối "Thứ tự đã chọn" tương đương
    `onclick="togglePrAggEntry(id, false)"` cũ; phát hiện `cspCoerceArg()` chỉ coerce được số nguyên
    (`/^-?\d+$/`), còn chuỗi `"false"` đọc từ `data-argN` vẫn giữ nguyên dạng chuỗi — mà chuỗi non-empty
    lại truthy trong JS, nên truyền thẳng literal `"false"` qua `data-arg1` sẽ SAI (checkbox coi như đang
    tick). Tách hẳn thành hàm riêng gọi cứng `false` để tránh bẫy coercion này (không sửa `cspCoerceArg()`
    dùng chung — nằm ngoài phạm vi module, ảnh hưởng mọi module khác đã convert).
- **2 gốc `bindCspDelegation`**: `periodicReportSection`, `prSlideshowModal`. Không đụng: nút Thao Tác
  chính ở `#prPeriodsTableBody` chỉ có dấu "—" (không có `onclick` gì để chuyển), dropdown "Khác ▾" dùng
  chung `buildActionCell()`/`#genericConfirmModal` (bước xác nhận trước khi Phát Hành/Hủy Phát Hành/Đóng
  Kỳ Sớm) — nằm trong đợt dọn hạ tầng dùng chung riêng, đúng tiền lệ mọi đợt trước.
- **Không phát hiện lỗi nghiệp vụ thật nào trong lúc demo module này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua 1 tài khoản demo tạm — không
  admin/không TOTP để tránh phụ thuộc luồng 2FA, chỉ có đúng quyền cần cho module này
  `reportManage`/`reportAggregate`/`reportEntryCreate` + `moduleAccess.periodicReport` — xoá lại ngay sau
  demo cùng toàn bộ dữ liệu demo: `reportPeriods`/`reportEntries` đều nằm trong `MIGRATED_COLLECTIONS`,
  xoá bằng `deleteRecordById()`; tài khoản demo xoá bằng `withLockedAppDataValue('users', ...)`): đăng
  nhập, vào Điều Hành > Báo Cáo Định Kỳ; tạo 1 Kỳ Báo Cáo mới (tick "Áp dụng TẤT CẢ phòng ban" qua
  `toggleScopeGroup`, `onsubmit` → `createReportPeriod`) — thành công; sang "Nhập Báo Cáo", chọn kỳ vừa
  tạo, đổi hình thức nộp sang PDF (`onPrEntryModeChange`), chọn tệp PDF thật (`onPrEntryPdfFilesChange`
  nhận `event` qua `data-arg-event`, ghép bằng pdf-lib ngay trong trình duyệt) — Lưu Nháp thành công rồi
  Gửi Báo Cáo qua `#genericConfirmModal`/`#genericConfirmOkBtn` — trạng thái chuyển đúng `SUBMITTED`; đóng
  sớm kỳ báo cáo (qua dropdown "Khác ▾" dùng chung, ngoài phạm vi CSP module này) để đủ điều kiện tổng
  hợp; sang "Tổng Hợp", chọn đúng kỳ — báo cáo PDF hiện đúng trong khối Ghép PDF (không lọt vào khối PPTX,
  đúng `getPrAggPeriodEntries()` loại `entryType==='PDF'`); tick chọn báo cáo (wrapper
  `onPrAggPdfEntryCheckboxChange`, pdf.js render thumbnail thành công), Tổng Hợp PDF
  (`mergeReportPeriodPdfAction`) rồi Phát Hành PDF (`publishPrPdfCompilation`) — cả 2 đều 200; sang "Đã
  Phát Hành" — thấy đúng kỳ vừa phát hành, bấm "🖥️ Xem PDF Toàn Màn Hình" (`openPrPdfFullscreen`) — mở
  đúng `#prSlideshowModal` full màn hình bằng pdf.js, đóng lại (`closePrSlideshow`) — đóng đúng, không lỗi
  JS console mới liên quan tới thay đổi (chỉ lỗi mạng nền quen thuộc trước lúc đăng nhập: font CDN ngoài
  bị chặn bởi sandbox mạng, `/api/auth/me` 401 lúc kiểm tra phiên đăng nhập cũ, `/api/captcha` 404 do
  CAPTCHA tắt — không liên quan tới module này).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — [KẾT_QUẢ_TEST]/46 OK[GHI_CHÚ_KNOWN_FLAKY].

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại: ĐÃ HOÀN TẤT TOÀN BỘ MODULE.** 23/23 đợt đã xong (Công Việc, Văn Bản Trình, Tài Liệu, Báo Cáo
Định Kỳ và toàn bộ ~19 module trước đó) — mọi `onclick`/`onchange`/`oninput`/`onsubmit` nghiệp vụ trong
`public/index.html` đã chuyển sang `data-op*`/`bindCspDelegation()`. Bước tiếp theo (KHÔNG còn thuộc đợt
"mỗi module 1 commit" này nữa) là dọn 2 nhóm hạ tầng dùng chung còn cố tình để lại `onclick` nguyên trạng
xuyên suốt 23 đợt (`buildActionCell()`/dropdown "Khác ▾", `#genericConfirmModal`, `#viewDocModal`,
`buildDashboardCardsHTML()`, `paginateList()`/`buildPaginationBoxHTML()`, "Approval Hub"
`#approvalHubSection`) rồi mới gỡ hẳn `'unsafe-inline'` khỏi CSP header.

## Trước đó — CSP unsafe-inline: đợt 22/N — module Tài Liệu

Tiếp tục đợt 21 (Văn Bản Trình, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển toàn bộ module
**Tài Liệu** (`#docSection` — form tải lên/cập nhật phiên bản + bộ lọc + danh sách chính, cộng 1 modal
sống ngoài section: "Chi Tiết Tài Liệu" xem lịch sử phiên bản):

- **16 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`:
  - **`#docSection`** (11 điểm): `onsubmit` form tải lên chính (`uploadDoc`), đổi Loại thao tác Nhập
    mới/Cập nhật (`onDocOpModeChange`), chọn tài liệu cần cập nhật (`onDocUpdateTargetChange`), đổi Phòng
    Ban Trình/Phân Loại để sinh lại Mã Tài Liệu (`refreshDocCodePreview`, 2 điểm), bộ lọc danh sách
    (`onFilterChange`, 5 điểm `onchange` + 1 điểm `oninput`).
  - **Dòng động trong `buildDocRowHTML()`/`renderDocs()`** (3 điểm): mở/thu gọn các phiên bản của 1 tài
    liệu (`toggleDocFamily`), nút chính "✅ Duyệt"/"📋 Chi tiết" của mỗi dòng (`runDocAction`).
  - **`#docDetailModal`** (2 điểm đóng modal, nút X và nút Đóng, cùng `closeDocDetailModal`) — riêng bảng
    lịch sử phiên bản bên trong do `viewDocDetails()` dựng động có thêm 2 nút mỗi dòng version
    (`viewDoc`/`downloadDocFile`, dùng chung khuôn `data-op` nên không tính trùng vào tổng 16 điểm tĩnh ở
    trên, nhưng vẫn nằm trong phạm vi module này và đã chuyển cùng đợt).
- **Không cần hàm wrapper mới nào** — mọi tham số đều là ID số/enum chuỗi literal (`doc.id`, `v.id`,
  `'approve'`/`'view'`), không có `this.checked`/biểu thức JS phức tạp nào cần bọc riêng.
- **2 gốc `bindCspDelegation`**: `docSection`, `docDetailModal`. Không đụng: dropdown "Khác ▾" dùng chung
  `buildActionCell()`, `#genericConfirmModal`, `#viewDocModal` (modal xem file bảo vệ dùng chung nhiều
  module — KHÁC `#docDetailModal` là modal riêng của module này), và "Approval Hub"
  (`#approvalHubSection`/`getMyPendingApprovals()` — gộp hồ sơ chờ duyệt từ 9 module trong đó có Tài Liệu,
  hạ tầng dùng chung liên module) — cả 4 đều nằm trong đợt dọn hạ tầng dùng chung riêng, đúng tiền lệ mọi
  đợt trước.
- **Không phát hiện lỗi nghiệp vụ thật nào trong lúc demo module này** — không phải sửa file test hồi quy
  nào.

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua 1 tài khoản demo tạm — không
  admin/không TOTP để tránh phụ thuộc luồng 2FA, chỉ có đúng quyền cần cho module Tài Liệu
  `uploadDepts`/`viewDraftDepts`/`viewApprovedDepts`/`docDownload` giới hạn 1 phòng ban — xoá lại ngay sau
  demo cùng toàn bộ dữ liệu demo: `docs` là bảng SQL riêng `dbo.Records`, xoá bằng `deleteRecordById()`;
  tài khoản demo xoá bằng `withLockedAppDataValue('users', ...)`): đăng nhập, vào Tài liệu; mở khối "Tìm
  Kiếm & Lọc Tài Liệu", đổi Trạng Thái (`onFilterChange` qua `onchange`) và gõ Từ Khóa (`onFilterChange`
  qua `oninput`); tải lên 1 tài liệu mới (chọn Phòng Ban Trình/Phân Loại kích hoạt `refreshDocCodePreview`,
  đính kèm tệp, điền Trích Lục, gửi phê duyệt qua `uploadDoc`) — tạo thành công, thấy ngay trong danh
  sách; lọc lại theo đúng tiêu đề vừa tạo; bấm nút "📋 Chi tiết" của dòng vừa tạo (`runDocAction`) — mở
  đúng `#docDetailModal` hiện bảng lịch sử phiên bản; trong bảng đó bấm "👁️ Xem" (`viewDoc`, mở đúng
  `#viewDocModal` dùng chung) và "⬇️ Tải" (`downloadDocFile`); đóng `#docDetailModal` bằng nút X
  (`closeDocDetailModal`) — đóng đúng, không lỗi JS console mới liên quan tới thay đổi (chỉ lỗi mạng nền
  quen thuộc trước lúc đăng nhập: font CDN ngoài bị chặn bởi sandbox mạng, `/api/auth/me` 401 lúc kiểm tra
  phiên đăng nhập cũ, `/api/captcha` 404 do CAPTCHA tắt — không liên quan tới module này).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`, gồm cả `tests/test-doc.js` riêng cho module
  này) — 46/46 OK; 2 file known-flaky quen thuộc từ các đợt trước (`test-audit-fixes-batch1.js`/
  `test-audit-round2-cluster1.js`, hoàn tất toàn bộ kịch bản nhưng tiến trình Node không tự thoát ngay khi
  chạy dồn — hạ tầng test, không liên quan thay đổi lần này) đều được xác nhận qua log chạy dồn kết thúc
  đúng ngay khi in dòng kết quả cuối (14/14 và 20/20 pass), khớp đúng pattern known-flaky đã ghi nhận từ
  đợt trước, không phải lỗi mới.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — thay đổi nằm thuần trong `public/index.html` (client JS/HTML), deploy an toàn chỉ với copy code +
`pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Báo Cáo Định Kỳ... — dùng hạ tầng `data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự
mỗi module 1 commit + demo + regression trước khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 21/N — module Văn Bản Trình

Tiếp tục đợt 20 (Công Việc, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển toàn bộ module
**Văn Bản Trình** (`#submissionSection` — form tạo tờ trình + dropdown "Phê duyệt"/lớp bổ sung + bộ lọc +
danh sách, cộng 1 modal sống ngoài section: bút phê & xử lý tờ trình):

- **22 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`:
  - **`#submissionSection`** (13 điểm): `onsubmit` form chính (`submitSubmissionReq`), đổi Cấp Phê Duyệt
    Cuối Cùng (`renderSubmissionApprovalLayerCheckboxes`), mở/đóng dropdown "Phê duyệt"
    (`toggleSubApprovalDropdown`, nhận `event` thật qua `data-arg-event`), nút "🔍 Xem Quy Trình"
    (`previewSubmissionWorkflow`), bộ lọc danh sách (`onSubFilterChange`, 4 điểm `onchange` + 1 điểm
    `oninput`), tick/bỏ tick 1 lớp phê duyệt bổ sung trong dropdown (`onSubApprovalLayerToggle`, dựng động
    trong `renderSubmissionApprovalLayerCheckboxes()`), 3 nút thao tác chính của mỗi dòng trong
    `#submissionTableBody` (`openResolveFileProposalModal`/`openProcessSubmissionModal`/
    `runSubmissionAction` — dựng động trong `renderSubmissionReqs()`).
  - **`#submissionProcessModal`** (9 điểm, nội dung do `openProcessSubmissionModal()`/
    `renderSubModalOpinions()` dựng động): đóng modal (nút X và nút Đóng, cùng
    `closeProcessSubmissionModal`), xem tệp tờ trình gốc + từng tệp bổ sung (`viewSubmissionAttachment`/
    `viewSubmissionExtraFile`), 3 nút quyết định ở bước đang chờ duyệt (`confirmProcessSubmission` với
    `REJECT`/`REQUEST_CHANGES`/`APPROVE` — riêng lớp Trợ Lý/Thư Ký thay `REQUEST_CHANGES` bằng
    `openTroLyThuKyBoSungChoice` để mở hộp chọn "thay thế toàn bộ tệp" thay vì chỉ bình luận), gửi ý kiến
    tham khảo (`giveSubmissionOpinion`).
- **Không cần hàm wrapper mới nào** — mọi tham số đều là ID số/enum chuỗi literal (`sub.id`, `idx`,
  `layer.key`, `'REJECT'`/`'REQUEST_CHANGES'`/`'APPROVE'`), không có `this.checked`/biểu thức JS phức tạp
  nào cần bọc riêng.
- **2 gốc `bindCspDelegation`**: `submissionSection`, `submissionProcessModal`. Không đụng: 3 nhánh dựng
  trong `showConfirmModal()`/`#genericConfirmModal` (`openTroLyThuKyBoSungChoice()`,
  `openTroLyThuKyProposeFileForm()`, `openResolveFileProposalModal()` — mỗi hàm tự vẽ nút quyết định NGAY
  TRONG `bodyHTML` của modal dùng chung, không phải khối tĩnh của module này), dropdown "Khác ▾" dùng
  chung `buildActionCell()`, `#viewDocModal` (nút "🔍 Xem Quy Trình" xem trước còn dùng lại modal này để
  hiển thị, đóng qua thao tác trực tiếp `classList`, không có `onclick` tĩnh nào), và `buildDashboardCardsHTML()`
  (4 thẻ dashboard đầu section — hàm sinh `onclick` ĐỘNG dùng chung cho MỌI module trong hệ thống, không
  riêng module này) — cả 5 đều là hạ tầng dùng chung, nằm trong đợt dọn hạ tầng riêng sau này, đúng tiền lệ
  mọi đợt trước.
- **1 file test hồi quy phải cập nhật theo markup mới**: `tests/test-submission.js` — 1 assertion kiểm tra
  sự có mặt của nút "Yêu Cầu Bổ Sung" ở bước Trợ Lý/Thư Ký bằng cách `.includes()` chuỗi lệnh gọi hàm cũ
  kiểu `openTroLyThuKyBoSungChoice(9001)`/`confirmProcessSubmission('REQUEST_CHANGES')` — chuỗi này không
  còn xuất hiện trong markup mới (`data-op="..." data-arg0="..."` là 2 thuộc tính HTML tách rời, không phải
  1 lệnh gọi hàm dạng chuỗi) nên assertion cũ báo FAIL dù hành vi thực tế đúng; đã sửa lại assertion để
  kiểm tra đúng cặp thuộc tính `data-op`/`data-arg0` tương ứng, giữ nguyên ý định kiểm thử ban đầu (đã xác
  nhận lại 19/19 kịch bản pass sau khi sửa).
- **Không phát hiện lỗi nghiệp vụ thật nào trong lúc demo module này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua 2 tài khoản demo tạm — không
  admin/không TOTP để tránh phụ thuộc luồng 2FA: 1 tài khoản người trình `submissionCreate`/`submissionView`,
  1 tài khoản người duyệt `submissionView` được tạm gán làm approver bước 1 của phòng "Phòng IT" — xoá lại
  ngay sau demo cùng toàn bộ dữ liệu demo: `submissions` là bảng SQL riêng `dbo.Records`, xoá bằng
  `deleteRecordById()`; tài khoản demo + cấu hình quy trình/nhóm phê duyệt tạm chỉnh sửa (khôi phục lại
  đúng bản gốc đã backup trước khi sửa) xoá/khôi phục bằng `withLockedAppDataValue('submissionDeptWorkflows'
  | 'submissionApprovalGroups' | 'users', ...)`): đăng nhập người trình, vào Điều Hành > Văn Bản Trình; điền
  form tạo tờ trình đầy đủ (đính kèm 1 tệp), mở dropdown "Phê duyệt", tick lớp "Xin ý kiến" và tự chọn
  chính mình làm người xin ý kiến (đúng widget tìm-để-thêm dùng chung, không phải điểm CSP của module này);
  bấm "🔍 Xem Quy Trình" xem trước quy trình; gửi phê duyệt (modal xác nhận `#genericConfirmModal` — hạ
  tầng dùng chung); mở lại hồ sơ vừa tạo qua nút "Chi tiết" (`runSubmissionAction`) — xem tệp đính kèm
  (`viewSubmissionAttachment`), gửi ý kiến tham khảo (`giveSubmissionOpinion`), đóng modal
  (`closeProcessSubmissionModal`); lọc danh sách theo từ khoá (`onSubFilterChange`); đăng xuất, đăng nhập
  người duyệt, mở đúng hồ sơ qua nút "✍️ Bút phê / Duyệt" (`openProcessSubmissionModal`) — xác nhận cả 3
  nút quyết định (Từ Chối/Yêu Cầu Bổ Sung/Phê Duyệt) hiện đúng, bấm "✅ Phê Duyệt & Chuyển Bước"
  (`confirmProcessSubmission`) hoàn tất quy trình — trạng thái chuyển đúng "Đã phê duyệt hoàn tất" — không
  lỗi JS console mới liên quan tới thay đổi (chỉ lỗi mạng nền quen thuộc trước/ngoài lúc đăng nhập: font
  CDN ngoài bị chặn bởi sandbox mạng, `/api/auth/me` 401 sau logout, `/api/captcha` 404 do CAPTCHA tắt,
  không liên quan tới module này).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 44/46 OK trực tiếp trong 1 lượt chạy dồn; 2
  file known-flaky quen thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, hoàn tất toàn
  bộ kịch bản nhưng tiến trình Node không tự thoát — hạ tầng test, không liên quan thay đổi lần này) cả 2
  chạy riêng lẻ đều xác nhận pass hết kịch bản (14/14 và 20/20). Phát hiện thêm 2 lượt FAIL khi chạy dồn:
  `test-vpp.js` (module Văn Phòng Phẩm, KHÔNG đụng tới trong đợt này) — chạy lại riêng lẻ pass 10/10, xác
  nhận chỉ là nhiễu thời điểm/tải máy lúc chạy dồn 46 file liên tục, không phải lỗi thật; `test-submission.js`
  — đây MỚI là lỗi thật (assertion cũ dò markup `onclick` cũ, xem mục sửa test ở trên), đã sửa và xác nhận
  lại 19/19 pass.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — thay đổi nằm trong `public/index.html` (thuần client JS/HTML) + `tests/test-submission.js` (chỉ sửa
1 assertion hồi quy, không phải code chạy thật), deploy an toàn chỉ với copy code + `pm2 restart`, không
cần thao tác 1 lần nào khác.

**Còn lại:** Tài Liệu, Báo Cáo Định Kỳ... — dùng hạ tầng `data-op*`/`bindCspDelegation()` đã xây, làm tiếp
tuần tự mỗi module 1 commit + demo + regression trước khi merge, tới khi hết toàn bộ điểm mới gỡ
`unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 20/N — module Công Việc

Tiếp tục đợt 19 (Biên Bản Họp, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển toàn bộ module
**Công Việc** (`#taskSection` — danh sách + bộ lọc, cộng 7 modal sống ngoài section: tạo việc thủ công,
yêu cầu/duyệt gia hạn, huỷ việc 2 bước, cập nhật tiến độ + chia nhỏ công việc, xem chi tiết):

- **31 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`:
  - **`#taskSection`**: bộ lọc danh sách (từ khoá, trạng thái, nguồn gốc — `onTaskFilterChange`), mở modal
    tạo việc thủ công (`openCreateTaskModal`).
  - **`#createTaskModal`** (3 điểm): đóng modal (nút X và Huỷ), lưu (`submitCreateTask`).
  - **`#taskExtensionRequestModal`/`#taskExtensionApproveModal`** (3 điểm mỗi modal): đóng modal, gửi yêu
    cầu/xác nhận duyệt gia hạn.
  - **`#taskCancelModal`/`#taskCancelApproveModal`** (3 điểm mỗi modal): đóng modal, gửi yêu cầu/xác nhận
    huỷ việc (luồng 2 bước bắt buộc nhập lý do).
  - **`#taskProgressModal`** (4 điểm): đóng modal, cập nhật tiến độ (`confirmTaskProgress`), thêm công
    việc nhỏ (`addSubtaskAction`).
  - **`#taskDetailModal`** (2 điểm): đóng modal (nút X và nút Đóng).
  - **Dòng động trong `renderTasks()`/`buildActionCell()`**: đánh dấu/xoá công việc nhỏ
    (`toggleSubtaskAction`/`deleteSubtaskAction`), nút chính "🔄 Cập nhật tiến độ"
    (`runTaskAction`), "✅ Nhận việc thay" cho người phối hợp bên ngoài (`acceptTaskOnBehalf`) — 1 điểm
    (`confirmCollaboratorParticipationOnBehalf`) sửa tay thay vì dùng script tự động vì tham số gốc có kỹ
    thuật escape dấu nháy đơn để nhúng an toàn vào chuỗi JS bên trong `onclick` — chuyển sang thuộc tính
    `data-argN` (không còn là chuỗi JS) thì kỹ thuật escape đó thừa và đã được bỏ, chỉ còn giữ lại
    `escapeHtml()` để an toàn HTML như các điểm khác.
  - **8 gốc `bindCspDelegation`**: `taskSection`, `createTaskModal`, `taskExtensionRequestModal`,
    `taskExtensionApproveModal`, `taskCancelModal`, `taskCancelApproveModal`, `taskProgressModal`,
    `taskDetailModal`. Không có hàm wrapper mới nào cần viết (không có điểm nào dùng `this.checked` hay
    biểu thức JS phức tạp). Không đụng dropdown "Khác ▾" dùng chung trong `buildActionCell()`,
    `#genericConfirmModal` (ngoài phạm vi đợt này).
  - **Không phát hiện lỗi thật nào trong lúc demo module này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm — không
  admin/không TOTP để tránh phụ thuộc luồng 2FA, xoá lại ngay sau demo cùng toàn bộ dữ liệu demo: `tasks`
  là bảng SQL riêng `dbo.Tasks`, xoá bằng `deleteTaskById()`; tài khoản demo xoá bằng
  `withLockedAppDataValue('users', ...)`): đăng nhập, mở Điều Hành > Công việc; giao việc thủ công cho
  chính tài khoản demo (tự kích hoạt luồng "Nhận việc" — bấm nút chính lần 1 để xác nhận nhận việc, lần 2
  mở đúng modal Cập Nhật Tiến Độ); chuyển trạng thái Chưa bắt đầu → Đang thực hiện (bắt buộc ghi chú tiến
  độ); mở lại modal (nay đã đủ điều kiện `assignedTo === currentUser && status === 'DOING'` để hiện khối
  Chia Nhỏ Công Việc) — thêm 1 công việc nhỏ kèm hạn hoàn thành, đánh dấu hoàn thành, xoá — cả 3 thao tác
  qua đúng `data-op="addSubtaskAction"`/`data-op-change="toggleSubtaskAction"`/
  `data-op="deleteSubtaskAction"` vừa chuyển đổi, đều thành công; cập nhật ghi chú tiến độ tiếp — không lỗi
  JS console mới liên quan tới thay đổi (chỉ các lỗi mạng nền quen thuộc trước lúc đăng nhập, không liên
  quan tới module này).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 44/46 OK, đúng 2 file known-flaky quen thuộc
  (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, timeout hạ tầng test không liên quan thay
  đổi lần này — cả 2 chạy riêng lẻ đều OK).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Văn Bản Trình, Tài Liệu, Báo Cáo Định Kỳ... — dùng hạ tầng
`data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit + demo + regression trước
khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 19/N — module Biên Bản Họp

Tiếp tục đợt 18 (Tin Tức/Truyền Thông, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển toàn bộ module
**Biên Bản Họp** (`#minutesSection` — form lập biên bản + thành phần tham dự + ý kiến chỉ đạo + bộ lọc
danh sách trong 1 section, cộng 2 modal sống ngoài section: soạn email thông báo và quản lý mẫu danh sách
tham dự):

- **50 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`:
  - **`#minutesForm`**: `onsubmit` (`submitMeetingMinutes`), đổi lịch họp liên kết
    (`onMinutesLinkedMeetingChange`).
  - **Toolbar mẫu danh sách tham dự** (4 nút): áp dụng mẫu đã chọn (wrapper mới — xem dưới), lưu mẫu từ
    danh sách hiện tại (`saveMeetingAttendeeTemplate`), xoá mẫu (`deleteMeetingAttendeeTemplate`), mở
    modal quản lý mẫu (`openAttendeeTemplateManagerModal`).
  - **Thêm dòng tham dự/chỉ đạo + Huỷ sửa** (3 nút): `addAttendeeRow`, `addMinutesDirectiveRow`,
    `cancelEditMeetingMinutes`.
  - **Bộ lọc danh sách** (4 điểm, đều gọi lại `onMinutesFilterChange`): từ khoá chủ đề, từ ngày, đến
    ngày, từ khoá chung.
  - **`renderAttendeesTable()`/`renderTplEditRowsTable()`** (dòng tham dự trong form chính + dòng trong
    trình soạn mẫu, cấu trúc gần như song song): mỗi dòng — sửa từng trường (`updateAttendeeField`/
    `updateTplEditField`), gợi ý tài khoản hệ thống theo tên gõ vào (`resolveAttendeeAccountInput`/
    `resolveTplRowAccountInput`), đổi Có/Không tài khoản (`toggleAttendeeHasAccount`/
    `toggleTplRowHasAccount`), xoá dòng (`removeAttendeeRow`/`removeTplEditRow`).
  - **`renderAttendeeTemplateManagerList()`**: sửa mẫu (`openAttendeeTemplateEditor`), xoá mẫu
    (`deleteAttendeeTemplateFromManager`).
  - **`renderMinutesDirectivesTable()`**: sửa nội dung/hạn hoàn thành (`updateMinutesDirectiveField`),
    đổi người thực hiện (`updateMinutesDirectiveField` qua `this.value`), đổi người phối hợp — multi-
    select (wrapper mới — xem dưới), xoá dòng (`removeMinutesDirectiveRow`).
  - **`renderMeetingMinutes()`/`viewMeetingMinutesDetails()`**: nút chính "🔍 Xem chi tiết"
    (`runMinutesAction`, các thao tác khác — sửa/xoá/tải/gửi email/duyệt — vẫn nằm trong dropdown "Khác ▾"
    dùng chung `buildActionCell()`, ngoài phạm vi đợt này); nút "📌 Giao việc" cho ý kiến chỉ đạo chưa gán
    (`createTaskFromMinutesDirective`).
  - **`#minutesEmailComposeModal`** (soạn email thông báo người tham dự, sống ngoài section, 4 điểm):
    đóng modal (nút X và nút Hủy, cùng `closeMinutesEmailComposeModal`), chọn/bỏ chọn tất cả người nhận
    (`toggleAllMinutesEmailRecipients`), gửi email (`confirmSendMinutesEmail`).
  - **`#attendeeTemplateManagerModal`** (quản lý mẫu danh sách tham dự, sống ngoài section, 6 điểm): đóng
    modal (nút X và nút Đóng, cùng `closeAttendeeTemplateManagerModal`), tạo mẫu mới
    (`openAttendeeTemplateEditor`, cùng data-op với nút "Sửa" của từng dòng — tham số `null` bỏ qua
    `data-argN` vì `undefined` giữ nguyên tính falsy), thêm người trong trình soạn (`addTplEditRow`),
    quay lại danh sách (`backToAttendeeTemplateList`), lưu mẫu (`saveAttendeeTemplateFromEditor`).
- **2 hàm wrapper mới** do runtime `data-op*` chưa hỗ trợ trực tiếp:
  - `applyMeetingAttendeeTemplateFromSelect()` — nút "Áp Dụng" gọi thẳng biểu thức
    `applyMeetingAttendeeTemplate(document.getElementById('minutesAttendeeTemplateSelect').value)`, tham
    số là 1 biểu thức đọc DOM chứ không phải `this`/`this.value`/literal nên không map trực tiếp được.
  - `updateMinutesDirectiveFieldMultiSelect(idx, field, el)` — ô chọn người phối hợp là `<select
    multiple>`, giá trị đọc qua `Array.from(this.selectedOptions).map(o => o.value)` chứ không phải
    `this.value` đơn giản; wrapper nhận thẳng element qua `data-arg-el` rồi tự đọc danh sách lựa chọn.
- **3 gốc `bindCspDelegation`**: `minutesSection` (form, thành phần tham dự, ý kiến chỉ đạo, bộ lọc,
  danh sách), `minutesEmailComposeModal`, `attendeeTemplateManagerModal` (2 modal xác nhận là sibling DOM
  sống ngoài section). Không đụng dropdown "Khác ▾" dùng chung trong `buildActionCell()`,
  `#genericConfirmModal`, hay `#viewDocModal` (modal xem file bảo vệ dùng chung — riêng module này còn
  dùng lại hạ tầng đó để hiển thị "Xem chi tiết" biên bản họp, đóng qua `closeViewDocModal()` vẫn giữ
  nguyên `onclick` — cả 3 nằm trong phạm vi dọn hạ tầng dùng chung riêng, ngoài phạm vi đợt này). Nút
  "Giao việc" chỉ TRIGGER module Công Việc (Task), bản thân module Công Việc là đợt CSP riêng sau này.
- **Không phát hiện lỗi thật nào trong lúc demo module này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo cùng toàn bộ dữ liệu demo tạo ra trong lúc test — `meetingMinutes` nằm trong
  `MIGRATED_COLLECTIONS`, xoá bằng `deleteRecordById()`; `meetingAttendeeTemplates` là collection
  `appData` thường, xoá bằng `withLockedAppDataValue()`; tài khoản demo xoá bằng
  `withLockedAppDataValue('users', ...)`): đăng nhập, mở Điều Hành > Biên bản họp; lập 1 biên bản với 2
  người tham dự và 1 ý kiến chỉ đạo (gán người thực hiện + người phối hợp qua wrapper multi-select) — lưu
  thành công, tự mở modal soạn email thông báo, bấm "Chọn/Bỏ chọn tất cả" rồi Hủy; mở "🔍 Xem chi tiết" —
  hiện đúng nội dung kèm nút "📌 Giao việc"; lưu danh sách tham dự hiện tại thành mẫu dùng chung
  (`saveMeetingAttendeeTemplate`), mở "Quản Lý Mẫu", sửa mẫu vừa lưu (thêm 1 dòng qua `addTplEditRow`,
  sửa tên qua wrapper `updateTplEditField`, lưu qua `saveAttendeeTemplateFromEditor`), xoá mẫu
  (`deleteAttendeeTemplateFromManager`) — toàn bộ đúng, không lỗi JS console mới liên quan tới thay đổi
  (chỉ 3 lỗi mạng nền quen thuộc trước lúc đăng nhập: chặn Google Fonts, `/api/auth/me` 401 lúc chưa đăng
  nhập, `/api/captcha` 404 do CAPTCHA chưa bật ở môi trường demo — cùng 3 lỗi y hệt các đợt trước, không
  liên quan tới module này).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`), gồm cả `tests/test-minutes.js` (riêng cho
  module này) — 44/46 OK, đúng 2 file known-flaky quen thuộc (`test-audit-fixes-batch1.js`/
  `test-audit-round2-cluster1.js`, timeout hạ tầng test không liên quan thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Công Việc, Văn Bản Trình, Tài Liệu, Báo Cáo Định Kỳ... — dùng hạ tầng
`data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit + demo + regression trước
khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 18/N — module Tin Tức/Truyền Thông

Tiếp tục đợt 17 (Tuyển Dụng, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển toàn bộ module **Tin
Tức/Truyền Thông Nội Bộ** (`#internalSection` — 5 sub-tab Nhịp Sống HCRC/Đào Tạo/Tuyển Dụng/Góc Chia
Sẻ/HCRC Đồng Hành trong 1 section, cộng modal xem chi tiết bài viết sống ngoài section), kèm form
"HCRC Đồng Hành" phía nhân viên (`#hrFeedbackForm`) vốn bị hoãn lại từ đợt 12 (Nhân Sự — đợt đó chỉ xử
lý phía Nhân Sự quản lý câu hỏi):

- **45 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`:
  - **5 nút chuyển sub-tab** (`setInternalSubTab`, tham số `'NEWS'`/`'TRAINING'`/`'RECRUITMENT'`/
    `'SHARE'`/`'QNA'` — 2 sub-tab TRAINING/RECRUITMENT nội dung đã chuyển ở đợt trước, chỉ 5 nút bấm
    nằm chung 1 hàng nên chuyển luôn cả cụm).
  - **Form đăng bài "Nhịp Sống HCRC"/"Góc Chia Sẻ"** (`#internalPostForm`, dùng chung cho cả 2 loại qua
    `activeInternalSubTab`): `onsubmit` (`submitInternalPost`), checkbox "Ghim bài" (`this.checked` —
    wrapper mới, xem dưới), nút "Huỷ Sửa" (`cancelEditInternalPost`).
  - **Bộ lọc feed** (4 điểm): trạng thái/từ ngày/đến ngày (`onchange`) + từ khoá (`oninput`), đều gọi lại
    `onInternalFilterChange`.
  - **Form + hộp thư "HCRC Đồng Hành" phía nhân viên** (2 điểm): `onsubmit` form
    (`submitHrFeedbackQuestion`), bấm vào 1 câu đã trả lời trong hộp thư cá nhân
    (`openHrFeedbackAnswer`, `renderHrFeedbackInbox()` — khác hẳn `renderHrFeedbackManage()` phía Nhân
    Sự đã chuyển ở đợt 12, xác nhận lại 0 handler raw còn sót ở khu vực đó).
  - **Các hàm dựng nút thao tác bài đăng** (`internalPostEditButtonHTML`/`internalPostHideActionHTML`/
    `internalPostRequestInfoActionHTML`/`internalCommentLikeButtonHTML`/
    `renderInternalModerationQueueHTML`): sửa/ẩn/hiện lại/yêu cầu bổ sung/duyệt/từ chối bài, thích bình
    luận, bỏ qua/xoá bình luận bị gắn cờ (`editInternalPostUI`/`hideInternalPostAction`/
    `unhideInternalPostAction`/`requestInternalPostInfoAction`/`toggleInternalCommentLike`/
    `dismissCommentFlagAction`/`deleteFlaggedCommentAction`/`approveInternalPostAction`/
    `rejectInternalPostAction`, đều nhận `p.id`/`c.id` làm tham số).
  - **`renderInternalNewsFeed()`**: 2 nút sắp xếp "Mới nhất"/"Tương tác nhiều"
    (`setInternalNewsSort`).
  - **`renderInternalNewsCard()`/`viewInternalPostDetail()`** (thẻ feed + modal chi tiết bài viết): mở
    chi tiết (`viewInternalPostDetail`, lặp lại ở nhiều vị trí trên cùng 1 thẻ — ảnh/tiêu đề/nút "Chi
    tiết"/"Xem thêm"), thích bài (`toggleInternalLikeInline`/`toggleInternalLike`), gửi bình luận
    (`addInternalCommentInline`/`addInternalComment`), đăng ký/huỷ đăng ký lớp đào tạo được nhắc tới
    trong bài tin (`registerForTraining`/`unregisterFromTraining`), nút "Bình luận" (wrapper mới — xem
    dưới), nút "Xem tất cả/Thu gọn bình luận" (wrapper mới — xem dưới).
  - **`#internalArticleModal`** (modal xem bài viết kiểu "trang báo", sống NGOÀI `#internalSection`): 1
    điểm — nút X đóng modal (`closeInternalArticleModal`).
- **3 hàm wrapper mới** do runtime `data-op*` chưa hỗ trợ trực tiếp:
  - `toggleInternalPinDurationWrap(el)` — checkbox "Ghim bài" đọc `this.checked` (không có
    `data-arg-checked`), nhận thẳng element qua `data-arg-el` rồi tự đọc `el.checked`.
  - `focusInternalCommentInput(id)` — nút "💬 Bình luận" trên thẻ feed gọi thẳng biểu thức
    `document.getElementById('internalCommentInput_' + id).focus()`, không phải 1 lời gọi hàm đơn nên
    không map được vào `data-op="fn(args)"`.
  - `toggleInternalCommentsExpandedAndView(id)` — nút "Xem tất cả/Thu gọn bình luận" (xuất hiện cả trong
    thẻ feed lẫn modal chi tiết) gọi 2 hàm liên tiếp `toggleInternalCommentsExpanded(${p.id});
    viewInternalPostDetail(${p.id});` với tham số là biểu thức template literal, không phải literal
    thuần nên không đủ điều kiện `data-op-seq` — gộp lại thành 1 hàm gọi cả 2.
- **2 gốc `bindCspDelegation`**: `internalSection` (5 sub-tab, form đăng bài, bộ lọc, hộp thư "HCRC
  Đồng Hành", toàn bộ nút thao tác bài/bình luận) và `internalArticleModal` (modal chi tiết, xác nhận là
  sibling DOM sống ngoài section, giống mẫu Xe/Vận Hành/Đào Tạo/Đồng Phục/Giấy Phép/Tuyển Dụng các đợt
  trước). Không đụng dropdown đổi trạng thái trong `buildActionCell()` dùng chung và
  `#genericConfirmModal` — cả 2 nằm trong đợt dọn hạ tầng dùng chung riêng, không thuộc phạm vi module
  này.
- **Không phát hiện lỗi thật nào trong lúc demo module này** — chỉ phát hiện 1 quirk có sẵn KHÔNG liên
  quan CSP: `<select id="internalPostCategoryShare" required>` vẫn giữ `required` dù bị ẩn khi đang ở
  sub-tab NEWS (`setInternalSubTab()` chỉ toggle class `hidden` trên wrapper, không đồng bộ `.required`)
  — theo đặc tả WHATWG, "không được render" KHÔNG nằm trong danh sách điều kiện "barred from constraint
  validation", nên trình duyệt vẫn chặn submit form gốc (console log "invalid form control ... not
  focusable", submit bị huỷ âm thầm). Đây là lỗi nghiệp vụ có từ trước, không phải do đổi
  `onsubmit`→`data-op-submit` gây ra (thuộc tính `required` không nằm trong phạm vi đổi của đợt này) —
  không sửa trong đợt này, chỉ né tạm trong kịch bản demo (gán giá trị cho cả ô ẩn trước khi bấm Đăng) để
  xác nhận đường `data-op-submit` hoạt động đúng.

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo cùng toàn bộ dữ liệu demo tạo ra trong lúc test — `internalPosts`/`hrFeedback`
  đều nằm trong `MIGRATED_COLLECTIONS`, xoá bằng `deleteRecordById()`, tài khoản demo xoá bằng
  `withLockedAppDataValue('users', ...)`): đăng nhập, mở Truyền Thông Nội Bộ > Nhịp Sống HCRC (qua nút
  sub-tab data-op); đăng 1 bài tin mới qua `#internalPostForm` — tự động "Đã duyệt" (NEWS không qua hàng
  chờ duyệt); bấm nút "Ghim bài" — xác nhận wrapper `toggleInternalPinDurationWrap` hiện/ẩn đúng khung
  chọn số ngày ghim; thích bài (`toggleInternalLikeInline`), gửi bình luận
  (`addInternalCommentInline`), bấm nút "💬 Bình luận" — xác nhận wrapper `focusInternalCommentInput`
  focus đúng ô nhập; mở modal chi tiết (`viewInternalPostDetail` → `#internalArticleModal` hiện đúng nội
  dung); thêm đủ 6 bình luận qua modal chi tiết rồi bấm "Xem tất cả bình luận" — xác nhận wrapper
  `toggleInternalCommentsExpandedAndView` hoạt động đúng (mở rộng danh sách + render lại modal, không
  lỗi); đóng modal qua nút X (`closeInternalArticleModal`) — đóng đúng; gõ từ khoá vào ô lọc
  (`onInternalFilterChange` qua `data-op-input`) — không lỗi; bấm "🙈 Ẩn" rồi "👁️ Hiện Lại" trên bài vừa
  tạo — cả 2 đều đổi đúng trạng thái APPROVED↔HIDDEN; chuyển sang sub-tab "HCRC Đồng Hành" (QNA), gửi 1
  câu hỏi qua `#hrFeedbackForm` — thành công, hiện đúng trong hộp thư cá nhân, bấm vào mục hộp thư
  (`openHrFeedbackAnswer`) không lỗi. Toàn bộ đúng, không có lỗi JS console mới liên quan tới thay đổi
  (chỉ 3 lỗi mạng nền quen thuộc trước lúc đăng nhập: chặn Google Fonts, `/api/auth/me` 401 lúc chưa
  đăng nhập, `/api/captcha` 404 do CAPTCHA chưa bật ở môi trường demo — cùng 3 lỗi y hệt các đợt trước,
  không liên quan tới module này).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`), gồm cả `tests/test-internal-news.js`/
  `tests/test-hr-feedback.js`/`tests/test-internal-recruitment-share.js` (riêng cho module này) — 44/46
  OK, đúng 2 file known-flaky quen thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`,
  timeout hạ tầng test không liên quan thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Biên Bản Họp, Công Việc, Văn Bản Trình, Tài Liệu, Báo Cáo Định Kỳ... — dùng hạ tầng
`data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit + demo + regression trước
khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 17/N — module Tuyển Dụng

Tiếp tục đợt 16 (Giấy Phép, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển toàn bộ module **Tuyển
Dụng** (`#internalRecruitmentSection` — 3 sub-tab Tin Tuyển Dụng/Ứng Viên Tôi Giới Thiệu/Quản Lý Ứng Viên
trong 1 section, cộng modal Giới Thiệu Ứng Viên sống ngoài section):

- **16 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`:
  - **3 nút chuyển sub-tab** (`setRecruitmentTab`, tham số `'JOBS'`/`'MY_REFERRALS'`/`'MANAGE'`).
  - **Form "Đăng Tin Tuyển Dụng"** (`#recruitmentJobForm`): `onsubmit` (`submitRecruitmentJob`).
  - **Bộ lọc Tin Tuyển Dụng**: 2 ô chọn (đợt/phòng ban) + 1 ô gõ từ khoá, đều gọi lại
    `onRecruitmentJobsFilterChange`.
  - **Bộ lọc Quản Lý Ứng Viên**: 1 ô chọn theo tin tuyển dụng (`onRecruitmentManageFilterChange`).
  - **`renderRecruitmentJobs()`** (dựng từng thẻ tin tuyển dụng): 4 điểm — "🙋 Giới Thiệu Ứng Viên"
    (`openRecruitmentReferModal`), "✅ Xác Nhận Đã Tuyển Đủ" (`confirmRecruitmentJobFilledUi`), "Đóng
    Tin" (`closeRecruitmentJobUi`), "Xoá" admin-only (`deleteRecruitmentJob`) — cả 4 đều nhận `j.id` làm
    tham số.
  - **`renderRecruitmentManage()`** (dựng từng dòng ứng viên): 1 điểm — dropdown đổi trạng thái ứng viên
    (`setRecruitmentReferralStatusUi(${r.id}, this.value)`), map thẳng vào `data-arg-value` (slot
    `this.value` có sẵn, không cần wrapper).
  - **`#recruitmentReferModal`** (modal Giới Thiệu Ứng Viên, sống NGOÀI section): 3 điểm — nút X đóng
    modal, `onsubmit` form (`submitRecruitmentReferral`), nút "Huỷ" (cả 2 nút đóng đều gọi
    `closeRecruitmentReferModal`).
- **Không có wrapper mới nào cần thiết** — toàn bộ 16 điểm map thẳng vào `data-op`/`data-op-change`/
  `data-op-input`/`data-op-submit` với tham số positional hoặc slot `this.value` có sẵn.
- **2 gốc `bindCspDelegation`**: `internalRecruitmentSection` (3 sub-tab) và `recruitmentReferModal`
  (modal ngoài section, xác nhận là sibling DOM, giống mẫu Xe/Vận Hành/Đào Tạo/Đồng Phục/Giấy Phép các
  đợt trước).
- **Không phát hiện lỗi thật nào trong lúc demo module này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo cùng toàn bộ dữ liệu demo tạo ra trong lúc test — `recruitmentJobs`/
  `recruitmentReferrals` đều nằm trong `MIGRATED_COLLECTIONS`, xoá bằng `deleteRecordById()`, tài khoản
  demo xoá bằng `withLockedAppDataValue('users', ...)`): đăng nhập, mở Truyền Thông Nội Bộ > Tuyển Dụng;
  đăng 1 tin tuyển dụng mới (điền đủ tên vị trí/số lượng/địa điểm/hạn nộp/phòng ban tuyển/liên hệ); bấm
  "🙋 Giới Thiệu Ứng Viên" trên tin vừa đăng — mở đúng `#recruitmentReferModal`, điền tên/SĐT/email ứng
  viên + upload CV (PDF), gửi giới thiệu thành công; chuyển sang sub-tab "Quản Lý Ứng Viên" — đổi trạng
  thái ứng viên vừa giới thiệu qua dropdown (`this.value` → `data-arg-value`) thành công; quay lại "Tin
  Tuyển Dụng" — bấm "Đóng Tin" rồi "Xoá" tin vừa tạo, cả 2 đều thành công. Toàn bộ đúng, không có lỗi JS
  console mới liên quan tới thay đổi (chỉ 3 lỗi mạng nền quen thuộc trước lúc đăng nhập: chặn Google
  Fonts, `/api/auth/me` 401 lúc chưa đăng nhập, `/api/captcha` 404 do CAPTCHA chưa bật ở môi trường demo
  — cùng 3 lỗi y hệt các đợt trước, không liên quan tới module này).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 44/46 OK, đúng 2 file known-flaky quen
  thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, timeout hạ tầng test không liên
  quan thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Tin Tức/Truyền Thông (bao gồm cả form "HCRC Đồng Hành" phía nhân viên — `#hrFeedbackForm`),
Biên Bản Họp, Công Việc, Văn Bản Trình, Tài Liệu, Báo Cáo Định Kỳ... — dùng hạ tầng
`data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit + demo + regression trước
khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 16/N — module Giấy Phép

Tiếp tục đợt 15 (Đồng Phục, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển toàn bộ module **Giấy
Phép** (`#licenseSection` — form Tải Lên/bộ lọc + danh sách trong 1 section, cộng modal chi tiết sống
ngoài section):

- **16 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`:
  - **Form "Tải Lên Giấy Phép" + bộ lọc** (trong `#licenseSection`): **9 điểm** — `onsubmit` form
    `#licenseForm` (`uploadLicense`), đổi Loại thao tác Nhập mới/Cập nhật (`onLicenseOpModeChange`), chọn
    giấy phép cần cập nhật (`onLicenseUpdateTargetChange`), 6 ô lọc (trạng thái duyệt/loại GP/vòng đời/từ
    ngày/đến ngày/từ khoá, đều gọi lại `onLicenseFilterChange`).
  - **`buildLicenseRowHTML()`** (dựng từng dòng danh sách): **3 điểm** — nút mở/thu gọn các phiên bản
    cùng 1 giấy phép (`toggleLicenseFamily`), nút "✅ Duyệt"/"📋 Chi tiết" (`runLicenseAction`, tham số
    `'approve'`/`'view'`).
  - **`viewLicenseDetails()`** (đổ nội dung vào `#licenseDetailBody` của modal chi tiết): **2 điểm** — nút
    "👁️ Xem"/"⬇️ Tải" từng phiên bản file (`viewLicenseFile`/`downloadLicenseFile`).
  - **`#licenseDetailModal`** (modal chi tiết & lịch sử phiên bản, sống NGOÀI `#licenseSection`): **2
    điểm** — nút X ở header + nút "Đóng" ở footer (đều `closeLicenseDetailModal`).
- **Không có wrapper mới nào cần thiết** — toàn bộ 16 điểm map thẳng vào `data-op`/`data-op-change`/
  `data-op-submit` với tham số positional đơn giản, không có `this.checked`/multi-statement/expression
  không map được vào slot có sẵn.
- **Không đụng danh mục "Loại Giấy Phép"** (`saveLicenseType`/`deleteLicenseType`/`renderLicenseTypeList`,
  render vào `#licenseTypeList`) — khu vực này nằm vật lý trong cụm Quản Trị/Hệ Thống (`#systemSection`)
  và đã được chuyển sang `data-op` từ đợt 13, xác nhận lại lúc scoping đợt này (0 handler raw còn sót),
  không thuộc phạm vi module Giấy Phép.
- **2 gốc `bindCspDelegation`**: `licenseSection` (form + danh sách) và `licenseDetailModal` (modal chi
  tiết, xác nhận là sibling DOM sống ngoài section, giống mẫu Xe/Vận Hành/Đào Tạo/Đồng Phục các đợt trước).
- **Không phát hiện lỗi thật nào trong lúc demo module này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo cùng toàn bộ dữ liệu demo tạo ra trong lúc test — `licenses` nằm trong
  `MIGRATED_COLLECTIONS`, xoá bằng `deleteRecordById()`, tài khoản demo xoá bằng
  `withLockedAppDataValue('users', ...)`): đăng nhập, mở Giấy Phép; tải lên 1 giấy phép mới (điền đủ công
  ty/địa điểm/loại/số GP/ngày cấp-hết hạn/cơ quan cấp + file PDF); bấm "✅ Duyệt" trên dòng vừa tạo — mở
  đúng `#genericConfirmModal` dùng chung, xác nhận, giấy phép chuyển "Đã duyệt"; bấm "📋 Chi tiết" — mở
  đúng `#licenseDetailModal`, hiện đúng lịch sử UPLOADED/APPROVED; bấm "👁️ Xem" file — mở đúng
  `#viewDocModal` (protected viewer dùng chung); đóng viewer, đóng modal chi tiết qua nút X — cả 2 modal
  đóng đúng, không còn hiện. Toàn bộ đúng, không có lỗi JS console mới liên quan tới thay đổi (chỉ 3 lỗi
  mạng nền quen thuộc trước lúc đăng nhập: chặn Google Fonts, `/api/auth/me` 401 lúc chưa đăng nhập,
  `/api/captcha` 404 do CAPTCHA chưa bật ở môi trường demo — cùng 3 lỗi y hệt các đợt trước, không liên
  quan tới module này).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`), gồm cả `tests/test-license.js` (riêng cho
  module này) — 44/46 OK, đúng 2 file known-flaky quen thuộc (`test-audit-fixes-batch1.js`/
  `test-audit-round2-cluster1.js`, timeout hạ tầng test không liên quan thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Tuyển Dụng, Tin Tức/Truyền Thông (bao gồm cả form "HCRC Đồng Hành" phía nhân viên —
`#hrFeedbackForm`), Biên Bản Họp, Công Việc, Văn Bản Trình, Tài Liệu, Báo Cáo Định Kỳ... — dùng hạ tầng
`data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit + demo + regression trước
khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 15/N — module Đồng Phục

Tiếp tục đợt 14 (Hỗ Trợ IT, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển toàn bộ module **Đồng
Phục** (`#uniformSection` — 5 sub-tab Kỳ Cấp Phát/Xác Nhận-Cấp Phát/Kho Đồng Phục/Tổng Quan/Quản Lý Nhân
Viên Siêu Thị trong 1 lần, không có modal nào sống ngoài section):

- **45 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`, chia theo sub-tab:
  - **5 nút chuyển sub-tab** dùng chung 1 thanh tab (`setUniformSubTab`).
  - **📦 Kỳ Cấp Phát** (`#uniformSubPeriods` + hàm render `renderUniformCatalogList`/
    `renderUniformAllocationBlocks`/`renderUniformPeriodsList`): **15 điểm** — nút "+ Thêm" Danh Mục Đồng
    Phục (`saveUniformCatalogItem`), nút Xóa từng mặt hàng danh mục, khối "Tạo Kỳ Cấp Phát" (nút "+ Thêm
    Siêu Thị"/"Tạo Kỳ Cấp Phát", ô tìm-siêu-thị theo khối phân bổ `resolveUniformAllocDeptInput`, nút "✕
    Bỏ siêu thị này", 3 ô chọn mặt hàng/size/số lượng + nút xoá dòng + nút "+ Thêm dòng mặt hàng" trong
    từng khối), ô lọc trạng thái kỳ cấp phát, 3 nút Duyệt/Từ Chối/Xóa trên từng kỳ trong danh sách.
  - **✅ Xác Nhận / Cấp Phát** (`#uniformSubStore` + hàm render `renderUniformPendingAllocations`/
    `renderUniformIssueItems`/`renderUniformHoldingsTable`/`renderUniformAdjEmpItemOptions`/
    `renderUniformTransferApprovalQueue`/`renderUniformTransfersTable`): **18 điểm** — nút "✅ Xác Nhận Đã
    Nhận" từng phần phân bổ đang chờ, khối "Cấp Đồng Phục Cho Nhân Viên" (ô tìm nhân viên
    `resolveUniformEmployeeInput`, nút "+ Thêm Mặt Hàng", chọn mặt hàng/size + số lượng + nút xoá dòng
    trong từng dòng cấp, nút "Cấp Phát"), 3 nút thao tác "Thu Hồi/Báo Hỏng/Báo Mất" trên bảng "Đồng Phục
    Nhân Viên Đang Giữ" (`openUniformHoldingActionModal(idx, outcome)`), khối "Báo Hỏng/Hủy (Từ Kho)" (nút
    submit), khối "Thu Hồi Từ Nhân Viên" (ô tìm nhân viên + dropdown size, nút submit), khối "Điều Chuyển
    Kho" giữa các siêu thị (nút "Gửi Yêu Cầu Điều Chuyển", ô lọc trạng thái lịch sử, 2 nút Duyệt/Từ Chối
    trên từng yêu cầu đang chờ).
  - **📊 Kho Đồng Phục** (`#uniformSubStock` + hàm render `renderUniformStock`): **2 điểm** — ô lọc theo
    tên siêu thị (`oninput`), nút mở/thu gọn chi tiết từng dòng tồn kho (`toggleUniformStockDetail`).
  - **📈 Tổng Quan**: **1 điểm** — nút "📥 Xuất Excel" (`exportUniformDashByStoreExcel`); phần còn lại của
    dashboard thuần hiển thị, không có control nào khác.
  - **🧑‍💼 Quản Lý Nhân Viên Siêu Thị** (`#uniformSubEmployees`): **4 điểm** — form tạo tài khoản nhân
    viên siêu thị (`submitUniformEmployeeCreate(event)`), ô tìm kiếm + checkbox "Hiện cả tài khoản đã
    khoá" (đều gọi lại `renderUniformEmployeesList`), nút "🔒 Khoá" trên từng nhân viên trong bảng.
- **1 wrapper mới** cho trường hợp `oninput` gọi 2 hàm liền (`oninput="resolveUniformEmployeeInput(...);
  renderUniformAdjEmpItemOptions();"` ở ô "Nhân Viên" của khối Thu Hồi Từ Nhân Viên) — `data-op-seq` chỉ
  được `bindCspDelegation()` xử lý ở sự kiện click, không có ở input/change, nên gộp thành 1 hàm
  `resolveUniformAdjEmpEmployeeInputAndRefresh(inputId, hiddenId)` đặt ngay cạnh
  `resolveUniformEmployeeInput()` gốc, dùng với `data-op-input`. Không có trường hợp `this.checked` nào
  trong phạm vi module này (không cần thêm wrapper `FromCheckbox`).
- **1 điểm converter không tự xử lý đúng, sửa tay**: `onclick="toggleUniformStockDetail('${escapeHtml(
  r.dept)}', '${escapeHtml(r.name)}', '${escapeHtml(r.size || '')}')"` — tham số thứ 3 chứa `||
  ''` (chuỗi rỗng dự phòng) khiến converter không nhận ra đây là 1 chuỗi bọc ngoài do có dấu nháy đơn lồng
  bên trong, giữ nguyên cả dấu nháy trong giá trị `data-arg2` (sai — sẽ biến `size` thành chuỗi có literal
  dấu nháy thay vì rỗng) — sửa tay thành `data-arg2="${escapeHtml(r.size || '')}"` không bọc nháy.
- **1 gốc `bindCspDelegation`**: `uniformSection` — cả 5 sub-tab đều render trong section này. 3 nút thao
  tác "Thu Hồi/Báo Hỏng/Báo Mất" (`openUniformHoldingActionModal()`) KHÔNG mở modal riêng của module — dùng
  chung `showConfirmModal()`/`#genericConfirmModal` (đã bọc sẵn ở cụm Quản Trị/Hệ Thống, đợt 13, dùng
  chung toàn hệ thống) nên không cần thêm gốc thứ 2.
- Tra riêng `renderUniformReportExtra()` (hàm hiển thị thống kê Đồng Phục trong tab report-detail của
  module Báo Cáo, đã chuyển từ đợt 11) — hàm này chỉ dựng 1 bảng thống kê thuần hiển thị (siêu thị/mặt
  hàng/size/đã nhận/đã cấp/tồn kho), không có control tương tác nào, không có gì cần chuyển ở đây.
- **Không phát hiện lỗi thật nào trong lúc demo module này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo cùng toàn bộ dữ liệu demo tạo ra trong lúc test — kỳ cấp phát/phiếu cấp/điều chỉnh
  tồn kho lưu SQL qua `dbo.Records` [`uniformPeriods`/`uniformIssuances`/`uniformStockAdjustments` đều nằm
  trong `MIGRATED_COLLECTIONS`, xoá bằng `deleteRecordById()`], còn tài khoản demo + siêu thị demo thêm vào
  Danh Mục Siêu Thị nằm ở AppData JSON blob thường [`users`/`stores`], xoá bằng `withLockedAppDataValue()`):
  đăng nhập, mở Đồng Phục; sub-tab Kỳ Cấp Phát — thêm 1 siêu thị demo vào Danh Mục Siêu Thị, tạo 1 kỳ cấp
  phát (chọn siêu thị qua ô tìm-kiếm-gõ-chọn, chọn mặt hàng/size từ Danh Mục Đồng Phục có sẵn, nhập số
  lượng), duyệt kỳ vừa tạo; sub-tab Xác Nhận/Cấp Phát — xác nhận đã nhận phần phân bổ, tạo 1 tài khoản
  nhân viên siêu thị demo qua sub-tab Quản Lý Nhân Viên Siêu Thị rồi quay lại cấp 1 mặt hàng cho nhân viên
  đó, bấm "↩️ Thu Hồi" trên bảng "Đồng Phục Nhân Viên Đang Giữ" (mở đúng `#genericConfirmModal` dùng
  chung, nhập lý do, xác nhận); sub-tab Kho Đồng Phục — mở/thu gọn chi tiết 1 dòng tồn kho; sub-tab Tổng
  Quan — xem dashboard render đúng. Toàn bộ đúng, không có lỗi JS console mới liên quan tới thay đổi (chỉ
  3 lỗi mạng nền quen thuộc trước lúc đăng nhập: chặn Google Fonts, `/api/auth/me` 401 lúc chưa đăng nhập,
  `/api/captcha` 404 do CAPTCHA chưa bật ở môi trường demo — cùng 3 lỗi y hệt các đợt trước, không liên
  quan tới module này).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`), gồm cả `tests/test-uniform.js` và
  `tests/test-uniform-phase2.js` (riêng cho module này) — 44/46 OK, đúng 2 file known-flaky quen thuộc
  (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, timeout hạ tầng test không liên quan thay
  đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Giấy Phép, Tuyển Dụng, Tin Tức/Truyền Thông (bao gồm cả form "HCRC Đồng Hành" phía nhân viên
— `#hrFeedbackForm`), Biên Bản Họp, Công Việc, Văn Bản Trình, Tài Liệu, Báo Cáo Định Kỳ... — dùng hạ tầng
`data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit + demo + regression trước
khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 14/N — module Hỗ Trợ IT

Tiếp tục đợt 13 (Quản Trị/Hệ Thống, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển toàn bộ module **Hỗ
Trợ IT** (`#itSupportSection` — 3 sub-tab Phê Duyệt Giá/Hỗ Trợ Yêu Cầu/Gia Hạn Dịch Vụ CNTT trong 1 lần,
cộng modal dùng chung "Gán vai trò cột" `#colRoleModal` nằm vật lý bên trong section này dù thuộc về Mẫu
Ngân Sách, và 4 modal xử lý/chi tiết sống ngoài section):

- **56 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`, chia theo 3 sub-tab + modal:
  - **🏷️ Phê Duyệt Giá** (`#itSubPrice` + hàm render `renderItPriceMasterListAdmin`/`renderItPriceApprovals`/
    `renderItPriceModalControls`): **31 điểm** — 3 nút chuyển sub-tab (`setItSupportSubTab`), nút "+ Thêm
    Mẫu Giá", 2 nút Hủy/Xác nhận của `#colRoleModal`, form nộp đề xuất (`submitItPriceApproval`), chọn Mẫu
    Giá + tải tệp bảng giá (nhận `event` qua `data-arg-event`), 3 ô lọc (trạng thái/từ ngày/đến ngày/từ
    khoá), 3 nút CRUD Mẫu Giá (Đổi tên/Thay mẫu/Xoá) trong bảng admin, nút "Chi tiết" mở `#itPriceModal`,
    toàn bộ nút xử lý theo vai trò/trạng thái trong modal chi tiết (Duyệt Huỷ Hồ Sơ/Từ Chối Yêu Cầu
    Này/Từ Chối Khẩn/Duyệt/Từ chối/Yêu Cầu Bổ Sung ×2/Tôi Đang Xử Lý/Xác nhận đã áp giá/Huỷ Nhận Xử Lý/Gửi
    Tệp Bổ Sung/Xóa), ô chọn tệp bổ sung (nhận cả `event` lẫn `masterListId` — 2 slot vị trí khác nhau
    trong cùng 1 lệnh gọi), 1 điểm `event.stopPropagation()` trên link "Tải file gốc" trong `<summary>`
    (chặn nổi bọt để không đóng/mở nhầm khối `<details>` khi bấm link).
  - **🎫 Hỗ Trợ Yêu Cầu** (`#itSubTicket` + hàm render `renderItTickets`/`renderItTicketModal`): **19 điểm**
    — form gửi yêu cầu (`submitItTicket`), 3 ô lọc (trạng thái/danh mục/từ khoá), nút "Xem/Xử lý" mở
    `#itTicketModal`, toàn bộ nút điều khiển trong modal (Duyệt/Từ chối leo thang, Nhận Xử Lý, Gửi/Gửi Lại
    Yêu Cầu Phê Duyệt, Gửi phê duyệt, Huỷ form leo thang, Cập Nhật trạng thái, Hủy Yêu Cầu), Đóng ×2, ô
    bình luận + nút Gửi.
  - **🔔 Gia Hạn Dịch Vụ CNTT** (`#itSubRenewal` + 2 modal `#itRenewalRenewModal`/`#itRenewalEditModal`
    sống ngoài section + hàm render `buildItServiceRenewalRowHTML`): **6 điểm** — form thêm dịch vụ
    (`submitItServiceRenewal`), 2 ô lọc (hiệu lực/loại dịch vụ) + 1 ô từ khoá, nút "🔄 Gia Hạn" trong hàng
    render động, Đóng/Xác Nhận của modal Gia Hạn, Hủy/Lưu Thay Đổi của modal Sửa.
- **3 hàm bọc nhỏ mới** cho các trường hợp hạ tầng `data-arg*` có sẵn không xử lý thẳng được:
  - **1 wrapper dùng chung mới cho `event.stopPropagation()`**: `stopEventPropagation(e)` — trường hợp
    chưa từng gặp (`onclick="event.stopPropagation()"` không phải lệnh gọi hàm có tên, converter không tự
    map được), đặt cạnh hạ tầng `cspCoerceArg`/`bindCspDelegation()` để module sau cũng dùng lại được nếu
    gặp cùng mẫu (kết hợp `data-arg-event="0"` để nhận đúng `Event` thật).
  - **2 wrapper mới** cho khối gán biến cờ + gọi hàm render liền nhau (`onclick="showItTicketEscalateForm
    = true; renderItTicketModal();"` / `= false; ...`) — không phải lệnh gọi hàm đơn nên converter không
    nhận diện được (khác `data-op-seq`, vốn chỉ nhận chuỗi lệnh gọi hàm literal-arg, không nhận phép gán):
    `openItTicketEscalateForm()`/`closeItTicketEscalateForm()`, đặt ngay cạnh khai báo biến
    `showItTicketEscalateForm`.
  - Không có trường hợp `this.checked` nào trong phạm vi module này (không cần thêm wrapper
    `FromCheckbox`); không dùng `data-op-seq` (không có nút gọi nhiều lệnh liền dạng `fn1();fn2()`).
- **5 gốc `bindCspDelegation`**: `itSupportSection` (bọc cả section lẫn `#colRoleModal` — modal dùng chung
  "Gán vai trò cột" cho Mẫu Ngân Sách nhưng nằm vật lý trong section này) + 4 modal sống ngoài section:
  `itTicketModal`, `itPriceModal` (cả 2 nằm chung khu modal với Ngân Sách phía dưới HTML),
  `itRenewalRenewModal`, `itRenewalEditModal` — cũng tranh thủ cập nhật lại chú thích cũ ở gốc
  `systemSection` (đợt 13) đang nói `#colRoleModal` "chưa tới lượt CSP" cho khớp thực tế.
- **Không phát hiện lỗi thật nào trong lúc demo module này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo, kể cả 1 yêu cầu hỗ trợ IT + 1 dịch vụ CNTT demo tạo ra trong lúc test — cả 2
  collection này lưu SQL qua `dbo.Records`, xoá bằng `deleteRecordById()` chứ không phải đường AppData):
  đăng nhập, mở Hỗ Trợ IT; sub-tab Hỗ Trợ Yêu Cầu — tạo 1 yêu cầu demo, mở modal chi tiết (`#itTicketModal`,
  gốc ngoài section), gửi 1 bình luận (xác nhận `data-op` hoạt động cả trong modal ngoài); sub-tab Gia Hạn
  Dịch Vụ CNTT (chỉ IT/admin thấy) — thêm 1 dịch vụ demo, mở modal "Gia Hạn" (`#itRenewalRenewModal`, gốc
  ngoài section riêng), đóng lại, mở modal "Sửa" qua dropdown "Khác ▾" (`#itRenewalEditModal`, gốc ngoài
  section khác) — xác nhận cả 2 modal Gia Hạn/Sửa dùng 2 gốc CSP riêng đều hoạt động; gọi trực tiếp
  `openColumnRoleMappingModal()` qua console (mô phỏng đúng luồng gọi thật từ Mẫu Ngân Sách vì cần tải file
  Excel thật mới trigger được từ UI) để xác nhận riêng `#colRoleModal` — nút "Xác nhận" (`confirmColRoleModal`)
  chạy đúng logic validate gán trùng vai trò cột, nút "Hủy" (`closeColRoleModal(null)`) đóng modal đúng —
  cả 2 đều qua gốc `itSupportSection` dù không mở từ chính UI Hỗ Trợ IT; sub-tab Phê Duyệt Giá — mở form
  đề xuất (chưa có Mẫu Giá nào cấu hình sẵn ở môi trường demo nên chưa test được bước nộp tệp/mở
  `#itPriceModal` qua UI, nhưng cùng khuôn `data-op`/`data-op-change` với Hỗ Trợ Yêu Cầu/Gia Hạn đã xác
  nhận hoạt động đúng) — toàn bộ đúng, không có lỗi JS console mới liên quan tới thay đổi (chỉ có 3 lỗi
  mạng nền quen thuộc trước lúc đăng nhập: chặn Google Fonts, `/api/auth/me` 401 lúc chưa đăng nhập,
  `/api/captcha` 404 do CAPTCHA chưa bật ở môi trường demo — xác nhận riêng bằng 1 lượt chạy baseline
  không đụng gì tới module này, cùng 3 lỗi y hệt xuất hiện ngay từ bước tải trang/đăng nhập).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`), gồm cả `tests/test-it-support.js` (riêng cho
  module này) — 44/46 OK, đúng 2 file known-flaky quen thuộc (`test-audit-fixes-batch1.js`/
  `test-audit-round2-cluster1.js`, timeout hạ tầng test không liên quan thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Đồng Phục, Giấy Phép, Tuyển Dụng, Tin Tức/Truyền Thông (bao gồm cả form "HCRC Đồng Hành" phía
nhân viên — `#hrFeedbackForm`), Biên Bản Họp, Công Việc, Văn Bản Trình, Tài Liệu, Báo Cáo Định Kỳ... — dùng
hạ tầng `data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit + demo + regression
trước khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 13/N — module Quản Trị/Hệ Thống

Tiếp tục đợt 12 (Nhân Sự, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển toàn bộ cụm **Quản Trị/Hệ
Thống** (`#systemSection`) trong 1 lần thay vì tách 3 lần như dự kiến ban đầu (Quản Trị Nội Dung/Biểu
Mẫu, Quy Trình & Phê Duyệt, Hệ Thống-Admin/Log/Thùng Rác) — cả 6 màn con của tab "🛠️ Hệ Thống" đều đã
được gộp làm CON trực tiếp của `#systemSection` từ 1 lần fix trước đó (để thanh tab con sticky khi cuộn),
nên gộp chung vừa đúng phạm vi vừa chỉ cần đúng 1 gốc CSP:

- **148 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`, chia theo 6 sub-tab:
  - **⚙️ Quản Trị** (`#adminSection` — thanh sub-tab con 4 mục + 4 khối Cấu Hình Email/Quản Lý Danh
    Mục/Phân Quyền/API Xác Thực Ngoài): **96 điểm** — form lưu SMTP + nút test gửi mail, nút chọn kiểu
    mã hoá SMTP, toàn bộ CRUD danh mục (Phòng ban, Siêu thị, Chức danh, Chức danh siêu thị, Loại Giấy
    Phép, Loại Hợp Đồng, Danh mục tài liệu, Từ khoá nhạy cảm, Danh mục đào tạo), form Thêm/Sửa Người
    Dùng + cây phân quyền (mọi nhóm quyền ALL/theo phòng ban qua `toggleScopeGroup`), danh sách Nhóm
    Phân Quyền, danh sách Người Dùng (Sửa/Xoá/Khoá-Mở), Nhóm Phê Duyệt Văn Bản Trình/Hợp Đồng, Nhóm Loại
    Trừ VPP, tạo/thu hồi API Key ngoài, gỡ thiết bị WebAuthn/TOTP hộ người dùng khác.
  - **🔄 Quy Trình & Phê Duyệt** (`#workflowSection`): **24 điểm** — chuyển đổi module quy trình (13 nút
    `switchWfModule`), form tạo/sửa mẫu quy trình phê duyệt, danh sách mẫu quy trình (Sửa/Xoá), cấu hình
    quy trình theo từng phòng ban + đơn vị tham gia quy trình.
  - **📋 Biểu Mẫu** (`#formSection`): **11 điểm** — chuyển tab loại biểu mẫu, form thêm trường tuỳ biến,
    bảng trường (di chuyển thứ tự, sửa nhãn/bắt buộc trường mặc định, sửa/xoá trường tuỳ biến).
  - **📊 Log** (`#logSection`): **7 điểm** — 3 dropdown lọc (Phân Hệ/Sự Kiện/Trạng Thái), ô tìm kiếm, nút
    Đặt Lại, Xoá Log, Xuất Log Excel.
  - **📎 Quản Lý Tệp File** (`#uploadTypeSection`): **2 điểm** — checkbox loại tệp cho phép theo module,
    ô giới hạn dung lượng riêng.
  - **🗑️ Thùng Rác** (`#trashSection`): **2 điểm** — nút Khôi phục/Xoá vĩnh viễn trong hàm render động
    (không có điểm tĩnh — toàn bộ nội dung do `renderTrashList()` sinh ra).
  - Thanh chuyển sub-tab con "🛠️ Hệ Thống" (6 nút `setSystemSubTab`) tính chung vào nhóm Quản Trị ở trên.
- **4 hàm bọc nhỏ mới** cho các trường hợp hạ tầng `data-arg*` có sẵn không xử lý thẳng được:
  - **3 wrapper `FromCheckbox`** (đọc `checkboxEl.checked` qua `data-arg-el`, đúng mẫu
    `updateBudgetTemplateFieldRequiredFromCheckbox` đã dùng ở đợt Ngân Sách):
    `toggleUploadTypeExtFromCheckbox`, `updateCoreFieldOverrideFromCheckbox`,
    `toggleStoreJobTitleRestrictedFromCheckbox`.
  - **1 wrapper `FromInput` mới** (trường hợp chưa từng gặp): ô sửa nhãn trường mặc định trước đây tính
    fallback ngay trong `oninput` (`this.value.trim() || '<nhãn gốc>'`) — biểu thức JS, không phải lệnh
    gọi hàm đơn nên converter không nhận diện được; viết `updateCoreFieldOverrideLabelFromInput(coreKey,
    fieldId, defaultLabel, inputEl)` nhận `defaultLabel` qua `data-arg2` rồi tự tính fallback từ
    `inputEl.value` qua `data-arg-el`.
  - **2 chỗ chỉnh hàm gốc thay vì chỉ thêm wrapper**: nút "Tôi đã lưu lại, đóng hộp này" (API Key vừa
    tạo) trước đây gọi thẳng `document.getElementById(...).classList.add(...)` trong `onclick` — không
    phải lệnh gọi hàm đơn, tách thành hàm `closeExtApiKeyRevealBox()` riêng; nút "Thu hồi" API Key trước
    đây truyền cả `name` qua tham số với `.replace(/'/g, "\\'")` để escape nháy đơn cho ngữ cảnh JS-string
    inline — chuỗi tên key tự do (Q. Reserved) không escape an toàn được cho thuộc tính HTML kiểu
    `data-argN`, nên đổi `revokeExternalApiKeyAction(id, name)` thành chỉ nhận `id` và tự tra `name` từ
    `DB.externalApiKeys` bên trong hàm (cùng khuôn `editExternalApiKeyAllowedIpsAction()` đã làm).
  - Không dùng `data-op-seq` lần này — không có nút nào gọi nhiều lệnh liền (`onclick="fn1();fn2()"`)
    trong phạm vi cụm này.
- **Chỉ cần thêm đúng 1 gốc** `bindCspDelegation('systemSection')` — cả 6 sub-tab con đều render bên
  trong `#systemSection` (không phải anh em ngoài section như hầu hết modal ở các module trước). Không
  đụng tới modal "Gán vai trò cột" (`#colRoleModal`, `openColumnRoleMappingModal()`) dù được gọi từ Mẫu
  Ngân Sách/Biểu Mẫu — modal này nằm VẬT LÝ trong `#itSupportSection` (module Hỗ Trợ IT, chưa tới lượt),
  và không đụng `#genericConfirmModal` (modal xác nhận dùng chung toàn hệ thống, không riêng cụm này) —
  để lại cho đúng lượt/đợt dọn hạ tầng dùng chung sau.
- **Không phát hiện lỗi thật nào trong lúc demo module này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo): đăng nhập, mở Hệ Thống > Quản Trị > Phân Quyền (mở rộng cây quyền, tick/bỏ tick
  1 nhóm ALL, lọc danh sách người dùng), tab Quản Lý Danh Mục, tab Cấu Hình Email (đổi kiểu mã hoá SMTP),
  tab API Xác Thực Ngoài; chuyển Biểu Mẫu (đổi tab loại biểu mẫu, mở khối sửa trường mặc định, gõ trực
  tiếp vào ô sửa nhãn + tick/bỏ tick "Bắt buộc" — xác nhận cả 2 wrapper `FromInput`/`FromCheckbox` mới
  hoạt động đúng, giá trị đổi ngay trên bảng); chuyển Quy Trình & Phê Duyệt (chuyển module con "QT Đăng
  Ký Xe"); chuyển Quản Lý Tệp File (tick/bỏ tick 1 loại tệp, đổi giới hạn dung lượng — xác nhận log hệ
  thống ghi đúng `UPDATE_UPLOAD_TYPE_CONFIG`/`UPDATE_UPLOAD_SIZE_LIMIT`); chuyển Log (lọc theo Phân Hệ,
  xác nhận bảng lọc đúng); chuyển Thùng Rác (danh sách hiện đúng, không bấm Khôi phục/Xoá vĩnh viễn vào
  dữ liệu thật của module khác) — toàn bộ đúng, không có lỗi JS console mới liên quan tới thay đổi (chỉ
  có vài lỗi mạng nền quen thuộc trước lúc đăng nhập: chặn Google Fonts, `/api/auth/me` 401 lúc chưa đăng
  nhập, `/api/captcha` 404 do CAPTCHA chưa bật ở môi trường demo — không liên quan ứng dụng/thay đổi).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 44/46 OK, đúng 2 file known-flaky quen
  thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, timeout hạ tầng test không liên
  quan thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Hỗ Trợ IT, Đồng Phục, Giấy Phép, Gia Hạn CNTT, Tuyển Dụng, Tin Tức/Truyền Thông (bao gồm cả
form "HCRC Đồng Hành" phía nhân viên — `#hrFeedbackForm`), Biên Bản Họp, Công Việc, Văn Bản Trình, Tài
Liệu, Báo Cáo Định Kỳ... — dùng hạ tầng `data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi
module 1 commit + demo + regression trước khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 12/N — module Nhân Sự (Quản Lý & Phản Hồi Ý Kiến)

Tiếp tục đợt 11 (Báo Cáo, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển nốt phần còn lại của module
**Nhân Sự** chưa chuyển ở đợt 10 (đợt đó mới chuyển sub-tab "🌳 Cơ Cấu Tổ Chức", còn sub-tab "🤝 Quản Lý &
Phản Hồi Ý Kiến" — `#hrSubFeedback`, màn Nhân Sự trả lời câu hỏi nhân viên gửi qua "HCRC Đồng Hành" —
chưa tới lượt):

- **2 điểm** `onclick`/`onchange` chuyển sang `data-op*`: dropdown lọc trạng thái (`onchange` →
  `renderHrFeedbackManage`), nút "Gửi Phản Hồi" trong hàm render động (`onclick` →
  `submitHrFeedbackResponse(${q.id})`).
- **Không cần thêm gốc mới** — cả 2 điểm đều nằm trong `#hrSection`, gốc `bindCspDelegation('hrSection')`
  đã bind sẵn từ đợt 10 (Cơ Cấu Tổ Chức) bọc chung mọi sub-tab của module Nhân Sự.
- Module Nhân Sự (`#hrSection`) coi như **đã xong hoàn toàn** — cả 2 sub-tab (Cơ Cấu Tổ Chức đợt 10 +
  Quản Lý & Phản Hồi Ý Kiến đợt này) đều không còn `onclick`/`onchange`/`oninput`/`onsubmit` thô.

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo, kể cả dữ liệu `hrFeedback` demo tạo ra trong lúc test): tạo 1 câu hỏi demo qua
  form nhân viên (Truyền Thông > HCRC Đồng Hành, module khác chưa tới lượt CSP), vào Nhân Sự > Quản Lý &
  Phản Hồi Ý Kiến, lọc theo trạng thái "Chờ phản hồi" (xác nhận `data-op-change` hoạt động), nhập nội
  dung và bấm "Gửi Phản Hồi" (xác nhận `data-op` hoạt động) — server trả về 200, câu hỏi chuyển đúng sang
  trạng thái "Đã phản hồi" — toàn bộ đúng, không có lỗi JS console mới liên quan tới thay đổi.
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 44/46 OK, đúng 2 file known-flaky quen
  thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, timeout hạ tầng test không liên
  quan thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Quản Trị/Hệ Thống, Hỗ Trợ IT, Đồng Phục, Giấy Phép, Gia Hạn CNTT, Tuyển Dụng, Tin Tức/Truyền
Thông (bao gồm cả form "HCRC Đồng Hành" phía nhân viên — `#hrFeedbackForm`), Biên Bản Họp, Công Việc, Văn
Bản Trình, Tài Liệu, Báo Cáo Định Kỳ... — dùng hạ tầng `data-op*`/`bindCspDelegation()` đã xây, làm tiếp
tuần tự mỗi module 1 commit + demo + regression trước khi merge, tới khi hết toàn bộ điểm mới gỡ
`unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 11/N — module Báo Cáo

Tiếp tục đợt 10 (Cơ Cấu Tổ Chức, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển module **Báo Cáo**
(`#reportsSection` — nav 2 cấp Tổng Hợp/theo từng module nghiệp vụ, khối "1. Tạo Báo Cáo Theo Yêu Cầu" +
"2. Tra Cứu Chi Tiết", cộng modal "Xem Trước" `#reportPreviewModal` sống ngoài section):

- **21 điểm** `onclick`/`onchange`/`oninput` chuyển sang `data-op*`:
  - **5 điểm** trong HTML tĩnh (nút Xuất Báo Cáo Excel, 2 ô ngày Từ/Đến, dropdown Phòng Ban, nút Đặt Lại
    Bộ Lọc).
  - **2 điểm** nút chuyển nav 2 cấp trong hàm render động (`selectReportsNavL1`/`selectReportsNavL2`).
  - **9 điểm** trong khối "🔍 2. Tra Cứu Chi Tiết" (`renderReportDetailSection`/
    `buildReportDetailFilterControlHTML`) — control lọc theo cột (select/number min-max/date từ-đến/text),
    nút Đặt lại bộ lọc, nút Xuất Excel (chi tiết), nút Xem Trước &amp; Xuất.
  - **1 điểm checkbox** chọn cột hiển thị (`onReportDetailColumnToggle(...,this.checked)`) — trường hợp
    `this.checked` chưa từng gặp nguyên dạng này (hạ tầng `data-arg*` không hỗ trợ đọc thẳng `this.checked`
    qua slot có sẵn) nên viết thêm 1 hàm bọc nhỏ `onReportDetailColumnToggleFromCheckbox(moduleKey, colKey,
    checkboxEl)` gọi lại hàm gốc với `checkboxEl.checked`, bind qua `data-arg-el="2"` — đúng mẫu đã dùng ở
    `updateBudgetTemplateFieldRequiredFromCheckbox` (đợt Ngân Sách).
  - **4 điểm** trong modal `#reportPreviewModal` (Đóng ×2, In, Xuất Excel) — modal này sống NGOÀI
    `#reportsSection` (giống các modal khác), cần thêm 1 gốc riêng.
  - Cần **2 gốc**: `bindCspDelegation('reportsSection')` (bọc cả thanh bộ lọc tĩnh lẫn toàn bộ nội dung
    động trong `#reportsContent`, kể cả `<details>` "Tra Cứu Chi Tiết" — cùng 1 container nên không cần
    thêm gốc riêng cho phần này) + `bindCspDelegation('reportPreviewModal')`.
- **Không phát hiện lỗi thật nào trong lúc demo module này** — khác với đợt 10 (Cơ Cấu Tổ Chức phát hiện
  lỗi dropdown dùng chung), lần này mọi thứ hoạt động đúng ngay từ đầu.

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo): mở Báo Cáo, đổi bộ lọc ngày, chuyển vào 1 module con (Tài Liệu), mở khối "Tra
  Cứu Chi Tiết", toggle 1 checkbox cột hiển thị (xác nhận đổi trạng thái true→false→true qua
  `onReportDetailColumnToggleFromCheckbox`), mở modal Xem Trước (hiển thị đúng nội dung theo bộ lọc/cột
  đã chọn), đóng modal, đặt lại bộ lọc chi tiết, xuất Báo Cáo Excel tổng hợp, đặt lại bộ lọc tổng — toàn
  bộ đúng, không có lỗi JS console mới liên quan tới thay đổi (chỉ có vài lỗi mạng nền của trình duyệt khi
  thử kết nối Google — không liên quan ứng dụng).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 44/46 OK, đúng 2 file known-flaky quen
  thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, timeout hạ tầng test không liên
  quan thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Nhân Sự, Quản Trị/Hệ Thống, Hỗ Trợ IT, Đồng Phục, Giấy Phép, Gia Hạn CNTT, Tuyển Dụng, Tin
Tức/Truyền Thông, Biên Bản Họp, Công Việc, Văn Bản Trình, Tài Liệu, Báo Cáo Định Kỳ... — dùng hạ tầng
`data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit + demo + regression trước
khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 10/N — module Cơ Cấu Tổ Chức

Tiếp tục đợt 9 (Ngân Sách, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển module **Cơ Cấu Tổ Chức**
(sub-tab "🌳 Cơ Cấu Tổ Chức" trong Nhân Sự — cây quản lý trực tiếp toàn công ty, modal "Đổi Quản Lý Trực
Tiếp") — module nhỏ nhất chuyển đổi từ trước tới nay, nhưng phát hiện kèm sửa 1 lỗi thật đáng kể trong
lúc demo:

- **10 điểm** `onclick`/`onchange` chuyển sang `data-op*`:
  - **2 điểm** nút chuyển sub-tab dùng chung cho cả `#hrSubFeedback`/`#hrSubOrgChart` (`setHrSubTab`) —
    chuyển luôn vì cùng gốc `#hrSection` sẽ dùng lại khi tới lượt module Nhân Sự, không tính thêm gốc mới.
  - **3 điểm** trong `#hrSubOrgChart` (Tải Mẫu Excel, Xuất Excel, Nhập Từ Excel).
  - **4 điểm** trong modal `#orgChartManagerModal` (Đóng ×2, Bỏ quản lý trực tiếp, Lưu).
  - **1 điểm** trong hàm render động `buildOrgChartNode()` (nút "✏️ Đổi quản lý" từng dòng cây).
  - Cần **2 gốc** `bindCspDelegation('hrSection')` + `bindCspDelegation('orgChartManagerModal')` — gốc
    `hrSection` bọc cả 2 sub-tab (kể cả `#hrSubFeedback` chưa chuyển, để dành đợt Nhân Sự sau).
- **Không phát hiện dạng cú pháp mới nào ngoài 5 loại đã biết** — cả 10 điểm đều convert máy móc thẳng,
  không cần helper mới.

**1 lỗi thật phát hiện + sửa trong lúc demo (không liên quan trực tiếp CSP, nhưng CHẶN demo module này)**:
nút "Đổi quản lý" mở modal, gõ tên tìm kiếm, dropdown gợi ý hiện đúng nội dung nhưng **KHÔNG BẤM CHỌN
ĐƯỢC** — dropdown gợi ý dùng chung `#systemUsersDatalist` (referenced qua `data-sdd-list=` từ RẤT NHIỀU
module khác: Đào Tạo, Vận Hành, Cơ Cấu Tổ Chức, mẫu Biên Bản Họp...) hoá ra được định nghĩa (duy nhất 1
lần) **NẰM BÊN TRONG `#minutesSection`** (module Biên Bản Họp) — `position:fixed` vẫn bị coi là
`display:none` khi ancestor `display:none` (đúng theo spec CSS, không phải bug trình duyệt), nên
`getBoundingClientRect()` trả về toàn 0 và không nhận click ở BẤT KỲ module nào khác ngoài lúc Biên Bản
Họp đang là tab mở — nội dung dropdown vẫn set đúng qua JS (`innerHTML`) nên trông như hoạt động, chỉ lộ
ra khi thực sự bấm chọn. `#carDriversDatalist` (dropdown lái xe, Đăng Ký Xe) nằm ngay cạnh, dính lỗi y
hệt. Sửa bằng cách di chuyển CẢ 2 div này ra ngay dưới `<body>` (luôn nằm trong cây render, không phụ
thuộc module nào đang mở) — đã xác nhận qua regression `test-meeting-car.js`/`test-minutes.js`/
`test-internal-training.js`/`test-org-chart-manager-visibility.js`/`test-orgchart-excel-import.js` đều
pass, không ảnh hưởng chức năng gốc của module Biên Bản Họp/Xe. Đây là lỗi có sẵn từ trước, phát hiện lần
đầu ở đợt này vì trước giờ demo các module khác tình cờ chưa test kỹ tương tác "gõ + bấm chọn gợi ý" khi
Biên Bản Họp KHÔNG phải tab đang mở.

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo): mở Nhân Sự > Cơ Cấu Tổ Chức, đổi quản lý trực tiếp 1 nhân viên qua modal (gõ +
  chọn đúng gợi ý — xác nhận lỗi trên đã hết), tải Mẫu Excel, Xuất Excel, chuyển qua lại 2 sub-tab — toàn
  bộ đúng, không có lỗi JS console mới.
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 44/46 OK, đúng 2 file known-flaky quen
  thuộc (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, timeout hạ tầng test không liên
  quan thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Báo Cáo, Nhân Sự, Quản Trị/Hệ Thống, Hỗ Trợ IT, Đồng Phục, Giấy Phép, Gia Hạn CNTT, Tuyển
Dụng, Tin Tức/Truyền Thông, Biên Bản Họp, Công Việc, Văn Bản Trình, Tài Liệu... — dùng hạ tầng
`data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit + demo + regression trước
khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 9/N — module Ngân Sách

Tiếp tục đợt 8 (Đào Tạo/LMS, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển module **Ngân Sách**
(3 sub-tab Ngân Sách Phê Duyệt/Ngân Sách Thực Hiện/Tổng Hợp, cộng modal "⚙️ Quản Lý Kỳ &amp; Mẫu" và modal
Xử Lý/Xem Chi Tiết):

- **44 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`, dùng lại đúng hạ tầng dùng
  chung (`cspDispatchOp`/`bindCspDelegation`) — không cần code hạ tầng mới:
  - **15 điểm** trong HTML tĩnh `#budgetSection` (3 nút chuyển sub-tab, nút mở modal Quản Lý Kỳ &amp; Mẫu,
    chọn kỳ ngân sách `onchange` + ô lọc trạng thái `onchange` cho cả 2 sub-tab PLAN/ACTUAL, nút Thêm dòng/
    Lưu Nháp/Gửi Duyệt, nút Tổng Hợp).
  - **10 điểm** trong modal `#budgetPeriodTemplateModal` ("Quản Lý Kỳ &amp; Mẫu") — sống **NGOÀI**
    `#budgetSection` (giống Xe/Vận Hành/Đào Tạo): 2 nút Đóng, form tạo kỳ (`onsubmit`), checkbox "Tất cả
    phòng ban", 2 ô chọn file Excel (`onchange` nhận tham số `event`), nút Thêm Mẫu/Thêm cột/Hủy, form lưu
    mẫu (`onsubmit`).
  - **2 điểm** trong modal `#budgetProcessModal` (2 nút Đóng, HTML tĩnh) — modal này cũng sống NGOÀI
    section.
  - **17 điểm** trong các hàm render động: nút "✕" xoá dòng/nút "✏️ Sửa Nháp"/"✍️ Xử lý / Duyệt"/"👁️ Xem
    chi tiết" (`renderBudgetEntryLinesTable`/`renderBudgetEntryList`), nút ▲▼ sắp xếp cột + ô nhập tên cột
    `oninput` + chọn kiểu cột `onchange` + ô nhập tuỳ chọn `oninput` + checkbox Bắt buộc `onchange` + nút
    xoá cột (`renderBudgetTemplateFieldsBuilder`), 3 nút In/Xuất Excel/Xuất PDF (`renderBudgetSummaryResult`),
    3 nút Từ Chối/Yêu Cầu Bổ Sung/Phê Duyệt trong modal xử lý (`openBudgetProcessModal`).
  - Cần **3 gốc** `bindCspDelegation('budgetSection')` + `bindCspDelegation('budgetPeriodTemplateModal')`
    + `bindCspDelegation('budgetProcessModal')` — cùng mẫu Xe/Vận Hành/Đào Tạo (2 modal sống ngoài section).
  - **Loại khỏi phạm vi**: `buildActionCell()`/`buildDashboardCardsHTML()` dùng chung (2 nút "Khác ▾" +
    thẻ dashboard bấm lọc trong `renderBudgetEntryList`) — vẫn dành cho 1 đợt riêng cuối cùng như các module
    trước; `oncontextmenu="return false"` bảo vệ nội dung Tổng Hợp (`renderBudgetSummaryResult`) — mẫu bảo
    vệ chống copy dùng chung toàn hệ thống, không thuộc 4 loại thuộc tính `onclick`/`onchange`/`oninput`/
    `onsubmit` trong phạm vi đợt CSP này.
- **1 dạng cú pháp nguồn** cần xử lý bằng helper (đã gặp ở đợt 8, lặp lại đúng mẫu): checkbox "Bắt buộc"
  của cột mẫu tuỳ biến dùng `onchange="...(idx, this.checked)"` — `this.checked` KHÔNG phải 1 trong 3 slot
  tham số đặc biệt được hỗ trợ (chỉ `data-arg-value`/`data-arg-el`/`data-arg-event`). Trước khi đổi, đã
  `grep -rn "updateBudgetTemplateField(" tests/` xác nhận `tests/test-office-budget.js` gọi thẳng
  `updateBudgetTemplateField(idx, 'label', value)` (chữ ký cũ `(idx, key, value)`, không dùng key
  `'required'`) — nên **giữ nguyên** chữ ký + logic hàm lõi `updateBudgetTemplateField()`, chỉ thêm 1 hàm
  mỏng mới `updateBudgetTemplateFieldRequiredFromCheckbox(idx, checkboxEl)` đọc `.checked` rồi gọi hàm lõi
  với key `'required'` — checkbox trong HTML đổi sang gọi hàm mỏng này qua `data-arg-el`.
- **Không phát hiện lỗi thật nào trong đợt này** (khác đợt 8 phát hiện + sửa lỗi `ttTakeSelectOption`) —
  `tests/test-office-budget.js` (bộ test hồi quy có sẵn, phủ khá đầy đủ luồng CRUD mẫu/kỳ/lập/duyệt/tổng
  hợp ngân sách) pass nguyên vẹn 54/54 kịch bản ngay từ lần chạy lại đầu tiên sau khi chuyển đổi.

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm `demo_budget`
  2FA thật, xoá lại ngay sau demo — cũng tạo tạm 1 mẫu ngân sách + 1 kỳ ngân sách + 2 bản ngân sách qua
  đúng luồng UI rồi xoá lại qua `deleteRecordForCollection()`, KHÔNG phải bug code): điều hướng Sidebar →
  Tổng Hợp → Ngân Sách, mở modal "⚙️ Quản Lý Kỳ &amp; Mẫu", tạo 1 mẫu ngân sách (thêm 1 cột tuỳ biến, đặt
  tên qua `oninput`, tick "Bắt buộc" qua checkbox `onchange` — xác nhận đúng giá trị `true` sau khi tick,
  chứng minh wrapper `data-arg-el` hoạt động đúng), tạo 1 kỳ ngân sách áp dụng tất cả phòng ban gắn mẫu vừa
  tạo, lập + Thêm dòng + Lưu Nháp + Gửi Duyệt 1 bản Ngân Sách Phê Duyệt (15.000.000đ) và 1 bản Ngân Sách
  Thực Hiện (13.500.000đ) cùng kỳ, mở modal Xử Lý/Xem Chi Tiết duyệt cả 2 bản (tài khoản demo có quyền
  admin nên tự duyệt được), qua tab Tổng Hợp chọn kỳ vừa tạo và xác nhận đúng cả 2 số tiền + khối "📌 Toàn
  Công Ty" hiển thị — toàn bộ đều đúng, không có lỗi JS console mới (3 lỗi console xuất hiện trong log —
  Google Fonts CDN bị chặn trong sandbox, `401` lúc `tryRestoreSession()` chưa đăng nhập, `404` tài nguyên
  không liên quan — đều là nhiễu môi trường sandbox có sẵn từ trước, không liên quan thay đổi lần này).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 44/46 OK, đúng 2 file known-flaky quen thuộc
  từ các đợt trước (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, timeout do đua tranh kết
  nối SQL Server ở hạ tầng test, không liên quan thay đổi lần này) — `tests/test-office-budget.js` xác nhận
  54/54 pass.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Cơ Cấu Tổ Chức, Báo Cáo, Nhân Sự, Quản Trị/Hệ Thống, Hỗ Trợ IT, Đồng Phục, Giấy Phép, Gia Hạn
CNTT, Tuyển Dụng, Tin Tức/Truyền Thông, Biên Bản Họp, Công Việc, Văn Bản Trình, Tài Liệu... — dùng hạ tầng
`data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit + demo + regression trước khi
merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 8/N — module Đào Tạo (LMS)

Tiếp tục đợt 7 (VPP, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển module **Đào Tạo** (Truyền Thông
Nội Bộ > Đào tạo — 9 sub-tab: Dashboard/Lớp Học/Chương Trình/Kế Hoạch Đào Tạo/Đăng Ký Của Tôi/Kho Tài
Liệu/Lộ Trình Thăng Tiến/Đào Tạo Tân Binh/Ngân Hàng Câu Hỏi, cộng 6 modal xử lý riêng) — module lớn và
phức tạp nhất chuyển đổi từ trước tới nay:

- **104 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`, dùng lại đúng hạ tầng
  dùng chung (`cspDispatchOp`/`bindCspDelegation`):
  - **33 điểm** trong HTML tĩnh `#internalTrainingLmsSection` (9 nút chuyển sub-tab, form tạo/sửa lớp
    học, form tạo bài test/khóa học/kế hoạch/tài liệu/lộ trình thăng tiến/đào tạo tân binh, các ô lọc
    dashboard, picker mời danh sách).
  - **21 điểm** trong 6 modal sống **NGOÀI** section (giống Xe/Vận Hành/VPP): `#trainingResultsModal`,
    `#trainingRosterModal`, `#trainingEditClassModal`, `#trainingTakeTestModal`, `#trainingClassQrModal`,
    `#trainingJoinClassModal`.
  - **~50 điểm** trong các hàm render động (`renderTrainingClasses`, `renderTestBuilderQuestions`,
    `renderTrainingMyRegs`, `renderTrainingDocuments`, `renderCareerPaths`, `renderOnboardingPaths`...).
  - Cần **7 gốc** `bindCspDelegation` — nhiều nhất từ trước tới nay (1 gốc section chính + 6 gốc modal),
    phản ánh đúng quy mô module (9 sub-tab, 6 modal riêng biệt).
  - **Loại khỏi phạm vi**: thanh tab cha "Truyền Thông" (đã chuyển ở đợt hạ tầng sidebar #704), màn cấu
    hình admin/Hệ Thống (Quản Lý Loại Đào Tạo...), module Tin Tức (sibling sub-tab dùng chung 1 số hàm
    tương tự nhưng thuộc phạm vi module khác).
- **5 dạng cú pháp nguồn** mà script chuyển đổi chung không xử lý tự động được, mỗi dạng xử lý bằng cách
  thêm hàm helper nhỏ trong nguồn (không sửa script chuyển đổi):
  1. Chuỗi gọi phương thức DOM nhiều bước (`document.getElementById(...).classList.add(...)`) — thêm
     `closeTrainingClassQrModal()`/`closeTrainingResultsModal()`.
  2. `oninput` sửa trực tiếp phần tử mảng/object (`tbQuestions[qi].text=this.value`) VÀ tái sử dụng hàm
     render có sẵn sẽ làm mất focus khi gõ (re-render mỗi phím) — thêm 3 hàm mới
     `tbSetQuestionText`/`tbSetQuestionPoints`/`tbSetOptionText` **cố tình KHÔNG** gọi lại
     `renderTestBuilderQuestions()`.
  3. `this.closest(...)` duyệt cây DOM + nhiều câu lệnh trong 1 `onclick` — thêm `removeCpStageRow(el)`.
  4. `onchange`/`oninput` nhiều câu lệnh (converter chỉ hỗ trợ chuỗi lệnh cho `onclick`) — thêm
     `onTrainingDocFilterCategoryChange()`.
  5. **Phát hiện giới hạn kiến trúc thật của hạ tầng CSP dùng chung**: `this.checked` KHÔNG phải 1 trong 3
     slot tham số đặc biệt được hỗ trợ (chỉ `data-arg-value`/`data-arg-el`/`data-arg-event` — xem chú
     thích trong `cspReadArgSlot`). Phát hiện qua đọc trực tiếp mã nguồn hạ tầng (không phải qua test
     fail) — nếu chuyển máy móc sẽ truyền chuỗi ký tự `"this.checked"` làm tham số, gây lỗi âm thầm. Xử
     lý bằng cách đổi 2 hàm checkbox `onchange` (`tbToggleCorrect`, `ttTakeSelectOption`) sang nhận phần
     tử qua `data-arg-el` rồi tự đọc `.checked` bên trong.
- **1 lỗi thật phát hiện qua chạy lại bộ test hồi quy** (không phải qua demo Playwright thủ công — demo
  chỉ đi qua các luồng admin/quản lý, không luyện qua bước làm bài test dạng chọn đáp án): đổi chữ ký
  `ttTakeSelectOption(optId, checkboxEl)` ở mục 5 phía trên làm vỡ 3 kịch bản trong
  `tests/test-internal-training.js` gọi thẳng `ttTakeSelectOption(optId, true)` (đúng chữ ký cũ nhận
  boolean, không qua checkbox DOM) — 3 bài test "làm bài test" bị chấm sai (FAILED thay vì PASSED). Sửa
  bằng cách tách lại thành 2 hàm: `ttTakeSelectOption(optId, checked)` giữ nguyên chữ ký cũ nhận boolean
  (test gọi thẳng hàm này), và thêm hàm mỏng `ttTakeToggleOptionFromCheckbox(optId, checkboxEl)` đọc
  `.checked` rồi gọi hàm trên — checkbox trong HTML đổi sang gọi hàm mỏng này qua `data-arg-el`. Chạy lại
  `tests/test-internal-training.js` xác nhận 49/49 kịch bản pass, chạy lại toàn bộ 46 file thấy lại đúng
  44/46 OK như kỳ vọng (2 file known-flaky bên dưới) trước khi merge.
- **`buildActionCell()`/`buildDashboardCardsHTML()`/`buildPaginationBoxHTML()`/`renderPeopleMultiSelect()`**
  tiếp tục KHÔNG đụng — vẫn dành cho 1 đợt riêng cuối cùng sau khi hết mọi module đơn lẻ.

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo — cũng seed tạm 1 "Loại Đào Tạo" cấu hình admin trống sẵn trong sandbox rồi xoá
  lại, KHÔNG phải bug code): tạo 1 bài test trong Ngân Hàng Câu Hỏi (thêm/xoá đáp án, tick đáp án đúng),
  tạo 1 lớp Online + 1 lớp Offline có gán bài test vừa tạo, mở đủ 6 modal từ dòng lớp Offline (Sửa/Kết
  Quả/Thêm Học Viên qua picker + Excel/Mã QR/Bắt Đầu Lớp), thêm rồi xoá 1 dòng cấp bậc trong Lộ Trình
  Thăng Tiến, đổi bộ lọc danh mục Kho Tài Liệu, duyệt đủ cả 9 sub-tab, xoá sạch dữ liệu demo — toàn bộ
  đúng, không có lỗi JS console mới (401/404/ERR_CONNECTION_RESET còn lại là nhiễu môi trường sandbox có
  sẵn từ trước, không liên quan thay đổi lần này).
- Chạy lại toàn bộ 46 file test hồi quy (`tests/test-*.js`) — 44/46 OK, đúng 2 file known-flaky quen
  thuộc từ đợt 7 (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, timeout do đua tranh
  kết nối SQL Server ở hạ tầng test, không liên quan thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Ngân Sách, Cơ Cấu Tổ Chức, Báo Cáo, Nhân Sự, Quản Trị/Hệ Thống, Hỗ Trợ IT, Đồng Phục, Giấy
Phép, Gia Hạn CNTT, Tuyển Dụng, Tin Tức/Truyền Thông, Biên Bản Họp, Công Việc, Văn Bản Trình, Tài Liệu... —
dùng hạ tầng `data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit + demo +
regression trước khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 7/N — module VPP (Văn Phòng Phẩm)

Tiếp tục đợt 6 (Phòng Họp, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển module **VPP** (đăng ký
Văn phòng phẩm, kỳ đăng ký, báo cáo tổng hợp — 3 sub-tab Đăng Ký/Kỳ Đăng Ký/Báo Cáo Tổng Hợp):

- **22 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`, dùng lại đúng hạ tầng dùng
  chung (`cspDispatchOp`/`bindCspDelegation`) — không cần code hạ tầng mới:
  - **13 điểm** trong HTML tĩnh `#vppSection` (3 nút chuyển sub-tab, chọn kỳ đăng ký `onchange`, tìm mặt
    hàng `oninput`, nút Lưu Nháp, ô lọc trạng thái `onchange`, ô Ngân sách/người `oninput`, ô chọn file
    danh mục `onchange` có tham số `event`, nút Tạo Kỳ Đăng Ký, chọn kỳ xem báo cáo `onchange`, 2 nút tải
    file Tổng Hợp/Tổng Quát Theo Phòng Ban).
  - **6 điểm** trong 2 hàm render động trong section: ô Số Lượng từng mặt hàng
    (`updateVppRegTotalDisplay` — `onVppRegPeriodChange()`), nút "✏️ Sửa Nháp"/"👁️ Xem chi tiết"/"✍️ Xử
    lý / Duyệt" (`editVppRegDraft`/`openVppRegModal` — `renderVppRegistrations()`); `renderVppPeriods()`
    xác nhận chỉ dùng `buildActionCell()` dùng chung, không đụng.
  - **3 điểm** trong modal Xử Lý Đăng Ký (`#vppRegModal`) — modal này sống **NGOÀI** `#vppSection` (giống
    Xe/Vận Hành): 2 nút Đóng (HTML tĩnh) + 3 nút Duyệt/Từ Chối/Bổ Sung do `openVppRegModal()` render động.
  - Cần **2 gốc** `bindCspDelegation('vppSection')` + `bindCspDelegation('vppRegModal')` — cùng mẫu Xe.
  - Phát hiện thêm 1 điểm **KHÔNG cần chuyển**: `submitBtn.onclick = () => submitVppRegDraftAction(...)`
    trong `onVppRegPeriodChange()` là gán trực tiếp property JS (`element.onclick = fn`), không phải
    thuộc tính HTML `onclick="..."` — vốn đã an toàn với CSP `unsafe-inline` bị gỡ, không phải sửa gì.
  - **Loại khỏi phạm vi (dành cho đợt Hệ Thống sau này)**: các hàm quản lý "Nhóm Quyền Đặc Biệt"
    (`renderVppExcludeGroupsAdmin`, `addVppExcludeGroupJobTitle`, `removeVppExcludeGroupJobTitle`,
    `addVppExcludeGroupRow`, `removeVppExcludeGroupRow`, `updateVppExcludeGroupField`,
    `renderUVppExcludeGroupsChecklist`) — thuộc màn hình cấu hình admin/Hệ Thống, không thuộc `#vppSection`.
- **`buildActionCell()`/`buildDashboardCardsHTML()`/`buildPaginationBoxHTML()`/`renderPeopleMultiSelect()`**
  tiếp tục KHÔNG đụng — vẫn dành cho 1 đợt riêng cuối cùng sau khi hết mọi module đơn lẻ.

**Không phát hiện lỗi phụ nào trong đợt này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo): điều hướng Sidebar → Hành Chính → Văn phòng phẩm, tạo kỳ đăng ký mới (đặt Ngân
  sách/người, upload file danh mục CSV — đọc đúng 3 mặt hàng), quay lại tab Đăng Ký, chọn kỳ vừa tạo, tìm
  mặt hàng theo từ khoá (lọc đúng), nhập số lượng cho 2 mặt hàng (tổng tiền cập nhật realtime đúng, so
  đúng với ngân sách/người), Lưu Nháp thành công, Gửi phê duyệt thành công (qua modal xác nhận chung), lọc
  danh sách theo trạng thái "Chờ duyệt", mở modal Xử Lý Đăng Ký từ danh sách, bấm Phê Duyệt (qua modal xác
  nhận chung, `withApprovalAuth` mức NONE nên chạy thẳng — không cần xác thực lại), chuyển tab Báo Cáo
  Tổng Hợp, chọn kỳ xem báo cáo, tải cả 2 file Excel (Tổng Hợp + Tổng Quát Theo Phòng Ban) — toàn bộ đều
  đúng, không có lỗi JS console mới (3 lỗi console xuất hiện trong log — Google Fonts CDN bị chặn trong
  sandbox, `401` trên `/api/auth/me` lúc chưa đăng nhập, `404` trên `/api/captcha` — đều là nhiễu môi
  trường sandbox có sẵn từ trước, xác nhận lại bằng 1 lượt tải trang trống độc lập không liên quan gì tới
  thay đổi lần này).
- Chạy lại toàn bộ 46 file test hồi quy hiện có (`tests/test-*.js`) — 44/46 OK. 2 file
  `test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js` lần này KHÔNG treo như các đợt trước mà báo
  FAIL ở đúng những kịch bản gọi `GET /api/data` thật tới SQL Server (lỗi "Login failed for user ''") —
  đã chạy lại độc lập từng file (không chung batch với 44 file kia) và tái hiện được y hệt cùng đúng 2
  kịch bản đó, xác nhận đây là bug hạ tầng test có sẵn từ trước (đua tranh kết nối/pool SQL Server khi
  test tự dựng thêm 1 server phụ), **không liên quan tới thay đổi lần này** — 2 file đã sửa
  (`public/index.html`, `server/package.json`) không đụng gì tới tầng kết nối SQL Server. Cùng 2 file này
  đã được ghi nhận có vấn đề hạ tầng từ đợt 2 (khi đó biểu hiện là treo lúc dọn dẹp thay vì FAIL).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Đào Tạo, Ngân Sách, Cơ Cấu Tổ Chức, Báo Cáo, Nhân Sự, Quản Trị/Hệ Thống, Hỗ Trợ IT, Đồng Phục,
Giấy Phép, Gia Hạn CNTT, Tuyển Dụng, Tin Tức/Truyền Thông, Biên Bản Họp, Công Việc, Văn Bản Trình, Tài
Liệu... — dùng hạ tầng `data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit + demo
+ regression trước khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 6/N — module Phòng Họp

Tiếp tục đợt 5 (Xe, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển module **Phòng Họp** (form đặt
lịch, lịch phòng dạng lưới, danh sách/lọc, nút Duyệt/Hủy):

- **11 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`, dùng lại đúng hạ tầng dùng
  chung (`cspDispatchOp`/`bindCspDelegation`) — không cần code hạ tầng mới:
  - **9 điểm** trong HTML tĩnh `#meetingSection` (2 nút chuyển sub-tab Đăng Ký/Lịch Họp, `onsubmit` form
    đặt phòng, 5 ô lọc danh sách, 1 ô chọn ngày xem lịch `onchange="renderMeetingCalendar()"`).
  - **2 điểm** trong `renderMeetings()` (nút "Duyệt" qua `approveMeeting()`, nút "Hủy" qua
    `runMeetingAction(id,'cancel')` — cả 2 cùng dùng `buildActionCell()` dùng chung, không đụng).
  - Chỉ cần **1 gốc** `bindCspDelegation('meetingSection')` — không có modal xử lý riêng ngoài section
    (khác Xe/Vận Hành): `approveMeeting()`/`cancelMeeting()` gọi thẳng API, không mở modal.
  - Lịch phòng dạng lưới (kéo-thả chọn nhiều khung giờ, tính năng đợt trước — xem mục "Meeting calendar:
    Outlook-style drag/Shift+click multi-slot select") đã dùng `addEventListener` từ trước, không có
    `onclick` cần chuyển.
- **`buildActionCell()`/`buildDashboardCardsHTML()`/`buildPaginationBoxHTML()`/`renderPeopleMultiSelect()`**
  tiếp tục KHÔNG đụng — vẫn dành cho 1 đợt riêng cuối cùng sau khi hết mọi module đơn lẻ.

**Không phát hiện lỗi phụ nào trong đợt này.**

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo): điều hướng Sidebar → Hành Chính → Phòng họp, chuyển qua tab Lịch Họp rồi đổi
  ngày xem lịch (lưới giờ/phòng cập nhật đúng), quay lại tab Đăng Ký, điền đầy đủ form đặt phòng (đơn vị,
  phòng họp, chủ đề, số người, thời gian, thiết bị, nội dung), gửi phê duyệt thành công (dialog "✅ Đã
  gửi đăng ký lịch phòng họp thành công!"), lọc theo trạng thái + từ khoá, bấm nút "Duyệt" trên dòng vừa
  tạo (chuyển đúng sang "✅ Đã duyệt lịch"), bấm nút "Hủy" (chuyển đúng sang "❌ Đã hủy lịch") — toàn bộ
  đều đúng, không có lỗi JS console mới. (Một lượt chạy demo thứ 2 còn xác nhận thêm: cơ chế chặn trùng
  giờ cùng phòng — tính năng nghiệp vụ có sẵn từ trước, không liên quan CSP — vẫn hoạt động đúng qua
  `data-op-submit` mới, báo lỗi rõ ràng khi thử đặt trùng giờ với lịch đã duyệt.)
- Chạy lại toàn bộ 46 file test hồi quy hiện có (`tests/test-*.js`) — pass 100% (2 file
  `test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js` treo lúc dọn dẹp sau khi đã chạy hết kịch
  bản — bug có sẵn từ trước, đã ghi nhận từ đợt 2, không liên quan gì tới thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** VPP, Đào Tạo, Ngân Sách, Cơ Cấu Tổ Chức, Báo Cáo, Nhân Sự, Quản Trị/Hệ Thống, Hỗ Trợ IT, Đồng
Phục, Giấy Phép, Gia Hạn CNTT, Tuyển Dụng, Tin Tức/Truyền Thông, Biên Bản Họp, Công Việc, Văn Bản Trình,
Tài Liệu... — dùng hạ tầng `data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module 1 commit +
demo + regression trước khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 5/N — module Xe (Đăng Ký Xe)

Tiếp tục đợt 4 (Thanh Toán, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển module **Xe** (form đăng
ký xe, lộ trình di chuyển, tab Lái Xe, danh sách/lọc, modal Xử Lý Đăng Ký Xe):

- **20 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` chuyển sang `data-op*`, dùng lại đúng hạ tầng dùng
  chung (`cspDispatchOp`/`bindCspDelegation`) — không cần code hạ tầng mới:
  - **9 điểm** trong HTML tĩnh `#carSection` (2 nút chuyển sub-tab Đăng Ký/Lái Xe, `onsubmit` form đăng
    ký, nút "+ Thêm Điểm" lộ trình, 5 ô lọc danh sách).
  - **5 điểm** trong 3 hàm render động: `renderCarRoutePoints()` (nhập/xoá từng điểm lộ trình),
    `renderCarDriverTab()` (nút "Xác Nhận Đăng Ký" của lái xe được phân công), `renderCarRegs()` (nút
    chính "Xử lý/Duyệt" hoặc "Xem chi tiết" — 2 nhánh cùng 1 hàm `runCarAction`).
  - **6 điểm** trong modal Xử Lý Đăng Ký Xe (`#carProcessModal`) — modal này sống **NGOÀI** `#carSection`
    (giống Vận Hành ở đợt 1), gồm 2 nút Đóng + ô nhập lái xe (HTML tĩnh) và 3 nút Duyệt/Từ Chối/Bổ Sung
    do `openCarProcessModal()` render động vào `#carModalActionBtns`.
  - Cần **2 gốc** `bindCspDelegation('carSection')` + `bindCspDelegation('carProcessModal')` — khác Hợp
    Đồng/Thanh Toán (chỉ 1 gốc) vì modal xử lý không nằm trong section, đúng mẫu đã dùng cho Vận Hành.
- **`buildActionCell()`/`buildDashboardCardsHTML()`/`buildPaginationBoxHTML()`/`renderPeopleMultiSelect()`**
  tiếp tục KHÔNG đụng — vẫn dành cho 1 đợt riêng cuối cùng sau khi hết mọi module đơn lẻ.

**Không phát hiện lỗi phụ nào trong đợt này** — khác các đợt trước (Hợp Đồng, Thanh Toán), demo lần này
không phát hiện thêm bug nghiệp vụ nào ngoài phạm vi CSP.

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo): điều hướng Sidebar → Hành Chính → Đăng Ký Xe, chuyển qua tab Lái Xe rồi quay
  lại, điền đầy đủ form đăng ký (đơn vị, loại xe, số người, mục đích, số KM, thời gian, mức độ ưu tiên),
  thêm 2 điểm lộ trình rồi xoá 1 điểm trống ở giữa (còn lại 3 điểm hợp lệ), gửi phê duyệt thành công
  (dialog "✅ Đã gửi phiếu đăng ký xe thành công!"), mở modal Xử Lý Đăng Ký Xe từ danh sách (hiện đúng
  thông tin phiếu + lộ trình + nút Duyệt/Từ Chối/Bổ Sung), điền thử ô Lái Xe, đóng modal — toàn bộ đều
  đúng, không có lỗi JS console mới.
- Chạy lại toàn bộ 46 file test hồi quy hiện có (`tests/test-*.js`) — pass 100% (2 file
  `test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js` treo lúc dọn dẹp sau khi đã chạy hết kịch
  bản — bug có sẵn từ trước, đã ghi nhận từ đợt 2, không liên quan gì tới thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — toàn bộ thay đổi nằm trong `public/index.html` (thuần client JS/HTML), deploy an toàn chỉ với copy
code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Phòng Họp, VPP, Đào Tạo, Ngân Sách, Cơ Cấu Tổ Chức, Báo Cáo, Nhân Sự, Quản Trị/Hệ Thống, Hỗ
Trợ IT, Đồng Phục, Giấy Phép, Gia Hạn CNTT, Tuyển Dụng, Tin Tức/Truyền Thông, Biên Bản Họp, Công Việc, Văn
Bản Trình, Tài Liệu... — dùng hạ tầng `data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi module
1 commit + demo + regression trước khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 4/N — module Thanh Toán + fix lỗi ẩn chặn âm thầm form thủ công

Tiếp tục đợt 3 (Hợp Đồng, xem mục "Trước đó" ngay bên dưới) — đợt này chuyển module **Thanh Toán** (form
tạo đề nghị thủ công, các đợt thanh toán, danh sách/lọc, sửa/xác nhận/yêu cầu bổ sung/xoá):

- **14 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` trong `#paymentSection` (dropdown Loại/Xác Nhận,
  form tạo `#paymentCreateForm`, chọn Loại Nguồn/Nguồn cụ thể, thêm/xoá đợt thanh toán, lọc trạng thái) +
  `renderPaymentCreateInstallmentsList()` (nút xoá từng đợt) + `renderPaymentRequests()` (5 nút hành động
  trên mỗi dòng: xác nhận đợt, sửa, phê duyệt, yêu cầu bổ sung, xoá) chuyển sang `data-op*`, dùng lại
  đúng hạ tầng dùng chung (`cspDispatchOp`/`bindCspDelegation`) — không cần code hạ tầng mới. Chỉ cần
  **1 gốc** `bindCspDelegation('paymentSection')`: `openEditPaymentRequest()` (nút Sửa) đổ dữ liệu ngược
  vào ĐÚNG `#paymentCreateForm` đã có sẵn trong section (chuyển sub-tab, không mở modal riêng) — giống
  kiểu "sửa tại chỗ" của Hợp Đồng ở đợt 3.
- **2 điểm CHỦ ĐỘNG KHÔNG chuyển** — `startContractPaymentAction`/`startOfficePaymentAction` là lệnh gọi
  JS thuần bên trong `switch` của `runContractAction()` (Hợp Đồng), KHÔNG phải thuộc tính `onclick=` nhúng
  trong HTML — đã nằm trong phạm vi `data-op="runContractAction"` chuyển ở đợt 3 rồi, không phải điểm mới
  của Thanh Toán.
- **`buildActionCell()`/`buildDashboardCardsHTML()`/`buildPaginationBoxHTML()`/`renderPeopleMultiSelect()`**
  tiếp tục KHÔNG đụng — vẫn dành cho 1 đợt riêng cuối cùng sau khi hết mọi module đơn lẻ.

**Fix phụ phát hiện trong lúc demo (không liên quan CSP, đã xác nhận là lỗi có thật, không phải lỗi riêng
của kịch bản demo):** ô chọn "Nguồn" (`#paymentSourceRecord`) trong form tạo đề nghị thủ công có hardcode
`required` ngay trong HTML gốc, nhưng field này chỉ thực sự bắt buộc khi Loại Nguồn là Hợp Đồng/Mua
Bán/Sửa Chữa — khi chọn "Thủ công" (mặc định), cả khối chứa nó bị ẩn qua `.hidden` (display:none) ở phần
tử CHA, nhưng bản thân `<select>` vẫn còn `required=true`. Chrome KHÔNG focus được vào ô ẩn để hiển thị
lời nhắc lỗi validate, nên **chặn âm thầm toàn bộ submit** của form — chỉ có 1 dòng cảnh báo console
(`"An invalid form control with name='' is not focusable."`), không có lỗi nào hiển thị cho người dùng —
khiến luồng tạo đề nghị thanh toán Thủ công không bao giờ gửi được. Phát hiện được nhờ kịch bản demo
Playwright thực sự bấm nút gửi thật (không mock). Đã sửa: chuyển `required` sang gán động theo
`sourceType !== 'MANUAL'` trong `onPaymentSourceTypeChange()`, và gán `false` trong `openEditPaymentRequest()`
(hàm này ẩn khối trực tiếp, không đi qua `onPaymentSourceTypeChange()` nên cần fix riêng để tránh trạng
thái `required` cũ còn sót lại ở chế độ sửa).

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo): điều hướng Sidebar → Tổng Hợp → Thanh Toán, chuyển sub-tab Tạo Mới/Xác Nhận Đề
  Nghị, điền form (phòng ban, tiêu đề), thêm 2 đợt thanh toán rồi xoá 1 đợt (đúng số dòng còn lại), gửi
  form thành công (dialog "✅ Đã tạo đề nghị thanh toán!"), lọc theo trạng thái "Chờ duyệt", mở chế độ Sửa
  trên dòng vừa tạo (nút đổi thành "Cập Nhật"), mở modal xác nhận phê duyệt rồi đóng lại — toàn bộ đều
  đúng, không có lỗi JS console mới.
- Chạy lại toàn bộ 46 file test hồi quy hiện có (`tests/test-*.js`) — pass 100% (2 file
  `test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js` treo lúc dọn dẹp sau khi đã chạy hết kịch
  bản — bug có sẵn từ trước, đã ghi nhận từ đợt 2, không liên quan gì tới thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — cả phần chuyển CSP lẫn phần fix `required` (đều nằm trong `public/index.html`, thuần client
JS/HTML) đều deploy an toàn chỉ với copy code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Xe, Phòng Họp, VPP, Đào Tạo, Ngân Sách, Cơ Cấu Tổ Chức, Báo Cáo, Nhân Sự, Quản Trị/Hệ Thống,
Hỗ Trợ IT, Đồng Phục, Giấy Phép, Gia Hạn CNTT, Tuyển Dụng, Tin Tức/Truyền Thông, Biên Bản Họp, Công Việc,
Văn Bản Trình, Tài Liệu... — dùng hạ tầng `data-op*`/`bindCspDelegation()` đã xây, làm tiếp tuần tự mỗi
module 1 commit + demo + regression trước khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 3/N — module Hợp Đồng + fix lỗi mất TOTP/vân tay khi lưu user

Tiếp tục đợt 2 (Điều hướng Sidebar + hạ tầng `data-op*` dùng chung, xem mục "Trước đó" ngay bên dưới) —
đợt này chuyển module **Hợp Đồng** (form tạo hợp đồng/phụ lục, danh sách, lọc, đợt thanh toán, dropdown
Cấp Phê Duyệt, xem trước quy trình):

- **26 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` trong `#contractSection` (form + bảng + lọc),
  `renderContractApprovalLayerCheckboxes()` (checkbox lớp phê duyệt tuỳ chọn — populate
  `#contractApprovalDropdownPanel`, lồng trong `#contractSection` nên vẫn thuộc phạm vi module này dù tên
  hàm không có chữ "Contract"), `renderContractInstallmentsList()` (thêm/xoá đợt thanh toán + % tự tính ra
  tiền) và `buildContractRowHTML()` (mở rộng phụ lục + nút hành động chính) chuyển sang `data-op*`, dùng
  LẠI đúng hạ tầng dùng chung xây ở đợt 2 (`cspDispatchOp`/`bindCspDelegation`) — không cần code hạ tầng
  mới. Chỉ cần **1 gốc** `bindCspDelegation('contractSection')` (khác Vận Hành cần 6 gốc): mọi phần tử
  động của Hợp Đồng (danh sách, đợt thanh toán, dropdown Cấp Phê Duyệt) đều render vào bên trong
  `#contractSection`, không có modal nào sống ngoài section, và màn "chi tiết"/"xem trước quy trình" dùng
  chung modal toàn cục `#viewDocModal` (chỉ text đã escape, không có onclick nhúng bên trong).
- **6 điểm CHỦ ĐỘNG KHÔNG chuyển** — thuộc màn cấu hình Hệ Thống/Admin (`saveContractExpiryDeptContacts()`,
  3 điểm `toggleScopeGroup('pContractView...')` trong cây phân quyền, `updateContractTypeAbbr(...)`,
  `saveContractApprovalGroup('${layer.key}')`) — tuy tên hàm có chữ "Contract" nhưng HTML chứa chúng nằm
  trong màn Quản Trị/Hệ Thống, không thuộc `#contractSection` — dành cho đợt chuyển đổi Hệ Thống sau này,
  đúng nguyên tắc "chỉ chuyển đúng phạm vi 1 module/đợt" đã áp dụng từ đầu.
- **`buildActionCell()`/`renderPeopleMultiSelect()`** (dùng ở nút "Khác" trên mỗi dòng và picker chọn
  người ở nhiều module khác) tiếp tục **KHÔNG đụng** — vẫn là helper dùng chung ~15+ module, dành cho 1
  đợt riêng cuối cùng sau khi hết mọi module đơn lẻ.

**Fix phụ phát hiện trong lúc demo (không liên quan CSP, đã xác nhận là lỗi có thật, không phải lỗi riêng
của kịch bản demo):** `prepareUsersForSave()` (`routes/data.js`) khi ghi lại collection `users` chỉ khôi
phục `mustChangePassword`/`failedLoginAttempts`/`lockedUntil`/`pinHash` từ bản ghi cũ nếu client không gửi
kèm — nhưng **thiếu** `totpSecretEnc`/`totpBackupCodeHashes`/`webauthnCredentials`/`webauthnUserId`, 4
field vốn LUÔN bị `stripPasswords()` lọc khỏi mọi response `GET /api/data` (đúng chủ đích bảo mật — không
lộ bí mật 2FA cho client) nên client **không bao giờ** có trong tay để gửi lại. Hệ quả: **bất kỳ lượt lưu
`users` nào** (VD admin chỉ sửa email 1 người khác) sẽ âm thầm xoá vân tay (WebAuthn) và bí mật TOTP đã
đăng ký của **mọi** người dùng trong mảng, buộc thiết lập lại 2FA/vân tay từ đầu dù không ai có ý định đó
— phát hiện được nhờ tài khoản demo Playwright bị đăng xuất bất ngờ giữa lượt demo (mã TOTP đúng nhưng
server báo sai vì bí mật đã bị xoá). Đã bổ sung khôi phục đúng 4 field này theo cùng khuôn `pinHash`.

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm 2FA thật,
  xoá lại ngay sau demo): mở tab Phê Duyệt, điền form tạo hợp đồng, mở/đóng dropdown Cấp Phê Duyệt, thêm 2
  đợt thanh toán rồi xoá 1 đợt (đúng số dòng còn lại), nhập % vào 1 đợt và xác nhận tự tính đúng ra tiền
  (50% × 100.000.000 = 50.000.000), mở khung "Tìm Kiếm & Lọc" (`<details>` đóng mặc định) rồi gõ từ khoá
  lọc, bấm "Xem Quy Trình" và xác nhận modal xem trước quy trình phê duyệt hiện đúng nội dung thật (3
  bước: Kiểm soát viên → Trưởng Phòng → Ban Giám Đốc) — toàn bộ đều đúng, không có lỗi JS console mới
  (2 lỗi console còn lại — 401 `/api/auth/me` lúc chưa đăng nhập và 404 `/api/captcha` — đều là hành vi
  bình thường đã thấy ở các đợt demo trước, không liên quan thay đổi lần này).
- Chạy lại toàn bộ 46 file test hồi quy hiện có (`tests/test-*.js`) — pass 100% (cùng 1 file
  `test-audit-fixes-batch1.js` có bug dọn dẹp có sẵn từ trước như đã ghi nhận ở đợt 2, không liên quan gì
  tới thay đổi lần này).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — cả phần chuyển CSP (client JS/HTML) lẫn phần fix `prepareUsersForSave()` (server, 1 hàm trong
`routes/data.js`) đều deploy an toàn chỉ với copy code + `pm2 restart`, không cần thao tác 1 lần nào khác.

**Còn lại:** Thanh Toán, Xe, Phòng Họp, VPP, Đào Tạo, Ngân Sách, Cơ Cấu Tổ Chức, Báo Cáo, Nhân Sự, Quản
Trị/Hệ Thống, Hỗ Trợ IT, Đồng Phục, Giấy Phép, Gia Hạn CNTT, Tuyển Dụng, Tin Tức/Truyền Thông, Biên Bản
Họp, Công Việc, Văn Bản Trình, Tài Liệu... — dùng hạ tầng `data-op*`/`bindCspDelegation()` đã xây, làm
tiếp tuần tự mỗi module 1 commit + demo + regression trước khi merge, tới khi hết toàn bộ điểm mới gỡ
`unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 2/N — Điều hướng Sidebar + hạ tầng dùng chung mới

Tiếp tục phương án chuyển đổi CSP theo từng module (đợt 1 là Vận Hành, xem mục ngay bên dưới). Đợt này
chuyển **thanh điều hướng bên trái** (`<aside id="userHeader">`) — dropdown Truyền Thông/Hợp Đồng/Điều
Hành/Hành Chính/Tổng Hợp/Vận Hành/Hỗ Trợ IT/Hệ Thống + các nút Trang chủ/Báo cáo/Nhân sự/Hồ sơ cá
nhân/Thu gọn sidebar/Đăng xuất — và đồng thời xây **hạ tầng CSP dùng chung mới**, thay cho kiểu bảng tra
cứu tay riêng từng module (`OP_CLICK_ACTIONS`...) của đợt Vận Hành, để các module còn lại chuyển đổi
nhanh hơn:

- **46 điểm** `onclick` chuyển sang **1 bộ thuộc tính `data-op*` tổng quát + 1 bộ hàm dispatch dùng
  chung** (`cspCollectArgs`/`cspRunSeq`/`bindCspDelegation`, đặt cạnh `bindOperationDelegation` cũ):
  `data-op`/`data-op-change`/`data-op-input` gọi thẳng `window[tênHàm]` (không cần bảng tra cứu tay vì
  mọi hàm xử lý trong file đều là hàm global), `data-argN` là tham số vị trí (tự nhận biết số nếu khớp
  `/^-?\d+$/`), `data-arg-value`/`-el`/`-event="N"` thay tham số N bằng `el.value`/chính phần tử
  DOM/Event thật (thay cho `this.value`/`this` trần/tham số `event` — 8 nút `toggleXDropdown(event)` cần
  `event.stopPropagation()` để không bị đóng ngay bởi listener bắt-click-ngoài-vùng), và
  `data-op-seq="fn1(a,b)|fn2(c)"` cho các `onclick` gọi NHIỀU hàm liên tiếp (đúng mẫu dropdown điều
  hướng: `closeXDropdown(); switchTab('y'); setXSubTab('z')` — 42/46 điểm của đợt này thuộc dạng này).
  Gắn listener 1 lần vào `#userHeader` (gốc ổn định, sidebar không bị `innerHTML` lại).
- CSP header **CHƯA đổi** — vẫn còn `unsafe-inline` tới khi xong hết toàn bộ module còn lại (Hợp Đồng,
  Thanh Toán, Xe, Phòng Họp, VPP, Đào Tạo, Ngân Sách, Cơ Cấu Tổ Chức, Báo Cáo, Nhân Sự, Quản Trị...) và 3
  hàm dùng chung (`buildActionCell()`/`buildDashboardCardsHTML()`/`buildPaginationBoxHTML()`).

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật qua tài khoản demo tạm, xoá lại
  ngay sau demo): mở lần lượt cả 8 dropdown điều hướng, bấm 1 mục con mỗi dropdown, xác nhận đúng
  tab/sub-tab tương ứng hiện ra (kể cả Hệ Thống — dropdown admin-only, và `data-op-seq` 2-3 lệnh liên
  tiếp) + nút đơn (`switchTab('dashboard')`, mở modal Hồ Sơ Cá Nhân) — 10/10 kiểm tra đều đúng, không có
  lỗi JS console mới.
- Chạy lại toàn bộ 46 file test hồi quy hiện có (`tests/test-*.js`) — pass 100% (1 file
  `test-audit-fixes-batch1.js` có bug dọn dẹp có sẵn từ trước — tiến trình không tự thoát sau khi in kết
  quả, không liên quan gì tới thay đổi lần này — đã xác nhận lại độc lập 14/14 kịch bản PASS).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — chỉ đổi cách gắn sự kiện JS phía client trong `public/index.html`, deploy an toàn chỉ với copy code.

**Còn lại:** Hợp Đồng, Thanh Toán, Xe, Phòng Họp, VPP, Đào Tạo, Ngân Sách, Cơ Cấu Tổ Chức, Báo Cáo, Nhân
Sự, Quản Trị... — dùng hạ tầng `data-op*`/`bindCspDelegation()` vừa xây ở đợt này, làm tiếp tuần tự mỗi
module 1 commit + demo + regression trước khi merge, tới khi hết toàn bộ điểm mới gỡ `unsafe-inline`.

## Trước đó — CSP unsafe-inline: đợt 1/N — module Vận Hành

Bắt đầu thực hiện phương án 2 đã đề xuất ở đợt rà soát bảo mật vòng 2 (chuyển toàn bộ 1017 điểm inline
event-handler sang `addEventListener` để có thể gỡ `unsafe-inline` khỏi CSP). Làm **theo từng module**,
demo + xác nhận không ảnh hưởng trước khi merge từng đợt — bắt đầu với **Vận Hành** (Đơn Hàng + Siêu Thị:
Mở mới/Sửa chữa/Dự toán/Thực hiện/Nghiệm thu/Báo cáo), module có nhiều điểm nhất sau khi soát riêng.

- Chuyển **80 điểm** `onclick`/`onchange`/`oninput`/`onsubmit` inline sang **event delegation** — gắn
  đúng 1 lần lúc tải trang lên 6 "gốc ổn định" (`#vanHanhSection` + 5 modal của module, các modal nằm
  ngoài `#vanHanhSection` nên cần gốc riêng). Nội dung bên trong các gốc này bị `innerHTML` lại liên tục
  (render lại danh sách/cây công việc) nhưng bản thân gốc không bao giờ bị thay thế nên listener gắn 1
  lần vẫn bắt đúng phần tử sinh ra sau — tránh 2 lỗi thường gặp khi chuyển đổi ở quy mô lớn: quên gắn lại
  listener sau mỗi lần render (nút im lặng) và gắn lại nhiều lần (1 cú bấm chạy hành động nhiều lần).
- **KHÔNG đổi** `buildActionCell()`/`buildDashboardCardsHTML()`/`buildPaginationBoxHTML()` (3 hàm dùng
  chung ~15+ module khác, kể cả trong chính module Vận Hành) — để lại cho 1 đợt CSP riêng của phần dùng
  chung, tránh mở rộng phạm vi rủi ro ngoài module đang làm.
- CSP header **CHƯA đổi** — `unsafe-inline` vẫn giữ nguyên tới khi xong hết mọi module còn lại, vì CSP là
  1 policy áp cho toàn trang, không tách theo module — gỡ sớm sẽ làm im lặng mọi nút chưa kịp chuyển đổi
  ở các module khác.

**Xác nhận không ảnh hưởng** — 2 lớp kiểm tra độc lập trước khi merge:
- Demo Playwright thật (SQL Server + server local + đăng nhập UI thật, không phải mock): tạo hồ sơ Mở
  mới Siêu Thị qua form thật, mở modal Xử lý/Duyệt và modal Dự toán từ nút trong bảng, thêm/xoá dòng hạng
  mục, gõ ô lọc — tất cả hoạt động y hệt trước khi sửa, không có lỗi console mới.
- Chạy lại toàn bộ 46 file test hồi quy hiện có (`tests/test-*.js`) — pass 100%, gồm
  `test-operation-store-lifecycle.js` (31/31 kịch bản riêng của module Vận Hành).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới — chỉ đổi cách gắn sự kiện JS phía client trong `public/index.html`, deploy an toàn chỉ với copy code
(không cần `pm2 restart` vì không đụng code server, nhưng restart cũng không hại gì nếu tiện làm cùng lúc).

**Còn lại:** các module khác (Hợp Đồng, Thanh Toán, Xe, Phòng Họp, VPP, Đào Tạo, Ngân Sách, Cơ Cấu Tổ
Chức, Báo Cáo, Nhân Sự, Quản Trị...) — làm tiếp tuần tự theo cùng khuôn, mỗi module 1 commit + demo +
regression trước khi merge, tới khi hết toàn bộ 1017 điểm mới gỡ `unsafe-inline` ở CSP header.

## Trước đó — Rà soát bảo mật vòng 2 (team security tìm thêm 3 lỗ hổng sau đợt v3.0)

Sau khi merge v3.0 (9 mục P0-P3 ở phần bên dưới), team security khách hàng gửi thêm 3 phát hiện: (1) CSP
`unsafe-inline` "quá mềm", (2) chưa rõ SQL injection có tồn tại không — yêu cầu audit chi tiết, (3) error
disclosure khi ở dev mode. Đã rà kỹ cả 3, xử lý 1 (fix code), xác nhận sạch 1 (audit không đổi code), và
lập phương án cho mục còn lại (đề xuất, chưa thực hiện — chờ quyết định người dùng):

- 🔴 **Error disclosure khi dev mode — ĐÃ VÁ.** Toàn hệ thống vốn đã có cơ chế ẩn chi tiết lỗi khi
  `NODE_ENV=production` (`sendServerError()`, `lib/errorResponse.js`) — xác nhận PM2 (`ecosystem.config.js`)
  đã đặt `NODE_ENV: 'production'` sẵn nên production KHÔNG lộ. Nhưng phát hiện ~15 điểm route đọc/parse
  file tải lên (bảng giá, danh mục VPP, kế hoạch đào tạo, danh sách học viên, import Excel Nhân Sự/Cơ Cấu
  Tổ Chức...) trả thẳng `err.message` ra JSON, KHÔNG qua cơ chế NODE_ENV-aware này — lỗi thư viện đọc
  Excel/CSV nội bộ hoặc lỗi ghi đĩa (ENOSPC/EACCES) có thể lộ chi tiết dù ở môi trường nào. Vá bằng hàm
  mới `sendCatchError()` (`lib/errorResponse.js`) — phân biệt lỗi NGHIỆP VỤ chủ đích (`HttpError`, message
  đã viết sẵn an toàn để hiển thị, VD "File thiếu cột bắt buộc: Tên mặt hàng") với lỗi KHÔNG LƯỜNG TRƯỚC
  (phải ẩn chi tiết khi production) — áp dụng cho `routes/upload.js`, `priceFile.js`,
  `budgetTemplateImport.js`, `storeCatalogImport.js`, `trainingPlanImport.js`, `trainingRoster.js`,
  `vppCatalog.js`, `adminExport.js` (2 route import Nhân Sự/Cơ Cấu Tổ Chức). Trong lúc vá phát hiện thêm 1
  chỗ dùng `throw new Error()` thường cho lỗi validate hợp lệ (`lib/adminExport.js`,
  `parseUsersImportXlsx()`) — nếu không sửa cùng lúc sẽ bị `sendCatchError()` ẩn nhầm thành lỗi chung
  chung, đã đổi sang `HttpError` để giữ đúng message rõ ràng cho người dùng.
- 🔴 **SQL Injection — ĐÃ AUDIT, KHÔNG PHÁT HIỆN LỖ HỔNG.** Rà toàn bộ ~70 điểm gọi `.query()` trong
  `server/routes/` + `server/lib/` (liệt kê đầy đủ qua grep, không lấy mẫu) — 100% dùng tham số hoá đúng
  chuẩn `mssql` (`.input(tên, kiểu, giá_trị)` + `@tên` trong câu lệnh), không có điểm nào nối chuỗi giá
  trị người dùng trực tiếp vào SQL. 2-3 điểm có dựng động phần TEXT câu lệnh (`lib/operationWorkItemStore.js`,
  `lib/recordStore.js`) đã soát riêng — chỉ nối tên tham số (`@p0, @p1...`) hoặc mệnh đề tĩnh cố định, giá
  trị thật luôn qua `.input()`. Không cần sửa code — ghi nhận vào đây để trả lời chính thức cho team
  security: đã audit chi tiết theo yêu cầu, kết quả sạch.
- 🔴 **CSP `unsafe-inline` — ĐÃ LƯỢNG HOÁ PHẠM VI, CHƯA SỬA (giữ nguyên quyết định hoãn lại ở v3.0).**
  Đây là refactor lớn đã được người dùng chủ động hoãn ở đợt trước (ước tính 2-3 ngày, đụng gần hết
  `index.html`). Đo lại chính xác cho phương án xử lý: file `public/index.html` hiện có **1017 thuộc
  tính inline event-handler** (`onclick=`, `onchange=`...) + **5 khối `<script>` inline**, tổng
  40.726 dòng / 2.537.187 byte. Đề xuất 2 phương án khi người dùng sẵn sàng làm:
  1. **Nonce-based (nhanh, ít rủi ro hơn)** — sinh 1 nonce ngẫu nhiên mỗi request, thêm vào CSP header
     (`script-src 'self' 'nonce-xxx'`) và gắn `nonce="xxx"` vào 5 khối `<script>` inline hiện có — bỏ
     được `'unsafe-inline'` cho khối script, nhưng KHÔNG xử lý được 1017 thuộc tính `onXxx=` (CSP không
     hỗ trợ nonce cho inline event-handler attribute) — vẫn phải giữ `script-src-attr: 'unsafe-inline'`
     riêng, chỉ giảm 1 phần bề mặt, không loại bỏ hoàn toàn XSS-execution-if-injected.
  2. **Chuyển hết sang `addEventListener` (triệt để, đúng như đề xuất security)** — xoá toàn bộ 1017
     `onXxx=` sang gắn listener bằng JS + `data-*`/id chọn phần tử, bỏ được `'unsafe-inline'` ở CẢ
     `script-src` lẫn `script-src-attr`. Đây là refactor thật sự diện rộng, rủi ro regression cao vì
     đụng gần như mọi màn hình — nên làm theo từng module (VD Vận Hành trước, rồi Nhân Sự...) kèm demo
     Playwright từng phần thay vì 1 lượt duy nhất.
  **Lưu ý quan trọng cho team security**: bản thân `unsafe-inline` KHÔNG PHẢI lỗ hổng độc lập — nó chỉ
  tăng mức thiệt hại NẾU đã tồn tại 1 lỗ hổng XSS khác (chèn được input không escape vào DOM). Đã audit
  riêng và chưa phát hiện điểm XSS injectable nào trong hệ thống. Khuyến nghị: có thể public trước với
  rủi ro này đã được lượng hoá + chấp nhận có kiểm soát, làm phương án 2 ở 1 đợt riêng sau.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm biến môi trường mới, KHÔNG thêm `dependencies`
mới trong `package.json` — thuần hardening logic ứng dụng, deploy an toàn chỉ với copy code +
`pm2 restart`.

Test: `node -c` toàn bộ 11 file server sửa/mới; `git stash`/`git stash pop` xác nhận số lượng test fail
trong `tests/test-*.js` giống hệt trước/sau thay đổi (môi trường sandbox này không có SQL Server thật nên
bộ test đầy đủ không chạy hết được) — 2 file liên quan trực tiếp chạy riêng pass đầy đủ, không regression
(`tests/test-audit-dot5-phase1.js` 13/13, `tests/test-admin-totp.js` 26/26).

## Trước đó — Rà soát bảo mật theo yêu cầu team security (trước khi public ra Internet)

Team security của khách hàng đưa 1 danh sách 9 mục ưu tiên P0-P3 yêu cầu xử lý trước khi public. Rà kỹ
từng mục đối chiếu code thật (không giả định) thì **5/9 mục đã được vá sẵn từ các đợt audit trước, không
cần sửa thêm**:

- 🔴 **Path Traversal uploads**: cả 7 route upload (`routes/upload.js` + 6 route phụ) đều dùng tên file
  server tự sinh (không lấy từ input người dùng) + allowlist đuôi file + kiểm chữ ký nhị phân thật; 2
  đường đọc file (`/uploads`, `/api/files/download`) đều qua `parseUploadsFileUrl()` (chỉ nhận đúng 1
  thành phần tên file, chặn `/`, `\`, `..`) + verify lại `path.dirname()` khớp đúng thư mục uploads/.
- 🔴 **Default Password 123456**: `seedDefaults.js` dò MỌI tài khoản (không riêng seed) còn dùng mật
  khẩu mặc định đã biết mỗi lần khởi động, tự bắt buộc đổi mật khẩu (`mustChangePassword`) trước khi
  dùng tiếp; mật khẩu mới bắt buộc ≥8 ký tự + chữ+số+ký tự đặc biệt + chặn danh sách mật khẩu yếu.
- 🟠 **File Upload Rate Limit**: cả 7 route upload đã có `express-rate-limit` giống nhau (10 phút/30 lượt).
- 🟠 **Perms Sanitization Verify**: đã đọc kỹ `sanitizeUsersPermsForViewer()` — logic đúng, không có lỗ
  hổng, đã có test riêng (`tests/test-audit-dot5-phase1.js`, 13/13 pass).
- 🟡 **Email Rate Limiting**: `routes/email.js` đã có `sendEmailRateLimiter` áp cho cả gửi thật lẫn gửi thử.

**4 mục còn lại** xử lý theo lựa chọn người dùng (đã hỏi qua 3 câu về phạm vi trước khi làm):

- 🟡 **Disk Space Monitoring**: `jobs/diskSpaceMonitor.js` mới — job chạy mỗi giờ, cảnh báo email admin
  khi ổ đĩa chứa `uploads/` vượt ngưỡng (mặc định 85%, chỉnh được ở Quản trị > Cấu Hình Email), cooldown
  24h tránh dội email. **Chỉ cảnh báo, KHÔNG tự xoá file nào** (người dùng chọn phương án an toàn nhất —
  hệ thống fail-open cho nhiều loại file chưa rà quyền sở hữu riêng, không có cách chắc chắn 1 file là
  rác an toàn để xoá tự động).
- 🟡 **Audit Log Encryption**: `lib/logCrypto.js` mới — mã hoá AES-256-GCM cột `IpAddress` trong
  `dbo.SystemLogs` (khoá `LOG_ENCRYPTION_KEY` riêng, **tuỳ chọn** — không đặt vẫn ghi log bình thường ở
  dạng plaintext như trước, chỉ cảnh báo khởi động nhắc bật). Chỉ mã hoá IpAddress, giữ FullName/
  Description dạng thường để còn tìm kiếm được khi admin tra cứu log.
- 🔵 **CSP Refactoring** (bỏ `unsafe-inline`) và 🔵 **Frontend Code-Splitting**: người dùng chọn **hoãn
  lại** — đây là 2 refactor lớn (ước tính 2-3 và 3-5 ngày), rủi ro regression cao vì đụng gần như mọi
  màn hình trong `index.html` (40.709 dòng), không phải lỗ hổng khai thác trực tiếp được (CSP
  unsafe-inline chỉ tăng rủi ro NẾU đã có XSS khác; bundle size là hiệu năng, không phải bảo mật) — làm
  ở 1 đợt riêng sau khi public.

**Deploy-impact:**
- `sql/schema.sql` **CÓ đổi** — cột `IpAddress` trong `dbo.SystemLogs` mở rộng từ `NVARCHAR(100)` lên
  `NVARCHAR(300)` (đủ chứa giá trị đã mã hoá). An toàn chạy lại nhiều lần, chỉ MỞ RỘNG không mất dữ liệu.
- `.env.example` thêm 1 biến môi trường **tuỳ chọn** `LOG_ENCRYPTION_KEY` — không đặt thì log vẫn ghi
  bình thường (plaintext như trước), server in cảnh báo khởi động nhắc bật. Nên đặt trước khi public.
- Không thêm `dependencies` mới trong `package.json`.
- Thao tác 1 lần: sau khi chạy lại `schema.sql`, nếu muốn bật mã hoá log thì thêm `LOG_ENCRYPTION_KEY`
  vào `.env` rồi `pm2 restart` — KHÔNG bắt buộc để deploy thành công.

Test: syntax check toàn bộ file server sửa/mới (`node -c`) + script inline trong `index.html`, không
duplicate DOM id mới, unit test round-trip mã hoá/giải mã (bao gồm khoá sai/thiếu khoá — không throw),
sanity check `fs.statfs`. Bộ test DB-thật (`tests/test-*.js`) không chạy được đầy đủ trong sandbox này
(không có SQL Server thật) — 2 file test có liên quan trực tiếp (`test-admin-totp.js` exercising
`insertSystemLog()` qua mock SQL request, `test-audit-dot5-phase1.js` cho `sanitizeUsersPermsForViewer()`)
đã chạy riêng và pass đầy đủ, không có regression so với trước khi sửa.

## Trước đó — Audit Đợt 5 Giai đoạn 4 (tiếp): 3 mục còn lại theo lựa chọn người dùng (nhánh `claude/chao-ban-oo5ijl`)

Tiếp theo phần Giai đoạn 4 đầu tiên (bên dưới) — người dùng được hỏi cụ thể về 4 mục Thấp còn lại cần
quyết định nghiệp vụ, chốt 3/4 mục nên làm:

- **Vận Hành > Dự toán**: thêm nút "🔁 Lập Lại Dự Toán" khi hồ sơ đang ở trạng thái "Đã từ chối" — trước
  đây REJECTED là ngõ cụt, không có đường quay lại DRAFT để sửa/gửi lại (khác REQUEST_CHANGES ở nơi
  khác trong hệ thống). `resetOperationEstimateToDraft()` (lib/recordActions.js) + 2 route mới
  `POST .../estimate/reset` cho `operationStoreOpenings`/`operationRepairs`.
- **Đăng Ký Xe > Xử lý duyệt**: thêm khái niệm "tài xế" — field `user.isDriver` (checkbox "🚗 Là tài xế"
  trong form Quản Lý Người Dùng). Picker "Lái xe được phân công" (`#carAssignedDriver`) trước đây dùng
  chung `systemUsersDatalist` (toàn bộ nhân viên công ty), giờ tách riêng `carDriversDatalist` chỉ gợi ý
  đúng nhóm đã đánh dấu là tài xế.
- **`lib/workflowEngine.js`**: đồng bộ lại `findCarPlateConflict()` — bản ghi lỗi định dạng ngày (NaN)
  giờ coi là CÓ trùng lịch (chặn an toàn), khớp đúng `findMeetingConflict()` ở `createValidation.js`
  (trước đây bất đối xứng giữa Xe/Phòng họp — chưa từng khai thác được vì mọi đường ghi hiện tại đã
  validate ngày hợp lệ trước khi tới đây, nhưng đáng đồng bộ cho nhất quán).
- **Hợp đồng**: validate `custodianDept` (Đơn vị tiếp nhận theo dõi & thanh toán) khớp danh mục phòng
  ban/siêu thị thật — CHỈ khi người tạo/sửa chủ động chọn khác `payload.dept` (giá trị mặc định khi
  không chọn vẫn giữ nguyên mức tin cậy cũ, tránh validate 2 lần theo 2 tiêu chuẩn khác nhau cho cùng 1
  giá trị — phát hiện + tự sửa 1 regression trong lúc chạy lại bộ test hồi quy).

3 mục còn lại của đợt rà soát Thấp — tách bạch trách nhiệm Vận Hành (người làm ≠ người nghiệm thu), bắt
buộc `If-Match` khi ghi `users`, và ngõ cụt REJECTED của Dự toán (mục thứ 3 ĐÃ xử lý ở trên qua nút Lập
Lại — 2 mục segregation/If-Match người dùng chọn giữ nguyên, không đổi hành vi).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, không thêm biến môi trường, không thêm dependency. Chỉ
cần copy code + `pm2 restart`.

Test: toàn bộ `tests/test-*.js` chạy lại, không có regression mới (2 kịch bản thất bại sẵn có do sandbox
không kết nối được SQL Server thật, không liên quan thay đổi).

## Trước đó — Audit Đợt 5 Giai đoạn 4: hoàn thiện (Thấp)

Giai đoạn cuối cùng trong lộ trình 4 giai đoạn của Audit Đợt 5 — các phát hiện mức Thấp, không chặn triển
khai, chỉ chọn xử lý những mục cơ giới/rủi ro hành vi bằng 0 (không đụng luồng nghiệp vụ nào):

- `careerPathConfirmations` (mốc "Xác nhận hoàn thành cấp bậc" của Lộ Trình Thăng Tiến, Đào Tạo): giờ
  được lọc lại đúng ở `GET /api/data` — trước đây chỉ ẩn ở giao diện, để lộ mốc thăng tiến (username/
  phòng ban/thời điểm xác nhận) của MỌI nhân viên cho bất kỳ ai gọi thẳng API.
- `lib/adminAuth.js`: sửa lại comment mô tả sai nguồn `req.user.admin` (comment cũ ghi nhầm là "cache
  trong JWT, hiệu lực 1h" — thực ra `requireAuth` đã tự re-fetch DB mỗi request qua cache vài giây, và
  JWT hệ thống này hiệu lực 8h chứ không phải 1h). Chỉ sửa chú thích, không đổi logic.
- `sql/schema.sql`: câu `ALTER TABLE dbo.AppData ALTER COLUMN UpdatedAt...` giờ chỉ chạy khi tra
  `INFORMATION_SCHEMA.COLUMNS` thấy cột CHƯA đúng kiểu — trước đây chạy vô điều kiện ở MỌI lần deploy dù
  không có gì thay đổi, tốn 1 khoá schema không cần thiết trên bảng đọc ở gần như mọi request. Vẫn an
  toàn chạy lại nhiều lần như trước (tự bọc điều kiện, không mất dữ liệu).
- `lib/taskStore.js` (`dbo.Tasks`) và `lib/systemLogStore.js` (`dbo.SystemLogs`): cắt các cột trích xuất
  độ rộng cố định (`SourceCode`, `TargetObject`, `IpAddress`...) về đúng độ rộng cột SQL trước khi ghi —
  trước đây nếu 1 giá trị vượt giới hạn cột (VD `IpAddress` lấy từ header có thể bị client gửi chuỗi dài
  bất thường), INSERT/UPDATE ném thẳng lỗi SQL thô thay vì ghi được bản ghi/log.

**Deploy-impact:** `sql/schema.sql` CÓ đổi (thêm điều kiện `INFORMATION_SCHEMA` quanh 1 câu `ALTER COLUMN`
đã có sẵn) — nhắc chạy lại script, vẫn an toàn chạy lại nhiều lần như mọi lần trước (tự bọc điều kiện,
không mất dữ liệu). Không thêm biến môi trường, không thêm dependency. Ngoài chạy lại `schema.sql`, chỉ
cần copy code + `pm2 restart`.

Test: toàn bộ `tests/test-*.js` chạy lại, không có regression mới (2 kịch bản thất bại sẵn có do sandbox
không kết nối được SQL Server thật, không liên quan thay đổi).

Đây là giai đoạn cuối trong lộ trình 4 giai đoạn của Audit Đợt 5 — 8 phát hiện Thấp còn lại trong danh
sách gốc không xử lý ở đợt này (mang tính chọn lọc kiến trúc/UX hơn là lỗi cơ giới, ví dụ tách bạch trách
nhiệm — segregation of duties — hay cần quyết định sản phẩm cụ thể) — có thể xem xét lại sau nếu người
dùng muốn tiếp tục.

## Trước đó — Audit Đợt 5 Giai đoạn 3: toàn vẹn dữ liệu & cascade xóa

Tiếp theo Giai đoạn 1+2 (bên dưới) — 4 phát hiện còn lại trong lộ trình khắc phục, nhóm "toàn vẹn dữ
liệu & cascade xóa" (không khẩn nhưng càng để lâu càng khó dọn rác dữ liệu):

- Xóa hồ sơ Vận Hành (`operationStoreOpenings`/`operationRepairs`) giờ cascade xóa luôn
  `operationExecutionPeriods` + toàn bộ cây `dbo.OperationWorkItems` tham chiếu tới hồ sơ đó — trước
  đây chỉ xóa đúng 1 dòng hồ sơ, để lại Kỳ Thực Hiện + cây công việc mồ côi vĩnh viễn trong DB.
- Xóa 1 nhánh cây `OperationWorkItems` giờ dùng đúng 1 câu `DELETE...WHERE Id IN (...)` (atomic) thay vì
  vòng lặp nhiều câu `DELETE` riêng lẻ không bọc transaction — tránh cây bị đứt gãy nếu tiến trình crash
  giữa vòng lặp.
- Task được giao từ Biên Bản Họp giờ báo rõ "⚠️ Biên bản họp nguồn đã bị xóa" trong Chi tiết công việc
  nếu biên bản gốc không còn tồn tại (`dbo.Tasks.SourceCode` chỉ là chuỗi tham chiếu tự do, không FK).
- Thêm `HOLDLOCK` cho 2 câu `MERGE` upsert (`dbo.EphemeralAuthTokens`, `dbo.AppData`) — lỗi đã biết của
  SQL Server có thể khiến 2 request cùng tạo 1 key MỚI gần như đồng thời cùng INSERT, gây lỗi 500 thay
  vì upsert êm.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, không thêm biến môi trường, không thêm dependency. Chỉ
cần copy code + `pm2 restart`.

Test: toàn bộ 46 file `tests/test-*.js` chạy lại, không có regression mới (2 kịch bản thất bại sẵn có do
sandbox không kết nối được SQL Server thật, không liên quan thay đổi).

## Trước đó — Audit Đợt 5 Giai đoạn 1+2

Rà soát bảo mật/logic nghiệp vụ toàn hệ thống, chốt lộ trình khắc phục 4 giai đoạn theo mức độ. Đã hoàn
tất Giai đoạn 1 (Nghiêm trọng/Cao) và Giai đoạn 2 (Cao/Trung bình còn lại), gộp merge chung 1 lần.

**Giai đoạn 1 — Nghiêm trọng/Cao:**
- `GET /api/data` (và `GET /api/data/users`) từng trả nguyên `perms`/`permOverrides`/`groupIds` của
  MỌI người dùng cho bất kỳ ai đăng nhập (kể cả non-admin) — chỉ admin và chính chủ mới thấy 3 field này
  của người khác (`sanitizeUsersPermsForViewer()`). 4 nơi cần danh sách người giữ 1 cờ quyền cụ thể để
  gửi email (duyệt họp/bài đăng nội bộ/giá IT khẩn/giấy phép) chuyển sang đọc field mới
  `data.moduleApproverUsernames` (tính sẵn phía server từ perms đầy đủ) thay vì tự quét `perms` người khác.
- `trainingTestSubmissions`/`trainingRegistrations` không lọc theo quyền phía server — học viên bất kỳ
  từng thấy được bài làm/đăng ký của TẤT CẢ người khác qua `GET /api/data`.
- Bảng xếp hạng (leaderboard) Đào Tạo hiển thị cho mọi người xem được tab Dashboard dù không có quyền
  quản lý đào tạo.

**Giai đoạn 2 — Cao/Trung bình:**
- Người được admin chỉ định duyệt Dự toán Vận Hành (`operationStoreOpeningEstimate`/
  `operationRepairEstimate` — quy trình độc lập, thường khác phòng ban với hồ sơ chính) trước đây không
  thấy được hồ sơ qua `GET /api/data` để duyệt bình thường qua giao diện (dù action API vẫn chạy được
  nếu biết trước id) — bổ sung nhánh approver Dự toán vào `canViewOperationStoreOpening`/
  `canViewOperationRepair`.
- Tài khoản chỉ giữ quyền `orgChartManage` (không phải admin thuần) thấy đủ UI Cơ Cấu Tổ Chức nhưng bấm
  Lưu luôn bị 403 do luồng ghi duy nhất (`POST /api/data/users`) yêu cầu admin thuần — thêm route hẹp
  `POST /api/admin/org-chart/set-manager`, chỉ đọc/ghi field `managerUsername` (không đụng
  perms/active/dept của ai), dùng khoá giao dịch thật + `assertNoManagerCycle()` dùng chung với luồng
  admin.
- Chặn xoá công việc Vận Hành đã "Đã nghiệm thu" và chặn tạo công việc mới sau khi hồ sơ đã "Xác nhận
  đưa vào sử dụng" — trước đây 2 thao tác này không có guard nào, có thể làm sai lệch mốc xác nhận đã
  chốt.

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, không thêm biến môi trường mới trong `.env.example`,
không thêm/đổi `dependencies` trong `package.json`. Chỉ cần copy code + `pm2 restart`.

Test: `tests/test-audit-dot5-phase1.js` (13/13), `tests/test-audit-dot5-phase2.js` (10/10) — toàn bộ 46
file `tests/test-*.js` hiện có đã chạy lại, không có regression mới (2 kịch bản thất bại sẵn có do
sandbox không kết nối được SQL Server thật, không liên quan thay đổi).

## Trước đó (PR #230)

Vận Hành — tab "🏬 Siêu Thị" gộp Mở Mới/Sửa Chữa, thêm vòng đời "dự án nhỏ" sau khi hồ sơ được tạo: **Dự
toán** (workflow duyệt độc lập, bảng hạng mục tự tính tổng tiền) → **Thực hiện** (cây công việc đa cấp,
bảng SQL mới `dbo.OperationWorkItems`, chỉ mở khi Dự toán duyệt xong) → **Nghiệm thu** (nút Nghiệm
thu/Bổ sung, cha tự chuyển trạng thái khi hết việc con dở) → **Báo cáo** (tổng hợp tiến độ nhanh/chậm).
3 quyền mới tách riêng theo giai đoạn (`operationEstimateCreate`/`operationExecutionManage`/
`operationAcceptanceManage`), đã đưa vào Approval Hub.

Bổ sung theo phản hồi thực tế trong quá trình demo:
- **Chặn thao tác đúng người**: chỉ người được gán (`assignedTo`) mới cập nhật tiến độ việc của mình,
  chỉ người được CHỈ ĐỊNH nghiệm thu (`acceptorUsername`) mới nghiệm thu được — trước đó ai giữ quyền
  vai trò cũng thao tác được mọi việc, không đúng thực tế phân công.
- **Kỳ Thực Hiện** (`operationExecutionPeriods`) — mỗi hồ sơ có nhiều kỳ, việc gốc bắt buộc chọn đúng kỳ
  đang "Đang thực hiện", việc con kế thừa kỳ của cha (server không tin giá trị client gửi).
- **Nút "✏️ Sửa" công việc** (title/mô tả/người phụ trách/người nghiệm thu/hạn — không cho sửa
  kỳ/vị trí cây/trạng thái) và **"🏁 Xác Nhận Đưa Vào Sử Dụng"** — mốc cấp hồ sơ mới, quyền riêng
  `operationUseConfirm`, chỉ mở khi TOÀN BỘ cây công việc đã "Đã nghiệm thu".
- **Nhân Sự → 🌳 Cơ Cấu Tổ Chức** (module mới): field `user.managerUsername` (không cần bảng riêng) + cây
  quản lý nhiều cấp, chống vòng lặp server-side. Quyền mới `orgChartManage`. Áp dụng cho **toàn bộ nhân
  viên công ty** (mọi phòng ban), không giới hạn theo module Vận Hành. Có nút Tải Mẫu/Xuất Excel/Nhập Từ
  Excel để chuẩn bị dữ liệu ngoài và lưu hồ sơ.
- **Trưởng phòng xem việc nhân viên**: dựa trên Cơ Cấu Tổ Chức, trưởng phòng (đệ quy nhiều cấp) XEM được
  task (Công Việc) và cây công việc Vận Hành của nhân viên mình quản lý — chỉ xem, không thao tác thay.
- **Fix bố cục**: 3 dòng `</div>` thừa sót lại từ đợt viết lại `#budgetSection` (Ngân Sách) khiến mọi
  module sau Ngân Sách trong file (Vận Hành, Nhân Sự...) hiển thị lệch ra ngoài khung sidebar.

**Deploy-impact:** CÓ đổi `sql/schema.sql` (bảng `dbo.OperationWorkItems` mới, script tự bọc
`IF OBJECT_ID(...) IS NULL` nên chạy lại an toàn). Không thêm biến môi trường mới, không thêm dependency
mới. `operationExecutionPeriods` và `user.managerUsername` đều là field/collection JSON tự do, không cần
đổi thêm gì ở schema.

Test: `tests/test-operation-store-lifecycle.js` (31/31), `tests/test-org-chart-manager-visibility.js`
(14/14), `tests/test-orgchart-excel-import.js` (8/8) — toàn bộ 44 file `tests/test-*.js` hiện có đã chạy
lại, không có regression (2 kịch bản thất bại sẵn có do sandbox không kết nối được SQL Server thật, không
liên quan thay đổi).

## Trước đó (PR #228–#229) — chưa ghi chi tiết đầy đủ

Giai đoạn giữa PR #226 (v1.100.0) và PR #230 (v2.5) gồm 2 đợt vá lỗi bảo mật/chất lượng lớn — **PR #228**
"Audit bảo mật: vá 10 lỗi Nghiêm trọng/Cao/Trung bình + cluster-safe hoá auth + quy tắc version mới" (đổi
sang định dạng version `MAJOR.MINOR`, reset về `2.0`) và **PR #229** "Giai đoạn 3: vá 16 lỗi mức Thấp (rà
soát 3 agent song song)". Chưa liệt kê chi tiết từng lỗi ở đây do khối lượng lớn — tra cứu trực tiếp lịch
sử commit/PR trên GitHub (nhánh `main`) khi cần đối chiếu cụ thể.

## Trước đó (PR #226, nhánh `claude/chao-ban-oo5ijl`)

Theo yêu cầu: tạo module top-level mới **"Vận Hành"** gồm 3 tab độc lập, và **xoá hoàn toàn "Đầu Tư"**
khỏi module "Tổng Hợp" (kể cả dữ liệu trong DB thật, không chỉ ẩn giao diện):

1. **Vận Hành — 3 luồng nghiệp vụ MỚI, hoàn toàn tách biệt** (không phải di dời từ Tổng Hợp): "Phê Duyệt
   Đơn Hàng" (kèm bảng chi tiết hàng hoá), "Mở Mới Siêu Thị", "Sửa Chữa Siêu Thị" — mỗi luồng 1 collection
   riêng (`operationOrders`/`operationStoreOpenings`/`operationRepairs`), tạo hồ sơ luôn ép về đúng phòng
   ban người tạo (không tạo hộ phòng khác), duyệt theo quy trình phòng ban cấu hình được ở Hệ Thống →
   Quy Trình & Phê Duyệt (đã bổ sung 3 mục mới ở đó — **cần admin vào cấu hình người duyệt sau khi
   deploy**, nếu chưa cấu hình sẽ tự rơi về chỉ admin duyệt được theo cơ chế mặc định có sẵn của engine).
   3 quyền tạo mới (`pOperationOrderCreate`/`pOperationStoreOpenCreate`/`pOperationRepairCreate`) trong
   khối phân quyền admin mới "🚚 Vận Hành".
2. **Xoá "Đầu Tư" khỏi Tổng Hợp**: gỡ toàn bộ khỏi giao diện (nav/tab con/dropdown/nhãn/báo cáo/quyền
   `officeInvest`) và khỏi validate server (`OFFICE_SUBTYPE_TO_PERM_FLAG` không còn nhận `DAU_TU` — tự
   động chặn tạo mới, không cần thêm code chặn riêng). Script một-lần `server/scripts/purge-dau-tu.js`
   (dry-run mặc định, `--confirm` để xoá thật) xoá THẲNG khỏi `dbo.Records` toàn bộ hồ sơ Đầu Tư còn lại
   cùng đề nghị thanh toán phát sinh từ đó — **KHÔNG qua Thùng Rác** (đúng yêu cầu "không giữ lại gì"),
   kèm dọn file đính kèm không còn ai tham chiếu.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường mới, không thêm
dependency mới — chỉ copy code + `pm2 restart`. **CẦN THAO TÁC THỦ CÔNG 1 LẦN sau khi deploy:**
(1) chạy `node scripts/purge-dau-tu.js` (từ thư mục `server/`) để xem trước, rồi `node
scripts/purge-dau-tu.js --confirm` để xoá vĩnh viễn dữ liệu Đầu Tư còn lại trên DB thật; (2) admin vào
Hệ Thống → Quy Trình & Phê Duyệt cấu hình người duyệt cho 3 luồng Vận Hành mới (nếu không cấu hình, mặc
định chỉ admin duyệt được).

Đã kiểm thử: phát hiện + fix 1 lỗi nghiêm trọng qua chạy test thật (không phải chỉ đọc code) —
`updateTongHopNavVisibility()` còn tham chiếu phần tử đã xoá gây crash toàn bộ nav Tổng Hợp cho mọi
người dùng, đã fix. `tests/test-office-budget.js` chạy lại 54/54 pass sau fix, xác nhận không regression
ở Office/Budget. `node -c` + kiểm tra trùng id HTML/cân bằng div toàn bộ `public/index.html`.

## Trước đó (PR #224, nhánh `claude/chao-ban-oo5ijl`)

Sửa lại mô hình phân quyền Ngân Sách vừa thêm ở PR #222 theo yêu cầu làm rõ lại — **bỏ hẳn tầng "xem miễn
phí"**, `budgetCreate` trở thành quyền NỀN TẢNG bắt buộc:

1. **`budgetCreate` ("Xem, tạo ngân sách")** — quyền nền tảng, PHẢI có mới vào được module: xem/nhập/sửa
   ngân sách Phê Duyệt & Thực Hiện của ĐÚNG phòng ban mình, và giờ ĐÃ xem được tab "Tổng Hợp" — nhưng chỉ
   thấy đúng phòng mình (dữ liệu đồng bộ về máy vốn đã lọc theo `canViewBudgetEntry()` phía server).
2. **`budgetAggregate` (Tổng hợp)** — không đổi hành vi: thêm khối "Theo Phòng Ban" MỌI phòng ban +
   "Chi Tiết Theo Hạng Mục" trong tab Tổng Hợp, KHÔNG thấy khối "📌 Toàn Công Ty".
3. **`budgetManage` (Quản lý — cao nhất)** — không đổi hành vi: xem hết mọi phòng ban + khối "Toàn Công
   Ty", toàn quyền tạo/đóng/mở kỳ + quản lý mẫu — xác nhận lại KHÔNG sửa được ngân sách của phòng ban khác
   (server đã chặn cứng ở `updateBudgetEntryDraft()`/`submitBudgetEntry()` từ trước, không cần sửa gì).

- **`canAccessBudgetModule()`** (`public/index.html`): trở lại đòi ÍT NHẤT 1 trong 3 quyền
  budgetCreate/budgetAggregate/budgetManage — đúng khuôn `canAccessOfficeModule()` (đòi officeBuy/Fix/
  Invest). Cũng bổ sung guard `alert`-chặn `switchTab('budget')` còn thiếu từ trước (mọi module khác đều
  có sẵn, riêng budget trước đây chỉ ẩn nút điều hướng chứ chưa chặn gọi thẳng hàm).
- Cập nhật lại ghi chú + nhãn 3 checkbox trong cây phân quyền admin (khối 18 — Ngân Sách).
- `tests/_seed.js`: `tp_kd` (Trưởng phòng, approver) thêm `budgetCreate` để còn vào module xử lý duyệt
  được — đúng thực tế Trưởng phòng cũng cần quyền lập/sửa ngân sách phòng mình.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường mới, không thêm
dependency mới — chỉ copy code + `pm2 restart`.

Đã kiểm thử: viết lại kịch bản test-office-budget.js — người không có quyền nào bị khoá hoàn toàn (nav ẩn
+ switchTab bị chặn); người chỉ có budgetCreate thấy Tổng Hợp đúng phòng mình, không thấy Toàn Công Ty —
54/54 pass. Toàn bộ `tests/test-*.js` — 0 lỗi.

## Trước đó (PR #222, nhánh `claude/chao-ban-oo5ijl`)

Theo yêu cầu: module "Ngân Sách" áp dụng mô hình phân quyền **3 tầng** thay vì bắt buộc 1 trong 3 quyền
phẳng (`budgetCreate`/`budgetAggregate`/`budgetManage`) mới vào được module:

1. **Tầng mặc định (không cần bật quyền nào)** — bất kỳ nhân viên nào còn quyền vào module "Ngân Sách"
   (mục 0) đều xem được (chỉ đọc) ngân sách **của chính phòng ban mình** ở tab Phê Duyệt/Thực Hiện.
2. **`budgetAggregate` (Tổng hợp)** — thêm tab "📊 Tổng Hợp", nhưng chỉ thấy khối "Theo Phòng Ban" (mọi
   phòng ban) + "Chi Tiết Theo Hạng Mục" — KHÔNG thấy con số gộp toàn công ty.
3. **`budgetManage` (Quản lý — cấp cao nhất)** — thấy mọi thứ tầng 2 thấy, CỘNG thêm khối "📌 Toàn Công
   Ty" (4 thẻ tổng Phê Duyệt/Thực Hiện/Chênh Lệch/% Sử Dụng + OPEX/CAPEX gộp cả công ty) trong tab Tổng
   Hợp, cùng quyền tạo/đóng/mở kỳ và quản lý mẫu ngân sách như trước.

- **Nguyên nhân đổi được mà không cần sửa server**: `lib/recordViewScope.js` (`canViewBudgetEntry`) từ
  trước đã cho phép xem bản ghi cùng phòng ban (`item.dept === user.dept`) mà không đòi `budgetCreate` —
  chỉ riêng cổng vào module ở client (`canAccessBudgetModule()`) đang chặn nhầm người không có 1 trong 3
  quyền phẳng. Nới cổng này ra là đủ để có tầng mặc định, không đụng gì tới server.
- **Client** (`public/index.html`): `canAccessBudgetModule()` chỉ còn yêu cầu còn quyền vào module (mục
  0); `setBudgetSubTab()` cho `budgetManage` vào tab Tổng Hợp luôn (superset của `budgetAggregate`);
  `renderBudgetSummaryResult()` tách khối "Toàn Công Ty" ra khỏi phần luôn hiển thị, chỉ render khi
  `canManageBudgetClient()` đúng. Cập nhật lại ghi chú + nhãn 3 checkbox trong cây phân quyền admin (khối
  18 — Ngân Sách) giải thích rõ mô hình 3 tầng.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường mới, không thêm
dependency mới — chỉ copy code + `pm2 restart`.

Đã kiểm thử: thêm user `budgetagg1` (chỉ `budgetAggregate`, không `budgetManage`) vào `tests/_seed.js` để
cô lập đúng ranh giới tầng 2/tầng 3, viết 3 kịch bản mới trong `tests/test-office-budget.js` (dùng
`tp_kd`/`budgetagg1`/`budgetmgr1`) xác nhận đúng biên giới 3 tầng — 51/51 pass. Toàn bộ `tests/test-*.js`
— 0 lỗi. `node -c` + kiểm tra trùng id HTML/cân bằng div trong `public/index.html`.

## Trước đó (PR #220, nhánh `claude/chao-ban-oo5ijl`)

Theo yêu cầu: module "Ngân Sách" (con của "Tổng Hợp") xoá hết cấu trúc tab con cũ, thay bằng đúng 3 tab:

1. **✅ Ngân Sách Phê Duyệt** — phòng ban lập ngân sách, gửi Trưởng phòng duyệt (cột: STT/Hạng mục/Mô tả/
   Tổng tiền/Loại ngân sách OPEX-CAPEX).
2. **💳 Ngân Sách Thực Hiện** — phòng ban ghi nhận chi tiêu THỰC TẾ cùng kỳ, cùng cấu trúc cột, cũng qua
   Trưởng phòng duyệt (đảm bảo số liệu đối chiếu đáng tin).
3. **📊 Tổng Hợp** — so sánh Phê Duyệt vs Thực Hiện: tổng theo phòng ban, theo OPEX/CAPEX, chi tiết theo
   từng hạng mục (đối chiếu theo tên trong cùng phòng ban), có Chênh Lệch + % Sử Dụng.

"Tạo Kỳ Ngân Sách + Mẫu Ngân Sách" (trước đây là 1 sub-tab riêng) chuyển vào modal **"⚙️ Quản Lý Kỳ &
Mẫu"** (chỉ hiện với người có quyền `budgetManage`) để module đúng 3 tab con.

- **Thiết kế**: 2 tab Phê Duyệt/Thực Hiện dùng CHUNG 1 collection `budgetEntries`, chung state machine
  DRAFT→PENDING→APPROVED/REJECTED, chung engine duyệt theo phòng ban (`budgetDeptWorkflows`), chung
  Approval Hub — chỉ thêm 1 field phân loại `entryKind: 'PLAN' | 'ACTUAL'` (mặc định `'PLAN'`, tương
  thích ngược 100% với dữ liệu cũ).
- **Server** (`lib/createValidation.js`): ràng buộc "1 bản/phòng ban/kỳ" (`getLockKey` + kiểm tra trùng
  lặp của `budgetEntries`) mở rộng thêm `entryKind` vào khoá — 1 phòng ban giờ lập được CẢ bản Phê Duyệt
  LẪN bản Thực Hiện trong cùng 1 kỳ mà không đụng khoá của nhau, vẫn chặn đúng trùng lặp trong cùng loại.
- **Client** (`public/index.html`): các hàm dùng chung cho 2 tab (`renderBudgetEntrySubTab`,
  `saveBudgetEntryDraft`, `submitCurrentBudgetEntry`, `renderBudgetEntryList`, ...) tham số hoá theo
  `kind` thay vì nhân đôi code — mọi id DOM lặp lại giữa 2 tab dùng hậu tố `_PLAN`/`_ACTUAL`.
  `lib/recordActions.js`/`lib/recordViewScope.js`/`lib/workflowEngine.js` không cần sửa — đã generic
  theo record, hoạt động đúng cho cả 2 `entryKind`.

**Deploy impact:** không đổi `server/sql/schema.sql` (`entryKind` là field JSON tự do trong payload đã
lưu, không cần cột/index mới), không thêm biến môi trường mới, không thêm dependency mới — chỉ copy code
+ `pm2 restart`.

Đã kiểm thử: cập nhật `tests/test-office-budget.js` (thêm kịch bản lập/gửi/duyệt bản Thực Hiện cho cùng
kỳ+phòng ban — xác nhận KHÔNG bị chặn trùng với bản Phê Duyệt, + kịch bản Tổng Hợp so sánh 2 chiều) và
`tests/test-audit-round2-cluster3.js` (khoá/thông báo lỗi mới do đổi `getLockKey`) — 42/42 + 21/21 pass.
Toàn bộ `tests/test-*.js` (40 file) — 0 lỗi. `node -c` mọi file server đã sửa + kiểm tra trùng id HTML/
cân bằng div trong `public/index.html`. Demo Playwright thủ công end-to-end (đăng nhập → tạo kỳ qua modal
→ lập+duyệt bản Phê Duyệt → lập+duyệt bản Thực Hiện cùng kỳ → xem Tổng Hợp) — xác nhận đúng số liệu và
giao diện.

## Trước đó (PR #218, nhánh `claude/chao-ban-oo5ijl`)

Theo phản ánh: mở màn "Hệ Thống" (đặc biệt tab con "Phân Quyền" — cây quyền rất dài), thanh chuyển tab
con bị đẩy mất khỏi màn hình ngay khi cuộn xuống, phải cuộn ngược lên đầu trang mới đổi được tab khác —
dù code ĐÃ có class `sticky` từ trước.

- **Nguyên nhân**: `#systemSubTabBar` (Quản Trị/Biểu Mẫu/Quy Trình & Phê Duyệt/Quản Lý Tệp File/Log/Thùng
  Rác) chỉ được bọc bởi `#systemSection` — một `<div>` trước đây CHỈ chứa mỗi thanh đó (cao ~41px) — còn
  6 màn nội dung con (`formSection`/`adminSection`/`workflowSection`/`uploadTypeSection`/`logSection`/
  `trashSection`) lại là ANH EM đứng ngoài, không phải con của `#systemSection`. `position: sticky` chỉ
  "dính" được trong đúng phạm vi chiều cao thẻ cha trực tiếp, nên thanh mất hẳn ngay khi cuộn qua khỏi
  41px đó — sticky trông như "không hoạt động" dù đủ class.
- **Cách sửa** (`public/index.html`): chuyển toàn bộ 6 màn nội dung con nói trên vào làm CON thật sự của
  `#systemSection` (thẻ đóng của `#systemSection` dời xuống sau `#uploadTypeSection`) — chỉ đổi vị trí
  thẻ trong DOM, không đổi nội dung/id/onclick nào. Nhờ vậy `#systemSection` luôn cao bằng đúng nội dung
  tab con đang hiện, thanh dính suốt quá trình cuộn.
- Thanh tab con của Quản Trị (Cấu Hình Email/Quản Lý Danh Mục/Phân Quyền/API Xác Thực Ngoài) cũng đổi
  sang `sticky`, dính ngay dưới thanh Hệ Thống ở trên — `top` tính động bằng JS
  (`positionAdminSubTabBar()`, gọi khi vào tab Quản Trị + khi resize/xoay màn hình) vì chiều cao thật của
  thanh trên thay đổi theo bề rộng màn hình (6 nút tự xuống dòng khác nhau trên điện thoại/tablet/
  desktop).

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường mới, không thêm
dependency mới — chỉ copy code + `pm2 restart`.

Đã kiểm thử bằng Playwright thật (đăng nhập bcrypt + TOTP 2FA thật qua route thật, không mock): cuộn sâu
vào tab "Phân Quyền" trên cả viewport mobile lẫn desktop — xác nhận cả 2 thanh giờ dính đúng ngay dưới
header, không còn bị đẩy mất; xác nhận cả 6 tab con Hệ Thống vẫn chuyển đổi hiển thị đúng sau khi tái cấu
trúc. `node -c` script + kiểm tra div-balance toàn file (không đổi so với trước — xác nhận việc di chuyển
khối HTML không làm lệch cân bằng thẻ). Toàn bộ `tests/test-*.js` — 0 lỗi, không regression.

## Trước đó (PR #216, nhánh `claude/chao-ban-oo5ijl`)

Theo yêu cầu rà soát lại đúng 2 phần của API xác thực ngoài trước khi giao cho đối tác cấu hình:

- **`POST /api/external/verify-credentials`**: đã khớp đúng yêu cầu sẵn — dùng API key để xác thực, trả
  `{success:false}` khi sai username/password, `{success:true}` khi đúng. Không cần sửa gì.
- **`GET /api/external/users`**: sửa lại response cho ĐÚNG 6 field đối tác yêu cầu — **vị trí, mã nhân
  viên, tên nhân viên, điện thoại, phòng, chức danh** — thay vì 7 field cũ (`username/name/dept/
  jobTitle/phone/email/active`).
  - `position` (vị trí): suy từ field `posType` sẵn có trong hệ thống ("Văn phòng" khi HO, "Siêu Thị" khi
    STORE — đúng khái niệm "Vị Trí" ở màn Người Dùng). User cũ tạo trước khi có field `posType` được suy
    luận lại y hệt logic phía client hiện có (dựa vào `dept` có trùng tên 1 siêu thị trong danh mục
    `stores` hay không).
  - `username`: đóng vai trò "mã nhân viên" — hệ thống không có field mã nhân viên riêng, `username` là
    định danh duy nhất/không đổi của mỗi nhân sự dùng để đăng nhập.
  - Bỏ hẳn `email` và `active` khỏi response vì không nằm trong 6 field đối tác yêu cầu.
- **Lưu ý cho người dùng**: chưa cấp API key thật nào cho đối tác — việc tạo key phải làm trực tiếp trên
  màn Admin (Hệ Thống → Quản Trị → API Xác Thực Ngoài → "Tạo Key Mới") vì key thật chỉ hiển thị đúng 1 lần
  lúc tạo và không thể sinh hộ được từ môi trường phát triển.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường mới, không thêm
dependency mới — chỉ copy code + `pm2 restart`.

Đã kiểm thử: `tests/test-external-auth.js` cập nhật/thêm 2 kịch bản (đúng 6 field, suy luận vị trí cho
user cũ chưa có `posType` tường minh) — 26/26 pass. Toàn bộ `tests/test-*.js` — 0 lỗi, không regression.

## Trước đó (PR #214, nhánh `claude/chao-ban-oo5ijl`)

Theo yêu cầu: thêm lớp bảo mật thứ 2 cho API xác thực ngoài (PR #212) — cấu hình theo TỪNG API key danh
sách IP được phép gọi.

- `lib/externalAuth.js`: `isIpAllowed()`/`parseAllowedIpsInput()` — so khớp IPv4 chính xác hoặc dải CIDR
  (`x.x.x.x/y`), IPv6 so khớp chính xác; validate định dạng ngay khi admin nhập, từ chối rule sai để
  tránh admin tưởng đã giới hạn IP nhưng rule thực chất vô nghĩa.
- `routes/externalAuthAdmin.js`: `POST /api/admin/external-api-keys` nhận thêm `allowedIps` khi tạo key;
  route mới `POST /api/admin/external-api-keys/:id/allowed-ips` để sửa lại sau (chỉ sửa được key đang
  hoạt động, không sửa được key đã thu hồi).
- `routes/externalAuthVerify.js`: middleware `requireExternalApiKey` (dùng chung cho cả
  `POST /verify-credentials` lẫn `GET /users`) trả `403` nếu IP gọi thật không nằm trong `allowedIps` của
  key — key đúng nhưng gọi từ IP lạ vẫn bị chặn.
- Admin UI (Hệ Thống → Quản Trị → API Xác Thực Ngoài): ô nhập IP cho phép khi tạo key, nút "Sửa IP" cho
  từng dòng, cột hiển thị danh sách hoặc "Mọi IP".
- **Tương thích ngược**: `allowedIps` rỗng (mặc định, gồm mọi key tạo TRƯỚC PR này) = không hạn chế IP,
  hành vi y hệt trước đây — không cần thao tác gì thêm cho các key đã cấp.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường mới, không thêm
dependency mới — chỉ copy code + `pm2 restart`.

Đã kiểm thử: `tests/test-external-auth.js` thêm 5 kịch bản (hàm thuần isIpAllowed/parseAllowedIpsInput,
tạo key với IP sai định dạng, key giới hạn IP chặn/cho qua đúng IP, key không cấu hình không bị ảnh
hưởng, sửa IP: chặn non-admin/key đã thu hồi/id sai) — 25/25 pass. Toàn bộ 41 file `tests/test-*.js` — 0
lỗi, không regression.

## Trước đó (PR #212, nhánh `claude/chao-ban-oo5ijl`)

Theo yêu cầu: viết API cho phép ứng dụng NGOÀI hệ thống xác thực tài khoản HCRC Workspace (cấp API key,
trả về thành công/thất bại), sau đó bổ sung thêm API đồng bộ thông tin danh bạ (username/tên/số điện
thoại/phòng/chức danh) sang ứng dụng đó.

- **Quản lý API key** (`routes/externalAuthAdmin.js`, admin-only, `/api/admin/external-api-keys`): tạo/
  liệt kê/thu hồi. Key thật (`hcrc_` + 64 ký tự hex ngẫu nhiên) chỉ hiển thị **đúng 1 lần** lúc tạo — từ
  đó DB chỉ lưu bcrypt hash (10 rounds, cùng chuẩn `lib/auth.js` dùng cho mật khẩu người dùng), không có
  cách nào lấy lại được key thật kể cả có toàn quyền truy cập DB.
- **Xác thực tài khoản** (`POST /api/external/verify-credentials`): body `{account,password}` kèm header
  `Authorization: Bearer <API key>`, trả `{success:true|false}`. KHÔNG cấp phiên/cookie (không phải đăng
  nhập hộ) — chỉ trả lời đúng/sai. Dùng CHUNG bộ đếm khoá tài khoản (`lib/loginAttempts.js`) với
  `POST /api/auth/login` — 5 lần sai liên tiếp thì khoá tạm 15 phút, không mở thêm đường dò mật khẩu
  không giới hạn số lần thử qua kênh mới này.
- **Đồng bộ danh bạ** (`GET /api/external/users`): cùng API key, trả username/tên/điện thoại/email/
  phòng ban/chức danh/trạng thái hoạt động của toàn bộ tài khoản, hoặc 1 hồ sơ qua `?account=<username>`
  — KHÔNG BAO GIỜ kèm mật khẩu/PIN dù đã hash.
- **Admin UI**: sub-tab mới "🔑 API Xác Thực Ngoài" trong Hệ Thống → Quản Trị.
- **Bảo mật đọc**: collection `externalApiKeys` ẩn HOÀN TOÀN khỏi `GET /api/data` cho người không phải
  admin (không chỉ lọc field bí mật như các collection khác) — nhân viên thường không có lý do gì cần
  biết danh sách key tích hợp ngoài tồn tại; kể cả admin cũng không bao giờ thấy `keyHash` qua bất kỳ
  response nào.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm dependency mới (dùng lại `bcryptjs`/
`express-rate-limit` đã có) — chỉ copy code + `pm2 restart`. Thêm biến môi trường TUỲ CHỌN
`EXTERNAL_AUTH_RATE_LIMIT_MAX` (giới hạn số lần gọi `/api/external/*` từ 1 IP/15 phút, mặc định 300, có
đường lùi nếu không đặt).

Đã kiểm thử: `tests/test-external-auth.js` (mới, 20 kịch bản: quản lý key, xác thực đúng/sai/khoá tài
khoản/tài khoản vô hiệu hoá/không cấp cookie, đồng bộ danh bạ toàn bộ/tra cứu lẻ/404/401) — 20/20 pass.
Toàn bộ 42 file `tests/test-*.js` — 0 lỗi, không regression.

## Trước đó (PR #210, nhánh `claude/chao-ban-oo5ijl`)

Theo yêu cầu: hiện thực hoá hướng ghép file PDF thật (đã phân tích/demo ở PR #208) cho Báo Cáo Định Kỳ —
áp dụng ở CẢ bước nhân viên nộp báo cáo lẫn bước người tổng hợp ghép báo cáo cuối, chạy song song hoàn
toàn với luồng `.pptx` hiện có (không thay thế).

- **`reportEntries.entryType` ('PDF' | 'PPTX', mặc định 'PPTX')**: nhân viên có thể chọn nộp nhiều file PDF
  — trình duyệt tự ghép (bằng `pdf-lib`, ghép byte thật, không rasterize) thành 1 file duy nhất trước khi
  tải lên, thay cho luồng `.pptx`+`parsedSlides` cũ (vẫn giữ nguyên 100% khi không chọn chế độ PDF).
- **`reportPeriods.pdfCompilation`** (tách riêng hoàn toàn khỏi `compilation`/`taskCompilation`, không đụng
  lẫn nhau): người tổng hợp chọn các báo cáo PDF đã nộp, hệ thống tự gom theo THỨ TỰ PHÒNG BAN (tái dùng
  đúng thuật toán đã có ở tổng hợp PPTX), cho sửa/xoá/sắp lại TỪNG TRANG bằng lưới kéo-thả trước khi ghép,
  ghép lại bao nhiêu lần tuỳ ý (`/mergePdf`). "Phát hành" (`/publishPdf`) mới thật sự mở từng file nguồn,
  ghép byte thật + đóng dấu watermark (tái dùng đúng kỹ thuật ở `routes/download.js`) thành 1 file PDF cuối
  cùng, sau đó khoá không sửa được nữa — phải "Hủy phát hành" (`/unpublishPdf`) mới tổng hợp lại được.
- **Trình chiếu PDF thật, toàn màn hình**: xem trực tiếp file PDF đã phát hành ngay trên giao diện (dùng
  `pdf.js` render từng trang, KHÔNG rasterize/vỡ định dạng gốc), dùng luôn `Fullscreen API` thật của trình
  duyệt (`requestFullscreen()`, lần đầu áp dụng trong hệ thống) — tái dùng chung 1 modal trình chiếu với
  chế độ slide PPTX cũ.
- **Bảo mật**: mọi trang trong `pdfCompilation.pages[]` client gửi lên chỉ có `{sourceEntryId,
  sourcePageIndex}` — server luôn tự tra lại `entry` thật rồi tự dựng lại phòng ban/người nộp/đường dẫn
  file, không tin bất kỳ field nào khác client có thể gửi kèm.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường mới, không thêm
dependency mới (`pdf-lib`/`@pdf-lib/fontkit` đã có sẵn trong `package.json` từ trước) — chỉ copy code +
`pm2 restart`. File `public/vendor/pdf-lib/pdf-lib.min.js` (vendor mới cho phía trình duyệt) đã được commit
sẵn trong repo, không cần chạy `npm install`/bước thủ công nào thêm.

Đã kiểm thử: `tests/test-periodic-report-pdf.js` (mới, 10 kịch bản: nộp/validate/regression/quyền/tổng hợp
theo phòng ban/ghép lại thay thế hoàn toàn/phát hành ra đúng số trang đã chọn+watermark/trang tham chiếu
lỗi thời bị chặn/hủy phát hành/quyền xem `pdfCompilation`) — 10/10 pass. Toàn bộ 44 file `tests/test-*.js`
— 0 lỗi, không regression (kể cả `tests/test-periodic-report.js` cũ, xác nhận luồng `.pptx` không đổi hành
vi).

## Trước đó (PR #208, nhánh `claude/chao-ban-oo5ijl`)

Theo yêu cầu: kiểm tra module Điều Hành, gỡ tính năng "Mẫu Trình Chiếu" khỏi Báo Cáo Định Kỳ, và tách phần
"Tổng Hợp Theo Công Việc" ra khỏi "Tổng Hợp Theo Báo Cáo" để dùng làm đối chiếu.

- **Gỡ "Mẫu Trình Chiếu":** xác nhận "Điều Hành" chỉ là dropdown nav gộp 3 module con (Biên bản họp/Công
  việc/Báo Cáo Định Kỳ) — tính năng Mẫu Trình Chiếu thực chất nằm trong module con "Báo Cáo Định Kỳ". Gỡ
  toàn bộ: collection `reportSlideTemplates` (server + client), sub-tab "🎨 Mẫu Trình Chiếu", pipeline
  trích ảnh nền từ ảnh/PDF/PowerPoint (~15 hàm client), route CRUD. Bỏ luôn yêu cầu bắt buộc chọn mẫu khi
  tạo Kỳ Báo Cáo — mọi kỳ mới dùng chung 1 giao diện mặc định cố định (giữ nguyên đọc được cho các kỳ cũ
  đã chọn mẫu 'ORANGE_GOLD'/'DEFAULT' đời trước, không ép migrate).
- **Tách "Đối Chiếu Theo Công Việc" khỏi "Tổng Hợp Theo Báo Cáo":** trước đây 2 nút "Tổng Hợp Theo Báo
  Cáo"/"Tổng Hợp Theo Công Việc" cùng ghi vào field `period.compilation` — bấm nút nào sau thì nội dung
  của nút kia bị ghi đè mất hoàn toàn. Nay `period.compilation` (từ báo cáo người dùng nộp) giữ nguyên
  hành vi cũ 100%; thêm field mới `period.taskCompilation` (từ `DB.tasks`) — hoàn toàn tách biệt, chỉ xem
  (không sửa/publish/trình chiếu), sinh lại từ đầu mỗi lần bấm nút "Đối Chiếu Theo Công Việc" — cho phép so
  công việc thật ghi nhận trong hệ thống với nội dung nhân viên tự báo cáo mà không mất dữ liệu bên nào.
  `taskCompilation` chỉ hiện qua `GET /api/data` cho `reportManage`/`reportAggregate`/`admin`.
- **Phân tích + demo (không có thay đổi code):** đã nghiên cứu kỹ thuật và làm demo tương tác thật (chạy
  `pdf-lib` + `pdf.js` ngay trong trình duyệt) so sánh ghép nhiều file bằng PPTX vs PDF cho phần báo cáo
  nộp — gửi riêng cho người dùng qua Artifact, không nằm trong PR này.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường mới, không thêm
dependency mới — chỉ copy code + `pm2 restart`. Lưu ý dữ liệu cũ: các kỳ báo cáo đã từng dùng "Tổng Hợp
Theo Công Việc" TRƯỚC bản này vẫn hiển thị nguyên vẹn trong khu vực "Tổng Hợp Theo Báo Cáo" — không tự
động tách ra `taskCompilation`; chỉ những lần bấm "Đối Chiếu Theo Công Việc" SAU khi deploy mới ghi vào
field mới.

Đã kiểm thử: `tests/test-periodic-report.js` viết lại/mở rộng (8 kịch bản, gồm kịch bản xác nhận
`taskCompilation` tách biệt hoàn toàn khỏi `compilation` + kịch bản xác nhận không lộ cho người không có
quyền quản lý/tổng hợp) — 8/8 pass. Toàn bộ 39 file `tests/test-*.js` — 0 lỗi, không regression.

## Trước đó (PR #206, nhánh `claude/chao-ban-oo5ijl`)

Bổ sung cho tính năng TOTP bắt buộc admin ở PR #204: trước đây, muốn thêm 1 thiết bị Authenticator khác
(vd điện thoại thứ 2) bắt buộc phải gỡ TOTP rồi thiết lập lại từ đầu, vì mã QR/bí mật chỉ hiện đúng 1 lần
lúc thiết lập ban đầu. Người dùng phản ánh muốn đăng ký Authenticator trên 2 thiết bị — PR này thêm khả
năng tự hiện lại đúng mã QR/bí mật ĐANG DÙNG (không sinh bí mật mới) để quét thêm ở thiết bị thứ 2, không
ảnh hưởng thiết bị thứ nhất (TOTP vốn là 1 bí mật dùng chung — nhiều app cùng giữ đúng 1 bí mật đều sinh
ra cùng mã hợp lệ ở mỗi thời điểm, không có khái niệm "thiết bị chính/phụ").

- `routes/auth.js`: route mới `POST /totp/reveal-secret` — giải mã `totpSecretEnc` đã lưu (bằng
  `decryptSecret()` có sẵn từ trước) và trả lại đúng secret/otpauth URI/QR hiện tại. Bắt buộc xác nhận lại
  mật khẩu hiện tại (cùng cơ chế lockout/rate-limit như `DELETE /totp`), gửi email báo mỗi lần dùng vì đây
  là hành động lộ ra 1 bí mật còn hiệu lực. **Không** tăng `sessionVersion` — giống `/setup-verify`, đây là
  hành động "thêm" chứ không phải "thu hồi lòng tin" (khác `DELETE /totp` và `DELETE /totp/:username`).
- `public/index.html`: thêm khối "➕ Thêm Thiết Bị Authenticator Khác" trong Hồ Sơ Cá Nhân → tab Xác Thực 2
  Lớp — nhập mật khẩu → hiện QR + mã thủ công để quét thêm trên máy thứ 2.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường mới (tái dùng
`EMAIL_ENCRYPTION_KEY` đã có), **không** thêm dependency mới (tái dùng nguyên `otplib`/`qrcode` đã cài từ
PR #204) — chỉ copy code + `pm2 restart`, không cần `npm install` lại.

Đã kiểm thử: 39 file `tests/test-*.js` pass, trong đó `test-admin-totp.js` có thêm 5 kịch bản mới cho
`reveal-secret` (thiếu mật khẩu, chưa bật TOTP, sai mật khẩu, đúng mật khẩu trả đúng bí mật đang dùng — xác
minh bằng cách đăng nhập thật lại bằng mã sinh từ bí mật trả về, không tăng sessionVersion) — tổng 26/26
kịch bản trong file này pass.

## Trước đó (PR #204, nhánh `claude/chao-ban-oo5ijl`)

Hoàn tất yêu cầu "tài khoản admin bắt buộc xác thực hai yếu tố" — bước tiếp theo sau PR #202 (đã làm
trước phần admin gỡ hộ vân tay khi mất thiết bị). Chọn TOTP (Google/Microsoft Authenticator...) làm
phương thức bắt buộc DUY NHẤT cho admin, theo đúng thiết kế đã trao đổi và xác nhận với người dùng.

- `lib/totp.js` (mới) — sinh bí mật/QR/otpauth URI (`otplib`), xác minh mã, sinh + hash 10 mã khôi phục
  dùng 1 lần (bcrypt, cùng khuôn PIN), 2 Map bộ nhớ tạm cho luồng đăng nhập 2 bước và luồng thiết lập.
- `lib/auth.js`: mở rộng `blockIfMustChangePassword` để cũng chặn admin chưa bật TOTP ở mọi route nghiệp
  vụ — dùng lại đúng middleware đã mount sẵn ở ~17 route file, không cần sửa lại từng nơi.
- `routes/auth.js`: đăng nhập 2 bước THẬT cho admin đã bật TOTP — `POST /login` không cấp cookie ngay
  (mật khẩu đúng chỉ là bước 1/2), phải qua `POST /verify-totp-login` (mã 6 số hoặc 1 mã khôi phục) mới
  cấp phiên — tránh 1 mật khẩu bị lộ vẫn đủ để có phiên hoạt động. Thêm route tự thiết lập/tự gỡ
  (`/totp/setup-options`, `/totp/setup-verify`, `DELETE /totp`, đòi xác nhận mật khẩu) và admin gỡ hộ
  người khác mất điện thoại (`GET /totp/status/:username`, `DELETE /totp/:username`, tăng
  `sessionVersion` của NGƯỜI ĐÓ) — kèm email báo mỗi lần thiết lập/gỡ để phát hiện sớm nếu bị chiếm phiên.
- `routes/data.js`: strip thêm `totpSecretEnc`/`totpBackupCodeHashes` khỏi `GET /api/data` chung.
- `public/index.html`: màn đăng nhập bước 2 (nhập mã/mã khôi phục), modal bắt buộc thiết lập TOTP (QR +
  mã thủ công + xác nhận + hiển thị mã khôi phục đúng 1 lần), mục "Xác Thực 2 Lớp" trong Hồ Sơ Cá Nhân,
  và khối gỡ hộ trong màn Sửa Người Dùng (chỉ hiện khi target đang có quyền admin).

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường mới (tái dùng
`EMAIL_ENCRYPTION_KEY` đã có để mã hoá bí mật TOTP) — **CÓ** thêm dependency mới `otplib@^12`, cần chạy
lại `npm install` trên server thật trước khi `pm2 restart`.

Đã kiểm thử: 39 file `tests/test-*.js` pass (38 file cũ + 1 file mới `test-admin-totp.js`, 21 kịch bản
riêng đợt này — thiết lập, đăng nhập 2 bước, tự gỡ, admin gỡ hộ, data-minimization). 4 file test cũ cần
thêm `totpEnabled:true` vào fixture admin dùng để đăng nhập trực tiếp qua `proceedAfterAuth()` (không
liên quan nội dung các bài test đó, chỉ là hệ quả tất yếu của cổng TOTP mới).

## Trước đó (PR #202, nhánh `claude/chao-ban-oo5ijl`)

Bước đầu trên đường tới yêu cầu "tài khoản admin bắt buộc xác thực 2 yếu tố" (đang trao đổi thêm phương
án cho phần còn lại — chọn WebAuthn hay OTP email làm lớp bắt buộc, cách xử lý khi bật tính năng cho admin
chưa từng thiết lập gì). Làm trước phần hạ tầng cần có ngay: trước đây mỗi người chỉ tự gỡ được thiết bị
vân tay của chính mình — nếu mất thiết bị (hoặc quên luôn mật khẩu) thì không còn cách nào đăng nhập lại
để tự gỡ, kẹt vĩnh viễn.

- `routes/auth.js`: `GET`/`DELETE /api/auth/webauthn/credentials/:username` (admin-only) — admin xem
  danh sách thiết bị an toàn (không lộ publicKey/counter) và gỡ hộ 1 thiết bị của người khác. Tăng
  `sessionVersion` của người bị gỡ (không phải của admin) để mọi phiên cũ của họ mất hiệu lực ngay.
- `routes/data.js`: strip thêm `webauthnCredentials`/`webauthnUserId` khỏi `GET /api/data` chung (trước
  đây lộ cho mọi người đã đăng nhập, không riêng admin — front-end không đọc dùng field này ở đâu ngoài
  2 route riêng đã tự tra DB).
- `public/index.html`: màn Sửa Người Dùng thêm khối liệt kê + nút Gỡ cho từng thiết bị của user đang sửa.

**Deploy impact:** không đổi `server/sql/schema.sql`, không thêm biến môi trường, không thêm dependency
mới — chỉ copy code + `pm2 restart`.

Đã kiểm thử: 38 file `tests/test-*.js` pass (37 file cũ + 1 file mới `test-admin-webauthn-reset.js`, 8
kịch bản riêng đợt này).

## Trước đó (PR #199 → #200, nhánh `claude/chao-ban-oo5ijl`)

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
