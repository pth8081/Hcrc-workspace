# Phiên bản hiện tại

**13.2** (nguồn: `server/package.json`, field `version`, cũng là số hiển thị ở badge góc màn hình +
`/api/health`). Đã merge vào `main` (fast-forward) cùng đợt này. Từ v2.0 trở đi đổi sang định dạng
`MAJOR.MINOR` (không còn semver 3 phần kiểu `1.100.0`) — xem quy tắc đánh version trong `CLAUDE.md`.

## Đợt E (UX rollout — ĐỢT CUỐI/5): nút "↺ Làm Mới" cho Vận Hành Siêu Thị/Onboarding/Offboarding (2026-09-08)

Tiếp nối Đợt A/B/C/D (xem các mục ngay dưới) — áp ĐÚNG mẫu tham chiếu đã dựng
(`confirmAndResetForm()`/chip file ở `core.js`, KHÔNG sửa gì thêm ở đó) cho
5 form Tạo Mới còn lại (Vận Hành Siêu Thị 3 form + Onboarding/Offboarding 2
form), **HOÀN TẤT toàn bộ kế hoạch UX 5 đợt**.

**Vận Hành (`module-vanhanh.js`) — 3 form Tạo Mới (`vanHanhSection`):**
- Đặt Hàng HO/Siêu Thị (`#operationOrderForm`) — `resetOperationOrderForm()`
  (mới): mã đơn tự sinh lại, bảng hạng mục (`operationOrderItems`) collapse
  về ĐÚNG 1 dòng trống, chip file `voFile` (input NÀY đã có
  `data-op-change="handleOperationOrderPdfUpload"` nghiệp vụ riêng đọc PDF
  tự điền form — gọi `onSingleFileChosen()` NGAY trong handler đó, cùng cách
  làm `itPriceFileInput` ở Đợt D), và mở lại khối "Chi Tiết Từ Phiếu Đặt
  Hàng" về đúng trạng thái mặc định (mở) nếu người dùng lỡ thu gọn.
- Mở Mới Siêu Thị (`#operationStoreOpenForm`) — `resetOperationStoreOpenForm()`
  (mới) + chip file đơn `vsoFile`. Field ngân sách DUY NHẤT còn lại
  "Ngân Sách Phê Duyệt — Danh Mục Đầu Tư" (`vsoApprovedBudget`, đổi tên/gộp
  từ field "Chi Phí Phê Duyệt" cũ đã bỏ ở VHST-1) được `form.reset()` xoá
  sạch bình thường.
- Sửa Chữa Siêu Thị (`#operationRepairForm`) — `resetOperationRepairForm()`
  (mới) + chip file đơn `vrFile`, cùng field ngân sách `vrApprovedBudget`
  như trên.
- **Khối "Danh Mục Đầu Tư" 2 cấp (VHST-3)**: xác nhận đây là 1 TAB CON RIÊNG
  (`opStoreEstimatePanel`, sub-tab "📁 Danh mục đầu tư") — chỉ thao tác được
  trên hồ sơ ĐÃ TỒN TẠI (chọn từ danh sách "Mã Hồ Sơ" đã tạo), KHÔNG nhúng
  trong 2 form Tạo Mới ở trên — nên nằm NGOÀI phạm vi đợt UX "form tạo mới
  chưa lưu" này, không cần reset.
- **Phát hiện + vá 1 lỗi có sẵn (KHÔNG do đợt này gây ra)**: module Vận Hành
  dùng riêng `bindOperationDelegation()`/`OP_CLICK_ACTIONS`/`OP_CHANGE_ACTIONS`
  (không phải `bindCspDelegation()` dùng chung ở mọi module khác) — 2 hạ
  tầng dùng chung `confirmAndResetForm()`/`onSingleFileChosen()` (core.js)
  phải khai báo tường minh thêm ở 2 registry này (cùng khuôn `pmsAdd`/
  `pmsRemove` đã có sẵn), nếu không nút "Làm Mới" lẫn nút chọn file mới sẽ
  IM LẶNG không hoạt động trong module này.

**Nhân Sự > Onboarding/Offboarding (`module-hcrcdonghanh.js`) — 2 form Tạo Mới (`hrLifecycleSection`):**
- Onboarding (thêm `id="hrOnboardingForm"`, trước đây chỉ có
  `data-op-submit`) — `resetHrOnboardingForm()` (mới): `form.reset()` +
  đưa Vị Trí về lại `HO` + gọi lại `onHrOnboardingPosTypeChange()` có sẵn để
  re-populate ĐÚNG dropdown Chức Danh theo HO (không sót option Siêu Thị vừa
  chọn) + ẩn/hiện lại đúng khối Phòng Ban/Siêu Thị + trả Email về lại
  KHÔNG bắt buộc.
- Offboarding (thêm `id="hrOffboardingForm"`) — `resetHrOffboardingForm()`
  (mới): `form.reset()` xoá sạch input/ngày/2 checkbox, dọn thêm tường minh
  hidden `hrOffbEmployeeUsername` + ẩn lại info-box `#hrOffbEmployeeInfo` (2
  phần `form.reset()` gốc không tự đụng tới vì được gán bằng JS), rồi gọi
  lại `updateHrOffboardingSubmitState()` có sẵn để khoá lại nút gửi (JS
  không tự bắn sự kiện `change` nên state nút không tự re-compute nếu không
  gọi tường minh).
- **Phát hiện + vá 1 LỖI THẬT NGHIÊM TRỌNG có sẵn (KHÔNG do đợt UX này gây
  ra)**: `#hrLifecycleSection` (module Onboarding/Offboarding, dựng ở commit
  `2278c17`) chưa BAO GIỜ được gọi `bindCspDelegation()` — nghĩa là TOÀN BỘ
  `data-op`/`data-op-change`/`data-op-input`/`data-op-submit` bên trong (2
  nút chuyển sub-tab, cascading Vị Trí→Phòng Ban/Chức Danh, sdd-picker nhân
  viên Offboarding, 2 checkbox bắt buộc, VÀ CẢ 2 NÚT "GỬI YÊU CẦU" CHÍNH)
  hoàn toàn IM LẶNG không chạy từ lúc module này ra mắt cho tới nay — phát
  hiện tình cờ lúc viết test cho nút "Làm Mới" (click không phản ứng gì).
  Vá bằng đúng 1 dòng `bindCspDelegation('hrLifecycleSection');` (core.js,
  cùng chỗ với `orgChartSection` — module con khác của Nhân Sự). **Đây là
  bug thật cần deploy gấp** — không liên quan gì tới "Làm Mới", nhưng phải
  sửa cùng lúc vì phát hiện ngay tại đây.
- **Gia Hạn CNTT (`itServiceRenewals`)**: đã xác nhận ĐÂY LÀ ĐÚNG form
  `#itRenewalCreateForm` (`module-itsupport-renewal.js`) đã hoàn tất ở Đợt D
  — KHÔNG có form "Gia Hạn CNTT" nào khác trong hệ thống, bỏ qua không lặp
  lại việc đã làm.

**Gap-fill Biểu Mẫu (`core.js`)**: thêm `id` cho `hrOnboardingForm`/
`hrOffboardingForm` (cần cho `confirmAndResetForm()`) khiến audit toàn app ở
`test-forms-batch4.js` (đếm MỌI `<form id=... data-op-submit=...>` thật) lần
đầu phát hiện 2 form này CHƯA có `coreKey` trong `CORE_FIELD_MANIFEST`/
`FORM_TABS` (trước đây không có `id` nên "vô hình" với audit đó, module
Biểu Mẫu quản trị chưa từng tuỳ biến được nhãn/bắt buộc cho 2 form này) — bổ
sung `HR_ONBOARDING`/`HR_OFFBOARDING` (nhóm mới `HR_LIFECYCLE`) theo đúng
khuôn có sẵn, loại trừ `hrOnbEmail` (nhãn/bắt buộc bị
`onHrOnboardingPosTypeChange()` tự ghi đè, cùng lý do `tcDocumentIds`) và 2
checkbox `hrOffbChecklistHandover`/`hrOffbChecklistBenefits` (`<label>` bọc
trực tiếp input, cùng lý do `tdMandatory`).

**Bộ test**: mở rộng `server/tests/test-form-reset-file-remove.js` thêm 5
kịch bản (3 form Vận Hành + Onboarding + Offboarding) — tổng 34/34 kịch bản
pass, bao gồm kiểm chứng riêng hành vi cascading picker Onboarding (chọn
Siêu Thị → Làm Mới → về đúng HO, dropdown Chức Danh re-populate lại đúng,
không sót option Siêu Thị) và sdd-picker + 2 checkbox Offboarding (chọn nhân
viên + tích đủ 2 checkbox → nút gửi mở ra → Làm Mới → sdd-picker/ngày/
checkbox/nút gửi đều về lại trạng thái khoá ban đầu). Toàn bộ suite hồi quy
hiện có (79 file `test-*.js`) chạy lại — không phát sinh lỗi mới ngoài 3 lỗi
kết nối SQL Server thật đã biết từ trước ở đúng 2 file
`test-audit-fixes-batch1.js` (2 lỗi)/`test-audit-round2-cluster1.js` (1
lỗi), xác nhận lại giống hệt baseline qua `git stash` (môi trường sandbox
không có SQL Server thật).

**Tổng kết toàn bộ kế hoạch UX 5 đợt (A→B→C→D→E)** — đếm lại CHÍNH XÁC qua
`grep 'data-op="confirmAndResetForm"' public/index.html` (32 nút "↺ Làm Mới"
thật, không phỏng đoán): **32 form Tạo Mới** trên **18 khu vực nghiệp vụ**
(Văn Bản Trình/Hợp Đồng/Tài Liệu/Giấy Phép/Đăng Ký Xe/Phòng Họp/Biên Bản Họp/
Văn Phòng(Mua Bán+Sửa Chữa+Đầu Tư)/Đào Tạo(7 form)/Tuyển Dụng(2)/HCRC Đồng
Hành/Nhịp Sống Nội Bộ/Thanh Toán/Hỗ Trợ IT(3)/VPP(2)/Ngân Sách(2) — 16 khu
vực đã có từ Đợt A-D — cộng thêm Vận Hành(3)/Onboarding-Offboarding(2) mới ở
Đợt E = 18) đã có nút "↺ Làm Mới" + chip "✕ Xoá file" (khi có ô tải tệp).
Lưu ý: Đào Tạo/Tuyển Dụng/Nhịp Sống Nội Bộ về mặt điều hướng đều là sub-tab
CÙNG 1 module top-level `internal` (Truyền Thông Nội Bộ, xem `BUSINESS_MODULES`)
— đếm tách theo khu vực nghiệp vụ/nhóm form ở đây (đúng cách người dùng vẫn
gọi tên), không theo đúng cấp bậc `parent`/top-level kỹ thuật. Ngoại lệ CHỦ Ý
nằm ngoài phạm vi (không phải bỏ sót): sub-tab "🗂️ Quản Lý Thanh Toán" (Đợt D
— UI sửa 1 bản ghi ĐÃ TỒN TẠI) và khối "Danh Mục Đầu Tư" của Vận Hành (Đợt E
— cùng lý do, chỉ thao tác được trên hồ sơ đã tạo).

**Deploy-impact**: THUẦN client-side (`public/index.html` +
`module-vanhanh.js`/`module-hcrcdonghanh.js`/`core.js`), không đổi
`schema.sql`, không thêm biến môi trường, không đổi `dependencies` — chỉ
cần copy code + `pm2 restart` (hoặc refresh trình duyệt nếu server không
đổi). **Lưu ý riêng đợt này**: thay đổi ở `core.js` (thêm
`bindCspDelegation('hrLifecycleSection')`) khắc phục 1 bug khiến TOÀN BỘ
module Onboarding/Offboarding không hoạt động — nên ưu tiên deploy sớm, độc
lập với phần "Làm Mới" nếu cần tách riêng.

## Đợt D (UX rollout): nút "↺ Làm Mới" cho Thanh Toán/Hỗ Trợ IT (3 form)/VPP/Ngân Sách (2026-09-08)

Tiếp nối Đợt A/B/C (xem 3 mục ngay dưới) — áp ĐÚNG mẫu tham chiếu đã dựng
(`confirmAndResetForm()`/chip file ở `core.js`, KHÔNG sửa gì thêm ở đó) cho
5 module còn lại của kế hoạch UX 5 đợt, hoàn tất toàn bộ kế hoạch.

**Thanh Toán (`module-thanhtoan.js`)**: `#paymentCreateForm` —
`resetPaymentCreateForm()` (mới) CHỈ gọi lại `cancelEditPaymentRequest()` có
sẵn từ trước (không viết logic mới) — form KHÔNG có ô tải tệp, kèm trắng
bảng động "Các Đợt Thanh Toán". Sub-tab "🗂️ Quản Lý Thanh Toán" (lập/sửa
NHÁP đã tạo từ module khác — Hợp Đồng "🧾 Lập Thanh Toán" — hoặc tự lập trực
tiếp, theo dõi hạn từng đợt tới khi PAID) CHỦ Ý nằm NGOÀI phạm vi đợt này:
đây là UI sửa 1 bản ghi ĐÃ TỒN TẠI (gần giống modal sửa), không phải "tạo
mới 1 lần" như các form còn lại trong 5 đợt UX này.

**Hỗ Trợ IT — 3 form Tạo Mới:**
- Phê Duyệt Giá (`#itPriceCreateForm`, `module-itsupport-price.js`) —
  `resetItPriceForm()` (mới) + chip file đơn `itPriceFileInput` (bảng giá) +
  chip file nhiều `itPriceExtraFiles` (tài liệu bổ sung). `itPriceFileInput`
  ĐÃ có `data-op-change="onItPriceFileChange"` nghiệp vụ riêng (đọc/xem
  trước bảng giá) TỪ TRƯỚC — 1 input chỉ nhận 1 `data-op-change` (không phải
  mảng), nên KHÔNG gắn thêm `data-op-change="onSingleFileChosen"` song song
  ở HTML được như các input file khác trong 5 đợt — gọi trực tiếp
  `onSingleFileChosen()` NGAY trong `onItPriceFileChange()` thay vào đó
  (cũng tiện sửa luôn 1 lỗ hổng nhỏ có sẵn: nhánh đọc file lỗi trước đây chỉ
  xoá `input.value` chứ không xoá chip, để lại chip "ma" trỏ tới file không
  còn tồn tại — nay dùng `clearSingleFileInput()` cho cả 2 chỗ). Mức Margin/
  Chiết Khấu (`itPriceTier`, chỉ hiện ở sub-tab con Bán Buôn) CHỈ bị **xoá
  giá trị đã chọn** khi "Làm Mới" — KHÔNG tự chuyển sub-tab con Bán Lẻ/Bán
  Buôn (`activeItPriceSubTab`) về mặc định, vì đó là trạng thái hiển thị
  CHUNG của cả danh sách đề xuất bên dưới (đổi ngầm khi bấm nút của riêng
  form sẽ gây bất ngờ khó hiểu hơn là có ích).
- Hỗ Trợ Yêu Cầu (`#itTicketCreateForm`) — `resetItTicketForm()` (mới), đơn
  giản nhất trong 3 form (không ô tải tệp).
- Gia Hạn Dịch Vụ CNTT (`#itRenewalCreateForm`, `module-itsupport-renewal.js`)
  — `resetItRenewalForm()` (mới) + chip file đơn `itRenewalFile`. Ô tìm-
  kiếm-gõ-chọn tự học `itRenewalCategory` (sdd\*) KHÔNG có input ẩn riêng lưu
  giá trị đã chọn như các sdd khác trong hệ thống — chính `input.value` LÀ
  giá trị thật nên `form.reset()` gốc đã đủ xoá sạch, chỉ cần đóng tường
  minh dropdown gợi ý nếu lỡ đang mở.

**VPP (`module-vpp.js`) — 2 "form" Tạo Mới, KHÔNG cái nào là `<form>` thật**
(bảng chọn mặt hàng/bảng nhân sự theo phòng ban đều dựng tay bằng `<div>`,
không `.reset()` được — `resetXxxForm()` phải tự set tay từng ô + gọi lại
`render*()` để tính lại giá trị mặc định THẬT thay vì hardcode rỗng):
- Đăng Ký (`#vppRegItemsWrap`) — `resetVppRegForm()` (mới). MỖI ô Số Lượng
  đã có `value="..."` (thuộc tính HTML thật) đúng bằng số lượng đã LƯU NHÁP
  (nếu đang sửa tiếp nháp cũ) hoặc rỗng (nếu chọn mới hoàn toàn) tại thời
  điểm dựng bảng — gán lại `input.value = input.defaultValue` cho MỌI ô là
  đủ "quay về mặc định thật" (mirror ý nghĩa `form.reset()` gốc), không xoá
  mất bản nháp đã lưu trên server.
- Kỳ Đăng Ký > Tạo Kỳ Đăng Ký Mới (`#vppNewPeriodFormWrap`) —
  `resetVppNewPeriodForm()` (mới) + chip file đơn `vppCatalogFileInput`
  (cùng cách xử lý `data-op-change` sẵn có như `itPriceFileInput` ở trên) +
  tính LẠI bảng "Nhân Sự Theo Phòng Ban" theo số nhân sự THẬT đang hoạt động
  (`renderVppDeptHeadcountTable()`), không giữ số đã sửa tay dở dang.

**Ngân Sách (`module-ngansach.js`)** — 2 tab con "✅ Ngân Sách Phê Duyệt Đơn
Vị"(PLAN)/"💳 Ngân Sách Thực Hiện"(ACTUAL) dùng CHUNG code (hậu tố
`_PLAN`/`_ACTUAL`), bảng hạng mục dựng theo mẫu cột của kỳ ("UI mẫu ngân
sách CRUD cột") KHÔNG phải `<form>` thật —
`resetBudgetEntryFormPLAN()`/`resetBudgetEntryFormACTUAL()` (mới) CHỈ gọi
lại `onBudgetEntryPeriodChange(kind)` có sẵn: nạp lại ĐÚNG bản NHÁP đã lưu
trên server của phòng ban cho kỳ đang chọn (nếu có — hoàn tác MỌI sửa dở
CHƯA lưu, giữ nguyên phần đã lưu) hoặc collapse về ĐÚNG 1 dòng trống theo
mẫu (nếu CHƯA có nháp nào).

**Bộ test**: mở rộng `server/tests/test-form-reset-file-remove.js` thêm 8
kịch bản (Thanh Toán + Phê Duyệt Giá + Hỗ Trợ Yêu Cầu + Gia Hạn Dịch Vụ CNTT
+ VPP Đăng Ký + VPP Tạo Kỳ + Ngân Sách PLAN + Ngân Sách ACTUAL) — tổng
29/29 kịch bản pass, bao gồm kiểm chứng chip file nhiều (`itPriceExtraFiles`,
chọn 2 xoá 1 còn đúng 1), tier-select `itPriceTier` bị xoá đúng, collapse
bảng động VPP/Ngân Sách, và 1 kịch bản Ngân Sách ACTUAL kiểm chứng riêng
hành vi "hoàn tác sửa dở CHƯA lưu, giữ nguyên phần ĐÃ lưu nháp trên server"
(khác PLAN — collapse về rỗng vì chưa có nháp nào). 2 route đọc/xem-trước-
file-ngay-khi-chọn (`/api/it-price/parse-file`/`/api/vpp/parse-catalog`)
không có trong hạ tầng mock backend dùng chung (`tests/_harness-contract.js`
chỉ mô phỏng `/api/upload` + `/api/create|workflow|records`) nên bài test tự
bọc thêm 2 route giả NGAY TRONG file test (không đụng hạ tầng dùng chung cho
mọi bài test khác) — nội dung tệp không ảnh hưởng luật nghiệp vụ nào ở đây
(đã có `test-it-support.js`/`test-vpp.js` với harness Express thật riêng
kiểm chứng logic đọc file thật). Toàn bộ suite hồi quy hiện có (79 file
`test-*.js`) chạy lại — không phát sinh lỗi mới ngoài 3 lỗi kết nối SQL
Server thật đã biết từ trước ở đúng 2 file `test-audit-fixes-batch1.js`
(2 lỗi)/`test-audit-round2-cluster1.js` (1 lỗi), xác nhận lại giống hệt
baseline qua `git stash` (môi trường sandbox không có SQL Server thật).

**Deploy-impact**: THUẦN client-side (`public/index.html` +
`module-thanhtoan.js`/`module-itsupport-price.js`/`module-itsupport-renewal.js`/
`module-vpp.js`/`module-ngansach.js`), không đổi `schema.sql`, không thêm
biến môi trường, không đổi `dependencies` — chỉ cần copy code + `pm2 restart`
(hoặc refresh trình duyệt nếu server không đổi).

## Đợt C (UX rollout): nút "↺ Làm Mới" cho Đào Tạo (7 form) + Tuyển Dụng/HCRC Đồng Hành/Nội Bộ (2026-09-08)

Tiếp nối Đợt A/B (xem 2 mục ngay dưới) — áp ĐÚNG mẫu tham chiếu đã dựng
(`confirmAndResetForm()`/chip file ở `core.js`, KHÔNG sửa gì thêm ở đó, trừ 1
điểm chi tiết nêu ở cuối mục này) cho toàn bộ form tạo mới còn lại của Đào
Tạo + 3 module còn lại của Truyền Thông Nội Bộ.

**Đào Tạo (`module-internalcomms-daotao.js`) — 7 form, nhiều hơn ước tính
ban đầu ~5** (đọc lại code thật xác nhận `careerPathForm`/`onboardingPathForm`
cũng là form Tạo Mới riêng, module này đã phình to sau đợt "4 loại câu hỏi +
chấm tay Nghị Luận"):
- Lớp Học (`#trainingClassForm`) — `resetTrainingClassForm()` (mới). Ngoài
  `form.reset()`, trắng Danh Sách Được Mời (`tcInviteListStaged`) + phần Nhập
  Từ Excel đang xem trước dở (`tcInviteFilePreviewItems`/ô trạng thái/nút) +
  gọi lại `onTrainingClassModeChange()` để đưa Kiểu Lớp Học về Online (ẩn lại
  Giảng Viên/Địa Điểm).
- Chương Trình (`#trainingCourseForm`) — `resetTrainingCourseForm()` (mới),
  đơn giản nhất đợt này.
- Kế Hoạch Đào Tạo (`#trainingPlanForm`) — `resetTrainingPlanForm()` (mới),
  gọi lại thẳng `cancelEditTrainingPlan()` có sẵn (cùng khuôn
  `resetMeetingMinutesForm()` Đợt B).
- Kho Tài Liệu (`#trainingDocForm`) — `resetTrainingDocForm()` (mới) + chip
  file `tdFile` (bắt buộc). Gọi lại `onTrainingDocTypeChange()` để đưa Loại
  Tài Liệu (Video/Hình Ảnh) về lại "Tài Liệu" mặc định đúng ẩn/hiện+required.
- Lộ Trình Thăng Tiến (`#careerPathForm`) — `resetCareerPathForm()` **ĐÃ CÓ
  SẴN TỪ TRƯỚC** lúc bắt đầu Đợt C (được viết đúng khuôn ngay từ đầu, chỉ
  thiếu nút gọi tới) — collapse "Các Cấp Bậc" về ĐÚNG 1 hàng trống.
- Đào Tạo Tân Binh > Quản Lý Lộ Trình (`#onboardingPathForm`) —
  `resetOnboardingPathForm()` (mới), gọi lại thẳng
  `cancelEditOnboardingPath()` có sẵn.
- Ngân Hàng Câu Hỏi (`#trainingTestForm`) — `resetTrainingTestForm()` (mới).
  Trắng HẲN danh sách câu hỏi đang xây dở (`tbQuestions`) về **ĐÚNG 0 câu**
  — đây LÀ trạng thái mặc định thật của form (giống hệt lúc mới vào tab),
  KHÔNG PHẢI 1 câu SINGLE 2-đáp-án-rỗng như phỏng đoán ban đầu: luồng tạo bài
  test thành công TỪ TRƯỚC đã luôn `tbQuestions = []` chứ không thêm lại 1
  câu mặc định — chỉ refactor logic có sẵn đó vào hàm dùng chung. Ảnh minh
  hoạ câu hỏi/đáp án (loại IMAGE_DRAG_DROP) tải lên NGAY khi chọn file
  (`tbQuestionImageFileChange()`/`tbOptionImageFileChange()`, lưu thẳng URL
  vào state) — **KHÔNG áp khuôn chip file cấp-form được** (đây là upload
  ngay-khi-chọn theo từng dòng động, khác hẳn 1 input file cấp-form cố định)
  nên cố ý để nguyên, không ép vào khuôn `onSingleFileChosen`/`onMultiFileChosen`.

**Tuyển Dụng (`module-internalcomms-nhipsong.js`) — 2 form:**
- Tin Tuyển Dụng (`#recruitmentJobForm`) — `resetRecruitmentJobForm()` (mới)
  + chip ảnh `rjBannerFile` (tuỳ chọn).
- Giới Thiệu Ứng Viên (`#recruitmentReferForm`, modal) —
  `resetRecruitmentReferForm()` (mới) + chip `rrCvFile` (bắt buộc). Form này
  có `#rrJobId` là hidden input NẰM TRONG chính form (khác mọi
  `editingXxxId` khác trong hệ thống, luôn là biến JS NGOÀI form) — đã đánh
  dấu `readonly` ở HTML để `confirmAndResetForm()` không tính nhầm là "đã
  nhập" ngay khi vừa mở modal, và `resetRecruitmentReferForm()` tự đọc/khôi
  phục lại giá trị này sau `form.reset()` để "↺ Làm Mới" giữa lúc điền dở
  không làm mất ngữ cảnh "đang giới thiệu ứng viên cho tin nào".

**HCRC Đồng Hành (`module-hcrcdonghanh.js`)**: `#hrFeedbackForm` —
`resetHrFeedbackForm()` (mới), form đơn giản, không có ô tải tệp.

**Nội Bộ/Nhịp Sống HCRC (`module-internalcomms-nhipsong.js`)**:
`#internalPostForm` — `resetInternalPostForm()` (mới), gọi lại thẳng
`cancelEditInternalPost()` có sẵn (cùng khuôn `resetMeetingMinutesForm()`) +
chip file `internalFile` (tuỳ chọn).

**Phát hiện phụ (không thuộc phạm vi sửa của đợt này)**: viết bài test lộ ra
1 bug CÓ SẴN TỪ TRƯỚC, không liên quan gì tới Đợt C — `#careerPathForm` nằm
LỒNG trong CẢ `#internalTrainingLmsSection` LẪN `#internalSection`, cả 2 đều
tự `bindCspDelegation()` riêng (core.js) nên 1 click chuột trong khu vực này
bị CẢ 2 tầng bắt (event bubble qua đúng 2 root), khiến 1 số thao tác click
(nút `+ Thêm Cấp Bậc`...) bị gọi hàm xử lý 2 LẦN thay vì 1. Nút "↺ Làm Mới"
mới thêm ở đợt này AN TOÀN trước bug này (mọi `resetXxxForm()` đều idempotent
— gọi 2 lần vẫn ra đúng 1 kết quả) nên không cần sửa gì để đợt này hoạt động
đúng, nhưng đây là 1 bug thật đáng sửa riêng (phạm vi rộng hơn nhiều — mọi
`data-op` click bên trong `internalTrainingLmsSection` đều bị ảnh hưởng) —
để lại cho 1 đợt riêng, không gộp vào đây.

**Bộ test**: mở rộng `server/tests/test-form-reset-file-remove.js` thêm 12
kịch bản (Đào Tạo 7 + Tuyển Dụng 2 + 1 kịch bản "không hỏi xác nhận khi vừa
mở modal" + HCRC Đồng Hành + Nội Bộ) — tổng 21/21 kịch bản pass. Toàn bộ
suite hồi quy hiện có (79 file `test-*.js`) chạy lại — không phát sinh lỗi
mới ngoài các lỗi kết nối SQL Server thật đã biết từ trước (môi trường
sandbox không có SQL Server thật).

**Deploy-impact**: THUẦN client-side (`public/index.html` +
`module-internalcomms-daotao.js`/`module-internalcomms-nhipsong.js`/
`module-hcrcdonghanh.js`), không đổi `schema.sql`, không thêm biến môi
trường, không đổi `dependencies` — chỉ cần copy code + `pm2 restart` (hoặc
refresh trình duyệt nếu server không đổi).

## Đợt B (UX rollout): nút "↺ Làm Mới" cho 4 form tạo mới tiếp theo (2026-09-08)

Tiếp nối Đợt A (v12.8, xem mục ngay dưới) — áp ĐÚNG mẫu tham chiếu đã dựng
(hạ tầng `confirmAndResetForm()`/chip file ở `core.js`, KHÔNG sửa gì thêm ở
đó) cho 4 form tạo mới tiếp theo. Khác Đợt A, cả 4 form đợt này đều KHÔNG có
ô tải tệp nào trên form Tạo Mới (chỉ ở màn xử lý duyệt/module khác không
thuộc phạm vi đợt này) nên không có chip file nào cần wiring — chỉ có nút
"↺ Làm Mới" + `resetXxxForm()` riêng từng module.

- Đăng Ký Xe (`#carForm`) — `resetCarRegForm()` (mới, `module-dangkyxe.js`,
  factor từ luồng gửi phiếu thành công). Ngoài `form.reset()` + sinh lại mã,
  còn phải trắng tường minh "Lộ Trình Di Chuyển" (mảng JS `carRoutePoints`,
  không phải input thường) về lại đúng 2 điểm rỗng qua `resetCarRoutePoints()`
  có sẵn.
- Phòng Họp (`#meetingForm`) — `resetMeetingReqForm()` (mới,
  `module-phonghop.js`), form đơn giản nhất đợt này: chỉ `form.reset()` +
  sinh lại mã, không có state JS riêng nào khác cần dọn.
- Biên Bản Họp (`#minutesForm`) — `resetMeetingMinutesForm()` (mới,
  `module-bienbanhop.js`) — GỌI LẠI THẲNG `cancelEditMeetingMinutes()` có sẵn
  (khác Hợp Đồng ở Đợt A: hàm cancel-edit ở đây đã làm ĐÚNG NGUYÊN VẸN mọi
  bước 1 lần "Làm Mới" cần — thoát Sửa dở nếu có, trắng bảng "Thành Phần Tham
  Dự"/"Ý Kiến Chỉ Đạo" về 0 dòng, trắng trường bổ sung, đưa nút Lưu/nút Huỷ
  Sửa về lại trạng thái gốc — không có bước nào khác biệt cần viết riêng).
- Mua Bán/Sửa Chữa/Đầu Tư (`#officeForm`) — `resetOfficeReqForm()` (mới,
  `module-office.js`), factor từ luồng gửi đề xuất thành công. Khi đang ở
  phân hệ Mua Sắm (`activeOfficeSubTab === 'MUA_BAN'`), collapse bảng "Danh
  Sách Hạng Mục Đề Nghị Mua Sắm" (mảng JS `officeItems`) về ĐÚNG 1 dòng trống
  (`officeItems = []; addOfficeItemRow();`, đúng idiom cũ) — không phải 0
  dòng.

**Bộ test**: mở rộng `server/tests/test-form-reset-file-remove.js` (hạ tầng
`_harness-contract.js`/`_seed.js` có sẵn) thêm 4 kịch bản cho 4 form trên —
tổng 9/9 kịch bản pass. Toàn bộ suite hồi quy hiện có (79 file `test-*.js`)
chạy lại — không phát sinh lỗi mới ngoài các lỗi kết nối SQL Server thật đã
biết từ trước (môi trường sandbox không có SQL Server thật).

**Deploy-impact**: THUẦN client-side (`public/index.html` + 4
`public/js/module-*.js`), không đổi `schema.sql`, không thêm biến môi
trường, không đổi `dependencies` — chỉ cần copy code + `pm2 restart` (hoặc
refresh trình duyệt nếu server không đổi).

## Đợt A (UX rollout): nút "↺ Làm Mới" + chip "✕ Xoá file" trên 4 form tạo mới — mẫu tham chiếu (2026-09-08)

Phàn nàn người dùng: đang nhập dở 1 form Tạo Mới, CHƯA gửi, muốn bỏ hết để
nhập lại thông tin khác — không có nút "Hủy/Làm Mới" nào để trắng form, và
tệp đã chọn ở ô upload không xoá được (chỉ chọn được tệp KHÁC đè lên, không
về lại "chưa chọn file"). Audit xác nhận: 0/31 form Tạo Mới trên toàn hệ
thống (~16 module) có 1 trong 2 tính năng này.

**2 hạ tầng dùng chung mới, `server/public/js/core.js`** (đặt ngay trước
`bindCspDelegation('userHeader')`, cạnh hạ tầng CSP `data-op`):
- `confirmAndResetForm(formId, resetFnName)` — gắn qua
  `data-op="confirmAndResetForm" data-arg0="<id form>"
  data-arg1="<tên hàm resetXxxForm của module>"` trên nút "↺ Làm Mới". Chỉ
  hỏi `confirm()` NẾU form đang có ít nhất 1 `<input>`/`<textarea>` khác giá
  trị mặc định (bỏ qua `<select>` — `HTMLSelectElement` không có
  `.defaultValue` thật, so sánh sẽ luôn sai lệch false-positive; bỏ qua ô
  readonly/disabled — mã tự sinh, trường khoá theo chế độ). Xác nhận xong ->
  gọi `window[resetFnName]()` (mỗi module tự viết `resetXxxForm()`, KHÔNG có
  logic dùng chung nào khác vì mỗi form có state JS riêng: dòng động, panel
  phê duyệt bổ sung, mã tự sinh, toggle Nhập Mới/Cập Nhật...).
- Chip "📎 tên file [✕]": `onSingleFileChosen(inputEl, chipContainerId)` +
  `clearSingleFileInput(inputId, chipContainerId)` cho input file đơn (gắn
  qua `data-op-change="onSingleFileChosen" data-arg-el="0"
  data-arg1="<id chip>"` ngay trên input); `onMultiFileChosen`/
  `removeOneFileFromMultiInput`/`clearMultiFileInput` cho input `multiple`
  (dùng `DataTransfer` để dựng lại `FileList` thiếu đúng 1 file bị xoá — API
  gốc không cho xoá trực tiếp 1 phần tử khỏi `FileList`).

**Áp dụng cho 4 form (Đợt A — mẫu tham chiếu cho Đợt B/C/D/E, ~27 form còn
lại trên ~12 module)**:
- Văn Bản Trình (`#submissionForm`) — `resetSubmissionForm()` (mới,
  `module-vanbantrinh.js`, factor ra từ 3 dòng reset cũ viết thẳng ở cuối
  `doSubmitSubmissionReq()` — giờ CẢ nút Làm Mới lẫn luồng trình thành công
  đều gọi 1 hàm duy nhất). Chip cho `subFile` (đơn) + `subExtraFiles`
  (multiple).
- Hợp Đồng (`#contractForm`) — `resetContractForm()` (mới,
  `module-hopdong.js`) — CỐ Ý viết RIÊNG, không refactor `cancelEditContract()`
  (hàm đó dành cho thoát chế độ Sửa, gọi từ nhiều nơi khác, đã có test hồi
  quy — đổi hành vi ở đó không cần thiết cho việc này) dù có phần trùng lặp;
  tự lo cả trường hợp bấm "Làm Mới" khi đang Sửa dở (thoát Sửa ngay). Trắng
  luôn "Các Đợt Thanh Toán" về 0 dòng. Chip cho `contractFile`.
- Tài Liệu (`#docForm`) — `resetDocUploadForm()` (mới, `module-tailieu.js`),
  factor từ luồng tải lên thành công. Đưa toggle Nhập Mới/Cập Nhật về lại
  "Nhập Mới". Chip cho `docFile`.
- Giấy Phép (`#licenseForm`) — `resetLicenseForm()` (mới, cùng file), cùng
  khuôn Tài Liệu. Chip cho `licenseFile`.

**Bug thật phát hiện qua bộ test mới trong lúc viết**: `renderMultiFileChips()`
tham chiếu nhầm biến `chipContainerId` (không tồn tại trong scope hàm đó,
tham số thực là `chipEl` — 1 phần tử DOM) khi dựng nút ✕ cho từng chip —
khiến MỌI thao tác chọn ≥2 file vào ô `multiple` ném `ReferenceError` ngay
trong `change` handler, chip không hiện. Sửa thành `chipEl.id`.

**Bộ test mới**: `server/tests/test-form-reset-file-remove.js` (dùng lại hạ
tầng `tests/_harness-contract.js`/`_seed.js`) — 5 kịch bản: chip file đơn +
multi hiện/xoá đúng cho cả 4 form, "Làm Mới" trắng đúng mọi state JS riêng
từng form (mã tự sinh, panel phê duyệt bổ sung Văn Bản Trình, Đợt Thanh Toán
Hợp Đồng, toggle Nhập Mới/Cập Nhật Tài Liệu/Giấy Phép), và xác nhận
`confirm()` chỉ được hỏi khi form thật sự có dữ liệu đã nhập (không hỏi vô ích
lúc form đang trống). Toàn bộ suite hồi quy hiện có (79 file `test-*.js`)
chạy lại — không phát sinh lỗi mới ngoài các lỗi kết nối SQL Server đã biết
từ trước (môi trường sandbox không có SQL Server thật).

**Deploy-impact**: THUẦN client-side (`public/index.html` + 3
`public/js/*.js`), không đổi `schema.sql`, không thêm biến môi trường, không
đổi `dependencies` — chỉ cần copy code + `pm2 restart` (hoặc refresh trình
duyệt nếu server không đổi).

## Nhân Sự > Offboarding: thêm trường bắt buộc "Ngày Nghỉ Việc" (2026-09-07)

Người dùng kiểm tra lại module Offboarding (mới build đợt trước) và phát hiện
thiếu trường "Ngày nghỉ việc" — hồ sơ khoá tài khoản chưa có thông tin thời
điểm nhân viên thực sự nghỉ (chỉ có ngày gửi yêu cầu, có thể gửi sớm trước
ngày nghỉ thật).

**Thay đổi**: thêm field mới `hrOffboardingRequests.lastWorkingDate` (bắt
buộc, validate cả server lẫn client — `lib/createValidation.js` throw 400 nếu
thiếu/không hợp lệ). Form Offboarding (`public/index.html`) thêm ô
`#hrOffbLastWorkingDate` (date input, required) ngay sau khối thông tin nhân
viên; nút "Gửi Yêu Cầu Khóa Tài Khoản" giờ chỉ sáng khi ĐỦ CẢ 3 điều kiện: đã
chọn nhân viên + đã nhập Ngày Nghỉ Việc + tích đủ 2 checklist (trước đây chỉ
2 điều kiện). Danh sách yêu cầu đã gửi hiển thị thêm "Ngày nghỉ việc: ..." bên
cạnh tên người gửi.

**Không đổi schema SQL** (JSON payload field, thuộc `dbo.Records`).

Đã gửi demo 2 màn hình Onboarding/Offboarding cho người dùng xem trực quan
(ảnh chụp qua Playwright, không phải sản phẩm cuối — dùng cùng cơ chế
`testHarness.js` sẵn có).

## Hỗ Trợ IT > Hỗ Trợ Yêu Cầu: làm rõ phê duyệt là TÙY CHỌN, IT tự quyết định (2026-09-07)

**Không có thay đổi code** (bổ sung ngay sau đợt sửa tài liệu ở trên). Người
dùng nhấn mạnh lại mấu chốt: phê duyệt quản lý chỉ áp dụng khi IT **chủ động
thấy cần** cho 1 ticket cụ thể — không phải điều kiện bắt buộc cho mọi ticket.
Đã xác nhận đây đúng là hành vi hiện tại (`escalateItTicket()` luôn do IT tự
tay gọi, không có ticket nào tự động rơi vào trạng thái chờ duyệt) — chỉ làm
rõ lại câu chữ trong `Huong-dan-nghiep-vu.md` §3.6 cho khỏi gây hiểu nhầm là
bắt buộc.

## Hỗ Trợ IT > Hỗ Trợ Yêu Cầu: sửa tài liệu nghiệp vụ nói sai "không qua duyệt" (2026-09-07)

**Không có thay đổi code.** Người dùng hỏi lại về việc "gửi phê duyệt quản lý
trước khi IT tiếp tục xử lý" ticket Hỗ Trợ Yêu Cầu — kiểm tra thực tế xác nhận
tính năng escalate/approve/deny **đã tồn tại và đã enforce đúng từ lâu**
(commit `0122c41`, có test `test-it-support.js` xác nhận server chặn cứng
`updateItTicketStatus()` bằng lỗi 409 khi `approvalStatus` là `PENDING`/
`REJECTED`, độc lập với giao diện). Nguyên nhân gây hiểu lầm: `deploy/
Huong-dan-nghiep-vu.md` mục 3.6 ghi sai là "không qua duyệt" — đã sửa lại
đúng mô tả luồng gửi/duyệt/chặn xử lý thật đang chạy trong code.

## Hợp Đồng > "Loại Thanh Toán" (1 lần/định kỳ) + Tổng Hợp > Thanh Toán: sub-tab mới "🗂️ Quản Lý Thanh Toán" + duyệt theo phòng ban (2026-09-07)

**Yêu cầu người dùng (nguyên văn, rút gọn)**: thêm trường "Loại thanh toán"
("Thanh toán 1 lần"/"Thanh toán định kỳ") ở Hợp Đồng; khi hợp đồng đủ điều
kiện, nút chuyển thanh toán đổi thành "Lập Thanh Toán" — lập được LIÊN TỤC với
hợp đồng định kỳ (mỗi lần hoàn tất lại mở ra chu kỳ mới, VD năm sau), còn "1
lần" thì sau khi hoàn thành sẽ khoá hẳn; bấm "Lập Thanh Toán" nhảy sang sub-tab
mới "Quản Lý Thanh Toán" (trong tab Thanh Toán của module Tổng Hợp) để tạo các
đợt thanh toán, **số tiền không bắt buộc nhập khi mới lưu, chỉ bắt buộc khi
"Chuyển Xác Nhận Thanh Toán"** (điểm người dùng chốt lại, sửa đề xuất ban đầu),
đợt thanh toán có cảnh báo hạn; bước "Chuyển Xác Nhận Thanh Toán" cần phê duyệt
theo phòng ban (trước đây chỉ 1 quyền phẳng "Quản lý Thanh Toán").

**Thay đổi dữ liệu** (đều là payload JSON/AppData — không đổi schema SQL):
- `contracts.paymentType`: `'ONE_TIME'` (mặc định, tương thích ngược hồ sơ cũ)
  hoặc `'PERIODIC'`.
- `paymentRequests.status` có thêm giá trị **`DRAFT`** (trước `PENDING`) — CHỈ
  phát sinh từ nút "🧾 Lập Thanh Toán" ở Hợp Đồng (đường tạo thủ công/CÓ NGUỒN
  từ module Thanh Toán vẫn đi thẳng `PENDING` như cũ, không đổi). `paymentRequests`
  có thêm `currentStep`/`history` (khởi tạo lúc gửi duyệt, hoặc lúc tạo với 2
  đường không qua NHÁP) để đi qua quy trình duyệt theo bước MỚI.
- AppData thêm `paymentDeptWorkflows` (cấu hình người duyệt theo phòng ban cho
  bước "Chuyển Xác Nhận Thanh Toán", admin cấu hình ở "Quy Trình & Phê Duyệt" >
  "💰 QT Thanh Toán" — trống mặc định, chỉ Admin duyệt được cho tới khi cấu
  hình, giống mọi module chưa cấu hình khác).

**Server**: `lib/recordActions.js` — `startContractPayment()` đổi gate
(`CHUA_THANH_TOAN` HOẶC `PERIODIC` + `DA_THANH_TOAN`; vẫn chặn khi đang
`CHO_THANH_TOAN`, không cho song song 2 chu kỳ) và tạo `DRAFT` thay vì `PENDING`
khi gọi KHÔNG kèm overrides (route "🧾 Lập Thanh Toán"); route `from-source`
(kế toán tự tạo có nguồn) và `startOfficePayment()` (Mua Bán/Sửa Chữa) truyền
`overrides.createAsPending:true` — **giữ nguyên PENDING ngay như cũ, không qua
DRAFT** (module Mua Bán/Sửa Chữa hoàn toàn không đổi hành vi). `editPaymentRequest()`
nới lỏng bắt buộc số tiền > 0 khi còn `DRAFT`; hàm mới `submitPaymentRequest()`
(DRAFT → PENDING) là nơi DUY NHẤT bắt buộc mọi đợt có số tiền > 0, khởi tạo
`currentStep:1/history:[]`. `confirmPaymentInstallment()`/route
`confirm-installment` ghi ngược `paymentStatus` theo ĐÚNG `paymentType` (PERIODIC
→ `CHUA_THANH_TOAN` mở chu kỳ mới; ONE_TIME/officeReqs → `DA_THANH_TOAN` như
cũ). `lib/workflowEngine.js` thêm `MODULE_CONFIGS.paymentRequests` (`disallowReject`
— chỉ Duyệt, không Từ Chối qua engine) thay cho quyền phẳng
`canManagePaymentRequests()` cũ khi Duyệt; hàm cũ `approvePaymentRequest()` +
route bespoke `POST /api/records/paymentRequests/:id/approve` đã **gỡ hẳn**,
thay bằng route generic `POST /api/workflow/paymentRequests/:id/approve`.
`computePaymentInstallmentDeadlineStatus()` (mới, thuần, không lưu field) tính
cảnh báo hạn từng đợt. Migration 1 lần lúc khởi động
(`migratePaymentRequestsMissingCurrentStep()`) gán `currentStep:1` cho đề nghị
CŨ chưa có field này (nếu không sẽ kẹt duyệt vì thiếu bước).

**Client**: nút Hợp Đồng đổi tên "🧾 Lập Thanh Toán", điều hướng thẳng sang
sub-tab "Quản Lý Thanh Toán" sau khi tạo. Tab Thanh Toán từ 2 lên **3 sub-tab**
("➕ Tạo Mới" / **"🗂️ Quản Lý Thanh Toán"** MỚI / "✅ Xác Nhận Đề Nghị Thanh
Toán" — giờ thuần là hàng chờ duyệt + xác nhận PAID). `canAccessPaymentModule()`
mở rộng thêm cho người ĐANG là approver ở `paymentDeptWorkflows` hoặc đã tự tạo
đề nghị của chính mình (custodian hợp đồng không nhất thiết có quyền phẳng
"Quản lý Thanh Toán").

**Kiểm thử**: mở rộng `tests/test-payment.js` (46 kịch bản) phủ đủ DRAFT/submit-
blocked-then-success/dept-approval/ONE_TIME khoá cứng/PERIODIC lặp lại 2 chu
kỳ; `tests/test-contract.js`/`tests/test-office-budget.js` xác nhận KHÔNG hồi
quy (module Mua Bán/Sửa Chữa hoàn toàn không đổi); cập nhật 2 test cũ bị ảnh
hưởng bởi việc gỡ route bespoke (`test-audit-round2-cluster6.js`) và số khoá
`MODULE_CONFIGS` tăng 12→13 (`test-workflow-position-approvers.js`). Full suite
78 file — 0 hồi quy mới (2 lỗi kết nối SQL Server pre-existing không đổi).

**Deploy-impact**: không đổi `schema.sql`/`.env.example`/`package.json`
dependencies — chỉ payload JSON/AppData mới, copy code + `pm2 restart` là đủ.

## Nhân Sự > Onboarding / Offboarding — tự động tạo ticket Hỗ Trợ IT (2026-09-07)

**Yêu cầu người dùng (nguyên văn)**: "Trong nhân sự thêm hai tab onboarding và
offboarding. Với tab onboarding cho phép nhân sự tạo yêu cầu onboarding cập
nhân thông tin nhân su với các thông khai báo như mã nhân viên, họ và tên,
email (để trống nếu do IT cấp account, đối với nhân viên siêu thì phải nhập
email), số điện thoại, phòng ban (lấy từ hệ thống), chức danh (lấy từ hệ
thống), ngày vào làm việc sau khi nhập xong thông tin ấn gửi yêu cầu cấp tài
khoản thì sẽ tự động tạo request trên hỗ trợ yêu cầu trong module hỗ trợ IT để
IT xử lý yêu cầu, IT sau khi thực hiện sẽ xác nhận hoàn thành và cập nhật các
thông tin trả lại. Tương tự module offboarding khi có nhân sự nghỉ việc sẽ tạo
yêu cầu offboarding với form nhập thông tin mã nhân viên để tự động lấy thông
tin của nhân viên từ hệ thống, sau khi đã tích chọn các yêu cầu như hoàn tất
các thủ tục bàn giao, thủ tục chế độ sẽ ấn gửi yêu cầu khóa tài khoản thì sẽ tự
động tạo request trên hỗ trợ yêu cầu bên trong module hỗ trợ IT để IT xử lý
khóa tài khoản và xác nhận trả lại thông tin cho người yêu cầu".

**Quyết định phạm vi đã xác nhận với người dùng (điểm cốt lõi)**: khi IT đánh
dấu ticket "Hoàn thành", hệ thống **CHỈ ghi lại ghi chú kết quả IT báo cáo**
(resolutionNote) ngược về hồ sơ Onboarding/Offboarding đã gửi yêu cầu —
**KHÔNG BAO GIỜ tự tạo/khoá tài khoản `DB.users`**. IT vẫn tự tay cấp/khoá
email + AD hoàn toàn NGOÀI hệ thống này như trước giờ; tính năng này thuần tuý
là cầu nối "yêu cầu có cấu trúc + theo dõi tiến độ + thông báo kết quả" vào
hàng đợi ticket Hỗ Trợ IT sẵn có, không phải tự động hoá việc cấp/khoá tài
khoản thật.

**Module mới**: `hrLifecycle` (nhãn "Onboarding / Offboarding", `parent:'hr'`
ở `BUSINESS_MODULES`) — 1 nav entry, 2 sub-tab nội bộ (`setHrLifecycleSubTab`)
mirror đúng khuôn "1 module, nhiều sub-tab" của `vanHanh`/`itSupport`, dùng
chung cụm module `hcrcdonghanh` (đã nạp sẵn cho "Nhân Sự"/"Cơ Cấu Tổ Chức").

- **Onboarding** (`hrOnboardingRequests`) — khai báo nhân viên MỚI (chưa có
  tài khoản, không tra cứu được): mã nhân viên (gõ tự do), họ tên, Vị Trí
  HO/Siêu Thị → Phòng Ban/Siêu Thị + Chức Danh (cascading mirror ĐÚNG
  `#uPosType`/`onUserPosTypeChange()` ở form Người Dùng đầy đủ, tra theo
  `DB.depts`/`DB.stores`/`DB.jobTitles`/`DB.storeJobTitles`), Email (**để
  trống hợp lệ nếu đợi IT cấp mới, BẮT BUỘC với nhân viên Siêu Thị** — chặn cả
  server, không chỉ client), SĐT, Ngày vào làm.
- **Offboarding** (`hrOffboardingRequests`) — nhân viên ĐÃ có tài khoản: tra
  cứu qua ô tìm-kiếm-gõ-chọn dùng chung `#systemUsersDatalist` (widget `sdd*`,
  KHÔNG dùng `<datalist>` native — đúng quy ước `CLAUDE.md`), snapshot NGAY
  LÚC TẠO tên/phòng ban/chức danh/email (không đọc sống lại sau) + 2 hộp kiểm
  bắt buộc "Đã hoàn tất thủ tục bàn giao công việc/tài sản"/"Đã hoàn tất thủ
  tục chế độ (BHXH, lương, phép còn lại...)" — **chặn ở CẢ server**, không chỉ
  disable nút ở client.
- **Cầu nối ticket** — "Gửi Yêu Cầu Cấp Tài Khoản"/"Gửi Yêu Cầu Khóa Tài
  Khoản" gọi `POST /api/records/hrOnboardingRequests|hrOffboardingRequests/:id/
  submit-it-request` (mirror ĐÚNG khuôn `startContractPayment()`/
  `startOfficePayment()`: khoá hồ sơ nguồn, build bản nháp ticket, insert vào
  `itSupportTickets` với `category:'ACCOUNT'`, `sourceType:'HR_ONBOARDING'`
  hoặc `'HR_OFFBOARDING'`, `sourceId` trỏ về hồ sơ nguồn — 2 field `sourceType`/
  `sourceId` MỚI thêm vào `itSupportTickets`, lần đầu tiên ticket được tạo tự
  động từ module khác). `creator` của ticket = người gửi yêu cầu -> tự xem
  được tiến độ ngay ở Hỗ Trợ IT > Hỗ Trợ Yêu Cầu mà không cần chia sẻ quyền gì
  thêm (đúng phạm vi xem sẵn có `canViewItSupportTicket()`).
- **Ghi ngược khi IT hoàn thành** — route `POST /api/records/itSupportTickets/
  :id/update-status` (chuyển `DONE`) giờ kèm bước phụ: nếu ticket có
  `sourceType`/`sourceId`, khoá + cập nhật hồ sơ Onboarding/Offboarding liên
  kết (`status:'COMPLETED'`, `itResultNote`, `itCompletedBy`, `itCompletedAt`)
  — lỗi ở bước phụ này (hồ sơ liên kết đã bị xoá...) không làm hỏng việc IT
  vừa hoàn tất ticket, chỉ log lại.
- **Quyền tạo TÁCH RIÊNG** khỏi `nhanSuManage`: 2 cờ phẳng MỚI
  `hrOnboardingCreate`/`hrOffboardingCreate` (khối 21 cây phân quyền) — seed
  1 lần lúc khởi động (`seedDefaults.js migrateHrLifecyclePerms()`, đánh dấu
  idempotent qua key `hrLifecyclePermsSeeded`) cấp sẵn cho mọi user/permGroup
  ĐANG có `nhanSuManage` để không ai mất quyền so với trước; admin tự thu
  hẹp/mở rộng lại sau. `nhanSuManage`/admin luôn xem được TOÀN BỘ yêu cầu
  (theo dõi tiến độ chung); còn lại chỉ thấy đúng yêu cầu do CHÍNH MÌNH gửi
  (riêng tư, cùng khuôn `hrFeedback`/"HCRC Đồng Hành" — xem
  `canViewHrOnboardingRequest()`/`canViewHrOffboardingRequest()` ở
  `lib/recordViewScope.js`). IT xử lý ticket không cần quyền mới nào, tái
  dùng nguyên `itManage`/`canManageItSupport()`.
- **Đặt tên collection**: cố ý dùng tiền tố `hr` (`hrOnboardingRequests`/
  `hrOffboardingRequests`) — KHÔNG dùng bare `onboarding*`/`offboarding*` vì hệ
  thống đã có sẵn `onboardingPaths`/`onboardingProgress` ("Đào Tạo Tân Binh",
  tính năng hoàn toàn khác — xác nhận qua `tests/test-onboarding.js` chạy lại
  đầy đủ 27/27 kịch bản, không bị ảnh hưởng gì).
- **Deploy-impact**: KHÔNG cần chạy lại `sql/schema.sql` (2 collection mới
  dùng chung bảng `dbo.Records` sẵn có, chỉ thêm tên vào
  `MIGRATED_COLLECTIONS`) — chỉ cần copy code + `pm2 restart`. Không thêm biến
  môi trường/dependency nào mới.
- Test mới `tests/test-hr-lifecycle.js` (mirror thật `lib/createValidation.js`/
  `lib/recordActions.js`/`lib/recordViewScope.js` qua `tests/testHarness.js`,
  không tự đoán lại luật) — phủ đủ: gác quyền tạo (403), validate STORE bắt
  buộc email (400), tạo ticket liên kết đúng `category`/`sourceType`/
  `sourceId`, chặn gửi trùng ticket (409), view-scope riêng tư (chỉ creator +
  nhanSuManage), IT hoàn thành ghi ngược đúng field và **không đụng
  `DB.users`**, cùng gác quyền/validate tương tự phía Offboarding + UI wiring
  (sub-tab, danh sách hiện đúng hồ sơ).

## Đào Tạo > Ngân Hàng Câu Hỏi: thêm câu hỏi "Nghị Luận"/"Kéo Thả Hình" + luồng chấm tay nghị luận (2026-09-07)

**Yêu cầu người dùng (nguyên văn)**: "Trong sub tab ngân hàng câu hỏi của tab đào tạo cho phép tôi tạo
thêm dạng câu hỏi trả lời nghị luận, yêu cầu người trả lời tự viết và dạng câu hỏi hình kéo thả khi trả
lời thay vì opption chọn: tóm lại sẽ có 4 loại câu hỏi..." Đã xác nhận với người dùng phương án LỚN HƠN
cho chấm nghị luận: xây dựng luồng CHẤM TAY thật (không phải "nghị luận = 0 điểm chỉ để tham khảo") —
người dùng chấp nhận đánh đổi: bài test có câu Nghị Luận sẽ KHÔNG có kết quả Đạt/Không Đạt ngay khi nộp,
chỉ có SAU KHI giảng viên chấm xong phần nghị luận.

**4 loại câu hỏi** (field `type` trên `trainingTests.questions[]`, mở rộng tại chỗ, không thêm field
discriminator riêng): `SINGLE`/`MULTI` **GIỮ NGUYÊN VẸN** (không đổi 1 dòng validate/chấm điểm nào) +
2 loại MỚI:
- **`ESSAY`** (Nghị Luận) — không có `options`/`correctOptionIds`, chỉ giữ `points` (điểm tối đa, trainer
  tự chấm). Test-taking hiện `<textarea>`, câu trả lời gửi lên dạng `{questionId, essayText}` (khác
  `{questionId, selectedOptionIds}` của các loại còn lại — mảng `answers` khi nộp bài giờ có 2 "hình
  dạng" tuỳ theo loại câu hỏi tương ứng).
- **`IMAGE_DRAG_DROP`** (Kéo Thả Hình) — TÁI SỬ DỤNG `options[]`/`correctOptionIds` (chấm điểm giống HỆT
  `MULTI`, khớp CHÍNH XÁC tập hợp, cho phép 1+ đáp án đúng — `gradeTrainingTestSubmission()` không đổi gì
  cho loại này) nhưng mỗi `option` giờ có thêm `imageUrl` BẮT BUỘC (ảnh riêng của từng đáp án — khác hẳn
  `imageUrl` ở cấp CÂU HỎI vốn chỉ là ảnh minh hoạ đề bài, đã có từ trước). Giao diện làm bài dùng HTML5
  Drag-and-Drop API thuần (mirror `module-baocaodinhky-trinhchieu.js`, không thư viện ngoài) + BẮT BUỘC
  đường bấm-chọn tương đương (native DnD không chạy trên trình duyệt di động) — cả 2 đường ghi vào CÙNG 1
  state (`ttTakeAnswers`).
- **Excel import/export**: CHỈ hỗ trợ SINGLE/MULTI như trước (`lib/trainingTestImport.js` không đổi) —
  ESSAY/IMAGE_DRAG_DROP CHƯA hỗ trợ nhập từ Excel, chỉ tạo được qua giao diện Test Builder (quyết định có
  chủ đích, nêu rõ để không ai ngỡ ngàng khi thấy Excel không nhận 2 loại mới).

**Luồng chấm tay Nghị Luận** — field mới `gradingStatus` trên `trainingTestSubmissions`
(`'COMPLETE'` | `'PENDING_ESSAY_GRADING'`):
- Bài test **KHÔNG có câu ESSAY nào** → hành vi 100% NHƯ CŨ (`gradingStatus:'COMPLETE'`, Đạt/Không Đạt
  chốt ngay khi nộp) — **không có gì thay đổi** cho mọi bài test đã tồn tại trước tính năng này.
- Bài test có ÍT NHẤT 1 câu ESSAY → `gradeTrainingTestSubmission()` (lib/recordActions.js) chỉ chấm được
  phần trắc nghiệm/kéo-thả (essay: lưu `essayText`, `essayPointsAwarded:null`), trả về
  `gradingStatus:'PENDING_ESSAY_GRADING'`, `percentage`/`passed` còn `null` — route submit-test
  (`routes/records.js`) THEO ĐÓ không gọi `applyAutoGradedTestResult()` ngay, đăng ký (`trainingRegistrations`)
  GIỮ NGUYÊN `'REGISTERED'` (chưa có Đạt/Không Đạt).
- Hàm MỚI `gradeTrainingTestEssayAnswers(user, sub, test, cls, essayGrades)` (lib/recordActions.js) —
  route MỚI `POST /api/records/trainingClasses/:classId/submissions/:submissionId/grade-essay` — chấm
  từng câu ESSAY (0 ≤ điểm ≤ `points` của câu, bắt buộc chấm ĐỦ mọi câu ESSAY trong 1 lượt), cộng dồn với
  điểm tự động đã chấm lúc nộp, chốt lại `percentage`/`passed`/`gradingStatus:'COMPLETE'`, rồi gọi LẠI
  đúng `applyAutoGradedTestResult()` (y hệt luồng tự động 100%, không viết lại quy tắc đạt/rớt lần 2) để
  ghi Đạt/Không Đạt cuối cùng vào đăng ký. Gác quyền bằng `canManageTrainingClass()` (trainingManage/admin
  MỌI lớp, giảng viên `trainingInstruct` được gán riêng chỉ chấm ĐÚNG lớp mình phụ trách) — **KHÔNG đụng
  tới** guard chặn chấm tay ở `setTrainingRegistrationResult()` (Đợt 8, chặn "lớp đã gán test thì không
  chấm tay tuỳ ý") — đây là 1 hành động MỚI, hẹp, riêng biệt ("hoàn tất đúng phần máy không chấm được"),
  không mở lại đường tắt chấm tay chung nào.
- Giao diện: mục MỚI "📝 Cần Chấm Nghị Luận" trong sub-tab Ngân Hàng Câu Hỏi (danh sách bài đang chờ +
  modal chấm điểm từng câu), màn "Đăng Ký Của Tôi" của học viên hiện "⏳ Chờ chấm nghị luận" thay vì giả
  vờ đã có kết quả, Test Builder có thêm 2 lựa chọn loại câu hỏi + UI tương ứng (ẩn hẳn đáp án cho ESSAY,
  ô tải ảnh riêng từng đáp án cho IMAGE_DRAG_DROP).

**Ví dụ đã kiểm thử** (test `tests/test-training-essay-dragdrop-ui.js`): bài test 1 SINGLE (2đ) + 1
IMAGE_DRAG_DROP (3đ) + 1 ESSAY (5đ, tổng 10đ), lớp passScore 70% → nv1 nộp bài đúng phần trắc nghiệm/kéo-
thả (5/10 điểm tạm) → `gradingStatus:'PENDING_ESSAY_GRADING'`, đăng ký còn `REGISTERED` → giảng viên A
(phụ trách lớp) chấm 4/5 điểm nghị luận → điểm cuối 9/10 = 90% → **ĐẠT** (≥70%), `gradingStatus:'COMPLETE'`.
Giảng viên KHÁC (không phụ trách lớp) bị từ chối 403; chấm điểm vượt quá tối đa bị từ chối 400; chấm lại
1 bài đã COMPLETE bị từ chối 409.

**Deploy-impact**: KHÔNG đổi `schema.sql` (trainingTestSubmissions vẫn 1 dòng JSON trong `dbo.Records`,
chỉ thêm field JSON mới `gradingStatus`/`essayGradedBy`/`essayGradedByName`/`essayGradedAt`, và câu hỏi
options thêm field JSON tuỳ chọn `imageUrl`) — KHÔNG đổi `.env.example`, KHÔNG thêm dependency mới. Chỉ
cần copy code + `pm2 restart`.

## Đăng Ký Xe: tab "🗓️ Lịch Xe" (chỉ xem lịch trống/bận lái xe) + fix lỗi tương phản chữ/nền (2026-09-07)

**Yêu cầu người dùng (nguyên văn)**: "Trong phần đăng ký xe thêm lịch phân công xe để có thể nhìn lịch
trống của lái xe như lịch họp và trắng là trống và đỏ là đã có lịch đăng ký, bạn xem sub tab đăng ký xe,
lái xe đang màu chữ và màu nên gây khó khăn cần xứ lại, thêm tab lịch xe giữa sub tab đăng ký xe và lái
xe cũng cần điều chỉnh màu chữ và nên cho dễ nhìn nhé." Đã xác nhận với người dùng: **chỉ là màn XEM**,
KHÔNG làm kéo-thả/bấm-để-đặt lịch trực tiếp từ lưới (biển số/lái xe cụ thể vẫn do Phòng Hành Chính phân
công khi xử lý duyệt như hiện tại).

**Root cause lỗi tương phản (đã fix TRƯỚC, làm nền tảng)**: `tailwind.config.js` `content` trước đây CHỈ
quét `./public/index.html`, không quét `public/js/**/*.js` — class active-tab `bg-indigo-700 text-white`
(2 nút sub-tab Đăng Ký Xe/Lái Xe, cả gõ cứng trong `index.html` lẫn set động ở `setCarSubTab()` trong
`public/js/module-dangkyxe.js`) được thêm SAU lần `npm run build:css` gần nhất nên hoàn toàn không có rule
biên dịch trong `public/tailwind.css` — sub-tab đang chọn hiển thị chữ trắng trên nền trong suốt, gần như
không đọc được. Đã sửa: `content: ['./public/index.html', './public/js/**/*.js']` rồi `npm run
build:css` lại — giữ nguyên màu đã chọn (`bg-indigo-700`/`text-white`, khớp khuôn active-tab
`bg-emerald-700`/`text-white` của Lịch Họp), chỉ là build-pipeline fix, không đổi bảng màu. Đã grep trực
tiếp `public/tailwind.css` sau build để xác nhận có đủ rule `.bg-indigo-700{...}`, `.bg-slate-200{...}`,
`.text-slate-700{...}` (badge "Đã hủy chuyến" cũng bị lỗi tương tự) và mọi class lưới Lịch Xe mới
(`.bg-red-500`, `.hover\:bg-red-600`, `.hover\:bg-emerald-50`, `.font-mono`).

**Tab mới "🗓️ Lịch Xe"** (`#btnCarSubCalendar`, giữa "🚗 Đăng Ký Xe" và "🧑‍✈️ Lái Xe"): mirror đúng
khuôn Lịch Họp (`renderMeetingCalendar()` ở `module-phonghop.js`) — bảng: cột = lái xe (`DB.users.filter(u
=> u.active !== false && u.isDriver)`, CÙNG nguồn dữ liệu `populateCarDriversDatalist()` ở
`module-bienbanhop.js`, không tạo truy vấn mới), hàng = khung giờ 30 phút 07:00-19:00
(`generateCarTimeSlots()` — bản sao riêng của `generateMeetingTimeSlots()` vì nhóm tải module
"dangkyxe" không phụ thuộc nhóm "phonghop", xem `MODULE_LOAD_GROUPS` ở `core.js`). Ô ĐỎ
(`bg-red-500 hover:bg-red-600`) = có phiếu `carRegs` của đúng lái xe đó trùng khung giờ với trạng thái
KHÁC `REJECTED`/`CANCELLED` (PENDING/APPROVED/DRAFT đều tính "đang bận" — cùng quy ước
`findCarPlateConflict()` ở `lib/workflowEngine.js`); ô TRẮNG (`bg-white hover:bg-emerald-50`) = trống. Bấm
ô đỏ hiện thông tin phiếu qua `alert()` (`showCarScheduleSlotInfo()`, mirror `showMeetingSlotInfo()`); bấm
ô trắng KHÔNG làm gì (khác hẳn `quickBookMeetingSlot()` của Lịch Họp — đây là điểm khác biệt DUY NHẤT so
với khuôn Lịch Họp, theo đúng phương án chỉ-xem người dùng đã chọn). Chuyến nhiều ngày (`startTime`/
`endTime` khác ngày) tự động hiện đỏ ở MỌI ngày trong khoảng vì phép so khớp dùng `Date` đầy đủ (không chỉ
giờ-trong-ngày) — không cần xử lý riêng.

**Deploy-impact: CÓ THAO TÁC THỦ CÔNG** — `public/tailwind.css` là file tĩnh build sẵn (`npm run
build:css`, KHÔNG tự sinh lúc chạy server), nên deploy đợt này **bắt buộc** copy file
`public/tailwind.css` đã build lại (hoặc chạy `npm run build:css` ngay trên server production) — chỉ
`pm2 restart` KHÔNG đủ, giao diện vẫn lỗi tương phản cũ nếu quên bước này. Không đổi `sql/schema.sql`,
không thêm biến môi trường, không đổi `dependencies`.

**Test**: mở rộng `tests/test-meeting-car.js` (đọc header file để biết cách hạ tầng test giả lập server
thật) — thêm cụm "Lịch Xe" kiểm: PENDING/DRAFT tính là bận (ô đỏ), REJECTED/CANCELLED không tính (ô
trắng), chuyến nhiều ngày hiện đỏ đúng ở cả ngày bắt đầu/GIỮA/kết thúc (không chỉ ngày bắt đầu) và trắng
lại đúng ở 2 biên ngoài khoảng, bấm ô đỏ hiện alert() và KHÔNG chuyển sang tab/form Đăng Ký. Toàn bộ 75
file `tests/test-*.js` chạy lại: chỉ còn đúng 3 FAIL tiền-lệ (không liên quan, do môi trường test không có
SQL Server thật kết nối tới `localhost:1433` — `test-audit-fixes-batch1.js` 2 FAIL, cùng lỗi ở
`test-audit-round2-cluster1.js` 1 FAIL — đã xác nhận bằng `git stash` giữ nguyên y hệt trước khi có thay
đổi này), không có regression mới.

## Rà soát audit "trường nhiều lựa chọn không sửa thêm/bớt được" — 6 danh mục mới admin-editable (2026-09-07)

**Yêu cầu người dùng (nguyên văn)**: "Rà soát lại tất cả biểu mẫu chỗ trường nào có nhiều lựa chọn thì
cho phép chỉnh sửa thêm, bớt lựa chọn trong trường này giúp mình nhé, hiện tại có một vài trường nhiều
lựa chọn mà ko sửa thêm bớt thông tin, bạn rà soát kỹ nhe". Một đợt research read-only trước đó đã xác
định đúng 6 trường/module cụ thể còn gõ cứng danh sách lựa chọn — đợt này triển khai admin-editable cho
cả 6, theo đúng khuôn mẫu đã có sẵn trong hệ thống (contractTypes/carTypes/itTicketCategories/licenseTypes).

**6 danh mục MỚI (tất cả đều `ADMIN_ONLY_KEYS`, `routes/data.js` — chỉ Quản Trị Viên ghi được)**:

1. **`DB.meetingRooms`** (Đặt Phòng Họp) — trước đây `const MEETING_ROOMS` gõ cứng 3 phòng ngay trong
   `public/js/core.js`. Nay admin thêm/xoá phòng họp tại chính module Đặt Phòng Họp (tab "📝 Đăng Ký" —
   khối "🗂️ Danh Mục Phòng Họp", cùng khuôn "Danh Mục Đồng Phục"). `<select id="meetingRoom">` + lưới
   Lịch Họp đều đọc `DB.meetingRooms` thay vì hằng số. Không có validate server (không đổi — trước đây
   cũng chưa có).
2. **`DB.carPurposes`** (Đăng Ký Xe — "Mục Đích Sử Dụng") — `{key,label}[]` (cùng khuôn
   `itTicketCategories`), `key` giữ đúng giá trị hiện có (`Công tác`/`Vận chuyển tài sản/hàng hóa`/
   `Ngoại giao, đưa đón khách`/`Khác`), `label` giữ nguyên phần ghi chú "(đính kèm...)". Sửa qua màn
   Biểu Mẫu (`CORE_FIELD_MANIFEST.CAR.carPurpose`, `optionsKey`). Không có validate server (không đổi).
3. **`DB.submissionPriorities`** (Tờ Trình — "Độ Khẩn") — cùng khuôn trên (`{key,label}[]`, key giữ
   nguyên `Bình thường`/`Gấp`/`Thượng khẩn`, label giữ icon 🔥/⚡). Sửa qua Biểu Mẫu
   (`CORE_FIELD_MANIFEST.SUBMISSION.subPriority`). Không có validate server (không đổi).
4. **`DB.hrFeedbackCategories`** (HCRC Đồng Hành — "Chủ Đề") — cùng khuôn `itTicketCategories`, giữ
   nguyên đúng 4 key (`OTHER`/`BENEFITS`/`POLICY`/`SALARY`). **CÓ sửa server**:
   `lib/createValidation.js` `hrFeedback.extraValidate` trước đây dùng `Set` cố định 4 giá trị — nay đọc
   `appData.hrFeedbackCategories` (fallback về đúng 4 giá trị gốc nếu appData chưa có, cùng khuôn
   `itSupportTickets.extraValidate`), nếu không admin thêm 1 chủ đề mới sẽ bị server âm thầm ép về
   `OTHER`. Đã gỡ hằng số trùng `HR_FEEDBACK_CATEGORY_LABELS` ở `module-hcrcdonghanh.js`, thay bằng
   `getHrFeedbackCategoryLabel()` đọc từ `DB.hrFeedbackCategories` (fallback nhãn gốc).
5. **Đồng bộ dropdown lọc IT Ticket** — `#filterCategoryItTicket` (Hỗ Trợ IT > Hỗ Trợ Yêu Cầu, khối Tìm
   Kiếm & Lọc) trước đây vẫn gõ cứng 5 `<option>` gốc dù `#itTicketCategory` (form tạo) đã đổ động từ
   `DB.itTicketCategories` từ lâu — 2 nơi lệch nhau mỗi khi admin sửa danh mục. Thêm
   `populateItTicketCategoryFilterSelect()`, gọi cùng lúc với `populateItTicketCategorySelect()` trong
   `populateDropdowns()` — không phải danh mục MỚI, chỉ là vá lệch pha giữa 2 dropdown cùng nguồn.
6. **`DB.itRenewalCategories`** (Hỗ Trợ IT > Gia Hạn Dịch Vụ CNTT — "Loại Dịch Vụ") — trước đây free-text
   + gợi ý tự học cố định (`IT_RENEWAL_CATEGORY_SUGGESTIONS`). Nay danh mục admin-editable (flat array,
   cùng khuôn `licenseTypes`): panel CRUD ngay trong tab Gia Hạn Dịch Vụ (chỉ Admin thấy, khối "📜 Quản
   Lý Danh Mục 'Loại Dịch Vụ'"), **VÀ** tự học server-side (`learnItRenewalCategory()`,
   `routes/create.js`, CHỈ THÊM không ghi đè — cùng khuôn `learnLicenseType()`). Ô nhập vẫn giữ nguyên
   cơ chế gợi ý tự dựng `sdd*` (KHÔNG dùng `<datalist>` native, theo quy ước `CLAUDE.md`). Đã seed sẵn
   đúng 6 giá trị gợi ý gốc; nếu hệ thống ĐÃ có bản ghi `itServiceRenewals` thật trước khi nâng cấp,
   `seedDefaults.js` (`migrateItRenewalCategories()`) tự quét bổ sung mọi giá trị `.category` khác đang
   có vào danh mục — không mồ côi giá trị nào.

**Zero behavior change tới khi admin chủ động sửa**: cả 6 danh mục seed đúng 1:1 giá trị/thứ tự đang gõ
cứng hôm nay (`defaults.js`) — không có bản ghi/hành vi nào đổi cho tới khi admin thật sự thêm/bớt/đổi
nhãn ở 1 trong các màn quản lý trên.

**Deploy-impact: KHÔNG** — 6 danh mục mới đều là AppData JSON (tự seed vào `dbo.AppData` lúc khởi động
qua `seedDefaults.js`, không đụng `sql/schema.sql`), không thêm biến môi trường (`.env.example`), không
đổi `dependencies` (`package.json`). Chỉ copy code + `pm2 restart`.

**Test**: `tests/test-form-fields-6-catalogs.js` (mới, 13 kịch bản — 5 danh mục admin-only-write 403/200,
`hrFeedback` chấp nhận category mới/từ chối category đã xoá/fallback đúng khi appData rỗng,
`itRenewalCategories` tự học CHỈ THÊM không ghi đè/không thêm trùng/chặn người không có `itManage`) +
1 kịch bản mới trong `tests/test-it-support.js` (đồng bộ dropdown lọc IT Ticket qua đúng đường admin thật
dùng — `saveCoreFieldOptionsList()`) + cập nhật seed `tests/test-meeting-car.js`/`test-submission.js`/
`testHarness.js` cho khớp shape mới. Full regression 75 file `tests/test-*.js`: 73/75 xanh, 2 lỗi còn
lại (`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js`) là lỗi kết nối SQL Server
(`localhost:1433`) CÓ SẴN TỪ TRƯỚC (đã xác nhận qua `git stash` baseline y hệt, không liên quan đợt này).

## Điều Hành > 📅 Báo Cáo Định Kỳ > Tổng Hợp: bộ lọc "Đối Chiếu Theo Công Việc" + Giấy Phép: sắp phiên bản mới nhất lên trước (2026-09-07)

2 thay đổi nhỏ, KHÔNG đụng schema/API mới, gộp chung 1 đợt:

**1. Bộ lọc cho "🗂️ Đối Chiếu Theo Công Việc"** (Điều Hành > 📅 Báo Cáo Định Kỳ > sub-tab Tổng Hợp,
box "🗂️ Đối chiếu với công việc thật (DB.tasks)") — trước đây bấm nút này luôn tổng hợp TOÀN BỘ công
việc trong phạm vi kỳ, không lọc được gì thêm. Nay có thêm 3 control (chỉ có tác dụng NGAY LẦN BẤM NÚT
— sinh lại từ đầu, KHÔNG live-filter bảng đang hiển thị):
- **Trạng thái** (`#prTaskFilterStatus`): để trống (mặc định, giữ nguyên hành vi cũ)/Chưa bắt đầu
  (`TODO`)/Đang thực hiện (`DOING`)/Đã hoàn thành (`DONE`)/**Quá hạn** (`OVERDUE` — nhóm PHÁI SINH,
  không phải 1 giá trị status thật: lọc theo đúng cờ "quá hạn" module này đã tự tính cho từng việc
  mở, sau khi đã xác định việc đó CÓ được tính vào kỳ hay không — 1 việc TODO/DOING lọt vào tổng hợp
  của kỳ gần như luôn được tính "quá hạn" vì hạn chót của nó đã <= mốc cuối kỳ).
- **Từ ngày/Đến ngày** (`#prTaskFilterFromDate`/`#prTaskFilterToDate`): GHI ĐÈ mốc bắt đầu/kết thúc mà
  trước đây LUÔN tự suy ra từ chuỗi kỳ báo cáo (kỳ CLOSED liền trước -> hạn chót kỳ này). Để trống cả
  2 = hành vi y hệt trước đây (mốc tự suy ra, có cảnh báo "khoảng trống ranh giới" nếu kỳ liền trước
  chưa đóng). Điền 1 trong 2 (hoặc cả 2) = GHI ĐÈ đúng mốc đó (không phải lọc AND thêm), vẫn giữ
  nguyên 2 kiểu ngưỡng khác nhau cho việc ĐÃ XONG (theo thời điểm hoàn thành, có cận dưới+trên) và
  việc CÒN MỞ (theo hạn chót, chỉ có cận trên) — và bỏ cảnh báo ranh giới (chỉ có ý nghĩa khi mốc tự
  suy ra, không còn ý nghĩa khi người dùng tự chọn khoảng tuỳ ý).
- `mergeReportPeriodByTasks(user, period, tasks, users, allPeriods, filters)` (`lib/recordActions.js`)
  thêm tham số thứ 6 `filters` (optional, mặc định không đổi hành vi cũ nếu bỏ trống/không truyền —
  callback cũ vẫn chạy nguyên). `POST /api/records/reportPeriods/:id/mergeByTasks` (`routes/records.js`)
  nay đọc `req.body` làm `filters` (trước đây route này không đọc body gì cả).

**2. Giấy Phép — sắp phiên bản mới nhất lên trước** (`public/js/module-tailieu.js`) — trước đây danh
sách các phiên bản gia hạn (cả ở bảng con khi bấm mở rộng 1 hồ sơ, lẫn bảng "Chi Tiết Giấy Phép") hiện
theo thứ tự CŨ nhất trước (v1 -> v2 -> v3...), phải cuộn xuống mới thấy bản mới nhất. Nay cả 2 nơi đều
sắp MỚI NHẤT lên trước (DESC theo `issueDate`, `versionNumber` làm tiêu chí phụ) — thuần sửa THỨ TỰ
hiển thị phía client, KHÔNG đụng gì tới `getLicenseFamily()` (vẫn giữ nguyên thứ tự tăng dần cũ vì
`family[0]`/`family[length-1]` còn được dùng nơi khác để xác định hồ sơ gốc/phiên bản mới nhất).

**Deploy-impact: KHÔNG** — không đổi `schema.sql`, không thêm biến môi trường (`.env.example`), không
đổi `dependencies` (`package.json`). Chỉ copy code + `pm2 restart`.

**Test**: `tests/test-report-period-by-tasks-filters.js` (mới, 8 kịch bản thuần Node gọi thẳng
`mergeReportPeriodByTasks()` — status thường/OVERDUE phái sinh/ghi đè fromDate/ghi đè toDate/kết hợp/
phạm vi rỗng báo lỗi 400) + `tests/test-periodic-report.js` (4 kịch bản UI mới qua browser thật, dùng
đúng 3 control DOM) + `tests/test-license.js` (1 kịch bản mới xác nhận thứ tự DESC ở cả 2 nơi hiển
thị) + `tests/testHarness.js` (mock dispatcher thread `body` vào `mergeReportPeriodByTasks()`). Full
regression 74 file `tests/test-*.js`: 72/74 xanh, 2 lỗi còn lại (`test-audit-fixes-batch1.js`,
`test-audit-round2-cluster1.js`) là lỗi kết nối SQL Server (`localhost:1433`) CÓ SẴN TỪ TRƯỚC (đã xác
nhận qua `git stash` baseline y hệt, không liên quan đợt này).

## Vận Hành > 🏬 Siêu Thị > Báo Cáo: "📋 Tổng Quan Toàn Bộ Công Việc" + Xuất Excel (2026-09-07)

**Yêu cầu người dùng (nguyên văn)**: "Trong báo cáo phải có một báo cáo tổng quan về tất cả các công việc
đang thực hiện, trạng thái liên quan, chậm, tiến độ, chạm nghiệm thu, nghiệm thu, hoàn thành và xuất được
ra file excel để xem tổng thể".

**Bối cảnh**: item **CUỐI CÙNG (7/7)** trong loạt cải tiến "Vận Hành > 🏬 Siêu Thị" đợt này (VHST-1..6 đã
merge trước đó cùng ngày, xem các mục ngay bên dưới). VHST-6 (mục ngay dưới) đã dựng sẵn khối "📊 Thống Kê
Quá Hạn Theo Công Việc" ở tab Báo Cáo — nhưng chỉ đếm SỐ LƯỢNG + liệt kê công việc **ĐANG QUÁ HẠN**, KHÔNG
liệt kê được TOÀN BỘ công việc (cả đang đúng tiến độ/đã hoàn thành) trong 1 bảng duy nhất, và KHÔNG xuất
được Excel. Mục này bổ sung đúng phần còn thiếu đó — **KHÔNG đụng/không thay đổi** khối thống kê VHST-6 đã
có (vẫn giữ nguyên).

**Thiết kế đã triển khai — HOÀN TOÀN CLIENT-SIDE, KHÔNG có thay đổi server/schema nào**: `DB.operationWorkItems`
đã được nạp đầy đủ (đúng phạm vi xem của người dùng — lọc theo hồ sơ nguồn ở `routes/data.js`, không đổi gì
thêm) ngay từ `GET /api/data` có sẵn — bảng tổng quan + xuất Excel đọc thẳng dữ liệu ĐÃ CÓ trong bộ nhớ
trình duyệt, không cần route/API mới nào.

- **`buildOperationStoreReportComputed()`** (mới, `public/js/module-vanhanh.js`) — tách phần dựng danh
  sách hồ sơ đã lọc 3 filter cấp hồ sơ (Loại Hồ Sơ/Tiến Độ/Từ Khóa) ra khỏi `renderOperationStoreReport()`
  — dùng CHUNG cho bảng rollup cấp hồ sơ có sẵn, khối thống kê VHST-6, VÀ bảng tổng quan mới — đúng 1
  nguồn sự thật cho "tập hồ sơ đang xem".
- **`buildOperationStoreReportOverviewRows(computed)`** (mới) — làm PHẲNG `computed` thành 1 dòng/công
  việc (MỌI công việc, gốc lẫn con, mọi trạng thái — không chỉ việc quá hạn như 2 bảng cảnh báo VHST-6),
  áp dụng thêm **2 filter RIÊNG** đọc trực tiếp DOM: `#opReportItemFilterStatus` (Trạng Thái Công Việc —
  đúng enum thật `CHUA_BAT_DAU`/`DANG_THUC_HIEN`/`DANG_NGHIEM_THU`/`DA_NGHIEM_THU`, "Đang nghiệm thu" =
  "chờ nghiệm thu" trong yêu cầu người dùng) và `#opReportItemFilterDeadlineStatus` (Trạng Thái Hạn — 4
  trạng thái `computeOperationWorkItemDeadlineStatus()` của VHST-6: `QUA_HAN_CHUA_BAT_DAU`/
  `QUA_HAN_CHUA_XONG`/`DUNG_TIEN_DO`/`HOAN_THANH` — đúng "chậm"/"tiến độ"/"hoàn thành" trong yêu cầu). Hàm
  này là NGUỒN DUY NHẤT cho CẢ hiển thị lẫn xuất Excel — file xuất LUÔN khớp đúng bảng đang lọc trên màn
  hình, không lệch nhau.
- **`renderOperationStoreReportOverview(computed)`** (mới) — dựng bảng 10 cột vào `tbody`
  `#operationWorkItemOverviewTableBody`: Mã Hồ Sơ, Tên Hồ Sơ, Tên Công Việc, Người Thực Hiện, Người Nghiệm
  Thu, Trạng Thái Công Việc, Trạng Thái Hạn, Ngày Bắt Đầu, Hạn Chót, **Ngày Nghiệm Thu** (đọc từ mốc
  history hành động `'ACCEPTED'` GẦN NHẤT — `acceptOperationWorkItem()` không lưu field ngày riêng, chỉ
  `acceptedBy`/`acceptedByName`/`acceptanceNote`).
- **`exportOperationStoreReportOverview()`** (mới) — nút "📥 Xuất Excel" ngay trên bảng, dùng ĐÚNG cơ chế
  `downloadXlsxFromServer()` có sẵn (`POST /api/admin/export-xlsx`, khác `exportOperationWorkItems()` có
  sẵn ở chỗ hàm đó CHỈ xuất công việc của 1 hồ sơ đang mở, còn hàm này xuất TOÀN BỘ hồ sơ đang hiển thị,
  respecting ĐỦ 5 filter — 3 cấp hồ sơ + 2 cấp công việc mới). Xuất file
  `Tong_Quan_Cong_Viec_Van_Hanh.xlsx`, sheet "Tổng Quan Công Việc", 10 cột khớp đúng bảng trên màn hình.
  Không có dòng nào phù hợp thì báo `alert()`, KHÔNG gọi server.
- **`index.html`**: thêm 2 dropdown filter mới (Trạng Thái Công Việc/Trạng Thái Hạn) ngay dưới 3 filter cấp
  hồ sơ có sẵn ở tab Báo Cáo, + khối bảng "📋 Tổng Quan Toàn Bộ Công Việc" mới (kèm ô đếm tổng số + nút
  Xuất Excel) chèn giữa khối cảnh báo VHST-6 và bảng rollup cấp hồ sơ (nay có thêm tiêu đề "📊 Tổng Hợp
  Theo Hồ Sơ" cho rõ ràng, KHÔNG đổi nội dung/cột của bảng đó).
- **Test mới**: `tests/test-operation-store-report-overview.js` (Playwright, cùng khuôn `testHarness.js`
  đã dùng cho `test-operation-store-lifecycle.js`) — seed 2 hồ sơ KHÁC NHAU (1 Mở mới + 1 Sửa chữa) với 5
  công việc trải đủ tổ hợp trạng thái công việc × trạng thái hạn: xác nhận bảng gộp ĐÚNG công việc từ
  NHIỀU hồ sơ, nhãn hiển thị đúng cho từng tổ hợp (kể cả việc "Đã nghiệm thu" dù hạn đã qua RẤT lâu vẫn
  hiện "Hoàn thành", không bị gắn cờ quá hạn), lọc theo Trạng Thái Công Việc/Trạng Thái Hạn thu hẹp ĐÚNG cả
  bảng trên màn hình lẫn file xuất, Ngày Nghiệm Thu lấy đúng mốc history `ACCEPTED` gần nhất, và trường
  hợp lọc rỗng báo alert đúng thay vì gọi xuất file trống. 6/6 kịch bản PASS.
- **Deploy-impact**: hoàn toàn KHÔNG — không đổi `sql/schema.sql`, không đổi `.env.example`, không đổi
  `dependencies` trong `package.json` (chỉ bump field `version`). Chỉ cần copy code + `pm2 restart` như
  thường lệ, không cần thao tác thủ công nào khác.

## Vận Hành > 🏬 Siêu Thị: tách riêng cảnh báo "quá hạn chưa bắt đầu" / "quá hạn chưa hoàn thành" (2026-09-07)

**Yêu cầu người dùng (nguyên văn)**: "Trong báo cáo phải thông kế được các đầu mục công việc quá hạn nhưng
chưa bắt đầu, cảnh báo các công việc quá hạn nhưng chưa bắt dầu, các công việc quá hạn nhưng chưa kết thúc
(hiện trạng thái ở báo cáo và trạng thái tại quản lý công việc, quản lý nghiệm thu".

**Thiết kế đã triển khai** (item thứ 6/7 trong loạt việc Vận Hành > Siêu Thị đang làm): trước bản này, tab
Báo Cáo chỉ có 1 trạng thái gộp chung `LATE`/"🔴 Chậm tiến độ" ở cấp HỒ SƠ cho MỌI công việc quá hạn (bất kể
chưa bắt đầu hay đã bắt đầu mà chưa xong), và 2 màn danh sách sống (Quản Lý Công Việc/Quản Lý Nghiệm Thu)
không hề hiển thị dấu hiệu quá hạn nào. Field `deadline` (hạn hoàn thành) trên mỗi `operationWorkItems` đã
CÓ SẴN từ trước (không phải field mới — form tạo/sửa công việc `owiDeadline` đã tồn tại) nên **không cần
field mới/không cần migration SQL** — chỉ cần 1 hàm tính trạng thái + hiển thị ở 3 nơi.

- Hàm dùng CHUNG **`computeOperationWorkItemDeadlineStatus(item)`** (bản gốc `lib/recordActions.js`, mirror
  client-side cùng tên ở `public/js/module-vanhanh.js` — theo đúng khuôn "2 bản độc lập, phải sửa đồng thời"
  đã dùng cho `computeOperationWorkItemProgressUpdateOverdueDays()` VHST-4) trả về 1 trong 4 trạng thái:
  - `HOAN_THANH` — đã `DA_NGHIEM_THU` (KHÔNG bao giờ gắn cờ quá hạn dù `deadline` đã qua rất lâu).
  - `QUA_HAN_CHUA_BAT_DAU` — `deadline` đã qua, status vẫn `CHUA_BAT_DAU`.
  - `QUA_HAN_CHUA_XONG` — `deadline` đã qua, status `DANG_THUC_HIEN` hoặc `DANG_NGHIEM_THU` (đã bắt đầu/đã
    nộp nghiệm thu nhưng CHƯA nghiệm thu xong thật sự).
  - `DUNG_TIEN_DO` — còn lại (chưa tới hạn, hoặc KHÔNG đặt `deadline` — không có hạn thì không có gì để so
    sánh, không bao giờ gắn cờ quá hạn).
  - LƯU Ý: khác HẲN cảnh báo "quá hạn cập nhật tiến độ" của VHST-4 (`progressUpdateFrequencyDays`, tần suất
    BẮT BUỘC cập nhật, không liên quan `deadline`) — 2 khái niệm ĐỘC LẬP, 1 công việc có thể dính CẢ HAI
    cảnh báo cùng lúc, không gộp chung.
- **Tab Báo Cáo** (`renderOperationStoreReport()`): thêm khối **"📊 Thống Kê Quá Hạn Theo Công Việc"** (4 ô
  đếm số lượng theo đúng 4 trạng thái trên) + 2 bảng **cảnh báo** liệt kê TỪNG công việc cụ thể đang quá hạn
  (mã hồ sơ, loại, tên công việc, hạn, số ngày quá hạn) — tách riêng "🔴 Quá hạn — Chưa bắt đầu" khỏi "🟠 Quá
  hạn — Chưa hoàn thành", dựng bởi `renderOperationStoreReportItemStats()` mới, tính trên ĐÚNG tập hồ sơ đang
  hiển thị (đã áp dụng bộ lọc hiện tại). Bảng rollup cấp HỒ SƠ có sẵn (Tổng CV/Đã Nghiệm Thu/Đang Thực
  Hiện/Chưa Bắt Đầu/% Hoàn Thành/Tiến Độ) GIỮ NGUYÊN, chỉ đổi cách tính cờ "🔴 Chậm tiến độ" sang dùng đúng
  `computeOperationWorkItemDeadlineStatus()` (trước đây tự parse `new Date(deadline) < today` trực tiếp, có
  thể lệch 1 ngày tuỳ múi giờ server) — thống kê cấp hồ sơ và cấp công việc giờ luôn khớp nhau.
- **2 màn danh sách sống** (Quản Lý Công Việc/Quản Lý Nghiệm Thu, `renderOperationExecutionList()`/
  `renderOperationAcceptanceList()`): thêm cột mới **"Quá Hạn"** ở mỗi dòng hồ sơ, đếm số công việc theo 2
  trạng thái quá hạn (`operationWorkItemDeadlineSummary()` mới) — hiện "🔴 N chưa bắt đầu"/"🟠 N chưa hoàn
  thành" hoặc "-" nếu không có gì quá hạn.
- **Modal cây công việc** (mở từ nút "🛠️ Quản Lý Công Việc"/"✅ Nghiệm Thu"): mỗi dòng công việc (cả
  EXECUTION lẫn ACCEPTANCE mode, `buildOperationWorkItemRow()`) hiện thêm badge quá hạn ngay dưới tên công
  việc — CÙNG chỗ badge "⚠️ Quá hạn cập nhật tiến độ" (VHST-4) nhưng là badge riêng, 2 badge có thể cùng hiện.

**Đã sửa**:
- `lib/recordActions.js` — thêm `computeOperationWorkItemDeadlineStatus()`, export cho test.
- `public/js/module-vanhanh.js` — thêm bản mirror `computeOperationWorkItemDeadlineStatus()`,
  `operationWorkItemDeadlineBadge()`, `operationWorkItemDeadlineSummary()`,
  `operationWorkItemDeadlineSummaryCellHTML()`, `renderOperationStoreReportItemStats()`; sửa
  `renderOperationExecutionList()`/`renderOperationAcceptanceList()` (thêm cột "Quá Hạn", colspan rỗng
  6→7), `buildOperationWorkItemRow()` (thêm badge ở `nameCell`), `renderOperationStoreReport()` (gọi
  `renderOperationStoreReportItemStats()`, đổi cách tính cờ `LATE`).
- `public/index.html` — thêm cột `<th>Quá Hạn</th>` ở 2 bảng Thực Hiện/Nghiệm Thu; thêm khối
  `#operationWorkItemDeadlineStatsBox`/`#operationWorkItemDeadlineWarningBox` ở tab Báo Cáo.
- `tests/test-operation-workitem-deadline-status.js` (mới) — 13 kịch bản test thuần cho
  `computeOperationWorkItemDeadlineStatus()`: quá hạn+`CHUA_BAT_DAU`, quá hạn+`DANG_THUC_HIEN`, quá
  hạn+`DANG_NGHIEM_THU`, quá hạn+`DA_NGHIEM_THU` (không cảnh báo), hạn tương lai, hạn = hôm nay, không đặt
  hạn, hạn sai định dạng, item null, và đếm tổng hợp (aggregate) trên 1 tập công việc trộn đủ 4 trạng thái.

**Deploy-impact**: KHÔNG cần chạy lại `schema.sql` (field `deadline` đã có sẵn trong JSON `Payload` của
`dbo.OperationWorkItems` từ trước, hàm mới chỉ ĐỌC lại field cũ — không có field payload mới nào cần thêm).
Không thêm biến môi trường, không thêm dependency `package.json` nào khác ngoài bump version. Chỉ cần copy
code + `pm2 restart`.

## Vận Hành > 🏬 Siêu Thị > Thực Hiện: "🔗 Liên Kết" công việc — phụ thuộc kiểu quản lý dự án (2026-09-07)

**Yêu cầu người dùng (nguyên văn)**: "Có phần liên kết công việc trên từng công việc con hoặc công việc lớn
không có công việc con, ý tương là tại mỗi công việc sẽ có nút thao tác liên kết, khi chọn thao tác liên kết
sẽ mở ra các đầu mục cv cần liên kêt và có thể chọn nhiều đầu mục công viêc. Viêc liên kêt đam bảo khi công
việc liên kết đến các công việc khác kêt thuc thì các công việc khác mới có thể bát đầu công viêc, nếu công
việc liên kết chưa kết thúc thì không thể thự hiện bắt đầu công việc được (giống quản lý dự án)".

**Thiết kế đã triển khai** (item thứ 5/7 trong loạt việc Vận Hành > Siêu Thị đang làm, nối tiếp VHST-4 ở
mục ngay dưới — cùng khái niệm "công việc lá" và cùng khuôn "tự dọn sạch field khi item không còn là lá"):
- Thêm 1 field mới, optional, trên mỗi `operationWorkItems` — **`dependsOnWorkItemIds`** (mảng id các công
  việc mà item này PHỤ THUỘC vào — "công việc liên kết") — **CHỈ áp dụng công việc LÁ**, cả ở item ĐANG sửa
  lẫn từng item được TRỎ TỚI (không liên kết được tới đầu mục có con). `resolveOperationWorkItemDependencyIds()`
  mới (`lib/recordActions.js`, mirror khuôn `resolveOperationWorkItemScheduleFields()` của VHST-4) validate:
  mỗi id phải tồn tại trong CHÍNH hồ sơ (`itemsForSource`, nên tự động chặn liên kết chéo hồ sơ — id lạ =
  "không tìm thấy"), phải trỏ tới đúng công việc LÁ, không tự liên kết chính mình, và **dò vòng lặp phụ
  thuộc** qua `assertNoOperationWorkItemDependencyCycle()` mới (mirror thuật toán `assertNoManagerCycle()`
  có sẵn ở `lib/recordViewScope.js` cho quan hệ quản lý trực tiếp — khác ở chỗ 1 work item có thể phụ thuộc
  NHIỀU công việc cùng lúc nên duyệt DFS qua ngăn xếp thay vì 1 chuỗi đơn).
- **Cổng chặn "Bắt đầu"** — `updateOperationWorkItemProgress()` (`lib/recordActions.js`) nhận thêm tham số
  `itemsForSource`, chặn (400) đúng bước "Chưa bắt đầu → Đang thực hiện" nếu còn BẤT KỲ công việc trong
  `dependsOnWorkItemIds[]` chưa đạt `DA_NGHIEM_THU` (thông báo nêu rõ tên từng công việc còn chặn) — CHỈ
  chặn bước "bắt đầu", không soi lại các bước sau (lặp lại "Đang thực hiện"/nộp nghiệm thu) dù liên kết đổi
  sau đó. Id liên kết không còn tồn tại (đã bị xoá) tự bỏ qua, không chặn cứng.
- Route sub-endpoint RIÊNG **`POST /operationWorkItems/:id/dependencies`** (mirror `/progress`, `/accept` —
  mỗi route chỉ đổi đúng phần dữ liệu của thao tác đó) gọi `setOperationWorkItemDependencies()` mới — quyền
  CHỈ người quản lý hồ sơ (mirror `editOperationWorkItem()`), chặn sửa liên kết khi item đã `DA_NGHIEM_THU`.
- **Dọn dẹp dữ liệu** (2 quyết định thiết kế):
  - **Xoá 1 (nhánh) công việc** → `cleanupOperationWorkItemDependenciesOnDelete()` mới (`routes/records.js`)
    tự động dọn sạch id vừa xoá khỏi `dependsOnWorkItemIds[]` của MỌI công việc khác còn lại cùng hồ sơ có
    tham chiếu tới — chủ động ngay lúc xoá (KHÁC lazy-cleanup ở dưới), tránh để lại liên kết "chết".
  - **Công việc lá đang có liên kết, sau đó có thêm việc con** (không còn là lá) → mirror ĐÚNG khuôn "tự dọn
    sạch" đã dùng cho `startDate`/`progressUpdateFrequencyDays` (VHST-4): KHÔNG cascade chủ động ngay lúc
    thêm con, mà tự dọn về `[]` ở lần gọi `/dependencies` KẾ TIẾP không gửi lại field này — nhất quán với
    tiền lệ đã có, và vô hại vì `updateOperationWorkItemProgress()` đã chặn thao tác tay trên công việc có
    con TRƯỚC KHI chạm tới cổng chặn liên kết.
- **UI** (`public/js/module-vanhanh.js` + `public/index.html`): nút mới **"🔗 Liên kết"** trên mỗi dòng công
  việc LÁ (tab Thực Hiện) mở modal `operationWorkItemDependencyModal` — checkbox nhiều lựa chọn liệt kê các
  công việc LÁ KHÁC cùng hồ sơ, tự LỌC SẴN client-side loại chính nó + mọi lựa chọn sẽ tạo vòng lặp (không
  bắt buộc, server vẫn validate lại). Dòng công việc có liên kết hiện nhãn **"🔗 Phụ thuộc: [tên các công
  việc]"**; nút "🔄 Cập Nhật Tiến Độ" bị thay bằng cảnh báo **"⛔ Chưa thể bắt đầu — đang chờ: [tên các công
  việc chưa xong]"** khi còn bị chặn (UX mirror — server mới là nơi thực sự chặn).

**Đã sửa**:
- `lib/recordActions.js` — thêm `resolveOperationWorkItemDependencyIds()`, `assertNoOperationWorkItemDependencyCycle()`,
  `setOperationWorkItemDependencies()`; tích hợp vào `createOperationWorkItem()` (`hasChildren` luôn `false`)
  và cổng chặn mới trong `updateOperationWorkItemProgress()` (nhận thêm tham số `itemsForSource`); export cả
  3 hàm mới cho test.
- `routes/records.js` — route mới `POST /operationWorkItems/:id/dependencies`; `POST .../progress` truyền
  thêm `itemsForSource`; thêm `cleanupOperationWorkItemDependenciesOnDelete()`, gọi ngay sau
  `deleteWorkItemsByIds()` ở route `/delete`.
- `public/js/module-vanhanh.js` — nút "🔗 Liên kết" + nhãn "🔗 Phụ thuộc" trong `buildOperationWorkItemRow()`
  (nhận thêm tham số `items`); cổng chặn UX trên nút "🔄 Cập Nhật Tiến Độ"; modal mới
  `openOperationWorkItemDependencyModal()`/`closeOperationWorkItemDependencyModal()`/
  `submitOperationWorkItemDependencies()` + hàm phụ `operationWorkItemWouldCycle()` (lọc client-side).
- `public/index.html` — modal mới `#operationWorkItemDependencyModal`.
- `tests/testHarness.js` — mock route `operationWorkItems:progress` truyền thêm `itemsForSource`; mock route
  mới `operationWorkItems:dependencies`; route `/delete` cascade-clean `dependsOnWorkItemIds` (mirror route
  thật).

**Kiểm thử**: file mới `tests/test-operation-workitem-dependencies.js` (23 kịch bản THUẦN, không cần
Playwright/SQL Server — validate id/leaf-only/tự liên kết/vòng lặp trực tiếp+dài, tích hợp create/set, cổng
chặn `updateOperationWorkItemProgress()` đủ các nhánh: chặn khi còn liên kết dở, cho qua khi đã nghiệm thu
xong, nhiều liên kết còn 1 cái dở vẫn chặn đúng tên, không liên kết thì không chặn, id chết tự bỏ qua, không
soi lại khi lặp lại "Đang thực hiện") — 23/23 pass. Mở rộng `tests/test-operation-store-lifecycle.js` thêm
10 kịch bản tích hợp qua route/UI thật (liên kết A→B qua route thật + chặn 400 + UI hiện đúng nhãn/cảnh báo,
B nghiệm thu xong thì A bắt đầu được, vòng lặp trực tiếp bị chặn, tự liên kết chính mình bị chặn, liên kết
chéo hồ sơ bị chặn, đặt liên kết trên công việc có con bị chặn, xoá công việc bị phụ thuộc tự dọn tham chiếu,
leaf→non-leaf tự dọn liên kết) — 10/10 pass (tổng file lifecycle: 100/100). Chạy toàn bộ `tests/test-*.js`
(71 file kể cả file mới) — 0 lỗi mới so với baseline (đã tự xác nhận lại baseline bằng `git stash`, KHÔNG
chỉ tin theo ghi chú cũ): chỉ còn đúng **2** kịch bản lỗi phụ thuộc SQL Server thật đã biết từ trước
(`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js`).

**Deploy-impact**: KHÔNG có gì ngoài copy code + `pm2 restart` — `dependsOnWorkItemIds` chỉ là 1 field JSON
thêm vào `Payload` (`dbo.OperationWorkItems`, vốn đã là JSON tự do — CHỈ `Status`/`ParentWorkItemId`/
`SourceType`/`SourceId` là cột SQL thật, xem `lib/operationWorkItemStore.js`), KHÔNG đổi `schema.sql`, không
thêm biến môi trường, không đổi `dependencies`. Công việc CŨ (chưa có `dependsOnWorkItemIds`) tự hiểu ngầm
là chưa liên kết gì — không bao giờ bị chặn, tương thích ngược hoàn toàn.

## Vận Hành > 🏬 Siêu Thị > Thực Hiện: "Ngày bắt đầu" + "Tần suất cập nhật tiến độ" (cảnh báo THỤ ĐỘNG quá hạn cập nhật, không cron job) (2026-09-07)

**Yêu cầu người dùng (nguyên văn)**: "Phần thực hiện công việc khi tạo thêm ngày bắt đầu, có thể đặt tần
suất yêu cầu thời gian cập nhật tiến đố (tần suất setup theo ngày và theo đầu mục công việc con hoặc công
việc lớn mà không có công việc con bên trong)".

**Thiết kế đã triển khai** (item thứ 4/7 trong loạt việc Vận Hành > Siêu Thị đang làm — KHÁC hẳn VHST-6
sẽ làm sau, VHST-6 là "quá hạn deadline/hoàn thành" cho tab Báo Cáo, còn task này CHỈ là "quá hạn cập
nhật tiến độ", tính-lúc-đọc, KHÔNG dựng cron job/job nhắc chủ động):
- Thêm 2 field mới, optional, trên mỗi `operationWorkItems` — **`startDate`** (ngày bắt đầu, `"YYYY-MM-DD"`)
  và **`progressUpdateFrequencyDays`** (số nguyên dương, số ngày giữa 2 lần cập nhật tiến độ) — **CHỈ áp
  dụng công việc LÁ** (không có việc con — đầu mục tổ chức có con thì server từ chối thẳng 400 nếu cố gán,
  qua `resolveOperationWorkItemScheduleFields()` mới, `lib/recordActions.js`, gọi từ cả
  `createOperationWorkItem()` lẫn `editOperationWorkItem()`). `editOperationWorkItem()` nhận thêm tham số
  `hasChildren` (route `POST /operationWorkItems/:id/edit` tự đối chiếu `parentWorkItemId` toàn bộ work
  item cùng nguồn) — nếu item VỪA có thêm con (không còn là lá) mà không gửi lại 2 field này thì tự động
  DỌN SẠCH về `null`, không cần nhánh dọn dẹp riêng.
- **Cảnh báo "quá hạn cập nhật tiến độ"** — hàm thuần `computeOperationWorkItemProgressUpdateOverdueDays(item, hasChildren)`
  (2 bản mirror độc lập: `lib/recordActions.js` server-side + `public/js/module-vanhanh.js` client-side,
  cùng khuôn `computeOperationWorkItemExpectedAcceptanceDate()` có sẵn) — TÁI SỬ DỤNG đúng dữ liệu
  "📜 Lịch Sử" (`item.history`, action `STATUS_*` do `updateOperationWorkItemProgress()` ghi mỗi lần bấm
  "🔄 Cập Nhật Tiến Độ"/"✅ Hoàn Thành"), KHÔNG dựng bảng/field lưu vết mới:
  - Không cảnh báo nếu: có việc con, đã "Đã nghiệm thu" (`DA_NGHIEM_THU`), chưa cấu hình `startDate`/
    `progressUpdateFrequencyDays`, hoặc `startDate` còn ở TƯƠNG LAI (chưa tới ngày bắt đầu).
  - Ngược lại: lấy mốc = lần cập nhật tiến độ GẦN NHẤT trong `history` (action `STATUS_*`), hoặc `startDate`
    nếu CHƯA TỪNG cập nhật lần nào — số ngày trôi qua từ mốc đó tới hôm nay ≥ `progressUpdateFrequencyDays`
    thì "quá hạn", hiện badge đỏ "⚠️ Quá hạn cập nhật tiến độ — X ngày" ngay dưới tên công việc (dùng chung
    1 chỗ `nameCell` trong `buildOperationWorkItemRow()` nên tự động hiện ở CẢ 2 tab Thực Hiện lẫn Nghiệm
    Thu, không cần lặp code).
  - Ví dụ đã test: `startDate` 10 ngày trước, `progressUpdateFrequencyDays=3`, CHƯA từng cập nhật tiến độ
    (chỉ có entry `CREATED`) → quá hạn ~10 ngày (tính từ `startDate`). `startDate` 30 ngày trước nhưng lần
    cập nhật GẦN NHẤT chỉ 8 ngày trước, `progressUpdateFrequencyDays=3` → quá hạn ~8 ngày (tính từ lần cập
    nhật gần nhất, KHÔNG phải `startDate`).
- **UI**: modal Thêm/Sửa Công Việc (`operationWorkItemFormModal`, `public/index.html`) thêm 2 ô "Ngày Bắt
  Đầu" (`owiStartDate`) + "Tần Suất Cập Nhật Tiến Độ (số ngày)" (`owiProgressUpdateFrequencyDays`, kèm ghi
  chú giải thích cơ chế cảnh báo) trong `#owiScheduleFieldWrap` — TẠO MỚI luôn hiện (công việc vừa tạo
  chưa thể có con); SỬA thì ẨN + hiện ghi chú thay thế (`#owiScheduleFieldNote`) nếu công việc ĐANG có con
  (`openOperationWorkItemFormModal()` tự đối chiếu `DB.operationWorkItems`, mirror đúng luật server).

**Đã sửa**:
- `lib/recordActions.js` — thêm `parseISODateOnly()`, `resolveOperationWorkItemScheduleFields()`,
  `computeOperationWorkItemProgressUpdateOverdueDays()`; tích hợp vào `createOperationWorkItem()`
  (`hasChildren` luôn `false`) và `editOperationWorkItem()` (nhận thêm tham số `hasChildren`); export cả 2
  hàm mới cho test.
- `routes/records.js` — `POST /operationWorkItems/:id/edit` tự tính `hasChildren` (đối chiếu
  `getWorkItemsBySource()`) trước khi gọi `editOperationWorkItem()`.
- `public/js/module-vanhanh.js` — thêm bản mirror client-side `parseISODateOnly()`/
  `computeOperationWorkItemProgressUpdateOverdueDays()`; `buildOperationWorkItemRow()` hiện badge quá hạn
  ở `nameCell` dùng chung; `openOperationWorkItemFormModal()`/`submitOperationWorkItemForm()` đọc/ghi 2
  field mới, ẩn/hiện ô theo `hasChildren` của item đang sửa.
- `public/index.html` — thêm `#owiScheduleFieldWrap` (2 input `owiStartDate`/`owiProgressUpdateFrequencyDays`
  + ghi chú) và `#owiScheduleFieldNote` trong modal `operationWorkItemFormModal`.

**Kiểm thử**: file mới `tests/test-operation-workitem-progress-frequency.js` (20 kịch bản THUẦN, không cần
Playwright/SQL Server — `resolveOperationWorkItemScheduleFields()`/tích hợp create-edit/5 kịch bản tính
quá hạn theo đúng yêu cầu: chưa từng cập nhật + quá hạn, vừa cập nhật (chưa quá hạn), cập nhật đã lâu (quá
hạn), không cấu hình frequency (không bao giờ cảnh báo), `startDate` tương lai (không bao giờ cảnh báo)) —
20/20 pass. Mở rộng `tests/test-operation-store-lifecycle.js` thêm 5 kịch bản tích hợp qua route/UI thật
(tạo việc lá với 2 field mới, sửa việc CÓ CON bị 400, badge hiện/biến mất đúng qua UI thật, ẩn/hiện ô form
đúng theo `hasChildren`) — cũng sửa `tests/testHarness.js` (mock route `operationWorkItems:edit` thiếu
tham số `hasChildren`, mirror đúng route thật). Chạy toàn bộ `tests/test-*.js` (70 file, 68 file 100% pass)
— 0 lỗi mới so với baseline, chỉ còn đúng 3 kịch bản lỗi phụ thuộc SQL Server thật đã biết từ trước (2 file:
`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js`).

**Deploy-impact**: KHÔNG có gì ngoài copy code + `pm2 restart` — `startDate`/`progressUpdateFrequencyDays`
chỉ là 2 field JSON thêm vào `Payload` (`dbo.OperationWorkItems`, vốn đã là JSON tự do — CHỈ `Status`/
`ParentWorkItemId`/`SourceType`/`SourceId` là cột SQL thật, xem `lib/operationWorkItemStore.js`), KHÔNG đổi
`schema.sql`, không thêm biến môi trường, không đổi `dependencies`. Không có cron job/job nhắc mới (đúng
quyết định thiết kế đã chốt) — cảnh báo hoàn toàn tính-lúc-render ở client, không có tác vụ nền nào chạy
thêm trên server. Công việc CŨ (chưa có `startDate`/`progressUpdateFrequencyDays`) tự hiểu ngầm là chưa
cấu hình — không bao giờ hiện badge cảnh báo, tương thích ngược hoàn toàn.

## Vận Hành > 🏬 Siêu Thị: Danh Mục Đầu Tư 2 cấp (danh mục lớn + danh mục con, tiền tự roll-up) (2026-09-07)

**Yêu cầu người dùng (nguyên văn)**: "Yêu cầu trong phần danh mục đầu tư có thể tạo được nhiều danh mục
con trong một danh mục lớn và tiền sẽ tổng cộng tại danh mục lớn để tính tổng tiền danh mục đầu tư." Đã
xác nhận với người dùng: **chỉ hỗ trợ đúng 2 cấp** (danh mục lớn + danh mục con), không lồng sâu hơn.

**Thiết kế đã triển khai**: thêm field `parentId` (optional) trên mỗi hạng mục `estimateItems[]` (bảng
Danh Mục Đầu Tư của hồ sơ Mở Mới/Sửa Chữa) — trỏ tới `id` 1 hạng mục KHÁC trong CÙNG mảng:
- `parentId` rỗng/null = **danh mục lớn** (gốc).
- `parentId` = id 1 danh mục lớn khác = **danh mục con** của danh mục đó.
- **Chỉ 2 cấp**: 1 danh mục con KHÔNG được làm cha của hạng mục khác — chặn ở server
  (`submitOperationEstimate()`, throw 400 rõ ràng) VÀ ở UI (dropdown chọn cha khi thêm dòng mới chỉ liệt
  kê danh mục LỚN hiện có, không cho chọn danh mục con làm cha).
- **Roll-up**: danh mục lớn có ≥1 con thì `amount` CỦA CHÍNH NÓ **luôn tự tính = tổng amount các con**,
  GHI ĐÈ mọi giá trị client gửi cho chính nó (input Chi Phí bị khoá/ẩn ở UI khi đã có con, hiện thay bằng
  số roll-up kèm ghi chú "🔢 Tự động tính từ N danh mục con"). Danh mục lớn KHÔNG có con nào thì hành vi
  **y hệt trước đây** — `amount` nhập tay trực tiếp, không đổi gì.
- **Tổng `estimateTotalAmount`** = CHỈ cộng các danh mục LỚN (`parentId` rỗng) — con đã nằm trong roll-up
  của cha, KHÔNG cộng thêm lần 2 (tránh tính đúp). Ví dụ đã test: danh mục lớn "Nội thất" có 2 con "Kệ
  trưng bày" 20tr + "Quầy thu ngân" 15tr (roll-up "Nội thất" = 35tr) + danh mục lớn "Sơn tường" không con
  5tr → tổng = 35tr + 5tr = **40tr** (không phải 70tr nếu cộng đúp con).
- **Xoá cha có con — quyết định CASCADE** (xoá cha kéo theo xoá luôn con), mirror ĐÚNG quy ước đã có sẵn
  của cây Công việc (`deleteOperationWorkItem()` trả `[item.id, ...descendantIds]` — xoá cha xoá cả cây
  con), chọn cascade thay vì chặn xoá để nhất quán 1 quy ước xuyên suốt module Vận Hành > Siêu Thị.
  `removeOperationEstimateItemRow()` (client) cascade xoá con cùng lúc xoá cha; server (`submitOperationEstimate()`)
  còn có thêm lớp phòng thủ: nếu con gửi lên với `parentId` trỏ tới 1 cha KHÔNG còn trong lần lưu (đã bị
  xoá cascade phía client) thì con đó bị BỎ HẲN, không lỗi, không âm thầm thăng thành danh mục lớn.
- Danh Mục Đầu Tư (`estimateItems[]`) và cây Công việc Thực hiện (`operationWorkItems`) VẪN là 2 khái niệm
  ĐỘC LẬP như trước — task này chỉ thêm cấu trúc cha/con NỘI BỘ trong `estimateItems[]`, không đụng gì tới
  liên kết 2 khái niệm đó (giữ nguyên quyết định thiết kế cũ, xem `routes/records.js`).

**Đã sửa**:
- `lib/recordActions.js` — viết lại `submitOperationEstimate()`: thêm bước resolve `parentId` qua `idMap`
  (id client gửi — có thể là id thật giữ nguyên hoặc id TẠM số âm client tự gán cho dòng mới thêm trong
  CÙNG lần lưu — map sang id THẬT server sinh), validate chặn lồng >1 cấp + tự tham chiếu chính mình, cascade
  bỏ con mồ côi (cha đã bị xoá cùng lần lưu), roll-up `amount` danh mục lớn có con, tổng `estimateTotalAmount`
  chỉ cộng danh mục lớn.
- `public/js/module-vanhanh.js` — `operationEstimateItems[]` mỗi dòng nay LUÔN có `id` ngay từ lúc thêm
  (id TẠM số âm cho dòng mới, xem `nextEstimateTempId()`) + field `parentId`; thêm
  `operationEstimateEffectiveAmount()` (mirror CHÍNH XÁC roll-up server), `populateEstimateNewItemParentSelect()`
  (dropdown chọn cha), `renderOperationEstimateItemRow()` (dùng LẠI đúng quy ước thụt lề/tree-line
  `↳` của `buildOperationWorkItemRow()` — cây Công việc — cho nhất quán hiển thị); `removeOperationEstimateItemRow()`
  cascade xoá con; `recalcOperationEstimateItemsTotal()`/`exportOperationEstimateItems()` đổi sang tính
  theo `operationEstimateEffectiveAmount()` + chỉ cộng danh mục lớn. Dọn 1 chú thích cũ trỏ tới hàm
  `syncOperationEstimateWorkItems()` không có thật trong code (sai sót từ trước, không liên quan thay đổi
  này).
- `public/index.html` — thêm `<select id="selEstimateNewItemParent">` (dropdown "đây là danh mục lớn mới"
  / "đây là danh mục con của...") cạnh nút "➕ Thêm Hạng Mục" trong modal Danh Mục Đầu Tư.

**Kiểm thử**: `tests/test-operation-danhmuc-dautu-units.js` thêm 7 kịch bản mới (Mục 6): roll-up 2 con,
parentId map đúng id thật, danh mục lớn không con không đổi hành vi, tổng không cộng đúp, chặn lồng >1
cấp (400), chặn tự tham chiếu chính mình (400), cascade bỏ con mồ côi khi cha bị xoá cùng lần lưu — 49/49
kịch bản pass (42 cũ + 7 mới). Chạy toàn bộ `tests/test-*.js` (69 file) — 0 lỗi mới so với baseline (chỉ
còn đúng các lỗi phụ thuộc SQL Server thật đã biết từ trước).

**Deploy-impact**: KHÔNG có gì ngoài copy code + `pm2 restart` — `parentId` chỉ là 1 field JSON thêm vào
bên trong `estimateItems[]` (vốn đã là JSON tự do trên bản ghi `operationStoreOpenings`/`operationRepairs`,
không có cột riêng trong `schema.sql`), không đổi `schema.sql`, không thêm biến môi trường, không đổi
`dependencies`. Hồ sơ CŨ (chưa có `parentId` trên hạng mục nào) tự hiểu ngầm là toàn bộ danh mục lớn —
tương thích ngược hoàn toàn, không cần migration dữ liệu.

## Vận Hành > 🏬 Siêu Thị: Overhaul quyền quản lý hồ sơ Mở Mới/Sửa Chữa (2026-09-07)

**Yêu cầu người dùng (nguyên văn)**: "Chỉ người quản lý dự án, người tạo hồ sơ mới được phép tạo, sửa
đầu mục công việc lớn, đầu mục công việc con, người thực hiện và người nghiệm thu chỉ thực hiện thao tác
cập nhật công việc, nghiệm thu công việc, không thể chỉnh sửa, thêm bớt công việc... chỉ cần quyền quản
lý mở mới, quản lý sửa chữa, ai có hai quyền này thì toàn quyền xử lý trên hồ sơ do mình thực hiện tạo mở
mới hoặc sửa chữa, còn những người khác chỉ có quyền thực hiện thao tác. Thêm một quyền quản lý hồ sơ
siêu thị sẽ có quyền cập nhật tất cả thông tin kể cả không phải hồ sơ do mình tạo ra."

**Luật MỚI đã triển khai** (áp dụng cho `operationStoreOpenings`/`operationRepairs`/
`operationWorkItems`/`operationExecutionPeriods`):
1. `operationStoreOpenCreate`/`operationRepairCreate` (2 quyền CŨ, GIỮ TÊN) — MỞ RỘNG ý nghĩa: người giữ
   quyền này (hoặc `admin`) nay có **toàn quyền quản lý** (tạo/sửa/xoá công việc mọi cấp, quản lý Danh
   Mục Đầu Tư, Bắt Đầu Kỳ Thực Hiện, Xác Nhận Đưa Vào Sử Dụng) — nhưng **CHỈ trên hồ sơ do CHÍNH mình
   tạo** (`sourceRecord.creator === user.username`).
2. `operationRecordManageAll` (quyền MỚI hoàn toàn) — toàn quyền như trên nhưng trên **MỌI** hồ sơ, không
   phân biệt người tạo.
3. **Rút gọn** 4 quyền tách riêng cũ `operationEstimateCreate`/`operationExecutionManage`/
   `operationAcceptanceManage`/`operationUseConfirm` — không còn là checkbox admin gán riêng được nữa,
   logic gate của cả 4 gộp vào luật 1+2 ở trên qua 1 hàm DUY NHẤT `canManageOperationRecord()`
   (`lib/createValidation.js`).
4. **Rút gọn vai trò cấp quyền của `personInCharge`** — trước đây "Người Phụ Trách" hồ sơ tự động có
   quyền SỬA công việc dù không giữ quyền quản lý nào; nay KHÔNG còn nữa, đúng "còn những người khác chỉ
   có quyền thực hiện thao tác". Field `personInCharge`/`personInChargeName` VẪN giữ nguyên trên dữ liệu
   (chỉ còn ý nghĩa hiển thị/thông tin — vẫn dùng ở form + hiển thị chi tiết hồ sơ, KHÔNG xoá khỏi model).
5. **KHÔNG đổi** cơ chế người thực hiện (`assignedTo[]`)/người nghiệm thu chỉ định (`acceptorUsername`) —
   vẫn tự cập nhật/nghiệm thu ĐÚNG việc của mình như cũ. Duy nhất thay đổi: "toàn quyền override" (trước
   đây `admin`/`operationExecutionManage`/`operationAcceptanceManage`) nay là `admin`/
   `operationRecordManageAll`/creator-scoped (luật 1) — người quản lý hồ sơ (creator hoặc
   `operationRecordManageAll`) giờ CŨNG cập nhật/nghiệm thu được trên hồ sơ của mình, ngoài đúng người
   được gán/chỉ định.

**Đã sửa**:
- `lib/createValidation.js` — thêm `canManageOperationRecord(user, sourceRecord, sourceType)` (helper
  DUY NHẤT, export dùng chung), sửa gate tạo `operationExecutionPeriods` (trước dùng
  `operationExecutionManage`, nay dùng helper trên).
- `lib/recordActions.js` — `submitOperationEstimate()`/`resetOperationEstimateToDraft()`/
  `createOperationWorkItem()`/`deleteOperationWorkItem()`/`startOperationExecutionPeriod()`/
  `editOperationWorkItem()`/`confirmOperationUse()` đều gate qua helper trên (nhận thêm tham số
  `sourceType`/`sourceRecord` tường minh khi cần); `updateOperationWorkItemProgress()`/
  `acceptOperationWorkItem()` nhận thêm `sourceRecord` CHỈ cho nhánh override, KHÔNG đổi nhánh chính
  `assignedTo[]`/`acceptorUsername`. Xoá 3 hàm assert tách rời cũ
  (`assertCanManageOperationExecution`/`assertCanManageOperationAcceptance`/
  `assertCanManageOperationWorkItem`), thay bằng `assertCanManageOperationRecord()`.
- `routes/records.js` — mọi route liên quan tự tra/truyền `sourceType`/`sourceRecord` tường minh (thêm
  helper `getOperationWorkItemSourceRecord()` dùng chung cho progress/edit/accept/delete); route tạo
  công việc bỏ field tạm `sourceRecord.__workItemSourceType` (rủi ro rò rỉ vào bản ghi lưu DB), dùng
  tham số `sourceType` tường minh thay thế.
- `routes/operationImport.js` — 4 gate tải mẫu/đọc preview Excel (Danh Mục Đầu Tư/Danh Sách Công Việc)
  đổi sang "giữ BẤT KỲ quyền quản lý hồ sơ nào" (`admin`/`operationRecordManageAll`/
  `operationStoreOpenCreate`/`operationRepairCreate`) — route ghi thật (`submitOperationEstimate()`/
  `createOperationWorkItem()`) vẫn tự đối chiếu lại đúng creator, đây chỉ là lớp chặn sơ bộ.
- `public/index.html` — cây phân quyền admin: xoá 4 checkbox `pOperationEstimateCreate`/
  `pOperationExecutionManage`/`pOperationAcceptanceManage`/`pOperationUseConfirm`; thêm checkbox
  `pOperationRecordManageAll` ("🏬 Quản Lý Hồ Sơ Siêu Thị (Toàn Quyền — Không Phân Biệt Người Tạo)"); đổi
  nhãn 2 checkbox `pOperationStoreOpenCreate`/`pOperationRepairCreate` thêm hậu tố "(+ Toàn Quyền Trên Hồ
  Sơ Của Mình)".
- `public/js/module-admin-permtree.js` — `collectPermsFromForm()`/`populatePermsForm()` đổi theo đúng 4
  checkbox xoá + 1 checkbox mới ở trên.
- `public/js/module-admin-userstaging.js` — bỏ đọc 4 checkbox cũ, đọc thêm `pOperationRecordManageAll`
  lúc `resetUserForm()`.
- `public/js/core.js` — `canAccessOperationModule()`/`canAccessOperationSubTab()` đổi gate theo luật mới
  (thêm helper `hasAnyOperationRecordManagePermClient()` cho gate CẤP TAB, chưa biết hồ sơ cụ thể).
- `public/js/module-vanhanh.js` — thêm `canManageOperationRecordClient(user, kind, sourceRecord)` (mirror
  client của `canManageOperationRecord()`), thay TOÀN BỘ các gate nút bấm cũ (estimate/execution/
  acceptance/use-confirm tách rời + nhánh `personInCharge` sửa việc) bằng gate DUY NHẤT này.

**Migration — KHÔNG tự động cấp `operationRecordManageAll`**: bất kỳ tài khoản nào hiện đang giữ CHỈ 1
trong 4 quyền đã rút gọn (`operationEstimateCreate`/`operationExecutionManage`/`operationAcceptanceManage`/
`operationUseConfirm` = `true`) mà KHÔNG có `operationStoreOpenCreate`/`operationRepairCreate`/`admin` sẽ
MẤT quyền quản lý trên hồ sơ không phải do mình tạo ngay khi deploy bản này — đây là siết chặt CHỦ Ý theo
đúng yêu cầu người dùng, KHÔNG viết migration tự động cấp bù `operationRecordManageAll` (sẽ vô hiệu hoá
mục đích siết chặt). Admin cần tự rà soát ai đang giữ các quyền cũ này (qua màn "Người Dùng" → cây phân
quyền, hoặc trực tiếp trong dữ liệu `users` đã lưu — 4 field cũ vẫn còn trong dữ liệu JSON đã lưu, chỉ
không còn hiệu lực gate nào) và cấp `operationRecordManageAll` thủ công cho người thực sự cần quyền quản
lý xuyên hồ sơ sau khi deploy.

**Kiểm thử**: `tests/test-operation-store-lifecycle.js` viết lại "Phần A" (personInCharge nay bị 403 thay
vì thành công) + thêm "Phần D" (ma trận đầy đủ: creator tự quản lý được hồ sơ mình tạo, 403 trên hồ sơ
người khác tạo dù giữ cùng quyền tạo, `operationRecordManageAll` toàn quyền mọi hồ sơ, `admin` luôn toàn
quyền, override cập nhật tiến độ/nghiệm thu cho creator/manageAll, KHÔNG đổi nhánh `assignedTo[]`/
`acceptorUsername`) — 85/85 kịch bản pass. `tests/testHarness.js` (mock route dùng chung nhiều bài test)
cập nhật theo đúng chữ ký hàm mới. `tests/test-operation-danhmuc-dautu-units.js`/
`tests/test-audit-dot5-phase2.js` cập nhật user giả lập theo quyền mới. Chạy toàn bộ `tests/test-*.js`
(69 file) — 0 lỗi mới so với baseline (chỉ còn đúng các lỗi phụ thuộc SQL Server thật đã biết từ trước).

**Deploy-impact**: KHÔNG có gì ngoài copy code + `pm2 restart` — không đổi `schema.sql`, không thêm biến
môi trường, không đổi `dependencies`. **CẦN làm thêm 1 việc thủ công sau deploy**: rà soát tài khoản đang
giữ 4 quyền cũ đã rút gọn (xem mục Migration ở trên) và cấp `operationRecordManageAll` cho người cần
quyền quản lý xuyên hồ sơ.

## Vận Hành > Siêu Thị (Mở Mới/Sửa Chữa): gỡ bỏ hẳn field "Chi Phí Phê Duyệt" (2026-09-07)

**Yêu cầu người dùng**: form lập hồ sơ Mở Mới và Sửa Chữa siêu thị đang có 2 field ngân sách song song
gây nhầm lẫn — "Chi Phí Phê Duyệt (VNĐ)" (tuỳ chọn, thật ra không dùng cho tính toán gì trong hệ thống)
và "Ngân Sách Phê Duyệt — Danh Mục Đầu Tư (VNĐ)" (bắt buộc, dùng để tính "Ngân sách còn lại" ở Danh mục
đầu tư). Yêu cầu **gỡ bỏ hẳn** field "Chi Phí Phê Duyệt", chỉ giữ lại "Ngân Sách Phê Duyệt".

**Đã rà soát TOÀN BỘ codebase trước khi xoá** (client + server) để xác nhận không còn nơi nào khác đọc/
hiển thị/tính tổng 2 field cũ (`operationStoreOpenings.estimatedBudget`, `operationRepairs.amount`) —
phát hiện ngoài 2 input form còn có: cột hiển thị ở bảng danh sách Mở Mới/Sửa Chữa, dòng hiển thị ở modal
xem chi tiết, và khai báo field trong `CORE_FIELD_MANIFEST` (màn admin "Biểu Mẫu" tuỳ biến nhãn/bắt buộc
theo field) — xử lý đồng bộ cả 4 điểm, không để sót tham chiếu treo (dangling reference) nào.

**Đã sửa**:
- `lib/createValidation.js` — bỏ 2 dòng gán `payload.estimatedBudget`/`payload.amount` khỏi
  `extraValidate` của `operationStoreOpenings`/`operationRepairs` (field không còn được server chủ động
  ghi vào hồ sơ mới nữa; `payload.approvedBudget` — bắt buộc nhập, validate không đổi — vẫn là field
  DUY NHẤT cho ngân sách của 2 loại hồ sơ này).
- `public/index.html` — gỡ hẳn 2 `<input>`+`<label>` "Chi Phí Phê Duyệt (VNĐ)" (`#vsoBudget`,
  `#vrAmount`) khỏi form Mở Mới/Sửa Chữa; đổi tiêu đề cột bảng danh sách từ "Chi Phí Phê Duyệt (& Ngày
  Khai Trương)" sang "Ngân Sách Phê Duyệt (& Ngày Khai Trương)".
- `public/js/module-vanhanh.js` — bỏ đọc `#vsoBudget`/`#vrAmount` lúc submit form; cột hiển thị ở bảng
  danh sách + dòng hiển thị ở modal chi tiết đổi từ đọc `estimatedBudget`/`amount` sang đọc
  `approvedBudget` (field còn lại duy nhất), theo đúng khuôn "(chưa nhập)" cho hồ sơ cũ thiếu
  `approvedBudget` đã dùng ở bảng Danh mục đầu tư.
- `public/js/core.js` — bỏ 2 dòng khai `vsoBudget`/`vrAmount` khỏi `CORE_FIELD_MANIFEST` (màn admin
  Biểu Mẫu không còn liệt kê field đã bị xoá khỏi form thật nữa).

**Không di trú dữ liệu cũ**: đúng kỷ luật additive/non-destructive đã dùng xuyên suốt — hồ sơ CŨ đã lỡ
lưu `estimatedBudget`/`amount` trước đợt này GIỮ NGUYÊN trong bản ghi (không xoá field khỏi dữ liệu đã
lưu), chỉ đơn giản không còn nơi nào trong code ghi/đọc/hiển thị field đó nữa.

**Kiểm thử**: cập nhật `tests/test-operation-danhmuc-dautu-units.js` (2 test `extraValidate` xác nhận
`approvedBudget` vẫn bắt buộc/validate đúng, field cũ dù client lỡ gửi lên cũng không còn được server chủ
động ghi) + `tests/test-operation-store-lifecycle.js` (bỏ `estimatedBudget`/`amount` khỏi các payload tạo
hồ sơ mô phỏng form thật, viết lại 1 test đã lỗi thời do dựa vào 2 field độc lập). Chạy toàn bộ
`tests/test-*.js` (69 file) — 0 lỗi mới so với baseline (chỉ còn đúng các lỗi phụ thuộc SQL Server thật
đã biết từ trước, không chạy được trong môi trường CI/sandbox).

**Deploy-impact**: KHÔNG có gì ngoài copy code + `pm2 restart` — không đổi `schema.sql` (field vốn chỉ
nằm trong payload JSON của bản ghi, không phải cột SQL riêng), không thêm biến môi trường, không đổi
`dependencies`.

## Vận Hành > Đặt Hàng Tại HO: đồng bộ biên giới 2 mức duyệt theo quy ước vừa sửa ở STORE (2026-09-07)

**Yêu cầu gốc**: sau đợt audit/sửa "Đặt Hàng Tại Siêu Thị" (v11.0, xem mục ngay dưới đây), người dùng yêu
cầu "bạn kiểm tra module đặt hàng HO luôn nhé".

**Đã kiểm tra trạng thái hiện tại trước khi sửa** — đọc trực tiếp `computeOperationOrderTier()` ở
`lib/workflowEngine.js`:
- **Phát hiện 1 lỗi thật**: `OPERATION_ORDER_HO_TIERS` vẫn dùng quy ước cũ `maxExclusive` + so sánh `<`
  (mốc đúng bằng rơi vào mức CAO HƠN) — ĐÚNG CÙNG 1 lớp lỗi quy ước biên giới vừa xác nhận sai và sửa ở
  STORE (v11.0): đơn HO đúng bằng 100.000.000đ trước đây bị đẩy lên mức `GTE100M` (`>= 100 triệu`) thay vì
  ở lại mức thấp hơn `LT100M`. Đây KHÔNG phải quyết định giá trị nghiệp vụ mới (mốc 100 triệu KHÔNG đổi,
  vẫn đúng 2 mức) — chỉ là cùng 1 bug quy ước inclusive/exclusive vừa fix ở module song song.
- Đã xác nhận LẠI mọi điểm khác đều ĐÚNG, không có lỗi: `computeOperationOrderAmount() = MAX(amount,
  paymentTotalAmount)` áp dụng đồng nhất cho cả STORE/HO (dùng chung 1 hàm, không có nhánh riêng theo
  `orderLocationType`); "Tổng Giá Trị Thanh Toán (VNĐ)" là field lái mức duyệt cho cả 2; `status:'PENDING',
  currentStep:1, history:[]` gán cứng đồng nhất ở `lib/createValidation.js` (không có nhánh HO/STORE
  riêng); `canViewOperationOrder()` (`lib/recordViewScope.js`) tra `resolveWfConfig` dùng chung, không lệch
  cho HO. Không phát hiện lỗi HO-riêng nào khác ngoài quy ước biên giới nói trên.

**Đã sửa**: `OPERATION_ORDER_HO_TIERS` ở `lib/workflowEngine.js` (nguồn xác thực server) + bản mirror
`public/js/core.js` (hiển thị client) + label dropdown cấu hình admin ở `public/js/module-workflow.js`
(`WF_MODULE_CONFIG.OPERATION_ORDER_HO.fixedTiers`) đổi từ field `maxExclusive`/so sánh `<` sang
`maxInclusive`/so sánh `<=` — khớp 100% quy ước hiện dùng cho STORE (`computeOperationOrderTier()` gộp lại
dùng chung 1 nhánh code cho cả 2, không còn xử lý riêng):
- `LT100M`: **≤ 100.000.000đ** (trước: < 100.000.000đ)
- `GTE100M`: **> 100.000.000đ** (trước: >= 100.000.000đ)

**Không cần di trú dữ liệu**: cùng lý do đã nêu ở đợt STORE — tier không lưu field riêng trên bản ghi,
luôn tính lại từ `amount` hiện có; tier KEY (`LT100M`/`GTE100M`) không đổi tên nên cấu hình approver-theo-
mức admin đã lưu (`operationOrderHOTierWorkflows`) vẫn khớp nguyên.

**Kiểm thử**: mở rộng `tests/test-operation-order-location-tiers.js` (file vừa mở rộng cho đợt STORE) —
cập nhật lại các test biên giới HO cũ theo quy ước mới + thêm test mốc đúng bằng 100.000.000 (→ `LT100M`)/
100.000.001 (→ `GTE100M`) qua cả `computeOperationOrderTier()` trực tiếp lẫn qua `max(amount,
paymentTotalAmount)`, cùng 1 test tamper (`paymentTotalAmount` giả thấp sát mốc mới không né được tier
cao). 35/35 kịch bản PASS. Toàn bộ 69 file `tests/test-*.js`: 67 PASS, 2 FAIL — đúng 2 lỗi SQL Server
pre-existing (`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js`, môi trường sandbox không có
SQL Server thật), khớp baseline, không có regression mới.

**Deploy impact**: KHÔNG cần thao tác gì ngoài copy code + `pm2 restart` — không đổi `schema.sql`, không
thêm biến môi trường, không thêm dependency, không có migrate dữ liệu 1 lần nào.

## Vận Hành > Đặt Hàng Siêu Thị: đổi biên giới 3 mức duyệt theo yêu cầu người dùng (2026-09-07)

**Yêu cầu gốc**: "Bạn xem giúp mình chỗ đặt hàng siêu thị... 1. Quy trình thay đổi chút là 3 mức sẽ là
<=10tr, >10tr và <=100tr, >100tr... 2. Quy trình tự động áp dụng theo các bước kiểm tra với trường Tổng
giá trị thanh toán (VNĐ) để làm điều kiện ai là người phê duyệt".

**Đã kiểm tra trạng thái hiện tại trước khi sửa**:
- Đặt Hàng Tại Siêu Thị (`operationOrders`, `orderLocationType='STORE'`) **ĐÃ SẴN đúng 3 mức** — không
  phải thêm/bớt mức. Biên giới CŨ dùng quy ước "<" (mốc đúng bằng rơi vào mức CAO HƠN): `< 10 triệu` /
  `10 triệu - dưới 100 triệu` / `>= 100 triệu` — nghĩa là đúng 10.000.000đ hay đúng 100.000.000đ trước
  đây bị đẩy lên mức TRÊN, ngược với "≤" người dùng vừa yêu cầu.
- "Tổng Giá Trị Thanh Toán (VNĐ)" (input `voPaymentTotalAmount` → field `paymentTotalAmount`) **ĐÃ ĐÚNG
  là field lái mức duyệt từ trước** (qua `computeOperationOrderAmount() = MAX(amount, paymentTotalAmount)`
  ở `lib/workflowEngine.js`, vá tier-spoofing từ đợt trước) — phần 2 yêu cầu của người dùng là "xác nhận
  đúng", không phải lỗi cần sửa. Đã viết thêm 3 test dùng thẳng `applyWorkflowAction()` thật (không mock)
  đổi CHỈ field này qua từng mốc 10tr/100tr để xác nhận tập approver hợp lệ đổi theo đúng field đó.

**Đã sửa — CHỈ đổi biên giới STORE (không đụng HO, người dùng không yêu cầu)**: `OPERATION_ORDER_STORE_TIERS`
ở `lib/workflowEngine.js` (nguồn xác thực server) + bản mirror `public/js/core.js` (hiển thị client) + label
dropdown cấu hình admin ở `public/js/module-workflow.js` (`WF_MODULE_CONFIG.OPERATION_ORDER_STORE.fixedTiers`)
đổi từ field `maxExclusive`/so sánh `<` sang `maxInclusive`/so sánh `<=`:
- `LT10M`: **≤ 10.000.000đ** (trước: < 10.000.000đ)
- `FROM10M_TO100M`: **> 10.000.000đ và ≤ 100.000.000đ** (trước: 10tr - dưới 100tr)
- `GTE100M`: **> 100.000.000đ** (trước: >= 100.000.000đ)

Đặt Hàng Tại HO giữ nguyên 2 mức `< 100 triệu` / `>= 100 triệu` (KHÔNG đổi).

**Không cần di trú dữ liệu**: tier KHÔNG lưu thành field riêng trên bản ghi `operationOrders` — luôn được
server tự tính lại từ `amount`/`orderLocationType` hiện có mỗi lần cần tra quy trình. Tier KEY (`LT10M`/
`FROM10M_TO100M`/`GTE100M`) không đổi tên, nên cấu hình approver-theo-mức admin đã lưu trước đây ở
`operationOrderStoreTierWorkflows` vẫn khớp nguyên — chỉ đổi hồ sơ nào rơi vào key nào (đúng mốc 10tr/100tr).
Không có schema/AppData seed mới nào cần chạy.

**Kiểm thử**: mở rộng `tests/test-operation-order-location-tiers.js` — 33/33 kịch bản PASS (cập nhật lại 2
test biên giới cũ theo quy ước mới + thêm 9 test mới: 4 mốc chính xác qua `computeOperationOrderAmount()`
thật, 1 test tamper sát mốc mới, 3 test xác nhận "Tổng Giá Trị Thanh Toán (VNĐ)" đổi CHỈ 1 field này qua
`applyWorkflowAction()` thật đổi đúng tập approver). Toàn bộ 69 file `tests/test-*.js`: 67 PASS, 2 FAIL —
đúng 2 lỗi SQL Server pre-existing (`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js`, do môi
trường sandbox không có SQL Server thật, xác nhận khớp baseline qua `git stash`), không có regression mới.

**Deploy impact**: KHÔNG cần thao tác gì ngoài copy code + `pm2 restart` — không đổi `schema.sql`, không
thêm biến môi trường, không thêm dependency, không có migrate dữ liệu 1 lần nào (xem lý do "không cần di
trú dữ liệu" ở trên).

## Vận Hành > Siêu Thị > Nghiệm Thu: audit theo yêu cầu người dùng — 1 lỗi thật phát hiện + sửa (2026-09-07)

**Yêu cầu gốc**: "Bạn kiểm tra module Nghiệm thu trong siêu thị luôn nhé" — audit sub-tab Nghiệm Thu
(`operationWorkItems` mode ACCEPTANCE), cùng tinh thần vừa audit/sửa xong sub-tab Thực Hiện (v10.7,
commit `cb5e2b4`).

**Đã kiểm tra kỹ, xác nhận ĐÚNG thiết kế (không phải bug)**:
- **"🔄 Bổ Sung" đã LÀ đúng dạng "self-loop" cần có** — không cần mirror thêm transition tự lặp lại kiểu
  Task/Thực Hiện: `acceptOperationWorkItem()` (`lib/recordActions.js`) đã có 2 hành động độc lập —
  `ACCEPT` (chốt, đổi `DA_NGHIEM_THU`) và `REQUEST_INFO` (chỉ ghi lý do vào `history`, GIỮ NGUYÊN
  `DANG_NGHIEM_THU`, bấm được nhiều lần) — đúng bản chất "duyệt hồ sơ" (2 kết cục: đạt/chưa đạt), khác
  Thực Hiện là 1 tác vụ đang chạy dở cần ghi tiến độ liên tục. KHÔNG ép symmetry giả tạo với Thực Hiện.
- **Chặn 409 việc CÓ CON** (`acceptOperationWorkItem()`) đã có, khớp đúng `updateOperationWorkItemProgress()`
  — re-xác nhận qua test `test-operation-store-lifecycle.js` (test "Fix 1") vẫn PASS.
- Phân quyền (`operationAcceptanceManage`/`acceptorUsername`), bắt buộc lý do, chặn nghiệm thu 2 lần
  (status phải đúng `DANG_NGHIEM_THU`) — đều đã đúng, có test xác nhận từ trước.
- `lib/createValidation.js` KHÔNG có entry `operationWorkItems` (route custom hẳn, không qua khung
  validate chung) — state machine (`CHUA_BAT_DAU`/`DANG_THUC_HIEN`/`DANG_NGHIEM_THU`/`DA_NGHIEM_THU`)
  nhất quán giữa create/progress/accept/cascade, không có enum lệch ở đâu khác.
- Nghiệm Thu KHÔNG có luồng đính kèm minh chứng/tệp — đúng phạm vi tính năng hiện tại, không phải nửa
  vời/quên nối dây.

**1 lỗi THẬT phát hiện — đã sửa**: `item.history` của `operationWorkItems` (ghi chú "cập nhật tiến độ
liên tục" của Thực Hiện thêm ở v10.7 + lý do BẮT BUỘC nhập lúc "🔄 Bổ Sung"/"✅ Nghiệm Thu") được ghi vào
DB nhưng **KHÔNG CÓ MÀN NÀO đọc lại được** — khác hẳn module Công Việc (`module-congviec.js`, bảng lịch
sử trong `#taskDetailContent`) là bản mirror gốc của tính năng "cập nhật tiến độ liên tục". Hệ quả thực
tế: người nghiệm thu gõ lý do "🔄 Bổ Sung" (bắt buộc nhập) xong là **mất hẳn**, không ai — kể cả chính họ
— đọc lại được nữa; tương tự ghi chú tiến độ 30%/60%... của Thực Hiện. Tính năng "cập nhật tiến độ liên
tục" mới thêm ở v10.7 vì vậy gần như vô nghĩa nếu không có nơi xem lại.

**Đã sửa**: thêm nút "📜" ở MỌI dòng công việc (cả Thực Hiện lẫn Nghiệm Thu, mọi cấp) mở modal
`operationWorkItemHistoryModal` mới — bảng lịch sử đầy đủ (Hành động/Người thực hiện/Thời gian/Ghi chú),
mirror ĐÚNG khuôn bảng lịch sử của module Công Việc (`module-congviec.js` dòng ~924/~1142).
`public/js/module-vanhanh.js`: `openOperationWorkItemHistoryModal()`/`closeOperationWorkItemHistoryModal()`
+ nút trong `buildOperationWorkItemRow()` (cả 2 nhánh EXECUTION/ACCEPTANCE). `public/index.html`: modal
mới. Không đổi schema/API route nào — dữ liệu `history` đã có sẵn từ trước, chỉ thêm màn đọc lại.

Kiểm thử: thêm 2 kịch bản UI thật (Playwright) vào `test-operation-store-lifecycle.js` (73 -> 75 kịch
bản) — 1 xác nhận nút "📜" (ACCEPTANCE) hiện đúng REQUEST_INFO + lý do vừa ghi, 1 xác nhận nút "📜"
(EXECUTION) hiện đủ cả 2 dòng ghi chú tiến độ liên tục — 75/75 kịch bản file này PASS; chạy lại toàn bộ
69 file `test-*.js`,
không phát sinh lỗi mới so với baseline (`git stash`). Screenshot Playwright thật minh hoạ modal lịch sử
lưu ở `server/demo-screenshots/operation-acceptance-audit/` (gitignored, không gửi đi đâu — không có
yêu cầu demo).

## Hành Chính > Đồng Phục: gỡ bỏ hẳn sub-tab "Quản Lý Nhân Viên Siêu Thị" (2026-09-07)

**Yêu cầu gốc**: "Bạn kiểm tra và gỡ bỏ toàn bộ sub tab quản lý nhân viên siêu thị trong tab đồng phục
thuộc module hành chính nhé, gỡ và làm sạch ứng dụng nhé."

**Kiểm tra trước khi xoá (đúng quy trình đã dùng cho các lần gỡ bỏ tính năng trước)**: sub-tab
"🧑‍💼 Quản Lý Nhân Viên Siêu Thị" (`#uniformSubEmployees`, PR #185, đợt "Bảo mật tài khoản khoá +
Sửa/Import danh mục + Sub-tab Quản Lý Nhân Viên Siêu Thị") KHÔNG phải 1 roster nhẹ tách riêng — nó tạo/
khoá **tài khoản đăng nhập THẬT** (username/mật khẩu/permGroup) ghi thẳng vào `DB.users` (cùng bảng với
màn "Người Dùng" đầy đủ của Admin), qua route riêng `routes/uniformEmployees.js`
(`POST/PATCH /api/uniform/employees`, gate `uniformManage`/`admin`, luôn ép `posType:'STORE'` + re-
validate `permGroup.scope==='STORE'` phía server, không tin field `perms` từ client). Vì vậy đã kiểm tra
kỹ 2 điều trước khi xoá:
1. **Dropdown "Cấp Đồng Phục Cho Nhân Viên"** (`renderUniformIssueEmployeeOptions()`) đọc THẲNG
   `DB.users` lọc theo `dept`/`posType!=='HO'`/`active` — KHÔNG phụ thuộc riêng vào tài khoản được tạo
   qua sub-tab này, nên xoá sub-tab KHÔNG làm gãy luồng cấp phát đồng phục.
2. Đường thay thế để tạo tài khoản `posType:'STORE'` **đã có sẵn và không đổi**: màn "Người Dùng" đầy đủ
   của Admin (`Hệ Thống > Quản Trị`, `module-admin-userstaging.js`) đã hỗ trợ Vị Trí Siêu Thị/chức danh
   Siêu Thị từ trước, không đi qua route bị xoá. Tài khoản nhân viên siêu thị ĐÃ được tạo qua sub-tab
   trước đây (dữ liệu thật trong `DB.users`, nếu có) **hoàn toàn không bị đụng tới** — chỉ UI/route TẠO
   MỚI/KHOÁ qua đường tắt này bị gỡ, không xoá bản ghi nào.

Kết luận: an toàn để gỡ hẳn (không phải dữ liệu tài khoản thật bị mất, không có tính năng nào khác của
Đồng Phục phụ thuộc vào route/hàm riêng của sub-tab này).

**Đã gỡ**:
- `public/index.html`: nút chuyển sub-tab `btnUniformSubEmployees` + toàn bộ section
  `#uniformSubEmployees` (form "Tạo Tài Khoản Nhân Viên Siêu Thị" + bảng "Danh Sách Nhân Viên Siêu Thị").
- `public/js/module-dongphuc.js`: nhánh `EMPLOYEES` trong `setUniformSubTab()` + 5 hàm dùng riêng
  (`populateUniformEmployeeGroupOptions`/`resetUniformEmployeeCreateForm`/`submitUniformEmployeeCreate`/
  `renderUniformEmployeesList`/`lockUniformEmployeeAction`).
- `routes/uniformEmployees.js`: **xoá cả file** (2 route `POST /employees`, `PATCH /employees/:id/active`
  — không route nào khác dùng file này); gỡ mount `app.use('/api/uniform', ...)` khỏi `server.js`.
- **Dọn theo (làm sạch, đúng yêu cầu "gỡ và làm sạch")** — mọi phần scaffolding chỉ tồn tại để phục vụ
  RIÊNG sub-tab này, xác nhận không nơi nào khác đọc:
  - Cờ `restrictedFromSelfService` trên `DB.storeJobTitles[]` (checkbox "Khoá tự tạo" ở màn Quản Trị >
    Danh Mục) — gỡ checkbox + hàm `toggleStoreJobTitleRestricted()`/`...FromCheckbox()`
    (`module-admin.js`), giữ nguyên danh mục `storeJobTitles` (vẫn dùng cho field Chức Danh của user
    `posType==='STORE'` ở màn Người Dùng đầy đủ).
  - Field `scope` (`'STORE'`) trên Nhóm Phân Quyền — checkbox "🏪 Chỉ dùng cho Siêu Thị"
    (`#gGroupStoreScope`) + badge hiển thị trong bảng Nhóm Phân Quyền (`module-admin-permgroups.js`,
    `index.html`) — không nơi nào khác đọc field này sau khi sub-tab bị gỡ.
  - Seed mặc định `grp_store_default` (permGroups) trong `defaults.js` (đặt lại `permGroups: []`) +
    hàm migration `migrateDefaultStorePermGroup()` trong `seedDefaults.js` (chạy mỗi lần khởi động, seed
    nhóm này vào DB thật đang chạy production nếu chưa có) — gỡ hẳn cả seed lẫn migration; **DB thật nào
    đã từng chạy migration này trước đây vẫn giữ nguyên nhóm `grp_store_default` đã seed** (không xoá dữ
    liệu cũ), chỉ không seed thêm/mới nữa.
  - `MODULE_FN_GROUP` (`core.js`, bảng tra cứu lazy-load theo tên hàm cho `ensureFnReady()`) — gỡ 7 entry
    của các hàm vừa xoá.
  - Comment tham chiếu rải rác (`routes/data.js`, `lib/adminAuth.js`) cập nhật lại danh sách route dùng
    chung `isCurrentlyAdminOrUniformManage()` (route `uniformEmployees.js` không còn tồn tại).
- **`tests/test-catalog-rename-uniform-employees.js` → đổi tên thành
  `tests/test-catalog-rename-locked-accounts.js`** (nội dung còn lại chỉ còn 3/4 yêu cầu gốc — khoá tài
  khoản/pending-approval warning/rename danh mục — không còn liên quan gì tới Nhân Viên Siêu Thị nữa):
  gỡ toàn bộ nhóm kịch bản (4a)-(4c) (submitUniformEmployeeCreate/lockUniformEmployeeAction/
  renderUniformEmployeesList) + seed dữ liệu chỉ phục vụ nhóm đó (`store_emp1`/`store_emp2`,
  `DB.permGroups` scope STORE, `DB.storeJobTitles` có cờ `restrictedFromSelfService`). 20/20 kịch bản
  còn lại PASS.
- `tests/test-uniform.js`/`tests/test-uniform-phase2.js`: không có kịch bản nào test sub-tab bị xoá (2
  file này chỉ test Kỳ Cấp Phát/Xác Nhận-Cấp Phát/Kho/Tổng Quan/Điều Chuyển — không đụng tới) — chạy lại
  xác nhận vẫn PASS toàn bộ: 34/34 (`test-uniform.js`) + 20/20 (`test-uniform-phase2.js`), không cần sửa.

Xác minh: `node -c` sạch trên mọi file server đã sửa; kiểm tra div-balance/duplicate-id trên
`index.html` không đổi so với baseline (đúng 6 lệch sẵn có do quy ước đếm thô gặp chuỗi JS lồng trong
template, không phải lỗi mới). Demo Playwright thật (tái dùng khuôn `tests/testHarness.js` — không có SQL
Server thật trong sandbox lần này nên dùng lại đúng cơ chế static-serve + mock API dispatcher của bộ test,
KHÔNG phải demo qua DB thật): đăng nhập Hành Chính (uniformManage) — tab-strip Đồng Phục CHỈ còn 4 nút
(Kỳ Cấp Phát/Xác Nhận-Cấp Phát/Kho/Tổng Quan), không còn nút/section Nhân Viên Siêu Thị nào trong DOM;
đăng nhập Giám Đốc Siêu Thị — màn "Xác Nhận/Cấp Phát" (form Cấp Đồng Phục Cho Nhân Viên, bảng Đang Giữ,
Báo Hỏng/Hủy, Thu Hồi, Điều Chuyển Kho) vẫn render đầy đủ, không lỗi console mới — ảnh chụp lưu ở
`server/demo-screenshots/uniform-remove-employee-subtab/`. Chạy lại bộ hồi quy đầy đủ (`tests/test-*.js`)
— PASS toàn bộ trừ đúng 2 lỗi known-flaky quen thuộc không liên quan thay đổi này
(`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, timeout hạ tầng test).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql`, KHÔNG thêm/đổi biến môi trường, KHÔNG thêm/đổi
`dependencies` trong `package.json` — chỉ copy code + `pm2 restart`. Lưu ý 1 điểm khác thường: gỡ hẳn
`migrateDefaultStorePermGroup()` (chạy mỗi lần khởi động trước đây) nghĩa là **từ lần restart tới, DB thật
sẽ KHÔNG còn tự seed nhóm phân quyền "Nhân Viên Siêu Thị (Mặc Định)" nữa nếu chưa từng có** — DB nào ĐÃ
từng chạy migration này ở các lần khởi động trước (rất có thể — migration này đã tồn tại từ PR #189) thì
nhóm `grp_store_default` đã sẵn có trong DB đó và **không bị xoá**, chỉ đơn giản không còn checkbox/badge
"Chỉ dùng cho Siêu Thị" nào để xem/sửa field `scope` của nó nữa (nhóm vẫn hoạt động bình thường như 1
Nhóm Phân Quyền thường, thành viên nhóm hiện có — nếu có — không bị ảnh hưởng).

## Vận Hành > Siêu Thị > Thực Hiện: cập nhật tiến độ liên tục không ép đổi trạng thái + làm rõ trạng thái "đầu mục lớn" tự hoàn thành theo việc con (2026-09-07)

**Yêu cầu gốc**: "kiểm tra Thực hiện trong siêu thị, muốn cập nhật công việc liên tục cho đến khi hoàn
thành thì mới đổi trạng thái giống công việc trong module điều hành. Nếu đầu mục lớn mà có việc còn thì
sau khi tất cả cv con hoàn thành thì mục lớn mới hiện và ấn hoàn thành được, các mục khác ko đổi."

**Phần A (gap THẬT — đã sửa)**: modal "🔄 Cập Nhật Tiến Độ" của `operationWorkItems` (Vận Hành > 🏬 Siêu
Thị > Thực Hiện) khi đang `DANG_THUC_HIEN` trước đây CHỈ có ĐÚNG 1 lựa chọn duy nhất —
`DANG_NGHIEM_THU` ("Hoàn thành — Nộp nghiệm thu") — khác hẳn modal "Cập Nhật Tiến Độ" của module Công
Việc công ty (`#taskProgressModal`, `TASK_STATUS_TRANSITIONS.DOING = ['DOING', 'DONE']`) vốn cho phép
DOING tự lặp lại chính nó (chỉ ghi thêm ghi chú tiến độ, KHÔNG đổi trạng thái). Hệ quả: mỗi lần chỉ
muốn ghi 1 dòng tiến độ (VD "đã xong 30%") đều bị ép chọn luôn "hoàn thành", không có cách ghi tiến độ
mà giữ nguyên trạng thái — đúng gap người dùng mô tả. Đã sửa mirror ĐÚNG mẫu Task:
- `lib/recordActions.js` `updateOperationWorkItemProgress()`: `allowedNext.DANG_THUC_HIEN` nay là
  `['DANG_THUC_HIEN', 'DANG_NGHIEM_THU']` (trước chỉ `['DANG_NGHIEM_THU']`) — tự lặp lại chính nó hợp lệ.
- `public/js/module-vanhanh.js` `openOperationWorkItemProgressModal()`/`confirmOperationWorkItemProgress()`:
  dropdown ở `DANG_THUC_HIEN` nay có 2 lựa chọn — "Vẫn đang thực hiện (cập nhật ghi chú tiến độ)" (tự lặp
  lại, BẮT BUỘC ghi chú) và "Hoàn thành — Nộp nghiệm thu" (đổi hẳn trạng thái, không bắt buộc ghi chú) —
  người dùng CHỦ ĐỘNG chọn, gọi được nhiều lần liên tiếp không đổi trạng thái, chỉ đổi khi thực sự chọn
  Hoàn thành. Nút tắt "✅ Hoàn Thành" (ngoài modal) và `CHUA_BAT_DAU` (chỉ 1 lựa chọn "Bắt đầu thực
  hiện", không tự lặp — mirror TODO của Task) giữ nguyên không đổi.

**Phần B (đã ĐÚNG từ trước — không phải bug, chỉ làm rõ UI)**: kiểm tra kỹ `lib/recordActions.js`
(`updateOperationWorkItemProgress()`/`acceptOperationWorkItem()`) + `routes/records.js`
(`syncOperationWorkItemAncestors()`, đệ quy lên hết các cấp cha) xác nhận: 1 việc CÓ CON không bao giờ
được cập nhật/nghiệm thu BẰNG TAY (chặn 409 tuyệt đối, KHÔNG điều kiện theo trạng thái con) — trạng thái
việc cha LUÔN được tính lại và cập nhật TỰ ĐỘNG (`computeParentWorkItemStatus()`) ngay khi có con đổi
trạng thái, cascade đệ quy đúng qua mọi cấp (đã có test `test-operation-store-lifecycle.js` xác nhận
cascade 3 cấp hoạt động đúng từ trước). Vì vậy yêu cầu "sau khi tất cả cv con hoàn thành thì mục lớn mới
hiện hoàn thành" ĐÃ được thoả mãn — nhưng HOÀN TOÀN TỰ ĐỘNG (không cần/không thể bấm gì, đưa 1 nút bấm
"Hoàn Thành" cho việc cha sẽ mâu thuẫn với chặn 409 tuyệt đối này và gây lệch client/server). Cái THIẾU
chỉ là UI: dòng việc CHA (có con) trước đây LUÔN hiện đúng 1 câu "Tự cập nhật theo việc con" — kể cả khi
cha ĐÃ TỰ hoàn thành xong (dễ hiểu lầm "chưa xong gì"). Đã sửa `buildOperationWorkItemRow()` (cả
EXECUTION lẫn ACCEPTANCE mode, `module-vanhanh.js`) để phân biệt rõ 2 trạng thái: còn con dở → vẫn câu cũ;
TẤT CẢ con đã xong (cha tự cascade `DA_NGHIEM_THU`) → hiện rõ "✅ Đã tự động hoàn thành (theo việc con)"
— vẫn không có nút bấm nào (khớp đúng chặn 409 server).

Không đổi field/bảng SQL, không thêm API route mới — chỉ sửa logic hiển thị + nới đúng 1 transition tự
lặp lại ở `allowedNext`. Kiểm thử: mở rộng `test-operation-store-lifecycle.js` (thêm ~10 kịch bản: dropdown
2 lựa chọn + bắt buộc ghi chú + cập nhật liên tục 2 lần không đổi trạng thái + progress-only qua server
trực tiếp + UI hiện đúng "chưa hoàn thành"/"đã tự động hoàn thành" ở cả 2 chế độ), 73/73 kịch bản file này
PASS; chạy lại toàn bộ 69 file `test-*.js`, không phát sinh lỗi mới so với baseline.

## Trước đó — Tạo 2 file hướng dẫn sống `deploy/Huong-dan-nghiep-vu.md` + `deploy/Huong-dan-trien-khai.md`, dời `HUONG_DAN_DEPLOY_UBUNTU.md` (2026-09-07)

**Yêu cầu gốc**: theo quy ước mới ghi ở `CLAUDE.md` (2 file hướng dẫn sống trong `vpdt-pms/deploy/`,
cập nhật liên tục theo từng thay đổi nghiệp vụ/triển khai từ nay về sau) — tạo phiên bản ĐẦU TIÊN của cả
2 file.

**`deploy/Huong-dan-trien-khai.md`** (triển khai) — KHÔNG viết lại từ đầu: dời nguyên nội dung đã có sẵn
và chính xác ở `HUONG_DAN_DEPLOY_UBUNTU.md` (thư mục gốc, đã rà lại khớp đúng `ecosystem.config.js`/
`.env.example`/`server.js` hiện tại) sang vị trí mới, giữ nguyên đánh số mục 0-16, chỉ thêm 1 Mục Lục có
link neo + 1 mục "Xem thêm" trỏ chéo sang file nghiệp vụ ở cuối. `HUONG_DAN_DEPLOY_UBUNTU.md` ở thư mục
gốc đổi thành 1 trang trỏ ngắn (KHÔNG xoá hẳn) — nhiều comment code (`server.js`/`ecosystem.config.js`/
`routes/auth.js`/`routes/systemLog.js`/`scripts/copy-vendor-assets.js`/`lib/operationWorkItemStore.js`)
vẫn tham chiếu tên file này theo đúng số mục, dời hẳn sẽ làm các tham chiếu đó trỏ vào file không tồn tại
— KHÔNG sửa các file `.js` này (việc dời file/redirect đã đủ giữ đường dẫn hợp lệ, đây là đợt việc thuần
tài liệu). `README.md`/`CLAUDE.md` (2 file Markdown, không phải code) đã cập nhật trỏ sang đường dẫn mới.

**`deploy/Huong-dan-nghiep-vu.md`** (nghiệp vụ) — viết MỚI hoàn toàn, đọc code thật (`BUSINESS_MODULES`
ở `core.js`, header từng `module-*.js`, `WF_MODULE_CONFIG`, `lib/externalAuth.js`, `lib/positionApprovers.js`,
cây phân quyền ở `index.html`) thay vì suy đoán — 7 mục: Tổng quan; Mô hình quy trình phê duyệt chung
(3 cách gán người duyệt Theo người/Theo phòng ban/Theo vị trí — tính năng v10.5, quyền `canBeApprover`,
danh mục khối 17, Hộp Thư Phê Duyệt, 1 ví dụ cấu hình cụ thể + bảng tra lỗi thường gặp); Danh sách module
nghiệp vụ theo 8 nhóm (Văn Phòng Điện Tử/Truyền Thông & Nhân Sự/Tài Chính/Hành Chính/Vận Hành/Hỗ Trợ IT/
Báo Cáo Định Kỳ/Hệ Thống); Cấu hình Báo Cáo; API đối tác ngoài (ExtAuth, tóm tắt góc nhìn quản trị — có
ghi chú đã có 1 đặc tả API riêng đầy đủ hơn cho đối tác từ 1 phiên trước); Cấu hình Email (SMTP + 🔔
Thông Báo Email Phê Duyệt v10.2); Phân quyền (bảng 23 khối 0-22, `permGroups` overlay, quy trình cấp
quyền nhân viên mới).

Không đổi file `.js`/`.sql` nào (thuần tài liệu) — không cần thao tác gì thêm ngoài copy code + `pm2
restart` theo quy trình thường ở `deploy/Huong-dan-trien-khai.md` mục 16.

## Trước đó — "Vị Trí Tham Gia Quy Trình" + bước duyệt "Theo vị trí" (POSITION mode) cho quy trình phê duyệt (2026-09-07)

**Yêu cầu gốc**: thêm 1 danh mục MỚI ở khối 17 "Nhóm Quyền Đặc Biệt" (Hệ Thống → Quản Trị → Phân Quyền)
— "Vị Trí Tham Gia Quy Trình", mỗi mục là 1 CẶP (chức danh, phòng ban) admin tự dựng (vì `DB.jobTitles`
vốn generic/không phân biệt phòng ban — "Trưởng phòng" không tự phân biệt được "Trưởng phòng IT" với
"Trưởng phòng Nhân Sự"). Đồng thời nâng CẢ 3 danh mục khối 17 (2 danh mục cũ + danh mục mới) lên 1 ô
"chọn nhiều thật" DUY NHẤT (gõ tìm, bấm chọn, chip xoá được TRONG CÙNG 1 Ô) — thay khuôn cũ input+
datalist+nút "Thêm"+chip rời. Và ở TỪNG BƯỚC của quy trình phê duyệt theo phòng ban/tier (16 màn cấu
hình `WF_MODULE_CONFIG`), thêm 1 toggle "🧭 Theo vị trí" (mặc định TẮT, không đổi hành vi cấu hình cũ
nào) — bật lên thì bước đó chọn (các) vị trí thay vì chọn tay người duyệt cụ thể, hệ thống tự tra
NGƯỜI THẬT hiện giữ đúng vị trí đó **VÀ** có quyền "Người duyệt" (`canBeApprover`) mỗi lần cần duyệt.

**Điểm bảo mật cốt lõi** (đã chốt: *"nếu ko chọn 'Theo vị trí' thì vẫn mặc định chọn người phê duyệt
thông thường và lưu ý vẫn phải phân quyền người phê duyệt thì mới được duyệt"*): khớp đúng vị trí CHỈ
LÀ ĐIỀU KIỆN LỌC BỚT — không thay thế được quyền `canBeApprover`. Đây là điểm KHÁC với chế độ PEOPLE
(chọn tay) hiện có: PEOPLE mode không re-check `canBeApprover` tại thời điểm duyệt (hành vi CŨ, giữ
nguyên, ngoài phạm vi đợt này) — chế độ POSITION MỚI luôn tính lại động (hoặc tại thời điểm snapshot),
nên luôn phản ánh đúng `canBeApprover` hiện tại.

**Server** — điểm tra cứu TRUNG TÂM DUY NHẤT `resolveStepApproverUsernames()`/`resolvePositionApprovers()`
(file mới `lib/positionApprovers.js`, tách riêng để tránh vòng lặp require giữa `lib/workflowEngine.js`
và `lib/createValidation.js`) — cắm vào `flatWorkflowConfigToSteps()` (`lib/workflowEngine.js`, dùng bởi
12/16 `WF_MODULE_CONFIG` không snapshot: DOC/CAR/OFFICE_BUY/OFFICE_FIX/VPP/CONTRACT_MANAGE/ITPRICE/
BUDGET/OPERATION_ORDER_STORE/OPERATION_ORDER_HO/OPERATION_STORE_OPEN_ESTIMATE/OPERATION_REPAIR_ESTIMATE)
và vào `buildEffectiveSubmissionWorkflowServer()`/`buildEffectiveContractApprovalWorkflowServer()`
(`lib/createValidation.js`, 2 module SNAPSHOT effectiveApprovers ngay lúc TẠO — SUBMISSION/
CONTRACT_APPROVAL, resolve POSITION mode NGAY LÚC ĐÓ). **2 ngoại lệ đã xác nhận rõ bằng test**:
`OPERATION_STORE_OPEN`/`OPERATION_REPAIR` (operationStoreOpenDeptWorkflows/operationRepairDeptWorkflows)
KHÔNG còn `MODULE_CONFIGS` tương ứng nữa (phê duyệt 2 luồng "Siêu Thị" đã dừng hẳn từ 1 đợt trước — status
đi thẳng APPROVED lúc tạo) — "Theo vị trí" cấu hình được ở 2 màn admin đó nhưng không có đường duyệt
sống nào tiêu thụ, không phải lỗi của đợt này.

Dữ liệu: `defaults.js` thêm `workflowParticipatingPositions` (mảng `{jobTitle,dept}`, gate ghi
`ADMIN_ONLY_KEYS` giống hệt `workflowParticipatingDepts`/`vppExcludedJobTitles`, `routes/data.js`). Mỗi
cấu hình quy trình phòng ban/tier thêm 2 field mới **additive**: `approverMode: {stepOrder: 'PEOPLE'|
'POSITION'}` (vắng = `'PEOPLE'`, y hệt cũ) và `approversByPosition: {stepOrder: [{jobTitle,dept}]}` —
`approvers[stepOrder]` giữ nguyên schema cũ, chỉ bị bỏ qua khi bước đó ở POSITION mode.

**Client** — widget dùng chung MỚI `renderMultiSelectDropdown()`/`getMultiSelectValues()` (`core.js`,
factor từ `renderPeopleMultiSelect()` sẵn có, generic cho nhãn/giá trị chuỗi bất kỳ) dùng cho cả 3 danh
mục khối 17 (`module-admin-specialperm.js`) LẪN ô chọn vị trí ở từng bước quy trình
(`module-ngansach.js`/`module-itsupport-tier.js`) — "items" của ô Vị Trí là tích chéo `DB.jobTitles` ×
`DB.depts`, gõ "Trưởng phòng IT" ra ngay đúng 1 dòng "Trưởng phòng — IT" để chọn. Bước "Theo vị trí" hiện
preview 3 TRẠNG THÁI — mirror UX đã dùng ở "Cấu Hình Cấp Đánh Giá KPI Theo Vị Trí" (v10.3): chưa chọn vị
trí / đã chọn nhưng chưa ai giữ (thiếu `canBeApprover` hoặc chưa tuyển) / đã tra ra người thật. Mirror
CLIENT của điểm tra cứu trung tâm: `resolveEffectiveStepApprovers()` (`core.js`) — thay thế MỌI nơi trước
đây đọc thẳng `wfConfig.approvers[step]` (~20 điểm rải khắp `core-approvalhub.js`/`core-dashboard.js`/
9 module) để nút "Duyệt" hiện đúng cho approver theo vị trí, không chỉ server mới biết.

Kiểm thử: `tests/test-workflow-participating-positions.js` (CRUD danh mục + gate ghi, chạy router thật
`routes/data.js`), `tests/test-workflow-position-approvers.js` (15 kịch bản — `resolvePositionApprovers()`
thuần, `flatWorkflowConfigToSteps()`/`applyWorkflowAction()` THẬT qua 3 module dbKey khác nhau, snapshot
lúc tạo submissions/contracts, regression PEOPLE mode, và xác nhận bằng code đúng 12 khoá `MODULE_CONFIGS`
sống). Sửa 2 bộ test cũ (`test-admin-users-permgroups.js`/`test-vpp.js`) theo đúng widget mới (không còn
khuôn input+datalist+nút "Thêm" cũ). Demo Playwright thật:
`demo-screenshots/workflow-position-approvers/` (không commit) — 3 danh mục khối 17 nâng cấp + sống sót
qua tải lại trang thật, 3 trạng thái preview "Theo vị trí", và phê duyệt THẬT: người đúng vị trí + có
`canBeApprover` duyệt được, người đúng vị trí nhưng THIẾU `canBeApprover` bị SERVER từ chối (403).

## Hộp Thư Phê Duyệt tự làm mới — không cần bấm F5 (2026-09-06)

**Yêu cầu gốc** (nguyên văn): *"Bạn kiểm tra xem có vấn đề gì về refresh trang khi tôi đang ở trong một
trang mà người gửi phê duyệt thao tác xong tôi phải ấn refresh mới thấy hiện để tôi phê duyệt, tôi
muốn tôi ko phải làm gì nó cũng sẽ hiên ra trạng thái luôn"*. Trước đây `DB.*` (client) chỉ tải MỘT LẦN
lúc đăng nhập (`initDatabase()`) — hồ sơ mới người khác gửi cần mình duyệt không tự xuất hiện cho tới
khi F5.

**Không dùng WebSocket/SSE** — server chạy PM2 `exec_mode:'cluster'` nhiều tiến trình độc lập, stateless
theo từng request (không sticky session), 1 kết nối WS/SSE giữ trong bộ nhớ đúng 1 tiến trình sẽ bỏ sót
client rơi vào tiến trình khác. Dùng polling ngắn (20s) — hoạt động đúng bất kể tiến trình nào trả lời,
không cần hạ tầng mới (không thêm dependency nào).

**Server**: `lib/approvalAggregator.js` (mới) — `computeMyPendingApprovalKeys(user, appData)`, hàm THUẦN
mirror lại `getMyPendingApprovals()` (client, `public/js/core-approvalhub.js`) cho ĐỦ cả 19 nguồn hồ sơ
(9+ module dept-workflow qua `lib/workflowEngine.js` MODULE_CONFIGS + `canApproveStep()` — ĐÚNG hàm
đang gác lượt duyệt/từ chối thật, không suy diễn lại — cộng thêm 6 module/nhánh quyền phẳng: Phòng Họp,
Góc Chia Sẻ + bình luận gắn cờ, Giấy Phép, Thanh Toán, "Từ chối khẩn cấp" Duyệt Giá, "Chờ Nhập Hàng" Vận
Hành Đơn Hàng). Trả về mảng KHOÁ đã sắp xếp/không trùng (không phải chỉ 1 con số đếm — 1 hồ sơ xử lý
xong đúng lúc 1 hồ sơ khác phát sinh có thể giữ nguyên đếm nhưng đổi hẳn nội dung). Endpoint mới
`GET /api/approvals/pending-signature` (`routes/approvals.js`, `requireAuth`) tái dùng nguyên 2 lớp
cache 3s sẵn có (`lib/appData.js`/`lib/recordStore.js`) — không thêm tầng cache mới.

**Client**: `startApprovalPolling()` (`public/js/core.js`, mô phỏng đúng khuôn `startSessionKeepAlive()`
sẵn có) — mỗi 20s (`APPROVAL_POLL_INTERVAL_MS`) gọi endpoint trên, so khoá (không so đếm) với lượt poll
trước; nếu đổi: cập nhật NGAY nhãn đếm nav "Phê Duyệt (N)" (lấy thẳng từ kết quả poll, không đợi tải lại
DB); nếu KHÔNG có modal nào đang mở (`isAnyModalOpen()`, quy ước `[id$="Modal"]` sẵn có toàn hệ thống)
mới tải lại toàn bộ `DB.*` (`initDatabase()`) rồi vẽ lại Hộp Thư Phê Duyệt nếu đang đứng đúng màn đó —
tránh giật dữ liệu khỏi tay người dùng đang thao tác dở ở màn khác. Bắt đầu ở `finishLogin()`, dừng ở
`logout()` — cùng vòng đời `startSessionKeepAlive()`. **Phạm vi đợt này CHỈ Hộp Thư Phê Duyệt + nhãn đếm
nav** — sub-tab "Phê duyệt" riêng của từng module (Tài liệu/Văn bản trình/Đăng ký xe/...) CHƯA tự làm
mới, để lại làm đợt sau nếu cần (mỗi module có hàm render/bộ lọc riêng, tự động hoá cả 9+ module rủi ro
cao hơn lợi ích so với phạm vi người dùng đã nêu).

Kiểm thử: `tests/test-approval-polling.js` (mới, 10 kịch bản, Node thuần — gọi trực tiếp
`computeMyPendingApprovalKeys()` phủ đủ 19 nguồn + gọi thật `GET /api/approvals/pending-signature` qua
router express thật, giả lập tầng lưu trữ) + demo 2 phiên trình duyệt thật (Playwright, xem
`demo-screenshots/approval-live-update/`, không commit — chỉ trên máy chạy demo).

## Nhân Sự > Cơ Cấu Tổ Chức: "🎯 Cấu Hình Cấp Đánh Giá KPI Theo Vị Trí" — tự động tra ra AI đánh giá vị trí nào, không chọn tay người quản lý trên từng nhân viên (2026-09-06)

**Yêu cầu gốc**: "cấu hình đánh giá kpi dựa trên position based sẽ được lấy khi cấp account điền theo
vị trí, phòng". **ĐÍNH CHÍNH sau khi xem demo bản đầu** — bản đầu hiểu SAI thành cấu hình 1 DANH SÁCH
TIÊU CHÍ KPI (tên/trọng số %/ghi chú) theo vị trí. Phản hồi chính xác của người dùng: *"tôi chưa đề cập
đến cấu hình tiêu chí kpi, tôi chỉ cấu hình cấp nào đánh giá kpi cấp nào theo vị trí để tôi cấu hình
trước, vì bạn đang để cấu hình cấp quản lý trên từng nhân viên gây khó khăn vì cty đông người. KPI tôi
chưa đưa tiêu chí đâu"*. Yêu cầu THẬT: cấu hình 1 LẦN DUY NHẤT "vị trí X (phòng ban Y, hoặc mọi phòng
ban) do CHỨC DANH NÀO đánh giá KPI", KHÔNG chọn tay người quản lý/đánh giá trên TỪNG tài khoản nhân
viên (không khả thi ở công ty đông người) — **KHÔNG có tiêu chí/trọng số/ghi chú KPI nào trong đợt
này**, chỉ dừng ở cấu hình "cấp nào đánh giá cấp nào" + tự động tra ra người thật đang giữ chức danh đó.
Giả định đơn giản hoá (chưa được người dùng xác nhận, sẽ sửa nếu cần): 1 chức danh đánh giá cho mỗi cặp
(dept, vị trí) — chưa hỗ trợ chuỗi nhiều cấp hay nhiều chức danh đánh giá khác nhau cho cùng 1 vị trí.

**Dữ liệu**: `DB.kpiEvaluatorConfig` (key mới trong `dbo.AppData`, seed `{}` ở `defaults.js` — ĐỔI TÊN
từ `kpiCriteriaConfig` của bản đầu sai, xoá hẳn không còn dùng ở đâu) — dạng
`{ [dept]: { [jobTitle]: {evaluatorJobTitle, updatedAt, updatedBy} } }`. `dept` là tên thật trong
`DB.depts`/`DB.stores`, HOẶC khoá đặc biệt `"_ALL_"` ("🌐 Áp dụng mọi phòng ban"). CHỈ lưu CHỨC DANH
người đánh giá (KHÔNG lưu username cụ thể nào) — người đánh giá THẬT được tra ĐỘNG tại thời điểm xem
bằng cách lọc `DB.users` cùng phòng ban với nhân viên + đúng chức danh đã cấu hình + đang active, nên
nhân sự thay đổi (nghỉ việc/tuyển mới/đổi chức danh) KHÔNG cần sửa lại cấu hình.

**Resolution 2 bước** (`resolveKpiEvaluatorForUser(user, allUsers, appData)`, hàm thuần trong
`module-hcrcdonghanh.js`): (1) tra QUY TẮC theo `user.dept` + `user.jobTitle` — khớp ĐÚNG dept trước,
không có thì rơi về `"_ALL_"` (mirror tinh thần `buildEffectiveSubmissionWorkflowServer()`,
`lib/createValidation.js`); (2) nếu có quy tắc, lọc `allUsers` CÙNG PHÒNG BAN với nhân viên + đúng
`evaluatorJobTitle` + `active !== false`. Trả về 3 trạng thái PHẢI phân biệt rõ ràng: `null` (chưa cấu
hình quy tắc nào), `{evaluatorJobTitle, evaluators: []}` (đã cấu hình nhưng hiện không ai giữ chức danh
đó trong phòng ban này), hoặc `{evaluatorJobTitle, evaluators: [{username,name}, ...]}` (tra ra người
thật — có thể nhiều người).

**Server**: `kpiEvaluatorConfig` vào `NON_ADMIN_GATED_KEYS` (`routes/data.js`, cùng khuôn
`meetingAttendeeTemplates`) — gate ghi RIÊNG `admin || orgChartManage || nhanSuManage` (đúng độ mở của
module con "Cơ Cấu Tổ Chức"), KHÔNG phải `ADMIN_ONLY_KEYS`. Đọc (GET) mở cho MỌI người đã đăng nhập —
không có bí mật nào trong key này (chỉ ánh xạ chức danh -> chức danh), cần đọc được để hiện modal "🎯
KPI" ở cây tổ chức.

**UI** (`public/index.html` + `public/js/module-hcrcdonghanh.js`): sub-tab strip 2 nút trong
`#orgChartSection` ("🌳 Sơ Đồ Tổ Chức" / "🎯 Cấu Hình Cấp Đánh Giá KPI", `setOrgChartSubTab()`). Form
CHỈ CÒN 3 dropdown (Phòng Ban, Vị Trí cần đánh giá, Chức Danh Người Đánh Giá — 2 dropdown chức danh
dùng CHUNG 1 danh mục nguồn gộp `DB.jobTitles`+`DB.storeJobTitles`) — **KHÔNG còn** ô tiêu chí/trọng
số/ghi chú/nút "+ Thêm tiêu chí" nào (đã bỏ hoàn toàn so với bản đầu sai). Nút "💾 Lưu Cấu Hình" ghi
`DB.kpiEvaluatorConfig[dept][jobTitle] = {evaluatorJobTitle,...}` rồi `syncStorage('kpiEvaluatorConfig')`
(mirror `saveVppExcludedJobTitles()`, `module-admin-specialperm.js` — snapshot/rollback). Danh sách
"📋 Đã Cấu Hình" hiện "Phòng: X — Vị trí: Y → Người đánh giá: Z" kèm Sửa/Xoá. Cây tổ chức
(`buildOrgChartNode()`) giữ nguyên nút "🎯 KPI" trên mỗi người, nhưng modal đổi hẳn nội dung — hiện AI
(tên + username) hiện đang đánh giá người này, hoặc 1 trong 2 thông báo phân biệt rõ ở trên. Modal sống
NGOÀI `#orgChartSection` (cùng khuôn `#orgChartManagerModal`) nên cần `bindCspDelegation('orgChartKpiModal')`
riêng (`core.js`, phát hiện qua demo Playwright chạy CSS thật ở đợt trước — vẫn giữ nguyên, không đổi).

**Kiểm thử**: `tests/test-kpi-criteria-config.js` (bản đầu sai) đã XOÁ HẲN, thay bằng
`tests/test-kpi-evaluator-config.js` (12 kịch bản — 6 kịch bản gate ghi/đọc không đổi so với bản đầu, 6
kịch bản resolution 2 bước: quy tắc riêng cho dept + tra đúng người cùng phòng ban, rơi về "_ALL_" và
vẫn tra đúng người đúng phòng ban của nhân viên, quy tắc có nhưng chưa ai giữ chức danh -> mảng rỗng
không crash, không có quy tắc nào -> `null`, thiếu `jobTitle` -> `null`, nhiều người cùng giữ chức danh
-> trả về đủ tất cả và loại người `active:false`). Toàn bộ 66 file `tests/test-*.js` chạy lại — không
có hồi quy mới (2 lỗi tiền tồn tại ở `test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js` đã
xác minh KHÔNG liên quan, tái hiện y hệt trên baseline chưa có đợt này).

**Demo**: `tests/demo-kpi-position-config.js` (bản đầu sai) đã XOÁ, thay bằng
`tests/demo-kpi-evaluator-config.js` — ảnh chụp mới tại `demo-screenshots/kpi-evaluator-config/` (7
ảnh: màn hình rỗng ban đầu KHÔNG còn ô tiêu chí nào, cấu hình dept cụ thể "Nhân viên bán hàng -> Giám
đốc siêu thị" áp dụng cho CẢ 3 nhân viên cùng vị trí không cần cấu hình riêng từng người, cấu hình
wildcard "_ALL_" + 1 rule "đã cấu hình nhưng chưa có người", còn nguyên sau `page.reload()` thật, modal
tra ra đúng người theo dept cụ thể, modal rơi về "_ALL_" và vẫn khớp đúng phòng ban của nhân viên, modal
phân biệt rõ "đã cấu hình nhưng chưa ai giữ chức danh" với "chưa cấu hình" ở vị trí khác).

**Deploy**: KHÔNG cần thao tác gì ngoài copy code + `pm2 restart` — không đổi `server/sql/schema.sql`
(dữ liệu vẫn ở `dbo.AppData` như mọi key khác), không thêm biến môi trường, không thêm `dependencies`
mới trong `package.json`.

## Quản Trị > "🔔 Thông Báo Email Phê Duyệt" — bật/tắt riêng email phê duyệt theo từng phân hệ, giảm trùng lặp với Hub Phê Duyệt (2026-09-06)

**Bối cảnh**: nhiều người đã thấy hồ sơ chờ duyệt qua Hub Phê Duyệt nên email "Cần phê duyệt" gửi cho
người duyệt thường TRÙNG LẶP/gây spam; ngược lại email "Kết quả duyệt" (Duyệt/Từ chối/Yêu cầu bổ sung)
gửi cho NGƯỜI TRÌNH — người không hề theo dõi Hub cho hồ sơ của chính mình — vẫn hữu ích. Thêm 1 màn
Quản Trị mới cho phép admin tự bật/tắt riêng 2 nhóm email này theo TỪNG PHÂN HỆ, không đụng gì tới Cấu
Hình Email (SMTP) đã có.

**Dữ liệu**: `DB.approvalEmailConfig` (key mới trong `dbo.AppData`, seed mặc định ở `defaults.js`) —
1 object phẳng theo module, mỗi module 2 khoá chính `approvalNeeded`/`result` (mặc định lần lượt
**false**/**true**) cộng thêm các khoá đặc thù riêng module (mặc định giữ nguyên hành vi cũ — **true**):
CAR/DOC/BUDGET/OFFICE/MEETING/VPP/CONTRACT/INTERNAL/OPERATION chỉ có 2 khoá chính; LICENSE chỉ có
`approvalNeeded` (Duyệt/Từ chối Giấy Phép hiện không gửi email ở bất kỳ đâu — không có khoá `result`);
SUBMISSION có thêm `opinionRequested`/`fileProposal`/`fileProposalAccepted`; IT_SUPPORT có thêm
`applied`/`requestInfo`/`emergencyRejectRequest`/`emergencyRejectApproved`/`emergencyRejectDenied`
(Phê Duyệt Giá) và `ticketApprovalNeeded`/`ticketEscalationApproved`/`ticketEscalationDenied`/
`ticketDone` (Ticket); OPERATION gộp chung cả 3 luồng con thật (OPERATION_ORDER/OPERATION_STORE_OPEN/
OPERATION_REPAIR). Ngoài phạm vi tính năng này (giữ nguyên, luôn gửi, không có toggle): toàn bộ họ
`NOTIFY_TASK_*`/`NOTIFY_EXTENSION_*`/`NOTIFY_CANCEL_*`/`NOTIFY_COLLABORATOR_CONFIRMED` (Công Việc —
không hiện trong Hub Phê Duyệt nên lý do "trùng lặp" không áp dụng), 3 email Biên Bản Họp
(`NOTIFY_TASK_ASSIGNED`/`NOTIFY_TASK_COLLABORATOR`/`NOTIFY_MINUTES_CREATED` — thủ công, đã có checkbox
opt-out riêng theo từng người nhận), checkbox "Gửi lại email" khi resubmit của Góc Chia Sẻ
(`internalResendEmailCheckbox` — cơ chế độc lập, giữ nguyên), OTP xác thực lại khi duyệt
(`routes/auth.js`, không đi qua `notifyUsersByEmail`), và 3 job nhắc hạn chạy theo lịch server (hợp
đồng/giấy phép/dịch vụ CNTT — theo hạn, không theo bước chuyển trạng thái).

**Cổng chặn**: DUY NHẤT bên trong `notifyRecipientsByEmail()` (`public/js/core.js`) — nơi TOÀN BỘ 88
điểm gọi `notifyUsersByEmail()`/`notifyRecipientsByEmail()` rải khắp ~13 module đã cùng đi qua từ
trước, nên không phải sửa từng điểm gọi. Phân loại `(module, actionType) -> {configModule, family}` gom
về 1 nguồn duy nhất `APPROVAL_EMAIL_EVENTS`/`classifyApprovalEmailEvent()` — dùng chung cho CẢ việc
chặn LẪN dựng màn hình admin (`renderApprovalEmailConfigForm()`), tránh lệch nhau khi sửa sau này. Sự
kiện KHÔNG nhận diện được (TASK/MINUTES, hoặc actionType tương lai chưa liệt kê) và module CHƯA có gì
trong `DB.approvalEmailConfig` (CSDL/phiên chưa từng lưu) đều **fail-open — luôn gửi**, không âm thầm
chặn oan. Khi email bị admin tắt: vẫn ghi đủ 1 dòng Nhật ký hệ thống cùng actionType/targetCode như cũ
(status mới `SUPPRESSED`) — chỉ bỏ qua bước gọi `dispatchRealEmail()` thật, không xoá dấu vết sự kiện.

**Server**: thêm `approvalEmailConfig` vào `ADMIN_ONLY_KEYS` (`routes/data.js`, cùng khuôn `emailConfig`
— `isCurrentlyAdmin()` tra CSDL mới, không tin cache JWT); không cần sanitize khi đọc (không có bí mật
nào trong key này) nên mọi người đã đăng nhập vẫn đọc được nguyên vẹn — cần để client tự tra cứu trước
khi quyết định gửi.

**UI**: tab con mới "🔔 Thông Báo Email Phê Duyệt" cạnh "📧 Cấu Hình Email" (`Quản Trị`) — 1 bảng 2 cột
"Cần Phê Duyệt"/"Kết Quả Duyệt" (1 dòng/module, ô không áp dụng được — LICENSE.result — hiện disabled
kèm ghi chú "Chưa có email" thay vì 1 checkbox khả dụng nhưng vô tác dụng) + 1 khối riêng các sự kiện
đặc thù theo module (SUBMISSION/IT_SUPPORT), 1 nút "Lưu Cấu Hình" chung.

**Kiểm thử**: 2 file mới `tests/test-approval-email-config.js` (32 kịch bản — cổng chặn/fail-open/
family độc lập/render mặc định/toggle qua đúng luồng UI thật cho CAR, SUBMISSION, IT_SUPPORT) và
`tests/test-approval-email-config-admin-gate.js` (4 kịch bản — 403 ghi cho non-admin, đọc vẫn mở, admin
ghi có hiệu lực thật). Toàn bộ 63 file test cũ chạy lại đạt, KHÔNG cần sửa seed data nào — do "module
chưa cấu hình gì trong `DB.approvalEmailConfig` -> fail-open" nên các test cũ (không hề seed key mới
này) giữ nguyên hành vi gửi email như trước.

## 4 lỗi nghiệp vụ Vận Hành / Đăng Ký Xe / Approval Hub phát hiện qua audit + 2 tính năng người dùng xác nhận (2026-09-06)

**Bối cảnh**: 1 đợt audit sâu logic nghiệp vụ khác (song song với đợt "Văn Phòng Tổng Hợp/Biên Bản
Họp/Công Việc" ở mục dưới) phát hiện thêm 2 lỗi ở Vận Hành + 2 tính năng người dùng đã xác nhận muốn
thêm ở Approval Hub và Đăng Ký Xe.

**Fix 1 — Vận Hành: nghiệm thu (nãi) trực tiếp 1 công việc CHA (có con) không bị chặn, phá vỡ bất biến
cascade**: `acceptOperationWorkItem()` (`lib/recordActions.js`) trước đây chỉ kiểm tra
`status === 'DANG_NGHIEM_THU'`, không kiểm tra công việc có con hay không — người có quyền nghiệm thu
có thể bấm "✅ Nghiệm Thu" thẳng lên 1 việc CHA (đặc biệt dễ xảy ra vì việc cha tự cascade lên
`DANG_NGHIEM_THU` khi mọi con đã "hoàn thành"), tự tay ghi đè `acceptedBy`/`status` dù đúng ra chỉ được
tự động cập nhật theo con (`computeParentWorkItemStatus`/`syncOperationWorkItemAncestors`). Sửa: mirror
đúng chặn 409 đã có ở `updateOperationWorkItemProgress()` — `acceptOperationWorkItem()` nay nhận thêm
tham số `children`, ném lỗi "Công việc này có việc con..." nếu còn con; route `POST
/operationWorkItems/:id/accept` (`routes/records.js`) tự đọc children trước khi gọi, mirror đúng route
`/progress` đã làm. Client (`module-vanhanh.js`, nhánh ACCEPTANCE-mode): ẩn 2 nút "✅ Nghiệm Thu"/"🔄 Bổ
Sung" khi `hasChildren`, hiện "Tự cập nhật theo việc con" thay vào đó (mirror đúng nhánh EXECUTION-mode
đã có). Cascade tự động (con nghiệm thu xong hết → cha tự `DA_NGHIEM_THU`) vẫn hoạt động y hệt — chỉ
chặn cú click TAY trực tiếp lên việc cha.

**Fix 2 — Vận Hành > Đơn Hàng: `paymentTotalAmount` (field người dùng tự gõ) có thể kéo đơn hàng thật
sự giá trị cao xuống mức duyệt thấp hơn**: `computeOperationOrderAmount()` (`lib/workflowEngine.js`)
trước đây ưu tiên `paymentTotalAmount` tuyệt đối bất cứ khi nào > 0, hoàn toàn bỏ qua `amount` (tổng
Số lượng × Đơn giá các hạng mục, server LUÔN tự tính lại, tamper-proof) dù `amount` cao hơn nhiều —
1 đơn hàng 200 triệu tiền hàng thật nhưng khai `paymentTotalAmount` giả 5 triệu sẽ né được tier duyệt
cao, chỉ cần người ít thẩm quyền hơn duyệt. Sửa: đổi thành `Math.max(amount, paymentTotalAmount)` —
`paymentTotalAmount` chỉ được phép đẩy tier LÊN cao hơn (hợp lệ khi gồm VAT/phụ phí thật), không bao
giờ kéo XUỐNG dưới mức `amount` thật yêu cầu. Đúng cho cả Store (3 mức) lẫn HO (2 mức). Client
(`computeOperationOrderAmountClient()`, `public/js/core.js`) mirror lại y hệt để nhãn hiển thị mức duyệt
dự kiến luôn khớp server (chỉ 1 nhãn hiển thị, không phải điểm chặn quyền — server luôn tự tính lại).

**Fix 3 — Approval Hub: đơn hàng `AWAITING_RECEIPT` ("Chờ Nhập Hàng") không bao giờ vào Hub dù người
chịu trách nhiệm còn phải xác nhận nhập/hủy nhập** — người dùng xác nhận "Có, đưa vào Hub".
`getMyPendingApprovals()` (`public/js/core-approvalhub.js`) trước đây chỉ gộp hồ sơ `status==='PENDING'`.
Sửa: gộp thêm `operationOrders` đang `AWAITING_RECEIPT` mà người dùng hiện tại pass
`canManageOperationOrderReceiptClient()` (`module-vanhanh.js`, tái dùng nguyên hàm quyền đã có, không
viết lại logic) — hiện như 1 loại mục riêng (`type: 'operationOrderReceipt'`) với 2 nút hành động ĐÚNG
như ở list Vận Hành gốc ("✅ Nhập Hàng"/"🚫 Hủy Nhập"), không phải Duyệt/Từ chối thông thường (đây không
phải quyết định duyệt/từ chối). Vì hàm quyền đó sống ở cụm nạp lười "vanhanh" trong khi
core-approvalhub.js luôn nạp sẵn (eager), có guard `typeof` trước khi gọi + tự nạp nền/làm mới lại Hub
khi cụm chưa từng mở trong phiên (không throw ReferenceError). Tab "Đã xử lý" đã tự hoạt động đúng từ
trước (`matchStatuses: ['APPROVED','AWAITING_RECEIPT','RECEIVED','RECEIPT_CANCELLED']`, thêm ở
`48fd713`) — chỉ xác nhận lại, không sửa gì thêm.

**Fix 4 — Đăng Ký Xe: thêm "Hủy chuyến"/"Đổi tài xế-xe" SAU KHI đã duyệt** — người dùng xác nhận "Thêm
nút Hủy/Đổi sau duyệt". Trước đây 1 phiếu đã `APPROVED` là ngõ cụt, chỉ admin xóa cứng được. Mirror cơ
chế Huỷ của Phòng Họp (`canCancelMeeting()`/`routes/meetingActions.js`): "Hủy chuyến" (action + route
mới `POST /api/records/carRegs/:id/cancel`, hàm `cancelCarReg()`/`canCancelCarReg()` ở
`lib/recordActions.js`) — tự huỷ được chuyến của CHÍNH MÌNH (creator, không cần quyền gì thêm) HOẶC
`carDispatch`("Người Điều Hành Xe")/admin huỷ được của bất kỳ ai — chuyển sang trạng thái `CANCELLED`
MỚI (chưa từng tồn tại cho `carRegs`; `findCarPlateConflict()` đã sẵn loại trừ trạng thái này khỏi kiểm
tra trùng biển số từ trước). "Đổi tài xế-xe" (route mới `POST /api/records/carRegs/:id/reassign`, hàm
`reassignCarDispatch()`) — CHỈ `carDispatch`/admin, tái dùng UI phân công có sẵn (`carDispatchSection`
trong modal xử lý) + `findCarPlateConflict()` để chặn gán trùng biển số, reset `driverConfirmed` khi đổi
tài xế (mirror đúng `applyWorkflowAction()`). Cả 2 hành động CHỈ áp dụng khi `status === 'APPROVED'` —
`applyWorkflowAction()` (dùng cho Duyệt/Từ chối) khoá cứng chỉ nhận `status==='PENDING'` nên đây là 2
hàm HOÀN TOÀN RIÊNG, không đụng tới engine duyệt theo bước. Client (`module-dangkyxe.js`): 2 lựa chọn
mới ở dòng danh sách (dropdown "Khác ▾") + 2 nút trong modal xử lý, gate đúng
`canCancelCarRegClient()`/`canDispatchCarClient()` (mirror chính xác gate server).

**Deploy impact**: KHÔNG đổi `server/sql/schema.sql`, KHÔNG thêm biến môi trường, KHÔNG thêm/đổi
`dependencies` — thuần JSON-blob data (field `status` mới `CANCELLED` cho `carRegs`, các field
`cancelledAt/cancelledBy/cancelledByName` mới, không cần migrate dữ liệu cũ) + app logic, chỉ cần copy
code + `pm2 restart` theo quy trình hiện có (mục 16 `HUONG_DAN_DEPLOY_UBUNTU.md`).

Đã kiểm thử: toàn bộ 63 file `tests/test-*.js` chạy tới hoàn tất thật — chỉ 2 file (`test-audit-fixes-batch1.js`,
`test-audit-round2-cluster1.js`) fail đúng những kịch bản gọi `GET /api/data` cần SQL Server thật (lỗi
kết nối `localhost:1433`), đã xác nhận là hạn chế môi trường sandbox có từ trước, không liên quan gì
tới 4 fix này. Bổ sung/mở rộng kiểm thử Playwright thật cho cả 4 fix: `tests/test-operation-store-lifecycle.js`
(Fix 1 — nghiệm thu tay việc cha bị chặn 409 + client ẩn đúng nút, cascade tự động vẫn qua 67/67 kịch
bản kể cả cascade 3 cấp), `tests/test-operation-order-location-tiers.js` (Fix 2 — `max(amount,
paymentTotalAmount)` đúng cả 2 hướng + đúng biên giới tier cho cả Store/HO, 24/24), `tests/test-approval-hub.js`
(Fix 3 — đơn `AWAITING_RECEIPT` vào đúng Hub của đúng approver với nút Nhập Hàng/Hủy Nhập, không vào Hub
của người không có quyền, 33/33), `tests/test-meeting-car.js` (Fix 4 — huỷ/đổi tài xế-xe hoạt động đúng
sau khi duyệt, gate đúng quyền, chặn biển số trùng, chặn thao tác trên phiếu chưa/không còn APPROVED,
53/53).

## Fix 4 lỗi nghiệp vụ phát hiện qua audit — Văn Phòng Tổng Hợp / Biên Bản Họp / Công Việc (2026-09-06)

**Bối cảnh**: 1 đợt audit sâu logic nghiệp vụ phát hiện 4 lỗi đã xác nhận, cả 4 đều thuần client-side
(`public/js/module-office.js`, `module-bienbanhop.js`, `module-congviec.js`) — không đụng tới bất kỳ
route/lib server nào.

**Fix 1 — Văn Phòng Tổng Hợp: nút "📤 Tải lại Tài liệu ký" biến mất vĩnh viễn sau lần tải đầu tiên**:
server (`uploadOfficeSignedFile()`) đã đúng từ trước — cho tải lại/sửa Tài liệu ký của đề xuất Mua
Bán/Sửa Chữa/Đầu Tư bất kỳ lúc nào còn `paymentStatus === 'CHUA_THANH_TOAN'`, kể cả khi đã có tệp (vd
lỡ chọn nhầm). Nhưng client chỉ hiện nút khi `!o.signedFileUrl`, nên sau lần tải đầu tiên nút biến mất
vĩnh viễn dù còn cơ hội sửa. Sửa: hiện nút cả khi `o.signedFileUrl && paymentStatus === 'CHUA_THANH_TOAN'`
— nút vẫn biến mất đúng lúc ngay khi đã bấm "Chuyển Sang Thanh Toán".

**Fix 2 — Biên Bản Họp: nút "📌 Giao việc" theo TỪNG dòng chỉ đạo (trong modal Chi tiết) là 1 đường tạo
việc CŨ, khác nút "Giao việc" hàng loạt chính thức** — mở modal Giao Việc thủ công thông thường, không
set `sourceType`/`sourceCode`/`sourceDirectiveId` (server `createTask()` ép cứng `sourceType='MANUAL'`),
nên: (a) nút không bao giờ tự ẩn (lookup "đã có việc" theo `sourceDirectiveId` luôn thất bại) — bấm lại
nhiều lần tạo việc trùng; (b) việc tạo ra khởi động `TODO` thay vì tự động `DOING` (đúng quy tắc việc
nguồn Biên Bản Họp); (c) `d.taskCreated`/`m.tasksAssigned` không được set nên biên bản không khoá lại.
Sửa: nút này giờ gọi thẳng `confirmAssignMinutesTasks()` — CÙNG hàm với nút "Giao việc" hàng loạt ở danh
sách (loại bỏ hẳn đường tạo việc cũ, không thêm đường thứ 3), cộng thêm tự render lại modal Chi tiết
đang mở sau khi tạo việc xong để nút ẩn ngay lập tức. `createTaskFromMinutesDirective()` (hàm cũ, không
còn dùng) đã xoá khỏi `module-congviec.js`.

**Fix 3 — Công Việc: "Cập Nhật Tiến Độ" không ẩn "✅ Hoàn thành" khi có yêu cầu HUỶ đang chờ duyệt** —
chỉ xét `t.pendingExtension`, không xét `t.pendingCancellation`, trong khi server
(`updateTaskStatusAction()`) chặn `DONE` cho CẢ 2 trường hợp — chọn "Hoàn thành" lúc đó luôn bị server
trả 409 (dead click). Sửa: mở rộng điều kiện lọc để loại "Hoàn thành" khi có 1 trong 2 (mirror đúng
cách `pendingExtension` đã được xử lý).

**Fix 4 — Công Việc: nút "Xác nhận thay" (người phối hợp ngoài hệ thống) không ẩn khi việc đã đóng** —
điều kiện chỉ xét `!accepted && isAssigner`, không xét việc còn mở hay không, trong khi server
(`confirmCollaboratorParticipation()`) chặn khi `status` là `DONE`/`CANCELLED` — nút hiện mãi trên việc
đã đóng, bấm vào luôn 409. Sửa: thêm điều kiện `isOpenTask` (`status !== 'DONE' && status !== 'CANCELLED'`,
cùng công thức `isOpenTask` đã dùng ở chỗ khác trong `module-congviec.js`) vào điều kiện hiện nút.

**Deploy impact**: KHÔNG đổi `server/sql/schema.sql`, KHÔNG thêm biến môi trường, KHÔNG thêm/đổi
`dependencies` — thuần client-side (chỉ 3 file `public/js/module-*.js`), chỉ cần copy code + `pm2 restart`
theo quy trình hiện có (mục 16 `HUONG_DAN_DEPLOY_UBUNTU.md`).

Đã kiểm thử: toàn bộ 63 file `tests/test-*.js` — 61/63 pass hoàn toàn, 2 file còn lại chỉ fail đúng 1
kịch bản mỗi file do SQL Server thật không có trong sandbox kiểm thử (lỗi kết nối `localhost:1433`, đã
xác nhận là hạn chế môi trường có từ trước, không liên quan gì tới 4 fix này). Bổ sung/mở rộng kiểm thử
Playwright thật (click nút/mở modal trên DOM thật, không chỉ gọi hàm) cho cả 4 fix:
`tests/test-office-budget.js` (Fix 1 — nút hiện đúng cả 2 giai đoạn trước/sau tải tệp, ẩn đúng lúc sau
khi thanh toán, server vẫn 409 nếu gọi thẳng API sau khi khoá), `tests/test-minutes.js` (Fix 2 — nút
theo dòng tạo đúng việc DOING/sourceType/sourceDirectiveId, tự ẩn, gọi lại bị 409 không tạo trùng),
`tests/test-task.js` (Fix 3 + Fix 4 — ẩn "Hoàn thành" khi pendingCancellation, ẩn "Xác nhận thay" khi
DONE/CANCELLED).

## Góc Chia Sẻ: checkbox tuỳ chọn gửi lại email duyệt khi resubmit sau "Yêu Cầu Bổ Sung" (2026-09-06)

**Bối cảnh**: 1 đợt audit sâu logic nghiệp vụ phát hiện: khi tác giả sửa + gửi lại bài Góc Chia Sẻ sau
khi nhận "Yêu Cầu Bổ Sung" (NEED_INFO -> PENDING), bài quay lại đúng hàng chờ duyệt nhưng KHÔNG có email
nào báo lại cho người duyệt — khác nhánh tạo bài mới (`submitInternalPost()` nhánh `!isEditing`) luôn gửi
email qua `notifyUsersByEmail(..., getInternalPostApproverUsernames(), ...)`.

Hỏi lại người dùng có nên tự động gửi lại email hay không, người dùng đề xuất đúng: thêm 1 checkbox để
tác giả TỰ CHỌN, mặc định KHÔNG tích (không gửi) — tích thì mới gửi lại.

**Đã làm**: thêm checkbox "📧 Gửi email thông báo lại cho người duyệt" trên form Sửa bài Góc Chia Sẻ
(`#internalResendEmailField`/`#internalResendEmailCheckbox`, `public/index.html`), mặc định ẩn + không
tích, CHỈ hiện ra khi đang thực sự resubmit 1 bài NEED_INFO (`editInternalPostUI()` kiểm tra
`p.status === 'NEED_INFO'`) — không hiện ở form tạo bài mới, không hiện khi Sửa bài Nháp (chưa từng gửi
duyệt nên không phải "gửi lại"); tự ẩn + bỏ tích lại mỗi lần đổi tab/mở form khác
(`setInternalSubTab()`), tránh mang theo lựa chọn của phiên Sửa trước. Ở `submitInternalPost()` nhánh
`isEditing`, khi phát hiện đúng chuyển trạng thái NEED_INFO -> PENDING, chỉ gửi lại email (dùng LẠI y hệt
lệnh gọi `notifyUsersByEmail()` của nhánh tạo mới, cùng danh sách người nhận) nếu checkbox đang tích;
không tích thì bài vẫn resubmit/vào lại hàng chờ duyệt bình thường như trước giờ, chỉ bỏ qua bước gửi
email (`public/js/module-internalcomms-nhipsong.js`).

**Deploy impact**: KHÔNG đổi `server/sql/schema.sql`, KHÔNG thêm biến môi trường, KHÔNG thêm/đổi
`dependencies` — thuần client-side (`public/index.html` + 1 file `public/js/module-*.js`), chỉ cần copy
code + `pm2 restart` theo quy trình hiện có (mục 16 `HUONG_DAN_DEPLOY_UBUNTU.md`).

Đã kiểm thử: toàn bộ 63 file `tests/test-*.js` — 61/63 pass hoàn toàn, 2 file còn lại chỉ fail đúng do SQL
Server thật không có trong sandbox kiểm thử (lỗi kết nối `localhost:1433`, hạn chế môi trường có từ
trước, không liên quan tính năng này). Bổ sung 4 kịch bản Playwright thật vào
`tests/test-internal-recruitment-share.js`: tạo bài mới không có checkbox này (luôn gửi email như cũ),
resubmit NEED_INFO thấy checkbox hiện đúng ngữ cảnh + mặc định không tích, resubmit KHÔNG tích thì không
gửi email thêm (vẫn về PENDING bình thường), resubmit CÓ tích thì gửi thêm 1 email đúng tới cùng danh
sách người duyệt như lúc tạo bài, và Sửa bài Nháp (không phải resubmit) thì checkbox vẫn ẩn.

## Chạy như dịch vụ hệ thống (systemd) dưới tài khoản riêng, không phải root + viết lại toàn bộ HUONG_DAN_DEPLOY_UBUNTU.md (2026-09-06)

**Bối cảnh**: Trước đây `HUONG_DAN_DEPLOY_UBUNTU.md` hướng dẫn chạy PM2 bằng chính tài khoản admin đang
đăng nhập (thường có quyền `sudo`, đôi khi là `root`) — nếu có lỗ hổng chưa biết trong ứng dụng hoặc 1
gói npm phụ thuộc bị khai thác, kẻ tấn công có thể chiếm toàn quyền máy chủ thay vì chỉ 1 phạm vi giới
hạn. Người dùng yêu cầu: (1) chạy ứng dụng như dịch vụ hệ thống thật (systemd), sống sót qua reboot +
đóng phiên SSH thay vì tiến trình chạy tay; (2) tạo tài khoản hệ thống riêng, không phải root, không
phải tài khoản cá nhân admin; (3) khoá quyền thư mục ứng dụng + đặc biệt `.env` chỉ tài khoản đó đọc
được; (4) viết lại toàn bộ hướng dẫn deploy cho rõ ràng, gộp đúng nội dung PM2 cluster mode (đã có từ
đợt trước) + phần mới này thành 1 luồng liền mạch.

**Thiết kế tài khoản dịch vụ + systemd (mục 9-10 mới trong `HUONG_DAN_DEPLOY_UBUNTU.md`)**:
- `useradd --system --no-create-home --home-dir /opt/vpdt --shell /usr/sbin/nologin vpdt-app` — tài
  khoản hệ thống, không cho đăng nhập tương tác (SSH/`su -`), **trỏ thẳng "home" vào chính thư mục ứng
  dụng** thay vì tạo thư mục home riêng biệt. Đây là điểm mấu chốt xác minh được thực tế trong sandbox:
  PM2 lưu trạng thái/log vào `$HOME/.pm2` — nếu dùng `--no-create-home` mà KHÔNG trỏ `--home-dir` vào
  thư mục có thật, PM2 báo lỗi `ENOENT` ngay lần chạy đầu (đã tái hiện lỗi này rồi mới tìm ra cách sửa
  đúng). Trỏ home vào `/opt/vpdt` giải quyết gọn: mọi lệnh `sudo -u vpdt-app pm2 ...` tự dùng đúng
  `/opt/vpdt/.pm2` mà không cần khai báo `PM2_HOME` thủ công ở bất kỳ đâu.
- `chown -R vpdt-app:vpdt-app /opt/vpdt` + `chmod 750` thư mục + `chmod 600 .env` — đã rà lại toàn bộ
  repo, xác nhận không có file/thư mục nào khác (kể cả `uploads/`) cần quyền rộng hơn (không cần bật
  `770`/group-writable cho `uploads/` vì chỉ đúng 1 tiến trình, chạy dưới đúng 1 tài khoản, ghi vào đây).
- `pm2 startup systemd -u vpdt-app --hp /opt/vpdt` — đã tự kiểm chứng ĐÚNG cú pháp này với PM2 `7.0.3`
  cài trong sandbox (không đoán): lệnh tự phát hiện `systemd`, in ra 1 dòng lệnh `sudo env PATH=...`
  khác cần copy-paste chạy lại (do PM2 chủ động không tự chạy khi chưa đủ quyền), tạo dịch vụ tên
  `pm2-vpdt-app` (đọc thẳng template `systemd.tpl` của PM2 để xác nhận: `User=vpdt-app`,
  `Environment=PM2_HOME=/opt/vpdt/.pm2`, `ExecStart=pm2 resurrect`, `ExecReload=pm2 reload all`).
  `pm2 save` (chạy dưới `vpdt-app`) bắt buộc phải làm ngay sau khi start app lần đầu — đây là danh sách
  `pm2 resurrect` sẽ phục hồi lại mỗi khi server reboot.

**Đã thực sự smoke-test được gì trong sandbox (container, KHÔNG có systemd thật làm PID 1 — đã tự kiểm
tra bằng `systemctl status`/`ps -p 1` trước khi giả định, xác nhận không thể đăng ký/khởi động 1 service
systemd thật ở đây) — không có bất kỳ khẳng định "đã kiểm chứng end-to-end" nào cho phần systemd thật**:
- Tạo tài khoản hệ thống thật (`useradd --system --no-create-home --home-dir ... --shell nologin`),
  `chown -R` + `chmod 750`/`600` 1 thư mục ứng dụng thử — xác nhận THẬT (không suy đoán): 1 tài khoản
  KHÁC (không phải chủ sở hữu) bị từ chối đọc/liệt kê thư mục VÀ đọc `.env` (`Permission denied`), trong
  khi chính tài khoản dịch vụ đọc/ghi bình thường (kể cả ghi vào `uploads/` mô phỏng).
- Khởi động PM2 **cluster mode thật** (`exec_mode: 'cluster'`, 2 tiến trình) dưới tài khoản dịch vụ qua
  `runuser -u vpdt-app`: `pm2 list` xác nhận cột `user` = đúng tài khoản dịch vụ (không phải root); log
  thực tế của 2 tiến trình xác nhận ĐÚNG cơ chế cron-guard hiện có (biến `NODE_APP_INSTANCE` PM2 tự gán)
  vẫn hoạt động dưới tài khoản mới: instance 0 tự nhận `scheduler=true`, instance 1 tự nhận
  `scheduler=false` — không đổi gì ở `ecosystem.config.js`/`server.js` mà vẫn đúng.
- `pm2 startup systemd -u ... --hp ...` chạy được và in ra đúng cú pháp lệnh cần chạy (đã đọc thẳng mã
  nguồn PM2 để xác nhận ý nghĩa `--hp`/tên service sinh ra), nhưng **KHÔNG thể xác nhận việc đăng ký
  service thật + sống sót qua reboot thật** trong sandbox này (không có systemd PID 1) — phần này cần
  người dùng tự xác nhận trên máy chủ thật của họ theo đúng các bước đã viết ở mục 10c
  `HUONG_DAN_DEPLOY_UBUNTU.md` (đã hướng dẫn cả cách tự thử bằng `sudo reboot` để xác nhận chắc chắn).
- Toàn bộ tài khoản/thư mục thử nghiệm trong sandbox đã dọn sạch (`userdel`, `rm -rf`) sau khi xác minh
  xong — không để lại trạng thái thử nghiệm nào trong môi trường.

**Sửa nhỏ kèm theo**: `ecosystem.config.js` sửa 1 chú thích sai (ghi nhầm tên biến `PM2_APP_INSTANCE`
— biến PM2 thật sự dùng là `NODE_APP_INSTANCE`, code `server.js` vẫn luôn đọc đúng biến, chỉ chú thích
bị sai tên) và bổ sung ghi chú xác nhận không có giả định đường dẫn/tài khoản cụ thể nào ở file này. Cập
nhật các chú thích trỏ số mục cũ trong code server đã lạc hậu do đánh số lại `HUONG_DAN_DEPLOY_UBUNTU.md`
(`routes/auth.js`, `routes/systemLog.js`, `scripts/copy-vendor-assets.js`,
`lib/operationWorkItemStore.js`) và trong `CLAUDE.md` ("mục 12" → "mục 16" cho quy trình cập nhật code).
Không có thay đổi hành vi thực tế nào ở các file `.js` này — thuần sửa nội dung chú thích/thông báo lỗi
trỏ đúng mục trong tài liệu.

**Viết lại toàn bộ `HUONG_DAN_DEPLOY_UBUNTU.md`**: giữ nguyên các mục dựng máy lần đầu (Node.js, SQL
Server, `.env`, SMTP, chạy thử) và các mục bảo mật/vận hành đã có (CAPTCHA, WebAuthn, PWA, fail2ban,
`TRUST_PROXY`, `DB_ENCRYPT`), chèn thêm 2 mục MỚI đúng vị trí luồng thao tác thực tế (mục 9 — tạo tài
khoản dịch vụ + khoá quyền, ngay sau bước "chạy thử" mục 8; mục 10c — đăng ký PM2 làm dịch vụ systemd,
trong mục PM2 cluster mode đã đổi từ 9a cũ thành mục 10 mới), đánh số lại toàn bộ các mục còn lại cho
liền mạch (Nginx/TRUST_PROXY/fail2ban dời từ 9b/9c/9d cũ thành 11/12/13; tình trạng bảo mật từ mục 10
cũ thành 14; kiểm tra sức khỏe + quy trình cập nhật code từ 11/12 cũ thành 15/16). Mọi lệnh `pm2
restart`/`pm2 status`/`pm2 logs` trong toàn bộ tài liệu đã đổi thành `sudo -u vpdt-app pm2 ...` cho khớp
tài khoản chạy thực tế; quy trình cập nhật code (mục 16, cũ là mục 12) bổ sung bước `chown -R` trả lại
quyền sở hữu cho tài khoản dịch vụ sau khi copy code mới (vì bước copy code/`npm install` làm bằng tài
khoản admin sẽ tạo file thuộc sở hữu admin, cần trả lại đúng quyền trước khi restart). Đã soát lại toàn
bộ tài liệu xác nhận không còn tham chiếu số mục cũ nào bị lạc hậu, và không còn hướng dẫn "chạy bằng tài
khoản hiện tại"/`pm2 restart` (không `sudo -u vpdt-app`) nào sót lại ở phần vận hành production.

**Kiểm thử**: `node -c` toàn bộ file `.js` đã sửa (`ecosystem.config.js`, `routes/auth.js`,
`routes/systemLog.js`, `scripts/copy-vendor-assets.js`, `lib/operationWorkItemStore.js`), chạy lại TOÀN
BỘ `tests/test-*.js` 2 lần (trước và sau khi sửa các file trên) — cả 2 lần đều chỉ còn đúng 2 lỗi cũ đã
biết (không kết nối được SQL Server `localhost:1433` khi chạy ngoài môi trường có SQL Server thật),
không phát sinh lỗi mới.

**Tác động deploy — ĐÂY LÀ TRỌNG TÂM CỦA ĐỢT NÀY, KHÔNG PHẢI "chỉ copy code + restart" như thường lệ**:
bản cập nhật này chỉ đổi code THUẦN Ở MỨC CHÚ THÍCH (không đổi hành vi runtime nào của
`ecosystem.config.js`/`server.js`/route nào) — nhưng **giá trị thật của đợt này là 1 THỦ TỤC THỦ CÔNG,
1 LẦN, PHẢI TỰ LÀM TRÊN MÁY CHỦ THẬT** để chuyển từ "PM2 chạy tay bằng tài khoản admin" sang "PM2 chạy
như dịch vụ hệ thống dưới tài khoản riêng, không phải root" — làm theo đúng thứ tự mục 9 → mục 10c mới
trong `HUONG_DAN_DEPLOY_UBUNTU.md` (tạo tài khoản `vpdt-app`, `chown -R` + khoá quyền thư mục/`.env`,
dừng tiến trình PM2 cũ đang chạy dưới tài khoản cũ, khởi động lại dưới `vpdt-app`, đăng ký systemd,
`pm2 save`). KHÔNG đổi `server/sql/schema.sql`, KHÔNG thêm biến `.env` mới, KHÔNG đổi `dependencies`
trong `package.json` — nhưng KHÔNG thể chỉ "copy code + `pm2 restart`" mà có được lợi ích bảo mật của
đợt này; nếu không tự thực hiện thủ tục ở mục 9-10c, hệ thống vẫn chạy đúng như cũ (không có gì hỏng),
chỉ là chưa có được lớp bảo vệ least-privilege + chưa sống sót qua reboot server mà thôi.

## Chuyển box chọn checkbox người duyệt sang ô tìm-kiếm-gõ-chọn nhiều người ở "Quy Trình & Phê Duyệt" (2026-09-06)

**Bối cảnh**: `CLAUDE.md` đã quy định "mọi ô tìm-kiếm-gõ-chọn mới từ giờ trở đi phải dùng cơ chế `sdd*`/
`renderPeopleMultiSelect()`" (đợt thay 19 điểm `<datalist>` trước đây). Rà soát lại toàn bộ màn "Hệ Thống
> Quy Trình & Phê Duyệt" phát hiện 2 hàm dựng UI vẫn còn "box chọn" kiểu checkbox-list cũ cho bước chọn
người duyệt (chưa dùng widget này):

1. **`renderWorkflowTab()`** (`module-ngansach.js`) — nhánh theo PHÒNG BAN, dùng chung cho MỌI module
   `WF_MODULE_CONFIG` không theo tier: Tài liệu, Văn Bản Trình, Đăng Ký Xe, Mua Bán/Sửa Chữa VP, Văn
   Phòng Phẩm, Hợp Đồng (Phê Duyệt + Quản Lý HĐ), Hỗ Trợ IT Duyệt Giá (nhánh Bán Lẻ), Ngân Sách, Vận Hành
   (Mở Mới/Sửa Chữa Siêu Thị + 2 giai đoạn Dự Toán) — trước đây mỗi bước hiện 1 khối checkbox tách
   "người cùng phòng ban" (hiện sẵn) / "người phòng khác" (ẩn sau nút "▾ Hiện thêm").
2. **`renderItPriceTierWorkflowTab()`** (`module-itsupport-tier.js`) — nhánh theo MỨC/TIER cố định: Hỗ
   Trợ IT Duyệt Giá (nhánh Bán Buôn, 4 mức Margin/Chiết Khấu), Vận Hành > Đặt Hàng Tại Siêu Thị (3 mức
   giá trị), Vận Hành > Đặt Hàng Tại HO (2 mức giá trị) — trước đây mỗi bước hiện checkbox "đã tick"
   (hiện sẵn) + phần "chưa tick" ẩn sau nút "▾ Hiện thêm".

Cả 2 hàm trên **đã chuyển hẳn sang `renderPeopleMultiSelect()`** (ô gõ tìm theo tên/username/phòng ban +
chọn nhiều, hiện dạng chip có nút xoá) — mỗi bước 1 widget riêng (container `wfApproverPicker_<phòng
ban>_<bước>` / `wfTierApproverPicker_<tier>_<bước>`), backing bằng checkbox ẩn mang đúng `data-dept`/
`data-tier` + `data-step` như cũ để **không đổi gì** ở `collectDeptWorkflowConfig()`/
`collectItPriceTierWorkflowConfig()`/`saveDeptWorkflowConfig()`/`saveItPriceTierWorkflowConfig()`/
`saveAllDeptWorkflowConfigs()` — chỉ đổi Ô NHẬP, giữ nguyên 100% dữ liệu lưu vào
`DB.deptWorkflows`/`DB.itPriceDeptWorkflows`/`DB.budgetDeptWorkflows`/... /`DB.operationOrderStoreTierWorkflows`/
`DB.operationOrderHOTierWorkflows`/`DB.itPriceTierWorkflows`. Xoá kèm hàm `toggleWfOtherDeptCandidates()`
(nút "Hiện thêm/Ẩn bớt" cũ, không còn nơi nào gọi tới sau khi chuyển đổi).

**Đã xác nhận KHÔNG cần sửa** (đã dùng đúng `renderPeopleMultiSelect()` từ trước, không thuộc đợt này):
"Quản Lý Nhóm Phê Duyệt Trình" (`DB.submissionApprovalGroups`) và "Nhóm Phê Duyệt HĐ"
(`DB.contractApprovalGroups`) ở `module-admin-submissiongroups.js`, cùng khối chọn thành viên nhóm phân
quyền (`module-admin-permgroups.js`) và các ô chọn nhiều người khác đã dùng widget này (Công Việc, Văn
Bản Trình lớp bổ sung...).

**Kiểm thử**: `node -c` toàn bộ file JS đã sửa, quét trùng tên hàm top-level `public/js/*.js` (0 trùng
mới), chạy lại TOÀN BỘ `tests/test-*.js` — chỉ còn đúng 2 lỗi cũ đã biết (không kết nối được SQL Server
`localhost:1433` khi chạy ngoài môi trường có SQL Server thật), không phát sinh lỗi mới. Demo Playwright
thật (ảnh chụp ở `server/demo-screenshots/approver-picker-searchable/`, thư mục này KHÔNG commit vào git
— đã có sẵn trong `.gitignore`): so sánh trực tiếp UI checkbox-list CŨ (chạy lại đúng code trước khi sửa
qua `git show HEAD:...`) với UI widget MỚI cho cả nhánh phòng ban (Tài liệu) lẫn nhánh tier (Đặt Hàng Tại
Siêu Thị) — gõ tìm lọc, chọn 2 người, bấm Lưu, rồi đọc lại `DB.deptWorkflows`/`DB.operationOrderStoreTierWorkflows`
VÀ payload `POST /api/data/...` thực gửi đi: đúng NGUYÊN 2 người vừa chọn ở cả 2 bản CŨ/MỚI, chứng minh
đổi ô nhập không đổi dữ liệu lưu.

**Tác động deploy**: THUẦN client-side (`public/js/module-ngansach.js`, `public/js/module-itsupport-tier.js`,
`public/js/core.js` — chỉ xoá 1 dòng tra cứu hàm không dùng nữa). KHÔNG đổi `server/sql/schema.sql`,
KHÔNG thêm biến `.env`, KHÔNG đổi `dependencies` trong `package.json` — chỉ cần copy code (bao gồm 3 file
`.js` trong `public/js/`) + không cần `pm2 restart` bắt buộc (file tĩnh phục vụ qua Express static, người
dùng chỉ cần tải lại trang là thấy bản mới — nhưng vẫn nên `pm2 restart` theo đúng quy trình chuẩn ở
`HUONG_DAN_DEPLOY_UBUNTU.md` mục 12 để chắc chắn không có cache tầng trung gian nào giữ bản cũ).

## Cập nhật gần nhất trước đó — Siết CSP (bỏ 'unsafe-inline' script-src/style-src) + vá lỗ hổng CSP script-src-attr chặn nhầm Protected View + 3 tối ưu hiệu năng nạp module (2026-09-06)

**Bối cảnh**: 4 agent nghiên cứu song song (kích thước/thành phần bundle, XSS, CSP, hiệu năng) đã rà
soát toàn bộ mã nguồn ở đợt trước (chỉ nghiên cứu, không sửa gì) — người dùng duyệt kết quả tổng hợp và
yêu cầu triển khai 3 việc cùng lúc: (A) vá 1 lỗ hổng CSP có thật, (B) 3 tối ưu hiệu năng an toàn, (C) siết
CSP bỏ hẳn `'unsafe-inline'` khỏi `script-src`/`style-src`.

**A — Vá lỗ hổng CSP `script-src-attr` chặn nhầm tính năng "Protected View" (ưu tiên cao nhất)**:
`lib/securityHeaders.js` đặt `scriptSrcAttr: ["'none'"]` từ 1 đợt trước, dựa trên 1 lượt audit CHỈ kiểm
4 tên thuộc tính `onclick=`/`onchange=`/`oninput=`/`onsubmit=` — bỏ sót đúng **21 điểm** còn lại dùng
`oncontextmenu=`/`onkeydown=`/`onfocus=` (audit trước ước tính 20, kiểm đếm thực tế ra 21: 13×
`oncontextmenu="return false;"` ở khung "Protected View" `Tài Liệu`/`Ngân Sách`/`Thanh Toán`/`Báo Cáo
Định Kỳ` + `index.html`, 7× `onkeydown="if(event.key==='Enter'){...}"` ở các ô "gõ rồi bấm Enter"
(mời đào tạo, phòng ban tham gia quy trình, chức danh loại trừ VPP, bình luận Nhịp Sống nội bộ), 1×
`onfocus="pmsFilter(...)"` chết trùng lặp cạnh bản `data-op-input` đã đúng — xem `core.js`).

**Xác minh THỰC TẾ trước khi sửa** (Playwright thật + server thật, helmet thật, không giả lập): mở khung
"Protected View" 1 tài liệu, click phải — context menu **VẪN HIỆN** (tính năng chặn click phải bị vô
hiệu hoàn toàn), console có đúng 4 thông báo CSP thật `"Refused to execute inline event handler...
script-src-attr 'none'"`. Xác nhận đúng giả thuyết: lỗ hổng CSP âm thầm vô hiệu hoá 1 tính năng bảo mật
(chống copy tài liệu), không phải hình thức.

**Sửa**: bỏ hết 21 thuộc tính onXxx= còn lại, thay bằng 2 cơ chế delegation MỚI (mirror `bindCspDelegation()`
đã có sẵn cho click/change/input/submit) — `data-no-ctxmenu` (1 listener `contextmenu` DUY NHẤT trên
`document`, `closest()` theo thuộc tính này) và `data-op-enterkey` (1 listener `keydown` DUY NHẤT, dùng
lại nguyên `cspDispatchOp()`/quy ước `data-arg0`...) — cả 2 định nghĩa ở `core.js`. Xoá hẳn `onfocus="pmsFilter(...)"`
chết (xác minh: `data-op-input="pmsFilter"` đã xử lý đủ, `onfocus` chưa từng thực thi được do CSP nên xoá
không đổi hành vi thực tế nào). Xác minh LẠI sau fix (cùng kịch bản Playwright thật): click phải bị chặn
đúng, Enter-để-thêm hoạt động đúng, 0 vi phạm CSP.

**B — 3 tối ưu hiệu năng an toàn**:
1. Chuyển `downloadXlsxFromServer()` (từ `module-admin-userstaging.js`) và `scopeFromForm()` (từ
   `module-admin.js`) sang `core.js` (luôn nạp eager) — trước đây nằm trong cụm lazy-load
   "admin-permgroups", bị `module-vanhanh.js`/`module-dongphuc.js`/`module-hcrcdonghanh.js`/
   `module-logsystem-trash.js`/`module-baocaoquantri(-preview).js` gọi THẲNG (không qua `ensureFnReady()`)
   buộc phải nạp kéo theo TOÀN BỘ cụm đó (315KB/82KB gzip) + module Đào Tạo 205KB không liên quan (qua
   vòng phụ thuộc SCC). Đồng thời bọc `populateTrainingCategorySelects()` (module.js gọi từ `admin.js`)
   qua `ensureFnReady()` — tách nốt cạnh phụ thuộc còn lại giữa `admin.js` và Đào Tạo. Xác minh lại bằng
   công cụ AST/SCC thật (tự viết, tái tạo đúng 100% `MODULE_LOAD_GROUPS` gốc trước khi tin kết quả sau
   sửa) — cụm "admin-permgroups" 6 file TÁCH thành 4 cụm độc lập, `vanHanh` hết còn phụ thuộc cụm đó.
   **Đo thật** (Playwright network listener, mở tab Vận Hành lần đầu 1 phiên): **763.873 → 448.394 bytes
   gốc (giảm 41,3%)**, **≈194.818 → 112.367 bytes gzip (giảm 42,3%, ≈82KB)** — 6 file (đủ 5 file cụm
   admin-permgroups + module Đào Tạo 205KB) không còn tải khi mở Vận Hành nữa.
2. PDF.js: đổi `import` TĨNH trong `<script type="module">` (cuối `index.html`) sang `import()` ĐỘNG,
   nạp LƯỜI lần đầu thực sự cần đọc/vẽ PDF (`ensurePdfJsReady()`, `core.js`, cache theo Promise) — trước
   đây tải sẵn ~1MB ngay lúc mở trang dù phần lớn phiên không xem PDF nào. Cập nhật 3 điểm
   `module-vanhanh.js`/`module-baocaodinhky-trinhchieu.js` (2 chỗ) từng polling `while(!window.pdfjsLib)`
   sang `await ensurePdfJsReady()`.
3. `module-baocaodinhky-trinhchieu.js`: `loadPrPdfLibs()` (dùng cho `downloadPrPdf()`) đổi sang gọi
   `loadVendorScript()` dùng chung (đã cache theo src) thay vì tự dựng `loadScript()`/Promise cache
   RIÊNG — trước đây bấm cả "Tổng Hợp Theo Công Việc" (PDF) lẫn "Tải PDF" trình chiếu trong CÙNG 1 phiên
   tải trùng 2 lần html2canvas+jspdf.

**C — Siết CSP: bỏ `'unsafe-inline'` khỏi CẢ `script-src` LẪN `style-src`** (`lib/securityHeaders.js`):
- 2 khối `<script>` nội tuyến còn lại trong `index.html` (dòng set `copyrightYear` + khối bootstrap
  PDF.js) đã chuyển hết vào `core.js` — file này giờ không còn `<script>` nội tuyến nào.
- 1 khối `<style>` nội tuyến lớn (~386 dòng CSS tuỳ biến toàn app, đầu `index.html`) chuyển nguyên vẹn
  sang file ngoài MỚI `public/app.css` (nạp qua `<link>`).
- 7 thuộc tính `style="..."` TĨNH trong `index.html` (nền gradient màn chờ, cỡ chữ, icon SVG, lưới PDF,
  thanh tiến độ, khung video 16:9) đổi sang class CSS thật trong `app.css`.
- **Phát hiện thêm ngoài phạm vi audit ban đầu** (audit trước chỉ nêu vài điểm ví dụ "watermark Protected
  View"/"màu mẫu trình chiếu"): rà lại TOÀN BỘ `public/js/*.js` thấy tổng cộng **~45 điểm** dùng
  `style="..."` ĐỘNG (giá trị đổi theo dữ liệu) rải khắp `module-baocaodinhky-trinhchieu.js` (mẫu màu
  trình chiếu, ~19 điểm), `module-tailieu.js`/`module-thanhtoan.js` (watermark, 3 điểm),
  `module-baocaoquantri(-preview).js`/`module-vanhanh.js` (thanh tỷ lệ %, bảng báo cáo),
  `module-bienbanhop.js`/`module-congviec.js`/`module-vpp.js` (bảng "Phiếu"/"Biên bản"), và **1 khối
  `<style>` nội tuyến hoàn toàn bị bỏ sót** trong `buildApprovalSlipShellHTML()` (`core.js`, khung
  "Phiếu Phê Duyệt" dùng chung Xe/Văn Bản Trình/Văn Phòng) — phát hiện được nhờ soát console THẬT (không
  chỉ nhìn qua code) khi demo `viewCarApprovalSlip()`, xem đúng thông báo CSP "Refused to apply inline
  style" trước khi tin là đã xong. Toàn bộ đổi sang thuộc tính `data-style="..."` (dữ liệu thuần, không
  bị CSP diễn giải) rồi gán lại qua `el.style.cssText = ...` (CSSOM qua JS, không bị `style-src` chi
  phối) bằng `applyDataStyles()` gọi tường minh ở từng điểm chèn `.innerHTML` ĐÃ RÀ SOÁT, CỘNG 1
  `MutationObserver` toàn cục (`core.js`) làm lưới an toàn thứ 2 tự động quét mọi node DOM mới chèn vào
  bất cứ đâu — phòng trường hợp lỡ sót 1 điểm nào đó trong ~700 tính năng của hệ thống. Riêng khối
  `<style>` của `buildApprovalSlipShellHTML()`: nội dung CSS tách thành hằng số `APPROVAL_SLIP_CSS`
  (`core.js`) — vừa copy sang `app.css` (phục vụ màn xem trực tiếp trong app), vừa được 5 hàm
  `downloadXxxApprovalSlip()`/`downloadTaskSlip()`/`downloadMeetingMinutes()` (tải "Phiếu"/"Biên bản"
  thành file `.html` ĐỘC LẬP, mở lại sau không có JS nào của app chạy kèm) tự nhúng lại/khôi phục qua
  `standaloneHtmlRestoreStyles()` (đổi `data-style="..."` ngược lại `style="..."` bằng chuỗi thuần tuý
  NGAY TRƯỚC khi tạo Blob) — các file `.html` tải về vẫn hiển thị đúng, độc lập hoàn toàn với CSP của
  app này (mở qua `file://`, không qua server).
- `lib/securityHeaders.js`: `scriptSrc`/`styleSrc` bỏ hẳn `'unsafe-inline'`.

**Kiểm chứng**: `node -c` mọi file server đã sửa; soát cân bằng `<div>`/trùng `id`/trùng tên hàm top-level
toàn bộ `public/js/*.js` (0 trùng); chạy TOÀN BỘ 63 file `tests/test-*.js` — 61 PASS, đúng 2 FAIL đã biết
trước do KHÔNG có SQL Server thật trong môi trường này (`Failed to connect to localhost:1433`), không có
lỗi MỚI nào; smoke thật qua Playwright (server thật + `lib/securityHeaders.js` thật) mở 9+ tab (Tài
Liệu/Công Việc/Hợp Đồng/Xe/Vận Hành/Hệ Thống/Báo Cáo/Ngân Sách/Hỗ Trợ IT), mở khung Protected View, xem
Phiếu Phê Duyệt Xe — console sạch hoàn toàn, 0 vi phạm CSP. Ảnh chụp Playwright thật lưu tại
`server/demo-screenshots/csp-perf-hardening/`: click-phải bị chặn trước/sau fix, giảm tải mạng thật của
tab Vận Hành (763.873→448.394 bytes), console sạch qua phiên nhiều tab.

**Tác động triển khai**: KHÔNG cần thao tác gì ngoài copy code + `pm2 restart` — không đổi
`server/sql/schema.sql`, không thêm biến môi trường mới (`server/.env.example` không đổi), không thêm/đổi
`dependencies` trong `server/package.json` (chỉ đổi field `version`). File tĩnh mới `public/app.css` tự
được `express.static` phục vụ, không cần cấu hình gì thêm ở Nginx/PM2.

## Cập nhật trước đó — Vận Hành > 📦 Đơn Hàng: tách "Đặt Hàng Tại Siêu Thị"/"Đặt Hàng Tại HO" + duyệt theo mức giá trị đơn hàng (2026-09-06)

Theo yêu cầu người dùng: tách sub-tab "📋 Danh Sách" (gộp chung Siêu Thị + HO) thành 2 sub-tab RIÊNG —
"🏬 Đặt Hàng Tại Siêu Thị"/"🏢 Đặt Hàng Tại HO" — cộng với "📊 Báo Cáo" (mở rộng) thành 3 sub-tab, và đổi
HẲN quy trình duyệt `operationOrders` từ theo PHÒNG BAN (`operationOrderDeptWorkflows`) sang theo MỨC GIÁ
TRỊ đơn hàng, 2 quy trình TÁCH RIÊNG hoàn toàn cho 2 luồng trên (không dùng chung người duyệt) — mirror
đúng kỹ thuật tier-based đã có sẵn cho Hỗ Trợ IT > Bán Buôn (`itPriceTierWorkflows`/
`resolveItPriceTierWorkflowConfig()`), với 1 khác biệt quan trọng: mức ở đây **tự tính từ chính số tiền
đơn hàng** (KHÔNG có ô chọn tay như `priceTier` của ITPRICE, vì mức hoàn toàn suy ra được từ dữ liệu sẵn
có) — server LUÔN tự tính lại (`computeOperationOrderTier()`, `lib/workflowEngine.js`), không tin bất kỳ
giá trị mức nào (nếu có) client tự gửi kèm.

**Biên giới mức đã chốt** (mốc đúng bằng luôn rơi vào mức CAO HƠN):
- **Đặt Hàng Tại Siêu Thị** (3 mức): `< 10.000.000đ` (`LT10M`) | `10.000.000đ` – `< 100.000.000đ`
  (`FROM10M_TO100M`) | `>= 100.000.000đ` (`GTE100M`).
- **Đặt Hàng Tại HO** (2 mức): `< 100.000.000đ` (`LT100M`) | `>= 100.000.000đ` (`GTE100M`).
- Số tiền căn cứ (`computeOperationOrderAmount()`): ưu tiên `paymentTotalAmount` (Tổng Giá Trị Thanh
  Toán, đọc từ PDF NCC) nếu > 0, rơi về `amount` (tổng hạng mục, server tự tính lại) khi tạo tay không
  kèm PDF.

**Field mới** `item.orderLocationType` (`STORE`/`HO`) — bắt buộc, gắn NGẦM theo đúng sub-tab đang mở lúc
tạo (không có dropdown chọn tay, cùng cơ chế `priceType` của itPriceApprovals) — `lib/createValidation.js`
throw 400 nếu thiếu/sai giá trị. Hồ sơ CŨ trước đợt này không có field -> di trú 1 lần
(`migrateOperationOrdersDefaultLocationType()`, `seedDefaults.js`, idempotent, chạy mỗi lần khởi động)
gán mặc định `'HO'` (lựa chọn AN TOÀN hơn `'STORE'` vì HO chỉ 2 mức rộng, tránh vô tình rơi vào mức thấp
nhất "< 10 triệu" — chỉ Siêu Thị mới có — của 1 đơn có thể giá trị lớn mà chưa admin nào cấu hình).

**2 collection AppData MỚI** (admin-only-write, `routes/data.js`) thay hẳn cho
`operationOrderDeptWorkflows` (đã XOÁ HẲN khỏi `defaults.js`/admin UI — không còn nơi nào đọc/ghi tới):
`operationOrderStoreTierWorkflows` (3 khoá tier) và `operationOrderHOTierWorkflows` (2 khoá tier), cùng
khuôn phẳng `{ [tierKey]: {workflowId, approvers} }` với `itPriceTierWorkflows`. 2 tab admin MỚI ở "Quy
Trình & Phê Duyệt" (`OPERATION_ORDER_STORE`/`OPERATION_ORDER_HO`, cờ `pureTier: true` mới thêm vào
`renderWorkflowTab()` để render thẳng theo tier, không cần điều kiện `activeWfSubmissionType==='WHOLESALE'`
như ITPRICE) mirror đúng UI `renderItPriceTierWorkflowTab()` đã có sẵn — tái dùng nguyên hàm, không viết
lại. Nhân tiện vá 1 lỗ hổng nhỏ liên quan: `deleteWorkflowTemplate()` trước đây chỉ quét usage của mẫu
quy trình ở map dept-based (`cfg.dbKey`), bỏ sót hẳn các collection theo tier (`cfg.tierDbKeyForWholesale`)
— giờ quét cả 2, tránh để lại tham chiếu treo khi xoá 1 mẫu đang được gán cho 1 mức tier.

**Client** (`public/js/module-vanhanh.js`): `activeOperationOrderSubTab` đổi từ 2 giá trị (`LIST`/`REPORT`)
sang 3 (`STORE`/`HO`/`REPORT`) — `STORE`/`HO` dùng CHUNG 1 khối DOM (`#opOrderListPanel`: form tạo/bộ
lọc/bảng danh sách) y hệt cơ chế sub-tab "Bán Lẻ"/"Bán Buôn" của `module-itsupport-price.js`
(`activeItPriceSubTab`) thay vì nhân đôi HTML — khác biệt duy nhất là `orderLocationType` gắn ngầm +
lọc theo loại khi render danh sách/dashboard card. Mọi chỗ trước đây tra `DB.operationOrderDeptWorkflows[o.dept]`
(6 chỗ: `canManageOperationOrderReceiptClient()`, `notifyOperationApprovalNeeded()`, `renderOperationList()`,
`buildOperationRowHTML()`, `openOperationProcessModal()`, `renderOperationOrderReport()`) đổi sang gọi
`resolveOperationOrderWorkflowConfigForItemClient(o)` (mirror server, `core.js`) — resolve theo TỪNG hồ
sơ thay vì map phẳng theo dept.

**Báo Cáo mở rộng** (`renderOperationOrderReport()`): giữ nguyên "Tổng Chuỗi" (toàn bộ đơn, không đổi ý
nghĩa các thẻ cũ), thêm 2 khối con "🏬 Đặt Hàng Tại Siêu Thị"/"🏢 Đặt Hàng Tại HO" (cùng bộ số liệu, tách
theo `orderLocationType`) VÀ bảng MỚI "📍 Số Đơn Theo Từng Siêu Thị (Nơi Nhận)" (nhóm theo
`receivingLocationName`: tổng số đơn + đã nhận hàng + tổng giá trị mỗi nơi, cộng 1 dòng "🔗 TỔNG CHUỖI").

**Tương thích ngược:** `receiveOperationOrderGoods()`/`cancelOperationOrderReceipt()`/
`canViewOperationOrder()` (Nhập Hàng/Hủy Nhập, xem hồ sơ) đều gọi thẳng
`MODULE_CONFIGS.operationOrders.resolveWfConfig()` sẵn có — tự động dùng đúng logic tier mới, KHÔNG cần
sửa gì thêm ở 2 file đó. `editOperationOrderDraft()`/`submitOperationOrderDraft()` ("Sửa & Gửi Lại Bổ
Sung") không đổi gì (không đụng `orderLocationType`) — mức tự tính lại đúng nếu `amount` đổi sau khi sửa
(không lưu tier thành field riêng, luôn tính trực tiếp từ `orderLocationType` + `amount`/`paymentTotalAmount`
hiện có trên hồ sơ).

**Test mới:** `tests/test-operation-order-location-tiers.js` (20 kịch bản — biên giới mức ở CẢ 2 phía đúng
mốc 10 triệu/100 triệu, 2 luồng Siêu Thị/HO tách biệt hoàn toàn kể cả cùng số tiền, chống giả mạo field
tier phía client, di trú hồ sơ cũ). `tests/test-operation-order-report.js`/
`tests/test-operation-order-receiving.js`/`tests/test-operation-order-po-fields.js` cập nhật để dùng
`operationOrderHOTierWorkflows`/`orderLocationType` thay cho dept-workflow cũ. Demo Playwright mới:
`tests/demo-operation-order-store-ho-split.js` (ảnh chụp ở
`demo-screenshots/operation-order-store-ho-split/`).

## Cập nhật trước đó — Vận Hành > 📦 Đơn Hàng: sub-tab "📊 Báo Cáo" + giai đoạn "Chờ Nhập Hàng" sau khi duyệt (2026-09-06)

Theo yêu cầu người dùng: tách màn "📦 Đơn Hàng" thành 2 sub-tab ("📋 Danh Sách" — màn cũ nguyên vẹn — và
"📊 Báo Cáo" mới), thêm 1 giai đoạn MỚI sau khi duyệt xong ("Chờ Nhập Hàng" → "Nhập Hàng"/"Hủy Nhập"), và
thêm bộ lọc theo "Siêu Thị (Nơi Nhận)" — dựa trên field `receivingLocationName` đã có từ đợt PDF autofill
(commit ngay trước, `da8403f`). **KHÔNG đụng gì tới quy trình duyệt PENDING theo phòng ban gốc** (đúng yêu
cầu tường minh của người dùng) — đây chỉ là 1 giai đoạn TIẾP THEO, bắt đầu SAU KHI đã duyệt xong.

**Trạng thái mới (`lib/workflowEngine.js` `applyWorkflowAction()`):** duyệt xong bước CUỐI của
`operationOrders` giờ KHÔNG dừng ở `APPROVED` như mọi module khác nữa — tự động chuyển tiếp sang
`AWAITING_RECEIPT` ("⏳🚚 Chờ nhập hàng") ngay trong cùng 1 lượt xử lý, ghi thêm `approvedAt` (ISO, khác
`history[].time` dạng `vi-VN` không tiện sort/nhóm) để Báo Cáo nhóm "theo tháng" mà không phải tự parse
ngược lịch sử. Chỉ đúng `moduleKey === 'operationOrders'` bị ảnh hưởng — mọi module khác (carRegs, docs,
submissions...) vẫn dừng ở `APPROVED` y hệt trước (có test regression riêng xác nhận điều này).

**2 hành động MỚI, TÁCH RIÊNG khỏi engine duyệt PENDING** (`lib/recordActions.js`
`receiveOperationOrderGoods()`/`cancelOperationOrderReceipt()`, route
`POST /api/records/operationOrders/:id/receive-goods|cancel-receipt` ở `routes/records.js` — KHÔNG đi qua
`POST /api/workflow/.../approve|reject` vì hàm đó chỉ nhận hồ sơ đang `PENDING`):
- **"📥 Nhập Hàng"** → `RECEIVED` ("✅ Đã nhập hàng", coi như KẾT THÚC đơn) + `receivedAt` (ISO).
- **"🚫 Hủy Nhập"** → `RECEIPT_CANCELLED` ("🚫 Đã hủy nhập" — hàng không về thực tế, KHÁC `REJECTED`: đó là
  bị từ chối ngay ở bước duyệt, trước khi có gì để nói tới việc nhập hay không) + `receiptCancelledAt`
  (ISO) + bắt buộc lý do.
- Cả 2 CHỈ nhận từ đúng `AWAITING_RECEIPT` (409 nếu sai trạng thái nguồn, kể cả gọi lại lần 2 sau khi đã
  xử lý xong).
- **Quyền thao tác — quyết định thiết kế:** MIRROR đúng quần thể được phép Duyệt/Từ chối đơn hàng đó (admin
  hoặc có tên ở BẤT KỲ bước nào trong dept-workflow của phòng ban hồ sơ) — KHÔNG mở thêm cho người tạo đơn
  (thường là người đi mua/đặt hàng, khác vai trò xác nhận nhập kho). Đây là lựa chọn hợp lý nhất với dữ
  liệu hiện có (không có bảng "nhân sự phụ trách kho theo từng nơi nhận" nào để gán chính xác hơn) — nếu
  thực tế nghiệp vụ cần người khác (VD nhân viên kho tại chính siêu thị đó) thao tác, cần bổ sung 1 khái
  niệm quyền mới ở đợt sau.

**Hồ sơ CŨ đã ở `APPROVED` từ trước đợt này** (di trú 1 lần, idempotent — `migrateApprovedOperationOrdersToAwaitingReceipt()`,
`seedDefaults.js`, chạy mỗi lần khởi động): tự chuyển sang `AWAITING_RECEIPT` (không suy đoán đã nhận hàng
hay chưa), `approvedAt` lấy lại từ dòng lịch sử `APPROVED` cuối cùng nếu parse được (không thì dùng thời
điểm di trú), ghi thêm 1 dòng `SYSTEM_MIGRATION` — nếu không di trú, hồ sơ cũ sẽ kẹt vĩnh viễn không bao
giờ thấy được 2 nút mới và lọt khỏi mọi ô đếm Báo Cáo.

**Sub-tab "📊 Báo Cáo"** (`renderOperationOrderReport()`, `public/js/module-vanhanh.js`) — mirror phong
cách "Báo Cáo Quản Trị" (bộ lọc khoảng ngày + thẻ tổng hợp + thanh tỷ lệ ngang thay biểu đồ thư viện
ngoài, viết 1 bản cục bộ `buildOpOrderStatBarHTML()` thay vì gọi thẳng `buildStatBarHTML()` ở
`module-baocaoquantri.js` vì cụm nạp module lười "vanhanh" không khai deps tới cụm đó), sống NGAY TRONG
màn Đơn Hàng (không gộp vào module "Báo Cáo" top-level riêng, đúng yêu cầu):
- Lọc theo khoảng ngày TẠO đơn + "Siêu Thị (Nơi Nhận)".
- 7 thẻ đếm: Tổng Số Đơn / Đã Phê Duyệt (`APPROVED`+`AWAITING_RECEIPT`+`RECEIVED`+`RECEIPT_CANCELLED` — cả
  3 trạng thái sau đều ĐÃ qua xong bước duyệt phòng ban) / Chưa Phê Duyệt (`PENDING`+`DRAFT`) / Bị Từ Chối
  (`REJECTED`, tách riêng khỏi "chưa phê duyệt" — đây là kết quả đã CHỐT) / Chờ Nhập Hàng / Đã Nhập Hàng /
  Đã Hủy Nhập.
- 2 tổng giá trị: Đơn Đã Phê Duyệt (dùng `amount` — tổng luôn có sẵn từ hạng mục, không phải
  `paymentTotalAmount` optional từ PDF) và Đơn Đã Nhập Hàng.
- 2 khối "theo tháng" (nhóm theo `approvedAt`/`receivedAt`, KHÁC `createdAt` — 1 đơn tạo trong khoảng lọc
  nhưng duyệt/nhập hàng ở tháng khác vẫn lên đúng tháng sự kiện đó).

**Lọc "Siêu Thị (Nơi Nhận)"** — quyết định thiết kế: dùng danh sách GIÁ TRỊ THỰC TẾ đã có trong
`receivingLocationName` (free-text đọc từ PDF NCC), KHÔNG đối chiếu "Danh Mục Siêu Thị" (`DB.stores`,
`lib/storeCatalogImport.js`) vì field này chưa từng được validate khớp danh mục đó lúc tạo — dùng
`DB.stores` làm nguồn dropdown rất dễ khiến bộ lọc "không khớp gì cả" nếu tên PDF parse ra khác cách viết
trong danh mục. Áp dụng cho CẢ Danh Sách lẫn Báo Cáo (không chỉ Báo Cáo — theo đúng cách hiểu ngữ nghĩa
"bộ lọc chung", không phải riêng cho báo cáo).

**Bug tiện thể vá — dropdown "Khác ▾" của Vận Hành chưa từng hoạt động qua click:** phát hiện khi viết
demo — `module-vanhanh.js` tự dựng 1 hệ thống dispatch CSP riêng (`OP_CHANGE_ACTIONS`, KHÔNG dùng
`bindCspDelegation()`/`window[fnName]` chung của `core.js`) nhưng THIẾU khoá `handleActionCellDispatch`
(hàm dùng chung cho MỌI dropdown "Khác ▾" ở `buildActionCell()`) — nghĩa là "🗑️ Xóa" (đã có sẵn cho
`operationOrders` từ trước) chưa BAO GIỜ chạy được khi chọn qua dropdown thật (sự kiện `change` nổi bọt
lên `#vanHanhSection` nhưng bị bỏ qua lặng lẽ, không lỗi gì). Vá tại `OP_CHANGE_ACTIONS` (thêm 1 dòng,
dùng `cspCoerceArg()` có sẵn ở `core.js` để ép đúng kiểu tham số `id`) — 2 nút MỚI "Nhập Hàng"/"Hủy Nhập"
đi qua đúng dropdown này nên nếu không vá thì cũng sẽ không hoạt động.

**Sweep các nơi đếm/lọc `operationOrders` theo status khác:** `public/js/core-approvalhub.js`
`getMyProcessedApprovals()` — mục "Hồ Sơ Đã Xử Lý > Đã Duyệt" ở Approval Hub trước đây so khớp cứng
`rec.status === 'APPROVED'`, nếu không sửa sẽ KHÔNG BAO GIỜ còn thấy đơn hàng nào ở đây (status đã đổi
tiếp ngay sau khi duyệt) dù người dùng thực sự đã duyệt — thêm tham số `matchStatuses` (mặc định vẫn so
đúng `[status]` như cũ cho MỌI module khác) để `operationOrders` so khớp cả nhóm
`APPROVED`/`AWAITING_RECEIPT`/`RECEIVED`/`RECEIPT_CANCELLED` khi lọc "Đã duyệt". `addDeptWorkflowItems()`
("đang chờ tôi duyệt") không cần sửa — đã chỉ nhận đúng `status === 'PENDING'` từ trước.

Test mới:
- `tests/test-operation-order-receiving.js` (thuần Node, không Playwright) — 16 kịch bản: quy trình duyệt
  PENDING→APPROVE/REJECT không hồi quy (kể cả bước giữa của quy trình nhiều bước KHÔNG bị tự chuyển
  `AWAITING_RECEIPT`, chỉ đúng bước CUỐI mới chuyển, và module KHÁC — carRegs — hoàn toàn không bị ảnh
  hưởng), `receiveOperationOrderGoods()`/`cancelOperationOrderReceipt()` đúng quyền/đúng trạng thái nguồn,
  và di trú hồ sơ cũ (`migrateApprovedOperationOrdersToAwaitingReceipt()`) đúng + idempotent.
- `tests/test-operation-order-report.js` (Playwright, `tests/testHarness.js` — mở rộng thêm
  `operationOrderDeptWorkflows` vào `buildAppDataForCreate()` + 2 action handler `receive-goods`/
  `cancel-receipt` gọi thẳng hàm thật) — 20 kịch bản: tạo/duyệt/từ chối/nhập hàng/hủy nhập qua ĐÚNG luồng
  UI thật, nút mới chỉ hiện + chỉ hoạt động đúng quyền/trạng thái, đếm/tổng giá trị/nhóm theo tháng ở Báo
  Cáo đúng số liệu tay tính trước, lọc Siêu Thị thu hẹp đúng cả Danh Sách lẫn Báo Cáo, chuyển sub-tab qua
  lại không lỗi.

Demo Playwright thật (dùng `tests/testHarness.js` — sandbox không có SQL Server/Docker để chạy server
thật, xem ghi chú đầu file) — tạo 4 đơn hàng ở 2 siêu thị khác nhau, duyệt 3 đơn, 1 đơn Nhập Hàng xong
(RECEIVED), 1 đơn Hủy Nhập (RECEIPT_CANCELLED), 1 đơn còn Chờ Nhập Hàng — ảnh lưu ở
`server/demo-screenshots/operation-order-report-receiving/`: (01) sub-tab Danh Sách + badge trạng thái
mới, (02a/02b) dropdown "Khác ▾" + modal xác nhận Nhập Hàng thật, (03) sub-tab Báo Cáo, (04) lọc Siêu Thị
thu hẹp danh sách.

Xác minh: bộ hồi quy đầy đủ 64 file `tests/test-*.js` — 62 qua, đúng 2 lỗi biết trước do sandbox không có
SQL Server thật (không liên quan thay đổi này, giống mọi lần chạy trước).

**Deploy: không cần thao tác gì ngoài copy code + `pm2 restart`** — không đổi `schema.sql` (dữ liệu vẫn là
JSON qua `dbo.Records`, chỉ thêm field/status mới, không cột SQL nào), không đổi `.env.example`, không
thêm/đổi `dependencies`. Có 1 điểm cần biết: `migrateApprovedOperationOrdersToAwaitingReceipt()`
(`seedDefaults.js`) sẽ TỰ ĐỘNG chuyển mọi đơn hàng đang ở `APPROVED` sang `AWAITING_RECEIPT` ngay lần
restart tới (thay đổi dữ liệu thật, một chiều, đúng ý — cùng khuôn di trú `migrateStuckOperationApprovalStatuses()`
đã có từ đợt trước) — người dùng nên biết trước khi restart nếu hệ thống thật đang có đơn hàng đã duyệt.

## Cập nhật trước đó — Vận Hành > 📦 Đơn Hàng: đọc PDF phiếu đặt hàng NCC tự động điền form (2026-09-06)

Theo yêu cầu người dùng: khi lập "Đơn Hàng" (`operationOrders`), upload file phiếu đặt hàng NCC (PDF) ở
form tạo mới thì ứng dụng **tự đọc và điền TOÀN BỘ field** (không chỉ vài field) để người dùng chỉ cần
kiểm tra lại rồi gửi phê duyệt, không phải gõ tay lại từ đầu. Xác nhận qua PDF mẫu người dùng cung cấp
(`120HT_PO.pdf`) và lời xác nhận trực tiếp: **chỉ 1 mẫu/1 hệ thống NCC duy nhất** — không cần tổng quát
hoá cho định dạng khác.

**Phát hiện kỹ thuật cốt lõi:** PDF mẫu dùng phông chữ Việt kiểu cũ (họ TCVN3/.VnTime, dấu câu chữ Việt
nằm ở dải mã 0xA0-0xFF) mà không có bảng ToUnicode CMap đúng — lớp text mà `pdfjs-dist` (đã vendor sẵn ở
`public/vendor/pdfjs/pdf.mjs`, dùng chung với `renderPdfProtected()`) trích ra qua `getTextContent()` bị
"mojibake" (SAI bảng mã ở ĐÚNG vị trí, không phải thiếu dữ liệu) — VD ký tự thô `μ` luôn là `à`, `§` luôn
là `Đ`. Đối chiếu ký tự-theo-ký-tự giữa bản PDF.js trích ra và bản văn bản đúng dựng lại được ĐẦY ĐỦ 3
bảng ánh xạ tất định: `PO_CHAR_FIXED_MAP` (ký tự thô -> đúng, cố định cả hoa/thường vì TCVN3 dùng mã
riêng cho từng dạng), `PO_CHAR_CASE_MAP` (10 ký tự chỉ thấy 1 dạng trong mẫu — viết hoa theo ngữ cảnh từ
ASCII xung quanh) và `PO_WORD_FIXUPS` (8 từ bị RỚT hẳn ký tự `ư` — lỗi rộng chiều ngang bằng 0 của dấu
móc trong phông, khác hẳn lỗi sai bảng mã). Riêng phần trích xuất thứ tự đọc: thay vì dùng thẳng thứ tự
content-stream thô (label/value có thể in xen kẽ lộn xộn), nhóm lại các text item theo toạ độ Y (dung
sai 3.2pt) rồi sắp theo X trong từng dòng — phục hồi đúng thứ tự đọc thị giác thật của phiếu.

**`lib/createValidation.js` (`operationOrders.extraValidate`):** thêm 14 field cấp đơn hàng — `poNumber`,
`orderDate`, `deliveryDate`, `ordererName`, `stationCode`, `supplierCode`, `supplierTaxCode`,
`receivingLocationCode`, `receivingLocationName`, `deliveryAddress`, `discountAmount`, `vatAmount`,
`afterDiscountAmount`, `paymentTotalAmount` — và 3 field mới ở từng hạng mục (`items[]`): `productCode`,
`barcode`, `qtyReceived`. **TẤT CẢ optional** (khớp `assertUploadedFileUrl`/`title`/`items` bắt buộc GIỮ
NGUYÊN như cũ) — hồ sơ tạo tay không upload PDF vẫn hợp lệ y hệt trước, field mới tự về `''`/`0`/`null`
(qtyReceived dùng `null` khi chưa nhập, khác `0` thật). Không đổi `schema.sql` — `operationOrders` đã nằm
trong `MIGRATED_COLLECTIONS` (`lib/recordStore.js`), lưu JSON qua `dbo.Records`, field mới tự có chỗ
chứa mà không cần cột mới nào.

**`public/index.html` + `public/js/module-vanhanh.js`:**
- Đổi nhãn "File Đính Kèm (báo giá/hợp đồng...)" (`#voFile`) thành **"File Đơn Hàng"** — giờ có hành vi tự
  đọc, không còn đơn thuần "đính kèm".
- Thêm khối gấp/mở "Chi Tiết Từ Phiếu Đặt Hàng" (`#operationOrderPoDetailsBox`) chứa 14 input mới (Số Đơn
  (NCC)/Ngày Đặt/Ngày Giao/Người Đặt/Tại Trạm/Mã NCC/MST NCC/Mã Nơi Nhận/Nơi Nhận/Địa Chỉ Giao Hàng/Giá
  Trị Chiết Khấu/Thành Tiền Sau CK/VAT/Tổng Giá Trị Thanh Toán) — 4 ô tiền dùng đúng khuôn
  `money-input`/`getMoneyValue()`/`formatMoneyDisplay()` (khớp đợt soát tiền `77173bc` vừa xong).
- Bảng hạng mục thêm 2 cột "Mã Hàng"/"Mã Vạch" + 1 cột "SL Nhận" (Thực Nhận, tách khỏi "SL Đặt" — field
  `qty` cũ giữ nguyên ý nghĩa "số lượng đặt").
- `handleOperationOrderPdfUpload()` (mới, wired qua `data-op-change` trên `#voFile`, đăng ký ở
  `OP_CHANGE_ACTIONS` — module Vận Hành dùng registry dispatch riêng, không phải `window[fnName]` chung):
  chỉ tự đọc khi file chọn là PDF thật; parse xong TỰ ĐIỀN mọi field tương ứng (kể cả field cũ
  title/supplier/items) rồi DỪNG LẠI — không tự gửi phê duyệt, người dùng vẫn tự kiểm tra + bấm nút gửi
  như cũ (cùng UX luồng import Excel đã có). Đọc lỗi/PDF không đúng mẫu/không có lớp text (scan ảnh) ->
  thông báo "Không đọc được thông tin từ file, vui lòng nhập tay" ngay tại chỗ, không throw lỗi JS thô,
  không chặn người dùng tự nhập tay tiếp.
- `buildOperationDetailsHTML()`: thêm khối "Thông tin từ phiếu đặt hàng NCC" + breakdown Chiết Khấu/Sau
  CK/VAT/Thanh Toán ở màn xem chi tiết — CHỈ hiện khi có ít nhất 1 field (hồ sơ cũ/tạo tay không hiện dãy
  "N/A" vô nghĩa), bảng hạng mục thêm 4 cột Mã hàng/Mã vạch/SL nhận tương ứng.

**`public/js/core.js` (Biểu Mẫu — `CORE_FIELD_MANIFEST.OPERATION_ORDER`):** thêm đủ 14 field mới vào bộ
trường mặc định của tab "Vận Hành - Phê Duyệt Đơn Hàng" (cùng pattern `{id, label, required:false}` như
mọi field khác trong bộ này) — admin sửa nhãn hiển thị được qua màn Biểu Mẫu giống hệt `voTitle`/
`voSupplier` đã có từ trước; xác nhận cơ chế này CHỈ tuỳ biến nhãn hiển thị + bắt buộc/không bắt buộc
(không phải điền sẵn giá trị mặc định thật/không phải 1 engine nghiệp vụ khác).

Test mới `tests/test-operation-order-po-fields.js` (thuần Node, không Playwright — gọi thẳng
`validateAndPrepareCreate('operationOrders', ...)`) xác nhận: (a) hồ sơ kiểu cũ không field mới vẫn hợp
lệ y hệt trước, (b) hồ sơ đầy đủ field lưu & đọc lại đúng (kể cả `amount` vẫn tự tính lại từ
qty×unitPrice, không bị field mới can thiệp), (c) số tiền round-trip đúng, chuỗi lạ tự về 0 an toàn
(không throw/NaN), số âm bị chặn, ngày sai định dạng tự về rỗng không crash.

Demo Playwright thật (server thật + SQL Server thật) upload đúng file mẫu `120HT_PO.pdf` vào `#voFile`
trên form thật, chụp màn hình TRƯỚC/SAU khi tự điền và sau khi nộp — ảnh lưu ở
`server/demo-screenshots/operation-order-pdf-autofill/`.

**Deploy: không cần thao tác gì ngoài copy code + `pm2 restart`** — không đổi `schema.sql` (đã xác nhận
`operationOrders` lưu JSON qua `dbo.Records`, không có cột SQL nào cần thêm), không đổi `.env.example`,
không thêm/đổi `dependencies` (`pdfjs-dist` đã có sẵn từ trước, chỉ dùng lại instance `window.pdfjsLib`
mà `renderPdfProtected()` đã nạp).

## Cập nhật trước đó — Vận Hành > Siêu Thị: xoá hẳn cơ chế "Bổ Sung" (không còn phê duyệt), vá lỗ hổng dữ liệu cũ (2026-09-05)

Theo xác nhận của người dùng: trong "Tab Siêu Thị" (2 loại hồ sơ `operationStoreOpenings`/
`operationRepairs` 🏬 Mở Mới + 🔧 Sửa Chữa, cùng "Danh Mục Đầu Tư" — `estimateStatus` — của chính 2 loại
này) **chưa bao giờ có yêu cầu phê duyệt** — đúng như Mục H (60c473b, 2026-09-04) đã làm: hồ sơ vào thẳng
`APPROVED` ngay lúc tạo, không ai cần bấm Duyệt. Việc này bỏ sót 1 nguy cơ: 2 loại hồ sơ này được thêm
sớm hơn Mục H đúng 3 ngày (b89d46e, 2026-09-01) nên có 1 khoảng hẹp đã đi qua pipeline duyệt ĐẦY ĐỦ kiểu
cũ — nếu trong 3 ngày đó có ai bấm "Yêu Cầu Bổ Sung" trên 1 hồ sơ thật, hồ sơ sẽ kẹt ở `status: 'DRAFT'`
vĩnh viễn (di trú cũ `migrateStuckOperationApprovalStatuses()`, thêm ở c02376f, chỉ tự sửa `PENDING`,
không sửa `DRAFT`) — đúng lúc cơ chế "Sửa & Gửi Lại Bổ Sung" (đường thoát DUY NHẤT khỏi DRAFT) sắp bị xoá.

**Bước 1 — vá lỗ hổng trước khi xoá gì:** mở rộng `migrateStuckOperationApprovalStatuses()`
(`seedDefaults.js`, chạy mỗi lần khởi động server) — ngoài việc tự chuyển `PENDING`→`APPROVED` như cũ,
nay CŨNG quét sạch mọi hồ sơ `operationStoreOpenings`/`operationRepairs` đang ở `status: 'DRAFT'` (trạng
thái nghỉ của "Yêu Cầu Bổ Sung") sang `APPROVED`, ghi thêm 1 dòng lịch sử `SYSTEM_MIGRATION`. **KHÔNG**
đụng tới `estimateStatus: 'DRAFT'` (Danh Mục Đầu Tư) — đây là trạng thái ĐẦU vào bình thường, đang dùng
(hồ sơ chưa lập/đang lập danh mục), khác hẳn ý nghĩa DRAFT của hồ sơ chính. Viết 3 kịch bản test mới
(`tests/test-operation-danhmuc-dautu-units.js`, mock `lib/recordStore.js` qua `require.cache` — không cần
SQL Server thật) xác nhận: hồ sơ DRAFT cũ được chuyển đúng, hồ sơ vừa DRAFT (chính) vừa PENDING (Danh mục
đầu tư) cùng lúc thì cả 2 field đều được xử lý, và hồ sơ đã đúng sẵn thì không bị đụng vào (idempotent).

**Bước 2 — xoá "Bổ Sung" cho 2 loại hồ sơ này (giờ đã provably không thể xảy ra nữa):**
- `public/js/core.js`: bỏ 2 nhánh `operationStoreOpenings`/`operationRepairs` khỏi `BOSUNG_MODULE_META`,
  `openBosungEditModal()`, `confirmBosungResubmit()`; xoá luôn `resolveBsPersonInChargeInput()` (chỉ 2
  nhánh này từng dùng picker Người Phụ Trách trong modal Bổ Sung).
- `lib/recordActions.js`: xoá `editOperationStoreOpeningDraft`/`submitOperationStoreOpeningDraft`/
  `editOperationRepairDraft`/`submitOperationRepairDraft` + export tương ứng.
- `routes/records.js`: xoá 4 route `POST /operationStoreOpenings|operationRepairs/:id/update|submit`.
- `lib/workflowEngine.js`: xoá `MODULE_CONFIGS.operationStoreOpenings`/`.operationRepairs` (hồ sơ này
  không bao giờ vào `PENDING` nữa nên route generic `/api/workflow/<module>/:id/:action` chỉ còn ném lỗi
  409 chết — dọn hẳn). **Giữ nguyên** `operationStoreOpeningEstimate`/`operationRepairEstimate` (Danh Mục
  Đầu Tư, ngoài phạm vi lần này).
- `lib/recordViewScope.js`: `canViewOperationStoreOpening()`/`canViewOperationRepair()` bỏ nhánh "đang là
  approver hồ sơ chính" (tham chiếu tới `MODULE_CONFIGS` vừa xoá ở trên, tránh crash) — giữ nguyên dept
  match/`hasOwnWorkItemInSource()`/approver của Danh Mục Đầu Tư.
- `public/js/module-vanhanh.js`: nút "✏️ Sửa & Gửi Lại" giờ chỉ hiện cho `operationOrders` (loại DUY NHẤT
  còn giữ quy trình duyệt cũ trong module Vận Hành — xác nhận qua code, KHÔNG đụng tới).
- `public/js/core-approvalhub.js`: bỏ 2 lệnh `addDeptWorkflowItems(DB.operationStoreOpenings/...)` (không
  bao giờ góp kết quả nữa) — giữ nguyên 2 lệnh tương ứng cho Danh Mục Đầu Tư.
- `tests/testHarness.js`: bỏ 2 action handler `operationStoreOpenings:update`/`operationRepairs:update`
  (gọi hàm đã xoá).

**`operationOrders` ("📦 Đơn Hàng"):** xác nhận đây là collection HOÀN TOÀN RIÊNG (không phải cùng dữ liệu
với "Danh Mục Đầu Tư"/`estimateStatus`) và vẫn giữ nguyên quy trình duyệt PENDING theo phòng ban thật —
`lib/createValidation.js` tự ghi rõ "khác operationOrders 'Phê Duyệt Đơn Hàng', vẫn giữ nguyên PENDING/quy
trình duyệt cũ, KHÔNG đụng tới" — nên **KHÔNG** áp dụng đợt dọn dẹp này cho `operationOrders`.

Xác minh: bộ hồi quy đầy đủ 59 file `tests/test-*.js` — 57 qua, đúng 2 lỗi biết trước do sandbox không có
SQL Server thật (không liên quan thay đổi này). `tests/test-office-budget.js` (Kịch bản 13 — Bổ Sung
`officeReqs`) và `tests/test-operation-store-lifecycle.js` đều PASS toàn bộ — thêm 4 kịch bản Playwright
mới ở file sau xác nhận: KHÔNG còn nút "Sửa & Gửi Lại" nào cho 2 loại hồ sơ Siêu Thị (kể cả khi giả lập
dữ liệu client lệch `status:'DRAFT'`, điều kiện `kind==='operationOrders'` vẫn chặn cứng ở
`buildOperationRowHTML()`), modal "Xem chi tiết" vẫn mở bình thường (view-only, không crash), và
`BOSUNG_MODULE_META` không còn khai 2 kind này.

**Deploy — QUAN TRỌNG, khác thông lệ "chỉ copy code":** không đổi `schema.sql`/`.env.example`/
`package.json` dependencies, nhưng di trú `migrateStuckOperationApprovalStatuses()` ở `seedDefaults.js`
**tự chạy ngay khi server khởi động lại** — nếu CSDL thật có bất kỳ hồ sơ `operationStoreOpenings`/
`operationRepairs` nào đang kẹt ở `status: 'DRAFT'` (do 1 phê duyệt viên lỡ bấm "Yêu Cầu Bổ Sung" trong
khoảng 2026-09-01 → 2026-09-04), nó sẽ TỰ ĐỘNG được chuyển sang `APPROVED` ngay ở lần restart tới — đây là
thay đổi DỮ LIỆU THẬT tự động, một chiều, và đúng ý (khớp với "loại hồ sơ này giờ không bao giờ cần phê
duyệt nữa"), không cần thao tác thủ công nào thêm, nhưng người dùng nên biết trước khi restart.

## Cập nhật trước đó — Soát toàn hệ thống các ô nhập tiền còn thiếu dấu phân cách hàng nghìn (2026-09-05)

Theo yêu cầu người dùng: "rà soát toàn bộ các ô liên quan tới tiền trong app xem có tuân thủ đúng định
dạng [dấu phẩy hàng nghìn] không, cái nào chưa tuân thủ thì chỉnh lại luôn". Soát toàn bộ `public/index.html`
(mọi HTML tĩnh) + toàn bộ `public/js/module-*.js` (mọi form dựng bằng template string ở JS, không chỉ HTML
tĩnh) theo cả từ khoá tiếng Việt ("chi phí", "ngân sách", "đơn giá", "VNĐ"...) lẫn id/tên biến tiếng Anh
(amount/cost/price/budget), cộng quét toàn bộ `type="number"` còn sót + mọi lượt đọc `.value` bằng
`Number(...)`/`parseInt`/`parseFloat` thẳng thay vì qua `getMoneyValue()`.

Phát hiện đúng **5 ô tiền** (trong 3 module) còn dùng `type="number"` thay vì cơ chế `money-input` chuẩn
(`core.js`, mục "Ô NHẬP TIỀN" — xem `CLAUDE.md`/ghi chú tại đó), toàn bộ đều nằm trong modal dùng CHUNG
"Sửa & Gửi Lại" (`openBosungEditModal()`/`confirmBosungResubmit()` ở `core.js`, hiện ra khi người duyệt
yêu cầu bổ sung hồ sơ — REQUEST_CHANGES):

- `#bsAmount` — nhánh `officeReqs` ("Dự toán / Chi phí", Mua Sắm/Sửa Chữa Văn Phòng)
- `#bsBudget` / `#bsApprovedBudget` — nhánh `operationStoreOpenings` ("Chi Phí Phê Duyệt" / "Ngân Sách
  Phê Duyệt — Danh Mục Đầu Tư", Vận Hành > Siêu Thị > Mở Mới)
- `#bsAmount` / `#bsApprovedBudget` — nhánh `operationRepairs` (cùng 2 khái niệm, Vận Hành > Siêu Thị >
  Sửa Chữa)

Đã đổi cả 5 ô sang đúng khuôn `type="text" inputmode="numeric" class="... money-input"`, prefill lúc mở
modal qua `formatMoneyDisplay(item.xxx || 0)` (trước đây gán thẳng số thô, hồ sơ cũ mở ra hiện không có
dấu chấm cho tới khi gõ thêm 1 ký tự), và đổi đúng 5 chỗ đọc giá trị trong `confirmBosungResubmit()` từ
`Number(document.getElementById('bsXxx').value) || 0` sang `getMoneyValue(document.getElementById('bsXxx'))`
— nếu chỉ đổi input mà quên đổi chỗ đọc thì `Number(...)` sẽ đọc thẳng chuỗi có dấu chấm hiển thị
("15.000.000") ra `NaN`, mất luôn số tiền lúc gửi lại hồ sơ.

**Toàn bộ các ô tiền còn lại đã kiểm tra đều tuân thủ đúng** (không sửa gì thêm): 16 ô `money-input` sẵn
có (`contractAmount`, `vppNewPeriodBudget`, `offAmount`, `itRenewalCost`/`RenewCost`/`EditCost`,
`vsoBudget`/`vsoApprovedBudget`, `vrAmount`/`vrApprovedBudget`, các dòng hạng mục Hợp Đồng/Thanh
Toán/Mua Sắm Văn Phòng/Đơn Hàng Vận Hành/Danh Mục Đầu Tư, cột "money" tuỳ biến của module Ngân Sách) đều
đã đọc đúng qua `getMoneyValue()` và prefill đúng qua `formatMoneyDisplay()`. Các `type="number"` còn lại
trong toàn hệ thống xác nhận đều là số lượng/điểm/ngày/m²/cổng SMTP... — không phải tiền, không đụng tới.
Module "🏷️ Phê Duyệt Giá" (Hỗ Trợ IT) không có ô nhập tiền thủ công (giá đến từ upload Excel bảng giá),
ngoài phạm vi soát này.

Xác minh: bộ hồi quy đầy đủ 59 file `tests/test-*.js` chạy lại — 57 qua, đúng 2 lỗi biết trước do sandbox
không có SQL Server thật (không liên quan thay đổi này). Viết thêm 1 kịch bản Playwright riêng (dùng
`tests/testHarness.js`, gõ từng ký tự thật vào cả 5 ô vừa sửa) xác nhận: hiện dấu chấm đúng lúc gõ, hồ sơ
cũ mở ra đã hiện dấu chấm ngay (không đợi gõ thêm), và giá trị gửi đi + lưu lại cuối cùng đúng bằng số đã
gõ (không `NaN`, không lệch) ở cả 3 module.

**Deploy**: không đổi `schema.sql`/`.env.example`/`package.json` dependencies nào — chỉ code client hiện
có (`public/js/core.js`), copy code + `pm2 restart` là đủ.

## Cập nhật trước đó — Sắp xếp lại menu: dời "Báo Cáo" cạnh "Hệ Thống", "Nhân Sự" thành dropdown có module con (2026-09-05)

Theo yêu cầu người dùng: "chuyển đổi vị trí module báo cáo xuống dưới, để cạnh module hệ thống. Nhân sự
tới đây sẽ là module lớn nên chuyển qua dạng menu sổ xuống, có thể mở rộng thêm — bên trong sau này có
các module nhỏ như Onboarding, Offboarding, Hồ Sơ Nhân Sự, KPI, Công & Phép, Cơ Cấu Tổ Chức".

**Phần 1 — dời "Báo Cáo"**: xác nhận có 2 module tên gần giống nhau — "Báo Cáo" (`reports`, màn tổng hợp
số liệu ĐỌC từ 11 module khác, không có luồng nghiệp vụ riêng) và "Báo Cáo Định Kỳ" (`periodicReport`,
1 QUY TRÌNH nghiệp vụ chủ động — nộp/tổng hợp/duyệt theo kỳ). Đã dời đúng **"Báo Cáo" (`reports`)** —
gần với nhóm công cụ giám sát/hệ thống hơn — xuống nằm ngay TRƯỚC "Hệ Thống" ở cuối sidebar (trước đây
nằm ngay sau "Vận Hành", phía trên "Nhân Sự"); **"Báo Cáo Định Kỳ" giữ nguyên** ở nhóm "Điều Hành" vì là
quy trình nghiệp vụ hàng ngày, không phải màn giám sát. Đây là dời HTML thuần (thứ tự nút sidebar
`public/index.html` KHÔNG do mảng `BUSINESS_MODULES` sinh ra — mảng đó chỉ phục vụ màn checkbox "Quyền
Truy Cập Module" ở Hệ Thống > Quản Trị), cộng dời luôn entry `reports` trong `BUSINESS_MODULES` xuống
cuối cho khớp.

**Phần 2 — "Nhân Sự" thành dropdown có module con**: trước đây "Nhân Sự" (`hr`) là 1 module phẳng với 2
TAB CON cùng 1 màn hình (Quản Lý & Phản Hồi Ý Kiến + Cơ Cấu Tổ Chức, chọn qua nút pill nội bộ). Đã tách
"Cơ Cấu Tổ Chức" thành **module con riêng** (`orgChart`, `BUSINESS_MODULES` khai `parent:'hr'`, đúng khuôn
"Ngân Sách" là con của "Tổng Hợp") với section riêng (`#orgChartSection`), quyền riêng
(`canAccessOrgChartModule()`, giữ nguyên 2 quyền cũ `orgChartManage`/`nhanSuManage`, không ai bị siết/nới
quyền). "Nhân Sự" đổi từ nút phẳng sang **dropdown** (`#hrNavWrap`/`#hrDropdownPanel`) đúng khuôn "Hành
Chính"/"Tổng Hợp"/"Vận Hành" — bấm mở ra 2 mục: "Quản Lý & Phản Hồi Ý Kiến" (module `hr`, giờ chỉ còn 1
tab) và "Cơ Cấu Tổ Chức" (module `orgChart`). **CHƯA xây 5 module con user liệt kê** (Onboarding/
Offboarding/Hồ Sơ Nhân Sự/KPI/Công & Phép) — người dùng mô tả đây là việc "sau này", chỉ dựng đúng cấu
trúc dropdown/parent-child để các đợt sau nối thêm module con thật theo đúng khuôn `orgChart` vừa tách,
không tạo mục "sắp ra mắt" giả cho tính năng chưa tồn tại.

- `public/js/core.js`: `BUSINESS_MODULES` thêm entry `orgChart` (parent:`hr`), dời `reports` xuống cuối;
  `canAccessHrModule()` quay về đúng 1 quyền `nhanSuManage`; thêm `canAccessOrgChartModule()`;
  `switchTab()`/`_dispatchTabRender()` thêm nhánh `orgChart`; thêm `updateHrNavVisibility()`/
  `toggleHrDropdown()`/`closeHrDropdown()` (đúng khuôn `vanHanh`); `TAB_MODULE_GROUPS` thêm
  `orgChart:["hcrcdonghanh"]` (dùng chung cụm nạp lười với `hr`, cùng file `module-hcrcdonghanh.js`).
- `public/index.html`: nút "Nhân Sự" đổi thành dropdown; nút "Báo Cáo" dời xuống trước "Hệ Thống"; tách
  `#hrSection` (chỉ còn nội dung Phản Hồi Ý Kiến) và `#orgChartSection` (nội dung Cơ Cấu Tổ Chức, tách từ
  "hrSubOrgChart" cũ) thành 2 section riêng.
- `public/js/module-hcrcdonghanh.js`: bỏ `setHrSubTab()`/`activeHrSubTab` (không còn cần dispatch giữa 2
  tab con — mỗi module giờ có đúng 1 màn, gọi thẳng `renderHrFeedbackManage()`/`renderOrgChart()` từ
  `switchTab()`).

**Test**: `tests/test-lazy-load-all-tabs.js` cập nhật điểm điều hướng "Nhân Sự" (tách 2 điểm dropdown) +
sửa lỗ hổng seed dữ liệu tiền tồn tại phát hiện được khi bài test này bắt đầu click DOM thật xuyên suốt
"Hệ Thống > Quản Trị" rồi "Quy Trình & Phê Duyệt" (thêm `DB.workflows` mặc định `WF_1STEP`, khớp
`defaults.js` thật — bài test cũ không hề liên quan tới thay đổi lần này, chỉ tình cờ lộ ra) + đổi cơ chế
click trong vòng lặp điều hướng sang `.click()` DOM thật qua `page.evaluate()` (không dùng toạ độ chuột
của Playwright nữa — tránh phụ thuộc vị trí/scroll khi sidebar dài thêm/bớt dòng). `tests/test-hr-
feedback.js` cập nhật 3 chỗ kiểm tra nút nav "Nhân Sự" ẩn/hiện (`btnHrTab` → `btnHrFeedbackNav`, đúng
phần tử thật sự bị ẩn/hiện theo quyền sau khi tách dropdown). `tests/test-org-chart-manager-visibility.js`
không cần sửa (chỉ test logic server `lib/recordViewScope.js`, không đụng DOM/nav). Toàn bộ 59 file
`tests/test-*.js`: 57/59 pass, đúng 2 lỗi known pre-existing cần SQL Server thật (không liên quan thay
đổi lần này).

**Deploy**: không đổi `schema.sql`/`.env.example`/`package.json` dependencies nào — chỉ code client hiện
có, copy code + `pm2 restart` là đủ.

## Cập nhật trước đó — Hỗ Trợ IT > Hỗ Trợ Yêu Cầu: thêm "Gửi Phê Duyệt" vào nút thao tác (2026-09-05)

Theo yêu cầu người dùng: "yêu cầu cần có phê duyệt IT sẽ gửi cho người phê duyệt và khi nào được phê
duyệt thì mới quay lại trạng thái IT xử lý" — **tính năng nghiệp vụ này đã có sẵn ĐẦY ĐỦ từ trước**
(`escalateItTicket()`/`approveItTicketEscalation()`/`denyItTicketEscalation()`, `lib/recordActions.js`):
đội IT gửi yêu cầu phê duyệt tới 1 người cụ thể (`approvalStatus: PENDING`), server tự chặn
`updateItTicketStatus()` (không cho tiếp tục cập nhật DONE/CANCELLED) cho tới khi người đó duyệt
(`APPROVED`) — đúng "khi nào được phê duyệt mới quay lại trạng thái IT xử lý". **Không phải tính năng
mới** — chỉ thiếu đúng 1 việc: nút "📨 Gửi Phê Duyệt" trước đây CHỈ nằm trong modal chi tiết ticket
(phải mở "👁️ Xem / Xử lý" rồi tự tìm), chưa lộ ra ở dropdown "Khác ▾" của nút thao tác trên danh sách
như người dùng yêu cầu.

- `public/js/module-itsupport-price.js`: thêm mục "📨 Gửi Phê Duyệt" (hoặc "Gửi Lại Phê Duyệt" nếu vừa
  bị từ chối) vào dropdown "Khác ▾" ở cột Thao Tác, hiện đúng điều kiện với nút tương ứng trong modal
  (đội IT + ticket đang `DOING` + chưa có yêu cầu phê duyệt nào đang chờ). Bấm vào mở thẳng modal chi
  tiết + hiện luôn form chọn người duyệt/lý do — không phải tìm thêm 1 bước, không dựng lại UI riêng
  (giữ đúng 1 nguồn cho form, `renderItTicketModal()`).
- KHÔNG đổi gì ở server (`lib/recordActions.js`/`routes/records.js`) — state machine phê duyệt giữ
  nguyên, đã đúng theo yêu cầu từ trước.

**Test**: `tests/test-it-support.js` thêm 1 kịch bản mới xác nhận dropdown hiện đúng mục này khi ticket
đang DOING + chưa có yêu cầu chờ duyệt, bấm mở đúng modal + form, và mục này TỰ ẨN khi ticket đã DONE.
Toàn bộ `tests/test-*.js` (60 file): 58/60 pass (2 lỗi known pre-existing cần SQL Server thật).

**Deploy**: không có thay đổi `schema.sql`/`.env.example`/`package.json` dependencies nào — chỉ code
client hiện có, copy code + `pm2 restart` là đủ.

## Cập nhật trước đó — Báo Cáo Định Kỳ: bỏ hẳn upload PowerPoint (.pptx), thêm Xuất PDF/Excel cho Tổng Hợp Theo Công Việc (2026-09-05)

Theo yêu cầu người dùng: "bỏ luôn không sử dụng upload báo cáo file ppt/pptx, tổng hợp báo cáo từ nguồn
công việc có thể xuất ra cả file pdf và excel".

**Phần 1 — Bỏ hẳn hình thức nộp PowerPoint (.pptx)**, chỉ còn PDF (ghép nhiều file bằng pdf-lib ngay
trong trình duyệt, đã có sẵn từ trước — nay là hình thức DUY NHẤT):
- Form "📝 Nhập Báo Cáo": bỏ hẳn 2 radio "Hình thức nộp" + ô chọn tệp `.pptx` (`public/index.html`,
  `public/js/module-baocaodinhky-nhap.js`) — không còn `prEntryMode`, luôn gửi `entryType: 'PDF'`.
- Server (`lib/createValidation.js normalizeReportEntryPayload()`): LUÔN ép `entryType` về `'PDF'` +
  `parsedSlides` về `[]`, kể cả khi 1 request thủ công cố gửi `entryType: 'PPTX'` kèm `parsedSlides` (đã
  có test regression riêng xác nhận không lách được).
- Xoá hẳn `parsePptxToSlideContents()` (JSZip + DOMParser đọc XML `.pptx`, từng nằm ở
  `public/js/module-internalcomms-daotao-viewer.js` — xác nhận đây là CONSUMER DUY NHẤT trước khi xoá,
  không đụng module Đào Tạo dùng chung file này cho các hàm xem Word/Excel bảo vệ khác). Dọn theo:
  `/vendor/jszip` (route tĩnh phục vụ bundle JSZip cho trình duyệt, `server.js`) + entry copy trong
  `scripts/copy-vendor-assets.js` + file `public/vendor/jszip/jszip.min.js` đã commit — **`jszip` VẪN
  còn là dependency `package.json` (server.js không đổi ở đây)**, vì `lib/xlsxSafeRead.js` (chống
  zip-bomb khi đọc mọi file Excel import) dùng `jszip` phía SERVER, hoàn toàn độc lập với bundle trình
  duyệt vừa gỡ.
- Dữ liệu CŨ đã nộp bằng `.pptx` trước đợt này KHÔNG bị xoá/hỏng — `period.compilation`
  (`PPTX_SLIDE`, mergeReportPeriod()) vẫn xem/đối chiếu/phát hành lại được bình thường, chỉ không còn
  đường tạo entry `.pptx` MỚI nào nữa (xác nhận qua test seed thẳng 1 entry legacy vào state, không đi
  qua form đã gỡ).

**Phần 2 — Xuất PDF + Excel cho "🗂️ Đối Chiếu Theo Công Việc" (`period.taskCompilation`, dựng từ
`DB.tasks` qua `mergeReportPeriodByTasks()`, TÁCH RIÊNG khỏi bản tổng hợp báo cáo chính thức)**:
- 📄 Xuất PDF (`exportPrTaskCompilationPdf()`, `module-baocaodinhky-trinhchieu.js`): mirror ĐÚNG kỹ
  thuật `exportBudgetSummaryPdf()` (module-ngansach.js, đã có sẵn) — dựng lại nội dung ĐANG HIỂN THỊ vào
  1 stage ẩn khổ A4, chụp html2canvas, cắt lát ghép nhiều trang bằng jsPDF.
- 📊 Xuất Excel (`exportPrTaskCompilationExcel()`): dùng ĐÚNG route dùng chung có sẵn
  `POST /api/admin/export-xlsx` (`downloadXlsxFromServer()`, cùng khuôn `exportOperationWorkItems()` ở
  module-vanhanh.js) — làm PHẲNG slides thành 1 dòng/công việc (Phòng Ban/Người Phụ Trách/Nội Dung/Tiến
  Độ/Hạn Chót/Hỗ Trợ), dễ lọc/sắp xếp lại hơn giữ nguyên cấu trúc slide.
- 2 nút mới ngay trên khối "Đối Chiếu Theo Công Việc" (chỉ hiện khi đã có bản đối chiếu).

**Test**: `tests/test-periodic-report.js` viết lại kịch bản Nhập Liệu (chỉ còn PDF) + kịch bản Tổng Hợp
Theo Báo Cáo đổi sang seed dữ liệu CŨ (giả lập production có sẵn từ trước) + thêm 3 kịch bản mới (Xuất
PDF thật — chặn `jsPDF` constructor đọc lại byte PDF thật, có chữ ký `%PDF`; Xuất Excel — chặn
`downloadXlsxFromServer()` xác nhận đúng cột/dữ liệu; báo lỗi rõ ràng khi chưa từng đối chiếu).
`tests/test-periodic-report-pdf.js` viết lại kịch bản "entryType mặc định" (từ "mặc định PPTX" thành
"LUÔN ép về PDF, không lách được"). Toàn bộ `tests/test-*.js` (60 file): 58/60 pass (2 lỗi known
pre-existing cần SQL Server thật).

**Deploy**: không có thay đổi `schema.sql`/`.env.example`/`package.json` dependencies nào — chỉ code
client+server hiện có, copy code + `pm2 restart` là đủ.

## Cập nhật trước đó — FIX KHẨN: Vận Hành > Siêu Thị > Thực Hiện không tạo được công việc gốc (2026-09-05)

**Triệu chứng người dùng báo**: mở "➕ Thêm Công Việc Gốc" trên hồ sơ Sửa Chữa (hoặc Mở Mới) Siêu Thị,
điền đủ Tên Công Việc/Mô Tả/Người Nghiệm Thu Chỉ Định/Hạn Hoàn Thành/Nghiệm thu-timing, bấm "Lưu Công
Việc" → toast lỗi chung chung "⛔ Không thể xử lý yêu cầu".

**GỐC RỄ THẬT (xác nhận bằng cách dựng lại chính xác `routes/records.js` thật + giả lập kiểu cột SQL Server
thật, KHÔNG chỉ qua `tests/testHarness.js` — harness đó mock thẳng mảng JS trong bộ nhớ, bỏ qua hoàn toàn
lớp SQL của `lib/operationWorkItemStore.js` nên 61/61 kịch bản vẫn "pass" dù bug này vẫn còn nguyên)**:
cột `dbo.OperationWorkItems.SourceId` trên CSDL SQL Server thật vẫn là kiểu `INT` (tối đa ~2.1 tỷ) trong
khi giá trị luôn là id kiểu `Date.now()` (~1.7 nghìn tỷ — VƯỢT TRẦN INT ngay lập tức) → SQL Server ném lỗi
"Arithmetic overflow error converting expression to data type int." ở CHÍNH XÁC câu INSERT khi tạo công
việc GỐC. Đây là lỗi SQL thô (không phải `HttpError`) nên `handleError()` (`routes/records.js`) không nhận
diện được, rơi về toast chung chung mặc định — **không phải bug nghiệp vụ mới**: `periodId`/"Tạo Kỳ",
`acceptorUsername`, `approvedBudget`, cascade cha-con... đều đã được trace tay + test lại kỹ, hoàn toàn
đúng. Migration `ALTER COLUMN SourceId ... BIGINT` sửa đúng lỗi này ĐÃ có sẵn trong `sql/schema.sql` từ 1
đợt merge trước (bản `6.4`, tự chạy an toàn nhiều lần) — **nhưng đó là script CHẠY TAY**, và rất có thể
chưa được chạy lại trên SQL Server thật đang chạy production kể từ lúc migration đó được thêm vào.

**⚠️ HÀNH ĐỘNG BẮT BUỘC NGAY (đây MỚI là điều thật sự khắc phục được lỗi)**: chạy lại
`server/sql/schema.sql` trên SQL Server production NGAY BÂY GIỜ (an toàn, chỉ ALTER cột nếu còn sai kiểu,
không mất dữ liệu, không cần dừng server) — xem mục 12 `HUONG_DAN_DEPLOY_UBUNTU.md`. Nếu không chạy lại,
tạo công việc Thực hiện vẫn tiếp tục lỗi dù đã cập nhật code bản này.

**Code bản này cải thiện thêm (không tự sửa được schema, chỉ giúp CHẨN ĐOÁN rõ hơn)**:
`assertSourceIdColumnIsBigInt()` (`lib/operationWorkItemStore.js`) chủ động dò kiểu cột thật qua
`INFORMATION_SCHEMA.COLUMNS` trước khi insert/update công việc Thực hiện — nếu vẫn `INT`, chặn NGAY với
thông báo RÕ RÀNG chỉ thẳng hướng khắc phục (thay vì để lỗi SQL Server thô lọt ra ngoài thành toast chung
chung); tự dò lại (không cache kết quả lỗi) nên nhận ra NGAY khi quản trị chạy xong `schema.sql`, không
cần khởi động lại server. `seedDefaults.js` gọi thêm 1 lần lúc khởi động để in cảnh báo ra console ngay
khi deploy (cùng khuôn cảnh báo `DB_ENCRYPT`/`LOG_ENCRYPTION_KEY` đã có ở `db.js`).

**Test**: `tests/test-operation-workitem-sourceid-schema.js` (mới, 5 kịch bản) — giả lập cả 2 trạng thái
cột (`int`/`bigint`) xác nhận đúng hành vi chặn/cho qua + cache. Dựng lại thật `routes/records.js` bằng
Express + pool SQL giả lập (không qua `testHarness.js`) xác nhận: trạng thái `int` → lỗi rõ ràng, KHÔNG
đụng câu INSERT; trạng thái `bigint` (sau khi chạy `schema.sql`) → tạo công việc thành công thật, cả
`operationRepairs` lẫn `operationStoreOpenings` (không phân biệt sourceType, cùng 1 cột). Toàn bộ
`tests/test-*.js` (59 file): 57/59 pass (2 lỗi known pre-existing cần SQL Server thật —
`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js`), bao gồm `test-operation-store-lifecycle.js`
(61/61, Playwright thật trên `public/index.html`, cả Mở Mới lẫn Sửa Chữa).

## Cập nhật trước đó — Đào Tạo: Ngân Hàng Câu Hỏi có ảnh minh hoạ + Video 0.5x-1.5x/PDF phải xem hết mới tính hoàn thành (2026-09-05)

3 phần độc lập của module Đào Tạo (Truyền Thông Nội Bộ), thực hiện theo đúng phân tích đã thống nhất với
người dùng, gộp chung 1 lần merge (các phần chia sẻ chung 1 collection mới, tách merge riêng rủi ro hơn).

**Phần 1 — Ngân Hàng Câu Hỏi hỗ trợ ảnh minh hoạ câu hỏi (giữ nguyên câu hỏi thuần văn bản như trước):**
- `trainingTests.questions[].imageUrl` (tuỳ chọn) — server (`lib/createValidation.js`) xác minh bằng ĐÚNG
  `assertUploadedFileUrl()` đã dùng cho mọi field file khác trong file này (chặn scheme `javascript:`/URL
  ngoài hệ thống — cùng lỗ hổng stored-XSS đã vá trước đó cho `licenses`/`itServiceRenewals`...).
- Test Builder (Test Builder câu hỏi) thêm ô tải ảnh/xem trước/xoá ảnh mỗi câu (`uploadFileToServer()`,
  moduleKey `trainingTestImage` — thêm mới trong "Quản Lý Tệp File", mặc định CHỈ nhận `.jpg/.jpeg/.png/
  .webp`, trần 5MB, admin chỉnh được). Màn làm bài (`ttTakeRenderQuestion()`) hiện ảnh phía trên nội dung
  câu hỏi nếu có, không đổi layout câu hỏi không ảnh.
- **Phân quyền xem ảnh câu hỏi** (`lib/fileAuthz.js`, cả `/api/files/download` lẫn Khung Xem Bảo Vệ
  `/uploads/...`): trước đây MỌI file không tra ra được hồ sơ sở hữu đều FAIL-OPEN (ai đăng nhập cũng xem
  được) — thêm nhánh tra `trainingTests` theo đúng câu hỏi chứa ảnh, chỉ trainingManage/admin, giảng viên
  được gán cho 1 lớp dùng đúng bài test đó, hoặc học viên đang có đăng ký còn hiệu lực vào lớp đó mới xem
  được; bài test CHƯA gán lớp nào thì chỉ trainingManage/admin xem được ảnh của nó.
- **Nhập/Xuất Excel hàng loạt**: tải mẫu Excel (`lib/trainingTestImport.js` + route mới
  `routes/trainingTestImport.js`, mirror khuôn `lib/trainingPlanImport.js`), tải ảnh picker trước (cùng
  moduleKey `trainingTestImage`), điền câu hỏi (cột "Ảnh" gõ đúng tên tệp ảnh vừa tải — client tự đối
  chiếu, KHÔNG chấp nhận URL ảnh ngoài hệ thống từ file Excel), xem trước rồi nạp vào Test Builder (câu
  hỏi vẫn đi qua ĐÚNG `POST /api/create/trainingTests` khi bấm "Tạo Bài Test", không có đường tạo tắt nào
  bỏ qua validate). Xuất Excel dùng cùng khuôn cột để có thể tải về sửa rồi nhập lại.

**Phần 2 — Video bài giảng: giới hạn tốc độ phát 0.5x-1.5x + chặn tua vượt điểm đã xem xa nhất.** Thay
hẳn `<iframe>` nhúng Youtube thô bằng Youtube IFrame Player API thật (`viewTrainingVideoDoc()`, modal mới
`#trainingVideoModal`) — poll `getCurrentTime()`/`getDuration()` mỗi 1.5s, tự `seekTo()` kéo lùi nếu tua
vượt điểm xa nhất đã xem (biên dung sai 3s, luôn cho tua NGƯỢC tự do), tự `setPlaybackRate()` kéo về
[0.5, 1.5] nếu `onPlaybackRateChange` báo vượt ngoài khoảng. **THÀNH THẬT về giới hạn đã trao đổi với
người dùng**: đây là "phát hiện rồi sửa lại" (best-effort phía client) — giao diện gốc của trình phát
Youtube (menu chuột phải trên iframe) không thể bị trang nhúng gỡ bỏ tuỳ chọn bằng JS, người rành kỹ
thuật vẫn có đường lách (devtools...); không phải khoá cứng tuyệt đối, chỉ chặn đường dùng thông thường.
Logic chấm/tua tách thành 3 hàm THUẦN test được không cần dựng iframe thật
(`clampYoutubePlaybackRate()`/`computeYoutubeSeekSnapback()`/`computeYoutubeFurthestWatched()`).

**Phần 3 — PDF phải cuộn xem hết MỌI trang mới tính "đã xem".** `renderPdfProtected()` (script PDF.js gốc,
`public/index.html`) thêm tham số `progress` tuỳ chọn (mọi caller khác không đổi hành vi) —
`IntersectionObserver` (root = khung cuộn) + dwell ~900ms mỗi trang trước khi tính "đã xem" (chống tính
nhầm khi lướt nhanh), báo callback đúng 1 lần/trang. `viewTrainingPdfDoc()` gộp báo cáo (debounce ~1.2s)
gửi lên server. Áp dụng cho `trainingDocuments` loại `DOCUMENT` có đuôi `.pdf` — ảnh/`.docx`/`.xlsx` vẫn
dùng cú click thủ công "Đánh dấu đã xem" như trước (không có tín hiệu khách quan để đòi hỏi hơn).

**Dữ liệu chung Phần 2+3 — `trainingDocumentProgress` (collection mới, `dbo.Records`, không cần đổi
`schema.sql`)**: 1 dòng/1 (tài liệu, người dùng) — giây đã xem xa nhất/trang đã xem, tính hoàn thành bằng
`lib/recordActions.js` (`isTrainingVideoProgressComplete()` ~95% thời lượng, `isTrainingPdfProgressComplete()`
đủ MỌI trang 1..N) — 2 hàm THUẦN + `computeTrainingDocumentProgressUpdate()` (hợp nhất tiến độ, chống thụt
lùi: giây/trang đã ghi nhận không bao giờ bị 1 lượt báo cáo trễ/thấp hơn xoá mất) test được không cần DB.
Route mới `POST /api/records/trainingDocuments/:id/track-progress` tự suy "kind" từ `docType` THẬT (không
tin `payload.kind` client gửi), khoá theo `docId+username`. **"Bắt Buộc Hoàn Thành" giờ có logic thật**:
lần đầu đạt hoàn thành tự động gọi `markTrainingDocumentViewed()` cho MỌI đăng ký (lớp ONLINE) đang coi
tài liệu này là giáo trình bắt buộc — trước đây field `mandatory` "CHỈ là cờ hiển thị (badge), KHÔNG có
logic" (đúng theo ghi chú cũ ở `createValidation.js`), giờ nút bấm tay bị GỠ BỎ cho đúng 2 loại có tín
hiệu khách quan (video/PDF), thay bằng dòng chữ "Sẽ tự động đánh dấu khi..." — ảnh/tài liệu văn phòng khác
vẫn giữ nguyên nút bấm tay cũ. Riêng tư theo người dùng ở `GET /api/data`
(`filterTrainingDocumentProgressForUser()`, cùng khuôn `trainingRegistrations`).

**CSP (`lib/securityHeaders.js`) — thay đổi cần lưu ý khi triển khai**: mở `scriptSrc`/`frameSrc` cho
`https://www.youtube.com` (script bootstrap IFrame API + iframe trình phát thật) — trước đây 2 directive
này CHƯA từng mở domain này, nghĩa là NHIỀU KHẢ NĂNG bản nhúng Youtube `<iframe>` cũ (trước đợt này) đã bị
CSP âm thầm chặn từ trước, không hiện được, không riêng gì tính năng mới. Không mở thêm `connectSrc` (giao
tiếp iframe-trang qua `postMessage`, không qua XHR/fetch).

**Không có dependency npm mới** (`pdf-lib` dùng để dựng file PDF thật cho test đã có sẵn trong
`dependencies` từ trước). Không đổi `.env.example`. Không cần thao tác thủ công nào khác ngoài copy code +
`pm2 restart` (schema.sql không đổi — collection mới dùng chung bảng `dbo.Records` sẵn có).

**Kiểm chứng**: `node --check` sạch mọi file server đã sửa; test THUẦN NODE mới
(`tests/test-training-question-images.js`) phủ validate ảnh câu hỏi + ma trận phân quyền xem ảnh (kể cả
xác nhận người ngoài cuộc KHÔNG tải được dù biết đúng URL) + parse Excel; test Playwright mới
(`tests/test-training-question-images-ui.js`) phủ luồng tải ảnh/nhập-xuất Excel thật qua UI;
`tests/test-training-video-pdf-progress.js` phủ 3 hàm thuần Youtube + PDF THẬT (PDF.js + Intersection
Observer thật, không giả lập) cuộn qua 1 phần (chưa hoàn thành) rồi cuộn hết (hoàn thành + tự động đánh
dấu đăng ký) — cùng dịp vá 2 gap có sẵn của bộ hạ tầng test (`tests/_harness.js` thiếu MIME `.mjs` khiến
`renderPdfProtected()`/PDF.js CHƯA TỪNG chạy được trong bộ test Playwright này dù đã tồn tại từ trước rất
lâu; `tests/_mock-backend.js` ghi đè toàn bộ `window.fetch` kể cả tải file tĩnh, phải cho tải tài nguyên
KHÔNG phải `/api/*` đi qua fetch thật). Toàn bộ `tests/test-*.js` chạy `node --check` sạch + chạy thật,
CHỈ 2 lỗi biết trước (kết nối SQL Server, không liên quan) — không yếu bớt assertion nào để né lỗi.

## Cập nhật trước đó — Hạ tầng: nạp module theo cụm (lazy load), Đợt 7 Phần B

Phần A (8.5) đã xử lý Cache-Control/cache-busting. Phần B này xử lý khoảng trống còn lại: 34 file
`module-*.js` (không tính 5 file `core*.js`) trước đây nạp EAGER hết trên MỌI lượt tải trang — giờ chỉ
nạp khi người dùng THỰC SỰ mở đúng tab/cụm liên quan trong phiên.

**Công cụ**: dựng 1 bộ quét AST thật (acorn, không đoán tay) quét TOÀN BỘ 39 file — mọi tham chiếu
identifier (kể cả trong callback/hàm lồng, không chỉ lời gọi cấp cao nhất) + mọi tham chiếu qua chuỗi
`data-op="..."`/`data-op-seq="..."` (cơ chế điều phối CSP-safe dùng khắp app, xem `CLAUDE.md`) — dựng đồ
thị phụ thuộc file→file, gộp các file phụ thuộc VÒNG (SCC, tính bằng Tarjan) thành 1 cụm bắt buộc nạp
chung.

**Kết quả cụm — DÀY hơn 1 tab = 1 cụm sạch đẹp như kỳ vọng ban đầu**: 34 file gộp thành **22 cụm** (không
phải 34 cụm riêng biệt). Vài cụm nhiều file thật sự đan xen vòng lẫn nhau:
- `admin*` (6 file: `module-admin(-permtree/-permgroups/-submissiongroups/-userstaging)`,
  `module-internalcomms-daotao.js`) — Quản Trị + Đào Tạo dính vòng lẫn nhau (helper Excel dùng chung).
- `hopdong` (3 file: `module-hopdong/office/thanhtoan.js`) — Hợp Đồng/Tổng Hợp/Thanh Toán chia sẻ luồng
  Thanh Toán chung.
- `baocaoquantri-preview` (2 file: `module-baocaoquantri(-preview).js`) — Báo Cáo Quản Trị + bản xem trước.
- `baocaodinhky-nhap` (2 file: nhập liệu + trình chiếu Báo Cáo Định Kỳ).
- `itsupport-tier` (2 file: `module-itsupport-tier.js` + `module-ngansach.js`) — Ngân Sách dùng chung cấu
  hình mức giá IT.
- `formbuilder-nav` (2 file: `module-tailieu.js` + `module-formbuilder-nav.js`) — **HUB trung tâm**, được
  22/34 file khác tham chiếu (helper mở Khung Xem Bảo Vệ, sinh mã, dropdown động...) — hầu như module nào
  cũng kéo theo cụm này.
- 16 cụm còn lại là 1 file/cụm (Công Việc, Biên Bản Họp, Đăng Ký Xe, VPP, Đồng Phục, Phòng Họp, Văn Bản
  Trình, Nhân Sự, Vận Hành, Hệ Thống(Hệ Thống Tabs), Log/Thùng Rác, Quy Trình, Đặc Quyền Admin, Hỗ Trợ IT
  (Giá/Gia Hạn riêng), Xem Trước Word/Excel).

Báo cáo trung thực: đây KHÔNG phải 1 tab = 1 file tải riêng biệt sạch sẽ — do là app lớn phát triển tăng
dần với nhiều hàm dùng chung, nhiều cụm phụ thuộc bắc cầu vào `formbuilder-nav`/`admin*`. Tab "Hệ Thống"
(cấu hình admin) kéo theo nhiều nhất (~13/34 file, đúng bản chất màn cấu hình trung tâm).

**7 hàm/hằng số nhỏ đã CHUYỂN sang `core.js`** (thuần cơ học, không đổi logic) vì bị gọi từ code LUÔN
CHẠY bất kể tab nào (lúc đăng nhập/mỗi lần chuyển tab) — không thể để nằm ở 1 file nạp lười:
`loadVendorScript()`, `isManagerOf()`/`workItemAssignees()`/`isWorkItemAssignee()`, `applyUploadAcceptAttrs()`,
`populateUserJobTitleOptions()`, `stripVnDiacritics()`, `parseVNDateTime()`,
`SENSITIVE_CATEGORY_LABELS`/`SENSITIVE_CATEGORY_SEVERE`, `canManagePaymentRequestsClient()`,
`itPriceHasUnresolvedInfoRequest()`, `canAggregateReportsClient()`, `isInternalPostScheduled()`,
`activeOperationStoreSubTab`. Phát hiện qua chính bộ quét AST (tham chiếu core→module ở code không hề
qua tab nào).

**Cơ chế nạp** (`core.js`): `loadModuleGroup(key)` tạo `<script>` động cho từng file trong cụm (giữ
`?v=<version>` của Phần A qua `window.__ASSET_VERSION__`), tự nạp ĐỆ QUY cụm phụ thuộc trước/cùng lúc,
cache theo Promise (gọi lại cùng `key` không nạp lại — idempotent), lỗi mạng xoá cache để lần sau thử
lại. `script.async = false` để giữ ĐÚNG thứ tự thực thi trong 1 cụm (phát hiện qua bộ test: 1 file cấu
hình top-level gán thẳng hàm của file khác cùng cụm làm giá trị field — không phải gọi hàm — cần đúng
thứ tự script, không phải bảng chữ cái). `ensureFnReady(fnName)` tra cứu 1 hàm bất kỳ qua TÊN CHUỖI (dùng
cho `data-op`), tự nạp đúng cụm nếu chưa có. `switchTab()` giờ là hàm bất đồng bộ, nhưng có "đường nhanh
đồng bộ": nếu cụm của tab đó ĐÃ nạp xong trong phiên, gọi render NGAY, không lùi 1 nhịp vi mô nào (giữ
đúng hành vi trước đây — quan trọng vì phát hiện qua test hồi quy: 1 số chỗ bấm xong đọc lại DOM ngay
không đợi).

**Nhảy xuyên cụm**: rà toàn bộ điểm `switchTab()` có code chạy NGAY SAU nó (Approval Hub/Dashboard nhảy
tới tab khác, `applyPwaShortcutParam()`, `openTakeTestFromQueryParam()`...) — sửa thành `await switchTab()`
trước khi gọi tiếp. `cspDispatchOp()`/`cspRunSeq()` (điều phối `data-op`/`data-op-seq`, dùng ở HẦU HẾT nút
bấm + toàn bộ điều hướng sidebar) tự kiểm tra hàm đã sẵn sàng chưa trước khi gọi — sẵn rồi thì gọi NGAY
đồng bộ (không đổi hiệu năng/hành vi so với trước), chưa có thì tự nạp cụm rồi gọi lại, báo lỗi rõ ràng
nếu nạp thất bại (không treo im lặng).

**Kiểm chứng**: bộ quét AST chạy lại ở "chế độ xác minh" — xác nhận MỌI tham chiếu file→file (cả bare
identifier lẫn `data-op*`) đều được thoả bởi core/cùng cụm/cụm phụ thuộc bắc cầu — **0 vi phạm**. Toàn bộ
55 file `tests/test-*.js` (54 cũ + 1 mới `test-lazy-load-all-tabs.js`) chạy `node --check` sạch + chạy
thật, CHỈ 2 lỗi biết trước (kết nối SQL Server, không liên quan) — không yếu bớt assertion nào để né lỗi;
2 bug thật phát hiện qua vòng chạy đầu (đường nhanh đồng bộ thiếu ở `cspDispatchOp`/`switchTab` gây lệch
nhịp vi mô làm 1 test merge-quyền đọc nhầm DOM cũ; thứ tự script "async ngầm" làm 1 file đọc nhầm hàm
chưa định nghĩa của file cùng cụm) đã sửa tận gốc, không phải vá test.

Bài test mới `test-lazy-load-all-tabs.js`: duyệt qua **toàn bộ ~35 điểm điều hướng sidebar** (mọi
tab + mọi tab con) bằng CLICK THẬT (không gọi thẳng hàm qua JS), xác nhận mỗi lần section tương ứng
hiện ra + không lỗi JS/console.error; xác nhận mở lại 1 tab lần 2 KHÔNG tải lại file `/js/module-*.js`
qua mạng (idempotent); xác nhận nhảy xuyên cụm thật (Approval Hub → tab khác qua `gotoApprovalHubOrigin()`,
`ensureFnReady()` tự nạp đúng cụm cho 1 hàm chưa từng dùng trong phiên) — 41/41 kịch bản qua.

**Đo thực tế trước/sau** (gzip, gần khớp mạng thật):
- Trước (EAGER hết): 39 file JS ≈ 2,22MB thô → **~526KB gzip** mỗi lượt tải trang, bất kể dùng tab nào.
- Sau, chỉ mở Trang chủ (không mở tab nghiệp vụ nào): 5 file core*.js ≈ 558KB thô → **~145KB gzip**
  (giảm ~72%).
- Sau, phiên thực tế mở thêm Tài Liệu + Hợp Đồng (2-3 tab, kéo theo cụm `formbuilder-nav`+`hopdong`+
  `vanbantrinh`+`congviec`+`vpp`+`admin-specialperm` = 9/34 file): core + 9 file ≈ 1,03MB thô →
  **~256KB gzip** (giảm ~52% so với trước).
- Người dùng mở hết mọi tab (đặc biệt "Hệ Thống") trong 1 phiên sẽ tiệm cận lại tổng cũ — đây là quyền
  đánh đổi trung thực, không phải "luôn nhỏ hơn nhiều lần"; lợi ích thật là NGƯỜI DÙNG CHỈ DÙNG VÀI TAB
  (đa số) tải ít hơn đáng kể + trang tải xong ban đầu nhanh hơn (core.js nhỏ hơn nhiều so với gộp cả 39
  file).

**Tác động triển khai:** không cần gì ngoài copy code + `pm2 restart` — không đổi `schema.sql`, không
thêm biến `.env`, không thêm `dependencies` mới.

## Cập nhật trước đó — Hạ tầng: Cache-Control + cache-busting cho `public/js/*.js` (Đợt 7, Phần A)

Đo thực tế (trước khi làm): gzip đã bật sẵn từ trước (`compression()`, `server.js`) — ~627KB truyền thật
trên tổng ~2,7MB JS thô, phần này ĐÃ ổn, không đụng tới. Nhưng phát hiện 2 khoảng trống thật:

1. **Không có Cache-Control nào** cho `index.html` lẫn toàn bộ `public/js/*.js` — `express.static(public)`
   phục vụ nguyên trạng, mỗi lần tải trang trình duyệt phải re-validate lại cả 39 file JS với server (dù
   nội dung file không đổi giữa 2 lần deploy), trong khi `/vendor/*` (thư viện ngoài) đã có
   `VENDOR_STATIC_OPTS = { maxAge: '7d', immutable: true }` từ trước.
2. 39 file `public/js/*.js` nạp **EAGER hết** trên MỌI lượt tải trang, bất kể người dùng có mở tới module
   đó hay không trong phiên — tiền đề cho Đợt 7 Phần B (nạp theo cụm khi cần, xem mục dưới khi merge).

**Cách làm Phần A này** (`server/server.js`):
- Route `/index.html` VÀ catch-all (`app.get('*')`) không còn `res.sendFile()` thẳng nữa — đọc file, thay
  thế MỌI `<script src="/js/xxx.js">` thành `src="/js/xxx.js?v=<version>"` (đọc SỐNG từ `package.json`,
  không hard-code), cache kết quả theo `mtimeMs` (không đọc+thay lại mỗi request khi file không đổi).
  Response của route này luôn `Cache-Control: no-cache` — đây là file DUY NHẤT phải luôn tải mới để phát
  hiện đúng version hiện tại. Cũng chặn riêng path `/index.html` (không chỉ `"/"`) để không có đường nào
  lọt qua `express.static` trả về bản GỐC chưa gắn version.
- Mount tĩnh mới `/js` (mirror đúng khuôn `VENDOR_STATIC_OPTS`): `{ maxAge: '1y', immutable: true }` —
  AN TOÀN vì luôn đi kèm `?v=`, bản deploy mới đổi version → đổi URL → trình duyệt tự tải bản mới, không
  có rủi ro dùng nhầm cache cũ.
- Gắn kèm `window.__ASSET_VERSION__` (script nhỏ, chèn ngay trước `<script src="/js/core.js...">`) để
  phía client (Đợt 7 Phần B, `loadModuleGroup()`) tự đọc lại ĐÚNG version đang chạy khi tạo `<script>`
  động cho các file nạp sau, không hard-code version ở client.

Đã xác nhận qua HTTP request thật (dựng lại đúng logic ở 1 server Express riêng, vì sandbox này không có
SQL Server thật để chạy `server.js` thật — xem `server/tests/README.md`): `GET /` trả về HTML với MỌI thẻ
`<script src="/js/...">` đã gắn `?v=8.5` khớp `package.json`, `window.__ASSET_VERSION__="8.5"`, header
`Cache-Control: no-cache`; `GET /js/core.js?v=8.5` trả `Cache-Control: public, max-age=31536000,
immutable`; `GET /index.html` (path literal) cũng trả đúng bản đã gắn version + `no-cache`, không có
đường nào lọt bản gốc.

**Tác động triển khai:** không cần gì ngoài copy code + `pm2 restart` — không đổi `schema.sql`, không
thêm biến `.env`, không thêm `dependencies` mới.

## Cập nhật gần nhất — Hạ tầng: tách tiếp `core.js` (Đợt 6 — core.js 7.440 → 6.034 dòng, tách 4 file mới + chuyển 1 khối về đúng module)

Đợt 1-5 (`7.9`→`8.3`) đã tách hết khối `<script>` inline khổng lồ của `index.html` ra `public/js/*.js`,
nhưng `core.js` (7.440 dòng) vẫn to gấp gần 3 lần file lớn thứ nhì (`module-internalcomms-daotao.js`,
2.797 dòng) vì gộp chung cả hạ tầng thật-sự-dùng-chung LẪN vài khối nghiệp vụ lớn tự-đứng-được (Approval
Hub, quản lý thiết bị 2FA, PWA, Dashboard). Đợt này rà lại TOÀN BỘ `core.js` (đọc hết nội dung, không
tin lại mốc dòng cũ) và tách tiếp — thuần cơ học, không đổi 1 dòng logic.

**4 file mới** (nạp ngay sau `core.js`, trước mọi `module-*.js`):
- `core-approvalhub.js` (653 dòng) — "✅ PHÊ DUYỆT — HỘP THƯ DUYỆT TỔNG HỢP": `getMyPendingApprovals()`/
  `renderApprovalHub()`/`updateApprovalHubBadge()`/`updateInternalShareBadge()`/... Khối banner gốc
  "✅ PHÊ DUYỆT" trong `core.js` thực ra lồng cả `switchTab()`/`populateDropdowns()`/`logout()`/
  `finishLogin()`/toàn bộ toggle dropdown điều hướng/`canAccessXModule()` khác — những hàm này dùng
  chung cho CẢ hệ thống (không riêng gì Phê Duyệt), nên vẫn giữ nguyên ở `core.js`, chỉ tách đúng phần
  thật sự là Approval Hub.
- `core-dashboard.js` (259 dòng) — trang chủ cá nhân hoá: gộp 2 khối gốc nằm CÁCH NHAU bởi khối Approval
  Hub xen giữa (`buildDashboardCards()`+helper đếm/ẩn-hiện, và `renderDashboard()`/modal Cá Nhân Hoá).
- `core-devicesecurity.js` (336 dòng) — quản lý thiết bị vân tay/Face ID (WebAuthn) + TOTP: tự quản lý
  của chính mình (`renderWebauthnDeviceList()`...), admin xem/gỡ hộ CỦA NGƯỜI KHÁC (WebAuthn + TOTP,
  cùng màn Sửa Người Dùng nên gộp chung), và màn bắt buộc thiết lập TOTP cho admin (`openTotpSetupWall()`).
- `core-pwa.js` (91 dòng) — cài đặt PWA/service worker, tự chứa hoàn toàn (không module nào khác đụng
  tới; `applyPwaShortcutParam()` do `finishLogin()` gọi, tra hàm theo TÊN lúc chạy nên không phát sinh
  phụ thuộc thứ tự nạp file).

**1 khối chuyển về đúng module** (không phải file mới): `buildEffectiveSubmissionWorkflow()`/
`buildSubmissionWorkflowPreviewHTML()`/`readSelectedSubmissionLayers()`/`previewSubmissionWorkflow()`
("VĂN BẢN TRÌNH — QUY TRÌNH THEO LOẠI TỜ TRÌNH...") chuyển từ `core.js` sang `module-vanbantrinh.js` —
đã rà toàn bộ `public/js/*.js` + `index.html`, xác nhận CHỈ module Văn Bản Trình gọi 4 hàm này.
`getSubmissionDeptWorkflowConfig()`/`resolveSubmissionWorkflow()` (2 hàm liền kề, cùng banner gốc)
**CỐ Ý giữ nguyên ở `core.js`** vì Dashboard (`core-dashboard.js`) + Approval Hub (`core-approvalhub.js`)
cũng gọi tới, không riêng gì Văn Bản Trình.

**1 khối rà rồi quyết định KHÔNG chuyển**: "Hỗ Trợ IT > Phê Duyệt Giá — cấu hình duyệt theo phòng ban ×
LOẠI GIÁ" (`resolveItPriceDeptWorkflowConfigClient()`...) — rà thấy `module-ngansach.js` (Ngân Sách,
KHÔNG phải Hỗ Trợ IT) cũng gọi thẳng `resolveItPriceDeptWorkflowConfigClient()` (dùng chung cơ chế cấu
hình duyệt giá cho tab Ngân Sách Phê Duyệt) — không "riêng 1 module" như giả định ban đầu nên giữ
nguyên ở `core.js`, không dời sang `module-itsupport-price.js`/`module-itsupport-tier.js`.

**`core.js`: 7.440 → 6.034 dòng** (phần còn lại là hạ tầng thật sự dùng chung cho CẢ ~30 module: khởi
tạo/đồng bộ DB, tìm-kiếm/lọc/phân trang dùng chung, modal xác nhận, phân quyền-theo-module, xác thực
lại khi duyệt (OTP/PIN), đồng phê duyệt, dropdown/multi-select tự dựng, hạ tầng CSP event-delegation +
~70 lời gọi wiring, đăng nhập/phiên/đăng xuất, `switchTab()`/`populateDropdowns()`/toggle điều hướng —
KHÔNG rút gọn thêm được nữa mà không phá vỡ tính "hạ tầng dùng chung" của các khối này).

Verify: syntax check cả 6 file (4 mới + `core.js` + `module-vanbantrinh.js`), không trùng tên hàm/const
global nào giữa TOÀN BỘ 39 file `public/js/*.js`, script AST tự viết lại (đã kiểm tra bắt đúng cả dạng
tham chiếu-thuần-tên làm giá trị object-literal top-level, không chỉ lời gọi trực tiếp) chạy trên toàn
bộ 39 file theo đúng thứ tự `<script src>` mới — 0 tham chiếu không giải quyết được. Full 54 file test
hồi quy Playwright chạy lại sạch (chỉ 2 lỗi biết trước do thiếu SQL Server thật:
`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js`). Thêm 1 smoke test Playwright riêng cho
đợt này: đăng nhập (seed `DB.*` + `finishLogin()`), bấm qua Dashboard/Phê Duyệt/Văn Bản Trình (nút "Xem
Quy Trình")/Hỗ Trợ IT/mở Hồ Sơ Cá Nhân (WebAuthn tự quản lý + khối cài PWA)/Admin "Sửa Người Dùng" (xem
hộ thiết bị vân tay + TOTP người khác) — theo dõi `console`/`pageerror` suốt: không có lỗi JS nào (2
cảnh báo MIME-type/connection-reset chỉ do harness test tự dựng không phục vụ `/vendor/pdfjs/*`, không
liên quan tới khối `<script type="module">` PDF.js thật — không đổi gì khối đó).

**`index.html`**: chỉ thêm 4 dòng `<script src="/js/core-*.js">` ngay sau `<script src="/js/core.js">`,
không đụng markup/CSS/thẻ `<script type="module">` PDF.js/script copyright. **Không cần migrate dữ
liệu, không đổi `schema.sql`/`.env.example`/`dependencies`.** `server.js` vẫn
`express.static(path.join(__dirname, 'public'))` — file JS mới tự phục vụ theo đường dẫn, không cần
route/cấu hình gì thêm. Deploy như bình thường: copy code + `pm2 restart`, không có bước thủ công nào khác.

## Trước đó — Hạ tầng: tách JS client ra file ngoài (Đợt 5/5 — HOÀN TẤT: Xem Trước File Word/Excel + Hỗ Trợ IT(Phê Duyệt Giá) + Đồng Phục + HCRC Đồng Hành)

Hoàn tất việc tách toàn bộ JS client của `public/index.html` ra `public/js/*.js` (bắt đầu từ đợt 1,
`7.9`) — 4 file CUỐI CÙNG, nằm trong khối `<script>` KHÁC vật lý ở SAU thẻ `<script type="module">` tải
PDF.js (không đụng thẻ module này, giữ nguyên vị trí như mọi đợt trước).

`module-internalcomms-daotao-viewer.js` (464 dòng, xem Word/Excel trong trình duyệt qua
mammoth.js/exceljs — `loadVendorScript()`), `module-itsupport-price.js` (1.707 dòng, Hỗ Trợ IT > Phê
Duyệt Giá bán mặt hàng siêu thị), `module-dongphuc.js` (1.539 dòng, module Đồng Phục đầy đủ),
`module-hcrcdonghanh.js` (475 dòng, Nhân Sự "HCRC Đồng Hành" hỏi&đáp).

**Sau đợt này, `public/index.html` KHÔNG còn khối `<script>` JS nghiệp vụ inline nào** — chỉ còn: script
gán năm bản quyền (dòng ~450), script `type="module"` tải PDF.js (không đổi), và toàn bộ business logic
nằm trong `public/js/*.js` (35 file, 34.956 dòng), tải qua các thẻ `<script src="/js/...">` theo đúng
thứ tự gốc trong file cũ. `index.html`: 43.009 → 8.085 dòng.

Verify: syntax check từng file, không trùng tên hàm/const global nào giữa TOÀN BỘ 35 file (rà lại lần
cuối trên layout hoàn chỉnh), script rà thứ tự hoisting (bản đã sửa ở đợt 4, bắt cả tham chiếu-thuần-tên
không chỉ lời gọi) chạy trên toàn bộ 35 file — 0 tham chiếu không giải quyết được, full 54 file test hồi
quy Playwright chạy lại sạch (chỉ 2 lỗi biết trước do thiếu SQL Server thật), demo Playwright riêng bấm
qua 21 tab (cả module cũ lẫn mới tách) không lỗi console/page nào.

**Layout cuối cùng `public/js/`** (35 file theo đúng thứ tự tải): `core.js` rồi lần lượt
Tài Liệu → Văn Bản Trình → Công Việc → Hợp Đồng/Thanh Toán → Phòng Họp/Biên Bản Họp → Đăng Ký Xe →
Office → Vận Hành → VPP → Hệ Thống(tabs) → Biểu Mẫu(nav) → Quy Trình → Hỗ Trợ IT(gia hạn) → Ngân
Sách → Hỗ Trợ IT(tier) → Admin → Cây/Nhóm Phân Quyền → Khối 17 → Báo Cáo Định Kỳ(nhập+trình chiếu) →
Nhóm Phê Duyệt Trình → User Chờ Lưu → Log/Thùng Rác → Báo Cáo Quản Trị(preview trước, rồi chính) →
Truyền Thông Nội Bộ(Nhịp Sống, rồi Đào Tạo) → [thẻ `<script type="module">` PDF.js, không đổi] → Xem
Trước Word/Excel → Hỗ Trợ IT(price) → Đồng Phục → HCRC Đồng Hành.

**Không cần migrate dữ liệu, không đổi `schema.sql`/`.env.example`/`dependencies`.** `server.js` đã
`express.static(path.join(__dirname, 'public'))` từ trước (verify lại lần cuối, dòng 266) — `public/js/*.js`
tự phục vụ đúng theo đường dẫn `/js/...` không cần route/cấu hình gì thêm. CSP (`lib/securityHeaders.js`)
đã `scriptSrc: ["'self'", "'unsafe-inline'"]` từ trước — `'self'` đã cho phép mọi `<script src>` cùng gốc
(file JS mới thuộc diện này), `'unsafe-inline'` vẫn cần giữ vì còn 2 khối script nhỏ cố tình để lại
inline (copyright, `type="module"` PDF.js) — không cần đổi CSP. Deploy như bình thường: copy code +
`pm2 restart`, không có bước thủ công nào khác.

## Trước đó — Hạ tầng: tách JS client ra file ngoài (Đợt 4/5 — Báo Cáo Quản Trị + Truyền Thông Nội Bộ/Đào Tạo — HOÀN TẤT khối script GỐC, chỉ còn phần vật lý nằm sau script PDF.js)

Tiếp tục đợt 1-3 (`7.9`/`8.0`/`8.1`, xem mục "Trước đó" ngay dưới) — tách nốt 4 file CUỐI CÙNG của khối
`<script>` inline GỐC (đoạn 7972→38744 trong file trước khi tách). Sau đợt này, khối `<script>` gốc
không còn tồn tại — toàn bộ đã ra `public/js/*.js`. Đợt 5 (cuối) sẽ tách 1 khối `<script>` KHÁC, nằm
vật lý SAU thẻ `<script type="module">` tải PDF.js (không đụng thẻ này).

`module-baocaoquantri.js` (638 dòng, Module Báo Cáo Quản Trị), `module-baocaoquantri-preview.js` (660
dòng, "Tạo Báo Cáo Theo Yêu Cầu" xem trước), `module-internalcomms-nhipsong.js` (1.441 dòng, Truyền
Thông Nội Bộ — Nhịp Sống HCRC/Góc Chia Sẻ), `module-internalcomms-daotao.js` (2.797 dòng, Đào Tạo).

**Phát hiện + sửa 1 lỗi thật khi verify đợt này (bài học cho việc rà thứ tự hoisting)**: script AST tự
viết ở đợt 1 chỉ rà "lời GỌI hàm" (`CallExpression`) ở top-level làm rủi ro tham chiếu-tới-trước — bỏ
sót 1 dạng khác cũng thực thi NGAY khi định nghĩa: **tham chiếu THUẦN TÊN HÀM (không gọi) làm GIÁ TRỊ
thuộc tính trong object literal top-level**, VD `REPORT_MODULE_CONFIGS = { office: { renderExtra:
renderOfficeReportExtra, ... } }` — chỉ 1 tên hàm, không có `()`, nhưng việc DỰNG object literal này vẫn
phải tra `renderOfficeReportExtra` trong scope NGAY LÚC ĐÓ (khác hẳn arrow function `el =>
someFn(el)` — trường hợp NÀY mới thực sự an toàn vì thân hàm hoãn thực thi). Phát hiện qua đúng bước
demo Playwright bấm qua các tab (`ReferenceError: renderOfficeReportExtra is not defined` tại
`module-baocaoquantri.js`, vì 5 hàm `render*ReportExtra` cần lại nằm trong
`module-baocaoquantri-preview.js`, tải SAU). Đã viết lại script rà theo đúng quy tắc JS thật (thu thập
MỌI định danh chạm tới ở top-level, không riêng lời gọi hàm) và chạy lại trên TOÀN BỘ ~35 file theo
đúng thứ tự tải cuối cùng — xác nhận đây là ĐIỂM DUY NHẤT bị bỏ sót trong toàn bộ 4 đợt (batch 1-3 đã
merge trước đó không dính lỗi này). Sửa bằng cách đổi thứ tự 2 thẻ `<script src>` (tải
`module-baocaoquantri-preview.js` TRƯỚC `module-baocaoquantri.js`) — không đổi nội dung file nào.

Verify: syntax check từng file, không trùng tên hàm/const global, script rà thứ tự hoisting đã sửa chạy
lại trên toàn bộ 35 file (0 tham chiếu không giải quyết được), full 54 file test hồi quy Playwright chạy
lại sạch (chỉ 2 lỗi biết trước do thiếu SQL Server thật), demo Playwright riêng bấm qua 21 tab xác nhận
0 lỗi console/page (bắt đúng lỗi trên trước khi sửa).

**Không cần migrate dữ liệu, không đổi `schema.sql`/`.env.example`/`dependencies`/CSP/static-serving.**

## Trước đó — Hạ tầng: tách JS client ra file ngoài (Đợt 3/5 — Admin(user/dept/cat)+Cây Phân Quyền+Nhóm Phân Quyền+Khối 17+Báo Cáo Định Kỳ+Nhóm Phê Duyệt Trình+Danh Sách User Chờ Lưu+Log/Thùng Rác)

Tiếp tục đợt 1-2 (`7.9`/`8.0`, xem mục "Trước đó" ngay dưới) — tách thêm 9 file khỏi khối `<script>`
inline còn lại của `public/index.html`, giữ đúng nguyên tắc: chỉ di chuyển cơ học, không đổi logic, giữ
đúng thứ tự xuất hiện gốc.

`module-admin.js` (558 dòng, CRUD Phòng Ban/Danh Mục), `module-admin-permtree.js` (314 dòng, cây phân
quyền dạng `<details>` gấp/mở dùng ở màn Sửa Người Dùng/Sửa Nhóm), `module-admin-permgroups.js` (240
dòng, Nhóm Phân Quyền), `module-admin-specialperm.js` (209 dòng, Khối 17 — 2 cấu hình nhóm quyền đặc
biệt), `module-baocaodinhky-nhap.js` (744 dòng, Báo Cáo Định Kỳ — nhập/kỳ/tổng hợp),
`module-baocaodinhky-trinhchieu.js` (915 dòng, Báo Cáo Định Kỳ — ghép PDF/trình chiếu toàn màn
hình/xuất PDF), `module-admin-submissiongroups.js` (233 dòng, Nhóm Phê Duyệt Trình Văn Bản Trình),
`module-admin-userstaging.js` (526 dòng, danh sách người dùng mới chờ lưu hàng loạt),
`module-logsystem-trash.js` (250 dòng, Nhật Ký Hệ Thống + Thùng Rác).

Verify: syntax check từng file, không trùng tên hàm/const global nào giữa các file, full 54 file test
hồi quy Playwright chạy lại sạch (chỉ 2 lỗi biết trước do thiếu SQL Server thật), demo Playwright riêng
bấm qua 21 tab không lỗi console/page nào. `index.html`: 21.781 → 17.801 dòng.

**Không cần migrate dữ liệu, không đổi `schema.sql`/`.env.example`/`dependencies`/CSP/static-serving.**

## Trước đó — Hạ tầng: tách JS client ra file ngoài (Đợt 2/5 — Office/Vận Hành/VPP/Hệ Thống(tabs)/Biểu Mẫu(nav)/Quy Trình/Hỗ Trợ IT(gia hạn+tier)/Ngân Sách)

Tiếp tục đợt 1 (`7.9`, xem mục "Trước đó" ngay dưới) — tách thêm 9 file khỏi khối `<script>` inline còn
lại của `public/index.html`, giữ đúng nguyên tắc: chỉ di chuyển cơ học, không đổi logic, giữ đúng thứ tự
xuất hiện gốc trong file (đã verify lại KHÔNG có tham chiếu-tới-trước xuyên file nào bằng script AST tự
viết ở đợt 1, áp dụng lại cho đợt này). File mới: `module-office.js` (462 dòng, module Phê Duyệt Văn
Phòng), `module-vanhanh.js` (1.797 dòng, module Vận Hành — Đơn Hàng/Mở Mới Siêu Thị/Sửa Chữa, dự
toán+thực hiện+nghiệm thu+báo cáo, cả bảng `OP_CLICK_ACTIONS`/`bindOperationDelegation` CSP dispatch
RIÊNG của module này — khác `bindCspDelegation()` dùng chung đã dời vào `core.js` ở đợt 1),
`module-vpp.js` (930 dòng, Văn Phòng Phẩm), `module-hethong-tabs.js` (203 dòng, chuyển tab màn "Hệ
Thống" gộp Quản Trị/Biểu Mẫu/Quy Trình), `module-formbuilder-nav.js` (376 dòng, thanh tab cấp 1 Biểu
Mẫu), `module-workflow.js` (60 dòng, bảng tra cứu module↔collection Quy Trình Phê Duyệt),
`module-itsupport-renewal.js` (288 dòng, Gia Hạn Dịch Vụ CNTT), `module-ngansach.js` (1.519 dòng, Ngân
Sách Phê Duyệt/Thực Hiện/Tổng Hợp), `module-itsupport-tier.js` (369 dòng, Hỗ Trợ IT > Phê Duyệt Giá Bán
Buôn theo Tier).

Verify: syntax check từng file, không trùng tên hàm/const global, full 54 file test hồi quy Playwright
chạy lại sạch (chỉ 2 lỗi biết trước do thiếu SQL Server thật), demo Playwright riêng bấm qua 21 tab
không lỗi console/page nào. `index.html`: 27.776 → 21.781 dòng (giảm đúng 5.995 dòng = tổng 9 file mới,
lệch 9 dòng do mỗi file có 1 dòng trắng cuối).

**Không cần migrate dữ liệu, không đổi `schema.sql`/`.env.example`/`dependencies`/CSP/static-serving** —
deploy như bình thường (copy code + `pm2 restart`).

## Trước đó — Hạ tầng: tách JS client ra file ngoài (Đợt 1/5 — core.js + 6 module đầu: Tài Liệu/Văn Bản Trình/Công Việc/Hợp Đồng+Thanh Toán/Phòng Họp+Biên Bản Họp/Đăng Ký Xe)

Bắt đầu chia nhỏ khối `<script>` inline khổng lồ của `public/index.html` (~30.800 dòng, ~1.565 hàm
top-level, DÙNG CHUNG 1 khối duy nhất — lớn hơn cả toàn bộ backend `lib/`+`routes/` gộp lại) thành
nhiều file `.js` riêng dưới `public/js/`, tải qua nhiều thẻ `<script src="/js/...">` theo đúng thứ tự
xuất hiện gốc trong file, thay cho 1 khối inline duy nhất. Lý do: nhiều agent nền cùng sửa 1 file này
đã gây gần xung đột merge suốt phiên làm việc trước, phải khoá tay tuần tự thủ công. Đây là đợt 1/5 —
sẽ tiếp tục tách nốt phần còn lại (Office/Vận Hành/VPP/Ngân Sách/Hệ Thống/Admin/Báo Cáo/Truyền Thông Nội
Bộ/Đồng Phục/Hỗ Trợ IT/HCRC Đồng Hành...) ở các đợt kế tiếp.

**Nguyên tắc: CHỈ di chuyển cơ học (mechanical relocation), KHÔNG đổi 1 dòng logic nào.** Mọi hàm giữ
nguyên tên/tham số/thân hàm, vẫn là hàm global thường (`function foo(){}`), không bọc IIFE/module — cơ
chế `data-op` (CSP dispatch: `cspCoerceArg`/`bindCspDelegation`...) đọc hàm theo tên qua `window[fnName]`
vẫn hoạt động y hệt.

- **Rủi ro kỹ thuật chính đã xử lý — thứ tự hoisting**: trước đây `function foo(){}` được hoisted trong
  toàn khối `<script>`, gọi được từ bất kỳ đâu trong khối bất kể thứ tự vật lý. Tách ra nhiều
  `<script src>` riêng thì hoisting CHỈ còn hiệu lực TRONG từng file — 1 lời gọi ở top-level file A tới
  hàm định nghĩa ở file B sẽ `ReferenceError` nếu B tải SAU A. Đã viết công cụ phân tích AST (acorn) rà
  toàn bộ ~34.956 dòng JS, liệt kê hết mọi statement top-level THỰC SỰ thực thi ngay (không phải khai báo
  hàm hay object literal chứa hàm — 2 loại này KHÔNG thực thi ngay nên an toàn bất kể thứ tự file), xác
  nhận: toàn bộ ~120 điểm "rủi ro" tìm được đều tham chiếu tới hàm/const định nghĩa NGAY GẦN đó cùng khu
  vực gốc trong file — không có tham chiếu-tới-trước (forward reference) nào xuyên khu vực. 1 khối hạ
  tầng CSP dispatch dùng chung cho MỌI module (`bindCspDelegation`/`cspDispatchOp`... + ~70 lời gọi
  `bindCspDelegation('xxxSection')` cho từng module) nằm vật lý xen giữa module Vận Hành và VPP trong
  file gốc — do đây là hạ tầng dùng chung thật sự (không phụ thuộc code riêng module nào, chỉ dùng ID
  chuỗi + tra `window[fnName]` LÚC CLICK chứ không phải lúc định nghĩa), đã dời nguyên khối này vào
  `core.js` (tải đầu tiên) thay vì giữ đúng vị trí gốc — ngoại lệ DUY NHẤT về thứ tự, có ghi chú rõ trong
  code. Đã verify lại bằng script riêng: mô phỏng đúng thứ tự tải `<script src>` cuối cùng, 0 tham chiếu
  không giải quyết được.
- **`const`/`let` top-level KHÔNG gắn vào `window`** (đúng với MỌI `<script>` — inline hay external, đây
  không phải hành vi mới do tách file) — mọi `<script>` cùng trang (kể cả nhiều file ngoài) vẫn CHIA SẺ
  CHUNG 1 "global lexical environment" của trang, y hệt trước đây — đã verify bằng Playwright thật (đọc
  `DB`/`SUBMISSION_APPROVAL_LAYERS` qua `typeof` từ `page.evaluate` chạy sau khi mọi file tải xong).
- **`server.js` đã `express.static(public/)` từ trước** — `public/js/*.js` tự động phục vụ được, KHÔNG
  cần thêm route/cấu hình gì.
- **CSP (`lib/securityHeaders.js`) đã có `scriptSrc: ["'self'", ...]` từ trước** — script cùng gốc
  (`/js/...`) không bị chặn, không cần đổi gì (vẫn giữ `'unsafe-inline'` vì còn 2 khối script nhỏ cố tình
  để lại inline: `type="module"` tải PDF.js, và script gán năm bản quyền).
- **9 file test Playwright/harness cũ (test-vpp/test-meeting-car/test-minutes/test-admin-users-permgroups/
  test-approval-hub/test-auth-login/test-catalog-rename-uniform-employees/test-perm-tree-expand-collapse
  + `test-audit-round2-cluster6.js`) tự dựng static server RIÊNG chỉ biết phục vụ `index.html`** (không
  generic như `testHarness.js`/`_harness.js`) — phát hiện qua đúng full regression suite (54 file), sửa
  thêm route tĩnh cho `/js/*.js` (8 file) + đổi cách tìm hàm sang quét cả `public/js/*.js` thay vì giả
  định còn nằm trong `index.html` (1 file, `test-audit-round2-cluster6.js` mục [3] Thanh Toán). KHÔNG đổi
  logic nghiệp vụ nào trong các file test này, chỉ hạ tầng phục vụ tĩnh.

**Layout mới**: `public/js/core.js` (DB/state dùng chung, escapeHtml, tìm-kiếm/lọc/phân trang dùng
chung, CSP dispatch, xác thực lại khi duyệt, WebAuthn/TOTP, PWA, Approval Hub, phiếu phê duyệt dựng
động, dropdown tìm-kiếm-gõ-chọn + chọn nhiều người dùng chung...) tải ĐẦU TIÊN, rồi
`module-tailieu.js`/`module-vanbantrinh.js`/`module-congviec.js`/`module-hopdong.js`/
`module-thanhtoan.js`/`module-phonghop.js`/`module-bienbanhop.js`/`module-dangkyxe.js` theo đúng thứ tự
xuất hiện gốc. Phần còn lại của khối script cũ (Office/Vận Hành/VPP/Ngân Sách/Hệ Thống/Admin/Báo Cáo
Định Kỳ/Báo Cáo Quản Trị/Truyền Thông Nội Bộ/Đào Tạo/Hỗ Trợ IT/Đồng Phục/HCRC Đồng Hành...) TẠM THỜI vẫn
còn inline trong `index.html` (sẽ tách nốt ở đợt 2-5) — trang vẫn chạy đúng y hệt, không có hành vi nào
đổi.

Verify: syntax check (`node --check`) từng file mới, không trùng tên hàm/const global nào giữa các file,
0 tham chiếu top-level không giải quyết được (script tự viết), FULL 54 file test hồi quy Playwright chạy
lại từ đầu (chỉ 2 lỗi biết trước do thiếu SQL Server thật —
`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, không lỗi mới), demo Playwright riêng bấm
qua 21 tab (cả module đã tách lẫn chưa tách) không có lỗi console/page nào, `index.html` giảm từ 43.009
xuống 27.776 dòng (giảm ~15.233 dòng, đúng bằng tổng dòng của 9 file mới tách).

**Không cần migrate dữ liệu** — không đổi `schema.sql`/`.env.example`/`dependencies`. Deploy: copy code +
`pm2 restart` như bình thường (file tĩnh mới dưới `public/js/` tự phục vụ qua `express.static` sẵn có).

## Trước đó — Vận Hành > Siêu Thị: cascade cha-con tự động, Ngân Sách Phê Duyệt tách field riêng, cv con có nút Cập Nhật Tiến Độ/Hoàn Thành giống module Công Việc

3 sửa đổi/bổ sung theo phản hồi người dùng sau khi review đợt "vòng đời hiển thị mới" (`7.7`, xem mục
"Trước đó" ngay dưới) — chỉ 2 luồng `operationStoreOpenings`/`operationRepairs`, KHÔNG đụng
`operationOrders` hay module nào khác.

- **Correction 1 — cascade cha-con tự động (MỚI, chưa từng có trước đây)**: người dùng xác nhận Danh Mục
  Đầu Tư và Danh Sách Công Việc là 2 khái niệm **độc lập, không liên quan** — quyết định giữ 2 cây tách
  biệt của đợt trước là ĐÚNG, không đổi. Cũng xác nhận cơ chế "Nghiệm thu ngay khi hoàn thành"/"Nghiệm thu
  sau N ngày" (`acceptanceMode`, đợt trước) đã đúng như thiết kế — nút "✅ Nghiệm Thu" luôn hiện ngay khi
  việc chuyển "Đang nghiệm thu" bất kể mode nào, N ngày chỉ mang tính NHẮC (badge "Quá hạn"), không khoá —
  đã đọc lại kỹ code + xác nhận hành vi này ĐÚNG như mô tả, không sửa.
  Việc thật sự còn thiếu: **cascade trạng thái cha-con của cây Công việc** (`computeParentWorkItemStatus()`,
  `lib/recordActions.js`, dùng bởi `syncOperationWorkItemAncestors()` ở `routes/records.js`, gọi đệ quy
  lên tới gốc sau MỌI lần 1 việc lá đổi trạng thái) trước đây CHỈ có 2 mốc thật (cha nhảy thẳng
  `DANG_THUC_HIEN` → `DA_NGHIEM_THU`, bỏ qua hẳn bước "hoàn thành" trung gian) — thêm mốc thứ 3: **TẤT CẢ
  con đã "hoàn thành" (`DANG_NGHIEM_THU`) nhưng chưa nghiệm thu hết → cha TỰ ĐỘNG "hoàn thành"**
  (`DANG_NGHIEM_THU`, tự set `completedAt` như 1 việc lá thật) — đúng yêu cầu "cv con hoàn thành sẽ tự
  động hoàn thành cv cha, cv con nghiệm thu xong hết sẽ hoàn thành nghiệm thu cv cha". Đệ quy đúng nhiều
  cấp (đã test 3 cấp: cháu → con → gốc). Gate "Đưa vào sử dụng"/mốc hiển thị "Đã nghiệm thu"
  (`computeOperationRecordStageStatus()`) đã tự đúng KHÔNG cần sửa gì thêm — vẫn đòi `DA_NGHIEM_THU` thật
  trên toàn bộ cây (cha cascade lẫn lá), "hoàn thành" (`DANG_NGHIEM_THU`) trung gian KHÔNG được tính là đủ
  điều kiện đóng hồ sơ (đã viết test riêng xác nhận không bị cascade mới làm lỏng gate). 2 bản mirror
  (server `lib/recordActions.js` + client `operationComputeParentWorkItemStatus()`/
  `syncOperationWorkItemAncestorsClient()` ở `public/index.html`) sửa đồng thời như quy ước cũ.
- **Correction 2 — "Ngân Sách Phê Duyệt" tách field RIÊNG, ĐỘC LẬP (sửa lỗi thiết kế đợt trước)**: đợt
  `7.7` LẤY NHẦM `estimatedBudget` (Mở mới)/`amount` (Sửa chữa) — vốn là field "Chi Phí Phê Duyệt" có sẵn
  từ trước — làm nguồn cho 2 cột "Ngân Sách Phê Duyệt"/"Ngân Sách Còn Lại" ở Danh Mục Đầu Tư. Người dùng
  xác nhận đây là 2 khái niệm khác nhau. Thêm field MỚI `approvedBudget` — nhập **ngay lúc lập hồ sơ**
  (form Mở mới/Sửa chữa, ô "Ngân Sách Phê Duyệt — Danh Mục Đầu Tư (VNĐ)", bắt buộc nhập), validate ở
  `lib/createValidation.js extraValidate` cả 2 collection (số không âm, bắt buộc — throw 400 nếu thiếu).
  Bảng tổng hợp Danh Mục Đầu Tư + modal "Ngân Sách Còn Lại" đổi hẳn sang đọc `approvedBudget`, KHÔNG còn
  đụng `estimatedBudget`/`amount` (2 field này GIỮ NGUYÊN ý nghĩa cũ, vẫn hiển thị "Chi Phí Phê Duyệt" ở
  nơi khác). Hồ sơ CŨ trước bản vá này không có `approvedBudget` — **CHỦ ĐÍCH để `null`, KHÔNG backfill
  ngược** từ `estimatedBudget`/`amount` (2 field độc lập, không suy ra được) — UI hiện "(chưa nhập)"/"—"
  thay vì 0/NaN/số âm sai, người phụ trách hồ sơ tự bổ sung sau. Form "Bổ Sung" (sửa lại hồ sơ DRAFT cũ,
  chỉ còn dùng cho dữ liệu tồn từ trước Mục H) cũng thêm field này cho đủ.
- **Correction 3 — cv con có nút "🔄 Cập Nhật Tiến Độ" + "✅ Hoàn Thành" giống hệt module Công Việc công
  ty**: trước đây mỗi việc LÁ chỉ có 2 nút text rời rạc "▶ Bắt Đầu"/"📤 Nộp Nghiệm Thu", không có ghi chú
  tiến độ. Thêm modal MỚI `#operationWorkItemProgressModal` mirror ĐÚNG UI/UX `#taskProgressModal` của
  module Công Việc (dropdown trạng thái kế tiếp + ô "Ghi chú tiến độ" tuỳ chọn, lưu vào `history[].note`
  — `updateOperationWorkItemProgress()` nhận thêm tham số `note`) — áp dụng cho MỌI việc lá ở MỌI cấp
  trong cây (không chỉ cv gốc), giữ nguyên gate quyền cũ (toàn quyền `operationExecutionManage` HOẶC đúng
  người trong `assignedTo[]`, xem `updateOperationWorkItemProgressAction()`). Nút tắt "✅ Hoàn Thành"
  (chuyển thẳng "Đang nghiệm thu") vẫn giữ riêng khi việc đang "Đang thực hiện", đúng yêu cầu "có nút cập
  nhật cv VÀ hoàn thành".

Đã viết test mới cho cả 3: cascade 3 cấp (`tests/test-operation-store-lifecycle.js`, cả unit
`computeParentWorkItemStatus()` ở `tests/test-operation-danhmuc-dautu-units.js`), `approvedBudget` bắt
buộc + hồ sơ cũ thiếu field hiện đúng "(chưa nhập)", và click-through UI thật cho modal Cập Nhật Tiến Độ +
gate quyền (NOPERM không thấy nút, WORKER là assignee mới thấy). Demo Playwright đầy đủ vòng đời (tạo hồ
sơ → nhập ngân sách → lập cây công việc → cascade hoàn thành/nghiệm thu tự động → đưa vào sử dụng), 12 ảnh
chụp màn hình gửi kèm báo cáo.

**Không cần migrate dữ liệu cũ** cho `approvedBudget` (để `null`, UI tự xử lý hiển thị) — không có thay
đổi `schema.sql`/`.env.example`/`dependencies`.

## Trước đó — Vận Hành > Siêu Thị: vòng đời hiển thị mới, Danh Mục Đầu Tư sửa được sau khi lưu + cột ngân sách, bỏ hẳn Tạo Kỳ, không cho xoá hồ sơ, Import/Export Excel, fix hồ sơ cũ kẹt PENDING

Tiếp nối đợt trước ("Vận Hành > Siêu Thị: Chi Phí Phê Duyệt, Danh Mục Đầu Tư, Thực Hiện linh hoạt, bỏ phê
duyệt nội bộ" — Mục A-H, xem mục "Trước đó" bên dưới) theo yêu cầu người dùng tiếp theo, CHỈ cho 2 luồng
`operationStoreOpenings` ("Mở Mới Siêu Thị")/`operationRepairs` ("Sửa Chữa Siêu Thị") — KHÔNG đụng
`operationOrders` ("📦 Phê Duyệt Đơn Hàng") hay bất kỳ module nào khác.

**Quan trọng — đọc kỹ trước khi coi đây là việc làm từ đầu**: phần lớn nền tảng (bỏ phê duyệt hồ sơ
chính, đổi "Dự toán" → "Danh mục đầu tư", Kỳ Thực Hiện đã thành KHÔNG BẮT BUỘC, "Chi Phí Còn Lại" live)
**đã có sẵn** từ đợt trước — bản tóm tắt giao việc ban đầu (dựa trên trí nhớ phiên làm việc trước) nói
sai rằng "Danh Mục Đầu Tư" chưa tồn tại; đã tự xác minh lại toàn bộ code trước khi thiết kế, theo đúng
yêu cầu. Việc thật sự làm ở đợt này là các khoảng trống CÒN LẠI so với yêu cầu người dùng mới nhất:

- **Vòng đời hiển thị mới (5 mốc, thay hẳn badge trạng thái cũ DRAFT/PENDING/APPROVED/REJECTED cho 2
  luồng này)** — hàm thuần MỚI `computeOperationRecordStageStatus()` (`lib/recordActions.js`, mirror
  client `computeOperationRecordStageStatusClient()`/`operationRecordStageStatus()` ở `public/index.html`,
  cùng quy ước "2 cài đặt độc lập" đã dùng cho `computeParentWorkItemStatus`): **KHÔNG lưu field mới**,
  tính lại trực tiếp mỗi lần hiển thị từ `estimateStatus`/`estimateItems`/danh sách work items/
  `useConfirmStatus` đã có sẵn — tránh nguy cơ lệch dữ liệu do quên đồng bộ ở 1 trong nhiều điểm ghi.
  5 mốc đúng nguyên văn yêu cầu: **"Hồ sơ đã lập"** (`LAP`, ngay lúc tạo) → **"Đã lập danh mục đầu tư"**
  (`DANH_MUC_DAU_TU`, sau khi lưu Danh mục đầu tư có ít nhất 1 hạng mục) → **"Đã lập danh sách công việc"**
  (`DANH_SACH_CONG_VIEC`, sau khi có ít nhất 1 công việc Thực hiện) → **"Đã nghiệm thu"** (`NGHIEM_THU`,
  KHI TOÀN BỘ cây công việc — cả việc lớn lẫn việc con — đã "Đã nghiệm thu") → **"Đóng hồ sơ và đưa vào sử
  dụng"** (`DONG_HO_SO`, sau khi bấm nút có sẵn "🏁 Xác Nhận Đưa Vào Sử Dụng"/`confirmOperationUse()` —
  nút này đã tồn tại từ đợt trước, chỉ còn thiếu đúng nhãn trạng thái hiển thị mới). Áp dụng vào badge cột
  "Trạng Thái" (2 bảng Mở mới/Sửa chữa), 5 dashboard-card + ô lọc "Trạng Thái" (chỉ 2 tab này — tab Đơn
  Hàng giữ nguyên PENDING/APPROVED/REJECTED cũ).
- **Danh mục đầu tư sửa được cả sau khi đã lưu (APPROVED)** — trước đây `submitOperationEstimate()` chỉ
  nhận lại từ `DRAFT`, lưu xong là hết đường sửa (ngõ cụt thật, đúng như người dùng phản ánh). Nay nhận
  thêm từ `APPROVED`; mỗi hạng mục được gán `id` ổn định (giữ nguyên qua các lần sửa nếu client gửi lại
  đúng id cũ) để làm nền cho tương lai, dù đợt này **chủ đích KHÔNG** dùng id đó để tự tạo/xoá công việc
  Thực hiện tương ứng — xem quyết định thiết kế "Danh mục đầu tư ↔ Công việc" ngay dưới.
- **Quyết định thiết kế — "tự động cập nhật sang nghiệm thu" nghĩa là gì**: đã CÂN NHẮC rồi bỏ phương án
  tự tạo/xoá công việc Thực hiện theo từng hạng mục Danh mục đầu tư (thử code thật, phát hiện qua chính
  bộ test hiện có: hồ sơ CŨ chỉ cần sửa nhỏ Danh mục đầu tư cũng bất ngờ sinh công việc "ma" cho TOÀN BỘ
  hạng mục cũ; và về nghiệp vụ, 1 hạng mục ngân sách có thể ứng với 0/1/nhiều công việc thi công thực tế,
  ép đúng 1-1 sẽ sai). Quyết định cuối: Danh mục đầu tư và cây Công việc là **2 khái niệm độc lập** như
  cũ (Công việc vẫn thêm/sửa/xoá tay) — "tự động cập nhật" là mọi con số/trạng thái SUY RA từ Danh mục
  đầu tư (vòng đời hiển thị ở trên, "Ngân Sách Còn Lại" dưới đây) đều tính lại NGAY mỗi lần hiển thị,
  không cần bước đồng bộ thủ công nào.
- **2 cột ngân sách mới ở bảng tổng hợp "Danh mục đầu tư"** (`#operationEstimateTableBody`, TRƯỚC ĐÂY chỉ
  có ở trong modal từng hồ sơ dưới tên "Chi Phí Còn Lại"): **"Ngân Sách Phê Duyệt"** (bên trái cột "Tổng
  Danh Mục Đầu Tư", = `estimatedBudget` cho Mở mới / `amount` cho Sửa chữa — field CÓ SẴN, nhập lúc lập
  hồ sơ, không thêm field mới) và **"Ngân Sách Còn Lại"** (bên phải, = Ngân Sách Phê Duyệt − Tổng Danh
  Mục Đầu Tư, tự tính, số âm tô đỏ) — đúng thứ tự cột người dùng yêu cầu.
- **Bỏ HẲN "Tạo Kỳ"** (khác đợt trước chỉ làm optional) khỏi cả màn Thực hiện lẫn Lập công việc: xoá form
  "+ Tạo Kỳ Mới"/nút "▶ Bắt Đầu"/ô chọn Kỳ trong form thêm công việc, cùng 4 hàm client liên quan
  (`renderOperationExecutionPeriodsBox`/`toggleOperationExecutionPeriodCreateForm`/
  `submitOperationExecutionPeriod`/`startOperationExecutionPeriodAction`) — kèm dọn `CORE_FIELD_MANIFEST`/
  `FORM_TABS` entry `OPERATION_EXECUTION_PERIOD` (tab "Biểu Mẫu" tuỳ biến nhãn cho 1 form không còn tồn
  tại nữa thì cũng vô nghĩa). GIỮ NGUYÊN server (`operationExecutionPeriods` collection/route/validate) +
  `periodId`/`periodName` optional trên work items — hồ sơ CŨ còn gắn kỳ vẫn hiển thị đúng badge, không
  cần migrate dữ liệu.
- **Fix bug thật "Danh mục cv trong thực hiện đang lỗi ko lập và tạo được"** — root-cause xác nhận qua
  dữ liệu thật trong DB sandbox (không đoán): hồ sơ lập TRƯỚC khi Mục H (bỏ phê duyệt) tồn tại có thể còn
  kẹt ở `status`/`estimateStatus` = `PENDING` — với `estimateStatus` đặc biệt nghiêm trọng vì
  `submitOperationEstimate()`/`resetOperationEstimateToDraft()` chỉ nhận từ `DRAFT`/`APPROVED`/`REJECTED`,
  **không có đường thoát nào từ `PENDING`** → không bao giờ lập được Danh mục đầu tư → không bao giờ mở
  khoá được Thực hiện. Thêm di trú 1 lần lúc khởi động `migrateStuckOperationApprovalStatuses()`
  (`seedDefaults.js`, idempotent, cùng khuôn `migratePendingActualBudgetEntries()` đã có cho Ngân Sách):
  mọi bản ghi 2 collection này còn kẹt `PENDING` (hồ sơ chính hoặc Danh mục đầu tư) tự chuyển `APPROVED`,
  ghi `SYSTEM_MIGRATION`.
- **Hồ sơ Mở Mới/Sửa Chữa sau khi lập xong KHÔNG được xoá** — chặn ở ĐÚNG route ghi CSDL
  (`POST /api/records/operation{StoreOpenings,Repairs}/:id/delete` trả 403 KHÔNG điều kiện, kể cả admin —
  route CASCADE-xoá cũ đã gỡ hoàn toàn, không còn ngoại lệ nào), không chỉ ẩn nút ở client (dù nút cũng đã
  ẩn, `buildOperationRowHTML()` chỉ còn hiện "🗑️ Xóa" cho `operationOrders`).
- **Import/Export Excel + file mẫu tiếng Việt** cho cả Danh mục đầu tư lẫn Danh sách công việc — mirror
  đúng khuôn `lib/storeCatalogImport.js`/`routes/storeCatalogImport.js` (đọc file qua
  `lib/xlsxSafeRead.js` chống zip-bomb, KHÔNG dùng gói `xlsx`/SheetJS): `lib/operationImport.js` +
  `routes/operationImport.js` (mount `/api/operation`) — 2 route mẫu (`GET .../estimate-import-template`,
  `.../workitem-import-template`) + 2 route đọc (`POST .../estimate-parse-import`,
  `.../workitem-parse-import`, CHỈ đọc/trả JSON, không tự ghi — client vẫn phải gọi đúng API ghi thật có
  sẵn cho từng dòng, giữ nguyên toàn bộ validate/quyền). XUẤT dùng lại thẳng route dùng chung có sẵn
  `POST /api/admin/export-xlsx`, không cần route mới. **Phạm vi Import công việc CHỦ ĐÍCH thu hẹp về công
  việc GỐC** (không import được cây cha/con qua Excel — phức tạp không tương xứng lợi ích, việc con vẫn
  thêm tay "➕ Con" như cũ).

**2 fix phụ phát hiện qua chính bộ test hiện có khi xoá "Tạo Kỳ"** (ngoài phạm vi yêu cầu gốc, tự sửa vì
là bug thật do chính đợt này gây ra): (1) sót 1 dòng gán `owiPeriodCreateFormOpen = false` không khai báo
biến (implicit global, không lỗi cú pháp nên "new Function()" parse-check không bắt được — chỉ lộ ra khi
thật sự chạy) trong `openOperationWorkItemModal()`; (2) `tests/test-forms-batch3.js` (đợt Biểu Mẫu cũ) có
1 kịch bản test riêng cho form "Tạo Kỳ Mới" đã xoá — cập nhật bỏ kịch bản đó, `NEW_TABS` còn 10 (từ 11).

**Xác nhận qua demo Playwright** (mock backend chạy `lib/recordActions.js`/`lib/createValidation.js`
THẬT trong tiến trình Node — cùng khuôn `tests/testHarness.js` mọi test khác dùng, KHÔNG có tài khoản demo
sẵn có/quyền admin thật trên SQL Server sandbox của phiên này để chạy trên `server.js` thật đầu-cuối; xem
phần "Giới hạn kiểm thử" bên dưới): chạy trọn vòng đời 5 mốc cho 1 hồ sơ Mở Mới + 1 hồ sơ Sửa Chữa — lập
hồ sơ (APPROVED/LAP ngay) → xác nhận KHÔNG có nút Xoá + gọi thẳng API xoá (bỏ qua UI, tài khoản admin
thật) vẫn bị chặn → lập Danh mục đầu tư (DANH_MUC_DAU_TU, cột Ngân Sách Phê Duyệt/Còn Lại đúng số) → mở
lại xác nhận vẫn sửa được → sang Thực hiện xác nhận KHÔNG còn UI "Tạo Kỳ" → lập công việc gốc THÀNH CÔNG
(xác nhận bug báo cáo đã hết) → DANH_SACH_CONG_VIEC → tiến độ + nghiệm thu → NGHIEM_THU → "Đưa vào sử
dụng" → DONG_HO_SO. 22 ảnh chụp màn hình đã lưu.

**Giới hạn kiểm thử (nêu rõ, không giấu)**: phiên làm việc này không có sẵn tài khoản demo non-admin nào
có quyền Vận Hành trên SQL Server sandbox thật, và không có mật khẩu/TOTP của tài khoản `admin` có sẵn để
đăng nhập thật (không tự tạo tài khoản mới bằng cách ghi thẳng CSDL ngoài luồng ứng dụng — bị chặn có chủ
đích). Vì vậy demo Playwright ở trên chạy trên mock backend (dùng chung code nghiệp vụ thật) thay vì
`server.js` thật đầu-cuối như các đợt trước. Đã bù lại bằng: (1) `tests/test-operation-danhmuc-dautu-units.js`
(17 kịch bản, hàm thuần không qua mock) test trực tiếp `computeOperationRecordStageStatus()`/
`submitOperationEstimate()`/`rejectOperationDelete()`/`lib/operationImport.js` (round-trip mẫu Excel thật
qua `exceljs`); (2) xác nhận trực tiếp qua SQL Server thật (đang chạy sẵn, Docker `vpdt-mssql`) rằng bug
"kẹt PENDING" có xảy ra thật trong dữ liệu sandbox hiện có (1 hồ sơ `operationStoreOpenings` thật đang kẹt
`status: PENDING`), xác nhận migration mới viết đúng nhắm vào tình huống thật.

**Regression**: toàn bộ 54 file `tests/test-*.js` PASS — chỉ còn đúng 2 lỗi known pre-existing cần SQL
Server thật (`test-audit-fixes-batch1.js`/`test-audit-round2-cluster1.js`, timeout thoát tiến trình chứ
không phải lỗi nghiệp vụ, cùng 2 file đã biết từ trước). `tests/test-operation-store-lifecycle.js` mở
rộng thêm 5 kịch bản mới (40 → 45) cho đúng vòng đời/xoá/sửa-lại-danh-mục/cột ngân sách; sửa
`tests/test-forms-batch3.js` (nêu ở trên); thêm mới `tests/test-operation-danhmuc-dautu-units.js` (17
kịch bản).

**Deploy-impact:** KHÔNG đổi `sql/schema.sql` (mọi field mới — `estimateItems[].id`, `assignedTo`... —
đều nằm trong payload JSON blob sẵn có của `dbo.Records`). KHÔNG thêm biến môi trường mới. KHÔNG thêm
`dependencies` mới (`exceljs`/`multer`/`express-rate-limit` đều đã có sẵn, dùng lại nguyên). **1 migration
tự động lúc khởi động** (`migrateStuckOperationApprovalStatuses()`, idempotent, không cần thao tác tay) —
chuyển các hồ sơ Mở Mới/Sửa Chữa cũ còn kẹt `PENDING` sang `APPROVED`, xem phần fix bug ở trên.

## Trước đó — Biểu Mẫu: gộp 43 tab phẳng thành tab+sub-tab theo nhóm + Ngân Sách Thực Hiện bỏ phê duyệt

Gồm 2 phần độc lập, gộp chung 1 lần merge theo yêu cầu người dùng.

### Phần A — "📋 Biểu Mẫu": tab+sub-tab (nhóm → form), mirror màn "Quy Trình & Phê Duyệt"

Sau 4 đợt mở rộng liên tiếp, "📋 Biểu Mẫu" đã phình ra 43 nút tab phẳng (`FORM_TABS`) xếp thành 1 hàng
dài khó dùng. Đưa về đúng 2 cấp, cùng khuôn `WF_MODULE_CONFIG`/`renderWfSubmissionTypeTabs()` bên màn
"🔄 Quy Trình & Phê Duyệt":

- Mỗi entry `FORM_TABS` thêm field `group` (20 nhóm nghiệp vụ thật, mảng mới `FORM_GROUPS` — VD "Hợp
  Đồng" gộp `CONTRACT_APPROVAL`/`CONTRACT_MANAGE`, "Hỗ Trợ IT" gộp `IT_PRICE`/`IT_TICKET`/`IT_RENEWAL`,
  "Đào Tạo" gộp 9 form kể cả 2 form "Đào Tạo Tân Binh"...).
- `renderFormTabsBar()` giờ vẽ **cấp 1**: 1 nút/nhóm (~20 nút thay vì 43). `renderFormSubTabsBar()`
  (hàng mới `#formSubTabsBar`) vẽ **cấp 2**: các form cụ thể trong nhóm đang chọn — **chỉ hiện khi
  nhóm có >1 form**; nhóm chỉ 1 form (VD "Tài Liệu", "Công Việc"...) thì bấm nút cấp 1 vào THẲNG form
  đó, không có gì để chọn thêm (đúng hệt module không `hasTypes` bên WF).
- `switchFormGroup(group)`/`switchFormTab(tabKey)` (hàm mới/sửa) tự đồng bộ 2 hàng tab + tự chọn đúng
  nhóm chứa `activeFormTab` mỗi khi mở lại màn — `activeFormTab` (nguồn chân lý cho
  `CORE_FIELD_MANIFEST`/`DB.formTemplates`) và toàn bộ tầng dữ liệu/field-editing **giữ nguyên 100%**,
  đây thuần là thay đổi điều hướng UI.
- Cập nhật `tests/test-forms-batch1.js..batch4.js` (đọc `formTabsBar` cấp bằng tên tab cũ) sang điều
  hướng qua `switchFormGroup()`/hàng tab con mới — không sửa/nới lỏng assertion nào, chỉ đổi bước bấm.
  Thêm `tests/test-forms-nav-groups.js` (mới, 207 kịch bản): lặp ĐỘNG qua toàn bộ `FORM_TABS` xác nhận
  mọi form đều đến được qua đúng nhóm cấp 1 (+ cấp 2 nếu có), không hard-code danh sách 43 tab bằng tay.

### Phần B — Ngân Sách: "Thực Hiện" (ACTUAL) bỏ hẳn bước phê duyệt, chỉ "Phê Duyệt" (PLAN) còn qua Trưởng phòng

Theo đúng yêu cầu người dùng: ACTUAL là nhân viên tự ghi nhận chi tiêu thực tế, người quản lý chỉ cần
xem/kiểm soát chứ không "duyệt" — Ngân Sách ở đây chỉ là công cụ quản lý nội bộ cho đơn vị.

- `submitBudgetEntry()` (`lib/recordActions.js`): `entryKind==='ACTUAL'` giờ đi THẲNG `DRAFT ->
  APPROVED` (bỏ qua `PENDING`), ghi 1 dòng lịch sử `SUBMITTED_NO_APPROVAL` làm dấu vết — cùng tinh thần
  Mục H (bỏ phê duyệt Vận Hành > Siêu Thị) nhưng khác ở chỗ bước "Gửi" vẫn tồn tại, chỉ đích đến cuối
  đổi. `entryKind!=='ACTUAL'` (PLAN) **giữ nguyên 100%** luồng `DRAFT -> PENDING -> Trưởng phòng duyệt`.
- **Di trú 1 lần lúc khởi động** (`seedDefaults.js` → `migratePendingActualBudgetEntries()`, idempotent):
  mọi `budgetEntries` cũ có `entryKind==='ACTUAL'` đang kẹt ở `PENDING` (gửi trước khi đổi, chờ 1 phê
  duyệt sẽ không bao giờ tới) tự chuyển sang `APPROVED`, kèm dòng lịch sử `SYSTEM_MIGRATION`.
  **Đã kiểm thử thủ công**: chèn 1 bản ACTUAL/PENDING giả, khởi động lại server, xác nhận tự chuyển
  đúng sang APPROVED.
- **Sửa trực tiếp bản ACTUAL bất kể trạng thái**: thêm `updateApprovedActualBudgetEntry()` +
  route `POST /api/records/budgetEntries/:id/manager-edit` + modal mới `#budgetManagerEditModal`
  ("✏️ Sửa (Quản Lý)" ở danh sách sub-tab "Ngân Sách Thực Hiện") — chỉ `budgetManage`/admin, áp dụng
  cho MỌI trạng thái (kể cả đã APPROVED), vì ACTUAL không còn ai "duyệt" để bắt lỗi số liệu nữa.
- Nút Duyệt/Từ chối ở modal xử lý (`openBudgetProcessModal()`) tự động KHÔNG còn hiện cho bản ACTUAL
  (gate có sẵn `canApprove = status==='PENDING'`, ACTUAL không còn đường tới PENDING) — không cần sửa
  gì thêm. Đổi nhãn nút "📤 Gửi Duyệt" → "📤 Ghi Nhận" + các câu chữ xác nhận/thông báo ở sub-tab "Ngân
  Sách Thực Hiện" (KHÔNG đụng tới sub-tab "Ngân Sách Phê Duyệt"). `renderBudgetSummaryResult()`
  (Tổng Hợp) không cần sửa — vẫn lọc `status==='APPROVED'` cho cả 2 loại, ACTUAL giờ tới APPROVED
  nhanh hơn nhưng cùng điều kiện.
- Mở rộng `tests/test-office-budget.js` (kịch bản 9b/10): ACTUAL "Gửi" đi thẳng APPROVED (không qua
  Trưởng phòng), PLAN giữ nguyên luồng cũ, modal xử lý cho bản ACTUAL đã APPROVED không còn nút Duyệt.

### Kiểm thử

Toàn bộ `tests/test-*.js` (53 file) chạy lại — chỉ còn đúng 2 lỗi known pre-existing cần SQL Server
thật (`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js` — mọi kịch bản BÊN TRONG đều PASS,
100% scenario, exit code khác 0 chỉ là treo tiến trình lúc thoát, không phải lỗi nghiệp vụ), không phát
sinh regression nào khác. Demo Playwright thật trên server thật (Docker `vpdt-mssql` + `node server.js`,
tài khoản `demo_forms_admin`) xác nhận cả 2 phần hoạt động đúng trên app thật (không chỉ mock) — 18/18
kịch bản pass, đã dọn sạch dữ liệu/label demo sau khi xong.

## Trước đó — Biểu Mẫu Đợt 4: nốt các form Đào Tạo còn lại + 1 gap-fill (7 tab mới) — HOÀN TẤT

Đợt cuối dọn "Phạm vi CHƯA làm" ghi ở cuối Đợt 3: đưa 6 form Đào Tạo còn lại vào "📋 Biểu Mẫu" —
`trainingCourseForm` (Tạo Chương Trình), `trainingPlanForm` (Kế Hoạch Đào Tạo), `trainingDocForm` (Kho Tài
Liệu), `careerPathForm` (Lộ Trình Thăng Tiến), `onboardingPathForm` + `onboardingAssignForm` (Đào Tạo Tân
Binh — Quản Lý Lộ Trình/Phân Công, 2 form riêng biệt).

**Audit toàn app phát hiện thêm 1 gap-fill ngoài phạm vi gốc**: đếm lại TOÀN BỘ `<form id=...
data-op-submit=...>` thật trong `public/index.html` (đúng 25 form) đối chiếu với `CORE_FIELD_MANIFEST` —
chỉ còn đúng 1 form chưa có coreKey: `#trainingEditClassForm` (modal "✏️ Sửa Lớp Học", mở từ bảng Lớp Học
qua `openEditTrainingClassModal()`) — bản SỬA riêng biệt của `trainingClassForm` (Tạo Mới), id khác hẳn
(prefix `te` thay vì `tc`), Đợt 3 chỉ phủ form Tạo Mới nên bỏ sót form Sửa này. Thêm coreKey thứ 7:
`TRAINING_CLASS_EDIT` (14 field, mirror đúng `TRAINING_CLASS`). Sau khi thêm, **cả 25/25 form nhập liệu
thật trong toàn app đều đã có coreKey phủ** — xác nhận bằng 1 kịch bản audit riêng trong
`tests/test-forms-batch4.js` (đếm động số `<form>` thật lúc chạy, không hard-code số 25) để tránh audit tự
vô hiệu hoá nếu file thay đổi sau này.

**7 `coreKey` mới trong `CORE_FIELD_MANIFEST`**: `TRAINING_COURSE` (3 field), `TRAINING_PLAN` (7 field),
`TRAINING_DOC` (6 field), `CAREER_PATH` (3 field), `ONBOARDING_PATH` (4 field), `ONBOARDING_ASSIGN` (2
field), `TRAINING_CLASS_EDIT` (14 field) — cùng 7 `FORM_TABS` entry mới. Cơ chế áp dụng
(`applyCoreFieldCustomizations()`/`applyAllCoreFieldCustomizations()`) vẫn CHUNG cho mọi coreKey, KHÔNG
phát sinh ngoại lệ call-site riêng nào ở đợt này — tất cả 7 form đều là DOM TĨNH có sẵn từ lúc tải trang
(kể cả `#onboardingAssignForm`, LÀ 1 `<div>` chứ không phải `<form>`, chỉ `classList.toggle('hidden')`
theo quyền, không render lại qua `innerHTML` — khác hẳn ngoại lệ `OPERATION_EXECUTION_PERIOD` ở Đợt 3).

**3 field bị loại trừ có chủ đích khỏi `TRAINING_DOC`** (audit div-wrapping + nhãn động, cùng tinh thần
Đợt 1/3): `tdMandatory` (checkbox "⚠️ Bắt Buộc Hoàn Thành") — `<label>` BỌC TRỰC TIẾP input checkbox
(`<label><input id="tdMandatory">...</label>`, không phải label SIBLING trong div dùng chung như mọi field
khác), nên `applyCoreFieldCustomizations()` sẽ ghi đè `labelEl.innerHTML` và XOÁ MẤT checkbox khỏi DOM nếu
đưa vào — field DUY NHẤT có cấu trúc ngược này trong toàn app, loại khỏi manifest thay vì sửa lại markup.
`tdFile`/`tdFileLabel` — nhãn bị `onTrainingDocTypeChange()` tự đổi qua lại "Tệp Tài Liệu"/"Ảnh Tài Liệu"
theo `#tdDocType`, cùng lý do `tcDocumentIds` bị loại ở Đợt 3. Ngược lại, `teDocumentIds` (Giáo Trình) ở
`TRAINING_CLASS_EDIT` ĐƯA VÀO ĐƯỢC bình thường — form Sửa Lớp Học không cho đổi `#tcMode` sau khi tạo
(mode đã khoá), nên nhãn field này CỐ ĐỊNH, không có hàm nào tự đổi qua lại như bản Tạo Mới.

**optionsKey mới**: `tccCategory` (TRAINING_COURSE)/`tdCategory` (TRAINING_DOC) trỏ `DB.trainingCategories`
— CÙNG danh sách với `tcCategory`/`ttCategory` đã có từ Đợt 3 (populate qua chung 1 vòng lặp
`['tcCategory','tdCategory','tccCategory'].forEach(...)` trong `renderTrainingLms()`) — chỉ THÊM 1 lối sửa
song song, không đụng `defaults.js`/`routes/data.js`. `tpCourseId`/`tpTargetDept`/`opStage1/2RequiredCourseIds`
KHÔNG có optionsKey — select tham chiếu dữ liệu khác (trainingCourses/depts), không phải danh sách nhãn cố
định.

**Test**: `tests/test-forms-batch4.js` (MỚI, cùng khuôn `tests/test-forms-batch1-3.js` — mock DOM/DB) — 43
kịch bản: 7 tab mới hiện đúng; sửa nhãn mặc định qua `editCoreField()`+`addCustomField()` phản ánh đúng lên
form thật cho TRAINING_COURSE/TRAINING_PLAN/TRAINING_DOC/CAREER_PATH/ONBOARDING_PATH/ONBOARDING_ASSIGN/
TRAINING_CLASS_EDIT, xác nhận không lem nhãn sang field liền kề; `ONBOARDING_ASSIGN` xác nhận hoạt động
đúng dù là `<div>` không phải `<form>`; xác nhận `tdMandatory` KHÔNG bị xoá khỏi DOM (checkbox vẫn còn
nguyên sau `applyAllCoreFieldCustomizations()`); xác nhận `tdFile`/`cpStageBuilderContainer` bị loại trừ
đúng; cả 7 tab mới đều đủ field mặc định và KHÔNG có nút xoá; 1 kịch bản audit toàn app xác nhận cả 25
form thật đều có coreKey phủ. Chạy lại toàn bộ `tests/test-*.js` (52 file) — chỉ còn đúng 2 lỗi known
pre-existing cần SQL Server thật (`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js` — mọi kịch
bản BÊN TRONG đều PASS), không phát sinh regression nào khác (bao gồm chạy lại `test-forms-batch3.js` —
49/49 vẫn pass).

Demo Playwright thật (Docker `vpdt-mssql` + `node server.js` đang chạy sẵn, tài khoản `demo_forms_admin` có
sẵn từ Đợt 1 — reset mật khẩu + `totpEnabled:false` để đi lại đúng màn thiết lập TOTP lần đầu bằng mã 6 số
sinh thật từ `otplib`): đăng nhập, thiết lập TOTP qua đúng API `/totp/setup-options` + `/totp/setup-verify`
với mã thật, mở Hệ Thống → Biểu Mẫu, xác nhận đủ 7 tab mới hiện trên UI thật; sửa nhãn 1 trường mặc định ở
5 form (TRAINING_COURSE/TRAINING_DOC/CAREER_PATH/ONBOARDING_ASSIGN/TRAINING_CLASS_EDIT) qua đúng nút "✏️
Sửa" + form thật, lưu — mở đúng form nghiệp vụ thật tương ứng (bao gồm mở modal "Sửa Lớp Học" thật cho
gap-fill `TRAINING_CLASS_EDIT`) và xác nhận nhãn mới hiện đúng ngay; xác nhận cả 7 tab đều không có nút
xoá nào cho trường mặc định. 23/23 kịch bản pass. Đã dọn lại toàn bộ 5 override demo khỏi `DB.formTemplates`
sau khi chụp ảnh xong, không để lại dữ liệu demo trong hệ thống thật.

**Kết luận audit toàn app (BUSINESS_MODULES × FORM_TABS/CORE_FIELD_MANIFEST)**: sau Đợt 4, KHÔNG còn form
nhập liệu nghiệp vụ thật nào (đếm theo `<form data-op-submit>`) thiếu coreKey trong Biểu Mẫu — yêu cầu gốc
"cho phép admin sửa mọi form nhập liệu thật không cần sửa code" coi như đã HOÀN TẤT cho toàn bộ ứng dụng.
Các màn "Quản Lý Danh Mục" (CRUD tự sửa/xoá trực tiếp) và cấu hình hệ thống tiếp tục CỐ Ý không đưa vào,
đúng nguyên tắc đã chốt từ Đợt 1-3 (Biểu Mẫu chỉ áp cho form TẠO 1 HỒ SƠ NGHIỆP VỤ).

**Deploy-impact**: KHÔNG đổi `sql/schema.sql`, KHÔNG đổi `.env.example`, KHÔNG thêm `dependencies` mới —
chỉ copy code + `pm2 restart`.

## Trước đó — Biểu Mẫu Đợt 3: mở rộng ra Vận Hành/Đào Tạo/Tuyển Dụng + 3 gap-fill (11 tab mới)

Tiếp nối Đợt 1 (`TASK`/`VPP`/`LICENSE`/`IT_PRICE`/`IT_TICKET`) và Đợt 2 (`PAYMENT`/`BUDGET_PERIOD`/
`BUDGET_TEMPLATE`/`REPORT_ENTRY`/`REPORT_PERIOD`/5 coreKey Đồng Phục) — mở rộng module "📋 Biểu Mẫu" ra 3
phân hệ theo yêu cầu người dùng: **Vận Hành** (duyệt đơn hàng/mở mới-sửa chữa siêu thị/công việc thực
hiện-nghiệm thu), **Đào Tạo** (tạo lớp học, ngân hàng câu hỏi), và **Tuyển Dụng** (đăng tin, giới thiệu
ứng viên). Kèm audit đối chiếu `BUSINESS_MODULES` với `FORM_TABS` trên toàn app, phát hiện thêm 3
"biểu mẫu" thật bị Đợt 1/2 bỏ sót: **HCRC Đồng Hành** (gửi câu hỏi tới Nhân Sự, sống trong module Truyền
Thông Nội Bộ), **Hỗ Trợ IT - Gia Hạn Dịch Vụ** (Đợt 1 chỉ tách Đề Xuất Duyệt Giá/Yêu Cầu Hỗ Trợ, bỏ sót
tab con này), và **Vận Hành - Tạo Kỳ Thực Hiện** (form con trong luồng Thực hiện).

**11 `coreKey` mới trong `CORE_FIELD_MANIFEST`** (`public/index.html`): `OPERATION_ORDER` (5 field),
`OPERATION_STORE_OPEN` (9 field), `OPERATION_REPAIR` (8 field), `OPERATION_WORK_ITEM` (4 field),
`OPERATION_EXECUTION_PERIOD` (1 field), `TRAINING_CLASS` (14 field), `TRAINING_TEST` (3 field),
`RECRUITMENT_JOB` (10 field), `RECRUITMENT_REFERRAL` (5 field), `HR_FEEDBACK` (2 field), `IT_RENEWAL`
(9 field) — cùng 11 `FORM_TABS` entry mới. Cơ chế áp dụng (`applyCoreFieldCustomizations()`/
`applyAllCoreFieldCustomizations()`) vẫn CHUNG cho mọi coreKey, không cần call site riêng — ĐÚNG 1 NGOẠI
LỆ DUY NHẤT: `OPERATION_EXECUTION_PERIOD` (field `owiNewPeriodName`) render ĐỘNG qua `innerHTML` (chỉ có
trong DOM khi form "Tạo Kỳ Mới" đang mở, khác mọi field khác vốn là `<div>` tĩnh có sẵn từ lúc tải trang)
nên cần 1 call site `applyCoreFieldCustomizations()` riêng ngay trong `renderOperationExecutionPeriodsBox()`.
Giữ nguyên tắc: mọi trường mặc định chỉ sửa được Nhãn hiển thị + Bắt buộc nhập, KHÔNG xoá được, KHÔNG đổi
kiểu dữ liệu — không thêm nút xoá nào cho trường mặc định ở 11 tab mới.

**Đào Tạo — audit phát hiện `tcDocumentIds` (Giáo Trình) KHÔNG đưa vào `TRAINING_CLASS`**: nhãn của field
này bị `onTrainingClassModeChange()` TỰ ĐỘNG đổi qua lại theo `#tcMode` (2 câu chữ khác nhau tùy
Online/Offline) MỖI LẦN vào lại module/đổi sub-tab — nếu đưa vào manifest, nhãn admin tùy biến sẽ liên tục
bị hàm này ghi đè lại ngay sau khi tải trang. Ngân Hàng Câu Hỏi (`TRAINING_TEST`) — bản thân khối câu hỏi
(`tbQuestionsContainer`) đã là biểu mẫu tự do hoàn toàn (giảng viên tự gõ nội dung/đáp án từng câu, không
có "nhãn mặc định"), không đưa vào — chỉ 3 field cố định ngoài khối câu hỏi. `#uniformCatalogAdminForm`-kiểu
CRUD danh mục (`trainingCourseForm`/`trainingPlanForm`/`trainingDocForm`/`careerPathForm`/
`onboardingPathForm`) CHƯA đưa vào đợt này — xem "Phạm vi CHƯA làm" bên dưới.

**Audit form markup phát hiện 1 lỗi div-wrapping mới, cùng lớp lỗi `#licenseForm` ở Đợt 1**:
`#itRenewalCreateForm` (Hỗ Trợ IT - Gia Hạn Dịch Vụ) có 6 field là con TRỰC TIẾP của `<form>` (không bọc
`<div>` riêng), khiến `applyCoreFieldCustomizations()` có thể ghi đè nhầm nhãn "Ngày bắt đầu"/"Ngày hết
hạn" khi sửa bất kỳ field nào trong số đó — đã bọc lại từng field trong `<div>` riêng trước khi thêm vào
`CORE_FIELD_MANIFEST.IT_RENEWAL`. 3 module còn lại (Vận Hành/Đào Tạo/Tuyển Dụng) audit KHÔNG phát hiện lỗi
tương tự — mọi field được chọn đều đã bọc `<div>` riêng sẵn.

**Không có dropdown "danh sách lựa chọn cố định" nào cần thêm `optionsKey` mới ở đợt này** ngoại trừ
`tcCategory`/`ttCategory` (Loại Đào Tạo) trỏ `DB.trainingCategories` — danh sách NÀY ĐÃ admin-editable qua
màn Quản Lý Danh Mục riêng có sẵn từ trước, optionsKey ở đây chỉ THÊM 1 lối sửa song song, cùng khuôn
`licenseType`/`contractType` ở Đợt 1 — không đụng `defaults.js`/`routes/data.js`/`lib/createValidation.js`
lần này. Mọi radio group (không có id chung, VD `owiAcceptanceMode`/`prEntryMode`) và mọi select chọn 1
bản ghi có sẵn (VD `owiPeriodSelect`) tiếp tục bị loại trừ theo đúng nguyên tắc đã chốt từ Đợt 1/2.

**Dọn dẹp phụ**: audit DB.formTemplates hiện tại phát hiện 3 override nhãn "(Demo Biểu Mẫu)" còn sót lại
từ Đợt 1/2 (`TASK.taskTitleInput`/`LICENSE.licenseIssueDate`/`IT_TICKET.itTicketTitle`) — dữ liệu demo
lẽ ra phải được dọn sau khi chụp ảnh nhưng bị bỏ sót, đang hiển thị SAI trên form thật cho người dùng thật.
Đã dọn sạch cả 3 (không thuộc phạm vi Đợt 3 nhưng phát hiện được trong lúc audit, sửa luôn vì ảnh hưởng
trực tiếp tới người dùng thật).

**Test**: `tests/test-forms-batch3.js` (MỚI, cùng khuôn `tests/test-forms-batch1.js`/`test-forms-batch2.js`
— mock DOM/DB) — 49 kịch bản: 11 tab mới hiện đúng; sửa nhãn mặc định qua `editCoreField()`+
`addCustomField()` phản ánh đúng lên form thật cho OPERATION_ORDER/OPERATION_WORK_ITEM/TRAINING_CLASS/
RECRUITMENT_JOB/RECRUITMENT_REFERRAL/HR_FEEDBACK/IT_RENEWAL, xác nhận không lem nhãn sang field liền kề
(kể cả field không có `<label>` riêng, dùng fallback placeholder); riêng OPERATION_EXECUTION_PERIOD xác
nhận field render động + call site riêng hoạt động đúng; xác nhận `tcDocumentIds` bị loại trừ có chủ đích;
cả 11 tab mới đều đủ field mặc định và KHÔNG có nút xoá. Chạy lại toàn bộ `tests/test-*.js` (51 file) —
chỉ còn đúng 2 lỗi known pre-existing cần SQL Server thật (`test-audit-fixes-batch1.js`,
`test-audit-round2-cluster1.js` — mọi kịch bản BÊN TRONG đều PASS), không phát sinh regression nào khác.

Demo Playwright thật (Docker `vpdt-mssql` + `node server.js`, tài khoản `demo_forms_admin` có sẵn từ Đợt 1
— reset mật khẩu + `totpEnabled:false` để đi lại đúng màn "Bắt Buộc Thiết Lập Xác Thực 2 Lớp" bằng mã 6 số
sinh thật từ `otplib`): mở Biểu Mẫu, xác nhận đủ 11 tab mới hiện trên UI thật; sửa nhãn 1 trường mặc định
ở 4 module (Vận Hành/Đào Tạo/Tuyển Dụng/HCRC Đồng Hành) qua đúng nút "✏️ Sửa" + form thật, lưu — mở form
nghiệp vụ thật tương ứng (`#operationOrderForm`/`#trainingClassForm`/`#recruitmentJobForm`/`#hrFeedbackForm`)
và xác nhận nhãn mới hiện đúng ngay; xác nhận cả 9 tab kiểm tra qua UI thật đều không có nút xoá nào cho
trường mặc định. 28/28 kịch bản pass. Đã dọn lại override demo (`DB.formTemplates`) sau khi chụp ảnh xong,
không để lại dữ liệu demo trong hệ thống thật (kèm dọn sạch cả 3 override demo sót lại từ Đợt 1/2 nêu trên).

**Phạm vi CHƯA làm**: "trường bổ sung" hoàn toàn mới cho 11 tab này CHƯA wire vào form nghiệp vụ thật (như
mọi đợt trước). Đào Tạo còn nhiều form thật khác CHƯA đưa vào Biểu Mẫu (phạm vi gốc chỉ định "tạo lớp học,
ngân hàng câu hỏi"): `trainingCourseForm` (Tạo Chương Trình), `trainingPlanForm` (Kế Hoạch Đào Tạo),
`trainingDocForm` (Kho Tài Liệu), `careerPathForm` (Lộ Trình Thăng Tiến), `onboardingPathForm` +
`onboardingAssignForm` (Đào Tạo Tân Binh) — để dành cho 1 đợt sau nếu người dùng muốn phủ hết Đào Tạo. Toàn
bộ các màn "Quản Lý Danh Mục" (saveCat/saveDept/saveJobTitle/saveLicenseType/saveTrainingCategory/
saveStore/saveStoreJobTitle/saveSensitiveKeyword/saveEmailConfig/saveWorkflowTemplate/saveUser) và cấu
hình hệ thống (API key, Cơ Cấu Tổ Chức "Đổi quản lý trực tiếp" — chỉ 1 field picker, không phải biểu mẫu
nhiều trường) tiếp tục CỐ Ý không đưa vào — đúng nguyên tắc Biểu Mẫu chỉ áp cho form TẠO 1 HỒ SƠ NGHIỆP VỤ,
không áp cho CRUD danh mục đã tự sửa/xoá trực tiếp. Sau Đợt 3, đối chiếu lại toàn bộ `BUSINESS_MODULES`
(19 module/module con) với `FORM_TABS`: chỉ còn đúng phạm vi Đào Tạo nêu trên là gap thật sự đáng kể còn
lại — mọi module khác đã có coreKey phủ đủ mọi form nhập liệu thật.

**Deploy-impact**: KHÔNG đổi `sql/schema.sql`, KHÔNG đổi `.env.example`, KHÔNG thêm `dependencies` mới —
chỉ copy code + `pm2 restart`.

## Trước đó — Biểu Mẫu Đợt 2: mở rộng ra Thanh Toán/Ngân Sách/Báo Cáo Định Kỳ/Đồng Phục (10 tab mới)

Tiếp nối Đợt 1 (`TASK`/`VPP`/`LICENSE`/`IT_PRICE`/`IT_TICKET`) — mở rộng module "📋 Biểu Mẫu" ra đúng 4
phân hệ còn lại theo yêu cầu người dùng: **Thanh Toán** (`#paymentCreateForm`), **Ngân Sách**, **Báo Cáo
Định Kỳ**, và **Đồng Phục**.

**Ngân Sách — audit phát hiện KHÔNG đưa `budgetEntries` (dòng ngân sách theo từng kỳ) vào
`CORE_FIELD_MANIFEST`**: module này đã có sẵn cơ chế tự sửa nhãn/bắt buộc/thêm-bớt cột MẠNH HƠN Biểu Mẫu —
`BUDGET_CORE_FIELD_DEFS` + màn "🧩 Mẫu Ngân Sách" (`budgetTemplateFieldsBody`), admin đổi nhãn 3 cột lõi
(Tên Hạng Mục/Số Tiền/Loại NS) TỪNG MẪU riêng biệt, không có 1 nhãn "mặc định" duy nhất để Biểu Mẫu áp —
gộp thêm sẽ chỉ tạo 2 lối sửa chồng chéo. Chỉ 2 form THẬT SỰ hardcode field cố định được đưa vào: "Tạo Kỳ
Ngân Sách Mới" (`BUDGET_PERIOD`) và "Mẫu Ngân Sách" phần Tên Mẫu (`BUDGET_TEMPLATE`).

**Đồng Phục có 5 form nhập liệu thật riêng biệt** (không dùng chung field nào) → 5 coreKey/tab riêng:
`UNIFORM_PERIOD` (Tạo Kỳ Cấp Phát), `UNIFORM_ISSUE` (Cấp Cho Nhân Viên), `UNIFORM_ADJUST_STOCK` (Báo
Hỏng/Hủy Từ Kho), `UNIFORM_ADJUST_EMPLOYEE` (Thu Hồi Từ Nhân Viên), `UNIFORM_TRANSFER` (Điều Chuyển Kho
Giữa Các Siêu Thị). `#uniformCatalogAdminForm` (Tên Đồng Phục/Size) CỐ Ý không đưa vào — cùng lý do
`licenseTypes`/`contractTypes` ở Đợt 1: đây là màn "Quản Lý Danh Mục" (CRUD danh sách), không phải form 1
hồ sơ nghiệp vụ, admin đã sửa/xoá tự do trực tiếp tại đó rồi.

**10 `coreKey` mới trong `CORE_FIELD_MANIFEST`** (`public/index.html`): `PAYMENT` (4 field), `BUDGET_PERIOD`
(3 field), `BUDGET_TEMPLATE` (1 field), `REPORT_ENTRY` (3 field), `REPORT_PERIOD` (2 field), `UNIFORM_PERIOD`
(2 field), `UNIFORM_ISSUE` (3 field), `UNIFORM_ADJUST_STOCK` (3 field), `UNIFORM_ADJUST_EMPLOYEE` (4 field),
`UNIFORM_TRANSFER` (4 field) — cùng 10 `FORM_TABS` entry mới. Cơ chế áp dụng
(`applyCoreFieldCustomizations()`/`applyAllCoreFieldCustomizations()`) vẫn CHUNG cho mọi coreKey, không cần
call site riêng — đúng như Đợt 1. Giữ nguyên tắc: mọi trường mặc định chỉ sửa được Nhãn hiển thị + Bắt buộc
nhập, KHÔNG xoá được, KHÔNG đổi kiểu dữ liệu — không thêm nút xoá nào cho trường mặc định ở 10 tab mới.

**KHÔNG có dropdown "danh sách lựa chọn cố định" nào cần thêm `optionsKey` mới ở đợt này** — đã audit từng
dropdown (`paymentSourceType`, `budgetPeriodTemplateSelect`, 2 radio "Hình thức nộp" báo cáo, 2/4 radio
"Kết quả" đồng phục...) và xác nhận tất cả đều gắn trực tiếp với logic rẽ nhánh/trạng thái hệ thống cố định
(cùng lý do `itPriceTier`/`licenseOperatingStatus` ở Đợt 1 không có optionsKey), không phải nhãn tự do — nên
KHÔNG đụng `defaults.js`/`routes/data.js`/`lib/createValidation.js` lần này.

Audit form markup cả 4 module — KHÔNG phát hiện lỗi div-wrapping nào giống `#licenseForm` ở Đợt 1 (mọi field
được chọn đều đã bọc riêng `<div>` sẵn từ trước).

**Test**: `tests/test-forms-batch2.js` (MỚI, cùng khuôn `tests/test-forms-batch1.js` — mock DOM/DB) — 41
kịch bản: 10 tab mới hiện đúng; sửa nhãn mặc định qua `editCoreField()`+`addCustomField()` phản ánh đúng lên
form thật cho PAYMENT/BUDGET_PERIOD/REPORT_PERIOD/UNIFORM_ISSUE/UNIFORM_ADJUST_EMPLOYEE, xác nhận không lem
nhãn sang field liền kề (kể cả 2 field "Lý Do" trùng gợi ý ở 2 coreKey UNIFORM khác nhau); cả 10 tab mới đều
đủ field mặc định và KHÔNG có nút xoá. Chạy lại toàn bộ `tests/test-*.js` (50 file) — chỉ còn đúng 2 lỗi
known pre-existing cần SQL Server thật (`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js` — mọi
kịch bản BÊN TRONG đều PASS, process chỉ không tự thoát sau khi xong do connection pool chưa đóng, không
phải lỗi mới), không phát sinh regression nào khác.

Demo Playwright thật (Docker `vpdt-mssql` + `node server.js`, tài khoản `demo_forms_admin` có sẵn từ Đợt 1
— reset `totpEnabled:false` để đi lại đúng màn "Bắt Buộc Thiết Lập Xác Thực 2 Lớp" lần đăng nhập admin đầu
bằng mã 6 số sinh thật từ `otplib`): mở Biểu Mẫu, xác nhận đủ 10 tab mới hiện trên UI thật; sửa nhãn 1
trường mặc định ở cả 4 module (Thanh Toán/Ngân Sách/Báo Cáo Định Kỳ/Đồng Phục) qua đúng nút "✏️ Sửa" + form
thật, lưu — mở form nghiệp vụ thật tương ứng (`#paymentCreateForm`/`#budgetPeriodTemplateModal`/`#prSubPeriods`/
`#uniformSubStore`) và xác nhận nhãn mới hiện đúng ngay; xác nhận cả 10 tab mới đều không có nút xoá nào cho
trường mặc định. 25/25 kịch bản pass. Đã dọn lại override demo (`DB.formTemplates`) sau khi chụp ảnh xong,
không để lại dữ liệu demo trong hệ thống thật.

**Phạm vi CHƯA làm (giống Đợt 1)**: "trường bổ sung" hoàn toàn mới cho 10 tab này CHƯA wire vào form nghiệp
vụ thật (chưa có `dynamicFieldsContainer_*` tương ứng) — admin vẫn thêm được qua UI Biểu Mẫu (lưu vào
`DB.formTemplates`) nhưng chưa hiện trên form thật. Yêu cầu gốc (sửa nhãn/bắt buộc trường MẶC ĐỊNH) đã đủ.

**Deploy-impact**: KHÔNG đổi `sql/schema.sql`, KHÔNG đổi `.env.example`, KHÔNG thêm `dependencies` mới —
chỉ copy code + `pm2 restart`.

## Trước đó — Biểu Mẫu Đợt 1: mở rộng ra Công Việc/Văn Phòng Phẩm/Giấy Phép/Hỗ Trợ IT (5 tab mới)

Module "📋 Biểu Mẫu" (Hệ Thống → Quản Trị) trước đây chỉ phủ 9 phân hệ (Văn Bản Trình, Hợp Đồng ×2, Đăng
Ký Xe, Văn Phòng ×2, Tài Liệu, Biên Bản Họp, Đặt Phòng Họp, Truyền Thông Nội Bộ) — đợt 1 mở rộng thêm
đúng 4-5 phân hệ theo yêu cầu người dùng ("mọi biểu mẫu nhập liệu trong app phải lên được Biểu Mẫu để sửa
nhãn/bắt buộc/danh sách lựa chọn mà không đụng code"): **Công Việc** (form Giao Việc, `#createTaskModal`),
**Văn Phòng Phẩm** (form Tạo Kỳ Đăng Ký, `#vppSubPeriods` — VPP không có "1 hồ sơ = field cố định" như các
module khác, đăng ký là chọn số lượng trực tiếp trên bảng danh mục hàng hoá động theo từng kỳ nên không có
field cố định nào để đưa vào Biểu Mẫu ở đúng màn đó), **Giấy Phép** (`#licenseForm`), và **Hỗ Trợ IT** tách
riêng 2 tab con — **Đề Xuất Duyệt Giá** (`#itPriceCreateForm`) và **Yêu Cầu Hỗ Trợ** (`#itTicketCreateForm`).

**5 `coreKey` mới trong `CORE_FIELD_MANIFEST`** (`public/index.html`): `TASK` (4 field), `VPP` (4 field),
`LICENSE` (10 field), `IT_PRICE` (7 field), `IT_TICKET` (4 field) — cùng 5 `FORM_TABS` entry mới (key
trùng coreKey, mỗi module chỉ có 1 form nên không tách sub-tab như `CONTRACT`/`OFFICE`). Cơ chế áp dụng
(`applyCoreFieldCustomizations()`/`applyAllCoreFieldCustomizations()`) đã CHUNG cho MỌI coreKey từ trước —
chỉ cần khai đúng field id trong manifest là admin sửa nhãn/bắt buộc có hiệu lực ngay trên form thật, không
cần thêm call site riêng cho 5 module mới (đã verify bằng cả Playwright mock lẫn demo thật). Giữ đúng
nguyên tắc đã chốt với người dùng: **mọi trường mặc định chỉ sửa được Nhãn hiển thị + Bắt buộc nhập,
KHÔNG xoá được, KHÔNG đổi kiểu dữ liệu** — không thêm nút xoá nào cho trường mặc định ở 5 tab mới.

**2 dropdown "danh sách lựa chọn cố định" mới thành admin-editable** (`optionsKey`, cùng khuôn
`submissionTypes`/`contractTypes`/`carTypes`/`internalNewsCategories` có sẵn):
- `LICENSE.licenseType` → `optionsKey: 'licenseTypes'` — danh sách NÀY đã tồn tại sẵn (đã admin-editable
  qua màn "Quản Lý Danh Mục" riêng + tự học thêm khi ai gõ loại mới, xem `uploadLicense()`), optionsKey chỉ
  thêm 1 lối sửa song song (đúng khuôn `cats`/DOC đã có 2 lối sửa từ trước), KHÔNG đổi cơ chế tự học.
- `IT_TICKET.itTicketCategory` → `optionsKey: 'itTicketCategories'`, `optionsIsKeyLabel: true` — danh sách
  **MỚI HOÀN TOÀN**: "Danh Mục" của Hỗ Trợ Yêu Cầu IT trước đây gõ cứng 5 `<option>` (`IT_TICKET_CATEGORY_
  LABELS`), giờ chuyển thành `DEFAULTS.itTicketCategories` (`defaults.js`, seed đúng 5 giá trị cũ để không
  đổi hành vi dữ liệu có sẵn) + `ADMIN_ONLY_KEYS` (`routes/data.js`) — client đổ động qua
  `populateItTicketCategorySelect()` (cùng khuôn `populateInternalPostCategorySelects()`), hiển thị đọc qua
  `getItTicketCategoryLabel()` (fallback về nhãn gốc nếu key không còn trong DB — dữ liệu cũ trước khi seed
  chạy). Server-side: `itSupportTickets.extraValidate()` (`lib/createValidation.js`) đổi từ `Set` cố định 5
  giá trị sang đọc `appData.itTicketCategories` (vẫn giữ fallback y hệt `Set` cũ nếu `appData` chưa seed).
  `itPriceTier` (Margin/Chiết Khấu Bán Buôn) và `itPriceMasterListSelect` (Mẫu Giá) CỐ Ý không có optionsKey
  — 2 danh sách này gắn trực tiếp với cấu hình duyệt/khuôn cột đã có màn quản trị riêng, đổi khoá tự do sẽ
  làm mồ côi cấu hình đã gán.

**Fix 1 lỗi thật phát hiện trong lúc audit `#licenseForm`**: nhiều field (`licenseCode`/`licenseCompanyName`/
`licenseLocationName`/`licenseOperatingStatus`/`licenseNumber`/`licenseIssuingAuthority`/`licenseFile`) là
CON TRỰC TIẾP của `<form>` (không bọc riêng từng `<div>`) — cơ chế `applyCoreFieldCustomizations()` tìm
`<label>` qua `input.closest('div')`, nên TRƯỚC KHI thêm `LICENSE` vào manifest, sửa nhãn BẤT KỲ field nào
trong số này sẽ vô tình ghi đè nhãn "Loại thao tác:" ở đầu form (`closest('div')` của các field bare này
đều trỏ về cùng 1 div ngoài cùng chứa label đó). Đã bọc lại từng field trong `<div>` riêng trước khi thêm
`optionsKey`/field vào manifest — không đổi id/giá trị/hành vi nào khác của form, chỉ đổi cấu trúc bọc.

**Test**: `tests/test-forms-batch1.js` (MỚI, cùng khuôn `tests/test-doc.js` — mock DOM/DB, không cần SQL
Server thật) — 26 kịch bản: 5 tab mới hiện đúng trong `renderFormTabsBar()`; sửa nhãn mặc định qua
`editCoreField()`+`addCustomField()` (mô phỏng submit form Biểu Mẫu thật) phản ánh đúng lên form thật cho
TASK/LICENSE; xác nhận sửa 1 field KHÔNG lem nhãn sang field khác (regression guard cho lỗi `#licenseForm`
ở trên); sửa `optionsKey` (`licenseTypes` + `itTicketCategories` optionsIsKeyLabel:true — key ổn định GIỮ
NGUYÊN khi nhãn không đổi, chỉ nhãn thực sự mới mới sinh key mới, đúng khuôn `saveCoreFieldOptionsList()`
đã dùng cho `submissionTypes`); cả 5 tab mới đều đủ số field mặc định khai trong manifest và KHÔNG có nút
xoá (`deleteCustomField`) nào cho trường mặc định. `tests/testHarness.js` (dùng chung bởi nhiều bài test
khác, gồm `tests/test-it-support.js`) bổ sung seed mặc định `itTicketCategories` (cả trong `createMockState()`
lẫn `buildAppDataForCreate()`) — thiếu bước này thì `<select id="itTicketCategory">` (giờ đổ động, không còn
`<option>` gõ cứng) sẽ RỖNG trong môi trường test, khiến `document.getElementById('itTicketCategory').value =
'HARDWARE'` (nhiều dòng có sẵn trong `test-it-support.js`) không set được gì — đã phát hiện VÀ vá TRƯỚC khi
chạy full suite, không phải regression sót lại.

Chạy lại toàn bộ `tests/test-*.js` (49 file, tính cả bài mới) — chỉ còn đúng 2 lỗi known pre-existing cần
SQL Server thật (`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js` — mọi kịch bản BÊN TRONG 2
bài này đều PASS, chỉ process không tự thoát sau khi xong, không phải lỗi mới), không phát sinh regression
nào khác ngoài lỗi `itTicketCategories` ở `testHarness.js` đã tự vá kể trên.

Demo Playwright thật (Docker `vpdt-mssql` + `node server.js`, tài khoản `demo_forms_admin` — admin MỚI TẠO,
`totpEnabled:false` ban đầu nhưng vẫn phải qua đúng màn "Bắt Buộc Thiết Lập Xác Thực 2 Lớp" lần đăng nhập
đầu vì TOTP là BẮT BUỘC với MỌI tài khoản admin bất kể `totpEnabled`, xem `proceedAfterAuth()` — hoàn tất
bằng mã 6 số sinh THẬT từ `otplib` cùng thư viện server dùng để verify, không phải giả lập): mở Biểu Mẫu,
xác nhận đủ 5 tab mới hiện trên UI thật; sửa nhãn 1 trường mặc định ở 3 module (Công Việc/Giấy Phép/Hỗ Trợ
Yêu Cầu IT) qua đúng nút "✏️ Sửa" + form thật, lưu — mở form nghiệp vụ thật tương ứng (`#createTaskModal`/
`#licenseForm`/`#itTicketCreateForm`) và xác nhận nhãn mới hiện đúng ngay; xác nhận cả 5 tab mới đều không
có nút xoá nào cho trường mặc định. 14/14 kịch bản pass.

**Phạm vi CHƯA làm trong đợt này (để lại cho đợt sau nếu cần)**: "trường bổ sung" (custom field admin tự
thêm hoàn toàn mới, khác sửa trường mặc định có sẵn) cho 5 module mới CHƯA được wire vào form nghiệp vụ
thật (chưa có `dynamicFieldsContainer_*` + `renderDynamicInputsForModule()`/`collectDynamicFieldsData()`/
`validateRequiredCustomData()` cho TASK/VPP/LICENSE/IT_PRICE/IT_TICKET như 8 module cũ đã có) — admin VẪN
thêm được 1 trường bổ sung qua UI Biểu Mẫu cho các tab này (lưu vào `DB.formTemplates`), nhưng nó sẽ KHÔNG
hiện trên form thật cho tới khi hạ tầng này được nối thêm. Yêu cầu gốc của người dùng (sửa nhãn/bắt buộc/
danh sách lựa chọn của trường MẶC ĐỊNH) đã đủ, không bị ảnh hưởng bởi giới hạn này.

**Deploy-impact**: KHÔNG đổi `sql/schema.sql` (vẫn là JSON blob trong `dbo.AppData`), KHÔNG đổi
`.env.example`, KHÔNG thêm `dependencies` mới — chỉ copy code + `pm2 restart`. `itTicketCategories` tự seed
đúng 1 lần ngay trong lần khởi động server đầu tiên sau khi cập nhật (`seedDefaults()`, vòng lặp `DEFAULTS`
đã có sẵn tự nhận key mới), không cần thao tác tay nào thêm.

## Trước đó — Nhóm Không Cấp Văn Phòng Phẩm: chuyển từ gán theo NHÓM sang chọn thẳng CHỨC DANH (mảng phẳng)

Khối 17 "Nhóm Quyền Đặc Biệt" (màn Hệ Thống → Quản Trị → Phân Quyền) — "Nhóm Không Cấp Văn Phòng Phẩm"
trước đây là 1 danh sách NHIỀU NHÓM tự đặt tên, mỗi nhóm mang 1 danh sách chức danh, và còn phải gán thủ
công user vào 0..N nhóm (`user.vppExcludeGroupIds`) mới thực sự bị loại — 2 lớp gián tiếp không cần thiết.
Đổi hẳn sang `vppExcludedJobTitles`: 1 mảng chuỗi PHẲNG (cùng khuôn `workflowParticipatingDepts` ngay bên
cạnh) — user có `jobTitle` HIỆN TẠI nằm trong mảng này là bị loại thẳng, không cần gán vào đâu nữa.

**Di trú dữ liệu cũ (tự động, 1 lần/DB)**: `seedDefaults.js` thêm `migrateVppExcludedJobTitles()`, PHẢI
chạy TRƯỚC vòng lặp seed `DEFAULTS` thường (vòng lặp đó tự tạo row rỗng cho key thiếu, sẽ làm mất khả năng
phân biệt "DB chưa từng có key này — cần di trú" với "đã có nhưng admin để rỗng" nếu chạy sau) — gộp
(union, khử trùng) toàn bộ `jobTitles[]` của mọi nhóm trong `vppExcludeGroups[]` cũ thành giá trị khởi tạo
của `vppExcludedJobTitles[]`. Key `vppExcludeGroups` + field `user.vppExcludeGroupIds` vẫn GIỮ NGUYÊN
trong CSDL sau di trú (không xoá dữ liệu), chỉ đơn giản không còn nơi nào trong code mới đọc/ghi tới nữa —
`routes/data.js` vẫn chặn ghi trực tiếp key cũ này (đề phòng có nơi nào lỡ còn gọi tới).

**Code liên quan cũng đổi theo mảng phẳng**: `lib/createValidation.js` (chặn đăng ký VPP khi chức danh
nằm trong `appData.vppExcludedJobTitles`, thay vì dò qua 2 lớp nhóm+gán) — thu gọn từ so khớp
lồng nhau còn đúng 1 dòng `includes()`; `lib/catalogRename.js::cascadeJobTitleRename()` (đổi tên chức
danh trong danh mục giờ cascade thẳng vào mảng phẳng, không còn duyệt qua từng nhóm cũ). Admin UI (`public/index.html`)
đổi hẳn sang widget tìm-kiếm-gõ-chọn (`sdd*`, đúng khuôn `workflowParticipatingDepts`) + chip xoá được,
gõ sai/tự do bị chặn ngay ở client (và server chặn lại lần nữa qua `ADMIN_ONLY_KEYS`); form "Sửa Người
Dùng" bỏ hẳn bước gán user vào nhóm (không còn nhóm nào để gán).

**Test**: `tests/test-vpp.js` thêm bộ kịch bản VPP-exclude (thêm/xoá chức danh qua UI thật, số nhân sự gợi
ý giảm đúng khi loại 1 chức danh, `isUserVppExcluded()` + khoá client (picker kỳ đăng ký bị disable) +
chặn server-side độc lập với client, chức danh khác không bị ảnh hưởng); `tests/test-admin-users-permgroups.js`
viết lại kịch bản (e) theo mảng phẳng (chọn đúng gợi ý mới thêm được, gõ tự do sai bị chặn, chức danh vừa
thêm biến mất khỏi datalist gợi ý còn lại) + thêm (f) xác nhận form Sửa Người Dùng đã gỡ hẳn checklist gán
nhóm cũ. Chạy lại toàn bộ `tests/test-*.js` (48 file) — chỉ còn đúng 2 lỗi known pre-existing cần SQL
Server thật (`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js`), output byte-identical với
baseline trước đợt sửa, không phát sinh regression nào khác.

Demo Playwright thật (khởi động `vpdt-mssql` Docker + `node server.js`, đăng nhập admin thật qua UI —
gồm cả bước bắt buộc đổi mật khẩu tạm + thiết lập TOTP lần đầu): mở khối 17, thêm chức danh "Trưởng
phòng" vào "Nhóm Không Cấp Văn Phòng Phẩm" qua đúng ô tìm-kiếm-gõ-chọn + nút "➕ Thêm Chức Danh" thật, bấm
Lưu — nhận đúng alert thành công; RELOAD LẠI TRANG TỪ ĐẦU (không phải chỉ đọc state client) và xác nhận
`DB.vppExcludedJobTitles` trả về từ SQL Server thật đã có đúng "Trưởng phòng" cạnh 2 chức danh đã di trú
sẵn từ trước ("Nhân viên", "Chuyên viên") — xác nhận cả di trú tự động lẫn lượt lưu mới đều xuyên suốt tới
CSDL thật, không chỉ đúng trên máy client. Sau đó gỡ lại "Trưởng phòng" + Lưu + reload xác nhận CSDL về
đúng trạng thái ban đầu (không để lại dữ liệu demo).

**Deploy-impact**: KHÔNG đổi `sql/schema.sql` (vẫn là JSON blob trong `dbo.AppData`), KHÔNG đổi
`.env.example`, KHÔNG thêm `dependencies` mới — chỉ copy code + `pm2 restart`; di trú dữ liệu cũ tự chạy
đúng 1 lần ngay trong lần khởi động server đầu tiên sau khi cập nhật (xem `seedDefaults()` ở trên), không
cần thao tác tay nào thêm.

## Trước đó — Hỗ Trợ IT: Tài liệu bổ sung ở Phê Duyệt Giá, Bán Buôn đổi sang duyệt theo Margin/Chiết Khấu, fix nút Mở rộng/Thu gọn cây phân quyền

3 việc độc lập gộp 1 đợt (cùng khu vực code module Hỗ Trợ IT + màn admin "Quy Trình & Phê Duyệt"/"Phân Quyền"):

**A. "📎 Tài liệu bổ sung liên quan" (nhiều tệp)** — thêm vào form tạo Phê Duyệt Giá (`#itPriceCreateForm`,
dùng chung cho cả Bán Lẻ lẫn Bán Buôn), mirror đúng khuôn "Tài Liệu Bổ Sung Theo Tờ Trình" (`subExtraFiles`)
của Văn Bản Trình — hoàn toàn tuỳ chọn, chọn nhiều tệp cùng lúc, hiện trong modal chi tiết kèm nút Xem/Tải.
Kèm 2 chỗ vá bảo mật: `lib/fileAuthz.js::findOwningRecord()` trước đây chỉ tra `item.files` (bảng giá) của
`itPriceApprovals`, không tra `item.extraFiles` — file "tài liệu bổ sung" mới upload sẽ tra không ra hồ sơ
sở hữu và rơi vào nhánh FAIL-OPEN (bất kỳ ai đăng nhập cũng đọc được, kể cả người không có quyền xem hồ sơ
đó); và `authorizeFileAccess()` nhánh `owning.itPrice` trước đây áp luật "chỉ file đã duyệt mới tải được"
(vốn chỉ dành cho bảng giá Excel) lên CẢ `extraFiles`, khiến mọi lượt tải tài liệu bổ sung đều bị chặn nhầm.

**B. Bán Buôn: bỏ hẳn quy trình duyệt theo phòng ban, chuyển sang chọn 1 trong 4 mức Margin/Chiết Khấu cố
định** (`Margin < 5%`, `Margin ≥ 5%`, `Chiết khấu ≤ 5%`, `Chiết khấu > 5%` — danh sách PHẲNG, không lồng
nhau, đã chốt với người dùng). Bán Lẻ giữ nguyên 100% quy trình theo phòng ban như cũ, không bị ảnh hưởng.
Trường mới `priceTier` bắt buộc trên form Bán Buôn (server tự xác minh lại, null hoá cho Bán Lẻ dù client
cố gửi kèm giá trị lạ). `lib/workflowEngine.js` thêm `resolveItPriceTierWorkflowConfig()` + collection MỚI
`itPriceTierWorkflows` (map phẳng `{tierKey: {workflowId, approvers}}`, không cần tương thích ngược vì là
cấu hình hoàn toàn mới) — `resolveWfConfig` của `itPriceApprovals` branch theo `priceType`: WHOLESALE tra
theo tier, RETAIL tra theo dept như cũ. Admin cấu hình người duyệt riêng cho từng mức ở màn "Quy Trình &
Phê Duyệt" — tab "Bán Buôn" của "Hỗ Trợ IT - Duyệt giá" đổi hẳn sang layout 4 thẻ cố định theo tier (không
còn tách cùng phòng/khác phòng như layout theo dept), tab "Bán Lẻ" giữ nguyên UI theo dept không đổi. Rất
nhiều điểm client hiển thị/kiểm quyền theo hồ sơ cụ thể (badge trạng thái, nút Duyệt/Từ chối trong modal,
Approval Hub, `canViewItPriceApproval`, cảnh báo trước khi khoá tài khoản...) phải branch đúng theo tier
cho hồ sơ Bán Buôn — gom về 1 hàm `resolveItPriceWorkflowConfigForItemClient()` để không bỏ sót điểm nào.

**C. Fix nút "Mở rộng tất cả"/"Thu gọn tất cả" ở cây phân quyền (màn Sửa Người Dùng/Sửa Nhóm Phân Quyền)**
— bug có thật, không phải giả định: nút gọi qua cơ chế CSP-safe `data-op="setAllPermTreeNodes" data-arg0="false"`,
nhưng `cspCoerceArg()` chỉ coerce chuỗi TOÀN SỐ sang `Number`, giữ nguyên `"true"`/`"false"` ở dạng STRING.
`d.open = "false"` gán 1 chuỗi KHÔNG RỖNG vào thuộc tính boolean IDL của `<details>`, mà `Boolean("false") === true`
(chuỗi không rỗng luôn truthy) — nghĩa là CẢ 2 nút đều MỞ RỘNG hết, "Thu gọn tất cả" không hề thu gọn được
gì. Fix: so sánh tường minh (`open === true || open === 'true'`) thay vì tin kiểu dữ liệu.

**Verify**: `node -c` mọi file server sửa (`lib/fileAuthz.js`, `lib/createValidation.js`,
`lib/workflowEngine.js`, `defaults.js`, `routes/data.js`) OK; syntax/dup-id check `public/index.html` khớp
đúng baseline (1 lỗi import pre-existing, 17 dup-id, không phát sinh mới). Test mới: `tests/test-uploads-file-authz.js`
(3 kịch bản mới, gọi thẳng `authorizeFileAccess()` thật) khoá chặt cả 2 lỗ hổng của mục A — người ngoài
phạm vi bị chặn (không FAIL-OPEN), extraFiles không bị luật "chỉ file đã duyệt" chặn nhầm, item.files vẫn
giữ đúng hành vi cũ; `tests/test-it-support.js` thêm ~10 kịch bản (2 sub-tab tạo hồ sơ kèm priceTier, chặn
thiếu priceTier cả client lẫn server, người duyệt tier A không duyệt được hồ sơ tier B và ngược lại, người
duyệt Bán Buôn theo dept CŨ không còn quyền gì với hồ sơ Bán Buôn nữa, Bán Lẻ song song không đổi, tạo hồ
sơ kèm/không kèm tài liệu bổ sung); `tests/test-perm-tree-expand-collapse.js` (file MỚI, Playwright thật
trên `public/index.html` thật) gọi `setAllPermTreeNodes('false')`/`('true')` bằng ĐÚNG string như đường đi
`data-op` thật (đã xác nhận test này bắt được bug gốc khi tạm revert fix), cộng thêm kịch bản bấm nút thật
qua dispatch. Chạy lại toàn bộ `tests/test-*.js` (48 file, +1 file mới) — chỉ còn đúng 2 lỗi known-flaky
đã biết từ trước (`test-audit-fixes-batch1.js`, `test-audit-round2-cluster1.js`, cần SQL Server thật, output
byte-identical với baseline trước đợt), không phát sinh regression nào khác.

Demo Playwright thật (server thật + SQL Server thật, tài khoản demo có sẵn `nv_nhansu`/`ks_kiemsoat`/`sep_duyet`
non-admin `totpEnabled:false`, admin dùng 1 phiên duy nhất xuyên suốt để né lỗi 401-sau-khi-bật-TOTP đã biết
từ trước): tạo hồ sơ Bán Lẻ kèm 2 tệp tài liệu bổ sung — hiện đúng trong modal chi tiết, chính chủ tải được
cả 2 tệp, người ngoài phạm vi bị chặn tải (403) và hồ sơ bị lọc khỏi `GET /api/data` phía họ; admin cấu hình
qua UI thật 2 người duyệt riêng cho "Margin < 5%" và "Chiết khấu > 5%" — tạo hồ sơ Bán Buôn ở mức Margin < 5%,
xác nhận đúng người duyệt mức đó thấy và duyệt được trong "Phê Duyệt" tổng hợp, người duyệt mức kia không
thấy/không duyệt được; hồ sơ Bán Lẻ song song vẫn duyệt đúng theo phòng ban như cũ; màn "Sửa Người Dùng" bấm
"Thu gọn tất cả" đóng hết 23 khối quyền, bấm "Mở rộng tất cả" mở lại hết (có chụp ảnh trước/sau).

**Deploy-impact**: KHÔNG đổi `sql/schema.sql` (mọi field mới là JSON blob trong `dbo.Records`/`dbo.AppData`),
KHÔNG đổi `.env.example`, KHÔNG thêm `dependencies` mới — chỉ copy code + `pm2 restart`.

## Trước đó — Fix: nút Duyệt/Từ chối Phê Duyệt Giá ở màn "Phê Duyệt" tổng hợp không phản ứng gì

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
