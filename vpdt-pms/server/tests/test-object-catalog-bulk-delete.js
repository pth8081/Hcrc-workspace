// server/tests/test-object-catalog-bulk-delete.js
//
// Regression cho OBJECT_CATALOG_BULK_CONFIG (core.js, 10/2026, theo yêu cầu người dùng "đảm bảo tất cả
// các danh mục đều phải sửa được chọn xóa nhiều") — mở rộng cơ chế "chọn nhiều để xoá" (đã có cho 11
// danh mục mảng chuỗi phẳng, xem tests/test-catalog-bulk-delete.js) sang các danh mục dạng OBJECT nhiều
// field trước đây bị loại trừ: sensitiveKeywords (id số), storeJobTitles (khoá = label chuỗi),
// deptGroups (thẻ <div>, có afterDelete hook riêng), meetingRooms (thẻ <div>, có preDeleteWarningFn dò
// lịch sắp tới), jobTitleGradeDefaults (khoá = jobTitle chuỗi), carVehicleTypes (id số, module riêng
// module-dangkyxe.js) + positionTypes (cơ chế BESPOKE riêng, không qua OBJECT_CATALOG_BULK_CONFIG, có
// bỏ qua êm Vị Trí đang bị khoá xoá).
//
// Dựng theo khuôn tests/test-catalog-bulk-delete.js (static server + Chromium thật, mock window.fetch).
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
  page.on('dialog', d => d.accept().catch(() => {})); // confirm() luôn "OK" trừ khi test tự đọc text

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.__dataSaves = {};
    window.__failKeys = new Set();
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const m = typeof url === 'string' && /^\/api\/data\/([^/?]+)$/.exec(url);
      if (m) {
        const key = m[1];
        const body = JSON.parse((opts && opts.body) || '{}');
        (window.__dataSaves[key] = window.__dataSaves[key] || []).push(body);
        if (window.__failKeys.has(key)) { window.__failKeys.delete(key); return { ok: false, status: 500, json: async () => ({ error: 'Lỗi giả lập' }) }; }
        return { ok: true, status: 200, json: async () => (body) };
      }
      if (typeof url === 'string' && url === '/api/meetings/busy-slots') {
        return { ok: true, status: 200, json: async () => ({ items: window.__busySlots || [] }) };
      }
      if (typeof url === 'string' && /^\/api\/admin\/position-types\/[^/]+$/.test(url) && opts && opts.method === 'DELETE') {
        const key = decodeURIComponent(url.split('/').pop());
        if (window.__positionTypeDeleteBlocked && window.__positionTypeDeleteBlocked.has(key)) {
          return { ok: false, status: 409, json: async () => ({ error: 'Đang có tài khoản gán Vị Trí này' }) };
        }
        DB.positionTypes = DB.positionTypes.filter(t => t.key !== key);
        return { ok: true, status: 200, json: async () => ({ positionTypes: DB.positionTypes }) };
      }
      if (typeof url === 'string' && url.startsWith('/api/')) return { ok: true, status: 200, json: async () => ([]) };
      return realFetch(url, opts);
    };

    Object.assign(DB, {
      depts: ['Phòng A'], stores: [], priceZones: [], cats: [], jobTitles: [], licenseTypes: [],
      carTaxiCompanies: [], carEvaluationIssues: [], itRenewalCategories: [], trainingCategories: [],
      contractTypes: [], jobGrades: ['L1', 'L3'],
      sensitiveKeywords: [
        { id: 1, term: 'lương', category: 'SALARY' },
        { id: 2, term: 'kỷ luật', category: 'SALARY' },
        { id: 3, term: 'giữ lại', category: 'SALARY' }
      ],
      storeJobTitles: [{ label: 'Giám Đốc Siêu Thị' }, { label: 'Thu Ngân' }, { label: 'Bảo Vệ' }],
      deptGroups: [{ id: 10, name: 'Khối Xoá 1', depts: [] }, { id: 11, name: 'Khối Xoá 2', depts: [] }, { id: 12, name: 'Khối Giữ Lại', depts: [] }],
      meetingRooms: [{ id: 20, name: 'Phòng Họp A', short: 'A' }, { id: 21, name: 'Phòng Họp B (bận)', short: 'B' }, { id: 22, name: 'Phòng Họp C', short: 'C' }],
      jobTitleGradeDefaults: [{ jobTitle: 'Trưởng Phòng', jobGrade: 'L3' }, { jobTitle: 'Nhân Viên', jobGrade: 'L1' }],
      carVehicleTypes: [{ id: 30, name: 'Xe 4 chỗ', bienSo: '', isTaxi: false }, { id: 31, name: 'Xe 7 chỗ', bienSo: '', isTaxi: false }],
      positionTypes: [
        { key: 'HO', label: 'Khối VP', builtin: true, locations: [], jobTitles: [] },
        { key: 'STORE', label: 'Siêu Thị', builtin: true, locations: [], jobTitles: [] },
        { key: 'KHO1', label: 'Vị Trí Kho 1', builtin: false, locations: [], jobTitles: [] },
        { key: 'KHO2', label: 'Vị Trí Kho 2 (đang gán)', builtin: false, locations: [], jobTitles: [] }
      ],
      users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng A', posType: 'HO', jobTitle: 'Admin', email: 'a@test.local', phone: '090', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }]
    });
    window.__busySlots = [{ room: 'Phòng Họp B (bận)', status: 'PENDING', startTime: new Date(Date.now() + 86400000).toISOString() }];
    window.__positionTypeDeleteBlocked = new Set(['KHO2']);
  });

  await page.evaluate(() => finishLogin(DB.users.find(u => u.username === 'admin')));
  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(400);

  // Cài helper NGAY TRONG trang (tránh phải stringify/truyền hàm qua lại giữa Node <-> browser nhiều lần).
  await page.evaluate(() => {
    window.__tickByText = (listSelector, text, opName) => {
      const rows = Array.from(document.querySelectorAll(listSelector));
      const row = rows.find(li => li.textContent.includes(text));
      const cb = row?.querySelector(`input[type="checkbox"][data-op-change="${opName}"]`);
      if (!cb) return false;
      cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
  });

  const ready = await page.evaluate(() => [
    'renderSensitiveKeywordList', 'renderStoreJobTitleList', 'renderDeptGroupList', 'renderMeetingRoomCatalogList',
    'renderJobTitleGradeDefaultList', 'renderCarVehicleTypeList', 'renderPositionTypeList',
    'bulkDeleteObjectCatalogItems', 'bulkDeletePositionTypes'
  ].every(fn => typeof window[fn] === 'function'));
  record('setup: toàn bộ hàm render/bulk-delete cần test đã sẵn sàng (cluster hethong-tabs kéo theo dangkyxe+phonghop)', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===================== 1) sensitiveKeywords — <ul>/<li>, id số, KHÔNG side-effect riêng =====================
  await page.evaluate(() => renderSensitiveKeywordList());
  const skTick = await page.evaluate(() =>
    window.__tickByText('#sensitiveKeywordList li', 'lương', 'toggleObjectCatalogBulkItem') &&
    window.__tickByText('#sensitiveKeywordList li', 'kỷ luật', 'toggleObjectCatalogBulkItem'));
  record('sensitiveKeywords: tick được 2/3 checkbox (id số)', skTick === true);
  const skBar = await page.evaluate(() => document.querySelector('#sensitiveKeywordList .bg-amber-50')?.innerText || '');
  record('sensitiveKeywords: thanh "Đã chọn 2 từ khoá nhạy cảm" hiện đúng', /Đã chọn 2/.test(skBar), skBar);
  await page.evaluate(() => { document.querySelector('#sensitiveKeywordList [data-op="bulkDeleteObjectCatalogItems"]').click(); });
  await page.waitForTimeout(120);
  const afterSk = await page.evaluate(() => DB.sensitiveKeywords.map(k => k.term));
  record('sensitiveKeywords: xoá đúng 2 mục đã tick, giữ lại "giữ lại"', JSON.stringify(afterSk) === JSON.stringify(['giữ lại']), JSON.stringify(afterSk));

  // ===================== 2) storeJobTitles — <ul>/<li>, khoá = label chuỗi =====================
  await page.evaluate(() => renderStoreJobTitleList());
  await page.evaluate(() => window.__tickByText('#storeJobTitleList li', 'Thu Ngân', 'toggleObjectCatalogBulkItem'));
  await page.evaluate(() => { document.querySelector('#storeJobTitleList [data-op="bulkDeleteObjectCatalogItems"]').click(); });
  await page.waitForTimeout(120);
  const afterSjt = await page.evaluate(() => DB.storeJobTitles.map(t => t.label));
  record('storeJobTitles: xoá đúng "Thu Ngân" (khoá chuỗi), giữ lại 2 chức danh còn lại',
    JSON.stringify(afterSjt.sort()) === JSON.stringify(['Bảo Vệ', 'Giám Đốc Siêu Thị']), JSON.stringify(afterSjt));

  // ===================== 3) jobTitleGradeDefaults — <ul>/<li>, khoá = jobTitle chuỗi =====================
  await page.evaluate(() => renderJobTitleGradeDefaultList());
  await page.evaluate(() => window.__tickByText('#jobTitleGradeDefaultList li', 'Nhân Viên', 'toggleObjectCatalogBulkItem'));
  await page.evaluate(() => { document.querySelector('#jobTitleGradeDefaultList [data-op="bulkDeleteObjectCatalogItems"]').click(); });
  await page.waitForTimeout(120);
  const afterJtgd = await page.evaluate(() => DB.jobTitleGradeDefaults.map(r => r.jobTitle));
  record('jobTitleGradeDefaults: xoá đúng "Nhân Viên", giữ lại "Trưởng Phòng"', JSON.stringify(afterJtgd) === JSON.stringify(['Trưởng Phòng']), JSON.stringify(afterJtgd));

  // ===================== 4) carVehicleTypes — module-dangkyxe.js (cluster riêng), id số =====================
  await page.evaluate(() => renderCarVehicleTypeList());
  await page.evaluate(() => window.__tickByText('#carVehicleTypeList li', 'Xe 4 chỗ', 'toggleObjectCatalogBulkItem'));
  await page.evaluate(() => { document.querySelector('#carVehicleTypeList [data-op="bulkDeleteObjectCatalogItems"]').click(); });
  await page.waitForTimeout(120);
  const afterCvt = await page.evaluate(() => DB.carVehicleTypes.map(t => t.name));
  record('carVehicleTypes: xoá đúng "Xe 4 chỗ" (module-dangkyxe.js, cluster riêng), giữ lại "Xe 7 chỗ"', JSON.stringify(afterCvt) === JSON.stringify(['Xe 7 chỗ']), JSON.stringify(afterCvt));

  // ===================== 5) deptGroups — thẻ <div>, có afterDelete hook riêng =====================
  await page.evaluate(() => renderDeptGroupList());
  const dgInitial = await page.evaluate(() => ({
    divBarVisible: !!document.querySelector('#deptGroupListWrap > .bg-white.rounded.border.px-2\\.5'),
    checkboxCount: document.querySelectorAll('#deptGroupListWrap input[data-op-change="toggleObjectCatalogBulkItem"]').length
  }));
  record('deptGroups: đủ 3 checkbox (1/card), bar "Chọn tất cả" vẽ dạng <div> không phải <li>', dgInitial.checkboxCount === 3, JSON.stringify(dgInitial));
  await page.evaluate(() => {
    window.__tickByText('#deptGroupListWrap > div', 'Khối Xoá 1', 'toggleObjectCatalogBulkItem');
    window.__tickByText('#deptGroupListWrap > div', 'Khối Xoá 2', 'toggleObjectCatalogBulkItem');
  });
  const dgBar = await page.evaluate(() => document.querySelector('#deptGroupListWrap .bg-amber-50')?.innerText || '');
  record('deptGroups: thanh "Đã chọn 2 Khối/Ban" hiện đúng (bar dạng <div>)', /Đã chọn 2/.test(dgBar), dgBar);
  await page.evaluate(() => { document.querySelector('#deptGroupListWrap [data-op="bulkDeleteObjectCatalogItems"]').click(); });
  await page.waitForTimeout(120);
  const afterDg = await page.evaluate(() => DB.deptGroups.map(g => g.name));
  record('deptGroups: xoá đúng 2 Khối/Ban đã tick, giữ lại "Khối Giữ Lại"', JSON.stringify(afterDg) === JSON.stringify(['Khối Giữ Lại']), JSON.stringify(afterDg));

  // ===================== 6) meetingRooms — thẻ <div>, preDeleteWarningFn dò lịch sắp tới =====================
  await page.evaluate(() => renderMeetingRoomCatalogList());
  await page.evaluate(() => {
    window.__tickByText('#meetingRoomCatalogListWrap > div', 'Phòng Họp A', 'toggleObjectCatalogBulkItem');
    window.__tickByText('#meetingRoomCatalogListWrap > div', 'Phòng Họp B (bận)', 'toggleObjectCatalogBulkItem');
  });
  // dò confirm() có nhận đúng cảnh báo "còn lịch sắp tới" cho "Phòng Họp B (bận)" không, trước khi luôn accept().
  let confirmMessageSeen = '';
  page.once('dialog', d => { confirmMessageSeen = d.message(); d.accept().catch(() => {}); });
  await page.evaluate(() => { document.querySelector('#meetingRoomCatalogListWrap [data-op="bulkDeleteObjectCatalogItems"]').click(); });
  await page.waitForTimeout(150);
  record('meetingRooms: confirm() có nêu rõ cảnh báo lịch sắp tới cho "Phòng Họp B (bận)"', /CÒN lịch họp SẮP TỚI/.test(confirmMessageSeen) && confirmMessageSeen.includes('Phòng Họp B'), confirmMessageSeen);
  const afterMr = await page.evaluate(() => DB.meetingRooms.map(r => r.name));
  record('meetingRooms: vẫn xoá đúng cả 2 phòng đã tick (cảnh báo không chặn, chỉ nhắc nhở)', JSON.stringify(afterMr) === JSON.stringify(['Phòng Họp C']), JSON.stringify(afterMr));

  // ===================== 7) Rollback khi lưu thất bại (object catalog) =====================
  await page.evaluate(() => renderSensitiveKeywordList()); // còn lại đúng 1 phần tử "giữ lại"
  const beforeFail = await page.evaluate(() => DB.sensitiveKeywords.map(k => ({ ...k })));
  await page.evaluate(() => {
    window.__tickByText('#sensitiveKeywordList li', 'giữ lại', 'toggleObjectCatalogBulkItem');
    window.__failKeys.add('sensitiveKeywords');
  });
  await page.evaluate(() => { document.querySelector('#sensitiveKeywordList [data-op="bulkDeleteObjectCatalogItems"]').click(); });
  await page.waitForTimeout(120);
  const afterFail = await page.evaluate(() => DB.sensitiveKeywords);
  record('sensitiveKeywords: lưu thất bại -> DB khôi phục lại y hệt trước khi xoá (không mất dữ liệu)',
    JSON.stringify(afterFail) === JSON.stringify(beforeFail), JSON.stringify({ before: beforeFail, after: afterFail }));

  // ===================== 8) positionTypes — BESPOKE, bỏ qua êm Vị Trí đang bị khoá xoá =====================
  await page.evaluate(() => renderPositionTypeList());
  const ptInitial = await page.evaluate(() => ({
    builtinHasCheckbox: !!document.querySelector('[data-op="renamePositionTypeLabel"][data-arg0="HO"]')?.closest('div')?.querySelector('input[data-op-change="togglePositionTypeBulkItem"]'),
    selectableCheckboxes: document.querySelectorAll('input[data-op-change="togglePositionTypeBulkItem"]').length
  }));
  record('positionTypes: 2 Vị Trí builtin (HO/STORE) KHÔNG có checkbox, chỉ 2 Vị Trí tự thêm có', !ptInitial.builtinHasCheckbox && ptInitial.selectableCheckboxes === 2, JSON.stringify(ptInitial));
  await page.evaluate(() => {
    window.__tickByText('#positionTypeList > div', 'Vị Trí Kho 1', 'togglePositionTypeBulkItem');
    window.__tickByText('#positionTypeList > div', 'Vị Trí Kho 2', 'togglePositionTypeBulkItem');
  });
  await page.evaluate(() => { document.querySelector('[data-op="bulkDeletePositionTypes"]').click(); });
  await page.waitForTimeout(150);
  const afterPt = await page.evaluate(() => ({ keys: DB.positionTypes.map(t => t.key), alerts: window.__alerts.slice() }));
  record('positionTypes: xoá được "Vị Trí Kho 1" (không bị khoá), GIỮ LẠI "Vị Trí Kho 2" (server chặn vì đang gán tài khoản) + 2 builtin',
    JSON.stringify(afterPt.keys.sort()) === JSON.stringify(['HO', 'KHO2', 'STORE']), JSON.stringify(afterPt.keys));
  record('positionTypes: có alert báo rõ Vị Trí nào KHÔNG xoá được + lý do', afterPt.alerts.some(a => a.includes('Vị Trí Kho 2') && a.includes('tài khoản gán')), JSON.stringify(afterPt.alerts));

  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();
  finish();
}

function finish() {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log('');
  console.log(`${passed}/${total} scenarios passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
