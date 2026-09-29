// server/tests/test-catalog-bulk-delete.js
//
// Regression cho tính năng MỚI (10/2026, theo yêu cầu người dùng "tất cả các danh mục có thể lựa chọn
// nhiều item để xóa cùng một lúc") — checkbox "chọn nhiều để xoá" DÙNG CHUNG cho 10 danh mục dạng mảng
// chuỗi phẳng (SIMPLE_CATALOG_BULK_CONFIG, core.js). Kiểm: tick từng dòng/"Chọn tất cả"/"Bỏ chọn" cập
// nhật đúng thanh "Đã chọn N mục", bulkDeleteCatalogItems() xoá đúng NHIỀU giá trị cùng lúc (kể cả tên
// TOÀN CHỮ SỐ — đúng lỗi người dùng báo cáo, "168" không xoá được), side-effect RIÊNG cho "depts"
// (dọn deptAbbrs + deptGroups[].depts) vẫn chạy đúng khi xoá nhiều tên 1 lượt, và rollback đầy đủ khi lưu
// server thất bại.
//
// Dựng theo khuôn tests/test-admin-store-type-ui.js (static server + Chromium thật, mock window.fetch).
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
  page.on('dialog', d => d.accept().catch(() => {})); // confirm() bulk-delete luôn "OK" trừ khi test tự stub riêng

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.__dataSaves = {}; // { [key]: [...bodies] }
    window.__failKeys = new Set(); // key nào có mặt ở đây thì lượt lưu KẾ TIẾP của key đó thất bại (dùng 1 lần rồi tự xoá)
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
      if (typeof url === 'string' && url.startsWith('/api/')) return { ok: true, status: 200, json: async () => ([]) };
      return realFetch(url, opts);
    };

    Object.assign(DB, {
      depts: ['Phòng A', 'Phòng B', '168'],
      deptAbbrs: { 'Phòng A': 'PA', 'Phòng B': 'PB', '168': 'D168' },
      deptGroups: [{ id: 1, name: 'Khối X', depts: ['Phòng A', '168'] }],
      stores: ['Siêu Thị A', '168', 'Cửa Hàng B'],
      storeTypes: { 'Siêu Thị A': 'ST', '168': 'WH' },
      priceZones: ['Miền Bắc', 'Miền Nam', 'Miền Trung'],
      cats: [], jobTitles: [], licenseTypes: [], carTaxiCompanies: [], carEvaluationIssues: [],
      itRenewalCategories: [], trainingCategories: [], contractTypes: [],
      users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng A', posType: 'HO', jobTitle: 'Admin', email: 'a@test.local', phone: '090', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }]
    });
  });

  await page.evaluate(() => finishLogin(DB.users.find(u => u.username === 'admin')));
  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(300);

  const ready = await page.evaluate(() => typeof renderPriceZoneList === 'function' && typeof renderDeptList === 'function' && typeof renderStoreList === 'function' && typeof bulkDeleteCatalogItems === 'function');
  record('setup: các hàm cần test đã sẵn sàng (renderDeptList/renderStoreList/renderPriceZoneList/bulkDeleteCatalogItems)', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===================== 1) priceZones — danh mục KHÔNG có side-effect (đường đi generic) =====================
  await page.evaluate(() => renderPriceZoneList());
  const pzInitial = await page.evaluate(() => ({
    toolbarVisible: !!document.querySelector('#priceZoneList .bg-amber-50'),
    rowCheckboxes: document.querySelectorAll('#priceZoneList li input[type="checkbox"][data-op-change="toggleCatalogBulkItem"]').length
  }));
  record('priceZones: chưa tick gì thì KHÔNG hiện thanh "Đã chọn" + đủ 3 checkbox/dòng', !pzInitial.toolbarVisible && pzInitial.rowCheckboxes === 3, JSON.stringify(pzInitial));

  await page.evaluate(() => {
    const cb = document.querySelectorAll('#priceZoneList li input[type="checkbox"][data-op-change="toggleCatalogBulkItem"]')[0];
    cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const pzAfterOne = await page.evaluate(() => document.querySelector('#priceZoneList .bg-amber-50')?.innerText || '');
  record('priceZones: tick 1 dòng -> thanh "Đã chọn 1 vùng giá áp dụng" hiện ra', /Đã chọn 1/.test(pzAfterOne), pzAfterOne);

  // "Chọn tất cả"
  await page.evaluate(() => {
    const all = document.querySelector('#priceZoneList input[data-op-change="toggleCatalogBulkAll"]');
    all.checked = true; all.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const pzAfterAll = await page.evaluate(() => document.querySelector('#priceZoneList .bg-amber-50')?.innerText || '');
  record('priceZones: "Chọn tất cả" -> "Đã chọn 3 vùng giá áp dụng"', /Đã chọn 3/.test(pzAfterAll), pzAfterAll);

  // Bỏ chọn
  await page.evaluate(() => { document.querySelector('#priceZoneList [data-op="clearCatalogBulkSelection"]').click(); });
  const pzAfterClear = await page.evaluate(() => !!document.querySelector('#priceZoneList .bg-amber-50'));
  record('priceZones: "Bỏ chọn" -> thanh "Đã chọn" biến mất', !pzAfterClear);

  // Tick 2/3 rồi xoá — LƯU Ý: mỗi lần tick 1 checkbox sẽ trigger vẽ lại TOÀN BỘ <ul> (rerenderCatalogBulkList()),
  // nên KHÔNG được giữ tham chiếu checkbox cũ giữa 2 lượt tick — phải re-query bằng tên dòng SAU MỖI lượt.
  await page.evaluate(() => {
    const tickByName = (name) => {
      const rows = Array.from(document.querySelectorAll('#priceZoneList li'));
      const row = rows.find(li => li.querySelector('span.flex-1')?.textContent === name);
      const cb = row?.querySelector('input[type="checkbox"][data-op-change="toggleCatalogBulkItem"]');
      cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
    };
    tickByName('Miền Bắc');
    tickByName('Miền Trung');
  });
  await page.evaluate(() => { document.querySelector('#priceZoneList [data-op="bulkDeleteCatalogItems"]').click(); });
  await page.waitForTimeout(120);
  const pzAfterDelete = await page.evaluate(() => ({ priceZones: DB.priceZones, saves: window.__dataSaves.priceZones }));
  record('priceZones: xoá đúng 2 mục đã tick (Miền Bắc + Miền Trung), giữ lại Miền Nam', JSON.stringify(pzAfterDelete.priceZones) === JSON.stringify(['Miền Nam']), JSON.stringify(pzAfterDelete.priceZones));
  record('priceZones: chỉ gọi lưu đúng 1 collection "priceZones" (không side-effect thừa)', pzAfterDelete.saves && pzAfterDelete.saves.length === 1, JSON.stringify(pzAfterDelete.saves));

  // ===================== 2) depts — có side-effect RIÊNG (deptAbbrs + deptGroups) =====================
  await page.evaluate(() => renderDeptList());
  // Tick "Phòng A" và "168" (tên toàn số — đúng lỗi người dùng báo cáo) rồi xoá cả 2 cùng lúc.
  const deptCheckResult = await page.evaluate(() => {
    // Mỗi lượt tick vẽ lại TOÀN BỘ <ul> -> phải re-query theo tên dòng SAU MỖI lượt, không giữ tham chiếu cũ.
    const findCb = (name) => {
      const rows = Array.from(document.querySelectorAll('#deptList li'));
      const row = rows.find(li => li.querySelector('span.flex-1')?.textContent === name);
      return row?.querySelector('input[type="checkbox"][data-op-change="toggleCatalogBulkItem"]');
    };
    const cbA = findCb('Phòng A');
    if (!cbA) return { error: 'không tìm thấy checkbox của Phòng A', rowsHtml: document.getElementById('deptList').innerHTML };
    cbA.checked = true; cbA.dispatchEvent(new Event('change', { bubbles: true }));
    const cb168 = findCb('168');
    if (!cb168) return { error: 'không tìm thấy checkbox của 168', rowsHtml: document.getElementById('deptList').innerHTML };
    cb168.checked = true; cb168.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  });
  record('depts: tìm + tick được checkbox của "Phòng A" và "168" (tên toàn số)', deptCheckResult.ok === true, JSON.stringify(deptCheckResult));

  const deptToolbarText = await page.evaluate(() => document.querySelector('#deptList .bg-amber-50')?.innerText || '');
  record('depts: thanh "Đã chọn 2 phòng ban" hiện đúng số lượng', /Đã chọn 2/.test(deptToolbarText), deptToolbarText);

  await page.evaluate(() => { document.querySelector('#deptList [data-op="bulkDeleteCatalogItems"]').click(); });
  await page.waitForTimeout(120);
  const afterDeptBulk = await page.evaluate(() => ({
    depts: DB.depts,
    deptAbbrs: DB.deptAbbrs,
    deptGroups: DB.deptGroups,
    savedKeys: Object.keys(window.__dataSaves).filter(k => window.__dataSaves[k].length && ['depts', 'deptAbbrs', 'deptGroups'].includes(k))
  }));
  record('depts: xoá đúng "Phòng A" + "168" (tên toàn số), CHỈ giữ lại "Phòng B" — LỖI ĐÃ VÁ (trước đây không xoá được tên toàn số)',
    JSON.stringify(afterDeptBulk.depts) === JSON.stringify(['Phòng B']), JSON.stringify(afterDeptBulk.depts));
  record('depts: side-effect deptAbbrs dọn đúng CẢ 2 khoá đã xoá, giữ lại "Phòng B"',
    !('Phòng A' in afterDeptBulk.deptAbbrs) && !('168' in afterDeptBulk.deptAbbrs) && afterDeptBulk.deptAbbrs['Phòng B'] === 'PB', JSON.stringify(afterDeptBulk.deptAbbrs));
  record('depts: side-effect deptGroups[].depts dọn đúng CẢ 2 tên khỏi "Khối X" (mảng rỗng, group vẫn còn)',
    afterDeptBulk.deptGroups.length === 1 && Array.isArray(afterDeptBulk.deptGroups[0].depts) && afterDeptBulk.deptGroups[0].depts.length === 0, JSON.stringify(afterDeptBulk.deptGroups));
  record('depts: lưu đúng cả 3 collection liên quan (depts + deptAbbrs + deptGroups)',
    afterDeptBulk.savedKeys.sort().join(',') === 'deptAbbrs,deptGroups,depts', JSON.stringify(afterDeptBulk.savedKeys));

  // ===================== 3) stores — trọng tâm báo cáo người dùng: xoá siêu thị TÊN TOÀN SỐ =====================
  await page.evaluate(() => renderStoreList());
  const storeCheckResult = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#storeList li'));
    const findRow = (name) => rows.find(li => li.querySelector('span.flex-1')?.textContent === name);
    const cb168 = findRow('168')?.querySelector('input[type="checkbox"][data-op-change="toggleCatalogBulkItem"]');
    if (!cb168) return { error: 'không tìm thấy checkbox của "168"', rowsHtml: document.getElementById('storeList').innerHTML };
    cb168.checked = true; cb168.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  });
  record('stores: tick được checkbox của siêu thị tên "168" (toàn chữ số)', storeCheckResult.ok === true, JSON.stringify(storeCheckResult));

  await page.evaluate(() => { document.querySelector('#storeList [data-op="bulkDeleteCatalogItems"]').click(); });
  await page.waitForTimeout(120);
  const afterStoreBulk = await page.evaluate(() => DB.stores);
  record('stores: xoá ĐÚNG siêu thị "168" qua bulk-delete (LỖI GỐC đã báo cáo — trước đây không xoá được, kể cả xoá đơn lẻ)',
    JSON.stringify(afterStoreBulk) === JSON.stringify(['Siêu Thị A', 'Cửa Hàng B']), JSON.stringify(afterStoreBulk));

  // ===================== 4) Rollback khi lưu thất bại =====================
  await page.evaluate(() => renderPriceZoneList()); // còn lại đúng 1 phần tử "Miền Nam" từ bước 1
  const beforeFail = await page.evaluate(() => [...DB.priceZones]);
  await page.evaluate(() => {
    const cb = document.querySelector('#priceZoneList li input[type="checkbox"][data-op-change="toggleCatalogBulkItem"]');
    cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
    window.__failKeys.add('priceZones');
  });
  await page.evaluate(() => { document.querySelector('#priceZoneList [data-op="bulkDeleteCatalogItems"]').click(); });
  await page.waitForTimeout(120);
  const afterFail = await page.evaluate(() => DB.priceZones);
  record('priceZones: lưu thất bại -> DB.priceZones khôi phục lại y hệt trước khi xoá (không mất dữ liệu)',
    JSON.stringify(afterFail) === JSON.stringify(beforeFail), JSON.stringify({ before: beforeFail, after: afterFail }));

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
