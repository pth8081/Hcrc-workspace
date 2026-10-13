// server/tests/demo-hr-onboarding-bulk-import-ui.js
//
// Kiểm tra THẬT bằng Playwright (Chromium thật + public/index.html/js/*.js thật, dùng chung hạ tầng
// tests/_harness-contract.js) cho 3 nút Nhập Excel hàng loạt Onboarding mới (10/2026) ở tab
// "💼 Nhân Sự → 🧑‍💼 Onboarding / Offboarding": "📥 Tải Mẫu (Theo Quy Trình)"/"📤 Nhập Excel (Theo Quy
// Trình)"/"👉 Bỏ Qua Quy Trình" — xác nhận bấm nút KHÔNG lỗi JS (kể cả sau khi sửa core.js chung,
// routes/create.js refactor), modal mở đúng, "Bỏ Qua Quy Trình" chuyển đúng tab + mở đúng modal Nhập
// Excel Hồ Sơ Nhân Sự đã có sẵn.
'use strict';

const path = require('path');
const fs = require('fs');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'hr-onboarding-bulk-import');
fs.mkdirSync(OUT_DIR, { recursive: true });

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}`); }
}

async function main() {
  const h = await startHarness();
  const { page } = h;
  try {
    // admin bypass mọi perm check (client lẫn server) — không cần sửa tests/_seed.js thêm user mới.
    await h.loginAs('admin');
    await page.evaluate(() => switchTab('hrLifecycle'));
    await page.waitForTimeout(150);

    const visible = await page.evaluate(() => ({
      tmplLink: !document.getElementById('btnHrpOnbCreateTemplateLink').classList.contains('hidden'),
      importBtn: !document.getElementById('btnHrpOnbCreateImport').classList.contains('hidden'),
      skipBtn: !document.getElementById('btnHrpOnbSkipImport').classList.contains('hidden'),
      tmplHref: document.getElementById('btnHrpOnbCreateTemplateLink').getAttribute('href')
    }));
    check('Nút "Tải Mẫu (Theo Quy Trình)" hiện cho admin', visible.tmplLink);
    check('Nút "Nhập Excel (Theo Quy Trình)" hiện cho admin', visible.importBtn);
    check('Nút "Bỏ Qua Quy Trình" hiện cho admin', visible.skipBtn);
    check('Link Tải Mẫu trỏ đúng route GET /api/hr-processes/onboarding-create-template', visible.tmplHref === '/api/hr-processes/onboarding-create-template');

    await page.screenshot({ path: path.join(OUT_DIR, '1-tab-onboarding-buttons.png'), fullPage: false });

    // Bấm "📤 Nhập Excel (Theo Quy Trình)" -> modal phải mở, không lỗi JS.
    await page.click('#btnHrpOnbCreateImport');
    await page.waitForTimeout(100);
    const modalOpen = await page.evaluate(() => !document.getElementById('hrpOnbCreateImportModal').classList.contains('hidden'));
    check('Bấm "Nhập Excel (Theo Quy Trình)" -> modal hrpOnbCreateImportModal mở ra', modalOpen);
    await page.screenshot({ path: path.join(OUT_DIR, '2-modal-nhap-excel-theo-quy-trinh.png'), fullPage: false });

    await page.click('#hrpOnbCreateImportModal button[data-op="closeHrpOnbCreateImportModal"]');
    await page.waitForTimeout(100);
    const modalClosed = await page.evaluate(() => document.getElementById('hrpOnbCreateImportModal').classList.contains('hidden'));
    check('Đóng modal thành công', modalClosed);

    // Bấm "👉 Bỏ Qua Quy Trình" -> phải chuyển sang tab hrProfile VÀ mở đúng modal Nhập Excel Hồ Sơ Nhân Sự có sẵn.
    await page.click('#btnHrpOnbSkipImport');
    await page.waitForTimeout(250);
    const afterSkipClick = await page.evaluate(() => ({
      onHrProfileTab: !document.getElementById('hrProfileSection').classList.contains('hidden'),
      hrpfModalOpen: !!document.getElementById('hrpfImportModal') && !document.getElementById('hrpfImportModal').classList.contains('hidden')
    }));
    check('Bấm "Bỏ Qua Quy Trình" -> chuyển đúng sang tab Hồ Sơ Nhân Sự', afterSkipClick.onHrProfileTab);
    check('Bấm "Bỏ Qua Quy Trình" -> mở đúng modal Nhập Excel Hồ Sơ Nhân Sự (hrpfImportModal) có sẵn, KHÔNG xây lại tính năng mới', afterSkipClick.hrpfModalOpen);
    await page.screenshot({ path: path.join(OUT_DIR, '3-bo-qua-quy-trinh-mo-modal-ho-so-nhan-su.png'), fullPage: false });

    check('KHÔNG có lỗi JS thật (pageerror) nào xảy ra suốt kịch bản', h.jsExceptions.length === 0);
    if (h.jsExceptions.length) console.error('jsExceptions:', h.jsExceptions);
  } finally {
    await h.stop();
  }
  console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\n${passed} passed, 0 failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
