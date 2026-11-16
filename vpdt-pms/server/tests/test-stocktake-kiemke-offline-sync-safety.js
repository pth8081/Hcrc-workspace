// tests/test-stocktake-kiemke-offline-sync-safety.js — Chống TRÙNG dữ liệu khi đồng bộ offline/mạng
// CHẬP CHỜN cho Kiểm Kê (12/2026, theo yêu cầu người dùng: "khi mà offline xong online đồng bộ, bạn phải
// kiểm tra kỹ dữ liệu làm sao để cho nó không bị đồng bộ theo kiểu duplicate"; "mạng chập chờn... vẫn kiểm
// kê xong đi ra chỗ nào có thì nó đồng bộ lên"; "có một nút bật online/offline thủ công").
//
// Kịch bản KHÓ NHẤT (và THẬT NHẤT) gây trùng: server ĐÃ nhận + cộng dồn xong 1 lượt quét, nhưng PHẢN HỒI
// bị rớt giữa chừng (sóng yếu đúng lúc đó) — client tưởng gửi thất bại, giữ lại trong hàng đợi để gửi lại,
// lần gửi lại thành công lần 2 sẽ cộng dồn THÊM 1 lần nữa nếu không có idempotency key. Test A mô phỏng
// ĐÚNG race này bằng cách cho request THẬT đi tới server (áp dụng xong) rồi mới giả lập client nhận lỗi
// mạng — không phải giả định lý thuyết suông.
// Chạy: node tests/test-stocktake-kiemke-offline-sync-safety.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8992;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1,
    perms: { kiemKeGomMaDo: true, kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true }, active: true, totpEnabled: true
  };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [USER],
    kiemKeShelfLocations: [SHELF_A1],
    stocktakeSessions: [THONG_KE_SESSION],
    stocktakeUserAccess: [{ id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canGomMa: true, canKiemDem: true, canKiemSoat: true }],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [{ maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 }];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Mock chưa hỗ trợ route: POST /api/data/users')) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  // Request THẬT vẫn đi tới server (áp dụng xong, state thay đổi thật) nhưng client nhận TypeError như mất
  // phản hồi — mô phỏng ĐÚNG race "server xử lý xong nhưng response rớt giữa chừng".
  const simulateLostResponseOnce = () => page.evaluate(() => {
    window.__origFetch = window.fetch;
    window.fetch = async (...args) => {
      await window.__origFetch(...args);
      window.fetch = window.__origFetch; // chỉ giả lập đúng 1 lần gọi kế tiếp
      throw new TypeError('Failed to fetch');
    };
  });
  const goOffline = () => page.evaluate(() => { window.__origFetch = window.fetch; window.fetch = () => { throw new TypeError('Failed to fetch'); }; });
  const goOnline = () => page.evaluate(() => { if (window.__origFetch) { window.fetch = window.__origFetch; delete window.__origFetch; } });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(200);
    await page.selectOption('#kkKiemDemShelfSelect', '10');
    await page.waitForTimeout(200);

    // ===== A) Lượt quét ĐẦU TIÊN mất phản hồi NGAY LÚC GỬI TRỰC TUYẾN (chưa từng vào hàng đợi) =====
    await simulateLostResponseOnce();
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(200);
    await run.run('A1) Lượt quét đầu mất phản hồi (server ĐÃ cộng dồn xong) -> vẫn vào hàng đợi để thử lại (client không biết đã thành công)', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 1, 'Phải có 1 lượt trong hàng đợi (client tưởng thất bại)');
      const serverQty = await page.evaluate(() => fetch(`/api/stocktake/counts?sessionId=9002&shelfLocationId=10`).then(r => r.json()).then(b => (b.items.find(c => c.maHang === 'SP001') || {}).slKiemDem || 0));
      assertEqual(serverQty, 1, 'Server THỰC TẾ đã cộng dồn thành công = 1 (dù client tưởng thất bại)');
    });

    await page.evaluate(() => trySyncPendingKkScans());
    await page.waitForTimeout(300);
    await run.run('A2) Gửi lại (đồng bộ ngược) ĐÚNG lượt quét đã thành công đó -> idempotency key chặn cộng dồn lần 2, SL VẪN = 1 (không phải 2)', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 0, 'Hàng đợi phải rỗng sau khi "đồng bộ lại" (server nhận diện đã áp dụng, trả về thành công)');
      const serverQty = await page.evaluate(() => fetch(`/api/stocktake/counts?sessionId=9002&shelfLocationId=10`).then(r => r.json()).then(b => (b.items.find(c => c.maHang === 'SP001') || {}).slKiemDem || 0));
      assertEqual(serverQty, 1, 'SL PHẢI VẪN LÀ 1 — nếu là 2 nghĩa là bị cộng dồn trùng (lỗi nghiêm trọng)');
    });

    // ===== B) Mạng CHẬP CHỜN nhiều lần liên tiếp khi KHÔNG chuyển tab nào (đúng kịch bản người dùng nêu:
    //          đứng ở vị trí sóng yếu, quét xong, đi ra chỗ có sóng, vẫn đứng nguyên màn Kiểm Đếm) =====
    await goOffline();
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]'); // lượt 2 (offline hẳn)
    await page.waitForTimeout(150);
    await goOnline();
    // Mô phỏng ĐÚNG "có sóng lại rồi lại mất ngay" — KHÔNG chuyển tab, KHÔNG có sự kiện 'online' nào bắn ra
    // (test gọi trực tiếp hàm mà heartbeat 20s sẽ tự gọi, để không phải CHỜ THẬT 20 giây trong bộ test).
    await simulateLostResponseOnce(); // lượt đồng bộ của mục B lại mất phản hồi 1 lần nữa
    await page.evaluate(() => trySyncPendingKkScans());
    await page.waitForTimeout(250);
    await run.run('B1) Chập chờn: đồng bộ lần 1 (có sóng) lại mất phản hồi NGAY TRONG LÚC ĐỒNG BỘ -> vẫn giữ đúng 1 lượt chờ, server đã cộng dồn đúng 1 lần', async () => {
      const serverQty = await page.evaluate(() => fetch(`/api/stocktake/counts?sessionId=9002&shelfLocationId=10`).then(r => r.json()).then(b => (b.items.find(c => c.maHang === 'SP001') || {}).slKiemDem || 0));
      assertEqual(serverQty, 2, 'SL phải = 2 (1 từ mục A + 1 từ lượt offline mục B vừa đồng bộ xong), CHƯA bị trùng dù vừa mất phản hồi giữa chừng');
    });
    await page.evaluate(() => trySyncPendingKkScans()); // giả lập nhịp heartbeat 20s tiếp theo tự thử lại
    await page.waitForTimeout(250);
    await run.run('B2) Nhịp tự thử lại tiếp theo (giả lập heartbeat, KHÔNG cần chuyển tab) -> hàng đợi trống hẳn, SL vẫn đúng = 2, không nhân đôi', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 0, 'Hàng đợi phải trống sau khi heartbeat tự thử lại thành công');
      const serverQty = await page.evaluate(() => fetch(`/api/stocktake/counts?sessionId=9002&shelfLocationId=10`).then(r => r.json()).then(b => (b.items.find(c => c.maHang === 'SP001') || {}).slKiemDem || 0));
      assertEqual(serverQty, 2, 'SL PHẢI VẪN LÀ 2 — không được tăng lên 3 (sẽ là trùng)');
    });

    // ===== C) Công tắc "Offline Thủ Công" — bật thì KHÔNG được gọi mạng dù mạng vẫn tốt =====
    let liveFetchCalledWhileManualOffline = false;
    await page.exposeFunction('__markLiveFetchCalled', () => { liveFetchCalledWhileManualOffline = true; });
    await page.evaluate(() => {
      window.__origFetch2 = window.fetch;
      window.fetch = (...args) => {
        if (String(args[0] || '').includes('/counts/scan')) window.__markLiveFetchCalled();
        return window.__origFetch2(...args);
      };
    });
    await page.click('[data-op="toggleKkManualOfflineMode"]');
    await page.waitForTimeout(100);
    await run.run('C1) Bật "Offline Thủ Công" -> hiện banner cảnh báo rõ ràng', async () => {
      const noteHidden = await page.evaluate(() => document.getElementById('kkOfflineModeNote').classList.contains('hidden'));
      assert(!noteHidden, 'Phải hiện banner "ĐANG Ở CHẾ ĐỘ OFFLINE THỦ CÔNG"');
      const btnText = await page.evaluate(() => document.getElementById('btnKkManualOfflineToggle').textContent);
      assert(btnText.includes('Tắt Offline'), `Nút phải đổi thành "Tắt Offline...", thực tế: ${btnText}`);
    });

    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(200);
    await run.run('C2) Quét khi đang bật Offline Thủ Công (mạng THẬT vẫn tốt) -> KHÔNG gọi API trực tuyến, vào thẳng hàng đợi', async () => {
      assert(!liveFetchCalledWhileManualOffline, 'KHÔNG được gọi /counts/scan trực tuyến khi đang bật Offline Thủ Công');
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 1, 'Phải có 1 lượt trong hàng đợi do Offline Thủ Công');
      const countEl = await page.evaluate(() => document.getElementById('kkPendingSyncCount').textContent);
      assert(/1 lượt/.test(countEl), `Phải hiện đúng số lượt đang chờ, thực tế: ${countEl}`);
    });

    await page.evaluate(() => { window.fetch = window.__origFetch2; delete window.__origFetch2; });
    await page.click('[data-op="toggleKkManualOfflineMode"]');
    await page.waitForTimeout(300);
    await run.run('C3) Tắt "Offline Thủ Công" -> tự động đồng bộ ngay hàng đợi vừa tích luỹ, SL cuối đúng = 3 (không trùng)', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingScans.length);
      assertEqual(pendingLen, 0, 'Hàng đợi phải tự trống ngay khi tắt công tắc');
      const serverQty = await page.evaluate(() => fetch(`/api/stocktake/counts?sessionId=9002&shelfLocationId=10`).then(r => r.json()).then(b => (b.items.find(c => c.maHang === 'SP001') || {}).slKiemDem || 0));
      assertEqual(serverQty, 3, 'SL phải = 3 (2 trước đó + 1 lượt Offline Thủ Công), không nhân đôi/mất mát');
    });

    // ===== D) Gỡ Xác Nhận bị mất phản hồi (đã xoá xong ở server) -> KHÔNG được báo "bị từ chối" =====
    await page.evaluate(() => switchTab('kiemKe'));
    await page.click('#btnKkSubConfirm');
    await page.waitForTimeout(250);
    await page.click('[data-op="confirmKkShelf"][data-arg0="10"]');
    await page.waitForTimeout(200);
    const confirmedId = await page.evaluate(() => kkConfirmConfirmations.find(c => c.shelfLocationId === 10)?.id);
    assert(confirmedId, 'Chuẩn bị: phải xác nhận A1 thành công trước để có id thật cho bước Gỡ Xác Nhận');
    await page.evaluate((id) => {
      window.__origFetch = window.fetch;
      window.fetch = async (...args) => {
        const url = String(args[0] || '');
        if (url.includes(`/shelf-confirmations/${id}`)) {
          await window.__origFetch(...args); // DELETE thật đi tới server, xoá thành công
          window.fetch = window.__origFetch;
          throw new TypeError('Failed to fetch'); // nhưng client nhận như mất phản hồi
        }
        return window.__origFetch(...args);
      };
    }, confirmedId);
    await page.evaluate((id) => unconfirmKkShelf(id), confirmedId);
    await page.waitForTimeout(200);
    await run.run('D1) Gỡ Xác Nhận mất phản hồi (server ĐÃ xoá xong) -> vào hàng đợi để thử lại', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingConfirms.length);
      assertEqual(pendingLen, 1, 'Phải có 1 hành động Gỡ Xác Nhận trong hàng đợi');
    });
    await page.evaluate(() => trySyncPendingKkConfirms());
    await page.waitForTimeout(200);
    await run.run('D2) Thử lại Gỡ Xác Nhận (server trả 404 vì ĐÃ xoá từ lần trước) -> COI LÀ THÀNH CÔNG, không hiện "bị từ chối"', async () => {
      const pendingLen = await page.evaluate(() => kkOfflinePendingConfirms.length);
      assertEqual(pendingLen, 0, 'Hàng đợi phải trống — 404 khi Gỡ Xác Nhận lại nghĩa là ĐÃ đạt trạng thái mong muốn, không phải lỗi');
    });

    await run.run('Không có lỗi JS/console nào phát sinh trong toàn bộ luồng chống trùng thật', async () => {
      assert(jsErrors.length === 0, 'Lỗi JS: ' + jsErrors.join(' | '));
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
