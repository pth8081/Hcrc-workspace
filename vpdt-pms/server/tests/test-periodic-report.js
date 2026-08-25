// server/tests/test-periodic-report.js
//
// Regression test cho module Báo Cáo Định Kỳ (key 'periodicReport'):
//   - Mẫu Trình Chiếu (reportSlideTemplates) — reportManage tạo trước, chọn lúc "Tạo Kỳ".
//   - Tạo Kỳ (reportPeriods) — reportManage, phạm vi phòng ban + hạn chót + mẫu trình chiếu bắt buộc.
//   - Nhập Liệu (reportEntries) — reportEntryCreate, 1 người/1 kỳ (Lưu Nháp -> Gửi, chốt hẳn).
//   - Tổng Hợp (reportAggregate) — chọn+sắp thứ tự báo cáo (mergeReportPeriodAction) HOẶC tự động theo
//     Công Việc (mergeReportPeriodByTasksAction, dựng slide TASK_STATS/TASKS từ DB.tasks) -> sửa slide
//     -> Phát hành/Hủy phát hành.
//
// Chạy: node server/tests/test-periodic-report.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8983;

// ===================== Seed dữ liệu =====================
const HC_PR = { username: 'hc_pr', name: 'Nguyễn Văn Báo Cáo', dept: 'Hành Chính', perms: { reportManage: true }, active: true };
const AGG1 = { username: 'agg1', name: 'Trần Tổng Hợp Viên', dept: 'Ban Giám Đốc', perms: { reportAggregate: true }, active: true };
const EMP_KD = { username: 'emp_kd', name: 'Lê Văn Kinh Doanh', dept: 'Kinh Doanh', perms: { reportEntryCreate: true }, active: true };
const EMP_NOAGG = { username: 'emp_noagg', name: 'Phạm Không Quyền Tổng Hợp', dept: 'Kinh Doanh', perms: { reportEntryCreate: true }, active: true };

// 2 công việc thật của emp_kd — dùng cho kịch bản "Tổng Hợp Theo Công Việc" (mergeReportPeriodByTasks()
// ở lib/recordActions.js): 1 việc ĐÃ hoàn thành (đếm theo thời điểm STATUS_DONE trong history) + 1
// việc CÒN MỞ (đếm theo deadline nằm trong phạm vi kỳ).
const TASKS = [
  {
    id: 9001, title: 'Chuẩn bị báo giá quý cho khách VIP', status: 'DONE', assignedTo: 'emp_kd', assignedToName: 'Lê Văn Kinh Doanh',
    deadline: null, collaborators: [], history: [{ action: 'STATUS_DONE', time: '09:00:00 1/1/2025' }]
  },
  {
    id: 9002, title: 'Theo dõi công nợ khách hàng tháng này', status: 'DOING', assignedTo: 'emp_kd', assignedToName: 'Lê Văn Kinh Doanh',
    deadline: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(), collaborators: [], history: []
  }
];

