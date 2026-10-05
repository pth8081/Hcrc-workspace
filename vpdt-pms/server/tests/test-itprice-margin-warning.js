// server/tests/test-itprice-margin-warning.js
//
// Yêu cầu người dùng (9/2026 rà soát nghiệp vụ, mục 4 "Giá bán buôn... đặt cột KT margin, check thông
// báo nếu sai"): checkItPriceMarginConsistency() (public/js/module-itsupport-price.js) đối chiếu mức
// Margin/Chiết Khấu người đề xuất TỰ CHỌN (#itPriceTier) với số liệu THẬT trong cột đã gán vai trò
// "Margin/Chiết Khấu" (admin gán 1 lần cho Mẫu Giá qua "🎯 Cột Margin/CK") của file bảng giá vừa tải lên —
// CHỈ CẢNH BÁO (không chặn gửi) khi TRUNG BÌNH CỘNG số liệu thật KHÔNG khớp mức đã chọn.
//
// Đợt 10/2026 (theo yêu cầu người dùng): trước đây CẢ 4 tier (MARGIN_LT5/MARGIN_GTE5/DISCOUNT_LTE5/
// DISCOUNT_GT5) CÙNG đọc chung 1 cột marginColumnKey — nay tách 2 vai trò cột RIÊNG: marginColumnKey cho
// 2 tier MARGIN_*, discountColumnKey (MỚI) cho 2 tier DISCOUNT_* — xem itPriceColumnKeyForTier(). Bước
// chọn cột này giờ CHỈ còn hỏi ở Bán Buôn (ẩn hẳn khỏi Bán Lẻ, xem renderItPriceMasterListAdmin()) nhưng
// không ảnh hưởng tới test này (chỉ test logic đối chiếu ở form Bán Buôn, không đụng màn quản trị).
//
// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #11): dùng THUẦN trung bình cộng có
// thể bị vài dòng margin cao che mất khi trung bình hoá cùng nhiều dòng thấp (dòng đó đáng ra thuộc mức
// MARGIN_GTE5, đi quy trình duyệt khác). Đã sửa checkItPriceMarginConsistency() để cảnh báo nếu BẤT KỲ
// dòng nào (không chỉ trung bình) sai phía so với mức đã chọn — xem 2 kịch bản "straddle" bên dưới. Cũng
// sửa parseItPriceMarginNumber() để đọc đúng số dạng "1.234,5" (dấu chấm phân cách nghìn, dấu phẩy thập
// phân) — trước đây .replace(',', '.') chỉ thay dấu phẩy ĐẦU TIÊN, ra NaN, âm thầm bị lọc khỏi tính toán.
//
// Gọi qua REAL app thật (Playwright + public/index.html + module-itsupport-price.js thật) — không chép
// lại logic đối chiếu.
//
// Chạy: node server/tests/test-itprice-margin-warning.js
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8994;
const STAFF = { username: 'staff_mkt', name: 'Trần Thị Marketing', dept: 'Marketing', perms: { itPriceProposeCreateWholesale: true, itPriceProposeCreateRetail: true }, active: true };

