// server/tests/test-audit-round2-internalcomms-training-pure.js
//
// Regression test cho ĐỢT RÀ SOÁT CHUYÊN SÂU VÒNG 2 (9/2026) — cụm "Truyền Thông Nội Bộ / Đào Tạo /
// Tuyển Dụng / HCRC Đồng Hành". Phần THUẦN NODE (không HTTP, không Playwright) — gọi thẳng hàm thật của
// lib/createValidation.js + lib/recordActions.js, đúng khuôn tests/test-audit-round4-internal-training.js.
// Phần cần chạy qua route thật (server tự tính giờ/đọc lại bản ghi liên quan) nằm ở bài riêng:
// tests/test-audit-round2-internalcomms-training-routes.js.
//
// Mỗi kịch bản gắn với ĐÚNG 1 phát hiện đã vá, viết sao cho hoàn tác bản vá là FAIL ngay:
//   #2  trainingRegistrations.extraValidate — chặn đăng ký vào lớp ĐÃ kết thúc (OFFLINE sessionState
//       ENDED / ONLINE qua endTime).
//   #3  editTrainingClass() — chặn gán MỚI testId (null -> có giá trị) cho lớp đã có đăng ký chấm TAY
//       (reg.gradedManually).
//   #8  recruitmentReferrals.extraValidate — chống trùng ứng viên (SĐT/email) trong CÙNG 1 job + có
//       getLockKey theo jobId.
//   #9  internalPosts.extraValidate/editInternalPost() — bắt buộc title/content, trần độ dài; comment
//       (add/edit) cắt ở 5000 ký tự.
//   #10 trainingRegistrations.extraValidate — payload.classId được ép kiểu Number rồi GÁN LẠI.
//   #13 editInternalPost() — kiểm lại quyền đăng theo TỪNG type trước khi tự động APPROVED.
//   #14 internalPosts — code SINH LẠI Ở SERVER theo type, không tin client.
//
// Chạy: node server/tests/test-audit-round2-internalcomms-training-pure.js
const assert = require('assert');

const { validateAndPrepareCreate } = require('../lib/createValidation');
const recordActions = require('../lib/recordActions');

