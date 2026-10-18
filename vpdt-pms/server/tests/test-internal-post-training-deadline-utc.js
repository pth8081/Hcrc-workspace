// server/tests/test-internal-post-training-deadline-utc.js
//
// LỖI ĐÃ VÁ (re-audit lần 6, mức Thấp — "registerInternalPostTraining deadline so sánh UTC"):
// registerInternalPostTraining() (lib/recordActions.js) so sánh post.training.registerDeadline bằng
// `new Date().toISOString().slice(0, 10)` — LUÔN lấy ngày theo giờ UTC. Trên máy chủ chạy giờ VN
// (UTC+7), trong khung 00:00-06:59 sáng giờ VN, ngày UTC vẫn còn là NGÀY HÔM TRƯỚC — nếu
// registerDeadline rơi đúng vào ngày hôm trước đó, nhân viên vẫn đăng ký được khoá đào tạo đính kèm bài
// Nhịp Sống HCRC dù hạn (giờ VN) đã qua. CÙNG LỚP LỖI đã vá cho trainingRegistrations/
// recruitmentReferrals (xem tests/test-recruitment-referral-deadline-utc.js — cùng kỹ thuật test).
// Đã vá: đổi sang localDateStr(new Date()) (lib/attendance.js, đọc giờ LOCAL của máy chủ).
//
// Test THẬT (gọi trực tiếp registerInternalPostTraining() thuần, không cần SQL Server/HTTP) — ép
// process.env.TZ='Asia/Ho_Chi_Minh' + thay global.Date tạm thời để giả lập "thời điểm hiện tại" là
// 00:30 sáng giờ VN ngày 01/01/2026 (= 2025-12-31T17:30:00Z theo UTC, môi trường chạy test mặc định là
// UTC nên không tự lộ lỗi này).
//
// Chạy: node server/tests/test-internal-post-training-deadline-utc.js
'use strict';
const assert = require('assert');
const recordActions = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const USER = { username: 'nv1', name: 'Nhân Viên 1' };
function makePost(registerDeadline, overrides) {
  return Object.assign({
    id: 1, type: 'TRAINING',
    training: { registeredUsers: [], capacity: 0, registerDeadline }
  }, overrides);
}

const RealDate = global.Date;
const FIXED_NOW_MS = new RealDate('2026-01-01T00:30:00+07:00').getTime();
class FixedNowDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) { super(FIXED_NOW_MS); return; }
    super(...args);
  }
  static now() { return FIXED_NOW_MS; }
}
function withFixedVnNow(fn) {
  const originalTZ = process.env.TZ;
  process.env.TZ = 'Asia/Ho_Chi_Minh';
  global.Date = FixedNowDate;
  try { return fn(); }
  finally { global.Date = RealDate; process.env.TZ = originalTZ; }
}

test('LỖI ĐÃ VÁ: registerDeadline hôm trước theo giờ UTC nhưng ĐÃ QUA theo giờ VN (00:30 sáng) -> PHẢI bị chặn 409', () => {
  withFixedVnNow(() => {
    assert.throws(
      () => recordActions.registerInternalPostTraining(USER, makePost('2025-12-31')),
      /Đã hết hạn đăng ký khóa đào tạo này/,
      'phải bị chặn 409 — nếu không chặn, vẫn còn lỗi UTC cũ'
    );
  });
});

test('đối chứng: registerDeadline HÔM NAY (giờ VN, 01/01/2026) vẫn CHƯA qua hạn -> đăng ký thành công', () => {
  withFixedVnNow(() => {
    const post = makePost('2026-01-01');
    const result = recordActions.registerInternalPostTraining(USER, post);
    assert.ok(result.training.registeredUsers.includes('nv1'), 'phải đăng ký được khi deadline đúng hôm nay');
  });
});

test('đối chứng: registerDeadline TƯƠNG LAI vẫn đăng ký được bình thường', () => {
  withFixedVnNow(() => {
    const post = makePost('2026-06-30');
    const result = recordActions.registerInternalPostTraining(USER, post);
    assert.ok(result.training.registeredUsers.includes('nv1'));
  });
});

test('đối chứng: KHÔNG đặt registerDeadline vẫn đăng ký được bình thường, không bị chặn nhầm', () => {
  withFixedVnNow(() => {
    const post = makePost('');
    const result = recordActions.registerInternalPostTraining(USER, post);
    assert.ok(result.training.registeredUsers.includes('nv1'));
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
