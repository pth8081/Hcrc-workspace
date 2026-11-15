// tests/test-stocktake-kiemke-offline.js — Online/Offline cho Kiểm Kê (12/2026, theo yêu cầu người dùng
// — xem docs/kiem-ke-kiem-soat-offline.md): "tôi gom mã mất mạng cũng vẫn có thể thực hiện được, tôi kiểm
// đếm mất mạng vẫn có thể thực hiện được... đồng bộ cả phần tồn kho lẫn phần quầy kệ để tôi có thể chọn
// quầy kệ được, kể cả phần xác nhận... nếu mà offline thì những cái mà khóa quầy kệ thì nó phải vô hiệu
// [KHÔNG — xem phân tích trong tài liệu] để người dùng có thể chọn được quầy kệ để kiểm kê tiếp".
//
// Playwright THẬT (click/fill/selectOption thật) — giả lập mất mạng bằng cách thay window.fetch tạm thời
// để throw TypeError('Failed to fetch') (CÙNG khuôn đã dùng ở test-shelf-mobile-and-offline-inventory.js),
// KHÔNG mock DOM tay.
// Chạy: node tests/test-stocktake-kiemke-offline.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8994;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', active: true, kiemKeLocked: true, kiemKeLockedBy: 'itA', kiemKeLockedByName: 'IT Quản Trị' };
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1,
    perms: { kiemKeGomMaDo: true, kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true }, active: true, totpEnabled: true
  };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [USER],
    shelfLocations: [SHELF_A1, SHELF_A2],
    stocktakeSessions: [THONG_KE_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canGomMa: true, canKiemDem: true, canKiemSoat: true },
      { id: 2, username: 'nv1', dept: DEPT1, shelfLocationId: 11, canGomMa: true, canKiemDem: true, canKiemSoat: true }
    ],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Mock chưa hỗ trợ route: POST /api/data/users')) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const goOffline = () => page.evaluate(() => { window.__origFetch = window.fetch; window.fetch = () => { throw new TypeError('Failed to fetch'); }; });
  const goOnline = () => page.evaluate(() => { if (window.__origFetch) { window.fetch = window.__origFetch; delete window.__origFetch; } });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(250); // để prefetchKkSessionInfoForShelves() chạy ngầm xong cho CẢ A1 và A2

    await run.run('Online: Tab 3 Kiểm Đếm tải đúng A1 (mở) + A2 (đã khoá, hiện 🔒) từ server', async () => {
      const options = await page.evaluate(() => Array.from(document.getElementById('kkKiemDemShelfSelect').options).map(o => o.textContent));
      assert(options.some(o => o.includes('A1') && !o.includes('🔒')), `A1 phải hiện KHÔNG có 🔒, thực tế: ${options.join(' | ')}`);
      assert(options.some(o => o.includes('🔒') && o.includes('A2')), `A2 phải hiện CÓ 🔒, thực tế: ${options.join(' | ')}`);
    });

    await page.selectOption('#kkKiemDemShelfSelect', '10');
    await page.waitForTimeout(200);
    await run.run('Online: chọn A1 -> hiện ô quét + ĐÃ cache session info cho offline sau này', async () => {
      const hidden = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      assert(!hidden, 'Ô quét phải MỞ khi chọn A1 (có kỳ, không khoá)');
      const cached = await page.evaluate(() => typeof getKkSessionInfoOffline === 'function' && !!getKkSessionInfoOffline('KIEM_DEM', 10));
      assert(cached, 'Phải đã cache session info cho A1 (qua onKkScanShelfChanged() lúc còn mạng)');
    });

    // ===== MẤT MẠNG =====
    await goOffline();
    await page.evaluate(() => switchTab('kiemKe'));
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(200);

    await run.run('Offline: vào lại Tab 3 -> danh sách quầy kệ vẫn hiện đủ (từ cache) + báo rõ "Ngoại tuyến"', async () => {
      const options = await page.evaluate(() => Array.from(document.getElementById('kkKiemDemShelfSelect').options).map(o => o.textContent));
      assert(options.some(o => o.includes('A1')) && options.some(o => o.includes('A2')), `Phải còn đủ A1+A2 từ cache, thực tế: ${options.join(' | ')}`);
      const noteHidden = await page.evaluate(() => document.getElementById('kkKiemDemOfflineNote').classList.contains('hidden'));
      assert(!noteHidden, 'Phải hiện ghi chú "Ngoại tuyến" khi tải danh sách quầy kệ thất bại vì mất mạng');
    });

    await page.selectOption('#kkKiemDemShelfSelect', '10');
    await page.waitForTimeout(200);
    await run.run('Offline: chọn A1 (đã cache session info) -> vẫn mở được ô quét bình thường', async () => {
      const hidden = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      assert(!hidden, 'Ô quét phải MỞ offline nếu đã có cache session info hợp lệ cho đúng quầy kệ này');
    });

    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(200);
    await run.run('Offline: quét mã SP001 -> ghi vào hàng đợi kkPendingScans + hiện NGAY trong danh sách với badge ⏳', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 1, 'Phải có đúng 1 lượt quét trong hàng đợi offline');
      const listText = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(listText.includes('SP001') && listText.includes('⏳'), `Danh sách phải hiện SP001 kèm badge ⏳ chưa đồng bộ, thực tế: ${listText}`);
    });

    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(200);
    await run.run('Offline: quét TRÙNG mã lần 2 -> cộng dồn SL=2 ngay tại chỗ (optimistic), vẫn đúng 1 dòng trong hàng đợi lịch sử 2 lượt', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 2, 'Phải có 2 lượt quét riêng biệt trong hàng đợi (mỗi lượt 1 bản ghi, giống server sẽ cộng dồn khi đồng bộ)');
      const qty = await page.evaluate(() => {
        const row = kkScanState.KIEMDEM.counts.find(c => c.maHang === 'SP001');
        return row ? row.slKiemDem : null;
      });
      assertEqual(qty, 2, 'SL hiện tại (optimistic) phải là 2 sau 2 lượt quét offline cùng mã');
    });

    // Quầy kệ A2 (đã khoá TỪ TRƯỚC khi cache, nên cache session info/shelf list đã biết điều này).
    await page.selectOption('#kkKiemDemShelfSelect', '11');
    await page.waitForTimeout(200);
    await run.run('Offline: chọn A2 (đã khoá TỪ TRƯỚC lúc còn mạng) -> VẪN bị chặn đúng bằng dữ liệu cache (không lách khoá được bằng cách tắt mạng)', async () => {
      const hidden = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      assert(hidden, 'Ô quét PHẢI đóng — quầy kệ A2 đã bị khoá, cache phải phản ánh đúng kể cả khi offline');
      const info = await page.evaluate(() => document.getElementById('kkKiemDemSessionInfo').textContent);
      assert(/KHOÁ/.test(info), `Phải báo rõ lý do KHOÁ, thực tế: ${info}`);
    });

    // ===== CÓ MẠNG LẠI =====
    await page.selectOption('#kkKiemDemShelfSelect', '10');
    await page.waitForTimeout(150);
    await goOnline();
    await page.evaluate(() => trySyncPendingKkScans());
    await page.waitForTimeout(400);
    await run.run('Có mạng lại: hàng đợi tự đồng bộ hết, danh sách tải lại THẬT từ server với SL cộng dồn đúng = 2', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 0, 'Hàng đợi phải rỗng sau khi đồng bộ thành công');
      const row = await page.evaluate(() => kkScanState.KIEMDEM.counts.find(c => c.maHang === 'SP001'));
      assert(row && !String(row.id).startsWith('offline_'), 'Dòng phải có id THẬT từ server (không còn id tạm offline_...)');
      assertEqual(row.slKiemDem, 2, 'SL thật trên server phải = 2 (2 lượt quét offline x1 đã được server cộng dồn đúng)');
      const listText = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(!listText.includes('⏳'), 'Badge ⏳ phải biến mất sau khi đồng bộ xong');
    });

    // ===== Tab 6 Xác Nhận offline =====
    await page.evaluate(() => switchTab('kiemKe'));
    await page.click('#btnKkSubConfirm');
    await page.waitForTimeout(250);
    await goOffline();
    await page.evaluate(() => confirmKkShelf(10));
    await page.waitForTimeout(200);
    await run.run('Offline: Xác Nhận quầy kệ A1 (Kiểm Đếm) -> ghi vào hàng đợi kkPendingConfirms + hiện badge ⏳', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingConfirms.length);
      assertEqual(pendingLen, 1, 'Phải có đúng 1 hành động Xác Nhận đang chờ đồng bộ');
      const listText = await page.evaluate(() => document.getElementById('kkConfirmShelfListBody').textContent);
      assert(listText.includes('⏳') && listText.includes('CHƯA đồng bộ'), `Phải hiện badge ⏳ CHƯA đồng bộ, thực tế: ${listText}`);
    });

    await page.click('[data-op="cancelKkPendingConfirm"][data-arg0="KIEMDEM"][data-arg1="10"]');
    await page.waitForTimeout(150);
    await run.run('Offline: bấm "Huỷ" trên dòng ⏳ -> xoá khỏi hàng đợi, quay lại nút "Xác Nhận" bình thường', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingConfirms.length);
      assertEqual(pendingLen, 0, 'Hàng đợi Xác Nhận phải rỗng sau khi Huỷ');
      const hasConfirmBtn = await page.evaluate(() => !!document.querySelector('[data-op="confirmKkShelf"][data-arg0="10"]'));
      assert(hasConfirmBtn, 'Phải quay lại đúng nút "Xác Nhận" bình thường cho A1');
    });

    await page.evaluate(() => confirmKkShelf(10));
    await page.waitForTimeout(150);
    await goOnline();
    await page.evaluate(() => trySyncPendingKkConfirms());
    await page.waitForTimeout(300);
    await run.run('Có mạng lại: Xác Nhận A1 đã queue offline tự đồng bộ thành công, hiện ✅ đã xác nhận thật', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingConfirms.length);
      assertEqual(pendingLen, 0, 'Hàng đợi Xác Nhận phải rỗng sau khi đồng bộ');
      const listText = await page.evaluate(() => document.getElementById('kkConfirmShelfListBody').textContent);
      assert(listText.includes('✅') && listText.includes('đã xác nhận bởi'), `Phải hiện ✅ đã xác nhận thật từ server, thực tế: ${listText}`);
    });

    await run.run('Không có lỗi JS/console nào phát sinh trong toàn bộ luồng online/offline thật', async () => {
      assert(jsErrors.length === 0, 'Lỗi JS: ' + jsErrors.join(' | '));
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
