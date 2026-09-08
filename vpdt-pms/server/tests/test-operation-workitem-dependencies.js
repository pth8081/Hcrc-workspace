// server/tests/test-operation-workitem-dependencies.js
//
// Test THUẦN (không cần Playwright/SQL Server) cho tính năng VHST-5 "🔗 Liên kết" công việc
// (dbo.OperationWorkItems, JSON Payload — KHÔNG cần migration SQL, chỉ 1 field mới dependsOnWorkItemIds
// trong payload, mirror ĐÚNG khuôn VHST-4 startDate/progressUpdateFrequencyDays):
//   1. resolveOperationWorkItemDependencyIds() (lib/recordActions.js) — validate mảng id liên kết: CHỈ
//      công việc LÁ, mỗi id phải tồn tại trong CHÍNH hồ sơ (itemsForSource), phải trỏ tới công việc LÁ,
//      không tự liên kết chính mình, tự "dọn sạch" về [] khi hasChildren=true mà payload không gửi gì.
//   2. assertNoOperationWorkItemDependencyCycle() — dò vòng lặp phụ thuộc trực tiếp (A<->B) và dài hơn
//      (A->B->C->A).
//   3. createOperationWorkItem()/setOperationWorkItemDependencies() — tích hợp field mới đúng luồng thật
//      (bao gồm gate quyền + chặn sửa liên kết khi đã DA_NGHIEM_THU).
//   4. updateOperationWorkItemProgress() — cổng chặn "chưa thể bắt đầu (CHUA_BAT_DAU -> DANG_THUC_HIEN)
//      khi còn công việc liên kết chưa DA_NGHIEM_THU", CHỈ áp dụng đúng bước "bắt đầu" (không chặn lặp lại
//      DANG_THUC_HIEN/chuyển DANG_NGHIEM_THU sau khi đã bắt đầu được 1 lần).
//   5. BUG THẬT phát hiện lúc kiểm tra lại (phản hồi người dùng — "🔗 Liên kết không dùng được"): mọi test
//      Ở TRÊN chỉ gọi thẳng recordActions.js (đúng logic nghiệp vụ, không sai) nên KHÔNG hề bắt được bug
//      thật — nút "🔗 Liên kết" trên mỗi dòng vẫn MỞ được modal (openOperationWorkItemDependencyModal()
//      nằm trong operationWorkItemModal, đã bind), nhưng modal "operationWorkItemDependencyModal" (public/
//      index.html) CHƯA TỪNG được đăng ký ở forEach(bindOperationDelegation) (module-vanhanh.js) từ lúc
//      VHST-5 được thêm — 1 <div> ĐỘC LẬP cấp cao, không lồng trong root nào đã bind, nên "💾 Lưu Liên
//      Kết"/"Huỷ"/"✕" bên TRONG modal hoàn toàn không phản hồi khi bấm (cùng lớp lỗi CSP-delegation với
//      hrLifecycleSection ở Đợt E). Test 5a static-scan bên dưới là lưới an toàn RẺ (không cần Playwright)
//      chặn tái diễn — coi tests/test-operation-vhst-uibugfix.js (Playwright, xác nhận qua DOM thật + ảnh
//      chụp màn hình) là bằng chứng đầy đủ nhất cho bug lớp này.
//
// Chạy: node server/tests/test-operation-workitem-dependencies.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
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

const ADMIN_USER = { username: 'admin', name: 'Admin', perms: { admin: true } };
const SOURCE_RECORD = { id: 1, creator: 'someone_else', estimateStatus: 'APPROVED', useConfirmStatus: null, code: 'MM-TEST' };

// ===== 1) resolveOperationWorkItemDependencyIds() =====
test('resolveOperationWorkItemDependencyIds(): không gửi gì -> [], không throw', () => {
  const r = recordActions.resolveOperationWorkItemDependencyIds({}, false, [], 1);
  assert.deepStrictEqual(r, []);
});

test('resolveOperationWorkItemDependencyIds(): mảng rỗng -> [] (coi như không gửi)', () => {
  const r = recordActions.resolveOperationWorkItemDependencyIds({ dependsOnWorkItemIds: [] }, false, [], 1);
  assert.deepStrictEqual(r, []);
});

test('resolveOperationWorkItemDependencyIds(): hasChildren=true + payload CÓ gửi -> từ chối (400, "công việc lá")', () => {
  const items = [{ id: 2, title: 'B', dependsOnWorkItemIds: [] }];
  assertThrowsHttp(() => recordActions.resolveOperationWorkItemDependencyIds({ dependsOnWorkItemIds: [2] }, true, items, 1), 400, 'công việc lá');
});

