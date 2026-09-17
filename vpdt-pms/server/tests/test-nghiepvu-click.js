// server/tests/test-nghiepvu-click.js
//
// Regression cho BUG THẬT người dùng báo (9/2026, kèm ảnh chụp mobile): bấm vào bất kỳ mục nào trong cây
// điều hướng module "📘 Nghiệp Vụ" (nav trái, VD "Hợp Đồng Lao Động") ÂM THẦM không có phản hồi — nội
// dung bên phải không đổi, cả desktop lẫn mobile. Nguyên nhân: #nghiepVuSection (root chứa mọi nút
// data-op="setNVActiveKey"/"setNVDaotaoArea" của module này) chưa từng được đăng ký
// bindCspDelegation() (core.js) từ lúc dựng module — click không bao giờ tới tay cspDispatchOp().
//
// KHÁC test-nghiepvu.js (71 kịch bản, PASS ngay cả khi có bug này) — bài test cũ gọi THẲNG
// setNVActiveKey()/setNVDaotaoArea() qua page.evaluate(), bỏ qua hẳn bước click DOM thật nên không bắt
// được lớp lỗi "click không tới tay hàm xử lý". Bài test NÀY mô phỏng CLICK DOM THẬT (page.click()) —
// cùng khuôn "app Express thật + CSP thật" của test-nghiepvu-csp.js — để không lặp lại lỗ hổng kiểm thử.
//
// Chạy: node server/tests/test-nghiepvu-click.js
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
  const PORT = 9706;
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });

  async function withPage(viewport, fn) {
    const page = await browser.newPage({ viewport });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => {
      window.fetch = async () => ({ ok: true, status: 200, json: async () => ([]) });
      Object.assign(DB, {
        depts: [], stores: [], cats: [],
        // nghiepVuViewAll: true — bài test này click qua CÁC MỤC BẤT KỲ (hrContract/hrProfile/daotao) để
        // xác nhận đúng lớp click-wiring (CSP delegation), không phải test phân quyền theo mục (đã test
        // riêng ở nơi khác) — thiếu quyền này, các mục KHÔNG có quyền module thật tương ứng sẽ không còn
        // render trên nav (canViewNVItem(), module-nghiepvu.js), khiến page.click() chờ hết timeout.
        users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'X', jobTitle: 'Admin', email: 'a@t', phone: '0', perms: { admin: true, nghiepVuViewAll: true }, active: true, groupIds: [], permOverrides: null }]
      });
      finishLogin(DB.users[0]);
    });
    await page.evaluate(() => switchTab('nghiepVu'));
    await page.waitForTimeout(300);
    try { await fn(page); } finally { await page.close(); }
  }

  // ===== Desktop viewport: click DOM thật vào 1 mục KHÁC mục mặc định ("doc"), xác nhận nội dung đổi =====
  await withPage({ width: 1440, height: 900 }, async (page) => {
    const beforeTitle = await page.evaluate(() => document.querySelector('#nghiepVuMain h2')?.textContent?.trim() || '');
    record('[desktop] Trước khi bấm: đang hiện đúng mục mặc định "Tài Liệu"', beforeTitle.includes('Tài Liệu'), beforeTitle);

    // Bấm THẬT qua chuột Playwright (không gọi thẳng hàm JS) — đúng cách người dùng tương tác thật.
    await page.click('#nghiepVuRoot .nv-item[data-arg0="hrContract"]');
    await page.waitForTimeout(150);

    const afterTitle = await page.evaluate(() => document.querySelector('#nghiepVuMain h2')?.textContent?.trim() || '');
    record('[desktop] Bấm "Hợp Đồng Lao Động" trong nav -> nội dung PHẢI đổi đúng mục vừa bấm', afterTitle.includes('Hợp Đồng Lao Động'), `title sau khi bấm: "${afterTitle}"`);

    const activeClass = await page.evaluate(() => document.querySelector('#nghiepVuRoot .nv-item[data-arg0="hrContract"]')?.classList.contains('active'));
    record('[desktop] Nút vừa bấm phải chuyển sang trạng thái active (đổi màu nổi bật)', activeClass === true);

    // Bấm tiếp mục "Đào Tạo" rồi bấm 1 pill khu vực con — xác nhận setNVDaotaoArea() (nv-pill) cũng chạy.
    await page.click('#nghiepVuRoot .nv-item[data-arg0="daotao"]');
    await page.waitForTimeout(150);
    await page.click('#nghiepVuMain .nv-pill[data-arg0="newhire"]');
    await page.waitForTimeout(150);
    const daotaoAreaTitle = await page.evaluate(() => document.querySelector('#nghiepVuMain h3')?.textContent || '');
    record('[desktop] Bấm pill khu vực "Lộ Trình Tân Binh" trong Đào Tạo -> nội dung PHẢI đổi', daotaoAreaTitle.includes('Tân Binh'), daotaoAreaTitle);
  });

  // ===== Mobile viewport: cùng kịch bản, đúng như ảnh người dùng gửi (điện thoại thật) =====
  await withPage({ width: 412, height: 915 }, async (page) => {
    await page.click('#nghiepVuRoot .nv-item[data-arg0="hrProfile"]');
    await page.waitForTimeout(150);
    const mobileTitle = await page.evaluate(() => document.querySelector('#nghiepVuMain h2')?.textContent?.trim() || '');
    record('[mobile 412px] Bấm "Hồ Sơ Nhân Sự" trong nav -> nội dung PHẢI đổi đúng mục vừa bấm', mobileTitle.includes('Hồ Sơ Nhân Sự'), `title sau khi bấm: "${mobileTitle}"`);
  });

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
