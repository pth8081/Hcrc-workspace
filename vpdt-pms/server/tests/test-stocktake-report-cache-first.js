// tests/test-stocktake-report-cache-first.js — test Playwright THẬT cho cache-first ở Tab 7 "📊 Báo Cáo"
// CỦA KIỂM KÊ (MỚI, 12/2026, theo yêu cầu TRỰC TIẾP người dùng: "tôi cần cái này để có báo cáo nhanh").
// CÙNG nguyên lý cache-first đã có ở Tồn Kho/Đối Chiếu/Báo Cáo của Kiểm Soát Hàng Hóa — xem
// loadKkReportTab()/kkOfflineReportCache (module-vanhanh.js). Chạy: node tests/test-stocktake-report-cache-first.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8999;
  const DEPT1 = 'Siêu thị Quận 1';
  const MANAGER = { username: 'qlA', name: 'Quản Lý A', dept: DEPT1, perms: { kiemKeReportView: true }, active: true, totpEnabled: true };
  const SESSION1 = { id: 9201, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const SESSION2 = { id: 9202, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const TRANG_THAI_LABEL_VN = { NHAP: 'Nháp', DANG_HOAT_DONG: 'Đang hoạt động', DA_CHOT: 'Đã chốt' };
  const kkReportLabel = (s) => `${s.loaiKy === 'GOM_MA' ? '📷 Gom Mã' : '🔢 Kiểm Kê'} — ${s.dept} — ${s.tenKy} (${TRANG_THAI_LABEL_VN[s.trangThai] || s.trangThai})`;
  const SESSION1_LABEL = kkReportLabel(SESSION1);
  const SESSION2_LABEL = kkReportLabel(SESSION2);

  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [MANAGER],
    kiemKeShelfLocations: [{ id: 50, dept: DEPT1, code: 'A1', name: 'Kệ A1', active: true }],
    stocktakeSessions: [SESSION1, SESSION2],
    stocktakeCounts: [
      { id: 1, sessionId: SESSION1.id, dept: DEPT1, shelfLocationId: 50, maHang: 'SP001', tenHang: 'Hàng A1', slGomMa: 0, slKiemDem: 48 },
      { id: 2, sessionId: SESSION2.id, dept: DEPT1, shelfLocationId: 50, maHang: 'SP002', tenHang: 'Hàng A2', slGomMa: 20, slKiemDem: 0 }
    ]
  });
  state.__mockStocktakeReportInventoryByDept = { [DEPT1]: [{ maHang: 'SP001', tenHang: 'Hàng A1', soLuongTon: 50 }, { maHang: 'SP002', tenHang: 'Hàng A2', soLuongTon: 30 }] };

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

  const goOffline = () => page.evaluate(() => { window.__origFetch = window.fetch; window.fetch = () => { throw new TypeError('Failed to fetch'); }; });
  const goOnline = () => page.evaluate(() => { if (window.__origFetch) { window.fetch = window.__origFetch; delete window.__origFetch; } });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);
    await page.click('#btnKkSubReport');
    await page.waitForTimeout(150);

    await page.fill('#kkReportSessionInput', SESSION1_LABEL);
    await page.waitForTimeout(250);
    await run.run('Lần đầu chọn Kỳ 1 -> gọi mạng, hiện đúng dữ liệu', async () => {
      const text = await page.evaluate(() => document.getElementById('kkReportBody')?.textContent || '');
      assert(text.includes('SP001'), `Phải hiện SP001, thực tế: ${text}`);
    });

    await run.run('Cache-first: chọn lại Kỳ 1 lần 2 dù mạng CHẬM (giả lập trễ 3s) -> hiện NGAY dữ liệu cache', async () => {
      await page.evaluate(() => {
        window.__origFetchSlow = window.fetch;
        window.fetch = (url, opts) => {
          if (String(url).includes('/api/stocktake/report')) {
            return new Promise((resolve) => setTimeout(() => resolve(window.__origFetchSlow(url, opts)), 3000));
          }
          return window.__origFetchSlow(url, opts);
        };
      });
      // Đổi qua Kỳ 2 rồi quay lại Kỳ 1 để buộc loadKkReportTab() chạy lại (chọn lại ĐÚNG label hiện tại
      // sẽ bị bỏ qua, xem onKkReportSessionInputChanged()).
      await page.fill('#kkReportSessionInput', SESSION2_LABEL);
      await page.waitForTimeout(100);
      await page.fill('#kkReportSessionInput', SESSION1_LABEL);
      // CHỈ chờ 150ms (KHÔNG đủ để lượt fetch 3s trả lời) rồi kiểm tra NGAY.
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkReportBody')?.textContent || '');
      assert(text.includes('SP001'), `Phải hiện NGAY dữ liệu cache (SP001) trước khi mạng chậm trả lời -- got: ${text}`);
      await page.evaluate(() => { window.fetch = window.__origFetchSlow; });
      await page.waitForTimeout(3200);
      await page.evaluate(() => { delete window.__origFetchSlow; });
    });

    await run.run('Đổi sang Kỳ 2 (CHƯA có cache đúng tổ hợp) -> KHÔNG hiện nhầm số liệu của Kỳ 1', async () => {
      await page.fill('#kkReportSessionInput', SESSION2_LABEL);
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkReportBody')?.textContent || '');
      assert(text.includes('SP002'), `Phải hiện đúng dữ liệu Kỳ 2 (SP002), thực tế: ${text}`);
    });

    await page.fill('#kkReportSessionInput', SESSION1_LABEL);
    await page.waitForTimeout(250);
    await goOffline();
    await page.fill('#kkReportSessionInput', SESSION2_LABEL);
    await page.waitForTimeout(100);
    await page.fill('#kkReportSessionInput', SESSION1_LABEL);
    await page.waitForTimeout(300);
    await run.run('Mất mạng (TypeError) -> fallback đúng cache Kỳ 1 lần xem gần nhất, hiện banner ngoại tuyến', async () => {
      const offlineNote = await page.evaluate(() => document.getElementById('kkReportOfflineNote')?.textContent || '');
      assert(offlineNote.includes('Ngoại tuyến'), `Phải hiện banner ngoại tuyến, thực tế: ${offlineNote}`);
      const text = await page.evaluate(() => document.getElementById('kkReportBody')?.textContent || '');
      assert(text.includes('SP001'), `Offline vẫn phải hiện dữ liệu cache Kỳ 1 (SP001), thực tế: ${text}`);
    });
    await goOnline();

    await run.run('Không có lỗi JS/console nào phát sinh', async () => {
      assert(jsErrors.length === 0, 'Lỗi JS: ' + jsErrors.join(' | '));
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
