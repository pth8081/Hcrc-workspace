'use strict';
// Regression test cho việc dồn 43 tab phẳng của FORM_TABS (Đợt 1-4 mở rộng "Biểu Mẫu") vào 2 cấp
// tab+sub-tab theo nhóm (FORM_GROUPS), mirror khuôn WF_MODULE_CONFIG/renderWfSubmissionTypeTabs bên màn
// "Quy Trình & Phê Duyệt" — xem renderFormTabsBar()/renderFormSubTabsBar()/switchFormGroup()/
// switchFormTab() trong public/index.html.
//
// KHÔNG hard-code danh sách 43 key/20 nhóm ở đây — lặp trực tiếp qua FORM_TABS/FORM_GROUPS đọc được từ
// trang thật, để test luôn khớp dữ liệu hiện tại (thêm/bớt tab sau này không cần sửa file test).
//
// Kịch bản, với MỖI entry trong FORM_TABS:
//   1. Xác định nhóm chứa entry (t.group) có mặt trong FORM_GROUPS.
//   2. switchFormGroup(nhóm) — nhóm chỉ có 1 form phải nhảy THẲNG tới đúng form đó (activeFormTab ===
//      entry.key ngay), KHÔNG hiện hàng tab con; nhóm có >1 form phải HIỆN hàng tab con và chứa đủ nút
//      cho từng entry thuộc nhóm.
//   3. Với nhóm >1 form: switchFormTab(entry.key) qua đúng nút cấp 2 (data-op="switchFormTab") — xác
//      nhận activeFormTab cập nhật đúng, nhãn #lblActiveFormName khớp entry.label, và bảng trường
//      (#formFieldsTableBody) có xuất hiện (render không lỗi).
//   4. Sau khi đi hết TOÀN BỘ FORM_TABS, xác nhận mở lại màn (switchFormTab(activeFormTab) — mô phỏng
//      setSystemSubTab('FORM')) tự chọn đúng nhóm cấp 1 chứa activeFormTab hiện tại.
//
// Run: node server/tests/test-forms-nav-groups.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8958;

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

  results = await page.evaluate(async () => {
    const results = [];
    function check(name, cond, detail) {
      results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') });
    }

    window.alert = () => {};
    window.confirm = () => true;
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, version: 'v' + Date.now() }) });

    // DB tối thiểu — không cần dữ liệu nghiệp vụ thật, chỉ cần đủ để renderFormFieldsTable()/
    // applyCoreFieldCustomizations() không văng lỗi (các optionsKey rỗng vẫn hợp lệ).
    Object.assign(DB, {
      depts: ['Phòng Hành Chính'], cats: [], stores: [], jobTitles: ['Nhân Viên'],
      submissionTypes: [], contractTypes: [], carTypes: [], licenseTypes: [], itTicketCategories: [],
      trainingCategories: [], formTemplates: {}, systemLogs: [], users: []
    });
    currentUser = { username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Hành Chính', perms: { admin: true } };

    // ---------- 0) FORM_GROUPS/FORM_TABS toàn vẹn: mọi entry FORM_TABS trỏ về 1 group CÓ THẬT trong
    // FORM_GROUPS (không group mồ côi) ----------
    const groupKeys = new Set(FORM_GROUPS.map(g => g.key));
    const orphaned = FORM_TABS.filter(t => !groupKeys.has(t.group)).map(t => t.key);
    check('FORM_TABS: không có entry nào trỏ group không tồn tại trong FORM_GROUPS',
      orphaned.length === 0, JSON.stringify(orphaned));

    // ---------- Lặp qua TOÀN BỘ FORM_TABS (không hard-code danh sách) ----------
    for (const entry of FORM_TABS) {
      const group = entry.group;
      const entriesInGroup = getFormTabsInGroup(group);

      // Bấm nút cấp 1 của đúng nhóm chứa entry này.
      switchFormGroup(group);

      const subBar = document.getElementById('formSubTabsBar');
      const subVisible = subBar && !subBar.classList.contains('hidden');

      if (entriesInGroup.length === 1) {
        check(`[${entry.key}] nhóm "${group}" chỉ 1 form -> bấm nút cấp 1 vào THẲNG, không hiện tab con`,
          !subVisible && activeFormTab === entry.key,
          `subVisible=${subVisible} activeFormTab=${activeFormTab}`);
      } else {
        check(`[${entry.key}] nhóm "${group}" có ${entriesInGroup.length} form -> PHẢI hiện hàng tab con`,
          subVisible, `subVisible=${subVisible}`);
        const subHtml = subBar ? subBar.innerHTML : '';
        check(`[${entry.key}] có nút ở hàng tab con (data-arg0="${entry.key}")`,
          subHtml.includes(`data-arg0="${entry.key}"`), subHtml.slice(0, 200));

        // Bấm đúng nút cấp 2 của entry này (cùng hàm data-op="switchFormTab" thật gọi).
        switchFormTab(entry.key);
      }

      check(`[${entry.key}] activeFormTab đúng sau khi điều hướng`,
        activeFormTab === entry.key, `activeFormTab=${activeFormTab}`);

      const lbl = document.getElementById('lblActiveFormName');
      check(`[${entry.key}] #lblActiveFormName khớp label`,
        !!lbl && lbl.innerText === entry.label, lbl ? lbl.innerText : 'NO LABEL');

      const tbody = document.getElementById('formFieldsTableBody');
      check(`[${entry.key}] #formFieldsTableBody render không lỗi (có nội dung)`,
        !!tbody && tbody.innerHTML.trim().length > 0, tbody ? tbody.innerHTML.slice(0, 150) : 'NO TBODY');
    }

    // ---------- Mở lại màn (mô phỏng setSystemSubTab('FORM')) phải tự chọn đúng nhóm chứa
    // activeFormTab hiện tại (đang là entry CUỐI của FORM_TABS sau vòng lặp trên) ----------
    {
      const lastTab = activeFormTab;
      const expectedGroup = getFormGroupForTab(lastTab);
      activeFormGroup = '__DELIBERATELY_WRONG__'; // giả lập trạng thái cũ/sai trước khi mở lại màn
      switchFormTab(lastTab);
      check('Mở lại màn Biểu Mẫu: tự chọn đúng nhóm cấp 1 chứa activeFormTab hiện tại',
        activeFormGroup === expectedGroup, `activeFormGroup=${activeFormGroup} expected=${expectedGroup}`);
      const btn = document.getElementById(`btnFormGroup_${expectedGroup}`);
      check('Mở lại màn Biểu Mẫu: nút nhóm cấp 1 tương ứng được tô đậm (bg-rose-700)',
        !!btn && btn.className.includes('bg-rose-700'), btn ? btn.className : 'NO BTN');
    }

    return results;
  });
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
