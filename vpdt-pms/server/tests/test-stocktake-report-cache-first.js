// tests/test-stocktake-report-cache-first.js — test Playwright THẬT cho tab 7 "📊 Báo Cáo" CỦA KIỂM KÊ
// (module-vanhanh.js::loadKkReportTab()). ĐỔI LẠI (12/2026, theo yêu cầu TRỰC TIẾP người dùng "cache
// không sử dụng vào mục đích nào thì báo cáo không cần cache... lúc nào lấy báo cáo thì mới lấy từ cơ sở
// dữ liệu xuống" — xác nhận giữ fallback khi MẤT MẠNG THẬT): file này TRƯỚC ĐÂY kiểm hành vi "cache-first"
// (hiện số cũ NGAY trước khi gọi mạng) — hành vi đó đã bị GỠ BỎ hoàn toàn. Nay kiểm ĐÚNG hành vi MỚI:
// luôn gọi thẳng CSDL mỗi khi mở tab/đổi Kỳ (không hiện số cũ đón đầu), CHỈ dùng cache gần nhất làm dự
// phòng khi gọi mạng thất bại THẬT (TypeError), và lỗi nghiệp vụ khác thì KHÔNG dùng cache che lỗi.
// Chạy: node tests/test-stocktake-report-cache-first.js
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

    // LUÔN GỌI MẠNG LẠI — KHÔNG còn "cache-first" (MỚI, 12/2026): chọn lại ĐÚNG Kỳ đã xem trước đó,
    // nhưng mạng CHẬM (giả lập trễ 3s) -> PHẢI chờ, KHÔNG được hiện ngay số liệu cũ trong lúc chờ.
    await run.run('KHÔNG còn cache-first: chọn lại Kỳ 1 lần 2 khi mạng CHẬM (giả lập trễ 3s) -> KHÔNG hiện số cũ trong lúc chờ, bảng vẫn ẩn + đang tải', async () => {
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
      // CHỈ chờ 150ms (KHÔNG đủ để lượt fetch 3s trả lời) rồi kiểm tra NGAY — đúng hành vi MỚI: bảng
      // phải ẨN + ghi chú "Đang tải", KHÔNG hiện nhầm dữ liệu cũ của lượt xem trước (dù cùng Kỳ 1).
      await page.waitForTimeout(150);
      const emptyNote = await page.evaluate(() => document.getElementById('kkReportEmptyNote')?.textContent || '');
      const bodyHidden = await page.evaluate(() => document.getElementById('kkReportBody')?.classList.contains('hidden'));
      assert(emptyNote.includes('Đang tải'), `Phải hiện "Đang tải báo cáo..." trong lúc chờ, thực tế: ${emptyNote}`);
      assert(bodyHidden === true, 'Bảng kết quả phải ẨN trong lúc đang tải, không hiện nhầm số cũ');
      // Chờ lượt fetch chậm trả lời xong rồi mới xác nhận hiện đúng dữ liệu MỚI.
      await page.evaluate(() => { window.fetch = window.__origFetchSlow; });
      await page.waitForTimeout(3200);
      const textAfter = await page.evaluate(() => document.getElementById('kkReportBody')?.textContent || '');
      assert(textAfter.includes('SP001'), `Sau khi mạng trả lời xong phải hiện đúng dữ liệu (SP001), thực tế: ${textAfter}`);
      await page.evaluate(() => { delete window.__origFetchSlow; });
    });

    await run.run('Đổi sang Kỳ 2 -> hiện đúng dữ liệu Kỳ 2, không lẫn Kỳ 1', async () => {
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
    await run.run('Mất mạng THẬT (TypeError) -> fallback đúng cache Kỳ 1 lần xem gần nhất, hiện banner ngoại tuyến', async () => {
      const offlineNote = await page.evaluate(() => document.getElementById('kkReportOfflineNote')?.textContent || '');
      assert(offlineNote.includes('Ngoại tuyến'), `Phải hiện banner ngoại tuyến, thực tế: ${offlineNote}`);
      const text = await page.evaluate(() => document.getElementById('kkReportBody')?.textContent || '');
      assert(text.includes('SP001'), `Offline vẫn phải hiện dữ liệu cache Kỳ 1 (SP001), thực tế: ${text}`);
    });
    await goOnline();

    // LỖI NGHIỆP VỤ (không phải mất mạng) -> KHÔNG được dùng cache che lỗi (MỚI, 12/2026) — mô phỏng 1
    // lỗi nghiệp vụ thật (403 giả lập) ngay cả khi ĐÃ có cache Kỳ 1 hợp lệ từ các bước trên.
    await run.run('Lỗi nghiệp vụ thật (không phải mất mạng) -> LUÔN báo đúng lỗi, KHÔNG âm thầm giữ nguyên số cache cũ', async () => {
      await page.evaluate(() => {
        window.__origFetchBiz = window.fetch;
        window.fetch = (url, opts) => {
          if (String(url).includes('/api/stocktake/report')) {
            return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'Mô phỏng lỗi nghiệp vụ (quyền vừa bị thu hồi)' }) });
          }
          return window.__origFetchBiz(url, opts);
        };
      });
      await page.fill('#kkReportSessionInput', SESSION2_LABEL);
      await page.waitForTimeout(100);
      await page.fill('#kkReportSessionInput', SESSION1_LABEL);
      await page.waitForTimeout(250);
      const emptyNote = await page.evaluate(() => document.getElementById('kkReportEmptyNote')?.textContent || '');
      assert(emptyNote.includes('Mô phỏng lỗi nghiệp vụ'), `Phải hiện đúng lỗi nghiệp vụ thật, thực tế: ${emptyNote}`);
      const bodyHidden = await page.evaluate(() => document.getElementById('kkReportBody')?.classList.contains('hidden'));
      assert(bodyHidden === true, 'Lỗi nghiệp vụ -> bảng phải ẨN, KHÔNG âm thầm hiện số cache cũ của Kỳ 1');
      await page.evaluate(() => { window.fetch = window.__origFetchBiz; delete window.__origFetchBiz; });
    });

    // Khôi phục lại dữ liệu đúng cho test cuối (không có lỗi JS) đọc DOM ổn định.
    await page.fill('#kkReportSessionInput', SESSION1_LABEL);
    await page.waitForTimeout(250);

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
