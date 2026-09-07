// tests/test-training-essay-dragdrop-ui.js — Đào Tạo > Ngân Hàng Câu Hỏi (Đợt 10, phần CLIENT + luồng
// đầy đủ qua server thật — xem tests/test-training-essay-dragdrop-server.js cho phần server thuần Node).
//
// Kịch bản chính (VÍ DỤ THẬT theo đúng yêu cầu nghiệp vụ):
//   1. Tạo 1 bài test 3 câu: SINGLE (2đ, tự động chấm), IMAGE_DRAG_DROP (3đ, tự động chấm, ảnh TỪNG đáp
//      án tải THẬT qua uploadFileToServer()), ESSAY (5đ, chấm tay) — Test Builder <select> hiện đủ 4 loại.
//   2. Gán vào 1 lớp ONLINE (passScore 70%), học viên nộp bài: SINGLE đúng + IMAGE_DRAG_DROP đúng (bằng
//      CẢ đường bấm chọn LẪN đường kéo-thả, xác nhận 2 đường cùng ghi vào 1 state) + ESSAY tự viết.
//   3. Ngay sau khi nộp: gradingStatus 'PENDING_ESSAY_GRADING', reg.result CÒN 'REGISTERED' (KHÔNG có
//      Đạt/Không Đạt), màn "Đăng Ký Của Tôi" hiện đúng "Chờ chấm nghị luận".
//   4. Giảng viên mở "📝 Cần Chấm Nghị Luận", chấm 4/5 điểm nghị luận -> điểm cuối 9/10 = 90% -> ĐẠT
//      (passScore 70%) — verify cả 2 field DB.trainingTestSubmissions/DB.trainingRegistrations cập nhật.
//   5. Chấm điểm vượt quá tối đa bị từ chối (400); giảng viên KHÔNG được gán lớp này bị từ chối (403);
//      chấm lại 1 bài đã COMPLETE bị từ chối (409).
//   6. Regression: 1 bài test KHÔNG có câu ESSAY nào vẫn có kết quả NGAY khi nộp (gradingStatus COMPLETE),
//      y hệt hành vi trước Đợt 10.
//
// Run: node server/tests/test-training-essay-dragdrop-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8938;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const trainer = makeUser({ username: 'gv.linh', name: 'Trần Thị Linh', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } });
    const instructorA = makeUser({ username: 'gv.a', name: 'Giảng Viên A', dept: 'Phòng CNTT', perms: { trainingInstruct: true } });
    const instructorB = makeUser({ username: 'gv.b', name: 'Giảng Viên B', dept: 'Phòng Kế Toán', perms: { trainingInstruct: true } });
    const nv1 = makeUser({ username: 'nv1', name: 'Học Viên Một', dept: 'Phòng CNTT', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [trainer, instructorA, instructorB, nv1]);
    await page.evaluate((u) => finishLogin(u), trainer);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('TESTS'); });

    const tmpImgPath = path.join(os.tmpdir(), 'dragdrop-option-image.png');
    fs.writeFileSync(tmpImgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));

    await run('Test Builder <select> hiện đủ 4 loại câu hỏi (SINGLE/MULTI/ESSAY/IMAGE_DRAG_DROP)', async () => {
      await page.evaluate(() => { tbQuestions = []; tbAddQuestion(); });
      const html = await page.evaluate(() => document.getElementById('tbQuestionsContainer').innerHTML);
      assert(html.includes('value="ESSAY"'), 'expected an ESSAY <option>');
      assert(html.includes('value="IMAGE_DRAG_DROP"'), 'expected an IMAGE_DRAG_DROP <option>');
      assert(html.includes('value="SINGLE"') && html.includes('value="MULTI"'), 'SINGLE/MULTI options must still be present');
    });

    await run('chuyển loại câu hỏi sang ESSAY -> UI ẩn hẳn danh sách đáp án', async () => {
      await page.evaluate(() => tbUpdateQuestionField(0, 'type', 'ESSAY'));
      const html = await page.evaluate(() => document.getElementById('tbQuestionsContainer').innerHTML);
      assert(html.includes('Nghị Luận'), 'expected the ESSAY hint text');
      assert(!html.includes('Thêm Đáp Án'), 'ESSAY question must not show an "add option" control');
    });

    await run('chuyển loại câu hỏi sang IMAGE_DRAG_DROP -> UI hiện ô tải ảnh PER OPTION', async () => {
      await page.evaluate(() => tbUpdateQuestionField(0, 'type', 'IMAGE_DRAG_DROP'));
      const html = await page.evaluate(() => document.getElementById('tbQuestionsContainer').innerHTML);
      assert(html.includes('tbOptionImageFileChange'), 'expected per-option image file inputs for IMAGE_DRAG_DROP');
      assert(html.includes('Ảnh (bắt buộc)'), 'expected the "required image" hint per option');
    });

    let testId = null;
    await run('tạo bài test THẬT: 1 SINGLE (2đ) + 1 IMAGE_DRAG_DROP (3đ, ảnh tải thật) + 1 ESSAY (5đ)', async () => {
      await page.evaluate(() => {
        tbQuestions = [
          { text: 'Thủ đô Việt Nam?', type: 'SINGLE', points: 2, imageUrl: '', options: [
            { text: 'Hà Nội', correct: true, imageUrl: '' }, { text: 'Đà Nẵng', correct: false, imageUrl: '' }
          ] },
          { text: 'Kéo hình con vật sống dưới nước vào khung', type: 'IMAGE_DRAG_DROP', points: 3, imageUrl: '', options: [
            { text: 'Cá', correct: true, imageUrl: '' }, { text: 'Chó', correct: false, imageUrl: '' }
          ] },
          { text: 'Trình bày quan điểm của bạn về văn hoá doanh nghiệp', type: 'ESSAY', points: 5, imageUrl: '', options: [] }
        ];
        renderTestBuilderQuestions();
      });
      // Tải ảnh THẬT cho 2 đáp án của câu IMAGE_DRAG_DROP — selector CHỈ khớp input tải ảnh PER OPTION
      // (data-op-change="tbOptionImageFileChange"), không lẫn với input tải ảnh minh hoạ ĐỀ BÀI (stem,
      // mọi câu hỏi kể cả SINGLE/ESSAY đều có 1 ô này khi imageUrl rỗng).
      const optionImgSelector = '#tbQuestionsContainer input[data-op-change="tbOptionImageFileChange"]';
      const fileInputs = await page.$$(optionImgSelector);
      assertEqual(fileInputs.length, 2, `expected exactly 2 per-option image file inputs (IMAGE_DRAG_DROP), got ${fileInputs.length}`);
      await page.setInputFiles(optionImgSelector, tmpImgPath); // Playwright: khớp phần tử ĐẦU TIÊN
      await page.waitForFunction(() => tbQuestions[1].options[0].imageUrl, { timeout: 5000 });
      // Re-query sau khi DOM re-render (ảnh đã có preview, input[0] cũ biến mất — input còn lại giờ là index 0).
      await page.setInputFiles(optionImgSelector, tmpImgPath);
      await page.waitForFunction(() => tbQuestions[1].options[1].imageUrl, { timeout: 5000 });

      await page.evaluate(() => {
        document.getElementById('ttTitle').value = 'Bài Test Đợt 10 — 3 Loại Câu Hỏi';
        document.getElementById('ttPassScore').value = '70';
      });
      await page.evaluate(() => submitTrainingTest({ preventDefault() {} }));
      const tests = await page.evaluate(() => DB.trainingTests);
      assertEqual(tests.length, 1, 'expected exactly 1 training test');
      testId = tests[0].id;
      assertEqual(tests[0].questions.length, 3, 'expected 3 questions');
      assertEqual(tests[0].questions[0].type, 'SINGLE');
      assertEqual(tests[0].questions[1].type, 'IMAGE_DRAG_DROP');
      assertEqual(tests[0].questions[2].type, 'ESSAY');
      assert(/^\/uploads\//.test(tests[0].questions[1].options[0].imageUrl), 'IMAGE_DRAG_DROP option 1 should have a real /uploads/ imageUrl');
      assert(/^\/uploads\//.test(tests[0].questions[1].options[1].imageUrl), 'IMAGE_DRAG_DROP option 2 should have a real /uploads/ imageUrl');
      assertEqual(tests[0].questions[2].options.length, 0, 'ESSAY question should have zero options');
    });

    let classId = null;
    await run('trainer gán bài test này (có ESSAY) vào 1 lớp ONLINE, giảng viên A phụ trách', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('CLASSES'); });
      await page.evaluate((tid) => {
        document.getElementById('tcCategory').value = 'Kỹ năng mềm';
        document.getElementById('tcTitle').value = 'Lớp Kiểm Thử Đợt 10';
        document.getElementById('tcStart').value = '2026-01-01T08:00';
        document.getElementById('tcEnd').value = '2026-01-01T10:00';
        document.getElementById('tcMode').value = 'ONLINE';
        document.getElementById('tcInstructorUsername').value = 'gv.a'; // gán giảng viên A trực tiếp qua hidden field (mirrors resolveTrainingInstructorInput())
        document.getElementById('tcTestId').value = String(tid);
        document.getElementById('tcPassScore').value = '70';
      }, testId);
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const classes = await page.evaluate(() => DB.trainingClasses);
      assertEqual(classes.length, 1, 'expected exactly 1 class');
      classId = classes[0].id;
      assertEqual(classes[0].testId, testId, 'class should reference the new test');
    });

    await run('trainer thêm nv1 vào lớp', async () => {
      await page.evaluate((id) => openTrainingRosterModal(id), classId);
      await page.evaluate(() => stageTrainingRosterUser('nv1', 'Học Viên Một', 'Phòng CNTT'));
      await page.evaluate(() => confirmTrainingRosterAdd());
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv1'), classId);
      assert(reg, 'nv1 should now be registered');
    });

    await run('nv1 làm bài: SINGLE đúng (bấm chọn), IMAGE_DRAG_DROP đúng (1 ảnh bấm chọn + 1 ảnh kéo-thả), ESSAY tự viết -> nộp bài', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate((id) => openTakeTestModal(id), classId);

      // openTakeTestModal() XÁO TRỘN thứ tự câu hỏi mỗi lần mở (shuffleArrayCopy(), Đợt 4 — xem
      // module-internalcomms-daotao.js) nên KHÔNG được giả định câu hỏi #N cố định là loại gì — lặp theo
      // ttTakeIndex hiện tại và rẽ nhánh theo q.type thật, mirror "a shuffled test-take run" đã có sẵn
      // trong tests/test-internal-training.js.
      const total = await page.evaluate(() => ttTakeQuestions.length);
      assertEqual(total, 3, 'expected exactly 3 questions in this test');
      for (let i = 0; i < total; i++) {
        const qType = await page.evaluate(() => ttTakeQuestions[ttTakeIndex].type);
        if (qType === 'SINGLE') {
          await page.evaluate(() => {
            const q = ttTakeQuestions[ttTakeIndex];
            q.correctOptionIds.forEach((optId) => ttTakeSelectOption(optId, true));
          });
        } else if (qType === 'IMAGE_DRAG_DROP') {
          // Options trong câu này CŨNG bị xáo trộn thứ tự (shuffleArrayCopy() áp dụng cho q.options
          // trong openTakeTestModal()) nên vị trí DOM #0 không chắc là đáp án ĐÚNG — bước 1 chỉ xác nhận
          // "bấm CLICK trên thẻ ảnh #0 (id THẬT bất kỳ) toggle chọn/bỏ chọn đúng theo id đó" (2 lần bấm
          // liên tiếp = chọn rồi bỏ chọn lại, về trạng thái rỗng), KHÔNG giả định thẻ #0 là đáp án đúng.
          await page.waitForSelector('#ttTakeDragPool > div');
          const domOptionId = await page.evaluate(() => Number(ttTakeQuestions[ttTakeIndex].options[0].id));
          await page.evaluate(() => document.querySelectorAll('#ttTakeDragPool > div')[0].click());
          const afterClick = await page.evaluate(() => ttTakeAnswers[ttTakeQuestions[ttTakeIndex].id].slice());
          assertEqual(JSON.stringify(afterClick), JSON.stringify([domOptionId]), 'clicking the 1st rendered image card should select exactly ITS OWN option id');
          await page.evaluate(() => document.querySelectorAll('#ttTakeDragPool > div')[0].click()); // bấm lại -> bỏ chọn (toggle)
          const afterSecondClick = await page.evaluate(() => ttTakeAnswers[ttTakeQuestions[ttTakeIndex].id].slice());
          assertEqual(afterSecondClick.length, 0, 'clicking the SAME card again should deselect it (toggle)');
          // Đáp án THẬT nộp bài — dùng đường "kéo thả" (gọi ĐÚNG hàm mà handler 'drop' thật sự gọi,
          // addOnly=true) để chọn đúng (các) đáp án ĐÚNG, xác nhận ghi vào CÙNG 1 state (ttTakeAnswers)
          // như đường bấm chọn vừa kiểm ở trên — 2 đường tương đương, không đường nào có state riêng.
          const correctIds = await page.evaluate(() => ttTakeQuestions[ttTakeIndex].correctOptionIds.slice());
          await page.evaluate((ids) => { ids.forEach((id) => ttTakeToggleImageDragOption(id, true)); }, correctIds);
          const afterDrop = await page.evaluate(() => ttTakeAnswers[ttTakeQuestions[ttTakeIndex].id].slice().sort());
          assertEqual(JSON.stringify(afterDrop), JSON.stringify([...correctIds].sort()), 'drag-drop path must select exactly the correct option ids');
        } else if (qType === 'ESSAY') {
          // Gõ vào textarea thật (data-op-input) để đi qua đúng luồng CSP dispatch.
          await page.waitForSelector('#ttTakeOptionsContainer textarea');
          await page.type('#ttTakeOptionsContainer textarea', 'Văn hoá doanh nghiệp là nền tảng gắn kết nhân viên...');
        } else {
          throw new Error(`unexpected question type in this test: ${qType}`);
        }
        await page.evaluate(() => ttTakeGoNext()); // câu cuối -> tự động gọi ttTakeSubmit()
      }
      await page.waitForFunction(() => document.getElementById('trainingTakeTestModal').classList.contains('hidden'), { timeout: 5000 });

      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đang chờ chấm câu nghị luận')), `expected the "pending essay grading" alert, got ${JSON.stringify(alerts)}`);
    });

    let submissionId = null;
    await run('ngay sau khi nộp: gradingStatus PENDING_ESSAY_GRADING, reg.result CÒN REGISTERED, điểm auto = 5/10', async () => {
      const sub = await page.evaluate((cid) => DB.trainingTestSubmissions.find((s) => s.classId === cid && s.username === 'nv1'), classId);
      assert(sub, 'expected a submission record for nv1');
      submissionId = sub.id;
      assertEqual(sub.gradingStatus, 'PENDING_ESSAY_GRADING', 'submission should be pending essay grading');
      assertEqual(sub.score, 5, 'auto-graded score should be 2 (SINGLE) + 3 (IMAGE_DRAG_DROP) = 5');
      assertEqual(sub.totalPoints, 10, 'total points should be 2+3+5=10');
      assertEqual(sub.percentage, null, 'percentage must NOT be finalized yet');
      assertEqual(sub.passed, null, 'passed must NOT be finalized yet');
      const reg = await page.evaluate((cid) => DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'nv1'), classId);
      assertEqual(reg.result, 'REGISTERED', 'reg.result must stay REGISTERED until the essay portion is graded');
    });

    await run('màn "Đăng Ký Của Tôi" hiện đúng "Chờ chấm nghị luận" thay vì kết quả giả', async () => {
      await page.evaluate(() => { setTrainingLmsTab('MY_REGS'); });
      const html = await page.evaluate(() => document.getElementById('trainingMyRegsTableBody').innerHTML);
      assert(html.includes('Chờ chấm nghị luận'), 'expected the pending-essay badge in "Đăng Ký Của Tôi"');
      assert(!html.includes('Vào Làm Bài Test'), 'must NOT show "take the test" button again for an already-submitted essay-pending test');
    });

    await run('giảng viên KHÁC (không phụ trách lớp này) không thấy bài trong hàng đợi + bị server từ chối (403)', async () => {
      await page.evaluate((u) => { currentUser = u; }, instructorB);
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('TESTS'); });
      const html = await page.evaluate(() => document.getElementById('trainingEssayGradingContainer').innerHTML);
      assert(!html.includes('openGradeEssayModal'), 'instructor B should not see any pending submission to grade');
      let errMsg = null;
      await page.evaluate(async ({ cid, sid }) => {
        try { await callRecordAction('trainingClasses', cid, `submissions/${sid}/grade-essay`, { essayGrades: [{ questionId: 3, pointsAwarded: 4 }] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, { cid: classId, sid: submissionId });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không có quyền'), `expected a 403 permission error, got: ${errMsg}`);
    });

    await run('chấm điểm nghị luận vượt quá tối đa (5đ) bị từ chối (400)', async () => {
      await page.evaluate((u) => { currentUser = u; }, instructorA);
      let errMsg = null;
      await page.evaluate(async ({ cid, sid }) => {
        try { await callRecordAction('trainingClasses', cid, `submissions/${sid}/grade-essay`, { essayGrades: [{ questionId: 999, pointsAwarded: 4 }] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, { cid: classId, sid: submissionId });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg, 'expected an error for a non-existent essay question id (unrecognized -> treated as unscored -> 400)');
    });

    await run('giảng viên A (phụ trách lớp) mở hàng đợi "📝 Cần Chấm Nghị Luận", chấm 4/5 điểm -> điểm cuối 9/10 = 90% -> ĐẠT', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('TESTS'); });
      const html = await page.evaluate(() => document.getElementById('trainingEssayGradingContainer').innerHTML);
      assert(html.includes('openGradeEssayModal'), 'instructor A should see the pending submission');
      await page.evaluate((sid) => openGradeEssayModal(sid), submissionId);
      const modalTitle = await page.evaluate(() => document.getElementById('geModalTitle').innerText);
      assert(modalTitle.includes('Học Viên Một'), 'modal title should name the student');
      const questionsHTML = await page.evaluate(() => document.getElementById('geQuestionsContainer').innerHTML);
      assert(questionsHTML.includes('Văn hoá doanh nghiệp là nền tảng'), 'the essay text answer should be shown for grading');

      const essayQId = await page.evaluate((tid) => DB.trainingTests.find((t) => t.id === tid).questions.find((q) => q.type === 'ESSAY').id, testId);
      await page.evaluate((qid) => { document.getElementById(`geScore_${qid}`).value = '4'; }, essayQId);
      await page.evaluate(() => submitGradeEssay());

      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đã chấm xong')), `expected a completion alert, got ${JSON.stringify(alerts)}`);

      const sub = await page.evaluate((sid) => DB.trainingTestSubmissions.find((s) => s.id === sid), submissionId);
      assertEqual(sub.gradingStatus, 'COMPLETE', 'submission should now be COMPLETE');
      assertEqual(sub.score, 9, 'expected final score 5 (auto) + 4 (essay) = 9');
      assertEqual(sub.percentage, 90, 'expected 9/10 = 90%');
      assertEqual(sub.passed, true, '90% >= passScore 70% -> ĐẠT');

      const reg = await page.evaluate((cid) => DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'nv1'), classId);
      assertEqual(reg.result, 'PASSED', 'reg.result should now be PASSED');
      assert(reg.resultByName.includes('Giảng Viên A'), `expected resultByName to credit the grading instructor, got: ${reg.resultByName}`);
    });

    await run('chấm lại 1 bài đã COMPLETE bị từ chối (409)', async () => {
      let errMsg = null;
      await page.evaluate(async ({ cid, sid }) => {
        try { await callRecordAction('trainingClasses', cid, `submissions/${sid}/grade-essay`, { essayGrades: [{ questionId: 3, pointsAwarded: 2 }] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, { cid: classId, sid: submissionId });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không ở trạng thái chờ chấm'), `expected a 409 re-grade rejection, got: ${errMsg}`);
    });

    await run('hàng đợi "📝 Cần Chấm Nghị Luận" giờ rỗng (bài đã chấm xong)', async () => {
      await page.evaluate(() => renderTrainingEssayGradingQueue());
      const html = await page.evaluate(() => document.getElementById('trainingEssayGradingContainer').innerHTML);
      assert(html.includes('Không có bài nào đang chờ chấm'), 'expected an empty-queue message');
    });

    // ===== Regression: bài test KHÔNG có câu ESSAY vẫn có kết quả NGAY, y hệt trước Đợt 10 =====
    let noEssayTestId = null;
    await run('regression: tạo bài test 100% SINGLE/MULTI (không ESSAY)', async () => {
      await page.evaluate(() => { currentUser = null; });
      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate(() => { setTrainingLmsTab('TESTS'); });
      await page.evaluate(() => {
        tbQuestions = [{ text: 'Câu hỏi thường', type: 'SINGLE', points: 1, imageUrl: '', options: [
          { text: 'Đúng', correct: true, imageUrl: '' }, { text: 'Sai', correct: false, imageUrl: '' }
        ] }];
        document.getElementById('ttTitle').value = 'Bài Test Không Có Nghị Luận';
        document.getElementById('ttPassScore').value = '50';
      });
      await page.evaluate(() => submitTrainingTest({ preventDefault() {} }));
      const tests = await page.evaluate(() => DB.trainingTests);
      noEssayTestId = tests.find((t) => t.title === 'Bài Test Không Có Nghị Luận').id;
    });

    let noEssayClassId = null;
    await run('regression: gán vào lớp mới, nv1 nộp bài -> kết quả CHỐT NGAY (gradingStatus COMPLETE), không có gì "chờ chấm"', async () => {
      await page.evaluate(() => { setTrainingLmsTab('CLASSES'); });
      await page.evaluate((tid) => {
        document.getElementById('tcCategory').value = 'Kỹ năng mềm';
        document.getElementById('tcTitle').value = 'Lớp Không Nghị Luận';
        document.getElementById('tcStart').value = '2026-01-01T08:00';
        document.getElementById('tcEnd').value = '2026-01-01T10:00';
        document.getElementById('tcMode').value = 'ONLINE';
        document.getElementById('tcTestId').value = String(tid);
        document.getElementById('tcPassScore').value = '50';
      }, noEssayTestId);
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const classes = await page.evaluate(() => DB.trainingClasses);
      noEssayClassId = classes.find((c) => c.title === 'Lớp Không Nghị Luận').id;
      await page.evaluate((id) => openTrainingRosterModal(id), noEssayClassId);
      await page.evaluate(() => stageTrainingRosterUser('nv1', 'Học Viên Một', 'Phòng CNTT'));
      await page.evaluate(() => confirmTrainingRosterAdd());

      await page.evaluate((u) => { currentUser = u; }, nv1);
      const result = await page.evaluate(async ({ classId, tId }) => {
        const test = DB.trainingTests.find((t) => t.id === tId);
        const q1 = test.questions[0];
        ttTakeClassId = classId;
        ttTakeQuestions = test.questions;
        ttTakeAnswers = { [q1.id]: [...q1.correctOptionIds] };
        await ttTakeSubmit();
        return {
          reg: DB.trainingRegistrations.find((r) => r.classId === classId && r.creator === 'nv1'),
          sub: DB.trainingTestSubmissions.find((s) => s.classId === classId && s.username === 'nv1')
        };
      }, { classId: noEssayClassId, tId: noEssayTestId });
      assertEqual(result.sub.gradingStatus, 'COMPLETE', 'no-essay test must finalize immediately (regression)');
      assertEqual(result.reg.result, 'PASSED', 'no-essay test must set the result immediately (regression)');
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-training-essay-dragdrop-ui.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
