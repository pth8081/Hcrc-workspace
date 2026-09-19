// server/tests/test-itprice-margin-warning.js
//
// Yêu cầu người dùng (9/2026 rà soát nghiệp vụ, mục 4 "Giá bán buôn... đặt cột KT margin, check thông
// báo nếu sai"): checkItPriceMarginConsistency() (public/js/module-itsupport-price.js) đối chiếu mức
// Margin/Chiết Khấu người đề xuất TỰ CHỌN (#itPriceTier) với số liệu THẬT trong cột đã gán vai trò
// "Margin/Chiết Khấu" (marginColumnKey, admin gán 1 lần cho Mẫu Giá qua "🎯 Cột Margin/CK") của file bảng
// giá vừa tải lên — CHỈ CẢNH BÁO (không chặn gửi) khi trung bình cộng số liệu thật KHÔNG khớp mức đã chọn.
//
// Gọi qua REAL app thật (Playwright + public/index.html + module-itsupport-price.js thật) — không chép
// lại logic đối chiếu.
//
// Chạy: node server/tests/test-itprice-margin-warning.js
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8994;
const STAFF = { username: 'staff_mkt', name: 'Trần Thị Marketing', dept: 'Marketing', perms: { itPriceProposeCreateWholesale: true, itPriceProposeCreateRetail: true }, active: true };

const MASTER_LIST_WITH_MARGIN = {
  id: 1, name: 'Bảng Giá Có Cột Margin', marginColumnKey: 'margin',
  columns: [
    { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }, { key: 'margin', label: 'Margin (%)' }
  ],
  fileUrl: '/uploads/mau-co-margin.xlsx', fileName: 'mau-co-margin.xlsx',
  uploadedBy: 'admin', uploadedByName: 'Quản Trị Viên', uploadedAt: new Date().toLocaleString('vi-VN')
};
const MASTER_LIST_NO_MARGIN = {
  id: 2, name: 'Bảng Giá Không Có Cột Margin', marginColumnKey: null,
  columns: [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }],
  fileUrl: '/uploads/mau-khong-margin.xlsx', fileName: 'mau-khong-margin.xlsx',
  uploadedBy: 'admin', uploadedByName: 'Quản Trị Viên', uploadedAt: new Date().toLocaleString('vi-VN')
};

const state = createMockState({
  users: [STAFF],
  itPriceMasterLists: [MASTER_LIST_WITH_MARGIN, MASTER_LIST_NO_MARGIN],
  priceZones: ['Miền Bắc'],
  stores: ['Siêu thị Demo']
});

function seedPendingFileWithMargins(page, marginValues) {
  return page.evaluate((vals) => {
    itPricePendingFile = {
      fileUrl: '/uploads/gia-margin-test.xlsx', fileName: 'gia-margin-test.xlsx',
      items: vals.map((v, i) => ({ values: { code: `SP00${i + 1}`, name: `Mặt hàng ${i + 1}`, margin: v } })),
      columnLabels: [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }, { key: 'margin', label: 'Margin (%)' }]
    };
    checkItPriceMarginConsistency();
  }, marginValues);
}

