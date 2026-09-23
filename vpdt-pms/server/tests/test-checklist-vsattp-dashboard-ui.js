// server/tests/test-checklist-vsattp-dashboard-ui.js
//
// Regression cho UI MỚI (10/2026, yêu cầu người dùng) — tab con "🥗 Đánh Giá VSATTP" trong "📊 Báo Cáo"
// module Checklist: renderChecklistVsattpDashboard()/setChecklistReportSubTab() ở module-checklist.js.
// Kiểm client mirror của computeVsattpDashboardData() (đã có unit test riêng ở
// test-checklist-vsattp-dashboard-aggregation.js cho phần TOÁN) — file NÀY kiểm phần DOM/wiring: chuyển
// tab con, đọc bộ lọc đúng, cảnh báo đơn vị chưa phân loại, gọi đúng route xuất Excel.
//
// Dựng theo đúng khuôn tests/test-checklist-execute-tab-admin-audit-test.js (static server + Chromium
// thật, mock window.fetch cho route xuất file, không cần server thật).
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

  const exportCalls = [];
  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.__exportCalls = [];
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (url === '/api/checklist/vsattp-dashboard/export') {
        window.__exportCalls.push(JSON.parse((opts && opts.body) || '{}'));
        return { ok: true, status: 200, blob: async () => new Blob(['fake-xlsx']) };
      }
      if (typeof url === 'string' && url.startsWith('/api/')) return { ok: true, status: 200, json: async () => ([]) };
      return realFetch(url, opts);
    };

    Object.assign(DB, {
      depts: ['Phòng Vận Hành'], stores: ['Siêu Thị A', 'Siêu Thị B', 'Cửa Hàng X', 'Chưa Phân Loại Y'], cats: [],
      storeTypes: { 'Siêu Thị A': 'ST', 'Siêu Thị B': 'ST', 'Cửa Hàng X': 'CH' }, // "Chưa Phân Loại Y" CỐ Ý không có trong map
      checklistTemplates: [
        { id: 301, templateCode: 'CL_VSATTP', templateName: 'Checklist VSATTP', templateType: 'CONTROL_AUDIT', templateKind: 'DEDUCTION', status: 'ACTIVE', version: 1,
          categories: [{ name: 'Chất Lượng', maxDeduction: 30, subItems: [{ name: 'Cảm quan', criteria: [{ id: 1, description: 'Sản phẩm hết hạn sử dụng' }] }] }] },
        { id: 302, templateCode: 'CL_STCH_DAILY', templateName: 'Tự Đánh Giá', templateType: 'STORE_SELF', templateKind: 'QA', status: 'ACTIVE', version: 1, questions: [] }
      ],
      checklistSubmissions: [
        { id: 1, templateId: 301, status: 'SUBMITTED', storeCode: 'Siêu Thị A', submittedAt: '08:00:00 5/9/2026', submittedByName: 'KS1', scorePercent: 95, totalScore: 95, maxPossibleScore: 100, deductions: [{ criteriaId: 1, deductedPoints: 4, description: 'Bánh mì hết hạn', riskLevel: 'B', deadline: '10/9/2026' }] },
        { id: 2, templateId: 301, status: 'SUBMITTED', storeCode: 'Siêu Thị B', submittedAt: '08:00:00 6/9/2026', submittedByName: 'KS1', scorePercent: 70, totalScore: 70, maxPossibleScore: 100, deductions: [] },
        { id: 3, templateId: 301, status: 'SUBMITTED', storeCode: 'Cửa Hàng X', submittedAt: '08:00:00 7/9/2026', submittedByName: 'KS2', scorePercent: 88, totalScore: 88, maxPossibleScore: 100, deductions: [] },
        { id: 4, templateId: 301, status: 'SUBMITTED', storeCode: 'Chưa Phân Loại Y', submittedAt: '08:00:00 8/9/2026', submittedByName: 'KS2', scorePercent: 99, totalScore: 99, maxPossibleScore: 100, deductions: [] },
        // Bài mẫu QA (không phải DEDUCTION) — PHẢI bị loại khỏi Dashboard hoàn toàn dù cùng siêu thị A.
        { id: 5, templateId: 302, status: 'SUBMITTED', storeCode: 'Siêu Thị A', submittedAt: '09:00:00 8/9/2026', submittedByName: 'NV1', scorePercent: null, answers: [] },
        // Bài DRAFT (chưa nộp) — PHẢI bị loại khỏi Dashboard.
        { id: 6, templateId: 301, status: 'DRAFT', storeCode: 'Siêu Thị A', submittedAt: null, scorePercent: null, deductions: [] }
      ],
      users: [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng Vận Hành', posType: 'HO', jobTitle: 'Admin', email: 'a@test.local', phone: '090', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }
      ]
    });
  });

  await page.evaluate(() => finishLogin(DB.users.find(u => u.username === 'admin')));
  await page.evaluate(() => switchTab('checklist'));
  await page.waitForTimeout(250);
  await page.evaluate(() => setChecklistSubTab('REPORT'));
  await page.waitForTimeout(150);

  const ready = await page.evaluate(() => typeof renderChecklistVsattpDashboard === 'function' && typeof setChecklistReportSubTab === 'function');
  record('setup: module-checklist.js đã nạp xong, hàm cần test đã sẵn sàng', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== 1. Mặc định mở tab con "GENERAL" (nội dung cũ), tab "VSATTP" ẩn =====
  const initial = await page.evaluate(() => ({
    generalHidden: document.getElementById('checklistReportGeneralPanel').classList.contains('hidden'),
    vsattpHidden: document.getElementById('checklistReportVsattpPanel').classList.contains('hidden')
  }));
  record('Mặc định: panel GENERAL hiện, panel VSATTP ẩn', !initial.generalHidden && initial.vsattpHidden, JSON.stringify(initial));

  // ===== 2. Chuyển sang tab "VSATTP" — panel đổi + Dashboard tự render =====
  await page.evaluate(() => setChecklistReportSubTab('VSATTP'));
  await page.waitForTimeout(100);
  const afterSwitch = await page.evaluate(() => ({
    generalHidden: document.getElementById('checklistReportGeneralPanel').classList.contains('hidden'),
    vsattpHidden: document.getElementById('checklistReportVsattpPanel').classList.contains('hidden')
  }));
  record('Sau khi chuyển tab: panel VSATTP hiện, panel GENERAL ẩn', afterSwitch.generalHidden && !afterSwitch.vsattpHidden, JSON.stringify(afterSwitch));

  // ===== 3. Thống kê đúng: 2 ST (A,B) + 1 CH (X) đã kiểm tra — "Chưa Phân Loại Y" KHÔNG tính =====
  const stats = await page.evaluate(() => document.getElementById('checklistVsattpStatsWrap').innerText);
  record('Thống kê: đúng 2 Siêu Thị đã kiểm tra (A, B — không tính "Chưa Phân Loại Y")', /\b2\b/.test(stats.split('Siêu Thị đã kiểm tra')[0].trim().split('\n').pop()), stats);
  record('Thống kê: đúng 1 Cửa Hàng đã kiểm tra (X)', /\b1\b/.test(stats.split('Cửa Hàng đã kiểm tra')[0].trim().split('\n').pop()), stats);

  // ===== 4. Cảnh báo đơn vị chưa phân loại hiện đúng, nêu tên "Chưa Phân Loại Y" =====
  const warn = await page.evaluate(() => ({
    hidden: document.getElementById('checklistVsattpUnclassifiedWarn').classList.contains('hidden'),
    text: document.getElementById('checklistVsattpUnclassifiedWarn').innerText
  }));
  record('Cảnh báo chưa phân loại HIỆN, nêu đúng tên đơn vị', !warn.hidden && warn.text.includes('Chưa Phân Loại Y'), warn.text);

  // ===== 5. Top 5 ST hiện đúng — Siêu Thị A (95đ) cao hơn Siêu Thị B (70đ) =====
  const topStHigh = await page.evaluate(() => document.getElementById('checklistVsattpTopStHigh').innerText);
  record('Top 5 ST cao nhất hiện "Siêu Thị A" trước "Siêu Thị B" (95 > 70)', topStHigh.indexOf('Siêu Thị A') < topStHigh.indexOf('Siêu Thị B') && topStHigh.indexOf('Siêu Thị A') >= 0, topStHigh);

  // ===== 6. Tỷ lệ vi phạm ST: "Sản phẩm hết hạn sử dụng" do Siêu Thị A gây ra, mẫu số = 2 (A,B) =====
  const violSt = await page.evaluate(() => document.getElementById('checklistVsattpViolSt').innerText);
  record('Tỷ lệ vi phạm ST hiện đúng tiêu chí + tỷ lệ 50.0% (1/2 ST vi phạm)', violSt.includes('Sản phẩm hết hạn sử dụng') && violSt.includes('50.0%'), violSt);

  // ===== 7. Lọc theo siêu thị cụ thể — chỉ chọn "Siêu Thị B" -> Top 5 ST cao chỉ còn B =====
  await page.evaluate(() => {
    const sel = document.getElementById('checklistVsattpStoreFilter');
    Array.from(sel.options).forEach(o => { o.selected = o.value === 'Siêu Thị B'; });
    applyChecklistVsattpFilter();
  });
  await page.waitForTimeout(100);
  const filteredTop = await page.evaluate(() => document.getElementById('checklistVsattpTopStHigh').innerText);
  record('Lọc theo "Siêu Thị B": Top 5 ST cao chỉ còn B, không còn A', filteredTop.includes('Siêu Thị B') && !filteredTop.includes('Siêu Thị A'), filteredTop);
  // Dọn bộ lọc lại (bỏ chọn) để không ảnh hưởng bước xuất Excel bên dưới (muốn xuất KHÔNG lọc).
  await page.evaluate(() => {
    const sel = document.getElementById('checklistVsattpStoreFilter');
    Array.from(sel.options).forEach(o => { o.selected = false; });
    applyChecklistVsattpFilter();
  });

  // ===== 8. Xuất Excel gọi ĐÚNG route + body (storeCodes null khi không lọc gì) =====
  await page.evaluate(() => exportChecklistVsattpExcel());
  await page.waitForTimeout(100);
  const calls = await page.evaluate(() => window.__exportCalls);
  record('Xuất Excel: gọi đúng 1 lần route /api/checklist/vsattp-dashboard/export', calls.length === 1, JSON.stringify(calls));
  record('Xuất Excel: storeCodes=null khi không lọc siêu thị nào', calls[0] && calls[0].storeCodes === null, JSON.stringify(calls[0]));

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
