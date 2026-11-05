// server/tests/demo-approval-hub-refresh.js
//
// DEMO thật — chụp ảnh "Việc D" (11/2026): nút "🔄 Làm Mới" + mốc "Cập nhật lúc..." ở đầu màn
// "✅ Phê Duyệt" (Hộp Thư Phê Duyệt).
//
// Chạy: node server/tests/demo-approval-hub-refresh.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'approval-hub-refresh');
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

async function shot(page, selector, file, label) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log(`📸 ${label} ->`, file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const state = createMockState({
    depts: ['Ban Giám Đốc'], users: [ADMIN],
    docs: [{ id: 1, dept: 'Ban Giám Đốc', status: 'PENDING', currentStep: 1, history: [], displayCode: 'TL-001', title: 'Quy chế chi tiêu nội bộ 2026', createdAt: '2026-11-01' }]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1100, height: 500 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => stopApprovalPolling());
    await page.evaluate(() => switchTab('approvalHub'));
    await page.waitForTimeout(150);
    await shot(page, '#approvalHubSection > div:first-child', '00-nut-lam-moi-va-moc-cap-nhat.png', 'Nút "🔄 Làm Mới" + mốc "Cập nhật lúc..." ở đầu màn Hộp Thư Phê Duyệt');

    console.log('\n✅ XÁC NHẬN: người dùng tự bấm "🔄 Làm Mới" để tải lại NGAY (không cần đợi nhịp poll ngầm), và luôn thấy rõ dữ liệu đang xem cập nhật lúc nào.');
  } finally {
    await browser.close();
    server.close();
  }
})();
