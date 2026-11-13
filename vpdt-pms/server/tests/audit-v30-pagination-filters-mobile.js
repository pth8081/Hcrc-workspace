// server/tests/audit-v30-pagination-filters-mobile.js
//
// AUDIT THỰC TẾ (11/2026, version 30.28-30.30) — Playwright lái trình duyệt THẬT, thao tác đúng như
// người dùng (bấm nút, gõ liệu) để kiểm tra:
//   1. Phân trang RANH GIỚI (9/10/11/21 dòng, pageSize mặc định 10) cho 5 bảng "Kiểm Soát Hàng Hóa":
//      Ghi Nhận (shelfRecordRecent), Hạn Sử Dụng (shelfExpiry), Quầy Kệ (shelfLocation),
//      Đối Chiếu (shelfRecon), Báo Cáo (shelfReport). Bấm "Trang sau"(›)/"Trang cuối"(»), đổi
//      "Hiển thị X dòng/trang".
//   2. Bộ lọc kết hợp NHIỀU điều kiện cùng lúc (AND, không phải chỉ đúng điều kiện cuối gõ) ở
//      Ghi Nhận và Hạn Sử Dụng.
//   3. Xoá hết filter đang áp dụng -> trang tự reset về 1 (tránh đứng ở trang rỗng/trang cũ).
//   4. Responsive mobile (390px): cột "Người Cập Nhật Gần Nhất" không vỡ bảng, bộ lọc ngày không tràn.
//
// Chạy: node server/tests/audit-v30-pagination-filters-mobile.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8979;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'audit-v30-28-30');
const DEPT = 'Siêu thị Quận 1';
const USER = {
  username: 'nv1', name: 'Nhân Viên 1', dept: DEPT,
  perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true
};
const LOC_CODES = ['KE-1', 'KE-2', 'KE-3', 'KE-4', 'KE-5', 'KE-6'];
const CATS = ['Mỹ phẩm', 'Đồ uống', 'Bánh kẹo', 'Gia dụng'];

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

// 21 bản ghi "shelfRecords" ĐỦ DÙNG cho cả 4 bảng Ghi Nhận/Hạn Sử Dụng/Báo Cáo/Đối Chiếu (maHang RIÊNG
// BIỆT từng dòng để Đối Chiếu — gộp theo maHang — cũng ra đúng N dòng khi cắt N bản ghi đầu).
function buildFullRecords() {
  const now = Date.now();
  return Array.from({ length: 21 }, (_, i) => {
    const loc = LOC_CODES[i % LOC_CODES.length];
    const ts = new Date(now - i * 3600000).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    return {
      id: i + 1, dept: DEPT,
      shelfLocationId: 900 + (i % LOC_CODES.length), shelfLocationCode: loc, shelfLocationName: `Kệ ${loc}`,
      maHang: `SP${String(i + 1).padStart(3, '0')}`, maVach: `8930000${String(i + 1).padStart(6, '0')}`,
      productName: `Sản phẩm demo ${i + 1}`, quantity: 5 + (i % 10),
      expiryDate: new Date(now + (10 + i) * 86400000).toISOString(),
      creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: ts, lastScannedAt: ts,
      ...(i % 5 === 0 ? { lastEditedBy: 'nv1', lastEditedByName: 'Nguyễn Thị Cập Nhật Tên Rất Dài Để Demo Responsive Mobile', lastEditedAt: ts } : {})
    };
  });
}
function buildFullLocations() {
  return Array.from({ length: 21 }, (_, i) => ({
    id: 2000 + i, code: `KE-CAT-${String(i + 1).padStart(3, '0')}`, name: `Quầy Kệ Số ${i + 1}`,
    category: CATS[i % CATS.length], dept: DEPT, active: true
  }));
}

