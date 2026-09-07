// server/tests/test-operation-workitem-progress-frequency.js
//
// Test THUẦN (không cần Playwright/SQL Server) cho tính năng VHST-4 "Ngày bắt đầu + Tần suất cập nhật
// tiến độ" (dbo.OperationWorkItems, JSON Payload — KHÔNG cần migration SQL, chỉ 2 field mới startDate/
// progressUpdateFrequencyDays trong payload):
//   1. resolveOperationWorkItemScheduleFields() (lib/recordActions.js) — validate format startDate/
//      progressUpdateFrequencyDays, chặn set trên công việc CÓ CON (hasChildren=true), tự "dọn sạch" 2
//      field này về null khi hasChildren=true mà payload không gửi gì (đúng hành vi UI ẩn field).
//   2. createOperationWorkItem()/editOperationWorkItem() — tích hợp 2 field mới đúng luồng thật.
//   3. computeOperationWorkItemProgressUpdateOverdueDays() — cảnh báo THỤ ĐỘNG "quá hạn cập nhật tiến
//      độ", tính từ item.history (action STATUS_*, tái sử dụng ĐÚNG cơ chế "📜 Lịch Sử" có sẵn) — đủ 5
//      kịch bản theo yêu cầu: (a) chưa từng cập nhật + đã quá hạn kể từ startDate, (b) vừa cập nhật gần
//      đây (chưa quá hạn), (c) cập nhật đã lâu (quá hạn), (d) không cấu hình frequency (không bao giờ
//      cảnh báo), (e) startDate ở TƯƠNG LAI (chưa tới ngày bắt đầu, không cảnh báo dù history thế nào).
//
// Chạy: node server/tests/test-operation-workitem-progress-frequency.js
const assert = require('assert');
const recordActions = require('../lib/recordActions');
const { HttpError } = require('../lib/httpErrors');

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

function assertThrowsHttp(fn, statusCode, messageIncludes) {
  try {
    fn();
  } catch (err) {
    assert(err instanceof HttpError, `Phải throw HttpError, nhận được: ${err && err.constructor && err.constructor.name}`);
    if (statusCode) assert.strictEqual(err.statusCode ?? err.status, statusCode, `statusCode phải là ${statusCode}, nhận được ${err.statusCode ?? err.status}`);
    if (messageIncludes) assert(err.message.includes(messageIncludes), `Message "${err.message}" phải chứa "${messageIncludes}"`);
    return;
  }
  assert.fail('Phải throw lỗi nhưng không throw gì');
}

// ===== 1) resolveOperationWorkItemScheduleFields() =====
test('resolveOperationWorkItemScheduleFields(): không gửi gì (create) -> {null, null}, không throw', () => {
  const r = recordActions.resolveOperationWorkItemScheduleFields({}, false);
  assert.strictEqual(r.startDate, null);
  assert.strictEqual(r.progressUpdateFrequencyDays, null);
});

test('resolveOperationWorkItemScheduleFields(): startDate + progressUpdateFrequencyDays hợp lệ, hasChildren=false -> lưu đúng', () => {
  const r = recordActions.resolveOperationWorkItemScheduleFields({ startDate: '2026-09-01', progressUpdateFrequencyDays: 3 }, false);
  assert.strictEqual(r.startDate, '2026-09-01');
  assert.strictEqual(r.progressUpdateFrequencyDays, 3);
});

test('resolveOperationWorkItemScheduleFields(): startDate sai định dạng bị từ chối (400)', () => {
  assertThrowsHttp(() => recordActions.resolveOperationWorkItemScheduleFields({ startDate: '01/09/2026' }, false), 400, 'Ngày bắt đầu không hợp lệ');
});

test('resolveOperationWorkItemScheduleFields(): progressUpdateFrequencyDays không phải số nguyên dương bị từ chối (400)', () => {
  assertThrowsHttp(() => recordActions.resolveOperationWorkItemScheduleFields({ progressUpdateFrequencyDays: 0 }, false), 400, 'số nguyên dương');
  assertThrowsHttp(() => recordActions.resolveOperationWorkItemScheduleFields({ progressUpdateFrequencyDays: -2 }, false), 400, 'số nguyên dương');
  assertThrowsHttp(() => recordActions.resolveOperationWorkItemScheduleFields({ progressUpdateFrequencyDays: 1.5 }, false), 400, 'số nguyên dương');
});

