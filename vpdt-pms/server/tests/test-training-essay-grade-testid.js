// server/tests/test-training-essay-grade-testid.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu Truyền Thông Nội Bộ, 9/2026): route
// POST /trainingClasses/:classId/submissions/:submissionId/grade-essay (routes/records.js) trước đây
// tra đề thi để lấy câu hỏi Nghị Luận theo `cls.testId` (đề ĐANG GÁN CHO LỚP tại thời điểm CHẤM) thay vì
// `sub.testId` (đề THẬT SỰ học viên đã làm lúc NỘP BÀI, lưu sẵn trên chính bản ghi nộp). Nếu ai đó đổi
// đề của lớp SAU khi học viên nộp bài nhưng TRƯỚC khi giảng viên chấm, câu hỏi Nghị Luận tra ra thuộc đề
// MỚI trong khi câu trả lời (sub.answers[].questionId) vẫn của đề CŨ — bài nộp có thể kẹt vĩnh viễn ở
// PENDING_ESSAY_GRADING (đề mới không có câu Nghị Luận nào) hoặc bị chấm sai lệch hoàn toàn theo
// questionId của đề mới.
//
// Bài test này KHÔNG mở trình duyệt Playwright — boot thẳng router thật (routes/records.js) trong tiến
// trình Node, chỉ giả lập tầng lưu trữ (lib/recordStore) + xác thực (lib/auth) + lib/appData, cùng khuôn
// Phần B của tests/test-attendance-leave.js.
//
// Chạy: node server/tests/test-training-essay-grade-testid.js
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const STORE = { trainingClasses: [], trainingTests: [], trainingTestSubmissions: [], trainingRegistrations: [] };
let nextId = 1000;
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(STORE)),
  getAllForCollection: async (c) => (STORE[c] || []).slice(),
  getAllForCollectionCached: async (c) => (STORE[c] || []).slice(),
  withAppLock: async (key, fn) => fn(),
  createForCollection: async (c, builderFn) => {
    const draft = await builderFn((STORE[c] || []).slice());
    const item = Object.assign({ id: nextId++ }, draft);
    (STORE[c] = STORE[c] || []).push(item);
    return item;
  },
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = STORE[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    const result = await mutatorFn(list[idx]);
    list[idx] = result;
    return result;
  }
});

const TRAINER = { username: 'gv1', name: 'Giảng Viên', dept: 'Phòng Nhân Sự', perms: { trainingManage: true }, active: true };
const STUDENT = { username: 'hv1', name: 'Học Viên Một', dept: 'Phòng CNTT', perms: {}, active: true };
const USERS = [TRAINER, STUDENT];
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const username = req.headers['x-demo-user'];
    const fresh = USERS.find(u => u.username === username);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAllAppData: async () => ({ users: USERS }),
  withLockedAppDataValue: async (key, fn) => fn(null)
});

const recordRoutes = require('../routes/records');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || ''} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

async function api(port, method, urlPath, body, asUser) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-demo-user': asUser.username },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

