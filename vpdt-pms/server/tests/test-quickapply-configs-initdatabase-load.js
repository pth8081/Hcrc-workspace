// tests/test-quickapply-configs-initdatabase-load.js
//
// Regression test cho LỖ HỔNG THẬT (báo cáo người dùng 9/2026, kèm ảnh): lưu 1 cấu hình "⚡ Áp Dụng
// Nhanh" (Hệ Thống > Nghiệp Vụ Nâng Cao > Áp Dụng Nhanh) xong, F5 lại trang thì cấu hình biến mất, hiện
// lại "Chưa có cấu hình Áp Dụng Nhanh nào" dù server vẫn còn lưu đúng. Root cause: initDatabase()
// (public/js/core.js) CHƯA TỪNG gán DB.quickApplyConfigs từ response GET /api/data — module-workflow.js
// chỉ tự gán DB.quickApplyConfigs ngay trong phiên lúc tạo/sửa/xoá (mọi hàm đọc đều tự `|| []` nên không
// lỗi JS/crash), không có nơi nào đọc lại dữ liệu ĐÃ CÓ SẴN từ trước khi tải trang — cùng khuôn bug
// laborContracts/carVehicleTypes/workflowParticipatingPositions đã từng phát hiện (xem
// test-checklist-initdatabase-load.js làm mẫu cho cách viết test loại này).
//
// Chạy: node server/tests/test-quickapply-configs-initdatabase-load.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assertEqual
} = require('./testHarness');

const PORT = 8989;

const ADMIN = { username: 'admin9', name: 'Admin Test 9', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };

// 1 cấu hình Áp Dụng Nhanh ĐÃ TỒN TẠI SẴN (mô phỏng đã lưu ở phiên trước, hoặc do người khác tạo) —
// KHÔNG tạo qua bất kỳ hành động client nào trong bài test này.
const EXISTING_CONFIG = {
  id: 1, workflowId: 'WF_2STEP', modules: ['CAR', 'DOC'], approverMode: {}, approversByPosition: {}
};

const state = createMockState({
  depts: ['Phòng CNTT'], stores: [], users: [ADMIN],
  workflows: [
    { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] },
    { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }, { order: 2, name: 'Phê duyệt 2' }] }
  ],
  quickApplyConfigs: [EXISTING_CONFIG]
});

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err && err.stack || String(err)));

  try {
    await run.run('Đăng nhập MỚI (chưa từng tạo/sửa gì trong phiên) -> DB.quickApplyConfigs phải có SẴN cấu hình đã tồn tại từ trước (không phải mảng rỗng)', async () => {
      const s = await page.evaluate(async (u) => {
        window.__resetCapture();
        await proceedAfterAuth(u);
        return {
          count: (DB.quickApplyConfigs || []).length,
          workflowId: DB.quickApplyConfigs?.[0]?.workflowId,
          modules: DB.quickApplyConfigs?.[0]?.modules
        };
      }, ADMIN);
      assertEqual(s.count, 1, 'DB.quickApplyConfigs phải có ĐÚNG 1 cấu hình đã tồn tại sẵn ngay sau khi đăng nhập (KHÔNG phải mảng rỗng)');
      assertEqual(s.workflowId, 'WF_2STEP', 'Phải đúng nội dung cấu hình đã tồn tại từ trước, không phải dữ liệu client tự tạo');
      assertEqual(JSON.stringify(s.modules), JSON.stringify(['CAR', 'DOC']), 'Phạm vi module phải đúng dữ liệu đã lưu từ trước');
    });

    await run.run('Tab Áp Dụng Nhanh phải HIỂN THỊ NGAY cấu hình đã có sẵn (không cần thao tác gì thêm)', async () => {
      await page.evaluate(() => document.querySelector('[data-op="switchTab"][data-arg0="system"]')?.click());
      await page.waitForTimeout(150);
      await page.evaluate(() => document.querySelector('#btnSystemTab')?.click());
      await page.waitForTimeout(150);
      await page.evaluate(() => document.querySelector('button[data-op-seq*="setSystemSubTab(ADVWORKFLOW)"]')?.click());
      await page.waitForTimeout(150);
      await page.evaluate(() => document.querySelector('#btnAdvWorkflowSubQuickApply')?.click());
      await page.waitForTimeout(200);
      const html = await page.evaluate(() => document.getElementById('quickApplyConfigList').innerHTML);
      assertEqual(html.includes('Quy trình 2 bước'), true, 'Danh sách cấu hình phải hiện đúng tên mẫu quy trình đã có sẵn ngay khi vào tab Áp Dụng Nhanh');
    });

    await run.run('Không có ngoại lệ JS chưa bắt nào phát sinh', async () => {
      assertEqual(jsErrors.length, 0, `Phải không có lỗi JS nào (${jsErrors.join('; ')})`);
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
