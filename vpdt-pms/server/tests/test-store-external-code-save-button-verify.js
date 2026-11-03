// server/tests/test-store-external-code-save-button-verify.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo kèm ảnh chụp: "Nhập mã điểm api xong refresh lại mất hết, lỗi này
// rất lâu nhưng khi làm bạn dường như không kiểm tra và xử lý luôn, trước tôi có yêu cầu có nút lưu cho
// chắc nhưng bạn báo chỉ cần nhập là tự lưu, giờ tôi lưu xong refresh mất hết dữ liệu"): trước đây ô "Mã
// Điểm API Tồn Kho" (Quản Lý Danh Mục Siêu Thị) tự lưu khi rời ô (data-op-change trên chính input) —
// người dùng không có cách nào biết CHẮC lượt lưu đã thực sự thành công trước khi rời màn hình/tải lại
// trang. Đã đổi hẳn sang nút "💾 Lưu" tường minh từng dòng (saveStoreExternalCodeFromInput(), gọi
// setStoreExternalCode()) — và quan trọng hơn: setStoreExternalCode() giờ ĐỌC LẠI THẬT từ server
// (GET /api/data/storeExternalCodes, bỏ qua mọi cache DB phía trình duyệt) ngay sau khi lưu để xác nhận
// đúng giá trị đã THỰC SỰ nằm trong CSDL, thay vì chỉ tin HTTP 200 của POST là đủ — nếu đọc lại không
// khớp, báo lỗi RÕ RÀNG thay vì im lặng coi là đã lưu xong.
//
// Chạy: node server/tests/test-store-external-code-save-button-verify.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual, assertIncludes } = require('./testHarness');

const PORT = 8992;

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, totpEnabled: true, active: true };

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const state = createMockState({
    depts: [], stores: ['Siêu Thị A'], storeTypes: {}, storeExternalCodes: {}, users: [ADMIN]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await loginAs(page, ADMIN);
    await page.evaluate(async () => { await switchTab('system'); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { renderStoreList(); });

    await run.run('renderStoreList(): nút "💾 Lưu" riêng từng dòng, input KHÔNG còn tự lưu qua data-op-change', async () => {
      const html = await page.evaluate(() => document.getElementById('storeList').innerHTML);
      assertIncludes(html, 'saveStoreExternalCodeFromInput', 'Phải có nút gọi saveStoreExternalCodeFromInput()');
      assertIncludes(html, '💾 Lưu', 'Phải hiện nhãn nút "💾 Lưu"');
      const hasOldAutoSave = await page.evaluate(() => {
        const input = document.querySelector('#storeList input[type="text"]');
        return input ? input.hasAttribute('data-op-change') : null;
      });
      assertEqual(hasOldAutoSave, false, 'Input Mã Điểm KHÔNG còn gắn data-op-change (đã bỏ auto-save-khi-rời-ô)');
    });

    await run.run('ĐỐI CHỨNG lỗi người dùng báo: lưu "thành công giả" (POST 200 nhưng đọc lại KHÔNG khớp) -> báo lỗi rõ ràng, KHÔNG báo "Đã lưu"', async () => {
      const result = await page.evaluate(async () => {
        window.__alerts = [];
        const realFetch = window.fetch;
        window.fetch = async (url, opts) => {
          if (url === '/api/data/storeExternalCodes' && (!opts || opts.method === undefined)) {
            // GET xác nhận — trả về RỖNG (mô phỏng đúng lỗi người dùng báo: lưu xong không thấy trong CSDL)
            return { ok: true, status: 200, json: async () => ({}) };
          }
          if (url === '/api/data/storeExternalCodes' && opts?.method === 'POST') {
            return { ok: true, status: 200, json: async () => (JSON.parse(opts.body)) };
          }
          return realFetch(url, opts);
        };
        const input = document.querySelector('#storeList input[type="text"]');
        input.value = '217';
        await saveStoreExternalCodeFromInput(input, 'Siêu Thị A');
        return { alerts: window.__alerts.slice() };
      });
      assertEqual(result.alerts.length, 1, 'Phải có đúng 1 cảnh báo');
      assertIncludes(result.alerts[0], 'CẢNH BÁO', 'Phải cảnh báo rõ ràng khi đọc lại không khớp (lưu "thành công giả")');
      hAssertNotIncludes(result.alerts[0], '✅ Đã lưu');
    });

    await run.run('Đường thường: POST 200 + đọc lại khớp giá trị -> báo "✅ Đã lưu" + DB.storeExternalCodes cập nhật đúng', async () => {
      const result = await page.evaluate(async () => {
        window.__alerts = [];
        const realFetch = window.fetch;
        window.fetch = async (url, opts) => {
          if (url === '/api/data/storeExternalCodes' && opts?.method === 'POST') {
            return { ok: true, status: 200, json: async () => (JSON.parse(opts.body)) };
          }
          if (url === '/api/data/storeExternalCodes') {
            // GET xác nhận — trả ĐÚNG giá trị vừa lưu (đường thường, thành công thật)
            return { ok: true, status: 200, json: async () => ({ 'Siêu Thị A': '217' }) };
          }
          return realFetch(url, opts);
        };
        const input = document.querySelector('#storeList input[type="text"]');
        input.value = '217';
        await saveStoreExternalCodeFromInput(input, 'Siêu Thị A');
        return { alerts: window.__alerts.slice(), storeExternalCodes: DB.storeExternalCodes };
      });
      assertEqual(result.alerts.length, 1, 'Phải có đúng 1 thông báo');
      assertIncludes(result.alerts[0], '✅ Đã lưu', 'Phải báo thành công khi đọc lại khớp');
      assertEqual(result.storeExternalCodes['Siêu Thị A'], '217', 'DB.storeExternalCodes phải cập nhật đúng giá trị đã xác nhận từ server');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

function hAssertNotIncludes(haystack, needle) {
  if (String(haystack).includes(needle)) throw new Error(`Expected NOT to include "${needle}", got: ${haystack}`);
}

main().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
