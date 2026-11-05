// server/tests/test-approval-hub-refresh.js
//
// Regression cho "Việc D" (11/2026, cùng đợt phản hồi người dùng "auto refresh... có phê duyệt nhưng
// chưa thấy để xử lý tiếp" đã dẫn tới Việc A/B): thêm nút "🔄 Làm Mới" TAY + mốc "Cập nhật lúc..." ở đầu
// màn Hộp Thư Phê Duyệt (index.html #approvalHubSection) — xem refreshApprovalHubManually()/
// updateApprovalHubLastUpdatedLabel() (core-approvalhub.js) + biến lastDbLoadAt (core.js).
//
// Kịch bản CỐT LÕI cần test kỹ (tự rà soát trước khi merge, đúng y chú thích tại
// updateApprovalHubLastUpdatedLabel()): mốc "Cập nhật lúc..." PHẢI phản ánh ĐÚNG lần DB.* thật sự được
// tải lại từ server (lastDbLoadAt, set ở cuối initDatabase() khi thành công) — KHÔNG được tự "nhảy" chỉ
// vì người dùng đổi bộ lọc/sắp xếp (renderApprovalHub() chạy lại nhưng KHÔNG hề gọi initDatabase()).
//
// Chạy: node server/tests/test-approval-hub-refresh.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8996;
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

async function main() {
  const run = createRunner();
  const state = createMockState({ depts: ['Ban Giám Đốc'], users: [ADMIN] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => stopApprovalPolling()); // không cần nhịp poll nền chạy song song trong bài test này.

    await run.run('Sau đăng nhập + mở "✅ Phê Duyệt" -> mốc "Cập nhật lúc..." đã hiện (không rỗng), khớp lastDbLoadAt đặt lúc initDatabase() đăng nhập', async () => {
      await page.evaluate(() => switchTab('approvalHub'));
      const out = await page.evaluate(() => ({
        text: document.getElementById('approvalHubLastUpdated').innerText,
        hasLastDbLoadAt: lastDbLoadAt instanceof Date
      }));
      assert(out.hasLastDbLoadAt, 'lastDbLoadAt phải là Date (đã set ở initDatabase() lúc đăng nhập)');
      assert(out.text.startsWith('Cập nhật lúc '), `nhãn phải bắt đầu "Cập nhật lúc " — thực tế: "${out.text}"`);
    });

    await run.run('Đổi bộ lọc "Trạng Thái" (renderApprovalHub() chạy lại nhưng KHÔNG gọi initDatabase()) -> lastDbLoadAt + nhãn "Cập nhật lúc..." GIỮ NGUYÊN, không tự nhảy', async () => {
      const before = await page.evaluate(() => ({ t: lastDbLoadAt.getTime(), label: document.getElementById('approvalHubLastUpdated').innerText }));
      await page.waitForTimeout(1100); // chờ qua 1 giây thật — nếu lỗi tái phát (dùng new Date() trực tiếp) nhãn SẼ đổi giây hiển thị.
      await page.selectOption('#approvalHubFilterStatus', 'APPROVED');
      const after = await page.evaluate(() => ({ t: lastDbLoadAt.getTime(), label: document.getElementById('approvalHubLastUpdated').innerText }));
      assertEqual(after.t, before.t, 'lastDbLoadAt KHÔNG được đổi chỉ vì đổi bộ lọc (không có fetch nào xảy ra)');
      assertEqual(after.label, before.label, 'Nhãn "Cập nhật lúc..." KHÔNG được tự nhảy theo đồng hồ khi chỉ đổi bộ lọc — đây chính là lỗi đã vá trước khi merge');
    });

    await run.run('Bấm nút "🔄 Làm Mới" -> gọi THẬT initDatabase() + renderApprovalHub(), lastDbLoadAt cập nhật mới hơn, nút trở lại trạng thái bình thường', async () => {
      await page.evaluate(() => switchTab('approvalHub'));
      const before = await page.evaluate(() => lastDbLoadAt.getTime());
      await page.waitForTimeout(1100); // đảm bảo mốc SAU chắc chắn khác mốc TRƯỚC (độ phân giải giây của toLocaleTimeString).
      await page.click('[data-op="refreshApprovalHubManually"]');
      await page.waitForFunction((beforeT) => lastDbLoadAt && lastDbLoadAt.getTime() > beforeT, before, { timeout: 5000 });
      const out = await page.evaluate(() => ({
        btnText: document.getElementById('approvalHubRefreshBtn').innerText,
        btnDisabled: document.getElementById('approvalHubRefreshBtn').disabled,
        label: document.getElementById('approvalHubLastUpdated').innerText
      }));
      assertEqual(out.btnDisabled, false, 'nút phải tự bật lại (không bị kẹt disabled) sau khi làm mới xong');
      assertEqual(out.btnText, '🔄 Làm Mới', 'nút phải trở lại đúng nhãn gốc sau khi làm mới xong');
      assert(out.label.startsWith('Cập nhật lúc '), `nhãn phải cập nhật lại đúng khuôn — thực tế: "${out.label}"`);
    });

    await run.run('Lỗi mạng khi bấm "🔄 Làm Mới" -> alert() báo rõ lỗi (không im lặng như nhịp poll ngầm), nút tự bật lại (không kẹt mãi "Đang làm mới...")', async () => {
      await page.evaluate(() => {
        const baseFetch = window.fetch;
        window.fetch = async (url, opts) => {
          if (url === '/api/data') return { ok: false, status: 500, json: async () => ({}) };
          return baseFetch(url, opts);
        };
      });
      await page.click('[data-op="refreshApprovalHubManually"]');
      await page.waitForFunction(() => window.__alerts.length > 0, { timeout: 5000 });
      const out = await page.evaluate(() => ({
        alerts: window.__alerts.slice(),
        btnText: document.getElementById('approvalHubRefreshBtn').innerText,
        btnDisabled: document.getElementById('approvalHubRefreshBtn').disabled
      }));
      assert(out.alerts.some(a => a.includes('Không thể làm mới')), `phải có alert "Không thể làm mới" — thực tế: ${JSON.stringify(out.alerts)}`);
      assertEqual(out.btnDisabled, false, 'nút phải tự bật lại dù lỗi (finally), không kẹt mãi disabled');
      assertEqual(out.btnText, '🔄 Làm Mới', 'nút phải trở lại đúng nhãn gốc dù lỗi');
    });

  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
