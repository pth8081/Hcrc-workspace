// tests/test-internal-training.js — Truyền Thông Nội Bộ > Đào Tạo (TRAINING sub-tab / LMS).
// Question bank (Ngân Hàng Câu Hỏi) creation, class creation (online/offline), bulk-add students via
// picker and via Excel-upload preview, auto-grading on test submission, manual result entry, and the
// offline-class QR check-in button.
// Đợt 4: Chương Trình (trainingCourses) catalog + courseId link on trainingClasses/trainingDocuments,
// docType (VIDEO/IMAGE) + mandatory flag on trainingDocuments, and Đảo câu hỏi (question/option shuffle)
// on the test-take modal.
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
    const nv4 = makeUser({ username: 'nv4', name: 'Học Viên Bốn', dept: 'Phòng CNTT', perms: {} });
    // Đợt 3: trainingInstruct (KHÔNG kèm trainingManage) — quản lý được ĐÚNG lớp mình được gán làm
    // giảng viên (instructorUsername), không tạo lớp mới được, không đụng được lớp của giảng viên khác.
    const instructorA = makeUser({ username: 'gv.a', name: 'Giảng Viên A', dept: 'Phòng CNTT', perms: { trainingInstruct: true } });
    const instructorB = makeUser({ username: 'gv.b', name: 'Giảng Viên B', dept: 'Phòng Kế Toán', perms: { trainingInstruct: true } });
    // Đợt 9 — huỷ đăng ký (chờ duyệt) + gác "học xong mới thi": admin để kiểm tra huỷ có hiệu lực NGAY
    // (bỏ qua bước duyệt), nv5 là học viên "sạch" chưa dính tới bất kỳ kịch bản nào ở trên (mọi
    // nv1-nv4 đều đã có kết quả PASSED/FAILED trên onlineClassId vào cuối file, không còn ở trạng thái
    // REGISTERED để thử huỷ được nữa).
    const admin = makeUser({ username: 'admin.a', name: 'Quản Trị A', dept: 'Phòng Nhân Sự', perms: { admin: true } });
    const nv5 = makeUser({ username: 'nv5', name: 'Học Viên Năm', dept: 'Phòng CNTT', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [trainer, nv1, nv2, nv3, nv4, nv5, instructorA, instructorB, admin]);
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

    // Đợt 8 (bắt buộc thi): lớp có gán bài test -> chấm tay bị chặn HẲN toàn hệ thống (server 409),
    // form Kết Quả chỉ còn hiển thị 1 ghi chú, "Đạt" duy nhất đến từ tự làm bài qua đúng modal thật.
    await run('manual grading is blocked for a class with an assigned test (UI hides the form; server rejects a bypassed call)', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer);
      const nv3RegId = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv3').id, onlineClassId);
      const modalHTML = await page.evaluate((id) => { openTrainingResultsModal(id); return document.getElementById('trainingResultsModalBody').innerHTML; }, onlineClassId);
      assert(modalHTML.includes('Tự động qua bài test'), 'the results modal should show the auto-graded note instead of a manual grading form for a tested class');
      assert(!modalHTML.includes(`trResult_${nv3RegId}`), 'no manual result <select> should be rendered for a tested class');

      let errMsg = null;
      await page.evaluate(async (regId) => {
        try { await callRecordAction('trainingRegistrations', regId, 'set-result', { result: 'PASSED', score: 85 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, nv3RegId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('đã gán bài test'), `expected a server-side block for manual grading on a tested class, got: ${errMsg}`);
    });

    await run('auto-grading: nv3 takes the real test afterwards and PASSES (the only way to get a result now that the class has a test)', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv3);
      const result = await page.evaluate(async ({ classId, tId }) => {
        const test = DB.trainingTests.find((t) => t.id === tId);
        const q1 = test.questions[0], q2 = test.questions[1];
        ttTakeClassId = classId;
        ttTakeQuestions = test.questions;
        ttTakeAnswers = { [q1.id]: [...q1.correctOptionIds], [q2.id]: [...q2.correctOptionIds] };
        await ttTakeSubmit();
        return DB.trainingRegistrations.find((r) => r.classId === classId && r.creator === 'nv3');
      }, { classId: onlineClassId, tId: testId });
      assertEqual(result.result, 'PASSED', `expected PASSED, got ${result.result}`);
      assertEqual(result.score, 100, `expected 100%, got ${result.score}`);
      await page.evaluate((u) => { currentUser = u; }, trainer);
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
    await run('#systemUsersDatalist is already populated when the CREATE-class form is shown (regression: used to be empty on a fresh session — nothing called populateSystemUsersDatalist() before opening Đào Tạo)', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('CLASSES'); });
      const optionCount = await page.locator('#systemUsersDatalist option').count();
      assert(optionCount > 0, `expected #systemUsersDatalist to have options right after entering the CLASSES tab, got ${optionCount}`);
      const optionValues = await page.locator('#systemUsersDatalist option').evaluateAll((opts) => opts.map((o) => o.getAttribute('value')));
      assert(optionValues.some((v) => v && v.includes('gv.a')), `expected an option for account gv.a among #systemUsersDatalist options, got: ${JSON.stringify(optionValues)}`);
    });

    await run('trainer assigns gv.a as instructor via the datalist picker when creating an OFFLINE class', async () => {
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

    // ===================== Đợt 4: Chương Trình (trainingCourses) =====================

    let courseId1 = null;
    await run('trainingCourses: creating a course is gated to trainingManage (nv1 blocked, trainer succeeds)', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('COURSES'); });
      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate(() => {
        window.__alerts.length = 0;
        document.getElementById('tccCategory').value = 'Nghiệp vụ';
        document.getElementById('tccName').value = 'Chương Trình Bị Chặn';
      });
      const countBefore = await page.evaluate(() => DB.trainingCourses.length);
      await page.evaluate(() => submitTrainingCourse({ preventDefault() {}, target: { reset() {} } }));
      const countAfter = await page.evaluate(() => DB.trainingCourses.length);
      assertEqual(countAfter, countBefore, 'nv1 (no trainingManage) must not be able to create a trainingCourses entry');
      let alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('không có quyền tạo chương trình')), `expected a permission alert for nv1, got ${JSON.stringify(alerts)}`);

      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate(() => {
        window.__alerts.length = 0;
        document.getElementById('tccCategory').value = 'Nghiệp vụ';
        document.getElementById('tccName').value = 'Chương Trình Quản Lý Cửa Hàng';
        document.getElementById('tccDescription').value = 'Đào tạo quản lý cửa hàng cơ bản';
      });
      await page.evaluate(() => submitTrainingCourse({ preventDefault() {}, target: { reset() {} } }));
      const course = await page.evaluate(() => DB.trainingCourses.find((c) => c.name === 'Chương Trình Quản Lý Cửa Hàng'));
      assert(course, 'trainer (trainingManage) should be able to create a trainingCourses entry');
      courseId1 = course.id;
      assertEqual(course.category, 'Nghiệp vụ', 'course category mismatch');
      alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đã tạo chương trình thành công')), `expected success alert, got ${JSON.stringify(alerts)}`);
    });

    await run('server rejects trainingCourses creation from a non-trainingManage user even if the client bypasses the form', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate(async () => {
        try {
          await callCreateAction('trainingCourses', { code: `CT-BYPASS-${Date.now()}`, name: 'Chương Trình Bypass', category: 'Nghiệp vụ' });
        } catch (err) { window.__lastCreateErr = err.message; }
      });
      const errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không có quyền tạo chương trình'), `expected a server-side permission error, got: ${errMsg}`);
      const found = await page.evaluate(() => DB.trainingCourses.some((c) => c.name === 'Chương Trình Bypass'));
      assert(!found, 'the bypass course should NOT have been created');
    });

    let courseLinkedClassId = null;
    await run('trainingClasses: linking a class to a trainingCourses entry via courseId surfaces "Chương trình:" in the class list, without breaking a class that has none', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('CLASSES'); });
      await page.evaluate((cid) => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp Có Gắn Chương Trình';
        document.getElementById('tcStart').value = '2026-09-10T08:00';
        document.getElementById('tcMode').value = 'ONLINE';
        document.getElementById('tcTestId').value = '';
        document.getElementById('tcCourseId').value = String(cid);
      }, courseId1);
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp Có Gắn Chương Trình'));
      assert(cls, 'expected the course-linked class to be created');
      courseLinkedClassId = cls.id;
      assertEqual(cls.courseId, courseId1, 'courseId should be stored on the class');

      const tableHTML = await page.evaluate(() => { renderTrainingClasses(); return document.getElementById('trainingClassesTableBody').innerHTML; });
      assert(tableHTML.includes('Chương trình: Chương Trình Quản Lý Cửa Hàng'), 'class list should show the linked course name as supplementary context');
      const occurrences = (tableHTML.match(/Chương trình:/g) || []).length;
      assertEqual(occurrences, 1, 'only the course-linked class should render a "Chương trình:" line at this point');

      // Lớp tạo TRƯỚC tính năng này (không có courseId) vẫn phải hoạt động/hiển thị bình thường.
      const oldCls = await page.evaluate((id) => DB.trainingClasses.find((c) => c.id === id), onlineClassId);
      assert(oldCls.courseId == null, 'a class created before this feature should have no courseId (backward compatible)');
    });

    await run('server rejects an invalid courseId on trainingClasses creation even if the client bypasses the dropdown', async () => {
      await page.evaluate(async () => {
        try {
          await callCreateAction('trainingClasses', {
            code: `LOP-BADCOURSE-${Date.now()}`, category: 'Nghiệp vụ', title: 'Lớp Course Sai',
            startTime: '2026-09-11T08:00', mode: 'ONLINE', courseId: 999999
          });
        } catch (err) { window.__lastCreateErr = err.message; }
      });
      const errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('Chương trình được chọn không hợp lệ'), `expected an invalid-course error, got: ${errMsg}`);
    });

    await run('editing a class can attach/clear courseId, re-validated server-side', async () => {
      await page.evaluate((id) => { openEditTrainingClassModal(id); }, courseLinkedClassId);
      await page.evaluate(() => { document.getElementById('teCourseId').value = ''; });
      await page.evaluate(() => submitEditTrainingClass({ preventDefault() {} }));
      const cls = await page.evaluate((id) => DB.trainingClasses.find((c) => c.id === id), courseLinkedClassId);
      assert(cls.courseId == null, 'clearing the dropdown via edit should clear courseId back to null');
      const tableHTML = await page.evaluate(() => { renderTrainingClasses(); return document.getElementById('trainingClassesTableBody').innerHTML; });
      assertEqual((tableHTML.match(/Chương trình:/g) || []).length, 0, 'no class should show a "Chương trình:" line after the link was cleared');
    });

    // ===================== Đợt 4: Nội Dung Đào Tạo mở rộng (docType/mandatory/courseId) =====================

    let videoDocId = null;
    await run('trainingDocuments: creating a VIDEO document rejects a non-Youtube URL and accepts a Youtube one', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('DOCS'); });
      await page.evaluate(() => {
        window.__alerts.length = 0;
        document.getElementById('tdCategory').value = 'Nghiệp vụ';
        document.getElementById('tdTitle').value = 'Video Sai Link';
        document.getElementById('tdDocType').value = 'VIDEO';
        onTrainingDocTypeChange();
      });
      await page.evaluate(async () => {
        try {
          await callCreateAction('trainingDocuments', {
            code: `TL-BADVID-${Date.now()}`, category: 'Nghiệp vụ', title: 'Video Sai Link', docType: 'VIDEO', videoUrl: 'https://vimeo.com/12345'
          });
        } catch (err) { window.__lastCreateErr = err.message; }
      });
      const errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('Youtube'), `expected a Youtube-link validation error, got: ${errMsg}`);
      const badFound = await page.evaluate(() => DB.trainingDocuments.some((d) => d.title === 'Video Sai Link'));
      assert(!badFound, 'a non-Youtube video URL must be rejected server-side');

      await page.evaluate(() => {
        document.getElementById('tdTitle').value = 'Video Hướng Dẫn Nội Quy';
        document.getElementById('tdVideoUrl').value = 'https://www.youtube.com/watch?v=abc123XYZ';
      });
      await page.evaluate(() => submitTrainingDocument({ preventDefault() {}, target: { reset() {} } }));
      const doc = await page.evaluate(() => DB.trainingDocuments.find((d) => d.title === 'Video Hướng Dẫn Nội Quy'));
      assert(doc, 'expected the VIDEO document to be created with a valid Youtube URL');
      videoDocId = doc.id;
      assertEqual(doc.docType, 'VIDEO', 'docType should be VIDEO');
      assertEqual(doc.videoUrl, 'https://www.youtube.com/watch?v=abc123XYZ', 'videoUrl mismatch');
      assert(doc.fileUrl == null, 'a VIDEO document should not have a fileUrl');
      assertEqual(doc.mandatory, false, 'mandatory should default to false when the checkbox is left unchecked');

      const containerHTML = await page.evaluate(() => { renderTrainingDocuments(); return document.getElementById('trainingDocumentsContainer').innerHTML; });
      assert(containerHTML.includes('<iframe'), 'a VIDEO document should render as an embedded iframe');
    });

    await run('trainingDocuments: creating an IMAGE document (file upload) with mandatory + courseId round-trips and renders a thumbnail', async () => {
      await page.evaluate(() => {
        window.__alerts.length = 0;
        document.getElementById('tdCategory').value = 'Kỹ năng mềm';
        document.getElementById('tdTitle').value = 'Sơ Đồ Quy Trình';
        document.getElementById('tdDocType').value = 'IMAGE';
        onTrainingDocTypeChange();
        document.getElementById('tdMandatory').checked = true;
      });
      await page.evaluate((cid) => { document.getElementById('tdCourseId').value = String(cid); }, courseId1);
      const fs = require('fs');
      const os = require('os');
      const tmpImgPath = require('path').join(os.tmpdir(), 'training-doc-image-test.png');
      fs.writeFileSync(tmpImgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
      await page.setInputFiles('#tdFile', tmpImgPath);
      await page.evaluate(() => submitTrainingDocument({ preventDefault() {}, target: { reset() {} } }));
      const doc = await page.evaluate(() => DB.trainingDocuments.find((d) => d.title === 'Sơ Đồ Quy Trình'));
      assert(doc, 'expected the IMAGE document to be created');
      assertEqual(doc.docType, 'IMAGE', 'docType should be IMAGE');
      assertEqual(doc.mandatory, true, 'mandatory flag should round-trip as true when the checkbox is checked');
      assertEqual(doc.courseId, courseId1, 'courseId should round-trip on the document');
      assert(doc.fileUrl, 'an IMAGE document should still have a real fileUrl (same upload mechanism as DOCUMENT)');

      const containerHTML = await page.evaluate(() => { renderTrainingDocuments(); return document.getElementById('trainingDocumentsContainer').innerHTML; });
      assert(containerHTML.includes('<img'), 'an IMAGE document should render as a thumbnail <img>, not a download link');
      assert(containerHTML.includes('⚠️ Bắt buộc'), 'a mandatory document should show the "Bắt buộc" badge');
      assert(containerHTML.includes('Chương trình:'), 'a document linked to a course should show the course name');
    });

    await run('a legacy trainingDocuments record without docType/mandatory/courseId still renders correctly (backward compatible)', async () => {
      await page.evaluate(() => {
        DB.trainingDocuments.push({
          id: 999001, code: 'TL-LEGACY-1', category: 'Nghiệp vụ', title: 'Tài Liệu Cũ Trước Đợt 4',
          description: '', fileUrl: '/uploads/mock/legacy.pdf', fileName: 'legacy.pdf', fileType: 'application/pdf',
          uploaderUsername: 'gv.linh', uploaderName: 'Trần Thị Linh', createdAt: '01/01/2026 08:00:00'
          // KHÔNG có docType/mandatory/courseId — đúng hình dạng dữ liệu trước Đợt 4.
        });
      });
      const containerHTML = await page.evaluate(() => { renderTrainingDocuments(); return document.getElementById('trainingDocumentsContainer').innerHTML; });
      assert(containerHTML.includes('Tài Liệu Cũ Trước Đợt 4'), 'legacy document should still render');
      assert(containerHTML.includes('⬇️ Tải'), 'a document without docType should default to the DOCUMENT download-link rendering');
      await page.evaluate(() => { DB.trainingDocuments = DB.trainingDocuments.filter((d) => d.id !== 999001); });
    });

    // ===================== Đợt 4: Đảo câu hỏi (question/option shuffle) =====================

    await run('Đảo câu hỏi: each openTakeTestModal() call reshuffles question/option order (same ids, no mutation of stored test)', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv1);
      const test = await page.evaluate((tid) => DB.trainingTests.find((t) => t.id === tid), testId);
      const originalQIds = test.questions.map((q) => q.id);
      const originalOptIdsByQ = {};
      test.questions.forEach((q) => { originalOptIdsByQ[q.id] = q.options.map((o) => o.id); });

      const trials = await page.evaluate((classId) => {
        const out = [];
        for (let i = 0; i < 40; i++) {
          openTakeTestModal(classId);
          out.push(ttTakeQuestions.map((q) => ({ id: q.id, optIds: q.options.map((o) => o.id) })));
          clearInterval(ttTakeTimerHandle);
          document.getElementById('trainingTakeTestModal').classList.add('hidden');
        }
        return out;
      }, onlineClassId);

      let anyQOrderDiffers = false;
      let anyOptOrderDiffers = false;
      trials.forEach((trial) => {
        assertEqual(trial.length, originalQIds.length, 'shuffled question count mismatch');
        const qIds = trial.map((q) => q.id);
        assertEqual(JSON.stringify([...qIds].sort()), JSON.stringify([...originalQIds].sort()), 'shuffled question ids must be the exact same set as stored');
        if (JSON.stringify(qIds) !== JSON.stringify(originalQIds)) anyQOrderDiffers = true;
        trial.forEach((q) => {
          const orig = originalOptIdsByQ[q.id];
          assertEqual(JSON.stringify([...q.optIds].sort()), JSON.stringify([...orig].sort()), `shuffled option ids for question ${q.id} must be the exact same set as stored`);
          if (JSON.stringify(q.optIds) !== JSON.stringify(orig)) anyOptOrderDiffers = true;
        });
      });
      assert(anyQOrderDiffers, 'expected at least 1 of 40 shuffles to produce a different question order than storage order');
      assert(anyOptOrderDiffers, 'expected at least 1 of 40 shuffles to produce a different option order than storage order for at least 1 question');

      const testAfter = await page.evaluate((tid) => DB.trainingTests.find((t) => t.id === tid), testId);
      assertEqual(JSON.stringify(testAfter.questions.map((q) => q.id)), JSON.stringify(originalQIds), 'the stored test.questions order must remain untouched after shuffling');
      testAfter.questions.forEach((q) => {
        assertEqual(JSON.stringify(q.options.map((o) => o.id)), JSON.stringify(originalOptIdsByQ[q.id]), `stored option order for question ${q.id} must remain untouched after shuffling`);
      });
    });

    await run('a shuffled test-take run (via the real modal flow) still grades correctly end-to-end, order-independent', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv4);
      await page.evaluate((id) => registerForTrainingClass(id), onlineClassId);
      let reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv4'), onlineClassId);
      assert(reg, 'nv4 should have registered for the class successfully');

      await page.evaluate((id) => openTakeTestModal(id), onlineClassId);
      await page.evaluate(async () => {
        const total = ttTakeQuestions.length;
        for (let i = 0; i < total; i++) {
          const q = ttTakeQuestions[ttTakeIndex];
          q.correctOptionIds.forEach((optId) => ttTakeSelectOption(optId, true));
          await ttTakeGoNext();
        }
      });
      reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv4'), onlineClassId);
      assertEqual(reg.result, 'PASSED', `expected nv4 to PASS answering correctly regardless of shuffled order, got ${reg.result}`);
      assertEqual(reg.score, 100, `expected 100%, got ${reg.score}`);
    });

    // ===================== Đợt 9: huỷ đăng ký phải chờ trainingManage/admin duyệt =====================
    // window.fetch ở đây là mock trong-trang (xem _harness.js) — nó KHÔNG tự cập nhật DB.trainingRegistrations
    // của client, mọi hàm khác trong app đều tự ghi lại `DB.trainingRegistrations[idx] = result.item` sau
    // mỗi lần gọi callRecordAction() (xem cancelTrainingRegistrationAction() ở index.html) — quên bước
    // này khiến lần đọc lại `DB.trainingRegistrations.find(...)` kế tiếp trả về bản CŨ (chưa có
    // pendingCancellation), làm sai lệch toàn bộ chuỗi kịch bản tiếp theo, nên mọi bước dưới đây đều tự
    // đồng bộ lại ngay sau khi gọi, giống hệt code thật.
    async function syncTrainingReg(updated) {
      await page.evaluate((it) => {
        const idx = DB.trainingRegistrations.findIndex((r) => r.id === it.id);
        if (idx !== -1) DB.trainingRegistrations[idx] = it; else DB.trainingRegistrations.push(it);
      }, updated);
    }

    await run('a plain student self-cancelling only creates a PENDING request, does not cancel immediately', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv5);
      await page.evaluate((id) => registerForTrainingClass(id), onlineClassId);
      let reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv5'), onlineClassId);
      assert(reg, 'nv5 should have registered successfully');
      const result = await page.evaluate(async (regId) => callRecordAction('trainingRegistrations', regId, 'cancel', { reason: 'Bận việc đột xuất' }), reg.id);
      const updated = result.item;
      assertEqual(updated.result, 'REGISTERED', 'result must stay REGISTERED — a non-admin cancel is only a pending request, not immediate');
      assert(updated.pendingCancellation, 'expected pendingCancellation to be set');
      assertEqual(updated.pendingCancellation.reason, 'Bận việc đột xuất', 'pendingCancellation.reason mismatch');
      assertEqual(updated.pendingCancellation.requestedBy, 'nv5', 'pendingCancellation.requestedBy mismatch');
      await syncTrainingReg(updated);
    });

    await run('sending a second cancel request while one is already pending is rejected', async () => {
      let errMsg = null;
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv5'), onlineClassId);
      await page.evaluate(async (regId) => {
        window.__lastCreateErr = null;
        try { await callRecordAction('trainingRegistrations', regId, 'cancel', {}); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, reg.id);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('đang chờ duyệt'), `expected an already-pending error, got: ${errMsg}`);
    });

    await run('a trainingInstruct-only user (NOT trainingManage/admin) cannot approve or reject a cancel request', async () => {
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv5'), onlineClassId);
      await page.evaluate((u) => { currentUser = u; }, instructorA);
      let errMsg = null;
      await page.evaluate(async (regId) => {
        window.__lastCreateErr = null;
        try { await callRecordAction('trainingRegistrations', regId, 'approve-cancel', {}); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, reg.id);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không có quyền duyệt'), `expected a permission error for approve-cancel, got: ${errMsg}`);
      await page.evaluate(async (regId) => {
        window.__lastCreateErr = null;
        try { await callRecordAction('trainingRegistrations', regId, 'reject-cancel', {}); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, reg.id);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không có quyền từ chối'), `expected a permission error for reject-cancel, got: ${errMsg}`);
    });

    await run('trainingManage rejects the request — registration stays REGISTERED and can be re-requested', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer);
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv5'), onlineClassId);
      const result = await page.evaluate(async (regId) => callRecordAction('trainingRegistrations', regId, 'reject-cancel', {}), reg.id);
      const updated = result.item;
      assertEqual(updated.result, 'REGISTERED', 'result should remain REGISTERED after rejection');
      assertEqual(updated.pendingCancellation, null, 'pendingCancellation should be cleared after rejection');
      await syncTrainingReg(updated);

      await page.evaluate((u) => { currentUser = u; }, nv5);
      const result2 = await page.evaluate(async (regId) => callRecordAction('trainingRegistrations', regId, 'cancel', {}), reg.id);
      assert(result2.item.pendingCancellation, 'nv5 should be able to send a new cancel request after the previous one was rejected');
      await syncTrainingReg(result2.item);
    });

    await run('trainingManage approves the request — registration finally becomes CANCELLED', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer);
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv5'), onlineClassId);
      const result = await page.evaluate(async (regId) => callRecordAction('trainingRegistrations', regId, 'approve-cancel', {}), reg.id);
      const updated = result.item;
      assertEqual(updated.result, 'CANCELLED', 'result should become CANCELLED once trainingManage approves');
      assertEqual(updated.resultBy, 'gv.linh', 'resultBy should be the approver');
      assertEqual(updated.pendingCancellation, null, 'pendingCancellation should be cleared after approval');
      await syncTrainingReg(updated);
    });

    await run('Admin cancelling directly (a re-registration after the CANCELLED one above) has IMMEDIATE effect, no pending request', async () => {
      // nv5's earlier registration on onlineClassId is now CANCELLED (previous scenario) — CANCELLED
      // registrations don't count as "active" (extraValidate filters result !== 'CANCELLED'), so nv5 can
      // register again for the same class, giving us a fresh REGISTERED row to admin-cancel here.
      await page.evaluate((u) => { currentUser = u; }, nv5);
      await page.evaluate((id) => registerForTrainingClass(id), onlineClassId);
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv5' && r.result === 'REGISTERED'), onlineClassId);
      assert(reg, 'nv5 should have a fresh REGISTERED registration to cancel');
      await page.evaluate((u) => { currentUser = u; }, admin);
      const result = await page.evaluate(async (regId) => callRecordAction('trainingRegistrations', regId, 'cancel', {}), reg.id);
      const updated = result.item;
      assertEqual(updated.result, 'CANCELLED', 'admin cancel must take effect immediately');
      assertEqual(updated.pendingCancellation, null, 'admin cancel must never leave a pendingCancellation behind');
      await syncTrainingReg(updated);
    });

    // ===================== Đợt 9: ONLINE — phải xem hết giáo trình bắt buộc trước khi thi =====================

    let mandatoryDocClassId = null;
    let mandatoryDocId = null;
    await run('trainer creates an ONLINE class with a mandatory document (documentIds) + a test, endTime already in the past', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer);
      mandatoryDocId = await page.evaluate(() => DB.trainingDocuments.find((d) => d.title === 'Sơ Đồ Quy Trình').id);
      await page.evaluate((tid) => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp Có Giáo Trình Bắt Buộc';
        document.getElementById('tcStart').value = '2020-01-01T08:00';
        document.getElementById('tcEnd').value = '2020-01-01T10:00'; // đã qua từ lâu -> bài test tự mở NGAY nếu không còn gác nào khác
        document.getElementById('tcMode').value = 'ONLINE';
        document.getElementById('tcTestId').value = String(tid);
        onTrainingClassModeChange();
      }, testId);
      await page.evaluate((docId) => {
        [...document.getElementById('tcDocumentIds').options].forEach((o) => { o.selected = Number(o.value) === docId; });
      }, mandatoryDocId);
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp Có Giáo Trình Bắt Buộc'));
      assert(cls, 'expected the class to be created');
      mandatoryDocClassId = cls.id;
      assertEqual(cls.documentIds.length, 1, 'expected exactly 1 mandatory document');
      assertEqual(cls.documentIds[0], mandatoryDocId, 'documentIds should contain the selected document id');
    });

    await run('submit-test is blocked while the mandatory document has not been marked as viewed, even though endTime has long passed', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv5);
      await page.evaluate((id) => registerForTrainingClass(id), mandatoryDocClassId);
      let errMsg = null;
      await page.evaluate(async (classId) => {
        try { await callRecordAction('trainingClasses', classId, 'submit-test', { answers: [] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, mandatoryDocClassId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('xem hết tài liệu giáo trình'), `expected a must-view-documents error, got: ${errMsg}`);
    });

    await run('marking an invalid documentId (not in the class\'s documentIds) is rejected', async () => {
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv5'), mandatoryDocClassId);
      let errMsg = null;
      await page.evaluate(async (regId) => {
        try { await callRecordAction('trainingRegistrations', regId, 'mark-document-viewed', { documentId: 999999 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, reg.id);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không thuộc giáo trình bắt buộc'), `expected a not-in-syllabus error, got: ${errMsg}`);
    });

    await run('a different student cannot mark a document as viewed on someone else\'s registration', async () => {
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv5'), mandatoryDocClassId);
      await page.evaluate((u) => { currentUser = u; }, nv1);
      let errMsg = null;
      await page.evaluate(async ({ regId, docId }) => {
        try { await callRecordAction('trainingRegistrations', regId, 'mark-document-viewed', { documentId: docId }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, { regId: reg.id, docId: mandatoryDocId });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('chính mình'), `expected an own-registration-only error, got: ${errMsg}`);
    });

    await run('after nv5 marks the mandatory document as viewed via the real "Vào Lớp Học" modal, the test unlocks and can be submitted', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv5);
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv5'), mandatoryDocClassId);
      await page.evaluate((regId) => openTrainingJoinClassModal(regId), reg.id);
      const bodyHTML = await page.evaluate(() => document.getElementById('trainingJoinClassBody').innerHTML);
      assert(bodyHTML.includes('Sơ Đồ Quy Trình'), 'the join-class modal should list the mandatory document by title');
      await page.evaluate((docId) => markTrainingDocumentViewedAction(docId), mandatoryDocId);
      const updatedReg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.id === id), reg.id);
      assert(updatedReg.viewedDocumentIds.includes(mandatoryDocId), 'viewedDocumentIds should now include the mandatory document');

      await page.evaluate((id) => openTakeTestModal(id), mandatoryDocClassId);
      await page.evaluate(async () => {
        const total = ttTakeQuestions.length;
        for (let i = 0; i < total; i++) {
          const q = ttTakeQuestions[ttTakeIndex];
          q.correctOptionIds.forEach((optId) => ttTakeSelectOption(optId, true));
          await ttTakeGoNext();
        }
      });
      const finalReg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv5'), mandatoryDocClassId);
      assertEqual(finalReg.result, 'PASSED', `expected nv5 to PASS once the document gate is satisfied, got ${finalReg.result}`);
    });

    // ===================== Đợt 9: OFFLINE — phải chờ giảng viên "Kết Thúc Lớp" mới được thi =====================

    await run('submit-test on an OFFLINE class is blocked while the session has not been ended by the instructor', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate((id) => registerForTrainingClass(id), offlineClassId);
      let errMsg = null;
      await page.evaluate(async (classId) => {
        try { await callRecordAction('trainingClasses', classId, 'submit-test', { answers: [] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, offlineClassId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('Buổi học chưa kết thúc'), `expected a session-not-ended error, got: ${errMsg}`);
    });

    await run('once trainingManage starts then ends the OFFLINE session, submit-test succeeds', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate((id) => startOfflineTrainingClassAction(id), offlineClassId);
      await page.evaluate((id) => endOfflineTrainingClassAction(id), offlineClassId);
      const cls = await page.evaluate((id) => DB.trainingClasses.find((c) => c.id === id), offlineClassId);
      assertEqual(cls.sessionState, 'ENDED', 'expected the OFFLINE class session to be ENDED');

      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate((id) => openTakeTestModal(id), offlineClassId);
      await page.evaluate(async () => {
        const total = ttTakeQuestions.length;
        for (let i = 0; i < total; i++) {
          const q = ttTakeQuestions[ttTakeIndex];
          q.correctOptionIds.forEach((optId) => ttTakeSelectOption(optId, true));
          await ttTakeGoNext();
        }
      });
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv1'), offlineClassId);
      assertEqual(reg.result, 'PASSED', `expected nv1 to PASS once the OFFLINE session has ended, got ${reg.result}`);
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
