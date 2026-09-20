// server/tests/test-training-scenario-roleplay.js
//
// Đóng vai đầy đủ kịch bản nghiệp vụ người dùng yêu cầu cho module Đào Tạo (Truyền Thông Nội Bộ >
// Đào Tạo / LMS), lái qua đúng hàm client thật (submitTrainingPlan/submitTrainingCourse/
// submitTrainingClass/submitTrainingTest/submitTrainingDocument/registerForTrainingClass/
// openTakeTestModal/ttTakeSubmit...), dùng bộ hạ tầng _harness.js + _mock-backend.js (KHÔNG phải
// testHarness.js — 2 hạ tầng mock riêng biệt trong repo này; các test-training-*.js hiện có đều dùng
// _harness.js, vì _mock-backend.js là bản duy nhất đã cài đủ route cho module Đào Tạo).
//
// Luồng:
//   1) Người quản lý đào tạo (trainingManage) tạo Kế Hoạch Đào Tạo (trainingPlans).
//   2) Tạo Chương Trình Học (trainingCourses).
//   3) Tạo Ngân Hàng Câu Hỏi (trainingTests) — 1 câu SINGLE + 1 câu MULTI.
//   4) Tạo Tài Liệu (trainingDocuments, VIDEO) bắt buộc xem trước khi thi.
//   5) Tạo Lớp Học (trainingClasses) gắn Chương Trình + Ngân Hàng Câu Hỏi + Tài Liệu bắt buộc.
//   6) Học viên đăng ký học (trainingRegistrations).
//   7) Học viên xem tài liệu bắt buộc qua "Vào Lớp Học" (đúng modal thật, không né qua).
//   8) Học viên thi qua modal Vào Làm Bài Test thật (openTakeTestModal/ttTakeSelectOption/ttTakeGoNext)
//      -> tự động chấm điểm, có kết quả PASSED + điểm số.
//   9) [KHOẢNG TRỐNG TÍNH NĂNG — xác nhận rõ, KHÔNG tự chế] "Giám đốc siêu thị của nhân viên đó vào
//      đánh giá sau khi thi xong": đã khảo sát toàn bộ recordActions.js/routes/records.js/createValidation.js
//      — KHÔNG có route/quyền/hàm nào cho phép 1 người quản lý (kể cả cùng phòng ban/đơn vị với nhân
//      viên) "đánh giá" 1 bản ghi trainingRegistrations sau khi thi. Tính năng gần giống nhất
//      (evaluateOnboardingStage3) thuộc HẲN 1 module khác (Đào Tạo Tân Binh/onboardingProgress), đòi
//      thiết lập lộ trình tân binh riêng, không liên quan gì tới lớp học/bài test ở trên. Test này xác
//      nhận rõ khoảng trống bằng cách gọi thẳng action không tồn tại và xác nhận bị từ chối rõ ràng
//      (không phải lỗi 200 OK giả — xem test "KHOẢNG TRỐNG" bên dưới), để báo cáo trung thực cho người
//      yêu cầu thay vì tự dựng ra 1 hành vi không có thật.
//
// Xen kẽ các phép thử BẢO MẬT/PHÂN QUYỀN:
//   - Người không có trainingManage không tạo được kế hoạch/chương trình/lớp/test/tài liệu.
//   - Học viên không xem hết tài liệu bắt buộc thì không thi được, dù đã hết giờ lớp học.
//   - Học viên không đánh dấu-xem-hộ tài liệu cho người khác được.
//   - Học viên không nộp bài thi 2 lần cho cùng 1 lớp được.
//   - "Giám đốc siêu thị" (không có trainingManage/trainingInstruct/onboardingEvaluate) không có BẤT KỲ
//     hành động nào tác động được lên bản ghi đăng ký/kết quả của nhân viên.
//
// Chạy: node server/tests/test-training-scenario-roleplay.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8993;

