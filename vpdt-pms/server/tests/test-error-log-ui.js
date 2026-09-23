// server/tests/test-error-log-ui.js
//
// Regression test cho sub-tab MỚI "🖥️ Nhật Ký Lỗi Hệ Thống" (Hệ Thống > Log, 10/2026) — yêu cầu người
// dùng: "lấy tất cả các log lỗi của hệ thống đưa lên đây để tôi có thể điều tra được ngay cả khi không
// dùng đến pm2 log". Sub-tab này đứng CẠNH sub-tab cũ "📋 Nhật Ký Hoạt Động" (đổi tên từ "Quản Trị Log
// Hệ Thống & Giám Sát Hành Vi", dữ liệu/route giữ NGUYÊN, không phải phần test ở đây).
//
// Cơ chế server-side bọc console.error()/console.warn()/uncaughtException/unhandledRejection (xem
// lib/errorLogCapture.js) được kiểm bằng unit test RIÊNG (test-error-log-capture.js, không cần trình
// duyệt) — file này CHỈ kiểm phần client (sub-tab switch, render, lọc, xoá).
//
// Chạy: node server/tests/test-error-log-ui.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8994;
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Hỗ Trợ IT', perms: { admin: true }, active: true, totpEnabled: true };
const NON_ADMIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Kinh Doanh', perms: {}, active: true };

const SAMPLE_ERROR_LOGS = [
  { id: 2, timestamp: '23/10/2026 10:05:00', level: 'ERROR', source: null, message: 'Không kết nối được CSDL: timeout', stack: 'Error: timeout\n    at foo (bar.js:1:1)', username: '', ipAddress: '' },
  { id: 1, timestamp: '23/10/2026 09:00:00', level: 'WARNING', source: 'routes/auth.js', message: 'Đăng nhập vừa tới qua kết nối KHÔNG an toàn', stack: '', username: '', ipAddress: '' }
];

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

// Chặn ĐÚNG "/api/error-log" (GET trả seed, DELETE ghi nhận đã gọi) — testHarness.js dùng chung cho hơn
// 100 test khác KHÔNG mô phỏng route này (giống hệt "/api/log" cũ, cũng chưa từng được mock chung), nên
// chặn riêng trong CHÍNH bài test này thay vì đụng vào testHarness.js dùng chung.
async function stubErrorLogRoute(page, seed) {
  await page.evaluate((items) => {
    window.__errorLogDeleteCalled = false;
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (url.startsWith('/api/error-log')) {
        const method = (opts && opts.method) || 'GET';
        if (method === 'DELETE') {
          window.__errorLogDeleteCalled = true;
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: true, status: 200, json: async () => ({ items }) };
      }
      return realFetch(url, opts);
    };
  }, seed);
}

