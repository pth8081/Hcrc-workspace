// server/tests/test-vppregistrations-deadline-utc.js
//
// LỖI ĐÃ VÁ (re-audit lần 7, mức Thấp — "vppRegistrations hạn đăng ký so sánh UTC"): cả 3 vị trí kiểm
// "kỳ đăng ký VPP đã hết hạn chưa" đều so `new Date().toISOString().slice(0, 10)` (ngày UTC) với
// `period.endDate` — LUÔN lấy ngày theo giờ UTC. Trên máy chủ chạy giờ VN (UTC+7), trong khung 00:00-
// 06:59 sáng giờ VN, ngày UTC vẫn còn là NGÀY HÔM TRƯỚC — nếu period.endDate rơi đúng vào ngày hôm trước
// đó, hệ thống vẫn cho tạo/gửi/sửa đăng ký VPP dù hạn (giờ VN) đã qua. CÙNG LỚP LỖI đã vá cho
// trainingRegistrations/recruitmentReferrals/registerInternalPostTraining (VERSION.md v27.27/v27.28) —
// 3 vị trí:
//   1. CREATE_MODULE_CONFIGS.vppRegistrations.extraValidate (lib/createValidation.js, tạo nháp).
//   2. submitVppRegistration() (lib/recordActions.js, Gửi).
//   3. updateVppRegistrationDraft() (lib/recordActions.js, Sửa nháp).
// Đã vá: đổi cả 3 sang localDateStr(new Date()) (lib/attendance.js, đọc giờ LOCAL của máy chủ).
//
// Test THẬT (gọi trực tiếp, không cần SQL Server/HTTP) — ép process.env.TZ='Asia/Ho_Chi_Minh' + thay
// global.Date tạm thời để giả lập "thời điểm hiện tại" là 00:30 sáng giờ VN ngày 01/01/2026 (cùng kỹ
// thuật tests/test-recruitment-referral-deadline-utc.js).
//
// Chạy: node server/tests/test-vppregistrations-deadline-utc.js
'use strict';
const assert = require('assert');
const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');
const recordActions = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const USER = { username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên', perms: { vppRegisterCreate: true } };
function makePeriod(endDate, overrides) {
  return Object.assign({
    id: 1, code: 'VPP-2026-Q1', name: 'Kỳ VPP Q1/2026', status: 'OPEN', endDate,
    catalogItems: [{ name: 'Bút', code: 'BUT01', unit: 'cây', price: 5000 }]
  }, overrides);
}
function makeItem(periodId, overrides) {
  return Object.assign({ id: 501, periodId, creator: USER.username, dept: USER.dept, status: 'DRAFT', items: [{ name: 'Bút', qty: 1 }], history: [] }, overrides);
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

// ===== 1) CREATE_MODULE_CONFIGS.vppRegistrations.extraValidate (tạo nháp) =====
test('[Tạo nháp] LỖI ĐÃ VÁ: endDate hôm trước theo giờ UTC nhưng ĐÃ QUA theo giờ VN (00:30 sáng) -> PHẢI bị chặn 409', () => {
  withFixedVnNow(() => {
    const payload = { periodId: 1, items: [] };
    const appData = { vppPeriods: [makePeriod('2025-12-31')], vppExcludedJobTitles: [] };
    assert.throws(
      () => CREATE_MODULE_CONFIGS.vppRegistrations.extraValidate(payload, [], USER, appData),
      /đã kết thúc/,
      'phải bị chặn 409 "đã kết thúc" — nếu không chặn, vẫn còn lỗi UTC cũ'
    );
  });
});

test('[Tạo nháp] đối chứng: endDate HÔM NAY (giờ VN, 01/01/2026) vẫn CHƯA qua hạn -> tạo được bình thường', () => {
  withFixedVnNow(() => {
    const payload = { periodId: 1, items: [{ name: 'Bút', qty: 1 }] };
    const appData = { vppPeriods: [makePeriod('2026-01-01')], vppExcludedJobTitles: [] };
    assert.doesNotThrow(() => CREATE_MODULE_CONFIGS.vppRegistrations.extraValidate(payload, [], USER, appData));
  });
});

// ===== 2) submitVppRegistration() (Gửi) =====
test('[Gửi] LỖI ĐÃ VÁ: endDate hôm trước theo giờ UTC nhưng ĐÃ QUA theo giờ VN -> PHẢI bị chặn 409', () => {
  withFixedVnNow(() => {
    const period = makePeriod('2025-12-31');
    const item = makeItem(1);
    assert.throws(
      () => recordActions.submitVppRegistration(USER, item, period, [], []),
      /đã kết thúc/
    );
  });
});

test('[Gửi] đối chứng: endDate TƯƠNG LAI vẫn gửi được bình thường', () => {
  withFixedVnNow(() => {
    const period = makePeriod('2026-06-30');
    const item = makeItem(1);
    const result = recordActions.submitVppRegistration(USER, item, period, [], []);
    assert.strictEqual(result.status, 'PENDING');
  });
});

// ===== 3) updateVppRegistrationDraft() (Sửa nháp) =====
test('[Sửa nháp] LỖI ĐÃ VÁ: endDate hôm trước theo giờ UTC nhưng ĐÃ QUA theo giờ VN -> PHẢI bị chặn 409', () => {
  withFixedVnNow(() => {
    const period = makePeriod('2025-12-31');
    const item = makeItem(1);
    const payload = { items: [{ name: 'Bút', qty: 2 }] };
    assert.throws(
      () => recordActions.updateVppRegistrationDraft(USER, item, payload, period, [], {}),
      /đã kết thúc/
    );
  });
});

test('[Sửa nháp] đối chứng: endDate TƯƠNG LAI vẫn sửa được bình thường', () => {
  withFixedVnNow(() => {
    const period = makePeriod('2026-06-30');
    const item = makeItem(1);
    const payload = { items: [{ name: 'Bút', qty: 2 }] };
    assert.doesNotThrow(() => recordActions.updateVppRegistrationDraft(USER, item, payload, period, [], {}));
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
