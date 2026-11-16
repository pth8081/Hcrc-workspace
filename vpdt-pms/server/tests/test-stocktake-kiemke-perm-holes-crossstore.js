// tests/test-stocktake-kiemke-perm-holes-crossstore.js — Playwright THẬT, VIẾT MỚI ĐỘC LẬP (audit chéo
// trước merge nhánh claude/chao-ban-oo5ijl) — KHÔNG re-run lại 2 test đã có (test-stocktake-crossstore-
// scope-visibility.js / test-stocktake-period-closereopen-scope.js), mà cố tình đào các góc NEGATIVE
// khác chưa test:
//
//   1) kiemKeShelfLockManage {all:false, depts:[B]} dept nhà=A: xác nhận KHÔNG rò rỉ sang 1 siêu thị C
//      HOÀN TOÀN không liên quan (không phải nhà, không trong depts[]) — kiểm qua GET /api/data thật
//      (không chỉ UI) VÀ qua đòn tấn công trực tiếp (gọi thẳng route Khoá, bỏ qua UI) để xác nhận server
//      tự chặn lại, không chỉ dựa vào UI ẩn.
//   2) kiemKePeriodCloseManage {all:true} (KHÔNG có kiemKePeriodReopenManage) KHÔNG mở lại được kỳ đã
//      chốt CỦA CHÍNH SIÊU THỊ NHÀ MÌNH (test cũ test-stocktake-period-closereopen-scope.js chỉ thử ở 1
//      siêu thị KHÔNG phải nhà — ở đây thử đúng siêu thị nhà, vì quyền Đóng Kỳ áp dụng được tới siêu thị
//      nhà không có nghĩa Mở Lại cũng áp dụng được, phải xác nhận KHÔNG lẫn giữa 2 quyền dù app theo
// NHẦM đồng dạng theo trạng thái).
//   4) kiemKeConfirmDo: true (boolean CŨ, tương thích ngược) — xác nhận hành vi y hệt TRƯỚC đợt nâng cấp
//      {all,depts[]}: CHỈ đúng siêu thị nhà, không hề mở rộng sang siêu thị khác dù chuỗi tên trùng với
//      siêu thị khác trong cùng dữ liệu test.
//   5) Admin bypass sanity cho cả 2 tình huống trên (Khoá Quầy Kệ + Mở Lại Kỳ) — admin không bị chặn bởi
//      bất kỳ phạm vi nào.
//
// Chạy: node tests/test-stocktake-kiemke-perm-holes-crossstore.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8951;
  const A = 'CH Quận 7';   // nhà của IT_LOCK / IT_CLOSE_ONLY / IT_LEGACY
  const B = 'CH Quận 8';   // IT_LOCK được gán Khoá/Mở Khoá ở đây
  const C = 'CH Quận 9';   // HOÀN TOÀN không liên quan tới bất kỳ ai trong test này
  const SHELF_A = { id: 201, dept: A, code: 'A1', name: 'Kệ A1', active: true };
  const SHELF_B = { id: 202, dept: B, code: 'B1', name: 'Kệ B1', active: true };
  const SHELF_C = { id: 203, dept: C, code: 'C1', name: 'Kệ C1', active: true };

  const IT_LOCK = {
    username: 'it.lock2', name: 'IT Khoá Quầy Kệ 2', dept: A,
    perms: { kiemKeShelfLockManage: { all: false, depts: [B] } },
    active: true, totpEnabled: true
  };
  const IT_CLOSE_ONLY = {
    username: 'it.closeonly', name: 'IT Chỉ Đóng Kỳ', dept: A,
    perms: { kiemKePeriodCloseManage: { all: true } }, // KHÔNG có kiemKePeriodReopenManage
    active: true, totpEnabled: true
  };
  const IT_LEGACY = {
    username: 'it.legacy', name: 'IT Xác Nhận (cờ cũ)', dept: A,
    perms: { kiemKeConfirmDo: true }, // boolean CŨ, chưa qua admin re-save {all,depts}
    active: true, totpEnabled: true
  };
  const ADMIN = {
    username: 'admin.audit2', name: 'Admin Audit', dept: 'HO',
    perms: { admin: true }, active: true, totpEnabled: true
  };

  const sActiveHomeA = { id: 9101, dept: A, loaiKy: 'THONG_KE', tenKy: 'Kỳ Đang Hoạt Động - Nhà A', trangThai: 'DANG_HOAT_DONG' };
  const sClosedHomeA = { id: 9102, dept: A, loaiKy: 'GOM_MA', tenKy: 'Kỳ Đã Chốt - Nhà A', trangThai: 'DA_CHOT' };
  const sClosedC = { id: 9103, dept: C, loaiKy: 'THONG_KE', tenKy: 'Kỳ Đã Chốt - Quận 9 (admin)', trangThai: 'DA_CHOT' };
  const sActiveB = { id: 9104, dept: B, loaiKy: 'THONG_KE', tenKy: 'Kỳ Đang Hoạt Động - Quận 8 (confirm-all admin)', trangThai: 'DANG_HOAT_DONG' };

  const state = createMockState({
    depts: [A, B, C, 'HO'], stores: [A, B, C],
    users: [IT_LOCK, IT_CLOSE_ONLY, IT_LEGACY, ADMIN],
    kiemKeShelfLocations: [SHELF_A, SHELF_B, SHELF_C],
    stocktakeSessions: [sActiveHomeA, sClosedHomeA, sClosedC, sActiveB]
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
    // ===================== Scenario 1: IT_LOCK — không rò rỉ sang siêu thị C =====================
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, IT_LOCK);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await page.click('#btnKkSubShelfConfig');
    await page.waitForTimeout(200);

    await run.run('[1] Dropdown "Siêu thị:" ở Tab 5 CHỈ có đúng 2 (nhà A + được gán B), KHÔNG có C', async () => {
      const values = await page.evaluate(() => (document.getElementById('kkShelfConfigDeptDropdown')._sddItems || []).map(i => i.value));
      assert(values.includes(A), `Phải có siêu thị nhà ${A}, thực tế: ${values.join(',')}`);
      assert(values.includes(B), `Phải có siêu thị được gán ${B}, thực tế: ${values.join(',')}`);
      assert(!values.includes(C), `KHÔNG được có ${C} (hoàn toàn không liên quan), thực tế: ${values.join(',')}`);
      assertEqual(values.length, 2, `Phải đúng 2 lựa chọn, thực tế: ${values.join(',')}`);
    });

    await run.run('[1] Gõ tên siêu thị C vào ô tìm-kiếm-gõ-chọn KHÔNG chuyển được dept (bị từ chối âm thầm)', async () => {
      const before = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(before.includes('A1'), `Trước khi gõ phải đang xem đúng dept nhà A (thấy A1), thực tế: ${before}`);
      await page.fill('#kkShelfConfigDeptInput', C);
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(!after.includes('C1'), `KHÔNG được chuyển sang xem được quầy kệ C1 của siêu thị C, thực tế: ${after}`);
    });

    await run.run('[1] GET /api/data thật: kiemKeShelfLocations CHỈ gồm dept A+B, KHÔNG có bản ghi dept C nào', async () => {
      const data = await page.evaluate(async () => (await fetch('/api/data')).json());
      const depts = new Set((data.kiemKeShelfLocations || []).map(l => l.dept));
      assert(depts.has(A) && depts.has(B), `Phải thấy quầy kệ dept A và B qua API thật, thực tế depts: ${[...depts].join(',')}`);
      assert(!depts.has(C), `KHÔNG được lộ bất kỳ quầy kệ dept ${C} nào qua GET /api/data, thực tế depts: ${[...depts].join(',')}`);
    });

    await run.run('[1] Tấn công trực tiếp (bỏ qua UI): POST /shelf-locations/lock cho quầy kệ dept C bị chặn 403, KHÔNG bị khoá', async () => {
      const res = await page.evaluate(async (shelfId) => {
        const r = await fetch('/api/stocktake/shelf-locations/lock', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shelfLocationIds: [shelfId] })
        });
        return { status: r.status, body: await r.json() };
      }, SHELF_C.id);
      assertEqual(res.status, 403, `Server phải chặn 403 khi IT_LOCK cố khoá quầy kệ dept C (ngoài phạm vi), thực tế: ${JSON.stringify(res)}`);
      assert(!SHELF_C.kiemKeLocked, 'Quầy kệ dept C KHÔNG được bị khoá sau đòn tấn công trực tiếp');
    });

    await run.run('[1] Nhưng vẫn khoá được THẬT quầy kệ dept B (được gán rõ) qua đúng route', async () => {
      const res = await page.evaluate(async (shelfId) => {
        const r = await fetch('/api/stocktake/shelf-locations/lock', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shelfLocationIds: [shelfId] })
        });
        return { status: r.status, body: await r.json() };
      }, SHELF_B.id);
      assertEqual(res.status, 200, `Phải khoá được quầy kệ dept B (được gán rõ), thực tế: ${JSON.stringify(res)}`);
      assert(SHELF_B.kiemKeLocked === true || (res.body.items && res.body.items[0] && res.body.items[0].kiemKeLocked), 'Quầy kệ B phải chuyển sang kiemKeLocked=true');
    });

    // ===================== Scenario 2: IT_CLOSE_ONLY — Đóng Kỳ {all:true} nhưng KHÔNG Mở Lại được, NGAY
    // CẢ kỳ đã chốt của chính siêu thị NHÀ mình (khác test cũ chỉ thử ở siêu thị khác) =====================
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, IT_CLOSE_ONLY);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    await run.run('[2] IT_CLOSE_ONLY đóng được kỳ Đang hoạt động CỦA CHÍNH SIÊU THỊ NHÀ (sanity — quyền Đóng Kỳ hoạt động thật)', async () => {
      const options = await page.evaluate(() => Array.from(document.getElementById('kkPeriodDeptSelect').options).map(o => o.value));
      assert(options.includes(A), `Dropdown phải có siêu thị nhà ${A}, thực tế: ${options.join(',')}`);
      await page.selectOption('#kkPeriodDeptSelect', A);
      await page.waitForTimeout(200);
      const btn = await page.$(`button[data-op="closeKkPeriod"][data-arg0="${sActiveHomeA.id}"]`);
      assert(!!btn, `Phải thấy nút Đóng Kỳ cho kỳ ${sActiveHomeA.id} (nhà A, Đang hoạt động)`);
      await btn.click();
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
      assert(text.includes('Đã chốt'), `Kỳ ${sActiveHomeA.id} phải chuyển sang Đã chốt, thực tế: ${text}`);
    });

    await run.run('[2] IT_CLOSE_ONLY KHÔNG thấy VÀ KHÔNG mở lại được kỳ Đã chốt CỦA CHÍNH SIÊU THỊ NHÀ (chưa có kiemKePeriodReopenManage)', async () => {
      const btn = await page.$(`button[data-op="reopenKkPeriod"][data-arg0="${sClosedHomeA.id}"]`);
      assert(!btn, `KHÔNG được thấy nút Mở Lại cho kỳ ${sClosedHomeA.id} dù là siêu thị NHÀ của chính IT_CLOSE_ONLY`);
      const res = await page.evaluate(async (id) => {
        const r = await fetch(`/api/stocktake/sessions/${id}/reopen`, { method: 'POST' });
        return { status: r.status, body: await r.json() };
      }, sClosedHomeA.id);
      assertEqual(res.status, 403, `Server phải chặn 403 khi IT_CLOSE_ONLY cố Mở Lại kỳ nhà mình (chỉ có Đóng Kỳ, không có Mở Lại), thực tế: ${JSON.stringify(res)}`);
      assertEqual(sClosedHomeA.trangThai, 'DA_CHOT', 'Trạng thái kỳ KHÔNG được đổi sau đòn tấn công trực tiếp');
    });

    // ===================== Scenario 4: kiemKeConfirmDo:true (cờ CŨ) — tương thích ngược, CHỈ siêu thị
    // nhà, dù dữ liệu test có sẵn siêu thị khác tên khác (B, C) =====================
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, IT_LEGACY);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    await run.run('[4] kiemKeConfirmDo:true (cờ cũ) -> kkSelectableDepts CHỈ có đúng 1 siêu thị (nhà), không mở rộng', async () => {
      const hasDropdown = await page.evaluate(() => !!document.getElementById('kkPeriodDeptSelect'));
      assert(!hasDropdown, 'KHÔNG được hiện dropdown chọn siêu thị — cờ cũ true KHÔNG có phạm vi {all,depts} nào để mở rộng ra ngoài siêu thị nhà');
      const label = await page.evaluate(() => document.getElementById('kkPeriodDeptRow').textContent);
      assert(label.includes(A), `Phải hiện đúng tên siêu thị nhà ${A}, thực tế: ${label}`);
    });

    await run.run('[4] GET /sessions?dept=<siêu thị khác> bị server ÂM THẦM bỏ qua, trả về đúng kỳ của siêu thị NHÀ (không lộ/không đổi)', async () => {
      const data = await page.evaluate(async (otherDept) => (await fetch(`/api/stocktake/sessions?dept=${encodeURIComponent(otherDept)}`)).json(), B);
      const depts = new Set((data.items || []).map(s => s.dept));
      assert(!depts.has(B), `KHÔNG được trả kỳ của dept ${B} dù query ?dept= yêu cầu, thực tế depts: ${[...depts].join(',')}`);
      (data.items || []).forEach(s => assertEqual(s.dept, A, `Mọi kỳ trả về phải đúng dept nhà ${A}, thực tế gặp ${s.dept}`));
    });

    await run.run('[4] Tấn công trực tiếp: POST confirm-all cho kỳ CỦA SIÊU THỊ KHÁC (B) bị chặn 403 dù cờ Xác Nhận đang true', async () => {
      const res = await page.evaluate(async (id) => {
        const r = await fetch(`/api/stocktake/sessions/${id}/confirm-all`, { method: 'POST' });
        return { status: r.status, body: await r.json() };
      }, sActiveB.id);
      assertEqual(res.status, 403, `Server phải chặn 403 — kiemKeConfirmDo:true (cờ cũ) không mở rộng ra siêu thị khác, thực tế: ${JSON.stringify(res)}`);
      assertEqual(sActiveB.trangThai, 'DANG_HOAT_DONG', 'Kỳ dept B KHÔNG được bị đóng sau đòn tấn công trực tiếp của IT_LEGACY');
    });

    await run.run('[4] Gọi THẲNG hàm thật canConfirmStocktakeForDept() (lib/stocktakeEngine.js, không tự đoán lại) xác nhận ĐÚNG 3 trường hợp', () => {
      const { canConfirmStocktakeForDept } = require('../lib/stocktakeEngine');
      assert(canConfirmStocktakeForDept(IT_LEGACY, A) === true, `Phải TRUE cho đúng siêu thị nhà ${A}`);
      assert(canConfirmStocktakeForDept(IT_LEGACY, B) === false, `Phải FALSE cho siêu thị khác ${B}`);
      assert(canConfirmStocktakeForDept(IT_LEGACY, C) === false, `Phải FALSE cho siêu thị khác ${C}`);
    });

    // ===================== Scenario 5: Admin bypass sanity — admin không bị chặn bởi BẤT KỲ phạm vi nào
    // ở cả 2 nhóm quyền trên (Khoá Quầy Kệ dept C, Mở Lại Kỳ dept C) =====================
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    await run.run('[5] Admin khoá được THẬT quầy kệ dept C (siêu thị hoàn toàn không liên quan tới bất kỳ phạm vi nào)', async () => {
      const res = await page.evaluate(async (shelfId) => {
        const r = await fetch('/api/stocktake/shelf-locations/lock', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shelfLocationIds: [shelfId] })
        });
        return { status: r.status, body: await r.json() };
      }, SHELF_C.id);
      assertEqual(res.status, 200, `Admin phải khoá được quầy kệ dept C không giới hạn, thực tế: ${JSON.stringify(res)}`);
    });

    await run.run('[5] Admin Mở Lại được THẬT kỳ Đã chốt của dept C (không cần kiemKePeriodReopenManage)', async () => {
      await page.selectOption('#kkPeriodDeptSelect', C);
      await page.waitForTimeout(200);
      const btn = await page.$(`button[data-op="reopenKkPeriod"][data-arg0="${sClosedC.id}"]`);
      assert(!!btn, `Admin phải thấy nút Mở Lại cho kỳ ${sClosedC.id} (dept C)`);
      await btn.click();
      await page.waitForTimeout(250);
      assertEqual(sClosedC.trangThai, 'DANG_HOAT_DONG', `Kỳ dept C phải chuyển sang Đang hoạt động sau khi Admin Mở Lại, thực tế: ${sClosedC.trangThai}`);
    });

    await run.run('[5] Admin Xác Nhận Toàn Bộ Đợt được kỳ dept B (confirm-all, không cần kiemKeConfirmDo nào)', async () => {
      const res = await page.evaluate(async (id) => {
        const r = await fetch(`/api/stocktake/sessions/${id}/confirm-all`, { method: 'POST' });
        return { status: r.status, body: await r.json() };
      }, sActiveB.id);
      assertEqual(res.status, 200, `Admin phải Xác Nhận Toàn Bộ Đợt được dept B không giới hạn, thực tế: ${JSON.stringify(res)}`);
      assertEqual(sActiveB.trangThai, 'DA_CHOT', 'Kỳ dept B phải chuyển sang Đã chốt sau khi Admin Xác Nhận Toàn Bộ Đợt');
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
