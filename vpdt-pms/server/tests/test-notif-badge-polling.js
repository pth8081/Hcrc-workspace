// server/tests/test-notif-badge-polling.js
//
// Item 6 (đợt golive 10/2026, "mở rộng poll nhẹ"): badge số thông báo chưa đọc (🔔 notifDropdownPanel)
// TRƯỚC ĐÂY chỉ tải ĐÚNG 1 LẦN lúc đăng nhập (refreshNotifBadge(), finishLogin()) — không có cách nào
// khác để biết có thông báo MỚI trong lúc đứng nguyên 1 màn hình, đúng cùng triệu chứng "phải F5 mới
// thấy" đã vá cho Hộp Thư Phê Duyệt (startApprovalPolling(), core.js) — nay có thêm
// startNotifBadgePolling()/stopNotifBadgePolling()/runNotifBadgePollTick() (core.js), CÙNG khuôn nhưng
// đơn giản hơn (không cần so khoá phức tạp — badge chỉ là 1 số + danh sách đọc-thuần).
//
// Test này gọi trực tiếp runNotifBadgePollTick() (không đợi thật 30s NOTIF_BADGE_POLL_INTERVAL_MS) để
// xác nhận đúng 2 nhánh: dropdown ĐANG ĐÓNG -> chỉ cập nhật badge; dropdown ĐANG MỞ -> tải lại nguyên
// danh sách. Cũng xác nhận startNotifBadgePolling()/stopNotifBadgePolling() thật sự tạo/dọn 1 timer, và
// finishLogin()/logout() gọi đúng cặp hàm này.
//
// Chạy: node server/tests/test-notif-badge-polling.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert: hAssert, assertEqual } = require('./testHarness');

const PORT = 8995;

async function main() {
  const run = createRunner();
  const ADMIN = { username: 'admin', name: 'Quản Trị', dept: 'IT', perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({ users: [ADMIN] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  // Chèn thêm route '/api/notifications' (KHÔNG có sẵn trong __apiDispatch của testHarness.js — 3 module
  // test gốc dùng harness này không đụng tới thông báo) — cùng cách bọc window.fetch hiện có đã dùng ở
  // test-simple-catalog-excel-tools.js (SAU khi launchPage() đã chạy xong, không dùng addInitScript).
  await page.evaluate(() => {
    const harnessFetch = window.fetch;
    window.__notifServerState = { unreadCount: 3, notifications: [{ id: 1, title: 'A', message: 'a', createdAt: '2026-01-01', isRead: false }] };
    window.__notifFetchCallCount = 0;
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && url === '/api/notifications' && (!opts || (opts.method || 'GET') === 'GET')) {
        window.__notifFetchCallCount++;
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(window.__notifServerState)) };
      }
      return harnessFetch(url, opts);
    };
  });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);

    await run.run('finishLogin() khởi động sẵn 1 timer notifBadgePollTimer (không cần chờ 30s)', async () => {
      const has = await page.evaluate(() => typeof notifBadgePollTimer !== 'undefined' && notifBadgePollTimer !== null);
      hAssert(has, 'notifBadgePollTimer phải khác null ngay sau khi đăng nhập (finishLogin() đã gọi startNotifBadgePolling())');
    });

    await run.run('runNotifBadgePollTick(): dropdown ĐANG ĐÓNG -> chỉ cập nhật badge, KHÔNG gọi loadAndRenderNotifDropdown()', async () => {
      const result = await page.evaluate(async () => {
        document.getElementById('notifDropdownPanel').classList.add('hidden');
        window.__notifServerState.unreadCount = 5;
        window.__notifFetchCallCount = 0;
        await runNotifBadgePollTick();
        return {
          badgeText: document.getElementById('notifUnreadBadge').textContent,
          fetchCalls: window.__notifFetchCallCount
        };
      });
      assertEqual(result.badgeText, '5', 'Badge phải cập nhật đúng số mới nhất (5) dù không mở dropdown');
      assertEqual(result.fetchCalls, 1, 'Phải gọi đúng 1 lần GET /api/notifications (qua refreshNotifBadge())');
    });

    await run.run('runNotifBadgePollTick(): dropdown ĐANG MỞ -> tải lại nguyên danh sách (loadAndRenderNotifDropdown())', async () => {
      const result = await page.evaluate(async () => {
        document.getElementById('notifDropdownPanel').classList.remove('hidden');
        window.__notifServerState = { unreadCount: 1, notifications: [{ id: 42, title: 'Thông báo mới nhất', message: 'nội dung mới', createdAt: '2026-02-02', isRead: false }] };
        await runNotifBadgePollTick();
        return {
          badgeText: document.getElementById('notifUnreadBadge').textContent,
          panelHtml: document.getElementById('notifDropdownPanel').innerHTML
        };
      });
      assertEqual(result.badgeText, '1', 'Badge phải cập nhật đúng theo dữ liệu mới nhất');
      hAssert(result.panelHtml.includes('Thông báo mới nhất'), 'Dropdown đang mở phải tự vẽ lại với thông báo MỚI (không đợi người dùng đóng/mở lại)');
    });

    await run.run('logout() dừng hẳn notifBadgePollTimer (không rò rỉ timer sau khi đăng xuất)', async () => {
      const after = await page.evaluate(() => {
        document.getElementById('notifDropdownPanel').classList.add('hidden');
        logout();
        return notifBadgePollTimer;
      });
      hAssert(after === null, 'notifBadgePollTimer phải là null sau logout() (stopNotifBadgePolling() đã chạy)');
    });

    await run.run('runNotifBadgePollTick() bỏ qua an toàn nếu gọi khi KHÔNG có currentUser (timer chưa kịp dừng)', async () => {
      const result = await page.evaluate(async () => {
        window.__notifFetchCallCount = 0;
        await runNotifBadgePollTick(); // currentUser đã null sau logout() ở kịch bản trước
        return window.__notifFetchCallCount;
      });
      assertEqual(result, 0, 'Không được gọi fetch nào khi currentUser rỗng — tránh gọi API bằng phiên rỗng');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
