// tests/test-shelf-threshold-digest-ui-real-click.js — "Báo Cáo Ngưỡng Tồn" THIẾT KẾ LẠI LẦN 2 (11/2026):
// test UI THẬT bằng Playwright page.click()/page.selectOption() (không page.evaluate() gọi hàm trực
// tiếp cho các nút/ô đang test — cùng nguyên tắc rút ra từ bug kẹt sub-tab v28.48, xem
// tests/test-shelf-subtab-real-click.js) cho: (1) bảng Ngưỡng Tồn trên web tô màu đỏ/vàng/an toàn theo
// classifyThresholdStatus(), (2) panel admin mới "⏰ Lịch Báo Cáo Ngưỡng Tồn" — đổi Chu Kỳ ẩn/hiện đúng
// field Thứ/Ngày-trong-tháng (data-op-change="showShelfDigestFrequencyFields"), lưu round-trip đúng.
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8982;
  const ADMIN = {
    username: 'admin1', name: 'Quản Trị Viên', dept: 'HO',
    perms: { admin: true, vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true, email: 'admin1@hcrc.vn'
  };
  const today = new Date().toISOString();
  const state = createMockState({
    depts: ['Siêu thị Quận 1'],
    users: [ADMIN],
    shelfLocations: [{ id: 100, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Quầy A1', category: 'Đồ uống' }],
    shelfStockThresholds: [
      // RED: tồn 3 < ngưỡng 10
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU_RED', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true },
      // YELLOW: tồn 52 nằm trong [50, 55) — còn <10% nữa chạm ngưỡng
      { id: 2, dept: 'Siêu thị Quận 1', maHang: 'SKU_YELLOW', maVach: '', category: '', minQuantity: 50, extraRecipientUsernames: [], active: true },
      // GREEN: tồn 100 >= 11
      { id: 3, dept: 'Siêu thị Quận 1', maHang: 'SKU_GREEN', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true }
    ],
    shelfRecords: [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU_RED', maVach: '', quantity: 3, createdAt: today },
      { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU_YELLOW', maVach: '', quantity: 52, createdAt: today },
      { id: 3, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU_GREEN', maVach: '', quantity: 100, createdAt: today }
    ]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);

    // ===== Phần 1: bảng Ngưỡng Tồn trên web — tô màu đỏ/vàng/an toàn =====
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubThreshold');
    await page.waitForTimeout(50);

    await run.run('Bảng Ngưỡng Tồn: dòng RED có class bg-red-50 + badge "Dưới ngưỡng" + đúng số Tồn Hôm Nay', async () => {
      const info = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#vhShelfThresholdBody tr')];
        const row = rows.find(r => r.textContent.includes('SKU_RED'));
        return row ? { cls: row.className, html: row.innerHTML } : null;
      });
      assert(info, 'phải tìm thấy dòng SKU_RED');
      assert(info.cls.includes('bg-red-50'), `dòng SKU_RED phải có bg-red-50, thực tế class: ${info.cls}`);
      assert(info.html.includes('Dưới ngưỡng') && info.html.includes('>3<'), `phải hiện badge Dưới ngưỡng + tổng 3, thực tế: ${info.html}`);
    });

    await run.run('Bảng Ngưỡng Tồn: dòng YELLOW có class bg-amber-50 + badge "Gần ngưỡng"', async () => {
      const info = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#vhShelfThresholdBody tr')];
        const row = rows.find(r => r.textContent.includes('SKU_YELLOW'));
        return row ? { cls: row.className, html: row.innerHTML } : null;
      });
      assert(info, 'phải tìm thấy dòng SKU_YELLOW');
      assert(info.cls.includes('bg-amber-50'), `dòng SKU_YELLOW phải có bg-amber-50, thực tế class: ${info.cls}`);
      assert(info.html.includes('Gần ngưỡng'), `phải hiện badge Gần ngưỡng, thực tế: ${info.html}`);
    });

    await run.run('Bảng Ngưỡng Tồn: dòng GREEN KHÔNG có bg-red-50/bg-amber-50, badge "An toàn"', async () => {
      const info = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#vhShelfThresholdBody tr')];
        const row = rows.find(r => r.textContent.includes('SKU_GREEN'));
        return row ? { cls: row.className, html: row.innerHTML } : null;
      });
      assert(info, 'phải tìm thấy dòng SKU_GREEN');
      assert(!info.cls.includes('bg-red-50') && !info.cls.includes('bg-amber-50'), `dòng SKU_GREEN KHÔNG được tô đỏ/vàng, thực tế class: ${info.cls}`);
      assert(info.html.includes('An toàn'), `phải hiện badge An toàn, thực tế: ${info.html}`);
    });

    // ===== Phần 2: panel admin "⏰ Lịch Báo Cáo Ngưỡng Tồn" =====
    await page.evaluate(() => { switchTab('system'); });
    await page.click('#btnSystemSubAdmin');
    await page.click('#btnAdminSubShelfDigest');
    await page.waitForTimeout(50);

    await run.run('Mặc định WEEKLY -> hiện ô "Thứ Gửi", ẩn ô "Ngày Trong Tháng"', async () => {
      const visible = await page.evaluate(() => ({
        dowHidden: document.getElementById('stDigestDayOfWeekWrap').classList.contains('hidden'),
        domHidden: document.getElementById('stDigestDayOfMonthWrap').classList.contains('hidden')
      }));
      assert(!visible.dowHidden, 'Thứ Gửi phải HIỆN khi mặc định WEEKLY');
      assert(visible.domHidden, 'Ngày Trong Tháng phải ẨN khi mặc định WEEKLY');
    });

    await run.run('Đổi Chu Kỳ sang MONTHLY (click/select THẬT) -> ẩn Thứ, hiện Ngày Trong Tháng', async () => {
      await page.selectOption('#stDigestFrequency', 'MONTHLY');
      await page.waitForTimeout(30);
      const visible = await page.evaluate(() => ({
        dowHidden: document.getElementById('stDigestDayOfWeekWrap').classList.contains('hidden'),
        domHidden: document.getElementById('stDigestDayOfMonthWrap').classList.contains('hidden')
      }));
      assert(visible.dowHidden, 'Thứ Gửi phải ẨN khi chọn MONTHLY');
      assert(!visible.domHidden, 'Ngày Trong Tháng phải HIỆN khi chọn MONTHLY');
    });

    await run.run('Đổi lại DAILY -> ẩn CẢ 2 field Thứ/Ngày', async () => {
      await page.selectOption('#stDigestFrequency', 'DAILY');
      await page.waitForTimeout(30);
      const visible = await page.evaluate(() => ({
        dowHidden: document.getElementById('stDigestDayOfWeekWrap').classList.contains('hidden'),
        domHidden: document.getElementById('stDigestDayOfMonthWrap').classList.contains('hidden')
      }));
      assert(visible.dowHidden && visible.domHidden, 'DAILY không cần cả Thứ lẫn Ngày trong tháng');
    });

    await run.run('Bấm "Lưu Lịch Gửi" THẬT -> DB.shelfThresholdDigestSchedule cập nhật đúng giá trị form', async () => {
      await page.selectOption('#stDigestFrequency', 'WEEKLY');
      await page.waitForTimeout(30);
      await page.selectOption('#stDigestDayOfWeek', '3'); // Thứ 4
      await page.fill('#stDigestHour', '9');
      await page.click('#adminSubShelfDigest button[type="submit"]');
      await page.waitForTimeout(80);
      const saved = await page.evaluate(() => DB.shelfThresholdDigestSchedule);
      assertEqual(saved.frequency, 'WEEKLY');
      assertEqual(saved.dayOfWeek, 3);
      assertEqual(saved.hour, 9);
    });

    // Xác nhận giá trị đã lưu THỰC SỰ quay lại đúng khi mở lại panel (không chỉ còn đúng trong DB phía
    // client ngay sau submit) — bấm THẬT sang tab khác rồi bấm lại đúng nút tab Ngưỡng Tồn, buộc
    // loadShelfThresholdDigestScheduleToForm() chạy lại và đọc từ DB (đã được syncStorage() xác nhận qua
    // route POST thật của mock) để đổ vào form, mô phỏng đúng hành vi "rời trang rồi quay lại"/tải lại.
    await run.run('Rời sang tab khác rồi bấm lại tab Ngưỡng Tồn (THẬT) -> form hiện đúng giá trị vừa lưu (Thứ 4, 9h)', async () => {
      await page.click('#btnAdminSubTrustedCa');
      await page.waitForTimeout(30);
      await page.click('#btnAdminSubShelfDigest');
      await page.waitForTimeout(30);
      const reloaded = await page.evaluate(() => ({
        frequency: document.getElementById('stDigestFrequency').value,
        dayOfWeek: document.getElementById('stDigestDayOfWeek').value,
        hour: document.getElementById('stDigestHour').value,
        dowHidden: document.getElementById('stDigestDayOfWeekWrap').classList.contains('hidden'),
        domHidden: document.getElementById('stDigestDayOfMonthWrap').classList.contains('hidden')
      }));
      assertEqual(reloaded.frequency, 'WEEKLY');
      assertEqual(reloaded.dayOfWeek, '3');
      assertEqual(reloaded.hour, '9');
      assert(!reloaded.dowHidden, 'Thứ Gửi phải HIỆN lại đúng vì frequency đã lưu là WEEKLY');
      assert(reloaded.domHidden, 'Ngày Trong Tháng phải vẫn ẨN vì frequency đã lưu là WEEKLY');
    });

    // Lọc bỏ nhiễu CÓ SẴN của harness (không liên quan tính năng này): 404 tải tài nguyên tĩnh + lỗi sync
    // "users" harness chưa mock đầy đủ route riêng (xảy ra ngay khi vào tab Quản Trị với tài khoản admin,
    // độc lập hoàn toàn với mọi thao tác trong bài test này) — CHỈ chặn lỗi thật liên quan trực tiếp tới
    // shelfThresholdDigestSchedule/Ngưỡng Tồn.
    const relevantErrors = jsErrors.filter(e => !e.includes('404') && !e.includes('"users"'));
    assertEqual(relevantErrors.length, 0, `Không được có lỗi JS liên quan tính năng này, thực tế:\n${relevantErrors.join('\n')}`);
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