test('resolveOperationWorkItemDependencyIds(): hasChildren=true + payload KHÔNG gửi gì -> [] (tự dọn sạch, không throw)', () => {
  const r = recordActions.resolveOperationWorkItemDependencyIds({}, true, [], 1);
  assert.deepStrictEqual(r, []);
});

test('resolveOperationWorkItemDependencyIds(): id không tồn tại trong itemsForSource (VD khác hồ sơ) -> từ chối (400)', () => {
  assertThrowsHttp(() => recordActions.resolveOperationWorkItemDependencyIds({ dependsOnWorkItemIds: [999] }, false, [], 1), 400, 'Không tìm thấy');
});

test('resolveOperationWorkItemDependencyIds(): id trỏ tới công việc CÓ CON (không phải lá) -> từ chối (400)', () => {
  const items = [
    { id: 2, title: 'Đầu mục lớn', parentWorkItemId: null, dependsOnWorkItemIds: [] },
    { id: 3, title: 'Con của đầu mục lớn', parentWorkItemId: 2, dependsOnWorkItemIds: [] }
  ];
  assertThrowsHttp(() => recordActions.resolveOperationWorkItemDependencyIds({ dependsOnWorkItemIds: [2] }, false, items, 1), 400, 'việc con');
});

test('resolveOperationWorkItemDependencyIds(): tự liên kết chính mình -> từ chối (400, thông báo riêng)', () => {
  const items = [{ id: 1, title: 'A', dependsOnWorkItemIds: [] }];
  assertThrowsHttp(() => recordActions.resolveOperationWorkItemDependencyIds({ dependsOnWorkItemIds: [1] }, false, items, 1), 400, 'chính nó');
});

test('resolveOperationWorkItemDependencyIds(): id hợp lệ (LÁ, khác hồ sơ id khác, không trùng) -> lưu đúng, loại trùng lặp', () => {
  const items = [
    { id: 2, title: 'B', dependsOnWorkItemIds: [] },
    { id: 3, title: 'C', dependsOnWorkItemIds: [] }
  ];
  const r = recordActions.resolveOperationWorkItemDependencyIds({ dependsOnWorkItemIds: [2, 3, 2] }, false, items, 1);
  assert.deepStrictEqual(r, [2, 3]);
});

// ===== 2) assertNoOperationWorkItemDependencyCycle() =====
test('assertNoOperationWorkItemDependencyCycle(): vòng lặp TRỰC TIẾP (A phụ thuộc B, B đã phụ thuộc A) -> từ chối (400)', () => {
  const items = [
    { id: 1, title: 'A', dependsOnWorkItemIds: [] },
    { id: 2, title: 'B', dependsOnWorkItemIds: [1] } // B đã phụ thuộc A từ trước
  ];
  // Đang đề xuất lưu A phụ thuộc B -> A -> B -> A, vòng lặp.
  assertThrowsHttp(() => recordActions.assertNoOperationWorkItemDependencyCycle(items, 1, [2]), 400, 'vòng lặp');
});

test('assertNoOperationWorkItemDependencyCycle(): vòng lặp DÀI (A phụ thuộc B, B đã phụ thuộc C, C đã phụ thuộc A) -> từ chối (400)', () => {
  const items = [
    { id: 1, title: 'A', dependsOnWorkItemIds: [] },
    { id: 2, title: 'B', dependsOnWorkItemIds: [3] },
    { id: 3, title: 'C', dependsOnWorkItemIds: [1] }
  ];
  assertThrowsHttp(() => recordActions.assertNoOperationWorkItemDependencyCycle(items, 1, [2]), 400, 'vòng lặp');
});

test('assertNoOperationWorkItemDependencyCycle(): KHÔNG vòng lặp (chuỗi phụ thuộc thẳng, không quay lại) -> không throw', () => {
  const items = [
    { id: 1, title: 'A', dependsOnWorkItemIds: [] },
    { id: 2, title: 'B', dependsOnWorkItemIds: [] },
    { id: 3, title: 'C', dependsOnWorkItemIds: [2] } // C phụ thuộc B
  ];
  // Đề xuất A phụ thuộc C (A -> C -> B, không quay lại A) -> hợp lệ.
  assert.doesNotThrow(() => recordActions.assertNoOperationWorkItemDependencyCycle(items, 1, [3]));
});

test('resolveOperationWorkItemDependencyIds(): tích hợp — chọn 1 công việc mà bản thân nó đã phụ thuộc ngược lại (vòng lặp) -> từ chối (400)', () => {
  const items = [
    { id: 1, title: 'A', dependsOnWorkItemIds: [] },
    { id: 2, title: 'B', dependsOnWorkItemIds: [1] }
  ];
  assertThrowsHttp(() => recordActions.resolveOperationWorkItemDependencyIds({ dependsOnWorkItemIds: [2] }, false, items, 1), 400, 'vòng lặp');
});

