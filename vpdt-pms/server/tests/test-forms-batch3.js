'use strict';
// Regression test cho Đợt 3 mở rộng "Biểu Mẫu" (Vận Hành/Đào Tạo/Tuyển Dụng + 3 gap-fill phát hiện qua
// audit BUSINESS_MODULES/FORM_TABS toàn app — ban đầu 11 tab mới, nay còn 10: OPERATION_ORDER/
// OPERATION_STORE_OPEN/OPERATION_REPAIR/OPERATION_WORK_ITEM/TRAINING_CLASS/TRAINING_TEST/
// RECRUITMENT_JOB/RECRUITMENT_REFERRAL/HR_FEEDBACK/IT_RENEWAL, xem CORE_FIELD_MANIFEST + FORM_TABS
// trong public/index.html — OPERATION_EXECUTION_PERIOD đã BỎ ở đợt "Danh Mục Đầu Tư + bỏ Tạo Kỳ", form
// "Tạo Kỳ Mới" mà nó tuỳ biến nhãn không còn tồn tại). Cùng khuôn tests/test-forms-batch1.js/batch2.js.
//
// Không có backend SQL Server thật trong môi trường này — serve public/index.html tĩnh, boot Chromium
// thật (Playwright), set thẳng biến toàn cục DB/currentUser rồi gọi ĐÚNG các hàm sản xuất thật
// (switchFormTab/renderFormFieldsTable/editCoreField/addCustomField/applyCoreFieldCustomizations) —
// không giả lập lại logic ở bên ngoài.
//
// Kịch bản:
//   1. 11 tab mới có mặt trong renderFormTabsBar().
//   2. OPERATION_ORDER: sửa nhãn trường mặc định "voTitle" -> hiện ngay trên #operationOrderForm.
//   3. OPERATION_WORK_ITEM: sửa nhãn "owiTitle" -> hiện đúng trên #operationWorkItemFormModal, không
//      lem sang owiDescription liền kề.
//   4. TRAINING_CLASS: sửa nhãn "tcTitle" -> hiện đúng trên #trainingClassForm, không lem sang
//      tcCategory liền kề.
//   5. RECRUITMENT_JOB: sửa nhãn "rjTitle" -> hiện đúng trên #recruitmentJobForm.
//   6. RECRUITMENT_REFERRAL: sửa nhãn "rrCandidateName" -> hiện đúng trên #recruitmentReferForm.
//   7. HR_FEEDBACK: sửa nhãn "hrFeedbackQuestion" -> hiện đúng trên #hrFeedbackForm.
//   8. IT_RENEWAL: sửa nhãn "itRenewalName" -> hiện đúng trên #itRenewalCreateForm (fallback placeholder,
//      không có <label> riêng), KHÔNG lem placeholder sang itRenewalVendor liền kề (xác nhận đã vá đúng
//      lỗi div-wrapping giống #licenseForm Đợt 1).
//   9. (đã bỏ — OPERATION_EXECUTION_PERIOD/"Tạo Kỳ Mới" không còn tồn tại, xem chú thích ở đầu file.)
//   10. Không có nút/thao tác XOÁ nào cho trường mặc định ở cả 10 tab mới.
//   11. applyAllCoreFieldCustomizations() (gọi 1 lần sau load thật) áp đúng cho MỌI coreKey mới.
//   12. TRAINING_CLASS: tcDocumentIds KHÔNG nằm trong CORE_FIELD_MANIFEST (loại trừ do xung đột với
//       onTrainingClassModeChange() tự đổi nhãn theo #tcMode).
//
// Run: node server/tests/test-forms-batch3.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8954;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

