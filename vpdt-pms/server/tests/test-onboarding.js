// tests/test-onboarding.js — Đào Tạo Tân Binh (onboardingPaths + onboardingProgress).
// Tách file riêng khỏi test-internal-training.js/test-training-plans.js/test-career-paths.js (cùng lý
// do các Đợt trước tách riêng: đây là 1 khối tính năng đủ lớn — catalog Lộ Trình + Phân Công + Giai đoạn
// 1/2 (Đợt 8: chọn CHƯƠNG TRÌNH HỌC bắt buộc, giống hệt careerPaths.stages[].requiredCourseIds — "Đạt"
// đến từ tự đăng ký + học lớp CÓ gán bài test, Nhân Sự xác nhận từng giai đoạn qua confirm-stage, KHÔNG
// còn là 1 bài test rời không gắn lớp học như trước Đợt 8) + đánh giá thủ công (Giai đoạn 3, gác theo
// dept, KHÔNG đổi) + cấp Chứng Chỉ Hoàn Thành PDF.
//
// PHẠM VI: server thật không chạy được trong sandbox này (không có SQL Server) — mọi kịch bản dưới đây
// chạy qua _mock-backend.js (mirror lib/createValidation.js CREATE_MODULE_CONFIGS.onboardingPaths/
// onboardingProgress + lib/recordActions.js confirmOnboardingStage/evaluateOnboardingStage3/
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

    // ===================== Chuẩn bị dữ liệu: 1 bài test + 2 Chương Trình + lớp học =====================

    // Đợt 8 — mỗi lớp PHẢI gán bài test (setTrainingRegistrationResult() chặn chấm tay khi lớp có test,
    // confirmOnboardingStage() chỉ tính "Đạt" khi c.testId != null) — dùng CHUNG 1 bài test 1 câu (đúng
    // khuôn Ngân Hàng Câu Hỏi tái sử dụng nhiều lớp, cùng tinh thần test-career-paths.js).
    let course1Id = null, course2Id = null, class1Id = null, class2Id = null;
    await run('seed 1 trainingTests + 2 trainingCourses + 2 trainingClasses (mỗi lớp gán 1 chương trình + bài test) to build stages against', async () => {
      const ids = await page.evaluate(async () => {
        const test = (await callCreateAction('trainingTests', {
          title: 'Test Chương Trình', category: '',
          questions: [{ text: 'Câu hỏi duy nhất', type: 'SINGLE', options: [{ text: 'Đáp án đúng' }, { text: 'Đáp án sai' }], correctOptionIds: [1] }]
        })).item;
        DB.trainingTests.push(test);
        const course1 = (await callCreateAction('trainingCourses', { name: 'Nội Quy Công Ty', category: 'Nghiệp vụ' })).item;
        const course2 = (await callCreateAction('trainingCourses', { name: 'Quy Trình Kho', category: 'Nghiệp vụ' })).item;
        DB.trainingCourses.push(course1, course2);
        const mkClass = (title, courseId) => callCreateAction('trainingClasses', {
          category: 'Nghiệp vụ', title, startTime: '2026-01-10T08:00', courseId, testId: test.id, passScore: 60
        });
        const c1 = (await mkClass('Nội Quy Công Ty - Lớp 1', course1.id)).item;
        const c2 = (await mkClass('Quy Trình Kho - Lớp 1', course2.id)).item;
        DB.trainingClasses.push(c1, c2);
        return { course1: course1.id, course2: course2.id, c1: c1.id, c2: c2.id };
      });
      course1Id = ids.course1; course2Id = ids.course2; class1Id = ids.c1; class2Id = ids.c2;
    });

    // Đăng ký + tự làm bài qua ĐÚNG modal thật (openTakeTestModal/ttTakeSelectOption/ttTakeGoNext) —
    // chấm tay (set-result) giờ bị chặn khi lớp có testId, cùng khuôn test-career-paths.js.
    async function registerAndPassClass(classId) {
      await page.evaluate((id) => registerForTrainingClass(id), classId);
      await page.evaluate((id) => openTakeTestModal(id), classId);
      await page.evaluate(async () => {
        const total = ttTakeQuestions.length;
        for (let i = 0; i < total; i++) {
          const q = ttTakeQuestions[ttTakeIndex];
          q.correctOptionIds.forEach((optId) => ttTakeSelectOption(optId, true));
          await ttTakeGoNext();
        }
      });
      await page.waitForFunction(() => document.getElementById('trainingTakeTestModal').classList.contains('hidden'));
    }

    await run('a stage missing requiredCourseIds is rejected server-side', async () => {
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('onboardingPaths', { name: 'Lộ Trình Thiếu Chương Trình', stage1RequiredCourseIds: [], stage2RequiredCourseIds: [1] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('chương trình học bắt buộc cho Giai đoạn 1'), `expected a missing-course error, got: ${errMsg}`);
    });

    let pathId = null;
    await run('trainingManage creates a full onboardingPaths entry via the real form (submitOnboardingPath)', async () => {
      await page.evaluate((ids) => {
        window.__alerts.length = 0;
        document.getElementById('opName').value = 'Lộ Trình Nhân Viên Kho';
        populateOnboardingPathSelects();
        [...document.getElementById('opStage1RequiredCourseIds').options].forEach((o) => { o.selected = Number(o.value) === ids.course1; });
        [...document.getElementById('opStage2RequiredCourseIds').options].forEach((o) => { o.selected = Number(o.value) === ids.course2; });
        document.getElementById('opStage3Criteria').value = 'Thái độ làm việc, tuân thủ quy trình kho.';
      }, { course1: course1Id, course2: course2Id });
      await page.evaluate(() => submitOnboardingPath({ preventDefault() {}, target: { reset() {} } }));
      const paths = await page.evaluate(() => DB.onboardingPaths);
      assertEqual(paths.length, 1, 'expected exactly 1 onboarding path');
      pathId = paths[0].id;
      assertEqual(paths[0].stage1RequiredCourseIds[0], course1Id, 'stage1RequiredCourseIds mismatch');
      assertEqual(paths[0].stage2RequiredCourseIds[0], course2Id, 'stage2RequiredCourseIds mismatch');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đã tạo lộ trình đào tạo tân binh')), `expected success alert, got ${JSON.stringify(alerts)}`);
    });

    await run('editing the path in place (Sửa) preserves unrelated fields', async () => {
      await page.evaluate((id) => openEditOnboardingPath(id), pathId);
      await page.evaluate(() => { document.getElementById('opStage3Criteria').value = 'Tiêu chí đã cập nhật.'; });
      await page.evaluate(() => submitOnboardingPath({ preventDefault() {}, target: { reset() {} } }));
      const path = await page.evaluate((id) => DB.onboardingPaths.find((p) => p.id === id), pathId);
      assertEqual(path.stage3Criteria, 'Tiêu chí đã cập nhật.', 'stage3Criteria should be updated');
      assertEqual(path.stage1RequiredCourseIds[0], course1Id, 'unrelated field (stage1RequiredCourseIds) should be preserved after a partial edit');
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
          day60: computeOnboardingMilestones({ startDate: mk(60), stage1Result: 'CONFIRMED', stage2Result: 'CONFIRMED', stage3Evaluation: null }) // qua mốc 59, GĐ3 quá hạn
        };
      });
      assertEqual(cases.day0.stage1.status.key, 'NOT_DUE', 'day0: Giai đoạn 1 chưa đến hạn');
      assertEqual(cases.day6.stage1.status.key, 'DUE_SOON', 'day6 (còn 1 ngày của hạn 7): Giai đoạn 1 phải Sắp đến hạn');
      assertEqual(cases.day8.stage1.status.key, 'OVERDUE', 'day8: Giai đoạn 1 (hạn 7 ngày) phải Quá hạn');
      assertEqual(cases.day8.stage2.status.key, 'NOT_DUE', 'day8: Giai đoạn 2 (hạn 21 ngày) chưa tới hạn');
      assertEqual(cases.day60.stage1.status.key, 'DONE', 'day60: Giai đoạn 1 đã được xác nhận -> Hoàn thành bất kể ngày');
      assertEqual(cases.day60.stage3.status.key, 'OVERDUE', 'day60 (quá mốc 59): Giai đoạn 3 chưa đánh giá phải Quá hạn');
    });

    // ===================== Đánh giá Giai đoạn 3 bị chặn khi GĐ1/2 CHƯA được xác nhận cả 2 =====================

    await run('evaluate-stage3 is blocked while Stage 1/2 are not both CONFIRMED yet (even for the correct-dept evaluator)', async () => {
      await page.evaluate((u) => { currentUser = u; }, mgrIt);
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'evaluate-stage3', { evaluation: 'PASSED' }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('xác nhận hoàn thành cả Giai đoạn 1 và Giai đoạn 2'), `expected a stage1/2-precondition error, got: ${errMsg}`);
      await page.evaluate((u) => { currentUser = u; }, hr);
    });

    // ===================== Luồng tân binh: học lớp GĐ1 -> Đạt -> HR xác nhận -> mở khoá GĐ2 -> Đạt -> xác nhận =====================

    await run('confirm-stage is blocked while the required course (Nội Quy Công Ty) has no PASSED registration yet', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'confirm-stage', { stage: 1 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('chưa đạt yêu cầu'), `expected a missing-course error, got: ${errMsg}`);
    });

    await run('confirm-stage for Stage 2 before Stage 1 is confirmed is rejected regardless of course completion (sequential gate)', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'confirm-stage', { stage: 2 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('Cần xác nhận hoàn thành Giai đoạn 1 trước'), `expected a sequential-order error, got: ${errMsg}`);
    });

    await run('a non-trainingManage user cannot confirm a stage (permission gate stays canManageTraining-only)', async () => {
      await page.evaluate((u) => { currentUser = u; }, peerIt);
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'confirm-stage', { stage: 1 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không có quyền xác nhận'), `expected a permission error, got: ${errMsg}`);
      await page.evaluate((u) => { currentUser = u; }, hr);
    });

    await run('staff.it registers for + passes the Stage 1 class (Nội Quy Công Ty) via the real test-taking modal', async () => {
      await page.evaluate((u) => { currentUser = u; }, staffIt);
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('CLASSES'); });
      await registerAndPassClass(class1Id);
      const reg = await page.evaluate((cid) => DB.trainingRegistrations.find((r) => r.classId === cid && r.creator === 'staff.it'), class1Id);
      assertEqual(reg.result, 'PASSED', 'registration should be PASSED');
      await page.evaluate((u) => { currentUser = u; }, hr);
    });

    await run('HR confirms Stage 1 now that the required course is PASSED, unlocking Stage 2', async () => {
      const result = await page.evaluate(async (pid) => callRecordAction('onboardingProgress', pid, 'confirm-stage', { stage: 1 }), progressId);
      const updated = result.item;
      assertEqual(updated.stage1Result, 'CONFIRMED', 'stage1Result should be CONFIRMED');
      assertEqual(updated.stage1ConfirmedBy, 'hr.mai', 'stage1ConfirmedBy mismatch');
      assert(updated.stage1ConfirmedAt, 'stage1ConfirmedAt should be set');
      await page.evaluate((it) => { const idx = DB.onboardingProgress.findIndex((p) => p.id === it.id); DB.onboardingProgress[idx] = it; }, updated);
    });

    await run('a stage already CONFIRMED cannot be confirmed again', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'confirm-stage', { stage: 1 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('đã được xác nhận hoàn thành từ trước'), `expected an already-confirmed error, got: ${errMsg}`);
    });

    await run('Stage 2 confirm still fails on its own course requirement (Quy Trình Kho not passed yet)', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'confirm-stage', { stage: 2 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('chưa đạt yêu cầu'), `expected a missing-course error (not a sequential-order error) for stage 2, got: ${errMsg}`);
    });

    await run('staff.it passes the Stage 2 class (Quy Trình Kho), then HR confirms Stage 2', async () => {
      await page.evaluate((u) => { currentUser = u; }, staffIt);
      await registerAndPassClass(class2Id);
      await page.evaluate((u) => { currentUser = u; }, hr);

      const result = await page.evaluate(async (pid) => callRecordAction('onboardingProgress', pid, 'confirm-stage', { stage: 2 }), progressId);
      const updated = result.item;
      assertEqual(updated.stage2Result, 'CONFIRMED', 'stage2Result should be CONFIRMED');
      assertEqual(updated.stage2ConfirmedBy, 'hr.mai', 'stage2ConfirmedBy mismatch');
      await page.evaluate((it) => { const idx = DB.onboardingProgress.findIndex((p) => p.id === it.id); DB.onboardingProgress[idx] = it; }, updated);
    });

    // ===================== Chứng chỉ bị chặn trước khi đủ 3 giai đoạn hoàn thành =====================

    await run('issue-certificate is blocked before Stage 3 has been evaluated (only 2 of 3 stages done so far)', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'issue-certificate', {}); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('chưa hoàn thành cả 3 giai đoạn'), `expected a not-all-3-done error, got: ${errMsg}`);
      await page.evaluate((u) => { currentUser = u; }, admin); // admin thử luôn cũng phải bị chặn như nhau (gác theo trạng thái, không theo quyền ở bước này)
      await page.evaluate(async (pid) => {
        try { await callRecordAction('onboardingProgress', pid, 'issue-certificate', {}); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, progressId);
      const errMsg2 = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg2 && errMsg2.includes('chưa hoàn thành cả 3 giai đoạn'), `expected the same not-all-3-done error for admin, got: ${errMsg2}`);
      await page.evaluate((u) => { currentUser = u; }, hr);
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

    await run('issue-certificate succeeds once all 3 stages are done, and certificateIssued flips permanently', async () => {
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
      // Kiểm tra riêng cờ admin bỏ qua mọi gác dept/trainingManage — dùng 1 hồ sơ MỚI để không đụng tới
      // progressId đã cấp chứng chỉ ở trên.
      await page.evaluate((u) => { currentUser = u; }, hr);
      await page.evaluate((d) => { DB.users.find((u) => u.username === 'peer.it').startDate = d; }, isoDateDaysAgo(1));
      const second = await page.evaluate(async (pid) => {
        const r = await callCreateAction('onboardingProgress', { employeeUsername: 'peer.it', pathId: pid });
        DB.onboardingProgress.unshift(r.item);
        return r.item;
      }, pathId);
      await page.evaluate((u) => { currentUser = u; }, admin);
      const afterEval = await page.evaluate(async (id) => {
        // admin bỏ qua yêu cầu xác nhận cả GĐ1/2 KHÔNG áp dụng — vẫn phải xác nhận cả 2 trước (đây là
        // điều kiện trạng thái, không phải quyền hạn) nên kỳ vọng vẫn bị chặn ở đây.
        try { await callRecordAction('onboardingProgress', id, 'evaluate-stage3', { evaluation: 'PASSED' }); return null; }
        catch (err) { return err.message; }
      }, second.id);
      assert(afterEval && afterEval.includes('xác nhận hoàn thành cả Giai đoạn 1 và Giai đoạn 2'), `admin should still be blocked by the stage1/2 precondition (state gate, not a permission gate), got: ${afterEval}`);
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
