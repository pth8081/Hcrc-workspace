// server/tests/demo-itprice-scope-dates.js
//
// DEMO thật (không phải bộ hồi quy tự động — xem tests/test-itprice-scope-dates.js cho phần đó) cho 2
// trường mới ở form "Phê Duyệt Giá" (Bán Lẻ + Bán Buôn dùng CHUNG 1 form):
//   - "🏬 Siêu Thị Áp Dụng" (Bán Lẻ) — mặc định "Toàn bộ siêu thị, cửa hàng", chọn "Khác" hiện ô
//     multi-select tìm-kiếm-gõ-chọn (renderMultiSelectDropdown(), lấy từ danh mục DB.stores). Bán Buôn
//     đổi nhãn "🏬 Siêu Thị Đề Xuất" — KHÔNG có khái niệm "Toàn bộ", ô multi-select LUÔN hiện sẵn và
//     LUÔN bắt buộc chọn (mục 2 đợt sau, xem applyItPriceStoreScopeUIForSubTab() ở module-itsupport-price.js).
//   - "📅 Ngày Áp Dụng" (luôn bắt buộc) + "⏳ Ngày Hết Hiệu Lực" (mặc định "Vĩnh viễn", chọn "Khác" hiện
//     ô nhập ngày thật) — áp dụng chung cho cả 2 loại giá, không đổi theo sub-tab.
// Chụp ảnh thật từng bước bằng Chromium (Playwright) mở ĐÚNG public/index.html + public/js/*.js thật,
// dùng lại hạ tầng mock backend của tests/testHarness.js (sandbox không có SQL Server thật).
//
// Chạy: node server/tests/demo-itprice-scope-dates.js
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'itprice-scope-dates');

const STAFF_KD = { username: 'staff_kd', name: 'Ngô Văn Kinh Doanh', dept: 'Kinh Doanh', perms: { itPriceProposeCreate: true }, active: true };
const APPROVER1 = { username: 'approver1', name: 'Trưởng Phòng Duyệt', dept: 'Ban Giám Đốc', perms: {}, active: true };