test('resolveOperationWorkItemScheduleFields(): hasChildren=true + payload CÓ gửi startDate/frequency -> từ chối (400, đúng "chỉ áp dụng công việc lá")', () => {
  assertThrowsHttp(() => recordActions.resolveOperationWorkItemScheduleFields({ startDate: '2026-09-01' }, true), 400, 'công việc lá');
  assertThrowsHttp(() => recordActions.resolveOperationWorkItemScheduleFields({ progressUpdateFrequencyDays: 5 }, true), 400, 'công việc lá');
});

test('resolveOperationWorkItemScheduleFields(): hasChildren=true + payload KHÔNG gửi gì -> {null, null} (tự dọn sạch, không throw — đúng hành vi UI ẩn field/item vừa có thêm con)', () => {
  const r = recordActions.resolveOperationWorkItemScheduleFields({}, true);
  assert.strictEqual(r.startDate, null);
  assert.strictEqual(r.progressUpdateFrequencyDays, null);
});

// ===== 2) Tích hợp createOperationWorkItem()/editOperationWorkItem() =====
const ADMIN_USER = { username: 'admin', name: 'Admin', perms: { admin: true } };
const SOURCE_RECORD = { id: 1, creator: 'someone_else', estimateStatus: 'APPROVED', useConfirmStatus: null, code: 'MM-TEST' };

test('createOperationWorkItem(): tạo công việc LÁ (gốc) với startDate + progressUpdateFrequencyDays -> lưu đúng vào item', () => {
  const item = recordActions.createOperationWorkItem(
    ADMIN_USER,
    { title: 'Việc test tần suất', startDate: '2026-08-01', progressUpdateFrequencyDays: 3 },
    SOURCE_RECORD, [], [], [], 'OPERATION_STORE_OPENING'
  );
  assert.strictEqual(item.startDate, '2026-08-01');
  assert.strictEqual(item.progressUpdateFrequencyDays, 3);
});

test('createOperationWorkItem(): không gửi startDate/frequency -> null (optional, tương thích ngược với item cũ)', () => {
  const item = recordActions.createOperationWorkItem(
    ADMIN_USER, { title: 'Việc không cấu hình tần suất' }, SOURCE_RECORD, [], [], [], 'OPERATION_STORE_OPENING'
  );
  assert.strictEqual(item.startDate, null);
  assert.strictEqual(item.progressUpdateFrequencyDays, null);
});

test('editOperationWorkItem(): sửa công việc LÁ (hasChildren=false) — set được startDate/progressUpdateFrequencyDays', () => {
  const item = { id: 1, sourceType: 'OPERATION_STORE_OPENING', status: 'CHUA_BAT_DAU', history: [] };
  const updated = recordActions.editOperationWorkItem(
    ADMIN_USER, item, { title: 'Việc lá', startDate: '2026-09-10', progressUpdateFrequencyDays: 5 }, [], SOURCE_RECORD, false
  );
  assert.strictEqual(updated.startDate, '2026-09-10');
  assert.strictEqual(updated.progressUpdateFrequencyDays, 5);
});

test('editOperationWorkItem(): sửa công việc CÓ CON (hasChildren=true) + cố gửi startDate -> bị từ chối (400)', () => {
  const item = { id: 2, sourceType: 'OPERATION_STORE_OPENING', status: 'CHUA_BAT_DAU', history: [] };
  assertThrowsHttp(() => recordActions.editOperationWorkItem(
    ADMIN_USER, item, { title: 'Việc cha', startDate: '2026-09-10' }, [], SOURCE_RECORD, true
  ), 400, 'công việc lá');
});

