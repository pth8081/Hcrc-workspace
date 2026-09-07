// server/tests/test-operation-workitem-deadline-status.js
//
// Test THUẦN (không cần Playwright/SQL Server) cho VHST-6: "Trong báo cáo phải thống kê được các đầu
// mục công việc quá hạn nhưng chưa bắt đầu, cảnh báo các công việc quá hạn nhưng chưa bắt đầu, các công
// việc quá hạn nhưng chưa kết thúc" — TÁCH RIÊNG 2 trạng thái quá hạn (trước đây gộp chung 1 trạng thái
// "LATE" ở renderOperationStoreReport(), public/js/module-vanhanh.js), hiện đồng thời ở:
//   1. Tab Báo Cáo (renderOperationStoreReport() -> renderOperationStoreReportItemStats(), thống kê +
//      cảnh báo cấp công việc).
//   2. 2 màn danh sách sống Quản Lý Công Việc/Quản Lý Nghiệm Thu (renderOperationExecutionList()/
//      renderOperationAcceptanceList(), cột "Quá Hạn" mới) + badge từng dòng trong modal cây công việc
//      (buildOperationWorkItemRow()).
//
// Hàm dùng CHUNG (ĐÚNG 1 nguồn sự thật, không lệch giữa báo cáo/2 màn danh sách sống):
// computeOperationWorkItemDeadlineStatus(item) — lib/recordActions.js — trả về 1 trong 4:
//   HOAN_THANH | QUA_HAN_CHUA_BAT_DAU | QUA_HAN_CHUA_XONG | DUNG_TIEN_DO
//
// LƯU Ý: field `deadline` trên operationWorkItem đã có SẴN từ trước VHST-6 (không phải field mới — xem
// createOperationWorkItem()/editOperationWorkItem(), UI form owiDeadline đã tồn tại) — VHST-6 CHỈ thêm
// hàm tính trạng thái quá hạn + hiển thị, KHÔNG cần field mới/KHÔNG cần migration SQL (payload JSON).
//
// Chạy: node server/tests/test-operation-workitem-deadline-status.js
const assert = require('assert');
const recordActions = require('../lib/recordActions');

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

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function isoDateOffset(n) {
  const d = daysAgo(-n); // n dương = tương lai, n âm = quá khứ (mirror isoDateDaysAgo(-n) test khác)
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isoDateDaysAgo(n) { return isoDateOffset(-n); }
function isoDateDaysAhead(n) { return isoDateOffset(n); }

const { computeOperationWorkItemDeadlineStatus } = recordActions;

// ===== 1) Deadline quá khứ + CHUA_BAT_DAU -> QUA_HAN_CHUA_BAT_DAU =====
test('deadline quá khứ (5 ngày trước) + status CHUA_BAT_DAU -> QUA_HAN_CHUA_BAT_DAU', () => {
  const item = { status: 'CHUA_BAT_DAU', deadline: isoDateDaysAgo(5) };
  assert.strictEqual(computeOperationWorkItemDeadlineStatus(item), 'QUA_HAN_CHUA_BAT_DAU');
});

// ===== 2) Deadline quá khứ + DANG_THUC_HIEN -> QUA_HAN_CHUA_XONG =====
test('deadline quá khứ (5 ngày trước) + status DANG_THUC_HIEN -> QUA_HAN_CHUA_XONG', () => {
  const item = { status: 'DANG_THUC_HIEN', deadline: isoDateDaysAgo(5) };
  assert.strictEqual(computeOperationWorkItemDeadlineStatus(item), 'QUA_HAN_CHUA_XONG');
});

// ===== 2-bis) Deadline quá khứ + DANG_NGHIEM_THU (đã nộp, chờ nghiệm thu) -> vẫn QUA_HAN_CHUA_XONG =====
test('deadline quá khứ + status DANG_NGHIEM_THU (đã nộp, chưa nghiệm thu xong) -> vẫn QUA_HAN_CHUA_XONG (chưa "kết thúc" thật sự)', () => {
  const item = { status: 'DANG_NGHIEM_THU', deadline: isoDateDaysAgo(3) };
  assert.strictEqual(computeOperationWorkItemDeadlineStatus(item), 'QUA_HAN_CHUA_XONG');
});

// ===== 3) Deadline quá khứ + DA_NGHIEM_THU -> HOAN_THANH (KHÔNG bị gắn cờ quá hạn dù deadline đã qua) ====
test('deadline quá khứ (30 ngày trước) + status DA_NGHIEM_THU -> HOAN_THANH (đã xong thì không còn cảnh báo quá hạn)', () => {
  const item = { status: 'DA_NGHIEM_THU', deadline: isoDateDaysAgo(30) };
  assert.strictEqual(computeOperationWorkItemDeadlineStatus(item), 'HOAN_THANH');
});

// ===== 4) Deadline tương lai -> DUNG_TIEN_DO bất kể status (trừ DA_NGHIEM_THU vẫn ưu tiên HOAN_THANH) ===
test('deadline ở TƯƠNG LAI (10 ngày sau) + status CHUA_BAT_DAU -> DUNG_TIEN_DO', () => {
  const item = { status: 'CHUA_BAT_DAU', deadline: isoDateDaysAhead(10) };
  assert.strictEqual(computeOperationWorkItemDeadlineStatus(item), 'DUNG_TIEN_DO');
});
test('deadline ở TƯƠNG LAI (10 ngày sau) + status DANG_THUC_HIEN -> DUNG_TIEN_DO', () => {
  const item = { status: 'DANG_THUC_HIEN', deadline: isoDateDaysAhead(10) };
  assert.strictEqual(computeOperationWorkItemDeadlineStatus(item), 'DUNG_TIEN_DO');
});
test('deadline = HÔM NAY (chưa qua hết ngày) -> DUNG_TIEN_DO (chỉ tính quá hạn khi deadline < hôm nay)', () => {
  const pad = (x) => String(x).padStart(2, '0');
  const d = new Date();
  const item = { status: 'DANG_THUC_HIEN', deadline: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
  assert.strictEqual(computeOperationWorkItemDeadlineStatus(item), 'DUNG_TIEN_DO');
});
test('deadline ở TƯƠNG LAI + status DA_NGHIEM_THU (nghiệm thu sớm) -> HOAN_THANH', () => {
  const item = { status: 'DA_NGHIEM_THU', deadline: isoDateDaysAhead(10) };
  assert.strictEqual(computeOperationWorkItemDeadlineStatus(item), 'HOAN_THANH');
});

// ===== 5) KHÔNG đặt deadline -> DUNG_TIEN_DO (không bao giờ gắn cờ quá hạn), dù status là gì =====
test('KHÔNG đặt deadline (rỗng) + status CHUA_BAT_DAU -> DUNG_TIEN_DO (không có hạn để so sánh)', () => {
  const item = { status: 'CHUA_BAT_DAU', deadline: '' };
  assert.strictEqual(computeOperationWorkItemDeadlineStatus(item), 'DUNG_TIEN_DO');
});
test('KHÔNG đặt deadline (undefined) + status DANG_THUC_HIEN -> DUNG_TIEN_DO', () => {
  const item = { status: 'DANG_THUC_HIEN' };
  assert.strictEqual(computeOperationWorkItemDeadlineStatus(item), 'DUNG_TIEN_DO');
});
test('deadline sai định dạng (không parse được) -> coi như không có deadline -> DUNG_TIEN_DO', () => {
  const item = { status: 'CHUA_BAT_DAU', deadline: '01/09/2026' };
  assert.strictEqual(computeOperationWorkItemDeadlineStatus(item), 'DUNG_TIEN_DO');
});

// ===== 6) item null/undefined -> DUNG_TIEN_DO (an toàn, không throw) =====
test('item null -> DUNG_TIEN_DO, không throw', () => {
  assert.strictEqual(computeOperationWorkItemDeadlineStatus(null), 'DUNG_TIEN_DO');
});

// ===== 7) Đếm tổng hợp (aggregate) trên 1 tập công việc — mirror ĐÚNG cách renderOperationStoreReport()/
// renderOperationStoreReportItemStats() gộp counts theo 4 trạng thái (module-vanhanh.js) =====
test('đếm tổng hợp trên 1 tập công việc trộn đủ 4 trạng thái -> cộng dồn đúng theo từng trạng thái', () => {
  const items = [
    { id: 1, status: 'CHUA_BAT_DAU', deadline: isoDateDaysAgo(5) },   // QUA_HAN_CHUA_BAT_DAU
    { id: 2, status: 'CHUA_BAT_DAU', deadline: isoDateDaysAgo(1) },   // QUA_HAN_CHUA_BAT_DAU
    { id: 3, status: 'DANG_THUC_HIEN', deadline: isoDateDaysAgo(3) },// QUA_HAN_CHUA_XONG
    { id: 4, status: 'DANG_NGHIEM_THU', deadline: isoDateDaysAgo(2) },// QUA_HAN_CHUA_XONG
    { id: 5, status: 'DA_NGHIEM_THU', deadline: isoDateDaysAgo(20) },// HOAN_THANH (dù deadline đã qua rất lâu)
    { id: 6, status: 'CHUA_BAT_DAU', deadline: isoDateDaysAhead(5) },// DUNG_TIEN_DO (chưa tới hạn)
    { id: 7, status: 'DANG_THUC_HIEN', deadline: '' }                // DUNG_TIEN_DO (không đặt hạn)
  ];
  const counts = { HOAN_THANH: 0, QUA_HAN_CHUA_BAT_DAU: 0, QUA_HAN_CHUA_XONG: 0, DUNG_TIEN_DO: 0 };
  items.forEach(w => { counts[computeOperationWorkItemDeadlineStatus(w)]++; });
  assert.strictEqual(counts.QUA_HAN_CHUA_BAT_DAU, 2, 'phải đếm đúng 2 việc quá hạn chưa bắt đầu');
  assert.strictEqual(counts.QUA_HAN_CHUA_XONG, 2, 'phải đếm đúng 2 việc quá hạn chưa hoàn thành (gồm cả DANG_NGHIEM_THU)');
  assert.strictEqual(counts.HOAN_THANH, 1, 'phải đếm đúng 1 việc đã hoàn thành (không bị gắn cờ quá hạn dù deadline đã qua)');
  assert.strictEqual(counts.DUNG_TIEN_DO, 2, 'phải đếm đúng 2 việc đúng tiến độ (1 chưa tới hạn + 1 không đặt hạn)');
  assert.strictEqual(counts.HOAN_THANH + counts.QUA_HAN_CHUA_BAT_DAU + counts.QUA_HAN_CHUA_XONG + counts.DUNG_TIEN_DO, items.length, 'tổng 4 trạng thái phải khớp đúng tổng số việc');
});

console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
if (failed) process.exitCode = 1;