const state = createMockState({
  depts: ['Kinh Doanh', 'Ban Giám Đốc'],
  stores: ['Siêu thị Quận 1', 'Siêu thị Quận 7', 'Cửa hàng Thủ Đức', 'Cửa hàng Biên Hòa'],
  users: [STAFF_KD, APPROVER1],
  itPriceDeptWorkflows: { 'Kinh Doanh': { workflowId: 'wf-kd-price', approvers: { 1: ['approver1'] } } },
  workflows: [{ id: 'wf-kd-price', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }] }]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function shot(page, name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${file}`);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1000, height: 1400 });

  try {
    await loginAs(page, STAFF_KD);
    await page.evaluate(() => { switchTab('itSupport'); setItSupportSubTab('PRICE'); });
    await page.locator('#itPriceCreateForm').scrollIntoViewIfNeeded();

    console.log('01: form mặc định — "Toàn bộ siêu thị, cửa hàng" + "Vĩnh viễn", 2 khối "Khác" đang ẩn.');
    await shot(page, '01-form-mac-dinh');

    console.log('02: chọn "Khác" ở Siêu Thị Áp Dụng -> hiện ô multi-select tìm-kiếm-gõ-chọn.');
    await page.selectOption('#itPriceStoreScopeMode', 'OTHER');
    await shot(page, '02-sieu-thi-khac-hien-o-chon');

    console.log('03: gõ tìm + chọn 2 siêu thị cụ thể (chip hiện ra).');
    await page.click('#itPriceStoreScopeStoresMultiSelect [data-pms-search]');
    await page.fill('#itPriceStoreScopeStoresMultiSelect [data-pms-search]', 'Quận');
    await page.waitForTimeout(100);
    await page.click('#itPriceStoreScopeStoresMultiSelect [data-pms-dropdown] div:has-text("Siêu thị Quận 1")');
    await page.fill('#itPriceStoreScopeStoresMultiSelect [data-pms-search]', 'Thủ Đức');
    await page.waitForTimeout(100);
    await page.click('#itPriceStoreScopeStoresMultiSelect [data-pms-dropdown] div:has-text("Cửa hàng Thủ Đức")');
    await shot(page, '03-da-chon-2-sieu-thi');

    console.log('04: chọn "Khác" ở Ngày Hết Hiệu Lực -> hiện ô nhập ngày thật.');
    await page.selectOption('#itPriceExpiryMode', 'OTHER');
    await page.fill('#itPriceEffectiveDate', '2026-09-15');
    await page.fill('#itPriceExpiryDate', '2027-03-15');
    await shot(page, '04-ngay-het-hieu-luc-khac');

    console.log('05: điền nốt form + gửi đề xuất thật, mở lại modal chi tiết xem thông tin đã lưu đúng chưa.');
    await page.fill('#itPriceReason', 'Điều chỉnh giá theo chương trình khuyến mãi Quý 4');
    await page.selectOption('#itPriceRetailZone', 'Miền Bắc');
    await page.evaluate(() => {
      itPricePendingFile = {
        fileUrl: '/uploads/gia-de-xuat-demo.xlsx', fileName: 'gia-de-xuat-demo.xlsx',
        items: [{ values: { code: 'SP001', name: 'Mì gói Hảo Hảo', price: '5500' } }],
        columnLabels: [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }, { key: 'price', label: 'Giá bán' }]
      };
    });
    const createdId = await page.evaluate(async () => {
      await submitItPriceApproval({ preventDefault() {}, target: { reset() {} } });
      return DB.itPriceApprovals[0].id;
    });
    await page.evaluate((id) => openItPriceModal(id), createdId);
    await page.waitForTimeout(150);
    await shot(page, '05-modal-chi-tiet-sau-khi-gui');

    const saved = await page.evaluate(() => DB.itPriceApprovals[0]);
    console.log('\nDữ liệu thật đã lưu (payload đi qua server thật, không phải chỉ hiển thị):');
    console.log(JSON.stringify({ storeScope: saved.storeScope, effectiveDate: saved.effectiveDate, expiryMode: saved.expiryMode, expiryDate: saved.expiryDate }, null, 2));

    // ===== Đợt sau (mục 2): Bán Buôn đổi tên "Siêu Thị Đề Xuất", KHÔNG có "Toàn bộ" =====
    console.log('\n06: chuyển sang sub-tab "Bán Buôn" — nhãn đổi thành "Siêu Thị Đề Xuất", KHÔNG còn lựa chọn Toàn bộ/Khác, ô multi-select LUÔN hiện sẵn.');
    await page.evaluate(() => { closeItPriceModal(); resetItPriceForm(); setItPriceSubTab('WHOLESALE'); });
    await page.locator('#itPriceCreateForm').scrollIntoViewIfNeeded();
    await shot(page, '06-ban-buon-sieu-thi-de-xuat');

    console.log('07: gõ tìm + chọn 1 siêu thị đề xuất, điền Mức Margin/Chiết Khấu, gửi đề xuất Bán Buôn thật, xem modal chi tiết.');
    await page.click('#itPriceStoreScopeStoresMultiSelect [data-pms-search]');
    await page.fill('#itPriceStoreScopeStoresMultiSelect [data-pms-search]', 'Biên Hòa');
    await page.waitForTimeout(100);
    await page.click('#itPriceStoreScopeStoresMultiSelect [data-pms-dropdown] div:has-text("Cửa hàng Biên Hòa")');
    await page.selectOption('#itPriceTier', 'MARGIN_LT5');
    await page.fill('#itPriceEffectiveDate', '2026-10-01');
    await page.fill('#itPriceReason', 'Đề xuất giá bán buôn riêng cho cửa hàng Biên Hòa');
    await page.evaluate(() => {
      itPricePendingFile = {
        fileUrl: '/uploads/gia-buon-demo.xlsx', fileName: 'gia-buon-demo.xlsx',
        items: [{ values: { code: 'SP002', name: 'Mì gói Omachi', price: '4800' } }],
        columnLabels: [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }, { key: 'price', label: 'Giá bán' }]
      };
    });
    const wholesaleId = await page.evaluate(async () => {
      await submitItPriceApproval({ preventDefault() {}, target: { reset() {} } });
      return DB.itPriceApprovals[0].id;
    });
    await page.evaluate((id) => openItPriceModal(id), wholesaleId);
    await page.waitForTimeout(150);
    await shot(page, '07-ban-buon-modal-chi-tiet');

    const savedWholesale = await page.evaluate(() => DB.itPriceApprovals[0]);
    console.log('\nDữ liệu Bán Buôn thật đã lưu (storeScope.mode LUÔN là OTHER, không có ALL):');
    console.log(JSON.stringify({ priceType: savedWholesale.priceType, storeScope: savedWholesale.storeScope }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
