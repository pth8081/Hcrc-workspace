// server/tests/test-collapse-operation-forms.js
//
// Regression test cho đợt "thu gọn form nhập" (10/2026, yêu cầu người dùng): nhiều form tạo mới ở Vận
// Hành/Mua Hàng/Hỗ Trợ IT trước đây LUÔN hiện sẵn ngay khi vào tab (chiếm nhiều chỗ màn hình dù người
// dùng chỉ đang xem danh sách) — nay mặc định ẨN, chỉ mở ra khi bấm nút "+ ..." cạnh tiêu đề khu vực, và
// có thể thu gọn lại qua nút "✕ Thu Gọn" trong hàng nút hành động cuối form (xem mẫu #mhVendorFormWrap/
// openMhVendorForm()/closeMhVendorForm() ở module-muahang.js).
//
// Trọng tâm bài test: #operationOrderForm (Vận Hành > Đơn Hàng > "📦 Tạo Đơn Hàng Mới") — form PHỨC TẠP
// NHẤT trong đợt (bảng hạng mục động + upload PDF tự điền form) nên rủi ro cao nhất nếu
// openOperationOrderForm() không gọi lại ĐÚNG hàm khởi tạo (resetOperationOrderForm()) mỗi lần mở:
//   (a) form ẨN mặc định khi vừa vào tab "📦 Đơn Hàng".
//   (b) bấm nút "+ Tạo Đơn Hàng" -> form HIỆN + bảng hạng mục có ĐÚNG 1 dòng trống (dù trước đó đã có
//       dữ liệu/nhiều dòng từ lần mở trước — xem kịch bản 3).
//   (c) bấm nút "✕ Thu Gọn" -> form ẨN lại.
//
// Phụ thêm 1 lượt kiểm tra nhanh (không lặp lại đầy đủ 3 bước trên) cho 6 form còn lại trong đợt để tăng
// độ tin cậy bộ test mới, không chỉ test đúng 1 form rồi suy diễn các form khác cũng đúng.
//
// Chạy: node server/tests/test-collapse-operation-forms.js
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8995;

