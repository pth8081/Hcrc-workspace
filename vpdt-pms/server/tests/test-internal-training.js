// tests/test-internal-training.js — Truyền Thông Nội Bộ > Đào Tạo (TRAINING sub-tab / LMS).
// Question bank (Ngân Hàng Câu Hỏi) creation, class creation (online/offline), bulk-add students via
// picker and via Excel-upload preview, auto-grading on test submission, manual result entry, and the
// offline-class QR check-in button.
//
// Run: node server/tests/test-internal-training.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8992;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const trainer = makeUser({ username: 'gv.linh', name: 'Trần Thị Linh', dept: 'Phòng Nhân Sự', perms: { internalTrainingCreate: true } });
    const nv1 = makeUser({ username: 'nv1', name: 'Học Viên Một', dept: 'Phòng CNTT', perms: {} });
    const nv2 = makeUser({ username: 'nv2', name: 'Học Viên Hai', dept: 'Phòng CNTT', perms: {} });
    const nv3 = makeUser({ username: 'nv3', name: 'Học Viên Ba', dept: 'Phòng Kế Toán', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [trainer, nv1, nv2, nv3]);
    await page.evaluate((u) => finishLogin(u), trainer);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('TESTS'); });

    let testId = null;

    await run('trainer creates a question-bank test with 1 SINGLE + 1 MULTI question', async () => {
      await page.evaluate(() => {
        tbQuestions = [
          { text: 'Thủ đô của Việt Nam là gì?', type: 'SINGLE', points: 2, options: [
            { text: 'TP. Hồ Chí Minh', correct: false }, { text: 'Hà Nội', correct: true }, { text: 'Đà Nẵng', correct: false }
          ] },
          { text: 'Chọn các phòng ban nghiệp vụ (chọn nhiều)?', type: 'MULTI', points: 3, options: [
            { text: 'Phòng Kế Toán', correct: true }, { text: 'Phòng CNTT', correct: false }, { text: 'Phòng Nhân Sự', correct: true }
          ] }
        ];
        document.getElementById('ttTitle').value = 'Bài Test Nội Quy Công Ty';
        document.getElementById('ttCategory').value = 'Nghiệp vụ';
        document.getElementById('ttPassScore').value = '70';
      });
      await page.evaluate(() => submitTrainingTest({ preventDefault() {} }));
      const tests = await page.evaluate(() => DB.trainingTests);
      assertEqual(tests.length, 1, 'expected exactly 1 training test');
      testId = tests[0].id;
      assertEqual(tests[0].questions.length, 2, 'expected 2 questions');
      assertEqual(tests[0].questions[0].correctOptionIds.length, 1, 'SINGLE question should have exactly 1 correct option id');
      assertEqual(tests[0].questions[1].correctOptionIds.length, 2, 'MULTI question should have 2 correct option ids');
      assertEqual(tests[0].passScore, 70, 'passScore mismatch');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đã tạo bài test thành công')), 'expected success alert for test creation');
    });

    await run('creating a test with a question missing a correct answer is rejected', async () => {
      await page.evaluate(() => {
        window.__alerts.length = 0;
        tbQuestions = [{ text: 'Câu hỏi thiếu đáp án đúng', type: 'SINGLE', points: 1, options: [{ text: 'A', correct: false }, { text: 'B', correct: false }] }];
        document.getElementById('ttTitle').value = 'Bài Test Lỗi';
      });
      const countBefore = await page.evaluate(() => DB.trainingTests.length);
      await page.evaluate(() => submitTrainingTest({ preventDefault() {} }));
      const countAfter = await page.evaluate(() => DB.trainingTests.length);
      assertEqual(countAfter, countBefore, 'no test should be created when a question has no correct answer');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('chưa chọn đáp án đúng')), `expected validation alert, got ${JSON.stringify(alerts)}`);
    });

    let onlineClassId = null;
    await run('trainer creates an ONLINE class and assigns the question-bank test', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('CLASSES'); });
      await page.evaluate((tid) => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Đào tạo Nội quy Công ty Q1';
        document.getElementById('tcStart').value = '2026-09-01T08:00';
        document.getElementById('tcEnd').value = '2026-09-01T10:00';
        document.getElementById('tcMode').value = 'ONLINE';
        document.getElementById('tcCapacity').value = '5';
        document.getElementById('tcTestId').value = String(tid);
      }, testId);
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const classes = await page.evaluate(() => DB.trainingClasses);
      assertEqual(classes.length, 1, 'expected exactly 1 training class');
      onlineClassId = classes[0].id;
      assertEqual(classes[0].status, 'OPEN', 'new class should be OPEN');
      assertEqual(classes[0].mode, 'ONLINE', 'mode mismatch');
      assertEqual(classes[0].testId, testId, 'assigned testId mismatch');
      assertEqual(classes[0].capacity, 5, 'capacity mismatch');
    });

    await run('creating a class without a start time is rejected server-side', async () => {
      await page.evaluate(() => {
        window.__alerts.length = 0;
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp thiếu giờ bắt đầu';
        document.getElementById('tcStart').value = '';
        document.getElementById('tcTestId').value = '';
      });
      const countBefore = await page.evaluate(() => DB.trainingClasses.length);
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const countAfter = await page.evaluate(() => DB.trainingClasses.length);
      assertEqual(countAfter, countBefore, 'no class should be created without a start time');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Thiếu thời gian bắt đầu lớp học')), `expected validation alert, got ${JSON.stringify(alerts)}`);
    });

    await run('bulk-add students via the picker (Cách 1) registers nv1 and nv2', async () => {
      await page.evaluate((id) => { openTrainingRosterModal(id); }, onlineClassId);
      await page.evaluate(() => {
        document.getElementById('trRosterPickInput').value = 'nv1';
        addTrainingRosterPick();
        document.getElementById('trRosterPickInput').value = 'nv2';
        addTrainingRosterPick();
      });
      const staged = await page.evaluate(() => trainingRosterStaged.map((p) => p.username));
      assertEqual(staged.length, 2, `expected 2 staged users, got ${JSON.stringify(staged)}`);
      await page.evaluate(() => confirmTrainingRosterAdd());
      const regs = await page.evaluate((id) => DB.trainingRegistrations.filter((r) => r.classId === id), onlineClassId);
      assertEqual(regs.length, 2, 'expected 2 registrations after bulk-add');
      assert(regs.every((r) => r.result === 'REGISTERED'), 'all bulk-added registrations should start as REGISTERED');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đã thêm 2/2 học viên')), `expected bulk-add success alert, got ${JSON.stringify(alerts)}`);
    });

    await run('bulk-add re-attempt correctly skips an already-registered / unknown username', async () => {
      await page.evaluate((id) => { openTrainingRosterModal(id); }, onlineClassId);
      // Simulate a stale client roster (nv1 already registered from the previous scenario, plus a
      // username that no longer exists) — the server must re-validate independently of what the
      // client staged, per the code comment on bulkRegisterTrainingClass().
      await page.evaluate(() => {
        trainingRosterStaged = [{ username: 'nv1', name: 'Học Viên Một', dept: 'Phòng CNTT' }, { username: 'ghost.acct', name: 'Ghost', dept: '' }];
        renderTrainingRosterStagedList();
      });
      await page.evaluate(() => confirmTrainingRosterAdd());
      const regsForNv1 = await page.evaluate((id) => DB.trainingRegistrations.filter((r) => r.classId === id && r.creator === 'nv1'), onlineClassId);
      assertEqual(regsForNv1.length, 1, 'nv1 should NOT be registered twice');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      const lastAlert = alerts[alerts.length - 1];
      assert(lastAlert.includes('0/2') || lastAlert.includes('bị bỏ qua'), `expected a skip-report alert, got: ${lastAlert}`);
    });

    await run('bulk-add students via Excel-upload preview (Cách 2) registers nv3', async () => {
      await page.evaluate((id) => { openTrainingRosterModal(id); }, onlineClassId);
      await page.evaluate(() => {
        window.__rosterParsePreset = [
          { username: 'nv3', name: 'Học Viên Ba', dept: 'Phòng Kế Toán', found: true, active: true },
          { username: 'no.such.user', name: '', found: false }
        ];
      });
      // A real <input type=file> can only be populated via Playwright's setInputFiles — write a
      // throwaway file so the change handler has a real File object to build FormData from (its
      // content is irrelevant since /api/training/parse-roster is mocked to return the preset above).
      const fs = require('fs');
      const os = require('os');
      const tmpPath = require('path').join(os.tmpdir(), 'roster-upload-test.xlsx');
      fs.writeFileSync(tmpPath, 'dummy');
      await page.setInputFiles('#trRosterFileInput', tmpPath);
      await page.waitForFunction(() => document.getElementById('trRosterFileStatus').innerText.includes('Đọc file'));
      const statusText = await page.evaluate(() => document.getElementById('trRosterFileStatus').innerText);
      assert(statusText.includes('1/2'), `expected preview status to report 1/2 valid, got: ${statusText}`);
      await page.evaluate(() => addTrainingRosterFileFound());
      const staged = await page.evaluate(() => trainingRosterStaged.map((p) => p.username));
      assertEqual(staged.length, 1, `expected only the found+active user staged, got ${JSON.stringify(staged)}`);
      assertEqual(staged[0], 'nv3', 'staged user should be nv3');
      await page.evaluate(() => confirmTrainingRosterAdd());
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv3'), onlineClassId);
      assert(reg, 'nv3 should now have a registration for the class');
      assertEqual(reg.result, 'REGISTERED', 'nv3 registration should start as REGISTERED');
    });

    await run('auto-grading: nv1 answers all questions correctly and PASSES', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv1);
      const result = await page.evaluate(async ({ classId, tId }) => {
        const test = DB.trainingTests.find((t) => t.id === tId);
        const q1 = test.questions[0], q2 = test.questions[1];
        ttTakeClassId = classId;
        ttTakeQuestions = test.questions;
        ttTakeAnswers = { [q1.id]: [...q1.correctOptionIds], [q2.id]: [...q2.correctOptionIds] };
        await ttTakeSubmit();
        return DB.trainingRegistrations.find((r) => r.classId === classId && r.creator === 'nv1');
      }, { classId: onlineClassId, tId: testId });
      assertEqual(result.result, 'PASSED', `expected PASSED, got ${result.result}`);
      assertEqual(result.score, 100, `expected 100%, got ${result.score}`);
      assertEqual(result.resultByName, 'Hệ thống (tự động chấm bài test)', 'auto-graded result should attribute to the system');
    });

    await run('auto-grading: nv2 answers incorrectly and FAILS', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv2);
      const result = await page.evaluate(async ({ classId, tId }) => {
        const test = DB.trainingTests.find((t) => t.id === tId);
        const q1 = test.questions[0], q2 = test.questions[1];
        ttTakeClassId = classId;
        ttTakeQuestions = test.questions;
        // Deliberately wrong: pick the non-correct option of Q1, leave Q2 unanswered.
        const wrongQ1 = q1.options.find((o) => !q1.correctOptionIds.includes(o.id));
        ttTakeAnswers = { [q1.id]: [wrongQ1.id], [q2.id]: [] };
        await ttTakeSubmit();
        return DB.trainingRegistrations.find((r) => r.classId === classId && r.creator === 'nv2');
      }, { classId: onlineClassId, tId: testId });
      assertEqual(result.result, 'FAILED', `expected FAILED, got ${result.result}`);
      assertEqual(result.score, 0, `expected 0%, got ${result.score}`);
    });

    await run('trainer manually records a PASSED result with a score for nv3', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer);
      const nv3RegId = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv3').id, onlineClassId);
      await page.evaluate((id) => { openTrainingResultsModal(id); }, onlineClassId);
      await page.evaluate((regId) => {
        document.getElementById(`trResult_${regId}`).value = 'PASSED';
        document.getElementById(`trScore_${regId}`).value = '85';
      }, nv3RegId);
      await page.evaluate((regId) => saveTrainingResult(regId), nv3RegId);
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.id === id), nv3RegId);
      assertEqual(reg.result, 'PASSED', 'manual result should be PASSED');
      assertEqual(reg.score, 85, 'manual score mismatch');
      assertEqual(reg.resultByName, 'Trần Thị Linh', 'resultByName should be the trainer who recorded it');
    });

    let offlineClassId = null;
    await run('trainer creates an OFFLINE class with a test and the QR check-in button/modal work', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('CLASSES'); });
      await page.evaluate((tid) => {
        document.getElementById('tcCategory').value = 'Kỹ năng mềm';
        document.getElementById('tcTitle').value = 'Đào tạo tại lớp - Kỹ năng giao tiếp';
        document.getElementById('tcStart').value = '2026-10-01T08:00';
        document.getElementById('tcEnd').value = '';
        document.getElementById('tcMode').value = 'OFFLINE';
        document.getElementById('tcTestId').value = String(tid);
      }, testId);
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const classes = await page.evaluate(() => DB.trainingClasses.filter((c) => c.mode === 'OFFLINE'));
      assertEqual(classes.length, 1, 'expected 1 OFFLINE class');
      offlineClassId = classes[0].id;

      const tableHTML = await page.evaluate(() => { renderTrainingClasses(); return document.getElementById('trainingClassesTableBody').innerHTML; });
      assert(tableHTML.includes('Mã QR'), 'OFFLINE class with an assigned test should show the QR check-in button');

      await page.evaluate((id) => openTrainingClassQrModal(id), offlineClassId);
      const modalVisible = await page.evaluate(() => !document.getElementById('trainingClassQrModal').classList.contains('hidden'));
      assert(modalVisible, 'QR modal should be visible after opening');
      const imgSrc = await page.evaluate(() => document.getElementById('trainingClassQrImg').src);
      assert(imgSrc.includes(`/api/training/class-qr/${offlineClassId}`), `QR image src should point at the class-qr endpoint, got: ${imgSrc}`);
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-internal-training.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
