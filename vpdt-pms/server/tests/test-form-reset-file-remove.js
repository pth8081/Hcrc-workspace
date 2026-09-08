'use strict';
// Regression test cho "Đợt A" (UX rollout — 5 đợt): 2 hạ tầng dùng chung MỚI ở core.js —
//   - confirmAndResetForm(formId, resetFnName): nút "↺ Làm Mới" trên form Tạo Mới, hỏi xác nhận NẾU
//     form đang có dữ liệu đã nhập, rồi gọi resetXxxForm() riêng của module.
//   - onSingleFileChosen()/clearSingleFileInput() (input file đơn) + onMultiFileChosen()/
//     removeOneFileFromMultiInput()/clearMultiFileInput() (input file multiple): chip "📎 tên file [✕]"
//     cho phép bỏ chọn tệp TRƯỚC KHI gửi form.
// — áp dụng cho 4 form tạo mới ở "Đợt A" (mẫu tham chiếu):
//   Văn Bản Trình (#submissionForm, resetSubmissionForm() — module-vanbantrinh.js)
//   Hợp Đồng (#contractForm, resetContractForm() — module-hopdong.js)
//   Tài Liệu (#docForm, resetDocUploadForm() — module-tailieu.js)
//   Giấy Phép (#licenseForm, resetLicenseForm() — module-tailieu.js)
// — VÀ "Đợt B" (đúng khuôn trên, 4 module tiếp theo, KHÔNG form nào trong 4 form này có ô tải tệp):
//   Đăng Ký Xe (#carForm, resetCarRegForm() — module-dangkyxe.js) — kèm trắng "Lộ Trình Di Chuyển"
//     (mảng JS carRoutePoints, không phải input thường).
//   Phòng Họp (#meetingForm, resetMeetingReqForm() — module-phonghop.js) — form đơn giản nhất đợt này.
//   Biên Bản Họp (#minutesForm, resetMeetingMinutesForm() — module-bienbanhop.js, gọi lại
//     cancelEditMeetingMinutes() có sẵn) — kèm trắng bảng "Thành Phần Tham Dự"/"Ý Kiến Chỉ Đạo" (mảng JS
//     minutesAttendeesRows/minutesDirectives) VỀ 0 DÒNG (đúng hành vi cancelEditMeetingMinutes()/luồng
//     lưu thành công đã có TỪ TRƯỚC — khác officeItems bên dưới collapse về 1 dòng, không phải 0).
//   Mua Bán/Sửa Chữa/Đầu Tư (#officeForm, resetOfficeReqForm() — module-office.js) — kèm collapse bảng
//     "Danh Sách Hạng Mục Đề Nghị Mua Sắm" (mảng JS officeItems) về ĐÚNG 1 dòng trống khi đang ở phân hệ
//     Mua Sắm (officeItems = []; addOfficeItemRow();), đúng hành vi cũ.
// — VÀ "Đợt C" (đúng khuôn trên, module Đào Tạo + 3 module Truyền Thông Nội Bộ còn lại — module-
//   internalcomms-daotao.js/module-internalcomms-nhipsong.js/module-hcrcdonghanh.js):
//   Đào Tạo có 7 form Tạo Mới (nhiều hơn ước tính ban đầu ~5 — đọc lại code thật xác nhận cả
//   careerPathForm/onboardingPathForm cũng là form Tạo Mới riêng, không chỉ 5 form ban đầu):
//     Lớp Học (#trainingClassForm, resetTrainingClassForm()) — kèm trắng Danh Sách Được Mời
//       (tcInviteListStaged) + phần Nhập Từ Excel đang xem trước dở (tcInviteFilePreviewItems) + đưa
//       Kiểu Lớp Học về lại Online (ẩn Giảng Viên/Địa Điểm, xem onTrainingClassModeChange()).
//     Chương Trình (#trainingCourseForm, resetTrainingCourseForm()) — đơn giản nhất đợt này.
//     Kế Hoạch Đào Tạo (#trainingPlanForm, resetTrainingPlanForm(), gọi lại cancelEditTrainingPlan() có
//       sẵn — cùng khuôn resetMeetingMinutesForm() Đợt B).
//     Kho Tài Liệu (#trainingDocForm, resetTrainingDocForm()) — kèm chip file tdFile + đưa Loại Tài Liệu
//       (Video/Hình Ảnh) về lại "Tài Liệu" mặc định (onTrainingDocTypeChange()).
//     Lộ Trình Thăng Tiến (#careerPathForm, resetCareerPathForm() — hàm này ĐÃ CÓ SẴN TỪ TRƯỚC lúc bắt
//       đầu Đợt C, chỉ thiếu nút gọi tới) — kèm collapse "Các Cấp Bậc" về ĐÚNG 1 hàng trống.
//     Đào Tạo Tân Binh > Quản Lý Lộ Trình (#onboardingPathForm, resetOnboardingPathForm(), gọi lại
//       cancelEditOnboardingPath() có sẵn).
//     Ngân Hàng Câu Hỏi (#trainingTestForm, resetTrainingTestForm()) — trắng HẲN danh sách câu hỏi
//       (tbQuestions) về ĐÚNG 0 câu — đây LÀ trạng thái mặc định thật của form (giống hệt lúc mới vào
//       tab, KHÔNG PHẢI 1 câu SINGLE 2-đáp-án-rỗng như phỏng đoán ban đầu — luồng tạo bài test thành công
//       TỪ TRƯỚC đã luôn set tbQuestions = [] chứ không thêm lại 1 câu mặc định, xem submitTrainingTest()
//       trước khi refactor). Ảnh minh hoạ câu hỏi/đáp án (IMAGE_DRAG_DROP) tải lên NGAY khi chọn file
//       (tbQuestionImageFileChange()/tbOptionImageFileChange(), lưu thẳng URL vào tbQuestions[].imageUrl)
//       — KHÔNG áp khuôn chip file cấp-form (onSingleFileChosen()/onMultiFileChosen()) vào đây được, nên
//       không có chip nào để kiểm ở đây; xoá câu hỏi khỏi tbQuestions khi Làm Mới đã tự dọn sạch ảnh gắn.
//   Tuyển Dụng có 2 form: Tin Tuyển Dụng (#recruitmentJobForm, resetRecruitmentJobForm() — chip
//     rjBannerFile) và Giới Thiệu Ứng Viên (#recruitmentReferForm, resetRecruitmentReferForm() — modal,
//     chip rrCvFile) — form SAU có 1 hidden input #rrJobId NẰM TRONG form (khác mọi editingXxxId khác
//     trong hệ thống luôn là biến JS NGOÀI form) nên phải tự khôi phục giá trị này sau form.reset() (đã
//     đánh dấu readonly ở HTML để confirmAndResetForm() không tính nhầm là "đã nhập" ngay khi vừa mở modal).
//   HCRC Đồng Hành (#hrFeedbackForm, resetHrFeedbackForm()) — form đơn giản, không có ô tải tệp.
//   Nội Bộ/Nhịp Sống HCRC (#internalPostForm, resetInternalPostForm(), gọi lại cancelEditInternalPost()
//     có sẵn — cùng khuôn resetMeetingMinutesForm()) — kèm chip internalFile + tắt Ghim/thoát Sửa dở dang.
//
// — VÀ "Đợt D" (đúng khuôn trên, 5 module còn lại của kế hoạch UX 5 đợt — Thanh Toán/Hỗ Trợ IT (3 form)/
//   VPP/Ngân Sách):
//   Thanh Toán (#paymentCreateForm, resetPaymentCreateForm() — CHỈ gọi lại cancelEditPaymentRequest() có
//     sẵn từ trước, không viết logic mới) — form KHÔNG có ô tải tệp; kèm trắng bảng "Các Đợt Thanh Toán"
//     (dựng động, mirror #contractInstallmentsList). Sub-tab "🗂️ Quản Lý Thanh Toán" (sửa NHÁP đã tạo từ
//     module khác, không phải "tạo mới" 1 lần như các form còn lại) CHỦ Ý nằm NGOÀI phạm vi đợt này.
//   Hỗ Trợ IT có 3 form Tạo Mới (module-itsupport-price.js/module-itsupport-renewal.js):
//     Phê Duyệt Giá (#itPriceCreateForm, resetItPriceForm()) — kèm chip file đơn itPriceFileInput (ĐÃ có
//       data-op-change nghiệp vụ riêng đọc/xem trước bảng giá TỪ TRƯỚC — không gắn thêm data-op-change=
//       "onSingleFileChosen" song song được, gọi trực tiếp onSingleFileChosen() NGAY trong
//       onItPriceFileChange() thay vì qua HTML, xem module-itsupport-price.js) + chip file nhiều
//       itPriceExtraFiles + Mức Margin/Chiết Khấu (itPriceTier, chỉ Bán Buôn) CHỈ bị xoá giá trị khi Làm
//       Mới, KHÔNG tự chuyển sub-tab con Bán Lẻ/Bán Buôn (activeItPriceSubTab) về mặc định — quyết định
//       có chủ ý, xem chú thích ngay tại resetItPriceForm().
//     Hỗ Trợ Yêu Cầu (#itTicketCreateForm, resetItTicketForm()) — đơn giản nhất đợt này, không ô tải tệp.
//     Gia Hạn Dịch Vụ CNTT (#itRenewalCreateForm, resetItRenewalForm()) — kèm chip file đơn itRenewalFile
//       + đóng tường minh dropdown gợi ý của ô tìm-kiếm-gõ-chọn itRenewalCategory (sdd*, KHÔNG có input ẩn
//       riêng như các sdd khác trong hệ thống — chính input.value LÀ giá trị thật, form.reset() gốc đã đủ
//       xoá sạch giá trị, chỉ cần đóng thêm dropdown nếu lỡ đang mở).
//   VPP (module-vpp.js) có 2 "form" Tạo Mới, KHÔNG cái nào là <form> thật (bảng chọn mặt hàng/bảng nhân
//     sự theo phòng ban đều dựng tay bằng <div>, không .reset() được — resetXxxForm() phải tự set tay
//     từng ô + gọi lại render* để tính lại giá trị mặc định "thật" thay vì hardcode rỗng):
//     Đăng Ký (#vppRegItemsWrap không phải <form>, resetVppRegForm()) — MỖI ô Số Lượng đã có value="..."
//       (thuộc tính HTML thật) đúng bằng số lượng đã LƯU NHÁP (nếu đang sửa tiếp nháp cũ) hoặc rỗng (nếu
//       chọn mới hoàn toàn) tại thời điểm dựng bảng — gán lại input.value = input.defaultValue cho MỌI ô
//       là đủ "quay về mặc định thật" (mirror ý nghĩa form.reset() gốc), không xoá mất bản nháp đã lưu.
//     Kỳ Đăng Ký > Tạo Kỳ Đăng Ký Mới (#vppNewPeriodFormWrap không phải <form>, resetVppNewPeriodForm())
//       — kèm chip file đơn vppCatalogFileInput (ĐÃ có data-op-change nghiệp vụ riêng đọc/xem trước danh
//       mục TỪ TRƯỚC, cùng cách xử lý itPriceFileInput ở trên) + tính LẠI bảng "Nhân Sự Theo Phòng Ban"
//       (renderVppDeptHeadcountTable()) theo số nhân sự THẬT đang hoạt động, không giữ số đã sửa tay dở.
//   Ngân Sách (module-ngansach.js) — 2 tab con "✅ Ngân Sách Phê Duyệt Đơn Vị"(PLAN)/"💳 Ngân Sách Thực
//     Hiện"(ACTUAL) dùng CHUNG code (hậu tố _PLAN/_ACTUAL), bảng hạng mục dựng theo mẫu cột của kỳ ("UI
//     mẫu ngân sách CRUD cột") KHÔNG phải <form> thật — resetBudgetEntryFormPLAN()/
//     resetBudgetEntryFormACTUAL() CHỈ gọi lại onBudgetEntryPeriodChange(kind) đã có sẵn: nạp lại ĐÚNG
//     bản NHÁP đã lưu trên server của phòng ban cho kỳ đang chọn (nếu có — hoàn tác MỌI sửa dở CHƯA lưu,
//     xem kịch bản "Ngân Sách Thực Hiện" bên dưới) hoặc collapse về ĐÚNG 1 dòng trống theo mẫu (nếu CHƯA
//     có nháp nào — xem kịch bản "Ngân Sách Phê Duyệt" bên dưới).
//
// Dùng lại hạ tầng tests/_harness-contract.js (tests/_seed.js) — đã seed sẵn đủ dept/loại pháp lý/
// workflow/nhóm phê duyệt cho Hợp Đồng LẪN Văn Bản Trình (3 bộ test gốc dùng chung: test-contract.js/
// test-payment.js/test-office-budget.js) — Mua Bán (officeReqs) thuộc nhóm này nên đã sẵn
// officeBuyDeptWorkflows. Giấy Phép/Đăng Ký Xe/Phòng Họp/Biên Bản Họp không thuộc 3 module gốc đó nên
// DB.licenses/DB.licenseTypes/DB.carPurposes/DB.meetingRooms phải tự seed thêm (rỗng/1 mục là đủ — chỉ
// cần đủ để chọn được 1 giá trị khác option đầu, quan sát được form.reset() có thật sự đổi lại hay
// không; module Biên Bản Họp không lọc theo dept nên không cần thêm gì). Đợt D seed thêm tay
// DB.vppPeriods/DB.budgetPeriods (module không thuộc 3 bộ gốc) NGAY TRONG từng kịch bản (không seed
// chung ở đây — mỗi kịch bản cần period riêng, tránh đụng "1 bản ngân sách/phòng ban/kỳ/loại").
//
// Chạy: node server/tests/test-form-reset-file-remove.js
const { startHarness } = require('./_harness-contract');

function fakeFile(name, content, mime) {
  return { name, mimeType: mime, buffer: Buffer.from(content) };
}
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

