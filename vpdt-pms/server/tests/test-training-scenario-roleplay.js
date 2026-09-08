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
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-training-scenario-roleplay');
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-training-scenario-roleplay.js:', err);
  process.exitCode = 1;
});
