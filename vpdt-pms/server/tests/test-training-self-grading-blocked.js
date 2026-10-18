'use strict';

// tests/test-training-self-grading-blocked.js
//
// LỖI ĐÃ VÁ (re-audit lần 5, mức Trung Bình — "Tự chấm/tự xác nhận/tự cấp chứng chỉ đào tạo cho chính
// mình"): 7 hành động Đào Tạo gác bằng canManageTraining()/canManageTrainingClass()/
// canEvaluateOnboardingStage3() (trainingManage/trainingInstruct/onboardingEvaluate/admin) — tất cả chỉ
// kiểm QUYỀN, không hề kiểm actor có PHẢI LÀ chính người được chấm/xác nhận/cấp chứng chỉ hay không:
//   1) setTrainingRegistrationResult() — chấm tay kết quả Đạt/Không đạt 1 lớp OFFLINE không gán test.
//   2) gradeTrainingTestEssayAnswers() — chấm điểm câu hỏi Nghị Luận của 1 bài test đã nộp.
//   3) confirmOnboardingStage() — xác nhận hoàn thành Giai đoạn 1/2 Tân Binh.
//   4) evaluateOnboardingStage3() — đánh giá Giai đoạn 3 Tân Binh (canEvaluateOnboardingStage3() so
//      dept TRỰC TIẾP — dept của CHÍNH MÌNH luôn trùng dept của mình, không loại trừ được tự đánh giá).
//   5) reevaluateOnboardingStage3() — đánh giá lại Giai đoạn 3 sau khi FAILED.
//   6) issueOnboardingCertificate() — cấp Chứng Chỉ Hoàn Thành đào tạo tân binh.
//   7) confirmCareerPathForEmployee() — xác nhận 1 cấp bậc Lộ Trình Thăng Tiến.
// 1 tài khoản vừa có quyền quản lý đào tạo (trainingManage/trainingInstruct/onboardingEvaluate) nhưng
// ĐANG đồng thời là học viên/nhân viên mới ở CHÍNH lớp/lộ trình/hồ sơ đó có thể tự chấm Đạt cho mình, tự
// xác nhận/tự đánh giá cho mình, rồi tự cấp luôn chứng chỉ — không ai khác xác nhận lại.
//
// Đã vá: assertNotSelfInTrainingAction(user, targetUsername, actionLabel) (lib/recordActions.js) — chặn
// CỨNG (403) khi targetUsername === user.username, không phân biệt admin (cùng khuôn các
// assertNotSelfDecidingXxx() khác đã bỏ nhánh admin-bypass theo quyết định 11/2026).
//
// Test gọi THẲNG 7 hàm lib (cùng khuôn test-hrprofile-export-salary-permission.js).
//
// Chạy: node server/tests/test-training-self-grading-blocked.js
const assert = require('assert');
const recordActions = require('../lib/recordActions');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err && err.stack ? err.stack : err}`); }
}

const SELF = { username: 'gv1', name: 'Giảng Viên 1', dept: 'Phòng A', perms: { trainingManage: true, onboardingEvaluate: true } };
const OTHER_ACTOR = { username: 'hr1', name: 'Nhân Sự 1', dept: 'Phòng A', perms: { trainingManage: true, onboardingEvaluate: true } };
const CLS = { id: 1, instructorUsername: 'gv1' };

(async () => {
  await test('LỖI ĐÃ VÁ: setTrainingRegistrationResult() — tự chấm kết quả lớp của chính mình bị chặn 403', () => {
    const reg = { classId: 1, creator: 'gv1', result: 'REGISTERED' };
    assert.throws(
      () => recordActions.setTrainingRegistrationResult({ result: 'PASSED' }, SELF, reg, CLS),
      /không thể tự.*chính mình/i
    );
  });
  await test('setTrainingRegistrationResult() — HR khác chấm kết quả cho người khác vẫn hoạt động bình thường', () => {
    const reg = { classId: 1, creator: 'gv1', result: 'REGISTERED' };
    const updated = recordActions.setTrainingRegistrationResult({ result: 'PASSED' }, OTHER_ACTOR, reg, CLS);
    assert.strictEqual(updated.result, 'PASSED');
  });

  await test('LỖI ĐÃ VÁ: gradeTrainingTestEssayAnswers() — tự chấm bài nghị luận của chính mình bị chặn 403', () => {
    const sub = { username: 'gv1', gradingStatus: 'PENDING_ESSAY_GRADING', answers: [], score: 0, totalPoints: 10 };
    const test1 = { questions: [{ id: 1, type: 'ESSAY', points: 10, text: 'Câu 1' }] };
    assert.throws(
      () => recordActions.gradeTrainingTestEssayAnswers(SELF, sub, test1, CLS, [{ questionId: 1, pointsAwarded: 10 }]),
      /không thể tự.*chính mình/i
    );
  });
  await test('gradeTrainingTestEssayAnswers() — HR khác chấm bài nghị luận của người khác vẫn hoạt động bình thường', () => {
    const sub = { username: 'gv1', gradingStatus: 'PENDING_ESSAY_GRADING', answers: [], score: 0, totalPoints: 10 };
    const test1 = { questions: [{ id: 1, type: 'ESSAY', points: 10, text: 'Câu 1' }] };
    const updated = recordActions.gradeTrainingTestEssayAnswers(OTHER_ACTOR, sub, test1, CLS, [{ questionId: 1, pointsAwarded: 10 }]);
    assert.strictEqual(updated.gradingStatus, 'COMPLETE');
  });

  await test('LỖI ĐÃ VÁ: confirmOnboardingStage() — tự xác nhận Giai đoạn 1 Tân Binh của chính mình bị chặn 403', () => {
    const progress = { employeeUsername: 'gv1', stage1Result: null, stage2Result: null };
    const path = { id: 1 };
    assert.throws(
      () => recordActions.confirmOnboardingStage({ stage: 1 }, SELF, progress, path),
      /không thể tự.*chính mình/i
    );
  });
  await test('confirmOnboardingStage() — HR khác xác nhận cho người khác vẫn hoạt động bình thường', () => {
    const progress = { employeeUsername: 'gv1', stage1Result: null, stage2Result: null };
    const path = { id: 1 };
    const updated = recordActions.confirmOnboardingStage({ stage: 1 }, OTHER_ACTOR, progress, path);
    assert.strictEqual(updated.stage1Result, 'CONFIRMED');
  });

  await test('LỖI ĐÃ VÁ: evaluateOnboardingStage3() — tự đánh giá Giai đoạn 3 của chính mình bị chặn 403 (dù cùng dept = chính mình)', () => {
    const progress = { employeeUsername: 'gv1', stage1Result: 'CONFIRMED', stage2Result: 'CONFIRMED', stage3Evaluation: null };
    assert.throws(
      () => recordActions.evaluateOnboardingStage3({ evaluation: 'PASSED' }, SELF, progress, [SELF]),
      /không thể tự.*chính mình/i
    );
  });
  await test('evaluateOnboardingStage3() — HR khác đánh giá cho người khác vẫn hoạt động bình thường', () => {
    const progress = { employeeUsername: 'gv1', stage1Result: 'CONFIRMED', stage2Result: 'CONFIRMED', stage3Evaluation: null };
    const updated = recordActions.evaluateOnboardingStage3({ evaluation: 'PASSED' }, OTHER_ACTOR, progress, [SELF, OTHER_ACTOR]);
    assert.strictEqual(updated.stage3Evaluation, 'PASSED');
  });

  await test('LỖI ĐÃ VÁ: reevaluateOnboardingStage3() — tự đánh giá lại Giai đoạn 3 của chính mình bị chặn 403', () => {
    const progress = { employeeUsername: 'gv1', stage3Evaluation: 'FAILED', certificateIssued: false };
    assert.throws(
      () => recordActions.reevaluateOnboardingStage3({ evaluation: 'PASSED', note: 'Cải thiện' }, SELF, progress, [SELF]),
      /không thể tự.*chính mình/i
    );
  });

  await test('LỖI ĐÃ VÁ: issueOnboardingCertificate() — tự cấp chứng chỉ hoàn thành cho chính mình bị chặn 403', () => {
    const progress = { employeeUsername: 'gv1', stage1Result: 'CONFIRMED', stage2Result: 'CONFIRMED', stage3Evaluation: 'PASSED', certificateIssued: false };
    assert.throws(
      () => recordActions.issueOnboardingCertificate(SELF, progress),
      /không thể tự.*chính mình/i
    );
  });
  await test('issueOnboardingCertificate() — HR khác cấp chứng chỉ cho người khác vẫn hoạt động bình thường', () => {
    const progress = { employeeUsername: 'gv1', stage1Result: 'CONFIRMED', stage2Result: 'CONFIRMED', stage3Evaluation: 'PASSED', certificateIssued: false };
    const updated = recordActions.issueOnboardingCertificate(OTHER_ACTOR, progress);
    assert.strictEqual(updated.certificateIssued, true);
  });

  await test('LỖI ĐÃ VÁ: confirmCareerPathForEmployee() — tự xác nhận cấp bậc Lộ Trình Thăng Tiến của chính mình bị chặn 403', () => {
    const path = { id: 1, stages: [{ name: 'Cấp 1', requiredCourseIds: [] }] };
    assert.throws(
      () => recordActions.confirmCareerPathForEmployee({ username: 'gv1', stageIndex: 0 }, SELF, path, [], [], [SELF], []),
      /không thể tự.*chính mình/i
    );
  });
  await test('confirmCareerPathForEmployee() — HR khác xác nhận cấp bậc cho người khác vẫn hoạt động bình thường', () => {
    const path = { id: 1, stages: [{ name: 'Cấp 1', requiredCourseIds: [] }] };
    const confirmation = recordActions.confirmCareerPathForEmployee({ username: 'gv1', stageIndex: 0 }, OTHER_ACTOR, path, [], [], [SELF, OTHER_ACTOR], []);
    assert.strictEqual(confirmation.username, 'gv1');
    assert.strictEqual(confirmation.confirmedBy, 'hr1');
  });

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
