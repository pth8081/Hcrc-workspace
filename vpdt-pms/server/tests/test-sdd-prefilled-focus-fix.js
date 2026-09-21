// server/tests/test-sdd-prefilled-focus-fix.js
//
// LỖI THẬT (phản hồi người dùng, 9/2026): ô "Lái xe được phân công" (Xử Lý Đăng Ký Xe, đổi tài xế) khi
// ĐÃ có sẵn 1 tài xế được gán — bấm/click vào ô để chọn tài xế KHÁC không hiện được tài xế khác trong
// gợi ý, chỉ thấy đúng tài xế hiện tại. Nguyên nhân: sddHandleTrigger() (core.js) gắn CHUNG 1 hàm cho cả
// 'input' (đang gõ) lẫn 'focusin' (mới bấm vào ô) — khi bấm vào ô ĐÃ điền sẵn giá trị, hàm lọc gợi ý
// theo CHÍNH giá trị đầy đủ đang có trong ô (input.value), mà giá trị đó gần như luôn chỉ khớp CHÍNH nó
// (chuỗi ghép "Tên — Phòng ban (username)"), nên các lựa chọn KHÁC bị lọc mất hết khỏi danh sách gợi ý —
// người dùng phải tự xoá trắng ô trước mới chọn được tài xế khác, không hề rõ ràng/khám phá được.
//
// Đây là lỗi HỆ THỐNG ở chính widget "tìm-kiếm-gõ-chọn" (sdd*, core.js) dùng CHUNG cho toàn bộ hệ thống
// (19+ điểm, xem CLAUDE.md) — không riêng ô lái xe. Bản vá: 'focusin' giờ luôn hiện TOÀN BỘ danh sách
// (lọc theo chuỗi rỗng), 'input' (đang gõ) vẫn lọc theo đúng input.value như cũ.
//
// Test dùng đúng kịch bản tái hiện thật: Xử Lý Đăng Ký Xe (openCarProcessModal), phiếu ĐÃ có tài xế gán
// sẵn (lx1) + còn 1 tài xế khác (lx2) — bấm vào ô lái xe phải thấy CẢ 2 tài xế, chọn tài xế khác phải
// chọn được.
//
// Chạy: node server/tests/test-sdd-prefilled-focus-fix.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8996;

const ADMIN = { username: 'admin1', name: 'Admin', dept: 'Ban Giám Đốc', role: 'STAFF', phone: '0900000001', email: 'admin1@company.com', jobTitle: 'Người điều hành xe', perms: { carDispatch: true }, active: true };
const DRIVER1 = { username: 'lx1', name: 'Nguyễn Khắc Tài', dept: 'Phòng IT', role: 'STAFF', phone: '0900000002', email: 'lx1@company.com', jobTitle: 'Lái xe', perms: {}, active: true, isDriver: true };
const DRIVER2 = { username: 'lx2', name: 'Trần Văn Lái', dept: 'Phòng Hành Chính', role: 'STAFF', phone: '0900000003', email: 'lx2@company.com', jobTitle: 'Lái xe', perms: {}, active: true, isDriver: true };

const CAR = {
  id: 9001, code: 'HCRC-DIAG-1', dept: 'Ban Giám Đốc', status: 'APPROVED', currentStep: 1, history: [],
  type: 'Xe 5 chỗ', km: '20', passengers: '2', purpose: 'Công tác',
  startTime: '2026-09-30T14:34', endTime: '2026-09-30T17:34', destination: 'Hà Nội -> Sài Đồng',
  creator: 'admin1', creatorName: 'Admin', assignedDriverUsername: 'lx1', assignedDriver: 'Nguyễn Khắc Tài'
};

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const state = createMockState({ depts: ['Ban Giám Đốc', 'Phòng IT', 'Phòng Hành Chính'], users: [ADMIN, DRIVER1, DRIVER2] });
  state.carRegs = [CAR];
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await loginAs(page, ADMIN);
    await page.evaluate((c) => { DB.carRegs.push(c); }, CAR);
    await page.evaluate(() => { switchTab('car'); openCarProcessModal(9001); });
    await page.waitForSelector('#carAssignedDriver', { state: 'visible', timeout: 8000 });

    await run.run('Ô "Lái xe được phân công" được điền sẵn đúng tài xế hiện tại + nạp đủ 2 tài xế vào danh sách gợi ý', async () => {
      const before = await page.evaluate(() => ({
        value: document.getElementById('carAssignedDriver').value,
        itemsCount: (document.getElementById('carDriversDatalist')._sddItems || []).length
      }));
      assertEqual(before.value, 'Nguyễn Khắc Tài — Phòng IT (lx1)', 'Ô phải điền sẵn đúng tài xế đang được gán');
      assertEqual(before.itemsCount, 2, 'Danh sách nạp cho picker phải có đủ cả 2 tài xế');
    });

    await run.run('LỖI ĐÃ VÁ: bấm vào ô đã điền sẵn -> phải thấy CẢ 2 tài xế trong gợi ý (trước đây chỉ thấy đúng 1 - tài xế hiện tại)', async () => {
      await page.click('#carAssignedDriver');
      await page.waitForTimeout(100);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#carDriversDatalist [data-sdd-idx]')).map((e) => e.textContent));
      assertEqual(rows.length, 2, `Phải hiện đủ 2 tài xế trong gợi ý, hiện chỉ có: ${JSON.stringify(rows)}`);
      assert(rows.some((r) => r.includes('Trần Văn Lái')), 'Phải thấy được tài xế KHÁC (Trần Văn Lái) trong gợi ý để có thể đổi sang');
    });

    await run.run('Chọn tài xế KHÁC (Trần Văn Lái) từ gợi ý -> ô + username ẩn phải cập nhật đúng, dropdown tự đóng', async () => {
      const clicked = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#carDriversDatalist [data-sdd-idx]'));
        const target = rows.find((r) => r.textContent.includes('Trần Văn Lái'));
        if (!target) return false;
        target.click();
        return true;
      });
      assert(clicked, 'Phải tìm và bấm được dòng gợi ý của tài xế khác');
      await page.waitForTimeout(100);
      const after = await page.evaluate(() => ({
        value: document.getElementById('carAssignedDriver').value,
        username: document.getElementById('carAssignedDriverUsername').value,
        ddHidden: document.getElementById('carDriversDatalist').classList.contains('hidden')
      }));
      assertEqual(after.value, 'Trần Văn Lái — Phòng Hành Chính (lx2)', 'Ô phải đổi sang đúng tài xế vừa chọn');
      assertEqual(after.username, 'lx2', 'Username ẩn phải đổi theo đúng tài xế vừa chọn');
      assert(after.ddHidden, 'Dropdown phải tự đóng lại sau khi chọn');
    });

    await run.run('Đang GÕ (input event) vẫn lọc đúng theo text gõ như cũ — không phá hành vi tìm-kiếm khi gõ tay', async () => {
      await page.evaluate(() => { closeCarProcessModal(); openCarProcessModal(9001); });
      await page.waitForTimeout(100);
      await page.click('#carAssignedDriver');
      await page.fill('#carAssignedDriver', 'Trần');
      await page.waitForTimeout(100);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#carDriversDatalist [data-sdd-idx]')).map((e) => e.textContent));
      assertEqual(rows.length, 1, `Gõ "Trần" phải chỉ còn lọc ra đúng 1 tài xế khớp, hiện: ${JSON.stringify(rows)}`);
      assert(rows[0].includes('Trần Văn Lái'), 'Kết quả lọc theo gõ tay phải đúng tài xế khớp tên');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
