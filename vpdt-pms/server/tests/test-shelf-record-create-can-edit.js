// tests/test-shelf-record-create-can-edit.js — "📷 Ghi Nhận" (Kiểm Soát Hàng Hóa): quyền "Ghi Nhận Trên
// Kệ" (shelfRecordCreate) ĐỦ để tự Sửa/Xóa/Cập Nhật nhanh/Bán Hết ngay trên bảng (11/2026, theo yêu cầu
// TRỰC TIẾP của người dùng kèm 2 ảnh chụp: "quyền Ghi Nhận Trên Kệ có thể cập nhật thông tin trên quầy kệ
// [Sửa/Xóa/SL hiện tại-Cập Nhật/Bán Hết] như ảnh 2") — ĐỔI QUYẾT ĐỊNH trước đó (shelfLocationManage/admin
// mới được, xem lib/shelfStockEdit.js canManageShelfRecordEdits()). Test UI THẬT bằng Playwright
// page.click()/page.fill() — cho ĐÚNG người dùng CHỈ có shelfRecordCreate (KHÔNG shelfLocationManage,
// KHÔNG admin) — nếu chỉ test đơn vị hàm applyShelfRecordEdit() thuần sẽ không bắt được lỗi dispatch CSP/
// luồng click thật như lịch sử các bug ở module này đã dạy (xem test-shelf-subtab-real-click.js).
//
// Phạm vi test:
//  1. "✏️ Sửa" (full edit — đổi số lượng/hạn sử dụng/ghi chú) -> lưu được, KHÔNG bị 403.
//  2. "💾 Cập Nhật" (ô "SL hiện tại", tắt nhanh) -> lưu được.
//  3. "✅ Bán Hết" -> set quantity=0, dừng theo dõi.
//  4. "🗑️ Xóa" -> xoá vĩnh viễn.
//  5. REGRESSION: vẫn CHỈ giới hạn ĐÚNG siêu thị của người đó — ghi nhận của siêu thị KHÁC không hiện cụm
//     nút này (renderShelfRecordActionsCell() đã ẩn sẵn, xem canViewShelfScopedItem()), không kiểm lại ở
//     đây (đã có test-shelf-ownstore-scope-regression.js riêng).
//  6. (11/2026, theo yêu cầu TRỰC TIẾP của người dùng NGAY SAU KHI mở quyền ở trên — "lưu lại ai là người
//     ghi nhận [cập nhật gần nhất]"): mỗi lần Sửa/Cập Nhật/Bán Hết phải cập nhật đúng field
//     lastEditedBy/lastEditedByName/lastEditedAt + cột "Người Cập Nhật Gần Nhất" trên bảng phải hiện đúng
//     tên người vừa thao tác.
//
// Chạy: node server/tests/test-shelf-record-create-can-edit.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8996;
  const USER = {
    username: 'nv1', name: 'Nhân Viên Ghi Nhận 1', dept: 'Siêu thị Quận 1',
    // CHỈ shelfRecordCreate — KHÔNG shelfLocationManage, KHÔNG admin. Đây chính xác là trường hợp người
    // dùng báo cáo (ảnh "Phân Quyền": chỉ tick "📷 Ghi Nhận Trên Kệ", KHÔNG tick "🖥️ Quản Lý Danh Mục
    // Quầy Kệ").
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true
  };
  const SHELF_LOCATION = { id: 601, code: 'KE-B1', name: 'Kệ B1', category: 'Thực phẩm', dept: 'Siêu thị Quận 1', active: true };
  const state = createMockState({
    depts: ['Siêu thị Quận 1'], users: [USER],
    shelfLocations: [SHELF_LOCATION], shelfRecords: []
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  const getShelfRecords = () => page.evaluate(() => DB.shelfRecords);

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubRecord');
    await page.waitForTimeout(80);

    // Tạo 1 ghi nhận để thao tác tiếp (CHÍNH quyền shelfRecordCreate đang test, phải tạo được).
    await run.run('Ghi nhận mới (shelfRecordCreate) -> tạo được, không lỗi', async () => {
      await page.fill('#srShelfLocationInput', `${SHELF_LOCATION.code} — ${SHELF_LOCATION.name}`);
      await page.evaluate(() => resolveShelfLocationInput());
      await page.fill('#srScanInput', 'SP001');
      await page.dispatchEvent('#srScanInput', 'input');
      await page.fill('#srProductName', 'Sản phẩm test 1');
      await page.fill('#srQuantity', '20');
      await page.click('#srForm button[type="submit"]');
      await page.waitForTimeout(100);
      const records = await getShelfRecords();
      assertEqual(records.length, 1, `Phải tạo được đúng 1 ghi nhận, thực tế: ${records.length}`);
    });

    await run.run('"✏️ Sửa" (chỉ có shelfRecordCreate, KHÔNG shelfLocationManage) -> lưu được, KHÔNG bị 403', async () => {
      const [record] = await getShelfRecords();
      await page.click(`[data-op="enterShelfRecordEditMode"][data-arg0="${record.id}"]`);
      await page.waitForTimeout(50);
      await page.fill(`#srEditQuantity_recent_${record.id}`, '15');
      await page.click(`[data-op="saveShelfRecordEdit"][data-arg0="${record.id}"]`);
      await page.waitForTimeout(100);
      const [updated] = await getShelfRecords();
      assertEqual(updated.quantity, 15, `"✏️ Sửa" phải lưu đúng số lượng mới, thực tế: ${updated.quantity}`);
      assertEqual(updated.lastEditedByName, USER.name, `"✏️ Sửa" phải ghi đúng tên người vừa thao tác vào lastEditedByName, thực tế: ${updated.lastEditedByName}`);
      assert(!!updated.lastEditedAt, 'lastEditedAt phải được set sau khi Sửa');
      const cellText = await page.evaluate((id) => document.querySelector(`[data-op="enterShelfRecordEditMode"][data-arg0="${id}"]`).closest('tr').children[7].textContent, record.id);
      assert(cellText.includes(USER.name), `Cột "Người Cập Nhật Gần Nhất" trên bảng phải hiện đúng tên, thực tế: "${cellText}"`);
    });

    await run.run('"💾 Cập Nhật" (ô "SL hiện tại") -> lưu được, KHÔNG bị 403', async () => {
      const [record] = await getShelfRecords();
      await page.fill(`#srQuickQty_recent_${record.id}`, '9');
      await page.click(`[data-op="quickUpdateShelfRecordQuantity"][data-arg0="${record.id}"]`);
      await page.waitForTimeout(100);
      const [updated] = await getShelfRecords();
      assertEqual(updated.quantity, 9, `"💾 Cập Nhật" phải lưu đúng số lượng mới, thực tế: ${updated.quantity}`);
      assertEqual(updated.lastEditedByName, USER.name, `"💾 Cập Nhật" phải ghi đúng tên người vừa thao tác vào lastEditedByName, thực tế: ${updated.lastEditedByName}`);
    });

    await run.run('"✅ Bán Hết" -> set quantity=0, dừng theo dõi, KHÔNG bị 403', async () => {
      const [record] = await getShelfRecords();
      page.once('dialog', d => d.accept());
      await page.click(`[data-op="markShelfRecordSoldOut"][data-arg0="${record.id}"]`);
      await page.waitForTimeout(100);
      const [updated] = await getShelfRecords();
      assertEqual(updated.quantity, 0, `"✅ Bán Hết" phải set quantity về 0, thực tế: ${updated.quantity}`);
    });

    // Tạo thêm 1 ghi nhận khác để test Xóa (dòng vừa Bán Hết ở trên chỉ còn nút "🗑️ Xóa" đơn độc).
    await run.run('Chuẩn bị: tạo thêm 1 ghi nhận để test "🗑️ Xóa"', async () => {
      await page.fill('#srShelfLocationInput', `${SHELF_LOCATION.code} — ${SHELF_LOCATION.name}`);
      await page.evaluate(() => resolveShelfLocationInput());
      await page.fill('#srScanInput', 'SP002');
      await page.dispatchEvent('#srScanInput', 'input');
      await page.fill('#srProductName', 'Sản phẩm test 2');
      await page.fill('#srQuantity', '5');
      await page.click('#srForm button[type="submit"]');
      await page.waitForTimeout(100);
      const records = await getShelfRecords();
      assertEqual(records.length, 2, `Phải có đủ 2 ghi nhận, thực tế: ${records.length}`);
    });

    await run.run('"🗑️ Xóa" (chỉ có shelfRecordCreate) -> xoá được, KHÔNG bị 403', async () => {
      const records = await getShelfRecords();
      const toDelete = records.find(r => r.maHang === 'SP002');
      page.once('dialog', d => d.accept());
      await page.click(`[data-op="deleteShelfRecordClient"][data-arg0="${toDelete.id}"]`);
      await page.waitForTimeout(100);
      const after = await getShelfRecords();
      assert(!after.some(r => r.id === toDelete.id), '"🗑️ Xóa" phải xoá vĩnh viễn đúng dòng, không còn trong DB.shelfRecords');
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh trong suốt kịch bản: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
