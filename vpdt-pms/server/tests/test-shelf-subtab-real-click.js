// tests/test-shelf-subtab-real-click.js — "📋 Kiểm Soát Hàng Hóa" (Vận Hành), bug thật phản hồi từ
// người dùng đã deploy v28.48 lên server thật, dùng trên điện thoại: bấm sang các sub-tab khác (🗄️ Quầy
// Kệ/⏰ Hạn Sử Dụng/🔔 Ngưỡng Tồn/📊 Đối Chiếu) từ sub-tab "📷 Ghi Nhận" đang mở — KHÔNG chuyển được, màn
// vẫn giữ nguyên nội dung + nút active của "Ghi Nhận".
//
// ROOT CAUSE (xác nhận bằng Playwright bấm THẬT vào nút <button>, không gọi hàm trực tiếp qua
// page.evaluate()): setVanHanhShelfSubTab() CHƯA TỪNG được khai ở registry OP_CLICK_ACTIONS riêng của
// module này (module-vanhanh.js, bindOperationDelegation('vanHanhSection')) — khác 3 anh em cùng khuôn
// data-op="setXxxSubTab" data-tab="..." (setVanHanhSubTab/setOperationStoreSubTab/setOperationOrderSubTab)
// ĐÃ được khai tường minh. Thiếu đăng ký -> rơi vào nhánh fallback cspDispatchOp() CHUNG (core.js), mà
// cspCollectArgs() chỉ đọc data-arg0/data-argN/data-argValue/data-argEl/data-argEvent — KHÔNG đọc
// data-tab -> setVanHanhShelfSubTab() luôn nhận tab=undefined -> logic fallback NỘI BỘ của hàm (chọn lại
// tab đầu tiên còn được phép) luôn trả về 'RECORD' (đứng đầu mảng `tabs`, allowFn luôn true) -> màn luôn
// bật lại "Ghi Nhận" dù bấm nút nào. KHÔNG có lỗi CSP/JS nào bị ném ra (xác nhận qua pageerror/console
// error rỗng lúc tái hiện) — chỉ là thiếu đăng ký, không phải lỗi logic bên trong setVanHanhShelfSubTab()
// hay vi phạm CSP. Fix: thêm 1 dòng
// `setVanHanhShelfSubTab: el => setVanHanhShelfSubTab(el.dataset.tab),` vào OP_CLICK_ACTIONS.
//
// Test ở đây dùng page.click() lên ĐÚNG 5 nút <button id="btnVhShelfSub..."> thật trên DOM (không
// page.evaluate() gọi hàm), bắt console.error/pageerror xuyên suốt, để KHÔNG lặp lại lỗi "test gọi hàm
// trực tiếp nên không bắt được lỗi dispatch" (toàn bộ test-shelf-*.js cũ đều dùng
// page.evaluate(() => setVanHanhShelfSubTab('RECORD')) — không đi qua đúng đường dispatch CSP thật nên
// chưa từng phát hiện được bug này).
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8998;
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true
  };
  const state = createMockState({ depts: ['Siêu thị Quận 1'], users: [USER] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { DB.shelfLocations = []; DB.shelfRecords = []; });
    await page.evaluate(() => ensureShelfOfflineReady());
    await page.evaluate(() => { switchTab('vanHanh'); });
    // Chuyển sang tab "📋 Kiểm Soát Hàng Hóa" CŨNG bằng click thật (setVanHanhSubTab đã được khai ở
    // OP_CLICK_ACTIONS từ trước — xác nhận nhánh này vẫn hoạt động, không phải nạn nhân của cùng lỗi).
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');

    const SUBTABS = [
      { tab: 'LOCATIONS', btn: '#btnVhShelfSubLocations', wrap: 'vanHanhShelfLocationsWrap' },
      { tab: 'EXPIRY', btn: '#btnVhShelfSubExpiry', wrap: 'vanHanhShelfExpiryWrap' },
      { tab: 'THRESHOLD', btn: '#btnVhShelfSubThreshold', wrap: 'vanHanhShelfThresholdWrap' },
      { tab: 'RECON', btn: '#btnVhShelfSubRecon', wrap: 'vanHanhShelfReconWrap' }
    ];

    for (const { tab, btn, wrap } of SUBTABS) {
      await run.run(`Bấm THẬT nút ${btn} (data-tab="${tab}") từ "Ghi Nhận" -> phải chuyển đúng sub-tab (không kẹt lại RECORD)`, async () => {
        // Luôn bắt đầu lại từ RECORD (đúng kịch bản người dùng báo lỗi: đang mở "Ghi Nhận" rồi bấm sang tab khác).
        await page.click('#btnVhShelfSubRecord');
        await page.waitForTimeout(30);
        await page.click(btn);
        await page.waitForTimeout(30);
        const result = await page.evaluate((wrapId) => ({
          active: activeVanHanhShelfSubTab,
          recordHidden: document.getElementById('vanHanhShelfRecordWrap').classList.contains('hidden'),
          targetHidden: document.getElementById(wrapId).classList.contains('hidden')
        }), wrap);
        assertEqual(result.active, tab, `activeVanHanhShelfSubTab phải = ${tab} sau khi bấm nút thật, thực tế: ${result.active} (LỖI ĐÃ VÁ: trước đây luôn kẹt ở RECORD)`);
        assert(result.recordHidden, 'Panel "Ghi Nhận" phải ẩn sau khi chuyển sang tab khác');
        assert(!result.targetHidden, `Panel #${wrap} phải hiện ra`);
      });
    }

    await run.run('Bấm lại #btnVhShelfSubRecord (RECORD) từ 1 sub-tab khác -> vẫn chuyển đúng (không phải case "đứng yên vì đã đúng")', async () => {
      await page.click('#btnVhShelfSubLocations');
      await page.waitForTimeout(30);
      await page.click('#btnVhShelfSubRecord');
      await page.waitForTimeout(30);
      const result = await page.evaluate(() => ({
        active: activeVanHanhShelfSubTab,
        recordHidden: document.getElementById('vanHanhShelfRecordWrap').classList.contains('hidden'),
        locationsHidden: document.getElementById('vanHanhShelfLocationsWrap').classList.contains('hidden')
      }));
      assertEqual(result.active, 'RECORD', `activeVanHanhShelfSubTab phải = RECORD, thực tế: ${result.active}`);
      assert(!result.recordHidden, 'Panel "Ghi Nhận" phải hiện lại');
      assert(result.locationsHidden, 'Panel "Quầy Kệ" phải ẩn lại');
    });

    await run.run('Nút active (class bg-cyan-700) phải theo ĐÚNG sub-tab đang mở, không dính ở "Ghi Nhận"', async () => {
      await page.click('#btnVhShelfSubExpiry');
      await page.waitForTimeout(30);
      const classes = await page.evaluate(() => ({
        record: document.getElementById('btnVhShelfSubRecord').className,
        expiry: document.getElementById('btnVhShelfSubExpiry').className
      }));
      assert(classes.expiry.includes('bg-cyan-700'), `Nút Hạn Sử Dụng phải active (bg-cyan-700), thực tế class: ${classes.expiry}`);
      assert(!classes.record.includes('bg-cyan-700'), `Nút Ghi Nhận KHÔNG được còn active, thực tế class: ${classes.record}`);
    });

    // ===== Nút "↺ Làm Mới" form Ghi Nhận (yêu cầu bổ sung cùng đợt, độc lập với bug kẹt sub-tab) =====
    await run.run('"↺ Làm Mới": xoá trắng mọi field đang nhập dở trong form Ghi Nhận (không đụng danh sách đã lưu)', async () => {
      await page.click('#btnVhShelfSubRecord');
      await page.waitForTimeout(30);
      await page.evaluate(() => {
        // Giả lập người dùng đang nhập dở — kể cả state picker riêng (match note) không nằm trong form.reset().
        document.getElementById('srShelfLocationInput').value = 'A1 — Quầy A1';
        document.getElementById('srShelfLocationId').value = '1';
        document.getElementById('srSku').value = '8938501234567';
        document.getElementById('srMaHang').value = '2003330491';
        document.getElementById('srProductName').value = 'Coca-Cola lon 330ml';
        document.getElementById('srQuantity').value = '24';
        document.getElementById('srExpiryDate').value = '2027-03-12';
        document.getElementById('srNote').value = 'Ghi chú test';
        setShelfMaHangMatchNote('✅ Đã khớp tồn kho hệ thống: Coca-Cola lon 330ml', true);
        // page.on('dialog') chưa cần tới nếu form coi là "sạch" — nhưng ở đây form ĐANG dirty nên confirm() thật
        // sẽ bị gọi, phải tự accept qua page.on('dialog') đăng ký bên dưới trước khi click.
      });
      page.once('dialog', (dialog) => dialog.accept());
      await page.click('#srForm button[data-op="confirmAndResetForm"]');
      await page.waitForTimeout(30);
      const after = await page.evaluate(() => ({
        shelfLocationInput: document.getElementById('srShelfLocationInput').value,
        shelfLocationId: document.getElementById('srShelfLocationId').value,
        sku: document.getElementById('srSku').value,
        maHang: document.getElementById('srMaHang').value,
        productName: document.getElementById('srProductName').value,
        quantity: document.getElementById('srQuantity').value,
        expiryDate: document.getElementById('srExpiryDate').value,
        note: document.getElementById('srNote').value,
        matchNote: document.getElementById('srMaHangMatchNote').textContent
      }));
      assertEqual(after.shelfLocationInput, '', 'Ô Quầy Kệ phải về rỗng');
      assertEqual(after.shelfLocationId, '', 'Hidden srShelfLocationId phải về rỗng');
      assertEqual(after.sku, '', 'Ô Mã Vạch phải về rỗng');
      assertEqual(after.maHang, '', 'Ô Mã Hàng (nội bộ) phải về rỗng');
      assertEqual(after.productName, '', 'Ô Tên Sản Phẩm phải về rỗng');
      assertEqual(after.quantity, '', 'Ô Số Lượng phải về rỗng');
      assertEqual(after.expiryDate, '', 'Ô Hạn Sử Dụng phải về rỗng');
      assertEqual(after.note, '', 'Ô Ghi Chú phải về rỗng');
      assertEqual(after.matchNote, '', 'Ghi chú khớp picker (srMaHangMatchNote) phải xoá sạch, không chỉ ẩn giá trị input — LỖI DỄ GẶP: state picker nằm ngoài <form>.reset()');
    });

    await run.run('"↺ Làm Mới": form đang trống (chưa gõ gì) -> KHÔNG hỏi xác nhận (confirm())', async () => {
      await page.click('#btnVhShelfSubRecord');
      await page.waitForTimeout(30);
      // form.reset() ở test trước đã đưa form về trống — không set lại gì, bấm Làm Mới ngay.
      let dialogShown = false;
      const onDialog = (dialog) => { dialogShown = true; dialog.accept(); };
      page.on('dialog', onDialog);
      await page.click('#srForm button[data-op="confirmAndResetForm"]');
      await page.waitForTimeout(30);
      page.off('dialog', onDialog);
      assert(!dialogShown, 'Form đang trống thì KHÔNG được hỏi xác nhận trước khi Làm Mới');
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh trong suốt kịch bản bấm thật: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
