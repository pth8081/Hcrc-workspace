// server/tests/test-multi-paste-search.js
//
// Test cho tính năng "dán nhiều mã cùng lúc vào ô tìm kiếm" (10/2026, yêu cầu người dùng: "copy nhiều
// dòng mã từ Excel, dán vào ô tìm kiếm, tự động tách ra và lọc theo tất cả các mã đó").
//
// Phát hiện quan trọng khi làm tính năng này (xác minh bằng Playwright thật, xem
// scratchpad/demo/paste-test2.js): dán nhiều dòng vào <input type="text"> 1 dòng khiến Chrome tự NỐI
// các dòng bằng dấu CÁCH (không giữ \n) — nên core.js:bindMultiPasteSearchInputs() phải đọc
// event.clipboardData THÔ ngay lúc bắt sự kiện 'paste' (còn nguyên \n), lưu mảng từ khoá vào
// el._multiKeywords, KHÔNG suy luận lại từ input.value sau khi dán.
//
// Rủi ro chính cần test: tính năng mới không được đổi hành vi GÕ TAY cũ (so khớp substring cả cụm,
// kể cả cụm có khoảng trắng như tên người "Nguyễn Văn A") — chỉ có PASTE nhiều dòng/dấu phẩy mới kích
// hoạt chế độ khớp-OR-nhiều-mã. Test cả 2 module đại diện: Vận Hành (module đầu tiên nối dây) và
// Người Dùng (module NHẠY CẢM NHẤT theo yêu cầu người dùng — phải xác nhận filterUserKeyword hiện vẫn
// chỉ là bộ lọc HIỂN THỊ danh sách, không đụng gì tới logic tạo/sửa/import user).
'use strict';
const { startStaticServer, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const server = await startStaticServer();
  const port = server.address().port;
  const { browser, page } = await launchPage(port, {});
  // launchPage() dùng browser.newPage() (context mặc định, chưa cấp quyền clipboard) — cấp quyền
  // clipboard-read/write ở ĐÂY để page.keyboard.press('Control+V') đọc được navigator.clipboard.writeText()
  // đã ghi, mô phỏng đúng thao tác dán thật của người dùng (không phải giả lập ClipboardEvent tổng hợp).
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const run = createRunner();

  try {
    // ===== Phần A: test thuần hàm (splitMultiKeyword/matchesAnyKeyword), không cần DOM =====
    await run.run('splitMultiKeyword(): tách đúng theo xuống dòng/dấu phẩy/chấm phẩy, bỏ khoảng trắng thừa', async () => {
      const r = await page.evaluate(() => splitMultiKeyword('  OO-0012 \n OO-0045\nOO-0101 , OO-0200 ;OO-0300  \n\n'));
      assertEqual(JSON.stringify(r), JSON.stringify(['OO-0012', 'OO-0045', 'OO-0101', 'OO-0200', 'OO-0300']));
    });

    await run.run('matchesAnyKeyword(): KHÔNG có multiKeywords -> hành vi y hệt matchesKeywordFields() cũ (so khớp substring cả cụm)', async () => {
      const r = await page.evaluate(() => ({
        wholePhraseMatches: matchesAnyKeyword(['Nguyễn Văn A', 'Phòng Kế Toán'], null, 'nguyễn văn a'),
        wrongOrderNoMatch: matchesAnyKeyword(['Nguyễn Văn A'], null, 'văn nguyễn'),
        emptyKeywordMatchesAll: matchesAnyKeyword(['bất kỳ gì'], null, '')
      }));
      assert(r.wholePhraseMatches, 'Gõ đúng cả cụm (không dán) phải khớp y hệt hành vi cũ');
      assert(!r.wrongOrderNoMatch, 'Không dán nhiều mã thì KHÔNG được tự tách theo khoảng trắng (tránh đổi hành vi tìm tên người)');
      assert(r.emptyKeywordMatchesAll, 'Từ khoá rỗng vẫn phải khớp mọi dòng như cũ');
    });

    await run.run('matchesAnyKeyword(): CÓ multiKeywords -> khớp OR giữa các mã, không cần đúng thứ tự/đủ cụm', async () => {
      const r = await page.evaluate(() => ({
        matchFirst: matchesAnyKeyword(['OO-2026-0012', 'Siêu Thị Quận 1'], ['oo-2026-0012', 'oo-2026-9999'], 'OO-2026-0012, OO-2026-9999'),
        noMatch: matchesAnyKeyword(['OO-2026-0033'], ['oo-2026-0012', 'oo-2026-9999'], 'OO-2026-0012, OO-2026-9999')
      }));
      assert(r.matchFirst, 'Khớp 1 trong nhiều mã đã dán là đủ (OR)');
      assert(!r.noMatch, 'Không khớp mã nào trong danh sách đã dán thì phải bị loại');
    });

    // ===== Phần B: thao tác DOM THẬT (paste thật qua clipboard, giống thao tác người dùng) =====
    // Vận Hành — module ĐẦU TIÊN nối dây tính năng, đại diện cho khuôn chung áp dụng cho các module khác.
    await page.evaluate(() => {
      DB.operationOrders = [
        { id: 1, code: 'OO-2026-0012', title: 'Sửa máy lạnh', creatorName: 'Nguyễn Văn A', dept: 'Phòng Kỹ Thuật', status: 'PENDING', orderLocationType: 'HO', createdAt: '08:00:00 01/10/2026' },
        { id: 2, code: 'OO-2026-0045', title: 'Lắp đặt camera', creatorName: 'Trần Thị B', dept: 'Phòng IT', status: 'APPROVED', orderLocationType: 'HO', createdAt: '09:00:00 02/10/2026' },
        { id: 3, code: 'OO-2026-0099', title: 'Sơn tường', creatorName: 'Lê Văn C', dept: 'Phòng Hành Chính', status: 'PENDING', orderLocationType: 'HO', createdAt: '10:00:00 03/10/2026' }
      ];
      DB.operationStoreOpenings = [];
      DB.operationRepairs = [];
      currentUser = { username: 'admin', perms: { admin: true } };
      activeOperationOrderSubTab = 'HO';
      switchTab('vanHanh');
    });

    await run.run('[Thao tác DOM THẬT] Vận Hành: dán 2 mã qua clipboard thật (Ctrl+V) -> tự tách, lọc đúng cả 2 dòng', async () => {
      const inputSel = '#filterKeywordOperationOrder';
      await page.waitForSelector(inputSel);
      await page.click(inputSel);
      await page.evaluate(async () => { await navigator.clipboard.writeText('OO-2026-0012\nOO-2026-0045'); });
      await page.keyboard.press('Control+V');
      await page.waitForTimeout(150);

      const r = await page.evaluate(() => {
        const el = document.getElementById('filterKeywordOperationOrder');
        const rows = [...document.querySelectorAll('#operationOrderTableBody tr, #opOrderTableBody tr')];
        return {
          value: el.value,
          multiKeywords: el._multiKeywords,
          rowCount: rows.length,
          rowText: rows.map(r => r.textContent).join(' | ')
        };
      });
      assertEqual(JSON.stringify(r.multiKeywords), JSON.stringify(['OO-2026-0012', 'OO-2026-0045']), 'Phải tách đúng 2 mã từ clipboard: ' + JSON.stringify(r));
      assert(r.value.includes('OO-2026-0012') && r.value.includes('OO-2026-0045'), 'Ô input phải hiện lại 2 mã đã dán (gộp bằng ", ")');
    });

    await run.run('[Thao tác DOM THẬT] Vận Hành: gõ thêm 1 ký tự sau khi dán -> _multiKeywords bị xoá, quay về so khớp cụm thường', async () => {
      const inputSel = '#filterKeywordOperationOrder';
      await page.click(inputSel);
      await page.keyboard.press('End');
      await page.keyboard.type('x');
      await page.waitForTimeout(100);
      const multiKeywords = await page.$eval(inputSel, el => el._multiKeywords);
      assertEqual(multiKeywords, null, 'Gõ tay thêm sau khi dán phải xoá trạng thái multi-keyword (không bị kẹt mãi ở chế độ dán)');
    });

    // ===== Phần C: Người Dùng — module NHẠY CẢM NHẤT theo yêu cầu người dùng =====
    await page.evaluate(() => {
      DB.users = [
        { id: 1, username: 'nv.ketoan', name: 'Nguyễn Văn A', dept: 'Phòng Kế Toán', perms: {} },
        { id: 2, username: 'nv.kinhdoanh', name: 'Trần Thị B', dept: 'Phòng Kinh Doanh', perms: {} },
        { id: 3, username: 'nv.hanhchinh', name: 'Lê Văn C', dept: 'Phòng Hành Chính', perms: {} }
      ];
      switchTab('system');
      if (typeof setAdminSubTab === 'function') setAdminSubTab('PERMS');
    });

    await run.run('[Thao tác DOM THẬT] Người Dùng: gõ tay "Nguyễn Văn A" (có khoảng trắng, KHÔNG dán) -> vẫn lọc đúng 1 dòng như hành vi cũ (an toàn, không bị tách theo khoảng trắng)', async () => {
      const inputSel = '#filterUserKeyword';
      await page.waitForSelector(inputSel);
      await page.fill(inputSel, 'Nguyễn Văn A');
      await page.waitForTimeout(100);
      const r = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#userTableBody tr')];
        return { rowCount: rows.length, multiKeywords: document.getElementById('filterUserKeyword')._multiKeywords };
      });
      assertEqual(r.multiKeywords, null, 'Gõ tay (không paste) không được bật chế độ multi-keyword');
      assertEqual(r.rowCount, 1, 'Phải lọc còn đúng 1 dòng (Nguyễn Văn A), không bị 3 từ "Nguyễn"/"Văn"/"A" làm match nhầm thêm dòng khác: ' + JSON.stringify(r));
    });

    await run.run('[Thao tác DOM THẬT] Người Dùng: dán 2 username qua clipboard thật -> lọc đúng cả 2 tài khoản (CHỈ hiển thị danh sách, không đụng logic tạo/sửa/import user)', async () => {
      const inputSel = '#filterUserKeyword';
      await page.click(inputSel);
      await page.fill(inputSel, '');
      await page.evaluate(async () => { await navigator.clipboard.writeText('nv.ketoan\nnv.kinhdoanh'); });
      await page.keyboard.press('Control+V');
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#userTableBody tr')];
        return {
          rowCount: rows.length,
          multiKeywords: document.getElementById('filterUserKeyword')._multiKeywords,
          dbUsersUntouched: DB.users.length === 3 && DB.users[0].username === 'nv.ketoan'
        };
      });
      assertEqual(JSON.stringify(r.multiKeywords), JSON.stringify(['nv.ketoan', 'nv.kinhdoanh']));
      assertEqual(r.rowCount, 2, 'Phải lọc còn đúng 2 dòng khớp 2 username đã dán: ' + JSON.stringify(r));
      assert(r.dbUsersUntouched, 'DB.users (dữ liệu gốc) không được bị tính năng tìm kiếm đụng vào/sửa đổi gì — đây chỉ là bộ lọc HIỂN THỊ');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