test('editOperationWorkItem(): item ĐÃ có startDate/frequency từ lúc còn là LÁ, sau đó có thêm con (hasChildren=true) + sửa KHÔNG gửi lại 2 field -> tự động dọn sạch về null', () => {
  const item = { id: 3, sourceType: 'OPERATION_STORE_OPENING', status: 'CHUA_BAT_DAU', history: [], startDate: '2026-08-01', progressUpdateFrequencyDays: 3 };
  const updated = recordActions.editOperationWorkItem(
    ADMIN_USER, item, { title: 'Việc vừa lên chức làm cha' }, [], SOURCE_RECORD, true
  );
  assert.strictEqual(updated.startDate, null, 'startDate phải tự dọn sạch khi item không còn là lá');
  assert.strictEqual(updated.progressUpdateFrequencyDays, null, 'progressUpdateFrequencyDays phải tự dọn sạch khi item không còn là lá');
});

// ===== 3) computeOperationWorkItemProgressUpdateOverdueDays() =====
// nowVN()-style time string ("HH:MM:SS D/M/YYYY") — daysAgo(N) trả về mốc N ngày trước THỜI ĐIỂM CHẠY
// TEST (để test luôn đúng bất kể ngày chạy thật).
function vnTimeString(date) {
  return date.toLocaleString('vi-VN');
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function isoDateDaysAgo(n) {
  const d = daysAgo(n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test('computeOperationWorkItemProgressUpdateOverdueDays(): hasChildren=true -> luôn null (không bao giờ cảnh báo đầu mục tổ chức)', () => {
  const item = { status: 'DANG_THUC_HIEN', startDate: isoDateDaysAgo(30), progressUpdateFrequencyDays: 3, history: [] };
  assert.strictEqual(recordActions.computeOperationWorkItemProgressUpdateOverdueDays(item, true), null);
});

test('computeOperationWorkItemProgressUpdateOverdueDays(): status DA_NGHIEM_THU -> luôn null (đã nghiệm thu xong, không còn cần cập nhật)', () => {
  const item = { status: 'DA_NGHIEM_THU', startDate: isoDateDaysAgo(30), progressUpdateFrequencyDays: 3, history: [] };
  assert.strictEqual(recordActions.computeOperationWorkItemProgressUpdateOverdueDays(item, false), null);
});

// (d) không cấu hình frequency -> không bao giờ cảnh báo.
test('(d) computeOperationWorkItemProgressUpdateOverdueDays(): KHÔNG có progressUpdateFrequencyDays -> null dù startDate đã rất lâu, dù không có history', () => {
  const item = { status: 'DANG_THUC_HIEN', startDate: isoDateDaysAgo(100), progressUpdateFrequencyDays: null, history: [] };
  assert.strictEqual(recordActions.computeOperationWorkItemProgressUpdateOverdueDays(item, false), null);
});

// (e) startDate tương lai -> không bao giờ cảnh báo, kể cả có history đã lâu.
test('(e) computeOperationWorkItemProgressUpdateOverdueDays(): startDate ở TƯƠNG LAI -> null bất kể history (chưa tới ngày bắt đầu)', () => {
  const d = new Date(); d.setDate(d.getDate() + 10);
  const pad = (x) => String(x).padStart(2, '0');
  const futureIso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const item = {
    status: 'DANG_THUC_HIEN', startDate: futureIso, progressUpdateFrequencyDays: 1,
    history: [{ action: 'STATUS_DANG_THUC_HIEN', time: vnTimeString(daysAgo(50)) }]
  };
  assert.strictEqual(recordActions.computeOperationWorkItemProgressUpdateOverdueDays(item, false), null);
});

// (a) chưa từng cập nhật (history rỗng/chỉ có CREATED) + startDate đã qua lâu hơn frequency -> quá hạn,
// tính từ startDate (đúng yêu cầu "chưa từng cập nhật thì lấy ngày bắt đầu làm mốc").
test('(a) computeOperationWorkItemProgressUpdateOverdueDays(): CHƯA từng cập nhật tiến độ (chỉ có CREATED), startDate 10 ngày trước, frequency 3 ngày -> quá hạn ~10 ngày', () => {
  const item = {
    status: 'DANG_THUC_HIEN', startDate: isoDateDaysAgo(10), progressUpdateFrequencyDays: 3,
    history: [{ action: 'CREATED', time: vnTimeString(daysAgo(10)) }]
  };
  const days = recordActions.computeOperationWorkItemProgressUpdateOverdueDays(item, false);
  assert(days !== null, 'Phải trả về quá hạn (không phải null)');
  assert(days >= 3, `Số ngày quá hạn (${days}) phải >= frequency (3)`);
  assert(days >= 9 && days <= 11, `Số ngày quá hạn (${days}) phải xấp xỉ 10 (tính từ startDate, chưa từng cập nhật)`);
});

// (a-bis) status CHUA_BAT_DAU (chưa bấm bắt đầu) nhưng startDate đã qua -> vẫn tính là quá hạn (spec: chỉ
// loại trừ DA_NGHIEM_THU, CHUA_BAT_DAU vẫn "chưa hoàn thành" nên vẫn cần cảnh báo).
test('(a-bis) computeOperationWorkItemProgressUpdateOverdueDays(): status CHUA_BAT_DAU (chưa bấm Cập Nhật Tiến Độ lần nào) nhưng startDate đã qua lâu -> vẫn cảnh báo quá hạn', () => {
  const item = { status: 'CHUA_BAT_DAU', startDate: isoDateDaysAgo(7), progressUpdateFrequencyDays: 3, history: [{ action: 'CREATED', time: vnTimeString(daysAgo(7)) }] };
  const days = recordActions.computeOperationWorkItemProgressUpdateOverdueDays(item, false);
  assert(days !== null && days >= 3, 'CHUA_BAT_DAU với startDate đã qua lâu vẫn phải được coi là quá hạn cập nhật');
});

// (b) vừa cập nhật gần đây -> chưa quá hạn.
test('(b) computeOperationWorkItemProgressUpdateOverdueDays(): startDate 10 ngày trước, CẬP NHẬT gần đây nhất 1 ngày trước, frequency 3 ngày -> null (chưa quá hạn)', () => {
  const item = {
    status: 'DANG_THUC_HIEN', startDate: isoDateDaysAgo(10), progressUpdateFrequencyDays: 3,
    history: [
      { action: 'CREATED', time: vnTimeString(daysAgo(10)) },
      { action: 'STATUS_DANG_THUC_HIEN', time: vnTimeString(daysAgo(5)) },
      { action: 'STATUS_DANG_THUC_HIEN', time: vnTimeString(daysAgo(1)), note: 'Đã xong 50%' }
    ]
  };
  assert.strictEqual(recordActions.computeOperationWorkItemProgressUpdateOverdueDays(item, false), null);
});

// (c) cập nhật đã lâu -> quá hạn, tính từ LẦN CẬP NHẬT GẦN NHẤT (không phải startDate).
test('(c) computeOperationWorkItemProgressUpdateOverdueDays(): startDate 30 ngày trước, lần cập nhật GẦN NHẤT 8 ngày trước, frequency 3 ngày -> quá hạn ~8 ngày (tính từ lần cập nhật, không phải startDate)', () => {
  const item = {
    status: 'DANG_THUC_HIEN', startDate: isoDateDaysAgo(30), progressUpdateFrequencyDays: 3,
    history: [
      { action: 'CREATED', time: vnTimeString(daysAgo(30)) },
      { action: 'STATUS_DANG_THUC_HIEN', time: vnTimeString(daysAgo(20)) },
      { action: 'STATUS_DANG_THUC_HIEN', time: vnTimeString(daysAgo(8)), note: 'Cập nhật cũ' }
    ]
  };
  const days = recordActions.computeOperationWorkItemProgressUpdateOverdueDays(item, false);
  assert(days !== null, 'Phải quá hạn');
  assert(days >= 7 && days <= 9, `Số ngày quá hạn (${days}) phải xấp xỉ 8 (tính từ lần cập nhật gần nhất, KHÔNG phải startDate 30 ngày trước)`);
});

test('computeOperationWorkItemProgressUpdateOverdueDays(): elapsed ĐÚNG BẰNG frequency -> vẫn tính là quá hạn (>=, không phải >)', () => {
  const item = {
    status: 'DANG_THUC_HIEN', startDate: isoDateDaysAgo(5), progressUpdateFrequencyDays: 5,
    history: [{ action: 'CREATED', time: vnTimeString(daysAgo(5)) }]
  };
  const days = recordActions.computeOperationWorkItemProgressUpdateOverdueDays(item, false);
  assert(days !== null, 'elapsed === frequency phải được tính là quá hạn (>=)');
});

console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
if (failed) process.exitCode = 1;
