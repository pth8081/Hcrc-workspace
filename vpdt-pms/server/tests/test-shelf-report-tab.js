// server/tests/test-shelf-report-tab.js
//
// DEMO thật (Playwright, PREVIEW — chưa merge) cho sub-tab MỚI "📑 Báo Cáo" trong "📊 Kiểm Soát Hàng Hóa"
// (11/2026, theo yêu cầu người dùng): "thêm 1 mục báo cáo để các siêu thị tự báo cáo danh sách những mặt
// hàng đã được đưa lên kệ... siêu thị login vào thì chỉ xem báo cáo siêu thị đấy thôi... và có 1 báo cáo
// tổng hợp người quản lý xem".
//
// Chụp 2 kịch bản:
//   1. Nhân viên siêu thị thường (không có shelfReportView) — chỉ thấy đúng siêu thị mình, KHÔNG có bộ
//      lọc "Siêu Thị" (DB.shelfRecords phía client đã được server lọc sẵn chỉ còn đúng siêu thị này) —
//      nhưng VẪN có cột "Siêu Thị" trong bảng/Excel (11/2026, theo yêu cầu người dùng "báo cáo này cho
//      tôi thêm cột siêu thị" — cột này LUÔN hiện từ nay, không còn điều kiện theo số lượng siêu thị
//      trong dữ liệu, xem renderShelfReportTable()/exportShelfReportExcel()).
//   2. Quản lý vùng (shelfReportView.all=true) — thấy NHIỀU siêu thị cùng lúc, bảng tự thêm bộ lọc
//      "Siêu Thị" — đây chính là "báo cáo tổng hợp".
//
// Chạy: node server/tests/test-shelf-report-tab.js
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-report-tab');

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

function seedShelfRecords(state) {
  const today = new Date().toISOString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  state.shelfRecords = [
    { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationCode: 'KA1', shelfLocationName: 'Kệ bánh kẹo', maHang: 'SP001', productName: 'Bánh quy HCRC 200g', quantity: 48, expiryDate: '2026-12-01', note: '', creator: 'nv1', creatorName: 'Nguyễn Thị Hàng', createdAt: today, lastScannedAt: today },
    { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationCode: 'KA1', shelfLocationName: 'Kệ bánh kẹo', maHang: 'SP002', productName: 'Sữa tươi HCRC 1L', quantity: 0, expiryDate: '2026-11-20', note: '', creator: 'nv1', creatorName: 'Nguyễn Thị Hàng', createdAt: yesterday, lastScannedAt: yesterday },
    { id: 3, dept: 'Siêu thị Quận 1', shelfLocationId: 2, shelfLocationCode: 'KB1', shelfLocationName: 'Kệ nước giải khát', maHang: 'SP003', productName: 'Nước suối Lavie 500ml', quantity: 120, expiryDate: '', note: '', creator: 'nv1', creatorName: 'Nguyễn Thị Hàng', createdAt: today, lastScannedAt: today },
    { id: 4, dept: 'Siêu thị Quận 3', shelfLocationId: 3, shelfLocationCode: 'KA1', shelfLocationName: 'Kệ bánh kẹo', maHang: 'SP001', productName: 'Bánh quy HCRC 200g', quantity: 30, expiryDate: '2026-12-15', note: '', creator: 'nv2', creatorName: 'Trần Văn Bình', createdAt: today, lastScannedAt: today },
    { id: 5, dept: 'Siêu thị Quận 3', shelfLocationId: 4, shelfLocationCode: 'KC1', shelfLocationName: 'Kệ mì gói', maHang: 'SP004', productName: 'Mì tôm Hảo Hảo', quantity: 0, expiryDate: '2026-10-01', note: '', creator: 'nv2', creatorName: 'Trần Văn Bình', createdAt: yesterday, lastScannedAt: yesterday }
  ];
  state.shelfLocations = [
    { id: 1, dept: 'Siêu thị Quận 1', code: 'KA1', name: 'Kệ bánh kẹo', active: true },
    { id: 2, dept: 'Siêu thị Quận 1', code: 'KB1', name: 'Kệ nước giải khát', active: true },
    { id: 3, dept: 'Siêu thị Quận 3', code: 'KA1', name: 'Kệ bánh kẹo', active: true },
    { id: 4, dept: 'Siêu thị Quận 3', code: 'KC1', name: 'Kệ mì gói', active: true }
  ];
}

