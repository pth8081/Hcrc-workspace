// server/tests/test-trash-operation-orders-label.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): TRASH_COLLECTION_LABELS (public/js/module-logsystem-trash.js)
// thiếu entry cho "operationOrders" (Vận Hành - Đơn Hàng) dù collection này xoá được từ lâu qua
// deleteAdminOnly() -> deleteRecordForCollection() (routes/records.js, POST /operationOrders/:id/delete)
// nên có xuất hiện thật trong Thùng Rác. trashCollectionLabel('operationOrders') trước đây rơi về nhánh
// fallback (`|| collection`) trả thẳng key kỹ thuật "operationOrders" thay vì tên tiếng Việt như mọi
// collection khác. Nay đã bổ sung entry 'Vận Hành - Đơn Hàng'.
//
// module-logsystem-trash.js là script trình duyệt thuần (không module.exports), nhưng 2 khai báo
// TRASH_COLLECTION_LABELS/trashCollectionLabel() ở đầu file không có side-effect nào chạy ngay khi nạp
// (không đụng DOM/document ở top-level) — nạp an toàn qua vm trong Node, không cần Playwright.
//
// Chạy: node server/tests/test-trash-operation-orders-label.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const filePath = path.join(__dirname, '..', 'public', 'js', 'module-logsystem-trash.js');
const source = fs.readFileSync(filePath, 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
// `const TRASH_COLLECTION_LABELS = {...}` khai báo ở top-level KHÔNG tự gắn vào global object của vm
// context (giống hệt const/let top-level trong trình duyệt thật không tự thành window.X) — CHỈ
// function declaration (trashCollectionLabel) mới tự gắn. Gán tường minh ngay sau khi chạy source để
// bài test truy cập được trực tiếp map, không đổi gì tới file gốc.
vm.runInContext(source + '\nthis.TRASH_COLLECTION_LABELS = TRASH_COLLECTION_LABELS;', sandbox, { filename: filePath });

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

test('LỖI ĐÃ VÁ: TRASH_COLLECTION_LABELS.operationOrders có tên tiếng Việt rõ ràng', () => {
  assert.strictEqual(sandbox.TRASH_COLLECTION_LABELS.operationOrders, 'Vận Hành - Đơn Hàng');
});

test('LỖI ĐÃ VÁ: trashCollectionLabel("operationOrders") trả đúng tên, KHÔNG rơi về fallback key kỹ thuật', () => {
  const label = sandbox.trashCollectionLabel('operationOrders');
  assert.strictEqual(label, 'Vận Hành - Đơn Hàng');
  assert.notStrictEqual(label, 'operationOrders');
});

test('Các entry cũ khác (VD licenses) vẫn giữ nguyên, không bị phá khi thêm entry mới', () => {
  assert.strictEqual(sandbox.trashCollectionLabel('licenses'), 'Giấy Phép');
  assert.strictEqual(sandbox.trashCollectionLabel('submissions'), 'Văn Bản Trình');
});

test('Collection lạ hoàn toàn không có trong map -> vẫn rơi về fallback trả thẳng key (hành vi gốc, không đổi)', () => {
  assert.strictEqual(sandbox.trashCollectionLabel('khongTonTai'), 'khongTonTai');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
