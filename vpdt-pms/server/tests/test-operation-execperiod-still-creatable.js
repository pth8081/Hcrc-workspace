// server/tests/test-operation-execperiod-still-creatable.js
//
// Audit nghiệp vụ — nghi vấn #8: "Kỳ Thực Hiện" (operationExecutionPeriods) đã bỏ HẲN khỏi UI (comment ở
// module-vanhanh.js dòng ~1992: "operationExecutionPeriods nữa... GIỮ NGUYÊN để hồ sơ CŨ còn periodId/
// periodName vẫn hiển thị đúng badge") nhưng route tạo mới (POST /api/create/operationExecutionPeriods,
// CREATE_MODULE_CONFIGS.operationExecutionPeriods ở lib/createValidation.js) + route "Bắt Đầu Kỳ" (POST
// /api/records/operationExecutionPeriods/:id/start) VẪN CÒN SỐNG, có validate/quyền đầy đủ (không phải lỗ
// hổng bảo mật — người gọi vẫn cần đúng quyền canManageOperationRecord() + dự toán đã duyệt) nhưng KHÔNG
// có bất kỳ nút/luồng UI nào gọi tới nữa. XÁC NHẬN 2 vế:
//   (1) UI thật sự KHÔNG CÒN đường nào gọi callCreateAction('operationExecutionPeriods', ...) — grep tĩnh
//       0 kết quả trong public/js/*.js (đã kiểm tra riêng, không lặp lại ở đây).
//   (2) Route/hàm vẫn CHẤP NHẬN request tạo Kỳ MỚI nếu gọi trực tiếp (không phải chỉ 404/410 "đã gỡ bỏ")
//       — nghĩa là ai giữ 1 script/bookmark cũ, hoặc gọi thẳng qua console/API client, vẫn tạo được dữ
//       liệu "Kỳ Thực Hiện" MỚI (không chỉ thao tác trên kỳ CŨ đã có sẵn) — đúng nghi vấn "dữ liệu rác".
// Gọi ĐÚNG callCreateAction() thật (public/js/core.js, hàm mọi form tạo mới trong hệ thống đều dùng) với
// đúng payload hợp lệ — không tự dựng request tay, không né logic thật.
//
// Chạy: node server/tests/test-operation-execperiod-still-creatable.js
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 9000;
const CREATOR = {
  username: 'vh_creator_ep', name: 'Người Tạo Hồ Sơ', dept: 'Vận Hành',
  perms: { operationStoreOpenCreate: true, operationRecordManageAll: true }, active: true
};
const state = createMockState({ depts: ['Vận Hành'], users: [CREATOR] });

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    let recordId = null;
    await run.run('Setup: hồ sơ + danh mục đầu tư APPROVED (điều kiện tiên quyết để tạo Kỳ)', async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, CREATOR);
      recordId = await page.evaluate(async () => {
        const res = await callCreateAction('operationStoreOpenings', {
          storeName: 'Siêu thị execperiod (test)', address: '123 Test', area: 200,
          approvedBudget: 5000000000, expectedOpenDate: '', personInCharge: '', note: ''
        });
        DB.operationStoreOpenings.push(res.item);
        return res.item.id;
      });
      await page.evaluate((id) => { openOperationEstimateModal('operationStoreOpenings', id); }, recordId);
      await page.waitForTimeout(60);
      await page.click('button[data-op="addOperationEstimateItemRow"]');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(1) input[data-field="content"]', 'Hạng mục ep');
      await page.fill('#operationEstimateItemsTableBody tr:nth-child(1) input[data-field="amount"]', '10000000');
      await page.evaluate(async () => { await submitOperationEstimateForApproval(); });
      const estStatus = await page.evaluate((id) => DB.operationStoreOpenings.find(r => r.id === id).estimateStatus, recordId);
      assertEqual(estStatus, 'APPROVED', 'Điều kiện tiên quyết: danh mục đầu tư phải APPROVED');
    });

    await run.run('XÁC NHẬN (1): UI hiện tại KHÔNG có form/nút nào để mở modal/gọi tạo Kỳ Thực Hiện mới', async () => {
      // Toàn bộ khối UI Kỳ Thực Hiện chỉ còn box HIỂN THỊ (operationExecutionPeriodsBox), không có form tạo.
      const hasCreateForm = await page.evaluate(() => !!document.querySelector('form#operationExecutionPeriodForm, [data-op="openOperationExecutionPeriodCreateModal"], [data-op="submitOperationExecutionPeriod"]'));
      assert(!hasCreateForm, 'Không được có bất kỳ form/nút tạo Kỳ Thực Hiện nào còn sót trong DOM (đúng như tài liệu "đã bỏ hẳn khỏi UI")');
      const fnExists = await page.evaluate(() => typeof window.submitOperationExecutionPeriod === 'function' || typeof window.openOperationExecutionPeriodModal === 'function');
      assert(!fnExists, 'Không còn hàm JS client nào để mở form tạo Kỳ (xác nhận thêm — không chỉ ẩn nút mà logic gọi cũng không còn tồn tại phía client)');
    });

    await run.run('XÁC NHẬN (2, BUG/GAP): gọi thẳng callCreateAction(\'operationExecutionPeriods\', ...) — route thật vẫn CHẤP NHẬN, tạo được Kỳ MỚI dù UI không còn đường nào dẫn tới', async () => {
      const result = await page.evaluate(async (id) => {
        try {
          const res = await callCreateAction('operationExecutionPeriods', {
            sourceType: 'OPERATION_STORE_OPENING', sourceId: id, name: 'Kỳ ma (gọi thẳng API, audit)'
          });
          return { ok: true, item: res.item };
        } catch (err) { return { ok: false, error: err.message }; }
      }, recordId);
      console.log(`  >> [GAP CONFIRM] Gọi thẳng /api/create/operationExecutionPeriods: ok=${result.ok}${result.ok ? `, status="${result.item.status}", id=${result.item.id}` : `, error="${result.error}"`}`);
      assert(result.ok, 'XÁC NHẬN: route tạo Kỳ Thực Hiện VẪN CÒN SỐNG và chấp nhận tạo bản ghi MỚI (không trả 404/410 "tính năng đã gỡ") — chỉ UI ẩn đi, dữ liệu vẫn tạo được nếu gọi thẳng API/script cũ');
      if (result.ok) assertEqual(result.item.status, 'CHUA_BAT_DAU', 'Kỳ mới tạo (dù qua đường "hậu môn" API) vẫn đúng trạng thái ban đầu CHUA_BAT_DAU — vào state hợp lệ, không phải request bị từ chối 1 phần');

      // Route "Bắt Đầu Kỳ" cũng còn sống tương ứng — xác nhận nốt để đủ bằng chứng "cả cặp tạo+bắt đầu" đều gọi được.
      const startResult = await page.evaluate(async (periodId) => {
        try {
          const res = await callRecordAction('operationExecutionPeriods', periodId, 'start', {});
          return { ok: true, status: res.item.status };
        } catch (err) { return { ok: false, error: err.message }; }
      }, result.item.id);
      console.log(`  >> [GAP CONFIRM] POST /operationExecutionPeriods/:id/start: ok=${startResult.ok}${startResult.ok ? `, status="${startResult.status}"` : `, error="${startResult.error}"`}`);
      assert(startResult.ok, 'Route "Bắt Đầu Kỳ" cũng vẫn hoạt động bình thường trên Kỳ vừa tạo qua đường API trực tiếp');
      assertEqual(startResult.status, 'DANG_THUC_HIEN', 'Kỳ "ma" này giờ ở trạng thái Đang thực hiện — đủ điều kiện dùng làm periodId cho công việc GỐC mới, tạo dữ liệu rác hoàn chỉnh mà UI không hề biết tính năng này còn tồn tại');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => { console.error(err); process.exit(1); });
