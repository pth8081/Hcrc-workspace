// server/tests/test-it-price-master-list-add.js
//
// Regression test cho lỗi thật (báo cáo 10/2026): "+ Thêm Mẫu Giá" ở "Hỗ Trợ IT > Phê Duyệt Giá"
// (CẢ 2 sub-tab Bán Lẻ/Bán Buôn, cùng dùng chung 1 nút/1 input file) bấm không có phản ứng gì.
//
// Root cause: pickAndParseMasterListFile() (module-itsupport-price.js) là input file DUY NHẤT trong
// toàn hệ thống KHÔNG dùng data-op-change (mọi input file khác đều bind trực tiếp qua
// bindCspDelegation), mà tự dựng 1 Promise chỉ resolve() khi bắt được "change" (chọn xong file). Hộp
// thoại OS KHÔNG bắn "change" nếu người dùng bấm Hủy/đóng đi mà không chọn file nào — Promise treo VĨNH
// VIỄN, kéo theo el.dataset.opInFlight (gán trong runCspOp(), core.js) của nút gọi hàm cũng treo mãi ->
// nút bị khoá cứng, bấm lại sau đó không còn phản ứng gì (đúng hiện tượng người dùng báo, chỉ cần 1 lần
// lỡ tay bấm Hủy hộp thoại chọn file). Đã vá: thêm handler cho sự kiện "cancel" (chuẩn trên mọi trình
// duyệt hiện đại) để resolve(null) đúng lúc, không treo Promise/khoá nút nữa.
//
// Chạy: node server/tests/test-it-price-master-list-add.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8993;
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Hỗ Trợ IT', perms: { admin: true }, active: true, totpEnabled: true };

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

// Giả lập route "/api/it-price/master-list/parse-file" (multipart FormData) NGAY TRONG TRANG — testHarness
// dùng chung 1 fetch override chỉ đặc cách cho "/api/upload" (fakeUploadResponse), các route multipart khác
// đi qua __apiDispatch (KHÔNG có File object, KHÔNG mô phỏng được việc đọc file thật) — cùng khuôn với
// window.__uploadIdCounter/fakeUploadResponse có sẵn ở testHarness.js, dựng thêm handler RIÊNG cho route
// này ngay trong page.evaluate() (không đụng testHarness.js dùng chung cho toàn bộ 100+ test khác).
async function stubParseFileRoute(page, { columns }) {
  await page.evaluate((cols) => {
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (url === '/api/it-price/master-list/parse-file') {
        const file = opts.body.get('file');
        return {
          ok: true, status: 200,
          json: async () => ({ columns: cols, fileUrl: `/uploads/fake_masterlist_${file.name}`, fileName: file.name })
        };
      }
      return realFetch(url, opts);
    };
  }, columns);
}