const state = createMockState({
  depts: ['Hành Chính', 'Kinh Doanh', 'Ban Giám Đốc'],
  users: [HC_PR, AGG1, EMP_KD, EMP_NOAGG],
  tasks: TASKS
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  let templateId = null;
  let periodId = null;
  let entryId = null;

  try {
    // ===== 1) reportManage tạo Mẫu Trình Chiếu (happy path) =====
    await run.run('reportManage tạo Mẫu Trình Chiếu mới (happy path)', async () => {
      await loginAs(page, HC_PR);
      const result = await page.evaluate(async () => {
        switchTab('periodicReport');
        setPeriodicReportSubTab('TEMPLATES');
        document.getElementById('prTplName').value = 'Mẫu Cam Vàng 2026';
        // Bỏ qua bước đọc tệp thật (ảnh/PDF/PowerPoint) — set thẳng kết quả xử lý như
        // processSlideTemplateFile() sẽ trả về, đúng field {bgImageUrl, isDark} mà submitSlideTemplateForm() đọc.
        pendingSlideTemplateBg = { bgImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', isDark: false };
        await submitSlideTemplateForm({ preventDefault() {} });
        return { alerts: window.__alerts, tpl: DB.reportSlideTemplates[0] };
      });
      assert(result.tpl, 'Mẫu trình chiếu phải được tạo');
      assertEqual(result.tpl.name, 'Mẫu Cam Vàng 2026', 'Phải lưu đúng tên mẫu');
      assertIncludes(result.alerts, 'Đã tạo mẫu trình chiếu mới', 'Phải có thông báo tạo mẫu thành công');
      templateId = result.tpl.id;
    });

    // ===== 2) reportManage tạo Kỳ Báo Cáo, phạm vi 1 phòng ban + mẫu vừa tạo (happy path) =====
    await run.run('reportManage tạo Kỳ Báo Cáo với phạm vi phòng ban + mẫu trình chiếu (happy path)', async () => {
      const result = await page.evaluate(async (tplId) => {
        setPeriodicReportSubTab('PERIODS');
        document.getElementById('prPeriodName').value = 'Báo Cáo Tuần 35/2026';
        const local = new Date(Date.now() + 60 * 24 * 3600 * 1000);
        // datetime-local input cần dạng "YYYY-MM-DDTHH:MM" theo GIỜ ĐỊA PHƯƠNG của trình duyệt.
        const pad = (n) => String(n).padStart(2, '0');
        document.getElementById('prPeriodEndTime').value = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T09:00`;
        const kdIdx = DB.depts.indexOf('Kinh Doanh');
        document.getElementById(`prPeriodDept_${kdIdx}`).checked = true;
        document.getElementById('prPeriodSlideTemplate').value = String(tplId);
        await createReportPeriod({ preventDefault() {} });
        const p = DB.reportPeriods[0];
        return { alerts: window.__alerts, period: p };
      }, templateId);
      assert(result.period, 'Kỳ báo cáo phải được tạo');
      assertEqual(result.period.status, 'OPEN', 'Kỳ mới tạo phải ở trạng thái OPEN');
      assertEqual(result.period.deptScope.all, false, 'Phạm vi không phải "tất cả phòng ban"');
      assert(result.period.deptScope.depts.includes('Kinh Doanh'), 'Phạm vi phải gồm đúng phòng ban đã chọn (Kinh Doanh)');
      assertEqual(result.period.slideTemplateId, templateId, 'Phải gắn đúng mẫu trình chiếu đã chọn');
      assertIncludes(result.alerts, 'Đã tạo kỳ báo cáo mới', 'Phải có thông báo tạo kỳ thành công');
      periodId = result.period.id;
    });

    // ===== 3) Validation: tạo kỳ báo cáo mà chưa chọn Mẫu Trình Chiếu (server tự chặn) =====
    await run.run('Validation: tạo Kỳ Báo Cáo khi chưa có Mẫu Trình Chiếu hợp lệ bị chặn', async () => {
      const before = await page.evaluate(() => DB.reportPeriods.length);
      const result = await page.evaluate(async () => {
        window.__resetCapture();
        document.getElementById('prPeriodName').value = 'Kỳ thiếu mẫu';
        const local = new Date(Date.now() + 60 * 24 * 3600 * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        document.getElementById('prPeriodEndTime').value = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T09:00`;
        document.getElementById('prPeriodDeptAll').checked = true;
        // Ép gửi thẳng slideTemplateId không tồn tại — bỏ qua chặn client (dropdown luôn có ít nhất mẫu
        // vừa tạo) để kiểm tra ĐÚNG server tự xác minh lại (extraValidate ở lib/createValidation.js).
        document.getElementById('prPeriodSlideTemplate').innerHTML = '<option value="999999">Mẫu không tồn tại</option>';
        document.getElementById('prPeriodSlideTemplate').value = '999999';
        await createReportPeriod({ preventDefault() {} });
        return { alerts: window.__alerts, count: DB.reportPeriods.length };
      });
      assertIncludes(result.alerts, 'mẫu trình chiếu hợp lệ', 'Phải báo lỗi thiếu/sai mẫu trình chiếu hợp lệ');
      assertEqual(result.count, before, 'Không được tạo thêm kỳ báo cáo nào khi mẫu trình chiếu không hợp lệ');
    });

    // ===== 4) Nhân viên nộp báo cáo: Lưu Nháp rồi Gửi (happy path Nhập Liệu) =====
    await run.run('Nhân viên nhập liệu: Lưu Nháp rồi Gửi Báo Cáo (happy path)', async () => {
      await loginAs(page, EMP_KD);
      // Bỏ qua đọc thật tệp .pptx (JSZip) — set thẳng kết quả như onPrEntryPptxFileChange() sẽ tạo ra,
      // và giả lập luôn bước tải tệp lên server (uploadFileToServer gọi /api/upload thật, không có mock).
      const result = await page.evaluate(async (pId) => {
        switchTab('periodicReport');
        setPeriodicReportSubTab('ENTRY');
        uploadFileToServer = async () => ({ fileUrl: '/uploads/bao-cao-tuan.pptx', fileName: 'bao-cao-tuan.pptx', fileType: 'pptx' });
        document.getElementById('prEntryPeriodSelect').value = String(pId);
        onPrEntryPeriodChange();
        document.getElementById('prEntryTitle').value = 'Báo cáo tuần — Phòng Kinh Doanh';
        prEntryPendingFile = {
          file: { name: 'bao-cao-tuan.pptx' },
          parsedSlides: [{ title: 'Công việc tuần này', bodyLines: ['Chốt đơn hàng ABC', 'Gặp khách hàng XYZ'], images: [] }]
        };
        await savePrEntryDraft();
        const draftId = prEntryDraftId;
        await submitPrEntryAction(draftId, true);
        await window.__confirmPending();
        const e = DB.reportEntries.find(x => x.id === draftId);
        return { alerts: window.__alerts, entry: e };
      }, periodId);
      assert(result.entry, 'Báo cáo phải được tạo');
      assertEqual(result.entry.status, 'SUBMITTED', 'Sau khi Gửi, báo cáo phải chuyển sang SUBMITTED');
      assertEqual(result.entry.parsedSlides.length, 1, 'Phải lưu đúng số slide đã đọc được từ tệp .pptx');
      assertIncludes(result.alerts, 'Đã gửi báo cáo', 'Phải có thông báo gửi báo cáo thành công');
      entryId = result.entry.id;
    });

    // ===== 5) Validation: mỗi người chỉ được 1 báo cáo / kỳ (server tự chặn tạo báo cáo thứ 2) =====
    await run.run('Validation: không được tạo báo cáo thứ 2 cho cùng 1 kỳ (server tự chặn)', async () => {
      const before = await page.evaluate(() => DB.reportEntries.length);
      const result = await page.evaluate(async (pId) => {
        window.__resetCapture();
        // onPrEntryPeriodChange() bình thường sẽ TỰ ẨN form vì đã gửi rồi (đúng UX) — gọi thẳng
        // savePrEntryDraft() (bỏ qua việc ẩn form) để xác minh server ĐỘC LẬP cũng chặn, không chỉ dựa
        // vào UI (đúng triết lý "server tự xác minh lại" xuyên suốt hệ thống).
        document.getElementById('prEntryPeriodSelect').value = String(pId);
        document.getElementById('prEntryTitle').value = 'Báo cáo trùng lần 2';
        prEntryDraftId = null;
        prEntryPendingFile = { file: { name: 'khac.pptx' }, parsedSlides: [{ title: 'Khác', bodyLines: ['x'], images: [] }] };
        await savePrEntryDraft();
        return { alerts: window.__alerts, count: DB.reportEntries.length };
      }, periodId);
      assertIncludes(result.alerts, 'đã có báo cáo ở kỳ này rồi', 'Phải báo lỗi đã có báo cáo ở kỳ này');
      assertEqual(result.count, before, 'Không được tạo thêm báo cáo nào khi đã có báo cáo cho kỳ này');
    });

    // ===== 6) Permission: người không có reportAggregate không tổng hợp được (server tự chặn) =====
    await run.run('Permission: người không có quyền reportAggregate bị chặn khi tổng hợp kỳ báo cáo', async () => {
      await loginAs(page, EMP_NOAGG);
      const result = await page.evaluate(async ({ pId, eId }) => {
        window.__resetCapture();
        // Không có reportAggregate -> không tự vào được tab Tổng Hợp qua UI; gọi thẳng hàm để kiểm tra
        // server tự xác minh lại quyền (đúng khuôn "gọi thẳng hàm onclick" khi UI đã ẩn nút đi).
        prAggCurrentPeriodId = pId;
        prAggSelectedIds = [eId];
        await mergeReportPeriodAction();
        return { alerts: window.__alerts };
      }, { pId: periodId, eId: entryId });
      assertIncludes(result.alerts, 'Bạn không có quyền tổng hợp Báo Cáo Định Kỳ', 'Server phải chặn người không có quyền reportAggregate');
    });

    // ===== 7) reportManage đóng kỳ sớm (điều kiện bắt buộc trước khi tổng hợp) =====
    await run.run('reportManage đóng kỳ báo cáo sớm (OPEN -> CLOSED)', async () => {
      await loginAs(page, HC_PR);
      const result = await page.evaluate(async (pId) => {
        switchTab('periodicReport');
        setPeriodicReportSubTab('PERIODS');
        closePrPeriodAction(pId);
        await window.__confirmPending();
        const p = DB.reportPeriods.find(x => x.id === pId);
        return { alerts: window.__alerts, status: p.status };
      }, periodId);
      assertEqual(result.status, 'CLOSED', 'Kỳ báo cáo phải chuyển sang CLOSED sau khi đóng sớm');
      assertIncludes(result.alerts, 'Đã đóng kỳ báo cáo', 'Phải có thông báo đóng kỳ thành công');
    });

    // ===== 8) reportAggregate tổng hợp theo Báo Cáo đã chọn, sửa 1 slide, rồi Phát Hành/Hủy Phát Hành =====
    await run.run('Tổng Hợp Theo Báo Cáo: chọn+sắp thứ tự, sửa slide, Phát Hành rồi Hủy Phát Hành', async () => {
      await loginAs(page, AGG1);
      const mergeResult = await page.evaluate(async ({ pId, eId }) => {
        switchTab('periodicReport');
        setPeriodicReportSubTab('AGGREGATE');
        document.getElementById('prAggPeriodSelect').value = String(pId);
        onPrAggPeriodChange();
        togglePrAggEntry(eId, true);
        await mergeReportPeriodAction();
        const p = DB.reportPeriods.find(x => x.id === pId);
        return {
          alerts: window.__alerts,
          compilationStatus: p.compilation.status,
          slideKinds: p.compilation.slides.map(s => s.kind),
          pptxTitle: p.compilation.slides.find(s => s.kind === 'PPTX_SLIDE')?.title
        };
      }, { pId: periodId, eId: entryId });
      assertEqual(mergeResult.compilationStatus, 'MERGED', 'Sau khi tổng hợp, trạng thái bản tổng hợp phải là MERGED');
      assertIncludes(mergeResult.slideKinds.join(','), 'COVER', 'Bản tổng hợp phải có trang bìa (COVER)');
      assertIncludes(mergeResult.slideKinds.join(','), 'PPTX_SLIDE', 'Bản tổng hợp phải có slide nội dung lấy từ báo cáo .pptx đã nộp');
      assertEqual(mergeResult.pptxTitle, 'Công việc tuần này', 'Slide PPTX phải giữ đúng tiêu đề đã đọc từ báo cáo gốc');
      assertIncludes(mergeResult.alerts, 'Đã tổng hợp', 'Phải có thông báo tổng hợp thành công');

      const editResult = await page.evaluate(async (pId) => {
        window.__resetCapture();
        const coverIdx = prAggPendingSlides.findIndex(s => s.kind === 'COVER');
        prAggPendingSlides[coverIdx].title = 'BÁO CÁO TUẦN 35/2026 (đã chỉnh sửa)';
        await savePrCompilation();
        const p = DB.reportPeriods.find(x => x.id === pId);
        return { alerts: window.__alerts, coverTitle: p.compilation.slides.find(s => s.kind === 'COVER').title, updatedByName: p.compilation.updatedByName };
      }, periodId);
      assertEqual(editResult.coverTitle, 'BÁO CÁO TUẦN 35/2026 (đã chỉnh sửa)', 'Slide trang bìa phải được cập nhật đúng nội dung mới');
      assertEqual(editResult.updatedByName, AGG1.name, 'Phải ghi đúng người vừa sửa bản tổng hợp');
      assertIncludes(editResult.alerts, 'Đã lưu chỉnh sửa', 'Phải có thông báo lưu chỉnh sửa thành công');

      const publishResult = await page.evaluate(async (pId) => {
        window.__resetCapture();
        publishPrCompilation();
        await window.__confirmPending();
        const p = DB.reportPeriods.find(x => x.id === pId);
        return { alerts: window.__alerts, status: p.compilation.status, publishedByName: p.compilation.publishedByName };
      }, periodId);
      assertEqual(publishResult.status, 'PUBLISHED', 'Sau khi phát hành, trạng thái bản tổng hợp phải là PUBLISHED');
      assertEqual(publishResult.publishedByName, AGG1.name, 'Phải ghi đúng người phát hành');
      assertIncludes(publishResult.alerts, 'Đã phát hành', 'Phải có thông báo phát hành thành công');

      const unpublishResult = await page.evaluate(async (pId) => {
        window.__resetCapture();
        unpublishPrCompilation();
        await window.__confirmPending();
        const p = DB.reportPeriods.find(x => x.id === pId);
        return { alerts: window.__alerts, status: p.compilation.status, publishedByName: p.compilation.publishedByName };
      }, periodId);
      assertEqual(unpublishResult.status, 'MERGED', 'Sau khi hủy phát hành, trạng thái phải quay lại MERGED (sửa tiếp được)');
      assertEqual(unpublishResult.publishedByName, null, 'Thông tin người phát hành phải được xoá sau khi hủy phát hành');
      assertIncludes(unpublishResult.alerts, 'Đã hủy phát hành', 'Phải có thông báo hủy phát hành thành công');
    });

    // ===== 9) Tổng Hợp Theo Công Việc — dựng lại compilation từ DB.tasks (view thống kê TASK_STATS) =====
    await run.run('Tổng Hợp Theo Công Việc: tự động dựng slide thống kê + danh sách công việc từ DB.tasks', async () => {
      const result = await page.evaluate(async (pId) => {
        window.__resetCapture();
        prAggCurrentPeriodId = pId;
        await mergeReportPeriodByTasksAction(); // đã có bản MERGED trước đó (theo Báo Cáo) -> hàm tự confirm() thay thế, confirm() đã stub luôn trả true
        const p = DB.reportPeriods.find(x => x.id === pId);
        const statsSlide = p.compilation.slides.find(s => s.kind === 'TASK_STATS');
        const tasksSlide = p.compilation.slides.find(s => s.kind === 'TASKS');
        return {
          alerts: window.__alerts,
          compilationStatus: p.compilation.status,
          statsText: statsSlide ? statsSlide.text : null,
          taskItems: tasksSlide ? tasksSlide.items : null
        };
      }, periodId);
      assertEqual(result.compilationStatus, 'MERGED', 'Tổng hợp theo Công Việc cũng phải đưa bản tổng hợp về trạng thái MERGED');
      assert(result.statsText, 'Phải có slide thống kê công việc (TASK_STATS)');
      assertIncludes(result.statsText, 'Tổng số công việc: 2', 'Phải đếm đúng tổng 2 công việc trong phạm vi kỳ');
      assertIncludes(result.statsText, 'Đã hoàn thành: 1', 'Phải đếm đúng 1 việc đã hoàn thành');
      assertIncludes(result.statsText, 'Đang thực hiện: 1', 'Phải đếm đúng 1 việc đang thực hiện');
      assert(result.taskItems && result.taskItems.length === 2, 'Slide danh sách công việc phải liệt kê đủ 2 việc của nhân viên trong phạm vi kỳ');
      assertIncludes(result.alerts, 'Đã tổng hợp theo Công Việc', 'Phải có thông báo tổng hợp theo Công Việc thành công');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-periodic-report.js:', err);
  process.exitCode = 1;
});