let passed = 0, failed = 0;
function run(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.stack}`);
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

const NHANVIEN = { username: 'nv1', name: 'Nguyễn Văn Nhân', dept: 'Kinh Doanh', perms: {} };
const NHANVIEN2 = { username: 'nv2', name: 'Trần Thị Hai', dept: 'Kinh Doanh', perms: {} };
const TRAINER = { username: 'dt1', name: 'Cán Bộ Đào Tạo', dept: 'Hành Chính', perms: { trainingManage: true } };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true } };

// ============================================================================
// #2 — chặn đăng ký vào lớp ĐÃ kết thúc
// ============================================================================
console.log('\n===== #2 trainingRegistrations.extraValidate: chặn đăng ký lớp đã kết thúc =====');

function baseClass(overrides) {
  return Object.assign({
    id: 900, code: 'LH-001', title: 'An toàn lao động', category: 'An toàn', creator: TRAINER.username,
    status: 'OPEN', capacity: 0, registerDeadline: '', inviteList: [], mode: 'ONLINE',
    startTime: '2020-01-01T08:00', endTime: '', sessionState: null
  }, overrides || {});
}

run('Lớp OFFLINE đã "Kết Thúc Lớp" (sessionState ENDED) -> đăng ký bị chặn 409', () => {
  const cls = baseClass({ mode: 'OFFLINE', sessionState: 'ENDED' });
  expectHttpError(() => validateAndPrepareCreate('trainingRegistrations', { classId: 900 }, NHANVIEN, [],
    { trainingClasses: [cls], formTemplates: {} }), 409, 'kết thúc');
});

run('Lớp OFFLINE đang ONGOING (chưa ENDED) -> vẫn đăng ký được bình thường', () => {
  const cls = baseClass({ mode: 'OFFLINE', sessionState: 'ONGOING' });
  const record = validateAndPrepareCreate('trainingRegistrations', { classId: 900 }, NHANVIEN, [],
    { trainingClasses: [cls], formTemplates: {} });
  assert.strictEqual(record.result, 'REGISTERED');
});

run('Lớp ONLINE đã qua endTime (quá khứ) -> đăng ký bị chặn 409', () => {
  const cls = baseClass({ mode: 'ONLINE', endTime: '2020-01-02T08:00' });
  expectHttpError(() => validateAndPrepareCreate('trainingRegistrations', { classId: 900 }, NHANVIEN, [],
    { trainingClasses: [cls], formTemplates: {} }), 409, 'kết thúc');
});

run('Lớp ONLINE có endTime TƯƠNG LAI -> vẫn đăng ký được bình thường', () => {
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const cls = baseClass({ mode: 'ONLINE', endTime: future });
  const record = validateAndPrepareCreate('trainingRegistrations', { classId: 900 }, NHANVIEN, [],
    { trainingClasses: [cls], formTemplates: {} });
  assert.strictEqual(record.result, 'REGISTERED');
});

run('Lớp ONLINE KHÔNG có endTime -> vẫn đăng ký được (chưa có gì để coi là "đã kết thúc")', () => {
  const cls = baseClass({ mode: 'ONLINE', endTime: '' });
  const record = validateAndPrepareCreate('trainingRegistrations', { classId: 900 }, NHANVIEN, [],
    { trainingClasses: [cls], formTemplates: {} });
  assert.strictEqual(record.result, 'REGISTERED');
});

// ============================================================================
// #10 — payload.classId phải được GÁN LẠI (ép kiểu Number)
// ============================================================================
console.log('\n===== #10 trainingRegistrations.extraValidate: payload.classId được ép kiểu =====');

run('Đăng ký gửi classId dạng CHUỖI -> bản ghi lưu classId là SỐ (Number), không phải chuỗi', () => {
  const cls = baseClass();
  const record = validateAndPrepareCreate('trainingRegistrations', { classId: '900' }, NHANVIEN, [],
    { trainingClasses: [cls], formTemplates: {} });
  assert.strictEqual(record.classId, 900);
  assert.strictEqual(typeof record.classId, 'number', 'classId phải là number, không phải string còn sót từ payload gốc');
});

// ============================================================================
// #3 — chặn gán MỚI testId cho lớp đã có đăng ký CHẤM TAY
// ============================================================================
console.log('\n===== #3 editTrainingClass(): chặn gán test sau khi đã chấm tay =====');

function baseClassForEdit(overrides) {
  return Object.assign({
    id: 900, category: 'An toàn', title: 'An toàn lao động', startTime: '2020-01-01T08:00', endTime: '',
    capacity: 0, documentIds: [], testId: null, passScore: null, testSecondsPerQuestion: 120,
    courseId: null, instructorUsername: null, instructor: '', inviteList: []
  }, overrides || {});
}

run('setTrainingRegistrationResult() (chấm tay) đánh dấu reg.gradedManually=true', () => {
  const reg = { id: 1, classId: 900, result: 'REGISTERED', score: null, resultNote: '', pendingCancellation: null };
  const cls = baseClassForEdit();
  const out = recordActions.setTrainingRegistrationResult({ result: 'PASSED', score: 90 }, TRAINER, reg, cls);
  assert.strictEqual(out.gradedManually, true);
});

run('applyAutoGradedTestResult() (chấm tự động qua bài test) đánh dấu reg.gradedManually=false', () => {
  const reg = { id: 2, classId: 900, result: 'REGISTERED', pendingCancellation: null };
  const out = recordActions.applyAutoGradedTestResult(reg, { passed: true, percentage: 85, score: 17, totalPoints: 20 });
  assert.strictEqual(out.gradedManually, false);
});

run('Lớp KHÔNG có test, đã chấm tay 1 đăng ký PASSED -> sửa lớp để GÁN bài test mới bị chặn 409', () => {
  const cls = baseClassForEdit();
  const regs = [{ id: 1, classId: 900, result: 'PASSED', gradedManually: true }];
  const tests = [{ id: 55, title: 'Bài test ATLĐ' }];
  expectHttpError(() => recordActions.editTrainingClass(
    { testId: 55, passScore: 70 }, TRAINER, cls, tests, [], [], regs), 409, 'chấm tay');
  assert.strictEqual(cls.testId, null, 'testId phải giữ nguyên null — không được ghi đè trước khi validate xong');
});

run('Lớp KHÔNG có test, KHÔNG có đăng ký chấm tay nào -> gán test mới vẫn hoạt động bình thường', () => {
  const cls = baseClassForEdit();
  const tests = [{ id: 55, title: 'Bài test ATLĐ' }];
  const out = recordActions.editTrainingClass({ testId: 55, passScore: 70 }, TRAINER, cls, tests, [], [], []);
  assert.strictEqual(out.testId, 55);
});

run('Lớp ĐÃ có test từ trước (testId != null) -> đổi sang test KHÁC vẫn được (không thuộc diện chặn — suốt thời gian đó chấm tay đã bị khoá ở setTrainingRegistrationResult())', () => {
  const cls = baseClassForEdit({ testId: 55, passScore: 70 });
  const regs = [{ id: 1, classId: 900, result: 'PASSED', gradedManually: false }];
  const tests = [{ id: 55, title: 'Bài A' }, { id: 56, title: 'Bài B' }];
  const out = recordActions.editTrainingClass({ testId: 56, passScore: 70 }, TRAINER, cls, tests, [], [], regs);
  assert.strictEqual(out.testId, 56);
});

run('Đăng ký chấm tay của LỚP KHÁC không chặn nhầm việc gán test cho lớp này', () => {
  const cls = baseClassForEdit();
  const regs = [{ id: 1, classId: 901, result: 'PASSED', gradedManually: true }]; // lớp khác (901 != 900)
  const tests = [{ id: 55, title: 'Bài test ATLĐ' }];
  const out = recordActions.editTrainingClass({ testId: 55, passScore: 70 }, TRAINER, cls, tests, [], [], regs);
  assert.strictEqual(out.testId, 55);
});

// ============================================================================
// #8 — chống trùng giới thiệu ứng viên + getLockKey theo jobId
// ============================================================================
console.log('\n===== #8 recruitmentReferrals.extraValidate: chống trùng ứng viên =====');

const RECRUIT_APP_DATA = {
  recruitmentJobs: [{ id: 40, title: 'Nhân viên bán hàng', status: 'OPEN', deadline: '' }],
  formTemplates: {}
};

function referralPayload(overrides) {
  return Object.assign({
    jobId: 40, candidateName: 'Nguyễn Văn A', candidatePhone: '0901234567',
    candidateEmail: 'a@example.com', cvFileUrl: '/uploads/cv-abc123.pdf'
  }, overrides || {});
}

run('Giới thiệu ứng viên TRÙNG SĐT cho CÙNG job (bởi người KHÁC) -> chặn 409', () => {
  const first = validateAndPrepareCreate('recruitmentReferrals', referralPayload(), NHANVIEN, [], RECRUIT_APP_DATA);
  expectHttpError(() => validateAndPrepareCreate('recruitmentReferrals',
    referralPayload({ candidateName: 'Nguyễn Văn A (tên khác)', candidateEmail: 'khac@example.com' }),
    NHANVIEN2, [first], RECRUIT_APP_DATA), 409, 'đã được giới thiệu');
});

run('Trùng EMAIL (khác hoa/thường + khoảng trắng thừa) cho CÙNG job -> vẫn nhận diện trùng', () => {
  const first = validateAndPrepareCreate('recruitmentReferrals', referralPayload(), NHANVIEN, [], RECRUIT_APP_DATA);
  expectHttpError(() => validateAndPrepareCreate('recruitmentReferrals',
    referralPayload({ candidatePhone: '0909999999', candidateEmail: '  A@EXAMPLE.COM  ' }),
    NHANVIEN2, [first], RECRUIT_APP_DATA), 409);
});

run('CÙNG ứng viên (trùng SĐT) nhưng job KHÁC -> KHÔNG bị chặn (chỉ so trong cùng job)', () => {
  const first = validateAndPrepareCreate('recruitmentReferrals', referralPayload(), NHANVIEN, [], RECRUIT_APP_DATA);
  const appData2 = { recruitmentJobs: [...RECRUIT_APP_DATA.recruitmentJobs, { id: 41, title: 'Kế toán', status: 'OPEN', deadline: '' }], formTemplates: {} };
  const record = validateAndPrepareCreate('recruitmentReferrals', referralPayload({ jobId: 41 }), NHANVIEN2, [first], appData2);
  assert.strictEqual(record.jobId, 41);
});

run('Ứng viên KHÁC hoàn toàn (SĐT/email khác) cho CÙNG job -> vẫn giới thiệu được bình thường', () => {
  const first = validateAndPrepareCreate('recruitmentReferrals', referralPayload(), NHANVIEN, [], RECRUIT_APP_DATA);
  const record = validateAndPrepareCreate('recruitmentReferrals',
    referralPayload({ candidateName: 'Lê Thị B', candidatePhone: '0912345678', candidateEmail: 'b@example.com' }),
    NHANVIEN2, [first], RECRUIT_APP_DATA);
  assert.strictEqual(record.candidateName, 'Lê Thị B');
});

run('getLockKey() khoá theo ĐÚNG jobId — 2 job khác nhau không tranh chấp khoá của nhau', () => {
  const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');
  const config = CREATE_MODULE_CONFIGS.recruitmentReferrals;
  assert.ok(typeof config.getLockKey === 'function', 'recruitmentReferrals phải có getLockKey');
  assert.strictEqual(config.getLockKey({ jobId: 40 }), 'recruitment_referral:40');
  assert.strictEqual(config.getLockKey({ jobId: 41 }), 'recruitment_referral:41');
});

// ============================================================================
// #9 — trần độ dài bình luận/bài đăng + bắt buộc title/content
// ============================================================================
console.log('\n===== #9 internalPosts/comment: bắt buộc + trần độ dài =====');

const POST_APP_DATA = {
  internalNewsCategories: [{ key: 'TIN_TUC', label: 'Tin Tức' }],
  internalShareCategories: [{ key: 'CHIA_SE', label: 'Chia Sẻ' }],
  formTemplates: {}
};

run('Tạo bài KHÔNG có title -> chặn 400', () => {
  expectHttpError(() => validateAndPrepareCreate('internalPosts',
    { type: 'SHARE', postCategory: 'CHIA_SE', title: '   ', content: 'Nội dung' }, NHANVIEN, [], POST_APP_DATA),
    400, 'tiêu đề');
});

run('Tạo bài KHÔNG có content -> chặn 400', () => {
  expectHttpError(() => validateAndPrepareCreate('internalPosts',
    { type: 'SHARE', postCategory: 'CHIA_SE', title: 'Có tiêu đề', content: '   ' }, NHANVIEN, [], POST_APP_DATA),
    400, 'nội dung');
});

run('content quá dài -> bị CẮT ở 20000 ký tự, không ném lỗi', () => {
  const record = validateAndPrepareCreate('internalPosts',
    { type: 'SHARE', postCategory: 'CHIA_SE', title: 'Bài dài', content: 'x'.repeat(30000) }, NHANVIEN, [], POST_APP_DATA);
  assert.strictEqual(record.content.length, 20000);
});

run('title quá dài -> bị CẮT ở 300 ký tự', () => {
  const record = validateAndPrepareCreate('internalPosts',
    { type: 'SHARE', postCategory: 'CHIA_SE', title: 'x'.repeat(500), content: 'Nội dung' }, NHANVIEN, [], POST_APP_DATA);
  assert.strictEqual(record.title.length, 300);
});

function seedPost(overrides) {
  return Object.assign({
    id: 1, author: NHANVIEN.username, authorName: NHANVIEN.name, type: 'SHARE', status: 'APPROVED',
    comments: [], likes: [], readBy: [NHANVIEN.username], title: 'Bài viết', content: 'Nội dung'
  }, overrides || {});
}

run('Bình luận quá 5000 ký tự -> lưu bị CẮT ở 5000, không ném lỗi', () => {
  const post = seedPost();
  const out = recordActions.addInternalPostComment({ content: 'a'.repeat(9000) }, NHANVIEN, post);
  assert.strictEqual(out.comments[0].content.length, 5000);
});

run('Sửa bình luận quá 5000 ký tự -> cũng bị CẮT ở 5000', () => {
  const post = seedPost({ comments: [{ id: 5, username: NHANVIEN.username, content: 'cũ', time: 'x' }] });
  const out = recordActions.editInternalPostComment({ content: 'b'.repeat(9000) }, NHANVIEN, post, 5);
  assert.strictEqual(out.comments[0].content.length, 5000);
});

run('Sửa bài (editInternalPost) xoá trắng title -> chặn 400 (không lọt qua như trước)', () => {
  const post = seedPost({ status: 'DRAFT' });
  expectHttpError(() => recordActions.editInternalPost({ title: '   ', content: 'Nội dung' }, NHANVIEN, post, POST_APP_DATA), 400, 'tiêu đề');
});

// ============================================================================
// #13 — sửa bài NEWS/TRAINING/REWARD phải kiểm lại quyền đăng theo type
// ============================================================================
console.log('\n===== #13 editInternalPost(): kiểm lại quyền đăng theo type khi publish =====');

run('Tác giả từng có trainingManage lúc TẠO nháp TRAINING, đã bị THU HỒI quyền -> sửa+gửi lại bị chặn 403', () => {
  const author = { username: 'dt2', name: 'Cán Bộ Đào Tạo Cũ', dept: 'Hành Chính', perms: {} }; // đã mất trainingManage
  const post = seedPost({ type: 'TRAINING', status: 'DRAFT', author: author.username, authorName: author.name, training: { registeredUsers: [] } });
  expectHttpError(() => recordActions.editInternalPost({ title: 'Lớp học mới', content: 'Nội dung' }, author, post, POST_APP_DATA), 403, 'quyền');
  assert.strictEqual(post.status, 'DRAFT', 'Không được tự APPROVED khi quyền đã bị thu hồi');
});

run('Tác giả VẪN còn đủ quyền trainingManage -> sửa+gửi lại vẫn hoạt động bình thường (không chặn oan)', () => {
  const post = seedPost({ type: 'TRAINING', status: 'DRAFT', author: TRAINER.username, authorName: TRAINER.name, training: { registeredUsers: [] } });
  const out = recordActions.editInternalPost({ title: 'Lớp học mới', content: 'Nội dung' }, TRAINER, post, POST_APP_DATA);
  assert.strictEqual(out.status, 'APPROVED');
});

run('SHARE luôn được publish lại (không cần quyền riêng nào), chỉ khác PENDING/APPROVED theo internalPostApprove', () => {
  const post = seedPost({ type: 'SHARE', status: 'NEED_INFO', postCategory: 'CHIA_SE' });
  const out = recordActions.editInternalPost({ title: 'Bài chia sẻ', content: 'Nội dung' }, NHANVIEN, post, POST_APP_DATA);
  assert.strictEqual(out.status, 'PENDING', 'SHARE của người không có quyền duyệt vẫn phải qua hàng chờ');
});

run('Admin luôn sửa+publish lại được MỌI type dù không có quyền riêng', () => {
  const post = seedPost({ type: 'REWARD', status: 'DRAFT', author: ADMIN.username, authorName: ADMIN.name });
  const out = recordActions.editInternalPost({ title: 'Khen thưởng', content: 'Nội dung' }, ADMIN, post, POST_APP_DATA);
  assert.strictEqual(out.status, 'APPROVED');
});

// ============================================================================
// #14 — code sinh lại Ở SERVER theo type, không tin client
// ============================================================================
console.log('\n===== #14 internalPosts: code SINH LẠI ở server theo type =====');

run('Client gửi code tuỳ ý (không đúng khuôn) -> server BỎ QUA, tự sinh lại đúng prefix theo type', () => {
  const record = validateAndPrepareCreate('internalPosts',
    { type: 'NEWS', postCategory: 'TIN_TUC', title: 'Tin tức', content: 'Nội dung', code: 'GIA-MAO-000' },
    { username: 'bbt1', name: 'Ban Biên Tập', dept: 'Hành Chính', perms: { internalNewsCreate: true } }, [], POST_APP_DATA);
  assert.ok(record.code.startsWith('TN-'), `code phải theo đúng prefix TN- (NEWS), thực tế: ${record.code}`);
  assert.notStrictEqual(record.code, 'GIA-MAO-000');
});

run('Mỗi type sinh đúng prefix riêng: NEWS=TN-, TRAINING=DT-, REWARD=KT-, SHARE=CS-', () => {
  const training = validateAndPrepareCreate('internalPosts',
    { type: 'TRAINING', title: 'Lớp học', content: 'Nội dung' }, TRAINER, [], POST_APP_DATA);
  assert.ok(training.code.startsWith('DT-'), training.code);
  const reward = validateAndPrepareCreate('internalPosts',
    { type: 'REWARD', title: 'Khen thưởng', content: 'Nội dung' }, ADMIN, [], POST_APP_DATA);
  assert.ok(reward.code.startsWith('KT-'), reward.code);
  const share = validateAndPrepareCreate('internalPosts',
    { type: 'SHARE', postCategory: 'CHIA_SE', title: 'Chia sẻ', content: 'Nội dung' }, NHANVIEN, [], POST_APP_DATA);
  assert.ok(share.code.startsWith('CS-'), share.code);
});

// ===================== Tổng kết =====================
console.log(`\n===== TỔNG KẾT: ${passed} PASS / ${failed} FAIL =====`);
if (failed > 0) process.exitCode = 1;
