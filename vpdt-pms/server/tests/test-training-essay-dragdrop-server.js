// tests/test-training-essay-dragdrop-server.js — Kiểm thử hồi quy THUẦN NODE (không Playwright) cho
// phần SERVER của "4 loại câu hỏi Ngân Hàng Câu Hỏi + chấm tay Nghị Luận" (Đợt 10):
//
//   1. lib/createValidation.js (trainingTests.extraValidate) — ESSAY (không cần options/correctOptionIds)
//      và IMAGE_DRAG_DROP (mỗi đáp án BẮT BUỘC 1 ảnh riêng, ngữ nghĩa như MULTI) được chấp nhận đúng;
//      SINGLE/MULTI KHÔNG bị ảnh hưởng (regression).
//   2. lib/fileAuthz.js — ảnh TỪNG ĐÁP ÁN của IMAGE_DRAG_DROP (options[].imageUrl) được bảo vệ giống hệt
//      ảnh minh hoạ câu hỏi (canViewTrainingTestQuestionImage()).
//   3. lib/recordActions.js:
//      - gradeTrainingTestSubmission(): bài KHÔNG có câu ESSAY nào chấm y hệt trước Đợt 10
//        (gradingStatus 'COMPLETE', percentage/passed chốt ngay) — bài CÓ câu ESSAY thì
//        gradingStatus 'PENDING_ESSAY_GRADING', percentage/passed null, score CHỈ tính phần tự động
//        chấm được. IMAGE_DRAG_DROP chấm đúng ngữ nghĩa MULTI (khớp CHÍNH XÁC tập hợp).
//      - gradeTrainingTestEssayAnswers(): gác quyền canManageTrainingClass(), validate điểm 0..points,
//        cộng dồn đúng với điểm tự động chấm, chốt percentage/passed theo cls.passScore.
//      - applyAutoGradedTestResult(): opts.gradedByEssay đổi đúng resultNote/resultBy/resultByName,
//        KHÔNG opts thì hành vi giữ nguyên 100% như trước Đợt 10.
//
// Run: node server/tests/test-training-essay-dragdrop-server.js
const assert = require('assert');

