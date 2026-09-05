// server/tests/test-operation-danhmuc-dautu-units.js
//
// Test THUẦN (không cần Playwright/SQL Server) cho đợt "Danh Mục Đầu Tư + bỏ Tạo Kỳ":
//   1. computeOperationRecordStageStatus() (lib/recordActions.js) — 5 mốc vòng đời hiển thị mới.
//   2. submitOperationEstimate() — id hạng mục ổn định qua các lần sửa, sửa lại được từ APPROVED
//      (không chỉ DRAFT), vẫn chặn khi đang REJECTED (chưa qua resetOperationEstimateToDraft()).
//   3. rejectOperationDelete() (routes/records.js) — luôn từ chối, không phụ thuộc quyền/trạng thái.
//   4. lib/operationImport.js — sinh file mẫu + đọc lại (round-trip) cho cả Danh Mục Đầu Tư lẫn Danh
//      Sách Công Việc, dò đúng tiêu đề tiếng Việt (không phân biệt hoa-thường/dấu).
//   5. seedDefaults.migrateStuckOperationApprovalStatuses() — đợt "xoá hẳn Bổ Sung cho Vận Hành >
//      Siêu Thị": xác nhận hàm di trú lúc khởi động quét sạch CẢ status===PENDING (đã có từ trước) LẪN
//      status===DRAFT (mới thêm — hồ sơ CŨ lỡ bị 1 phê duyệt viên bấm "Yêu Cầu Bổ Sung" TRONG 3 ngày
//      operationStoreOpenings/operationRepairs còn qua phê duyệt đầy đủ, TRƯỚC khi Mục H bỏ hẳn phê
//      duyệt — b89d46e 2026-09-01 tới 60c473b 2026-09-04) sang APPROVED, KHÔNG đụng tới hồ sơ đã đúng
//      hoặc tới estimateStatus (Danh mục đầu tư — DRAFT ở field NÀY vẫn là trạng thái hợp lệ đang dùng).
//
// Chạy: node server/tests/test-operation-danhmuc-dautu-units.js
const assert = require('assert');
const recordActions = require('../lib/recordActions');
const { rejectOperationDelete } = require('../routes/records');
const {
  buildOperationEstimateTemplateWorkbook, parseOperationEstimateImportXlsx,
  buildOperationWorkItemTemplateWorkbook, parseOperationWorkItemImportXlsx
} = require('../lib/operationImport');

