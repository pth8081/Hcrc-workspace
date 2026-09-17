// server/tests/test-itprice-form-split.js
//
// Regression test cho đợt tách biểu mẫu Phê Duyệt Giá Bán Buôn/Bán Lẻ (9/2026, theo yêu cầu người
// dùng — dùng chung 1 form cho cả 2 loại giá "nguy hiểm"): Bán Lẻ bỏ hẳn 3 trường "Siêu Thị Áp Dụng"/
// "Ngày Áp Dụng"/"Ngày Hết Hiệu Lực" (chỉ còn Bán Buôn dùng), và vá lỗi chặn tạo đề xuất khi danh mục
// "Vùng Giá Áp Dụng" (DB.priceZones) đang rỗng. Dùng REAL clicks (page.click()) thay vì gọi thẳng hàm
// qua page.evaluate() — bài học từ vụ Nghiệp Vụ click không phản hồi (bindCspDelegation thiếu đăng ký)
// chỉ lộ ra khi test click thật, không lộ khi gọi hàm trực tiếp.
//
// Chạy: node server/tests/test-itprice-form-split.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8993;
const STAFF_MKT = { username: 'staff_mkt', name: 'Trần Thị Marketing', dept: 'Marketing', perms: { itPriceProposeCreateWholesale: true, itPriceProposeCreateRetail: true }, active: true };
// totpEnabled:true để bỏ qua "tường chặn" bắt thiết lập 2FA (totpSetupWallModal, xem core.js:5698) —
// không phải trọng tâm bài test này, chỉ cần admin vào được thẳng màn hệ thống.
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