async function openReportTab(page) {
  await page.evaluate(() => { switchTab('vanHanh'); });
  await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
  await page.click('#btnVhShelfSubReport');
  await page.waitForTimeout(300);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startStaticServer(PORT);

  // ===== Kịch bản 1: Nhân viên siêu thị thường — chỉ có đúng siêu thị mình trong DB.shelfRecords. =====
  {
    const STAFF = { username: 'nv1', name: 'Nguyễn Thị Hàng', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true };
    const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1', 'Siêu thị Quận 3'], users: [STAFF] });
    seedShelfRecords(state);
    // Nhân viên thường — DB.shelfRecords phía client CHỈ còn đúng siêu thị mình (mirror filterShelfRecordsForUser()
    // thật của server, xem lib/recordViewScope.js) — bỏ hẳn 2 dòng "Siêu thị Quận 3" ra khỏi state trước
    // khi đăng nhập, đúng như server thật sẽ trả về.
    state.shelfRecords = state.shelfRecords.filter(r => r.dept === 'Siêu thị Quận 1');
    state.__mockSystemInventoryRows = [
      { maHang: 'SP001', tenHang: 'Bánh quy HCRC 200g', soLuongTon: 48 },
      { maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 5 },
      { maHang: 'SP003', tenHang: 'Nước suối Lavie 500ml', soLuongTon: 120 }
    ];
    const { browser, page } = await launchPage(PORT, state);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, STAFF);
    await openReportTab(page);
    await shot(page, '#vanHanhShelfWrap', '01-bao-cao-nhan-vien-1-sieu-thi.png');
    const info1 = await page.evaluate(() => ({
      headerText: document.getElementById('shelfReportHeader').textContent,
      filterHidden: document.getElementById('shelfReportStoreFilterWrap').classList.contains('hidden'),
      rowCount: document.querySelectorAll('#shelfReportBody tr').length,
      hasStoreColumn: document.querySelector('#shelfReportTableHead th')?.textContent.trim() === 'Siêu Thị'
    }));
    console.log('[Kịch bản 1 - Nhân viên]', info1);
    assert.strictEqual(info1.headerText, '📍 Siêu Thị: Siêu thị Quận 1', 'LỖI: nhân viên 1 siêu thị phải thấy header đúng tên siêu thị mình, không phải "báo cáo tổng hợp"');
    assert.strictEqual(info1.filterHidden, true, 'LỖI: nhân viên 1 siêu thị KHÔNG được thấy bộ lọc "Siêu Thị" (lộ khả năng xem siêu thị khác)');
    assert.strictEqual(info1.rowCount, 3, 'LỖI: nhân viên phải thấy đúng 3 dòng của ĐÚNG siêu thị mình (không thiếu/thừa)');
    // (11/2026, theo yêu cầu người dùng "báo cáo này cho tôi thêm cột siêu thị") — cột "Siêu Thị" nay LUÔN
    // hiện, kể cả khi chỉ xem đúng 1 siêu thị (TRƯỚC ĐÂY ẩn ở kịch bản này — xem renderShelfReportTable()).
    assert.strictEqual(info1.hasStoreColumn, true, 'LỖI: cột "Siêu Thị" phải LUÔN hiện, kể cả khi chỉ có đúng 1 siêu thị');

    // "📥 Xuất Excel" THẬT (bấm nút thật, không gọi thẳng hàm) — xác nhận gửi đúng cột + đủ 3 dòng, có cả
    // cột "Siêu Thị" (LUÔN xuất, không còn điều kiện theo số siêu thị).
    await page.click('[data-op="exportShelfReportExcel"]');
    await page.waitForTimeout(150);
    assert.strictEqual((state.__xlsxExports || []).length, 1, 'LỖI: bấm "📥 Xuất Excel" phải gửi đúng 1 lần gọi POST /api/admin/export-xlsx');
    const export1 = state.__xlsxExports[0];
    assert.strictEqual(export1.rows.length, 3, 'LỖI: file Excel của nhân viên phải có đủ 3 dòng');
    assert.ok(export1.columns.some(c => c.key === 'maHang'), 'LỖI: thiếu cột Mã Hàng trong file Excel');
    assert.ok(export1.columns.some(c => c.key === 'dept'), 'LỖI: cột "Siêu Thị" phải LUÔN có trong file Excel, kể cả khi chỉ có đúng 1 siêu thị');
    console.log('[Kịch bản 1 - Xuất Excel]', { rows: export1.rows.length, columns: export1.columns.map(c => c.key) });

    await browser.close();
  }

  // ===== Kịch bản 2: Quản lý vùng (shelfReportView.all) — thấy NHIỀU siêu thị = báo cáo tổng hợp. =====
  {
    const MANAGER = { username: 'qlv1', name: 'Phạm Thị Quản Lý Vùng', dept: 'Ban Điều Hành', perms: { vanHanhShelfTab: true, shelfReportView: { all: true, depts: [] } }, active: true, totpEnabled: true };
    const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1', 'Siêu thị Quận 3'], users: [MANAGER] });
    seedShelfRecords(state); // giữ CẢ 2 siêu thị — mirror đúng shelfReportView.all=true trả về mọi dept.
    // LỖI ĐÃ VÁ (11/2026, người dùng báo kèm ảnh chụp: xem "Tất cả siêu thị" cột "Tồn Kho Hệ Thống" hiện
    // trống "—" cho MỌI dòng) — seed cho CẢ 2 siêu thị (trước đây route GET /system-inventory?scope=recon
    // CHỈ tra được đúng 1 siêu thị của effectiveUser, route MỚI /system-inventory/report-all trả theo
    // TỪNG siêu thị — xem routes/shelfStock.js).
    state.__mockSystemInventoryByDept = {
      'Siêu thị Quận 1': [
        { maHang: 'SP001', tenHang: 'Bánh quy HCRC 200g', soLuongTon: 50 },
        { maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 5 },
        { maHang: 'SP003', tenHang: 'Nước suối Lavie 500ml', soLuongTon: 130 }
      ],
      'Siêu thị Quận 3': [
        { maHang: 'SP001', tenHang: 'Bánh quy HCRC 200g', soLuongTon: 32 },
        { maHang: 'SP004', tenHang: 'Mì tôm Hảo Hảo', soLuongTon: 0 }
      ]
    };
    const { browser, page } = await launchPage(PORT, state);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await openReportTab(page);
    await shot(page, '#vanHanhShelfWrap', '02-bao-cao-tong-hop-quan-ly-vung.png');
    const info2 = await page.evaluate(() => ({
      headerText: document.getElementById('shelfReportHeader').textContent,
      filterHidden: document.getElementById('shelfReportStoreFilterWrap').classList.contains('hidden'),
      rowCount: document.querySelectorAll('#shelfReportBody tr').length,
      hasStoreColumn: document.querySelector('#shelfReportTableHead th')?.textContent.trim() === 'Siêu Thị',
      // Cột "Tồn Kho Hệ Thống" là td thứ 8 (1-based) — [dept, maHang, tenHang, quầy kệ, số lượng, trạng
      // thái, hạn sử dụng, Tồn Kho Hệ Thống, ...] — xem renderShelfReportTable().
      sysStockValues: Array.from(document.querySelectorAll('#shelfReportBody tr')).map(tr => ({
        dept: tr.children[0]?.textContent.trim(), maHang: tr.children[1]?.textContent.trim(), sysStock: tr.children[7]?.textContent.trim()
      }))
    }));
    console.log('[Kịch bản 2 - Quản lý vùng]', info2);
    console.log('[Kịch bản 2 - Tồn Kho Hệ Thống từng dòng]', info2.sysStockValues);
    for (const row of info2.sysStockValues) {
      assert.notStrictEqual(row.sysStock, '—', `LỖI (bug tái hiện): dòng "${row.dept} / ${row.maHang}" vẫn hiện "—" thay vì số thật khi xem "Tất cả siêu thị" — đúng lỗi người dùng báo cáo`);
    }
    assert.strictEqual(info2.sysStockValues.find(r => r.dept === 'Siêu thị Quận 1' && r.maHang === 'SP002').sysStock, '5');
    assert.strictEqual(info2.sysStockValues.find(r => r.dept === 'Siêu thị Quận 3' && r.maHang === 'SP001').sysStock, '32', 'LỖI: phải lấy ĐÚNG Tồn Kho Hệ Thống của ĐÚNG siêu thị Quận 3, không lẫn số của Quận 1 (cùng mã SP001 nhưng khác siêu thị)');
    assert.strictEqual(info2.filterHidden, false, 'LỖI: quản lý vùng (shelfReportView.all=true, dữ liệu có 2 siêu thị) PHẢI thấy bộ lọc "Siêu Thị"');
    assert.strictEqual(info2.rowCount, 5, 'LỖI: quản lý vùng phải thấy ĐỦ 5 dòng của CẢ 2 siêu thị (báo cáo tổng hợp)');
    assert.strictEqual(info2.hasStoreColumn, true, 'LỖI: bảng tổng hợp phải tự thêm cột "Siêu Thị" ở đầu khi xem nhiều siêu thị');

    // "📥 Xuất Excel" THẬT ở báo cáo tổng hợp (chưa lọc) — phải có đủ 5 dòng + cột "Siêu Thị".
    await page.click('[data-op="exportShelfReportExcel"]');
    await page.waitForTimeout(150);
    assert.strictEqual((state.__xlsxExports || []).length, 1, 'LỖI: bấm "📥 Xuất Excel" ở báo cáo tổng hợp phải gửi đúng 1 lần gọi');
    const export2 = state.__xlsxExports[0];
    assert.strictEqual(export2.rows.length, 5, 'LỖI: file Excel báo cáo tổng hợp (chưa lọc) phải có đủ 5 dòng của CẢ 2 siêu thị');
    assert.ok(export2.columns.some(c => c.key === 'dept'), 'LỖI: báo cáo tổng hợp PHẢI có cột "Siêu Thị" trong Excel (phân biệt được dòng của siêu thị nào)');
    console.log('[Kịch bản 2 - Xuất Excel chưa lọc]', { rows: export2.rows.length, columns: export2.columns.map(c => c.key) });
    state.__xlsxExports.length = 0;

    // Lọc riêng "Siêu thị Quận 3" — xác nhận bộ lọc hoạt động thật.
    await page.selectOption('#shelfReportStoreFilter', 'Siêu thị Quận 3');
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhShelfWrap', '03-bao-cao-loc-rieng-1-sieu-thi.png');
    const info3 = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#shelfReportBody tr').length,
      allRowsAreQ3: Array.from(document.querySelectorAll('#shelfReportBody tr td:first-child')).every(td => td.textContent.trim() === 'Siêu thị Quận 3')
    }));
    console.log('[Kịch bản 2 - Lọc riêng Q3]', info3);
    assert.strictEqual(info3.rowCount, 2, 'LỖI: lọc riêng "Siêu thị Quận 3" phải chỉ còn đúng 2 dòng của siêu thị đó');
    assert.strictEqual(info3.allRowsAreQ3, true, 'LỖI: lọc riêng "Siêu thị Quận 3" nhưng vẫn lẫn dòng của siêu thị khác');

    // "📥 Xuất Excel" SAU KHI lọc riêng 1 siêu thị — file xuất ra cũng phải CHỈ còn đúng 2 dòng đã lọc
    // (xác nhận exportShelfReportExcel() đọc đúng filter hiện tại, không xuất nhầm toàn bộ dữ liệu gốc).
    await page.click('[data-op="exportShelfReportExcel"]');
    await page.waitForTimeout(150);
    assert.strictEqual(state.__xlsxExports.length, 1, 'LỖI: bấm "📥 Xuất Excel" sau khi lọc phải gửi đúng 1 lần gọi');
    const export3 = state.__xlsxExports[0];
    assert.strictEqual(export3.rows.length, 2, 'LỖI: file Excel SAU KHI lọc "Siêu thị Quận 3" phải chỉ còn đúng 2 dòng, không xuất nhầm toàn bộ 5 dòng gốc');
    assert.ok(export3.rows.every(r => r.dept === 'Siêu thị Quận 3'), 'LỖI: file Excel sau khi lọc lẫn dòng của siêu thị khác');
    console.log('[Kịch bản 2 - Xuất Excel đã lọc]', { rows: export3.rows.length });

    console.log('✅ Tất cả assertion đều PASS.');
    await browser.close();
  }

  // ===== Kịch bản 3: LỖI ĐÃ VÁ (11/2026, người dùng báo kèm ảnh chụp: "lúc vào tab không hiện luôn báo
  // cáo mặc dù có siêu thị đã thực hiện, phải chuyển qua lại mới hiển thị tất cả các siêu thị") — mô
  // phỏng mạng CHẬM (route report-all cố tình trễ) để xác nhận bảng vẫn hiện ĐÚNG các dòng ghi nhận NGAY
  // LẬP TỨC, không cần đợi xong lượt gọi mạng tra Tồn Kho Hệ Thống mới hiện. =====
  {
    const MANAGER = { username: 'qlv2', name: 'Phạm Thị Quản Lý Vùng 2', dept: 'Ban Điều Hành', perms: { vanHanhShelfTab: true, shelfReportView: { all: true, depts: [] } }, active: true, totpEnabled: true };
    const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1', 'Siêu thị Quận 3'], users: [MANAGER] });
    seedShelfRecords(state);
    state.__mockSystemInventoryByDept = {
      'Siêu thị Quận 1': [{ maHang: 'SP001', tenHang: 'Bánh quy HCRC 200g', soLuongTon: 50 }],
      'Siêu thị Quận 3': [{ maHang: 'SP001', tenHang: 'Bánh quy HCRC 200g', soLuongTon: 32 }]
    };
    const { browser, page } = await launchPage(PORT, state);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    // Mô phỏng mạng chậm — CHỈ trễ ĐÚNG route report-all (1.5s), giữ nguyên hành vi mọi route khác, để
    // tái hiện đúng kịch bản "mạng di động chậm" người dùng mô tả.
    await page.evaluate(() => {
      const realFetch = window.fetch;
      window.fetch = (url, opts) => {
        if (String(url).includes('/system-inventory/report-all')) {
          return new Promise((resolve) => setTimeout(() => resolve(realFetch(url, opts)), 1500));
        }
        return realFetch(url, opts);
      };
    });
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubReport');
    // Kiểm tra NGAY LẬP TỨC (100ms, còn lâu mới tới 1.5s của lượt gọi mạng giả lập) — bảng phải ĐÃ hiện
    // đủ 5 dòng ghi nhận, Tồn Kho Hệ Thống tạm "—" (chưa có dữ liệu), KHÔNG được trống trơn.
    await page.waitForTimeout(100);
    const infoImmediate = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#shelfReportBody tr').length,
      headerText: document.getElementById('shelfReportHeader').textContent,
      sysStockValues: Array.from(document.querySelectorAll('#shelfReportBody tr')).map(tr => tr.children[7]?.textContent.trim())
    }));
    console.log('[Kịch bản 3 - Ngay lập tức, mạng còn đang tải]', infoImmediate);
    assert.strictEqual(infoImmediate.rowCount, 5, `LỖI (bug tái hiện): bảng phải hiện ĐỦ 5 dòng NGAY LẬP TỨC dù lượt gọi mạng tra Tồn Kho Hệ Thống còn đang chạy, thực tế: ${infoImmediate.rowCount} dòng`);
    assert.strictEqual(infoImmediate.headerText, '📍 Đang xem báo cáo tổng hợp: 2 siêu thị (theo quyền "Xem Báo Cáo Kiểm Soát Hàng Hóa").');
    assert.ok(infoImmediate.sysStockValues.every(v => v === '—'), 'LỖI: lúc mạng còn đang tải, Tồn Kho Hệ Thống phải tạm hiện "—" (chưa có dữ liệu), không phải lỗi/giá trị sai');

    // Đợi lượt gọi mạng giả lập hoàn tất (1.5s) rồi kiểm tra lại — Tồn Kho Hệ Thống phải tự cập nhật đúng
    // số thật, KHÔNG cần người dùng thao tác/chuyển qua lại gì thêm.
    await page.waitForTimeout(1600);
    const infoAfter = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#shelfReportBody tr').length,
      sysStockValues: Array.from(document.querySelectorAll('#shelfReportBody tr')).map(tr => ({ maHang: tr.children[1]?.textContent.trim(), dept: tr.children[0]?.textContent.trim(), sysStock: tr.children[7]?.textContent.trim() }))
    }));
    console.log('[Kịch bản 3 - Sau khi mạng tải xong, tự cập nhật]', infoAfter);
    assert.strictEqual(infoAfter.rowCount, 5, 'LỖI: vẫn phải giữ đủ 5 dòng sau khi mạng tải xong');
    const sp001Q1 = infoAfter.sysStockValues.find(r => r.dept === 'Siêu thị Quận 1' && r.maHang === 'SP001');
    assert.strictEqual(sp001Q1.sysStock, '50', 'LỖI: Tồn Kho Hệ Thống phải TỰ cập nhật đúng số thật sau khi mạng tải xong, không cần chuyển qua lại');
    console.log('✅ Kịch bản 3 PASS — bảng hiện ngay, tự cập nhật Tồn Kho Hệ Thống khi mạng chậm.');
    await browser.close();
  }

  server.close();
  console.log('\n✅ Demo preview hoàn tất — ảnh lưu tại:', OUT_DIR);
})().catch((err) => { console.error(err); process.exit(1); });