// Fake lib/recordStore.js tối thiểu — chỉ 2 hàm mà migrateStuckOperationApprovalStatuses() thực sự
// dùng (getAllRecords/withLockedRecordById), thao tác thẳng trên mảng in-memory `seed` (mutate tại
// chỗ) thay vì SQL Server thật — cùng kỹ thuật require.cache đã dùng ở
// tests/test-operation-workitem-sourceid-schema.js (mock '../db'), áp dụng cho '../lib/recordStore' vì
// đó là lớp mà seedDefaults.js trực tiếp gọi tới (không cần giả lập sâu tới tận sql.Transaction).
function makeFakeRecordStore(seed) {
  return {
    async getAllRecords(collection) { return seed[collection] || []; },
    async withLockedRecordById(collection, id, mutatorFn) {
      const arr = seed[collection] || [];
      const idx = arr.findIndex(r => r.id === id);
      if (idx === -1) throw new Error(`fakeRecordStore: không tìm thấy ${collection}#${id}`);
      arr[idx] = await mutatorFn(arr[idx]);
      return arr[idx];
    },
    async migrateAllLegacyCollections() {} // không dùng tới trong test này, chỉ cần tồn tại
  };
}
// requireFreshMigrationFn(): mock '../lib/recordStore' rồi require lại '../seedDefaults' TỪ ĐẦU (xoá
// cache 2 module) để lấy đúng bản migrateStuckOperationApprovalStatuses() đang chạy trên `seed` giả —
// PHẢI dọn cache lại ngay sau khi dùng xong (return cleanup()) để không rò module giả sang test khác.
function requireFreshMigrationFn(seed) {
  const recordStorePath = require.resolve('../lib/recordStore');
  const seedDefaultsPath = require.resolve('../seedDefaults');
  require.cache[recordStorePath] = { id: recordStorePath, filename: recordStorePath, loaded: true, exports: makeFakeRecordStore(seed) };
  delete require.cache[seedDefaultsPath];
  const { migrateStuckOperationApprovalStatuses } = require('../seedDefaults');
  return {
    migrateStuckOperationApprovalStatuses,
    cleanup: () => { delete require.cache[recordStorePath]; delete require.cache[seedDefaultsPath]; }
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}

// ===================== 1) computeOperationRecordStageStatus =====================
test('computeOperationRecordStageStatus: hồ sơ mới, chưa có gì -> LAP', () => {
  const record = { estimateStatus: 'DRAFT', estimateItems: [] };
  assert.strictEqual(recordActions.computeOperationRecordStageStatus(record, []), 'LAP');
});
test('computeOperationRecordStageStatus: đã lưu Danh mục đầu tư (APPROVED, có hạng mục), chưa có công việc -> DANH_MUC_DAU_TU', () => {
  const record = { estimateStatus: 'APPROVED', estimateItems: [{ id: 1, content: 'A', amount: 100 }] };
  assert.strictEqual(recordActions.computeOperationRecordStageStatus(record, []), 'DANH_MUC_DAU_TU');
});
test('computeOperationRecordStageStatus: estimateStatus APPROVED nhưng estimateItems rỗng -> vẫn LAP (chưa thực sự có danh mục)', () => {
  const record = { estimateStatus: 'APPROVED', estimateItems: [] };
  assert.strictEqual(recordActions.computeOperationRecordStageStatus(record, []), 'LAP');
});
test('computeOperationRecordStageStatus: đã có ít nhất 1 công việc, chưa nghiệm thu hết -> DANH_SACH_CONG_VIEC', () => {
  const record = { estimateStatus: 'APPROVED', estimateItems: [{ id: 1, content: 'A', amount: 100 }] };
  const items = [{ status: 'CHUA_BAT_DAU' }, { status: 'DANG_THUC_HIEN' }];
  assert.strictEqual(recordActions.computeOperationRecordStageStatus(record, items), 'DANH_SACH_CONG_VIEC');
});
test('computeOperationRecordStageStatus: TOÀN BỘ công việc (cha lẫn con) đã Đã nghiệm thu -> NGHIEM_THU', () => {
  const record = { estimateStatus: 'APPROVED', estimateItems: [{ id: 1, content: 'A', amount: 100 }] };
  const items = [
    { id: 1, parentWorkItemId: null, status: 'DA_NGHIEM_THU' },
    { id: 2, parentWorkItemId: 1, status: 'DA_NGHIEM_THU' },
    { id: 3, parentWorkItemId: 1, status: 'DA_NGHIEM_THU' }
  ];
  assert.strictEqual(recordActions.computeOperationRecordStageStatus(record, items), 'NGHIEM_THU');
});
test('computeOperationRecordStageStatus: 1 công việc con còn dở -> KHÔNG phải NGHIEM_THU (vẫn DANH_SACH_CONG_VIEC)', () => {
  const record = { estimateStatus: 'APPROVED', estimateItems: [{ id: 1, content: 'A', amount: 100 }] };
  const items = [
    { id: 1, parentWorkItemId: null, status: 'DA_NGHIEM_THU' },
    { id: 2, parentWorkItemId: 1, status: 'DANG_NGHIEM_THU' }
  ];
  assert.strictEqual(recordActions.computeOperationRecordStageStatus(record, items), 'DANH_SACH_CONG_VIEC');
});
test('computeOperationRecordStageStatus: useConfirmStatus CONFIRMED -> DONG_HO_SO (ưu tiên cao nhất, bất kể state khác)', () => {
  const record = { estimateStatus: 'APPROVED', estimateItems: [{ id: 1 }], useConfirmStatus: 'CONFIRMED' };
  const items = [{ status: 'DA_NGHIEM_THU' }];
  assert.strictEqual(recordActions.computeOperationRecordStageStatus(record, items), 'DONG_HO_SO');
});
test('OPERATION_STAGE_LABELS: đúng 5 nhãn tiếng Việt theo yêu cầu người dùng', () => {
  const labels = recordActions.OPERATION_STAGE_LABELS;
  assert.strictEqual(labels.LAP, 'Hồ sơ đã lập');
  assert.strictEqual(labels.DANH_MUC_DAU_TU, 'Đã lập danh mục đầu tư');
  assert.strictEqual(labels.DANH_SACH_CONG_VIEC, 'Đã lập danh sách công việc');
  assert.strictEqual(labels.NGHIEM_THU, 'Đã nghiệm thu');
  assert.strictEqual(labels.DONG_HO_SO, 'Đóng hồ sơ và đưa vào sử dụng');
});

// ===================== 1b) computeParentWorkItemStatus (đợt sửa theo phản hồi người dùng, correction 1
//    — cascade cha-con: "cv con hoàn thành sẽ tự động hoàn thành cv cha, cv con nghiệm thu xong hết sẽ
//    hoàn thành nghiệm thu cv cha") =====================
test('computeParentWorkItemStatus: không có con -> CHUA_BAT_DAU', () => {
  assert.strictEqual(recordActions.computeParentWorkItemStatus([]), 'CHUA_BAT_DAU');
});
test('computeParentWorkItemStatus: mọi con vẫn CHUA_BAT_DAU -> cha CHUA_BAT_DAU', () => {
  const children = [{ status: 'CHUA_BAT_DAU' }, { status: 'CHUA_BAT_DAU' }];
  assert.strictEqual(recordActions.computeParentWorkItemStatus(children), 'CHUA_BAT_DAU');
});
test('computeParentWorkItemStatus: có ít nhất 1 con đã bắt đầu (chưa hoàn thành hết) -> cha DANG_THUC_HIEN', () => {
  const children = [{ status: 'DANG_THUC_HIEN' }, { status: 'CHUA_BAT_DAU' }];
  assert.strictEqual(recordActions.computeParentWorkItemStatus(children), 'DANG_THUC_HIEN');
});
test('computeParentWorkItemStatus: 1 con đã "hoàn thành" (DANG_NGHIEM_THU) nhưng con kia còn dở -> cha VẪN DANG_THUC_HIEN (chưa được nhảy sớm)', () => {
  const children = [{ status: 'DANG_NGHIEM_THU' }, { status: 'DANG_THUC_HIEN' }];
  assert.strictEqual(recordActions.computeParentWorkItemStatus(children), 'DANG_THUC_HIEN');
});
test('computeParentWorkItemStatus: TẤT CẢ con đã "hoàn thành" (DANG_NGHIEM_THU) nhưng CHƯA nghiệm thu hết -> cha TỰ ĐỘNG "hoàn thành" (DANG_NGHIEM_THU) — ĐÚNG "cv con hoàn thành sẽ tự động hoàn thành cv cha"', () => {
  const children = [{ status: 'DANG_NGHIEM_THU' }, { status: 'DANG_NGHIEM_THU' }];
  assert.strictEqual(recordActions.computeParentWorkItemStatus(children), 'DANG_NGHIEM_THU');
});
test('computeParentWorkItemStatus: TẤT CẢ con đã hoàn thành, TRỘN LẪN DANG_NGHIEM_THU và DA_NGHIEM_THU (1 con đã nghiệm thu xong sớm hơn) -> cha vẫn "hoàn thành" (DANG_NGHIEM_THU), CHƯA nghiệm thu vì còn 1 con chưa nghiệm thu', () => {
  const children = [{ status: 'DA_NGHIEM_THU' }, { status: 'DANG_NGHIEM_THU' }];
  assert.strictEqual(recordActions.computeParentWorkItemStatus(children), 'DANG_NGHIEM_THU');
});
test('computeParentWorkItemStatus: TẤT CẢ con đã DA_NGHIEM_THU -> cha TỰ ĐỘNG DA_NGHIEM_THU luôn (bỏ qua bước nghiệm thu riêng cho cha) — ĐÚNG "cv con nghiệm thu xong hết sẽ hoàn thành nghiệm thu cv cha"', () => {
  const children = [{ status: 'DA_NGHIEM_THU' }, { status: 'DA_NGHIEM_THU' }, { status: 'DA_NGHIEM_THU' }];
  assert.strictEqual(recordActions.computeParentWorkItemStatus(children), 'DA_NGHIEM_THU');
});

// ===================== 1c) computeOperationRecordStageStatus — gate "Đưa vào sử dụng"/NGHIEM_THU vẫn
//    đòi ĐÚNG DA_NGHIEM_THU trên toàn bộ cây, không bị "hoàn thành" (DANG_NGHIEM_THU) cascade đánh lừa
//    thành xong (xác nhận gate KHÔNG bị cascade mới làm lỏng lẻo) =====================
test('computeOperationRecordStageStatus: cha đã cascade "hoàn thành" (DANG_NGHIEM_THU) nhưng CHƯA "nghiệm thu" -> vẫn DANH_SACH_CONG_VIEC, KHÔNG phải NGHIEM_THU', () => {
  const record = { estimateStatus: 'APPROVED', estimateItems: [{ id: 1 }] };
  const items = [
    { id: 1, parentWorkItemId: null, status: 'DANG_NGHIEM_THU' }, // cha vừa cascade "hoàn thành"
    { id: 2, parentWorkItemId: 1, status: 'DANG_NGHIEM_THU' },
    { id: 3, parentWorkItemId: 1, status: 'DANG_NGHIEM_THU' }
  ];
  assert.strictEqual(recordActions.computeOperationRecordStageStatus(record, items), 'DANH_SACH_CONG_VIEC');
});

// ===================== 2) submitOperationEstimate =====================
const ESTIMATOR = { username: 'est1', name: 'Người Lập', perms: { operationEstimateCreate: true } };
test('submitOperationEstimate: lần lưu đầu (DRAFT) -> APPROVED, mỗi hạng mục được gán id', () => {
  const item = { estimateStatus: 'DRAFT', estimateItems: [], estimateHistory: [] };
  const result = recordActions.submitOperationEstimate(ESTIMATOR, item, { items: [{ content: 'A', amount: 100 }, { content: 'B', amount: 200 }] });
  assert.strictEqual(result.estimateStatus, 'APPROVED');
  assert.strictEqual(result.estimateItems.length, 2);
  assert(result.estimateItems[0].id != null, 'Hạng mục 1 phải có id');
  assert(result.estimateItems[1].id != null, 'Hạng mục 2 phải có id');
  assert.notStrictEqual(result.estimateItems[0].id, result.estimateItems[1].id, 'id 2 hạng mục không được trùng nhau');
});
test('submitOperationEstimate: sửa lại từ APPROVED (không chỉ DRAFT) -> vẫn APPROVED, id giữ nguyên khi gửi lại đúng id cũ', () => {
  const item = { estimateStatus: 'DRAFT', estimateItems: [], estimateHistory: [] };
  const first = recordActions.submitOperationEstimate(ESTIMATOR, item, { items: [{ content: 'A', amount: 100 }] });
  const keepId = first.estimateItems[0].id;
  const second = recordActions.submitOperationEstimate(ESTIMATOR, item, {
    items: [{ id: keepId, content: 'A sửa lại', amount: 150 }, { content: 'C mới', amount: 50 }]
  });
  assert.strictEqual(second.estimateStatus, 'APPROVED', 'Phải cho lưu lại từ APPROVED, không còn là ngõ cụt');
  assert.strictEqual(second.estimateItems.length, 2);
  assert.strictEqual(second.estimateItems[0].id, keepId, 'id hạng mục giữ nguyên phải KHÔNG đổi');
  assert.strictEqual(second.estimateItems[0].content, 'A sửa lại');
  assert.strictEqual(second.estimateItems[1].content, 'C mới');
  assert.notStrictEqual(second.estimateItems[1].id, keepId, 'Hạng mục mới thêm phải có id KHÁC hạng mục cũ');
  assert.strictEqual(second.estimateTotalAmount, 200, 'Tổng phải tính lại theo danh sách MỚI (150+50)');
});
test('submitOperationEstimate: đang REJECTED (dữ liệu cũ trước Mục H) vẫn bị chặn — phải qua resetOperationEstimateToDraft() trước', () => {
  const item = { estimateStatus: 'REJECTED', estimateItems: [], estimateHistory: [] };
  assert.throws(() => recordActions.submitOperationEstimate(ESTIMATOR, item, { items: [{ content: 'A', amount: 100 }] }), /không ở trạng thái cần lập/);
});
test('submitOperationEstimate: thiếu quyền operationEstimateCreate -> 403', () => {
  const item = { estimateStatus: 'DRAFT', estimateItems: [], estimateHistory: [] };
  assert.throws(() => recordActions.submitOperationEstimate({ username: 'x', perms: {} }, item, { items: [{ content: 'A', amount: 100 }] }), /không có quyền/);
});

// ===================== 2b) Correction 2 — "Ngân Sách Phê Duyệt" (approvedBudget): field RIÊNG, bắt
//    buộc nhập lúc lập hồ sơ operationStoreOpenings/operationRepairs, ĐỘC LẬP với estimatedBudget/amount
//    (extraValidate ở lib/createValidation.js, qua CREATE_MODULE_CONFIGS) =====================
const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');
const OP_CREATE_USER = { username: 'x', perms: { operationStoreOpenCreate: true, operationRepairCreate: true } };
test('operationStoreOpenings.extraValidate: thiếu approvedBudget -> throw rõ ràng', () => {
  const payload = { storeName: 'A', address: 'B', area: 1, estimatedBudget: 1 };
  assert.throws(() => CREATE_MODULE_CONFIGS.operationStoreOpenings.extraValidate(payload, 'operationStoreOpenings', OP_CREATE_USER, {}), /Ngân sách phê duyệt/);
});
test('operationStoreOpenings.extraValidate: approvedBudget âm -> throw', () => {
  const payload = { storeName: 'A', address: 'B', area: 1, estimatedBudget: 1, approvedBudget: -1 };
  assert.throws(() => CREATE_MODULE_CONFIGS.operationStoreOpenings.extraValidate(payload, 'operationStoreOpenings', OP_CREATE_USER, {}), /không hợp lệ/);
});
test('operationStoreOpenings.extraValidate: approvedBudget hợp lệ -> payload.approvedBudget ĐÚNG số đã nhập, ĐỘC LẬP với estimatedBudget', () => {
  const payload = { storeName: 'A', address: 'B', area: 1, estimatedBudget: 999, approvedBudget: 12345 };
  CREATE_MODULE_CONFIGS.operationStoreOpenings.extraValidate(payload, 'operationStoreOpenings', OP_CREATE_USER, {});
  assert.strictEqual(payload.approvedBudget, 12345);
  assert.strictEqual(payload.estimatedBudget, 999, 'estimatedBudget phải GIỮ NGUYÊN, không bị approvedBudget ghi đè');
});
test('operationRepairs.extraValidate: thiếu approvedBudget -> throw rõ ràng', () => {
  const payload = { storeName: 'A', title: 'B', amount: 1 };
  assert.throws(() => CREATE_MODULE_CONFIGS.operationRepairs.extraValidate(payload, 'operationRepairs', OP_CREATE_USER, {}), /Ngân sách phê duyệt/);
});
test('operationRepairs.extraValidate: approvedBudget hợp lệ -> payload.approvedBudget ĐÚNG số đã nhập, ĐỘC LẬP với amount', () => {
  const payload = { storeName: 'A', title: 'B', amount: 999, approvedBudget: 54321 };
  CREATE_MODULE_CONFIGS.operationRepairs.extraValidate(payload, 'operationRepairs', OP_CREATE_USER, {});
  assert.strictEqual(payload.approvedBudget, 54321);
  assert.strictEqual(payload.amount, 999, 'amount phải GIỮ NGUYÊN, không bị approvedBudget ghi đè');
});

// ===================== 2c) Correction 3 — updateOperationWorkItemProgress() nhận thêm note tuỳ chọn
//    (mirror #taskProgressModal — "Ghi chú tiến độ") =====================
test('updateOperationWorkItemProgress: có note -> ghi vào history entry mới nhất', () => {
  const user = { username: 'u1', name: 'User 1', perms: { operationExecutionManage: true } };
  const item = { status: 'CHUA_BAT_DAU', history: [] };
  const result = recordActions.updateOperationWorkItemProgress(user, item, [], 'DANG_THUC_HIEN', 'Đã bắt đầu khảo sát hiện trường');
  const last = result.history[result.history.length - 1];
  assert.strictEqual(last.note, 'Đã bắt đầu khảo sát hiện trường');
});
test('updateOperationWorkItemProgress: không có note -> history entry KHÔNG có field note (không ghi rác chuỗi rỗng)', () => {
  const user = { username: 'u1', name: 'User 1', perms: { operationExecutionManage: true } };
  const item = { status: 'CHUA_BAT_DAU', history: [] };
  const result = recordActions.updateOperationWorkItemProgress(user, item, [], 'DANG_THUC_HIEN');
  const last = result.history[result.history.length - 1];
  assert.strictEqual(last.note, undefined);
});

// ===================== 3) rejectOperationDelete =====================
test('rejectOperationDelete: LUÔN trả 403, không phụ thuộc quyền/trạng thái req', () => {
  let statusCode = null, body = null;
  const fakeRes = { status(code) { statusCode = code; return this; }, json(b) { body = b; return this; } };
  rejectOperationDelete({ freshUser: { perms: { admin: true } } }, fakeRes);
  assert.strictEqual(statusCode, 403);
  assert(/không được phép xoá/.test(body.error));
});

// ===================== 4) lib/operationImport.js — round-trip mẫu Excel =====================
async function bufferOf(workbook) {
  return workbook.xlsx.writeBuffer();
}
async function main() {
  await testAsync('operationImport: mẫu Danh Mục Đầu Tư sinh ra + đọc lại đúng dòng ví dụ (round-trip)', async () => {
    const wb = await buildOperationEstimateTemplateWorkbook();
    const buf = await bufferOf(wb);
    const items = await parseOperationEstimateImportXlsx(buf);
    assert.strictEqual(items.length, 1);
    assert(items[0].content.includes('Kệ trưng bày'));
    assert.strictEqual(items[0].amount, 20000000);
  });

  await testAsync('operationImport: đọc file Danh Mục Đầu Tư tự soạn, tiêu đề không dấu/khác hoa-thường vẫn dò đúng cột', async () => {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Sheet1');
    sheet.addRow(['noi DUNG', 'MO ta', 'chi phi (vnd)', 'luu y']);
    sheet.addRow(['Kệ inox', 'Loại 2 tầng', '15.000.000', 'Giao trong tuần']);
    sheet.addRow(['Sơn tường', '', 5000000, '']);
    const buf = await bufferOf(wb);
    const items = await parseOperationEstimateImportXlsx(buf);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].content, 'Kệ inox');
    assert.strictEqual(items[0].amount, 15000000, 'Phải đọc đúng "15.000.000" (dấu chấm phân cách hàng nghìn kiểu VN) = 15 triệu');
    assert.strictEqual(items[1].amount, 5000000);
  });

  await testAsync('operationImport: mẫu Danh Sách Công Việc sinh ra + đọc lại đúng dòng ví dụ (round-trip)', async () => {
    const wb = await buildOperationWorkItemTemplateWorkbook();
    const buf = await bufferOf(wb);
    const rows = await parseOperationWorkItemImportXlsx(buf);
    assert.strictEqual(rows.length, 1);
    assert(rows[0].title.includes('Thi công mặt bằng'));
    assert.deepStrictEqual(rows[0].assignedTo, ['username1', 'username2']);
    assert.strictEqual(rows[0].acceptorUsername, 'username3');
    assert.strictEqual(rows[0].deadline, '2026-12-31');
  });

  await testAsync('operationImport: Danh Mục Đầu Tư — file trống (không có dòng nội dung hợp lệ) bị từ chối', async () => {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['Nội Dung', 'Mô Tả', 'Chi Phí (VNĐ)', 'Lưu Ý']);
    const buf = await bufferOf(wb);
    await assert.rejects(() => parseOperationEstimateImportXlsx(buf), /Không đọc được hạng mục/);
  });

  // ===== 5) seedDefaults.migrateStuckOperationApprovalStatuses() =====
  await testAsync('migrateStuckOperationApprovalStatuses(): hồ sơ CŨ kẹt DRAFT (Yêu Cầu Bổ Sung, trước Mục H) -> APPROVED, ghi SYSTEM_MIGRATION, KHÔNG đụng estimateStatus đã đúng', async () => {
    const seed = {
      operationStoreOpenings: [
        { id: 1, code: 'MM-OLD1', status: 'DRAFT', currentStep: 1,
          history: [{ step: 1, approver: 'Trưởng phòng', username: 'tp1', action: 'REQUEST_CHANGES', comment: 'Sửa lại địa chỉ', time: '01/09/2026 10:00:00' }],
          estimateStatus: 'APPROVED', estimateHistory: [] },
        { id: 2, code: 'MM-OK', status: 'APPROVED', currentStep: 0, history: [],
          estimateStatus: 'DRAFT', estimateHistory: [] } // hồ sơ bình thường (estimateStatus DRAFT = đang lập, HỢP LỆ) — không được đụng tới
      ],
      operationRepairs: []
    };
    const { migrateStuckOperationApprovalStatuses, cleanup } = requireFreshMigrationFn(seed);
    try {
      await migrateStuckOperationApprovalStatuses();
    } finally { cleanup(); }

    const mm1 = seed.operationStoreOpenings.find(r => r.id === 1);
    assert.strictEqual(mm1.status, 'APPROVED', 'Hồ sơ Mở Mới cũ kẹt DRAFT phải được chuyển sang APPROVED');
    assert.strictEqual(mm1.currentStep, 0, 'currentStep phải reset về 0 cùng lúc chuyển APPROVED');
    assert(mm1.history.some(h => h.action === 'SYSTEM_MIGRATION'), 'Phải ghi thêm 1 dòng lịch sử SYSTEM_MIGRATION');
    assert.strictEqual(mm1.estimateStatus, 'APPROVED', 'estimateStatus vốn đã APPROVED — không bị đụng lại (không phải nhánh PENDING)');
    assert.strictEqual(mm1.estimateHistory.length, 0, 'estimateHistory không liên quan phải giữ nguyên rỗng');

    const mm2 = seed.operationStoreOpenings.find(r => r.id === 2);
    assert.strictEqual(mm2.status, 'APPROVED', 'Hồ sơ đã APPROVED sẵn không đổi (idempotent)');
    assert.strictEqual(mm2.history.length, 0, 'Không thêm lịch sử cho hồ sơ vốn đã đúng, không ở DRAFT/PENDING');
    assert.strictEqual(mm2.estimateStatus, 'DRAFT', 'estimateStatus===DRAFT là trạng thái Danh mục đầu tư đang lập, HỢP LỆ — di trú CHỈ quét status (hồ sơ chính) ở DRAFT, KHÔNG được đụng vào estimateStatus DRAFT');
  });

  await testAsync('migrateStuckOperationApprovalStatuses(): 1 hồ sơ vừa kẹt DRAFT (hồ sơ chính) VỪA kẹt PENDING (Danh mục đầu tư) -> cả 2 field cùng chuyển APPROVED trong 1 lượt', async () => {
    const seed = {
      operationStoreOpenings: [],
      operationRepairs: [
        { id: 3, code: 'SC-OLD1', status: 'DRAFT', currentStep: 1, history: [],
          estimateStatus: 'PENDING', estimateCurrentStep: 1, estimateHistory: [] }
      ]
    };
    const { migrateStuckOperationApprovalStatuses, cleanup } = requireFreshMigrationFn(seed);
    try {
      await migrateStuckOperationApprovalStatuses();
    } finally { cleanup(); }

    const sc1 = seed.operationRepairs.find(r => r.id === 3);
    assert.strictEqual(sc1.status, 'APPROVED', 'Hồ sơ Sửa Chữa cũ kẹt DRAFT (hồ sơ chính) phải chuyển sang APPROVED');
    assert.strictEqual(sc1.estimateStatus, 'APPROVED', 'estimateStatus kẹt PENDING (Danh mục đầu tư) phải CŨNG được chuyển sang APPROVED (nhánh PENDING đã có từ trước)');
    assert.strictEqual(sc1.estimateCurrentStep, 0);
    assert(sc1.estimateHistory.some(h => h.action === 'SYSTEM_MIGRATION'), 'estimateHistory phải ghi lại SYSTEM_MIGRATION cho nhánh estimateStatus PENDING');
    assert(sc1.history.some(h => h.action === 'SYSTEM_MIGRATION'), 'history phải ghi lại SYSTEM_MIGRATION cho nhánh status DRAFT');
  });

  await testAsync('migrateStuckOperationApprovalStatuses(): không còn hồ sơ DRAFT/PENDING nào -> idempotent, không throw, không đổi gì', async () => {
    const seed = {
      operationStoreOpenings: [{ id: 10, code: 'MM-CLEAN', status: 'APPROVED', currentStep: 0, history: [], estimateStatus: 'APPROVED', estimateHistory: [] }],
      operationRepairs: []
    };
    const { migrateStuckOperationApprovalStatuses, cleanup } = requireFreshMigrationFn(seed);
    try {
      await migrateStuckOperationApprovalStatuses();
    } finally { cleanup(); }
    assert.strictEqual(seed.operationStoreOpenings[0].status, 'APPROVED');
    assert.strictEqual(seed.operationStoreOpenings[0].history.length, 0, 'Không được thêm lịch sử khi không có gì cần di trú');
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
