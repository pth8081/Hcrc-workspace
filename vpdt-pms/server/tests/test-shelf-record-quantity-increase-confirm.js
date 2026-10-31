// tests/test-shelf-record-quantity-increase-confirm.js — "📷 Ghi Nhận" (Kiểm Soát Hàng Hóa), cảnh báo
// "SL mới CAO HƠN lần ghi nhận trước của ĐÚNG lô này" (11/2026, theo yêu cầu người dùng): khớp lô (cùng
// Quầy Kệ+Mã Hàng+Hạn Sử Dụng, đang active) mà SL vừa nhập CAO HƠN SL lần trước thường là do GÕ NHẦM giữ
// nguyên Hạn Sử Dụng của lô CŨ trong khi thực ra đang nhập 1 lô MỚI — phải hỏi lại trước khi lưu, không
// lưu âm thầm như SL thấp hơn/bằng (trường hợp thường gặp: bán dần, không cần hỏi gì).
// Test THẬT bằng Playwright: (1) SL tăng + Hủy -> KHÔNG lưu, (2) SL tăng + Xác Nhận -> lưu đúng SL mới,
// (3) SL giảm -> lưu luôn, KHÔNG hiện hỏi gì, (4) SL bằng -> lưu luôn, KHÔNG hiện hỏi gì. Dùng window.confirm
// đã được testHarness.js stub sẵn (mặc định luôn trả true, ghi lại message vào window.__confirms) — chỉ
// cần tạm thay bằng hàm trả false ở đúng bước (1), rồi trả lại stub gốc.
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8983;
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true, email: 'nv1@hcrc.vn'
  };
  const SHELF_LOCATION = { id: 601, code: 'KE-B1', name: 'Kệ B1', category: 'Thực phẩm', dept: 'Siêu thị Quận 1', active: true };
  const state = createMockState({
    depts: ['Siêu thị Quận 1'], users: [USER],
    shelfLocations: [SHELF_LOCATION], shelfRecords: []
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  const getShelfRecords = () => page.evaluate(() => DB.shelfRecords);
  const getConfirms = () => page.evaluate(() => window.__confirms.slice());

  async function fillShelfRecordForm({ maHang, productName, quantity, expiryDate }) {
    await page.fill('#srShelfLocationInput', `${SHELF_LOCATION.code} — ${SHELF_LOCATION.name}`);
    await page.evaluate(() => resolveShelfLocationInput());
    await page.fill('#srMaHang', maHang);
    await page.fill('#srProductName', productName);
    await page.fill('#srQuantity', String(quantity));
    await page.fill('#srExpiryDate', expiryDate || '');
    await page.click('#srForm button[type="submit"]');
    await page.waitForTimeout(80);
  }

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubRecord');
    await page.waitForTimeout(50);

    await run.run('Ghi nhận lần 1 (SKU-INC, SL 5, hạn 2026-12-01) -> tạo lô mới, chưa có gì để so sánh nên KHÔNG hỏi', async () => {
      await fillShelfRecordForm({ maHang: 'SKU-INC', productName: 'Bánh quy A', quantity: 5, expiryDate: '2026-12-01' });
      const records = await getShelfRecords();
      assertEqual(records.length, 1, `phải có đúng 1 bản ghi, thực tế: ${JSON.stringify(records)}`);
      assertEqual(records[0].quantity, 5);
      const confirms = await getConfirms();
      assertEqual(confirms.length, 0, 'lần tạo lô ĐẦU TIÊN (chưa có gì để so sánh) không được hỏi gì');
    });

    await run.run('Scan lại ĐÚNG lô, SL TĂNG (5 -> 8) + bấm HỦY (confirm trả false) -> KHÔNG lưu, SL giữ nguyên 5', async () => {
      await page.evaluate(() => {
        window.__confirms = [];
        window.__origConfirm = window.confirm;
        window.confirm = (msg) => { window.__confirms.push(String(msg)); return false; };
      });
      await fillShelfRecordForm({ maHang: 'SKU-INC', productName: 'Bánh quy A', quantity: 8, expiryDate: '2026-12-01' });
      const confirms = await getConfirms();
      assertEqual(confirms.length, 1, `phải hiện ĐÚNG 1 lần hỏi xác nhận, thực tế: ${JSON.stringify(confirms)}`);
      assert(confirms[0].includes('8') && confirms[0].includes('5'), `nội dung hỏi phải có cả SL mới (8) và SL cũ (5), thực tế: ${confirms[0]}`);
      assert(confirms[0].includes('01/12/2026') || confirms[0].toLowerCase().includes('hạn sử dụng'), `nội dung hỏi phải nêu rõ Hạn Sử Dụng của lô, thực tế: ${confirms[0]}`);
      const records = await getShelfRecords();
      assertEqual(records.length, 1, 'KHÔNG được tạo thêm dòng nào khi bấm Hủy');
      assertEqual(records[0].quantity, 5, 'bấm Hủy thì SL phải GIỮ NGUYÊN 5 (không lưu lên server)');
    });

    await run.run('Scan lại ĐÚNG lô, SL TĂNG (5 -> 8) + bấm XÁC NHẬN (confirm trả true) -> LƯU, SL cập nhật thành 8', async () => {
      await page.evaluate(() => {
        window.confirm = window.__origConfirm;
        window.__confirms = [];
      });
      await fillShelfRecordForm({ maHang: 'SKU-INC', productName: 'Bánh quy A', quantity: 8, expiryDate: '2026-12-01' });
      const confirms = await getConfirms();
      assertEqual(confirms.length, 1, 'phải hiện lại ĐÚNG 1 lần hỏi xác nhận (cùng kịch bản tăng SL)');
      const records = await getShelfRecords();
      assertEqual(records.length, 1, 'vẫn phải CẬP NHẬT dòng cũ (ghi đè), không tạo dòng mới');
      assertEqual(records[0].quantity, 8, 'bấm Xác Nhận thì SL phải cập nhật đúng thành 8');
    });

    await run.run('Scan lại ĐÚNG lô, SL GIẢM (8 -> 3) -> lưu LUÔN, KHÔNG hiện hỏi gì (trường hợp thường gặp: bán dần)', async () => {
      await page.evaluate(() => { window.__confirms = []; });
      await fillShelfRecordForm({ maHang: 'SKU-INC', productName: 'Bánh quy A', quantity: 3, expiryDate: '2026-12-01' });
      const confirms = await getConfirms();
      assertEqual(confirms.length, 0, `SL GIẢM không được hỏi gì, thực tế: ${JSON.stringify(confirms)}`);
      const records = await getShelfRecords();
      assertEqual(records[0].quantity, 3, 'phải lưu đúng SL mới 3');
    });

    await run.run('Scan lại ĐÚNG lô, SL BẰNG (3 -> 3) -> lưu LUÔN, KHÔNG hiện hỏi gì', async () => {
      await page.evaluate(() => { window.__confirms = []; });
      await fillShelfRecordForm({ maHang: 'SKU-INC', productName: 'Bánh quy A', quantity: 3, expiryDate: '2026-12-01' });
      const confirms = await getConfirms();
      assertEqual(confirms.length, 0, `SL BẰNG lần trước không được hỏi gì, thực tế: ${JSON.stringify(confirms)}`);
      const records = await getShelfRecords();
      assertEqual(records.length, 1);
      assertEqual(records[0].quantity, 3);
    });

    await run.run('Mã hàng KHÁC (không khớp lô) dù SL cao hơn lô SKU-INC -> KHÔNG hỏi (so sánh ĐÚNG theo lô khớp, không so lẫn sang SKU khác)', async () => {
      await page.evaluate(() => { window.__confirms = []; });
      await fillShelfRecordForm({ maHang: 'SKU-OTHER', productName: 'Snack B', quantity: 100, expiryDate: '2026-12-01' });
      const confirms = await getConfirms();
      assertEqual(confirms.length, 0, 'SKU khác (chưa từng ghi nhận) không có gì để so sánh -> không hỏi');
    });

    await run.run('Không có lỗi console.error/pageerror nào trong suốt quá trình thao tác THẬT', async () => {
      assertEqual(jsErrors.length, 0, `phải 0 lỗi, thực tế: ${JSON.stringify(jsErrors)}`);
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
