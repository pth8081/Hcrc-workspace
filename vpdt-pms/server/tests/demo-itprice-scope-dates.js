// server/tests/demo-itprice-scope-dates.js
//
// DEMO thật (không phải bộ hồi quy tự động — xem tests/test-itprice-scope-dates.js cho phần đó) cho 2
// trường "🏬 Siêu Thị Đề Xuất" + "📅 Ngày Áp Dụng"/"⏳ Ngày Hết Hiệu Lực" ở form "Phê Duyệt Giá Bán Buôn".
//   - 10/2026 (đợt tách Phê Duyệt Giá khỏi Hỗ Trợ IT): Bán Lẻ chuyển hẳn sang module Mua Hàng
//     (module-muahang.js, form rút gọn — TỰ GẮN storeScope=ALL/ngày áp dụng=hôm nay/hết hiệu lực=Vĩnh
//     viễn, KHÔNG còn 3 field này trên UI nữa, xem submitMhItPriceApproval()) — demo cho phần này giờ
//     chỉ còn 1 bước nộp đơn giản, không có gì để "chụp ảnh minh hoạ" thêm về scope/dates.
//   - Bán Buôn chuyển sang module Vận Hành (module-vanhanh.js/module-itsupport-price.js, ids GIỮ NGUYÊN
//     itPrice* — chỉ đổi trang sống) — 3 field này VẪN giữ nguyên hành vi cũ (KHÔNG có "Toàn bộ", ô
//     multi-select LUÔN hiện sẵn + LUÔN bắt buộc chọn, "Ngày Áp Dụng" luôn bắt buộc, "Ngày Hết Hiệu Lực"
//     mặc định "Vĩnh viễn" chọn "Khác" hiện ô nhập ngày thật) — trọng tâm demo này giờ dồn hết vào đây.
// Chụp ảnh thật từng bước bằng Chromium (Playwright) mở ĐÚNG public/index.html + public/js/*.js thật,
// dùng lại hạ tầng mock backend của tests/testHarness.js (sandbox không có SQL Server thật).
//
// Chạy: node server/tests/demo-itprice-scope-dates.js
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'itprice-scope-dates');

const STAFF_KD = { username: 'staff_kd', name: 'Ngô Văn Kinh Doanh', dept: 'Kinh Doanh', perms: { itPriceProposeCreateWholesale: true, itPriceProposeCreateRetail: true }, active: true };
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

    // ===== Bán Lẻ (Mua Hàng, 10/2026) — form rút gọn, KHÔNG còn store-scope/date để cấu hình. =====
    console.log('01: form Bán Lẻ (Mua Hàng) — rút gọn, không còn Siêu Thị Áp Dụng/Ngày Áp Dụng/Ngày Hết Hiệu Lực (tự gắn mặc định ALL/hôm nay/Vĩnh viễn).');
    await page.evaluate(async () => { await switchTab('muaHang'); setPurchasingSubTab('ITPRICE'); });
    await page.locator('#mhItPriceCreateForm').scrollIntoViewIfNeeded();
    await shot(page, '01-ban-le-form-rut-gon');

    await page.fill('#mhItPriceReason', 'Điều chỉnh giá theo chương trình khuyến mãi Quý 4');
    await page.selectOption('#mhItPriceRetailZone', 'Miền Bắc');
    await page.evaluate(() => {
      mhItPricePendingFile = {
        fileUrl: '/uploads/gia-de-xuat-demo.xlsx', fileName: 'gia-de-xuat-demo.xlsx',
        items: [{ values: { code: 'SP001', name: 'Mì gói Hảo Hảo', price: '5500' } }],
        columnLabels: [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }, { key: 'price', label: 'Giá bán' }]
      };
    });
    const createdId = await page.evaluate(async () => {
      await submitMhItPriceApproval({ preventDefault() {}, target: { reset() {} } });
      return DB.itPriceApprovals[0].id;
    });
    await page.evaluate((id) => openItPriceModal(id), createdId);
    await page.waitForTimeout(150);
    await shot(page, '02-ban-le-modal-chi-tiet-sau-khi-gui');

    const saved = await page.evaluate(() => DB.itPriceApprovals[0]);
    console.log('\nDữ liệu Bán Lẻ thật đã lưu (storeScope/effectiveDate/expiryMode TỰ GẮN mặc định, payload đi qua server thật):');
    console.log(JSON.stringify({ storeScope: saved.storeScope, effectiveDate: saved.effectiveDate, expiryMode: saved.expiryMode, expiryDate: saved.expiryDate }, null, 2));

    // ===== Bán Buôn (Vận Hành) — vẫn giữ nguyên "Siêu Thị Đề Xuất" (KHÔNG có Toàn bộ) + Ngày Áp Dụng/
    // Ngày Hết Hiệu Lực đầy đủ như trước. =====
    console.log('\n03: form Bán Buôn (Vận Hành) — "🏬 Siêu Thị Đề Xuất" LUÔN hiện sẵn + LUÔN bắt buộc chọn, KHÔNG có "Toàn bộ".');
    await closeItPriceModalSafe(page);
    await page.evaluate(async () => { await switchTab('vanHanh'); setVanHanhSubTab('ITPRICE'); });
    await page.locator('#itPriceCreateForm').scrollIntoViewIfNeeded();
    await shot(page, '03-ban-buon-sieu-thi-de-xuat');

    console.log('04: gõ tìm + chọn 2 siêu thị đề xuất (chip hiện ra).');
    await page.click('#itPriceStoreScopeStoresMultiSelect [data-pms-search]');
    await page.fill('#itPriceStoreScopeStoresMultiSelect [data-pms-search]', 'Quận');
    await page.waitForTimeout(100);
    await page.click('#itPriceStoreScopeStoresMultiSelect [data-pms-dropdown] div:has-text("Siêu thị Quận 1")');
    await page.fill('#itPriceStoreScopeStoresMultiSelect [data-pms-search]', 'Biên Hòa');
    await page.waitForTimeout(100);
    await page.click('#itPriceStoreScopeStoresMultiSelect [data-pms-dropdown] div:has-text("Cửa hàng Biên Hòa")');
    await shot(page, '04-da-chon-2-sieu-thi-de-xuat');

    console.log('05: chọn "Khác" ở Ngày Hết Hiệu Lực -> hiện ô nhập ngày thật, điền nốt form + gửi đề xuất Bán Buôn thật.');
    await page.selectOption('#itPriceExpiryMode', 'OTHER');
    await page.fill('#itPriceEffectiveDate', '2026-10-01');
    await page.fill('#itPriceExpiryDate', '2027-04-01');
    await page.selectOption('#itPriceTier', 'MARGIN_LT5');
    await page.fill('#itPriceWholesaleApplyUnit', 'Công ty TNHH ABC');
    await page.fill('#itPriceReason', 'Đề xuất giá bán buôn riêng cho 2 siêu thị vừa chọn');
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
    await shot(page, '05-ban-buon-modal-chi-tiet');

    const savedWholesale = await page.evaluate(() => DB.itPriceApprovals[0]);
    console.log('\nDữ liệu Bán Buôn thật đã lưu (storeScope.mode LUÔN là OTHER, không có ALL):');
    console.log(JSON.stringify({ priceType: savedWholesale.priceType, storeScope: savedWholesale.storeScope, effectiveDate: savedWholesale.effectiveDate, expiryMode: savedWholesale.expiryMode, expiryDate: savedWholesale.expiryDate }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

async function closeItPriceModalSafe(page) {
  await page.evaluate(() => { if (typeof closeItPriceModal === 'function') closeItPriceModal(); });
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