// 'OPERATION_EXECUTION_PERIOD' đã bỏ khỏi danh sách này (đợt "Danh Mục Đầu Tư + bỏ Tạo Kỳ" — coreKey +
// tab Biểu Mẫu tương ứng không còn tồn tại nữa, xem CORE_FIELD_MANIFEST/FORM_TABS ở public/index.html).
const NEW_TABS = [
  'OPERATION_ORDER', 'OPERATION_STORE_OPEN', 'OPERATION_REPAIR', 'OPERATION_WORK_ITEM',
  'TRAINING_CLASS', 'TRAINING_TEST', 'RECRUITMENT_JOB',
  'RECRUITMENT_REFERRAL', 'HR_FEEDBACK', 'IT_RENEWAL'
];

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let results;
  let pageErrors = [];
  try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });

  results = await page.evaluate(async (NEW_TABS) => {
    const results = [];
    function check(name, cond, detail) {
      results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') });
    }

    window.alert = () => {};
    window.confirm = () => true;

    window.fetch = async (url) => {
      if (String(url).startsWith('/api/data/')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, version: 'v' + Date.now() }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    Object.assign(DB, {
      depts: ['Phòng Hành Chính'], cats: [], stores: [], jobTitles: ['Nhân Viên'],
      submissionTypes: [], contractTypes: [], carTypes: [],
      licenseTypes: [], itTicketCategories: [], trainingCategories: ['Kỹ Năng Mềm'],
      operationOrders: [], operationStoreOpenings: [], operationRepairs: [], operationWorkItems: [],
      operationExecutionPeriods: [], itServiceRenewals: [],
      trainingClasses: [], trainingTests: [], trainingCourses: [],
      recruitmentJobs: [], recruitmentReferrals: [],
      formTemplates: {}, systemLogs: [], users: []
    });

    currentUser = { username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Hành Chính', perms: { admin: true } };

    // ---------- 1) 9 tab mới có mặt ở màn Biểu Mẫu (tab+sub-tab: nhóm chỉ 1 form thì nút cấp 1 CHÍNH
    // LÀ đích đến, nhóm >1 form thì phải thấy nút ở hàng tab con cấp 2 sau khi chọn đúng nhóm — xem
    // renderFormTabsBar()/renderFormSubTabsBar()/switchFormGroup()) ----------
    activeFormTab = 'SUBMISSION';
    switchFormTab('SUBMISSION');
    NEW_TABS.forEach(key => {
      const group = getFormGroupForTab(key);
      switchFormGroup(group);
      const entries = getFormTabsInGroup(group);
      if (entries.length > 1) {
        const subBar = document.getElementById('formSubTabsBar').innerHTML;
        check(`FORM_TABS: tab "${key}" có nút ở hàng tab con (nhóm ${group} có ${entries.length} form)`,
          subBar.includes(`data-arg0="${key}"`), subBar.slice(0, 300));
      } else {
        const bar = document.getElementById('formTabsBar').innerHTML;
        check(`FORM_TABS: tab "${key}" có nút cấp 1 (nhóm ${group} chỉ 1 form, vào thẳng)`,
          bar.includes(`data-arg0="${group}"`) && activeFormTab === key, bar.slice(0, 300));
      }
    });

    // ---------- Helper: mô phỏng đúng luồng UI thật ----------
    function editDefaultFieldLabel(tabKey, coreKey, fieldId, newLabel) {
      activeFormTab = tabKey;
      switchFormTab(tabKey);
      editCoreField(coreKey, fieldId);
      document.getElementById('fldLabel').value = newLabel;
      addCustomField({ preventDefault() {} });
    }

    // ---------- 2) OPERATION_ORDER: sửa nhãn voTitle -> hiện ngay trên #operationOrderForm ----------
    editDefaultFieldLabel('OPERATION_ORDER', 'OPERATION_ORDER', 'voTitle', 'Tiêu Đề Đơn Hàng (ĐÃ SỬA)');
    {
      const input = document.getElementById('voTitle');
      const labelEl = input.closest('div')?.querySelector('label');
      check('OPERATION_ORDER: <label> thật trên #operationOrderForm đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tiêu Đề Đơn Hàng (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
      const override = getCoreFieldOverrides('OPERATION_ORDER').voTitle;
      check('OPERATION_ORDER: override label đã lưu vào DB.formTemplates.__core__OPERATION_ORDER',
        override && override.label === 'Tiêu Đề Đơn Hàng (ĐÃ SỬA)', JSON.stringify(override));
    }

    // ---------- 3) OPERATION_WORK_ITEM: sửa nhãn owiTitle, không lem sang owiDescription ----------
    editDefaultFieldLabel('OPERATION_WORK_ITEM', 'OPERATION_WORK_ITEM', 'owiTitle', 'Tên CV Thực Hiện (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('owiTitle').closest('div')?.querySelector('label');
      check('OPERATION_WORK_ITEM: <label> thật trên #operationWorkItemFormModal đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tên CV Thực Hiện (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
      const otherLabel = document.getElementById('owiDescription').closest('div')?.querySelector('label');
      check('OPERATION_WORK_ITEM: sửa owiTitle KHÔNG làm lem nhãn sang owiDescription liền kề',
        !!otherLabel && otherLabel.textContent.includes('Mô Tả') && !otherLabel.textContent.includes('ĐÃ SỬA'),
        otherLabel ? otherLabel.textContent : 'NO LABEL FOUND');
    }

    // ---------- 4) TRAINING_CLASS: sửa nhãn tcTitle, không lem sang tcCategory liền kề ----------
    editDefaultFieldLabel('TRAINING_CLASS', 'TRAINING_CLASS', 'tcTitle', 'Tên Lớp (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('tcTitle').closest('div')?.querySelector('label');
      check('TRAINING_CLASS: <label> thật trên #trainingClassForm đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tên Lớp (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
      const otherLabel = document.getElementById('tcCategory').closest('div')?.querySelector('label');
      check('TRAINING_CLASS: sửa tcTitle KHÔNG làm lem nhãn sang tcCategory liền kề',
        !!otherLabel && otherLabel.textContent.includes('Loại Đào Tạo') && !otherLabel.textContent.includes('ĐÃ SỬA'),
        otherLabel ? otherLabel.textContent : 'NO LABEL FOUND');
    }

    // ---------- 5) RECRUITMENT_JOB: sửa nhãn rjTitle ----------
    editDefaultFieldLabel('RECRUITMENT_JOB', 'RECRUITMENT_JOB', 'rjTitle', 'Tên Vị Trí Tuyển (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('rjTitle').closest('div')?.querySelector('label');
      check('RECRUITMENT_JOB: <label> thật trên #recruitmentJobForm đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tên Vị Trí Tuyển (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
    }

    // ---------- 6) RECRUITMENT_REFERRAL: sửa nhãn rrCandidateName ----------
    editDefaultFieldLabel('RECRUITMENT_REFERRAL', 'RECRUITMENT_REFERRAL', 'rrCandidateName', 'Tên Ứng Viên (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('rrCandidateName').closest('div')?.querySelector('label');
      check('RECRUITMENT_REFERRAL: <label> thật trên #recruitmentReferForm đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tên Ứng Viên (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
    }

    // ---------- 7) HR_FEEDBACK: sửa nhãn hrFeedbackQuestion ----------
    editDefaultFieldLabel('HR_FEEDBACK', 'HR_FEEDBACK', 'hrFeedbackQuestion', 'Câu Hỏi Của Bạn (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('hrFeedbackQuestion').closest('div')?.querySelector('label');
      check('HR_FEEDBACK: <label> thật trên #hrFeedbackForm đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Câu Hỏi Của Bạn (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
    }

    // ---------- 8) IT_RENEWAL: sửa nhãn itRenewalName (fallback placeholder), không lem sang
    //             itRenewalVendor liền kề -- xác nhận đã vá đúng lỗi div-wrapping ----------
    editDefaultFieldLabel('IT_RENEWAL', 'IT_RENEWAL', 'itRenewalName', 'Tên Dịch Vụ CNTT (ĐÃ SỬA)');
    {
      const ph = document.getElementById('itRenewalName').placeholder;
      check('IT_RENEWAL: placeholder thật trên #itRenewalCreateForm đã đổi đúng (không có <label> riêng)',
        ph.includes('Tên Dịch Vụ CNTT (ĐÃ SỬA)'), ph);
      const otherPh = document.getElementById('itRenewalVendor').placeholder;
      check('IT_RENEWAL: sửa itRenewalName KHÔNG làm lem placeholder sang itRenewalVendor liền kề (đã vá lỗi div-wrapping)',
        otherPh === 'Nhà Cung Cấp', otherPh);
    }

    // ---------- 9) OPERATION_EXECUTION_PERIOD: BỎ HẲN (đợt "Danh Mục Đầu Tư + bỏ Tạo Kỳ") — coreKey +
    //             tab Biểu Mẫu tương ứng đã xoá khỏi CORE_FIELD_MANIFEST/FORM_TABS cùng với form
    //             "Tạo Kỳ Mới" ở public/index.html, không còn gì để kiểm ở đây nữa. ----------

    // ---------- 10) Không có nút/thao tác XOÁ nào cho trường mặc định ở cả 10 tab mới ----------
    NEW_TABS.forEach(key => {
      activeFormTab = key;
      switchFormTab(key);
      const html = document.getElementById('formFieldsTableBody').innerHTML;
      const coreIds = CORE_FIELD_MANIFEST[key].map(f => f.id);
      check(`Biểu Mẫu tab "${key}": đủ ${coreIds.length} trường mặc định, tất cả đều "Mặc định" (không xoá được)`,
        coreIds.every(id => html.includes(`>${id}<`)) &&
        (html.match(/Mặc định/g) || []).length === coreIds.length,
        html.slice(0, 300));
      check(`Biểu Mẫu tab "${key}": KHÔNG có nút deleteCustomField nào cho trường mặc định (chỉ có ✏️ Sửa)`,
        !html.includes('deleteCustomField'), 'found deleteCustomField in core-only tab');
    });

    // ---------- 9) applyAllCoreFieldCustomizations() áp đúng cho MỌI coreKey mới (kể cả tab chưa từng
    //             switchFormTab tới trong bài này) ----------
    applyAllCoreFieldCustomizations();
    check('applyAllCoreFieldCustomizations(): #voTitle vẫn giữ nhãn đã sửa sau khi áp lại toàn bộ',
      document.getElementById('voTitle').closest('div').querySelector('label').textContent.includes('ĐÃ SỬA'));
    check('applyAllCoreFieldCustomizations(): #rrCandidateName vẫn giữ nhãn đã sửa sau khi áp lại toàn bộ',
      document.getElementById('rrCandidateName').closest('div').querySelector('label').textContent.includes('ĐÃ SỬA'));

    // ---------- 10) tcDocumentIds bị loại trừ có chủ đích khỏi TRAINING_CLASS (xung đột với
    //              onTrainingClassModeChange() tự đổi nhãn theo #tcMode) ----------
    check('TRAINING_CLASS: tcDocumentIds KHÔNG có trong CORE_FIELD_MANIFEST (tránh xung đột nhãn động)',
      !CORE_FIELD_MANIFEST.TRAINING_CLASS.some(f => f.id === 'tcDocumentIds'),
      JSON.stringify(CORE_FIELD_MANIFEST.TRAINING_CLASS.map(f => f.id)));

    return results;
  }, NEW_TABS);
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.pass ? '' : ' -- ' + r.detail}`));
  if (pageErrors.length) {
    console.log('\n--- Page errors captured (informational, not counted as failure) ---');
    pageErrors.forEach(e => console.log(e));
  }
  console.log(`\n==== ${results.length - failed.length}/${results.length} scenario(s) passed ====`);
  if (failed.length > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
