// server/tests/test-audit-round4-internal-training.js
//
// Regression test cho ĐỢT AUDIT CHUYÊN SÂU 9/2026 — cụm "Truyền Thông Nội Bộ / Đào Tạo" (các phát hiện
// mức Cao/Trung bình/Thấp còn lại sau khi lỗi Nghiêm trọng đã được vá ở v23.67). Mỗi kịch bản gắn với
// ĐÚNG 1 bản vá, viết sao cho hoàn tác bản vá là FAIL ngay:
//
//   1. (CAO, lib/createValidation.js internalPosts.extraValidate) Tạo bài đăng KHÔNG whitelist field:
//      validateAndPrepareCreate() spread nguyên payload nên client gửi kèm
//      comments:[{username:'giamdoc',...}]/likes/readBy/createdAt là dựng được bình luận GIẢ MẠO lãnh
//      đạo + lượt thích/lượt xem khống NGAY LÚC TẠO (đường SỬA đã an toàn từ bản vá trước).
//   2. (CAO, lib/recordActions.js approveCancelTrainingRegistration) Duyệt yêu cầu huỷ đăng ký KHÔNG
//      kiểm lại reg.result -> xoá trắng kết quả ĐẠT đã thi thật, không có đường quay lại. Kèm theo:
//      setTrainingRegistrationResult()/applyAutoGradedTestResult() tự dọn pendingCancellation.
//   3. (TB, lib/createValidation.js trainingRegistrations) testStartedAt bị TIÊM ngay lúc ĐĂNG KÝ ->
//      vô hiệu hoá đối chiếu thời gian làm bài (startTrainingTestAttempt() chỉ ghi mốc LẦN ĐẦU).
//   4. (TB, lib/recordActions.js) trainingClasses.status không bao giờ rời 'OPEN' -> 2 nhánh chặn "lớp
//      đã đóng đăng ký" là code chết. Bổ sung closeTrainingClassRegistration()/reopen...().
//   5. (TB, lib/recordActions.js) Giai đoạn 3 Hội Nhập "Không đạt" là ngõ cụt vĩnh viễn. Bổ sung
//      reevaluateOnboardingStage3().
//   6. (THẤP, lib/createValidation.js trainingPlans) Kế Hoạch Đào Tạo nhập tay không so trùng
//      Tháng+Chương Trình+Đơn Vị (đường Excel đã có từ lâu).
//   7. (THẤP, lib/recordActions.js) Không có cách thu hồi 1 mốc Lộ Trình Thăng Tiến xác nhận nhầm.
//      Bổ sung assertCanRevokeCareerPathConfirmation().
//   8. (THẤP, lib/recordViewScope.js) trainingClasses.inviteList trả nguyên vẹn cho MỌI tài khoản qua
//      GET /api/data. Bổ sung sanitizeTrainingClassesForUser().
//
// Test THUẦN Node (không Playwright, không DB): gọi THẲNG hàm thật của lib/createValidation.js +
// lib/recordActions.js + lib/recordViewScope.js với dữ liệu dựng sẵn trong bộ nhớ — đúng khuôn
// tests/test-audit-round3-lowfixes.js. Phần gate moduleAccess + chặn xoá danh mục còn tham chiếu nằm ở
// tầng ROUTE nên được kiểm ở bài riêng: tests/test-audit-round4-internal-data-gate.js.
//
// Chạy: node server/tests/test-audit-round4-internal-training.js
const assert = require('assert');

const { validateAndPrepareCreate } = require('../lib/createValidation');
const recordActions = require('../lib/recordActions');
const { sanitizeTrainingClassesForUser } = require('../lib/recordViewScope');

