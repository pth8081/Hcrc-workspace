// server/tests/test-people-multiselect-dropdown-scope-b2.js
//
// Regression cho B2 (11/2026, QA module Vận Hành > DMĐT: "ô gợi ý Người Phụ Trách che mất bảng") —
// renderPeopleMultiSelect() (core.js) nhận thêm 1 tham số TUỲ CHỌN cuối `dropdownSizeClass` để nơi gọi
// tự giới hạn max-height/overflow/width khung dropdown gợi ý, mặc định giữ NGUYÊN y hệt khi không
// truyền gì (`max-h-40 overflow-y-auto w-full`). CHỈ lời gọi DMĐT "Thêm hạng mục"
// (estimateAssigneePicker_, renderOperationEstimateItemsTable() ở module-vanhanh.js) truyền giá trị
// thu hẹp `max-h-24 overflow-y-auto w-64`.
//
// Kiểm 2 việc:
//  1. DMĐT: dropdown có đúng class thu hẹp mới, KHÔNG còn class mặc định cũ.
//  2. 3 nơi gọi KHÁC (owiAssignedToPicker/Quản Lý Công Việc, groupMembersPicker/Ma Trận Phân Quyền,
//     fwdPeoplePicker/Chuyển Tiếp Xin Ý Kiến — không truyền dropdownSizeClass) hoàn toàn KHÔNG đổi:
//     vẫn đúng class mặc định cũ, và việc tìm+chọn người vẫn hoạt động bình thường (chip + checkbox ẩn).
//
// Chạy: node server/tests/test-people-multiselect-dropdown-scope-b2.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'
  }[ext] || 'application/octet-stream';
}
function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  const out = await page.evaluate(() => {
    const candidates = [
      { username: 'ttb', name: 'Trần Thị B', dept: 'Vận Hành' },
      { username: 'nva', name: 'Nguyễn Văn A', dept: 'Vận Hành' },
      { username: 'ltc', name: 'Lê Thị C', dept: 'Kế Toán' }
    ];
    function readDropdownClass(containerId) {
      const dd = document.querySelector(`#${containerId} [data-pms-dropdown]`);
      return dd ? dd.className : null;
    }
    function mkContainer(id) {
      const div = document.createElement('div');
      div.id = id;
      document.body.appendChild(div);
      return div;
    }
    function simulateSearchAndSelect(containerId, query, username) {
      const container = document.getElementById(containerId);
      const input = container.querySelector('[data-pms-search]');
      input.value = query;
      container._pmsRenderDropdown(query);
      const row = container.querySelector(`[data-pms-dropdown] [data-arg1="${username}"]`);
      if (row) pmsAdd(containerId, username);
      return { hiddenChecked: !!container.querySelector(`[data-pms-hidden] input[value="${username}"]:checked`) };
    }

    // ===== 1. DMĐT "Thêm hạng mục" — ĐÚNG lời gọi thật ở renderOperationEstimateItemsTable() =====
    mkContainer('estimateAssigneePicker_0');
    renderPeopleMultiSelect('estimateAssigneePicker_0', candidates, [], 'estimate-assignee', {}, 'max-h-24 overflow-y-auto w-64');
    const dmdtClass = readDropdownClass('estimateAssigneePicker_0');
    const dmdtSel = simulateSearchAndSelect('estimateAssigneePicker_0', 'Trần Thị B', 'ttb');

    // ===== 2. owiAssignedToPicker (Quản Lý Công Việc) — KHÔNG truyền dropdownSizeClass =====
    mkContainer('owiAssignedToPicker_test');
    renderPeopleMultiSelect('owiAssignedToPicker_test', candidates, [], 'owi-assignee', {});
    const owiClass = readDropdownClass('owiAssignedToPicker_test');
    const owiSel = simulateSearchAndSelect('owiAssignedToPicker_test', 'Nguyễn Văn A', 'nva');

    // ===== 3. groupMembersPicker (Ma Trận Phân Quyền) — KHÔNG truyền dropdownSizeClass =====
    mkContainer('groupMembersPicker_test');
    renderPeopleMultiSelect('groupMembersPicker_test', candidates, [], 'group-member-toggle', {});
    const gmpClass = readDropdownClass('groupMembersPicker_test');
    const gmpSel = simulateSearchAndSelect('groupMembersPicker_test', 'Lê Thị C', 'ltc');

    // ===== 4. fwdPeoplePicker (Chuyển Tiếp Xin Ý Kiến) — KHÔNG truyền dropdownSizeClass =====
    mkContainer('fwdPeoplePicker_test');
    renderPeopleMultiSelect('fwdPeoplePicker_test', candidates, [], 'fwdPersonCheckbox', {});
    const fwdClass = readDropdownClass('fwdPeoplePicker_test');
    const fwdSel = simulateSearchAndSelect('fwdPeoplePicker_test', 'Trần Thị B', 'ttb');

    const DEFAULT_CLASS_PARTS = ['max-h-40', 'overflow-y-auto', 'w-full'];
    const hasAll = (cls, parts) => parts.every(p => cls.split(' ').includes(p));

    return {
      dmdtClass, owiClass, gmpClass, fwdClass,
      dmdtHasNewScoped: hasAll(dmdtClass, ['max-h-24', 'overflow-y-auto', 'w-64']),
      dmdtNoOldDefault: !dmdtClass.split(' ').includes('max-h-40') && !dmdtClass.split(' ').includes('w-full'),
      owiUnchanged: hasAll(owiClass, DEFAULT_CLASS_PARTS),
      gmpUnchanged: hasAll(gmpClass, DEFAULT_CLASS_PARTS),
      fwdUnchanged: hasAll(fwdClass, DEFAULT_CLASS_PARTS),
      dmdtSelectWorks: dmdtSel.hiddenChecked,
      owiSelectWorks: owiSel.hiddenChecked,
      gmpSelectWorks: gmpSel.hiddenChecked,
      fwdSelectWorks: fwdSel.hiddenChecked
    };
  });

  record('DMĐT (estimateAssigneePicker_): dropdown nhận đúng class thu hẹp mới (max-h-24/w-64)', out.dmdtHasNewScoped, out.dmdtClass);
  record('DMĐT: dropdown KHÔNG còn mang class mặc định cũ (max-h-40/w-full)', out.dmdtNoOldDefault, out.dmdtClass);
  record('owiAssignedToPicker (Quản Lý Công Việc, không truyền tham số mới): dropdown GIỮ NGUYÊN mặc định cũ', out.owiUnchanged, out.owiClass);
  record('groupMembersPicker (Ma Trận Phân Quyền, không truyền tham số mới): dropdown GIỮ NGUYÊN mặc định cũ', out.gmpUnchanged, out.gmpClass);
  record('fwdPeoplePicker (Chuyển Tiếp Xin Ý Kiến, không truyền tham số mới): dropdown GIỮ NGUYÊN mặc định cũ', out.fwdUnchanged, out.fwdClass);
  record('DMĐT: gõ tìm + bấm chọn người vẫn hoạt động (checkbox ẩn được check đúng username)', out.dmdtSelectWorks);
  record('owiAssignedToPicker: gõ tìm + bấm chọn người vẫn hoạt động bình thường', out.owiSelectWorks);
  record('groupMembersPicker: gõ tìm + bấm chọn người vẫn hoạt động bình thường', out.gmpSelectWorks);
  record('fwdPeoplePicker: gõ tìm + bấm chọn người vẫn hoạt động bình thường', out.fwdSelectWorks);

  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh', pageErrors.length === 0, pageErrors.join('; '));

  await browser.close();
  server.close();

  const total = results.length;
  const passedCount = results.filter(r => r.pass).length;
  console.log(`\n==== ${passedCount}/${total} scenario(s) passed ====`);
  process.exit(passedCount === total ? 0 : 1);
}

main().catch((err) => {
  console.error('LỖI CHẠY TEST:', err);
  process.exit(1);
});