async function setRecordCount(page, state, fullRecords, n) {
  await page.evaluate(({ all, n }) => { DB.shelfRecords = all.slice(0, n); }, { all: fullRecords, n });
  state.shelfRecords = fullRecords.slice(0, n);
}
async function setLocationCount(page, fullLocations, n) {
  await page.evaluate(({ all, n }) => { DB.shelfLocations = all.slice(0, n); }, { all: fullLocations, n });
}

async function rowCount(page, selector) {
  return page.locator(selector).locator('tr').count();
}

// Kiểm tra ĐẦY ĐỦ 1 bảng cho 1 giá trị N: pageInfoText đúng, số dòng trang 1 đúng, (nếu >1 trang) bấm
// "Trang sau"(›) + "Trang cuối"(») load đúng dữ liệu, quay lại "Trang đầu"(«) đúng dữ liệu cũ.
async function verifyPaginationBoundary(page, moduleKey, tbodySelector, n, unitLabel) {
  const pageSize = 10;
  const totalPages = Math.ceil(n / pageSize) || 1;
  const infoSel = `#pageInfoText_${moduleKey}`;
  const btnsSel = `#paginationButtons_${moduleKey}`;

  const info1 = (await page.locator(infoSel).innerText()).trim();
  assert.strictEqual(info1, `Trang 1/${totalPages} (Tổng ${n} ${unitLabel})`,
    `[${moduleKey} n=${n}] LỖI: pageInfoText trang 1 sai -> "${info1}"`);
  const rows1 = await rowCount(page, tbodySelector);
  assert.strictEqual(rows1, Math.min(n, pageSize), `[${moduleKey} n=${n}] LỖI: số dòng trang 1 sai (${rows1})`);

  if (totalPages > 1) {
    // "Trang cuối" (») từ trang 1 -> đúng trang cuối + đúng SỐ DÒNG CÒN LẠI (phần dư)
    await page.locator(btnsSel).getByText('»', { exact: true }).click();
    await page.waitForTimeout(120);
    const infoLast = (await page.locator(infoSel).innerText()).trim();
    assert.strictEqual(infoLast, `Trang ${totalPages}/${totalPages} (Tổng ${n} ${unitLabel})`,
      `[${moduleKey} n=${n}] LỖI: bấm "Trang cuối" sai -> "${infoLast}"`);
    const expectedLastRows = n - (totalPages - 1) * pageSize;
    const rowsLast = await rowCount(page, tbodySelector);
    assert.strictEqual(rowsLast, expectedLastRows, `[${moduleKey} n=${n}] LỖI: số dòng trang cuối sai (${rowsLast}, cần ${expectedLastRows})`);

    // "Trang đầu" («) -> quay lại đúng trang 1 (nút «/» chỉ enable khi chưa đứng ở đầu/cuối, nên luôn
    // bấm NGAY SAU KHI vừa đứng ở trang cuối — tránh bấm vào nút đang bị disabled).
    await page.locator(btnsSel).getByText('«', { exact: true }).click();
    await page.waitForTimeout(120);
    const infoBack = (await page.locator(infoSel).innerText()).trim();
    assert.strictEqual(infoBack, `Trang 1/${totalPages} (Tổng ${n} ${unitLabel})`,
      `[${moduleKey} n=${n}] LỖI: bấm "Trang đầu" không quay lại đúng trang 1 -> "${infoBack}"`);

    // "Trang sau" (›) từ trang 1 -> trang 2 (chỉ còn khả năng áp dụng khi có từ 3 trang trở lên, để
    // tránh bấm trúng nút "Trang cuối"/"Trang sau" đã bị disabled vì trùng đúng trang cuối).
    if (totalPages > 2) {
      await page.locator(btnsSel).getByText('›', { exact: true }).click();
      await page.waitForTimeout(120);
      const info2 = (await page.locator(infoSel).innerText()).trim();
      assert.strictEqual(info2, `Trang 2/${totalPages} (Tổng ${n} ${unitLabel})`,
        `[${moduleKey} n=${n}] LỖI: bấm "Trang sau" không sang đúng trang 2 -> "${info2}"`);
      const rows2 = await rowCount(page, tbodySelector);
      assert.strictEqual(rows2, pageSize, `[${moduleKey} n=${n}] LỖI: số dòng trang 2 sai (${rows2})`);
      // "Trang trước" (‹) -> quay lại trang 1, dọn sạch state cho bước kiểm tra kế tiếp.
      await page.locator(btnsSel).getByText('‹', { exact: true }).click();
      await page.waitForTimeout(120);
    }
  }
  console.log(`  PASS [n=${n}] ${moduleKey}: Trang 1/${totalPages}, dòng trang 1=${rows1}${totalPages > 1 ? ', Trang sau/Trang cuối/Trang đầu đều đúng' : ''}`);
}

