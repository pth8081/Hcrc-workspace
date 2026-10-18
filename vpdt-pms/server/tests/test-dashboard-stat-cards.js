// server/tests/test-dashboard-stat-cards.js
//
// Regression test cho Giai đoạn 2d "HCRC Workspace Refresh" (11/2026) — ô thống kê Dashboard
// (renderDashboard(), core-dashboard.js) đổi từ khối "border-l-4 màu phẳng" sang .stat-card dùng chung
// (icon trong khung bo góc + shadow nhẹ, tông warning/neutral theo count) — xem .stat-card-icon.warning/
// .neutral, .stat-card-num.warning/.neutral (app.css).
//
//   (A) Thẻ count > 0 dùng tông "warning" (cần chú ý); thẻ count = 0 dùng tông "neutral".
//   (B) data-op/data-arg0 giữ NGUYÊN — bấm thẻ vẫn gọi đúng handleDashboardCardClick(key) như cũ.
//   (C) ĐỐI CHỨNG: khung "Tin Tức Nổi Bật" (renderDashboardNews) KHÔNG bị đụng tới trong đợt này.
//
// Chạy: node server/tests/test-dashboard-stat-cards.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT_UI = 8988;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({
    users: [ADMIN],
    docs: [{ id: 1, status: 'PENDING', dept: 'Phòng CNTT', currentStep: 1, creator: 'admin' }],
    tasks: []
  });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.waitForTimeout(150);

    await run.run('Thẻ count > 0 (Tài liệu chờ duyệt) dùng tông "warning"; thẻ count = 0 (Công việc) dùng tông "neutral"', async () => {
      const info = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#dashboardStatsGrid .stat-card'));
        return cards.map(c => ({
          label: c.querySelector('.stat-card-label')?.innerText || '',
          num: c.querySelector('.stat-card-num')?.innerText || '',
          hasWarning: !!c.querySelector('.stat-card-icon.warning'),
          hasNeutral: !!c.querySelector('.stat-card-icon.neutral')
        }));
      });
      const docCard = info.find(c => /Tài liệu/i.test(c.label));
      assertEqual(docCard?.num, '1', 'Thẻ Tài liệu chờ duyệt phải hiện đúng số 1');
      assertEqual(docCard?.hasWarning, true, 'count > 0 phải dùng tông warning');
      const taskCard = info.find(c => /Công việc/i.test(c.label));
      assertEqual(taskCard?.num, '0', 'Thẻ Công việc cần xử lý phải hiện đúng số 0');
      assertEqual(taskCard?.hasNeutral, true, 'count = 0 phải dùng tông neutral');
    });

    await run.run('data-op/data-arg0 giữ nguyên — bấm thẻ vẫn gọi đúng handleDashboardCardClick(key)', async () => {
      const result = await page.evaluate(() => {
        let calledWith = null;
        const original = window.handleDashboardCardClick;
        window.handleDashboardCardClick = (key) => { calledWith = key; };
        const card = document.querySelector('#dashboardStatsGrid [data-op="handleDashboardCardClick"][data-arg0="doc"]');
        card?.click();
        window.handleDashboardCardClick = original;
        return calledWith;
      });
      assertEqual(result, 'doc', 'Bấm thẻ Tài liệu phải gọi handleDashboardCardClick("doc") như cũ');
    });

    await run.run('ĐỐI CHỨNG: khung "Tin Tức Nổi Bật" không bị đụng tới (vẫn dùng đúng cấu trúc cũ)', async () => {
      const exists = await page.evaluate(() => !!document.getElementById('dashboardNewsSection'));
      assertEqual(exists, true, '#dashboardNewsSection vẫn còn nguyên, không bị đổi ở đợt này');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
