// tests/test-vpp-participating-depts-initdatabase-load.js
//
// Regression test cho LỖ HỔNG THẬT (báo cáo người dùng 11/2026, kèm ảnh chụp "Phòng Ban Tham Gia VPP"):
// lưu danh sách "Phòng Ban Tham Gia VPP" (Hệ Thống > Quyền Đặc Biệt) xong, F5 lại trang thì cấu hình biến
// mất, ô chọn lại rỗng dù server vẫn còn lưu đúng. Root cause: initDatabase() (public/js/core.js) CHƯA
// TỪNG gán DB.vppParticipatingDepts từ response GET /api/data — saveVppParticipatingDepts()
// (module-admin-specialperm.js) chỉ tự gán DB.vppParticipatingDepts NGAY TRONG PHIÊN lúc lưu, không có
// nơi nào đọc lại dữ liệu ĐÃ CÓ SẴN từ trước khi tải trang — CÙNG KHUÔN bug quickApplyConfigs/
// carVehicleTypes/workflowParticipatingPositions đã từng phát hiện (xem
// test-quickapply-configs-initdatabase-load.js làm mẫu cho cách viết test loại này).
//
// Chạy: node server/tests/test-vpp-participating-depts-initdatabase-load.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assertEqual
} = require('./testHarness');

const PORT = 8996;

const ADMIN = { username: 'admin96', name: 'Admin Test 96', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };

// Danh sách "Phòng Ban Tham Gia VPP" ĐÃ LƯU SẴN TỪ TRƯỚC (mô phỏng đã lưu ở phiên trước) — KHÔNG tạo qua
// bất kỳ hành động client nào trong bài test này.
const EXISTING_PARTICIPATING_DEPTS = ['Phòng CNTT', 'Phòng Kế Toán'];

const state = createMockState({
  depts: ['Phòng CNTT', 'Phòng Kế Toán', 'Ban Tổng Giám Đốc'], stores: [], users: [ADMIN],
  vppParticipatingDepts: EXISTING_PARTICIPATING_DEPTS
});

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err && err.stack || String(err)));

  try {
    await run.run('Đăng nhập MỚI (chưa từng sửa gì trong phiên) -> DB.vppParticipatingDepts phải có SẴN danh sách đã lưu từ trước (không phải mảng rỗng)', async () => {
      const s = await page.evaluate(async (u) => {
        window.__resetCapture();
        await proceedAfterAuth(u);
        return { list: DB.vppParticipatingDepts || [] };
      }, ADMIN);
      assertEqual(JSON.stringify(s.list), JSON.stringify(EXISTING_PARTICIPATING_DEPTS), 'DB.vppParticipatingDepts phải đúng danh sách đã lưu sẵn từ trước ngay sau khi đăng nhập (KHÔNG phải mảng rỗng — LỖI ĐÃ VÁ: trước đây initDatabase() chưa từng đọc field này từ response GET /api/data)');
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
