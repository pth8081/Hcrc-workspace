'use strict';
// Regression test cho Đợt 2 mở rộng "Biểu Mẫu" (Thanh Toán/Ngân Sách/Báo Cáo Định Kỳ/Đồng Phục — 10
// tab mới: PAYMENT/BUDGET_PERIOD/BUDGET_TEMPLATE/REPORT_ENTRY/REPORT_PERIOD/UNIFORM_PERIOD/
// UNIFORM_ISSUE/UNIFORM_ADJUST_STOCK/UNIFORM_ADJUST_EMPLOYEE/UNIFORM_TRANSFER, xem
// CORE_FIELD_MANIFEST + FORM_TABS trong public/index.html). Cùng khuôn tests/test-forms-batch1.js.
//
// Không có backend SQL Server thật trong môi trường này — serve public/index.html tĩnh, boot Chromium
// thật (Playwright), set thẳng biến toàn cục DB/currentUser rồi gọi ĐÚNG các hàm sản xuất thật
// (switchFormTab/renderFormFieldsTable/editCoreField/addCustomField/applyCoreFieldCustomizations) —
// không giả lập lại logic ở bên ngoài.
//
// Kịch bản:
//   1. 10 tab mới có mặt trong renderFormTabsBar().
//   2. PAYMENT: sửa nhãn trường mặc định "paymentTitle" (nhánh <label> thật) -> hiện ngay trên form thật
//      (#paymentCreateForm).
//   3. BUDGET_PERIOD: sửa nhãn "budgetPeriodName" -> hiện đúng trên #budgetPeriodTemplateModal.
//   4. REPORT_PERIOD: sửa nhãn "prPeriodName" -> hiện đúng trên #prSubPeriods.
//   5. UNIFORM_ISSUE: sửa nhãn "uniformIssueEmployee" -> hiện đúng trên #uniformSubStore, không lem
//      sang uniformIssueCode liền kề.
//   6. UNIFORM_ADJUST_EMPLOYEE: sửa nhãn "uniformAdjEmpReason" -> hiện đúng, không lem sang
//      uniformAdjStockReason (2 field trùng gợi ý "Lý Do" ở 2 form khác nhau — kiểm tra riêng biệt).
//   7. Không có nút/thao tác XOÁ nào cho trường mặc định (renderFormFieldsTable() chỉ có "✏️ Sửa" +
//      badge "Mặc định", không có deleteCustomField) ở cả 10 tab mới.
//   8. applyAllCoreFieldCustomizations() (gọi 1 lần sau load thật) áp đúng cho MỌI coreKey mới.
//
// Run: node server/tests/test-forms-batch2.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8953;

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
  'PAYMENT', 'BUDGET_PERIOD', 'BUDGET_TEMPLATE', 'REPORT_ENTRY', 'REPORT_PERIOD',
  'UNIFORM_PERIOD', 'UNIFORM_ISSUE', 'UNIFORM_ADJUST_STOCK', 'UNIFORM_ADJUST_EMPLOYEE', 'UNIFORM_TRANSFER'
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
      licenseTypes: [], itTicketCategories: [],
      paymentRequests: [], contracts: [], officeReqs: [],
      budgetTemplates: [], budgetPeriods: [], budgetEntries: [],
      reportPeriods: [], reportEntries: [],
      uniformCatalog: [], uniformPeriods: [], uniformIssuances: [],
      formTemplates: {}, systemLogs: [], users: []
    });

    currentUser = { username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Hành Chính', perms: { admin: true } };

    // ---------- 1) 10 tab mới có mặt ở màn Biểu Mẫu (tab+sub-tab: nhóm chỉ 1 form thì nút cấp 1 CHÍNH
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

    // ---------- 2) PAYMENT: sửa nhãn paymentTitle -> hiện ngay trên #paymentCreateForm ----------
    editDefaultFieldLabel('PAYMENT', 'PAYMENT', 'paymentTitle', 'Nội Dung Thanh Toán (ĐÃ SỬA)');
    {
      const input = document.getElementById('paymentTitle');
      const labelEl = input.closest('div')?.querySelector('label');
      check('PAYMENT: <label> thật trên #paymentCreateForm đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Nội Dung Thanh Toán (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
      const override = getCoreFieldOverrides('PAYMENT').paymentTitle;
      check('PAYMENT: override label đã lưu vào DB.formTemplates.__core__PAYMENT',
        override && override.label === 'Nội Dung Thanh Toán (ĐÃ SỬA)', JSON.stringify(override));
    }

    // ---------- 3) BUDGET_PERIOD: sửa nhãn budgetPeriodName ----------
    editDefaultFieldLabel('BUDGET_PERIOD', 'BUDGET_PERIOD', 'budgetPeriodName', 'Tên Kỳ NS (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('budgetPeriodName').closest('div')?.querySelector('label');
      check('BUDGET_PERIOD: <label> thật trên form Tạo Kỳ Ngân Sách đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tên Kỳ NS (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
      // Trường liền kề budgetPeriodEndTime KHÔNG bị ảnh hưởng
      const otherLabel = document.getElementById('budgetPeriodEndTime').closest('div')?.querySelector('label');
      check('BUDGET_PERIOD: sửa 1 trường KHÔNG làm lem nhãn sang budgetPeriodEndTime liền kề',
        !!otherLabel && otherLabel.textContent.includes('Hạn Chót Lập') && !otherLabel.textContent.includes('ĐÃ SỬA'),
        otherLabel ? otherLabel.textContent : 'NO LABEL FOUND');
    }

    // ---------- 4) REPORT_PERIOD: sửa nhãn prPeriodName ----------
    editDefaultFieldLabel('REPORT_PERIOD', 'REPORT_PERIOD', 'prPeriodName', 'Tên Kỳ BC (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('prPeriodName').closest('div')?.querySelector('label');
      check('REPORT_PERIOD: <label> thật trên #prSubPeriods đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Tên Kỳ BC (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
    }

    // ---------- 5) UNIFORM_ISSUE: sửa nhãn uniformIssueEmployee, không lem sang uniformIssueCode ----------
    editDefaultFieldLabel('UNIFORM_ISSUE', 'UNIFORM_ISSUE', 'uniformIssueEmployee', 'Nhân Viên Nhận (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('uniformIssueEmployee').closest('div')?.querySelector('label');
      check('UNIFORM_ISSUE: <label> thật trên #uniformSubStore đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Nhân Viên Nhận (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
      const otherLabel = document.getElementById('uniformIssueCode').closest('div')?.querySelector('label');
      check('UNIFORM_ISSUE: sửa 1 trường KHÔNG làm lem nhãn sang uniformIssueCode liền kề',
        !!otherLabel && otherLabel.textContent.includes('Mã Phiếu') && !otherLabel.textContent.includes('ĐÃ SỬA'),
        otherLabel ? otherLabel.textContent : 'NO LABEL FOUND');
    }

    // ---------- 6) UNIFORM_ADJUST_EMPLOYEE: sửa nhãn uniformAdjEmpReason, không lem sang
    //             uniformAdjStockReason (2 form "Lý Do" khác nhau, tránh nhầm lẫn giữa 2 coreKey) ----------
    editDefaultFieldLabel('UNIFORM_ADJUST_EMPLOYEE', 'UNIFORM_ADJUST_EMPLOYEE', 'uniformAdjEmpReason', 'Lý Do Thu Hồi (ĐÃ SỬA)');
    {
      const labelEl = document.getElementById('uniformAdjEmpReason').closest('div')?.querySelector('label');
      check('UNIFORM_ADJUST_EMPLOYEE: <label> thật trên form "Thu Hồi Từ Nhân Viên" đã đổi đúng nhãn mới',
        !!labelEl && labelEl.textContent.includes('Lý Do Thu Hồi (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
      const otherLabel = document.getElementById('uniformAdjStockReason').closest('div')?.querySelector('label');
      check('UNIFORM_ADJUST_EMPLOYEE: sửa uniformAdjEmpReason KHÔNG làm lem sang uniformAdjStockReason (form "Báo Hỏng/Hủy Từ Kho" khác biệt)',
        !!otherLabel && otherLabel.textContent.includes('Lý Do') && !otherLabel.textContent.includes('ĐÃ SỬA'),
        otherLabel ? otherLabel.textContent : 'NO LABEL FOUND');
    }

    // ---------- 7) Không có nút/thao tác XOÁ nào cho trường mặc định ở cả 10 tab mới ----------
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

    // ---------- 8) applyAllCoreFieldCustomizations() áp đúng cho MỌI coreKey mới (kể cả tab chưa từng
    //             switchFormTab tới trong bài này) ----------
    applyAllCoreFieldCustomizations();
    check('applyAllCoreFieldCustomizations(): #paymentTitle vẫn giữ nhãn đã sửa sau khi áp lại toàn bộ',
      document.getElementById('paymentTitle').closest('div').querySelector('label').textContent.includes('ĐÃ SỬA'));
    check('applyAllCoreFieldCustomizations(): #uniformAdjEmpReason vẫn giữ nhãn đã sửa sau khi áp lại toàn bộ',
      document.getElementById('uniformAdjEmpReason').closest('div').querySelector('label').textContent.includes('ĐÃ SỬA'));

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
