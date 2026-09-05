'use strict';
// Regression test cho Đợt 1 mở rộng "Biểu Mẫu" (Công Việc/VPP/Giấy Phép/Hỗ Trợ IT — 5 tab mới:
// TASK/VPP/LICENSE/IT_PRICE/IT_TICKET, xem CORE_FIELD_MANIFEST + FORM_TABS trong public/index.html).
//
// Không có backend SQL Server thật trong môi trường này — cùng khuôn tests/test-doc.js: serve
// public/index.html tĩnh, boot Chromium thật (Playwright), set thẳng biến toàn cục DB/currentUser rồi
// gọi ĐÚNG các hàm sản xuất thật (switchFormTab/renderFormFieldsTable/editCoreField/addCustomField/
// applyCoreFieldCustomizations) — không giả lập lại logic ở bên ngoài.
//
// Kịch bản:
//   1. 5 tab mới (TASK/VPP/LICENSE/IT_PRICE/IT_TICKET) có mặt trong renderFormTabsBar().
//   2. TASK: sửa nhãn trường mặc định "taskTitleInput" qua editCoreField()+addCustomField() (mô phỏng
//      submit form Biểu Mẫu) -> nhãn MỚI hiện ngay trên form thật (#createTaskModal).
//   3. LICENSE: sửa nhãn trường mặc định "licenseIssuingAuthority" (có <label> riêng, khác nhánh
//      placeholder-fallback của taskTitleInput) -> nhãn MỚI hiện trên form thật (#licenseForm).
//   4. LICENSE: sửa danh sách lựa chọn (optionsKey 'licenseTypes') -> DB.licenseTypes cập nhật đúng.
//   5. IT_TICKET: sửa danh sách lựa chọn (optionsKey 'itTicketCategories', optionsIsKeyLabel:true) ->
//      giữ nguyên KEY ổn định, chỉ đổi LABEL -> populateItTicketCategorySelect() phản ánh đúng.
//   6. Không có nút/thao tác XOÁ nào cho trường mặc định (renderFormFieldsTable() chỉ có "✏️ Sửa" +
//      badge "Mặc định", không có deleteCustomField) ở cả 5 tab mới.
//
// Run: node server/tests/test-forms-batch1.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8952;

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

  // Ha tang: nap module theo cum, dot 7 (server/public/js/*.js) - test o day drive truc tiep ham

  // module-*.js qua page.evaluate()/click that thay vi luon di qua switchTab() nhu nguoi dung that,
  // nen chu dong nap TOAN BO cum module ngay tu dau (gia lap 1 phien da tung mo het moi tab) -

  // khong doi ket qua test nao (van goi dung ham that).
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  results = await page.evaluate(async () => {
    const results = [];
    function check(name, cond, detail) {
      results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') });
    }

    window.alert = () => {};
    window.confirm = () => true;

    // Bất kỳ ghi nào lên /api/data/<key> hay /api/log đều trả ok — bài này chỉ quan tâm hành vi CLIENT
    // (CORE_FIELD_MANIFEST/FORM_TABS/applyCoreFieldCustomizations), không kiểm server.
    window.fetch = async (url, opts) => {
      if (String(url).startsWith('/api/data/')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, version: 'v' + Date.now() }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    Object.assign(DB, {
      depts: ['Phòng Hành Chính'], cats: [], stores: [], jobTitles: ['Nhân Viên'],
      submissionTypes: [], contractTypes: [], carTypes: [],
      licenseTypes: ['Giấy phép kinh doanh', 'Giấy phép PCCC'],
      itTicketCategories: [
        { key: 'HARDWARE', label: '🖥️ Phần cứng' }, { key: 'SOFTWARE', label: '💿 Phần mềm' },
        { key: 'NETWORK', label: '🌐 Mạng / Internet' }, { key: 'ACCOUNT', label: '🔑 Tài khoản / Đăng nhập' },
        { key: 'OTHER', label: '❓ Khác' }
      ],
      formTemplates: {}, systemLogs: [], users: []
    });

    currentUser = { username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Hành Chính', perms: { admin: true } };

    // ---------- 1) 5 tab mới có mặt ở màn Biểu Mẫu (tab+sub-tab: nhóm chỉ 1 form thì nút cấp 1 CHÍNH
    // LÀ đích đến, nhóm >1 form thì phải thấy nút ở hàng tab con cấp 2 sau khi chọn đúng nhóm — xem
    // renderFormTabsBar()/renderFormSubTabsBar()/switchFormGroup()) ----------
    activeFormTab = 'SUBMISSION';
    switchFormTab('SUBMISSION');
    ['TASK', 'VPP', 'LICENSE', 'IT_PRICE', 'IT_TICKET'].forEach(key => {
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

    // ---------- Helper: mô phỏng đúng luồng UI thật (editCoreField -> điền form -> addCustomField) ----------
    function editDefaultFieldLabel(tabKey, coreKey, fieldId, newLabel) {
      activeFormTab = tabKey;
      switchFormTab(tabKey); // cùng hàm nút tab thật gọi — reset editingCoreField, render bảng
      editCoreField(coreKey, fieldId); // cùng hàm nút "✏️ Sửa" thật gọi — điền sẵn form phía trên
      document.getElementById('fldLabel').value = newLabel;
      addCustomField({ preventDefault() {} }); // cùng hàm submit form thật gọi
    }

    // ---------- 2) TASK: sửa nhãn taskTitleInput -> có mặt ngay trên form thật #createTaskModal ----------
    editDefaultFieldLabel('TASK', 'TASK', 'taskTitleInput', 'Tiêu Đề Công Việc (ĐÃ SỬA)');
    {
      const input = document.getElementById('taskTitleInput');
      const override = getCoreFieldOverrides('TASK').taskTitleInput;
      check('TASK: override label đã lưu vào DB.formTemplates.__core__TASK',
        override && override.label === 'Tiêu Đề Công Việc (ĐÃ SỬA)', JSON.stringify(override));
      check('TASK: input#taskTitleInput.required vẫn true (không đổi kiểu/bắt buộc ngoài ý muốn)',
        input.required === true);
    }

    // ---------- 3) LICENSE: sửa nhãn licenseIssueDate (nhánh <label> thật, không phải placeholder) ----------
    editDefaultFieldLabel('LICENSE', 'LICENSE', 'licenseIssueDate', 'Ngày Cấp Phép (ĐÃ SỬA)');
    {
      const input = document.getElementById('licenseIssueDate');
      const labelEl = input.closest('div')?.querySelector('label');
      check('LICENSE: <label> thật trên #licenseForm đã đổi đúng nhãn mới (không lem sang trường khác)',
        !!labelEl && labelEl.textContent.includes('Ngày Cấp Phép (ĐÃ SỬA)'),
        labelEl ? labelEl.textContent : 'NO LABEL FOUND');
      // Trường liền kề (licenseExpiryDate) KHÔNG bị ảnh hưởng — xác nhận closest('div') không lem sang label sai
      // (đây chính là lỗi thật đã sửa trước khi thêm optionsKey — form #licenseForm trước đó có nhiều input
      // là CON TRỰC TIẾP của <form>, không bọc riêng từng <div>, khiến closest('div') của các input đó
      // cùng trỏ về div NGOÀI CÙNG và vô tình đè lên <label> "Loại thao tác:" — đã bọc lại từng field
      // trong <div> riêng, xem diff #licenseForm).
      const otherLabel = document.getElementById('licenseExpiryDate').closest('div')?.querySelector('label');
      check('LICENSE: sửa 1 trường KHÔNG làm lem nhãn sang trường khác (licenseExpiryDate vẫn giữ nhãn gốc)',
        !!otherLabel && otherLabel.textContent.includes('Ngày Hết Hạn') && !otherLabel.textContent.includes('ĐÃ SỬA'),
        otherLabel ? otherLabel.textContent : 'NO LABEL FOUND');
      const opModeLabel = document.getElementById('licenseOpMode').closest('div')?.querySelector('label');
      check('LICENSE: nhãn "Loại thao tác:" ở đầu form KHÔNG bị lem/ghi đè bởi bất kỳ field nào ở trên',
        !!opModeLabel && opModeLabel.textContent.trim() === 'Loại thao tác:',
        opModeLabel ? opModeLabel.textContent : 'NO LABEL FOUND');
    }

    // ---------- 4) LICENSE: sửa optionsKey 'licenseTypes' (danh sách lựa chọn) ----------
    {
      activeFormTab = 'LICENSE';
      switchFormTab('LICENSE');
      editCoreField('LICENSE', 'licenseType');
      document.getElementById('fldOptions').value = 'Giấy phép kinh doanh, Giấy phép PCCC, Giấy phép ATTP mới';
      addCustomField({ preventDefault() {} });
      check('LICENSE: saveCoreFieldOptionsList() cập nhật đúng DB.licenseTypes (thêm giá trị mới)',
        DB.licenseTypes.length === 3 && DB.licenseTypes.includes('Giấy phép ATTP mới'),
        JSON.stringify(DB.licenseTypes));
    }

    // ---------- 5) IT_TICKET: sửa optionsKey 'itTicketCategories' (optionsIsKeyLabel:true — giữ nguyên key) ----------
    // saveCoreFieldOptionsList() (cùng cơ chế submissionTypes/internalNewsCategories đã dùng từ trước)
    // GIỮ NGUYÊN key theo NHÃN KHÔNG ĐỔI — chỉ sinh key mới cho nhãn thực sự mới trong danh sách gõ lại
    // (đây là hành vi THIẾT KẾ, không phải đổi TÊN 1 nhãn có sẵn tại chỗ — gõ lại nhãn khác chữ = coi như
    // 1 mục MỚI, cùng khuôn mọi optionsKey khác trong hệ thống).
    {
      activeFormTab = 'IT_TICKET';
      switchFormTab('IT_TICKET');
      editCoreField('IT_TICKET', 'itTicketCategory');
      // Giữ NGUYÊN VĂN 5 nhãn gốc (không đổi chữ nào) + thêm 1 mục MỚI ở cuối.
      document.getElementById('fldOptions').value = '🖥️ Phần cứng, 💿 Phần mềm, 🌐 Mạng / Internet, 🔑 Tài khoản / Đăng nhập, ❓ Khác, 🖨️ Máy in';
      addCustomField({ preventDefault() {} });
      const hw = DB.itTicketCategories.find(c => c.label === '🖥️ Phần cứng');
      const newOne = DB.itTicketCategories.find(c => c.label === '🖨️ Máy in');
      check('IT_TICKET: 5 nhãn GIỮ NGUYÊN chữ vẫn giữ đúng key ổn định (HARDWARE) — không mồ côi ticket cũ',
        !!hw && hw.key === 'HARDWARE', JSON.stringify(DB.itTicketCategories));
      check('IT_TICKET: thêm mục MỚI được sinh key riêng, không trùng 5 key cũ',
        !!newOne && newOne.key && !['HARDWARE', 'SOFTWARE', 'NETWORK', 'ACCOUNT', 'OTHER'].includes(newOne.key),
        JSON.stringify(newOne));
      check('IT_TICKET: cả 5 key gốc đều còn nguyên (SOFTWARE/NETWORK/ACCOUNT/OTHER)',
        ['SOFTWARE', 'NETWORK', 'ACCOUNT', 'OTHER'].every(k => DB.itTicketCategories.some(c => c.key === k)),
        JSON.stringify(DB.itTicketCategories));
      populateItTicketCategorySelect();
      const selHtml = document.getElementById('itTicketCategory').innerHTML;
      check('IT_TICKET: <select> thật trên #itTicketCreateForm đổ lại đúng cả nhãn cũ lẫn nhãn mới thêm',
        selHtml.includes('🖥️ Phần cứng') && selHtml.includes('🖨️ Máy in'), selHtml);
    }

    // ---------- 6) Không có nút/thao tác XOÁ nào cho trường mặc định ở cả 5 tab mới ----------
    ['TASK', 'VPP', 'LICENSE', 'IT_PRICE', 'IT_TICKET'].forEach(key => {
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

    // ---------- 7) applyAllCoreFieldCustomizations() (gọi 1 lần sau load thật) áp đúng cho MỌI coreKey mới ----------
    applyAllCoreFieldCustomizations();
    check('applyAllCoreFieldCustomizations(): #taskTitleInput vẫn giữ nhãn đã sửa sau khi áp lại toàn bộ',
      document.getElementById('taskTitleInput').closest('div').querySelector('label').textContent.includes('ĐÃ SỬA'));

    return results;
  });
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.pass ? '' : ' -- ' + r.detail}`));
  // Cùng khuôn tests/test-doc.js: chỉ LOG lỗi console/page (thường là noise mạng sandbox — font/favicon
  // ngoài bị chặn — không liên quan hành vi đang kiểm), KHÔNG tự động fail cả bài vì chúng.
  if (pageErrors.length) {
    console.log('\n--- Page errors captured (informational, not counted as failure) ---');
    pageErrors.forEach(e => console.log(e));
  }
  console.log(`\n==== ${results.length - failed.length}/${results.length} scenario(s) passed ====`);
  if (failed.length > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
