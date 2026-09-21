// server/tests/test-itprice-mastertlist-channel-split.js
//
// Yêu cầu người dùng: "Phê duyệt giá bán lẻ và giá bán buôn đang dùng chung mẫu phê duyệt giá làm cho
// hệ thống bị lỗi dữ liệu, xoá giá mẫu là xoá hết" — Mẫu Giá (itPriceMasterLists) trước đây là 1 mảng
// PHẲNG không có field phân biệt kênh, panel quản trị + dropdown chọn mẫu hiện CHUNG cho cả Bán Lẻ/Bán
// Buôn dù đang mở sub-tab nào -> xoá 1 mẫu tưởng riêng của 1 kênh thực chất xoá khỏi CẢ 2 kênh.
//
// Đã vá: thêm field `priceType` (RETAIL/WHOLESALE/không có = mẫu cũ, hiện ở CẢ 2 kênh) — cả client
// (module-itsupport-price.js: addItPriceMasterList()/renderItPriceMasterListAdmin()/
// renderItPriceMasterListSelect(), lọc lại theo activeItPriceSubTab mỗi lần đổi sub-tab qua
// setItPriceSubTab()) lẫn server (lib/createValidation.js: chỉ ép buộc chọn mẫu trong số mẫu ĐÚNG kênh,
// và mẫu chọn phải thuộc đúng kênh hoặc là mẫu cũ).
//
// Chạy: node server/tests/test-itprice-mastertlist-channel-split.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');
const { validateAndPrepareCreate } = require('../lib/createValidation');

const PORT = 8997;

