// server/tests/test-license-cancel.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): giống hệt lỗ hổng nghiệp vụ đã vá cho officeReqs/
// carRegs/vppRegistrations/uniformTransfers — người tải lên Giấy Phép lỡ gửi nhầm (sai tệp/thông tin)
// trong khi CÒN ĐANG PENDING (chưa ai duyệt) không có cách nào rút lại, phải chờ người duyệt Từ Chối hộ
// dù họ chưa hề xem xét gì. Nay thêm canCancelLicense()/cancelLicense() cho người tạo tự Hủy khi PENDING.
//
// canCancelLicense()/cancelLicense() đều THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-license-cancel.js
'use strict';
const assert = require('assert');
const { canCancelLicense, cancelLicense } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const CREATOR = { username: 'nv1', name: 'Nhân Viên 1' };
const OTHER = { username: 'nv2', name: 'Nhân Viên 2' };
const ADMIN = { username: 'admin', name: 'Admin', perms: { admin: true } };

function makeLicense(overrides) {
  return Object.assign({ id: 1, creator: 'nv1', creatorName: 'Nhân Viên 1', status: 'PENDING', companyName: 'Công ty A' }, overrides);
}

test('canCancelLicense: người tạo hủy được hồ sơ của chính mình', () => {
  assert.strictEqual(canCancelLicense(CREATOR, makeLicense()), true);
});

test('canCancelLicense: người khác (không phải admin) không hủy được', () => {
  assert.strictEqual(canCancelLicense(OTHER, makeLicense()), false);
});

test('canCancelLicense: admin hủy được hồ sơ của bất kỳ ai', () => {
  assert.strictEqual(canCancelLicense(ADMIN, makeLicense()), true);
});

test('LỖI ĐÃ VÁ: người tạo hủy hồ sơ đang PENDING -> thành công, chuyển CANCELLED', () => {
  const item = makeLicense();
  const updated = cancelLicense(CREATOR, item, { reason: 'Gửi nhầm tệp' });
  assert.strictEqual(updated.status, 'CANCELLED');
  assert.strictEqual(updated.cancelledBy, 'nv1');
  assert.strictEqual(updated.history[updated.history.length - 1].action, 'CANCELLED');
});

test('Người khác không có quyền -> 403', () => {
  assert.throws(() => cancelLicense(OTHER, makeLicense(), {}), /403|quyền/);
});

test('Đã APPROVED -> không hủy được nữa (đã có kết quả xử lý)', () => {
  const item = makeLicense({ status: 'APPROVED' });
  assert.throws(() => cancelLicense(CREATOR, item, {}), /409|Chỉ hủy được/);
});

test('Đã REJECTED -> không hủy được nữa (đã có kết quả xử lý)', () => {
  const item = makeLicense({ status: 'REJECTED' });
  assert.throws(() => cancelLicense(CREATOR, item, {}), /409|Chỉ hủy được/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
