// tests/test-career-paths.js — Đào Tạo Đợt 7 (CUỐI, "Lộ Trình Thăng Tiến"): careerPaths giờ gồm NHIỀU
// CẤP BẬC tuần tự (stages[], thứ tự mảng = thứ tự cấp bậc), mỗi cấp có 1 danh sách CHƯƠNG TRÌNH
// (trainingCourses, requiredCourseIds) bắt buộc phải PASSED hết (ở BẤT KỲ lớp nào thuộc chương trình đó)
// mới đủ điều kiện "Xác nhận" cấp đó — VÀ chỉ xác nhận được cấp N sau khi cấp N-1 đã được xác nhận
// (careerPathConfirmations, uniqueness pathId+username+stageIndex). Đây là schema THAY THẾ HẲN
// requiredClassIds phẳng của các Đợt trước — không có bản ghi thật nào cần tương thích ngược (collection
// chưa từng phát hành cho người dùng thật).
//
// PHẠM VI: server thật không chạy được trong sandbox này (không có SQL Server) — mọi kịch bản dưới đây
// chạy qua _mock-backend.js (mirror CREATE_MODULE_CONFIGS.careerPaths.extraValidate ở
// lib/createValidation.js + confirmCareerPathForEmployee() ở lib/recordActions.js, xem
// __mockValidateCareerPathCreate()/__mockConfirmCareerPath() ở _mock-backend.js).
//
// Run: node server/tests/test-career-paths.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8996;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const hr = makeUser({ username: 'hr.mai', name: 'Trần Thị Mai', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } });
    const admin = makeUser({ username: 'admin.a', name: 'Quản Trị A', dept: 'Phòng Nhân Sự', perms: { admin: true } });
    // Nhân viên mục tiêu của lộ trình — jobTitle ban đầu 'Nhân viên', dùng để kiểm tra KHÔNG bị tự đổi.
    const staffIt = makeUser({ username: 'staff.it', name: 'Nhân Viên IT', dept: 'Phòng CNTT', jobTitle: 'Nhân viên', perms: {} });
    // Đồng nghiệp — dùng để kiểm tra gác quyền xác nhận (không có trainingManage) + lộ trình thứ 2 độc lập.
    const peerIt = makeUser({ username: 'peer.it', name: 'Đồng Nghiệp IT', dept: 'Phòng CNTT', jobTitle: 'Nhân viên', perms: {} });

    const seed = baseCatalogSeed();
    await page.evaluate((s) => { Object.assign(DB, s); }, seed);
    await page.evaluate((users) => { DB.users = users; }, [hr, admin, staffIt, peerIt]);
    await page.evaluate((u) => finishLogin(u), hr);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('PATHS'); });

    // ===================== careerPaths: quyền + validate (tạo) =====================

    await run('non-trainingManage cannot create careerPaths (server-side reject)', async () => {
      await page.evaluate((u) => { currentUser = u; }, peerIt);
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('careerPaths', { name: 'X', stages: [{ name: 'A', requiredCourseIds: [1] }] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không có quyền tạo lộ trình'), `expected a permission error, got: ${errMsg}`);
      await page.evaluate((u) => { currentUser = u; }, hr);
    });

    await run('missing name is rejected', async () => {
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('careerPaths', { stages: [{ name: 'A', requiredCourseIds: [1] }] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('Thiếu tên lộ trình'), `expected a missing-name error, got: ${errMsg}`);
    });

    await run('empty stages[] is rejected (need at least 1 cấp bậc)', async () => {
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('careerPaths', { name: 'Lộ Trình Rỗng', stages: [] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('ít nhất 1 cấp bậc'), `expected an empty-stages error, got: ${errMsg}`);
    });

    await run('a stage missing a name is rejected', async () => {
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('careerPaths', { name: 'Lộ Trình X', stages: [{ name: '', requiredCourseIds: [1] }] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('thiếu tên'), `expected a stage-missing-name error, got: ${errMsg}`);
    });

    await run('a stage with no requiredCourseIds is rejected', async () => {
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('careerPaths', { name: 'Lộ Trình Y', stages: [{ name: 'Trưởng nhóm', requiredCourseIds: [] }] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('cần chọn ít nhất 1 chương trình'), `expected a missing-course error, got: ${errMsg}`);
    });

    await run('a stage referencing a non-existent courseId is rejected', async () => {
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('careerPaths', { name: 'Lộ Trình Z', stages: [{ name: 'Trưởng nhóm', requiredCourseIds: [999999] }] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không hợp lệ'), `expected an invalid-course error, got: ${errMsg}`);
    });

    // ===================== Chuẩn bị dữ liệu: 2 Chương Trình + 3 Lớp Học =====================

    // Đợt 8 — mỗi lớp PHẢI gán bài test (setTrainingRegistrationResult() chặn chấm tay khi lớp có test,
    // confirmCareerPathForEmployee() chỉ tính "Đạt" khi c.testId != null) — 3 lớp dùng CHUNG 1 bài test 1
    // câu (đúng khuôn Ngân Hàng Câu Hỏi tái sử dụng nhiều lớp).
    let courseAId = null, courseBId = null, classA1Id = null, classA2Id = null, classBId = null;
    await run('seed 1 trainingTests + 2 trainingCourses + 3 trainingClasses (2 lớp cùng thuộc Chương Trình A, đều có gán bài test) to build stages against', async () => {
      const ids = await page.evaluate(async () => {
        const test = (await callCreateAction('trainingTests', {
          title: 'Test Chương Trình', category: '',
          questions: [{ text: 'Câu hỏi duy nhất', type: 'SINGLE', options: [{ text: 'Đáp án đúng' }, { text: 'Đáp án sai' }], correctOptionIds: [1] }]
        })).item;
        DB.trainingTests.push(test);
        const courseA = (await callCreateAction('trainingCourses', { name: 'Kỹ Năng Giao Tiếp', category: 'Kỹ năng mềm' })).item;
        const courseB = (await callCreateAction('trainingCourses', { name: 'Quản Lý Đội Nhóm', category: 'Nghiệp vụ' })).item;
        DB.trainingCourses.push(courseA, courseB);
        const mkClass = (title, courseId) => callCreateAction('trainingClasses', {
          category: 'Nghiệp vụ', title, startTime: '2026-01-10T08:00', courseId, testId: test.id, passScore: 60
        });
        const a1 = (await mkClass('Giao Tiếp - Lớp 1', courseA.id)).item;
        const a2 = (await mkClass('Giao Tiếp - Lớp 2', courseA.id)).item;
        const b1 = (await mkClass('Quản Lý Đội Nhóm - Lớp 1', courseB.id)).item;
        DB.trainingClasses.push(a1, a2, b1);
        return { courseA: courseA.id, courseB: courseB.id, a1: a1.id, a2: a2.id, b1: b1.id };
      });
      courseAId = ids.courseA; courseBId = ids.courseB; classA1Id = ids.a1; classA2Id = ids.a2; classBId = ids.b1;
    });

    // Đợt 8 — lớp CÓ gán bài test: đăng ký + tự làm bài qua ĐÚNG modal thật (openTakeTestModal/
    // ttTakeSelectOption/ttTakeGoNext), thay vì chấm tay (set-result giờ bị chặn khi lớp có testId).
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

    // ===================== Tạo lộ trình 2 cấp bậc qua ĐÚNG form thật (submitCareerPath) =====================

    let pathId = null;
    await run('trainingManage creates a 2-stage careerPath via the real stage-builder form (submitCareerPath/addCpStageRow)', async () => {
      await page.evaluate((ids) => {
        window.__alerts.length = 0;
        document.getElementById('cpName').value = 'Lộ Trình Vận Hành';
        document.getElementById('cpTargetTitle').value = 'Trưởng Phòng Vận Hành';
        document.getElementById('cpDescription').value = 'Lộ trình mẫu cho kiểm thử.';
        // renderTrainingLms() (do setTrainingLmsTab kích hoạt lúc đầu, TRƯỚC khi seed Chương Trình) đã tự
        // thêm sẵn 1 hàng rỗng qua populateCareerPathStageBuilder() nhưng options của nó rỗng tại thời
        // điểm đó — làm mới lại options (giờ đã có 2 Chương Trình thật) rồi mới thêm 1 hàng nữa cho đủ 2
        // cấp bậc.
        populateCareerPathStageBuilder();
        addCpStageRow();
        const rows = [...document.querySelectorAll('#cpStageBuilderContainer .cp-stage-row')];
        rows[0].querySelector('.cp-stage-name-input').value = 'Trưởng Nhóm';
        [...rows[0].querySelector('.cp-stage-course-select').options].forEach((o) => { o.selected = Number(o.value) === ids.courseA; });
        rows[1].querySelector('.cp-stage-name-input').value = 'Trưởng Phòng';
        [...rows[1].querySelector('.cp-stage-course-select').options].forEach((o) => { o.selected = Number(o.value) === ids.courseB; });
      }, { courseA: courseAId, courseB: courseBId });
      await page.evaluate(() => submitCareerPath({ preventDefault() {}, target: { reset() {} } }));
      const paths = await page.evaluate(() => DB.careerPaths);
      assertEqual(paths.length, 1, 'expected exactly 1 careerPath');
      pathId = paths[0].id;
      assertEqual(paths[0].stages.length, 2, 'expected 2 stages');
      assertEqual(paths[0].stages[0].name, 'Trưởng Nhóm', 'stage 0 name mismatch');
      assertEqual(paths[0].stages[0].requiredCourseIds[0], courseAId, 'stage 0 requiredCourseIds mismatch');
      assertEqual(paths[0].stages[1].name, 'Trưởng Phòng', 'stage 1 name mismatch');
      assertEqual(paths[0].stages[1].requiredCourseIds[0], courseBId, 'stage 1 requiredCourseIds mismatch');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đã tạo lộ trình thăng tiến')), `expected success alert, got ${JSON.stringify(alerts)}`);
    });

    await run('the stage builder resets to exactly 1 empty row after a successful submit (resetCareerPathForm)', async () => {
      const rowCount = await page.evaluate(() => document.querySelectorAll('#cpStageBuilderContainer .cp-stage-row').length);
      assertEqual(rowCount, 1, 'stage builder should reset back to exactly 1 empty row');
    });

    // ===================== Gác tuần tự + điều kiện Đạt theo TỪNG cấp =====================

    await run('confirming stage 1 (index 1) BEFORE stage 0 is confirmed is rejected regardless of course completion (sequential gate)', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('careerPaths', pid, 'confirm', { username: 'staff.it', stageIndex: 1 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, pathId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('chưa được xác nhận hoàn thành Cấp 1 trước đó'), `expected a sequential-order error, got: ${errMsg}`);
    });

    await run('confirming stage 0 fails while the required course (A) has no PASSED registration yet', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('careerPaths', pid, 'confirm', { username: 'staff.it', stageIndex: 0 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, pathId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('chưa đạt yêu cầu'), `expected a missing-course error, got: ${errMsg}`);
    });

    await run('a non-trainingManage user cannot confirm a stage (permission gate stays canManageTraining-only)', async () => {
      await page.evaluate((u) => { currentUser = u; }, peerIt);
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('careerPaths', pid, 'confirm', { username: 'staff.it', stageIndex: 0 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, pathId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không có quyền xác nhận'), `expected a permission error, got: ${errMsg}`);
      await page.evaluate((u) => { currentUser = u; }, hr);
    });

    await run('register staff.it into Class A1 (Chương Trình A) and pass its test', async () => {
      await page.evaluate((u) => { currentUser = u; }, staffIt);
      await registerAndPassClass(classA1Id);
      await page.evaluate((u) => { currentUser = u; }, hr);
      const reg = await page.evaluate((classId) => DB.trainingRegistrations.find((r) => r.classId === classId && r.creator === 'staff.it'), classA1Id);
      assertEqual(reg.result, 'PASSED', 'registration should be PASSED');
    });

    await run('confirming stage 0 now succeeds ("any class in the course" — staff.it passed Class A1, not A2, and that still counts for Chương Trình A)', async () => {
      const result = await page.evaluate(async (pid) => callRecordAction('careerPaths', pid, 'confirm', { username: 'staff.it', stageIndex: 0 }), pathId);
      const confirmation = result.confirmation;
      assertEqual(confirmation.pathId, pathId, 'confirmation.pathId mismatch');
      assertEqual(confirmation.stageIndex, 0, 'confirmation.stageIndex mismatch');
      assertEqual(confirmation.stageName, 'Trưởng Nhóm', 'confirmation.stageName mismatch');
      assertEqual(confirmation.username, 'staff.it', 'confirmation.username mismatch');
      assertEqual(confirmation.confirmedBy, 'hr.mai', 'confirmation.confirmedBy mismatch');
      await page.evaluate((c) => { DB.careerPathConfirmations.push(c); }, confirmation);
    });

    await run('confirming the SAME stage a second time is rejected (duplicate pathId+username+stageIndex)', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('careerPaths', pid, 'confirm', { username: 'staff.it', stageIndex: 0 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, pathId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('đã được xác nhận hoàn thành Cấp 1'), `expected a duplicate-confirmation error, got: ${errMsg}`);
    });

    await run('stage 1 is now sequentially unlocked but still fails on its own course requirement (Chương Trình B not passed yet)', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('careerPaths', pid, 'confirm', { username: 'staff.it', stageIndex: 1 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, pathId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('chưa đạt yêu cầu'), `expected a missing-course error (not a sequential-order error) for stage 1, got: ${errMsg}`);
    });

    await run('register staff.it into Class B1 (Chương Trình B) and pass its test, then confirming stage 1 succeeds', async () => {
      await page.evaluate((u) => { currentUser = u; }, staffIt);
      await registerAndPassClass(classBId);
      await page.evaluate((u) => { currentUser = u; }, hr);

      const result = await page.evaluate(async (pid) => callRecordAction('careerPaths', pid, 'confirm', { username: 'staff.it', stageIndex: 1 }), pathId);
      const confirmation = result.confirmation;
      assertEqual(confirmation.stageIndex, 1, 'confirmation.stageIndex mismatch');
      assertEqual(confirmation.stageName, 'Trưởng Phòng', 'confirmation.stageName mismatch');
      await page.evaluate((c) => { DB.careerPathConfirmations.push(c); }, confirmation);
    });

    await run('SAFETY: confirming stages never touches user.jobTitle (stays 100% manual via Quản Lý Người Dùng)', async () => {
      const jobTitle = await page.evaluate(() => DB.users.find((u) => u.username === 'staff.it').jobTitle);
      assertEqual(jobTitle, 'Nhân viên', 'jobTitle must remain exactly as it was before any confirmation — never auto-updated by this feature');
    });

    await run('an out-of-range stageIndex is rejected with a clear error', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('careerPaths', pid, 'confirm', { username: 'staff.it', stageIndex: 5 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, pathId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('Cấp bậc cần xác nhận không hợp lệ'), `expected an invalid-stageIndex error, got: ${errMsg}`);
    });

    await run('confirming for an unknown username is rejected (404)', async () => {
      let errMsg = null;
      await page.evaluate(async (pid) => {
        try { await callRecordAction('careerPaths', pid, 'confirm', { username: 'khong.ton.tai', stageIndex: 0 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, pathId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('Không tìm thấy nhân viên'), `expected a not-found error, got: ${errMsg}`);
    });

    // ===================== Hiển thị tuần tự phía client (renderCareerPaths/computeCareerPathStageStatuses) =====================

    await run('renderCareerPaths(): as staff.it (self), both confirmed stages render ✅ Đã xác nhận', async () => {
      await page.evaluate((u) => { currentUser = u; }, staffIt);
      const html = await page.evaluate(() => { renderCareerPaths(); return document.getElementById('careerPathsContainer').innerHTML; });
      assert(html.includes('✅ Cấp 1: Trưởng Nhóm — Đã xác nhận'), `expected stage 1 confirmed status, got: ${html}`);
      assert(html.includes('✅ Cấp 2: Trưởng Phòng — Đã xác nhận'), `expected stage 2 confirmed status, got: ${html}`);
      await page.evaluate((u) => { currentUser = u; }, hr);
    });

    await run('renderCareerPaths(): a fresh employee (peer.it) with NO confirmations yet sees stage 1 unlocked (🔓) and stage 2 locked (🔒)', async () => {
      await page.evaluate((u) => { currentUser = u; }, peerIt);
      const html = await page.evaluate(() => { renderCareerPaths(); return document.getElementById('careerPathsContainer').innerHTML; });
      assert(html.includes('🔓 Cấp 1: Trưởng Nhóm — Đang thực hiện — 0/1 chương trình đã hoàn thành'), `expected stage 1 in-progress status, got: ${html}`);
      assert(html.includes('🔒 Cấp 2: Trưởng Phòng — Chưa mở, cần hoàn thành Cấp 1 trước'), `expected stage 2 locked status, got: ${html}`);
      assert(!html.includes('cpConfirmUsername_'), 'a non-manage user must not see the manager confirm controls');
      await page.evaluate((u) => { currentUser = u; }, hr);
    });

    await run('renderCpEmployeeStageLookup(): once peer.it passes Chương Trình A, the manager sees the "Đủ điều kiện" suggestion badge scoped to stage 1, and confirming it via the real button handler succeeds', async () => {
      await page.evaluate((u) => { currentUser = u; }, peerIt);
      await registerAndPassClass(classA2Id);
      await page.evaluate((u) => { currentUser = u; }, hr);

      // Render lại thẻ lộ trình (đúng luồng thật: nhập username -> renderCpEmployeeStageLookup qua oninput).
      await page.evaluate((pid) => {
        renderCareerPaths();
        document.getElementById(`cpConfirmUsername_${pid}`).value = 'peer.it';
        renderCpEmployeeStageLookup(pid);
      }, pathId);
      const boxHTML = await page.evaluate((pid) => document.getElementById(`cpEmployeeStageBox_${pid}`).innerHTML, pathId);
      assert(boxHTML.includes('Đủ điều kiện — chờ xác nhận'), `expected the 100%-suggestion badge, got: ${boxHTML}`);
      assert(boxHTML.includes('Xác Nhận Cấp 1'), `expected a confirm button scoped to stage 1, got: ${boxHTML}`);

      // Bấm nút đúng như handler thật của nó (confirmCareerPathAction(pathId, stageIndex) đọc username từ input).
      const confirmation = await page.evaluate(async (pid) => {
        const result = await confirmCareerPathAction(pid, 0);
        return DB.careerPathConfirmations[0];
      }, pathId);
      assertEqual(confirmation.username, 'peer.it', 'confirmation username mismatch');
      assertEqual(confirmation.stageIndex, 0, 'confirmation stageIndex mismatch');
    });

    await run('MULTI-PATH: a second, independent 1-stage careerPath referencing the SAME course does not interfere with staff.it\'s existing confirmations on the first path', async () => {
      await page.evaluate((ids) => {
        document.getElementById('cpName').value = 'Lộ Trình Chuyên Viên';
        document.getElementById('cpTargetTitle').value = '';
        document.getElementById('cpDescription').value = '';
        const rows = [...document.querySelectorAll('#cpStageBuilderContainer .cp-stage-row')];
        rows[0].querySelector('.cp-stage-name-input').value = 'Chuyên Viên';
        [...rows[0].querySelector('.cp-stage-course-select').options].forEach((o) => { o.selected = Number(o.value) === ids.courseA; });
      }, { courseA: courseAId });
      await page.evaluate(() => submitCareerPath({ preventDefault() {}, target: { reset() {} } }));
      const paths = await page.evaluate(() => DB.careerPaths);
      assertEqual(paths.length, 2, 'expected 2 careerPaths total now');
      const secondPath = paths.find((p) => p.name === 'Lộ Trình Chuyên Viên');
      // staff.it đã Đạt Chương Trình A từ trước (dùng cho lộ trình 1) — xác nhận được NGAY trên lộ trình
      // MỚI này mà không hề bị chặn/trùng với confirmation đã có ở lộ trình đầu (khác pathId).
      const result = await page.evaluate((pid) => callRecordAction('careerPaths', pid, 'confirm', { username: 'staff.it', stageIndex: 0 }), secondPath.id);
      assertEqual(result.confirmation.pathId, secondPath.id, 'the new confirmation must belong to the SECOND path, not be confused with the first');
      await page.evaluate((c) => { DB.careerPathConfirmations.push(c); }, result.confirmation);
      const staffConfirmations = await page.evaluate(() => DB.careerPathConfirmations.filter((c) => c.username === 'staff.it'));
      assertEqual(staffConfirmations.length, 3, 'staff.it should now have 3 confirmations total across 2 different paths (2 on path 1 + 1 on path 2)');
    });

    await run('an Admin (no trainingManage) also passes the create-path permission gate (admin override)', async () => {
      await page.evaluate((u) => { currentUser = u; }, admin);
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('careerPaths', { name: 'Lộ Trình Admin', stages: [] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      // Vẫn bị chặn bởi ĐIỀU KIỆN DỮ LIỆU (thiếu stages) — không phải bởi quyền hạn (admin có quyền tạo).
      assert(errMsg && errMsg.includes('ít nhất 1 cấp bậc'), `admin should pass the permission gate and only hit the data-validation gate, got: ${errMsg}`);
    });

    await run('deleting a careerPath still works via the shared delete action', async () => {
      const beforeCount = await page.evaluate(() => DB.careerPaths.length);
      await page.evaluate((pid) => deleteCareerPath(pid), pathId);
      const afterCount = await page.evaluate(() => DB.careerPaths.length);
      assertEqual(afterCount, beforeCount - 1, 'expected the deleted path to be removed from DB.careerPaths');
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-career-paths.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