// ===================== Phần server (đơn vị thuần, không cần trình duyệt) =====================
async function runServerTests(run) {
  const DEPT = 'Kinh Doanh';
  const GOOD_URL = '/uploads/1717171717171-0123456789abcdef.pdf';
  const PRICE_ITEMS = [{ values: { c0: 'Mặt hàng A', c1: '15000' } }];
  const IT_USER = { username: 'it1', name: 'Người Đề Xuất Giá', dept: DEPT, perms: { itPriceProposeCreateWholesale: true, itPriceProposeCreateRetail: true } };

  const RETAIL_LIST = { id: 1, name: 'Mẫu Bán Lẻ', priceType: 'RETAIL', columns: [{ key: 'c0', label: 'Tên' }, { key: 'c1', label: 'Giá' }] };
  const WHOLESALE_LIST = { id: 2, name: 'Mẫu Bán Buôn', priceType: 'WHOLESALE', columns: [{ key: 'c0', label: 'Tên' }, { key: 'c1', label: 'Giá' }] };
  const LEGACY_LIST = { id: 3, name: 'Mẫu Cũ (chưa gắn kênh)', columns: [{ key: 'c0', label: 'Tên' }, { key: 'c1', label: 'Giá' }] };

  const appDataWith = (lists) => ({ formTemplates: {}, stores: ['Siêu thị A'], priceZones: ['Miền Bắc'], itPriceMasterLists: lists });

  const basePayload = (over) => ({
    dept: DEPT, reason: 'Áp giá', priceType: 'RETAIL', effectiveDate: '2026-09-01',
    files: [{ fileUrl: GOOD_URL, fileName: 'bang-gia.xlsx', items: PRICE_ITEMS, columnLabels: [] }],
    ...over
  });

  function expectHttpError(fn, status, messagePart) {
    let thrown = null;
    try { fn(); } catch (err) { thrown = err; }
    if (!thrown) throw new Error(`Đáng lẽ phải ném lỗi (${status}) nhưng chạy thành công`);
    if (thrown.status !== status) throw new Error(`Sai mã lỗi: mong ${status}, thực tế ${thrown.status} (${thrown.message})`);
    if (messagePart && !String(thrown.message).includes(messagePart)) {
      throw new Error(`Sai nội dung lỗi: mong chứa "${messagePart}", thực tế "${thrown.message}"`);
    }
  }

  await run.run('Chỉ có mẫu WHOLESALE, đề xuất RETAIL không chọn mẫu nào -> vẫn thành công (không bị ép chọn mẫu của kênh khác)', () => {
    const rec = validateAndPrepareCreate('itPriceApprovals', basePayload({ priceType: 'RETAIL' }), IT_USER, [], appDataWith([WHOLESALE_LIST]));
    assertEqual(rec.masterListId, null, 'RETAIL không có mẫu nào của kênh mình -> masterListId phải null, không bị ép');
  });

  await run.run('Có mẫu RETAIL, đề xuất RETAIL không chọn mẫu nào -> 400 (bắt buộc chọn)', () => {
    expectHttpError(() => validateAndPrepareCreate('itPriceApprovals', basePayload({ priceType: 'RETAIL' }), IT_USER, [], appDataWith([RETAIL_LIST])),
      400, 'Vui lòng chọn đúng Mẫu Giá Phê Duyệt');
  });

  await run.run('LỖI ĐÃ VÁ: đề xuất RETAIL trỏ tới masterListId của kênh WHOLESALE -> bị coi như không hợp lệ -> 400 (trước đây không phân biệt kênh, sẽ chấp nhận nhầm)', () => {
    expectHttpError(() => validateAndPrepareCreate('itPriceApprovals', basePayload({ priceType: 'RETAIL', masterListId: WHOLESALE_LIST.id }), IT_USER, [], appDataWith([RETAIL_LIST, WHOLESALE_LIST])),
      400, 'Vui lòng chọn đúng Mẫu Giá Phê Duyệt');
  });

  await run.run('Đề xuất RETAIL chọn đúng mẫu RETAIL -> thành công, lưu đúng masterListId/masterListName', () => {
    const rec = validateAndPrepareCreate('itPriceApprovals', basePayload({ priceType: 'RETAIL', masterListId: RETAIL_LIST.id }), IT_USER, [], appDataWith([RETAIL_LIST, WHOLESALE_LIST]));
    assertEqual(rec.masterListId, RETAIL_LIST.id);
    assertEqual(rec.masterListName, RETAIL_LIST.name);
  });

  await run.run('Đề xuất WHOLESALE chọn đúng mẫu WHOLESALE -> thành công (đối xứng test trên)', () => {
    const rec = validateAndPrepareCreate('itPriceApprovals',
      basePayload({ priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5', wholesaleApplyUnit: 'Đại lý ABC', storeScope: { mode: 'OTHER', stores: ['Siêu thị A'] }, masterListId: WHOLESALE_LIST.id }),
      IT_USER, [], appDataWith([RETAIL_LIST, WHOLESALE_LIST]));
    assertEqual(rec.masterListId, WHOLESALE_LIST.id);
  });

  await run.run('Mẫu CŨ chưa gắn priceType -> hợp lệ cho CẢ 2 kênh (RETAIL chọn được)', () => {
    const rec = validateAndPrepareCreate('itPriceApprovals', basePayload({ priceType: 'RETAIL', masterListId: LEGACY_LIST.id }), IT_USER, [], appDataWith([LEGACY_LIST]));
    assertEqual(rec.masterListId, LEGACY_LIST.id, 'Mẫu cũ chưa gắn kênh phải dùng được cho RETAIL');
  });

  await run.run('Mẫu CŨ chưa gắn priceType -> hợp lệ cho CẢ 2 kênh (WHOLESALE cũng chọn được)', () => {
    const rec = validateAndPrepareCreate('itPriceApprovals',
      basePayload({ priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5', wholesaleApplyUnit: 'Đại lý ABC', storeScope: { mode: 'OTHER', stores: ['Siêu thị A'] }, masterListId: LEGACY_LIST.id }),
      IT_USER, [], appDataWith([LEGACY_LIST]));
    assertEqual(rec.masterListId, LEGACY_LIST.id, 'Mẫu cũ chưa gắn kênh phải dùng được cho WHOLESALE');
  });
}

// ===================== Phần client (UI thật qua Playwright) =====================
async function runClientTests(run) {
  const ADMIN = { username: 'admin', name: 'Quản Trị', dept: 'IT', perms: { admin: true }, active: true };
  const state = createMockState({
    users: [ADMIN],
    itPriceMasterLists: [
      { id: 1, name: 'Mẫu Bán Lẻ', priceType: 'RETAIL', columns: [{ key: 'c0', label: 'Tên' }], uploadedByName: 'AD', uploadedAt: '' },
      { id: 2, name: 'Mẫu Bán Buôn', priceType: 'WHOLESALE', columns: [{ key: 'c0', label: 'Tên' }], uploadedByName: 'AD', uploadedAt: '' },
      { id: 3, name: 'Mẫu Cũ Chưa Gắn Kênh', columns: [{ key: 'c0', label: 'Tên' }], uploadedByName: 'AD', uploadedAt: '' }
    ]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('itSupport'));
    await page.waitForTimeout(150);
    await page.evaluate(() => setItSupportSubTab('PRICE'));
    await page.waitForTimeout(150);

    async function adminTableText() {
      return page.evaluate(() => document.getElementById('itPriceMasterListTableBody').innerText);
    }
    async function selectOptionTexts() {
      return page.evaluate(() => Array.from(document.getElementById('itPriceMasterListSelect').options).map(o => o.text));
    }

    await run.run('Mặc định mở Bán Lẻ: panel quản trị CHỈ hiện mẫu Bán Lẻ + mẫu cũ, KHÔNG hiện mẫu Bán Buôn', async () => {
      const txt = await adminTableText();
      assert(txt.includes('Mẫu Bán Lẻ'), 'Phải thấy Mẫu Bán Lẻ');
      assert(txt.includes('Mẫu Cũ Chưa Gắn Kênh'), 'Mẫu cũ (chưa gắn kênh) phải hiện ở cả 2 kênh');
      assert(!txt.includes('Mẫu Bán Buôn'), 'LỖI ĐÃ VÁ: Bán Lẻ không được thấy mẫu của Bán Buôn');
    });

    await run.run('Dropdown chọn mẫu ở form tạo đề xuất cũng lọc đúng như panel quản trị', async () => {
      const texts = await selectOptionTexts();
      const joined = texts.join('|');
      assert(joined.includes('Mẫu Bán Lẻ'), 'Dropdown phải có Mẫu Bán Lẻ');
      assert(joined.includes('Mẫu Cũ Chưa Gắn Kênh'), 'Dropdown phải có mẫu cũ');
      assert(!joined.includes('Mẫu Bán Buôn'), 'Dropdown không được có mẫu của kênh khác');
    });

    await run.run('Chuyển sang sub-tab Bán Buôn: panel quản trị + dropdown tự vẽ lại, giờ hiện mẫu Bán Buôn + mẫu cũ, ẩn mẫu Bán Lẻ', async () => {
      await page.click('#btnItPriceSubWholesale');
      await page.waitForTimeout(150);
      const txt = await adminTableText();
      assert(txt.includes('Mẫu Bán Buôn'), 'Bán Buôn phải thấy đúng mẫu của mình');
      assert(txt.includes('Mẫu Cũ Chưa Gắn Kênh'), 'Mẫu cũ vẫn hiện ở kênh này');
      assert(!txt.includes('Mẫu Bán Lẻ'), 'LỖI ĐÃ VÁ: Bán Buôn không được thấy mẫu của Bán Lẻ');
      const texts = await selectOptionTexts();
      assert(!texts.join('|').includes('Mẫu Bán Lẻ'), 'Dropdown Bán Buôn không được có mẫu Bán Lẻ');
    });

    await run.run('LỖI ĐÃ VÁ ("xoá giá mẫu là xoá hết"): xoá mẫu Bán Buôn (id=2) đang xem KHÔNG đụng tới mẫu Bán Lẻ (id=1) trong DB.itPriceMasterLists', async () => {
      await page.evaluate(() => deleteItPriceMasterList(2));
      await page.waitForTimeout(150);
      const remaining = await page.evaluate(() => (DB.itPriceMasterLists || []).map(m => m.id));
      assert(remaining.includes(1), 'Mẫu Bán Lẻ (id=1) phải CÒN NGUYÊN sau khi xoá mẫu Bán Buôn — trước đây là 1 mảng chung, hành vi đúng vẫn phải giữ (test đối chứng, không phải lỗi mới)');
      assert(!remaining.includes(2), 'Mẫu Bán Buôn (id=2) phải đã bị xoá đúng');
      assert(remaining.includes(3), 'Mẫu cũ chưa gắn kênh (id=3) không liên quan, phải còn nguyên');
    });

    await run.run('Quay lại Bán Lẻ: mẫu Bán Lẻ (id=1) vẫn còn nguyên, không hề bị ảnh hưởng bởi việc xoá ở kênh Bán Buôn', async () => {
      await page.click('#btnItPriceSubRetail');
      await page.waitForTimeout(150);
      const txt = await adminTableText();
      assert(txt.includes('Mẫu Bán Lẻ'), 'Mẫu Bán Lẻ phải vẫn còn sau khi xoá 1 mẫu ở kênh Bán Buôn');
    });
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const run = createRunner();
  runServerTests(run);
  await runClientTests(run);
  run.summary();
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
