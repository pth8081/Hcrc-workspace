// server/tests/test-hrfeedback-withdraw.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): câu hỏi Phản Hồi Ý Kiến gửi nhầm/muốn rút lại khi CÒN
// ĐANG chờ Nhân Sự trả lời (PENDING) trước đây không có cách nào tự rút — chỉ Admin xoá được (xoá HẲN,
// không giữ dấu vết), trong khi người hỏi chỉ muốn rút lại câu hỏi CỦA CHÍNH MÌNH. Nay
// canWithdrawHrFeedback()/withdrawHrFeedback() cho phép người tạo tự rút, chuyển WITHDRAWN (giữ lịch sử).
//
// canWithdrawHrFeedback()/withdrawHrFeedback() đều THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-hrfeedback-withdraw.js
'use strict';
const assert = require('assert');
const { canWithdrawHrFeedback, withdrawHrFeedback, respondToHrFeedback } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const CREATOR = { username: 'nv1', name: 'Nhân Viên 1' };
const OTHER = { username: 'nv2', name: 'Nhân Viên 2' };
const HR = { username: 'hr1', name: 'Nhân Sự', perms: { nhanSuManage: true } };

function makeFeedback(overrides) {
  return Object.assign({ id: 1, creator: 'nv1', creatorName: 'Nhân Viên 1', question: 'Câu hỏi test', status: 'PENDING' }, overrides);
}

test('canWithdrawHrFeedback: người tạo rút được câu hỏi của chính mình', () => {
  assert.strictEqual(canWithdrawHrFeedback(CREATOR, makeFeedback()), true);
});

test('canWithdrawHrFeedback: người khác (kể cả Nhân Sự) không rút hộ được', () => {
  assert.strictEqual(canWithdrawHrFeedback(OTHER, makeFeedback()), false);
  assert.strictEqual(canWithdrawHrFeedback(HR, makeFeedback()), false);
});

test('LỖI ĐÃ VÁ: người tạo rút câu hỏi đang PENDING -> thành công, chuyển WITHDRAWN', () => {
  const item = makeFeedback();
  const updated = withdrawHrFeedback(CREATOR, item);
  assert.strictEqual(updated.status, 'WITHDRAWN');
  assert.ok(updated.withdrawnAt);
});

test('Người khác không có quyền -> 403', () => {
  assert.throws(() => withdrawHrFeedback(OTHER, makeFeedback()), /403|chính mình/);
});

test('Đã ANSWERED -> không rút lại được nữa (Nhân Sự đã xử lý)', () => {
  const item = makeFeedback({ status: 'ANSWERED' });
  assert.throws(() => withdrawHrFeedback(CREATOR, item), /409|Chỉ rút lại được/);
});

test('Đã WITHDRAWN từ trước -> không rút lại lần 2', () => {
  const item = makeFeedback({ status: 'WITHDRAWN' });
  assert.throws(() => withdrawHrFeedback(CREATOR, item), /409|Chỉ rút lại được/);
});

test('LỖI ĐÃ VÁ (liên quan): Nhân Sự KHÔNG trả lời được câu hỏi ĐÃ BỊ RÚT LẠI (guard cũ chỉ chặn ANSWERED, bỏ sót WITHDRAWN)', () => {
  const item = withdrawHrFeedback(CREATOR, makeFeedback());
  assert.throws(() => respondToHrFeedback(HR, item, { response: 'Trả lời nhầm vào câu đã rút' }), /409|đã bị người gửi rút lại/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