function resetState() {
  STORE.trainingClasses = [];
  STORE.trainingTests = [];
  STORE.trainingTestSubmissions = [];
  STORE.trainingRegistrations = [];
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  console.log('== routes/records.js grade-essay: phải chấm theo ĐỀ CỦA BÀI NỘP (sub.testId), không phải đề hiện tại của lớp (cls.testId) ==');

  await test('Đổi đề của lớp SAU KHI học viên nộp bài, TRƯỚC KHI chấm: vẫn chấm đúng đề học viên đã làm, không kẹt/không sai điểm', async () => {
    resetState();
    // Đề A (học viên đã làm): 1 câu Nghị Luận 10 điểm, id câu hỏi 1.
    const testA = { id: 1, title: 'Đề A', totalPoints: 10, questions: [{ id: 1, type: 'ESSAY', text: 'Trình bày...', points: 10 }] };
    // Đề B (lớp bị đổi sang SAU khi học viên đã nộp): câu hỏi id KHÁC hẳn (id 2), cũng là ESSAY nhưng
    // khác thang điểm — mô phỏng đúng kịch bản "đổi đề giữa chừng" gây lệch điểm nếu tra nhầm theo lớp.
    const testB = { id: 2, title: 'Đề B', totalPoints: 20, questions: [{ id: 2, type: 'ESSAY', text: 'Câu khác hẳn...', points: 20 }] };
    STORE.trainingTests = [testA, testB];
    // Lớp hiện đang gán đề B (đã bị đổi sau khi hv1 nộp bài theo đề A).
    STORE.trainingClasses = [{ id: 10, title: 'Lớp Test', testId: 2, instructorUsername: TRAINER.username, passScore: 70 }];
    STORE.trainingTestSubmissions = [{
      id: 20, testId: 1, classId: 10, username: STUDENT.username, name: STUDENT.name,
      answers: [{ questionId: 1, essayPointsAwarded: null }],
      score: 0, totalPoints: 10, percentage: null, passed: null,
      gradingStatus: 'PENDING_ESSAY_GRADING', essayGradedBy: null, essayGradedByName: null, essayGradedAt: null
    }];
    STORE.trainingRegistrations = [{ id: 30, classId: 10, creator: STUDENT.username, result: 'REGISTERED' }];

    const res = await api(port, 'POST', '/api/records/trainingClasses/10/submissions/20/grade-essay',
      { essayGrades: [{ questionId: 1, pointsAwarded: 8 }] }, TRAINER);

    assertEqual(res.status, 200, `Phải chấm thành công theo đúng đề A của bài nộp (lỗi cũ: kẹt 409/404 vì đề B không có câu id 1) — thực tế: ${JSON.stringify(res.body)}`);
    assertEqual(res.body.submission.gradingStatus, 'COMPLETE', 'Phải chuyển sang COMPLETE sau khi chấm xong');
    assertEqual(res.body.submission.score, 8, 'Điểm phải tính theo đúng câu hỏi id 1 của đề A (8 điểm), không phải công thức/thang điểm của đề B');
    assertEqual(res.body.submission.percentage, 80, '80% (8/10) tính theo đúng totalPoints của đề A đã nộp, không phải đề B (totalPoints 20)');
  });

  await test('Đối chứng: nếu KHÔNG có bài test nào khớp sub.testId (đề gốc đã bị xoá), báo lỗi rõ ràng thay vì âm thầm tính sai', async () => {
    resetState();
    STORE.trainingTests = [{ id: 2, title: 'Đề B', totalPoints: 20, questions: [{ id: 2, type: 'ESSAY', text: 'Câu khác', points: 20 }] }];
    STORE.trainingClasses = [{ id: 11, title: 'Lớp Test 2', testId: 2, instructorUsername: TRAINER.username, passScore: 70 }];
    STORE.trainingTestSubmissions = [{
      id: 21, testId: 999, classId: 11, username: STUDENT.username, name: STUDENT.name,
      answers: [], score: 0, totalPoints: 10, percentage: null, passed: null,
      gradingStatus: 'PENDING_ESSAY_GRADING', essayGradedBy: null, essayGradedByName: null, essayGradedAt: null
    }];

    const res = await api(port, 'POST', '/api/records/trainingClasses/11/submissions/21/grade-essay',
      { essayGrades: [{ questionId: 2, pointsAwarded: 5 }] }, TRAINER);
    assertEqual(res.status, 404, 'Đề gốc của bài nộp không còn tồn tại phải báo lỗi rõ ràng, không được âm thầm chấm nhầm theo đề khác');
  });

  console.log('\n== gradeTrainingTestEssayAnswers(): phải chấm theo Điểm Đạt SNAPSHOT lúc nộp bài (passScoreAtSubmit), không phải cls.passScore SỐNG tại thời điểm chấm ==');

  await test('LỖI ĐÃ VÁ (đợt 3, 9/2026): sửa Điểm Đạt của lớp SAU khi học viên nộp bài, TRƯỚC khi chấm nghị luận -> vẫn tính Đạt/Không Đạt theo ngưỡng lúc NỘP BÀI', async () => {
    resetState();
    const testA = { id: 1, title: 'Đề A', totalPoints: 10, questions: [{ id: 1, type: 'ESSAY', text: 'Trình bày...', points: 10 }] };
    STORE.trainingTests = [testA];
    // Lớp BAN ĐẦU passScore=70 lúc học viên nộp bài (snapshot ghi lại đúng 70), SAU ĐÓ quản lý đào tạo
    // sửa lại passScore của lớp thành 90 (siết chặt hơn) TRƯỚC khi giảng viên kịp chấm nghị luận.
    STORE.trainingClasses = [{ id: 10, title: 'Lớp Test', testId: 1, instructorUsername: TRAINER.username, passScore: 90 }];
    STORE.trainingTestSubmissions = [{
      id: 20, testId: 1, classId: 10, username: STUDENT.username, name: STUDENT.name,
      answers: [{ questionId: 1, essayPointsAwarded: null }],
      score: 0, totalPoints: 10, percentage: null, passed: null,
      passScoreAtSubmit: 70, // <-- snapshot lúc nộp bài, KHÔNG PHẢI 90 (giá trị hiện tại của lớp)
      gradingStatus: 'PENDING_ESSAY_GRADING', essayGradedBy: null, essayGradedByName: null, essayGradedAt: null
    }];
    STORE.trainingRegistrations = [{ id: 30, classId: 10, creator: STUDENT.username, result: 'REGISTERED' }];

    // Chấm 8/10 = 80% -> ĐẠT theo ngưỡng 70 (lúc nộp bài), nhưng KHÔNG ĐẠT theo ngưỡng 90 (hiện tại của lớp).
    const res = await api(port, 'POST', '/api/records/trainingClasses/10/submissions/20/grade-essay',
      { essayGrades: [{ questionId: 1, pointsAwarded: 8 }] }, TRAINER);
    assertEqual(res.status, 200, JSON.stringify(res.body));
    assertEqual(res.body.submission.percentage, 80);
    assertEqual(res.body.submission.passed, true, 'Phải ĐẠT theo ngưỡng 70 lúc nộp bài (passScoreAtSubmit), không phải 90 hiện tại của lớp');
  });

  await test('Bài nộp CŨ chưa có passScoreAtSubmit (nộp trước khi có bản vá) -> fallback về cls.passScore hiện tại, không lỗi', async () => {
    resetState();
    const testA = { id: 1, title: 'Đề A', totalPoints: 10, questions: [{ id: 1, type: 'ESSAY', text: 'Trình bày...', points: 10 }] };
    STORE.trainingTests = [testA];
    STORE.trainingClasses = [{ id: 12, title: 'Lớp Test 3', testId: 1, instructorUsername: TRAINER.username, passScore: 70 }];
    STORE.trainingTestSubmissions = [{
      id: 22, testId: 1, classId: 12, username: STUDENT.username, name: STUDENT.name,
      answers: [{ questionId: 1, essayPointsAwarded: null }],
      score: 0, totalPoints: 10, percentage: null, passed: null,
      gradingStatus: 'PENDING_ESSAY_GRADING', essayGradedBy: null, essayGradedByName: null, essayGradedAt: null
      // Cố ý KHÔNG có field passScoreAtSubmit — mô phỏng bài nộp từ TRƯỚC khi có bản vá này.
    }];
    STORE.trainingRegistrations = [{ id: 31, classId: 12, creator: STUDENT.username, result: 'REGISTERED' }];

    const res = await api(port, 'POST', '/api/records/trainingClasses/12/submissions/22/grade-essay',
      { essayGrades: [{ questionId: 1, pointsAwarded: 8 }] }, TRAINER);
    assertEqual(res.status, 200, JSON.stringify(res.body));
    assertEqual(res.body.submission.passed, true, 'Fallback đúng theo cls.passScore=70 hiện tại khi bài nộp không có snapshot');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  server.close();
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
