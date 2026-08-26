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
    const trainer = makeUser({ username: 'gv.linh', name: 'Trần Thị Linh', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } });
    const nv1 = makeUser({ username: 'nv1', name: 'Học Viên Một', dept: 'Phòng CNTT', perms: {} });
    const nv2 = makeUser({ username: 'nv2', name: 'Học Viên Hai', dept: 'Phòng CNTT', perms: {} });
    const nv3 = makeUser({ username: 'nv3', name: 'Học Viên Ba', dept: 'Phòng Kế Toán', perms: {} });
    // Đợt 3: trainingInstruct (KHÔNG kèm trainingManage) — quản lý được ĐÚNG lớp mình được gán làm
    // giảng viên (instructorUsername), không tạo lớp mới được, không đụng được lớp của giảng viên khác.
    const instructorA = makeUser({ username: 'gv.a', name: 'Giảng Viên A', dept: 'Phòng CNTT', perms: { trainingInstruct: true } });
    const instructorB = makeUser({ username: 'gv.b', name: 'Giảng Viên B', dept: 'Phòng Kế Toán', perms: { trainingInstruct: true } });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [trainer, nv1, nv2, nv3, instructorA, instructorB]);
    await page.evaluate((u) => finishLogin(u), trainer);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('TESTS'); });

    let testId = null;

    await run('migrateLegacyPerms() renames internalTrainingCreate -> trainingManage, keeping the old grant', async () => {
      const migrated = await page.evaluate(() => migrateLegacyPerms({ internalTrainingCreate: true }));
      assertEqual(migrated.changed, true, 'expected migration to report a change');
      assertEqual(migrated.perms.trainingManage, true, 'internalTrainingCreate:true should become trainingManage:true');
      assertEqual(migrated.perms.internalTrainingCreate, undefined, 'old internalTrainingCreate key should be removed');
    });

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

    // ===================== Đợt 3: Phân quyền + Vòng đời trạng thái Đào Tạo =====================

    let instructedClassId = null;
    await run('trainer assigns gv.a as instructor via the datalist picker when creating an OFFLINE class', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('CLASSES'); });
      await page.evaluate(() => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp Của Giảng Viên A';
        document.getElementById('tcStart').value = '2026-09-05T08:00';
        document.getElementById('tcEnd').value = '2026-09-05T10:00';
        document.getElementById('tcMode').value = 'OFFLINE';
        document.getElementById('tcTestId').value = '';
        document.getElementById('tcInstructor').value = 'Giảng Viên A — Phòng CNTT (gv.a)';
        resolveTrainingInstructorInput(document.getElementById('tcInstructor').value);
      });
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp Của Giảng Viên A'));
      assert(cls, 'expected the class to be created');
      instructedClassId = cls.id;
      assertEqual(cls.instructorUsername, 'gv.a', 'instructorUsername should resolve to gv.a');
      assertEqual(cls.instructor, 'Giảng Viên A', 'instructor display name should be resolved from the account, not free text');
      assertEqual(cls.sessionState, 'SCHEDULED', 'new OFFLINE class should start SCHEDULED');
    });

    await run('typing an instructor name that does not resolve to any account blocks submit client-side', async () => {
      await page.evaluate(() => {
        window.__alerts.length = 0;
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp Giảng Viên Không Hợp Lệ';
        document.getElementById('tcStart').value = '2026-09-06T08:00';
        document.getElementById('tcMode').value = 'ONLINE';
        document.getElementById('tcInstructor').value = 'Ai Đó Không Tồn Tại';
        document.getElementById('tcInstructorUsername').value = ''; // chưa từng khớp gợi ý nào
      });
      const countBefore = await page.evaluate(() => DB.trainingClasses.length);
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const countAfter = await page.evaluate(() => DB.trainingClasses.length);
      assertEqual(countAfter, countBefore, 'no class should be created when the instructor text does not resolve');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('chọn đúng giảng viên')), `expected instructor-resolution alert, got ${JSON.stringify(alerts)}`);
    });

    await run('server rejects an instructorUsername that is not a real account even if the client bypasses the picker', async () => {
      let errMsg = null;
      await page.evaluate(async () => {
        try {
          await callCreateAction('trainingClasses', {
            code: `LOP-BYPASS-${Date.now()}`, category: 'Nghiệp vụ', title: 'Lớp Bypass', startTime: '2026-09-07T08:00',
            mode: 'ONLINE', instructor: 'Ai Đó', instructorUsername: 'no.such.instructor'
          });
        } catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('giảng viên'), `expected a server-side instructor-not-found error, got: ${errMsg}`);
      const found = await page.evaluate(() => DB.trainingClasses.some((c) => c.title === 'Lớp Bypass'));
      assert(!found, 'the bypass class should NOT have been created');
    });

    await run('gv.a (trainingInstruct) manages the roster of their own assigned class', async () => {
      await page.evaluate((u) => { currentUser = u; }, instructorA);
      await page.evaluate((id) => { openTrainingRosterModal(id); }, instructedClassId);
      await page.evaluate(() => {
        document.getElementById('trRosterPickInput').value = 'nv1';
        addTrainingRosterPick();
      });
      await page.evaluate(() => confirmTrainingRosterAdd());
      const regs = await page.evaluate((id) => DB.trainingRegistrations.filter((r) => r.classId === id && r.result !== 'CANCELLED'), instructedClassId);
      assertEqual(regs.length, 1, 'gv.a should have successfully added nv1 to their own assigned class');
    });

    await run('gv.b (trainingInstruct, different instructor) cannot manage gv.a\'s assigned class', async () => {
      await page.evaluate((u) => { currentUser = u; }, instructorB);
      await page.evaluate((id) => { openTrainingRosterModal(id); }, instructedClassId);
      await page.evaluate(() => {
        document.getElementById('trRosterPickInput').value = 'nv2';
        addTrainingRosterPick();
      });
      await page.evaluate(() => confirmTrainingRosterAdd());
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('⛔')), `expected a permission-denied alert for gv.b, got ${JSON.stringify(alerts)}`);
      const nv2Reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv2' && r.result !== 'CANCELLED'), instructedClassId);
      assert(!nv2Reg, 'gv.b must NOT be able to add students to a class they are not the assigned instructor of');
    });

    await run('neither gv.a nor gv.b (trainingInstruct only) can create a new class', async () => {
      for (const instructor of [instructorA, instructorB]) {
        await page.evaluate((u) => { currentUser = u; }, instructor);
        await page.evaluate(() => { window.__alerts.length = 0; });
        const countBefore = await page.evaluate(() => DB.trainingClasses.length);
        await page.evaluate(() => {
          document.getElementById('tcCategory').value = 'Nghiệp vụ';
          document.getElementById('tcTitle').value = 'Lớp Giảng Viên Tự Tạo';
          document.getElementById('tcStart').value = '2026-09-08T08:00';
          document.getElementById('tcInstructor').value = '';
          document.getElementById('tcInstructorUsername').value = '';
        });
        await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
        const countAfter = await page.evaluate(() => DB.trainingClasses.length);
        assertEqual(countAfter, countBefore, `${instructor.username} (trainingInstruct only) must not be able to create a class`);
        const alerts = await page.evaluate(() => window.__alerts.slice());
        assert(alerts.some((a) => a.includes('không có quyền tạo lớp học')), `expected a no-permission alert for ${instructor.username}, got ${JSON.stringify(alerts)}`);
      }
    });

    await run('OFFLINE session-state lifecycle: gv.b cannot start it, gv.a can start then end it', async () => {
      await page.evaluate((u) => { currentUser = u; }, instructorB);
      await page.evaluate((id) => startOfflineTrainingClassAction(id), instructedClassId);
      let alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('⛔')), 'gv.b should be denied starting a class they do not instruct');
      let cls = await page.evaluate((id) => DB.trainingClasses.find((c) => c.id === id), instructedClassId);
      assertEqual(cls.sessionState, 'SCHEDULED', 'sessionState must stay SCHEDULED after a denied start attempt');

      await page.evaluate((u) => { currentUser = u; }, instructorA);
      await page.evaluate(() => { window.__alerts.length = 0; });
      await page.evaluate((id) => startOfflineTrainingClassAction(id), instructedClassId);
      cls = await page.evaluate((id) => DB.trainingClasses.find((c) => c.id === id), instructedClassId);
      assertEqual(cls.sessionState, 'ONGOING', 'gv.a (assigned instructor) should be able to start the class');

      await page.evaluate((id) => startOfflineTrainingClassAction(id), instructedClassId);
      alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('⛔')), 'starting an already-ONGOING class again should be rejected');

      await page.evaluate((id) => endOfflineTrainingClassAction(id), instructedClassId);
      cls = await page.evaluate((id) => DB.trainingClasses.find((c) => c.id === id), instructedClassId);
      assertEqual(cls.sessionState, 'ENDED', 'gv.a should be able to end the class after it started');
    });

    await run('ONLINE class sessionState is computed live from startTime/endTime, not stored', async () => {
      const states = await page.evaluate(() => {
        const now = Date.now();
        const fmt = (ms) => new Date(now + ms).toISOString().slice(0, 16);
        const upcoming = { mode: 'ONLINE', startTime: fmt(60 * 60 * 1000), endTime: fmt(2 * 60 * 60 * 1000) };
        const ongoing = { mode: 'ONLINE', startTime: fmt(-30 * 60 * 1000), endTime: fmt(30 * 60 * 1000) };
        const ended = { mode: 'ONLINE', startTime: fmt(-2 * 60 * 60 * 1000), endTime: fmt(-60 * 60 * 1000) };
        return {
          upcoming: getTrainingClassSessionState(upcoming),
          ongoing: getTrainingClassSessionState(ongoing),
          ended: getTrainingClassSessionState(ended)
        };
      });
      assertEqual(states.upcoming, 'SCHEDULED', 'ONLINE class starting in the future should be SCHEDULED (Sắp diễn ra)');
      assertEqual(states.ongoing, 'ONGOING', 'ONLINE class between start/end should be ONGOING (Đang diễn ra)');
      assertEqual(states.ended, 'ENDED', 'ONLINE class past its endTime should be ENDED (Đã kết thúc)');
    });

    await run('Chờ / Đang học / Hoàn thành / Đã hủy display status is computed, not stored', async () => {
      const statuses = await page.evaluate(() => {
        const scheduledCls = { mode: 'OFFLINE', sessionState: 'SCHEDULED' };
        const ongoingCls = { mode: 'OFFLINE', sessionState: 'ONGOING' };
        return {
          waiting: getTrainingRegDisplayStatus({ result: 'REGISTERED' }, scheduledCls).label,
          studying: getTrainingRegDisplayStatus({ result: 'REGISTERED' }, ongoingCls).label,
          passed: getTrainingRegDisplayStatus({ result: 'PASSED' }, ongoingCls),
          failed: getTrainingRegDisplayStatus({ result: 'FAILED' }, ongoingCls),
          cancelled: getTrainingRegDisplayStatus({ result: 'CANCELLED' }, ongoingCls).label
        };
      });
      assertEqual(statuses.waiting, 'Chờ', 'REGISTERED + class not yet started should display "Chờ"');
      assertEqual(statuses.studying, 'Đang học', 'REGISTERED + class started, no result yet should display "Đang học"');
      assertEqual(statuses.passed.label, 'Hoàn thành', 'PASSED should display "Hoàn thành"');
      assertEqual(statuses.passed.sub, 'Đạt', 'PASSED sub-badge should be "Đạt"');
      assertEqual(statuses.failed.sub, 'Không đạt', 'FAILED sub-badge should be "Không đạt"');
      assertEqual(statuses.cancelled, 'Đã hủy', 'CANCELLED should keep its own distinct "Đã hủy" display');
    });

    let invitedClassId = null;
    await run('inviteList: empty by default, self-registration open to everyone (backward-compatible)', async () => {
      const cls = await page.evaluate((id) => DB.trainingClasses.find((c) => c.id === id), onlineClassId);
      assert(Array.isArray(cls.inviteList) && cls.inviteList.length === 0, 'a class created before/without inviting anyone should have an empty inviteList');
    });

    await run('inviteList: HR sets an invite list, only listed users may self-register', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate(() => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp Có Danh Sách Mời';
        document.getElementById('tcStart').value = '2026-09-09T08:00';
        document.getElementById('tcEnd').value = '';
        document.getElementById('tcMode').value = 'ONLINE';
        document.getElementById('tcInstructor').value = '';
        document.getElementById('tcInstructorUsername').value = '';
        document.getElementById('tcInviteListPickInput').value = 'Học Viên Một — Phòng CNTT (nv1)';
        addTrainingInviteListPick();
      });
      const staged = await page.evaluate(() => tcInviteListStaged.map((p) => p.username));
      assertEqual(staged.length, 1, `expected 1 invited user staged, got ${JSON.stringify(staged)}`);
      await page.evaluate(() => { window.__alerts.length = 0; });
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp Có Danh Sách Mời'));
      const dbgAlerts = await page.evaluate(() => window.__alerts.slice());
      assert(cls, `expected the invite-list class to be created, alerts: ${JSON.stringify(dbgAlerts)}`);
      invitedClassId = cls.id;
      assertEqual(cls.inviteList.length, 1, 'inviteList should contain exactly 1 username');
      assertEqual(cls.inviteList[0], 'nv1', 'inviteList should contain nv1');

      await page.evaluate((u) => { currentUser = u; }, nv2);
      await page.evaluate((id) => registerForTrainingClass(id), invitedClassId);
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('danh sách mời')), `expected nv2 (not invited) to be rejected, got ${JSON.stringify(alerts)}`);
      let nv2Reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv2'), invitedClassId);
      assert(!nv2Reg, 'nv2 (not on the invite list) must NOT be able to self-register');

      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate((id) => registerForTrainingClass(id), invitedClassId);
      const nv1Reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv1'), invitedClassId);
      assert(nv1Reg, 'nv1 (on the invite list) should be able to self-register');

      // Roster bulk-add (HR override) is COMPLETELY unaffected by inviteList — trainer can still force-add nv2.
      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate((id) => { openTrainingRosterModal(id); }, invitedClassId);
      await page.evaluate(() => {
        document.getElementById('trRosterPickInput').value = 'nv2';
        addTrainingRosterPick();
      });
      await page.evaluate(() => confirmTrainingRosterAdd());
      nv2Reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv2' && r.result !== 'CANCELLED'), invitedClassId);
      assert(nv2Reg, 'HR bulk-add (roster override) must still work for nv2 even though the invite list excludes them');
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