const MASTER_LIST = {
  id: 1, name: 'Bảng Giá Chuẩn 2026',
  columns: [
    { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
    { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
  ],
  fileUrl: '/uploads/mau-gia-chuan-2026.xlsx', fileName: 'mau-gia-chuan-2026.xlsx',
  uploadedBy: 'admin', uploadedByName: 'Quản Trị Viên', uploadedAt: new Date().toLocaleString('vi-VN')
};

const state = createMockState({
  users: [STAFF_MKT, ADMIN],
  itPriceMasterLists: [MASTER_LIST],
  priceZones: [], // cố ý RỖNG — đúng kịch bản lỗi người dùng báo cáo
  stores: ['Siêu thị Demo']
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

function seedPendingFile(page, suffix) {
  return page.evaluate((s) => {
    itPricePendingFile = {
      fileUrl: `/uploads/gia-${s}.xlsx`, fileName: `gia-${s}.xlsx`,
      items: [{ values: { code: 'MK001', name: 'Sản phẩm MKT', oldPrice: '900', newPrice: '1000' } }],
      columnLabels: [
        { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
        { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
      ]
    };
  }, suffix);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await run.run('Real click "Bán Buôn": ẩn hẳn khối Vùng Giá Áp Dụng, hiện khối Siêu Thị Đề Xuất/Ngày Áp Dụng/Ngày Hết Hiệu Lực', async () => {
      await loginAs(page, STAFF_MKT);
      await page.evaluate(() => { switchTab('itSupport'); setItSupportSubTab('PRICE'); });
      await page.waitForTimeout(150);

      await page.click('#btnItPriceSubWholesale');
      await page.waitForTimeout(150);

      const retailZoneVisible = await page.evaluate(() => !document.getElementById('itPriceRetailZoneWrap').classList.contains('hidden'));
      const wholesaleBlockVisible = await page.evaluate(() => !document.getElementById('itPriceWholesaleScopeDateWrap').classList.contains('hidden'));
      assertEqual(retailZoneVisible, false, 'Bán Buôn: khối Vùng Giá Áp Dụng (chỉ Bán Lẻ) phải ẩn');
      assertEqual(wholesaleBlockVisible, true, 'Bán Buôn: khối Siêu Thị Đề Xuất/Ngày Áp Dụng/Ngày Hết Hiệu Lực phải hiện');
    });

    await run.run('Real click "Bán Lẻ": ẩn hẳn khối Siêu Thị Đề Xuất/Ngày Áp Dụng/Ngày Hết Hiệu Lực, hiện khối Vùng Giá Áp Dụng', async () => {
      await page.click('#btnItPriceSubRetail');
      await page.waitForTimeout(150);

      const retailZoneVisible = await page.evaluate(() => !document.getElementById('itPriceRetailZoneWrap').classList.contains('hidden'));
      const wholesaleBlockVisible = await page.evaluate(() => !document.getElementById('itPriceWholesaleScopeDateWrap').classList.contains('hidden'));
      assertEqual(retailZoneVisible, true, 'Bán Lẻ: khối Vùng Giá Áp Dụng phải hiện');
      assertEqual(wholesaleBlockVisible, false, 'Bán Lẻ: khối Siêu Thị Đề Xuất/Ngày Áp Dụng/Ngày Hết Hiệu Lực (chỉ Bán Buôn) phải ẩn');
    });

    await run.run('Danh mục Vùng Giá Áp Dụng rỗng: hiện gợi ý + (admin) nút thêm nhanh ngay trong form', async () => {
      const hintText = await page.evaluate(() => document.getElementById('itPriceRetailZoneEmptyHint').innerText);
      assert(hintText.includes('Chưa có Vùng Giá'), 'Phải hiện gợi ý rõ ràng khi danh mục rỗng, không để form trống trơn không giải thích');
      // staff_mkt (KHÔNG phải admin) -> KHÔNG có nút thêm nhanh.
      const hasQuickAddBtn = await page.$('[data-op="quickAddPriceZoneFromItPriceForm"]');
      assert(!hasQuickAddBtn, 'Người không phải admin không được thấy nút thêm nhanh Vùng Giá (priceZones chỉ Admin ghi được)');
    });

    await run.run('Real click Gửi (Bán Lẻ, danh mục Vùng Giá rỗng): "Vùng Giá Áp Dụng" không bắt buộc, vẫn tạo được hồ sơ', async () => {
      await page.selectOption('#itPriceMasterListSelect', '1');
      await page.fill('#itPriceReason', 'Test retail — chưa có vùng giá');
      await seedPendingFile(page, 'retail-empty-zone');
      await page.evaluate(() => { window.__alerts = []; });
      await page.click('#itPriceCreateForm button[type="submit"]');
      await page.waitForTimeout(200);
      const alerts = await page.evaluate(() => window.__alerts);
      assert(!alerts.some(a => a.includes('Vùng Giá Áp Dụng')), 'Không được báo lỗi thiếu Vùng Giá — trường này không bắt buộc');
      assertEqual(state.itPriceApprovals.length, 1, 'Phải tạo được hồ sơ dù chưa chọn Vùng Giá Áp Dụng');
      assertEqual(state.itPriceApprovals[0].priceZone, null, 'priceZone phải là null khi không chọn');
    });

    await run.run('Admin: real click "+ Thêm ngay tại đây" tạo Vùng Giá mới NGAY trong form Phê Duyệt Giá (không cần rời sang Quản Lý Danh Mục)', async () => {
      await loginAs(page, ADMIN);
      await page.evaluate(() => { switchTab('itSupport'); setItSupportSubTab('PRICE'); setItPriceSubTab('RETAIL'); });
      await page.waitForTimeout(150);

      const hasQuickAddBtn = await page.$('[data-op="quickAddPriceZoneFromItPriceForm"]');
      assert(hasQuickAddBtn, 'Admin PHẢI thấy nút thêm nhanh khi danh mục Vùng Giá đang rỗng');

      await page.evaluate(() => { window.__promptAnswer = 'Miền Bắc'; });
      await page.click('[data-op="quickAddPriceZoneFromItPriceForm"]');
      await page.waitForTimeout(300);

      const zones = await page.evaluate(() => DB.priceZones);
      assert(zones.includes('Miền Bắc'), 'Vùng giá mới phải được lưu vào DB.priceZones (đồng bộ server)');
      const selectedValue = await page.evaluate(() => document.getElementById('itPriceRetailZone').value);
      assertEqual(selectedValue, 'Miền Bắc', 'Sau khi thêm nhanh, dropdown phải tự chọn ĐÚNG vùng giá vừa thêm');
      const hintHidden = await page.evaluate(() => document.getElementById('itPriceRetailZoneEmptyHint').classList.contains('hidden'));
      assertEqual(hintHidden, true, 'Gợi ý danh mục rỗng phải tự ẩn ngay sau khi đã có ít nhất 1 vùng giá');
    });

    await run.run('Real click Gửi (Bán Lẻ, đã có Vùng Giá): tạo thành công, tự gắn effectiveDate=hôm nay/expiryMode=PERMANENT/storeScope=ALL', async () => {
      await page.selectOption('#itPriceMasterListSelect', '1');
      await page.fill('#itPriceReason', 'Test retail — đã có vùng giá');
      await seedPendingFile(page, 'retail-ok');
      await page.evaluate(() => { window.__alerts = []; });
      await page.click('#itPriceCreateForm button[type="submit"]');
      await page.waitForTimeout(300);

      const alerts = await page.evaluate(() => window.__alerts);
      assert(alerts.some(a => a.includes('thành công')), `Phải tạo thành công, alerts=${JSON.stringify(alerts)}`);
      const created = await page.evaluate(() => DB.itPriceApprovals[0]);
      assertEqual(created.priceType, 'RETAIL', 'priceType phải đúng RETAIL');
      assertEqual(created.priceZone, 'Miền Bắc', 'priceZone phải đúng vùng giá đã chọn');
      assertEqual(created.storeScope.mode, 'ALL', 'Bán Lẻ tự gắn storeScope=ALL (không hỏi lại vì đã bỏ trường này khỏi form)');
      assertEqual(created.expiryMode, 'PERMANENT', 'Bán Lẻ tự gắn expiryMode=PERMANENT (không hỏi lại)');
      const today = new Date().toLocaleDateString('en-CA');
      assertEqual(created.effectiveDate, today, 'Bán Lẻ tự gắn effectiveDate=hôm nay (không hỏi lại)');
    });

    await run.run('Real click Gửi (Bán Buôn, điền đủ trường): tạo thành công với đúng storeScope/ngày do người dùng chọn', async () => {
      await page.click('#btnItPriceSubWholesale');
      await page.waitForTimeout(150);
      await page.selectOption('#itPriceMasterListSelect', '1');
      await page.fill('#itPriceReason', 'Test wholesale');
      await page.selectOption('#itPriceTier', 'MARGIN_LT5');
      await page.fill('#itPriceWholesaleApplyUnit', 'Công ty TNHH ABC');
      await page.fill('#itPriceEffectiveDate', '2026-10-01');
      const storeInput = await page.$('#itPriceStoreScopeStoresMultiSelect [data-pms-search]');
      await storeInput.click();
      await storeInput.type('Demo');
      await page.waitForTimeout(150);
      await page.click('#itPriceStoreScopeStoresMultiSelect [data-op="gmsAdd"]');
      await seedPendingFile(page, 'wholesale-ok');
      await page.evaluate(() => { window.__alerts = []; });
      await page.click('#itPriceCreateForm button[type="submit"]');
      await page.waitForTimeout(300);

      const alerts = await page.evaluate(() => window.__alerts);
      assert(alerts.some(a => a.includes('thành công')), `Phải tạo thành công, alerts=${JSON.stringify(alerts)}`);
      const created = await page.evaluate(() => DB.itPriceApprovals[0]);
      assertEqual(created.priceType, 'WHOLESALE', 'priceType phải đúng WHOLESALE');
      assertEqual(created.effectiveDate, '2026-10-01', 'Bán Buôn vẫn đọc đúng Ngày Áp Dụng người dùng nhập tay');
      assertEqual(created.storeScope.mode, 'OTHER', 'Bán Buôn vẫn bắt buộc storeScope=OTHER với siêu thị cụ thể');
      assert(created.storeScope.stores.includes('Siêu thị Demo'), 'Phải lưu đúng siêu thị đã chọn');
    });

    // ===== "Trường Bổ Sung" (dynamic custom fields) giờ TÁCH RIÊNG theo modKey IT_PRICE_RETAIL/
    // IT_PRICE_WHOLESALE (trước đây dùng chung 1 modKey 'IT_PRICE') — xem itPriceDynamicModKey() ở
    // module-itsupport-price.js. Field admin thêm riêng cho 1 sub-tab KHÔNG được lộ sang sub-tab kia. =====
    await run.run('"Trường Bổ Sung" tách riêng: field thêm cho Bán Lẻ KHÔNG hiện ở Bán Buôn và ngược lại', async () => {
      await page.evaluate(() => {
        DB.formTemplates.IT_PRICE_RETAIL = [{ id: 'f_cust_retail1', label: 'Ghi chú riêng Bán Lẻ', type: 'text', options: [], required: false, isDefault: false }];
        DB.formTemplates.IT_PRICE_WHOLESALE = [{ id: 'f_cust_wholesale1', label: 'Ghi chú riêng Bán Buôn', type: 'text', options: [], required: false, isDefault: false }];
      });
      await page.click('#btnItPriceSubRetail');
      await page.waitForTimeout(150);
      let html = await page.evaluate(() => document.getElementById('dynamicFieldsContainer_IT_PRICE').innerHTML);
      assert(html.includes('Ghi chú riêng Bán Lẻ'), 'Bán Lẻ phải thấy đúng field Trường Bổ Sung của mình');
      assert(!html.includes('Ghi chú riêng Bán Buôn'), 'Bán Lẻ KHÔNG được thấy field Trường Bổ Sung của Bán Buôn');

      await page.click('#btnItPriceSubWholesale');
      await page.waitForTimeout(150);
      html = await page.evaluate(() => document.getElementById('dynamicFieldsContainer_IT_PRICE').innerHTML);
      assert(html.includes('Ghi chú riêng Bán Buôn'), 'Bán Buôn phải thấy đúng field Trường Bổ Sung của mình');
      assert(!html.includes('Ghi chú riêng Bán Lẻ'), 'Bán Buôn KHÔNG được thấy field Trường Bổ Sung của Bán Lẻ');

      await page.click('#btnItPriceSubRetail');
      await page.waitForTimeout(150);
    });

    // ===== Migration: dữ liệu formTemplates cũ (1 modKey 'IT_PRICE' chung, từ TRƯỚC đợt tách) phải tự
    // chuyển sang CẢ 2 modKey mới khi tải lại — không mất cấu hình admin đã có, xem
    // migrateItPriceFormTemplatesKeys() ở core.js. =====
    await run.run('migrateItPriceFormTemplatesKeys(): dữ liệu cũ IT_PRICE (chung) tự tách sang CẢ 2 modKey mới', async () => {
      const result = await page.evaluate(() => migrateItPriceFormTemplatesKeys({
        IT_PRICE: [{ id: 'f_old1', label: 'Trường bổ sung cũ', type: 'text', options: [], required: false }],
        __core__IT_PRICE: { itPriceCode: { label: 'Mã Đề Xuất (đã đổi)', required: true } },
        __order__IT_PRICE: ['itPriceCode', 'f_old1'],
        SOME_OTHER_KEY: ['giữ nguyên không đụng tới']
      }));
      assert(Array.isArray(result.IT_PRICE_RETAIL) && result.IT_PRICE_RETAIL.length === 1 && result.IT_PRICE_RETAIL[0].label === 'Trường bổ sung cũ', 'Phải copy đúng field cũ sang IT_PRICE_RETAIL');
      assert(Array.isArray(result.IT_PRICE_WHOLESALE) && result.IT_PRICE_WHOLESALE.length === 1 && result.IT_PRICE_WHOLESALE[0].label === 'Trường bổ sung cũ', 'Phải copy đúng field cũ sang IT_PRICE_WHOLESALE');
      assert(result.IT_PRICE_RETAIL !== result.IT_PRICE_WHOLESALE, 'Không được dùng chung 1 tham chiếu mảng (tránh sửa 1 bên ảnh hưởng bên kia)');
      assertEqual(result.__core__IT_PRICE_RETAIL.itPriceCode.label, 'Mã Đề Xuất (đã đổi)', 'Phải copy đúng override __core__ sang IT_PRICE_RETAIL');
      assertEqual(result.__core__IT_PRICE_WHOLESALE.itPriceCode.label, 'Mã Đề Xuất (đã đổi)', 'Phải copy đúng override __core__ sang IT_PRICE_WHOLESALE');
      assert(!('IT_PRICE' in result) && !('__core__IT_PRICE' in result) && !('__order__IT_PRICE' in result), 'Phải xoá hẳn 3 khoá cũ sau khi migrate');
      assert(Array.isArray(result.SOME_OTHER_KEY), 'Không được đụng tới khoá không liên quan');
    });

    await run.run('migrateItPriceFormTemplatesKeys(): đã có khoá mới rồi thì KHÔNG migrate lại (idempotent)', async () => {
      const input = { IT_PRICE: [{ id: 'f_old1', label: 'Cũ', type: 'text', required: false }], IT_PRICE_RETAIL: [{ id: 'f_new1', label: 'Đã cấu hình riêng rồi', type: 'text', required: false }] };
      const result = await page.evaluate((inp) => migrateItPriceFormTemplatesKeys(inp), input);
      assertEqual(result.IT_PRICE_RETAIL[0].label, 'Đã cấu hình riêng rồi', 'Không được ghi đè cấu hình MỚI đã có bằng dữ liệu cũ');
      assert('IT_PRICE' in result, 'Không migrate thì khoá cũ vẫn còn nguyên (không tự xoá nhầm)');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