async function warningState(page) {
  return page.evaluate(() => ({
    hidden: document.getElementById('itPriceMarginWarningWrap').classList.contains('hidden'),
    text: document.getElementById('itPriceMarginWarningText').innerText
  }));
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, STAFF);
    await page.evaluate(() => { switchTab('itSupport'); setItSupportSubTab('PRICE'); });
    await page.waitForTimeout(150);
    await page.click('#btnItPriceSubWholesale');
    await page.waitForTimeout(150);

    await run.run('Chưa chọn Mẫu Giá nào -> cảnh báo LUÔN ẩn dù tải file có cột margin', async () => {
      await page.selectOption('#itPriceTier', 'MARGIN_LT5');
      await seedPendingFileWithMargins(page, ['12%', '13%', '11%']); // trung bình 12% >= 5, KHÔNG khớp MARGIN_LT5 -- nhưng chưa chọn mẫu nên vẫn phải ẩn
      const s = await warningState(page);
      assertEqual(s.hidden, true, 'Chưa chọn Mẫu Giá: cảnh báo phải ẩn');
    });

    await run.run('Chọn Mẫu Giá KHÔNG có cột margin gán sẵn -> cảnh báo vẫn ẩn (marginColumnKey null)', async () => {
      await page.selectOption('#itPriceMasterListSelect', String(MASTER_LIST_NO_MARGIN.id));
      await page.waitForTimeout(100);
      await seedPendingFileWithMargins(page, ['12%', '13%', '11%']);
      const s = await warningState(page);
      assertEqual(s.hidden, true, 'Mẫu Giá không có marginColumnKey: cảnh báo phải ẩn dù số liệu lệch');
    });

    await run.run('Chọn Mẫu Giá CÓ cột margin + chọn mức MARGIN_LT5, nhưng số liệu thật trung bình 12% (>=5%) -> HIỆN cảnh báo lệch, đúng số liệu', async () => {
      await page.selectOption('#itPriceMasterListSelect', String(MASTER_LIST_WITH_MARGIN.id));
      await page.waitForTimeout(100);
      await page.selectOption('#itPriceTier', 'MARGIN_LT5');
      await seedPendingFileWithMargins(page, ['12%', '13%', '11%']); // avg = 12
      const s = await warningState(page);
      assertEqual(s.hidden, false, 'Số liệu 12% trung bình lệch mức MARGIN_LT5 (<5%): cảnh báo phải HIỆN');
      assert(/12\.0%/.test(s.text), `Nội dung cảnh báo phải nêu đúng trung bình 12.0% -- thực tế: "${s.text}"`);
      assert(/không khớp/i.test(s.text), `Nội dung cảnh báo phải nêu rõ "không khớp" -- thực tế: "${s.text}"`);
    });

    await run.run('CÙNG Mẫu Giá + số liệu KHỚP đúng mức đã chọn (MARGIN_LT5, avg 3% < 5%) -> cảnh báo ẨN', async () => {
      await seedPendingFileWithMargins(page, ['2%', '3%', '4%']); // avg = 3, khớp MARGIN_LT5
      const s = await warningState(page);
      assertEqual(s.hidden, true, 'Số liệu khớp mức đã chọn: cảnh báo phải ẩn');
    });

    await run.run('Đổi mức sang MARGIN_GTE5 với CÙNG số liệu (avg 3% < 5%, không còn khớp) -> cảnh báo HIỆN LẠI (data-op-change gọi lại đúng hàm)', async () => {
      await page.selectOption('#itPriceTier', 'MARGIN_GTE5');
      await page.waitForTimeout(100);
      const s = await warningState(page);
      assertEqual(s.hidden, false, 'Đổi mức làm số liệu cũ không còn khớp: cảnh báo phải hiện lại ngay khi đổi mức (không cần tải lại file)');
    });

    await run.run('Đổi mức Chiết Khấu (DISCOUNT_LTE5) với số liệu chiết khấu thật avg 8% (>5%) -> cảnh báo HIỆN, nhánh discount (không phải nhánh margin)', async () => {
      await page.selectOption('#itPriceTier', 'DISCOUNT_LTE5');
      await seedPendingFileWithMargins(page, ['7%', '8%', '9%']); // avg = 8, KHÔNG khớp DISCOUNT_LTE5 (<=5)
      const s = await warningState(page);
      assertEqual(s.hidden, false, 'Chiết khấu 8% trung bình vượt mức DISCOUNT_LTE5 (<=5%): cảnh báo phải hiện');
    });

    await run.run('Chuyển sang sub-tab Bán Lẻ (RETAIL) -> cảnh báo LUÔN ẩn (chỉ áp dụng Bán Buôn)', async () => {
      await page.click('#btnItPriceSubRetail');
      await page.waitForTimeout(150);
      const s = await warningState(page);
      assertEqual(s.hidden, true, 'Sub-tab Bán Lẻ: cảnh báo margin (chỉ dành Bán Buôn) phải luôn ẩn');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