async function main() {
  const h = await startHarness();
  const { page } = h;
  const results = [];
  function recordResult(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
    if (!ok) console.log(`  -> ${detail && detail.message ? detail.message : detail}`);
  }
  async function check(name, fn) {
    try { await fn(); recordResult(name, true); }
    catch (err) { recordResult(name, false, err); }
  }

  try {
    await h.loginAs('admin');

    // Giấy Phép: không thuộc 3 module gốc dùng _seed.js — bổ sung tay 2 collection còn thiếu.
    await page.evaluate(() => { DB.licenses = []; DB.licenseTypes = []; });

    // window.confirm() của _harness-contract.js luôn trả true nhưng KHÔNG ghi log lời gọi — thay bằng
    // bản có ghi log (vẫn trả true, không chặn luồng resetXxxForm() phía sau) để bài test xác minh được
    // ĐÚNG lúc confirmAndResetForm() có hỏi/không hỏi xác nhận.
    await page.evaluate(() => {
      window.__confirmCalls = [];
      window.confirm = (msg) => { window.__confirmCalls.push(String(msg)); return true; };
    });

    // _harness-contract.js chỉ mô phỏng /api/upload + /api/create|workflow|records (xem window.fetch ở
    // đó) — 2 route đọc/xem-trước-file-ngay-khi-chọn của Đợt D (POST /api/it-price/parse-file, POST
    // /api/vpp/parse-catalog) KHÔNG có trong danh sách đó nên rơi vào "Không rõ route" (404 giả), khiến
    // itPricePendingFile/vppPendingCatalog không bao giờ set được -> nhánh dọn lỗi trong
    // onItPriceFileChange()/onVppCatalogFileChange() xoá NGAY chip vừa hiện. Bọc thêm 2 route giả ở ĐÚNG
    // 1 nơi (không đụng _harness-contract.js dùng chung cho mọi bài test khác) — nội dung tệp KHÔNG ảnh
    // hưởng luật nghiệp vụ nào bài test này kiểm chứng (đã có test-it-support.js/test-vpp.js với harness
    // Express thật riêng kiểm chứng logic đọc file thật), ở đây chỉ cần phản hồi hợp lệ để 2 luồng chip
    // "📎 tên file [✕]"/"Làm Mới" chạy được bình thường như 1 lần đọc file thành công thật.
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = async (url, opts) => {
        if (typeof url === 'string' && url.indexOf('/api/it-price/parse-file') !== -1) {
          return {
            ok: true, status: 200, json: async () => ({
              items: [{ values: { c0: 'Bút bi Thiên Long', c1: '5000' } }],
              columnLabels: [{ key: 'c0', label: 'Tên mặt hàng' }, { key: 'c1', label: 'Giá mới' }],
              masterListName: null,
              fileUrl: `/uploads/${Date.now()}-test-gia-de-xuat.xlsx`,
              fileName: 'gia-de-xuat.xlsx', size: 123
            })
          };
        }
        if (typeof url === 'string' && url.indexOf('/api/vpp/parse-catalog') !== -1) {
          return {
            ok: true, status: 200, json: async () => ({
              items: [{ code: 'VPP001', name: 'Bút bi Thiên Long', origin: 'Việt Nam', unit: 'Cái', spec: '', price: 3000 }],
              fileUrl: `/uploads/${Date.now()}-test-danh-muc.xlsx`, fileName: 'danh-muc.xlsx'
            })
          };
        }
        return originalFetch(url, opts);
      };
    });

    // ================= 1) Văn Bản Trình =================
    await check(
      'Văn Bản Trình: chip file đơn + multi hiện đúng tên, xoá đúng 1 file khỏi multi (còn lại đúng file kia), "Làm Mới" trắng toàn bộ form kể cả panel phê duyệt bổ sung + mã tự sinh',
      async () => {
        await page.evaluate(() => {
          // Gán 1 thành viên cho lớp "Đồng trình" — DONG_TRINH mặc định rỗng ở _seed.js, checkbox lớp sẽ
          // bị disabled nếu không có thành viên nào (xem renderSubmissionApprovalLayerCheckboxes()).
          DB.submissionApprovalGroups = { DONG_TRINH: ['admin'] };
          switchTab('submission');
        });
        // subDept KHÔNG có option rỗng đặt trước (cùng lý do contractDept ở kịch bản Hợp Đồng bên dưới)
        // — chọn "Phòng Kế Toán" (KHÁC option đầu tiên "Phòng Kinh Doanh") để quan sát được form.reset()
        // thật sự đưa nó về lại ĐÚNG option đầu, không phải về rỗng.
        await page.selectOption('#subDept', 'Phòng Kế Toán');
        await page.selectOption('#subType', 'Tờ trình khác');
        await page.selectOption('#subApprovalLevel', 'KHAC');
        await page.evaluate(() => renderSubmissionApprovalLayerCheckboxes());
        await page.fill('#subTitle', 'Đề xuất kiểm thử reset form');
        await page.fill('#subContent', 'Nội dung kiểm thử reset form.');

        // Chọn tệp đơn -> chip hiện đúng tên.
        await page.setInputFiles('#subFile', fakeFile('to-trinh.pdf', 'noi dung', 'application/pdf'));
        const chip1 = await page.locator('#subFileChip').innerText();
        assertTrue(chip1.includes('to-trinh.pdf'), `Chip subFile phải hiện tên file, thực tế: ${chip1}`);

        // Chọn 2 tệp bổ sung -> 2 chip; xoá 1 -> còn ĐÚNG 1, đúng file còn lại, input.files còn đúng 1.
        await page.setInputFiles('#subExtraFiles', [
          fakeFile('phu-luc-1.pdf', 'a', 'application/pdf'),
          fakeFile('phu-luc-2.pdf', 'b', 'application/pdf')
        ]);
        const chipCountBefore = await page.locator('#subExtraFilesChip button[data-op="removeOneFileFromMultiInput"]').count();
        assertTrue(chipCountBefore === 2, `Phải có đúng 2 chip tài liệu bổ sung, thực tế ${chipCountBefore}`);
        await page.locator('#subExtraFilesChip button[data-op="removeOneFileFromMultiInput"]').first().click();
        const remainingChips = await page.locator('#subExtraFilesChip button[data-op="removeOneFileFromMultiInput"]').count();
        assertTrue(remainingChips === 1, `Sau khi xoá 1 phải còn đúng 1 chip, thực tế ${remainingChips}`);
        const remainingChipText = await page.locator('#subExtraFilesChip').innerText();
        assertTrue(
          remainingChipText.includes('phu-luc-2.pdf') && !remainingChipText.includes('phu-luc-1.pdf'),
          `Phải còn ĐÚNG file phu-luc-2.pdf (đã xoá phu-luc-1.pdf), thực tế: ${remainingChipText}`
        );
        const remainingFilesLength = await page.locator('#subExtraFiles').evaluate((el) => el.files.length);
        assertTrue(remainingFilesLength === 1, `input.files phải còn đúng 1 phần tử, thực tế ${remainingFilesLength}`);

        // Tick 1 checkbox lớp phê duyệt bổ sung (KHAC -> DONG_TRINH có thành viên, không bị disable).
        await page.click('#subApprovalDropdownBtn');
        await page.check('#subApprovalDropdownPanel input.sub-layer-toggle[value="DONG_TRINH"]');
        const codeBeforeReset = await page.locator('#subCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'subCode phải tự sinh sẵn khi vừa mở tab');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#submissionForm button[data-arg1="resetSubmissionForm"]');
        const state = await page.evaluate(() => ({
          subDept: document.getElementById('subDept').value,
          subTitle: document.getElementById('subTitle').value,
          subContent: document.getElementById('subContent').value,
          subCode: document.getElementById('subCode').value,
          subFileValue: document.getElementById('subFile').value,
          subFileChip: document.getElementById('subFileChip').innerHTML,
          subExtraFilesValue: document.getElementById('subExtraFiles').value,
          subExtraFilesChip: document.getElementById('subExtraFilesChip').innerHTML,
          anyLayerChecked: document.querySelectorAll('#subApprovalDropdownPanel input.sub-layer-toggle:checked').length,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.subDept === 'Phòng Kinh Doanh', `subDept phải về ĐÚNG option đầu (Phòng Kinh Doanh, KHÁC "Phòng Kế Toán" vừa chọn), thực tế "${state.subDept}"`);
        assertTrue(state.subTitle === '', 'subTitle phải về rỗng');
        assertTrue(state.subContent === '', 'subContent phải về rỗng');
        assertTrue(/^HCRC-[^-]+-VBT-/.test(state.subCode), `subCode phải được sinh lại đúng khuôn HCRC-<mã phòng>-VBT-..., thực tế "${state.subCode}"`);
        assertTrue(state.subFileValue === '', 'subFile input phải về rỗng');
        assertTrue(state.subFileChip === '', 'Chip subFile phải biến mất sau Làm Mới');
        assertTrue(state.subExtraFilesValue === '', 'subExtraFiles input phải về rỗng');
        assertTrue(state.subExtraFilesChip === '', 'Chip subExtraFiles phải biến mất sau Làm Mới');
        assertTrue(state.anyLayerChecked === 0, 'Không còn checkbox lớp phê duyệt bổ sung nào được tick sau Làm Mới');
      }
    );

    // ================= 2) Hợp Đồng =================
    await check(
      // contractDept/contractType KHÔNG có option rỗng đặt trước (khác selDept của Tài Liệu) — chọn 1
      // dept/type KHÁC option đầu tiên để form.reset() có gì đó "khác biệt" mà quan sát được: reset() sẽ
      // đưa 2 select này về lại đúng OPTION ĐẦU TIÊN (Phòng Kinh Doanh/Hợp đồng kinh tế, theo đúng thứ
      // tự DB.depts/DB.contractTypes ở tests/_seed.js) — không phải về rỗng như 2 module Tài Liệu/Giấy
      // Phép (những form đó có option rỗng "-- Chọn... --" đặt đầu).
      'Hợp Đồng: chip file, "Làm Mới" trắng form (2 select không có option rỗng -> reset về ĐÚNG option đầu) + trắng Đợt Thanh Toán về 0 dòng + mã hợp đồng sinh lại đúng theo option đầu',
      async () => {
        await page.evaluate(() => switchTab('contract'));
        await page.selectOption('#contractDept', 'Phòng Kế Toán');
        await page.selectOption('#contractType', 'Hợp đồng dịch vụ');
        await page.fill('#contractTitle', 'Hợp đồng kiểm thử reset form');
        await page.fill('#contractPartner', 'Công ty TNHH Kiểm Thử');
        await page.fill('#contractAmount', '10000000');
        await page.fill('#contractStartDate', '2026-01-01');
        await page.fill('#contractEndDate', '2026-12-31');
        await page.fill('#contractContent', 'Nội dung kiểm thử reset form.');
        await page.setInputFiles('#contractFile', fakeFile('hop-dong.pdf', 'noi dung', 'application/pdf'));
        const chip = await page.locator('#contractFileChip').innerText();
        assertTrue(chip.includes('hop-dong.pdf'), `Chip contractFile phải hiện tên file, thực tế: ${chip}`);

        // Thêm 2 dòng Đợt Thanh Toán.
        await page.click('button[data-op="addContractInstallmentRow"]');
        await page.click('button[data-op="addContractInstallmentRow"]');
        const rowsBefore = await page.locator('#contractInstallmentsList [data-installment-row]').count();
        assertTrue(rowsBefore === 2, `Phải có 2 dòng Đợt Thanh Toán trước khi Làm Mới, thực tế ${rowsBefore}`);

        const codeBeforeReset = await page.locator('#contractCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'contractCode phải tự sinh khi đã chọn đủ Phòng Ban + Loại Pháp Lý');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#contractForm button[data-arg1="resetContractForm"]');
        const state = await page.evaluate(() => ({
          contractDept: document.getElementById('contractDept').value,
          contractTitle: document.getElementById('contractTitle').value,
          contractCode: document.getElementById('contractCode').value,
          contractFileValue: document.getElementById('contractFile').value,
          contractFileChip: document.getElementById('contractFileChip').innerHTML,
          installmentRows: document.querySelectorAll('#contractInstallmentsList [data-installment-row]').length,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.contractDept === 'Phòng Kinh Doanh', `contractDept phải về ĐÚNG option đầu (Phòng Kinh Doanh, KHÁC "Phòng Kế Toán" vừa chọn), thực tế "${state.contractDept}"`);
        assertTrue(state.contractTitle === '', 'contractTitle phải về rỗng');
        // dept/type đã reset về option đầu (Phòng Kinh Doanh/Hợp đồng kinh tế) -> mã tự sinh lại theo
        // ĐÚNG 2 giá trị đó (viết tắt KD/KTE, xem tests/_seed.js deptAbbrs/contractTypeAbbrs).
        assertTrue(/^HCRC-KD-KTE-/.test(state.contractCode), `contractCode phải sinh lại đúng theo option đầu (HCRC-KD-KTE-...), thực tế "${state.contractCode}"`);
        assertTrue(state.contractFileValue === '', 'contractFile input phải về rỗng');
        assertTrue(state.contractFileChip === '', 'Chip contractFile phải biến mất sau Làm Mới');
        assertTrue(state.installmentRows === 0, `Đợt Thanh Toán phải về 0 dòng sau Làm Mới, thực tế ${state.installmentRows}`);
      }
    );

    // ================= 3) Tài Liệu =================
    await check(
      'Tài Liệu: chip file, "Làm Mới" trắng form + đưa toggle Nhập Mới/Cập Nhật về lại "Nhập Mới" + mã về rỗng',
      async () => {
        await page.evaluate(() => switchTab('doc'));
        await page.selectOption('#selDept', 'Phòng Kinh Doanh');
        await page.selectOption('#selCat', 'Hợp đồng / Hồ sơ');
        await page.fill('#docTitle', 'Tài liệu kiểm thử reset form');
        await page.fill('#docSummary', 'Tóm tắt kiểm thử reset form.');
        await page.setInputFiles('#docFile', fakeFile('tai-lieu.pdf', 'noi dung', 'application/pdf'));
        const chip = await page.locator('#docFileChip').innerText();
        assertTrue(chip.includes('tai-lieu.pdf'), `Chip docFile phải hiện tên file, thực tế: ${chip}`);
        const codeBeforeReset = await page.locator('#docCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'docCode phải tự sinh khi đã chọn đủ Phòng Ban + Phân Loại');

        // Đổi sang "Cập nhật" -> xác nhận Làm Mới đưa được VỀ LẠI "Nhập Mới" (không kẹt ở chế độ Cập nhật).
        await page.selectOption('#docOpMode', 'UPDATE');
        await page.evaluate(() => onDocOpModeChange());

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#docForm button[data-arg1="resetDocUploadForm"]');
        const state = await page.evaluate(() => ({
          docOpMode: document.getElementById('docOpMode').value,
          selDept: document.getElementById('selDept').value,
          docTitle: document.getElementById('docTitle').value,
          docCode: document.getElementById('docCode').value,
          docFileValue: document.getElementById('docFile').value,
          docFileChip: document.getElementById('docFileChip').innerHTML,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.docOpMode === 'NEW', `docOpMode phải về "NEW" sau Làm Mới, thực tế "${state.docOpMode}"`);
        assertTrue(state.selDept === '', `selDept phải về rỗng, thực tế "${state.selDept}"`);
        assertTrue(state.docTitle === '', 'docTitle phải về rỗng');
        assertTrue(state.docCode === '', `docCode phải về rỗng (chưa chọn lại Phòng Ban/Phân Loại), thực tế "${state.docCode}"`);
        assertTrue(state.docFileValue === '', 'docFile input phải về rỗng');
        assertTrue(state.docFileChip === '', 'Chip docFile phải biến mất sau Làm Mới');
      }
    );

    // ================= 4) Giấy Phép =================
    await check(
      'Giấy Phép: chip file, "Làm Mới" trắng form + sinh lại mã đúng khuôn HCRC-GP-...',
      async () => {
        await page.evaluate(() => switchTab('license'));
        await page.fill('#licenseCompanyName', 'Công ty TNHH Kiểm Thử');
        await page.fill('#licenseLocationName', 'Chi nhánh kiểm thử');
        await page.fill('#licenseType', 'Giấy phép kiểm thử');
        await page.fill('#licenseNumber', 'GP-TEST-001');
        await page.fill('#licenseIssueDate', '2026-01-01');
        await page.fill('#licenseExpiryDate', '2027-01-01');
        await page.fill('#licenseIssuingAuthority', 'Cơ quan kiểm thử');
        await page.setInputFiles('#licenseFile', fakeFile('giay-phep.pdf', 'noi dung', 'application/pdf'));
        const chip = await page.locator('#licenseFileChip').innerText();
        assertTrue(chip.includes('giay-phep.pdf'), `Chip licenseFile phải hiện tên file, thực tế: ${chip}`);

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#licenseForm button[data-arg1="resetLicenseForm"]');
        const state = await page.evaluate(() => ({
          licenseOpMode: document.getElementById('licenseOpMode').value,
          licenseCompanyName: document.getElementById('licenseCompanyName').value,
          licenseCode: document.getElementById('licenseCode').value,
          licenseFileValue: document.getElementById('licenseFile').value,
          licenseFileChip: document.getElementById('licenseFileChip').innerHTML,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.licenseOpMode === 'NEW', `licenseOpMode phải về "NEW" sau Làm Mới, thực tế "${state.licenseOpMode}"`);
        assertTrue(state.licenseCompanyName === '', 'licenseCompanyName phải về rỗng');
        assertTrue(/^HCRC-[^-]+-GP-/.test(state.licenseCode), `licenseCode phải được sinh lại đúng khuôn HCRC-<mã phòng>-GP-..., thực tế "${state.licenseCode}"`);
        assertTrue(state.licenseFileValue === '', 'licenseFile input phải về rỗng');
        assertTrue(state.licenseFileChip === '', 'Chip licenseFile phải biến mất sau Làm Mới');
      }
    );

    // ================= 5) Đăng Ký Xe =================
    await check(
      'Đăng Ký Xe: "Làm Mới" trắng form (dept không có option rỗng -> reset về ĐÚNG option đầu) + trắng lại Lộ Trình Di Chuyển về đúng 2 điểm rỗng + sinh lại mã',
      async () => {
        await page.evaluate(() => {
          DB.carPurposes = [{ key: 'CT', label: 'Công tác' }];
          switchTab('car');
        });
        await page.selectOption('#carDept', 'Phòng Kế Toán');
        await page.selectOption('#carType', '5 chỗ');
        await page.fill('#carPassengers', '02 - Kiểm thử A, Kiểm thử B');
        await page.fill('#carDirectUser', 'Người Trực Tiếp Kiểm Thử');
        await page.fill('#carDirectUserPhone', '0900000099');
        await page.selectOption('#carPurpose', 'CT');
        await page.fill('#carKm', '150');
        await page.fill('#carStartTime', '2026-09-10T08:00');
        await page.fill('#carEndTime', '2026-09-10T17:00');
        await page.fill('#carReason', 'Nội dung kiểm thử reset form.');

        // Lộ Trình Di Chuyển mặc định đã có sẵn 2 ô rỗng (Điểm xuất phát + 1 điểm đến, xem
        // resetCarRoutePoints() gọi từ setCarSubTab() lúc mở tab) — thêm 1 điểm nữa rồi điền cả 3.
        await page.click('button[data-op="addCarRoutePoint"]');
        const routeInputsBefore = await page.locator('#carRoutePointsWrap input').count();
        assertTrue(routeInputsBefore === 3, `Phải có 3 ô Lộ Trình sau khi bấm "+ Thêm Điểm", thực tế ${routeInputsBefore}`);
        await page.locator('#carRoutePointsWrap input').nth(0).fill('Hội An');
        await page.locator('#carRoutePointsWrap input').nth(1).fill('Đà Nẵng');
        await page.locator('#carRoutePointsWrap input').nth(2).fill('Huế');

        const codeBeforeReset = await page.locator('#carCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'carCode phải tự sinh sẵn khi vừa mở tab');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#carForm button[data-arg1="resetCarRegForm"]');
        const state = await page.evaluate(() => ({
          carDept: document.getElementById('carDept').value,
          carPassengers: document.getElementById('carPassengers').value,
          carReason: document.getElementById('carReason').value,
          carCode: document.getElementById('carCode').value,
          carDestination: document.getElementById('carDestination').value,
          routeInputsCount: document.querySelectorAll('#carRoutePointsWrap input').length,
          routeInputValues: Array.from(document.querySelectorAll('#carRoutePointsWrap input')).map(el => el.value),
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.carDept === 'Phòng Kinh Doanh', `carDept phải về ĐÚNG option đầu (Phòng Kinh Doanh, KHÁC "Phòng Kế Toán" vừa chọn), thực tế "${state.carDept}"`);
        assertTrue(state.carPassengers === '', 'carPassengers phải về rỗng');
        assertTrue(state.carReason === '', 'carReason phải về rỗng');
        assertTrue(/^HCRC-[^-]+-DKX-/.test(state.carCode), `carCode phải được sinh lại đúng khuôn HCRC-<mã phòng>-DKX-..., thực tế "${state.carCode}"`);
        assertTrue(state.routeInputsCount === 2, `Lộ Trình Di Chuyển phải về lại ĐÚNG 2 ô (không phải 3 ô vừa nhập, cũng không phải 0), thực tế ${state.routeInputsCount}`);
        assertTrue(state.routeInputValues.every(v => v === ''), `Cả 2 ô Lộ Trình phải trống sau Làm Mới, thực tế ${JSON.stringify(state.routeInputValues)}`);
        assertTrue(state.carDestination === '', 'carDestination (hidden, ghép từ Lộ Trình) phải trống sau Làm Mới');
      }
    );

    // ================= 6) Phòng Họp =================
    await check(
      'Phòng Họp: form đơn giản nhất đợt này (không có ô tải tệp/mảng JS riêng) — "Làm Mới" trắng form + sinh lại mã',
      async () => {
        await page.evaluate(() => {
          DB.meetingRooms = [{ id: 1, name: 'Phòng Họp A', short: 'A' }];
          switchTab('meeting');
        });
        await page.selectOption('#meetingDept', 'Phòng Kế Toán');
        await page.selectOption('#meetingRoom', 'Phòng Họp A');
        await page.fill('#meetingTitle', 'Họp kiểm thử reset form');
        await page.fill('#meetingAttendees', '10');
        await page.fill('#meetingStartTime', '2026-09-10T08:00');
        await page.fill('#meetingEndTime', '2026-09-10T09:00');
        await page.fill('#meetingEquipment', 'Máy chiếu');
        await page.fill('#meetingAgenda', 'Nội dung kiểm thử reset form.');

        const codeBeforeReset = await page.locator('#meetingCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'meetingCode phải tự sinh sẵn khi vừa mở tab');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#meetingForm button[data-arg1="resetMeetingReqForm"]');
        const state = await page.evaluate(() => ({
          meetingDept: document.getElementById('meetingDept').value,
          meetingTitle: document.getElementById('meetingTitle').value,
          meetingAgenda: document.getElementById('meetingAgenda').value,
          meetingCode: document.getElementById('meetingCode').value,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.meetingDept === 'Phòng Kinh Doanh', `meetingDept phải về ĐÚNG option đầu (Phòng Kinh Doanh, KHÁC "Phòng Kế Toán" vừa chọn), thực tế "${state.meetingDept}"`);
        assertTrue(state.meetingTitle === '', 'meetingTitle phải về rỗng');
        assertTrue(state.meetingAgenda === '', 'meetingAgenda phải về rỗng');
        assertTrue(/^HCRC-[^-]+-DPH-/.test(state.meetingCode), `meetingCode phải được sinh lại đúng khuôn HCRC-<mã phòng>-DPH-..., thực tế "${state.meetingCode}"`);
      }
    );

    // ================= 7) Biên Bản Họp =================
    await check(
      'Biên Bản Họp: "Làm Mới" trắng form + trắng bảng Thành Phần Tham Dự/Ý Kiến Chỉ Đạo về ĐÚNG 0 dòng (đúng hành vi cancelEditMeetingMinutes()/luồng lưu thành công đã có) + sinh lại mã + đưa nút Lưu về lại nhãn gốc',
      async () => {
        await page.evaluate(() => switchTab('minutes'));
        await page.fill('#minutesTitle', 'Họp kiểm thử reset form');
        await page.fill('#minutesTime', '2026-09-10T09:00');
        await page.fill('#minutesLocation', 'Phòng họp A');
        await page.fill('#minutesChair', 'Nguyễn Văn Chủ Trì');
        await page.fill('#minutesSecretary', 'Trần Thị Thư Ký');
        await page.fill('#minutesContent', 'Nội dung kiểm thử reset form.');

        // Bảng Thành Phần Tham Dự KHÔNG có sẵn dòng nào khi vừa mở tab (khác officeItems của Mua Sắm) —
        // tự bấm "Thêm Người Tham Dự" trước khi điền.
        await page.click('button[data-op="addAttendeeRow"]');
        await page.click('button[data-op="addAttendeeRow"]');
        const attendeeRowsBefore = await page.locator('#minutesAttendeesTableBody tr').count();
        assertTrue(attendeeRowsBefore === 2, `Phải có 2 dòng Thành Phần Tham Dự trước khi Làm Mới, thực tế ${attendeeRowsBefore}`);
        await page.locator('#minutesAttendeesTableBody input[data-arg1="name"]').nth(0).fill('Người Tham Dự A');
        await page.locator('#minutesAttendeesTableBody input[data-arg1="name"]').nth(1).fill('Người Tham Dự B');

        await page.click('button[data-op="addMinutesDirectiveRow"]');
        const directiveRowsBefore = await page.locator('#minutesDirectivesTableBody tr').count();
        assertTrue(directiveRowsBefore === 1, `Phải có 1 dòng Ý Kiến Chỉ Đạo trước khi Làm Mới, thực tế ${directiveRowsBefore}`);
        await page.locator('#minutesDirectivesTableBody input[data-arg1="content"]').nth(0).fill('Nội dung chỉ đạo kiểm thử');

        const codeBeforeReset = await page.locator('#minutesCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'minutesCode phải tự sinh sẵn khi vừa mở tab');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#minutesForm button[data-arg1="resetMeetingMinutesForm"]');
        const state = await page.evaluate(() => ({
          minutesTitle: document.getElementById('minutesTitle').value,
          minutesContent: document.getElementById('minutesContent').value,
          minutesCode: document.getElementById('minutesCode').value,
          attendeeRows: document.querySelectorAll('#minutesAttendeesTableBody tr').length,
          directiveRows: document.querySelectorAll('#minutesDirectivesTableBody tr').length,
          submitBtnText: document.getElementById('minutesSubmitBtn').innerText,
          cancelBtnHidden: document.getElementById('minutesCancelEditBtn').classList.contains('hidden'),
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.minutesTitle === '', 'minutesTitle phải về rỗng');
        assertTrue(state.minutesContent === '', 'minutesContent phải về rỗng');
        assertTrue(/^HCRC-[^-]+-BBH-/.test(state.minutesCode), `minutesCode phải được sinh lại đúng khuôn HCRC-<mã phòng>-BBH-..., thực tế "${state.minutesCode}"`);
        assertTrue(state.attendeeRows === 0, `Bảng Thành Phần Tham Dự phải về ĐÚNG 0 dòng sau Làm Mới, thực tế ${state.attendeeRows}`);
        assertTrue(state.directiveRows === 0, `Bảng Ý Kiến Chỉ Đạo phải về ĐÚNG 0 dòng sau Làm Mới, thực tế ${state.directiveRows}`);
        assertTrue(state.submitBtnText === 'Lưu Biên Bản Họp', `Nút Lưu phải về lại nhãn gốc, thực tế "${state.submitBtnText}"`);
        assertTrue(state.cancelBtnHidden === true, 'Nút "Huỷ Sửa" phải ẩn sau Làm Mới');
      }
    );

    // ================= 8) Mua Bán/Sửa Chữa/Đầu Tư (officeReqs, phân hệ Mua Sắm) =================
    await check(
      'Mua Bán (Mua Sắm): "Làm Mới" trắng form + collapse bảng "Danh Sách Hạng Mục Đề Nghị Mua Sắm" về ĐÚNG 1 dòng trống (không phải 0, không phải còn nguyên 2 dòng) + sinh lại mã',
      async () => {
        await page.evaluate(() => switchTab('office')); // activeOfficeSubTab mặc định = 'MUA_BAN'
        await page.selectOption('#offDept', 'Phòng Kế Toán');
        await page.fill('#offTitle', 'Mua sắm kiểm thử reset form');
        await page.fill('#offReason', 'Lý do kiểm thử reset form.');

        // setOfficeSubTab() đã tự thêm sẵn ĐÚNG 1 dòng trống khi vừa mở phân hệ Mua Sắm (officeItems
        // rỗng lúc đó) — điền dòng đó rồi thêm 1 dòng nữa để có 2 dòng trước khi Làm Mới.
        const rowsInitial = await page.locator('#officeItemsTableBody tr').count();
        assertTrue(rowsInitial === 1, `Phải có sẵn ĐÚNG 1 dòng Hạng Mục khi vừa mở phân hệ Mua Sắm, thực tế ${rowsInitial}`);
        await page.locator('#officeItemsTableBody input[data-arg1="name"]').nth(0).fill('Bàn làm việc');
        await page.locator('#officeItemsTableBody input[data-arg1="qty"]').nth(0).fill('5');
        await page.click('button[data-op="addOfficeItemRow"]');
        await page.locator('#officeItemsTableBody input[data-arg1="name"]').nth(1).fill('Ghế xoay');
        await page.locator('#officeItemsTableBody input[data-arg1="qty"]').nth(1).fill('5');
        const rowsBeforeReset = await page.locator('#officeItemsTableBody tr').count();
        assertTrue(rowsBeforeReset === 2, `Phải có 2 dòng Hạng Mục trước khi Làm Mới, thực tế ${rowsBeforeReset}`);

        const codeBeforeReset = await page.locator('#offCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'offCode phải tự sinh sẵn khi vừa mở tab');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#officeForm button[data-arg1="resetOfficeReqForm"]');
        const state = await page.evaluate(() => ({
          offDept: document.getElementById('offDept').value,
          offTitle: document.getElementById('offTitle').value,
          offCode: document.getElementById('offCode').value,
          itemRows: document.querySelectorAll('#officeItemsTableBody tr').length,
          itemRowName: document.querySelector('#officeItemsTableBody input[data-arg1="name"]')?.value,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.offDept === 'Phòng Kinh Doanh', `offDept phải về ĐÚNG option đầu (Phòng Kinh Doanh, KHÁC "Phòng Kế Toán" vừa chọn), thực tế "${state.offDept}"`);
        assertTrue(state.offTitle === '', 'offTitle phải về rỗng');
        assertTrue(/^HCRC-[^-]+-MB-/.test(state.offCode), `offCode phải được sinh lại đúng khuôn HCRC-<mã phòng>-MB-... (Mua Bán), thực tế "${state.offCode}"`);
        assertTrue(state.itemRows === 1, `Bảng Hạng Mục phải collapse về ĐÚNG 1 dòng trống sau Làm Mới, thực tế ${state.itemRows}`);
        assertTrue(state.itemRowName === '', `Dòng Hạng Mục còn lại phải trống (Tên Tài Sản), thực tế "${state.itemRowName}"`);
      }
    );

    // ================= 9) confirmAndResetForm(): KHÔNG hỏi xác nhận khi form đang trống =================
    await check('confirmAndResetForm(): KHÔNG hỏi xác nhận khi form đang trống (vừa mở tab, chưa nhập gì)', async () => {
      await page.evaluate(() => { switchTab('license'); window.__confirmCalls = []; });
      await page.click('#licenseForm button[data-arg1="resetLicenseForm"]');
      const confirmCount = await page.evaluate(() => window.__confirmCalls.length);
      assertTrue(confirmCount === 0, `KHÔNG được hỏi xác nhận khi form đang trống, thực tế đã hỏi ${confirmCount} lần`);
    });

    // ============ Đợt C: Đào Tạo (7 form) + Tuyển Dụng (2 form) + HCRC Đồng Hành + Nội Bộ ============
    // Fixture dùng chung cho các kịch bản Đào Tạo bên dưới — trainingCategories/trainingCourses rỗng ở
    // _seed.js (không thuộc 3 module gốc).
    await page.evaluate(() => {
      DB.trainingCategories = ['Nghiệp Vụ'];
      DB.trainingCourses = [{ id: 501, name: 'Khóa Kiểm Thử', category: 'Nghiệp Vụ' }];
    });

    // ================= 10) Đào Tạo > Lớp Học =================
    await check(
      'Đào Tạo > Lớp Học: "Làm Mới" trắng form (Offline->Online, ẩn lại Giảng Viên/Địa Điểm) + trắng Danh Sách Được Mời (tcInviteListStaged) + trắng phần Nhập Từ Excel đang xem trước dở',
      async () => {
        await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('CLASSES'); });
        await page.fill('#tcTitle', 'Lớp kiểm thử reset form');
        await page.selectOption('#tcMode', 'OFFLINE');
        await page.evaluate(() => onTrainingClassModeChange());
        await page.fill('#tcInstructor', 'Giảng Viên Kiểm Thử');
        await page.fill('#tcLocation', 'Phòng A');
        await page.fill('#tcStart', '2026-01-01T08:00');
        await page.fill('#tcDescription', 'Nội dung kiểm thử reset form.');
        await page.evaluate(() => {
          document.getElementById('tcInstructorUsername').value = 'gv1';
          tcInviteListStaged.push({ username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc' });
          renderTrainingInviteListStagedList();
          // Giả lập phần Nhập Từ Excel đang xem trước dở (không cần thật sự upload/parse Excel để kiểm
          // resetTrainingClassForm() có dọn sạch đúng các phần tử này hay không).
          tcInviteFilePreviewItems = [{ username: 'nv1', name: 'X', status: 'OK' }];
          document.getElementById('tcInviteFileStatus').innerText = 'Đã tìm thấy 1 người hợp lệ.';
          document.getElementById('tcInviteFilePreviewWrap').classList.remove('hidden');
          document.getElementById('tcInviteFileAddBtn').classList.remove('hidden');
        });

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#trainingClassForm button[data-arg1="resetTrainingClassForm"]');
        const state = await page.evaluate(() => ({
          tcTitle: document.getElementById('tcTitle').value,
          tcMode: document.getElementById('tcMode').value,
          tcInstructorFieldHidden: document.getElementById('tcInstructorFieldWrap').classList.contains('hidden'),
          tcLocationFieldHidden: document.getElementById('tcLocationFieldWrap').classList.contains('hidden'),
          tcInstructorUsername: document.getElementById('tcInstructorUsername').value,
          inviteStagedCount: tcInviteListStaged.length,
          inviteStagedListText: document.getElementById('tcInviteListStagedList').innerText,
          previewItemsCount: tcInviteFilePreviewItems.length,
          inviteFileInputValue: document.getElementById('tcInviteFileInput').value,
          inviteFileStatus: document.getElementById('tcInviteFileStatus').innerText,
          previewWrapHidden: document.getElementById('tcInviteFilePreviewWrap').classList.contains('hidden'),
          addBtnHidden: document.getElementById('tcInviteFileAddBtn').classList.contains('hidden'),
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.tcTitle === '', 'tcTitle phải về rỗng');
        assertTrue(state.tcMode === 'ONLINE', `tcMode phải về lại "ONLINE" (mặc định), thực tế "${state.tcMode}"`);
        assertTrue(state.tcInstructorFieldHidden === true, 'Ô Giảng Viên phải ẩn lại (Online)');
        assertTrue(state.tcLocationFieldHidden === true, 'Ô Địa Điểm phải ẩn lại (Online)');
        assertTrue(state.tcInstructorUsername === '', 'tcInstructorUsername (hidden) phải về rỗng');
        assertTrue(state.inviteStagedCount === 0, `Danh Sách Được Mời phải về 0 người, thực tế ${state.inviteStagedCount}`);
        assertTrue(state.inviteStagedListText.includes('Chưa mời ai'), 'Danh Sách Được Mời phải hiện lại thông báo mặc định');
        assertTrue(state.previewItemsCount === 0, `Phần xem trước Nhập Từ Excel phải về 0 dòng, thực tế ${state.previewItemsCount}`);
        assertTrue(state.inviteFileInputValue === '', 'tcInviteFileInput phải về rỗng');
        assertTrue(state.inviteFileStatus === '', 'tcInviteFileStatus phải về rỗng');
        assertTrue(state.previewWrapHidden === true, 'tcInviteFilePreviewWrap phải ẩn lại');
        assertTrue(state.addBtnHidden === true, 'tcInviteFileAddBtn phải ẩn lại');
      }
    );

    // ================= 11) Đào Tạo > Chương Trình =================
    await check('Đào Tạo > Chương Trình: form đơn giản nhất đợt này — "Làm Mới" trắng form', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('COURSES'); });
      await page.fill('#tccName', 'Chương trình kiểm thử reset form');
      await page.fill('#tccDescription', 'Mô tả kiểm thử reset form.');

      await page.evaluate(() => { window.__confirmCalls = []; });
      await page.click('#trainingCourseForm button[data-arg1="resetTrainingCourseForm"]');
      const state = await page.evaluate(() => ({
        tccName: document.getElementById('tccName').value,
        tccDescription: document.getElementById('tccDescription').value,
        confirmCalls: window.__confirmCalls.length
      }));
      assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
      assertTrue(state.tccName === '', 'tccName phải về rỗng');
      assertTrue(state.tccDescription === '', 'tccDescription phải về rỗng');
    });

    // ================= 12) Đào Tạo > Kế Hoạch Đào Tạo =================
    await check(
      'Đào Tạo > Kế Hoạch: "Làm Mới" trắng form + thoát Sửa dở dang (nhãn/nút về lại mặc định, gọi lại cancelEditTrainingPlan() có sẵn)',
      async () => {
        await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('PLANS'); });
        await page.fill('#tpMonth', '2026-05');
        await page.fill('#tpAudience', 'Nhân viên mới');
        await page.fill('#tpPlannedClasses', '3');
        // Giả lập đang giữa chừng Sửa 1 kế hoạch có sẵn (openEditTrainingPlan()).
        await page.evaluate(() => {
          editingTrainingPlanId = 999;
          document.getElementById('tpCancelEditBtn').classList.remove('hidden');
          document.getElementById('tpSubmitBtn').innerText = 'Lưu Thay Đổi';
          document.getElementById('trainingPlanFormTitle').innerText = 'Sửa Kế Hoạch — Tháng test';
        });

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#trainingPlanForm button[data-arg1="resetTrainingPlanForm"]');
        const state = await page.evaluate(() => ({
          tpMonth: document.getElementById('tpMonth').value,
          tpAudience: document.getElementById('tpAudience').value,
          editingId: editingTrainingPlanId,
          cancelBtnHidden: document.getElementById('tpCancelEditBtn').classList.contains('hidden'),
          submitBtnText: document.getElementById('tpSubmitBtn').innerText,
          formTitle: document.getElementById('trainingPlanFormTitle').innerText,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.tpMonth === '', 'tpMonth phải về rỗng');
        assertTrue(state.tpAudience === '', 'tpAudience phải về rỗng');
        assertTrue(state.editingId === null, 'editingTrainingPlanId phải về null (thoát Sửa dở dang)');
        assertTrue(state.cancelBtnHidden === true, 'Nút "Hủy Sửa" phải ẩn lại');
        assertTrue(state.submitBtnText === 'Lập Kế Hoạch', `Nút Lưu phải về lại nhãn gốc, thực tế "${state.submitBtnText}"`);
        assertTrue(state.formTitle === '➕ Lập Kế Hoạch Đào Tạo Mới', `Tiêu đề form phải về lại mặc định, thực tế "${state.formTitle}"`);
      }
    );

    // ================= 13) Đào Tạo > Kho Tài Liệu =================
    await check(
      'Đào Tạo > Kho Tài Liệu: chip file tdFile, "Làm Mới" trắng form + đưa Loại Tài Liệu (Video->Tài Liệu) về lại đúng ẩn/hiện + required',
      async () => {
        await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('DOCS'); });
        await page.fill('#tdTitle', 'Tài liệu kiểm thử reset form');
        await page.setInputFiles('#tdFile', fakeFile('tai-lieu-dt.pdf', 'noi dung', 'application/pdf'));
        const chip = await page.locator('#tdFileChip').innerText();
        assertTrue(chip.includes('tai-lieu-dt.pdf'), `Chip tdFile phải hiện tên file, thực tế: ${chip}`);

        await page.selectOption('#tdDocType', 'VIDEO');
        await page.evaluate(() => onTrainingDocTypeChange());
        await page.fill('#tdVideoUrl', 'https://www.youtube.com/watch?v=abc123');
        await page.check('#tdMandatory');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#trainingDocForm button[data-arg1="resetTrainingDocForm"]');
        const state = await page.evaluate(() => ({
          tdTitle: document.getElementById('tdTitle').value,
          tdDocType: document.getElementById('tdDocType').value,
          tdFileFieldHidden: document.getElementById('tdFileField').classList.contains('hidden'),
          tdVideoFieldHidden: document.getElementById('tdVideoField').classList.contains('hidden'),
          tdFileRequired: document.getElementById('tdFile').required,
          tdMandatory: document.getElementById('tdMandatory').checked,
          tdFileValue: document.getElementById('tdFile').value,
          tdFileChip: document.getElementById('tdFileChip').innerHTML,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.tdTitle === '', 'tdTitle phải về rỗng');
        assertTrue(state.tdDocType === 'DOCUMENT', `tdDocType phải về lại "DOCUMENT" (mặc định), thực tế "${state.tdDocType}"`);
        assertTrue(state.tdFileFieldHidden === false, 'Ô Tệp Tài Liệu phải hiện lại');
        assertTrue(state.tdVideoFieldHidden === true, 'Ô Link Video phải ẩn lại');
        assertTrue(state.tdFileRequired === true, 'tdFile phải required lại (loại DOCUMENT)');
        assertTrue(state.tdMandatory === false, 'tdMandatory phải bỏ tick');
        assertTrue(state.tdFileValue === '', 'tdFile input phải về rỗng');
        assertTrue(state.tdFileChip === '', 'Chip tdFile phải biến mất sau Làm Mới');
      }
    );

    // ================= 14) Đào Tạo > Lộ Trình Thăng Tiến =================
    await check(
      'Đào Tạo > Lộ Trình Thăng Tiến: "Làm Mới" trắng form + collapse "Các Cấp Bậc" về ĐÚNG 1 hàng trống (resetCareerPathForm() đã có sẵn TỪ TRƯỚC, chỉ thêm nút gọi tới)',
      async () => {
        await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('PATHS'); });
        await page.fill('#cpName', 'Lộ trình kiểm thử reset form');
        await page.fill('#cpTargetTitle', 'Trưởng nhóm kiểm thử');
        const rowsInitial = await page.locator('#cpStageBuilderContainer .cp-stage-row').count();
        assertTrue(rowsInitial === 1, `Phải có sẵn ĐÚNG 1 hàng Cấp Bậc khi vừa mở tab, thực tế ${rowsInitial}`);
        await page.locator('.cp-stage-name-input').nth(0).fill('Cấp 1 kiểm thử');
        await page.selectOption('.cp-stage-course-select', '501');
        // Gọi thẳng addCpStageRow() qua JS thay vì click nút "+ Thêm Cấp Bậc" trên UI: #careerPathForm
        // nằm LỒNG trong CẢ #internalTrainingLmsSection LẪN #internalSection — cả 2 đều tự
        // bindCspDelegation() riêng (xem core.js) nên 1 click chuột thật ở đây bị DỊCH VỤ CẢ 2 tầng bắt
        // (event bubble qua đúng 2 root), gọi addCpStageRow() 2 LẦN thay vì 1 (bug CÓ SẴN TỪ TRƯỚC, không
        // liên quan gì tới Đợt C — addCpStageRow() không idempotent nên lộ ra, KHÁC nút "↺ Làm Mới" ngay
        // dưới đây vẫn an toàn dù bị dispatch 2 lần vì resetCareerPathForm() collapse về ĐÚNG 1 hàng bất
        // kể gọi mấy lần, xem chú thích cuối bài test này). Gọi thẳng hàm ở đây để bài test không phụ
        // thuộc bug KHÔNG THUỘC PHẠM VI Đợt C đó.
        await page.evaluate(() => addCpStageRow());
        const rowsBeforeReset = await page.locator('#cpStageBuilderContainer .cp-stage-row').count();
        assertTrue(rowsBeforeReset === 2, `Phải có 2 hàng Cấp Bậc trước khi Làm Mới, thực tế ${rowsBeforeReset}`);

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#careerPathForm button[data-arg1="resetCareerPathForm"]');
        const state = await page.evaluate(() => ({
          cpName: document.getElementById('cpName').value,
          rows: document.querySelectorAll('#cpStageBuilderContainer .cp-stage-row').length,
          rowNameValue: document.querySelector('.cp-stage-name-input')?.value,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.cpName === '', 'cpName phải về rỗng');
        assertTrue(state.rows === 1, `Các Cấp Bậc phải collapse về ĐÚNG 1 hàng trống sau Làm Mới, thực tế ${state.rows}`);
        assertTrue(state.rowNameValue === '', `Hàng còn lại phải trống (tên cấp bậc), thực tế "${state.rowNameValue}"`);
      }
    );

    // ================= 15) Đào Tạo Tân Binh > Quản Lý Lộ Trình =================
    await check(
      'Đào Tạo Tân Binh > Quản Lý Lộ Trình: "Làm Mới" trắng form + thoát Sửa dở dang (gọi lại cancelEditOnboardingPath() có sẵn)',
      async () => {
        await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('ONBOARDING'); });
        await page.fill('#opName', 'Lộ trình tân binh kiểm thử');
        await page.selectOption('#opStage1RequiredCourseIds', ['501']);
        await page.selectOption('#opStage2RequiredCourseIds', ['501']);
        await page.fill('#opStage3Criteria', 'Tiêu chí kiểm thử.');
        await page.evaluate(() => {
          editingOnboardingPathId = 999;
          document.getElementById('opCancelEditBtn').classList.remove('hidden');
          document.getElementById('opSubmitBtn').innerText = 'Lưu Thay Đổi';
        });

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#onboardingPathForm button[data-arg1="resetOnboardingPathForm"]');
        const state = await page.evaluate(() => ({
          opName: document.getElementById('opName').value,
          stage1Selected: [...document.getElementById('opStage1RequiredCourseIds').selectedOptions].length,
          stage2Selected: [...document.getElementById('opStage2RequiredCourseIds').selectedOptions].length,
          opStage3Criteria: document.getElementById('opStage3Criteria').value,
          editingId: editingOnboardingPathId,
          cancelBtnHidden: document.getElementById('opCancelEditBtn').classList.contains('hidden'),
          submitBtnText: document.getElementById('opSubmitBtn').innerText,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.opName === '', 'opName phải về rỗng');
        assertTrue(state.stage1Selected === 0, 'opStage1RequiredCourseIds phải không còn lựa chọn nào');
        assertTrue(state.stage2Selected === 0, 'opStage2RequiredCourseIds phải không còn lựa chọn nào');
        assertTrue(state.opStage3Criteria === '', 'opStage3Criteria phải về rỗng');
        assertTrue(state.editingId === null, 'editingOnboardingPathId phải về null (thoát Sửa dở dang)');
        assertTrue(state.cancelBtnHidden === true, 'Nút "Hủy Sửa" phải ẩn lại');
        assertTrue(state.submitBtnText === 'Tạo Lộ Trình', `Nút Lưu phải về lại nhãn gốc, thực tế "${state.submitBtnText}"`);
      }
    );

    // ================= 16) Đào Tạo > Ngân Hàng Câu Hỏi =================
    await check(
      'Ngân Hàng Câu Hỏi: "Làm Mới" trắng form (tiêu đề/loại/điểm) + trắng HẲN danh sách câu hỏi đang xây dở về ĐÚNG 0 câu — đây LÀ trạng thái mặc định thật của form (không phải 1 câu SINGLE mặc định)',
      async () => {
        await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('TESTS'); });
        await page.fill('#ttTitle', 'Bài test kiểm thử reset form');
        await page.fill('#ttPassScore', '70');
        // Dựng thẳng 1 câu hỏi MULTI + 3 đáp án + 1 ảnh minh hoạ (đã có imageUrl) qua state JS trực tiếp —
        // cùng khuôn tests/test-training-question-images-ui.js, không cần thật sự lặp lại thao tác click
        // "+ Thêm Câu Hỏi"/"+ Thêm Đáp Án" qua UI.
        await page.evaluate(() => {
          tbQuestions = [{
            text: 'Câu hỏi kiểm thử reset form', type: 'MULTI', points: 2, imageUrl: '/uploads/fake-question-image.png',
            options: [
              { text: 'Đáp án 1', correct: true, imageUrl: '' },
              { text: 'Đáp án 2', correct: true, imageUrl: '' },
              { text: 'Đáp án 3', correct: false, imageUrl: '' }
            ]
          }];
          renderTestBuilderQuestions();
        });
        const questionBlocksBefore = await page.locator('#tbQuestionsContainer > div').count();
        assertTrue(questionBlocksBefore === 1, `Phải có 1 câu hỏi đang xây dở trước khi Làm Mới, thực tế ${questionBlocksBefore}`);

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#trainingTestForm button[data-arg1="resetTrainingTestForm"]');
        const state = await page.evaluate(() => ({
          ttTitle: document.getElementById('ttTitle').value,
          ttPassScore: document.getElementById('ttPassScore').value,
          tbQuestionsLength: tbQuestions.length,
          containerText: document.getElementById('tbQuestionsContainer').innerText,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.ttTitle === '', 'ttTitle phải về rỗng');
        assertTrue(state.ttPassScore === '', 'ttPassScore phải về rỗng');
        assertTrue(state.tbQuestionsLength === 0, `tbQuestions phải về ĐÚNG 0 câu (đúng trạng thái mặc định thật của form), thực tế ${state.tbQuestionsLength}`);
        assertTrue(state.containerText.includes('Chưa có câu hỏi nào'), `Phải hiện lại thông báo "Chưa có câu hỏi nào", thực tế: ${state.containerText}`);
      }
    );

    // ================= 17) Tuyển Dụng > Tin Tuyển Dụng =================
    await check(
      'Tuyển Dụng > Tin Tuyển Dụng: chip ảnh banner rjBannerFile, "Làm Mới" trắng form',
      async () => {
        await page.evaluate(() => { switchTab('internal'); setInternalSubTab('RECRUITMENT'); setRecruitmentTab('JOBS'); });
        await page.fill('#rjTitle', 'Vị trí kiểm thử reset form');
        await page.fill('#rjContactInfo', '0900000000');
        await page.fill('#rjDescription', 'Mô tả kiểm thử reset form.');
        await page.setInputFiles('#rjBannerFile', fakeFile('banner.png', 'noi dung', 'image/png'));
        const chip = await page.locator('#rjBannerFileChip').innerText();
        assertTrue(chip.includes('banner.png'), `Chip rjBannerFile phải hiện tên file, thực tế: ${chip}`);

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#recruitmentJobForm button[data-arg1="resetRecruitmentJobForm"]');
        const state = await page.evaluate(() => ({
          rjTitle: document.getElementById('rjTitle').value,
          rjDescription: document.getElementById('rjDescription').value,
          rjBannerFileValue: document.getElementById('rjBannerFile').value,
          rjBannerFileChip: document.getElementById('rjBannerFileChip').innerHTML,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.rjTitle === '', 'rjTitle phải về rỗng');
        assertTrue(state.rjDescription === '', 'rjDescription phải về rỗng');
        assertTrue(state.rjBannerFileValue === '', 'rjBannerFile input phải về rỗng');
        assertTrue(state.rjBannerFileChip === '', 'Chip rjBannerFile phải biến mất sau Làm Mới');
      }
    );

    // ================= 18) Tuyển Dụng > Giới Thiệu Ứng Viên (modal) =================
    await check(
      'Tuyển Dụng > Giới Thiệu Ứng Viên (modal): chip CV rrCvFile, "Làm Mới" trắng form NHƯNG GIỮ NGUYÊN #rrJobId (ngữ cảnh "đang giới thiệu cho tin nào", hidden input NẰM TRONG form — khác mọi editingXxxId khác)',
      async () => {
        await page.evaluate(() => {
          DB.recruitmentJobs = [{ id: 777, title: 'Vị trí kiểm thử modal', status: 'OPEN', slots: 0 }];
          switchTab('internal'); setInternalSubTab('RECRUITMENT'); setRecruitmentTab('JOBS');
          openRecruitmentReferModal(777);
        });
        await page.fill('#rrCandidateName', 'Ứng viên kiểm thử');
        await page.fill('#rrCandidatePhone', '0911111111');
        await page.fill('#rrCandidateNote', 'Ghi chú kiểm thử reset form.');
        await page.setInputFiles('#rrCvFile', fakeFile('cv-kiem-thu.pdf', 'noi dung', 'application/pdf'));
        const chip = await page.locator('#rrCvFileChip').innerText();
        assertTrue(chip.includes('cv-kiem-thu.pdf'), `Chip rrCvFile phải hiện tên file, thực tế: ${chip}`);

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#recruitmentReferForm button[data-arg1="resetRecruitmentReferForm"]');
        const state = await page.evaluate(() => ({
          rrCandidateName: document.getElementById('rrCandidateName').value,
          rrCandidateNote: document.getElementById('rrCandidateNote').value,
          rrCvFileValue: document.getElementById('rrCvFile').value,
          rrCvFileChip: document.getElementById('rrCvFileChip').innerHTML,
          rrJobId: document.getElementById('rrJobId').value,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.rrCandidateName === '', 'rrCandidateName phải về rỗng');
        assertTrue(state.rrCandidateNote === '', 'rrCandidateNote phải về rỗng');
        assertTrue(state.rrCvFileValue === '', 'rrCvFile input phải về rỗng');
        assertTrue(state.rrCvFileChip === '', 'Chip rrCvFile phải biến mất sau Làm Mới');
        assertTrue(state.rrJobId === '777', `#rrJobId PHẢI được giữ nguyên (777) sau Làm Mới (không phải mất ngữ cảnh), thực tế "${state.rrJobId}"`);
      }
    );

    // ============ 19) recruitmentReferForm: KHÔNG hỏi xác nhận ngay khi vừa mở modal ============
    // #rrJobId đã đánh dấu readonly để confirmAndResetForm() không tính nhầm là "đã nhập" chỉ vì modal
    // vừa mở (giá trị luôn khác rỗng ngay từ lúc mở, khác defaultValue rỗng của hidden input tĩnh).
    await check('recruitmentReferForm: KHÔNG hỏi xác nhận ngay khi vừa mở modal (readonly #rrJobId không tính là "đã nhập")', async () => {
      await page.evaluate(() => {
        DB.recruitmentJobs = [{ id: 778, title: 'Vị trí kiểm thử modal 2', status: 'OPEN', slots: 0 }];
        switchTab('internal'); setInternalSubTab('RECRUITMENT'); setRecruitmentTab('JOBS');
        openRecruitmentReferModal(778);
        window.__confirmCalls = [];
      });
      await page.click('#recruitmentReferForm button[data-arg1="resetRecruitmentReferForm"]');
      const confirmCount = await page.evaluate(() => window.__confirmCalls.length);
      assertTrue(confirmCount === 0, `KHÔNG được hỏi xác nhận ngay khi vừa mở modal, thực tế đã hỏi ${confirmCount} lần`);
      // Đóng modal lại — để mở (fixed inset-0, phủ kín màn hình) sẽ chặn MỌI click chuột thật của
      // Playwright ở các bài test SAU trong cùng phiên trình duyệt này.
      await page.evaluate(() => closeRecruitmentReferModal());
    });

    // ================= 20) HCRC Đồng Hành =================
    await check('HCRC Đồng Hành: "Làm Mới" trắng form gửi câu hỏi tới Nhân Sự (form đơn giản, không có ô tải tệp)', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('QNA'); });
      await page.fill('#hrFeedbackQuestion', 'Câu hỏi kiểm thử reset form.');

      await page.evaluate(() => { window.__confirmCalls = []; });
      await page.click('#hrFeedbackForm button[data-arg1="resetHrFeedbackForm"]');
      const state = await page.evaluate(() => ({
        hrFeedbackQuestion: document.getElementById('hrFeedbackQuestion').value,
        confirmCalls: window.__confirmCalls.length
      }));
      assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
      assertTrue(state.hrFeedbackQuestion === '', 'hrFeedbackQuestion phải về rỗng');
    });

    // ================= 21) Nội Bộ > Nhịp Sống HCRC (internalPostForm) =================
    await check(
      'Nhịp Sống HCRC (Nội Bộ): chip file đính kèm internalFile, "Làm Mới" trắng form + tắt Ghim bài (gọi lại cancelEditInternalPost() có sẵn)',
      async () => {
        await page.evaluate(() => { switchTab('internal'); setInternalSubTab('NEWS'); });
        await page.fill('#internalTitle', 'Tin kiểm thử reset form');
        await page.selectOption('#internalPostCategory', 'THI_DUA');
        await page.fill('#internalContent', 'Nội dung kiểm thử reset form.');
        await page.setInputFiles('#internalFile', fakeFile('dinh-kem.pdf', 'noi dung', 'application/pdf'));
        const chip = await page.locator('#internalFileChip').innerText();
        assertTrue(chip.includes('dinh-kem.pdf'), `Chip internalFile phải hiện tên file, thực tế: ${chip}`);
        await page.check('#internalPinCheckbox');
        await page.evaluate(() => toggleInternalPinDurationWrap(document.getElementById('internalPinCheckbox')));
        const pinWrapHiddenBefore = await page.evaluate(() => document.getElementById('internalPinDurationWrap').classList.contains('hidden'));
        assertTrue(pinWrapHiddenBefore === false, 'Khối chọn số ngày Ghim phải hiện ra sau khi tick (tiền đề bài test)');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#internalPostForm button[data-arg1="resetInternalPostForm"]');
        const state = await page.evaluate(() => ({
          internalTitle: document.getElementById('internalTitle').value,
          internalPostCategory: document.getElementById('internalPostCategory').value,
          internalContent: document.getElementById('internalContent').value,
          internalFileValue: document.getElementById('internalFile').value,
          internalFileChip: document.getElementById('internalFileChip').innerHTML,
          pinChecked: document.getElementById('internalPinCheckbox').checked,
          pinWrapHidden: document.getElementById('internalPinDurationWrap').classList.contains('hidden'),
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.internalTitle === '', 'internalTitle phải về rỗng');
        assertTrue(state.internalPostCategory === '', `internalPostCategory phải về rỗng, thực tế "${state.internalPostCategory}"`);
        assertTrue(state.internalContent === '', 'internalContent phải về rỗng');
        assertTrue(state.internalFileValue === '', 'internalFile input phải về rỗng');
        assertTrue(state.internalFileChip === '', 'Chip internalFile phải biến mất sau Làm Mới');
        assertTrue(state.pinChecked === false, 'internalPinCheckbox phải bỏ tick');
        assertTrue(state.pinWrapHidden === true, 'Khối chọn số ngày Ghim phải ẩn lại');
      }
    );

    // ================= 22) Thanh Toán (paymentCreateForm) =================
    await check(
      'Thanh Toán: "Làm Mới" gọi lại cancelEditPaymentRequest() có sẵn — trắng form tạo thủ công + trắng bảng "Các Đợt Thanh Toán" (KHÔNG có ô tải tệp)',
      async () => {
        await page.evaluate(() => { switchTab('office'); setOfficeSubTab('PAYMENT'); setPaymentSubTab('CREATE'); });
        await page.fill('#paymentTitle', 'Đề nghị kiểm thử reset form');
        // LƯU Ý: #paymentSection nằm LỒNG BÊN TRONG #officeSection (khác Hợp Đồng — 1 gốc riêng) nên sự
        // kiện click nổi bọt qua CẢ 2 root bindCspDelegation() (officeSection LẪN paymentSection), khiến
        // addPaymentCreateInstallmentRow() chạy 2 LẦN/click (đã xác nhận đây là hành vi CÓ SẴN TỪ TRƯỚC,
        // không phải lỗi phát sinh từ nút "↺ Làm Mới" mới thêm — không thuộc phạm vi đợt này, chỉ ghi
        // nhận đúng số dòng THẬT SỰ quan sát được để bài test không giả định sai).
        await page.click('button[data-op="addPaymentCreateInstallmentRow"]');
        const rowsBefore = await page.locator('#paymentCreateInstallmentsList [data-installment-row]').count();
        assertTrue(rowsBefore === 2, `1 click "+ Thêm Đợt" hiện tạo 2 dòng (bấm nổi bọt qua 2 root, hành vi có sẵn) trước khi Làm Mới, thực tế ${rowsBefore}`);
        await page.fill('#paymentCreateInstallmentsList [data-installment-row="0"] .payment-installment-desc', 'Đợt 1 kiểm thử');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#paymentCreateForm button[data-arg1="resetPaymentCreateForm"]');
        const state = await page.evaluate(() => ({
          paymentTitle: document.getElementById('paymentTitle').value,
          installmentRows: document.querySelectorAll('#paymentCreateInstallmentsList [data-installment-row]').length,
          sourceType: document.getElementById('paymentSourceType').value,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.paymentTitle === '', 'paymentTitle phải về rỗng');
        assertTrue(state.installmentRows === 0, `Các Đợt Thanh Toán phải về 0 dòng, thực tế ${state.installmentRows}`);
        assertTrue(state.sourceType === 'MANUAL', `paymentSourceType phải về lại "Thủ công", thực tế "${state.sourceType}"`);
      }
    );

    // ================= 23) Hỗ Trợ IT > Phê Duyệt Giá (itPriceCreateForm) =================
    await check(
      'Phê Duyệt Giá: chip file đơn (bảng giá, ĐÃ có data-op-change riêng đọc file) + chip file nhiều (tài liệu bổ sung, xoá đúng 1 file), Mức Margin/Chiết Khấu (Bán Buôn) bị xoá giá trị nhưng KHÔNG tự chuyển lại sub-tab Bán Lẻ, mã đề xuất/phòng ban sinh lại đúng',
      async () => {
        await page.evaluate(() => { switchTab('itSupport'); setItSupportSubTab('PRICE'); setItPriceSubTab('WHOLESALE'); });
        await page.selectOption('#itPriceTier', 'MARGIN_LT5');
        await page.fill('#itPriceReason', 'Lý do kiểm thử reset form');

        await page.setInputFiles('#itPriceFileInput', fakeFile('gia-de-xuat.xlsx', 'noi dung xlsx gia', XLSX_MIME));
        await page.waitForFunction(() => {
          const t = document.getElementById('itPriceFileStatus').innerText;
          return t.includes('✅') || t.includes('⛔');
        });
        const chip1 = await page.locator('#itPriceFileChip').innerText();
        assertTrue(chip1.includes('gia-de-xuat.xlsx'), `Chip itPriceFileInput phải hiện tên file, thực tế: ${chip1}`);
        const pendingBeforeReset = await page.evaluate(() => itPricePendingFile);
        assertTrue(!!pendingBeforeReset, 'itPricePendingFile phải đọc thành công tệp .xlsx thật trước khi Làm Mới (tiền đề bài test)');

        await page.setInputFiles('#itPriceExtraFiles', [
          fakeFile('phu-luc-1.pdf', 'a', 'application/pdf'),
          fakeFile('phu-luc-2.pdf', 'b', 'application/pdf')
        ]);
        const chipCountBefore = await page.locator('#itPriceExtraFilesChip button[data-op="removeOneFileFromMultiInput"]').count();
        assertTrue(chipCountBefore === 2, `Phải có đúng 2 chip tài liệu bổ sung, thực tế ${chipCountBefore}`);
        await page.locator('#itPriceExtraFilesChip button[data-op="removeOneFileFromMultiInput"]').first().click();
        const remainingChips = await page.locator('#itPriceExtraFilesChip button[data-op="removeOneFileFromMultiInput"]').count();
        assertTrue(remainingChips === 1, `Sau khi xoá 1 phải còn đúng 1 chip, thực tế ${remainingChips}`);
        const remainingChipText = await page.locator('#itPriceExtraFilesChip').innerText();
        assertTrue(
          remainingChipText.includes('phu-luc-2.pdf') && !remainingChipText.includes('phu-luc-1.pdf'),
          `Phải còn ĐÚNG file phu-luc-2.pdf (đã xoá phu-luc-1.pdf), thực tế: ${remainingChipText}`
        );
        const remainingFilesLength = await page.locator('#itPriceExtraFiles').evaluate((el) => el.files.length);
        assertTrue(remainingFilesLength === 1, `input.files phải còn đúng 1 phần tử, thực tế ${remainingFilesLength}`);

        const codeBeforeReset = await page.locator('#itPriceCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'itPriceCode phải tự sinh sẵn khi vừa mở tab');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#itPriceCreateForm button[data-arg1="resetItPriceForm"]');
        const state = await page.evaluate(() => ({
          itPriceReason: document.getElementById('itPriceReason').value,
          itPriceTier: document.getElementById('itPriceTier').value,
          tierWrapHidden: document.getElementById('itPriceTierSelectWrap').classList.contains('hidden'),
          itPriceCode: document.getElementById('itPriceCode').value,
          itPriceDeptDisplay: document.getElementById('itPriceDeptDisplay').value,
          itPriceFileValue: document.getElementById('itPriceFileInput').value,
          itPriceFileChip: document.getElementById('itPriceFileChip').innerHTML,
          itPriceExtraFilesValue: document.getElementById('itPriceExtraFiles').value,
          itPriceExtraFilesChip: document.getElementById('itPriceExtraFilesChip').innerHTML,
          itPricePendingFile: (typeof itPricePendingFile === 'undefined') ? 'UNDEFINED' : itPricePendingFile,
          activeSubTab: activeItPriceSubTab,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.itPriceReason === '', 'itPriceReason phải về rỗng');
        assertTrue(state.itPriceTier === '', `Mức Margin/Chiết Khấu phải về rỗng sau Làm Mới, thực tế "${state.itPriceTier}"`);
        assertTrue(state.activeSubTab === 'WHOLESALE', `Sub-tab Bán Buôn KHÔNG được tự đổi lại Bán Lẻ khi Làm Mới (chỉ xoá giá trị đã chọn), thực tế "${state.activeSubTab}"`);
        assertTrue(state.tierWrapHidden === false, 'Khối Mức Margin/Chiết Khấu vẫn phải HIỆN (đang ở Bán Buôn) — chỉ giá trị bị xoá, không ẩn khối');
        assertTrue(/^HCRC-[^-]+-ITPG-/.test(state.itPriceCode), `itPriceCode phải được sinh lại đúng khuôn HCRC-<mã phòng>-ITPG-..., thực tế "${state.itPriceCode}"`);
        assertTrue(state.itPriceDeptDisplay === 'Ban Giám Đốc', `itPriceDeptDisplay phải về đúng phòng ban hiện tại, thực tế "${state.itPriceDeptDisplay}"`);
        assertTrue(state.itPriceFileValue === '', 'itPriceFileInput phải về rỗng');
        assertTrue(state.itPriceFileChip === '', 'Chip itPriceFileInput phải biến mất sau Làm Mới');
        assertTrue(state.itPriceExtraFilesValue === '', 'itPriceExtraFiles phải về rỗng');
        assertTrue(state.itPriceExtraFilesChip === '', 'Chip itPriceExtraFiles phải biến mất sau Làm Mới');
        assertTrue(state.itPricePendingFile === null, `itPricePendingFile phải về null sau Làm Mới, thực tế ${JSON.stringify(state.itPricePendingFile)}`);
      }
    );

    // ================= 24) Hỗ Trợ IT > Hỗ Trợ Yêu Cầu (itTicketCreateForm) =================
    await check(
      'Hỗ Trợ Yêu Cầu: "Làm Mới" trắng form + sinh lại mã yêu cầu mới (KHÔNG có ô tải tệp)',
      async () => {
        await page.evaluate(() => { switchTab('itSupport'); setItSupportSubTab('TICKET'); });
        await page.fill('#itTicketTitle', 'Yêu cầu kiểm thử reset form');
        await page.fill('#itTicketDescription', 'Mô tả kiểm thử reset form.');
        const codeBeforeReset = await page.locator('#itTicketCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'itTicketCode phải tự sinh sẵn khi vừa mở tab');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#itTicketCreateForm button[data-arg1="resetItTicketForm"]');
        const state = await page.evaluate(() => ({
          itTicketTitle: document.getElementById('itTicketTitle').value,
          itTicketDescription: document.getElementById('itTicketDescription').value,
          itTicketCode: document.getElementById('itTicketCode').value,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.itTicketTitle === '', 'itTicketTitle phải về rỗng');
        assertTrue(state.itTicketDescription === '', 'itTicketDescription phải về rỗng');
        assertTrue(/^HCRC-/.test(state.itTicketCode), `itTicketCode phải được sinh lại, thực tế "${state.itTicketCode}"`);
      }
    );

    // ================= 25) Hỗ Trợ IT > Gia Hạn Dịch Vụ CNTT (itRenewalCreateForm) =================
    await check(
      'Gia Hạn Dịch Vụ CNTT: chip file đơn itRenewalFile, "Làm Mới" trắng form + đóng dropdown gợi ý đang mở của ô tìm-kiếm-gõ-chọn itRenewalCategory',
      async () => {
        // itServiceRenewals/itRenewalCategories: không thuộc 3 module gốc dùng _seed.js — bổ sung tay
        // (renderItServiceRenewals() gọi .map() thẳng lên DB.itServiceRenewals, undefined sẽ vỡ ngay).
        await page.evaluate(() => { DB.itServiceRenewals = []; DB.itRenewalCategories = []; switchTab('itSupport'); setItSupportSubTab('RENEWAL'); });
        await page.fill('#itRenewalName', 'Office 365 kiểm thử reset form');
        await page.fill('#itRenewalCategory', 'Phần mềm kiểm thử');
        await page.fill('#itRenewalVendor', 'Microsoft');
        await page.fill('#itRenewalExpiryDate', '2027-01-01');
        await page.setInputFiles('#itRenewalFile', fakeFile('hop-dong-license.pdf', 'noi dung', 'application/pdf'));
        const chip = await page.locator('#itRenewalFileChip').innerText();
        assertTrue(chip.includes('hop-dong-license.pdf'), `Chip itRenewalFile phải hiện tên file, thực tế: ${chip}`);

        // Focus lại ô Loại dịch vụ để mở dropdown gợi ý (sddHandleTrigger lắng nghe cả 'focusin') — kiểm
        // tra tiền đề bài test (dropdown PHẢI đang mở trước khi bấm Làm Mới mới có gì để kiểm chứng).
        await page.focus('#itRenewalCategory');
        const dropdownHiddenBefore = await page.evaluate(() => document.getElementById('itRenewalCategoryDatalist').classList.contains('hidden'));
        assertTrue(dropdownHiddenBefore === false, 'Dropdown gợi ý itRenewalCategoryDatalist phải đang MỞ sau khi focus (tiền đề bài test)');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#itRenewalCreateForm button[data-arg1="resetItRenewalForm"]');
        const state = await page.evaluate(() => ({
          itRenewalName: document.getElementById('itRenewalName').value,
          itRenewalCategory: document.getElementById('itRenewalCategory').value,
          itRenewalVendor: document.getElementById('itRenewalVendor').value,
          itRenewalExpiryDate: document.getElementById('itRenewalExpiryDate').value,
          itRenewalFileValue: document.getElementById('itRenewalFile').value,
          itRenewalFileChip: document.getElementById('itRenewalFileChip').innerHTML,
          dropdownHidden: document.getElementById('itRenewalCategoryDatalist').classList.contains('hidden'),
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.itRenewalName === '', 'itRenewalName phải về rỗng');
        assertTrue(state.itRenewalCategory === '', 'itRenewalCategory phải về rỗng');
        assertTrue(state.itRenewalVendor === '', 'itRenewalVendor phải về rỗng');
        assertTrue(state.itRenewalExpiryDate === '', 'itRenewalExpiryDate phải về rỗng');
        assertTrue(state.itRenewalFileValue === '', 'itRenewalFile input phải về rỗng');
        assertTrue(state.itRenewalFileChip === '', 'Chip itRenewalFile phải biến mất sau Làm Mới');
        assertTrue(state.dropdownHidden === true, 'Dropdown gợi ý itRenewalCategoryDatalist phải đóng lại sau Làm Mới');
      }
    );

    // ================= 26) VPP > Đăng Ký (vppRegItemsWrap, KHÔNG phải <form> thật) =================
    await check(
      'VPP Đăng Ký: KHÔNG phải <form> thật — "Làm Mới" đưa MỌI ô Số Lượng về đúng defaultValue (rỗng, vì chưa có nháp nào), không phải collapse dòng như Mua Sắm mà là bảng cố định theo danh mục',
      async () => {
        await page.evaluate(() => {
          DB.vppExcludedJobTitles = [];
          DB.vppPeriods = [{
            id: 993001, code: 'VPP-TEST-REG', name: 'Kỳ kiểm thử reset form (Đăng Ký)',
            startDate: '', endDate: '', status: 'OPEN',
            catalogItems: [
              { code: 'VPP001', name: 'Bút bi Thiên Long', origin: 'Việt Nam', unit: 'Cái', spec: 'Hộp 10 cây', price: 3000 },
              { code: 'VPP002', name: 'Giấy A4', origin: 'Việt Nam', unit: 'Ram', spec: '', price: 60000 }
            ],
            perPersonBudget: null, deptHeadcounts: {}, createdAt: new Date().toLocaleString('vi-VN')
          }];
          DB.vppRegistrations = [];
          switchTab('vpp'); setVppSubTab('REGISTER');
        });
        await page.selectOption('#vppRegPeriodSelect', '993001');
        await page.fill('#vppItemQty_0', '5');
        await page.fill('#vppItemQty_1', '2');
        await page.fill('#vppRegItemSearch', 'bút');
        const rowsVisibleBeforeReset = await page.locator('#vppRegItemsTableBody tr:not(.hidden)').count();
        assertTrue(rowsVisibleBeforeReset === 1, `Lọc theo "bút" phải chỉ còn 1 dòng hiện, thực tế ${rowsVisibleBeforeReset}`);

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#vppRegItemsWrap button[data-arg1="resetVppRegForm"]');
        const state = await page.evaluate(() => ({
          qty0: document.getElementById('vppItemQty_0').value,
          qty1: document.getElementById('vppItemQty_1').value,
          search: document.getElementById('vppRegItemSearch').value,
          rowsVisible: document.querySelectorAll('#vppRegItemsTableBody tr:not(.hidden)').length,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.qty0 === '', `Số Lượng dòng 1 phải về rỗng (chưa có nháp nào lưu), thực tế "${state.qty0}"`);
        assertTrue(state.qty1 === '', `Số Lượng dòng 2 phải về rỗng (chưa có nháp nào lưu), thực tế "${state.qty1}"`);
        assertTrue(state.search === '', 'Ô tìm mặt hàng phải về rỗng');
        assertTrue(state.rowsVisible === 2, `Bỏ lọc xong phải hiện lại đủ 2 dòng mặt hàng, thực tế ${state.rowsVisible}`);
      }
    );

    // ================= 27) VPP > Kỳ Đăng Ký > Tạo Kỳ Đăng Ký Mới (vppNewPeriodFormWrap, KHÔNG phải <form> thật) =================
    await check(
      'VPP Tạo Kỳ Đăng Ký Mới: chip file đơn vppCatalogFileInput (ĐÃ có data-op-change riêng đọc file), "Làm Mới" trắng form + tính LẠI bảng Nhân Sự Theo Phòng Ban theo số thật (không giữ số sửa tay)',
      async () => {
        await page.evaluate(() => { switchTab('vpp'); setVppSubTab('PERIODS'); });
        await page.fill('#vppNewPeriodName', 'Kỳ kiểm thử reset form (Tạo Kỳ)');
        await page.fill('#vppNewPeriodStart', '2027-01-01');
        await page.fill('#vppNewPeriodEnd', '2027-01-31');
        await page.fill('#vppNewPeriodBudget', '250.000');

        await page.setInputFiles('#vppCatalogFileInput', fakeFile('danh-muc.xlsx', 'noi dung xlsx danh muc', XLSX_MIME));
        await page.waitForFunction(() => {
          const t = document.getElementById('vppCatalogStatus').innerText;
          return t.includes('✅') || t.includes('⛔');
        });
        const chip = await page.locator('#vppCatalogFileChip').innerText();
        assertTrue(chip.includes('danh-muc.xlsx'), `Chip vppCatalogFileInput phải hiện tên file, thực tế: ${chip}`);
        const pendingBeforeReset = await page.evaluate(() => vppPendingCatalog);
        assertTrue(!!pendingBeforeReset, 'vppPendingCatalog phải đọc thành công tệp .xlsx thật trước khi Làm Mới (tiền đề bài test)');

        const firstHeadcountInput = page.locator('#vppDeptHeadcountBody .vpp-headcount-input').first();
        const originalHeadcount = await firstHeadcountInput.inputValue();
        await firstHeadcountInput.fill('999');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#vppNewPeriodFormWrap button[data-arg1="resetVppNewPeriodForm"]');
        const state = await page.evaluate(() => ({
          name: document.getElementById('vppNewPeriodName').value,
          start: document.getElementById('vppNewPeriodStart').value,
          end: document.getElementById('vppNewPeriodEnd').value,
          budget: document.getElementById('vppNewPeriodBudget').value,
          fileValue: document.getElementById('vppCatalogFileInput').value,
          fileChip: document.getElementById('vppCatalogFileChip').innerHTML,
          headcountFirst: document.querySelector('#vppDeptHeadcountBody .vpp-headcount-input')?.value,
          pendingCatalog: (typeof vppPendingCatalog === 'undefined') ? 'UNDEFINED' : vppPendingCatalog,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.name === '', 'vppNewPeriodName phải về rỗng');
        assertTrue(state.start === '', 'vppNewPeriodStart phải về rỗng');
        assertTrue(state.end === '', 'vppNewPeriodEnd phải về rỗng');
        assertTrue(state.budget === '100.000', `Ngân sách/người phải về lại mặc định 100.000, thực tế "${state.budget}"`);
        assertTrue(state.fileValue === '', 'vppCatalogFileInput phải về rỗng');
        assertTrue(state.fileChip === '', 'Chip vppCatalogFileInput phải biến mất sau Làm Mới');
        assertTrue(
          state.headcountFirst === originalHeadcount,
          `Bảng Nhân Sự Theo Phòng Ban phải TÍNH LẠI đúng số nhân sự thật đang hoạt động (${originalHeadcount}), không giữ số đã sửa tay "999", thực tế "${state.headcountFirst}"`
        );
        assertTrue(state.pendingCatalog === null, `vppPendingCatalog phải về null sau Làm Mới, thực tế ${JSON.stringify(state.pendingCatalog)}`);
      }
    );

    // ================= 28) Ngân Sách > Ngân Sách Phê Duyệt (budgetEntryFormWrap_PLAN, KHÔNG phải <form> thật) =================
    await check(
      'Ngân Sách (Phê Duyệt): KHÔNG phải <form> thật — CHƯA có nháp nào lưu -> "Làm Mới" gọi lại onBudgetEntryPeriodChange() có sẵn, collapse bảng hạng mục về ĐÚNG 1 dòng trống theo mẫu cột',
      async () => {
        // seedRecord() ghi CẢ VÀO state.collections.budgetPeriods (mock backend đọc lúc validate lưu
        // nháp qua server thật, xem lib/createValidation.js budgetEntries.extraValidate) LẪN window.DB
        // (giao diện hiển thị) — kịch bản PLAN này không round-trip server (chỉ collapse dòng ở client)
        // nên đáng lẽ không bắt buộc, nhưng seed đủ cho nhất quán với kịch bản ACTUAL ngay bên dưới.
        await h.seedRecord('budgetPeriods', {
          id: 994001, code: 'NS-TEST-PLAN', name: 'Kỳ kiểm thử reset form (Phê Duyệt)',
          startTime: '', endTime: '2030-12-31T23:59', status: 'OPEN',
          deptScope: { all: true, depts: [] }, templateId: null, createdAt: new Date().toLocaleString('vi-VN')
        });
        await page.evaluate(() => { switchTab('budget'); setBudgetSubTab('APPROVED'); });
        await page.selectOption('#budgetEntryPeriodSelect_PLAN', '994001');
        const rowsBefore = await page.locator('#budgetEntryLinesBody_PLAN tr[data-budget-line-idx]').count();
        assertTrue(rowsBefore === 1, `Phải có đúng 1 dòng trống mặc định khi chưa có nháp nào lưu, thực tế ${rowsBefore}`);
        await page.click('#budgetEntryAddRowBtn_PLAN');
        const rowsAfterAdd = await page.locator('#budgetEntryLinesBody_PLAN tr[data-budget-line-idx]').count();
        assertTrue(rowsAfterAdd === 2, `Sau khi thêm dòng phải có 2 dòng, thực tế ${rowsAfterAdd}`);
        await page.fill('#budgetEntryLinesBody_PLAN tr[data-budget-line-idx="0"] .budget-line-core[data-core-key="name"]', 'Hạng mục kiểm thử reset');
        await page.fill('#budgetEntryLinesBody_PLAN tr[data-budget-line-idx="0"] .budget-line-core[data-core-key="amount"]', '1000000');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#budgetEntryFormWrap_PLAN button[data-arg1="resetBudgetEntryFormPLAN"]');
        const state = await page.evaluate(() => ({
          rows: document.querySelectorAll('#budgetEntryLinesBody_PLAN tr[data-budget-line-idx]').length,
          name0: document.querySelector('#budgetEntryLinesBody_PLAN tr[data-budget-line-idx="0"] .budget-line-core[data-core-key="name"]')?.value,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.rows === 1, `Bảng hạng mục phải collapse lại về ĐÚNG 1 dòng trống (chưa có nháp lưu), thực tế ${state.rows}`);
        assertTrue(state.name0 === '', `Tên Hạng Mục dòng còn lại phải rỗng, thực tế "${state.name0}"`);
      }
    );

    // ================= 29) Ngân Sách > Ngân Sách Thực Hiện (budgetEntryFormWrap_ACTUAL, KHÔNG phải <form> thật) =================
    await check(
      'Ngân Sách (Thực Hiện): ĐÃ có nháp lưu trên server -> "Làm Mới" hoàn tác sửa dở CHƯA lưu (dòng mới thêm + sửa tên), nạp lại ĐÚNG giá trị đã lưu nháp (không collapse về rỗng)',
      async () => {
        // seedRecord() BẮT BUỘC ở kịch bản này (khác PLAN ở trên) — saveBudgetEntryDraft('ACTUAL') round-
        // trip THẬT qua mock backend (POST /api/create/budgetEntries), lib/createValidation.js đọc period
        // từ appData.budgetPeriods (= state.collections.budgetPeriods phía mock, KHÔNG phải window.DB
        // phía trình duyệt) — chỉ gán tay DB.budgetPeriods sẽ báo lỗi "Không tìm thấy kỳ ngân sách".
        await h.seedRecord('budgetPeriods', {
          id: 994002, code: 'NS-TEST-ACTUAL', name: 'Kỳ kiểm thử reset form (Thực Hiện)',
          startTime: '', endTime: '2030-12-31T23:59', status: 'OPEN',
          deptScope: { all: true, depts: [] }, templateId: null, createdAt: new Date().toLocaleString('vi-VN')
        });
        await page.evaluate(() => { switchTab('budget'); setBudgetSubTab('ACTUAL'); });
        await page.selectOption('#budgetEntryPeriodSelect_ACTUAL', '994002');
        await page.fill('#budgetEntryLinesBody_ACTUAL tr[data-budget-line-idx="0"] .budget-line-core[data-core-key="name"]', 'Hạng mục đã lưu nháp');
        await page.fill('#budgetEntryLinesBody_ACTUAL tr[data-budget-line-idx="0"] .budget-line-core[data-core-key="amount"]', '2000000');
        await page.evaluate(() => saveBudgetEntryDraft('ACTUAL'));
        await page.waitForFunction(() => budgetEntryFormDraftId['ACTUAL'] != null);

        // Sửa dở dang CHƯA lưu: đổi lại tên dòng đã lưu + thêm 1 dòng mới — đây là phần PHẢI MẤT khi Làm Mới.
        await page.click('#budgetEntryAddRowBtn_ACTUAL');
        const rowsBeforeReset = await page.locator('#budgetEntryLinesBody_ACTUAL tr[data-budget-line-idx]').count();
        assertTrue(rowsBeforeReset === 2, `Phải có 2 dòng (1 đã lưu + 1 mới thêm chưa lưu) trước khi Làm Mới, thực tế ${rowsBeforeReset}`);
        await page.fill('#budgetEntryLinesBody_ACTUAL tr[data-budget-line-idx="0"] .budget-line-core[data-core-key="name"]', 'Sửa dở CHƯA lưu');
        await page.fill('#budgetEntryLinesBody_ACTUAL tr[data-budget-line-idx="1"] .budget-line-core[data-core-key="name"]', 'Dòng mới thêm CHƯA lưu');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#budgetEntryFormWrap_ACTUAL button[data-arg1="resetBudgetEntryFormACTUAL"]');
        const state = await page.evaluate(() => ({
          rows: document.querySelectorAll('#budgetEntryLinesBody_ACTUAL tr[data-budget-line-idx]').length,
          name0: document.querySelector('#budgetEntryLinesBody_ACTUAL tr[data-budget-line-idx="0"] .budget-line-core[data-core-key="name"]')?.value,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.rows === 1, `Phải quay lại ĐÚNG số dòng đã LƯU NHÁP trên server (1 dòng), bỏ dòng mới thêm chưa lưu, thực tế ${state.rows}`);
        assertTrue(
          state.name0 === 'Hạng mục đã lưu nháp',
          `Dòng còn lại phải về ĐÚNG giá trị đã lưu nháp trên server ("Hạng mục đã lưu nháp"), không giữ sửa dở "Sửa dở CHƯA lưu", thực tế "${state.name0}"`
        );
      }
    );

    // ================= 30) Vận Hành > Đặt Hàng HO/Siêu Thị (operationOrderForm) =================
    await check(
      'Vận Hành > Đặt Hàng: chip file đơn voFile (ĐÃ có data-op-change riêng đọc PDF tự điền form), "Làm Mới" trắng form + collapse bảng hạng mục về ĐÚNG 1 dòng trống + mở lại khối "Chi Tiết Từ Phiếu Đặt Hàng" + sinh lại mã đơn hàng mới',
      async () => {
        // operationOrders/operationStoreOpenings/operationRepairs: không thuộc 3 module gốc dùng
        // _seed.js — bổ sung tay (renderOperationList() gọi .filter() thẳng lên DB.operation*, undefined
        // sẽ vỡ ngay khi switchTab('vanHanh') tự render danh sách).
        await page.evaluate(() => {
          DB.operationOrders = []; DB.operationStoreOpenings = []; DB.operationRepairs = [];
          switchTab('vanHanh');
        });
        await page.fill('#voTitle', 'Đặt hàng kiểm thử reset form');
        await page.fill('#voSupplier', 'Công ty TNHH Kiểm Thử');
        // Tệp KHÔNG phải PDF -> handleOperationOrderPdfUpload() chỉ đính kèm (gọi onSingleFileChosen()
        // hiện chip), KHÔNG tự đọc/điền form (nhánh đọc PDF thật đã có bộ test riêng
        // demo-operation-order-pdf-autofill.js, không lặp lại ở đây).
        await page.setInputFiles('#voFile', fakeFile('bao-gia.jpg', 'noi dung anh', 'image/jpeg'));
        const chip = await page.locator('#voFileChip').innerText();
        assertTrue(chip.includes('bao-gia.jpg'), `Chip voFile phải hiện tên file, thực tế: ${chip}`);

        // Thêm 2 dòng hạng mục (đã có sẵn 1 dòng mặc định khi vừa mở tab) -> 3 dòng, điền tên dòng đầu.
        await page.click('button[data-op="addOperationOrderItemRow"]');
        await page.click('button[data-op="addOperationOrderItemRow"]');
        const rowsBefore = await page.locator('#operationOrderItemsTableBody tr').count();
        assertTrue(rowsBefore === 3, `Phải có 3 dòng hạng mục trước khi Làm Mới, thực tế ${rowsBefore}`);
        await page.fill('#operationOrderItemsTableBody tr:nth-child(1) input[data-field="name"]', 'Bút bi kiểm thử');

        // Thu gọn khối "Chi Tiết Từ Phiếu Đặt Hàng" -> phải tự MỞ LẠI sau Làm Mới (mặc định mở).
        await page.click('button[data-op="toggleOperationOrderPoDetailsBox"]');
        const collapsedBeforeReset = await page.evaluate(() => document.getElementById('operationOrderPoDetailsBox').classList.contains('hidden'));
        assertTrue(collapsedBeforeReset === true, 'Khối Chi Tiết Từ Phiếu Đặt Hàng phải đang THU GỌN (tiền đề bài test)');

        const codeBeforeReset = await page.locator('#voCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'voCode phải tự sinh sẵn khi vừa mở tab');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#operationOrderForm button[data-arg1="resetOperationOrderForm"]');
        const state = await page.evaluate(() => ({
          voTitle: document.getElementById('voTitle').value,
          voSupplier: document.getElementById('voSupplier').value,
          voCode: document.getElementById('voCode').value,
          voFileValue: document.getElementById('voFile').value,
          voFileChip: document.getElementById('voFileChip').innerHTML,
          itemRows: document.querySelectorAll('#operationOrderItemsTableBody tr').length,
          itemName0: document.querySelector('#operationOrderItemsTableBody tr td input[data-field="name"]')?.value,
          poBoxHidden: document.getElementById('operationOrderPoDetailsBox').classList.contains('hidden'),
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.voTitle === '', 'voTitle phải về rỗng');
        assertTrue(state.voSupplier === '', 'voSupplier phải về rỗng');
        assertTrue(/^HCRC-[^-]+-DH-/.test(state.voCode), `voCode phải được sinh lại đúng khuôn HCRC-<mã phòng>-DH-..., thực tế "${state.voCode}"`);
        assertTrue(state.voFileValue === '', 'voFile input phải về rỗng');
        assertTrue(state.voFileChip === '', 'Chip voFile phải biến mất sau Làm Mới');
        assertTrue(state.itemRows === 1, `Bảng hạng mục phải collapse về ĐÚNG 1 dòng trống, thực tế ${state.itemRows}`);
        assertTrue(state.itemName0 === '', `Tên hàng dòng còn lại phải rỗng, thực tế "${state.itemName0}"`);
        assertTrue(state.poBoxHidden === false, 'Khối Chi Tiết Từ Phiếu Đặt Hàng phải MỞ LẠI (trạng thái mặc định) sau Làm Mới');
      }
    );

    // ================= 31) Vận Hành > Siêu Thị > Mở Mới (operationStoreOpenForm) =================
    await check(
      'Vận Hành > Mở Mới Siêu Thị: chip file đơn vsoFile, "Làm Mới" trắng form (kể cả field "Ngân Sách Phê Duyệt — Danh Mục Đầu Tư" — ĐÃ đổi tên/chỉ còn 1 field ngân sách duy nhất từ VHST-1) + sinh lại mã đề xuất mới',
      async () => {
        await page.evaluate(() => {
          DB.operationOrders = []; DB.operationStoreOpenings = []; DB.operationRepairs = [];
          switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN');
        });
        await page.fill('#vsoStoreName', 'Siêu thị kiểm thử reset form');
        await page.fill('#vsoAddress', '123 Đường Kiểm Thử, Quận 1');
        await page.fill('#vsoArea', '500');
        await page.fill('#vsoApprovedBudget', '5000000000');
        await page.fill('#vsoOpenDate', '2027-01-01');
        await page.fill('#vsoPersonInChargeInput', 'Người phụ trách kiểm thử');
        await page.fill('#vsoNote', 'Ghi chú kiểm thử reset form.');
        await page.setInputFiles('#vsoFile', fakeFile('khao-sat.pdf', 'noi dung', 'application/pdf'));
        const chip = await page.locator('#vsoFileChip').innerText();
        assertTrue(chip.includes('khao-sat.pdf'), `Chip vsoFile phải hiện tên file, thực tế: ${chip}`);

        const codeBeforeReset = await page.locator('#vsoCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'vsoCode phải tự sinh sẵn khi vừa mở tab');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#operationStoreOpenForm button[data-arg1="resetOperationStoreOpenForm"]');
        const state = await page.evaluate(() => ({
          vsoStoreName: document.getElementById('vsoStoreName').value,
          vsoAddress: document.getElementById('vsoAddress').value,
          vsoArea: document.getElementById('vsoArea').value,
          vsoApprovedBudget: document.getElementById('vsoApprovedBudget').value,
          vsoOpenDate: document.getElementById('vsoOpenDate').value,
          vsoPersonInChargeInput: document.getElementById('vsoPersonInChargeInput').value,
          vsoNote: document.getElementById('vsoNote').value,
          vsoCode: document.getElementById('vsoCode').value,
          vsoFileValue: document.getElementById('vsoFile').value,
          vsoFileChip: document.getElementById('vsoFileChip').innerHTML,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.vsoStoreName === '', 'vsoStoreName phải về rỗng');
        assertTrue(state.vsoAddress === '', 'vsoAddress phải về rỗng');
        assertTrue(state.vsoArea === '', 'vsoArea phải về rỗng');
        assertTrue(state.vsoApprovedBudget === '', `Ngân Sách Phê Duyệt — Danh Mục Đầu Tư phải về rỗng, thực tế "${state.vsoApprovedBudget}"`);
        assertTrue(state.vsoOpenDate === '', 'vsoOpenDate phải về rỗng');
        assertTrue(state.vsoPersonInChargeInput === '', 'vsoPersonInChargeInput phải về rỗng');
        assertTrue(state.vsoNote === '', 'vsoNote phải về rỗng');
        assertTrue(/^HCRC-[^-]+-MMST-/.test(state.vsoCode), `vsoCode phải được sinh lại đúng khuôn HCRC-<mã phòng>-MMST-..., thực tế "${state.vsoCode}"`);
        assertTrue(state.vsoFileValue === '', 'vsoFile input phải về rỗng');
        assertTrue(state.vsoFileChip === '', 'Chip vsoFile phải biến mất sau Làm Mới');
      }
    );

    // ================= 32) Vận Hành > Siêu Thị > Sửa Chữa (operationRepairForm) =================
    await check(
      'Vận Hành > Sửa Chữa Siêu Thị: chip file đơn vrFile, "Làm Mới" trắng form (kể cả field "Ngân Sách Phê Duyệt — Danh Mục Đầu Tư") + sinh lại mã đề xuất mới',
      async () => {
        await page.evaluate(() => {
          DB.operationOrders = []; DB.operationStoreOpenings = []; DB.operationRepairs = [];
          switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('REPAIR');
        });
        await page.fill('#vrStoreName', 'Siêu thị cần sửa kiểm thử');
        await page.fill('#vrTitle', 'Sửa hệ thống điện kiểm thử reset form');
        await page.fill('#vrApprovedBudget', '20000000');
        await page.fill('#vrSupplier', 'Công ty thi công kiểm thử');
        await page.fill('#vrPersonInChargeInput', 'Người phụ trách kiểm thử');
        await page.fill('#vrDescription', 'Mô tả kiểm thử reset form.');
        await page.setInputFiles('#vrFile', fakeFile('hien-trang.jpg', 'noi dung anh', 'image/jpeg'));
        const chip = await page.locator('#vrFileChip').innerText();
        assertTrue(chip.includes('hien-trang.jpg'), `Chip vrFile phải hiện tên file, thực tế: ${chip}`);

        const codeBeforeReset = await page.locator('#vrCode').inputValue();
        assertTrue(codeBeforeReset !== '', 'vrCode phải tự sinh sẵn khi vừa mở tab');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#operationRepairForm button[data-arg1="resetOperationRepairForm"]');
        const state = await page.evaluate(() => ({
          vrStoreName: document.getElementById('vrStoreName').value,
          vrTitle: document.getElementById('vrTitle').value,
          vrApprovedBudget: document.getElementById('vrApprovedBudget').value,
          vrSupplier: document.getElementById('vrSupplier').value,
          vrPersonInChargeInput: document.getElementById('vrPersonInChargeInput').value,
          vrDescription: document.getElementById('vrDescription').value,
          vrCode: document.getElementById('vrCode').value,
          vrFileValue: document.getElementById('vrFile').value,
          vrFileChip: document.getElementById('vrFileChip').innerHTML,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.vrStoreName === '', 'vrStoreName phải về rỗng');
        assertTrue(state.vrTitle === '', 'vrTitle phải về rỗng');
        assertTrue(state.vrApprovedBudget === '', `Ngân Sách Phê Duyệt — Danh Mục Đầu Tư phải về rỗng, thực tế "${state.vrApprovedBudget}"`);
        assertTrue(state.vrSupplier === '', 'vrSupplier phải về rỗng');
        assertTrue(state.vrPersonInChargeInput === '', 'vrPersonInChargeInput phải về rỗng');
        assertTrue(state.vrDescription === '', 'vrDescription phải về rỗng');
        assertTrue(/^HCRC-[^-]+-SCST-/.test(state.vrCode), `vrCode phải được sinh lại đúng khuôn HCRC-<mã phòng>-SCST-..., thực tế "${state.vrCode}"`);
        assertTrue(state.vrFileValue === '', 'vrFile input phải về rỗng');
        assertTrue(state.vrFileChip === '', 'Chip vrFile phải biến mất sau Làm Mới');
      }
    );

    // ================= 33) Nhân Sự > Onboarding/Offboarding v2 > Onboarding (hrpOnboardingForm) =================
    // Bản v1 (hrOnboardingForm/hrOnbXxx, 2 sub-tab hrOnboardingRequests/hrOffboardingRequests) đã bị GỠ
    // HẲN, thay bằng mô hình quy trình có checklist (module-hrlifecycle.js, DB.hrProcesses/
    // DB.hrTaskTemplates) — form Tạo Mới đổi tên hrpOnboardingForm/hrpOnbXxx, chỉ hiện sau khi bấm
    // "+ Tạo Onboarding" (showHrCreateForm('ONBOARDING'), #btnHrpCreateOnboarding).
    await check(
      'Nhân Sự > Onboarding: "Làm Mới" đưa cascading picker Vị Trí về ĐÚNG mặc định HO (dropdown Chức Danh re-populate lại đúng danh mục HO, KHÔNG còn sót option Siêu Thị vừa chọn) + trắng toàn bộ form',
      async () => {
        // hrProcesses/hrTaskTemplates: không thuộc 3 module gốc — bổ sung tay. DB.stores/DB.storeJobTitles
        // seed thêm nội dung THẤY ĐƯỢC để phân biệt rõ với DB.jobTitles (HO) khi kiểm tra cascading.
        await page.evaluate(() => {
          DB.hrProcesses = []; DB.hrTaskTemplates = [];
          DB.stores = ['Siêu Thị Quận 7'];
          DB.storeJobTitles = [{ label: 'Nhân viên bán hàng' }, { label: 'Quản lý ca' }];
          switchTab('hrLifecycle');
        });
        await page.click('#btnHrpCreateOnboarding');

        const initialState = await page.evaluate(() => ({
          posType: document.getElementById('hrpOnbPosType').value,
          deptWrapHidden: document.getElementById('hrpOnbDeptWrap').classList.contains('hidden'),
          storeWrapHidden: document.getElementById('hrpOnbStoreWrap').classList.contains('hidden'),
          jobTitleOptions: Array.from(document.getElementById('hrpOnbJobTitle').options).map(o => o.value)
        }));
        assertTrue(initialState.posType === 'HO', `Vị Trí mặc định phải là HO khi vừa mở form, thực tế "${initialState.posType}"`);
        assertTrue(initialState.deptWrapHidden === false, 'Khối Phòng Ban phải HIỆN khi đang ở HO (tiền đề bài test)');
        assertTrue(initialState.storeWrapHidden === true, 'Khối Siêu Thị phải ẨN khi đang ở HO (tiền đề bài test)');
        assertTrue(!initialState.jobTitleOptions.includes('Nhân viên bán hàng'), 'Chức Danh lúc đầu (HO) KHÔNG được có option Siêu Thị (tiền đề bài test)');

        // Chuyển sang Siêu Thị -> cascading phải đổi đúng: ẩn Phòng Ban, hiện Siêu Thị, Chức Danh đổi
        // sang danh mục Siêu Thị, Email chuyển bắt buộc.
        await page.selectOption('#hrpOnbPosType', 'STORE');
        const storeState = await page.evaluate(() => ({
          deptWrapHidden: document.getElementById('hrpOnbDeptWrap').classList.contains('hidden'),
          storeWrapHidden: document.getElementById('hrpOnbStoreWrap').classList.contains('hidden'),
          jobTitleOptions: Array.from(document.getElementById('hrpOnbJobTitle').options).map(o => o.value),
          emailRequired: document.getElementById('hrpOnbEmail').required
        }));
        assertTrue(storeState.deptWrapHidden === true, 'Khối Phòng Ban phải ẨN khi đang ở Siêu Thị (tiền đề bài test)');
        assertTrue(storeState.storeWrapHidden === false, 'Khối Siêu Thị phải HIỆN khi đang ở Siêu Thị (tiền đề bài test)');
        assertTrue(storeState.jobTitleOptions.includes('Nhân viên bán hàng') && storeState.jobTitleOptions.includes('Quản lý ca'), `Chức Danh phải đổi sang danh mục Siêu Thị, thực tế ${JSON.stringify(storeState.jobTitleOptions)}`);
        assertTrue(storeState.emailRequired === true, 'Email phải chuyển bắt buộc khi đang ở Siêu Thị (tiền đề bài test)');

        await page.fill('#hrpOnbEmployeeCode', 'NV9999');
        await page.fill('#hrpOnbFullName', 'Nguyễn Văn Kiểm Thử');
        await page.selectOption('#hrpOnbStore', 'Siêu Thị Quận 7');
        await page.selectOption('#hrpOnbJobTitle', 'Nhân viên bán hàng');
        await page.fill('#hrpOnbEmail', 'test@company.com');
        await page.fill('#hrpOnbPhone', '0912345678');
        await page.fill('#hrpOnbStartDate', '2026-10-01');
        await page.fill('#hrpOnbNote', 'Ghi chú kiểm thử reset form.');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#hrpOnboardingForm button[data-arg1="resetHrpOnboardingForm"]');
        const state = await page.evaluate(() => ({
          posType: document.getElementById('hrpOnbPosType').value,
          deptWrapHidden: document.getElementById('hrpOnbDeptWrap').classList.contains('hidden'),
          storeWrapHidden: document.getElementById('hrpOnbStoreWrap').classList.contains('hidden'),
          jobTitleOptions: Array.from(document.getElementById('hrpOnbJobTitle').options).map(o => o.value),
          emailRequired: document.getElementById('hrpOnbEmail').required,
          employeeCode: document.getElementById('hrpOnbEmployeeCode').value,
          fullName: document.getElementById('hrpOnbFullName').value,
          email: document.getElementById('hrpOnbEmail').value,
          phone: document.getElementById('hrpOnbPhone').value,
          startDate: document.getElementById('hrpOnbStartDate').value,
          note: document.getElementById('hrpOnbNote').value,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.posType === 'HO', `Vị Trí phải về ĐÚNG mặc định HO sau Làm Mới, thực tế "${state.posType}"`);
        assertTrue(state.deptWrapHidden === false, 'Khối Phòng Ban phải HIỆN lại sau Làm Mới (đã về HO)');
        assertTrue(state.storeWrapHidden === true, 'Khối Siêu Thị phải ẨN lại sau Làm Mới (đã về HO), KHÔNG được kẹt lại ở trạng thái Siêu Thị vừa chọn');
        assertTrue(!state.jobTitleOptions.includes('Nhân viên bán hàng'), `Chức Danh phải re-populate lại ĐÚNG danh mục HO (không còn sót option Siêu Thị "Nhân viên bán hàng"), thực tế ${JSON.stringify(state.jobTitleOptions)}`);
        assertTrue(state.emailRequired === false, 'Email phải hết bắt buộc sau khi về lại HO');
        assertTrue(state.employeeCode === '', 'hrpOnbEmployeeCode phải về rỗng');
        assertTrue(state.fullName === '', 'hrpOnbFullName phải về rỗng');
        assertTrue(state.email === '', 'hrpOnbEmail phải về rỗng');
        assertTrue(state.phone === '', 'hrpOnbPhone phải về rỗng');
        assertTrue(state.startDate === '', 'hrpOnbStartDate phải về rỗng');
        assertTrue(state.note === '', 'hrpOnbNote phải về rỗng');
      }
    );

    // ================= 34) Nhân Sự > Onboarding/Offboarding v2 > Offboarding (hrpOffboardingForm) =================
    // Bản v1 bắt buộc tích đủ 2 checkbox thủ tục bàn giao/chế độ trước khi mở nút gửi — bản v2 KHÔNG còn
    // 2 checkbox đó (checklist các việc cần làm giờ tự sinh SAU khi tạo quy trình, không phải điều kiện
    // TRƯỚC khi tạo) — nút gửi chỉ còn phụ thuộc đã chọn đúng nhân viên + nhập Ngày Nghỉ Việc
    // (updateHrpOffboardingSubmitState()).
    await check(
      'Nhân Sự > Offboarding: chọn nhân viên qua sdd-picker + nhập Ngày Nghỉ Việc -> nút gửi MỞ ra, "Làm Mới" xoá sạch sdd-picker (hidden username + info-box) + ngày nghỉ việc + Quản lý trực tiếp + khoá lại nút gửi (updateHrpOffboardingSubmitState() re-compute, KHÔNG dựa vào form.reset() tự bắn change)',
      async () => {
        await page.evaluate(() => {
          DB.hrProcesses = []; DB.hrTaskTemplates = [];
          switchTab('hrLifecycle');
        });
        await page.click('#btnHrpCreateOffboarding');

        // Chọn nhân viên qua sdd-picker — gọi thẳng resolveHrpOffboardingEmployeeInput() với nhãn ĐÚNG
        // khuôn "Tên — Phòng ban (username)" (cùng khuôn resolveTrainingInstructorInput() ở
        // test-internal-training.js), khớp đúng user 'admin' đã seed sẵn ở tests/_seed.js.
        await page.evaluate(() => {
          document.getElementById('hrpOffbEmployeeInput').value = 'Quản Trị Viên — Ban Giám Đốc (admin)';
          resolveHrpOffboardingEmployeeInput(document.getElementById('hrpOffbEmployeeInput').value);
        });
        const pickedState = await page.evaluate(() => ({
          username: document.getElementById('hrpOffbEmployeeUsername').value,
          infoHidden: document.getElementById('hrpOffbEmployeeInfo').classList.contains('hidden'),
          infoText: document.getElementById('hrpOffbEmployeeInfo').innerText,
          btnDisabled: document.getElementById('btnSubmitHrpOffboarding').disabled
        }));
        assertTrue(pickedState.username === 'admin', `Phải khớp đúng username 'admin' (tiền đề bài test), thực tế "${pickedState.username}"`);
        assertTrue(pickedState.infoHidden === false, 'Info-box nhân viên phải HIỆN sau khi chọn đúng (tiền đề bài test)');
        assertTrue(pickedState.infoText.includes('Quản Trị Viên'), `Info-box phải hiện đúng tên nhân viên, thực tế: ${pickedState.infoText}`);
        assertTrue(pickedState.btnDisabled === true, 'Nút gửi vẫn phải KHOÁ (chưa nhập Ngày Nghỉ Việc) — tiền đề bài test');

        await page.fill('#hrpOffbLastWorkingDate', '2026-12-31');
        await page.check('#hrpOffbIsManagerial');
        await page.fill('#hrpOffbReason', 'Lý do kiểm thử reset form.');
        const readyState = await page.evaluate(() => document.getElementById('btnSubmitHrpOffboarding').disabled);
        assertTrue(readyState === false, 'Nút gửi phải MỞ RA khi đã đủ nhân viên + ngày nghỉ việc (tiền đề bài test)');

        await page.evaluate(() => { window.__confirmCalls = []; });
        await page.click('#hrpOffboardingForm button[data-arg1="resetHrpOffboardingForm"]');
        const state = await page.evaluate(() => ({
          employeeInput: document.getElementById('hrpOffbEmployeeInput').value,
          employeeUsername: document.getElementById('hrpOffbEmployeeUsername').value,
          infoHidden: document.getElementById('hrpOffbEmployeeInfo').classList.contains('hidden'),
          infoHtml: document.getElementById('hrpOffbEmployeeInfo').innerHTML,
          lastWorkingDate: document.getElementById('hrpOffbLastWorkingDate').value,
          isManagerialChecked: document.getElementById('hrpOffbIsManagerial').checked,
          directManagerUsername: document.getElementById('hrpOffbDirectManagerUsername').value,
          reason: document.getElementById('hrpOffbReason').value,
          btnDisabled: document.getElementById('btnSubmitHrpOffboarding').disabled,
          confirmCalls: window.__confirmCalls.length
        }));
        assertTrue(state.confirmCalls === 1, `Form đang có dữ liệu -> phải hỏi xác nhận đúng 1 lần, thực tế ${state.confirmCalls}`);
        assertTrue(state.employeeInput === '', 'hrpOffbEmployeeInput phải về rỗng');
        assertTrue(state.employeeUsername === '', 'hrpOffbEmployeeUsername (hidden) phải về rỗng');
        assertTrue(state.infoHidden === true, 'Info-box nhân viên phải ẨN lại sau Làm Mới');
        assertTrue(state.infoHtml === '', 'Info-box nhân viên phải trắng nội dung sau Làm Mới');
        assertTrue(state.lastWorkingDate === '', 'hrpOffbLastWorkingDate phải về rỗng');
        assertTrue(state.isManagerialChecked === false, 'Checkbox "đang giữ vị trí quản lý" phải bỏ tick');
        assertTrue(state.directManagerUsername === '', 'hrpOffbDirectManagerUsername (hidden) phải về rỗng');
        assertTrue(state.reason === '', 'hrpOffbReason phải về rỗng');
        assertTrue(state.btnDisabled === true, 'Nút gửi phải KHOÁ LẠI sau Làm Mới (updateHrpOffboardingSubmitState() re-compute)');
      }
    );

  } finally {
    const total = results.length;
    const passed = results.filter((r) => r.ok).length;
    console.log('');
    console.log(`==== ${passed}/${total} scenario(s) passed${total - passed ? `, ${total - passed} FAILED` : ''} ====`);
    if (total - passed > 0) process.exitCode = 1;
    await h.stop();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
