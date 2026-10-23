// tests/test-training-report-full.js — Báo Cáo Đào Tạo Tổng Hợp (5 sheet, theo mẫu Excel BP Đào Tạo,
// 11/2026): module-internalcomms-daotao.js::computeTrainingReportFull()/exportTrainingReportFullExcel().
// Khác hẳn test-training-plans.js (test exportTrainingPlanDashboardExcel() — 1 sheet, nguồn trainingPlans)
// — đây là báo cáo MỚI, RIÊNG, nguồn chính trainingClasses/trainingRegistrations/trainingTests (LMS thật)
// + trainingPlans (chỉ dùng cho "Số lớp dự kiến theo kế hoạch" + sheet Giảng Viên Nội Bộ) +
// onboardingProgress (sheet Tân Binh, theo NGƯỜI/giai đoạn — quyết định #4 đã chốt với người dùng).
//
// Dùng chung hạ tầng tests/_harness.js (setup/teardown/makeRunner/baseCatalogSeed/makeUser) — ĐÚNG khuôn
// test-training-plans.js/test-internal-training.js (KHÔNG dùng _harness-contract.js — harness đó chỉ
// khai báo state.collections cho 3 bộ test contract/payment/office-budget, thiếu trainingClasses/
// trainingPlans/onboardingPaths nên POST /api/create/trainingClasses thật sẽ lỗi "Cannot read properties
// of undefined (reading 'unshift')").
//
// Run: node server/tests/test-training-report-full.js
'use strict';