const CREATOR = {
  username: 'vh_collapse_test', name: 'Người Kiểm Thử Thu Gọn Form', dept: 'Vận Hành',
  perms: {
    operationOrderCreate: true, operationStoreOpenCreate: true, operationRepairCreate: true,
    itPriceProposeCreateWholesale: true, itPriceProposeCreateRetail: true
  },
  active: true
};
const state = createMockState({ depts: ['Vận Hành'], users: [CREATOR], stores: ['Siêu thị Demo'] });

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, CREATOR);

    // ===================== #operationOrderForm (trọng tâm) =====================
    await run.run('(a) Vào tab "📦 Đơn Hàng" -> #operationOrderForm ẨN mặc định, nút "+ Tạo Đơn Hàng" HIỆN', async () => {
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); });
      await page.waitForSelector('#btnOperationOrderNew', { state: 'visible' });
      const formHidden = await page.evaluate(() => document.getElementById('operationOrderForm').classList.contains('hidden'));
      assert(formHidden, 'operationOrderForm phải ẨN mặc định khi vừa vào tab Đơn Hàng');
    });

    await run.run('(b) Bấm "+ Tạo Đơn Hàng" (nút thật, data-op) -> form HIỆN + bảng hạng mục ĐÚNG 1 dòng trống', async () => {
      await page.click('#btnOperationOrderNew');
      const state1 = await page.evaluate(() => ({
        formHidden: document.getElementById('operationOrderForm').classList.contains('hidden'),
        itemRows: document.querySelectorAll('#operationOrderItemsTableBody tr').length,
        itemName0: document.querySelector('#operationOrderItemsTableBody tr td input[data-field="name"]')?.value,
        voCode: document.getElementById('voCode').value
      }));
      assert(!state1.formHidden, 'Bấm "+ Tạo Đơn Hàng" phải mở lại form (gỡ class hidden)');
      assertEqual(state1.itemRows, 1, `Bảng hạng mục phải có ĐÚNG 1 dòng trống ngay khi mở form, thực tế ${state1.itemRows}`);
      assertEqual(state1.itemName0, '', 'Dòng hạng mục duy nhất phải trống (chưa có tên hàng)');
      assert(!!state1.voCode, 'Mã đơn hàng phải được sinh sẵn ngay khi mở form');
    });

    await run.run('(c) Bấm "✕ Thu Gọn" (nút thật, data-op="closeOperationOrderForm") -> form ẨN lại', async () => {
      await page.click('#operationOrderForm button[data-op="closeOperationOrderForm"]');
      const formHidden = await page.evaluate(() => document.getElementById('operationOrderForm').classList.contains('hidden'));
      assert(formHidden, 'Bấm "✕ Thu Gọn" phải ẩn lại operationOrderForm');
    });

    await run.run('Kịch bản 3 (rủi ro cao nhất): đang có dữ liệu/3 dòng hạng mục dở từ lần mở TRƯỚC -> mở LẠI qua nút "+" vẫn phải reset về ĐÚNG 1 dòng trống, không giữ dữ liệu cũ', async () => {
      // Mở lại, gõ dở dang + thêm 2 dòng hạng mục (thành 3 dòng), rồi thu gọn KHÔNG bấm "Làm Mới" (mô
      // phỏng đúng nghi ngại nêu trong task: thu gọn rồi mở lại có lỡ giữ nguyên dữ liệu/bảng trống
      // không khởi tạo lại được không).
      await page.click('#btnOperationOrderNew');
      await page.fill('#voTitle', 'Đơn hàng dở dang (sẽ bị thu gọn giữa đường)');
      await page.click('button[data-op="addOperationOrderItemRow"]');
      await page.click('button[data-op="addOperationOrderItemRow"]');
      const rowsBeforeCollapse = await page.locator('#operationOrderItemsTableBody tr').count();
      assertEqual(rowsBeforeCollapse, 3, `Tiền đề: phải có 3 dòng hạng mục trước khi thu gọn, thực tế ${rowsBeforeCollapse}`);
      await page.fill('#operationOrderItemsTableBody tr:nth-child(1) input[data-field="name"]', 'Hàng dở dang dòng 1');

      await page.click('#operationOrderForm button[data-op="closeOperationOrderForm"]');
      const hiddenAfterCollapse = await page.evaluate(() => document.getElementById('operationOrderForm').classList.contains('hidden'));
      assert(hiddenAfterCollapse, 'Tiền đề: form phải đang ẨN (vừa thu gọn) trước khi mở lại');

      await page.click('#btnOperationOrderNew');
      const state2 = await page.evaluate(() => ({
        formHidden: document.getElementById('operationOrderForm').classList.contains('hidden'),
        itemRows: document.querySelectorAll('#operationOrderItemsTableBody tr').length,
        itemName0: document.querySelector('#operationOrderItemsTableBody tr td input[data-field="name"]')?.value,
        voTitle: document.getElementById('voTitle').value,
        voFileValue: document.getElementById('voFile').value
      }));
      assert(!state2.formHidden, 'Mở lại lần 2 phải hiện form');
      assertEqual(state2.itemRows, 1, `BUG nếu sai: mở lại qua nút "+" PHẢI reset bảng hạng mục về ĐÚNG 1 dòng trống (không giữ 3 dòng dở dang từ lần trước), thực tế ${state2.itemRows}`);
      assertEqual(state2.itemName0, '', 'Dòng hạng mục duy nhất sau khi mở lại phải trống (không sót "Hàng dở dang dòng 1")');
      assertEqual(state2.voTitle, '', 'voTitle phải được reset về rỗng khi mở lại (resetOperationOrderForm() chạy lại từ đầu)');
      assertEqual(state2.voFileValue, '', 'Input file voFile phải được reset (rỗng) khi mở lại');
    });

    // ===================== 6 form còn lại — kiểm tra nhanh hidden-by-default + nút mở/đóng =====================
    await run.run('#operationStoreOpenForm (Vận Hành > Siêu Thị > Mở Mới): ẩn mặc định, mở/đóng đúng qua nút thật', async () => {
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); });
      const hiddenDefault = await page.evaluate(() => document.getElementById('operationStoreOpenForm').classList.contains('hidden'));
      assert(hiddenDefault, 'operationStoreOpenForm phải ẩn mặc định');
      await page.click('#btnOperationStoreOpenNew');
      const hiddenAfterOpen = await page.evaluate(() => document.getElementById('operationStoreOpenForm').classList.contains('hidden'));
      assert(!hiddenAfterOpen, 'Bấm "+ Tạo Đề Xuất Mở Mới" phải mở form');
      await page.click('#operationStoreOpenForm button[data-op="closeOperationStoreOpenForm"]');
      const hiddenAfterClose = await page.evaluate(() => document.getElementById('operationStoreOpenForm').classList.contains('hidden'));
      assert(hiddenAfterClose, 'Bấm "✕ Thu Gọn" phải đóng lại form');
    });

    await run.run('#operationRepairForm (Vận Hành > Siêu Thị > Sửa Chữa): ẩn mặc định, mở/đóng đúng qua nút thật', async () => {
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('REPAIR'); });
      const hiddenDefault = await page.evaluate(() => document.getElementById('operationRepairForm').classList.contains('hidden'));
      assert(hiddenDefault, 'operationRepairForm phải ẩn mặc định');
      await page.click('#btnOperationRepairNew');
      const hiddenAfterOpen = await page.evaluate(() => document.getElementById('operationRepairForm').classList.contains('hidden'));
      assert(!hiddenAfterOpen, 'Bấm "+ Tạo Đề Xuất Sửa Chữa" phải mở form');
      await page.click('#operationRepairForm button[data-op="closeOperationRepairForm"]');
      const hiddenAfterClose = await page.evaluate(() => document.getElementById('operationRepairForm').classList.contains('hidden'));
      assert(hiddenAfterClose, 'Bấm "✕ Thu Gọn" phải đóng lại form');
    });

    await run.run('#itPriceCreateForm (Vận Hành > Phê Duyệt Giá Bán Buôn, LOẠI B): nút "+ Đề Xuất Mới" gác theo quyền, form ẩn mặc định, mở/đóng đúng', async () => {
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ITPRICE'); });
      const btnVisible = await page.evaluate(() => !document.getElementById('btnItPriceCreateNew').classList.contains('hidden'));
      assert(btnVisible, 'Người có quyền itPriceProposeCreateWholesale phải thấy nút "+ Đề Xuất Mới"');
      const hiddenDefault = await page.evaluate(() => document.getElementById('itPriceCreateForm').classList.contains('hidden'));
      assert(hiddenDefault, 'itPriceCreateForm phải ẩn mặc định dù người dùng có quyền');
      await page.click('#btnItPriceCreateNew');
      const hiddenAfterOpen = await page.evaluate(() => document.getElementById('itPriceCreateForm').classList.contains('hidden'));
      assert(!hiddenAfterOpen, 'Bấm "+ Đề Xuất Mới" phải mở form');
      await page.click('#itPriceCreateForm button[data-op="closeItPriceCreateForm"]');
      const hiddenAfterClose = await page.evaluate(() => document.getElementById('itPriceCreateForm').classList.contains('hidden'));
      assert(hiddenAfterClose, 'Bấm "✕ Thu Gọn" phải đóng lại form');
    });

    await run.run('#mhItPriceCreateForm (Mua Hàng > Phê Duyệt Giá Bán Lẻ, LOẠI B): nút "+ Đề Xuất Mới" gác theo quyền, form ẩn mặc định, mở/đóng đúng', async () => {
      await page.evaluate(() => { switchTab('muaHang'); setPurchasingSubTab('ITPRICE'); });
      const btnVisible = await page.evaluate(() => !document.getElementById('btnMhItPriceCreateNew').classList.contains('hidden'));
      assert(btnVisible, 'Người có quyền itPriceProposeCreateRetail phải thấy nút "+ Đề Xuất Mới"');
      const hiddenDefault = await page.evaluate(() => document.getElementById('mhItPriceCreateForm').classList.contains('hidden'));
      assert(hiddenDefault, 'mhItPriceCreateForm phải ẩn mặc định dù người dùng có quyền');
      await page.click('#btnMhItPriceCreateNew');
      const hiddenAfterOpen = await page.evaluate(() => document.getElementById('mhItPriceCreateForm').classList.contains('hidden'));
      assert(!hiddenAfterOpen, 'Bấm "+ Đề Xuất Mới" phải mở form');
      await page.click('#mhItPriceCreateForm button[data-op="closeMhItPriceCreateForm"]');
      const hiddenAfterClose = await page.evaluate(() => document.getElementById('mhItPriceCreateForm').classList.contains('hidden'));
      assert(hiddenAfterClose, 'Bấm "✕ Thu Gọn" phải đóng lại form');
    });

    await run.run('#itTicketCreateForm (Hỗ Trợ IT > Hỗ Trợ Yêu Cầu): ẩn mặc định, mở/đóng đúng qua nút thật', async () => {
      await page.evaluate(() => { switchTab('itSupport'); setItSupportSubTab('TICKET'); });
      const hiddenDefault = await page.evaluate(() => document.getElementById('itTicketCreateForm').classList.contains('hidden'));
      assert(hiddenDefault, 'itTicketCreateForm phải ẩn mặc định');
      await page.click('#btnItTicketNew');
      const hiddenAfterOpen = await page.evaluate(() => document.getElementById('itTicketCreateForm').classList.contains('hidden'));
      assert(!hiddenAfterOpen, 'Bấm "+ Gửi Yêu Cầu" phải mở form');
      await page.click('#itTicketCreateForm button[data-op="closeItTicketForm"]');
      const hiddenAfterClose = await page.evaluate(() => document.getElementById('itTicketCreateForm').classList.contains('hidden'));
      assert(hiddenAfterClose, 'Bấm "✕ Thu Gọn" phải đóng lại form');
    });

    // itRenewalCreateForm: chỉ IT (itServiceRenewalManage/admin) thấy được sub-tab RENEWAL — CREATOR
    // hiện không có quyền này nên nâng quyền ngay trong phiên (đổi perms rồi gọi lại proceedAfterAuth()),
    // tránh tạo riêng 1 user IT thứ 2 không cần thiết cho bài test vốn chỉ kiểm tra UI ẩn/hiện form.
    await run.run('#itRenewalCreateForm (Hỗ Trợ IT > Gia Hạn Dịch Vụ CNTT, chỉ IT thấy): ẩn mặc định, mở/đóng đúng qua nút thật', async () => {
      await page.evaluate(async () => {
        window.__resetCapture();
        await proceedAfterAuth({ ...currentUser, perms: { ...currentUser.perms, itServiceRenewalManage: true } });
        DB.itServiceRenewals = DB.itServiceRenewals || [];
        DB.itRenewalCategories = DB.itRenewalCategories || [];
        switchTab('itSupport');
        setItSupportSubTab('RENEWAL');
      });
      const hiddenDefault = await page.evaluate(() => document.getElementById('itRenewalCreateForm').classList.contains('hidden'));
      assert(hiddenDefault, 'itRenewalCreateForm phải ẩn mặc định');
      await page.click('#btnItRenewalNew');
      const hiddenAfterOpen = await page.evaluate(() => document.getElementById('itRenewalCreateForm').classList.contains('hidden'));
      assert(!hiddenAfterOpen, 'Bấm "+ Thêm Dịch Vụ" phải mở form');
      await page.click('#itRenewalCreateForm button[data-op="closeItRenewalForm"]');
      const hiddenAfterClose = await page.evaluate(() => document.getElementById('itRenewalCreateForm').classList.contains('hidden'));
      assert(hiddenAfterClose, 'Bấm "✕ Thu Gọn" phải đóng lại form');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => { console.error(err); process.exit(1); });