// ===== 3) Tích hợp createOperationWorkItem()/setOperationWorkItemDependencies() =====
test('createOperationWorkItem(): tạo công việc LÁ liên kết tới 1 công việc lá khác đã có sẵn trong hồ sơ -> lưu đúng dependsOnWorkItemIds', () => {
  const existing = [{ id: 100, title: 'Việc nền tảng', parentWorkItemId: null, dependsOnWorkItemIds: [] }];
  const item = recordActions.createOperationWorkItem(
    ADMIN_USER, { title: 'Việc phụ thuộc', dependsOnWorkItemIds: [100] }, SOURCE_RECORD, existing, [], [], 'OPERATION_STORE_OPENING'
  );
  assert.deepStrictEqual(item.dependsOnWorkItemIds, [100]);
});

test('createOperationWorkItem(): không gửi dependsOnWorkItemIds -> [] (tương thích ngược với item cũ)', () => {
  const item = recordActions.createOperationWorkItem(
    ADMIN_USER, { title: 'Việc không liên kết' }, SOURCE_RECORD, [], [], [], 'OPERATION_STORE_OPENING'
  );
  assert.deepStrictEqual(item.dependsOnWorkItemIds, []);
});

test('setOperationWorkItemDependencies(): lưu đúng liên kết mới, ghi thêm history DEPENDENCIES_EDITED', () => {
  const item = { id: 1, sourceType: 'OPERATION_STORE_OPENING', status: 'CHUA_BAT_DAU', history: [], dependsOnWorkItemIds: [] };
  const others = [{ id: 2, title: 'B', dependsOnWorkItemIds: [] }];
  const updated = recordActions.setOperationWorkItemDependencies(ADMIN_USER, item, { dependsOnWorkItemIds: [2] }, others, false, SOURCE_RECORD);
  assert.deepStrictEqual(updated.dependsOnWorkItemIds, [2]);
  assert(updated.history.some(h => h.action === 'DEPENDENCIES_EDITED'), 'Phải ghi lại lịch sử DEPENDENCIES_EDITED');
});

test('setOperationWorkItemDependencies(): công việc ĐÃ NGHIỆM THU (DA_NGHIEM_THU) -> từ chối sửa liên kết (409)', () => {
  const item = { id: 1, sourceType: 'OPERATION_STORE_OPENING', status: 'DA_NGHIEM_THU', history: [], dependsOnWorkItemIds: [] };
  assertThrowsHttp(() => recordActions.setOperationWorkItemDependencies(ADMIN_USER, item, { dependsOnWorkItemIds: [] }, [], false, SOURCE_RECORD), 409, 'nghiệm thu xong');
});

test('setOperationWorkItemDependencies(): item vừa có thêm con (hasChildren=true) + KHÔNG gửi lại dependsOnWorkItemIds -> tự động dọn sạch về []', () => {
  const item = { id: 3, sourceType: 'OPERATION_STORE_OPENING', status: 'CHUA_BAT_DAU', history: [], dependsOnWorkItemIds: [2] };
  const updated = recordActions.setOperationWorkItemDependencies(ADMIN_USER, item, {}, [], true, SOURCE_RECORD);
  assert.deepStrictEqual(updated.dependsOnWorkItemIds, [], 'dependsOnWorkItemIds phải tự dọn sạch khi item không còn là lá');
});

// ===== 4) updateOperationWorkItemProgress() — cổng chặn "🔗 Liên kết" =====
function makeItem(overrides) {
  return { id: 1, sourceType: 'OPERATION_STORE_OPENING', status: 'CHUA_BAT_DAU', history: [], assignedTo: [], dependsOnWorkItemIds: [], ...overrides };
}

test('updateOperationWorkItemProgress(): công việc liên kết CHƯA nghiệm thu xong -> chặn "Bắt đầu" (CHUA_BAT_DAU -> DANG_THUC_HIEN), 400', () => {
  const dep = { id: 2, title: 'Việc nền tảng', status: 'DANG_THUC_HIEN' };
  const item = makeItem({ dependsOnWorkItemIds: [2] });
  assertThrowsHttp(
    () => recordActions.updateOperationWorkItemProgress(ADMIN_USER, item, [], 'DANG_THUC_HIEN', '', SOURCE_RECORD, [item, dep]),
    400, 'Việc nền tảng'
  );
});

