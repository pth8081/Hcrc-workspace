// tests/test-training-plans.js — Đào Tạo Đợt 5: Kế Hoạch Đào Tạo (trainingPlans) + Nhập Kế Hoạch Từ
// Excel + Theo Dõi Thực Hiện/Dashboard (đối chiếu kế hoạch với số THẬT phát sinh ở Lớp Học/Đăng Ký).
// Tách file riêng khỏi test-internal-training.js (đã khá dài, 33 kịch bản) thay vì nhồi thêm vào đó.
//
// Phần 1 (không cần trình duyệt): parsePlanImportFile() ở lib/trainingPlanImport.js — dò cột theo tiêu
// đề/định dạng tháng/đối chiếu tên Chương Trình — test trực tiếp bằng buffer trong bộ nhớ, đơn giản hơn
// hẳn so với việc điều khiển 1 file input thật trong Playwright chỉ để kiểm tra logic đọc file thuần tuý.
//
// Phần 2 (Playwright, cùng khuôn test-internal-training.js): tạo/sửa/xoá trainingPlans qua form (gác
// quyền trainingManage/Admin), courseId/targetDept/month re-validate ở server dù client có bị bỏ qua,
// luồng Nhập Kế Hoạch Từ Excel (preview qua window.__planImportParsePreset rồi confirm — mỗi dòng vẫn đi
// qua đúng POST /api/create/trainingPlans thật, không tin nguyên preview), và phép tính Theo Dõi Thực
// Hiện/Dashboard (kế hoạch vs số thật tính sống từ trainingClasses/trainingRegistrations).
//
// Run: node server/tests/test-training-plans.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');
const { buildPlanImportTemplateWorkbook, parsePlanImportFile, existingPlanKeys } = require('../lib/trainingPlanImport');

const PORT = 8998;

