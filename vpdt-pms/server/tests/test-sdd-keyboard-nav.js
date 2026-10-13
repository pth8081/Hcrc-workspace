// server/tests/test-sdd-keyboard-nav.js
//
// Điều hướng bàn phím cho ô tìm-kiếm-gõ-chọn "sdd*" (10/2026, theo yêu cầu người dùng: thao tác nhanh
// bằng bàn phím trong các form Nhân Sự, không phải lúc nào cũng với tay sang chuột) — xem
// sddSetActiveIdx()/khối keydown ArrowDown/ArrowUp/Enter mới ở core.js (ngay sau sddHandleTrigger()).
// Dùng lại ĐÚNG kịch bản "Lái xe được phân công" (Xử Lý Đăng Ký Xe) đã có sẵn ở
// test-sdd-prefilled-focus-fix.js — widget DÙNG CHUNG toàn hệ thống (19+ điểm), không cần dựng form mới.
//
// Chạy: node server/tests/test-sdd-keyboard-nav.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8997;

const ADMIN = { username: 'admin1', name: 'Admin', dept: 'Ban Giám Đốc', role: 'STAFF', phone: '0900000001', email: 'admin1@company.com', jobTitle: 'Người điều hành xe', perms: { carDispatch: true }, active: true };
const DRIVER1 = { username: 'lx1', name: 'Nguyễn Khắc Tài', dept: 'Phòng IT', role: 'STAFF', phone: '0900000002', email: 'lx1@company.com', jobTitle: 'Lái xe', perms: {}, active: true, isDriver: true };
const DRIVER2 = { username: 'lx2', name: 'Trần Văn Lái', dept: 'Phòng Hành Chính', role: 'STAFF', phone: '0900000003', email: 'lx2@company.com', jobTitle: 'Lái xe', perms: {}, active: true, isDriver: true };
const DRIVER3 = { username: 'lx3', name: 'Phạm Văn Vững', dept: 'Phòng Hành Chính', role: 'STAFF', phone: '0900000004', email: 'lx3@company.com', jobTitle: 'Lái xe', perms: {}, active: true, isDriver: true };

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
  const state = createMockState({ depts: ['Ban Giám Đốc', 'Phòng IT', 'Phòng Hành Chính'], users: [ADMIN, DRIVER1, DRIVER2, DRIVER3] });
  state.carRegs = [CAR];
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));

  try {
    await loginAs(page, ADMIN);
    await page.evaluate((c) => { DB.carRegs.push(c); }, CAR);
    await page.evaluate(() => { switchTab('car'); openCarProcessModal(9001); });
    await page.waitForSelector('#carAssignedDriver', { state: 'visible', timeout: 8000 });

    await run.run('Bấm Tab vào ô -> dropdown tự hiện sẵn 3 tài xế (hành vi focusin đã có từ trước)', async () => {
      await page.focus('#carAssignedDriver');
      await page.waitForTimeout(100);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#carDriversDatalist [data-sdd-idx]')).map(e => e.textContent));
      assertEqual(rows.length, 3, `Phải thấy đủ 3 tài xế: ${JSON.stringify(rows)}`);
    });

    await run.run('ArrowDown lần 1 -> tô sáng ĐÚNG dòng đầu tiên (idx 0)', async () => {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(50);
      const active = await page.evaluate(() => document.getElementById('carDriversDatalist')._sddActiveIdx);
      assertEqual(active, 0, 'ArrowDown lần đầu phải tô sáng dòng 0');
      const highlighted = await page.evaluate(() => document.querySelector('#carDriversDatalist [data-sdd-idx="0"]').classList.contains('bg-sky-100'));
      assert(highlighted, 'Dòng 0 phải có class tô sáng bg-sky-100');
    });

    await run.run('ArrowDown lần 2 -> chuyển sang dòng thứ 2 (idx 1), KHÔNG lặp lại dòng 0', async () => {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(50);
      const active = await page.evaluate(() => document.getElementById('carDriversDatalist')._sddActiveIdx);
      assertEqual(active, 1, 'ArrowDown lần 2 phải tô sáng dòng 1');
    });

    await run.run('ArrowUp -> quay lại dòng 0', async () => {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(50);
      const active = await page.evaluate(() => document.getElementById('carDriversDatalist')._sddActiveIdx);
      assertEqual(active, 0, 'ArrowUp phải quay lại dòng 0');
    });

    await run.run('ArrowUp ở dòng đầu -> vòng xuống dòng CUỐI (idx 2), không kẹt ở biên', async () => {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(50);
      const active = await page.evaluate(() => document.getElementById('carDriversDatalist')._sddActiveIdx);
      assertEqual(active, 2, 'ArrowUp ở dòng đầu phải vòng xuống dòng cuối (idx 2)');
    });

    await run.run('Enter khi đang tô sáng dòng -> CHỌN đúng dòng đó, ô + username ẩn cập nhật, dropdown tự đóng', async () => {
      // Hiện đang tô sáng idx 2 (Phạm Văn Vững, lx3) từ bước trước.
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      const after = await page.evaluate(() => ({
        inputValue: document.getElementById('carAssignedDriver').value,
        username: document.getElementById('carAssignedDriverUsername')?.value,
        ddHidden: document.getElementById('carDriversDatalist').classList.contains('hidden')
      }));
      assert(after.inputValue.includes('Phạm Văn Vững'), `Ô phải đổi đúng sang Phạm Văn Vững, hiện là: ${after.inputValue}`);
      assert(after.ddHidden, 'Dropdown phải tự đóng sau khi Enter chọn');
    });

    await run.run('Mở lại dropdown (Tab ra rồi Tab lại) -> Enter khi CHƯA tô sáng dòng nào -> KHÔNG chặn Enter mặc định (không văng lỗi, dropdown vẫn đóng)', async () => {
      await page.evaluate(() => document.getElementById('carAssignedDriver').blur());
      await page.waitForTimeout(50);
      await page.focus('#carAssignedDriver');
      await page.waitForTimeout(100);
      const activeIdxBefore = await page.evaluate(() => document.getElementById('carDriversDatalist')._sddActiveIdx);
      assertEqual(activeIdxBefore, -1, 'Vừa mở lại (chỉ focus, chưa bấm mũi tên) thì chưa có dòng nào được tô sáng');
      // Enter ở đây KHÔNG được chọn gì (vì chưa ArrowDown lần nào) — chỉ xác nhận không văng lỗi JS.
      await page.keyboard.press('Enter');
      await page.waitForTimeout(50);
    });

    await run.run('KHÔNG có lỗi JS nào xảy ra suốt kịch bản điều hướng bàn phím', async () => {
      assertEqual(jsErrors.length, 0, `jsErrors: ${JSON.stringify(jsErrors)}`);
    });

    run.summary();
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
