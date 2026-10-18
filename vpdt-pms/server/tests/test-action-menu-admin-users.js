// server/tests/test-action-menu-admin-users.js
//
// Regression test cho Giai đoạn 2a "HCRC Workspace Refresh" (11/2026) — gộp 4+5 nút rải màu ở Hệ
// Thống > Quản Trị ("Danh Sách Người Dùng & Quyền Hạn"/"Ma Trận Phân Quyền") vào menu "⋯" dùng chung
// (toggleActionMenu()/closeActionMenu(), core.js + .action-menu-panel/.action-menu-item, app.css).
//
//   (A) Bấm "⋯" -> menu hiện ra; bấm "⋯" lần nữa -> menu đóng lại (toggle).
//   (B) Mở menu A, bấm "⋯" của menu B -> menu A tự đóng (chỉ 1 menu mở tại 1 thời điểm).
//   (C) Mở menu, click ra ngoài (không phải nút trigger/không phải trong panel) -> menu tự đóng.
//   (D) Bấm 1 mục trong menu (VD "📄 Tải File Mẫu") -> ĐÚNG hàm gốc (downloadUserTemplate) vẫn được
//       gọi (hành vi KHÔNG đổi) VÀ menu tự đóng lại ngay sau đó.
//
// Chạy: node server/tests/test-action-menu-admin-users.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT_UI = 8993;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({ users: [ADMIN] });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); });
    await page.waitForTimeout(150);

    await run.run('Bấm "⋯" (menu Danh Sách Người Dùng) -> panel THẬT SỰ hiện ra (computed display, không chỉ classList); bấm lần nữa -> đóng lại', async () => {
      // Dùng getComputedStyle().display thay vì chỉ kiểm classList.contains('hidden') — LỖI ĐÃ VÁ (phát
      // hiện qua chụp ảnh thật trước khi merge): từng có lúc class "hidden" ĐÚNG có mặt trên phần tử
      // nhưng panel vẫn hiện ra do 1 rule CSS khác (.action-menu-panel) đè mất display:none của nó —
      // kiểm classList không bắt được lớp lỗi này, phải đo trực tiếp giá trị hiển thị thật.
      const before = await page.evaluate(() => getComputedStyle(document.getElementById('userListActionsMenu')).display);
      assertEqual(before, 'none', 'TRƯỚC khi bấm: panel phải thật sự ẩn (display:none), không chỉ có class "hidden"');
      const after1 = await page.evaluate(() => {
        toggleActionMenu('userListActionsMenu', null);
        return getComputedStyle(document.getElementById('userListActionsMenu')).display;
      });
      assertEqual(after1, 'flex', 'Lần bấm 1: panel phải thật sự hiện (display:flex)');
      const after2 = await page.evaluate(() => {
        toggleActionMenu('userListActionsMenu', null);
        return getComputedStyle(document.getElementById('userListActionsMenu')).display;
      });
      assertEqual(after2, 'none', 'Lần bấm 2: panel phải thật sự đóng lại (display:none)');
    });

    await run.run('Mở menu A rồi mở menu B -> menu A tự đóng (chỉ 1 menu mở 1 lúc)', async () => {
      const result = await page.evaluate(() => {
        toggleActionMenu('userListActionsMenu', null);
        toggleActionMenu('permMatrixActionsMenu', null);
        return {
          a: document.getElementById('userListActionsMenu').classList.contains('hidden'),
          b: document.getElementById('permMatrixActionsMenu').classList.contains('hidden')
        };
      });
      assertEqual(result.a, true, 'Menu A (Danh Sách Người Dùng) phải tự đóng khi mở menu B');
      assertEqual(result.b, false, 'Menu B (Ma Trận Phân Quyền) phải đang mở');
    });

    await run.run('Mở menu, click ra ngoài (không phải trigger/panel) -> tự đóng', async () => {
      await page.evaluate(() => { toggleActionMenu('permMatrixActionsMenu', null); });
      await page.mouse.click(10, 10); // góc trên-trái màn hình, chắc chắn ngoài trigger lẫn panel
      const hidden = await page.evaluate(() => document.getElementById('permMatrixActionsMenu').classList.contains('hidden'));
      assertEqual(hidden, true, 'Click ra ngoài phải tự đóng menu đang mở');
    });

    await run.run('Bấm mục "📄 Tải File Mẫu" trong menu -> gọi ĐÚNG downloadUserTemplate() gốc + tự đóng menu', async () => {
      const result = await page.evaluate(() => {
        let called = false;
        const original = window.downloadUserTemplate;
        window.downloadUserTemplate = () => { called = true; };
        toggleActionMenu('userListActionsMenu', null);
        const btn = document.querySelector('#userListActionsMenu [data-op-seq*="downloadUserTemplate"]');
        btn.click();
        const hidden = document.getElementById('userListActionsMenu').classList.contains('hidden');
        window.downloadUserTemplate = original;
        return { called, hidden };
      });
      assertEqual(result.called, true, 'Hành vi gốc (downloadUserTemplate) phải vẫn được gọi, không đổi');
      assertEqual(result.hidden, true, 'Menu phải tự đóng ngay sau khi bấm 1 mục');
    });

    await run.run('ĐỐI CHỨNG: cụm "➕ Tạo Nhóm Mới" KHÔNG đổi (không thuộc phạm vi gộp menu)', async () => {
      const exists = await page.evaluate(() => !!document.querySelector('[data-op="startCreateGroup"]'));
      assertEqual(exists, true, 'Nút "Tạo Nhóm Mới" vẫn còn nguyên, không bị gộp vào menu nào');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
