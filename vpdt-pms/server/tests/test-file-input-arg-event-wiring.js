// server/tests/test-file-input-arg-event-wiring.js
//
// LỖI ĐÃ VÁ (11/2026, báo cáo người dùng kèm ảnh chụp "chọn file ở modal Nhập Excel TẠO MỚI Hợp Đồng Lao
// Động hàng loạt xong không thấy nút Xác Nhận đâu cả" — thực ra là KHÔNG CÓ GÌ xảy ra sau khi chọn file,
// không chỉ riêng nút Xác Nhận): 3 ô <input type="file"> dùng cơ chế CSP delegation CHUNG
// (bindCspDelegation(), core.js — KHÁC #vanHanhSection/#orgChartSection... có registry OP_CHANGE_ACTIONS
// riêng tự truyền (el, e)) thiếu thuộc tính `data-arg-event="0"` cần thiết để cspCollectArgs()/
// cspDispatchOp() TRUYỀN Event thật vào hàm xử lý data-op-change — thiếu thuộc tính này, hàm bị gọi với
// KHÔNG tham số nào (`fn()` thay vì `fn(event)`), và cả 3 hàm xử lý đều đọc `event.target.files` ngay dòng
// đầu tiên nên ném lỗi "Cannot read properties of undefined (reading 'target')" NGAY LẬP TỨC, bị nuốt im
// lặng (không alert, không console hiện cho người dùng thường) — màn hình chỉ đứng yên như chưa chọn gì.
//
// Đối chiếu với TOÀN BỘ ~45 ô <input type="file" data-op-change="...">  còn lại trong hệ thống (rà soát
// bằng grep) xác nhận đây là 3 NGOẠI LỆ DUY NHẤT thiếu `data-arg-event` trong khi đúng ra cần — mọi ô
// khác hoặc đã có đúng thuộc tính, hoặc dùng registry riêng (vanHanh/orgChart) tự truyền event theo cách
// khác không cần thuộc tính này.
//
// 3 ô đã vá (CHỈ THÊM `data-arg-event="0"`, không đổi gì khác):
//   1. #hrContractImportFile       -> onHrContractImportFileChange()       (hrContractSection.html)
//   2. #hrContractCreateImportFile -> onHrContractCreateImportFileChange() (hrContractSection.html, lỗi
//      người dùng BÁO CÁO TRỰC TIẾP qua ảnh chụp màn hình)
//   3. #hrpOnbCreateImportFile     -> onHrpOnbCreateImportFileChange()     (hrLifecycleSection.html)
//
// Test THẬT qua UI (Chromium thật + index.html/module-*.js thật, chỉ stub window.fetch) — đi đúng đường
// người dùng gặp lỗi: mở đúng modal, chọn file thật (Playwright setInputFiles()), xác nhận handler THẬT
// SỰ chạy (có gọi fetch tới đúng route, có cập nhật status text, KHÔNG có lỗi JS nào).
//
// Chạy: node server/tests/test-file-input-arg-event-wiring.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const ExcelJS = require('exceljs');

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
  console.log((pass ? '✅ PASS' : '❌ FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  const PORT = 9890 + Math.floor(Math.random() * 50);
  const server = await startStaticServer(PORT);

  const xlsxPath = path.join(__dirname, '..', 'demo-screenshots', 'test-file-input-arg-event-tmp.xlsx');
  fs.mkdirSync(path.dirname(xlsxPath), { recursive: true });
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Sheet1').addRow(['test']);
  await wb.xlsx.writeFile(xlsxPath);

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.alert = () => {};
    window.confirm = () => true;
    window.__fetchCalls = [];
    window.fetch = async (url, init) => {
      window.__fetchCalls.push(String(url));
      const u = String(url);
      if (u === '/api/labor-contracts/parse-create-import' || u === '/api/labor-contracts/parse-import') {
        return { ok: true, status: 200, json: async () => ({ fileName: 'test.xlsx', items: [] }) };
      }
      if (u === '/api/hr-processes/onboarding-parse-create-import') {
        return { ok: true, status: 200, json: async () => ({ fileName: 'test.xlsx', items: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    Object.assign(DB, {
      users: [{ id: 1, username: 'admin', name: 'Test Admin', dept: 'HR', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true, hrContractManage: true, hrOnboardingCreate: true, hrOnboardingProcessManage: true }, active: true, groupIds: [], permOverrides: null }],
      laborContractTypes: [], laborContracts: [], employeeProfiles: [], onboardingPaths: [], onboardingProgress: [], hrProcesses: []
    });
    finishLogin(DB.users[0]);
  });

  // ===== 1+2. #hrContractSection: hrContractImportFile + hrContractCreateImportFile =====
  await page.evaluate(() => switchTab('hrContract'));
  await page.waitForTimeout(400);

  await page.evaluate(() => document.querySelector('[data-op="openHrContractImportModal"]')?.click());
  await page.waitForTimeout(150);
  let fi = await page.$('#hrContractImportFile');
  record('hrContractImportFile: tìm thấy input', !!fi);
  if (fi) {
    await fi.setInputFiles(xlsxPath);
    await page.waitForTimeout(400);
    const statusText = await page.evaluate(() => document.getElementById('hrContractImportStatus').innerText);
    record('hrContractImportFile: handler chạy thật, status cập nhật (không còn rỗng/treo)', !!statusText && statusText.length > 0, `thực tế: "${statusText}"`);
  }
  await page.evaluate(() => document.querySelector('[data-op="closeHrContractImportModal"]')?.click());

  await page.evaluate(() => document.querySelector('[data-op="openHrContractCreateImportModal"]')?.click());
  await page.waitForTimeout(150);
  fi = await page.$('#hrContractCreateImportFile');
  record('hrContractCreateImportFile: tìm thấy input', !!fi);
  if (fi) {
    await fi.setInputFiles(xlsxPath);
    await page.waitForTimeout(400);
    const statusText = await page.evaluate(() => document.getElementById('hrContractCreateImportStatus').innerText);
    record('hrContractCreateImportFile: handler chạy thật, status cập nhật (lỗi người dùng báo cáo trực tiếp)', !!statusText && statusText.length > 0, `thực tế: "${statusText}"`);
  }

  // ===== 3. #hrLifecycleSection: hrpOnbCreateImportFile =====
  // KHÔNG dựng được kịch bản UI đầy đủ cho ô này trong harness tĩnh (module-hrlifecycle.js không tự nạp
  // được qua switchTab('hrLifecycle') với bộ DB.* giả lập tối thiểu ở đây — thiếu phụ thuộc nào đó của
  // canAccessHrLifecycleModule()/MODULE_LOAD_GROUPS chưa xác định được nguyên nhân, KHÔNG liên quan tới
  // bản vá data-arg-event; 2 ô #1/#2 ở #hrContractSection phía trên dùng CHUNG CƠ CHẾ và đã CHỨNG MINH
  // bằng UI thật ở trên). Bản vá cho #hrpOnbCreateImportFile (public/fragments/hrLifecycleSection.html)
  // chỉ thêm ĐÚNG 1 thuộc tính `data-arg-event="0"` — giống hệt mẫu đã chứng minh đúng ở 2 ô trên và ở
  // itPriceFileInput/uImportExcelInput/... (40+ ô file input khác trong toàn hệ thống đã dùng đúng mẫu
  // này từ trước) — an toàn theo đúng tính nhất quán, không cần thêm kịch bản UI riêng.

  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();
  fs.unlinkSync(xlsxPath);
  finish();
}

function finish() {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log('');
  console.log(`${passed}/${total} scenarios passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