test('updateOperationWorkItemProgress(): công việc liên kết ĐÃ nghiệm thu xong (DA_NGHIEM_THU) -> cho phép "Bắt đầu" bình thường', () => {
  const dep = { id: 2, title: 'Việc nền tảng', status: 'DA_NGHIEM_THU' };
  const item = makeItem({ dependsOnWorkItemIds: [2] });
  const updated = recordActions.updateOperationWorkItemProgress(ADMIN_USER, item, [], 'DANG_THUC_HIEN', '', SOURCE_RECORD, [item, dep]);
  assert.strictEqual(updated.status, 'DANG_THUC_HIEN');
});

test('updateOperationWorkItemProgress(): NHIỀU công việc liên kết, còn 1 cái CHƯA xong -> vẫn chặn, thông báo nêu đúng tên cái chưa xong', () => {
  const depDone = { id: 2, title: 'Đã xong', status: 'DA_NGHIEM_THU' };
  const depPending = { id: 3, title: 'Chưa xong', status: 'DANG_NGHIEM_THU' };
  const item = makeItem({ dependsOnWorkItemIds: [2, 3] });
  assertThrowsHttp(
    () => recordActions.updateOperationWorkItemProgress(ADMIN_USER, item, [], 'DANG_THUC_HIEN', '', SOURCE_RECORD, [item, depDone, depPending]),
    400, 'Chưa xong'
  );
});

test('updateOperationWorkItemProgress(): không có dependsOnWorkItemIds (mảng rỗng) -> "Bắt đầu" bình thường, không bị chặn', () => {
  const item = makeItem({ dependsOnWorkItemIds: [] });
  const updated = recordActions.updateOperationWorkItemProgress(ADMIN_USER, item, [], 'DANG_THUC_HIEN', '', SOURCE_RECORD, [item]);
  assert.strictEqual(updated.status, 'DANG_THUC_HIEN');
});

test('updateOperationWorkItemProgress(): id liên kết đã bị XOÁ (không còn trong itemsForSource) -> KHÔNG chặn (tham chiếu chết tự bỏ qua)', () => {
  const item = makeItem({ dependsOnWorkItemIds: [999] }); // 999 không tồn tại trong itemsForSource
  const updated = recordActions.updateOperationWorkItemProgress(ADMIN_USER, item, [], 'DANG_THUC_HIEN', '', SOURCE_RECORD, [item]);
  assert.strictEqual(updated.status, 'DANG_THUC_HIEN');
});

test('updateOperationWorkItemProgress(): ĐÃ ở DANG_THUC_HIEN (đã "bắt đầu" thành công từ trước) + lặp lại DANG_THUC_HIEN (cập nhật ghi chú tiến độ) -> KHÔNG bị cổng chặn soi lại dù còn liên kết chưa xong', () => {
  const dep = { id: 2, title: 'Việc nền tảng', status: 'DANG_THUC_HIEN' };
  const item = makeItem({ status: 'DANG_THUC_HIEN', dependsOnWorkItemIds: [2] });
  const updated = recordActions.updateOperationWorkItemProgress(ADMIN_USER, item, [], 'DANG_THUC_HIEN', 'Cập nhật tiến độ', SOURCE_RECORD, [item, dep]);
  assert.strictEqual(updated.status, 'DANG_THUC_HIEN');
});

// ===== 5a) Lưới an toàn RẺ (static-scan, không cần Playwright) cho bug CSP-delegation đã tìm thấy =====
test('module-vanhanh.js: "operationWorkItemDependencyModal" PHẢI có trong forEach(bindOperationDelegation(...)) (nếu không, mọi nút BÊN TRONG modal "🔗 Liên Kết" — Lưu/Huỷ/✕ — sẽ không phản hồi khi bấm)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'module-vanhanh.js'), 'utf8');
  const m = src.match(/\[[^\]]*\]\.forEach\(bindOperationDelegation\)/);
  assert(m, 'Phải tìm thấy dòng forEach(bindOperationDelegation) trong module-vanhanh.js');
  assert(m[0].includes("'operationWorkItemDependencyModal'"), 'Danh sách bindOperationDelegation() phải bao gồm "operationWorkItemDependencyModal"');
});

test('public/index.html: modal "operationWorkItemDependencyModal" tồn tại và có đủ 3 nút cần delegation (✕/Huỷ/💾 Lưu Liên Kết)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const m = html.match(/<div id="operationWorkItemDependencyModal"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert(m, 'Phải tìm thấy modal operationWorkItemDependencyModal trong index.html');
  assert(m[0].includes('data-op="closeOperationWorkItemDependencyModal"'), 'Phải có nút đóng modal (data-op)');
  assert(m[0].includes('data-op="submitOperationWorkItemDependencies"'), 'Phải có nút "💾 Lưu Liên Kết" (data-op)');
});

console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
if (failed) process.exitCode = 1;
