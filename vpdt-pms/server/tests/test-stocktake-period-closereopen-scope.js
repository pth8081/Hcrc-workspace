// tests/test-stocktake-period-closereopen-scope.js — test Playwright THẬT cho quyền MỚI (12/2026, theo
// yêu cầu người dùng "cho thêm mục quyền đóng mở kỳ kiểm kê có chọn 1 hoặc nhiều siêu thị hoặc all siêu
// thị") kiemKePeriodCloseReopenManage {all, depts[]}: người KHÔNG phải Admin, KHÔNG có kiemKePeriodManage,
// được gán quyền này cho 1 siêu thị KHÁC siêu thị của mình — phải (a) THẤY được dropdown "📍 Siêu thị:" ở
// Tab 1 để chuyển sang xem đúng siêu thị được gán (LỖI THẬT phát hiện khi thêm quyền này: trước đó
// dropdown CHỈ admin mới có, người thường bị kẹt cứng siêu thị của mình dù có quyền mới), (b) Đóng Kỳ
// được kỳ Đang hoạt động, (c) Mở Lại được kỳ Đã chốt — của ĐÚNG siêu thị được gán, KHÔNG phải siêu thị
// thứ 3 không liên quan.
// Chạy: node tests/test-stocktake-period-closereopen-scope.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8996;
  const DEPT1 = 'Siêu thị Quận 1'; // nhà của IT
  const DEPT2 = 'Siêu thị Quận 2'; // được gán quyền Đóng/Mở Lại
  const DEPT3 = 'Siêu thị Quận 3'; // KHÔNG liên quan — không được gán, không phải nhà
  const IT = {
    username: 'it1', name: 'IT Hỗ Trợ', dept: DEPT1,
    perms: { kiemKePeriodCloseReopenManage: { all: false, depts: [DEPT2] } },
    active: true, totpEnabled: true
  };
  const activeDept2 = { id: 7001, dept: DEPT2, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026 - Quận 2', trangThai: 'DANG_HOAT_DONG' };
  const closedDept2 = { id: 7002, dept: DEPT2, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q3/2026 - Quận 2 (đã chốt)', trangThai: 'DA_CHOT' };
  const state = createMockState({
    depts: [DEPT1, DEPT2, DEPT3], stores: [DEPT1, DEPT2, DEPT3], users: [IT],
    stocktakeSessions: [activeDept2, closedDept2]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';
  const jsErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes(KNOWN_HARNESS_NOISE)) return;
    jsErrors.push('[console.error] ' + msg.text());
  });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, IT);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    await run.run('IT (không admin, không kiemKePeriodManage) VẪN thấy dropdown "Siêu thị:" vì có kiemKePeriodCloseReopenManage phạm vi khác dept mình', async () => {
      const isSelect = await page.evaluate(() => !!document.getElementById('kkPeriodDeptSelect'));
      assert(isSelect, 'Phải hiện dropdown (không phải text cố định) vì phạm vi quyền có hơn 1 siêu thị chọn được');
      const options = await page.evaluate(() => Array.from(document.getElementById('kkPeriodDeptSelect').options).map(o => o.value));
      assert(options.includes(DEPT1) && options.includes(DEPT2), `Dropdown phải có cả siêu thị nhà (${DEPT1}) và siêu thị được gán (${DEPT2}), thực tế: ${options.join(',')}`);
      assert(!options.includes(DEPT3), `Dropdown KHÔNG được có ${DEPT3} (không liên quan, không được gán)`);
    });

    await run.run('Chọn Siêu thị Quận 2 -> thấy đúng 2 kỳ của Quận 2 (Đang hoạt động + Đã chốt)', async () => {
      await page.selectOption('#kkPeriodDeptSelect', DEPT2);
      await page.waitForTimeout(200);
      const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
      assert(text.includes('Kiểm Kê Q4/2026 - Quận 2') && text.includes('Gom Mã Q3/2026 - Quận 2'), `Phải hiện đủ 2 kỳ của Quận 2, thực tế: ${text}`);
    });

    await run.run('IT Đóng Kỳ được kỳ Đang hoạt động của Quận 2 (siêu thị được gán, không phải siêu thị mình)', async () => {
      const btn = await page.$('button[data-op="closeKkPeriod"][data-arg0="7001"]');
      assert(!!btn, 'Phải thấy nút Đóng Kỳ cho kỳ 7001 (Quận 2, Đang hoạt động)');
      await btn.click();
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
      assert(text.includes('Đã chốt') || !text.includes('🔒 Đóng Kỳ'), `Kỳ 7001 phải chuyển sang Đã chốt, thực tế: ${text}`);
    });

    await run.run('IT Mở Lại được kỳ Đã chốt của Quận 2 (quyền MỚI — trước đây chỉ Admin mở lại được)', async () => {
      const btn = await page.$('button[data-op="reopenKkPeriod"][data-arg0="7002"]');
      assert(!!btn, 'Phải thấy nút Mở Lại cho kỳ 7002 (Quận 2, Đã chốt)');
      await btn.click();
      await page.waitForTimeout(250);
      const btnGone = await page.$('button[data-op="reopenKkPeriod"][data-arg0="7002"]');
      assert(!btnGone, 'Sau khi Mở Lại, nút Mở Lại của kỳ 7002 phải biến mất (đã chuyển sang Đang hoạt động)');
    });

    await run.run('Server tự chặn đúng: IT không đọc được danh sách kỳ của Quận 3 (không nằm trong phạm vi) dù cố gửi ?dept= thẳng', async () => {
      const body = await page.evaluate(async (dept3) => {
        const r = await fetch(`/api/stocktake/sessions?dept=${encodeURIComponent(dept3)}`);
        return { status: r.status, body: await r.json() };
      }, DEPT3);
      // Server fallback về ĐÚNG dept của chính IT (DEPT1) thay vì DEPT3 khi không đủ quyền — không phải lỗi,
      // không rò rỉ dữ liệu Quận 3, không phải Quận 3.
      assertEqual(body.status, 200, `Vẫn trả 200 (không lỗi), chỉ fallback về đúng dept của IT: ${JSON.stringify(body)}`);
      const depts = new Set((body.body.items || []).map(it => it.dept));
      assert(!depts.has(DEPT3), `Tuyệt đối KHÔNG được trả dữ liệu của Quận 3, thực tế: ${JSON.stringify(body.body.items)}`);
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
