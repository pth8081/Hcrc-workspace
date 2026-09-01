# Phiên bản hiện tại

**1.99.1** — đã merge vào `main` (nguồn: `server/package.json`, field `version`, cũng là số hiển thị ở
badge góc màn hình + `/api/health`).

## Cập nhật gần nhất (PR #224, nhánh `claude/chao-ban-oo5ijl`)

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
