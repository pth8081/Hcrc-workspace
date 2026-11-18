// tests/test-stocktake-kiemke-soft-reminder.js — "Nhắc nhở mềm" khi đổi quầy kệ (12/2026, theo yêu cầu
// người dùng: nếu IT KHÔNG dùng Khóa Quầy Kệ mà vẫn muốn hạn chế làm dở nhiều quầy kệ cùng lúc) — quầy kệ
// ĐANG MỞ đã có số liệu quét thật (qty>0) nhưng CHƯA Xác Nhận, người dùng tự đổi sang quầy kệ KHÁC thì
// hỏi lại 1 lần (confirm()), KHÔNG chặn cứng — huỷ thì giữ nguyên quầy kệ cũ, đồng ý thì cho đổi bình
// thường. Áp dụng CHUNG cho Gom Mã/Kiểm Đếm/Kiểm Soát.
//
// LƯU Ý: testHarness.js stub window.confirm() LUÔN trả `true` ngay (không mở dialog trình duyệt thật) trừ
// khi test tự nạp trước window.__confirmAnswers (hàng đợi câu trả lời giả lập, push(false) = mô phỏng bấm
// "Huỷ" cho lần confirm() kế tiếp) — nội dung câu hỏi đọc lại qua window.__confirms, KHÔNG dùng
// page.on('dialog', ...) (không áp dụng ở đây vì không phải dialog trình duyệt thật).
// Chạy: node tests/test-stocktake-kiemke-soft-reminder.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8990;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', active: true };
  // Nhãn hiển thị trong ô tìm-kiếm-gõ-chọn (sdd*) — ĐÚNG khuôn kkShelfOptionLabel() ở module-vanhanh.js:
  // `${kiemKeLocked ? '🔒 ' : ''}${dept} — ${code} — ${name}`. 2 quầy kệ này không có kiemKeLocked -> không tiền tố.
  const SHELF_A1_LABEL = `${DEPT1} — ${SHELF_A1.code} — ${SHELF_A1.name}`;
  const SHELF_A2_LABEL = `${DEPT1} — ${SHELF_A2.code} — ${SHELF_A2.name}`;
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1,
    perms: { kiemKeKiemDemDo: true }, active: true, totpEnabled: true
  };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [USER],
    kiemKeShelfLocations: [SHELF_A1, SHELF_A2],
    stocktakeSessions: [THONG_KE_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canKiemDem: true },
      { id: 2, username: 'nv1', dept: DEPT1, shelfLocationId: 11, canKiemDem: true }
    ],
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

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(200);

    await run.run('Chưa quét gì ở A1 -> đổi sang A2 KHÔNG hỏi gì (không có việc dở để nhắc)', async () => {
      await page.evaluate(() => { window.__confirms = []; });
      await page.fill('#kkKiemDemShelfInput', SHELF_A1_LABEL);
      await page.waitForTimeout(150);
      await page.fill('#kkKiemDemShelfInput', SHELF_A2_LABEL);
      await page.waitForTimeout(150);
      const confirms = await page.evaluate(() => window.__confirms);
      assertEqual(confirms.length, 0, `Không được hỏi gì khi quầy kệ trước đó chưa có số liệu quét nào, thực tế: ${JSON.stringify(confirms)}`);
      const selected = await page.evaluate(() => kkScanState.KIEMDEM.selectedShelfId);
      assertEqual(selected, 11, 'Phải đổi thành công sang A2');
    });

    await page.fill('#kkKiemDemShelfInput', SHELF_A1_LABEL);
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(200);

    await run.run('Đã quét SP001 ở A1 (chưa Xác Nhận) -> HUỶ hộp thoại khi đổi sang A2 -> GIỮ NGUYÊN A1, không mất dữ liệu', async () => {
      await page.evaluate(() => { window.__confirms = []; window.__confirmAnswers = [false]; }); // mô phỏng bấm "Huỷ"
      await page.fill('#kkKiemDemShelfInput', SHELF_A2_LABEL);
      await page.waitForTimeout(200);
      const confirms = await page.evaluate(() => window.__confirms);
      assertEqual(confirms.length, 1, 'Phải hỏi đúng 1 lần');
      assert(/CHƯA được Xác Nhận/.test(confirms[0]), `Phải hỏi đúng nội dung nhắc Xác Nhận, thực tế: "${confirms[0]}"`);
      const selectValue = await page.evaluate(() => document.getElementById('kkKiemDemShelfInput').value);
      assertEqual(selectValue, SHELF_A1_LABEL, 'Huỷ hộp thoại -> ô nhập phải TRẢ VỀ đúng nhãn A1 (quầy kệ cũ), không nhảy sang A2');
      const selected = await page.evaluate(() => kkScanState.KIEMDEM.selectedShelfId);
      assertEqual(selected, 10, 'State phải vẫn giữ đúng A1 đang thao tác');
      const countText = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(countText.includes('SP001'), 'Dữ liệu đã quét ở A1 phải còn nguyên, không bị xoá/mất khi huỷ hộp thoại');
    });

    await run.run('Đồng ý hộp thoại -> cho đổi sang A2 bình thường', async () => {
      await page.evaluate(() => { window.__confirms = []; }); // mặc định __confirmAnswers rỗng = luôn đồng ý
      await page.fill('#kkKiemDemShelfInput', SHELF_A2_LABEL);
      await page.waitForTimeout(200);
      const confirms = await page.evaluate(() => window.__confirms);
      assertEqual(confirms.length, 1, 'Phải hỏi đúng 1 lần trước khi cho đổi');
      const selected = await page.evaluate(() => kkScanState.KIEMDEM.selectedShelfId);
      assertEqual(selected, 11, 'Đồng ý hộp thoại -> phải đổi thành công sang A2');
    });

    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(200);
    await run.run('Đổi về rỗng (đóng màn quét, không chọn quầy kệ khác) -> KHÔNG hỏi gì dù A2 đang có việc dở', async () => {
      await page.evaluate(() => { window.__confirms = []; });
      await page.fill('#kkKiemDemShelfInput', '');
      await page.waitForTimeout(150);
      const confirms = await page.evaluate(() => window.__confirms);
      assertEqual(confirms.length, 0, 'Bỏ trống lựa chọn (không chuyển sang làm quầy kệ nào khác) thì không cần nhắc');
    });

    await run.run('Không có lỗi JS/console nào phát sinh', async () => {
      assert(jsErrors.length === 0, 'Lỗi JS: ' + jsErrors.join(' | '));
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
