// server/tests/test-generatecode-payload-dept-spoofing.js
//
// LỖI ĐÃ VÁ (re-audit lần 6, mức Thấp — "generateCode dùng payload.dept thô chưa ép"):
// submissions/contracts/docs đều có forceOwnDept: true (record.dept CUỐI CÙNG luôn = user.dept, ép ở
// finalDept trong validateAndPrepareCreate() — bước SAU generateCode) nhưng generateCode() của cả 3
// module lại chạy TRƯỚC đó và đọc payload.dept THÔ (client gửi, CHƯA bị ép) để tính viết tắt phòng ban
// trong mã hồ sơ — 1 request tự gửi payload.dept khác phòng ban thật của mình khiến MÃ sinh ra mang
// viết tắt phòng ban SAI (của payload.dept giả) dù record THẬT lại thuộc phòng ban khác (user.dept) —
// nhiễu số thứ tự (computeNextSeqForPrefix) của phòng ban bị "mượn tên" + mã tra cứu gây nhầm lẫn hồ sơ
// thuộc phòng ban nào. Cùng gốc: contracts.extraValidate mặc định/so sánh custodianDept cũng dùng
// payload.dept thô thay vì user.dept. Đã vá: cả 4 chỗ đổi sang user.dept (mirror licenses.generateCode
// đã làm đúng từ trước).
//
// Test THẬT (gọi trực tiếp CREATE_MODULE_CONFIGS.<module>.generateCode()/extraValidate(), không cần SQL
// Server/HTTP).
//
// Chạy: node server/tests/test-generatecode-payload-dept-spoofing.js
'use strict';
const assert = require('assert');
const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

// CREATOR thật thuộc 'Phòng Kinh Doanh', tự soạn payload.dept = 'Ban Giám Đốc' (giả mạo).
const USER = { username: 'nv1', dept: 'Phòng Kinh Doanh', perms: { contractCreate: true } };
const APP_DATA = { deptAbbrs: { 'Phòng Kinh Doanh': 'KD', 'Ban Giám Đốc': 'BGD' }, depts: ['Phòng Kinh Doanh', 'Ban Giám Đốc'], stores: [] };

test('submissions.generateCode: payload.dept bị giả mạo -> mã PHẢI dùng viết tắt user.dept (KD), KHÔNG dùng payload.dept giả (BGD)', () => {
  const payload = { dept: 'Ban Giám Đốc' };
  const code = CREATE_MODULE_CONFIGS.submissions.generateCode(payload, [], USER, APP_DATA);
  assert.ok(code.includes('-KD-'), `mã phải mang viết tắt KD (user.dept thật), nhận được: ${code}`);
  assert.ok(!code.includes('-BGD-'), `mã KHÔNG được mang viết tắt BGD (payload.dept giả mạo), nhận được: ${code}`);
});

test('contracts.generateCode (hợp đồng GỐC): payload.dept bị giả mạo -> mã PHẢI dùng viết tắt user.dept (KD)', () => {
  const payload = { dept: 'Ban Giám Đốc', isAddendum: false, type: 'LAODONG' };
  const code = CREATE_MODULE_CONFIGS.contracts.generateCode(payload, [], USER, APP_DATA);
  assert.ok(code.includes('-KD-'), `mã phải mang viết tắt KD (user.dept thật), nhận được: ${code}`);
  assert.ok(!code.includes('-BGD-'), `mã KHÔNG được mang viết tắt BGD (payload.dept giả mạo), nhận được: ${code}`);
});

test('contracts.generateCode (phụ lục): vẫn hoạt động bình thường, không đụng tới dept (kế thừa mã hợp đồng gốc)', () => {
  const root = { id: 1, isAddendum: false, code: 'HCRC-KD-LD-001' };
  const payload = { dept: 'Ban Giám Đốc', isAddendum: true, rootContractId: 1 };
  const code = CREATE_MODULE_CONFIGS.contracts.generateCode(payload, [root], USER, APP_DATA);
  assert.strictEqual(code, 'HCRC-KD-LD-001-PLHD01');
});