// Đổi "Hiển thị X dòng/trang" -> 20, xác nhận số trang + số dòng đổi đúng, rồi trả lại 10 (tránh làm
// lệch state cho N tiếp theo trong vòng lặp).
async function verifyChangePageSize(page, moduleKey, tbodySelector, n, unitLabel) {
  const boxSel = `#paginationBox_${moduleKey} select`;
  await page.selectOption(boxSel, '20');
  await page.waitForTimeout(120);
  const totalPages20 = Math.ceil(n / 20);
  const info = (await page.locator(`#pageInfoText_${moduleKey}`).innerText()).trim();
  assert.strictEqual(info, `Trang 1/${totalPages20} (Tổng ${n} ${unitLabel})`,
    `[${moduleKey} n=${n}] LỖI: đổi "20 dòng/trang" sai pageInfoText -> "${info}"`);
  const rows = await rowCount(page, tbodySelector);
  assert.strictEqual(rows, Math.min(n, 20), `[${moduleKey} n=${n}] LỖI: đổi "20 dòng/trang" sai số dòng hiển thị (${rows})`);
  console.log(`  PASS [n=${n}] ${moduleKey}: đổi "Hiển thị 20 dòng/trang" -> Trang 1/${totalPages20}, ${rows} dòng`);
  // Trả lại 10 dòng/trang cho vòng lặp kế tiếp.
  await page.selectOption(boxSel, '10');
  await page.waitForTimeout(120);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fullRecords = buildFullRecords();
  const fullLocations = buildFullLocations();
  const inventoryRows = fullRecords.map(r => ({ maHang: r.maHang, tenHang: r.productName, soLuongTon: 999 }));

  const state = createMockState({
    depts: [DEPT], users: [USER],
    shelfLocations: fullLocations.slice(), shelfRecords: fullRecords.slice(),
    __mockSystemInventoryRows: inventoryRows
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });

  let failures = 0;
  async function step(name, fn) {
    try { await fn(); console.log(`PASS: ${name}`); }
    catch (err) { failures++; console.log(`FAIL: ${name}\n  -> ${err && err.message ? err.message : err}`); }
  }

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');

    // ============================================================
    // 1) PHÂN TRANG RANH GIỚI (9/10/11/21) — 5 bảng
    // ============================================================
    // LƯU Ý: dùng data-op="setVanHanhShelfSubTab" (bấm nút tab thật, giống người dùng) để mở ĐÚNG đúng
    // wrap div đang ẩn (classList 'hidden') trước khi thao tác trên nó — gọi thẳng hàm renderXxx() qua
    // evaluate() mà KHÔNG chuyển tab trước sẽ để wrap div ở trạng thái ẩn, Playwright không click được
    // (element is not visible) vào các nút phân trang bên trong, như phát hiện thực tế ở lượt chạy đầu.
    for (const n of [9, 10, 11, 21]) {
      await setRecordCount(page, state, fullRecords, n);
      await setLocationCount(page, fullLocations, n);

      await step(`[Ghi Nhận] phân trang ranh giới n=${n}`, async () => {
        await page.click('#btnVhShelfSubRecord');
        await page.waitForTimeout(150);
        await verifyPaginationBoundary(page, 'shelfRecordRecent', '#vhShelfRecordRecentBody', n, 'ghi nhận');
      });
      await step(`[Hạn Sử Dụng] phân trang ranh giới n=${n}`, async () => {
        await page.click('#btnVhShelfSubExpiry');
        await page.waitForTimeout(150);
        await verifyPaginationBoundary(page, 'shelfExpiry', '#vhShelfExpiryBody', n, 'sản phẩm');
      });
      await step(`[Báo Cáo] phân trang ranh giới n=${n}`, async () => {
        await page.click('#btnVhShelfSubReport');
        await page.waitForTimeout(150);
        await verifyPaginationBoundary(page, 'shelfReport', '#shelfReportBody', n, 'dòng');
      });
      await step(`[Quầy Kệ] phân trang ranh giới n=${n}`, async () => {
        await page.click('#btnVhShelfSubLocations');
        await page.waitForTimeout(150);
        await verifyPaginationBoundary(page, 'shelfLocation', '#vhShelfLocationsBody', n, 'quầy kệ');
      });
      await step(`[Đối Chiếu] phân trang ranh giới n=${n}`, async () => {
        await page.click('#btnVhShelfSubRecon');
        await page.waitForTimeout(200);
        await verifyPaginationBoundary(page, 'shelfRecon', '#vhShelfReconBody', n, 'mã hàng');
      });
    }

    // Đổi "Hiển thị X dòng/trang" — kiểm riêng cho n=21 (trường hợp nhiều trang nhất) ở cả 5 bảng.
    await setRecordCount(page, state, fullRecords, 21);
    await setLocationCount(page, fullLocations, 21);
    await step('[Ghi Nhận] đổi "Hiển thị X dòng/trang"', async () => {
      await page.click('#btnVhShelfSubRecord');
      await page.waitForTimeout(150);
      await verifyChangePageSize(page, 'shelfRecordRecent', '#vhShelfRecordRecentBody', 21, 'ghi nhận');
    });
    await step('[Hạn Sử Dụng] đổi "Hiển thị X dòng/trang"', async () => {
      await page.click('#btnVhShelfSubExpiry');
      await page.waitForTimeout(150);
      await verifyChangePageSize(page, 'shelfExpiry', '#vhShelfExpiryBody', 21, 'sản phẩm');
    });
    await step('[Báo Cáo] đổi "Hiển thị X dòng/trang"', async () => {
      await page.click('#btnVhShelfSubReport');
      await page.waitForTimeout(150);
      await verifyChangePageSize(page, 'shelfReport', '#shelfReportBody', 21, 'dòng');
    });
    await step('[Quầy Kệ] đổi "Hiển thị X dòng/trang"', async () => {
      await page.click('#btnVhShelfSubLocations');
      await page.waitForTimeout(150);
      await verifyChangePageSize(page, 'shelfLocation', '#vhShelfLocationsBody', 21, 'quầy kệ');
    });
    await step('[Đối Chiếu] đổi "Hiển thị X dòng/trang"', async () => {
      await page.click('#btnVhShelfSubRecon');
      await page.waitForTimeout(200);
      await verifyChangePageSize(page, 'shelfRecon', '#vhShelfReconBody', 21, 'mã hàng');
    });

    await shot(page, '#vanHanhShelfWrap', '1-phan-trang-21-dong-bao-cao.png');

    // ============================================================
    // 2) BỘ LỌC KẾT HỢP NHIỀU ĐIỀU KIỆN CÙNG LÚC (AND) — Ghi Nhận + Hạn Sử Dụng
    // ============================================================
    // Dữ liệu riêng, nhỏ, THIẾT KẾ ĐỂ PHÂN BIỆT RÕ "khớp cả 3 điều kiện" vs "chỉ khớp 1-2 điều kiện":
    //   id1: KE-1, ghi nhận GẦN đây (2 ngày trước), SL=15  -> khớp CẢ 3 điều kiện dưới đây.
    //   id2: KE-2 (sai quầy kệ),      ghi nhận GẦN đây,      SL=15  -> chỉ khớp 2/3.
    //   id3: KE-1,                    ghi nhận XA (20 ngày),  SL=15  -> chỉ khớp 2/3.
    //   id4: KE-1,                    ghi nhận GẦN đây,       SL=3 (thiếu)  -> chỉ khớp 2/3.
    const now = Date.now();
    const fmt = (ms) => new Date(ms).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const nearTs = fmt(now - 2 * 86400000);
    const farTs = fmt(now - 20 * 86400000);
    const combRecords = [
      { id: 101, dept: DEPT, shelfLocationId: 1, shelfLocationCode: 'KE-1', shelfLocationName: 'Kệ KE-1', maHang: 'CB001', maVach: 'V001', productName: 'Khớp cả 3 điều kiện', quantity: 15, expiryDate: new Date(now + 15 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: nearTs, lastScannedAt: nearTs },
      { id: 102, dept: DEPT, shelfLocationId: 2, shelfLocationCode: 'KE-2', shelfLocationName: 'Kệ KE-2', maHang: 'CB002', maVach: 'V002', productName: 'Sai quầy kệ', quantity: 15, expiryDate: new Date(now + 15 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: nearTs, lastScannedAt: nearTs },
      { id: 103, dept: DEPT, shelfLocationId: 1, shelfLocationCode: 'KE-1', shelfLocationName: 'Kệ KE-1', maHang: 'CB003', maVach: 'V003', productName: 'Ghi nhận quá xa', quantity: 15, expiryDate: new Date(now + 15 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: farTs, lastScannedAt: farTs },
      { id: 104, dept: DEPT, shelfLocationId: 1, shelfLocationCode: 'KE-1', shelfLocationName: 'Kệ KE-1', maHang: 'CB004', maVach: 'V004', productName: 'Số lượng thiếu', quantity: 3, expiryDate: new Date(now + 15 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: nearTs, lastScannedAt: nearTs }
    ];
    await setRecordCount(page, state, combRecords, 4);
    const fromDateStr = new Date(now - 5 * 86400000).toISOString().slice(0, 10);

    await step('[Ghi Nhận] lọc kết hợp Quầy Kệ + Số Lượng Từ cùng lúc -> chỉ đúng giao (AND)', async () => {
      await page.click('#btnVhShelfSubRecord');
      await page.waitForTimeout(150);
      await page.click('#btnToggleShelfRecordRecentFilter');
      await page.fill('#srfShelfLocation', 'KE-1');
      await page.fill('#srfQtyMin', '10');
      await page.waitForTimeout(150);
      // Ghi Nhận KHÔNG có bộ lọc ngày (chỉ Hạn Sử Dụng mới có) — kết hợp ĐÚNG 2 điều kiện "Quầy Kệ=KE-1"
      // VÀ "Số Lượng >= 10" phải ra giao (AND) của 2 điều kiện: record 103 (KE-1, SL=15, "Ghi nhận quá
      // xa") VẪN khớp (không có field ngày để loại), CHỈ record 102 (KE-2, sai quầy kệ) và record 104
      // (SL=3, thiếu) bị loại — nếu lọc theo kiểu OR hoặc "chỉ điều kiện gõ cuối" sẽ ra kết quả KHÁC hẳn
      // (VD chỉ lọc SL>=10 riêng sẽ có thêm record 102; chỉ lọc KE-1 riêng sẽ có thêm record 104).
      const names = await page.locator('#vhShelfRecordRecentBody tr td:nth-child(2)').allTextContents();
      assert.deepStrictEqual(names.map(s => s.trim()), ['Ghi nhận quá xa', 'Khớp cả 3 điều kiện'],
        `LỖI: lọc kết hợp Ghi Nhận (Quầy Kệ=KE-1 + SL>=10, CÙNG LÚC) phải ra ĐÚNG giao (AND) của 2 điều kiện, không phải OR/chỉ điều kiện cuối. Thực tế: ${JSON.stringify(names)}`);
      await page.click('[data-op="clearShelfRecordRecentFilters"]');
      await page.waitForTimeout(120);
    });

    await step('[Hạn Sử Dụng] lọc kết hợp Quầy Kệ + Thời Gian Ghi Nhận + Số Lượng cùng lúc -> chỉ đúng giao (AND)', async () => {
      await page.click('#btnVhShelfSubExpiry');
      await page.waitForTimeout(150);
      await page.click('#btnToggleShelfExpiryFilter');
      await page.fill('#sefShelfLocation', 'KE-1');
      await page.dispatchEvent('#sefShelfLocation', 'input');
      await page.fill('#sefCreatedFrom', fromDateStr);
      await page.dispatchEvent('#sefCreatedFrom', 'change');
      await page.fill('#sefQtyMin', '10');
      await page.dispatchEvent('#sefQtyMin', 'input');
      await page.waitForTimeout(150);
      const names = await page.locator('#vhShelfExpiryBody tr td:nth-child(2)').allTextContents();
      assert.deepStrictEqual(names.map(s => s.trim()), ['Khớp cả 3 điều kiện'],
        `LỖI: lọc kết hợp Hạn Sử Dụng (Quầy Kệ=KE-1 + Ghi Nhận Từ + SL>=10, cả 3 CÙNG LÚC) phải CHỈ còn đúng 1 dòng khớp ĐỦ CẢ 3, không phải chỉ đúng điều kiện gõ cuối cùng. Thực tế: ${JSON.stringify(names)}`);
      await shot(page, '#vanHanhShelfWrap', '2-han-su-dung-loc-ket-hop-3-dieu-kien.png');
    });

    // ============================================================
    // 3) XOÁ FILTER -> TỰ RESET VỀ TRANG 1 (tránh đứng ở trang rỗng/trang cũ)
    // ============================================================
    await step('[Ghi Nhận] xoá filter đang áp dụng -> tự reset về trang 1 (không kẹt ở trang cũ)', async () => {
      await setRecordCount(page, state, fullRecords, 21);
      await page.evaluate(() => resetListPage('shelfRecordRecent'));
      await page.click('#btnVhShelfSubRecord');
      await page.waitForTimeout(150);
      // Đứng ở trang 3 (trang cuối, 21 dòng) của danh sách KHÔNG lọc.
      await page.locator('#paginationButtons_shelfRecordRecent').getByText('»', { exact: true }).click();
      await page.waitForTimeout(100);
      let info = (await page.locator('#pageInfoText_shelfRecordRecent').innerText()).trim();
      assert.strictEqual(info, 'Trang 3/3 (Tổng 21 ghi nhận)', `LỖI: chưa vào được trang 3 để thiết lập tình huống test -> "${info}"`);
      // Áp 1 filter chỉ khớp 2 dòng (còn 1 trang) -> fix cứng việc "resetListPage" tự chạy. Bấm nút "Hiện
      // Bộ Lọc" CHỈ KHI panel đang ẩn (nút này là TOGGLE — bấm khi đã mở từ bước test trước sẽ ẨN đi).
      const filterPanelHidden = await page.evaluate(() => document.getElementById('shelfRecordRecentFilterPanel')?.classList.contains('hidden'));
      if (filterPanelHidden) await page.click('#btnToggleShelfRecordRecentFilter');
      await page.fill('#srfMaHang', 'SP001');
      await page.waitForTimeout(120);
      info = (await page.locator('#pageInfoText_shelfRecordRecent').innerText()).trim();
      assert.strictEqual(info, 'Trang 1/1 (Tổng 1 ghi nhận)', `LỖI: áp filter phải tự về trang 1, không đứng ở trang 3 cũ (trang rỗng) -> "${info}"`);
      // XOÁ filter -> phải về lại trang 1 của toàn bộ 21 dòng (KHÔNG tự nhảy lại trang 3 cũ).
      await page.click('[data-op="clearShelfRecordRecentFilters"]');
      await page.waitForTimeout(120);
      info = (await page.locator('#pageInfoText_shelfRecordRecent').innerText()).trim();
      assert.strictEqual(info, 'Trang 1/3 (Tổng 21 ghi nhận)', `LỖI: xoá filter phải tự reset về Trang 1/3, không kẹt ở trang 3 cũ hay trang rỗng -> "${info}"`);
    });

    // ============================================================
    // 4) RESPONSIVE MOBILE (390px) — Ghi Nhận + Hạn Sử Dụng
    // ============================================================
    await step('[Mobile 390px] Ghi Nhận — không vỡ bảng, trang không tràn ngang', async () => {
      await page.click('#btnVhShelfSubRecord');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      const overflowInfo = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth
      }));
      assert.ok(overflowInfo.scrollW <= overflowInfo.innerW + 2,
        `LỖI: trang Ghi Nhận bị TRÀN NGANG ở mobile 390px (scrollWidth=${overflowInfo.scrollW} > innerWidth=${overflowInfo.innerW})`);
      // Cột "Người Cập Nhật Gần Nhất" — xác nhận ô chứa tên dài THẬT bị bọc đúng trong max-w-[110px], không
      // kéo dãn bảng/trang (cho phép dư chút padding/border, chặn ngưỡng 140px).
      const lastEditedWidth = await page.evaluate(() => {
        const cell = document.querySelector('#vhShelfRecordRecentBody tr td:nth-child(9) div');
        return cell ? cell.getBoundingClientRect().width : null;
      });
      assert.ok(lastEditedWidth !== null, 'LỖI: không tìm thấy ô "Người Cập Nhật Gần Nhất" có tên dài để kiểm tra');
      assert.ok(lastEditedWidth <= 140, `LỖI: ô "Người Cập Nhật Gần Nhất" rộng ${lastEditedWidth}px, vượt quá giới hạn max-w-[110px] mong đợi (vỡ bảng mobile)`);
      await shot(page, 'body', '3-mobile-390px-ghi-nhan.png');
    });

    await step('[Mobile 390px] Hạn Sử Dụng — bộ lọc ngày tháng không tràn ngang', async () => {
      await page.click('#btnVhShelfSubExpiry');
      await page.click('#btnToggleShelfExpiryFilter');
      await page.waitForTimeout(200);
      const overflowInfo = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        panelScrollW: document.getElementById('shelfExpiryFilterPanel')?.scrollWidth,
        panelClientW: document.getElementById('shelfExpiryFilterPanel')?.clientWidth
      }));
      assert.ok(overflowInfo.scrollW <= overflowInfo.innerW + 2,
        `LỖI: trang Hạn Sử Dụng (bộ lọc mở) bị TRÀN NGANG ở mobile 390px (scrollWidth=${overflowInfo.scrollW} > innerWidth=${overflowInfo.innerW})`);
      assert.ok(overflowInfo.panelScrollW <= overflowInfo.panelClientW + 2,
        `LỖI: khung bộ lọc ngày tháng "Hạn Sử Dụng" tự tràn ngang bên trong nó (scrollWidth=${overflowInfo.panelScrollW} > clientWidth=${overflowInfo.panelClientW})`);
      await shot(page, 'body', '4-mobile-390px-han-su-dung-bo-loc.png');
    });

    console.log(`\n==== ${failures === 0 ? 'TẤT CẢ' : (failures + ' LỖI trong')} scenario(s) đã chạy ====`);
    if (jsErrors.length) {
      failures++;
      console.log('FAIL: Có lỗi JS console/pageerror phát sinh trong suốt quá trình thao tác:\n  ' + jsErrors.join('\n  '));
    } else {
      console.log('PASS: Không có lỗi console.error/pageerror nào trong suốt quá trình thao tác THẬT');
    }
    console.log(`\nẢnh minh chứng đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
