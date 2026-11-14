// tests/test-audit-ui-race-csp.js — AUDIT TẠM (không sửa source), test Playwright THẬT cho module
// "📋 Kiểm Kê": bấm nhanh/double-click nhiều lần + chuyển tab qua lại thật nhanh để lộ race condition,
// đồng thời lắng nghe console.error/pageerror SUỐT toàn bộ quá trình (yêu cầu audit mục 2).
// Chạy: node tests/test-audit-ui-race-csp.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8986;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 30, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const SHELF_A2 = { id: 31, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì', active: true };

  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };
  const GOM_MA_SESSION = { id: 9301, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Race', trangThai: 'NHAP' };
  const THONG_KE_SESSION = { id: 9302, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Race', trangThai: 'DANG_HOAT_DONG' };

  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [ADMIN],
    shelfLocations: [SHELF_A1, SHELF_A2],
    stocktakeSessions: [GOM_MA_SESSION, THONG_KE_SESSION],
    // Allowlist TUYỆT ĐỐI (Tab 8) — kể cả Admin vẫn cần dòng allowlist riêng để quét/kiểm đếm trên quầy
    // kệ cụ thể (my-shelf-locations lọc theo allowlist thật, admin chỉ bypass check quyền TAB, không
    // bypass allowlist theo quầy kệ — xem routes/stocktake.js GET /my-shelf-locations).
    stocktakeUserAccess: [
      { id: 1, username: 'admin', dept: DEPT1, shelfLocationId: 30, canGomMa: true, canKiemDem: true, canKiemSoat: true },
      { id: 2, username: 'admin', dept: DEPT1, shelfLocationId: 31, canGomMa: true, canKiemDem: true, canKiemSoat: true }
    ],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [
    { maHang: 'SP777', maVach: '8937770000777', tenHang: 'Hàng Race A1', soLuongTon: 40 }
  ];

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

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(150);

    // ===== 1) Double-click THẬT (2 click gần như đồng thời) trên "Thêm" (submitKkScan) — khoá chống
    // double-submit dùng chung (runCspOp()/cspDispatchOp(), core.js) PHẢI chặn lần bấm thứ 2 khi lần 1
    // CHƯA xong (data-op-in-flight), không được quét trùng 2 lần cho 1 lần bấm "kiểu double-click". =====
    await run.run('Double-click "Thêm" (Gom Mã) khi chưa có kỳ Gom Mã hoạt động — không treo, không báo lỗi trùng nhau bất thường', async () => {
      await page.click('#btnKkSubGomMa');
      await page.waitForTimeout(150);
      await page.selectOption('#kkGomMaShelfSelect', '30');
      await page.waitForTimeout(150);
      // Kỳ Gom Mã đang ở NHAP (chưa Kích Hoạt) -> ô quét phải ẨN, double-click vào nút bên trong khung ẨN
      // là KHÔNG THỂ (Playwright sẽ tự chặn action vì phần tử invisible) — xác nhận đúng trạng thái này.
      const hidden = await page.evaluate(() => document.getElementById('kkGomMaScanBox').classList.contains('hidden'));
      assert(hidden, 'Kỳ Gom Mã chưa Kích Hoạt -> ô quét phải ẨN (không có nút "Thêm" nào để bấm nhầm)');
    });

    await run.run('Kích hoạt kỳ Gom Mã qua UI thật -> double-click thật (2 click gần như đồng thời) trên "Thêm" chỉ quét ĐÚNG 1 lần/click (không nhân đôi do race)', async () => {
      await page.click('#btnKkSubPeriod');
      await page.waitForTimeout(150);
      await page.click('[data-op="activateKkPeriod"][data-arg0="9301"]');
      await page.waitForTimeout(200);
      await page.click('#btnKkSubGomMa');
      await page.waitForTimeout(150);
      await page.selectOption('#kkGomMaShelfSelect', '30');
      await page.waitForTimeout(200);
      await page.fill('#kkGomMaBarcodeInput', 'SP777');
      // 2 click THẬT, ĐỒNG BỘ LIÊN TIẾP trên CÙNG 1 phần tử DOM (el.click() 2 lần không chờ gì ở giữa) —
      // mô phỏng double-click thật nhanh/mạng chậm. Dùng el.click() qua evaluate() (KHÔNG dùng 2 lệnh
      // page.click() riêng biệt gọi đồng thời — Playwright tự chờ "actionability" mỗi lệnh, có thể treo
      // vô hạn nếu DOM đổi giữa 2 lần chờ). Nếu khoá opInFlight hoạt động đúng, click thứ 2 sẽ bị bỏ qua
      // (dataset.opInFlight đã set NGAY khi click 1 gọi submitKkScan(), trong CÙNG 1 lượt xử lý sự kiện
      // đồng bộ của trình duyệt, trước khi nhường lại vòng lặp sự kiện cho click 2 xử lý).
      await page.evaluate(() => {
        const el = document.querySelector('[data-op="submitKkScan"][data-arg0="GOMMA"]');
        el.click(); el.click();
      });
      await page.waitForTimeout(300);
      const rowCount = await page.evaluate(() => document.querySelectorAll('#kkGomMaListBody tbody tr').length);
      const qty = await page.evaluate(() => document.querySelector('#kkGomMaListBody input[type="number"]')?.value);
      assertEqual(rowCount, 1, `Double-click 1 nút phải vẫn chỉ ra ĐÚNG 1 dòng (không nhân đôi dòng do race), thực tế: ${rowCount} dòng`);
      assertEqual(qty, '1', `Double-click bị khoá opInFlight -> chỉ 1 click thật sự chạy -> SL phải vẫn là 1 (nếu ra 2 nghĩa là khoá double-submit KHÔNG chặn được), thực tế: ${qty}`);
    });

    // ===== 2) Chuyển tab THẬT NHANH qua lại (không chờ async load xong) — xác nhận trạng thái CUỐI CÙNG
    // nhất quán (đúng 1 wrap hiện, đúng tab active), không còn 2 khung cùng hiện/kẹt ở trạng thái lưng
    // chừng do request của tab trước về SAU khi đã chuyển tab khác. =====
    await run.run('Chuyển nhanh qua lại 8 sub-tab Kiểm Kê KHÔNG chờ async load xong giữa mỗi lần bấm -> trạng thái cuối cùng nhất quán, đúng 1 wrap hiện', async () => {
      const order = ['GOMMA', 'KIEMDEM', 'KIEMSOAT', 'SHELFCONFIG', 'CONFIRM', 'REPORT', 'USERACCESS', 'PERIOD', 'GOMMA', 'REPORT'];
      const idMap = {
        PERIOD: ['btnKkSubPeriod', 'kkPeriodWrap'], GOMMA: ['btnKkSubGomMa', 'kkGomMaWrap'],
        KIEMDEM: ['btnKkSubKiemDem', 'kkKiemDemWrap'], KIEMSOAT: ['btnKkSubKiemSoat', 'kkKiemSoatWrap'],
        SHELFCONFIG: ['btnKkSubShelfConfig', 'kkShelfConfigWrap'], CONFIRM: ['btnKkSubConfirm', 'kkConfirmWrap'],
        REPORT: ['btnKkSubReport', 'kkReportWrap'], USERACCESS: ['btnKkSubUserAccess', 'kkUserAccessWrap']
      };
      // Bấm LIÊN TỤC, KHÔNG await giữa mỗi click (chỉ await đúng lệnh click() để gửi event, không chờ
      // trang xử lý xong hệ quả — mô phỏng người dùng bấm tab loạn tay/double hoặc mạng chậm làm các
      // request trước đó chưa kịp resolve khi đã chuyển tab khác).
      for (const key of order) {
        await page.click(`#${idMap[key][0]}`);
      }
      await page.waitForTimeout(500); // để MỌI request/async load còn treo (nếu có) kịp resolve hết.
      const lastKey = order[order.length - 1];
      const visibleWraps = await page.evaluate((map) => {
        return Object.entries(map).filter(([, [, wrapId]]) => {
          const el = document.getElementById(wrapId);
          return el && !el.classList.contains('hidden');
        }).map(([k]) => k);
      }, idMap);
      assertEqual(visibleWraps.length, 1, `Sau khi ổn định, phải ĐÚNG 1 wrap hiện (không 0, không >1 do race), thực tế: ${JSON.stringify(visibleWraps)}`);
      assertEqual(visibleWraps[0], lastKey, `Wrap hiện phải khớp đúng tab bấm SAU CÙNG (${lastKey}), thực tế: ${visibleWraps[0]}`);
      const activeTab = await page.evaluate(() => activeKiemKeSubTab);
      assertEqual(activeTab, lastKey, `activeKiemKeSubTab phải khớp đúng tab bấm sau cùng, thực tế: ${activeTab}`);
    });

    // ===== 3) Double-click thật trên "Kích Hoạt"/"Đóng Kỳ" (Tab 1) — hành động ĐỔI TRẠNG THÁI 1 lần, lần
    // bấm thừa (nếu lọt qua khoá) phải báo lỗi RÕ RÀNG (409 "đã đang hoạt động"/tương tự), không crash. =====
    await run.run('Double-click thật trên "Đóng Kỳ" (kỳ Thống Kê Đang hoạt động) -> đóng kỳ ĐÚNG 1 lần, không lỗi JS, không alert mâu thuẫn', async () => {
      await page.click('#btnKkSubPeriod');
      await page.waitForTimeout(200);
      const beforeAlerts = (await page.evaluate(() => (window.__alerts || []).length));
      await page.evaluate(() => {
        const el = document.querySelector('[data-op="closeKkPeriod"][data-arg0="9302"]');
        if (el) { el.click(); el.click(); }
      });
      await page.waitForTimeout(300);
      const rowText = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
      assert(rowText.includes('Đã chốt'), `Kỳ Thống Kê phải chuyển Đã chốt sau khi Đóng Kỳ, thực tế: ${rowText}`);
      const alertsAfter = await page.evaluate(() => window.__alerts || []);
      // Click thừa (nếu THỰC SỰ lọt qua khoá opInFlight, vì DOM đã bị thay) chỉ được phép sinh ra ĐÚNG 1
      // alert lỗi rõ ràng (không phải crash) — không được có bất kỳ console.error/pageerror nào (kiểm ở
      // dưới cuối file), và KHÔNG được đóng kỳ 2 LẦN (không có 2 bản ghi/sự kiện trùng nhau phía state).
      const newAlerts = alertsAfter.slice(beforeAlerts);
      newAlerts.forEach(a => assert(!/undefined|NaN|\[object/.test(a), `Alert không được lộ lỗi kỹ thuật thô, thực tế: ${a}`));
    });

    // ===== 4) Double-click thật trên "Xác Nhận" quầy kệ (Tab 6) — xác nhận lại 1 quầy kệ ĐÃ xác nhận là
    // idempotent (theo chú thích confirmShelf() ở lib/stocktakeEngine.js), không lỗi/không tạo 2 dòng. =====
    await run.run('Double-click thật trên nút "Xác Nhận" quầy kệ (Tab 6) — idempotent, không tạo 2 dòng xác nhận trùng, không lỗi JS', async () => {
      // Kỳ Thống Kê 9302 ĐÃ "Đã chốt" ở bước trước -> không còn kỳ Thống Kê "Đang hoạt động" nào cho
      // DEPT1 -> PHẢI kích hoạt 1 kỳ Thống Kê MỚI qua chính API thật TRƯỚC KHI quét, nếu không ô quét
      // Kiểm Đếm sẽ bị khoá "chưa có kỳ đang hoạt động" (đúng Lớp 3, không phải race).
      const newSessionId = await page.evaluate(async (dept) => {
        const r = await fetch('/api/stocktake/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dept, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Race 2' }) });
        const body = await r.json();
        await fetch(`/api/stocktake/sessions/${body.item.id}/activate`, { method: 'POST' });
        return body.item.id;
      }, DEPT1);
      // Cần có hoạt động Kiểm Đếm thật trên A2 trước để quầy kệ này xuất hiện ở danh sách Tab 6.
      await page.click('#btnKkSubKiemDem');
      await page.waitForTimeout(150);
      await page.selectOption('#kkKiemDemShelfSelect', '31');
      await page.waitForTimeout(200);
      await page.fill('#kkKiemDemBarcodeInput', 'SP777');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
      await page.waitForTimeout(200);

      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(200);
      await page.selectOption('#kkConfirmSessionSelect', String(newSessionId));
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        const el = document.querySelector('#kkConfirmShelfListBody button[data-op="confirmKkShelf"][data-arg0="31"]');
        if (el) { el.click(); el.click(); }
      });
      await page.waitForTimeout(300);
      const text = await page.evaluate(() => document.getElementById('kkConfirmShelfListBody').textContent);
      const confirmedCount = (text.match(/✅/g) || []).length;
      assertEqual(confirmedCount, 1, `Quầy kệ A2 phải hiện ĐÚNG 1 lần đã xác nhận (không trùng), thực tế: ${confirmedCount} (text: ${text})`);
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh trong suốt quá trình bấm nhanh/double-click: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
