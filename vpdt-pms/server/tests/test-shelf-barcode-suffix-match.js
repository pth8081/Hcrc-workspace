// tests/test-shelf-barcode-suffix-match.js — "Gõ tay 6 số cuối theo mã NCC (Mã Vạch) hoặc mã nội bộ (Mã
// Hàng)" (11/2026, theo yêu cầu TRỰC TIẾP của người dùng: "kiểm tra 6 số cuối theo mã ncc hoặc nội bộ").
// Dùng page.fill()/page.click() lên ĐÚNG ô/nút thật trên DOM (không gọi hàm trực tiếp qua page.evaluate())
// — cùng bài học test-shelf-subtab-real-click.js: gọi hàm trực tiếp không bắt được lỗi dispatch CSP thật.
//
// Phạm vi test:
//  1. "💲 Kiểm Tra Giá": gõ ĐÚNG 6 số cuối khớp DUY NHẤT 1 mặt hàng (qua Mã Vạch) -> tự tra giá NGAY,
//     không cần hỏi gì thêm.
//  2. "💲 Kiểm Tra Giá": gõ ĐÚNG 6 số cuối khớp NHIỀU mặt hàng (2 Mã Hàng khác nhau nhưng cùng 6 số cuối)
//     -> PHẢI hiện danh sách chọn, KHÔNG tự ý tra giá đại 1 mặt hàng — bấm chọn đúng 1 dòng mới tra giá.
//  3. "💲 Kiểm Tra Giá": gõ 6 số cuối KHÔNG khớp mặt hàng nào -> rơi về hành vi CŨ (gửi nguyên làm Mã
//     Vạch), server/đối tác báo không tìm thấy — không bị lỗi JS/treo.
//  4. "📷 Ghi Nhận": gõ tay vào ô Mã Vạch (#srSku) ĐÚNG 6 số cuối khớp DUY NHẤT -> tự điền Mã Hàng + Tên
//     Sản Phẩm, có ghi chú "theo 6 số cuối".
//  5. "📷 Ghi Nhận": gõ tay 6 số cuối khớp NHIỀU mặt hàng -> KHÔNG tự điền Mã Hàng (tránh sai), chỉ báo rõ
//     số lượng khớp + hướng dẫn dùng picker.
//  6. (11/2026, 2 LỖI THẬT người dùng báo kèm ảnh chụp trên production, SAU khi tính năng ở trên đã merge)
//     "💲 Kiểm Tra Giá": dữ liệu tồn kho hệ thống có 3 dòng HOÀN TOÀN GIỐNG NHAU (cùng Mã Hàng/Mã Vạch —
//     dữ liệu thô từ API đối tác lặp dòng, xem lib/shelfInventoryAggregate.js) -> gõ 6 số cuối phải khớp
//     DUY NHẤT 1 mặt hàng (đã gộp ở server, routes/shelfStock.js), KHÔNG được hiện "khớp 3 mặt hàng" giả.
//  7. "📷 Ghi Nhận": gõ tay 6 số cuối TRỰC TIẾP vào ô "Mã Hàng (nội bộ)" (#srMaHang, KHÔNG phải #srSku) ->
//     cũng phải tự nhận diện được (điền ngược lại Mã Vạch + Tên Sản Phẩm) — LỖI THẬT người dùng báo: ô này
//     trước đây không có handler nào, gõ gì cũng không phản hồi vì Ghi Nhận không có nút "xác nhận" riêng
//     như Kiểm Tra Giá.
//
// Chạy: node server/tests/test-shelf-barcode-suffix-match.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8991;
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true
  };
  const state = createMockState({ depts: ['Siêu thị Quận 1'], users: [USER] });
  state.storeExternalCodes = { 'Siêu thị Quận 1': '001' };
  state.__mockPriceCheckConfigured = true;
  // rowA: 6 số cuối "890123" CHỈ xuất hiện ở Mã Vạch của đúng 1 dòng -> khớp DUY NHẤT.
  // rowB/rowC: CÙNG 6 số cuối "440456" ở Mã Hàng (2 Mã Hàng khác nhau: 1000440456/2000440456) -> khớp
  // NHIỀU dòng -> phải hỏi chọn, không tự đoán.
  // rowD/rowE/rowF: 2 LỖI THẬT người dùng báo (11/2026) — dữ liệu thô đối tác trả 3 dòng HOÀN TOÀN
  // GIỐNG NHAU cho ĐÚNG 1 mã hàng thật (G7 Cà Phê 3in1, đúng ví dụ ảnh chụp người dùng gửi) -> phải được
  // server GỘP (aggregateSystemInventoryRowsByMaHang(), mirror ở testHarness.js) thành 1 dòng duy nhất
  // TRƯỚC khi tới logic khớp-6-số-cuối, không được báo "khớp 3 mặt hàng" giả.
  state.__mockSystemInventoryRows = [
    { maHang: '2003330123', maVach: '8934567890123', tenHang: 'Sữa tươi TH True Milk 1L', soLuongTon: 50 },
    { maHang: '1000440456', maVach: '8934000112233', tenHang: 'Nước suối Aquafina 500ml', soLuongTon: 30 },
    { maHang: '2000440456', maVach: '8934999887766', tenHang: 'Nước khoáng Lavie 500ml', soLuongTon: 20 },
    { maHang: '2002092675', maVach: '8935024912607', tenHang: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', soLuongTon: 14 },
    { maHang: '2002092675', maVach: '8935024912607', tenHang: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', soLuongTon: 14 },
    { maHang: '2002092675', maVach: '8935024912607', tenHang: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', soLuongTon: 14 }
  ];
  state.__mockPriceCheckResults = {
    '2003330123': { maHang: '2003330123', tenHang: 'Sữa tươi TH True Milk 1L', maVach: '8934567890123', giaThuong: 24000, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: '2026-11-12T09:00:00.000Z' },
    '1000440456': { maHang: '1000440456', tenHang: 'Nước suối Aquafina 500ml', maVach: '8934000112233', giaThuong: 10000, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: '2026-11-12T09:01:00.000Z' },
    '2002092675': { maHang: '2002092675', tenHang: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', maVach: '8935024912607', giaThuong: 79600, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: '2026-11-13T08:00:00.000Z' }
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(async () => { await switchTab('vanHanh'); });
    await page.waitForSelector('[data-op="setVanHanhSubTab"][data-tab="SHELF"]', { state: 'visible' });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.waitForTimeout(100);

    await run.run('"💲 Kiểm Tra Giá": vào tab tự nạp Tồn Kho Hệ Thống (cache dùng để khớp 6 số cuối, đã GỘP trùng mã hàng)', async () => {
      await page.click('#btnVhShelfSubPriceCheck');
      await page.waitForTimeout(200); // chờ loadShelfSystemInventoryForRecordPicker() (fetch mock) nạp xong cache
      const cacheLen = await page.evaluate(() => shelfSystemInventoryCache.length);
      // Seed 6 dòng thô (3 mã hàng đơn + 3 dòng trùng của G7 Cà Phê) -> server GỘP G7 Cà Phê thành 1 ->
      // cache phải còn đúng 4 mã hàng DUY NHẤT, không phải 6.
      assertEqual(cacheLen, 4, `shelfSystemInventoryCache phải GỘP trùng mã hàng (6 dòng thô -> 4 mã hàng duy nhất), thực tế: ${cacheLen}`);
    });

    await run.run('Kiểm Tra Giá: gõ ĐÚNG 6 số cuối khớp DUY NHẤT 1 mặt hàng -> tự tra giá NGAY, không hỏi gì', async () => {
      await page.fill('#pcMaHang', '890123');
      await page.click('#priceCheckForm button[type="submit"]');
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => ({
        resultVisible: !document.getElementById('priceCheckResultWrap').classList.contains('hidden'),
        suffixPickerHidden: document.getElementById('priceCheckSuffixPickerWrap').classList.contains('hidden'),
        tenHang: document.getElementById('pcResultTenHang').textContent,
        giaApDung: document.getElementById('pcResultGiaApDung').textContent
      }));
      assert(result.suffixPickerHidden, 'Khớp DUY NHẤT thì KHÔNG được hiện danh sách chọn');
      assert(result.resultVisible, 'Phải hiện thẳng kết quả tra giá');
      assert(result.tenHang.includes('Sữa tươi TH True Milk 1L'), `Tên hàng sai: ${result.tenHang}`);
      assert(result.giaApDung.includes('24.000'), `Giá sai: ${result.giaApDung}`);
      await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
      await page.waitForTimeout(50);
    });

    await run.run('Kiểm Tra Giá: gõ ĐÚNG 6 số cuối khớp NHIỀU mặt hàng -> PHẢI hiện danh sách chọn, KHÔNG tự tra giá đại', async () => {
      await page.fill('#pcMaHang', '440456');
      await page.click('#priceCheckForm button[type="submit"]');
      await page.waitForTimeout(100);
      const picker = await page.evaluate(() => ({
        pickerVisible: !document.getElementById('priceCheckSuffixPickerWrap').classList.contains('hidden'),
        resultHidden: document.getElementById('priceCheckResultWrap').classList.contains('hidden'),
        codeShown: document.getElementById('pcSuffixCodeShown').textContent,
        candidateCount: document.querySelectorAll('#priceCheckSuffixCandidatesList button[data-op="selectPriceCheckSuffixCandidate"]').length,
        candidateText: document.getElementById('priceCheckSuffixCandidatesList').textContent
      }));
      assert(picker.pickerVisible, 'Phải hiện khối chọn mặt hàng khi 6 số cuối khớp nhiều dòng');
      assert(picker.resultHidden, 'KHÔNG được tự ý hiện kết quả tra giá khi còn mơ hồ');
      assertEqual(picker.codeShown, '440456', `Phải hiện đúng mã đã gõ, thực tế: ${picker.codeShown}`);
      assertEqual(picker.candidateCount, 2, `Phải có đúng 2 lựa chọn, thực tế: ${picker.candidateCount}`);
      assert(picker.candidateText.includes('Nước suối Aquafina 500ml') && picker.candidateText.includes('Nước khoáng Lavie 500ml'),
        `Danh sách chọn phải nêu đủ tên cả 2 mặt hàng, thực tế: ${picker.candidateText}`);

      // Bấm chọn ĐÚNG dòng Aquafina -> phải tra giá đúng Mã Hàng 1000440456 (không lẫn sang Lavie).
      await page.click('#priceCheckSuffixCandidatesList button:has-text("Aquafina")');
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => ({
        resultVisible: !document.getElementById('priceCheckResultWrap').classList.contains('hidden'),
        tenHang: document.getElementById('pcResultTenHang').textContent,
        maHangLine: document.getElementById('pcResultMaHang').textContent
      }));
      assert(result.resultVisible, 'Sau khi chọn đúng 1 dòng phải tra giá và hiện kết quả');
      assert(result.tenHang.includes('Nước suối Aquafina 500ml'), `Phải tra ĐÚNG mặt hàng vừa chọn, thực tế: ${result.tenHang}`);
      assert(result.maHangLine.includes('1000440456'), `Phải tra đúng Mã Hàng của dòng đã chọn (không lẫn sang 2000440456), thực tế: ${result.maHangLine}`);
      await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
      await page.waitForTimeout(50);
    });

    await run.run('Kiểm Tra Giá: gõ 6 số cuối KHÔNG khớp mặt hàng nào -> rơi về hành vi cũ (gửi làm Mã Vạch), báo không tìm thấy, không lỗi JS', async () => {
      await page.fill('#pcMaHang', '999999');
      await page.click('#priceCheckForm button[type="submit"]');
      await page.waitForTimeout(150);
      const state2 = await page.evaluate(() => ({
        errorVisible: !document.getElementById('priceCheckErrorWrap').classList.contains('hidden'),
        pickerHidden: document.getElementById('priceCheckSuffixPickerWrap').classList.contains('hidden'),
        errorText: document.getElementById('priceCheckErrorText').textContent
      }));
      assert(state2.pickerHidden, 'Không khớp gì thì KHÔNG được hiện danh sách chọn');
      assert(state2.errorVisible, 'Phải rơi về luồng lỗi cũ (404 từ mock server)');
      assert(/không tìm thấy/i.test(state2.errorText), `Phải báo không tìm thấy giá, thực tế: ${state2.errorText}`);
      await page.click('#priceCheckErrorWrap button[data-op="cancelPriceCheck"]');
      await page.waitForTimeout(50);
    });

    await run.run('"📷 Ghi Nhận": gõ tay 6 số cuối khớp DUY NHẤT vào ô Mã Vạch -> tự điền Mã Hàng + Tên Sản Phẩm', async () => {
      await page.click('#btnVhShelfSubRecord');
      await page.waitForTimeout(200); // chờ loadShelfSystemInventoryForRecordPicker() nạp lại (cũng chạy khi vào RECORD)
      await page.fill('#srSku', '890123');
      await page.dispatchEvent('#srSku', 'input');
      await page.waitForTimeout(50);
      const r = await page.evaluate(() => ({
        maHang: document.getElementById('srMaHang').value,
        productName: document.getElementById('srProductName').value,
        note: document.getElementById('srMaHangMatchNote').textContent
      }));
      assertEqual(r.maHang, '2003330123', `Phải tự điền đúng Mã Hàng, thực tế: ${r.maHang}`);
      assertEqual(r.productName, 'Sữa tươi TH True Milk 1L', `Phải tự điền đúng Tên Sản Phẩm, thực tế: ${r.productName}`);
      assert(/6 số cuối/.test(r.note), `Ghi chú phải nêu rõ khớp theo 6 số cuối, thực tế: ${r.note}`);
    });

    await run.run('"📷 Ghi Nhận": gõ tay 6 số cuối khớp NHIỀU mặt hàng -> KHÔNG tự điền Mã Hàng (tránh sai), chỉ báo rõ số lượng khớp', async () => {
      await page.fill('#srMaHang', '');
      await page.fill('#srProductName', '');
      await page.fill('#srSku', '440456');
      await page.dispatchEvent('#srSku', 'input');
      await page.waitForTimeout(50);
      const r = await page.evaluate(() => ({
        maHang: document.getElementById('srMaHang').value,
        productName: document.getElementById('srProductName').value,
        note: document.getElementById('srMaHangMatchNote').textContent
      }));
      assertEqual(r.maHang, '', `KHÔNG được tự điền Mã Hàng khi còn mơ hồ (2 mặt hàng cùng 6 số cuối), thực tế: ${r.maHang}`);
      assertEqual(r.productName, '', 'KHÔNG được tự điền Tên Sản Phẩm khi còn mơ hồ');
      assert(/2 mặt hàng/.test(r.note) && /picker/i.test(r.note), `Ghi chú phải báo rõ khớp 2 mặt hàng + hướng dẫn dùng picker, thực tế: ${r.note}`);
    });

    await run.run('"💲 Kiểm Tra Giá": gõ 6 số cuối của mã hàng có 3 dòng TRÙNG LẶP (G7 Cà Phê) -> phải khớp DUY NHẤT (đã gộp ở server), KHÔNG báo "khớp 3 mặt hàng" giả', async () => {
      await page.click('#btnVhShelfSubPriceCheck');
      await page.waitForTimeout(100);
      await page.fill('#pcMaHang', '912607');
      await page.click('#priceCheckForm button[type="submit"]');
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => ({
        resultVisible: !document.getElementById('priceCheckResultWrap').classList.contains('hidden'),
        pickerHidden: document.getElementById('priceCheckSuffixPickerWrap').classList.contains('hidden'),
        tenHang: document.getElementById('pcResultTenHang').textContent,
        giaApDung: document.getElementById('pcResultGiaApDung').textContent
      }));
      assert(result.pickerHidden, 'Mã hàng có 3 dòng trùng lặp đã được GỘP thành 1 ở server -> KHÔNG được hiện danh sách "khớp nhiều mặt hàng" giả');
      assert(result.resultVisible, 'Phải hiện thẳng kết quả tra giá (khớp DUY NHẤT sau khi gộp)');
      assert(result.tenHang.includes('G7_Cà phê'), `Tên hàng sai: ${result.tenHang}`);
      assert(result.giaApDung.includes('79.600'), `Giá sai: ${result.giaApDung}`);
      await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
      await page.waitForTimeout(50);
    });

    await run.run('"📷 Ghi Nhận": gõ tay 6 số cuối TRỰC TIẾP vào ô "Mã Hàng (nội bộ)" (#srMaHang) -> tự điền Mã Vạch + Tên Sản Phẩm', async () => {
      await page.click('#btnVhShelfSubRecord');
      await page.waitForTimeout(200);
      await page.fill('#srSku', '');
      await page.fill('#srProductName', '');
      await page.fill('#srMaHang', '912607');
      await page.dispatchEvent('#srMaHang', 'input');
      await page.waitForTimeout(50);
      const r = await page.evaluate(() => ({
        maVach: document.getElementById('srSku').value,
        productName: document.getElementById('srProductName').value,
        note: document.getElementById('srMaHangMatchNote').textContent
      }));
      assertEqual(r.maVach, '8935024912607', `Phải tự điền đúng Mã Vạch khi gõ 6 số cuối vào ô Mã Hàng, thực tế: ${r.maVach}`);
      assertEqual(r.productName, 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', `Phải tự điền đúng Tên Sản Phẩm, thực tế: ${r.productName}`);
      assert(/6 số cuối/.test(r.note), `Ghi chú phải nêu rõ khớp theo 6 số cuối, thực tế: ${r.note}`);
    });

    await run.run('"📷 Ghi Nhận": gõ tay 6 số cuối khớp NHIỀU mặt hàng vào ô "Mã Hàng (nội bộ)" -> KHÔNG tự điền (tránh sai), chỉ báo rõ số lượng khớp', async () => {
      await page.fill('#srSku', '');
      await page.fill('#srProductName', '');
      await page.fill('#srMaHang', '440456');
      await page.dispatchEvent('#srMaHang', 'input');
      await page.waitForTimeout(50);
      const r = await page.evaluate(() => ({
        maVach: document.getElementById('srSku').value,
        productName: document.getElementById('srProductName').value,
        note: document.getElementById('srMaHangMatchNote').textContent
      }));
      assertEqual(r.maVach, '', `KHÔNG được tự điền Mã Vạch khi còn mơ hồ (2 mặt hàng cùng 6 số cuối), thực tế: ${r.maVach}`);
      assertEqual(r.productName, '', 'KHÔNG được tự điền Tên Sản Phẩm khi còn mơ hồ');
      assert(/2 mặt hàng/.test(r.note) && /picker/i.test(r.note), `Ghi chú phải báo rõ khớp 2 mặt hàng + hướng dẫn dùng picker, thực tế: ${r.note}`);
      await page.fill('#srMaHang', '');
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh trong suốt kịch bản: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
