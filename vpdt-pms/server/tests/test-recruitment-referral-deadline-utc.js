// server/tests/test-recruitment-referral-deadline-utc.js
//
// LỖI ĐÃ VÁ (re-audit lần 6, mức Thấp — "recruitmentReferrals deadline so sánh UTC"):
// CREATE_MODULE_CONFIGS.recruitmentReferrals.extraValidate() (lib/createValidation.js) so sánh
// job.deadline bằng `new Date().toISOString().slice(0, 10)` — LUÔN lấy ngày theo giờ UTC. Trên máy chủ
// chạy giờ VN (UTC+7), trong khung 00:00-06:59 sáng giờ VN, ngày UTC vẫn còn là NGÀY HÔM TRƯỚC — nếu
// deadline rơi đúng vào ngày hôm trước đó, hệ thống vẫn cho giới thiệu ứng viên dù hạn (giờ VN) đã qua.
// Đã vá: đổi sang localDateStr(new Date()) (lib/attendance.js, đọc giờ LOCAL của máy chủ) — mirror ĐÚNG
// bulkRegisterTrainingClass()/trainingRegistrations.extraValidate (cùng lớp lỗi đã vá trước đó).
//
// Test THẬT (gọi trực tiếp extraValidate() thuần, không cần SQL Server/HTTP) — mô phỏng ĐÚNG máy chủ
// chạy giờ VN bằng cách ép process.env.TZ='Asia/Ho_Chi_Minh' (môi trường chạy test mặc định là UTC nên
// không tự lộ lỗi này, xem chú thích tương tự ở tests/test-attendance-leave.js #5) VÀ giả lập "thời
// điểm hiện tại" bằng cách thay global.Date tạm thời — chỉ ép instant cho `new Date()` KHÔNG đối số,
// mọi cách gọi Date khác (có đối số, Date.now()) vẫn hoạt động như bản gốc.
//
// Chạy: node server/tests/test-recruitment-referral-deadline-utc.js
'use strict';
const assert = require('assert');
const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const USER = { username: 'nv1', dept: 'Phòng Kinh Doanh' };
function makePayload() {
  return { jobId: 1, candidateName: 'Nguyễn Văn A', candidatePhone: '0900000000', cvFileUrl: '/uploads/cv.pdf' };
}
function makeAppData(deadline) {
  return { recruitmentJobs: [{ id: 1, status: 'OPEN', deadline }] };
}

// FIXED_NOW: 2026-01-01T00:30:00+07:00 (00:30 sáng giờ VN, ngày 01/01/2026) — quy đổi UTC là
// 2025-12-31T17:30:00Z (vẫn NGÀY 31/12/2025 theo UTC). job.deadline = '2025-12-31': theo giờ VN đã
// SANG NGÀY MỚI (01/01), hạn 31/12 ĐÃ QUA — PHẢI bị chặn. Code CŨ (so UTC) đọc ngày UTC vẫn là
// '2025-12-31' -> '2025-12-31' > '2025-12-31' là false -> KHÔNG chặn (lỗi, giới thiệu được dù hạn giờ VN
// đã qua). Code MỚI (localDateStr, đọc giờ LOCAL=VN) đọc đúng '2026-01-01' -> '2026-01-01' > '2025-12-31'
// là true -> CHẶN đúng.
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

test('LỖI ĐÃ VÁ: deadline hôm trước theo giờ UTC nhưng ĐÃ QUA theo giờ VN (00:30 sáng) -> PHẢI bị chặn 409', () => {
  withFixedVnNow(() => {
    assert.throws(
      () => CREATE_MODULE_CONFIGS.recruitmentReferrals.extraValidate(makePayload(), [], USER, makeAppData('2025-12-31')),
      /đã hết hạn giới thiệu/,
      'phải bị chặn 409 "đã hết hạn giới thiệu" — nếu không chặn, vẫn còn lỗi UTC cũ'
    );
  });
});

test('đối chứng: deadline HÔM NAY (giờ VN, 01/01/2026) vẫn CHƯA qua hạn -> không bị chặn', () => {
  withFixedVnNow(() => {
    assert.doesNotThrow(
      () => CREATE_MODULE_CONFIGS.recruitmentReferrals.extraValidate(makePayload(), [], USER, makeAppData('2026-01-01')),
      'deadline đúng ngày hôm nay (giờ VN) vẫn phải cho giới thiệu — không bị chặn nhầm'
    );
  });
});

test('đối chứng: deadline TƯƠNG LAI vẫn cho giới thiệu bình thường', () => {
  withFixedVnNow(() => {
    assert.doesNotThrow(
      () => CREATE_MODULE_CONFIGS.recruitmentReferrals.extraValidate(makePayload(), [], USER, makeAppData('2026-06-30'))
    );
  });
});

test('đối chứng: tin KHÔNG có deadline (để trống) vẫn cho giới thiệu bình thường, không bị chặn nhầm', () => {
  withFixedVnNow(() => {
    assert.doesNotThrow(
      () => CREATE_MODULE_CONFIGS.recruitmentReferrals.extraValidate(makePayload(), [], USER, makeAppData(''))
    );
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