async function main() {
  const state = createMockState({ depts: ['Hỗ Trợ IT', 'Kinh Doanh'], users: [ADMIN, NON_ADMIN] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await run.run('Mặc định mở tab Log -> sub-tab "Nhật Ký Hoạt Động" đang chọn, "Nhật Ký Lỗi Hệ Thống" ẩn', async () => {
      await loginAs(page, ADMIN);
      await stubErrorLogRoute(page, SAMPLE_ERROR_LOGS);
      await page.evaluate(() => { switchTab('system'); setSystemSubTab('LOG'); });
      const result = await page.evaluate(() => ({
        activityHidden: document.getElementById('logSubActivitySection').classList.contains('hidden'),
        errorHidden: document.getElementById('logSubErrorSection').classList.contains('hidden'),
        activeSub: activeLogSubTab
      }));
      assert(!result.activityHidden, 'Mặc định "Nhật Ký Hoạt Động" phải hiện');
      assert(result.errorHidden, 'Mặc định "Nhật Ký Lỗi Hệ Thống" phải ẩn');
      assertEqual(result.activeSub, 'ACTIVITY', 'activeLogSubTab mặc định phải là ACTIVITY');
    });

    await run.run('Bấm "🖥️ Nhật Ký Lỗi Hệ Thống" -> gọi GET /api/error-log, hiện đúng dữ liệu seed, ẩn "Nhật Ký Hoạt Động"', async () => {
      await page.click('#btnLogSubError');
      await page.waitForTimeout(200);
      const result = await page.evaluate(() => ({
        activityHidden: document.getElementById('logSubActivitySection').classList.contains('hidden'),
        errorHidden: document.getElementById('logSubErrorSection').classList.contains('hidden'),
        rowCount: document.querySelectorAll('#errorLogTableBody tr').length,
        bodyText: document.getElementById('errorLogTableBody').innerText,
        errorLogsInDB: DB.errorLogs.length,
        btnActiveClass: document.getElementById('btnLogSubError').className,
        btnInactiveClass: document.getElementById('btnLogSubActivity').className
      }));
      assert(result.activityHidden, '"Nhật Ký Hoạt Động" phải ẩn sau khi chuyển sang "Nhật Ký Lỗi Hệ Thống"');
      assert(!result.errorHidden, '"Nhật Ký Lỗi Hệ Thống" phải hiện');
      assertEqual(result.errorLogsInDB, 2, 'DB.errorLogs phải nạp đúng 2 dòng seed qua GET /api/error-log');
      assertEqual(result.rowCount, 2, 'Bảng phải hiện đúng 2 dòng');
      assert(result.bodyText.includes('Không kết nối được CSDL'), 'Phải hiện đúng nội dung message dòng ERROR');
      assert(result.bodyText.includes('ERROR') && result.bodyText.includes('WARNING'), 'Phải hiện đúng cấp độ ERROR/WARNING');
      assert(result.btnActiveClass.includes('bg-stone-700'), 'Nút sub-tab đang chọn phải có class active');
      assert(result.btnInactiveClass.includes('bg-gray-200'), 'Nút sub-tab không chọn phải có class inactive');
    });

    await run.run('Dòng ERROR có stack trace hiện <details> "Chi tiết stack trace", dòng WARNING không có (stack rỗng)', async () => {
      const result = await page.evaluate(() => document.getElementById('errorLogTableBody').innerHTML);
      const detailsCount = (result.match(/Chi tiết stack trace/g) || []).length;
      assertEqual(detailsCount, 1, 'Chỉ đúng 1 dòng (ERROR có stack) hiện khối chi tiết stack trace');
    });

    await run.run('Lọc theo Cấp Độ = WARNING chỉ còn đúng 1 dòng', async () => {
      await page.evaluate(() => { document.getElementById('filterErrorLogLevel').value = 'WARNING'; });
      await page.selectOption('#filterErrorLogLevel', 'WARNING');
      await page.waitForTimeout(100);
      const rowCount = await page.evaluate(() => document.querySelectorAll('#errorLogTableBody tr').length);
      assertEqual(rowCount, 1, 'Lọc WARNING phải chỉ còn 1 dòng');
      const text = await page.evaluate(() => document.getElementById('errorLogTableBody').innerText);
      assert(text.includes('Đăng nhập vừa tới'), 'Dòng còn lại phải đúng là dòng WARNING');
    });

    await run.run('Tìm kiếm theo từ khoá "timeout" chỉ khớp dòng ERROR (kể cả sau khi đổi lại bộ lọc Cấp Độ)', async () => {
      await page.selectOption('#filterErrorLogLevel', '');
      await page.fill('#filterErrorLogKeyword', 'timeout');
      await page.waitForTimeout(100);
      const rowCount = await page.evaluate(() => document.querySelectorAll('#errorLogTableBody tr').length);
      assertEqual(rowCount, 1, 'Tìm "timeout" phải chỉ khớp đúng dòng ERROR (message chứa "timeout")');
    });

    await run.run('Bấm "Đặt Lại" xoá hết bộ lọc, hiện lại đủ 2 dòng', async () => {
      await page.click('[data-op="resetErrorLogFilters"]');
      await page.waitForTimeout(100);
      const result = await page.evaluate(() => ({
        rowCount: document.querySelectorAll('#errorLogTableBody tr').length,
        levelVal: document.getElementById('filterErrorLogLevel').value,
        keywordVal: document.getElementById('filterErrorLogKeyword').value
      }));
      assertEqual(result.rowCount, 2);
      assertEqual(result.levelVal, '');
      assertEqual(result.keywordVal, '');
    });

    await run.run('"🗑️ Xóa Log" gọi DELETE /api/error-log + xoá sạch bảng phía client', async () => {
      await page.evaluate(() => { window.confirm = () => true; });
      await page.click('[data-op="clearErrorLogs"]');
      await page.waitForTimeout(200);
      const result = await page.evaluate(() => ({
        deleteCalled: window.__errorLogDeleteCalled,
        errorLogsInDB: DB.errorLogs.length,
        bodyText: document.getElementById('errorLogTableBody').innerText
      }));
      assert(result.deleteCalled, 'Phải gọi DELETE /api/error-log');
      assertEqual(result.errorLogsInDB, 0, 'DB.errorLogs phải rỗng sau khi xoá');
      assert(result.bodyText.includes('Chưa ghi nhận lỗi hệ thống nào'), 'Phải hiện đúng thông báo rỗng "tốt!" khi không còn lỗi nào');
    });

    await run.run('"🗑️ Xóa Log" bấm Hủy xác nhận -> KHÔNG gọi DELETE, dữ liệu giữ nguyên', async () => {
      await stubErrorLogRoute(page, SAMPLE_ERROR_LOGS);
      await page.evaluate(() => { switchTab('system'); setSystemSubTab('LOG'); });
      await page.click('#btnLogSubError');
      await page.waitForTimeout(150);
      await page.evaluate(() => { window.confirm = () => false; });
      await page.click('[data-op="clearErrorLogs"]');
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => ({ deleteCalled: window.__errorLogDeleteCalled, count: DB.errorLogs.length }));
      assert(!result.deleteCalled, 'Bấm Hủy xác nhận thì KHÔNG được gọi DELETE');
      assertEqual(result.count, 2, 'Dữ liệu vẫn còn nguyên 2 dòng');
    });

    await run.run('Nhân viên thường KHÔNG vào được sub-tab Log (setSystemSubTab chặn non-admin ngay từ đầu, đúng phạm vi quyền cũ)', async () => {
      await loginAs(page, NON_ADMIN);
      const result = await page.evaluate(() => {
        activeSystemSubTab = 'FORM';
        switchTab('system');
        setSystemSubTab('LOG');
        return { activeSubTabAfter: activeSystemSubTab };
      });
      assertEqual(result.activeSubTabAfter, 'FORM', 'setSystemSubTab("LOG") phải bị chặn ngay từ đầu cho non-admin — không thể chạm tới Nhật Ký Lỗi Hệ Thống');
    });

  } finally {
    run.summary();
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
