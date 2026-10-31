// tests/test-shelf-record-lo-real-click.js — "📷 Ghi Nhận" (Kiểm Soát Hàng Hóa) THIẾT KẾ LẠI "Ghi Nhận
// Theo Lô" (11/2026, theo yêu cầu người dùng): test UI THẬT bằng Playwright page.click()/page.fill() cho:
// (1) scan lại ĐÚNG Quầy Kệ+Mã Hàng+Hạn Sử Dụng của 1 dòng ĐANG theo dõi -> CẬP NHẬT số lượng (không
// cộng dồn), (2) Hạn Sử Dụng khác -> tạo lô MỚI, (3) nút "✏️ Sửa" sửa trực tiếp trên bảng, (4) nút
// "🗑️ Xóa" xoá vĩnh viễn, (5) "✅ Bán Hết" set quantity=0 -> dừng theo dõi (ẩn khỏi Hạn Sử Dụng mặc
// định, hiện lại khi tick "Hiện cả dòng đã bán hết"), (6) ô "SL đã bán" + nút "➖ Trừ" trừ đúng số lượng,
// (7) cột "Tồn Kho Hệ Thống" ở tab Hạn Sử Dụng gộp ĐÚNG theo TỔNG nhiều lô/hạn sử dụng khác nhau CỦA
// CÙNG 1 mã hàng (không so riêng từng dòng) + phân loại đỏ/vàng đúng biên 90% (bù sai số dấu phẩy động,
// cùng khuôn SHELF_THRESHOLD_FP_EPSILON đã vá ở Ngưỡng Tồn). CHÚ Ý: DB/window là biến TRONG TRÌNH DUYỆT
// — mọi lần đọc đều phải qua page.evaluate(), không được đọc trực tiếp ở ngữ cảnh Node (bug đã gặp ở bản
// nháp đầu, "DB is not defined" — Node và trình duyệt là 2 tiến trình/ngữ cảnh RIÊNG BIỆT).
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8981;
  const USER = {
    username: 'cht1', name: 'Cửa Hàng Trưởng Q1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true, email: 'cht1@hcrc.vn'
  };
  const SHELF_LOCATION = { id: 501, code: 'KE-A1', name: 'Kệ A1', category: 'Thực phẩm', dept: 'Siêu thị Quận 1', active: true };
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
  const findRecordByExpiry = async (prefix) => {
    const records = await getShelfRecords();
    return records.find(r => r.expiryDate && r.expiryDate.startsWith(prefix));
  };

  async function fillShelfRecordForm({ maHang, productName, quantity, expiryDate }) {
    await page.fill('#srShelfLocationInput', `${SHELF_LOCATION.code} — ${SHELF_LOCATION.name}`);
    await page.evaluate(() => resolveShelfLocationInput());
    await page.fill('#srMaHang', maHang);
    await page.fill('#srProductName', productName);
    await page.fill('#srQuantity', String(quantity));
    await page.fill('#srExpiryDate', expiryDate || '');
    await page.click('#srForm button[type="submit"]');
    await page.waitForTimeout(80);
  }

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubRecord');
    await page.waitForTimeout(50);

    await run.run('Ghi nhận lần 1 (SKU001, SL 9, hạn 2026-12-01) -> tạo lô mới qua ĐÚNG POST /api/shelf-stock/records/upsert', async () => {
      await fillShelfRecordForm({ maHang: 'SKU001', productName: 'Sữa tươi A', quantity: 9, expiryDate: '2026-12-01' });
      const records = await getShelfRecords();
      assertEqual(records.length, 1, `phải có đúng 1 bản ghi, thực tế: ${JSON.stringify(records)}`);
      assertEqual(records[0].quantity, 9);
      assertEqual(records[0].dept, 'Siêu thị Quận 1');
    });

    await run.run('Scan lại ĐÚNG Quầy Kệ+Mã Hàng+Hạn Sử Dụng (còn 2) -> CẬP NHẬT số lượng dòng cũ, KHÔNG tạo dòng mới', async () => {
      await fillShelfRecordForm({ maHang: 'SKU001', productName: 'Sữa tươi A', quantity: 2, expiryDate: '2026-12-01' });
      const records = await getShelfRecords();
      assertEqual(records.length, 1, `phải vẫn chỉ 1 bản ghi (ghi đè, không cộng dồn), thực tế: ${JSON.stringify(records)}`);
      assertEqual(records[0].quantity, 2, 'số lượng phải GHI ĐÈ thành 2, không cộng dồn 9+2');
    });

    await run.run('Cùng Mã Hàng nhưng Hạn Sử Dụng KHÁC (2026-06-15) -> tạo LÔ MỚI (dòng thứ 2), không đè lô cũ', async () => {
      await fillShelfRecordForm({ maHang: 'SKU001', productName: 'Sữa tươi A', quantity: 5, expiryDate: '2026-06-15' });
      const records = await getShelfRecords();
      assertEqual(records.length, 2, `phải có 2 lô (2 hạn khác nhau), thực tế: ${JSON.stringify(records)}`);
      const batch1 = records.find(r => r.expiryDate && r.expiryDate.startsWith('2026-12-01'));
      const batch2 = records.find(r => r.expiryDate && r.expiryDate.startsWith('2026-06-15'));
      assert(batch1 && batch1.quantity === 2, `lô hạn 12/2026 phải giữ nguyên SL 2, thực tế: ${JSON.stringify(batch1)}`);
      assert(batch2 && batch2.quantity === 5, `lô hạn 06/2026 phải là lô mới SL 5, thực tế: ${JSON.stringify(batch2)}`);
    });

    await run.run('Nút "✏️ Sửa" trên bảng Ghi Nhận gần đây -> đổi SL + Lưu THẬT qua PATCH /api/shelf-stock/records/:id', async () => {
      const batch2 = await findRecordByExpiry('2026-06-15');
      await page.click(`[data-op="enterShelfRecordEditMode"][data-arg0="${batch2.id}"]`);
      await page.waitForTimeout(30);
      await page.fill(`#srEditQuantity_${batch2.id}`, '7');
      await page.click(`[data-op="saveShelfRecordEdit"][data-arg0="${batch2.id}"]`);
      await page.waitForTimeout(80);
      const updated = (await getShelfRecords()).find(r => r.id === batch2.id);
      assertEqual(updated.quantity, 7, `phải lưu đúng SL mới 7, thực tế: ${JSON.stringify(updated)}`);
    });

    await run.run('Ô "SL đã bán" + nút "➖ Trừ" -> trừ đúng vào SL đang theo dõi (7 - 3 = 4)', async () => {
      const batch2 = await findRecordByExpiry('2026-06-15');
      await page.fill(`#srDeduct_${batch2.id}`, '3');
      await page.click(`[data-op="deductShelfRecordSold"][data-arg0="${batch2.id}"]`);
      await page.waitForTimeout(80);
      const updated = (await getShelfRecords()).find(r => r.id === batch2.id);
      assertEqual(updated.quantity, 4, `phải còn 4, thực tế: ${JSON.stringify(updated)}`);
    });

    await run.run('Nút "✅ Bán Hết" (lô hạn 12/2026, SL 2) -> SL về 0, dừng theo dõi, confirm() tự true (test stub)', async () => {
      const batch1 = await findRecordByExpiry('2026-12-01');
      await page.click(`[data-op="markShelfRecordSoldOut"][data-arg0="${batch1.id}"]`);
      await page.waitForTimeout(80);
      const updated = (await getShelfRecords()).find(r => r.id === batch1.id);
      assertEqual(updated.quantity, 0, `phải về 0, thực tế: ${JSON.stringify(updated)}`);
    });

    await run.run('Scan lại ĐÚNG Mã Hàng+Hạn 2026-12-01 (đã bán hết, SL=0) -> KHÔNG "hồi sinh" dòng cũ, phải tạo LÔ MỚI tinh', async () => {
      const before = (await getShelfRecords()).length;
      await fillShelfRecordForm({ maHang: 'SKU001', productName: 'Sữa tươi A', quantity: 6, expiryDate: '2026-12-01' });
      const records = await getShelfRecords();
      assertEqual(records.length, before + 1, `phải thêm 1 dòng MỚI (không ghi đè dòng đã về 0), thực tế: ${JSON.stringify(records)}`);
      const newBatch = records.find(r => r.expiryDate && r.expiryDate.startsWith('2026-12-01') && r.quantity === 6);
      assert(newBatch, `phải có lô mới SL 6, thực tế: ${JSON.stringify(records)}`);
      const soldOutOld = records.find(r => r.expiryDate && r.expiryDate.startsWith('2026-12-01') && r.quantity === 0);
      assert(soldOutOld, `dòng cũ đã bán hết (SL 0) vẫn phải còn lưu lịch sử, thực tế: ${JSON.stringify(records)}`);
    });

    await run.run('Nút "🗑️ Xóa" -> xoá vĩnh viễn qua DELETE /api/shelf-stock/records/:id, confirm() tự true', async () => {
      const records = await getShelfRecords();
      const newBatch = records.find(r => r.expiryDate && r.expiryDate.startsWith('2026-12-01') && r.quantity === 6);
      const before = records.length;
      await page.click(`[data-op="deleteShelfRecordClient"][data-arg0="${newBatch.id}"]`);
      await page.waitForTimeout(80);
      const after = await getShelfRecords();
      assertEqual(after.length, before - 1, `phải giảm đúng 1 dòng, thực tế: ${JSON.stringify(after)}`);
      assert(!after.some(r => r.id === newBatch.id), 'dòng đã xoá không còn trong DB.shelfRecords');
    });

    await run.run('Tab "⏰ Hạn Sử Dụng": mặc định CHỈ hiện dòng còn theo dõi (SL>0), ẨN dòng đã bán hết', async () => {
      await page.click('#btnVhShelfSubExpiry');
      await page.waitForTimeout(50);
      const bodyText = await page.evaluate(() => document.getElementById('vhShelfExpiryBody').textContent);
      assert(bodyText.includes('Sữa tươi A'), `phải thấy dòng còn theo dõi, thực tế: ${bodyText}`);
      const soldOutRows = await page.evaluate(() => [...document.querySelectorAll('#vhShelfExpiryBody tr')].filter(tr => tr.textContent.includes('Đã bán hết')).length);
      assertEqual(soldOutRows, 0, 'KHÔNG được hiện dòng đã bán hết khi chưa tick checkbox');
    });

    await run.run('Tick "Hiện cả dòng đã bán hết" -> hiện lại dòng SL=0 với badge "Đã bán hết — ngừng theo dõi"', async () => {
      await page.click('#vhShelfExpiryShowSoldOut');
      await page.waitForTimeout(50);
      const soldOutRows = await page.evaluate(() => [...document.querySelectorAll('#vhShelfExpiryBody tr')].filter(tr => tr.textContent.includes('Đã bán hết')).length);
      assert(soldOutRows >= 1, `phải hiện lại ít nhất 1 dòng đã bán hết, thực tế đếm được: ${soldOutRows}`);
      await page.click('#vhShelfExpiryShowSoldOut'); // untick lại để các bước sau không bị ảnh hưởng
      await page.waitForTimeout(50);
    });

    await run.run('Cột "Tồn Kho Hệ Thống": gộp TỔNG nhiều lô cùng Mã Hàng (không so riêng từng dòng) + phân loại đúng biên 90%', async () => {
      // Trạng thái active SKU001 lúc này: lô hạn 06/2026 (SL 4, sau Sửa+Trừ) + lô hạn 12/2026 bị Bán Hết
      // (SL 0, không tính). Thêm 1 lô mới (hạn 09/2026, SL 6) để TỔNG active = 4 + 6 = 10, rồi seed tồn
      // kho hệ thống = 9 (đúng trong khoảng 10% dưới tổng -> phải tô VÀNG) để kiểm phân loại GỘP NHÓM
      // (không so riêng từng dòng — 1 dòng lô luôn nhỏ hơn tổng nên so riêng sẽ luôn "an toàn" giả).
      await page.click('#btnVhShelfSubRecord');
      await page.waitForTimeout(30);
      await fillShelfRecordForm({ maHang: 'SKU001', productName: 'Sữa tươi A', quantity: 6, expiryDate: '2026-09-09' });
      const activeTotal = (await getShelfRecords()).filter(r => r.maHang === 'SKU001' && Number(r.quantity) > 0)
        .reduce((sum, r) => sum + Number(r.quantity), 0);
      assertEqual(activeTotal, 10, `tổng active SKU001 phải là 10 trước khi seed tồn kho hệ thống, thực tế: ${activeTotal}`);
      // state là object Node.js (cùng tham chiếu đã truyền vào createDispatcher() qua launchPage()) — set
      // trực tiếp ở NGỮ CẢNH NODE này, KHÔNG qua page.evaluate() (đó là ngữ cảnh trình duyệt, không đọc
      // được biến Node.js phía test) — dispatcher đọc state.__mockSystemInventoryRows khi trang gọi GET.
      state.__mockSystemInventoryRows = [{ maHang: 'SKU001', maVach: '', soLuongTon: 9 }];
      await page.click('#btnVhShelfSubExpiry');
      await page.waitForTimeout(100);
      const cellTexts = await page.evaluate(() => [...document.querySelectorAll('#vhShelfExpiryBody tr')].map(tr => tr.textContent));
      const hasGroupNote = cellTexts.some(t => t.includes('tổng theo dõi mã này: 10'));
      assert(hasGroupNote, `phải hiện chú thích tổng theo nhóm mã hàng (10), thực tế: ${JSON.stringify(cellTexts)}`);
      const yellowRow = await page.evaluate(() => [...document.querySelectorAll('#vhShelfExpiryBody tr')].some(tr => tr.className.includes('bg-amber-50')));
      assert(yellowRow, 'tồn kho hệ thống (9) thấp hơn tổng theo dõi (10) trong khoảng 10% -> phải tô vàng (YELLOW), không phải đỏ/an toàn');
      const redRow = await page.evaluate(() => [...document.querySelectorAll('#vhShelfExpiryBody tr')].some(tr => tr.className.includes('bg-red-50')));
      assert(!redRow, 'KHÔNG được tô đỏ (lệch chỉ 10%, đúng biên YELLOW, không phải RED >10%)');
    });

    await run.run('Không có lỗi console.error/pageerror nào trong suốt quá trình thao tác THẬT', async () => {
      assertEqual(jsErrors.length, 0, `phải 0 lỗi, thực tế: ${JSON.stringify(jsErrors)}`);
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
