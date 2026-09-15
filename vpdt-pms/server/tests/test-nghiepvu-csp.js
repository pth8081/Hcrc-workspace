// server/tests/test-nghiepvu-csp.js
//
// Regression cho BUG THẬT phát hiện qua ảnh chụp console F12 + báo cáo thực tế của người dùng (v23.6→
// điều tra thêm): màn "📘 Nghiệp Vụ" trên server production (có bật CSP thật qua lib/securityHeaders.js)
// hiện thành menu PHẲNG không style, không bấm phân biệt được — 2 bản vá trước (v23.5/v23.6) chỉ sửa nội
// dung/SVG nên KHÔNG giải quyết được, vì nguyên nhân thật là module-nghiepvu.js nạp CSS tuỳ biến (.nv-*)
// qua document.createElement('style') + document.head.appendChild() ("<style> nội tuyến qua JS") — đúng
// kiểu bị chặn bởi styleSrc CSP (không có 'unsafe-inline', xem lib/securityHeaders.js) — trình duyệt ÂM
// THẦM chặn style này, không báo lỗi rõ ràng cho người dùng thường (giống hệt cảnh báo đã ghi ở đầu
// lib/securityHeaders.js cho Google Fonts). Sandbox test trước đó dùng static server thuần (KHÔNG áp CSP
// thật) nên KHÔNG BAO GIỜ bắt được lỗi này dù mọi bài test đều PASS.
//
// Bài test NÀY khác biệt: dựng app Express THẬT có áp lib/securityHeaders.js (helmet CSP thật, đúng cấu
// hình production) — không phải static server thuần như các test khác — để bắt được CHÍNH XÁC lớp lỗi
// "CSP âm thầm chặn style/script nội tuyến" mà sandbox test thông thường bỏ sót. Nên dùng làm KHUÔN MẪU
// cho mọi module mới sau này thay vì chỉ test qua static server.
//
// Chạy: node server/tests/test-nghiepvu-csp.js
'use strict';
const path = require('path');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  const express = require(path.join(__dirname, '..', 'node_modules', 'express'));
  const securityHeaders = require(path.join(__dirname, '..', 'lib', 'securityHeaders'));
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');

  const app = express();
  app.use(securityHeaders);
  app.use(express.static(PUBLIC_DIR));
  const PORT = 9705;
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => {
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ([]) });
    Object.assign(DB, {
      depts: [], stores: [], cats: [],
      users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'X', jobTitle: 'Admin', email: 'a@t', phone: '0', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }]
    });
    finishLogin(DB.users[0]);
  });

  // Chỉ bắt đầu ghi vi phạm CSP TỪ ĐÂY (sau khi đăng nhập xong) — finishLogin() tự nó phát sinh 1 vi
  // phạm style-src RIÊNG, KHÔNG liên quan gì tới module Nghiệp Vụ (tái hiện được cả khi không hề mở tab
  // Nghiệp Vụ) — nằm ngoài phạm vi bài test này, cần điều tra riêng. Chặn đúng phạm vi "mở tab Nghiệp
  // Vụ" để bài test không bị nhiễu bởi vấn đề khác không liên quan.
  const cspViolations = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('Content Security Policy') || t.includes('Refused')) cspViolations.push(t);
  });

  await page.evaluate(() => switchTab('nghiepVu'));
  await page.waitForTimeout(400);

  const ready = await page.evaluate(() => typeof renderNghiepVuModule === 'function');
  record('setup: module-nghiepvu.js đã nạp xong dưới CSP thật', ready);

  // ===== Kiểm tra chính: CSS .nv-* PHẢI áp dụng được thật sự (không chỉ là class có mặt trong DOM) =====
  const sidebarWidth = await page.evaluate(() => document.querySelector('#nghiepVuRoot .nv-sidebar')?.getBoundingClientRect().width || 0);
  record('CSS .nv-sidebar ÁP DỤNG ĐƯỢC dưới CSP thật (bề rộng ~270px, không phải 0/full-width)', sidebarWidth > 200 && sidebarWidth < 320, `width=${sidebarWidth}`);

  const activeItemBg = await page.evaluate(() => {
    const btn = document.querySelector('#nghiepVuRoot .nv-item.active');
    return btn ? getComputedStyle(btn).backgroundColor : null;
  });
  record('CSS .nv-item.active ÁP DỤNG ĐƯỢC (nền tím nhạt, không phải trong suốt)', activeItemBg === 'rgb(245, 243, 255)', `backgroundColor=${activeItemBg}`);

  const appDisplay = await page.evaluate(() => {
    const el = document.querySelector('#nghiepVuRoot .nv-app');
    return el ? getComputedStyle(el).display : null;
  });
  record('CSS .nv-app ÁP DỤNG ĐƯỢC (display:flex — 2 cột sidebar+nội dung, không rơi về mặc định block)', appDisplay === 'flex', `display=${appDisplay}`);

  // ===== Không còn document.createElement('style') nội tuyến nào trong module này (nguồn gốc bug) =====
  const hasInlineStyleTag = await page.evaluate(() => !!document.getElementById('nv-inline-styles'));
  record('KHÔNG còn thẻ <style> nội tuyến nào được tạo qua JS cho module Nghiệp Vụ (đã dời hẳn sang app.css)', !hasInlineStyleTag);

  // ===== KHÔNG có vi phạm CSP nào bắt nguồn từ module-nghiepvu.js (style-src) =====
  const nvRelatedViolations = cspViolations.filter(v => v.includes('style-src') || v.toLowerCase().includes('inline style'));
  record('KHÔNG có vi phạm CSP style-src nào phát sinh khi mở tab Nghiệp Vụ', nvRelatedViolations.length === 0, JSON.stringify(nvRelatedViolations));

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
