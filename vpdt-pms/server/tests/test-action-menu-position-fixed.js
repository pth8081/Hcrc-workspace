// server/tests/test-action-menu-position-fixed.js
//
// Regression test cho LỖI THẬT đã vá (người dùng chụp ảnh thật trên điện thoại, 2 đợt):
//   (1) menu "⋯" (Danh Sách Người Dùng) tràn ra ngoài mép trái màn hình trên mobile — nút trigger nằm
//       sát mép trái (layout đổi flex-col), `.action-menu-panel` cũ dùng `position: absolute; right: 0`
//       lồng trong `.action-menu-trigger-wrap` nên đẩy panel tràn hẳn ra ngoài.
//   (2) menu "⋯" (Ma Trận Phân Quyền) bị khối "Khối quyền" (select)/bảng "Sửa Nhanh Trên Web" ngay bên
//       dưới đè lên dù z-index menu (30) cao hơn bảng (sticky thead z-20/z-10) — do
//       `.action-menu-trigger-wrap` không tự tạo stacking context mới, z-index của panel vẫn phải
//       "tranh" đúng ngữ cảnh xếp lớp của 1 ancestor xa hơn, dễ bị ảnh hưởng bởi overflow:auto +
//       position:sticky của bảng cạnh đó trên 1 số trình duyệt di động.
//
// Đã sửa triệt để CẢ 2 bằng 1 cách chung: `.action-menu-panel` đổi hẳn sang `position: fixed` + tự
// tính top/left bằng JS (positionActionMenuPanel(), core.js) mỗi khi mở — fixed LUÔN nằm ở stacking
// context GỐC của trang và không bị ảnh hưởng bởi overflow/sticky của bất kỳ ancestor nào.
//
//   (A) Viewport hẹp (mobile, nút trigger ở mép trái) -> panel vẫn nằm TRỌN trong màn hình (không âm,
//       không tràn phải).
//   (B) Viewport rộng (desktop, nút trigger ở vị trí bất kỳ) -> panel vẫn nằm trọn trong màn hình.
//   (C) Mở đồng thời "Sửa Nhanh Trên Web" (bảng sticky thead) + menu "⋯" Ma Trận Phân Quyền -> phần tử
//       TẠI ĐÚNG toạ độ mục cuối cùng của menu ("📥 Import Nhóm Phân Quyền") phải CHÍNH LÀ mục đó (hoặc
//       con của nó), không phải select/table đè lên.
//
// Chạy: node server/tests/test-action-menu-position-fixed.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT_UI = 8994;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };
  const NV = { username: 'nv.a', name: 'Nguyễn Văn A', dept: 'Phòng CNTT', perms: {}, active: true };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({ users: [ADMIN, NV] });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); });
    await page.waitForTimeout(150);

    await run.run('.action-menu-panel dùng position:fixed (không còn absolute lồng trong trigger-wrap)', async () => {
      const pos = await page.evaluate(() => getComputedStyle(document.getElementById('userListActionsMenu')).position);
      assertEqual(pos, 'fixed', '.action-menu-panel phải là position:fixed');
    });

    await run.run('(A) Viewport mobile hẹp, trigger ở mép trái -> panel KHÔNG tràn ra ngoài 2 bên màn hình', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => toggleActionMenu('userListActionsMenu', null));
      await page.waitForTimeout(80);
      const box = await page.evaluate(() => document.getElementById('userListActionsMenu').getBoundingClientRect());
      assertEqual(box.left >= 0, true, `panel không được tràn mép trái (left=${box.left})`);
      assertEqual(box.right <= 390, true, `panel không được tràn mép phải (right=${box.right}, viewport=390)`);
      await page.evaluate(() => closeActionMenu('userListActionsMenu'));
      await page.setViewportSize({ width: 1280, height: 900 });
    });

    await run.run('(B) Viewport desktop rộng -> panel vẫn nằm trọn trong màn hình', async () => {
      await page.evaluate(() => toggleActionMenu('userListActionsMenu', null));
      await page.waitForTimeout(80);
      const box = await page.evaluate(() => document.getElementById('userListActionsMenu').getBoundingClientRect());
      assertEqual(box.left >= 0, true, `panel không được tràn mép trái (left=${box.left})`);
      assertEqual(box.right <= 1280, true, `panel không được tràn mép phải (right=${box.right})`);
      await page.evaluate(() => closeActionMenu('userListActionsMenu'));
    });

    await run.run('(C) Mở "Sửa Nhanh Trên Web" (bảng sticky thead) + menu "⋯" Ma Trận Phân Quyền đồng thời -> menu KHÔNG bị bảng/select đè lên', async () => {
      await page.evaluate(() => { if (typeof togglePermMatrixQuickEdit === 'function') togglePermMatrixQuickEdit(); });
      await page.waitForTimeout(100);
      await page.evaluate(() => toggleActionMenu('permMatrixActionsMenu', null));
      await page.waitForTimeout(100);
      const result = await page.evaluate(() => {
        const menu = document.getElementById('permMatrixActionsMenu');
        const lastItem = menu.lastElementChild;
        const r = lastItem.getBoundingClientRect();
        const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { onTop: topEl === lastItem || (lastItem.contains && lastItem.contains(topEl)), text: lastItem.textContent.trim() };
      });
      assertEqual(result.onTop, true, `mục cuối menu ("${result.text}") phải ở TRÊN CÙNG, không bị bảng/select đè lên`);
      await page.evaluate(() => closeActionMenu('permMatrixActionsMenu'));
    });
  } finally {
    await browser.close();
    await server.close();
  }

  run.summary();
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