async function main() {
  const state = createMockState({ depts: ['Hỗ Trợ IT'], users: [ADMIN] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await run.run('Bấm "+ Thêm Mẫu Giá" mở đúng hộp thoại chọn file (chưa có Mẫu Giá nào)', async () => {
      await loginAs(page, ADMIN);
      await page.evaluate(() => { switchTab('itSupport'); setItSupportSubTab('PRICE'); });
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 3000 }),
        page.click('[data-op="addItPriceMasterList"]'),
      ]);
      assert(!!chooser, 'Phải mở được hộp thoại chọn file');
      // Đóng hộp thoại KHÔNG chọn file nào (mô phỏng "Hủy") để dọn sạch trước kịch bản kế tiếp — Playwright
      // không có API "Hủy" trực tiếp, bắn thẳng sự kiện "cancel" trên input (xem chú thích ở kịch bản kế
      // tiếp) — quan trọng: nếu KHÔNG dọn ở đây, Promise của lần bấm này vẫn còn "đang chờ" thật sự (đúng
      // hành vi — chưa Hủy/chưa chọn file thì lock data-op-in-flight còn giữ là ĐÚNG, không phải bug) nên
      // lần bấm ở kịch bản sau sẽ bị cspDispatchOp() tự chặn (el.dataset.opInFlight==='1'), không mở lại
      // được hộp thoại — dễ nhầm là lỗi thật trong khi chỉ là chưa dọn sạch giữa 2 kịch bản.
      await page.evaluate(() => {
        document.getElementById('itPriceMasterListFileInput').dispatchEvent(new Event('cancel'));
      });
      await page.waitForTimeout(200);
    });

    await run.run('LỖI THẬT: bấm "Hủy" hộp thoại chọn file KHÔNG được làm nút "+ Thêm Mẫu Giá" bị khoá cứng — bấm lại vẫn phải mở lại được hộp thoại', async () => {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 3000 }),
        page.click('[data-op="addItPriceMasterList"]'),
      ]);
      // Mô phỏng đúng hành vi trình duyệt khi người dùng đóng hộp thoại KHÔNG chọn file: bắn sự kiện
      // "cancel" trên input, KHÔNG bắn "change" — xem chú thích tại pickAndParseMasterListFile().
      await page.evaluate(() => {
        document.getElementById('itPriceMasterListFileInput').dispatchEvent(new Event('cancel'));
      });
      await page.waitForTimeout(200);

      const inFlight = await page.evaluate(() => document.querySelector('[data-op="addItPriceMasterList"]').dataset.opInFlight);
      assert(inFlight !== '1', 'Sau khi Hủy hộp thoại, nút KHÔNG được ở trạng thái "đang xử lý" (data-op-in-flight) mãi mãi — đây chính là lỗi thật đã báo');

      const [chooser2] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 3000 }),
        page.click('[data-op="addItPriceMasterList"]'),
      ]);
      assert(!!chooser2, 'Bấm lại "+ Thêm Mẫu Giá" sau khi đã Hủy 1 lần vẫn phải mở lại được hộp thoại chọn file (không bị "im lặng không phản ứng" như lỗi báo cáo)');
      // Đóng nốt hộp thoại lần 2 (không chọn file) để dọn sạch, tránh treo sang kịch bản kế tiếp.
      await page.evaluate(() => {
        document.getElementById('itPriceMasterListFileInput').dispatchEvent(new Event('cancel'));
      });
      await page.waitForTimeout(200);
    });

    await run.run('Happy path: chọn file thật -> parse xong -> đặt tên -> lưu đúng vào DB.itPriceMasterLists với priceType đang mở (RETAIL)', async () => {
      await stubParseFileRoute(page, { columns: [{ key: 'c0', label: 'Tên hàng' }, { key: 'c1', label: 'Giá' }] });
      await page.evaluate(() => { window.__promptAnswer = 'Mẫu giá test Q4/2026'; });

      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 3000 }),
        page.click('[data-op="addItPriceMasterList"]'),
      ]);
      await chooser.setFiles({ name: 'gia-test.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('fake-xlsx-content') });
      // pickMarginColumnKey() mở modal #colRoleModal (chờ người dùng chọn/Hủy) — bấm "Hủy" (giữ nguyên
      // hành vi không bắt buộc gán cột Margin/Chiết Khấu) để hoàn tất luồng thêm mẫu.
      await page.waitForSelector('#colRoleModal:not(.hidden)', { timeout: 3000 });
      await page.click('[data-op="closeColRoleModal"]');

      await page.waitForTimeout(300);
      const result = await page.evaluate(() => ({
        lists: DB.itPriceMasterLists,
        alerts: window.__alerts
      }));
      assertEqual(result.lists.length, 1, 'Phải lưu đúng 1 Mẫu Giá mới');
      assertEqual(result.lists[0].name, 'Mẫu giá test Q4/2026', 'Tên Mẫu Giá phải đúng như đã nhập ở prompt');
      assertEqual(result.lists[0].priceType, 'RETAIL', 'Mẫu Giá tạo lúc đang mở sub-tab Bán Lẻ phải gắn priceType RETAIL');
      assertEqual(result.lists[0].columns.length, 2, 'Phải lưu đúng 2 cột đọc được từ file mẫu');
      assert(result.alerts.some(a => a.includes('Đã thêm Mẫu Giá')), 'Phải có thông báo thành công');
    });

    await run.run('"🔄 Thay mẫu" (replaceItPriceMasterListFile, dùng chung helper) cũng không bị khoá cứng khi Hủy hộp thoại', async () => {
      await page.evaluate(() => { switchTab('itSupport'); setItSupportSubTab('PRICE'); renderItPriceMasterListAdmin(); });
      const listId = await page.evaluate(() => DB.itPriceMasterLists[0].id);
      const btnSel = `[data-op="replaceItPriceMasterListFile"][data-arg0="${listId}"]`;
      await page.waitForSelector(btnSel, { timeout: 3000 });

      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 3000 }),
        page.click(btnSel),
      ]);
      assert(!!chooser, 'Bấm "🔄 Thay mẫu" phải mở được hộp thoại chọn file');
      await page.evaluate(() => {
        document.getElementById('itPriceMasterListFileInput').dispatchEvent(new Event('cancel'));
      });
      await page.waitForTimeout(200);
      const inFlight = await page.evaluate((sel) => document.querySelector(sel).dataset.opInFlight, btnSel);
      assert(inFlight !== '1', '"🔄 Thay mẫu" cũng dùng pickAndParseMasterListFile() — Hủy hộp thoại không được khoá cứng nút này');
    });

  } finally {
    run.summary();
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
