// tests/test-stocktake-period-closereopen-scope.js — test Playwright THẬT cho 2 quyền MỚI, TÁCH RIÊNG
// (12/2026, theo yêu cầu người dùng: "đóng kỳ tôi chỉ cho phép phân cho người đóng kỳ thôi, còn mở kỳ
// phải có quyền cao hơn — tách ra cho tôi hai cái"):
//   - kiemKePeriodCloseManage {all, depts[]} — ĐÓNG KỲ theo phạm vi siêu thị (chọn 1/nhiều/tất cả).
//   - kiemKePeriodReopenManage (boolean PHẲNG, KHÔNG có ô chọn siêu thị) — MỞ LẠI KỲ ĐÃ CHỐT, quyền "cao
//     hơn" Đóng Kỳ: bật là mở lại được MỌI siêu thị, không có mức hẹp hơn.
// Kịch bản: IT1 CHỈ có kiemKePeriodCloseManage (không có Reopen) -> đóng được nhưng KHÔNG mở lại được.
// IT2 CHỈ có kiemKePeriodReopenManage (không có Close scope nào, không phải admin/kiemKePeriodManage) ->
// mở lại được kỳ Đã Chốt CỦA BẤT KỲ SIÊU THỊ NÀO (không bị giới hạn depts), nhưng KHÔNG đóng được kỳ nào
// (vì không có quyền Đóng Kỳ riêng, không có Tab 1, không phải siêu thị của chính mình).
// Chạy: node tests/test-stocktake-period-closereopen-scope.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8946;
  const DEPT1 = 'Siêu thị Quận 1'; // nhà của IT1/IT2
  const DEPT2 = 'Siêu thị Quận 2'; // IT1 được gán quyền Đóng Kỳ ở đây
  const DEPT3 = 'Siêu thị Quận 3'; // KHÔNG liên quan tới IT1 — không được gán, không phải nhà
  const IT1 = {
    username: 'it1', name: 'IT Đóng Kỳ', dept: DEPT1,
    perms: { kiemKePeriodCloseManage: { all: false, depts: [DEPT2] } },
    active: true, totpEnabled: true
  };
  const IT2 = {
    username: 'it2', name: 'IT Mở Lại Kỳ', dept: DEPT1,
    perms: { kiemKePeriodReopenManage: true },
    active: true, totpEnabled: true
  };
  const activeDept2 = { id: 7001, dept: DEPT2, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026 - Quận 2', trangThai: 'DANG_HOAT_DONG' };
  const closedDept2 = { id: 7002, dept: DEPT2, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q3/2026 - Quận 2 (đã chốt)', trangThai: 'DA_CHOT' };
  const closedDept3 = { id: 7003, dept: DEPT3, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q3/2026 - Quận 3 (đã chốt)', trangThai: 'DA_CHOT' };
  const state = createMockState({
    depts: [DEPT1, DEPT2, DEPT3], stores: [DEPT1, DEPT2, DEPT3], users: [IT1, IT2],
    stocktakeSessions: [activeDept2, closedDept2, closedDept3]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chỉ hỗ trợ patch-mode (__patchUser) cho /api/data/users ở harness này';
  const jsErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes(KNOWN_HARNESS_NOISE)) return;
    jsErrors.push('[console.error] ' + msg.text());
  });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  try {
    // ===== IT1: CHỈ có kiemKePeriodCloseManage (Đóng Kỳ Quận 2) — KHÔNG có Mở Lại =====
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, IT1);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    await run.run('IT1 (chỉ Đóng Kỳ) thấy dropdown "Siêu thị:" vì phạm vi Đóng Kỳ khác dept mình', async () => {
      const isSelect = await page.evaluate(() => !!document.getElementById('kkPeriodDeptInput'));
      assert(isSelect, 'Phải hiện dropdown vì phạm vi Đóng Kỳ có hơn 1 siêu thị chọn được');
      const options = await page.evaluate(() => (document.getElementById('kkPeriodDeptDropdown')._sddItems || []).map(i => i.value));
      assert(options.includes(DEPT1) && options.includes(DEPT2), `Dropdown phải có cả siêu thị nhà (${DEPT1}) và được gán (${DEPT2}), thực tế: ${options.join(',')}`);
      assert(!options.includes(DEPT3), `Dropdown KHÔNG được có ${DEPT3} (IT1 không được gán, không phải quyền Mở Lại)`);
    });

    await run.run('IT1 Đóng Kỳ được kỳ Đang hoạt động của Quận 2 (siêu thị được gán, không phải siêu thị mình)', async () => {
      await page.fill('#kkPeriodDeptInput', DEPT2);
      await page.waitForTimeout(200);
      const btn = await page.$('button[data-op="closeKkPeriod"][data-arg0="7001"]');
      assert(!!btn, 'Phải thấy nút Đóng Kỳ cho kỳ 7001 (Quận 2, Đang hoạt động)');
      await btn.click();
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
      assert(text.includes('Đã chốt') || !text.includes('🔒 Đóng Kỳ'), `Kỳ 7001 phải chuyển sang Đã chốt, thực tế: ${text}`);
    });

    await run.run('IT1 KHÔNG thấy/bấm được nút Mở Lại cho kỳ Đã chốt của Quận 2 (chỉ có Đóng Kỳ, không có quyền Mở Lại — "cao hơn")', async () => {
      const btn = await page.$('button[data-op="reopenKkPeriod"][data-arg0="7002"]');
      assert(!btn, 'KHÔNG được thấy nút Mở Lại — IT1 chỉ có kiemKePeriodCloseManage, chưa có kiemKePeriodReopenManage');
      // Server cũng phải tự chặn thật (không chỉ ẩn UI) nếu cố gọi thẳng API.
      const res = await page.evaluate(async () => {
        const r = await fetch('/api/stocktake/sessions/7002/reopen', { method: 'POST' });
        return { status: r.status, body: await r.json() };
      });
      assertEqual(res.status, 403, `Server phải chặn 403 khi IT1 cố Mở Lại dù không có quyền, thực tế: ${JSON.stringify(res)}`);
    });

    // ===== IT2: CHỈ có kiemKePeriodReopenManage (phẳng, mọi siêu thị) — KHÔNG có Đóng Kỳ nào =====
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, IT2);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    await run.run('IT2 (chỉ Mở Lại) thấy dropdown với MỌI siêu thị (quyền Mở Lại luôn là tất cả, không chọn lẻ)', async () => {
      const options = await page.evaluate(() => Array.from(document.getElementById('kkPeriodDeptSelect').options).map(o => o.value));
      assert(options.includes(DEPT1) && options.includes(DEPT2) && options.includes(DEPT3), `Phải thấy ĐỦ cả 3 siêu thị, thực tế: ${options.join(',')}`);
    });

    await run.run('IT2 Mở Lại được kỳ Đã chốt của Quận 3 (siêu thị hoàn toàn không liên quan, vì quyền Mở Lại là MỌI siêu thị)', async () => {
      await page.selectOption('#kkPeriodDeptSelect', DEPT3);
      await page.waitForTimeout(200);
      const btn = await page.$('button[data-op="reopenKkPeriod"][data-arg0="7003"]');
      assert(!!btn, 'Phải thấy nút Mở Lại cho kỳ 7003 (Quận 3, Đã chốt) dù IT2 không liên quan gì tới Quận 3');
      await btn.click();
      await page.waitForTimeout(250);
      const btnGone = await page.$('button[data-op="reopenKkPeriod"][data-arg0="7003"]');
      assert(!btnGone, 'Sau khi Mở Lại, nút phải biến mất (đã chuyển sang Đang hoạt động)');
    });

    await run.run('IT2 KHÔNG Đóng Kỳ được (không có kiemKePeriodCloseManage, không có Tab 1, không phải siêu thị mình)', async () => {
      const res = await page.evaluate(async () => {
        const r = await fetch('/api/stocktake/sessions/7003/close', { method: 'POST' });
        return { status: r.status, body: await r.json() };
      });
      assertEqual(res.status, 403, `Server phải chặn 403 khi IT2 cố Đóng Kỳ dù không có quyền, thực tế: ${JSON.stringify(res)}`);
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
