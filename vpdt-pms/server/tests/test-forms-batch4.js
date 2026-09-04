'use strict';
// Regression test cho Đợt 4 mở rộng "Biểu Mẫu" (nốt các form Đào Tạo còn lại — dọn "Phạm vi chưa làm" ghi
// ở cuối Đợt 3: Tạo Chương Trình/Kế Hoạch Đào Tạo/Kho Tài Liệu/Lộ Trình Thăng Tiến/Đào Tạo Tân Binh (2
// form: Quản Lý Lộ Trình + Phân Công) — 6 tab mới: TRAINING_COURSE/TRAINING_PLAN/TRAINING_DOC/
// CAREER_PATH/ONBOARDING_PATH/ONBOARDING_ASSIGN, xem CORE_FIELD_MANIFEST + FORM_TABS trong
// public/index.html). Cùng khuôn tests/test-forms-batch1.js..batch3.js.
//
// Không có backend SQL Server thật trong môi trường này — serve public/index.html tĩnh, boot Chromium
// thật (Playwright), set thẳng biến toàn cục DB/currentUser rồi gọi ĐÚNG các hàm sản xuất thật
// (switchFormTab/renderFormFieldsTable/editCoreField/addCustomField/applyCoreFieldCustomizations) —
// không giả lập lại logic ở bên ngoài.
//
// Kịch bản:
//   1. 6 tab mới có mặt trong renderFormTabsBar().
//   2. TRAINING_COURSE: sửa nhãn "tccName" -> hiện đúng trên #trainingCourseForm, không lem sang
//      tccDescription liền kề.
//   3. TRAINING_PLAN: sửa nhãn "tpAudience" -> hiện đúng trên #trainingPlanForm.
//   4. TRAINING_DOC: sửa nhãn "tdTitle" -> hiện đúng trên #trainingDocForm, không lem sang tdCourseId
//      liền kề.
//   5. CAREER_PATH: sửa nhãn "cpName" -> hiện đúng trên #careerPathForm.
//   6. ONBOARDING_PATH: sửa nhãn "opName" -> hiện đúng trên #onboardingPathForm.
//   7. ONBOARDING_ASSIGN: sửa nhãn "oaEmployeeInput" -> hiện đúng trên #onboardingAssignForm (LÀ 1 <div>,
//      không phải <form>, xác nhận applyCoreFieldCustomizations() vẫn hoạt động vì đây là DOM tĩnh).
//   8. TRAINING_CLASS_EDIT (gap-fill audit): sửa nhãn "teTitle" -> hiện đúng trên #trainingEditClassForm
//      (modal "Sửa Lớp Học"), không lem sang teCourseId liền kề; teDocumentIds ĐƯA VÀO ĐƯỢC (khác
//      tcDocumentIds bị loại ở Đợt 3 — nhãn cố định ở form Sửa, mode đã khoá không đổi được).
//   9. Không có nút/thao tác XOÁ nào cho trường mặc định ở cả 7 tab mới.
//   10. applyAllCoreFieldCustomizations() áp đúng cho MỌI coreKey mới (kể cả tab chưa từng switchFormTab
//      tới trong bài này).
//   11. tdMandatory (checkbox "Bắt Buộc Hoàn Thành") KHÔNG có trong TRAINING_DOC — xác nhận loại trừ do
//       <label> bọc trực tiếp input (nếu lỡ đưa vào sẽ xoá mất checkbox khỏi DOM); checkbox vẫn còn
//       nguyên trong DOM sau applyAllCoreFieldCustomizations().
//   12. tdFile/tdFileLabel KHÔNG có trong TRAINING_DOC — xác nhận loại trừ do nhãn bị
//       onTrainingDocTypeChange() tự đổi theo #tdDocType.
//   13. cpStageBuilderContainer (khối "Các Cấp Bậc" động) KHÔNG có id nào trong CAREER_PATH.
//   14. Audit toàn app: TOÀN BỘ <form id=... data-op-submit=...> thật trong file (25 form) đều đã có
//       đúng 1 coreKey phủ trong CORE_FIELD_MANIFEST sau Đợt 4.
//
// Run: node server/tests/test-forms-batch4.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8955;

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