let passed = 0, failed = 0;
async function run(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`);
  }
}

function stubModule(relPath, exportsObj) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true, children: [], paths: [], exports: exportsObj
  };
  return resolved;
}

const MANAGER = { username: 'gv.linh', name: 'Trần Thị Linh', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } };
const INSTRUCTOR_A = { username: 'gv.a', name: 'Giảng Viên A', dept: 'Phòng CNTT', perms: { trainingInstruct: true } };
const INSTRUCTOR_B = { username: 'gv.b', name: 'Giảng Viên B', dept: 'Phòng Kế Toán', perms: { trainingInstruct: true } };
const STUDENT = { username: 'nv1', name: 'Học Viên Một', dept: 'Phòng CNTT', perms: {} };
const OUTSIDER = { username: 'nv3', name: 'Người Ngoài Cuộc', dept: 'Phòng Kế Toán', perms: {} };

async function main() {
  // ===================== 1. lib/createValidation.js =====================
  const { validateAndPrepareCreate, CreateError } = require('../lib/createValidation');

  await run('ESSAY: chấp nhận không cần options/correctOptionIds, giữ points làm điểm tối đa', () => {
    const record = validateAndPrepareCreate('trainingTests', {
      title: 'Bài Test Nghị Luận', category: '',
      questions: [{ text: 'Trình bày quan điểm của bạn về...', type: 'ESSAY', points: 5 }]
    }, MANAGER, [], {});
    const q = record.questions[0];
    assert.strictEqual(q.type, 'ESSAY');
    assert.deepStrictEqual(q.options, []);
    assert.deepStrictEqual(q.correctOptionIds, []);
    assert.strictEqual(q.points, 5);
  });

  await run('ESSAY: câu hỏi vẫn phải có text (KHÔNG bỏ qua ràng buộc chung)', () => {
    assert.throws(
      () => validateAndPrepareCreate('trainingTests', {
        title: 'Bài Test Lỗi', questions: [{ text: '', type: 'ESSAY', points: 5 }]
      }, MANAGER, [], {}),
      (err) => err instanceof CreateError && err.status === 400
    );
  });

  await run('IMAGE_DRAG_DROP: chấp nhận đủ ảnh mỗi đáp án + đáp án đúng hợp lệ', () => {
    const record = validateAndPrepareCreate('trainingTests', {
      title: 'Bài Test Kéo Thả Hình', category: '',
      questions: [{
        text: 'Kéo hình con vật sống dưới nước vào khung', type: 'IMAGE_DRAG_DROP', points: 3,
        options: [
          { text: 'Cá', imageUrl: '/uploads/1700000000001-aaaaaaaaaaaaaaaa.png' },
          { text: 'Chó', imageUrl: '/uploads/1700000000002-bbbbbbbbbbbbbbbb.png' },
          { text: 'Tôm', imageUrl: '/uploads/1700000000003-cccccccccccccccc.png' }
        ],
        correctOptionIds: [1, 3]
      }]
    }, MANAGER, [], {});
    const q = record.questions[0];
    assert.strictEqual(q.type, 'IMAGE_DRAG_DROP');
    assert.strictEqual(q.options.length, 3);
    assert.strictEqual(q.options[0].imageUrl, '/uploads/1700000000001-aaaaaaaaaaaaaaaa.png');
    assert.deepStrictEqual(q.correctOptionIds, [1, 3]);
  });

  await run('IMAGE_DRAG_DROP: TỪ CHỐI đáp án thiếu ảnh (chỉ có text)', () => {
    assert.throws(
      () => validateAndPrepareCreate('trainingTests', {
        title: 'Bài Test Lỗi', questions: [{
          text: 'Câu hỏi', type: 'IMAGE_DRAG_DROP', points: 1,
          options: [{ text: 'A', imageUrl: '/uploads/aaa.png' }, { text: 'B (thiếu ảnh)', imageUrl: '' }],
          correctOptionIds: [1]
        }]
      }, MANAGER, [], {}),
      (err) => err instanceof CreateError && err.status === 400 && /cần ít nhất 2 đáp án/.test(err.message)
    );
  });

  await run('IMAGE_DRAG_DROP: TỪ CHỐI ảnh đáp án scheme javascript: (cùng lỗ hổng stored-XSS đã vá cho ảnh câu hỏi)', () => {
    assert.throws(
      () => validateAndPrepareCreate('trainingTests', {
        title: 'Bài Test Lỗi', questions: [{
          text: 'Câu hỏi', type: 'IMAGE_DRAG_DROP', points: 1,
          options: [
            { text: 'A', imageUrl: 'javascript:alert(1)' },
            { text: 'B', imageUrl: '/uploads/bbb.png' }
          ],
          correctOptionIds: [1]
        }]
      }, MANAGER, [], {}),
      (err) => err instanceof CreateError && err.status === 400
    );
  });

  await run('IMAGE_DRAG_DROP: TỪ CHỐI khi chưa chọn đáp án đúng nào', () => {
    assert.throws(
      () => validateAndPrepareCreate('trainingTests', {
        title: 'Bài Test Lỗi', questions: [{
          text: 'Câu hỏi', type: 'IMAGE_DRAG_DROP', points: 1,
          options: [{ text: 'A', imageUrl: '/uploads/aaa.png' }, { text: 'B', imageUrl: '/uploads/bbb.png' }],
          correctOptionIds: []
        }]
      }, MANAGER, [], {}),
      (err) => err instanceof CreateError && err.status === 400 && /chưa chọn đáp án đúng/.test(err.message)
    );
  });

  await run('SINGLE/MULTI: không thay đổi hành vi (regression) — vẫn cần ≥2 đáp án text + đáp án đúng', () => {
    const record = validateAndPrepareCreate('trainingTests', {
      title: 'Bài Test Thường', category: '',
      questions: [
        { text: 'Câu 1 số ít', type: 'SINGLE', points: 1, options: [{ text: 'A' }, { text: 'B' }], correctOptionIds: [1] },
        { text: 'Câu 2 nhiều', type: 'MULTI', points: 2, options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }], correctOptionIds: [1, 3] }
      ]
    }, MANAGER, [], {});
    assert.strictEqual(record.questions[0].type, 'SINGLE');
    assert.strictEqual(record.questions[1].type, 'MULTI');
    assert.deepStrictEqual(record.questions[1].correctOptionIds, [1, 3]);
  });

  await run('type không hợp lệ/không gửi -> mặc định SINGLE (regression, giữ nguyên fallback cũ)', () => {
    const record = validateAndPrepareCreate('trainingTests', {
      title: 'Bài Test Mặc Định', questions: [{ text: 'Câu hỏi', options: [{ text: 'A' }, { text: 'B' }], correctOptionIds: [1] }]
    }, MANAGER, [], {});
    assert.strictEqual(record.questions[0].type, 'SINGLE');
  });

  // ===================== 2. lib/fileAuthz.js — ảnh TỪNG ĐÁP ÁN (IMAGE_DRAG_DROP) =====================
  const TEST_WITH_OPTION_IMAGES = {
    id: 1, title: 'Bài Test Kéo Thả', category: '',
    questions: [{
      id: 1, text: 'Câu 1', type: 'IMAGE_DRAG_DROP', points: 1,
      options: [
        { id: 1, text: 'A', imageUrl: '/uploads/opt-a-0123456789abcdef.png' },
        { id: 2, text: 'B', imageUrl: '/uploads/opt-b-0123456789abcdef.png' }
      ],
      correctOptionIds: [1], imageUrl: ''
    }]
  };
  const CLASS_A = { id: 100, testId: 1, instructorUsername: INSTRUCTOR_A.username };
  const REG_ENROLLED = { id: 200, classId: 100, creator: STUDENT.username, result: 'REGISTERED' };
  const COLLECTIONS = {
    trainingTests: [TEST_WITH_OPTION_IMAGES],
    trainingClasses: [CLASS_A],
    trainingRegistrations: [REG_ENROLLED]
  };
  const EMPTY_COLLECTIONS = ['docs', 'submissions', 'contracts', 'carRegs', 'officeReqs', 'internalPosts',
    'itPriceApprovals', 'reportEntries', 'reportPeriods', 'recruitmentReferrals', 'licenses',
    'itServiceRenewals', 'operationOrders', 'operationStoreOpenings', 'operationRepairs'];
  stubModule('../lib/recordStore', {
    getAllForCollection: async (name) => COLLECTIONS[name] || (EMPTY_COLLECTIONS.includes(name) ? [] : []),
    getAllTrashItemsCached: async () => []
  });
  stubModule('../lib/appData', {
    getAllAppData: async () => ({}),
    getAppDataValue: async () => ({})
  });
  const { authorizeFileAccess } = require('../lib/fileAuthz');
  const optImgUrl = TEST_WITH_OPTION_IMAGES.questions[0].options[0].imageUrl;

  await run('authorizeFileAccess: ảnh TỪNG ĐÁP ÁN (IMAGE_DRAG_DROP) được bảo vệ giống ảnh câu hỏi — trainingManage xem được', async () => {
    assert.strictEqual(await authorizeFileAccess(MANAGER, optImgUrl, 'view'), true);
  });
  await run('authorizeFileAccess: giảng viên được gán cho lớp dùng đúng bài test xem được ảnh đáp án', async () => {
    assert.strictEqual(await authorizeFileAccess(INSTRUCTOR_A, optImgUrl, 'download'), true);
  });
  await run('authorizeFileAccess: giảng viên KHÁC không xem được ảnh đáp án', async () => {
    assert.strictEqual(await authorizeFileAccess(INSTRUCTOR_B, optImgUrl, 'view'), false);
  });
  await run('authorizeFileAccess: người ngoài cuộc không xem được ảnh đáp án — không rơi vào FAIL-OPEN', async () => {
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, optImgUrl, 'view'), false);
  });

  // ===================== 3. lib/recordActions.js =====================
  const {
    gradeTrainingTestSubmission, applyAutoGradedTestResult, gradeTrainingTestEssayAnswers, canManageTrainingClass
  } = require('../lib/recordActions');

  const testNoEssay = {
    id: 1, questions: [
      { id: 1, type: 'SINGLE', points: 2, correctOptionIds: [1] },
      { id: 2, type: 'MULTI', points: 3, correctOptionIds: [1, 3] }
    ]
  };
  await run('gradeTrainingTestSubmission(): KHÔNG có câu ESSAY -> gradingStatus COMPLETE, percentage/passed chốt ngay (regression, y hệt trước Đợt 10)', () => {
    const graded = gradeTrainingTestSubmission(
      [{ questionId: 1, selectedOptionIds: [1] }, { questionId: 2, selectedOptionIds: [1, 3] }],
      testNoEssay, 70
    );
    assert.strictEqual(graded.gradingStatus, 'COMPLETE');
    assert.strictEqual(graded.score, 5);
    assert.strictEqual(graded.totalPoints, 5);
    assert.strictEqual(graded.percentage, 100);
    assert.strictEqual(graded.passed, true);
  });

  const testWithEssay = {
    id: 2, questions: [
      { id: 1, type: 'SINGLE', points: 2, correctOptionIds: [1] },
      { id: 2, type: 'IMAGE_DRAG_DROP', points: 3, correctOptionIds: [1, 2] },
      { id: 3, type: 'ESSAY', points: 5 }
    ]
  };
  let submissionAfterSubmit;
  await run('gradeTrainingTestSubmission(): CÓ câu ESSAY -> gradingStatus PENDING_ESSAY_GRADING, percentage/passed null, score CHỈ tính phần tự động chấm', () => {
    const graded = gradeTrainingTestSubmission(
      [
        { questionId: 1, selectedOptionIds: [1] }, // đúng, +2
        { questionId: 2, selectedOptionIds: [1, 2] }, // IMAGE_DRAG_DROP đúng như MULTI, +3
        { questionId: 3, essayText: 'Bài làm của tôi về chủ đề này...' }
      ],
      testWithEssay, 70
    );
    assert.strictEqual(graded.gradingStatus, 'PENDING_ESSAY_GRADING');
    assert.strictEqual(graded.score, 5, 'chỉ tính 2 câu tự động chấm được (2+3), KHÔNG tính câu ESSAY');
    assert.strictEqual(graded.totalPoints, 10);
    assert.strictEqual(graded.percentage, null);
    assert.strictEqual(graded.passed, null);
    const essayAnswer = graded.answers.find((a) => a.questionId === 3);
    assert.strictEqual(essayAnswer.essayText, 'Bài làm của tôi về chủ đề này...');
    assert.strictEqual(essayAnswer.essayPointsAwarded, null);
    submissionAfterSubmit = {
      id: 999, classId: 100, username: STUDENT.username,
      answers: graded.answers, score: graded.score, totalPoints: graded.totalPoints,
      percentage: graded.percentage, passed: graded.passed, gradingStatus: graded.gradingStatus
    };
  });

  await run('applyAutoGradedTestResult(): KHÔNG opts (luồng cũ) — resultBy null, resultByName "Hệ thống..." (regression)', () => {
    const reg = { result: 'REGISTERED' };
    applyAutoGradedTestResult(reg, { passed: true, percentage: 100, score: 5, totalPoints: 5 });
    assert.strictEqual(reg.result, 'PASSED');
    assert.strictEqual(reg.resultBy, null);
    assert.strictEqual(reg.resultByName, 'Hệ thống (tự động chấm bài test)');
    assert.ok(reg.resultNote.includes('Tự động chấm từ bài test'));
  });

  await run('gradeTrainingTestEssayAnswers(): TỪ CHỐI người không quản lý được lớp này (403)', () => {
    const cls = { id: 100, passScore: 70, instructorUsername: INSTRUCTOR_A.username };
    assert.throws(
      () => gradeTrainingTestEssayAnswers(INSTRUCTOR_B, { ...submissionAfterSubmit }, testWithEssay, cls, [{ questionId: 3, pointsAwarded: 4 }]),
      (err) => err.status === 403
    );
  });

  await run('gradeTrainingTestEssayAnswers(): CHO PHÉP giảng viên được gán đúng lớp (canManageTrainingClass) — mirrors setTrainingRegistrationResult()', () => {
    const cls = { id: 100, passScore: 70, instructorUsername: INSTRUCTOR_A.username };
    assert.strictEqual(canManageTrainingClass(INSTRUCTOR_A, cls), true);
  });

  await run('gradeTrainingTestEssayAnswers(): TỪ CHỐI điểm vượt quá điểm tối đa của câu (400)', () => {
    const cls = { id: 100, passScore: 70 };
    assert.throws(
      () => gradeTrainingTestEssayAnswers(MANAGER, { ...submissionAfterSubmit }, testWithEssay, cls, [{ questionId: 3, pointsAwarded: 999 }]),
      (err) => err.status === 400
    );
  });

  await run('gradeTrainingTestEssayAnswers(): TỪ CHỐI bài không có câu ESSAY nào (409)', () => {
    const cls = { id: 100, passScore: 70 };
    const subNoEssay = { classId: 100, gradingStatus: 'PENDING_ESSAY_GRADING', answers: [] };
    assert.throws(
      () => gradeTrainingTestEssayAnswers(MANAGER, subNoEssay, testNoEssay, cls, []),
      (err) => err.status === 409
    );
  });

  await run('gradeTrainingTestEssayAnswers(): TỪ CHỐI bài đã COMPLETE (409, không cho chấm lại)', () => {
    const cls = { id: 100, passScore: 70 };
    const subDone = { ...submissionAfterSubmit, gradingStatus: 'COMPLETE' };
    assert.throws(
      () => gradeTrainingTestEssayAnswers(MANAGER, subDone, testWithEssay, cls, [{ questionId: 3, pointsAwarded: 4 }]),
      (err) => err.status === 409
    );
  });

  let finalizedSubmission;
  await run('gradeTrainingTestEssayAnswers(): chấm hợp lệ (4/5) -> cộng dồn đúng với điểm tự động (5) = 9/10 = 90%, gradingStatus COMPLETE', () => {
    const cls = { id: 100, passScore: 70 };
    const sub = { ...submissionAfterSubmit, answers: submissionAfterSubmit.answers.map((a) => ({ ...a })) };
    const result = gradeTrainingTestEssayAnswers(MANAGER, sub, testWithEssay, cls, [{ questionId: 3, pointsAwarded: 4 }]);
    assert.strictEqual(result.score, 9);
    assert.strictEqual(result.percentage, 90);
    assert.strictEqual(result.passed, true, 'passScore lớp là 70%, 90% >= 70% -> Đạt');
    assert.strictEqual(result.gradingStatus, 'COMPLETE');
    assert.strictEqual(result.essayGradedBy, MANAGER.username);
    const essayAnswer = result.answers.find((a) => a.questionId === 3);
    assert.strictEqual(essayAnswer.essayPointsAwarded, 4);
    finalizedSubmission = result;
  });

  await run('applyAutoGradedTestResult(): CÓ opts.gradedByEssay — resultNote/resultBy/resultByName phản ánh đúng người đã chấm nghị luận', () => {
    const reg = { result: 'REGISTERED' };
    applyAutoGradedTestResult(reg, finalizedSubmission, { gradedByEssay: { username: MANAGER.username, name: MANAGER.name } });
    assert.strictEqual(reg.result, 'PASSED');
    assert.strictEqual(reg.resultBy, MANAGER.username);
    assert.ok(reg.resultByName.includes(MANAGER.name));
    assert.ok(reg.resultNote.includes('chấm tay phần nghị luận'));
  });

  await run('gradeTrainingTestEssayAnswers(): điểm khác nhau -> cls.passScore quyết định đúng Đạt/Không Đạt (chấm thấp -> FAILED)', () => {
    const cls = { id: 100, passScore: 70 };
    const sub = { ...submissionAfterSubmit, answers: submissionAfterSubmit.answers.map((a) => ({ ...a })) };
    const result = gradeTrainingTestEssayAnswers(MANAGER, sub, testWithEssay, cls, [{ questionId: 3, pointsAwarded: 0 }]);
    assert.strictEqual(result.score, 5);
    assert.strictEqual(result.percentage, 50);
    assert.strictEqual(result.passed, false, '50% < 70% -> Không Đạt');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