const MASTER_LIST_WITH_MARGIN = {
  id: 1, name: 'Bảng Giá Có Cột Margin', marginColumnKey: 'margin', discountColumnKey: 'discount',
  columns: [
    { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
    { key: 'margin', label: 'Margin (%)' }, { key: 'discount', label: 'Chiết Khấu (%)' }
  ],
  fileUrl: '/uploads/mau-co-margin.xlsx', fileName: 'mau-co-margin.xlsx',
  uploadedBy: 'admin', uploadedByName: 'Quản Trị Viên', uploadedAt: new Date().toLocaleString('vi-VN')
};
const MASTER_LIST_NO_MARGIN = {
  id: 2, name: 'Bảng Giá Không Có Cột Margin', marginColumnKey: null, discountColumnKey: null,
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

// colKey: 'margin' hoặc 'discount' — field THẬT trong items phải khớp đúng marginColumnKey/
// discountColumnKey của Mẫu Giá đang chọn (2 cột RIÊNG từ 10/2026, xem itPriceColumnKeyForTier()).
function seedPendingFileWithMargins(page, values, colKey = 'margin') {
  return page.evaluate(({ vals, ck }) => {
    itPricePendingFile = {
      fileUrl: '/uploads/gia-margin-test.xlsx', fileName: 'gia-margin-test.xlsx',
      items: vals.map((v, i) => ({ values: { code: `SP00${i + 1}`, name: `Mặt hàng ${i + 1}`, [ck]: v } })),
      columnLabels: [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }, { key: ck, label: ck === 'margin' ? 'Margin (%)' : 'Chiết Khấu (%)' }]
    };
    checkItPriceMarginConsistency();
  }, { vals: values, ck: colKey });
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
    // 10/2026 (đợt tách Phê Duyệt Giá khỏi Hỗ Trợ IT): cảnh báo Margin/Chiết Khấu CHỈ còn tồn tại ở form
    // Bán Buôn (Vận Hành, module-itsupport-price.js/module-vanhanh.js) — không còn sub-tab switcher
    // Bán Lẻ/Bán Buôn chung 1 form nữa, nên KHÔNG cần bấm btnItPriceSubWholesale (luôn là Bán Buôn khi
    // vào tab này).
    await page.evaluate(async () => { await switchTab('vanHanh'); setVanHanhSubTab('ITPRICE'); });
    await page.waitForTimeout(150);
    // Thu gọn form (10/2026) — #itPriceCreateForm giờ mặc định ẨN, phải bấm "+ Đề Xuất Mới"
    // (openItPriceCreateForm()) trước khi thao tác field bên trong (page.selectOption() cần phần tử visible).
    await page.evaluate(() => openItPriceCreateForm());

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

    await run.run('Đổi mức Chiết Khấu (DISCOUNT_LTE5) với số liệu chiết khấu thật avg 8% (>5%) -> cảnh báo HIỆN, đọc đúng cột discountColumnKey RIÊNG (không phải cột margin)', async () => {
      await page.selectOption('#itPriceTier', 'DISCOUNT_LTE5');
      // Đợt 10/2026: tier DISCOUNT_* giờ đọc discountColumnKey ('discount'), KHÔNG còn đọc chung
      // marginColumnKey như trước — cố tình seed cột 'margin' (nếu còn đọc nhầm) với số liệu KHÁC để phân
      // biệt rõ: nếu code vẫn đọc nhầm cột margin (rỗng ở seed này) thì nums sẽ rỗng -> cảnh báo ẨN SAI.
      await seedPendingFileWithMargins(page, ['7%', '8%', '9%'], 'discount'); // avg = 8, KHÔNG khớp DISCOUNT_LTE5 (<=5)
      const s = await warningState(page);
      assertEqual(s.hidden, false, 'Chiết khấu 8% trung bình vượt mức DISCOUNT_LTE5 (<=5%): cảnh báo phải hiện, đọc đúng cột discountColumnKey');
    });

    await run.run('LỖI ĐÃ VÁ: mức MARGIN_LT5, đa số dòng THẤP nhưng 1 dòng margin CAO (30%) bị trung bình hoá che mất -> vẫn PHẢI cảnh báo (trước đây avg=8.75<... thực ra avg vẫn >=5 ở đây; dùng bộ số khiến avg < 5 nhưng có dòng >= 5)', async () => {
      await page.selectOption('#itPriceMasterListSelect', String(MASTER_LIST_WITH_MARGIN.id));
      await page.waitForTimeout(100);
      await page.selectOption('#itPriceTier', 'MARGIN_LT5');
      // 9 dòng 1% (thấp) + 1 dòng 30% (cao) -> avg = (9*1+30)/10 = 3.9% -- vẫn < 5% nên TRUNG BÌNH CỘNG cũ
      // sẽ ẩn cảnh báo dù có 1 dòng (30%) rõ ràng thuộc mức MARGIN_GTE5 (đi quy trình duyệt khác).
      await seedPendingFileWithMargins(page, ['1%', '1%', '1%', '1%', '1%', '1%', '1%', '1%', '1%', '30%']);
      const s = await warningState(page);
      assertEqual(s.hidden, false, 'LỖI ĐÃ VÁ: dù trung bình (3.9%) vẫn khớp MARGIN_LT5, có 1 dòng (30%) sai phía -> PHẢI cảnh báo, không được ẩn theo trung bình như bản cũ');
      assert(/1\/10|30\.0%/.test(s.text), `Nội dung cảnh báo nên nêu số dòng sai phía hoặc giá trị lớn nhất 30.0% -- thực tế: "${s.text}"`);
    });

    await run.run('Đối chứng: TẤT CẢ dòng đều khớp MARGIN_LT5 (không dòng nào sai phía) -> cảnh báo ẨN như cũ (không cảnh báo oan)', async () => {
      await seedPendingFileWithMargins(page, ['1%', '2%', '3%', '4%', '4.5%']);
      const s = await warningState(page);
      assertEqual(s.hidden, true, 'Không dòng nào sai phía -> không được cảnh báo oan');
    });

    await run.run('LỖI ĐÃ VÁ: parseItPriceMarginNumber đọc đúng số dạng "1.234,5%" (dấu chấm phân cách nghìn, dấu phẩy thập phân) -> không bị NaN/bỏ sót khỏi tính toán', async () => {
      // Chọn MARGIN_LT5 (không phải GTE5) để PHÂN BIỆT được 2 khả năng: (a) parse ĐÚNG thành 1234.5 (>=5,
      // SAI PHÍA so với MARGIN_LT5) -> cảnh báo PHẢI HIỆN; (b) parse LỖI ra NaN (bug cũ, .replace(',', '.')
      // chỉ thay dấu phẩy ĐẦU TIÊN -> "1.234.5" -> Number() = NaN) -> bị lọc khỏi nums[], nums rỗng ->
      // return sớm (!nums.length) -> cảnh báo ẨN. 2 khả năng cho kết quả HIỂN THỊ khác hẳn nhau, phân biệt
      // được rõ ràng (khác hẳn khi test bằng MARGIN_GTE5 ở trên, cả 2 khả năng đều cho cùng kết quả "ẩn").
      await page.selectOption('#itPriceTier', 'MARGIN_LT5');
      await seedPendingFileWithMargins(page, ['1.234,5%']);
      const s = await warningState(page);
      assertEqual(s.hidden, false, 'Giá trị "1.234,5%" phải đọc đúng thành 1234.5 (>=5%, sai phía MARGIN_LT5) -> cảnh báo PHẢI HIỆN; nếu ẩn nghĩa là parse ra NaN rồi bị lọc mất (lỗi CŨ chưa vá)');
    });

    await run.run('2 cột Margin/Chiết Khấu ĐỘC LẬP nhau: cùng 1 file có cả 2 cột, đổi tier chỉ đổi cột được đọc, không lẫn số liệu', async () => {
      await page.selectOption('#itPriceMasterListSelect', String(MASTER_LIST_WITH_MARGIN.id));
      await page.waitForTimeout(100);
      // margin khớp MARGIN_LT5 (toàn bộ < 5%), nhưng discount lại KHÔNG khớp DISCOUNT_LTE5 (toàn bộ > 5%)
      // -- cùng 1 itPricePendingFile, nếu code lỡ đọc nhầm cột sẽ cho kết quả ẨN/HIỆN SAI ở 1 trong 2 tier.
      await page.evaluate(() => {
        itPricePendingFile = {
          fileUrl: '/x', fileName: 'x.xlsx',
          items: [
            { values: { code: 'SP001', name: 'A', margin: '2%', discount: '8%' } },
            { values: { code: 'SP002', name: 'B', margin: '3%', discount: '9%' } }
          ],
          columnLabels: []
        };
      });
      await page.selectOption('#itPriceTier', 'MARGIN_LT5');
      await page.evaluate(() => checkItPriceMarginConsistency());
      const sMargin = await warningState(page);
      assertEqual(sMargin.hidden, true, 'Tier MARGIN_LT5 phải đọc cột margin (2%/3%, khớp) -- KHÔNG được lẫn sang cột discount (8%/9%, sẽ sai)');

      await page.selectOption('#itPriceTier', 'DISCOUNT_LTE5');
      await page.waitForTimeout(100);
      const sDiscount = await warningState(page);
      assertEqual(sDiscount.hidden, false, 'Tier DISCOUNT_LTE5 phải đọc cột discount (8%/9%, KHÔNG khớp <=5%) -- KHÔNG được lẫn sang cột margin (2%/3%, sẽ khớp nhầm)');
    });

    await run.run('Form Bán Lẻ (Mua Hàng) không có khối cảnh báo margin nào (chỉ áp dụng Bán Buôn, 2 form giờ tách vật lý)', async () => {
      await page.evaluate(async () => { await switchTab('muaHang'); setPurchasingSubTab('ITPRICE'); });
      await page.waitForTimeout(150);
      const noTierField = await page.evaluate(() => !document.getElementById('mhSubItprice')?.querySelector('#itPriceTier, #itPriceMarginWarningWrap'));
      assert(noTierField, 'Form Bán Lẻ (Mua Hàng) không được có field Mức Margin/Chiết Khấu hay khối cảnh báo margin nào (chỉ Bán Buôn mới có)');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
