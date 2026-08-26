// tests/test-onboarding.js — Đào Tạo Đợt 6: Đào Tạo Tân Binh (onboardingPaths + onboardingProgress).
// Tách file riêng khỏi test-internal-training.js/test-training-plans.js (cùng lý do Đợt 5 tách riêng
// khỏi Đợt 4: đây là 1 khối tính năng đủ lớn — catalog Lộ Trình + Phân Công + 2 bài test SỐNG (Stage
// 1/2, tái sử dụng modal làm bài + chấm điểm có sẵn) + đánh giá thủ công (Stage 3, gác theo dept) + cấp
// Chứng Chỉ Hoàn Thành PDF).
//
// PHẠM VI: server thật không chạy được trong sandbox này (không có SQL Server) — mọi kịch bản dưới đây
// chạy qua _mock-backend.js (mirror lib/createValidation.js CREATE_MODULE_CONFIGS.onboardingPaths/
// onboardingProgress + lib/recordActions.js submitOnboardingStageTest/evaluateOnboardingStage3/
// issueOnboardingCertificate, xem comment ở đầu mỗi hàm __mock* tương ứng). Chứng Chỉ PDF THẬT
// (html2canvas + jsPDF, downloadOnboardingCertificatePdf() ở index.html) KHÔNG có test nào trong repo
// này từng exercise thật (kể cả exportBudgetSummaryPdf() ở Ngân Sách) — cố tình KHÔNG gọi
// issueOnboardingCertificateAction() (hàm đó luôn kích hoạt tải PDF thật ngay sau khi cấp) ở đây, chỉ
// gọi thẳng route 'issue-certificate' qua callRecordAction() để kiểm chứng đúng phần server-side gate
// (certificateIssued/issuedAt/issuedBy) — đủ phạm vi cần verify, không có logic nghiệp vụ nào khác nằm
// trong bước dựng PDF để kiểm chứng thêm.
//
// Run: node server/tests/test-onboarding.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8997;

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const hr = makeUser({ username: 'hr.mai', name: 'Trần Thị Mai', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } });
    const admin = makeUser({ username: 'admin.a', name: 'Quản Trị A', dept: 'Phòng Nhân Sự', perms: { admin: true } });
    // Quản lý ĐÚNG phòng CNTT với tân binh — có onboardingEvaluate -> phải đánh giá được.
    const mgrIt = makeUser({ username: 'mgr.it', name: 'Quản Lý IT', dept: 'Phòng CNTT', perms: { onboardingEvaluate: true } });
    // Quản lý KHÁC phòng (Kế Toán) nhưng vẫn có onboardingEvaluate -> phải bị chặn (khác dept).
    const mgrOther = makeUser({ username: 'mgr.other', name: 'Quản Lý Khác Phòng', dept: 'Phòng Kế Toán', perms: { onboardingEvaluate: true } });
    // Đồng nghiệp CÙNG phòng CNTT nhưng KHÔNG có onboardingEvaluate -> phải bị chặn (thiếu quyền dù đúng dept).
    const peerIt = makeUser({ username: 'peer.it', name: 'Đồng Nghiệp IT', dept: 'Phòng CNTT', perms: {} });
    // Tân binh — nhân viên được phân công lộ trình, ban đầu CHƯA có startDate (test chặn thiếu startDate).
    const staffIt = makeUser({ username: 'staff.it', name: 'Nhân Viên IT Mới', dept: 'Phòng CNTT', perms: {} });

    const seed = baseCatalogSeed();
    await page.evaluate((s) => { Object.assign(DB, s); }, seed);
    await page.evaluate((users) => { DB.users = users; }, [hr, admin, mgrIt, mgrOther, peerIt, staffIt]);
    await page.evaluate((u) => finishLogin(u), hr);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('ONBOARDING'); });

    // ===================== onboardingPaths: quyền + validate =====================

    await run('non-trainingManage cannot create onboardingPaths (server-side reject)', async () => {
      await page.evaluate((u) => { currentUser = u; }, staffIt);
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('onboardingPaths', { name: 'X' }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không có quyền tạo lộ trình'), `expected a permission error, got: ${errMsg}`);
      await page.evaluate((u) => { currentUser = u; }, hr);
    });

    let test1Id = null, test2Id = null, docId = null;
    await run('seed 2 trainingTests (1 question, correct = option id 1) + 1 trainingDocument to build a path against', async () => {
      const ids = await page.evaluate(async () => {
        const mkTest = (title) => callCreateAction('trainingTests', {
          title, category: '', passScore: 60,
          questions: [{ text: 'Câu hỏi duy nhất', type: 'SINGLE', options: [{ text: 'Đáp án đúng' }, { text: 'Đáp án sai' }], correctOptionIds: [1] }]
        });
        const t1 = (await mkTest('Test Giai Đoạn 1')).item;
        const t2 = (await mkTest('Test Giai Đoạn 2')).item;
        const doc = (await callCreateAction('trainingDocuments', { category: 'Nghiệp vụ', title: 'Tài liệu tân binh', docType: 'DOCUMENT', fileUrl: '/x.pdf', fileName: 'x.pdf', fileType: 'application/pdf' })).item;
        DB.trainingTests.push(t1, t2);
        DB.trainingDocuments.push(doc);
        return { t1: t1.id, t2: t2.id, doc: doc.id };
      });
      test1Id = ids.t1; test2Id = ids.t2; docId = ids.doc;
    });

    await run('missing test1Id/test2Id is rejected server-side (bắt buộc, khác courseId/testId tuỳ chọn ở trainingClasses)', async () => {
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('onboardingPaths', { name: 'Lộ Trình Thiếu Test', stage1DocumentIds: [], stage2DocumentIds: [] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('bài test Giai đoạn 1'), `expected a missing-test error, got: ${errMsg}`);
    });

    let pathId = null;
    await run('trainingManage creates a full onboardingPaths entry via the real form (submitOnboardingPath)', async () => {
      await page.evaluate((ids) => {
        window.__alerts.length = 0;
        document.getElementById('opName').value = 'Lộ Trình Nhân Viên Kho';
        populateOnboardingPathSelects();
        [...document.getElementById('opStage1DocumentIds').options].forEach((o) => { o.selected = Number(o.value) === ids.doc; });
        document.getElementById('opTest1Id').value = String(ids.t1);
        document.getElementById('opTest2Id').value = String(ids.t2);
        document.getElementById('opStage3Criteria').value = 'Thái độ làm việc, tuân thủ quy trình kho.';
      }, { doc: docId, t1: test1Id, t2: test2Id });
      await page.evaluate(() => submitOnboardingPath({ preventDefault() {}, target: { reset() {} } }));
      const paths = await page.evaluate(() => DB.onboardingPaths);
      assertEqual(paths.length, 1, 'expected exactly 1 onboarding path');
      pathId = paths[0].id;
      assertEqual(paths[0].test1Id, test1Id, 'test1Id mismatch');
      assertEqual(paths[0].test2Id, test2Id, 'test2Id mismatch');
      assertEqual(paths[0].stage1DocumentIds.length, 1, 'stage1DocumentIds mismatch');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đã tạo lộ trình đào tạo tân binh')), `expected success alert, got ${JSON.stringify(alerts)}`);
    });

    await run('editing the path in place (Sửa) preserves unrelated fields', async () => {
      await page.evaluate((id) => openEditOnboardingPath(id), pathId);
      await page.evaluate(() => { document.getElementById('opStage3Criteria').value = 'Tiêu chí đã cập nhật.'; });
      await page.evaluate(() => submitOnboardingPath({ preventDefault() {}, target: { reset() {} } }));
      const path = await page.evaluate((id) => DB.onboardingPaths.find((p) => p.id === id), pathId);
      assertEqual(path.stage3Criteria, 'Tiêu chí đã cập nhật.', 'stage3Criteria should be updated');
      assertEqual(path.test1Id, test1Id, 'unrelated field (test1Id) should be preserved after a partial edit');
    });

    await run('only Admin sees the "Xóa" button for onboardingPaths, not a trainingManage-only user', async () => {
      const htmlAsTrainer = await page.evaluate(() => { renderOnboardingPathsTable(); return document.getElementById('onboardingPathsTableBody').innerHTML; });
      assert(!htmlAsTrainer.includes('deleteOnboardingPath'), 'trainingManage (non-admin) should not see a delete button');
      await page.evaluate((u) => { currentUser = u; }, admin);
      const htmlAsAdmin = await page.evaluate(() => { renderOnboardingPathsTable(); return document.getElementById('onboardingPathsTableBody').innerHTML; });
      assert(htmlAsAdmin.includes('deleteOnboardingPath'), 'Admin should see a delete button');
      await page.evaluate((u) => { currentUser = u; }, hr);
    });

    // ===================== onboardingProgress: phân công — gate + validate =====================

    await run('assigning an employee with no startDate is rejected with a clear message', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callCreateAction('onboardingProgress', { employeeUsername: 'staff.it', pathId: pid }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, pathId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('chưa có Ngày Vào Làm Việc'), `expected a missing-startDate error, got: ${errMsg}`);
    });

    let progressId = null;
    await run('after setting startDate, assigning succeeds and snapshots startDate + names via the real form (submitOnboardingAssignment)', async () => {
      await page.evaluate((d) => { DB.users.find((u) => u.username === 'staff.it').startDate = d; }, isoDateDaysAgo(3));
      await page.evaluate((pid) => {
        populateOnboardingPathSelects();
        document.getElementById('oaEmployeeInput').value = 'Nhân Viên IT Mới (staff.it)';
        resolveOnboardingEmployeeInput();
        document.getElementById('oaPathId').value = String(pid);
      }, pathId);
      await page.evaluate(() => submitOnboardingAssignment());
      const list = await page.evaluate(() => DB.onboardingProgress);
      assertEqual(list.length, 1, 'expected exactly 1 onboardingProgress row');
      const item = list[0];
      progressId = item.id;
      assertEqual(item.employeeUsername, 'staff.it', 'employeeUsername mismatch');
      assertEqual(item.employeeName, 'Nhân Viên IT Mới', 'employeeName snapshot mismatch');
      assertEqual(item.pathName, 'Lộ Trình Nhân Viên Kho', 'pathName snapshot mismatch');
      assertEqual(item.stage1Result, null, 'stage1Result should start null');
      assertEqual(item.certificateIssued, false, 'certificateIssued should start false');
      assert(item.startDate, 'startDate should be snapshotted onto the progress row');
    });

    await run('assigning the SAME employee to the SAME path again is rejected (duplicate)', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callCreateAction('onboardingProgress', { employeeUsername: 'staff.it', pathId: pid }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, pathId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('đã được phân công lộ trình'), `expected a duplicate-assignment error, got: ${errMsg}`);
    });

    await run('SAFETY: later edits to the employee profile startDate do NOT retroactively shift the in-progress assignment (snapshot, not live-read)', async () => {
      const before = await page.evaluate((pid) => DB.onboardingProgress.find((p) => p.id === pid).startDate, progressId);
      await page.evaluate(() => { DB.users.find((u) => u.username === 'staff.it').startDate = '2000-01-01'; });
      const after = await page.evaluate((pid) => DB.onboardingProgress.find((p) => p.id === pid).startDate, progressId);
      assertEqual(after, before, 'progress.startDate must stay exactly as snapshotted at assignment time, independent of later profile edits');
      // Khôi phục lại đúng giá trị ban đầu cho phần còn lại của luồng test.
      await page.evaluate((d) => { DB.users.find((u) => u.username === 'staff.it').startDate = d; }, isoDateDaysAgo(3));
    });

    // ===================== Mốc tính SỐNG (computeOnboardingMilestones) tại nhiều mốc startDate =====================

    await run('computeOnboardingMilestones(): chuyển trạng thái đúng qua các mốc Ngày 1-7 / 8-21 / 59', async () => {
      const cases = await page.evaluate(() => {
        const mk = (daysAgo) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString().slice(0, 10); };
        const base = { stage1Result: null, stage2Result: null, stage3Evaluation: null };
        return {
          day0: computeOnboardingMilestones({ ...base, startDate: mk(0) }),
          day6: computeOnboardingMilestones({ ...base, startDate: mk(6) }),  // 1 ngày còn lại của hạn 7 ngày -> Sắp đến hạn
          day8: computeOnboardingMilestones({ ...base, startDate: mk(8) }),  // GĐ1 (hạn 7) quá hạn, GĐ2 (hạn 21) chưa tới
          day60: computeOnboardingMilestones({ startDate: mk(60), stage1Result: 'PASSED', stage2Result: 'PASSED', stage3Evaluation: null }) // qua mốc 59, GĐ3 quá hạn
        };
      });
      assertEqual(cases.day0.stage1.status.key, 'NOT_DUE', 'day0: Giai đoạn 1 chưa đến hạn');
      assertEqual(cases.day6.stage1.status.key, 'DUE_SOON', 'day6 (còn 1 ngày của hạn 7): Giai đoạn 1 phải Sắp đến hạn');
      assertEqual(cases.day8.stage1.status.key, 'OVERDUE', 'day8: Giai đoạn 1 (hạn 7 ngày) phải Quá hạn');
      assertEqual(cases.day8.stage2.status.key, 'NOT_DUE', 'day8: Giai đoạn 2 (hạn 21 ngày) chưa tới hạn');
      assertEqual(cases.day60.stage1.status.key, 'DONE', 'day60: Giai đoạn 1 đã có kết quả -> Hoàn thành bất kể ngày');
      assertEqual(cases.day60.stage3.status.key, 'OVERDUE', 'day60 (quá mốc 59): Giai đoạn 3 chưa đánh giá phải Quá hạn');
    });

    // ===================== Đánh giá Giai đoạn 3 bị chặn khi GĐ1/2 CHƯA Đạt cả 2 =====================

    await run('evaluate-stage3 is blocked while Stage 1/2 are not both PASSED yet (even for the correct-dept evaluator)', async () => {
      await page.evaluate((u) => { currentUser = u; }, mgrIt);
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'evaluate-stage3', { evaluation: 'PASSED' }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('Đạt cả Giai đoạn 1 và Giai đoạn 2'), `expected a stage1/2-precondition error, got: ${errMsg}`);
    });

    // ===================== Luồng tân binh: nộp bài Giai đoạn 1 -> Đạt -> mở khoá Giai đoạn 2 -> Đạt =====================

    await run('a user OTHER than the assigned employee cannot submit the stage test (403 ownership check)', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'submit-stage-test', { stage: 1, answers: [{ questionId: 1, selectedOptionIds: [1] }] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('chỉ có thể tự làm bài test'), `expected an ownership error, got: ${errMsg}`);
    });

    await run('Stage 2 cannot be submitted before Stage 1 is PASSED', async () => {
      await page.evaluate((u) => { currentUser = u; }, staffIt);
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'submit-stage-test', { stage: 2, answers: [{ questionId: 1, selectedOptionIds: [1] }] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('Đạt Giai đoạn 1 trước'), `expected a stage-order error, got: ${errMsg}`);
    });

    await run('the assigned employee submits Stage 1 via the REAL test-taking modal (openOnboardingStageTestModal, reused from trainingClasses) with the correct answer -> PASSED, unlocks Stage 2', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('ONBOARDING'); });
      await page.evaluate((pid) => openOnboardingStageTestModal(pid, 1), progressId);
      const modalVisible = await page.evaluate(() => !document.getElementById('trainingTakeTestModal').classList.contains('hidden'));
      assert(modalVisible, 'the shared take-test modal should be visible');
      await page.evaluate(() => ttTakeSelectOption(1, true)); // option id 1 = "Đáp án đúng" (correctOptionIds:[1])
      await page.evaluate(() => ttTakeGoNext()); // only question -> triggers submit
      await page.waitForFunction(() => document.getElementById('trainingTakeTestModal').classList.contains('hidden'));
      const progress = await page.evaluate((pid) => DB.onboardingProgress.find((p) => p.id === pid), progressId);
      assertEqual(progress.stage1Result, 'PASSED', 'stage1Result should be PASSED');
      assertEqual(progress.stage1Score, 100, 'stage1Score should be 100%');
      assert(progress.stage1SubmittedAt, 'stage1SubmittedAt should be set');
    });

    await run('a stage that already has a terminal result cannot be submitted again', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'submit-stage-test', { stage: 1, answers: [] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('đã có kết quả'), `expected an already-has-a-result error, got: ${errMsg}`);
    });

    await run('Stage 2 is now unlocked and passing it updates state', async () => {
      await page.evaluate((pid) => openOnboardingStageTestModal(pid, 2), progressId);
      await page.evaluate(() => ttTakeSelectOption(1, true));
      await page.evaluate(() => ttTakeGoNext());
      await page.waitForFunction(() => document.getElementById('trainingTakeTestModal').classList.contains('hidden'));
      const progress = await page.evaluate((pid) => DB.onboardingProgress.find((p) => p.id === pid), progressId);
      assertEqual(progress.stage2Result, 'PASSED', 'stage2Result should be PASSED');
      assertEqual(progress.stage2Score, 100, 'stage2Score should be 100%');
    });

    // ===================== Chứng chỉ bị chặn trước khi đủ 3 giai đoạn Đạt =====================

    await run('issue-certificate is blocked before Stage 3 has been evaluated (only 2 of 3 stages PASSED so far)', async () => {
      await page.evaluate((u) => { currentUser = u; }, hr); // trainingManage — kiểm tra đúng cổng TRẠNG THÁI, không phải cổng quyền hạn
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'issue-certificate', {}); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('chưa Đạt cả 3 giai đoạn'), `expected a not-all-3-passed error, got: ${errMsg}`);
      await page.evaluate((u) => { currentUser = u; }, admin); // admin thử luôn cũng phải bị chặn như nhau (gác theo trạng thái, không theo quyền ở bước này)
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'issue-certificate', {}); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      const errMsg2 = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg2 && errMsg2.includes('chưa Đạt cả 3 giai đoạn'), `expected the same not-all-3-passed error for admin, got: ${errMsg2}`);
    });

    // ===================== Đánh Giá Giai Đoạn 3 — gác theo phòng ban/siêu thị (mirror uniformStoreManage/item.dept) =====================

    await run('a same-dept colleague WITHOUT onboardingEvaluate cannot evaluate Stage 3 (peer.it, Phòng CNTT, no perm)', async () => {
      await page.evaluate((u) => { currentUser = u; }, peerIt);
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'evaluate-stage3', { evaluation: 'PASSED' }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không có quyền đánh giá Giai đoạn 3'), `expected a permission error, got: ${errMsg}`);
    });

    await run('an onboardingEvaluate holder in a DIFFERENT dept cannot evaluate Stage 3 (mgr.other, Phòng Kế Toán)', async () => {
      await page.evaluate((u) => { currentUser = u; }, mgrOther);
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'evaluate-stage3', { evaluation: 'PASSED' }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không có quyền đánh giá Giai đoạn 3'), `expected a dept-mismatch error, got: ${errMsg}`);
      // Cũng KHÔNG xuất hiện trong hàng chờ đánh giá phía client (soft-hide, cùng với gác cứng ở server).
      await page.evaluate(() => renderOnboardingStage3Queue());
      const queueHTML = await page.evaluate(() => document.getElementById('onboardingStage3QueueContainer').innerHTML);
      assert(!queueHTML.includes('Nhân Viên IT Mới'), 'a different-dept evaluator must not see this trainee in their Stage 3 queue');
    });

    await run('the SAME-dept manager with onboardingEvaluate (mgr.it, Phòng CNTT) CAN evaluate Stage 3 -> PASSED', async () => {
      await page.evaluate((u) => { currentUser = u; }, mgrIt);
      await page.evaluate(() => renderOnboardingStage3Queue());
      const queueHTML = await page.evaluate(() => document.getElementById('onboardingStage3QueueContainer').innerHTML);
      assert(queueHTML.includes('Nhân Viên IT Mới'), 'the correct-dept evaluator should see this trainee in their Stage 3 queue');

      const result = await page.evaluate(async (pid) => callRecordAction('onboardingProgress', pid, 'evaluate-stage3', { evaluation: 'PASSED', note: 'Thái độ tốt, nắm quy trình.' }), progressId);
      const updated = result.item;
      assertEqual(updated.stage3Evaluation, 'PASSED', 'stage3Evaluation should be PASSED');
      assertEqual(updated.stage3EvaluatedBy, 'mgr.it', 'stage3EvaluatedBy mismatch');
      assertEqual(updated.stage3Note, 'Thái độ tốt, nắm quy trình.', 'stage3Note mismatch');
      await page.evaluate((it) => { const idx = DB.onboardingProgress.findIndex((p) => p.id === it.id); DB.onboardingProgress[idx] = it; }, updated);
    });

    await run('Stage 3 cannot be evaluated a second time once it has a terminal result', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'evaluate-stage3', { evaluation: 'FAILED' }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('đã được đánh giá rồi'), `expected an already-evaluated error, got: ${errMsg}`);
    });

    // ===================== Cấp Chứng Chỉ Hoàn Thành =====================

    await run('issue-certificate succeeds once all 3 stages are PASSED, and certificateIssued flips permanently', async () => {
      await page.evaluate((u) => { currentUser = u; }, hr); // trainingManage
      const result = await page.evaluate(async (pid) => callRecordAction('onboardingProgress', pid, 'issue-certificate', {}), progressId);
      const updated = result.item;
      assertEqual(updated.certificateIssued, true, 'certificateIssued should now be true');
      assertEqual(updated.certificateIssuedBy, 'hr.mai', 'certificateIssuedBy mismatch');
      assert(updated.certificateIssuedAt, 'certificateIssuedAt should be set');
      await page.evaluate((it) => { const idx = DB.onboardingProgress.findIndex((p) => p.id === it.id); DB.onboardingProgress[idx] = it; }, updated);

      // Cấp lần 2 phải bị chặn — permanently issued, không cấp lại được.
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'issue-certificate', {}); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('đã được cấp trước đó'), `expected an already-issued error, got: ${errMsg}`);
    });

    await run('an Admin (no trainingManage) can also issue certificates and evaluate Stage 3 anywhere (admin override)', async () => {
      // Kiểm tra riêng cờ admin bỏ qua mọi gác dept/trainingManage — dùng 1 hồ sơ MỚI (path đã ràng buộc
      // test1Id/test2Id có thật) để không đụng tới progressId đã cấp chứng chỉ ở trên.
      await page.evaluate((u) => { currentUser = u; }, hr);
      await page.evaluate((d) => { DB.users.find((u) => u.username === 'peer.it').startDate = d; }, isoDateDaysAgo(1));
      const second = await page.evaluate(async (pid) => {
        const r = await callCreateAction('onboardingProgress', { employeeUsername: 'peer.it', pathId: pid });
        DB.onboardingProgress.unshift(r.item);
        return r.item;
      }, pathId);
      await page.evaluate((u) => { currentUser = u; }, admin);
      const afterEval = await page.evaluate(async (id) => {
        // admin bỏ qua yêu cầu Đạt cả GĐ1/2 KHÔNG áp dụng — vẫn phải Đạt cả 2 trước (đây là điều kiện
        // trạng thái, không phải quyền hạn) nên kỳ vọng vẫn bị chặn ở đây.
        try { await callRecordAction('onboardingProgress', id, 'evaluate-stage3', { evaluation: 'PASSED' }); return null; }
        catch (err) { return err.message; }
      }, second.id);
      assert(afterEval && afterEval.includes('Đạt cả Giai đoạn 1 và Giai đoạn 2'), `admin should still be blocked by the stage1/2 precondition (state gate, not a permission gate), got: ${afterEval}`);
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-onboarding.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
