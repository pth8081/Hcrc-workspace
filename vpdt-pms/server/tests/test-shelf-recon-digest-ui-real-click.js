// tests/test-shelf-recon-digest-ui-real-click.js — "📊 Báo Cáo Đối Chiếu" (Kiểm Soát Hàng Hóa, 11/2026,
// theo yêu cầu người dùng "đối chiếu cũng sẽ đặt lịch gửi email được") — Playwright THẬT (click thật,
// không gọi thẳng hàm), cùng khuôn tests/test-shelf-threshold-digest-ui-real-click.js:
//   1. Màn "📊 Đối Chiếu": picker "✉️ Người Nhận Email Báo Cáo Lệch" CHỈ hiện cho người có
//      shelfLocationManage, chọn người + bấm "Lưu Người Nhận" THẬT -> lưu đúng qua PUT /recon-recipients.
//   2. Hệ Thống → Quản Trị → "📊 Báo Cáo Đối Chiếu": form lịch gửi riêng (tách khỏi Ngưỡng Tồn) lưu đúng.
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const run = createRunner();
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8993;
  const MANAGER = {
    username: 'cht1', name: 'Cửa Hàng Trưởng Q1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfLocationManage: true, admin: false }, active: true, totpEnabled: true
  };
  const STAFF = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true
  };
  const ADMIN = { username: 'admin1', name: 'Quản Trị', dept: 'Văn Phòng', perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({ depts: ['Siêu thị Quận 1', 'Văn Phòng'], users: [MANAGER, STAFF, ADMIN] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await run.run('Nhân viên THƯỜNG (chỉ shelfRecordCreate) KHÔNG thấy khối picker người nhận ở Đối Chiếu', async () => {
      await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, STAFF);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('SHELF'); setVanHanhShelfSubTab('RECON'); });
      await page.waitForTimeout(200);
      const hidden = await page.evaluate(() => document.getElementById('shelfReconRecipientsWrap').classList.contains('hidden'));
      assert(hidden, 'Nhân viên thường không có shelfLocationManage -> không được thấy khối chọn người nhận email');
    });

    await run.run('Cửa hàng trưởng (shelfLocationManage) THẤY khối picker, chọn người + Lưu THẬT -> lưu đúng qua PUT /recon-recipients', async () => {
      await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('SHELF'); setVanHanhShelfSubTab('RECON'); });
      await page.waitForTimeout(250);
      const wrapHidden = await page.evaluate(() => document.getElementById('shelfReconRecipientsWrap').classList.contains('hidden'));
      assert(!wrapHidden, 'Cửa hàng trưởng phải thấy khối chọn người nhận email');

      // Chọn "nv1" (ĐÚNG siêu thị mình) qua picker thật (renderPeopleMultiSelect) — gõ vào ô tìm-kiếm,
      // click dòng gợi ý (data-op="pmsAdd"), rồi bấm nút "Lưu Người Nhận" THẬT.
      await page.fill('#shelfReconRecipientsPicker [data-pms-search]', 'nv1');
      await page.waitForTimeout(100);
      await page.click('#shelfReconRecipientsPicker [data-pms-dropdown] [data-op="pmsAdd"]');
      await page.waitForTimeout(100);

      await page.click('[data-op="saveShelfReconExtraRecipients"]');
      await page.waitForTimeout(150);

      assertEqual(JSON.stringify(state.shelfReconExtraRecipients?.['Siêu thị Quận 1']), JSON.stringify(['nv1']),
        'Phải lưu đúng ["nv1"] vào state.shelfReconExtraRecipients["Siêu thị Quận 1"]');
    });

    await run.run('Rời tab rồi mở lại Đối Chiếu -> picker hiện lại ĐÚNG người đã lưu (không mất khi chuyển tab)', async () => {
      await page.evaluate(() => { setVanHanhShelfSubTab('RECORD'); });
      await page.waitForTimeout(100);
      await page.evaluate(() => { setVanHanhShelfSubTab('RECON'); });
      await page.waitForTimeout(250);
      const checked = await page.evaluate(() => [...document.querySelectorAll('input.shelfReconRecipientCheckbox:checked')].map(cb => cb.value));
      assertEqual(JSON.stringify(checked), JSON.stringify(['nv1']), 'phải hiện lại đúng nv1 đã chọn từ trước');
    });

    await run.run('Admin: "📊 Báo Cáo Đối Chiếu" — lịch gửi TÁCH RIÊNG khỏi Ngưỡng Tồn, lưu THẬT đúng giá trị', async () => {
      await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
      await page.evaluate(() => { switchTab('system'); });
      await page.click('#btnSystemSubAdmin');
      await page.click('#btnAdminSubShelfDigest');
      await page.waitForTimeout(100);

      // Đổi Ngưỡng Tồn sang MONTHLY ngày 5, Đối Chiếu sang DAILY giờ 6 — phải ĐỘC LẬP hoàn toàn.
      await page.selectOption('#stDigestFrequency', 'MONTHLY');
      await page.fill('#stDigestDayOfMonth', '5');
      await page.click('form[data-op-submit="saveShelfThresholdDigestSchedule"] button[type="submit"]');
      await page.waitForTimeout(100);

      await page.selectOption('#srDigestFrequency', 'DAILY');
      await page.fill('#srDigestHour', '6');
      await page.click('form[data-op-submit="saveShelfReconDigestSchedule"] button[type="submit"]');
      await page.waitForTimeout(100);

      const result = await page.evaluate(() => ({
        threshold: DB.shelfThresholdDigestSchedule,
        recon: DB.shelfReconDigestSchedule
      }));
      assertEqual(result.threshold.frequency, 'MONTHLY');
      assertEqual(result.threshold.dayOfMonth, 5);
      assertEqual(result.recon.frequency, 'DAILY');
      assertEqual(result.recon.hour, 6);
      assert(result.threshold.frequency !== result.recon.frequency, 'phải là 2 lịch gửi ĐỘC LẬP, không lẫn vào nhau');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
