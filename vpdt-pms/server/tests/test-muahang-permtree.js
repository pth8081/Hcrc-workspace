'use strict';
// Regression: wiring "Mua Hàng > BAS" vào Nghiệp Vụ + Báo Cáo tổng hợp + cây phân quyền (v23.30) —
// CLAUDE.md bắt buộc mọi module mới có collection riêng phải có mặt ở cả 3 nơi này trong CÙNG đợt merge.
// Cùng hạ tầng test với tests/demo-muahang-module.js (xem tests/README.md) — serve public/index.html
// tĩnh, mở Chromium (Playwright) thật, KHÔNG cần backend/DB thật cho các kiểm tra thuần cấu hình/round-
// trip form này.
//
// Run: node server/tests/test-muahang-permtree.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8969;

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
  let jsErrors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => jsErrors.push(String(e)));

    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

    results = await page.evaluate(async () => {
      const results = [];
      function check(name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

      // ---------- Nghiệp Vụ ----------
      const nvGroup = NGHIEP_VU_NAV.find(g => g.group === 'Mua Hàng');
      check('NGHIEP_VU_NAV: có nhóm "Mua Hàng" với entry muaHang', !!nvGroup && nvGroup.items.some(it => it.key === 'muaHang'));
      check('NGHIEP_VU_DOCS: có entry muaHang với flow đầy đủ', !!(NGHIEP_VU_DOCS.muaHang && NGHIEP_VU_DOCS.muaHang.flow && NGHIEP_VU_DOCS.muaHang.flow.chain.length > 0));

      // ---------- Báo Cáo tổng hợp ----------
      check('REPORT_NAV_TREE: có entry muaHang', REPORT_NAV_TREE.some(n => n.key === 'muaHang' || (n.children || []).some(c => c.key === 'muaHang')));
      check('REPORT_KEY_ACCESS_FN: muaHang -> canViewPurchasingReportClient', REPORT_KEY_ACCESS_FN.muaHang === 'canViewPurchasingReportClient');
      check('REPORT_MODULE_CONFIGS: có entry muaHang với getRecords/extraRows', typeof REPORT_MODULE_CONFIGS.muaHang?.getRecords === 'function' && typeof REPORT_MODULE_CONFIGS.muaHang?.extraRows === 'function');

      // isReportKeyVisible() phải tôn trọng access fn thật — user không có rebateViewReport thì mục ẩn,
      // có rồi thì hiện (mirror đúng cách checklist đã kiểm chứng trước đó).
      const userNoPerm = { perms: {} };
      const userWithPerm = { perms: { rebateViewReport: true } };
      currentUser = userNoPerm;
      check('isReportKeyVisible(muaHang) = false khi không có rebateViewReport', isReportKeyVisible('muaHang') === false);
      currentUser = userWithPerm;
      check('isReportKeyVisible(muaHang) = true khi có rebateViewReport', isReportKeyVisible('muaHang') === true);
      currentUser = null;

      // ---------- Widget "Mở Thêm Mục/Tab" tự động liệt kê muaHang (data-driven từ 2 mảng trên) ----------
      document.body.insertAdjacentHTML('beforeend', '<div id="__mhTestMultiSelectHost"><div id="uNghiepVuExtraKeysMultiSelect"></div><div id="uReportExtraKeysMultiSelect"></div></div>');
      await renderNVReportExtraKeysWidgets({});
      // renderMultiSelectDropdown() lưu danh sách item gốc trên chính phần tử DOM (container._gmsItems),
      // KHÔNG render sẵn ra innerHTML (chỉ hiện khi gõ tìm — xem gmsFilter()/renderDropdown() ở core.js)
      // — đọc thẳng property này thay vì soi innerHTML.
      const nvItems = document.getElementById('uNghiepVuExtraKeysMultiSelect')._gmsItems || [];
      const reportItems = document.getElementById('uReportExtraKeysMultiSelect')._gmsItems || [];
      check('Widget "Mở Thêm Mục Nghiệp Vụ" tự liệt kê mục Mua Hàng', nvItems.some(it => it.value === 'muaHang'), JSON.stringify(nvItems.map(it => it.value)));
      check('Widget "Mở Thêm Tab Báo Cáo" tự liệt kê tab Mua Hàng', reportItems.some(it => it.value === 'muaHang'), JSON.stringify(reportItems.map(it => it.value)));

      // ---------- Cây phân quyền: 5 checkbox mới tồn tại + round-trip đúng ----------
      const ids = ['pRebateTermManage', 'pRebateTermActivate', 'pRebateReconcile', 'pRebateApprove', 'pRebateViewReport'];
      check('Cả 5 checkbox quyền Mua Hàng đều tồn tại trong DOM (khối 25 cây phân quyền)', ids.every(id => !!document.getElementById(id)));

      const fakePerms = {
        rebateTermManage: true, rebateTermActivate: false, rebateReconcile: true, rebateApprove: false, rebateViewReport: true
      };
      populatePermsForm(fakePerms);
      check('populatePermsForm() gán đúng giá trị ban đầu cho 5 checkbox',
        document.getElementById('pRebateTermManage').checked === true &&
        document.getElementById('pRebateTermActivate').checked === false &&
        document.getElementById('pRebateReconcile').checked === true &&
        document.getElementById('pRebateApprove').checked === false &&
        document.getElementById('pRebateViewReport').checked === true);

      document.getElementById('pRebateTermActivate').checked = true; // giả lập admin tick thêm 1 quyền
      const collected = collectPermsFromForm();
      check('collectPermsFromForm() đọc lại đúng 5 quyền Mua Hàng (round-trip)',
        collected.rebateTermManage === true && collected.rebateTermActivate === true &&
        collected.rebateReconcile === true && collected.rebateApprove === false &&
        collected.rebateViewReport === true,
        JSON.stringify({ rebateTermManage: collected.rebateTermManage, rebateTermActivate: collected.rebateTermActivate, rebateReconcile: collected.rebateReconcile, rebateApprove: collected.rebateApprove, rebateViewReport: collected.rebateViewReport }));

      // ---------- Badge cây phân quyền tự đếm đúng (generic, không cần wiring riêng) ----------
      refreshPermTreeBadges();
      const badgeText = document.getElementById('permTreeBadge_muahang')?.textContent || '';
      check('Badge khối 25 tự đếm đúng 4/5 quyền đã tick', badgeText === '4/5', badgeText);

      // ---------- defaultNewUserPerms(): user mới mặc định KHÔNG có quyền Mua Hàng nào ----------
      const fresh = defaultNewUserPerms();
      check('defaultNewUserPerms(): 5 quyền Mua Hàng đều mặc định false',
        fresh.rebateTermManage === false && fresh.rebateTermActivate === false && fresh.rebateReconcile === false &&
        fresh.rebateApprove === false && fresh.rebateViewReport === false);

      return { results };
    });
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.results.filter(r => !r.pass);
  results.results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
  if (jsErrors.length) console.log('JS errors (uncaught exceptions):', jsErrors);
  console.log(`\n${results.results.length - failed.length}/${results.results.length} passed.`);
  if (failed.length || jsErrors.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
