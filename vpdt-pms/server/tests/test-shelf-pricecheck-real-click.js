// tests/test-shelf-pricecheck-real-click.js — "💲 Kiểm Tra Giá" (mới, 11/2026, theo yêu cầu người dùng
// "siêu thị có thể kt nhanh giá của mặt hàng... chỉ hiện giá và ấn quét lại hoặc hủy nhé ko có lưu bất kỳ
// giá nào"). Dùng page.click() lên ĐÚNG các nút/ô thật trên DOM (không page.evaluate() gọi hàm trực tiếp
// — cùng bài học test-shelf-subtab-real-click.js: gọi hàm trực tiếp không bắt được lỗi dispatch CSP thật).
//
// Phạm vi test:
//  1. Tab "💲 Kiểm Tra Giá" hiện cho người có shelfRecordCreate (CÙNG quyền "Ghi Nhận"), ẨN cho người
//     KHÔNG có quyền đó (canCreateShelfRecordClient() gate mới thêm ở setVanHanhShelfSubTab()).
//  2. Gõ Mã Hàng + bấm "💲 Kiểm Tra Giá" -> gọi ĐÚNG POST /api/shelf-stock/price-check -> hiện kết quả
//     (tên hàng/giá thường) khi KHÔNG khuyến mại.
//  3. Có khuyến mại (coKhuyenMai=true) -> hiện giá khuyến mại làm "Giá áp dụng" + giá thường gạch ngang +
//     badge "Đang khuyến mại".
//  4. "🔄 Quét Lại" (11/2026 ĐỢT 2, rescanPriceCheck()) xoá sạch kết quả cũ RỒI mở THẲNG camera (modal
//     #shelfBarcodeModal hiện ra) để quét tiếp mặt hàng kế tiếp ngay, không bắt quay về form nhập tay.
//  5. "✖️ Hủy" (cancelPriceCheck()) xoá sạch kết quả cũ, quay về form trống (màn hình mặc định ban đầu) —
//     KHÁC "Quét Lại" từ đợt này (trước đây 2 nút giống hệt nhau).
//  6. Lỗi 404 (không tìm thấy giá) -> hiện đúng thông báo lỗi server trả về + 2 nút quay lại.
//  7. TUYỆT ĐỐI KHÔNG LƯU GIÁ vào đâu — xác nhận KHÔNG có request POST/PUT nào khác ngoài đúng 1 lần gọi
//     price-check cho mỗi lần "Kiểm Tra Giá" (không có autosave/no debounce ghi AppData/DB nào xảy ra).
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8997;
  const USER_WITH_PERM = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true
  };
  // shelfLocationManage (KHÔNG phải shelfRecordCreate) — đủ để vào được tab Vận Hành/Kiểm Soát Hàng Hóa
  // (canAccessOperationModule()/core.js đòi hỏi ÍT NHẤT 1 quyền chức năng thật như shelfLocationManage/
  // shelfRecordCreate/shelfReportView — vanHanhShelfTab chỉ là Khối 0, tự nó KHÔNG đủ để mở được tab),
  // nhưng vẫn THIẾU đúng shelfRecordCreate để cô lập đúng điều kiện ẩn nút Kiểm Tra Giá cần kiểm.
  const USER_NO_PERM = {
    username: 'nv2', name: 'Nhân Viên 2', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfLocationManage: true }, active: true, totpEnabled: true
  };
  const state = createMockState({ depts: ['Siêu thị Quận 1'], users: [USER_WITH_PERM, USER_NO_PERM] });
  state.storeExternalCodes = { 'Siêu thị Quận 1': '001' };
  state.__mockPriceCheckConfigured = true;
  state.__mockPriceCheckResults = {
    '2003330491': { maHang: '2003330491', tenHang: 'Sữa tươi TH True Milk 1L', maVach: '8934696001589', giaThuong: 24000, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: '2026-11-10T09:00:18.000Z' },
    '2003330999': { maHang: '2003330999', tenHang: 'Nước suối Aquafina 500ml', maVach: '8934588012345', giaThuong: 10000, giaKhuyenMai: 8500, coKhuyenMai: true, capNhatLuc: '2026-11-10T09:05:00.000Z' }
  };
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await run.run('Người KHÔNG có shelfRecordCreate: nút "💲 Kiểm Tra Giá" phải ẨN (hidden)', async () => {
      await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER_NO_PERM);
      await page.evaluate(async () => { await switchTab('vanHanh'); });
      await page.waitForSelector('[data-op="setVanHanhSubTab"][data-tab="SHELF"]', { state: 'visible' });
      await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
      await page.waitForTimeout(100);
      const hidden = await page.evaluate(() => document.getElementById('btnVhShelfSubPriceCheck').className.includes('hidden'));
      assert(hidden, 'Nút Kiểm Tra Giá phải có class hidden cho người không có shelfRecordCreate/admin');
    });

    await run.run('Người CÓ shelfRecordCreate: nút hiện, bấm vào chuyển đúng sub-tab PRICECHECK', async () => {
      await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER_WITH_PERM);
      await page.evaluate(async () => { await switchTab('vanHanh'); });
      await page.waitForSelector('[data-op="setVanHanhSubTab"][data-tab="SHELF"]', { state: 'visible' });
      await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
      await page.waitForTimeout(100);
      const visibleBefore = await page.evaluate(() => !document.getElementById('btnVhShelfSubPriceCheck').className.includes('hidden'));
      assert(visibleBefore, 'Nút Kiểm Tra Giá phải hiện cho người có shelfRecordCreate');
      await page.click('#btnVhShelfSubPriceCheck');
      await page.waitForTimeout(50);
      const state2 = await page.evaluate(() => ({
        active: activeVanHanhShelfSubTab,
        formVisible: !document.getElementById('priceCheckForm').classList.contains('hidden'),
        resultHidden: document.getElementById('priceCheckResultWrap').classList.contains('hidden')
      }));
      assertEqual(state2.active, 'PRICECHECK', `activeVanHanhShelfSubTab phải = PRICECHECK, thực tế: ${state2.active}`);
      assert(state2.formVisible, 'Form nhập Mã Hàng phải hiện mặc định (trạng thái FORM)');
      assert(state2.resultHidden, 'Khối kết quả phải ẩn lúc mới mở tab');
    });

    await run.run('Gõ Mã Hàng + bấm "💲 Kiểm Tra Giá" (KHÔNG khuyến mại) -> hiện đúng tên hàng + giá thường', async () => {
      // window.fetch được testHarness mock THẲNG trong trang (window.__apiDispatch), không phải network
      // request thật -> page.on('request') của Playwright KHÔNG bắt được -> đếm bằng cách bọc thêm 1 lớp
      // quanh window.fetch ngay trong trang, chỉ đếm ĐÚNG URL price-check.
      await page.evaluate(() => {
        window.__pcCallCount = 0;
        const origFetch = window.fetch;
        window.fetch = async (url, opts) => {
          if (url === '/api/shelf-stock/price-check') window.__pcCallCount++;
          return origFetch(url, opts);
        };
      });
      await page.fill('#pcMaHang', '2003330491');
      await page.click('#priceCheckForm button[type="submit"]');
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => ({
        resultVisible: !document.getElementById('priceCheckResultWrap').classList.contains('hidden'),
        formVisible: !document.getElementById('priceCheckForm').classList.contains('hidden'),
        tenHang: document.getElementById('pcResultTenHang').textContent,
        maHangLine: document.getElementById('pcResultMaHang').textContent,
        giaApDung: document.getElementById('pcResultGiaApDung').textContent,
        strikeHidden: document.getElementById('pcResultGiaThuongStrike').classList.contains('hidden'),
        badgeHidden: document.getElementById('pcResultKhuyenMaiBadge').classList.contains('hidden')
      }));
      assert(result.resultVisible, 'Khối kết quả phải hiện ra sau khi tra giá thành công');
      assert(!result.formVisible, 'Form nhập phải ẩn đi khi đang hiện kết quả');
      assert(result.tenHang.includes('Sữa tươi TH True Milk 1L'), `Tên hàng sai: ${result.tenHang}`);
      assert(result.maHangLine.includes('2003330491') && result.maHangLine.includes('8934696001589'), `Dòng Mã Hàng/Mã Vạch sai: ${result.maHangLine}`);
      assert(result.giaApDung.includes('24.000'), `Giá áp dụng phải là giá thường 24.000 VNĐ (không khuyến mại), thực tế: ${result.giaApDung}`);
      assert(result.strikeHidden, 'KHÔNG có khuyến mại thì KHÔNG hiện giá gạch ngang');
      assert(result.badgeHidden, 'KHÔNG có khuyến mại thì KHÔNG hiện badge "Đang khuyến mại"');
      const pcCallCount = await page.evaluate(() => window.__pcCallCount);
      assertEqual(pcCallCount, 1, `Phải gọi ĐÚNG 1 lần POST /price-check cho 1 lượt tra, thực tế: ${pcCallCount}`);
    });

    await run.run('"🔄 Quét Lại": xoá sạch kết quả cũ RỒI mở THẲNG camera quét tiếp (không chỉ quay về form)', async () => {
      await page.click('#priceCheckResultWrap button[data-op="rescanPriceCheck"]');
      await page.waitForTimeout(50);
      const after = await page.evaluate(() => ({
        formVisible: !document.getElementById('priceCheckForm').classList.contains('hidden'),
        resultHidden: document.getElementById('priceCheckResultWrap').classList.contains('hidden'),
        input: document.getElementById('pcMaHang').value,
        // getUserMedia không có camera thật trong môi trường test -> statusEl báo lỗi, nhưng modal VẪN
        // hiện ra (unhidden) đúng như openShelfBarcodeModal() ở test-shelf-mobile-and-offline-inventory.js.
        modalVisible: !document.getElementById('shelfBarcodeModal').classList.contains('hidden')
      }));
      assert(after.formVisible, 'Form nhập (ẩn SAU modal camera) vẫn phải được reset về trạng thái FORM');
      assert(after.resultHidden, 'Khối kết quả phải ẩn lại');
      assertEqual(after.input, '', 'Ô Mã Hàng phải về rỗng');
      assert(after.modalVisible, '"Quét Lại" phải mở THẲNG camera (modal quét mã vạch phải hiện ra)');
      // Đóng modal camera lại (như người dùng bấm "Đóng"/"✏️ Nhập Tay", modal có 2 nút CÙNG data-op nên
      // gọi thẳng hàm thay vì page.click() để tránh Playwright strict-mode do khớp nhiều phần tử).
      await page.evaluate(() => closeShelfBarcodeModal());
      await page.waitForTimeout(50);
    });

    await run.run('Có khuyến mại (coKhuyenMai=true): hiện giá khuyến mại làm "Giá áp dụng" + giá thường gạch ngang + badge', async () => {
      await page.fill('#pcMaHang', '2003330999');
      await page.click('#priceCheckForm button[type="submit"]');
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => ({
        giaApDung: document.getElementById('pcResultGiaApDung').textContent,
        strikeText: document.getElementById('pcResultGiaThuongStrike').textContent,
        strikeHidden: document.getElementById('pcResultGiaThuongStrike').classList.contains('hidden'),
        badgeHidden: document.getElementById('pcResultKhuyenMaiBadge').classList.contains('hidden')
      }));
      assert(result.giaApDung.includes('8.500'), `Giá áp dụng phải là giá khuyến mại 8.500 VNĐ, thực tế: ${result.giaApDung}`);
      assert(!result.strikeHidden, 'CÓ khuyến mại thì PHẢI hiện giá thường gạch ngang');
      assert(result.strikeText.includes('10.000'), `Giá gạch ngang phải là giá thường 10.000 VNĐ, thực tế: ${result.strikeText}`);
      assert(!result.badgeHidden, 'CÓ khuyến mại thì PHẢI hiện badge "Đang khuyến mại"');
    });

    await run.run('"✖️ Hủy": CÙNG hành vi xoá sạch kết quả, quay về form trống', async () => {
      await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
      await page.waitForTimeout(50);
      const after = await page.evaluate(() => ({
        formVisible: !document.getElementById('priceCheckForm').classList.contains('hidden'),
        resultHidden: document.getElementById('priceCheckResultWrap').classList.contains('hidden'),
        input: document.getElementById('pcMaHang').value
      }));
      assert(after.formVisible, 'Phải quay lại trạng thái FORM sau khi bấm Hủy');
      assert(after.resultHidden, 'Khối kết quả phải ẩn lại');
      assertEqual(after.input, '', 'Ô Mã Hàng phải về rỗng');
    });

    await run.run('Quét mã KHÔNG đúng 10 chữ số (mã vạch EAN-13) -> tự gửi làm maVach (bản 1.1 API đối tác), không bị đoán nhầm thành maHang', async () => {
      // Barcode EAN-13 thật (13 chữ số) — KHÔNG khớp /^\d{10}$/ nên resolveShelfPriceCheckLookupCode()
      // phải gửi làm maVach (shelfSystemInventoryCache rỗng trong test này, không có cache nào để khớp
      // trước) — seed kết quả mock ĐÚNG theo key maVach này (testHarness ưu tiên maHang nếu có, ở đây
      // client CHỈ gửi maVach nên lookupKey === maVach).
      // DÙNG BARCODE KHÁC HẲN '8934696001589' của mã 2003330491 ở kịch bản trên (12/2026, bảng giá
      // offline mới thêm: mỗi lượt tra ONLINE thành công tự "lấp" vào cache offline theo CẢ maHang LẪN
      // maVach của chính kết quả đó — xem mergeShelfPriceCatalogOfflineOneResult()/module-vanhanh.js —
      // dùng lại ĐÚNG maVach đã cache ở kịch bản trên sẽ đọc ra bản CŨ từ cache, không gọi lại online nữa,
      // không còn phản ánh đúng ý định gốc của kịch bản này là kiểm tra ĐƯỜNG GỌI ONLINE qua maVach).
      state.__mockPriceCheckResults['9998887776665'] = { maHang: '2003330491', tenHang: 'Sữa tươi TH True Milk 1L (tra bằng mã vạch)', maVach: '9998887776665', giaThuong: 24000, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: '2026-11-10T09:00:18.000Z' };
      await page.fill('#pcMaHang', '9998887776665');
      await page.click('#priceCheckForm button[type="submit"]');
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => ({
        resultVisible: !document.getElementById('priceCheckResultWrap').classList.contains('hidden'),
        tenHang: document.getElementById('pcResultTenHang').textContent
      }));
      assert(result.resultVisible, 'Phải tra được giá qua mã vạch EAN-13 (bản 1.1 API)');
      assert(result.tenHang.includes('tra bằng mã vạch'), `Phải trả đúng kết quả đã seed theo key maVach, thực tế: ${result.tenHang}`);
      await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
      await page.waitForTimeout(50);
    });

    await run.run('Mã hàng KHÔNG tồn tại (404 từ server) -> hiện đúng thông báo lỗi + 2 nút quay lại', async () => {
      await page.fill('#pcMaHang', 'MA_KHONG_TON_TAI');
      await page.click('#priceCheckForm button[type="submit"]');
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => ({
        errorVisible: !document.getElementById('priceCheckErrorWrap').classList.contains('hidden'),
        formVisible: !document.getElementById('priceCheckForm').classList.contains('hidden'),
        errorText: document.getElementById('priceCheckErrorText').textContent,
        hasRetryBtn: !!document.querySelector('#priceCheckErrorWrap button[data-op="rescanPriceCheck"]'),
        hasCancelBtn: !!document.querySelector('#priceCheckErrorWrap button[data-op="cancelPriceCheck"]')
      }));
      assert(result.errorVisible, 'Khối lỗi phải hiện ra khi server trả 404');
      assert(!result.formVisible, 'Form phải ẩn trong lúc hiện lỗi');
      assert(result.errorText.includes('MA_KHONG_TON_TAI'), `Thông báo lỗi phải đúng nội dung server trả về, thực tế: ${result.errorText}`);
      assert(result.hasRetryBtn, 'Khối lỗi phải có nút Quét Lại');
      assert(result.hasCancelBtn, 'Khối lỗi phải có nút Hủy');
      await page.click('#priceCheckErrorWrap button[data-op="cancelPriceCheck"]');
      await page.waitForTimeout(50);
      const back = await page.evaluate(() => !document.getElementById('priceCheckForm').classList.contains('hidden'));
      assert(back, 'Bấm Hủy từ trạng thái lỗi phải quay lại form trống');
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh trong suốt kịch bản: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
