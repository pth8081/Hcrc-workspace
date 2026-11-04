// tests/test-shelf-recipients-overview-ui-real-click.js — "👥 Người Nhận Tự Thêm" (Hệ Thống → Quản Trị →
// "⏰ Lịch Báo Cáo Ngưỡng Tồn", 11/2026, người dùng phát hiện khi xem demo "📊 Báo Cáo Đối Chiếu": "việc
// mỗi siêu thị tự thêm này thì sau này admin control của gì, muốn gỡ họ ra của gì nhỉ?"). Playwright THẬT
// (click thật, không gọi thẳng hàm) — gộp CẢ 2 nguồn Đối Chiếu/Ngưỡng Tồn, admin xem trạng thái (⚠️ khoá/
// 🔁 chuyển siêu thị) + bấm "🗑️ Gỡ" THẬT -> gỡ đúng qua DELETE /recon-recipients-overview.
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const run = createRunner();
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8994;
  const ADMIN = { username: 'admin1', name: 'Quản Trị', dept: 'Văn Phòng', perms: { admin: true }, active: true, totpEnabled: true };
  // nv1: hợp lệ (đang hoạt động, đúng siêu thị Quận 1). nv2: ĐÃ KHOÁ (active:false) nhưng còn trong danh
  // sách Đối Chiếu -> phải hiện badge ⚠️. nv3: còn hoạt động nhưng ĐÃ CHUYỂN sang Siêu thị Quận 7 trong
  // khi vẫn còn trong danh sách Ngưỡng Tồn của Quận 1 -> phải hiện badge 🔁.
  const NV1 = { username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1', perms: { shelfRecordCreate: true }, active: true, totpEnabled: true };
  const NV2 = { username: 'nv2', name: 'Nhân Viên 2 (đã khoá)', dept: 'Siêu thị Quận 1', perms: { shelfRecordCreate: true }, active: false, totpEnabled: true };
  const NV3 = { username: 'nv3', name: 'Nhân Viên 3 (đã chuyển)', dept: 'Siêu thị Quận 7', perms: { shelfRecordCreate: true }, active: true, totpEnabled: true };
  const state = createMockState({
    depts: ['Siêu thị Quận 1', 'Siêu thị Quận 7', 'Văn Phòng'],
    users: [ADMIN, NV1, NV2, NV3],
    shelfReconExtraRecipients: { 'Siêu thị Quận 1': ['nv1', 'nv2'] },
    shelfStockThresholds: [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'COCA-330', minQuantity: 10, active: true, extraRecipientUsernames: ['nv3'] }
    ]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('system'); });
    await page.click('#btnSystemSubAdmin');
    await page.click('#btnAdminSubShelfDigest');
    await page.waitForTimeout(500);

    await run.run('Bảng "👥 Người Nhận Tự Thêm" hiện đúng 3 dòng gộp cả Đối Chiếu + Ngưỡng Tồn, đúng badge trạng thái (tra theo class, không so diacritic chuỗi -> tránh lệch chuẩn hoá Unicode)', async () => {
      const info = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#reconOverviewTableBody tr')];
        const byUsername = (un) => rows.find(r => r.innerText.includes(`(${un})`));
        const badgeClassOf = (row) => row ? row.querySelectorAll('td')[3].querySelector('span').className : null;
        return {
          rowCount: rows.length,
          nv1Badge: badgeClassOf(byUsername('nv1')),
          nv2Badge: badgeClassOf(byUsername('nv2')),
          nv3Badge: badgeClassOf(byUsername('nv3'))
        };
      });
      assertEqual(info.rowCount, 3, 'phải có đúng 3 dòng (nv1 Đối Chiếu, nv2 Đối Chiếu, nv3 Ngưỡng Tồn)');
      assertEqual(info.nv1Badge, 'badge-success', 'nv1 (hợp lệ) phải badge-success');
      assertEqual(info.nv2Badge, 'badge-danger', 'nv2 (đã khoá) phải badge-danger');
      assertEqual(info.nv3Badge, 'badge-warning', 'nv3 (đã chuyển siêu thị) phải badge-warning');
      const statsText = await page.evaluate(() => document.getElementById('reconOverviewStats').innerText);
      assert(statsText.includes('3'), `tổng số người đã tự thêm phải là 3, thực tế: ${statsText}`);
    });

    await run.run('Lọc "Chỉ hiện cần chú ý" THẬT (tick checkbox) -> CHỈ còn nv2/nv3, ẩn nv1 (hợp lệ)', async () => {
      await page.click('#reconOverviewOnlyAttention');
      await page.waitForTimeout(100);
      const rowsText = await page.evaluate(() => document.getElementById('reconOverviewTableBody').innerText);
      assert(!rowsText.includes('nv1'), 'nv1 hợp lệ phải bị ẩn khi lọc "chỉ cần chú ý"');
      assert(rowsText.includes('nv2') && rowsText.includes('nv3'), 'nv2/nv3 (cần chú ý) vẫn phải còn hiện');
      await page.click('#reconOverviewOnlyAttention'); // bỏ tick lại cho bước sau
      await page.waitForTimeout(100);
    });

    await run.run('Bấm "🗑️ Gỡ" THẬT trên dòng nv2 (nguồn Đối Chiếu) -> gỡ đúng qua DELETE, KHÔNG đụng nv1 cùng siêu thị', async () => {
      const btnSelector = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#reconOverviewTableBody tr')];
        const row = rows.find(r => r.innerText.includes('nv2'));
        const btn = row.querySelector('[data-op="removeShelfReconOverviewRecipient"]');
        btn.setAttribute('data-test-target', '1');
        return '[data-test-target="1"]';
      });
      await page.click(btnSelector);
      await page.waitForTimeout(200);
      assertEqual(JSON.stringify(state.shelfReconExtraRecipients['Siêu thị Quận 1']), JSON.stringify(['nv1']),
        'Phải gỡ ĐÚNG nv2, giữ nguyên nv1 trong state.shelfReconExtraRecipients["Siêu thị Quận 1"]');
      const rowsText = await page.evaluate(() => document.getElementById('reconOverviewTableBody').innerText);
      assert(!rowsText.includes('nv2'), 'nv2 phải biến mất khỏi bảng sau khi gỡ + tự load lại');
      assert(rowsText.includes('nv1'), 'nv1 phải vẫn còn hiện');
    });

    await run.run('Bấm "🗑️ Gỡ" THẬT trên dòng nv3 (nguồn Ngưỡng Tồn) -> gỡ đúng khỏi state.shelfStockThresholds[0].extraRecipientUsernames', async () => {
      const btnSelector = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#reconOverviewTableBody tr')];
        const row = rows.find(r => r.innerText.includes('nv3'));
        const btn = row.querySelector('[data-op="removeShelfReconOverviewRecipient"]');
        btn.setAttribute('data-test-target', '2');
        return '[data-test-target="2"]';
      });
      await page.click(btnSelector);
      await page.waitForTimeout(200);
      assertEqual(JSON.stringify(state.shelfStockThresholds.find(t => t.id === 1).extraRecipientUsernames), JSON.stringify([]),
        'Phải gỡ ĐÚNG nv3 khỏi dòng ngưỡng #1');
      const statsText = await page.evaluate(() => document.getElementById('reconOverviewStats').innerText);
      assert(statsText.includes('1'), `chỉ còn đúng 1 người (nv1) sau khi gỡ cả nv2+nv3, thực tế: ${statsText}`);
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