const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8997;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const trainer = makeUser({ username: 'gv.report', name: 'Trần Thị Báo Cáo', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } });

    const seed = baseCatalogSeed();
    await page.evaluate((s) => { Object.assign(DB, s); }, seed);
    await page.evaluate((users) => { DB.users = users; }, [trainer]);
    await page.evaluate((u) => finishLogin(u), trainer);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('PLANS'); });

    let seedResult;
    await run('Seed trực tiếp DB (lớp/đăng ký/test/kế hoạch/onboardingProgress) rồi tính computeTrainingReportFull(2026)', async () => {
      seedResult = await page.evaluate(() => {
        DB.trainingTests = [{ id: 501, title: 'Bài Kiểm Tra Hội Nhập CBNV Mới', questions: [] }];
        DB.trainingClasses = [
          // 2 lớp "Tân Binh" tháng 3/2026, cùng tên lớp (gộp sheet Báo cáo theo Tên lớp+Tháng)
          { id: 901, title: 'Tân Binh', category: 'Tân binh', startTime: '2026-03-05T08:00', endTime: '2026-03-05T17:00',
            capacity: 10, participantGroup: 'CBNV mới', instructor: 'Nguyễn Thị Nga', testId: 501 },
          { id: 902, title: 'Tân Binh', category: 'Tân binh', startTime: '2026-03-20T08:00', endTime: '2026-03-20T17:00',
            capacity: 8, participantGroup: 'CBNV mới', instructor: 'Nguyễn Thị Nga', testId: 501 },
          // 1 lớp thường (không Tân Binh) tháng 3/2026
          { id: 903, title: 'Kỹ Năng Bán Hàng', category: 'Nghiệp vụ', startTime: '2026-03-10T08:00', endTime: '2026-03-10T12:00',
            capacity: 20, participantGroup: '', instructor: 'Trần Văn Bình', testId: null },
          // 1 lớp tháng khác (tháng 5) — không được tính vào tháng 3
          { id: 904, title: 'Kỹ Năng Bán Hàng', category: 'Nghiệp vụ', startTime: '2026-05-01T08:00', endTime: '2026-05-01T12:00',
            capacity: 15, participantGroup: '', instructor: 'Trần Văn Bình', testId: null },
          // 1 lớp năm KHÁC (2025) — không được tính vào báo cáo năm 2026
          { id: 905, title: 'Lớp Năm Cũ', category: 'Nghiệp vụ', startTime: '2025-12-01T08:00', endTime: '2025-12-01T12:00',
            capacity: 5, participantGroup: '', instructor: 'Trần Văn Bình', testId: null }
        ];
        DB.trainingRegistrations = [
          // Lớp 901 (Tân Binh, capacity 10): 2 tham gia, 1 đạt
          { id: 1, classId: 901, creator: 'nv1', result: 'PASSED' },
          { id: 2, classId: 901, creator: 'nv2', result: 'FAILED' },
          { id: 3, classId: 901, creator: 'nv3', result: 'CANCELLED' }, // KHÔNG tính (đã huỷ)
          // Lớp 902 (Tân Binh, capacity 8): 1 tham gia, 1 đạt
          { id: 4, classId: 902, creator: 'nv4', result: 'PASSED' },
          // Lớp 903 (thường, capacity 20): 3 tham gia, 2 đạt
          { id: 5, classId: 903, creator: 'nv5', result: 'PASSED' },
          { id: 6, classId: 903, creator: 'nv6', result: 'PASSED' },
          { id: 7, classId: 903, creator: 'nv7', result: 'FAILED' }
        ];
        DB.trainingPlans = [
          { id: 1, month: '2026-03', plannedClasses: 2, instructor: 'Nguyễn Thị Nga', instructorRating: 4.8,
            actualTrainingDateFrom: '2026-03-05T08:00', actualParticipants: 12, targetDept: '', courseId: null },
          { id: 2, month: '2026-03', plannedClasses: 1, instructor: 'Trần Văn Bình', instructorRating: 4.5,
            actualTrainingDateFrom: '2026-03-10T08:00', actualParticipants: 20, targetDept: '', courseId: null }
        ];
        DB.onboardingPaths = [{ id: 1, name: 'Lộ Trình Tân Binh Mặc Định' }];
        DB.onboardingProgress = [
          { id: 1, employeeName: 'Phạm Văn A', pathId: 1, pathName: 'Lộ Trình Tân Binh Mặc Định', startDate: '2026-03-01',
            stage1Result: 'CONFIRMED', stage1ConfirmedAt: '08/03/2026', stage2Result: 'CONFIRMED', stage2ConfirmedAt: '22/03/2026',
            stage3Evaluation: 'PASSED', stage3EvaluatedAt: '01/05/2026', certificateIssued: true, certificateIssuedAt: '02/05/2026' },
          { id: 2, employeeName: 'Lê Thị B', pathId: 1, pathName: 'Lộ Trình Tân Binh Mặc Định', startDate: '2026-03-15',
            stage1Result: 'CONFIRMED', stage1ConfirmedAt: '22/03/2026', stage2Result: null,
            stage3Evaluation: null, certificateIssued: false },
          // Năm khác — KHÔNG được tính vào báo cáo năm 2026
          { id: 3, employeeName: 'Năm Cũ', pathId: 1, pathName: 'Lộ Trình Tân Binh Mặc Định', startDate: '2025-06-01',
            stage1Result: 'CONFIRMED', stage2Result: 'CONFIRMED', stage3Evaluation: 'PASSED', certificateIssued: true }
        ];
        return computeTrainingReportFull(2026);
      });
      assertEqual(seedResult.detail.length, 4, 'Data chi tiết: phải đúng 4 lớp năm 2026 (loại lớp năm 2025)');
    });

    await run('Data chi tiết: lớp Tân Binh — SL dự kiến/tham gia/đạt + hình thức đánh giá lấy đúng tên bài test', async () => {
      const detail901 = seedResult.detail.find(d => d.durationHours === 9 && d.participantGroup === 'CBNV mới' && d.participated === 2);
      assert(detail901, 'không tìm thấy dòng lớp 901 trong Data chi tiết');
      assertEqual(detail901.expected, 10, 'SL dự kiến (=capacity) sai');
      assertEqual(detail901.passed, 1, 'SL đạt sai (phải loại CANCELLED)');
      assertEqual(detail901.evaluationMethod, 'Bài Kiểm Tra Hội Nhập CBNV Mới', 'Hình thức đánh giá phải lấy đúng tên bài test gắn lớp');
      assert(Math.abs(detail901.participationRate - 0.2) < 1e-9, `Tỉ lệ tham gia sai: ${detail901.participationRate}`);
      assert(Math.abs(detail901.passRate - 0.5) < 1e-9, `Tỉ lệ đạt sai: ${detail901.passRate}`);
      const detail903 = seedResult.detail.find(d => d.className === 'Kỹ Năng Bán Hàng' && d.trainingMonth === 3);
      assertEqual(detail903.evaluationMethod, '', 'Lớp không gắn test phải có hình thức đánh giá rỗng');
    });

    await run('Báo cáo (gộp Tên lớp+Tháng): 2 lớp Tân Binh tháng 3 gộp đúng 1 dòng, không lẫn lớp tháng 5', async () => {
      const tanBinhSummary = seedResult.summary.find(s => s.className === 'Tân Binh' && s.month === 3);
      assert(tanBinhSummary, 'không tìm thấy dòng gộp Tân Binh tháng 3');
      assertEqual(tanBinhSummary.classCount, 2, 'classCount phải = 2');
      assertEqual(tanBinhSummary.expected, 18, 'tổng SL dự kiến phải = 10+8');
      assertEqual(tanBinhSummary.participated, 3, 'tổng SL tham gia phải = 2+1');
      assertEqual(tanBinhSummary.organizedDays, '5,20', 'danh sách ngày tổ chức sai');
      const banHangMar = seedResult.summary.find(s => s.className === 'Kỹ Năng Bán Hàng' && s.month === 3);
      assertEqual(banHangMar.classCount, 1, 'lớp tháng 5 không được gộp lẫn vào dòng tháng 3');
    });

    await run('Báo cáo tổng hợp (theo tháng): tách đúng 2 biến thể có/không tính Tân Binh + tỉ lệ hoàn thành mục tiêu', async () => {
      const march = seedResult.monthRows.find(m => m.month === 3);
      assertEqual(march.plannedClasses, 3, 'plannedClasses tháng 3 phải = 2+1 (tổng trainingPlans)');
      assertEqual(march.totalClasses, 3, 'tổng số lớp thực hiện tháng 3 phải = 3 (2 Tân Binh + 1 thường)');
      assertEqual(march.expected, 38, 'SL dự kiến CÓ Tân Binh phải = 10+8+20');
      assertEqual(march.expectedExTanBinh, 20, 'SL dự kiến KHÔNG Tân Binh phải = 20');
      assertEqual(march.participated, 6, 'SL tham gia CÓ Tân Binh phải = 2+1+3');
      assertEqual(march.participatedExTanBinh, 3, 'SL tham gia KHÔNG Tân Binh phải = 3');
      assert(Math.abs(march.completionRate - 1) < 1e-9, `tỉ lệ hoàn thành mục tiêu tháng 3 phải = 1, got ${march.completionRate}`);
      const may = seedResult.monthRows.find(m => m.month === 5);
      assertEqual(may.totalClasses, 1, 'tháng 5 phải có 1 lớp');
      assertEqual(may.completionRate, '', 'tháng 5 không có kế hoạch -> completionRate phải rỗng');
      assertEqual(seedResult.yearTotal.plannedClasses, 3, 'dòng Tổng Năm: plannedClasses phải = 3 (chỉ tháng 3 có kế hoạch)');
      assertEqual(seedResult.yearTotal.totalClasses, 4, 'dòng Tổng Năm: tổng số lớp thực hiện phải khớp Data chi tiết (4)');
    });

    await run('Báo cáo Tân Binh (theo NGƯỜI/giai đoạn — quyết định #4): đúng trạng thái GĐ1/2/3 + chứng chỉ, loại người năm khác', async () => {
      assertEqual(seedResult.tanBinhRows.length, 2, 'phải đúng 2 người năm 2026 (loại người năm 2025)');
      const personA = seedResult.tanBinhRows.find(r => r.employeeName === 'Phạm Văn A');
      assert(personA.stage1.includes('✅') && personA.stage2.includes('✅') && personA.stage3.includes('✅ Đạt') && personA.certificate.includes('✅'),
        `Phạm Văn A phải đủ cả 3 giai đoạn + chứng chỉ: ${JSON.stringify(personA)}`);
      const personB = seedResult.tanBinhRows.find(r => r.employeeName === 'Lê Thị B');
      assert(personB.stage1.includes('✅') && personB.stage2.includes('⏳') && personB.stage3.includes('⏳') && personB.certificate === '',
        `Lê Thị B chỉ GĐ1 xong, còn lại chờ: ${JSON.stringify(personB)}`);
      assertEqual(seedResult.tanBinhSummary.total, 2, 'tổng số người phải = 2');
      assertEqual(seedResult.tanBinhSummary.stage1Done, 2, 'số người xong GĐ1 phải = 2');
      assertEqual(seedResult.tanBinhSummary.stage2Done, 1, 'số người xong GĐ2 phải = 1');
      assertEqual(seedResult.tanBinhSummary.stage3Done, 1, 'số người xong GĐ3 phải = 1');
    });

    await run('Báo cáo Giảng viên nội bộ (nguồn trainingPlans): gộp đúng theo (giảng viên, tháng)', async () => {
      assertEqual(seedResult.instructorRows.length, 2, 'phải đúng 2 dòng (2 giảng viên x 1 tháng)');
      const ngaRow = seedResult.instructorRows.find(r => r.instructor === 'Nguyễn Thị Nga');
      assertEqual(ngaRow.month, 3, 'tháng sai');
      assertEqual(ngaRow.rating, 4.8, 'điểm đánh giá sai');
      assertEqual(ngaRow.participants, 12, 'SL học viên sai');
    });

    await run('Xuất Excel: đúng 5 sheet theo thứ tự mẫu, đúng tên file, đúng số dòng', async () => {
      const exportResult = await page.evaluate(() => {
        const yearSel = document.getElementById('trYearSelect');
        if (yearSel) { yearSel.innerHTML = '<option value="2026">2026</option>'; yearSel.value = '2026'; }
        let captured = null;
        const orig = window.downloadMultiSheetXlsxFromServer;
        window.downloadMultiSheetXlsxFromServer = (fileName, sheets) => { captured = { fileName, sheets }; };
        exportTrainingReportFullExcel();
        window.downloadMultiSheetXlsxFromServer = orig;
        return captured;
      });
      assertEqual(exportResult.fileName, 'bao_cao_dao_tao_2026.xlsx', 'tên file sai quy ước');
      assertEqual(exportResult.sheets.map(s => s.sheetName).join('|'),
        'Data chi tiết|Báo cáo|Báo cáo Tân binh|Báo cáo tổng hợp|Báo cáo Giảng viên nội bộ', 'thứ tự/tên sheet sai mẫu');
      const detailSheet = exportResult.sheets.find(s => s.sheetName === 'Data chi tiết');
      assertEqual(detailSheet.rows.length, 4, 'sheet Data chi tiết phải có 4 dòng (khớp seed)');
      const monthSheet = exportResult.sheets.find(s => s.sheetName === 'Báo cáo tổng hợp');
      assertEqual(monthSheet.rows.length, 13, 'sheet Báo cáo tổng hợp phải có 13 dòng (12 tháng + Tổng năm)');
    });

    await run('Tạo lớp thật qua form (#tcParticipantGroup) -> lưu đúng field mới qua createValidation.js thật', async () => {
      await page.evaluate(() => { setTrainingLmsTab('CLASSES'); });
      const createResult = await page.evaluate(async () => {
        openTrainingClassForm();
        document.getElementById('tcTitle').value = 'Lớp Test Participant Group';
        document.getElementById('tcCategory').value = 'Nghiệp vụ';
        document.getElementById('tcStart').value = '2026-06-01T08:00';
        document.getElementById('tcEnd').value = '2026-06-01T12:00';
        document.getElementById('tcParticipantGroup').value = 'Trưởng Phòng/Phó Phòng';
        const before = DB.trainingClasses.length;
        await submitTrainingClass({ preventDefault() {}, target: { reset() {} } });
        const created = DB.trainingClasses.find(c => c.title === 'Lớp Test Participant Group');
        return { added: DB.trainingClasses.length - before, participantGroup: created && created.participantGroup, id: created && created.id };
      });
      assertEqual(createResult.added, 1, 'phải tạo thêm đúng 1 lớp');
      assertEqual(createResult.participantGroup, 'Trưởng Phòng/Phó Phòng', 'participantGroup phải được server lưu đúng');

      const editResult = await page.evaluate(async (classId) => {
        openEditTrainingClassModal(classId);
        const populated = document.getElementById('teParticipantGroup').value;
        document.getElementById('teParticipantGroup').value = 'Nhân Viên Mới Sửa Lại';
        await submitEditTrainingClass({ preventDefault() {} });
        const updated = DB.trainingClasses.find(c => c.id === classId);
        return { populated, updatedValue: updated && updated.participantGroup };
      }, createResult.id);
      assertEqual(editResult.populated, 'Trưởng Phòng/Phó Phòng', 'mở form Sửa phải tự điền đúng participantGroup cũ');
      assertEqual(editResult.updatedValue, 'Nhân Viên Mới Sửa Lại', 'sửa xong phải lưu đúng participantGroup mới qua recordActions.js thật');
    });

    assert(pageErrors.length === 0, `Có lỗi JS chưa bắt trong lúc chạy test: ${pageErrors.join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-training-report-full.js');
}

main().catch((err) => { console.error(err); process.exit(1); });
