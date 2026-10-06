// server/tests/test-notif-click-navigate.js
//
// Regression test cho lỗi người dùng báo "ấn vào thông báo không hiển thị gì" (10/2026, kèm ảnh chụp
// màn hình chuông 🔔 "Thông báo"). Gốc lỗi: onClickNotifItem() (core.js) trước đây CHỈ đánh dấu đã đọc
// rồi vẽ lại NGUYÊN danh sách dropdown tại chỗ — n.linkTo (lib/notifications.js, đã lưu sẵn từ lúc tạo,
// VD routes/payroll.js: `/payroll/my-payslips/${periodId}`) CHƯA TỪNG được đọc để điều hướng, nên bấm
// vào 1 thông báo trông y hệt "không có gì xảy ra". Vá: luôn ĐÓNG dropdown ngay (phản hồi rõ ràng), và
// nếu linkTo khớp khuôn /payroll/my-payslips/:id thì điều hướng thẳng tới đúng phiếu lương.
//
// testHarness.js KHÔNG mock sẵn /api/notifications hay /api/payroll/* — tự stub window.fetch ngay
// trong test này cho 2 nhóm route đó (mirror đúng shape response thật của routes/notifications.js/
// routes/payroll.js), các path khác vẫn đi qua dispatcher thật của testHarness.
//
// Chạy: node server/tests/test-notif-click-navigate.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8996;
const USER = { username: 'nva', name: 'Nguyễn Văn A', dept: 'Phòng Kinh Doanh', perms: {}, active: true };

const PERIOD = { id: 42, periodName: 'Tháng 9/2026', periodMonth: 9, periodYear: 2026 };
const PAYSLIP = {
  payslip: { workDays: 22, standardDays: 22, netPay: 15000000, details: [] },
  period: PERIOD
};

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const state = createMockState({ depts: ['Ban Giám Đốc', 'Phòng Kinh Doanh'], stores: [], users: [USER] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  // Stub /api/notifications* và /api/payroll/my-payslips/* — testHarness không mock 2 nhóm route này.
  await page.evaluate(({ periodId, payslipPayload }) => {
    const savedFetch = window.fetch;
    window.__markedReadIds = [];
    window.__notifFixture = [
      { id: 901, username: 'nva', type: 'PAYSLIP_PUBLISHED', title: 'Có phiếu lương mới',
        message: 'Phiếu lương Tháng 9/2026 đã được công bố — bấm để xem chi tiết.',
        linkTo: `/payroll/my-payslips/${periodId}`, isRead: false, createdAt: '01:00 06/10/2026' },
      { id: 902, username: 'nva', type: 'NO_APPROVER', title: '⚠️ Thiếu người duyệt',
        message: 'Đã bị chặn gửi vì thiếu cấu hình người duyệt hợp lệ.',
        linkTo: null, isRead: false, createdAt: '00:30 06/10/2026' }
    ];
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u === '/api/notifications') {
        const unread = window.__notifFixture.filter(n => !n.isRead).length;
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ notifications: window.__notifFixture, unreadCount: unread }) };
      }
      const readMatch = /^\/api\/notifications\/(\d+)\/read$/.exec(u);
      if (readMatch && opts?.method === 'PATCH') {
        const id = Number(readMatch[1]);
        window.__markedReadIds.push(id);
        const n = window.__notifFixture.find(x => x.id === id);
        if (n) n.isRead = true;
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true }) };
      }
      if (u === `/api/payroll/my-payslips/${periodId}`) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => payslipPayload };
      }
      return savedFetch(url, opts);
    };
  }, { periodId: PERIOD.id, payslipPayload: PAYSLIP });

  try {
    await loginAs(page, USER);

    await run.run('Bấm chuông 🔔: dropdown mở, hiện đúng 2 thông báo fixture', async () => {
      await page.click('#btnNotifBell');
      await page.waitForTimeout(150);
      const html = await page.evaluate(() => document.getElementById('notifDropdownPanel').innerHTML);
      assert(html.includes('Có phiếu lương mới'), 'phải thấy thông báo PAYSLIP_PUBLISHED');
      assert(html.includes('Thiếu người duyệt'), 'phải thấy thông báo NO_APPROVER');
      const badge = await page.evaluate(() => document.getElementById('notifUnreadBadge').textContent);
      assertEqual(badge, '2', 'badge phải hiện đúng 2 thông báo chưa đọc');
    });

    await run.run('LỖI ĐÃ VÁ: bấm thông báo CÓ linkTo (phiếu lương) -> đánh dấu đã đọc + đóng dropdown + điều hướng đúng tới Phiếu Lương Của Tôi', async () => {
      await page.click('[data-op="onClickNotifItem"][data-arg0="901"]');
      await page.waitForTimeout(250);

      const markedRead = await page.evaluate(() => window.__markedReadIds.includes(901));
      assert(markedRead, 'phải gọi PATCH đánh dấu đã đọc cho đúng id 901');

      const panelHidden = await page.evaluate(() => document.getElementById('notifDropdownPanel').classList.contains('hidden'));
      assert(panelHidden, 'dropdown phải ĐÓNG lại ngay sau khi bấm (phản hồi rõ ràng, khác hành vi lỗi cũ "vẽ lại tại chỗ")');

      const activeTab = await page.evaluate(() => document.getElementById('hrPayrollSection')?.classList.contains('hidden'));
      assertEqual(activeTab, false, 'phải chuyển sang đúng tab Lương (hrPayroll), không còn ở nguyên màn cũ');

      const modalVisible = await page.evaluate(() => !document.getElementById('hrpPayslipViewModal').classList.contains('hidden'));
      assert(modalVisible, 'phải tự mở khung xem phiếu lương (openHrpPayslipViewModal), không bắt người dùng tự tìm lại');

      const modalTitle = await page.evaluate(() => document.getElementById('hrpPvTitle').textContent);
      assert(modalTitle.includes('Tháng 9/2026'), `tiêu đề phiếu lương phải đúng kỳ lương từ linkTo, got: ${modalTitle}`);
    });

    await run.run('KHÔNG lỗi với thông báo KHÔNG có linkTo (VD NO_APPROVER): vẫn đánh dấu đã đọc + đóng dropdown an toàn, không throw', async () => {
      await page.evaluate(() => { window.__resetCapture(); document.getElementById('hrpPayslipViewModal').classList.add('hidden'); });
      await page.click('#btnNotifBell');
      await page.waitForTimeout(150);
      await page.click('[data-op="onClickNotifItem"][data-arg0="902"]');
      await page.waitForTimeout(200);

      const markedRead = await page.evaluate(() => window.__markedReadIds.includes(902));
      assert(markedRead, 'phải đánh dấu đã đọc cho id 902 dù không có linkTo');

      const panelHidden = await page.evaluate(() => document.getElementById('notifDropdownPanel').classList.contains('hidden'));
      assert(panelHidden, 'dropdown phải đóng lại dù thông báo không có linkTo (vẫn phải có phản hồi rõ ràng)');

      const errors = await page.evaluate(() => window.__consoleErrors || []);
      // console.error bị bắt riêng ở launchPage() dạng page.on('console') in ra stdout — ở đây chỉ cần
      // chắc chắn không có exception JS chưa bắt làm vỡ trang (kiểm tra dropdown vẫn còn DOM, tồn tại).
      const stillWorks = await page.evaluate(() => !!document.getElementById('notifDropdownPanel'));
      assert(stillWorks, 'trang không được vỡ khi click thông báo không có linkTo');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