let passed = 0, failed = 0;
function run(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.message}`);
  }
}

function expectHttpError(fn, status, messagePart) {
  let thrown = null;
  try { fn(); } catch (err) { thrown = err; }
  assert.ok(thrown, 'Phải bị TỪ CHỐI nhưng lại đi lọt (không ném lỗi nào)');
  assert.strictEqual(thrown.status, status, `Sai mã lỗi: ${thrown.status} — ${thrown.message}`);
  if (messagePart) {
    assert.ok(String(thrown.message).includes(messagePart), `Thông điệp lỗi không khớp: ${JSON.stringify(thrown.message)}`);
  }
}

// ===================== Seed dùng chung =====================
const NHANVIEN = { username: 'nv1', name: 'Nguyễn Văn Nhân', dept: 'Kinh Doanh', perms: {} };
const TRAINER = { username: 'dt1', name: 'Cán Bộ Đào Tạo', dept: 'Hành Chính', perms: { trainingManage: true } };
const GIANGVIEN = { username: 'gv1', name: 'Giảng Viên A', dept: 'Hành Chính', perms: { trainingInstruct: true } };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true } };
const QUANLY = { username: 'ql1', name: 'Quản Lý Kinh Doanh', dept: 'Kinh Doanh', perms: { onboardingEvaluate: true } };
const USERS = [NHANVIEN, TRAINER, GIANGVIEN, ADMIN, QUANLY];

// ============================================================================
// 1) CAO — internalPosts: không cho client tự set comments/likes/readBy/createdAt lúc TẠO
// ============================================================================
console.log('\n===== 1) internalPosts.extraValidate: chặn giả mạo tương tác lúc TẠO =====');

const POST_APP_DATA = {
  internalNewsCategories: [{ key: 'TIN_TUC', label: 'Tin Tức' }],
  internalShareCategories: [{ key: 'CHIA_SE', label: 'Chia Sẻ' }],
  formTemplates: {}
};

function fakeCommentPayload() {
  return {
    type: 'SHARE', postCategory: 'CHIA_SE', title: 'Bài chia sẻ', content: 'Nội dung',
    // 4 field TẤN CÔNG — client tự soạn gửi kèm:
    comments: [{ id: 99, username: 'giamdoc', name: 'Giám Đốc', content: 'Tôi rất hài lòng!', time: '01/01/2020' }],
    likes: ['giamdoc', 'truongphong', 'nv2', 'nv3'],
    readBy: ['giamdoc', 'truongphong', 'nv2'],
    createdAt: '01/01/2020, 00:00:00'
  };
}

run('Tạo bài Góc Chia Sẻ kèm comments giả mạo lãnh đạo -> server XOÁ SẠCH, lưu mảng rỗng', () => {
  const record = validateAndPrepareCreate('internalPosts', fakeCommentPayload(), NHANVIEN, [], POST_APP_DATA);
  assert.deepStrictEqual(record.comments, [], 'comments phải bị reset về [] — không nhận bình luận client gửi lúc tạo');
});

run('Tạo bài kèm likes khống -> reset về []', () => {
  const record = validateAndPrepareCreate('internalPosts', fakeCommentPayload(), NHANVIEN, [], POST_APP_DATA);
  assert.deepStrictEqual(record.likes, [], 'likes phải bị reset về []');
});

run('Tạo bài kèm readBy khống -> chỉ còn CHÍNH tác giả', () => {
  const record = validateAndPrepareCreate('internalPosts', fakeCommentPayload(), NHANVIEN, [], POST_APP_DATA);
  assert.deepStrictEqual(record.readBy, [NHANVIEN.username], 'readBy phải là đúng [tác giả]');
});

run('Tạo bài kèm createdAt giả (lùi về năm 2020) -> server tự chốt lại mốc thời gian', () => {
  const record = validateAndPrepareCreate('internalPosts', fakeCommentPayload(), NHANVIEN, [], POST_APP_DATA);
  assert.notStrictEqual(record.createdAt, '01/01/2020, 00:00:00', 'createdAt KHÔNG được lấy giá trị client gửi');
  assert.ok(record.createdAt && typeof record.createdAt === 'string' && record.createdAt.length > 0, 'createdAt vẫn phải có giá trị hợp lệ');
});

run('Bài NEWS (người có quyền đăng tin) cũng bị reset y hệt — không chỉ SHARE', () => {
  const author = { username: 'bbt1', name: 'Ban Biên Tập', dept: 'Hành Chính', perms: { internalNewsCreate: true } };
  const payload = Object.assign(fakeCommentPayload(), { type: 'NEWS', postCategory: 'TIN_TUC' });
  const record = validateAndPrepareCreate('internalPosts', payload, author, [], POST_APP_DATA);
  assert.deepStrictEqual(record.comments, []);
  assert.deepStrictEqual(record.likes, []);
  assert.deepStrictEqual(record.readBy, [author.username]);
});

run('Luồng tạo bài BÌNH THƯỜNG (không gửi 4 field này) vẫn chạy đúng như cũ', () => {
  const record = validateAndPrepareCreate('internalPosts',
    { type: 'SHARE', postCategory: 'CHIA_SE', title: 'Bài sạch', content: 'Nội dung' }, NHANVIEN, [], POST_APP_DATA);
  assert.deepStrictEqual(record.comments, []);
  assert.deepStrictEqual(record.likes, []);
  assert.deepStrictEqual(record.readBy, [NHANVIEN.username]);
  assert.strictEqual(record.status, 'PENDING', 'Bài SHARE của người không có quyền duyệt vẫn phải vào hàng chờ duyệt');
});

// ============================================================================
// 2) CAO — duyệt yêu cầu huỷ đăng ký không được xoá trắng kết quả đã thi
// ============================================================================
console.log('\n===== 2) approveCancelTrainingRegistration(): chặn xoá trắng kết quả đã có =====');

function seedReg(overrides) {
  return Object.assign({
    id: 7001, classId: 900, className: 'An toàn lao động', creator: NHANVIEN.username, creatorName: NHANVIEN.name,
    result: 'REGISTERED', score: null, resultNote: '', resultBy: null, resultByName: null, resultAt: null,
    pendingCancellation: { reason: 'Bận việc', requestedBy: NHANVIEN.username, requestedByName: NHANVIEN.name, requestedAt: 'x' }
  }, overrides || {});
}

run('Học viên đã PASSED mà vẫn còn yêu cầu huỷ treo -> DUYỆT HUỶ bị chặn 409, kết quả còn nguyên', () => {
  const reg = seedReg({ result: 'PASSED', score: 90 });
  expectHttpError(() => recordActions.approveCancelTrainingRegistration({}, TRAINER, reg), 409, 'Từ chối');
  assert.strictEqual(reg.result, 'PASSED', 'Kết quả ĐẠT phải còn nguyên sau lượt duyệt bị từ chối');
  assert.strictEqual(reg.score, 90);
});

run('Học viên đã FAILED -> cũng không duyệt huỷ được (409)', () => {
  const reg = seedReg({ result: 'FAILED', score: 40 });
  expectHttpError(() => recordActions.approveCancelTrainingRegistration({}, TRAINER, reg), 409);
  assert.strictEqual(reg.result, 'FAILED');
});

run('Đăng ký còn REGISTERED -> duyệt huỷ vẫn hoạt động BÌNH THƯỜNG như trước', () => {
  const reg = seedReg();
  const out = recordActions.approveCancelTrainingRegistration({}, TRAINER, reg);
  assert.strictEqual(out.result, 'CANCELLED');
  assert.strictEqual(out.pendingCancellation, null);
  assert.strictEqual(out.resultBy, TRAINER.username);
});

run('Từ chối yêu cầu huỷ vẫn là đường gỡ yêu cầu treo cho hồ sơ đã có kết quả', () => {
  const reg = seedReg({ result: 'PASSED', score: 90 });
  const out = recordActions.rejectCancelTrainingRegistration({}, TRAINER, reg);
  assert.strictEqual(out.pendingCancellation, null);
  assert.strictEqual(out.result, 'PASSED', 'Từ chối yêu cầu huỷ KHÔNG được đụng tới kết quả');
});

run('Ghi nhận kết quả THỦ CÔNG tự dọn luôn yêu cầu huỷ đang treo', () => {
  const reg = seedReg();
  const cls = { id: 900, testId: null, instructorUsername: GIANGVIEN.username };
  const out = recordActions.setTrainingRegistrationResult({ result: 'PASSED', score: 88 }, TRAINER, reg, cls);
  assert.strictEqual(out.result, 'PASSED');
  assert.strictEqual(out.pendingCancellation, null, 'pendingCancellation phải được dọn ngay khi có kết quả');
});

run('Chấm TỰ ĐỘNG từ bài test cũng tự dọn yêu cầu huỷ đang treo', () => {
  const reg = seedReg();
  const out = recordActions.applyAutoGradedTestResult(reg, { passed: true, percentage: 85, score: 17, totalPoints: 20 });
  assert.strictEqual(out.result, 'PASSED');
  assert.strictEqual(out.pendingCancellation, null);
});

// ============================================================================
// 3) TB — testStartedAt không được tiêm lúc ĐĂNG KÝ
// ============================================================================
console.log('\n===== 3) trainingRegistrations.extraValidate: reset testStartedAt =====');

const OPEN_CLASS = {
  id: 900, code: 'LH-001', title: 'An toàn lao động', category: 'An toàn', creator: TRAINER.username,
  status: 'OPEN', capacity: 0, registerDeadline: '', inviteList: [], testId: 55, testSecondsPerQuestion: 60
};
const REG_APP_DATA = { trainingClasses: [OPEN_CLASS], formTemplates: {} };

run('Đăng ký lớp kèm testStartedAt tự cấy -> server reset về null', () => {
  const record = validateAndPrepareCreate('trainingRegistrations',
    { classId: 900, testStartedAt: '2020-01-01T00:00:00.000Z', testStartedAtVN: '01/01/2020' },
    NHANVIEN, [], REG_APP_DATA);
  assert.strictEqual(record.testStartedAt, null, 'testStartedAt phải bị reset — chỉ server đặt lúc bấm Bắt Đầu Làm Bài');
  assert.strictEqual(record.testStartedAtVN, null);
});

run('Sau bản vá, startTrainingTestAttempt() vẫn ghi được mốc THẬT (không bị mốc giả chặn)', () => {
  const record = validateAndPrepareCreate('trainingRegistrations',
    { classId: 900, testStartedAt: '2020-01-01T00:00:00.000Z' }, NHANVIEN, [], REG_APP_DATA);
  record.creator = NHANVIEN.username;
  recordActions.startTrainingTestAttempt(NHANVIEN, record);
  assert.ok(record.testStartedAt, 'Phải ghi được mốc bắt đầu thật');
  const startedMs = new Date(record.testStartedAt).getTime();
  assert.ok(Date.now() - startedMs < 60000, 'Mốc bắt đầu phải là THỜI ĐIỂM HIỆN TẠI, không phải mốc client cấy sẵn');
});

run('evaluateTrainingTestTiming() phát hiện được quá giờ khi mốc bắt đầu là thật', () => {
  const reg = { testStartedAt: new Date(Date.now() - 3600 * 1000).toISOString() };
  const timing = recordActions.evaluateTrainingTestTiming(reg, OPEN_CLASS, { questions: [{ id: 1 }, { id: 2 }] });
  assert.ok(timing, 'Phải tính được thời gian làm bài');
  assert.strictEqual(timing.overTimeLimit, true, 'Làm bài 1 tiếng cho 2 câu × 60s phải bị gắn cờ quá giờ');
});

// ============================================================================
// 4) TB — đóng/mở lại đăng ký lớp học (kích hoạt 2 nhánh chặn vốn là code chết)
// ============================================================================
console.log('\n===== 4) closeTrainingClassRegistration()/reopenTrainingClassRegistration() =====');

function seedClass(overrides) {
  return Object.assign({}, OPEN_CLASS, overrides || {});
}

run('trainingManage đóng đăng ký -> status chuyển CLOSED + ghi dấu người đóng', () => {
  const cls = seedClass();
  const out = recordActions.closeTrainingClassRegistration(TRAINER, cls);
  assert.strictEqual(out.status, 'CLOSED');
  assert.strictEqual(out.registrationClosedBy, TRAINER.username);
});

run('Lớp ĐÃ đóng -> học viên KHÔNG tự đăng ký được nữa (nhánh chặn trước đây là code chết)', () => {
  const closed = seedClass({ status: 'CLOSED' });
  expectHttpError(
    () => validateAndPrepareCreate('trainingRegistrations', { classId: 900 }, NHANVIEN, [], { trainingClasses: [closed], formTemplates: {} }),
    409, 'đã đóng đăng ký');
});

run('Lớp ĐÃ đóng -> thêm học viên HÀNG LOẠT cũng bị chặn 409', () => {
  const closed = seedClass({ status: 'CLOSED' });
  expectHttpError(
    () => recordActions.bulkRegisterTrainingClass({ usernames: [NHANVIEN.username] }, TRAINER, closed, [], USERS),
    409, 'đã đóng đăng ký');
});

run('Người KHÔNG quản lý lớp không đóng được đăng ký (403)', () => {
  const cls = seedClass();
  expectHttpError(() => recordActions.closeTrainingClassRegistration(NHANVIEN, cls), 403);
  assert.strictEqual(cls.status, 'OPEN');
});

run('Giảng viên được gán cho ĐÚNG lớp này thì đóng được', () => {
  const cls = seedClass({ instructorUsername: GIANGVIEN.username });
  const out = recordActions.closeTrainingClassRegistration(GIANGVIEN, cls);
  assert.strictEqual(out.status, 'CLOSED');
});

run('Đóng 2 lần -> lần 2 bị chặn 409', () => {
  const cls = seedClass({ status: 'CLOSED' });
  expectHttpError(() => recordActions.closeTrainingClassRegistration(TRAINER, cls), 409);
});

run('Mở lại đăng ký -> status về OPEN, học viên đăng ký lại được', () => {
  const cls = seedClass({ status: 'CLOSED', registrationClosedBy: TRAINER.username });
  const out = recordActions.reopenTrainingClassRegistration(TRAINER, cls);
  assert.strictEqual(out.status, 'OPEN');
  assert.strictEqual(out.registrationClosedBy, null);
  const record = validateAndPrepareCreate('trainingRegistrations', { classId: 900 }, NHANVIEN, [], { trainingClasses: [out], formTemplates: {} });
  assert.strictEqual(record.result, 'REGISTERED');
});

run('Mở lại 1 lớp đang OPEN -> 409 (không có gì để mở)', () => {
  expectHttpError(() => recordActions.reopenTrainingClassRegistration(TRAINER, seedClass()), 409);
});

// ============================================================================
// 5) TB — đánh giá LẠI Giai đoạn 3 Hội Nhập đã "Không đạt"
// ============================================================================
console.log('\n===== 5) reevaluateOnboardingStage3() =====');

function seedProgress(overrides) {
  return Object.assign({
    id: 8001, employeeUsername: NHANVIEN.username, employeeName: NHANVIEN.name, pathId: 5, pathName: 'Tân binh Kinh Doanh',
    stage1Result: 'CONFIRMED', stage2Result: 'CONFIRMED',
    stage3Evaluation: 'FAILED', stage3EvaluatedBy: QUANLY.username, stage3EvaluatedByName: QUANLY.name,
    stage3EvaluatedAt: '01/09/2026', stage3Note: 'Chưa đạt yêu cầu giao tiếp', certificateIssued: false
  }, overrides || {});
}

run('Trước bản vá: đánh giá lần 2 bị chặn cứng -> đúng là NGÕ CỤT (hành vi cũ giữ nguyên)', () => {
  expectHttpError(() => recordActions.evaluateOnboardingStage3({ evaluation: 'PASSED' }, QUANLY, seedProgress(), USERS), 409);
});

run('Đánh giá LẠI 1 hồ sơ FAILED -> chuyển PASSED, giữ lịch sử lần đánh giá cũ', () => {
  const progress = seedProgress();
  const out = recordActions.reevaluateOnboardingStage3({ evaluation: 'PASSED', note: 'Đã cải thiện rõ rệt' }, QUANLY, progress, USERS);
  assert.strictEqual(out.stage3Evaluation, 'PASSED');
  assert.strictEqual(out.stage3Note, 'Đã cải thiện rõ rệt');
  assert.strictEqual(out.stage3EvaluationHistory.length, 1, 'Phải lưu lại đúng 1 dòng lịch sử đánh giá cũ');
  assert.strictEqual(out.stage3EvaluationHistory[0].evaluation, 'FAILED');
  assert.strictEqual(out.stage3EvaluationHistory[0].replacedBy, QUANLY.username);
});

run('Sau khi đánh giá lại ĐẠT -> cấp được Chứng Chỉ Hoàn Thành (ngõ cụt đã được gỡ)', () => {
  const progress = seedProgress();
  recordActions.reevaluateOnboardingStage3({ evaluation: 'PASSED', note: 'Đã cải thiện' }, QUANLY, progress, USERS);
  const out = recordActions.issueOnboardingCertificate(TRAINER, progress);
  assert.strictEqual(out.certificateIssued, true);
});

run('Đánh giá lại KHÔNG có lý do -> bị chặn 400', () => {
  expectHttpError(() => recordActions.reevaluateOnboardingStage3({ evaluation: 'PASSED', note: '   ' }, QUANLY, seedProgress(), USERS), 400);
});

run('Không được "đánh giá lại" 1 hồ sơ đang ĐẠT (đường hạ kết quả — không mở)', () => {
  expectHttpError(() => recordActions.reevaluateOnboardingStage3({ evaluation: 'FAILED', note: 'Đổi ý' }, QUANLY, seedProgress({ stage3Evaluation: 'PASSED' }), USERS), 409);
});

run('Không được đánh giá lại 1 hồ sơ CHƯA từng đánh giá (phải dùng đường đánh giá thường)', () => {
  expectHttpError(() => recordActions.reevaluateOnboardingStage3({ evaluation: 'PASSED', note: 'x' }, QUANLY, seedProgress({ stage3Evaluation: null }), USERS), 409);
});

run('Hồ sơ đã cấp chứng chỉ -> không đánh giá lại được', () => {
  expectHttpError(() => recordActions.reevaluateOnboardingStage3({ evaluation: 'PASSED', note: 'x' }, QUANLY,
    seedProgress({ certificateIssued: true }), USERS), 409);
});

run('Quản lý KHÁC phòng ban không đánh giá lại được (403 — cùng luật với đánh giá lần đầu)', () => {
  const quanLyKhac = { username: 'ql2', name: 'Quản Lý Khác', dept: 'Hành Chính', perms: { onboardingEvaluate: true } };
  expectHttpError(() => recordActions.reevaluateOnboardingStage3({ evaluation: 'PASSED', note: 'x' }, quanLyKhac, seedProgress(), USERS), 403);
});

// ============================================================================
// 6) THẤP — Kế Hoạch Đào Tạo nhập tay: so trùng Tháng+Chương Trình+Đơn Vị
// ============================================================================
console.log('\n===== 6) trainingPlans.extraValidate: chặn trùng Tháng+Chương Trình+Đơn Vị =====');

const PLAN_APP_DATA = {
  trainingCourses: [{ id: 31, name: 'An toàn lao động' }, { id: 32, name: 'Nghiệp vụ bán hàng' }],
  depts: ['Kinh Doanh', 'Hành Chính'], stores: ['Siêu Thị 1'], formTemplates: {}
};

function planPayload(overrides) {
  return Object.assign({ month: '2026-10', courseId: 31, targetDept: 'Kinh Doanh', plannedClasses: 2, plannedTrainees: 40 }, overrides || {});
}

run('Tạo tay dòng kế hoạch TRÙNG Tháng+Chương Trình+Đơn Vị -> chặn 409', () => {
  const existing = [validateAndPrepareCreate('trainingPlans', planPayload(), TRAINER, [], PLAN_APP_DATA)];
  expectHttpError(() => validateAndPrepareCreate('trainingPlans', planPayload(), TRAINER, existing, PLAN_APP_DATA), 409, 'Tháng + Chương Trình + Đơn Vị');
});

// Lưu ý: targetDept phải khớp CHÍNH XÁC 1 mục trong depts/stores (normalizeTrainingPlanFields() ném 400
// nếu không) nên không kiểm được kịch bản "khác hoa/thường"; chỉ kiểm khoảng trắng thừa — đủ để khẳng
// định khoá so trùng đi qua normalizeDedupKey() dùng chung với đường Excel, không phải so chuỗi thô.
run('Khoảng trắng thừa ở đơn vị vẫn tính là TRÙNG (dùng chung công thức khoá với đường Excel)', () => {
  const existing = [validateAndPrepareCreate('trainingPlans', planPayload(), TRAINER, [], PLAN_APP_DATA)];
  expectHttpError(() => validateAndPrepareCreate('trainingPlans', planPayload({ targetDept: '  Kinh Doanh  ' }), TRAINER, existing, PLAN_APP_DATA), 409);
});

run('Khác THÁNG -> vẫn tạo được bình thường', () => {
  const existing = [validateAndPrepareCreate('trainingPlans', planPayload(), TRAINER, [], PLAN_APP_DATA)];
  const record = validateAndPrepareCreate('trainingPlans', planPayload({ month: '2026-11' }), TRAINER, existing, PLAN_APP_DATA);
  assert.strictEqual(record.month, '2026-11');
});

run('Khác CHƯƠNG TRÌNH -> vẫn tạo được bình thường', () => {
  const existing = [validateAndPrepareCreate('trainingPlans', planPayload(), TRAINER, [], PLAN_APP_DATA)];
  const record = validateAndPrepareCreate('trainingPlans', planPayload({ courseId: 32 }), TRAINER, existing, PLAN_APP_DATA);
  assert.strictEqual(record.courseId, 32);
});

run('Khác ĐƠN VỊ -> vẫn tạo được bình thường', () => {
  const existing = [validateAndPrepareCreate('trainingPlans', planPayload(), TRAINER, [], PLAN_APP_DATA)];
  const record = validateAndPrepareCreate('trainingPlans', planPayload({ targetDept: 'Siêu Thị 1' }), TRAINER, existing, PLAN_APP_DATA);
  assert.strictEqual(record.targetDept, 'Siêu Thị 1');
});

run('Dòng KHÔNG gắn chương trình (courseId rỗng) không bị đánh dấu trùng nhầm', () => {
  const first = validateAndPrepareCreate('trainingPlans', planPayload({ courseId: '' }), TRAINER, [], PLAN_APP_DATA);
  const second = validateAndPrepareCreate('trainingPlans', planPayload({ courseId: '' }), TRAINER, [first], PLAN_APP_DATA);
  assert.strictEqual(second.courseId, null, 'Không có chương trình để so -> vẫn cho tạo (đúng khuôn existingPlanKeys() đường Excel)');
});

// ============================================================================
// 7) THẤP — thu hồi 1 mốc xác nhận Lộ Trình Thăng Tiến
// ============================================================================
console.log('\n===== 7) assertCanRevokeCareerPathConfirmation() =====');

const CONF_CAP1 = { id: 9001, pathId: 5, username: NHANVIEN.username, stageIndex: 0, stageName: 'Cấp 1' };
const CONF_CAP2 = { id: 9002, pathId: 5, username: NHANVIEN.username, stageIndex: 1, stageName: 'Cấp 2' };

run('trainingManage thu hồi được mốc CAO NHẤT đã xác nhận', () => {
  assert.strictEqual(recordActions.assertCanRevokeCareerPathConfirmation(TRAINER, CONF_CAP2, [CONF_CAP1, CONF_CAP2]), true);
});

run('Không thu hồi được cấp DƯỚI khi cấp trên vẫn còn xác nhận (giữ chuỗi tuần tự liền mạch)', () => {
  expectHttpError(() => recordActions.assertCanRevokeCareerPathConfirmation(TRAINER, CONF_CAP1, [CONF_CAP1, CONF_CAP2]), 409, 'Cấp 2');
});

run('Người không có quyền quản lý đào tạo -> 403', () => {
  expectHttpError(() => recordActions.assertCanRevokeCareerPathConfirmation(NHANVIEN, CONF_CAP2, [CONF_CAP1, CONF_CAP2]), 403);
});

run('Mốc của người KHÁC/lộ trình KHÁC không chặn nhầm lượt thu hồi này', () => {
  const ofOther = { id: 9003, pathId: 5, username: 'nv2', stageIndex: 1 };
  assert.strictEqual(recordActions.assertCanRevokeCareerPathConfirmation(TRAINER, CONF_CAP1, [CONF_CAP1, ofOther]), true);
});

run('Sau khi thu hồi, xác nhận LẠI đúng cấp đó được chấp nhận (không còn bị chặn "đã xác nhận rồi")', () => {
  const path = { id: 5, name: 'Lộ trình KD', stages: [{ name: 'Cấp 1', requiredCourseIds: [31] }] };
  const regs = [{ creator: NHANVIEN.username, result: 'PASSED', classId: 900 }];
  const classes = [{ id: 900, courseId: 31, testId: 55 }];
  // Còn mốc cũ -> chặn:
  expectHttpError(() => recordActions.confirmCareerPathForEmployee({ username: NHANVIEN.username, stageIndex: 0 },
    TRAINER, path, regs, [CONF_CAP1], USERS, classes), 409);
  // Đã thu hồi (mốc không còn trong collection) -> xác nhận lại được:
  const draft = recordActions.confirmCareerPathForEmployee({ username: NHANVIEN.username, stageIndex: 0 },
    TRAINER, path, regs, [], USERS, classes);
  assert.strictEqual(draft.stageIndex, 0);
  assert.strictEqual(draft.username, NHANVIEN.username);
});

// ============================================================================
// 8) THẤP — inviteList không còn công khai cho mọi tài khoản
// ============================================================================
console.log('\n===== 8) sanitizeTrainingClassesForUser(): rút gọn inviteList =====');

const INVITED = { username: 'nv_moi', name: 'Người Được Mời', dept: 'Kinh Doanh', perms: {} };
const LIMITED_CLASS = { id: 901, code: 'LH-002', title: 'Lớp quy hoạch cán bộ', status: 'OPEN', instructorUsername: GIANGVIEN.username, inviteList: [INVITED.username, 'nv_khac', 'nv_khac2'] };
const FREE_CLASS = { id: 902, code: 'LH-003', title: 'Lớp mở tự do', status: 'OPEN', inviteList: [] };
const ALL_CLASSES = [LIMITED_CLASS, FREE_CLASS];

run('Người ngoài danh sách mời KHÔNG còn đọc được username ai được mời', () => {
  const out = sanitizeTrainingClassesForUser(ALL_CLASSES, NHANVIEN);
  const cls = out.find(c => c.id === 901);
  assert.ok(!cls.inviteList.includes(INVITED.username), 'Không được lộ username người được mời');
  assert.ok(!cls.inviteList.includes('nv_khac'));
  assert.strictEqual(cls.inviteList.length, 1, 'Vẫn phải KHÁC rỗng để giao diện biết lớp này giới hạn theo danh sách mời');
});

run('Người CÓ trong danh sách mời vẫn tự nhận ra mình được mời (chỉ thấy chính mình)', () => {
  const cls = sanitizeTrainingClassesForUser(ALL_CLASSES, INVITED).find(c => c.id === 901);
  assert.deepStrictEqual(cls.inviteList, [INVITED.username]);
});

run('trainingManage/admin vẫn nhận danh sách mời ĐẦY ĐỦ (cần để sửa lớp)', () => {
  assert.deepStrictEqual(sanitizeTrainingClassesForUser(ALL_CLASSES, TRAINER).find(c => c.id === 901).inviteList, LIMITED_CLASS.inviteList);
  assert.deepStrictEqual(sanitizeTrainingClassesForUser(ALL_CLASSES, ADMIN).find(c => c.id === 901).inviteList, LIMITED_CLASS.inviteList);
});

run('Giảng viên phụ trách CHÍNH lớp đó vẫn nhận danh sách đầy đủ', () => {
  assert.deepStrictEqual(sanitizeTrainingClassesForUser(ALL_CLASSES, GIANGVIEN).find(c => c.id === 901).inviteList, LIMITED_CLASS.inviteList);
});

run('Lớp KHÔNG giới hạn (inviteList rỗng) giữ nguyên, không đụng field nào khác', () => {
  const out = sanitizeTrainingClassesForUser(ALL_CLASSES, NHANVIEN);
  const free = out.find(c => c.id === 902);
  assert.deepStrictEqual(free.inviteList, []);
  const limited = out.find(c => c.id === 901);
  assert.strictEqual(limited.title, LIMITED_CLASS.title, 'Mọi field khác của lớp giữ nguyên (danh mục lớp vẫn công khai)');
  assert.strictEqual(limited.status, 'OPEN');
});

// ===================== Tổng kết =====================
console.log(`\n===== TỔNG KẾT: ${passed} PASS / ${failed} FAIL =====`);
if (failed > 0) process.exitCode = 1;
