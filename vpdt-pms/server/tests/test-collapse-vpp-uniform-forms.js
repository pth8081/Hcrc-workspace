// server/tests/test-collapse-vpp-uniform-forms.js
//
// Regression test cho đợt "thu gọn form nhập" (10/2026, pattern chuẩn mhVendorFormWrap/openMhVendorForm
// — module-muahang.js: form wrap ẩn mặc định trong HTML tĩnh, 1 nút riêng "+ ..." bên ngoài mở form, 1
// nút "✕ Thu Gọn" bên trong form ở hàng nút hành động cuối). Tập trung vào module Đồng Phục (module-
// dongphuc.js) — ưu tiên #uniformCreatePeriodBlock (form phức tạp nhất chuyển thành công trong đợt này,
// kèm khối phân bổ theo siêu thị động "+ Thêm Siêu Thị") theo đúng yêu cầu của đợt, cộng thêm vài kịch
// bản nhẹ cho 2 form LOẠI B còn lại (#uniformCatalogAdminForm/#uniformTransferRequestForm) để xác nhận
// quyền gác đúng NÚT (không còn gác form tự ẩn/hiện theo quyền như trước).
//
// Dùng chung hạ tầng tests/testHarness.js (như test-uniform.js/test-uniform-phase2.js) — mock backend
// chạy thẳng lib/recordActions.js + lib/createValidation.js thật, chỉ tầng lưu trữ là giả lập.
//
// Chạy: node server/tests/test-collapse-vpp-uniform-forms.js
'use strict';
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8997;

const STORES = ['Siêu Thị Hội An', 'Siêu Thị Đà Nẵng'];

const HC = { username: 'hc1', name: 'Nguyễn Văn Hành Chính', dept: 'Hành Chính', perms: { uniformManage: true }, active: true };
// APPROVER: chỉ uniformApprove (KHÔNG uniformManage) — vẫn vào được tab "Kỳ Cấp Phát" để duyệt/từ chối
// (xem canSeePeriods ở setUniformSubTab()), nhưng KHÔNG được thấy/mở form "Tạo Kỳ Cấp Phát" lẫn form
// Danh Mục Đồng Phục — đúng kịch bản quyền cần kiểm chứng ở đợt thu gọn form này.
const APPROVER = { username: 'approver1', name: 'Người Duyệt Đồng Phục', dept: 'Hành Chính', perms: { uniformApprove: true }, active: true };