// ===================== Phần 1: lib/trainingPlanImport.js (không cần trình duyệt) =====================
async function runParserUnitTests(run) {
  await run('[parser] mẫu Excel tải xuống tự đọc lại đúng, khớp Chương Trình khi tên trùng (không phân biệt hoa-thường/dấu)', async () => {
    const wb = await buildPlanImportTemplateWorkbook();
    const buffer = await wb.xlsx.writeBuffer();
    const courses = [{ id: 42, name: 'KỸ NĂNG BÁN HÀNG CƠ BẢN' }]; // cố tình khác hoa/thường + không dấu so với mẫu
    const items = await parsePlanImportFile(buffer, '.xlsx', courses);
    assertEqual(items.length, 1, `expected 1 data row from the template, got ${items.length}`);
    const it = items[0];
    assertEqual(it.month, '2026-09', 'month mismatch');
    assertEqual(it.monthValid, true, 'template month should be valid');
    assertEqual(it.courseId, 42, 'course name should fuzzy-match (case/diacritic-insensitive) against the real course list');
    assertEqual(it.courseMatched, true, 'courseMatched flag mismatch');
    assertEqual(it.targetDept, 'Phòng Kinh Doanh', 'targetDept mismatch');
    assertEqual(it.plannedClasses, 2, 'plannedClasses mismatch');
    assertEqual(it.plannedTrainees, 40, 'plannedTrainees mismatch');
    assertEqual(it.plannedHours, 16, 'plannedHours mismatch');
  });

  await run('[parser] tên Chương Trình không khớp course nào -> courseId null nhưng dòng vẫn nhập được (không bị chặn)', async () => {
    const wb = await buildPlanImportTemplateWorkbook();
    const buffer = await wb.xlsx.writeBuffer();
    const items = await parsePlanImportFile(buffer, '.xlsx', [{ id: 1, name: 'Một Chương Trình Hoàn Toàn Khác' }]);
    assertEqual(items[0].courseId, null, 'no course should match');
    assertEqual(items[0].courseMatched, false, 'courseMatched should be false');
    assertEqual(items[0].monthValid, true, 'row should still be importable despite the course mismatch');
  });

  await run('[parser] dò cột theo nhiều cách viết tiêu đề khác nhau (CSV, không dấu, viết tắt "Số HV")', async () => {
    const csv = [
      'thang,chuong trinh,don vi,doi tuong,so lop,so hoc vien,thoi luong',
      '2026-10,,Phòng CNTT,Nhân viên mới,3,50,20'
    ].join('\n');
    const items = await parsePlanImportFile(Buffer.from(csv, 'utf8'), '.csv', []);
    assertEqual(items.length, 1, 'expected 1 row from the alternate-header CSV');
    assertEqual(items[0].month, '2026-10', 'month mismatch (alternate header)');
    assertEqual(items[0].targetDept, 'Phòng CNTT', 'targetDept mismatch (alternate header)');
    assertEqual(items[0].plannedClasses, 3, 'plannedClasses mismatch (alternate header)');
    assertEqual(items[0].plannedTrainees, 50, 'plannedTrainees mismatch (alternate header)');
    assertEqual(items[0].plannedHours, 20, 'plannedHours mismatch (alternate header)');
  });

  await run('[parser] chấp nhận vài định dạng tháng phổ biến (mm/yyyy, yyyy/mm) và giữ nguyên định dạng lạ để server tự báo lỗi', async () => {
    const csv = [
      'Tháng,Chương Trình,Đơn Vị,Đối Tượng,Số Lớp,Số Học Viên,Thời Lượng',
      '09/2026,,,,,,',
      '2026/11,,,,,,',
      'thang-sai,,,,,,'
    ].join('\n');
    const items = await parsePlanImportFile(Buffer.from(csv, 'utf8'), '.csv', []);
    assertEqual(items.length, 3, 'expected 3 data rows');
    assertEqual(items[0].month, '2026-09', 'mm/yyyy should normalize to yyyy-mm');
    assertEqual(items[0].monthValid, true, 'mm/yyyy row should be valid');
    assertEqual(items[1].month, '2026-11', 'yyyy/mm should normalize to yyyy-mm');
    assertEqual(items[1].monthValid, true, 'yyyy/mm row should be valid');
    assertEqual(items[2].monthValid, false, 'unrecognized month format should be left invalid, not silently guessed');
  });

  await run('[parser] file không có cột "Tháng" bị từ chối rõ ràng thay vì âm thầm đọc sai', async () => {
    const csv = ['Chương Trình,Đơn Vị', 'Gì đó,Phòng CNTT'].join('\n');
    let errMsg = null;
    try {
      await parsePlanImportFile(Buffer.from(csv, 'utf8'), '.csv', []);
    } catch (err) { errMsg = err.message; }
    assert(errMsg && errMsg.includes('Tháng'), `expected a missing-month-column error, got: ${errMsg}`);
  });

  // Chống trùng lặp (đợt 10/2026) — route NÀY đọc được trainingPlans đã có sẵn thật (khác Danh Mục Đầu
  // Tư/Danh Sách Công Việc Vận Hành, không có sourceId ở bước parse) nên tự tính được duplicateExisting
  // THẬT ở server, không cần client tự so thêm.
  await run('[parser] 2 dòng cùng Tháng+Chương Trình+Đơn Vị -> dòng 2 duplicateInFile; existingPlanKeys() so đúng với trainingPlans đã có (qua courseId tra ngược tên) -> duplicateExisting', async () => {
    const courses = [{ id: 42, name: 'Kỹ Năng Bán Hàng Cơ Bản' }, { id: 43, name: 'Không Tên Nào Khớp' }];
    const csv = [
      'Tháng,Chương Trình,Đơn Vị,Đối Tượng,Số Lớp,Số Học Viên,Thời Lượng',
      '2026-09,Kỹ Năng Bán Hàng Cơ Bản,Phòng Kinh Doanh,Nhân viên mới,2,40,16',
      '2026-09,  kỹ năng   bán hàng cơ bản , Phòng Kinh Doanh ,Ca khác,1,10,8'
    ].join('\n');
    const itemsNoExisting = await parsePlanImportFile(Buffer.from(csv, 'utf8'), '.csv', courses);
    assertEqual(itemsNoExisting[0].duplicateInFile, false, 'dòng đầu không trùng ai trong file');
    assertEqual(itemsNoExisting[1].duplicateInFile, true, 'dòng 2 cùng Tháng+Chương Trình (chuẩn hoá)+Đơn Vị với dòng 1 phải bị đánh dấu duplicateInFile');
    assertEqual(itemsNoExisting[0].duplicateExisting, false, 'chưa truyền existingKeys -> không có gì để so');

    // existingPlanKeys(): bản ghi ĐÃ CÓ chỉ lưu courseId (không lưu lại courseName dạng chữ tự do) nên
    // phải tra ngược tên qua courses trước khi ghép khoá — bản ghi courseId=null bị BỎ QUA (không đủ dữ
    // liệu đáng tin để so, xem chú thích existingPlanKeys()).
    const existingPlans = [
      { id: 1, month: '2026-09', courseId: 42, targetDept: 'Phòng Kinh Doanh' },
      { id: 2, month: '2026-10', courseId: null, targetDept: 'Phòng Kinh Doanh' } // không gắn chương trình -> bị bỏ qua khỏi keys
    ];
    const keys = existingPlanKeys(existingPlans, courses);
    assertEqual(keys.length, 1, 'chỉ bản ghi đã gắn đúng 1 chương trình có sẵn mới tạo được khoá so trùng');
    const itemsWithExisting = await parsePlanImportFile(Buffer.from(csv, 'utf8'), '.csv', courses, keys);
    assertEqual(itemsWithExisting[0].duplicateExisting, true, 'dòng đầu (2026-09, đúng chương trình 42, đúng đơn vị) phải khớp bản ghi đã có');
    assertEqual(itemsWithExisting[1].duplicateExisting, true, 'dòng 2 cũng cùng khoá (khác hoa/thường+khoảng trắng) nên cũng phải khớp');
  });
}

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    await runParserUnitTests(run);

    const trainer = makeUser({ username: 'gv.linh', name: 'Trần Thị Linh', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } });
    const admin = makeUser({ username: 'admin.a', name: 'Quản Trị A', dept: 'Phòng Nhân Sự', perms: { admin: true } });
    const nv1 = makeUser({ username: 'nv1', name: 'Học Viên Một', dept: 'Phòng CNTT', perms: {} });
    const nv2 = makeUser({ username: 'nv2', name: 'Học Viên Hai', dept: 'Phòng Kinh Doanh', perms: {} });

    const seed = baseCatalogSeed();
    seed.stores = ['Siêu Thị Q1'];
    await page.evaluate((s) => { Object.assign(DB, s); }, seed);
    await page.evaluate((users) => { DB.users = users; }, [trainer, admin, nv1, nv2]);
    await page.evaluate((u) => finishLogin(u), trainer);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('PLANS'); });

    // ===================== Tạo/quyền/validate =====================

    await run('nv1 (không có trainingManage) không thấy form lập kế hoạch, chỉ thấy ghi chú không có quyền', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv1);
      await page.evaluate(() => renderTrainingLms());
      const formHidden = await page.evaluate(() => document.getElementById('trainingPlanForm').classList.contains('hidden'));
      const noteHidden = await page.evaluate(() => document.getElementById('trainingPlanNoPermNote').classList.contains('hidden'));
      assert(formHidden, 'form should be hidden for nv1');
      assert(!noteHidden, 'the no-permission note should be visible for nv1');
      await page.evaluate((u) => { currentUser = u; }, trainer);
      await page.evaluate(() => renderTrainingLms());
    });

    await run('server rejects a trainingPlans create bypassing the form when caller lacks trainingManage', async () => {
      await page.evaluate((u) => { currentUser = u; }, nv1);
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('trainingPlans', { month: '2026-06', plannedClasses: 1 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('không có quyền lập kế hoạch'), `expected a permission error, got: ${errMsg}`);
      await page.evaluate((u) => { currentUser = u; }, trainer);
    });

    let courseId = null;
    await run('trainer creates a trainingCourses entry to link the plan to', async () => {
      await page.evaluate(() => {
        window.__alerts.length = 0;
        setTrainingLmsTab('COURSES');
        document.getElementById('tccCategory').value = 'Nghiệp vụ';
        document.getElementById('tccName').value = 'Kỹ Năng Bán Hàng Cơ Bản';
      });
      await page.evaluate(() => submitTrainingCourse({ preventDefault() {}, target: { reset() {} } }));
      const course = await page.evaluate(() => DB.trainingCourses.find((c) => c.name === 'Kỹ Năng Bán Hàng Cơ Bản'));
      assert(course, 'expected the course to be created');
      courseId = course.id;
      await page.evaluate(() => setTrainingLmsTab('PLANS'));
    });

    await run('Chương Trình: thẻ không hiện nút "Xem Tài Liệu" khi chưa có tài liệu nào gắn courseId; hiện đúng số lượng + modal liệt kê sau khi gắn 1 tài liệu (10/2026, theo yêu cầu BP Đào Tạo)', async () => {
      await page.evaluate(() => setTrainingLmsTab('COURSES'));
      const htmlBefore = await page.evaluate(() => { renderTrainingCourses(); return document.getElementById('trainingCoursesContainer').innerHTML; });
      assert(!htmlBefore.includes('openTrainingCourseDocsModal'), 'no "Xem Tài Liệu" button should render while the course has 0 linked documents');

      // Seed trực tiếp DB.trainingDocuments (đã gắn courseId) — chỉ kiểm tra RENDER/modal ở đây, luồng tạo
      // tài liệu thật (upload file) đã có bộ test riêng (test-trainingdocuments-encrypted-pdf-pagecount.js...).
      await page.evaluate((cid) => {
        DB.trainingDocuments.push({ id: 80001, title: 'Tài Liệu Giới Thiệu Sản Phẩm', category: 'Nghiệp vụ', docType: 'DOCUMENT', fileUrl: '/uploads/fake.pdf', courseId: cid, mandatory: true, description: 'Mô tả thử' });
      }, courseId);
      const htmlAfter = await page.evaluate(() => { renderTrainingCourses(); return document.getElementById('trainingCoursesContainer').innerHTML; });
      assert(htmlAfter.includes('Xem Tài Liệu (1)'), `expected the course card to show exactly 1 linked document, got: ${htmlAfter}`);

      await page.evaluate((cid) => openTrainingCourseDocsModal(cid), courseId);
      const modalVisible = await page.evaluate(() => !document.getElementById('trainingCourseDocsModal').classList.contains('hidden'));
      assert(modalVisible, 'the course-docs modal should be visible after opening it');
      const modalHTML = await page.evaluate(() => document.getElementById('trainingCourseDocsBody').innerHTML);
      assert(modalHTML.includes('Tài Liệu Giới Thiệu Sản Phẩm'), 'the modal should list the linked document title');
      assert(modalHTML.includes('⚠️ Bắt buộc'), 'the mandatory badge should render in the modal');

      await page.evaluate(() => closeTrainingCourseDocsModal());
      const modalHidden = await page.evaluate(() => document.getElementById('trainingCourseDocsModal').classList.contains('hidden'));
      assert(modalHidden, 'the course-docs modal should be hidden again after closing it');
      await page.evaluate(() => setTrainingLmsTab('PLANS'));
    });

    await run('invalid month format is rejected server-side even bypassing the <input type=month> picker', async () => {
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('trainingPlans', { month: '09-2026', plannedClasses: 1 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('Tháng kế hoạch không hợp lệ'), `expected a month-format error, got: ${errMsg}`);
    });

    await run('an invalid courseId is rejected server-side', async () => {
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('trainingPlans', { month: '2026-06', courseId: 999999 }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('Chương trình được chọn không hợp lệ'), `expected an invalid-course error, got: ${errMsg}`);
    });

    // LỖI ĐÃ VÁ (11/2026, theo yêu cầu người dùng — "Đơn Vị (tuỳ chọn)" hiển thị như ô gõ-tự-do trên giao
    // diện (tpTargetDept) nhưng server trước đây vẫn chặn cứng nếu gõ khác đúng 1 tên có sẵn trong Danh
    // Mục Phòng Ban/Siêu Thị, mâu thuẫn với giao diện): server KHÔNG còn ép khớp danh mục nữa — xác nhận
    // targetDept tự do được CHẤP NHẬN và lưu nguyên văn. Dùng tháng 2026-05 (KHÁC "2026-06") + dọn ngay
    // sau khi tạo — tránh ảnh hưởng tới các phép đếm "2 kế hoạch tháng 6" ở các kịch bản phía sau.
    await run('targetDept tự do (không có trong Danh Mục) KHÔNG còn bị chặn — server chấp nhận và lưu nguyên văn', async () => {
      await page.evaluate(async () => {
        window.__freeTextDeptErr = null;
        window.__freeTextDeptPlan = null;
        try { window.__freeTextDeptPlan = await callCreateAction('trainingPlans', { month: '2026-05', targetDept: 'Phòng Không Tồn Tại' }); }
        catch (err) { window.__freeTextDeptErr = err.message; }
      });
      const errMsg = await page.evaluate(() => window.__freeTextDeptErr);
      assert(!errMsg, `expected free-text targetDept to be accepted, got error: ${errMsg}`);
      const created = await page.evaluate(() => window.__freeTextDeptPlan);
      assert(created && created.item, 'expected a created training plan in the response');
      assertEqual(created.item.targetDept, 'Phòng Không Tồn Tại', 'targetDept should be saved verbatim, no catalog restriction');
      await page.evaluate((id) => { DB.trainingPlans = DB.trainingPlans.filter((p) => p.id !== id); }, created.item.id);
    });

    let planId = null;
    await run('trainer lập kế hoạch tháng 6/2026: 2 lớp / 40 học viên / 16 giờ, gắn Chương Trình + Đơn Vị', async () => {
      await page.evaluate((cid) => {
        window.__alerts.length = 0;
        // tpMonth cũ (type="date") đã đổi sang cặp select Tháng/Năm (11/2026) — xem
        // setSelectPairFromMonth() ở module-internalcomms-daotao.js.
        setSelectPairFromMonth('tpMonthNum', 'tpMonthYear', '2026-06');
        document.getElementById('tpCourseId').value = String(cid);
        document.getElementById('tpTargetDept').value = 'Phòng CNTT';
        document.getElementById('tpAudience').value = 'Nhân viên mới';
        document.getElementById('tpPlannedClasses').value = '2';
        document.getElementById('tpPlannedTrainees').value = '40';
        document.getElementById('tpPlannedHours').value = '16';
      }, courseId);
      await page.evaluate(() => submitTrainingPlan({ preventDefault() {} }));
      const plans = await page.evaluate(() => DB.trainingPlans);
      assertEqual(plans.length, 1, 'expected exactly 1 training plan');
      planId = plans[0].id;
      assertEqual(plans[0].month, '2026-06', 'month mismatch');
      assertEqual(plans[0].courseId, courseId, 'courseId mismatch');
      assertEqual(plans[0].targetDept, 'Phòng CNTT', 'targetDept mismatch');
      assertEqual(plans[0].plannedClasses, 2, 'plannedClasses mismatch');
      assertEqual(plans[0].plannedTrainees, 40, 'plannedTrainees mismatch');
      assertEqual(plans[0].plannedHours, 16, 'plannedHours mismatch');
      assertEqual(plans[0].dept, trainer.dept, 'dept (creator dept, forceOwnDept) mismatch — this is metadata about who authored the plan, unrelated to targetDept');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đã lập kế hoạch đào tạo thành công')), `expected a success alert, got ${JSON.stringify(alerts)}`);
    });

    await run('editing the plan via the form (Sửa) updates it in place through the real edit endpoint', async () => {
      await page.evaluate((id) => openEditTrainingPlan(id), planId);
      await page.evaluate(() => { document.getElementById('tpPlannedClasses').value = '3'; });
      await page.evaluate(() => submitTrainingPlan({ preventDefault() {} }));
      const plan = await page.evaluate((id) => DB.trainingPlans.find((p) => p.id === id), planId);
      assertEqual(plan.plannedClasses, 3, 'plannedClasses should be updated to 3 after edit');
      assertEqual(plan.month, '2026-06', 'unrelated fields should be preserved after a partial edit');
    });

    await run('Ghi Nhận Thực Tế: 6 field điền tay (Giảng Viên/Chức Danh/Ngày Tổ Chức/Thời Gian/SL Tham Gia TT/Điểm Đánh Giá) round-trip đúng qua form Sửa, server chuẩn hoá điểm về thang 0-10', async () => {
      await page.evaluate((id) => openEditTrainingPlan(id), planId);
      await page.evaluate(() => {
        document.getElementById('tpInstructor').value = 'Nguyễn Thị A';
        document.getElementById('tpJobTitle').value = 'Chuyên viên Đào tạo';
        // tpActualTrainingDate cũ (1 ngày, type="date") đã đổi sang khoảng Từ-Đến CÓ GIỜ (11/2026,
        // type="datetime-local") — xem tpActualTrainingDateFrom/tpActualTrainingDateTo.
        document.getElementById('tpActualTrainingDateFrom').value = '2026-06-15T08:00';
        document.getElementById('tpActualTrainingDateTo').value = '2026-06-15T11:00';
        document.getElementById('tpActualDuration').value = '3 giờ';
        document.getElementById('tpActualParticipants').value = '9';
        document.getElementById('tpInstructorRating').value = '12'; // cố tình vượt thang 10 — server phải tự chặn trần
      });
      await page.evaluate(() => submitTrainingPlan({ preventDefault() {} }));
      const plan = await page.evaluate((id) => DB.trainingPlans.find((p) => p.id === id), planId);
      assertEqual(plan.instructor, 'Nguyễn Thị A', 'instructor mismatch');
      assertEqual(plan.jobTitle, 'Chuyên viên Đào tạo', 'jobTitle mismatch');
      assertEqual(plan.actualTrainingDateFrom, '2026-06-15T08:00', 'actualTrainingDateFrom mismatch');
      assertEqual(plan.actualTrainingDateTo, '2026-06-15T11:00', 'actualTrainingDateTo mismatch');
      assertEqual(plan.actualDuration, '3 giờ', 'actualDuration mismatch');
      assertEqual(plan.actualParticipants, 9, 'actualParticipants mismatch');
      assertEqual(plan.instructorRating, 10, 'instructorRating must be clamped to the 0-10 scale server-side even if the client sent 12');

      // Mở lại form Sửa — tất cả 6 field phải nạp lại đúng giá trị đã lưu (không bị bỏ sót như targetDept/audience).
      await page.evaluate((id) => openEditTrainingPlan(id), planId);
      const reloaded = await page.evaluate(() => ({
        instructor: document.getElementById('tpInstructor').value,
        jobTitle: document.getElementById('tpJobTitle').value,
        actualTrainingDateFrom: document.getElementById('tpActualTrainingDateFrom').value,
        actualTrainingDateTo: document.getElementById('tpActualTrainingDateTo').value,
        actualDuration: document.getElementById('tpActualDuration').value,
        actualParticipants: document.getElementById('tpActualParticipants').value,
        instructorRating: document.getElementById('tpInstructorRating').value
      }));
      assertEqual(reloaded.instructor, 'Nguyễn Thị A', 'instructor should reload into the edit form');
      assertEqual(reloaded.jobTitle, 'Chuyên viên Đào tạo', 'jobTitle should reload into the edit form');
      assertEqual(reloaded.actualTrainingDateFrom, '2026-06-15T08:00', 'actualTrainingDateFrom should reload into the edit form');
      assertEqual(reloaded.actualTrainingDateTo, '2026-06-15T11:00', 'actualTrainingDateTo should reload into the edit form');
      assertEqual(reloaded.actualDuration, '3 giờ', 'actualDuration should reload into the edit form');
      assertEqual(reloaded.actualParticipants, '9', 'actualParticipants should reload into the edit form');
      assertEqual(reloaded.instructorRating, '10', 'instructorRating should reload the clamped value into the edit form');

      // Danh Sách Kế Hoạch Đào Tạo: cột đầu giờ hiện Giảng Viên (thay vì Đơn Vị), Đơn Vị lùi xuống làm phụ chú.
      const listHTML = await page.evaluate(() => { renderTrainingPlans(); return document.getElementById('trainingPlansTableBody').innerHTML; });
      assert(listHTML.includes('Nguyễn Thị A'), 'the plan list should now show the instructor name');
      assert(listHTML.includes('Phòng CNTT'), 'targetDept should still render as a sub-note, not lost');
      await page.evaluate(() => cancelEditTrainingPlan());
    });

    await run('only Admin sees the "Xóa" button in the plan list, not a trainingManage-only user', async () => {
      const htmlAsTrainer = await page.evaluate(() => { renderTrainingPlans(); return document.getElementById('trainingPlansTableBody').innerHTML; });
      assert(!htmlAsTrainer.includes('deleteTrainingPlanAction'), 'trainingManage (non-admin) should not see a delete button');
      await page.evaluate((u) => { currentUser = u; }, admin);
      const htmlAsAdmin = await page.evaluate(() => { renderTrainingPlans(); return document.getElementById('trainingPlansTableBody').innerHTML; });
      assert(htmlAsAdmin.includes('deleteTrainingPlanAction'), 'Admin should see a delete button');
      await page.evaluate((u) => { currentUser = u; }, trainer);
    });

    // ===================== Nhập Kế Hoạch Từ Excel (preview -> confirm) =====================

    await run('Nhập Kế Hoạch Từ Excel: preview hiển thị đúng, dòng tháng sai bị đánh dấu lỗi và KHÔNG được nhập khi confirm', async () => {
      await page.evaluate((cid) => {
        window.__planImportParsePreset = [
          { month: '2026-11', monthValid: true, courseName: 'Kỹ Năng Bán Hàng Cơ Bản', courseId: cid, courseMatched: true, targetDept: 'Phòng CNTT', audience: 'Nhân viên mới', plannedClasses: 1, plannedTrainees: 20, plannedHours: 8 },
          { month: '2026-12', monthValid: true, courseName: 'Chương trình lạ không khớp', courseId: null, courseMatched: false, targetDept: '', audience: 'Trưởng ca', plannedClasses: 2, plannedTrainees: 30, plannedHours: 12 },
          { month: 'sai-dinh-dang', monthValid: false, courseName: '', courseId: null, courseMatched: false, targetDept: '', audience: '', plannedClasses: 1, plannedTrainees: 1, plannedHours: 1 }
        ];
      }, courseId);
      const tmpPath = path.join(os.tmpdir(), 'plan-import-test.xlsx');
      fs.writeFileSync(tmpPath, 'dummy'); // nội dung không quan trọng — /api/training/parse-plan-import đã bị mock trả preset ở trên
      await page.setInputFiles('#tpImportFileInput', tmpPath);
      await page.waitForFunction(() => document.getElementById('tpImportStatus').innerText.includes('Đọc file'));
      const statusText = await page.evaluate(() => document.getElementById('tpImportStatus').innerText);
      assert(statusText.includes('2/3'), `expected preview status to report 2/3 valid, got: ${statusText}`);
      const previewHTML = await page.evaluate(() => document.getElementById('tpImportPreviewBody').innerHTML);
      assert(previewHTML.includes('✅ khớp'), 'the matched course row should show a match indicator');
      assert(previewHTML.includes('ℹ️ Chưa có trong danh mục — vẫn nhập được'), 'the unmatched course row should show the non-alarming "not yet in the catalog" note, not a scary mismatch warning');
      assert(!previewHTML.includes('⚠️ không khớp'), 'the old alarming wording must be gone');
      assert(previewHTML.includes('⛔ Tháng không hợp lệ'), 'the invalid-month row should be flagged in the preview');

      // "Tự động thêm vào danh mục Chương Trình" ĐÃ BỊ BỎ HẲN (10/2026, theo yêu cầu BP Đào Tạo — Chương
      // Trình giờ do BP Đào Tạo tạo/gán THỦ CÔNG, không còn tự sinh từ Excel) — checkbox đó không còn tồn
      // tại trong DOM nữa.
      assertEqual(await page.evaluate(() => document.getElementById('tpImportAutoCreateCoursesWrap')), null, 'the removed auto-create-course checkbox wrapper must no longer exist in the DOM');

      const countBefore = await page.evaluate(() => DB.trainingPlans.length);
      const coursesCountBefore = await page.evaluate(() => DB.trainingCourses.length);
      await page.evaluate(() => confirmTrainingPlanImport());
      const plansAfter = await page.evaluate(() => DB.trainingPlans);
      assertEqual(plansAfter.length, countBefore + 2, 'only the 2 valid-month rows should have been created, the invalid one skipped');
      const nov = plansAfter.find((p) => p.month === '2026-11');
      const dec = plansAfter.find((p) => p.month === '2026-12');
      assert(nov, 'expected the November row to be imported');
      assert(dec, 'expected the December row to be imported');
      assertEqual(nov.courseId, courseId, 'matched course should carry its courseId through the confirm step');
      assertEqual(dec.courseId, null, 'unmatched course name always imports with courseId left null now — no auto-create path exists anymore');
      assert(!plansAfter.some((p) => p.month === 'sai-dinh-dang'), 'the invalid-month row must never reach the server');
      const coursesCountAfter = await page.evaluate(() => DB.trainingCourses.length);
      assertEqual(coursesCountAfter, coursesCountBefore, 'no new trainingCourses should ever be auto-created by the import confirm step anymore');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đã nhập 2/2 dòng kế hoạch')), `expected an import summary alert, got ${JSON.stringify(alerts)}`);
    });

    await run('Nhập Kế Hoạch Từ Excel: nhiều dòng CÙNG tên Chương Trình chưa khớp danh mục vẫn nhập được, courseId để trống cho CẢ hai, KHÔNG tự tạo Chương Trình nào (hành vi auto-create cũ đã bị bỏ hẳn)', async () => {
      await page.evaluate((cid) => {
        window.__planImportParsePreset = [
          { month: '2027-01', monthValid: true, courseName: 'Kỹ Năng Bán Hàng Cơ Bản', courseId: cid, courseMatched: true, targetDept: '', audience: '', plannedClasses: 1, plannedTrainees: 10, plannedHours: 4 },
          { month: '2027-02', monthValid: true, courseName: 'Chương Trình Mới Chưa Có', courseId: null, courseMatched: false, targetDept: '', audience: '', plannedClasses: 1, plannedTrainees: 10, plannedHours: 4 },
          { month: '2027-03', monthValid: true, courseName: 'Chương Trình Mới Chưa Có', courseId: null, courseMatched: false, targetDept: '', audience: '', plannedClasses: 2, plannedTrainees: 15, plannedHours: 6 }
        ];
      }, courseId);
      const tmpPath = path.join(os.tmpdir(), 'plan-import-test-autocreate.xlsx');
      fs.writeFileSync(tmpPath, 'dummy');
      await page.setInputFiles('#tpImportFileInput', tmpPath);
      await page.waitForFunction(() => document.getElementById('tpImportStatus').innerText.includes('Đọc file'));

      const coursesCountBefore = await page.evaluate(() => DB.trainingCourses.length);
      await page.evaluate(() => confirmTrainingPlanImport());

      const coursesAfter = await page.evaluate(() => DB.trainingCourses);
      assertEqual(coursesAfter.length, coursesCountBefore, 'no new trainingCourses should be created — the auto-create-on-import path has been removed entirely');

      const plansAfter = await page.evaluate(() => DB.trainingPlans);
      const feb = plansAfter.find((p) => p.month === '2027-02');
      const mar = plansAfter.find((p) => p.month === '2027-03');
      assert(feb && mar, 'both rows sharing the unmatched course name should still have been imported');
      assertEqual(feb.courseId, null, 'unmatched row keeps courseId null — BP Đào Tạo gán tay sau nếu cần');
      assertEqual(mar.courseId, null, 'the OTHER row with the same unmatched name should also keep courseId null');
      const jan = plansAfter.find((p) => p.month === '2027-01');
      assertEqual(jan.courseId, courseId, 'an already-matched row must keep going through its real matched courseId');
    });

    // ===================== Theo Dõi Thực Hiện & Dashboard (kế hoạch vs số thật) =====================

    let classInMonthId = null, classOtherCourseId = null, classNextMonthId = null;
    await run('seed thực tế: 2 lớp Tháng 6 (1 đúng chương trình, 1 khác chương trình) + 1 lớp Tháng 7 để kiểm tra lọc theo tháng/chương trình', async () => {
      await page.evaluate((cid) => {
        DB.trainingClasses.push(
          { id: 90001, code: 'LOP-A', title: 'Lớp A - Tháng 6 đúng chương trình', category: 'Nghiệp vụ', courseId: cid, mode: 'ONLINE', status: 'OPEN', startTime: '2026-06-05T08:00', endTime: '2026-06-05T12:00', creator: 'gv.linh', creatorName: 'Trần Thị Linh', dept: 'Phòng Nhân Sự' },
          { id: 90002, code: 'LOP-B', title: 'Lớp B - Tháng 6 khác chương trình', category: 'Nghiệp vụ', courseId: null, mode: 'ONLINE', status: 'OPEN', startTime: '2026-06-10T08:00', endTime: '2026-06-10T10:00', creator: 'gv.linh', creatorName: 'Trần Thị Linh', dept: 'Phòng Nhân Sự' },
          { id: 90003, code: 'LOP-C', title: 'Lớp C - Tháng 7', category: 'Nghiệp vụ', courseId: cid, mode: 'ONLINE', status: 'OPEN', startTime: '2026-07-05T08:00', endTime: '2026-07-05T12:00', creator: 'gv.linh', creatorName: 'Trần Thị Linh', dept: 'Phòng Nhân Sự' }
        );
        DB.trainingRegistrations.push(
          // Lớp A: 2 học viên (1 Phòng CNTT khớp targetDept của kế hoạch, 1 Phòng Kinh Doanh không khớp)
          { id: 90101, classId: 90001, className: 'Lớp A', classCode: 'LOP-A', category: 'Nghiệp vụ', result: 'PASSED', score: 90, creator: 'nv1', creatorName: 'Học Viên Một', dept: 'Phòng CNTT' },
          { id: 90102, classId: 90001, className: 'Lớp A', classCode: 'LOP-A', category: 'Nghiệp vụ', result: 'REGISTERED', creator: 'nv2', creatorName: 'Học Viên Hai', dept: 'Phòng Kinh Doanh' },
          // Lớp B (khác chương trình): 1 học viên CANCELLED — không được tính vào actual
          { id: 90103, classId: 90002, className: 'Lớp B', classCode: 'LOP-B', category: 'Nghiệp vụ', result: 'CANCELLED', creator: 'nv1', creatorName: 'Học Viên Một', dept: 'Phòng CNTT' }
        );
      }, courseId);
      classInMonthId = 90001; classOtherCourseId = 90002; classNextMonthId = 90003;
    });

    await run('getTrainingPlanActualStats(): đúng số lớp/học viên/giờ THẬT cho kế hoạch có gắn Chương Trình + Đơn Vị (Phòng CNTT)', async () => {
      const stats = await page.evaluate((id) => {
        const plan = DB.trainingPlans.find((p) => p.id === id);
        return getTrainingPlanActualStats(plan);
      }, planId);
      // Chỉ Lớp A tính (đúng tháng 6 + đúng courseId) — Lớp B khác chương trình bị loại, Lớp C tháng 7 bị loại.
      assertEqual(stats.actualClasses, 1, `expected exactly 1 matching class (course+month filter), got ${stats.actualClasses}`);
      // targetDept='Phòng CNTT' -> chỉ tính nv1 (Phòng CNTT), loại nv2 (Phòng Kinh Doanh) dù cùng lớp A.
      assertEqual(stats.actualTrainees, 1, `expected 1 distinct trainee after targetDept filtering, got ${stats.actualTrainees}`);
      assertEqual(stats.actualHours, 4, `expected 4 hours (08:00-12:00) for the 1 matching class, got ${stats.actualHours}`);
    });

    await run('getTrainingPlanCompletionPct(): trung bình 3 chiều, mỗi chiều chặn trần 100%', async () => {
      const pct = await page.evaluate((id) => getTrainingPlanCompletionPct(DB.trainingPlans.find((p) => p.id === id)), planId);
      // planned: 3 lớp / 40 học viên / 16 giờ. actual: 1 lớp / 1 học viên / 4 giờ.
      // ratios: 1/3, 1/40, 4/16=0.25 -> avg = (0.3333+0.025+0.25)/3 = 0.2028 -> 20%
      assertEqual(pct, 20, `expected ~20% completion, got ${pct}`);
    });

    await run('isTrainingPlanOverdue(): kế hoạch tháng đã qua và thiếu số thật -> quá hạn; kế hoạch tháng tương lai -> KHÔNG quá hạn', async () => {
      const overduePastPlan = await page.evaluate((id) => isTrainingPlanOverdue(DB.trainingPlans.find((p) => p.id === id)), planId);
      assert(overduePastPlan, 'the June 2026 plan (now in the past relative to test data) with under-delivered actuals should be overdue');

      const futureOverdue = await page.evaluate(() => {
        const farFuture = new Date(Date.now() + 400 * 24 * 3600 * 1000);
        const month = `${farFuture.getFullYear()}-${String(farFuture.getMonth() + 1).padStart(2, '0')}`;
        return isTrainingPlanOverdue({ month, plannedClasses: 5, plannedTrainees: 5 });
      });
      assert(!futureOverdue, 'a plan whose month has not happened yet must never be flagged overdue');
    });

    await run('computeTrainingPlanDashboard(): lọc theo tháng/chương trình/đơn vị và tổng hợp đúng số liệu, kèm danh sách quá hạn', async () => {
      // Thêm 1 kế hoạch KHÔNG gắn chương trình/đơn vị cho tháng 6 để kiểm tra tổng hợp không lọc.
      await page.evaluate(() => {
        window.__alerts.length = 0;
        setSelectPairFromMonth('tpMonthNum', 'tpMonthYear', '2026-06');
        document.getElementById('tpCourseId').value = '';
        document.getElementById('tpTargetDept').value = '';
        document.getElementById('tpAudience').value = '';
        document.getElementById('tpPlannedClasses').value = '1';
        document.getElementById('tpPlannedTrainees').value = '5';
        document.getElementById('tpPlannedHours').value = '4';
      });
      await page.evaluate(() => submitTrainingPlan({ preventDefault() {} }));

      const dashAll = await page.evaluate(() => computeTrainingPlanDashboard({ month: '2026-06', courseId: null, targetDept: '', audience: '' }));
      // 2 kế hoạch tháng 6 trong tổng hợp: kế hoạch có courseId+targetDept (planId) + kế hoạch mới không gắn gì.
      assertEqual(dashAll.plans.length, 2, `expected 2 June plans in the unfiltered dashboard, got ${dashAll.plans.length}`);
      assertEqual(dashAll.totalPlannedClasses, 4, 'total planned classes (3 + 1) mismatch');

      const dashByCourse = await page.evaluate((cid) => computeTrainingPlanDashboard({ month: '2026-06', courseId: cid, targetDept: '', audience: '' }), courseId);
      assertEqual(dashByCourse.plans.length, 1, 'filtering by courseId should only keep the course-linked plan');
      assertEqual(dashByCourse.overdue.length, 1, 'the course-linked June plan should be reported overdue (under-delivered, month already past)');

      // byInstructor (10/2026, thay cho byDept cũ) — 2 kế hoạch tháng 6 phải tách thành 2 dòng khác nhau:
      // 1 dòng "Nguyễn Thị A / Chuyên viên Đào tạo / Phòng CNTT" (kế hoạch gốc, đã điền "Ghi Nhận Thực
      // Tế" ở kịch bản trước) + 1 dòng "(Chưa gán giảng viên)" (kế hoạch mới vừa thêm, không điền gì).
      const named = dashAll.byInstructor.find((r) => r.instructor === 'Nguyễn Thị A');
      assert(named, `expected a byInstructor row for "Nguyễn Thị A", got keys: ${dashAll.byInstructor.map((r) => r.instructor).join(', ')}`);
      assertEqual(named.jobTitle, 'Chuyên viên Đào tạo', 'byInstructor row should carry the jobTitle of that group');
      assertEqual(named.targetDept, 'Phòng CNTT', 'byInstructor row should carry the targetDept of that group');
      assertEqual(named.participantsSum, 9, 'byInstructor row should sum actualParticipants across its plans');
      assertEqual(named.avgRating, 10, 'byInstructor row should average instructorRating across its plans (only this 1 plan has a rating)');
      const unnamed = dashAll.byInstructor.find((r) => r.instructor === '(Chưa gán giảng viên)');
      assert(unnamed, 'expected a fallback byInstructor row for the plan with no instructor filled in');
      assertEqual(unnamed.avgRating, null, 'a plan with no instructorRating filled in should average to null, not 0');
    });

    await run('tpCategory lọc tpCourseId theo Loại Đào Tạo + category lưu đúng trên bản ghi khi lập kế hoạch', async () => {
      // LỖI ĐÃ XÁC NHẬN PRE-EXISTING KHÔNG LIÊN QUAN (cùng cụm "Nhập Kế Hoạch Từ Excel" đã bị timeout ở
      // 2 kịch bản phía trên — xác nhận qua git stash, không phải do đợt sửa 11/2026 này): luồng parse
      // Excel bị lỗi trong sandbox này để lại tác dụng phụ xoá trắng DB.trainingCategories giữa chừng.
      // Tự nạp lại danh mục ở ĐÂY cho chắc (không phụ thuộc trạng thái còn nguyên vẹn từ baseCatalogSeed())
      // để kịch bản MỚI này không bị ăn theo lỗi môi trường không liên quan.
      await page.evaluate(() => {
        window.__alerts.length = 0;
        if (!(DB.trainingCategories || []).includes('Kỹ năng mềm')) DB.trainingCategories = ['Kỹ năng mềm', 'Nghiệp vụ'];
        setTrainingLmsTab('COURSES');
        populateTrainingCategorySelects();
        document.getElementById('tccCategory').value = 'Kỹ năng mềm';
        document.getElementById('tccName').value = 'Giao Tiếp Hiệu Quả';
      });
      await page.evaluate(() => submitTrainingCourse({ preventDefault() {}, target: { reset() {} } }));
      const softSkillCourseId = await page.evaluate(() => DB.trainingCourses.find((c) => c.name === 'Giao Tiếp Hiệu Quả').id);
      await page.evaluate(() => setTrainingLmsTab('PLANS'));

      await page.evaluate(() => { populateTrainingCategorySelects(); document.getElementById('tpCategory').value = 'Kỹ năng mềm'; filterTrainingPlanCourseOptions(); });
      const optionsFiltered = await page.evaluate(() => [...document.getElementById('tpCourseId').options].map((o) => o.value));
      assert(optionsFiltered.includes(String(softSkillCourseId)), 'lọc theo "Kỹ năng mềm" phải giữ lại chương trình cùng loại');
      assert(!optionsFiltered.includes(String(courseId)), 'lọc theo "Kỹ năng mềm" phải bỏ chương trình "Nghiệp vụ" khác loại');

      await page.evaluate(() => { document.getElementById('tpCategory').value = ''; filterTrainingPlanCourseOptions(); });
      const optionsAll = await page.evaluate(() => [...document.getElementById('tpCourseId').options].map((o) => o.value));
      assert(optionsAll.includes(String(softSkillCourseId)) && optionsAll.includes(String(courseId)), 'để trống Loại Đào Tạo phải hiện lại đủ mọi chương trình');

      await page.evaluate(() => {
        setSelectPairFromMonth('tpMonthNum', 'tpMonthYear', '2026-08');
        document.getElementById('tpCategory').value = 'Kỹ năng mềm';
        document.getElementById('tpCourseId').value = '';
        document.getElementById('tpTargetDept').value = '';
        document.getElementById('tpAudience').value = '';
        document.getElementById('tpPlannedClasses').value = '1';
        document.getElementById('tpPlannedTrainees').value = '1';
        document.getElementById('tpPlannedHours').value = '1';
      });
      await page.evaluate(() => submitTrainingPlan({ preventDefault() {} }));
      const augPlan = await page.evaluate(() => DB.trainingPlans.find((p) => p.month === '2026-08'));
      assert(augPlan, 'expected the August plan to be created');
      assertEqual(augPlan.category, 'Kỹ năng mềm', 'category phải được lưu đúng trên bản ghi');
      // Dọn lại, tránh ảnh hưởng các kịch bản đếm số liệu phía sau (chỉ còn giữ 2 kế hoạch tháng 6 như cũ).
      await page.evaluate((id) => { DB.trainingPlans = DB.trainingPlans.filter((p) => p.id !== id); }, augPlan.id);
      await page.evaluate(() => cancelEditTrainingPlan());
    });

    await run('openEditTrainingPlan(): dữ liệu actualTrainingDate CŨ (chưa có actualTrainingDateFrom) vẫn fallback đúng vào ô "Từ"', async () => {
      const legacyId = await page.evaluate(() => {
        const legacy = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          month: '2026-03', category: '', courseId: null, targetDept: '', audience: '',
          plannedClasses: 0, plannedTrainees: 0, plannedHours: 0,
          instructor: '', jobTitle: '', actualTrainingDate: '2026-03-10', actualDuration: '', actualParticipants: 0,
          instructorRating: null, customData: {}, dept: 'Phòng Nhân Sự', creator: 'gv.linh', creatorName: 'Trần Thị Linh'
        };
        DB.trainingPlans.push(legacy);
        return legacy.id;
      });
      await page.evaluate((id) => openEditTrainingPlan(id), legacyId);
      const fromValue = await page.evaluate(() => document.getElementById('tpActualTrainingDateFrom').value);
      const toValue = await page.evaluate(() => document.getElementById('tpActualTrainingDateTo').value);
      assertEqual(fromValue, '2026-03-10T00:00', 'dữ liệu actualTrainingDate cũ phải fallback vào ô "Từ" kèm giờ 00:00');
      assertEqual(toValue, '', 'ô "Đến" phải để trống cho bản ghi cũ không có dữ liệu khoảng');
      await page.evaluate((id) => { DB.trainingPlans = DB.trainingPlans.filter((p) => p.id !== id); }, legacyId);
      await page.evaluate(() => cancelEditTrainingPlan());
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-training-plans.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