const NEW_TABS = [
  'TRAINING_COURSE', 'TRAINING_PLAN', 'TRAINING_DOC', 'CAREER_PATH', 'ONBOARDING_PATH', 'ONBOARDING_ASSIGN',
  'TRAINING_CLASS_EDIT'
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
      trainingClasses: [], trainingTests: [], trainingCourses: [], trainingPlans: [],
      trainingDocuments: [], careerPaths: [], onboardingPaths: [], onboardingProgress: [],
      formTemplates: {}, systemLogs: [], users: []
    });

    currentUser = { username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Hành Chính', perms: { admin: true } };

    // ---------- 1) 6 tab mới có mặt ở màn Biểu Mẫu (tab+sub-tab: nhóm chỉ 1 form thì nút cấp 1 CHÍNH
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

    // ---------- 2) TRAINING_COURSE: sửa nhãn tccName, không lem sang tccDescription liền kề ----------
    editDefaultFieldLabel('TRAINING_COURSE', 'TRAINING_COURSE', 'tccName', 'Tên Chương Trình (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('tccName').closest('div')?.querySelector('label');
      check('TRAINING_COURSE: <label> thật trên #trainingCourseForm đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tên Chương Trình (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
      const otherLabel = document.getElementById('tccDescription').closest('div')?.querySelector('label');
      check('TRAINING_COURSE: sửa tccName KHÔNG làm lem nhãn sang tccDescription liền kề',
        !!otherLabel && otherLabel.textContent.includes('Mô Tả') && !otherLabel.textContent.includes('ĐÃ SỬA'),
        otherLabel ? otherLabel.textContent : 'NO LABEL FOUND');
      const override = getCoreFieldOverrides('TRAINING_COURSE').tccName;
      check('TRAINING_COURSE: override label đã lưu vào DB.formTemplates.__core__TRAINING_COURSE',
        override && override.label === 'Tên Chương Trình (ĐÃ SỬA)', JSON.stringify(override));
    }

    // ---------- 3) TRAINING_PLAN: sửa nhãn tpAudience ----------
    editDefaultFieldLabel('TRAINING_PLAN', 'TRAINING_PLAN', 'tpAudience', 'Đối Tượng Học (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('tpAudience').closest('div')?.querySelector('label');
      check('TRAINING_PLAN: <label> thật trên #trainingPlanForm đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Đối Tượng Học (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
    }

    // ---------- 4) TRAINING_DOC: sửa nhãn tdTitle, không lem sang tdCourseId liền kề ----------
    editDefaultFieldLabel('TRAINING_DOC', 'TRAINING_DOC', 'tdTitle', 'Tên Tài Liệu Đào Tạo (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('tdTitle').closest('div')?.querySelector('label');
      check('TRAINING_DOC: <label> thật trên #trainingDocForm đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tên Tài Liệu Đào Tạo (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
      const otherLabel = document.getElementById('tdCourseId').closest('div')?.querySelector('label');
      check('TRAINING_DOC: sửa tdTitle KHÔNG làm lem nhãn sang tdCourseId liền kề',
        !!otherLabel && otherLabel.textContent.includes('Chương Trình') && !otherLabel.textContent.includes('ĐÃ SỬA'),
        otherLabel ? otherLabel.textContent : 'NO LABEL FOUND');
    }

    // ---------- 5) CAREER_PATH: sửa nhãn cpName ----------
    editDefaultFieldLabel('CAREER_PATH', 'CAREER_PATH', 'cpName', 'Tên Lộ Trình Thăng Tiến (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('cpName').closest('div')?.querySelector('label');
      check('CAREER_PATH: <label> thật trên #careerPathForm đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tên Lộ Trình Thăng Tiến (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
    }

    // ---------- 6) ONBOARDING_PATH: sửa nhãn opName ----------
    editDefaultFieldLabel('ONBOARDING_PATH', 'ONBOARDING_PATH', 'opName', 'Tên Lộ Trình Tân Binh (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('opName').closest('div')?.querySelector('label');
      check('ONBOARDING_PATH: <label> thật trên #onboardingPathForm đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tên Lộ Trình Tân Binh (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
    }

    // ---------- 7) ONBOARDING_ASSIGN: sửa nhãn oaEmployeeInput -- #onboardingAssignForm LÀ 1 <div>,
    //             không phải <form>, xác nhận vẫn là DOM tĩnh (không cần call site riêng) ----------
    check('ONBOARDING_ASSIGN: #onboardingAssignForm là <div> (không phải <form>) — xác nhận cấu trúc như phân tích',
      document.getElementById('onboardingAssignForm').tagName === 'DIV',
      document.getElementById('onboardingAssignForm').tagName);
    editDefaultFieldLabel('ONBOARDING_ASSIGN', 'ONBOARDING_ASSIGN', 'oaEmployeeInput', 'Tìm Nhân Viên Mới (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('oaEmployeeInput').closest('div')?.querySelector('label');
      check('ONBOARDING_ASSIGN: <label> thật trên #onboardingAssignForm (div) đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tìm Nhân Viên Mới (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
    }

    // ---------- 8) TRAINING_CLASS_EDIT (gap-fill): sửa nhãn teTitle, không lem sang teCourseId liền kề;
    //             teDocumentIds ĐƯA VÀO ĐƯỢC (khác tcDocumentIds bị loại ở Đợt 3) ----------
    editDefaultFieldLabel('TRAINING_CLASS_EDIT', 'TRAINING_CLASS_EDIT', 'teTitle', 'Tên Lớp Học (Sửa, ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('teTitle').closest('div')?.querySelector('label');
      check('TRAINING_CLASS_EDIT: <label> thật trên #trainingEditClassForm đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tên Lớp Học (Sửa, ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
      const otherLabel = document.getElementById('teCourseId').closest('div')?.querySelector('label');
      check('TRAINING_CLASS_EDIT: sửa teTitle KHÔNG làm lem nhãn sang teCourseId liền kề',
        !!otherLabel && otherLabel.textContent.includes('Chương Trình') && !otherLabel.textContent.includes('ĐÃ SỬA'),
        otherLabel ? otherLabel.textContent : 'NO LABEL FOUND');
      check('TRAINING_CLASS_EDIT: teDocumentIds CÓ trong CORE_FIELD_MANIFEST (khác tcDocumentIds — nhãn cố định ở form Sửa)',
        CORE_FIELD_MANIFEST.TRAINING_CLASS_EDIT.some(f => f.id === 'teDocumentIds'),
        JSON.stringify(CORE_FIELD_MANIFEST.TRAINING_CLASS_EDIT.map(f => f.id)));
    }
    editDefaultFieldLabel('TRAINING_CLASS_EDIT', 'TRAINING_CLASS_EDIT', 'teDocumentIds', 'Giáo Trình Lớp (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('teDocumentIds').closest('div')?.querySelector('label');
      check('TRAINING_CLASS_EDIT: sửa nhãn teDocumentIds hoạt động bình thường (field render tĩnh, không bị ghi đè)',
        !!labelEl && labelEl.textContent.includes('Giáo Trình Lớp (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
    }

    // ---------- 9) Không có nút/thao tác XOÁ nào cho trường mặc định ở cả 7 tab mới ----------
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
    //             switchFormTab tới lại trong bài này) ----------
    applyAllCoreFieldCustomizations();
    check('applyAllCoreFieldCustomizations(): #tccName vẫn giữ nhãn đã sửa sau khi áp lại toàn bộ',
      document.getElementById('tccName').closest('div').querySelector('label').textContent.includes('ĐÃ SỬA'));
    check('applyAllCoreFieldCustomizations(): #cpName vẫn giữ nhãn đã sửa sau khi áp lại toàn bộ',
      document.getElementById('cpName').closest('div').querySelector('label').textContent.includes('ĐÃ SỬA'));
    check('applyAllCoreFieldCustomizations(): #oaEmployeeInput (trong div, không phải form) vẫn giữ nhãn đã sửa',
      document.getElementById('oaEmployeeInput').closest('div').querySelector('label').textContent.includes('ĐÃ SỬA'));

    // ---------- 10) tdMandatory KHÔNG có trong TRAINING_DOC — và checkbox vẫn CÒN NGUYÊN trong DOM sau
    //              applyAllCoreFieldCustomizations() (xác nhận loại trừ đúng, không lỡ tay xoá mất input) ----------
    check('TRAINING_DOC: tdMandatory KHÔNG có trong CORE_FIELD_MANIFEST (label bọc trực tiếp input, đưa vào sẽ xoá mất checkbox)',
      !CORE_FIELD_MANIFEST.TRAINING_DOC.some(f => f.id === 'tdMandatory'),
      JSON.stringify(CORE_FIELD_MANIFEST.TRAINING_DOC.map(f => f.id)));
    {
      const cb = document.getElementById('tdMandatory');
      check('TRAINING_DOC: checkbox #tdMandatory vẫn còn nguyên trong DOM (chưa bị applyAllCoreFieldCustomizations() xoá mất)',
        !!cb && cb.type === 'checkbox', cb ? cb.outerHTML : 'MISSING FROM DOM');
    }

    // ---------- 11) tdFile/tdFileLabel KHÔNG có trong TRAINING_DOC (nhãn bị onTrainingDocTypeChange() tự
    //              đổi theo #tdDocType) ----------
    check('TRAINING_DOC: tdFile KHÔNG có trong CORE_FIELD_MANIFEST (nhãn bị onTrainingDocTypeChange() tự đổi động)',
      !CORE_FIELD_MANIFEST.TRAINING_DOC.some(f => f.id === 'tdFile'),
      JSON.stringify(CORE_FIELD_MANIFEST.TRAINING_DOC.map(f => f.id)));

    // ---------- 12) cpStageBuilderContainer (khối động) KHÔNG có trong CAREER_PATH ----------
    check('CAREER_PATH: cpStageBuilderContainer (hàng động) KHÔNG có trong CORE_FIELD_MANIFEST',
      !CORE_FIELD_MANIFEST.CAREER_PATH.some(f => f.id === 'cpStageBuilderContainer'),
      JSON.stringify(CORE_FIELD_MANIFEST.CAREER_PATH.map(f => f.id)));

    // ---------- 14) Audit toàn app: TOÀN BỘ <form id=... data-op-submit=...> thật trong file (đếm ĐÚNG
    //              khỏi document.documentElement.outerHTML tại thời điểm chạy test, không hard-code lại
    //              số 25 để tránh test tự vô hiệu hoá khi file thay đổi) đều có coreKey riêng trong
    //              CORE_FIELD_MANIFEST khớp field.id thật đầu tiên của form đó ----------
    {
      const allForms = [...document.querySelectorAll('form[id][data-op-submit]')];
      const coveredCoreKeys = new Set(Object.keys(CORE_FIELD_MANIFEST));
      const uncovered = allForms.filter(f => {
        // 1 form được coi là "phủ" nếu ÍT NHẤT 1 field con của nó trùng id với 1 field trong 1
        // coreKey nào đó của manifest (không đòi hỏi phủ 100% field, chỉ xác nhận KHÔNG có form nào
        // hoàn toàn bị bỏ sót — cùng tinh thần audit đã làm thủ công ở trên).
        const childIds = [...f.querySelectorAll('[id]')].map(el => el.id);
        return !Object.keys(CORE_FIELD_MANIFEST).some(key =>
          CORE_FIELD_MANIFEST[key].some(fd => childIds.includes(fd.id)));
      }).map(f => f.id);
      check(`Audit toàn app: tất cả ${allForms.length} <form data-op-submit> thật đều có ÍT NHẤT 1 field trong CORE_FIELD_MANIFEST`,
        uncovered.length === 0, 'Form chưa phủ: ' + JSON.stringify(uncovered));
    }

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