const state = createMockState({
  depts: ['Hành Chính'],
  stores: STORES,
  users: [HC, APPROVER],
  uniformCatalog: [{ id: 1, name: 'Áo đồng phục nam', sizes: ['S', 'M', 'L', 'XL'] }]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    // ===================== #uniformCreatePeriodBlock ("Tạo Kỳ Cấp Phát Đồng Phục") =====================
    await run.run(
      'uniformCreatePeriodBlock: ẨN mặc định khi mở tab "Kỳ Cấp Phát" (HC, có quyền uniformManage) — nút "+ Tạo Kỳ Cấp Phát" HIỆN',
      async () => {
        await loginAs(page, HC);
        const state1 = await page.evaluate(() => {
          switchTab('uniform');
          setUniformSubTab('PERIODS');
          return {
            blockHidden: document.getElementById('uniformCreatePeriodBlock').classList.contains('hidden'),
            btnHidden: document.getElementById('btnUniformPeriodNew').classList.contains('hidden')
          };
        });
        assert(state1.blockHidden, 'uniformCreatePeriodBlock phải ẨN mặc định ngay khi vừa mở tab, chưa bấm "+"');
        assert(!state1.btnHidden, 'Nút "+ Tạo Kỳ Cấp Phát" phải HIỆN cho HC (có quyền uniformManage)');
      }
    );

    await run.run(
      'Bấm "+ Tạo Kỳ Cấp Phát" (click thật qua data-op) MỞ form + state sạch (0 khối phân bổ, tên kỳ rỗng)',
      async () => {
        await page.click('#btnUniformPeriodNew');
        const afterOpen = await page.evaluate(() => ({
          blockHidden: document.getElementById('uniformCreatePeriodBlock').classList.contains('hidden'),
          name: document.getElementById('uniformPeriodName').value,
          blocksLen: uniformAllocBlocks.length,
          allocRowsRendered: document.querySelectorAll('#uniformAllocBlocksWrap > div').length
        }));
        assert(!afterOpen.blockHidden, 'Bấm "+ Tạo Kỳ Cấp Phát" phải MỞ form (gỡ class hidden)');
        assertEqual(afterOpen.name, '', 'Tên kỳ cấp phát phải rỗng ngay khi mở (chưa ai điền gì)');
        assertEqual(afterOpen.blocksLen, 0, 'uniformAllocBlocks phải rỗng (resetUniformPeriodForm() chạy khi mở)');
        assertEqual(afterOpen.allocRowsRendered, 0, 'Khối phân bổ theo siêu thị trên DOM phải rỗng, không còn dòng nào sót lại');
      }
    );

    await run.run(
      'Điền dở (tên kỳ + thêm 1 khối phân bổ) rồi bấm "✕ Thu Gọn" (click thật) — form ẨN lại',
      async () => {
        await page.fill('#uniformPeriodName', 'Kỳ nháp chưa gửi');
        await page.evaluate(() => { addUniformAllocationBlock(); });
        const beforeClose = await page.evaluate(() => uniformAllocBlocks.length);
        assertEqual(beforeClose, 1, 'Tiền đề: phải có đúng 1 khối phân bổ trước khi bấm Thu Gọn');

        await page.click('#uniformCreatePeriodBlock button[data-op="closeUniformCreatePeriodForm"]');
        const hidden = await page.evaluate(() => document.getElementById('uniformCreatePeriodBlock').classList.contains('hidden'));
        assert(hidden, 'Bấm "✕ Thu Gọn" phải ẨN lại form (gán class hidden)');
      }
    );

    await run.run(
      'Mở lại bằng nút "+" SAU KHI đã điền dở ở lượt trước — state PHẢI SẠCH lại (không giữ tên kỳ/khối phân bổ cũ)',
      async () => {
        await page.click('#btnUniformPeriodNew');
        const state2 = await page.evaluate(() => ({
          blockHidden: document.getElementById('uniformCreatePeriodBlock').classList.contains('hidden'),
          name: document.getElementById('uniformPeriodName').value,
          blocksLen: uniformAllocBlocks.length
        }));
        assert(!state2.blockHidden, 'Form phải MỞ lại sau khi bấm "+"');
        assertEqual(state2.name, '', 'openUniformCreatePeriodForm() phải gọi lại resetUniformPeriodForm() — tên kỳ của lượt trước KHÔNG được còn sót lại');
        assertEqual(state2.blocksLen, 0, 'Khối phân bổ của lượt điền dở trước đó KHÔNG được còn sót lại khi mở lại form');
      }
    );

    await run.run(
      'Happy path qua UI thật (bấm "+", điền form, +Thêm Siêu Thị, bấm Tạo Kỳ Cấp Phát) — tạo kỳ thành công VÀ form tự THU GỌN lại',
      async () => {
        await page.fill('#uniformPeriodName', 'Đợt hè 2026 (test thu gọn)');
        await page.evaluate(() => {
          addUniformAllocationBlock();
          updateUniformAllocDept(0, 'Siêu Thị Hội An');
          updateUniformAllocItemField(0, 0, 'name', 'Áo đồng phục nam');
          updateUniformAllocItemField(0, 0, 'size', 'L');
          updateUniformAllocItemField(0, 0, 'qty', '10');
        });

        await page.click('#uniformCreatePeriodBlock button[data-op="submitUniformPeriod"]');
        const result = await page.evaluate(() => ({
          alerts: window.__alerts.slice(),
          created: DB.uniformPeriods.some(p => p.name === 'Đợt hè 2026 (test thu gọn)'),
          blockHidden: document.getElementById('uniformCreatePeriodBlock').classList.contains('hidden')
        }));
        assert(result.alerts.some(a => a.includes('Đã tạo kỳ cấp phát')), `Phải báo thành công, thực tế alerts=${JSON.stringify(result.alerts)}`);
        assert(result.created, 'Kỳ cấp phát mới phải xuất hiện trong DB.uniformPeriods');
        assert(result.blockHidden, 'Sau khi tạo kỳ thành công, form "Tạo Kỳ Cấp Phát" phải TỰ THU GỌN lại (closeUniformCreatePeriodForm())');
      }
    );

    await run.run(
      'Quyền: APPROVER (chỉ uniformApprove, KHÔNG uniformManage) KHÔNG thấy nút "+" VÀ form luôn ẨN dù vào được tab "Kỳ Cấp Phát"',
      async () => {
        await loginAs(page, APPROVER);
        const result = await page.evaluate(() => {
          switchTab('uniform');
          setUniformSubTab('PERIODS');
          return {
            periodsSubTab: activeUniformSubTab,
            btnHidden: document.getElementById('btnUniformPeriodNew').classList.contains('hidden'),
            blockHidden: document.getElementById('uniformCreatePeriodBlock').classList.contains('hidden')
          };
        });
        assertEqual(result.periodsSubTab, 'PERIODS', 'APPROVER phải tới được tab "Kỳ Cấp Phát" (để duyệt/từ chối)');
        assert(result.btnHidden, 'APPROVER (không có uniformManage) KHÔNG được thấy nút "+ Tạo Kỳ Cấp Phát"');
        assert(result.blockHidden, 'APPROVER (không có uniformManage) KHÔNG được thấy form "Tạo Kỳ Cấp Phát" dù vào được tab');
      }
    );

    // ===================== #uniformCatalogAdminForm ("Danh Mục Đồng Phục", LOẠI B theo canEdit) =====================
    await run.run(
      'uniformCatalogAdminForm: ẨN mặc định cho HC (canEdit=true) — nút "+ Thêm Mặt Hàng" HIỆN; APPROVER (canEdit=false) KHÔNG thấy nút, form luôn ẨN',
      async () => {
        await loginAs(page, HC);
        const hcState = await page.evaluate(() => {
          switchTab('uniform');
          setUniformSubTab('PERIODS');
          return {
            formHidden: document.getElementById('uniformCatalogAdminForm').classList.contains('hidden'),
            btnHidden: document.getElementById('btnUniformCatalogNew').classList.contains('hidden')
          };
        });
        assert(hcState.formHidden, 'uniformCatalogAdminForm phải ẨN mặc định ngay cả khi HC (canEdit) vừa mở tab, chưa bấm "+"');
        assert(!hcState.btnHidden, 'Nút "+ Thêm Mặt Hàng" phải HIỆN cho HC (canEdit=true)');

        await page.click('#btnUniformCatalogNew');
        const afterOpen = await page.evaluate(() => document.getElementById('uniformCatalogAdminForm').classList.contains('hidden'));
        assert(!afterOpen, 'Bấm "+ Thêm Mặt Hàng" phải MỞ form');

        await loginAs(page, APPROVER);
        const approverState = await page.evaluate(() => {
          switchTab('uniform');
          setUniformSubTab('PERIODS');
          return {
            formHidden: document.getElementById('uniformCatalogAdminForm').classList.contains('hidden'),
            btnHidden: document.getElementById('btnUniformCatalogNew').classList.contains('hidden')
          };
        });
        assert(approverState.btnHidden, 'APPROVER (canEdit=false) KHÔNG được thấy nút "+ Thêm Mặt Hàng"');
        assert(approverState.formHidden, 'APPROVER (canEdit=false) KHÔNG được thấy form Danh Mục Đồng Phục, kể cả khi nó đang mở dở ở phiên HC trước đó');
      }
    );

    // ===================== #uniformTransferRequestForm ("Điều Chuyển Kho...", LOẠI B theo canManageUniformStore) =====================
    await run.run(
      'uniformTransferRequestForm: APPROVER/HC (không có uniformStoreManage) KHÔNG thấy nút "+ Gửi Yêu Cầu Điều Chuyển", form luôn ẨN',
      async () => {
        await loginAs(page, HC);
        const result = await page.evaluate(() => {
          switchTab('uniform');
          setUniformSubTab('STORE');
          return {
            btnHidden: document.getElementById('btnUniformTransferNew').classList.contains('hidden'),
            formHidden: document.getElementById('uniformTransferRequestForm').classList.contains('hidden')
          };
        });
        assert(result.btnHidden, 'HC (chỉ uniformManage, không uniformStoreManage) KHÔNG được thấy nút "+ Gửi Yêu Cầu Điều Chuyển"');
        assert(result.formHidden, 'Form Điều Chuyển phải ẨN cho người không có quyền uniformStoreManage');
      }
    );
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
