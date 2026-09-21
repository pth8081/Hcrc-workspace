'use strict';
// server/tests/test-mixed-approval-edit-ui.js
//
// Rà soát 10/2026 (yêu cầu người dùng, ảnh chụp màn hình "🏬 Quy Trình Đặt Hàng Siêu Thị — Cấu Hình
// Người Duyệt Theo Bước"): bảng operationOrderStoreMixedApprovalRules trước đây MỖI dòng chỉ có nút
// "🗑 Xoá" — sửa nhầm 1 dòng (đổi chức danh/người/phạm vi siêu thị) phải xoá rồi tạo lại từ đầu. Thêm nút
// "✏️ Sửa" mở lại form "+ Thêm Dòng" ở đúng chế độ CẬP NHẬT (giữ nguyên id, không tạo dòng mới).
//
// Bao phủ:
//   1. Bấm "✏️ Sửa" đổ đúng dữ liệu dòng (Bước/Kiểu/Chức danh hoặc Người/Siêu thị phụ trách) lên form,
//      nút submit đổi nhãn "💾 Cập Nhật Dòng", hiện nút "✕ Huỷ Sửa".
//   2. Sửa xong bấm Cập Nhật -> ĐÚNG dòng đó (cùng id) được thay nội dung, KHÔNG tạo thêm dòng mới, form
//      trở lại chế độ Thêm Mới (nhãn nút về "+ Thêm Dòng", ẩn Huỷ Sửa).
//   3. Bấm "✕ Huỷ Sửa" giữa chừng -> KHÔNG đổi gì dữ liệu, form về rỗng/chế độ Thêm Mới.
//   4. Đang sửa dở dòng A, xoá dòng B (dòng KHÁC) ở bảng -> vẫn giữ nguyên lựa chọn siêu thị đang sửa
//      của dòng A (không bị renderMixedApprovalSection() gọi lại từ deleteMixedApprovalRule() xoá mất).
//   5. Đang sửa dở dòng A mà chính dòng A bị xoá (tình huống hiếm) -> bấm Cập Nhật phải báo lỗi rõ ràng,
//      KHÔNG âm thầm coi như thành công, tự thoát về chế độ Thêm Mới.
//
// Cùng hạ tầng với test-mixed-approval-delete-warning-ui.js: serve public/ tĩnh, Playwright thật, KHÔNG
// cần backend/DB thật (fetch bị mock trả ok:true).
//
// Chạy: node server/tests/test-mixed-approval-edit-ui.js

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8972;

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
  const jsErrors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => jsErrors.push(String(e)));
    page.on('dialog', (d) => d.accept().catch(() => {}));

    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

    results = await page.evaluate(async () => {
      const results = [];
      function check(name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

      window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' });
      window.currentUser = { username: 'admin', name: 'Admin', perms: { admin: true } };

      DB.stores = ['Siêu Thị Q1', 'Siêu Thị Q3', 'Siêu Thị Q5'];
      DB.jobTitles = ['Phó Tổng Giám Đốc'];
      DB.storeJobTitles = [{ label: 'Giám Đốc siêu thị' }];
      DB.users = [
        { username: 'gd.q1', name: 'GĐ Q1', jobTitle: 'Giám Đốc siêu thị', dept: 'Siêu Thị Q1', active: true, perms: {} },
        { username: 'ptgd', name: 'Phó TGĐ', jobTitle: 'Phó Tổng Giám Đốc', dept: 'Ban Giám Đốc', active: true, perms: {} }
      ];
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc siêu thị', username: null, stores: [] },
        { id: 2, step: 2, mode: 'PERSON', jobTitle: null, username: 'ptgd', stores: ['Siêu Thị Q1'] }
      ];

      renderMixedApprovalSection();
      await new Promise((r) => setTimeout(r, 30));

      // ===== 1) Bấm "✏️ Sửa" dòng 2 (PERSON, có siêu thị ngoại lệ) đổ đúng dữ liệu lên form =====
      document.querySelector('[data-op="editMixedApprovalRule"][data-arg0="2"]').click();
      await new Promise((r) => setTimeout(r, 30));
      check('editMixedApprovalRule: Bước đổ đúng 2', document.getElementById('maNewStep').value === '2', document.getElementById('maNewStep').value);
      check('editMixedApprovalRule: Kiểu đổ đúng PERSON', document.getElementById('maNewMode').value === 'PERSON');
      check('editMixedApprovalRule: khối "Người cụ thể" hiện, khối "Chức danh" ẩn', !document.getElementById('maNewPersonWrap').classList.contains('hidden') && document.getElementById('maNewJobTitleWrap').classList.contains('hidden'));
      check('editMixedApprovalRule: ô Người đổ đúng nhãn "Phó TGĐ (ptgd) - Ban Giám Đốc"', document.getElementById('maNewPersonInput').value === 'Phó TGĐ (ptgd) - Ban Giám Đốc', document.getElementById('maNewPersonInput').value);
      check('editMixedApprovalRule: siêu thị ngoại lệ đổ đúng ["Siêu Thị Q1"]', JSON.stringify(getMultiSelectValues('maNewStoresPicker')) === JSON.stringify(['Siêu Thị Q1']), JSON.stringify(getMultiSelectValues('maNewStoresPicker')));
      check('editMixedApprovalRule: nút submit đổi nhãn "💾 Cập Nhật Dòng"', document.getElementById('maSubmitBtn').textContent.includes('Cập Nhật'));
      check('editMixedApprovalRule: nút "✕ Huỷ Sửa" hiện ra', !document.getElementById('maCancelEditBtn').classList.contains('hidden'));

      // ===== 2) Sửa Bước 2 -> 3, bấm Cập Nhật -> đúng dòng id=2 đổi, KHÔNG tạo dòng mới =====
      document.getElementById('maNewStep').value = '3';
      await addMixedApprovalRule();
      const rulesAfterEdit = DB.operationOrderStoreMixedApprovalRules;
      check('Cập Nhật: vẫn đúng 2 dòng (không tạo thêm)', rulesAfterEdit.length === 2, rulesAfterEdit.length);
      const row2After = rulesAfterEdit.find((r) => r.id === 2);
      check('Cập Nhật: dòng id=2 đổi Bước thành 3', row2After && row2After.step === 3, row2After && row2After.step);
      check('Cập Nhật: dòng id=2 vẫn giữ nguyên username/stores không đụng tới', row2After && row2After.username === 'ptgd' && JSON.stringify(row2After.stores) === JSON.stringify(['Siêu Thị Q1']));
      check('Cập Nhật xong: nút submit về lại "+ Thêm Dòng"', document.getElementById('maSubmitBtn').textContent.includes('Thêm Dòng'));
      check('Cập Nhật xong: nút "✕ Huỷ Sửa" ẩn lại', document.getElementById('maCancelEditBtn').classList.contains('hidden'));

      // ===== 3) Bấm Sửa dòng 1 rồi Huỷ Sửa -> KHÔNG đổi gì =====
      const row1Before = JSON.parse(JSON.stringify(DB.operationOrderStoreMixedApprovalRules.find((r) => r.id === 1)));
      document.querySelector('[data-op="editMixedApprovalRule"][data-arg0="1"]').click();
      await new Promise((r) => setTimeout(r, 30));
      document.getElementById('maNewStep').value = '5'; // đổi tay trên form nhưng KHÔNG bấm Cập Nhật
      cancelEditMixedApprovalRule();
      const row1After = DB.operationOrderStoreMixedApprovalRules.find((r) => r.id === 1);
      check('Huỷ Sửa: dữ liệu dòng 1 KHÔNG đổi gì', JSON.stringify(row1After) === JSON.stringify(row1Before), JSON.stringify(row1After));
      check('Huỷ Sửa: nút submit về "+ Thêm Dòng"', document.getElementById('maSubmitBtn').textContent.includes('Thêm Dòng'));
      check('Huỷ Sửa: ô Chức danh được xoá trắng', document.getElementById('maNewJobTitleInput').value === '');

      // ===== 4) Đang sửa dở dòng 1, xoá dòng 2 (khác) -> vẫn giữ đúng lựa chọn siêu thị đang sửa của dòng 1 =====
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc siêu thị', username: null, stores: ['Siêu Thị Q5'] },
        { id: 2, step: 3, mode: 'PERSON', jobTitle: null, username: 'ptgd', stores: ['Siêu Thị Q1'] }
      ];
      renderMixedApprovalSection();
      await new Promise((r) => setTimeout(r, 30));
      document.querySelector('[data-op="editMixedApprovalRule"][data-arg0="1"]').click();
      await new Promise((r) => setTimeout(r, 30));
      check('Setup mục 4: đang sửa dòng 1, picker đổ đúng ["Siêu Thị Q5"]', JSON.stringify(getMultiSelectValues('maNewStoresPicker')) === JSON.stringify(['Siêu Thị Q5']));
      await deleteMixedApprovalRule(2); // xoá dòng KHÁC (id=2), không phải dòng đang sửa
      check('Xoá dòng KHÁC trong lúc đang sửa dở: dòng 2 đã bị xoá khỏi DB', !DB.operationOrderStoreMixedApprovalRules.some((r) => r.id === 2));
      check('Xoá dòng KHÁC trong lúc đang sửa dở: picker của dòng ĐANG SỬA (id=1) KHÔNG bị reset về rỗng', JSON.stringify(getMultiSelectValues('maNewStoresPicker')) === JSON.stringify(['Siêu Thị Q5']), JSON.stringify(getMultiSelectValues('maNewStoresPicker')));
      check('Xoá dòng KHÁC trong lúc đang sửa dở: vẫn đang ở chế độ Sửa (nút Cập Nhật)', document.getElementById('maSubmitBtn').textContent.includes('Cập Nhật'));
      cancelEditMixedApprovalRule(); // dọn trạng thái trước kịch bản kế tiếp

      // ===== 5) Đang sửa dở CHÍNH dòng bị xoá -> báo lỗi rõ, không âm thầm "thành công" =====
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc siêu thị', username: null, stores: [] }
      ];
      renderMixedApprovalSection();
      await new Promise((r) => setTimeout(r, 30));
      document.querySelector('[data-op="editMixedApprovalRule"][data-arg0="1"]').click();
      await new Promise((r) => setTimeout(r, 30));
      let alertMsg = null;
      const originalAlert = window.alert;
      window.alert = (msg) => { alertMsg = msg; };
      await deleteMixedApprovalRule(1); // xoá CHÍNH dòng đang sửa (kịch bản hiếm, đề phòng)
      await addMixedApprovalRule(); // bấm "Cập Nhật" trong lúc dòng đã biến mất
      window.alert = originalAlert;
      check('Sửa đúng dòng vừa bị xoá: phải cảnh báo rõ, KHÔNG âm thầm coi là thành công', typeof alertMsg === 'string' && /không còn tồn tại/.test(alertMsg), alertMsg);
      check('Sửa đúng dòng vừa bị xoá: tự thoát về chế độ Thêm Mới', document.getElementById('maSubmitBtn').textContent.includes('Thêm Dòng'));

      return results;
    });
  } finally {
    await browser.close();
    server.close();
  }

  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.pass) { pass++; console.log(`PASS: ${r.name}`); }
    else { fail++; console.log(`FAIL: ${r.name}${r.detail ? ' -- ' + r.detail : ''}`); }
  }
  if (jsErrors.length) {
    fail += jsErrors.length;
    for (const e of jsErrors) console.log(`FAIL: (JS error) ${e}`);
  }
  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed${fail ? `, ${fail} FAILED` : ''} ====`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
