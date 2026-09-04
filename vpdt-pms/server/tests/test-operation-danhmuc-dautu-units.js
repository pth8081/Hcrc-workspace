// server/tests/test-operation-danhmuc-dautu-units.js
//
// Test THUẦN (không cần Playwright/SQL Server) cho đợt "Danh Mục Đầu Tư + bỏ Tạo Kỳ":
//   1. computeOperationRecordStageStatus() (lib/recordActions.js) — 5 mốc vòng đời hiển thị mới.
//   2. submitOperationEstimate() — id hạng mục ổn định qua các lần sửa, sửa lại được từ APPROVED
//      (không chỉ DRAFT), vẫn chặn khi đang REJECTED (chưa qua resetOperationEstimateToDraft()).
//   3. rejectOperationDelete() (routes/records.js) — luôn từ chối, không phụ thuộc quyền/trạng thái.
//   4. lib/operationImport.js — sinh file mẫu + đọc lại (round-trip) cho cả Danh Mục Đầu Tư lẫn Danh
//      Sách Công Việc, dò đúng tiêu đề tiếng Việt (không phân biệt hoa-thường/dấu).
//
// Chạy: node server/tests/test-operation-danhmuc-dautu-units.js
const assert = require('assert');
const recordActions = require('../lib/recordActions');
const { rejectOperationDelete } = require('../routes/records');
const {
  buildOperationEstimateTemplateWorkbook, parseOperationEstimateImportXlsx,
  buildOperationWorkItemTemplateWorkbook, parseOperationWorkItemImportXlsx
} = require('../lib/operationImport');

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

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
