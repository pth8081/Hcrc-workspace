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
const { buildPlanImportTemplateWorkbook, parsePlanImportFile } = require('../lib/trainingPlanImport');

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

    await run('an invalid targetDept is rejected server-side', async () => {
      let errMsg = null;
      await page.evaluate(async () => {
        try { await callCreateAction('trainingPlans', { month: '2026-06', targetDept: 'Phòng Không Tồn Tại' }); }
        catch (err) { window.__lastCreateErr = err.message; }
      });
      errMsg = await page.evaluate(() => window.__lastCreateErr);
      assert(errMsg && errMsg.includes('Đơn vị không hợp lệ'), `expected an invalid-dept error, got: ${errMsg}`);
    });

    let planId = null;
    await run('trainer lập kế hoạch tháng 6/2026: 2 lớp / 40 học viên / 16 giờ, gắn Chương Trình + Đơn Vị', async () => {
      await page.evaluate((cid) => {
        window.__alerts.length = 0;
        document.getElementById('tpMonth').value = '2026-06';
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
      assert(previewHTML.includes('⚠️ không khớp'), 'the unmatched course row should show a mismatch indicator');
      assert(previewHTML.includes('⛔ Tháng không hợp lệ'), 'the invalid-month row should be flagged in the preview');

      const countBefore = await page.evaluate(() => DB.trainingPlans.length);
      await page.evaluate(() => confirmTrainingPlanImport());
      const plansAfter = await page.evaluate(() => DB.trainingPlans);
      assertEqual(plansAfter.length, countBefore + 2, 'only the 2 valid-month rows should have been created, the invalid one skipped');
      const nov = plansAfter.find((p) => p.month === '2026-11');
      const dec = plansAfter.find((p) => p.month === '2026-12');
      assert(nov, 'expected the November row to be imported');
      assert(dec, 'expected the December row to be imported');
      assertEqual(nov.courseId, courseId, 'matched course should carry its courseId through the confirm step');
      assertEqual(dec.courseId, null, 'unmatched course name should import with courseId left null, not blocked');
      assert(!plansAfter.some((p) => p.month === 'sai-dinh-dang'), 'the invalid-month row must never reach the server');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đã nhập 2/2 dòng kế hoạch')), `expected an import summary alert, got ${JSON.stringify(alerts)}`);
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
        document.getElementById('tpMonth').value = '2026-06';
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