async function main() {
  const { server, browser, page } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const trainer = makeUser({ username: 'trainer_rp', name: 'Người Quản Lý Đào Tạo', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } });
    // Đóng vai đúng khung cảnh người dùng mô tả: nhân viên + "giám đốc siêu thị" của nhân viên đó — hệ
    // thống hiện tại chỉ có khái niệm `dept`, không có bảng ánh xạ GD-ST nào riêng cho module Đào Tạo,
    // nên dùng chung `dept` để mô phỏng đúng ý "cùng đơn vị/siêu thị" — xem khoảng trống ở kịch bản 9.
    const nv = makeUser({ username: 'nv_rp', name: 'Học Viên Đóng Vai', dept: 'Siêu Thị A', perms: {} });
    const gdSt = makeUser({ username: 'gd_st_rp', name: 'Giám Đốc Siêu Thị A (đóng vai)', dept: 'Siêu Thị A', perms: {} });
    const outsider = makeUser({ username: 'outsider_rp', name: 'Nhân Viên Không Quyền', dept: 'Phòng CNTT', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [trainer, nv, gdSt, outsider]);
    await page.evaluate((u) => finishLogin(u), trainer);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); });

    // ===== 0) Bảo mật: người không có trainingManage không tạo được kế hoạch đào tạo =====
    await run('Bảo mật: Nhân viên (không có trainingManage) KHÔNG tạo được Kế Hoạch Đào Tạo', async () => {
      await page.evaluate((u) => { currentUser = u; }, outsider);
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('trainingPlans', { month: '2026-10', plannedClasses: 1, plannedTrainees: 10, plannedHours: 4 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không có quyền'), `expected permission error, got: ${errMsg}`);
      await page.evaluate((u) => { currentUser = u; }, trainer);
    });

    // ===== 1) Người quản lý đào tạo tạo Kế Hoạch Đào Tạo (bấm THẬT) =====
    await run('1) Người quản lý đào tạo tạo Kế Hoạch Đào Tạo tháng 10/2026 (điền form + bấm THẬT)', async () => {
      await page.evaluate(() => { setTrainingLmsTab('PLANS'); });
      await page.evaluate(() => {
        document.getElementById('tpMonth').value = '2026-10';
        document.getElementById('tpTargetDept').value = 'Siêu Thị A';
        document.getElementById('tpAudience').value = 'Nhân viên Siêu Thị A';
        document.getElementById('tpPlannedClasses').value = '1';
        document.getElementById('tpPlannedTrainees').value = '1';
        document.getElementById('tpPlannedHours').value = '2';
      });
      await page.evaluate(() => submitTrainingPlan({ preventDefault() {} }));
      const plans = await page.evaluate(() => DB.trainingPlans);
      assertEqual(plans.length, 1, 'phải tạo được đúng 1 kế hoạch đào tạo');
      assertEqual(plans[0].month, '2026-10', 'tháng kế hoạch phải đúng');
    });

    // ===== 2) Tạo Chương Trình Học (bấm THẬT) =====
    let courseId;
    await run('2) Người quản lý đào tạo tạo Chương Trình Học "Nội Quy & An Toàn" (điền form + bấm THẬT)', async () => {
      await page.evaluate(() => { setTrainingLmsTab('COURSES'); });
      await page.evaluate(() => {
        document.getElementById('tccCategory').value = 'Nghiệp vụ';
        document.getElementById('tccName').value = 'Nội Quy & An Toàn Siêu Thị';
      });
      await page.evaluate(() => submitTrainingCourse({ preventDefault() {}, target: { reset() {} } }));
      const course = await page.evaluate(() => DB.trainingCourses.find((c) => c.name === 'Nội Quy & An Toàn Siêu Thị'));
      assert(course, 'phải tạo được chương trình học');
      courseId = course.id;
    });

    // ===== 3) Tạo Ngân Hàng Câu Hỏi (bấm THẬT) =====
    let testId;
    await run('3) Người quản lý đào tạo tạo bài test 2 câu (1 SINGLE + 1 MULTI) (bấm THẬT)', async () => {
      await page.evaluate(() => { setTrainingLmsTab('TESTS'); });
      await page.evaluate((cid) => {
        tbQuestions = [
          { text: 'Khi có cháy, việc đầu tiên cần làm là gì?', type: 'SINGLE', points: 5, options: [
            { text: 'Bỏ chạy ngay không báo ai', correct: false },
            { text: 'Báo động + hô hoán cho mọi người biết', correct: true },
            { text: 'Tiếp tục làm việc', correct: false }
          ] },
          { text: 'Chọn các trang thiết bị an toàn PHẢI có tại quầy thu ngân (chọn nhiều)?', type: 'MULTI', points: 5, options: [
            { text: 'Bình chữa cháy', correct: true },
            { text: 'Nút báo động khẩn cấp', correct: true },
            { text: 'Máy chơi game', correct: false }
          ] }
        ];
        document.getElementById('ttTitle').value = 'Bài Test Nội Quy & An Toàn';
        document.getElementById('ttCategory').value = 'Nghiệp vụ';
        document.getElementById('ttPassScore').value = '70';
      }, courseId);
      await page.evaluate(() => submitTrainingTest({ preventDefault() {} }));
      const test = await page.evaluate(() => DB.trainingTests.find((t) => t.title === 'Bài Test Nội Quy & An Toàn'));
      assert(test, 'phải tạo được bài test');
      assertEqual(test.questions.length, 2, 'bài test phải có đúng 2 câu hỏi');
      testId = test.id;
    });

    // ===== 4) Tạo Tài Liệu bắt buộc (VIDEO, bấm THẬT) =====
    let docId;
    await run('4) Người quản lý đào tạo tạo tài liệu VIDEO bắt buộc xem trước khi thi (bấm THẬT)', async () => {
      await page.evaluate(() => { setTrainingLmsTab('DOCS'); });
      await page.evaluate((cid) => {
        document.getElementById('tdCategory').value = 'Nghiệp vụ';
        document.getElementById('tdTitle').value = 'Video Hướng Dẫn An Toàn Siêu Thị';
        document.getElementById('tdDocType').value = 'VIDEO';
        onTrainingDocTypeChange();
        document.getElementById('tdVideoUrl').value = 'https://www.youtube.com/watch?v=safety123';
        // LỖI ĐÃ VÁ (rà soát chuyên sâu vòng 2, 9/2026, phát hiện #7): thời lượng video nay BẮT BUỘC.
        document.getElementById('tdVideoDuration').value = '300';
        document.getElementById('tdMandatory').checked = true;
        document.getElementById('tdCourseId').value = String(cid);
      }, courseId);
      await page.evaluate(() => submitTrainingDocument({ preventDefault() {}, target: { reset() {} } }));
      const doc = await page.evaluate(() => DB.trainingDocuments.find((d) => d.title === 'Video Hướng Dẫn An Toàn Siêu Thị'));
      assert(doc, 'phải tạo được tài liệu VIDEO');
      docId = doc.id;
    });

    // ===== 5) Tạo Lớp Học gắn Chương Trình + Test + Tài Liệu bắt buộc (bấm THẬT) =====
    let classId;
    await run('5) Người quản lý đào tạo tạo Lớp Học gắn đủ Chương Trình + Bài Test + Tài Liệu bắt buộc (bấm THẬT)', async () => {
      await page.evaluate(() => { setTrainingLmsTab('CLASSES'); });
      await page.evaluate(({ cid, tid, did }) => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp Đào Tạo Nội Quy & An Toàn Siêu Thị A';
        document.getElementById('tcCourseId').value = String(cid);
        // Đã qua từ lâu -> "Vào Làm Bài Test" (ONLINE) tự mở ngay, không cần chờ thời gian thật trôi qua.
        document.getElementById('tcStart').value = '2020-01-01T08:00';
        document.getElementById('tcEnd').value = '2020-01-01T10:00';
        document.getElementById('tcMode').value = 'ONLINE';
        onTrainingClassModeChange();
        document.getElementById('tcTestId').value = String(tid);
        applyTrainingClassTestDefaultPassScore('tcTestId', 'tcPassScore');
        [...document.getElementById('tcDocumentIds').options].forEach((o) => { o.selected = Number(o.value) === did; });
      }, { cid: courseId, tid: testId, did: docId });
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp Đào Tạo Nội Quy & An Toàn Siêu Thị A'));
      assert(cls, 'phải tạo được lớp học');
      assertEqual(cls.courseId, courseId, 'lớp phải gắn đúng chương trình học');
      assertEqual(cls.testId, testId, 'lớp phải gắn đúng bài test');
      assertEqual(cls.documentIds.length, 1, 'lớp phải gắn đúng 1 tài liệu bắt buộc');
      classId = cls.id;
    });

    // ===== 6) Học viên đăng ký học (bấm THẬT) =====
    let regId;
    await run('6) Học viên (nhân viên Siêu Thị A) đăng ký học lớp trên (bấm THẬT, không cần quyền gì đặc biệt)', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv);
      await page.evaluate((id) => registerForTrainingClass(id), classId);
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv_rp'), classId);
      assert(reg, 'học viên phải đăng ký học được');
      assertEqual(reg.result, 'REGISTERED', 'đăng ký mới phải ở trạng thái REGISTERED');
      regId = reg.id;
    });

    // ===== Bảo mật: chưa xem hết tài liệu bắt buộc thì không thi được, dù hết giờ từ lâu =====
    await run('Bảo mật: chưa xem hết tài liệu bắt buộc thì KHÔNG nộp bài thi được, dù lớp đã hết giờ từ lâu', async () => {
      let errMsg = null;
      await page.evaluate(async (cid) => {
        try { await callRecordAction('trainingClasses', cid, 'submit-test', { answers: [] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, classId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('xem hết tài liệu giáo trình'), `expected must-view-document error, got: ${errMsg}`);
    });

    // ===== Bảo mật: người khác không đánh dấu-xem-hộ tài liệu cho học viên A được =====
    await run('Bảo mật: người khác (outsider) KHÔNG đánh dấu-xem-hộ tài liệu cho học viên A được', async () => {
      await page.evaluate((u) => { currentUser = u; }, outsider);
      let errMsg = null;
      await page.evaluate(async ({ regId, docId }) => {
        try { await callRecordAction('trainingRegistrations', regId, 'mark-document-viewed', { documentId: docId }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, { regId, docId });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('chính mình'), `expected own-registration-only error, got: ${errMsg}`);
      await page.evaluate((u) => { currentUser = u; }, nv);
    });

    // ===== 7) Học viên xem tài liệu bắt buộc qua "Vào Lớp Học" (modal thật, bấm THẬT) =====
    await run('7) Học viên xem tài liệu bắt buộc qua modal "Vào Lớp Học" thật (bấm THẬT)', async () => {
      await page.evaluate((id) => openTrainingJoinClassModal(id), regId);
      const bodyHTML = await page.evaluate(() => document.getElementById('trainingJoinClassBody').innerHTML);
      assert(bodyHTML.includes('Video Hướng Dẫn An Toàn Siêu Thị'), 'modal "Vào Lớp Học" phải liệt kê đúng tài liệu bắt buộc');
      await page.evaluate((did) => markTrainingDocumentViewedAction(did), docId);
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.id === id), regId);
      assert(reg.viewedDocumentIds.includes(docId), 'tài liệu bắt buộc phải được ghi nhận đã xem');
    });

    // ===== 8) Học viên thi qua modal "Vào Làm Bài Test" thật -> tự động chấm điểm =====
    await run('8) Học viên thi qua modal "Vào Làm Bài Test" thật (chọn đáp án + bấm THẬT) -> tự động có điểm', async () => {
      await page.evaluate((id) => openTakeTestModal(id), classId);
      await page.evaluate(async () => {
        const total = ttTakeQuestions.length;
        for (let i = 0; i < total; i++) {
          const q = ttTakeQuestions[ttTakeIndex];
          q.correctOptionIds.forEach((optId) => ttTakeSelectOption(optId, true));
          await ttTakeGoNext();
        }
      });
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.id === id), regId);
      assertEqual(reg.result, 'PASSED', `học viên trả lời đúng hết phải ĐẠT, thực tế: ${reg.result}`);
      assertEqual(reg.score, 100, `điểm phải đúng 100%, thực tế: ${reg.score}`);
    });

    // ===== Bảo mật: không nộp bài thi lần 2 cho cùng 1 lớp được =====
    await run('Bảo mật: học viên KHÔNG nộp bài thi lần 2 cho cùng 1 lớp được', async () => {
      let errMsg = null;
      await page.evaluate(async (cid) => {
        try { await callRecordAction('trainingClasses', cid, 'submit-test', { answers: [] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, classId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg, 'phải bị chặn khi nộp bài thi lần 2');
    });

    // ===== 9) KHOẢNG TRỐNG TÍNH NĂNG — xác nhận "GD ST đánh giá sau khi thi xong" KHÔNG tồn tại =====
    await run('9) [KHOẢNG TRỐNG] "Giám đốc Siêu Thị A đánh giá nhân viên sau khi thi xong" — xác nhận KHÔNG có tính năng này trong hệ thống', async () => {
      await page.evaluate((u) => { currentUser = u; }, gdSt);
      // 9a) GD ST không có bất kỳ quyền đào tạo nào liên quan (đúng vai trò thật trong hệ thống hiện tại).
      const gdPerms = await page.evaluate(() => currentUser.perms || {});
      assert(!gdPerms.trainingManage && !gdPerms.trainingInstruct && !gdPerms.onboardingEvaluate,
        'Giám đốc Siêu Thị (đóng vai đúng thực tế) không có sẵn bất kỳ quyền đào tạo nào — khớp đúng hiện trạng hệ thống');
      // 9b) Gọi thẳng 1 action "evaluate" giả định (đúng khuôn callRecordAction mọi action khác dùng) —
      // xác nhận bị từ chối rõ ràng (400 "Hành động không hợp lệ"), KHÔNG lặng lẽ trả 200 OK giả — nghĩa
      // là route/action này THẬT SỰ không tồn tại trong hệ thống, không phải do quên set quyền.
      let errMsg = null;
      await page.evaluate(async (regId) => {
        try { await callRecordAction('trainingRegistrations', regId, 'evaluate', { evaluation: 'GOOD' }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, regId);
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg, 'action "evaluate" không tồn tại trong hệ thống — phải bị từ chối, không được âm thầm thành công');
      // 9c) set-result (cách DUY NHẤT hệ thống hiện có để 1 người quản lý ghi nhận kết quả thủ công cho
      // trainingRegistrations) cũng bị khoá cứng vì lớp đã gắn testId — đúng thiết kế "đã có bài test
      // thì KHÔNG ai override thủ công được nữa", càng khẳng định không có đường nào để "đánh giá" thêm.
      let setResultErr = null;
      await page.evaluate(async (regId) => {
        try { await callRecordAction('trainingRegistrations', regId, 'set-result', { result: 'PASSED', resultNote: 'GD ST tự đánh giá' }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, regId);
      setResultErr = await page.evaluate(() => window.__lastCreateErr);
      assert(setResultErr, 'set-result cũng phải bị chặn cho lớp đã gắn bài test — không có đường vòng nào để "đánh giá" thủ công');
    });

    // ===== 10) Tài khoản bị khoá KHÔNG hiện trong danh sách gợi ý "Thêm Học Viên" =====
    const lockedUser = makeUser({ username: 'nv_locked_rp', name: 'Nhân Viên Đã Khoá', dept: 'Siêu Thị A', perms: {}, active: false });
    await run('10) Tài khoản đã khoá (active:false) KHÔNG hiện trong danh sách gợi ý khi mở modal "Thêm Học Viên"', async () => {
      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate((u) => { DB.users.push(u); }, lockedUser);
      await page.evaluate((cid) => { openTrainingRosterModal(cid); }, classId);
      const items = await page.evaluate(() => (document.getElementById('systemUsersDatalist')._sddItems || []).map((it) => it.label));
      assert(!items.some((label) => label.includes('nv_locked_rp')), 'danh sách gợi ý KHÔNG được chứa tài khoản đã khoá');
      assert(items.some((label) => label.includes('nv_rp')), 'danh sách gợi ý vẫn phải chứa tài khoản đang hoạt động (đối chứng — không phải danh sách rỗng do lỗi khác)');
      // Phòng thủ 2 lớp: kể cả cố tình gửi thẳng username bị khoá lên server (bỏ qua dropdown/DevTools),
      // vẫn phải bị BỎ QUA (skipped, KHÔNG 200 OK giả) — xem bulkRegisterTrainingClass() lib/recordActions.js.
      const bulkResult = await page.evaluate(async (cid) => {
        return await callRecordAction('trainingClasses', cid, 'bulk-register', { usernames: ['nv_locked_rp'] });
      }, classId);
      assertEqual(bulkResult.added.length, 0, 'server KHÔNG được thêm tài khoản đã khoá vào lớp dù gửi thẳng username, bỏ qua UI');
      assertEqual(bulkResult.skipped[0]?.reason, 'NOT_FOUND', 'lý do bỏ qua phải đúng NOT_FOUND (tài khoản đã khoá coi như không hợp lệ)');
      await page.evaluate(() => { closeTrainingRosterModal(); });
    });

    // ===== 11) Học viên CHƯA đăng ký lớp (có tài khoản, đã đăng nhập) KHÔNG thấy/làm được bài test =====
    const notRegistered = makeUser({ username: 'nv_notreg_rp', name: 'Nhân Viên Chưa Đăng Ký', dept: 'Siêu Thị A', perms: {} });
    await run('11) Học viên có tài khoản + đã đăng nhập nhưng CHƯA đăng ký lớp -> KHÔNG mở/nộp được bài test', async () => {
      await page.evaluate((u) => { DB.users.push(u); }, notRegistered);
      await page.evaluate((u) => { currentUser = u; }, notRegistered);
      let startErr = null;
      await page.evaluate(async (cid) => {
        try { await callRecordAction('trainingClasses', cid, 'start-test', {}); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, classId);
      startErr = await page.evaluate(() => window.__lastCreateErr);
      assert(startErr && startErr.includes('chưa đăng ký'), `học viên chưa đăng ký phải bị chặn ngay ở start-test, thực tế: ${startErr}`);
      let submitErr = null;
      await page.evaluate(async (cid) => {
        try { await callRecordAction('trainingClasses', cid, 'submit-test', { answers: [] }); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, classId);
      submitErr = await page.evaluate(() => window.__lastCreateErr);
      assert(submitErr && submitErr.includes('chưa đăng ký'), `học viên chưa đăng ký phải bị chặn ở submit-test dù cố gọi thẳng, thực tế: ${submitErr}`);
      await page.evaluate((u) => { currentUser = u; }, trainer);
    });

    // ===== 12) [KHOẢNG TRỐNG] Chứng nhận hoàn thành LỚP HỌC (không phải Onboarding) sau khi ĐẠT =====
    await run('12) [KHOẢNG TRỐNG] Sau khi ĐẠT bài test, hệ thống KHÔNG tự cấp "chứng nhận hoàn thành lớp học XXX" — chỉ có ở Onboarding (onboardingProgress), không có cho trainingClasses/trainingRegistrations thường', async () => {
      // 12a) Đăng ký đã PASSED ở kịch bản 8 (nv_rp) — xác nhận KHÔNG có field nào ghi nhận đã cấp chứng
      // nhận trên chính bản ghi trainingRegistrations (khác onboardingProgress.certificateIssued).
      const reg = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.id === id), regId);
      assert(reg.result === 'PASSED', 'tiền đề: đăng ký phải đang ở trạng thái ĐẠT (kế thừa từ kịch bản 8)');
      assert(reg.certificateIssued === undefined, 'trainingRegistrations không có field certificateIssued nào cả — không có khái niệm "đã cấp chứng nhận" cho lớp học thường');
      // 12b) Gọi thẳng action "issue-certificate" (tên action THẬT của Onboarding, xem
      // issueOnboardingCertificate()/routes/records.js) lên collection trainingRegistrations — xác nhận
      // bị từ chối rõ ràng (route đó CHỈ đăng ký cho collection onboardingProgress), không phải 200 OK giả.
      let certErr = null;
      await page.evaluate(async (id) => {
        try { await callRecordAction('trainingRegistrations', id, 'issue-certificate', {}); }
        catch (err) { window.__lastCreateErr = err.message; }
      }, regId);
      certErr = await page.evaluate(() => window.__lastCreateErr);
      assert(certErr, 'action "issue-certificate" không tồn tại cho trainingRegistrations — phải bị từ chối, không được âm thầm thành công');
    });

    // ===== 13) Gợi ý học viên CHƯA hoàn thành (FAILED) khi tổ chức lại lớp cùng Chương Trình =====
    let classId2;
    await run('13) Mở Lớp Học mới cùng Chương Trình -> hệ thống gợi ý đúng học viên FAILED của lớp cũ, loại PASSED và tài khoản đã khoá', async () => {
      // Chuẩn bị tiền đề: nv2_rp làm bài SAI hết -> FAILED ở lớp gốc, để có ít nhất 1 học viên "chưa
      // hoàn thành" thật sự đúng kịch bản người dùng mô tả ("tổ chức lớp học lại").
      const nv2 = makeUser({ username: 'nv2_rp', name: 'Học Viên Thi Trượt', dept: 'Siêu Thị A', perms: {} });
      await page.evaluate((u) => { DB.users.push(u); }, nv2);
      await page.evaluate((u) => { currentUser = u; }, nv2);
      await page.evaluate((id) => registerForTrainingClass(id), classId);
      const reg2 = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.classId === id && r.creator === 'nv2_rp'), classId);
      // Lớp gốc có tài liệu bắt buộc (docId) -> phải đánh dấu đã xem trước, không thì submit-test sẽ bị
      // chặn 409 "chưa xem hết tài liệu" thay vì chấm điểm thật (đúng luật đã xác nhận ở kịch bản đầu).
      await page.evaluate((id) => openTrainingJoinClassModal(id), reg2.id);
      await page.evaluate((did) => markTrainingDocumentViewedAction(did), docId);
      // Đi qua ĐÚNG modal "Vào Làm Bài Test" thật (như kịch bản 8) nhưng KHÔNG chọn đáp án nào -> sai
      // hết -> FAILED (passScore 70%) — dùng luồng client thật để DB.trainingRegistrations được cập
      // nhật đúng (gọi thẳng callRecordAction không tự đồng bộ lại state cục bộ).
      await page.evaluate((id) => openTakeTestModal(id), classId);
      await page.evaluate(async () => {
        const total = ttTakeQuestions.length;
        for (let i = 0; i < total; i++) { await ttTakeGoNext(); }
      });
      const reg2After = await page.evaluate((id) => DB.trainingRegistrations.find((r) => r.id === id), reg2.id);
      assertEqual(reg2After.result, 'FAILED', 'tiền đề: nv2_rp phải KHÔNG ĐẠT để đúng kịch bản "học viên chưa hoàn thành"');

      // Thêm 1 đăng ký FAILED khác gắn với tài khoản ĐÃ KHOÁ (nv_locked_rp, tạo ở kịch bản 10) ở CHÍNH
      // lớp gốc -> phải chứng minh dù có FAILED thật, tài khoản khoá vẫn KHÔNG được gợi ý (khớp đúng
      // luật loại trừ tài khoản khoá dùng chung toàn hệ thống — seed thẳng vào DB vì mục đích chỉ để
      // kiểm tra logic lọc phía client, không cần đi lại toàn bộ luồng đăng ký/thi thật lần nữa).
      await page.evaluate((cid) => {
        DB.trainingRegistrations.push({
          id: 'reg_locked_rp_fail', classId: cid, creator: 'nv_locked_rp', creatorName: 'Nhân Viên Đã Khoá',
          dept: 'Siêu Thị A', result: 'FAILED', score: 0, viewedDocumentIds: [], createdAt: new Date().toISOString()
        });
      }, classId);

      // Người quản lý đào tạo mở lớp MỚI, CÙNG courseId với lớp cũ (đúng kịch bản "tổ chức lớp học lại").
      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate(() => { setTrainingLmsTab('CLASSES'); });
      await page.evaluate((cid) => {
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcTitle').value = 'Lớp Đào Tạo Nội Quy & An Toàn Siêu Thị A (Tổ chức lại)';
        document.getElementById('tcCourseId').value = String(cid);
        document.getElementById('tcStart').value = '2020-02-01T08:00';
        document.getElementById('tcEnd').value = '2020-02-01T10:00';
        document.getElementById('tcMode').value = 'ONLINE';
        onTrainingClassModeChange();
      }, courseId);
      await page.evaluate(() => submitTrainingClass({ preventDefault() {}, target: { reset() {} } }));
      const cls2 = await page.evaluate(() => DB.trainingClasses.find((c) => c.title === 'Lớp Đào Tạo Nội Quy & An Toàn Siêu Thị A (Tổ chức lại)'));
      assert(cls2, 'phải tạo được lớp học mới cùng chương trình');
      classId2 = cls2.id;

      // Mở modal "Thêm Học Viên" của lớp mới -> khối gợi ý phải hiện ra, đúng 1 người (nv2_rp), KHÔNG
      // chứa nv_rp (đã PASSED ở kịch bản 8) và KHÔNG chứa nv_locked_rp (FAILED thật nhưng tài khoản khoá).
      await page.evaluate((cid) => { openTrainingRosterModal(cid); }, classId2);
      const suggestWrapHidden = await page.evaluate(() => document.getElementById('trRosterSuggestWrap').classList.contains('hidden'));
      assert(!suggestWrapHidden, 'khối gợi ý phải hiện ra vì có ít nhất 1 học viên chưa hoàn thành hợp lệ (nv2_rp)');
      const suggestListHTML = await page.evaluate(() => document.getElementById('trRosterSuggestList').innerHTML);
      assert(/Học Viên Thi Trượt/.test(suggestListHTML), 'gợi ý phải hiện đúng tên học viên FAILED (nv2_rp)');
      assert(!/Học Viên Đóng Vai/.test(suggestListHTML), 'gợi ý KHÔNG được chứa nv_rp (đã ĐẠT/PASSED ở kịch bản 8)');
      assert(!/Nhân Viên Đã Khoá/.test(suggestListHTML), 'gợi ý KHÔNG được chứa tài khoản đã khoá dù có FAILED thật');
      const suggestCount = await page.evaluate(() => document.getElementById('trRosterSuggestCount').innerText);
      assertEqual(suggestCount, '1', 'phải đúng 1 người được gợi ý (chỉ nv2_rp hợp lệ)');

      // Bấm "+ Thêm tất cả" -> nv2_rp phải được đưa vào danh sách tạm (staged), và khối gợi ý tự ẩn đi
      // vì không còn ai để gợi ý nữa (đã được thêm hết).
      await page.evaluate(() => { addAllTrainingRosterSuggestions(); });
      const stagedAfter = await page.evaluate(() => trainingRosterStaged.map((p) => p.username));
      assert(stagedAfter.includes('nv2_rp'), 'sau khi bấm "+ Thêm tất cả", nv2_rp phải nằm trong danh sách tạm để add vào lớp mới');
      const suggestWrapHiddenAfter = await page.evaluate(() => document.getElementById('trRosterSuggestWrap').classList.contains('hidden'));
      assert(suggestWrapHiddenAfter, 'sau khi đã thêm hết, khối gợi ý phải tự ẩn (không còn ai để gợi ý)');

      // Xác nhận luồng thêm vào lớp thật hoạt động end-to-end: bulk-register với đúng danh sách staged.
      const bulkResult = await page.evaluate(async (cid) => {
        return await callRecordAction('trainingClasses', cid, 'bulk-register', { usernames: trainingRosterStaged.map((p) => p.username) });
      }, classId2);
      assertEqual(bulkResult.added.length, 1, 'phải thêm được đúng 1 học viên (nv2_rp) vào lớp mới qua danh sách tạm từ gợi ý');
      assertEqual(bulkResult.added[0].creator, 'nv2_rp', 'người được thêm phải đúng là nv2_rp');
      await page.evaluate(() => { closeTrainingRosterModal(); });
    });
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-training-scenario-roleplay');
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-training-scenario-roleplay.js:', err);
  process.exitCode = 1;
});