test('docs.generateCode (bản GỐC): payload.dept bị giả mạo -> mã PHẢI dùng viết tắt user.dept (KD)', () => {
  const payload = { dept: 'Ban Giám Đốc', cat: 'QD', rootDocId: null };
  const code = CREATE_MODULE_CONFIGS.docs.generateCode(payload, [], USER, APP_DATA);
  assert.ok(code.includes('-KD-'), `mã phải mang viết tắt KD (user.dept thật), nhận được: ${code}`);
  assert.ok(!code.includes('-BGD-'), `mã KHÔNG được mang viết tắt BGD (payload.dept giả mạo), nhận được: ${code}`);
});

test('docs.generateCode (bản phiên bản mới, rootDocId != null): vẫn trả null như cũ, không đụng tới dept', () => {
  const payload = { dept: 'Ban Giám Đốc', cat: 'QD', rootDocId: 5 };
  const code = CREATE_MODULE_CONFIGS.docs.generateCode(payload, [], USER, APP_DATA);
  assert.strictEqual(code, null);
});

test('contracts.extraValidate: custodianDept KHÔNG chọn -> mặc định ĐÚNG user.dept (KD), KHÔNG mặc định theo payload.dept giả (BGD)', () => {
  const payload = {
    dept: 'Ban Giám Đốc', // giả mạo
    type: 'LAODONG', isAddendum: false, amount: 1000, name: 'HĐ test',
  };
  // extraValidate ném lỗi khác (vd thiếu field) là chấp nhận được miễn custodianDept đã được gán đúng
  // TRƯỚC khi ném — kiểm tra trực tiếp payload.custodianDept sau lệnh gọi (bọc try vì có thể extraValidate
  // ném lỗi ở bước validate khác không liên quan tới custodianDept).
  try {
    CREATE_MODULE_CONFIGS.contracts.extraValidate(payload, [], USER, APP_DATA);
  } catch (e) { /* bỏ qua lỗi validate khác không liên quan custodianDept */ }
  assert.strictEqual(payload.custodianDept, 'Phòng Kinh Doanh', `custodianDept phải mặc định = user.dept thật ('Phòng Kinh Doanh'), nhận được: ${payload.custodianDept}`);
});

test('contracts.extraValidate: custodianDept = payload.dept giả (khác user.dept thật) -> PHẢI qua catalog-check (không bị skip nhầm)', () => {
  // Trước đây: so sánh custodianDept !== payload.dept -> custodianDept === payload.dept (cùng giá trị
  // giả) nên NHÁNH VALIDATE BỊ SKIP hoàn toàn dù custodianDept khác user.dept thật. Nay so với user.dept
  // -> custodianDept ('Ban Giám Đốc') !== user.dept ('Phòng Kinh Doanh') -> PHẢI chạy catalog-check.
  // Dùng 1 dept KHÔNG có trong catalog để ép lỗi "không hợp lệ" nếu catalog-check thực sự chạy.
  const payload = {
    dept: 'Ban Giám Đốc', custodianDept: 'Ban Giám Đốc', // trùng payload.dept giả, khác user.dept thật
    type: 'LAODONG', isAddendum: false, amount: 1000, name: 'HĐ test',
  };
  const appDataNoBGD = { deptAbbrs: APP_DATA.deptAbbrs, depts: ['Phòng Kinh Doanh'], stores: [] }; // 'Ban Giám Đốc' KHÔNG có trong catalog
  assert.throws(
    () => CREATE_MODULE_CONFIGS.contracts.extraValidate(payload, [], USER, appDataNoBGD),
    /không hợp lệ/,
    'custodianDept khác user.dept thật PHẢI qua catalog-check và bị chặn khi không có trong catalog'
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
