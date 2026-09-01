// server/tests/test-periodic-report.js
//
// Regression test cho module Báo Cáo Định Kỳ (key 'periodicReport'):
//   - Tạo Kỳ (reportPeriods) — reportManage, phạm vi phòng ban + hạn chót.
//   - Nhập Liệu (reportEntries) — reportEntryCreate, 1 người/1 kỳ (Lưu Nháp -> Gửi, chốt hẳn).
//   - Tổng Hợp (reportAggregate) — chọn+sắp thứ tự báo cáo (mergeReportPeriodAction) -> sửa slide ->
//     Phát hành/Hủy phát hành.
//   - Đối Chiếu Theo Công Việc (mergeReportPeriodByTasksAction, dựng period.taskCompilation từ DB.tasks)
//     — TÁCH RIÊNG khỏi period.compilation ở trên, không publish/slideshow, chỉ xem.
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

// 2 công việc thật của emp_kd — dùng cho kịch bản "Đối Chiếu Theo Công Việc" (mergeReportPeriodByTasks()
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
  let periodId = null;
  let entryId = null;

  try {
    // ===== 1) reportManage tạo Kỳ Báo Cáo, phạm vi 1 phòng ban (happy path) =====
    await run.run('reportManage tạo Kỳ Báo Cáo với phạm vi phòng ban (happy path)', async () => {
      await loginAs(page, HC_PR);
      const result = await page.evaluate(async () => {
        switchTab('periodicReport');
        setPeriodicReportSubTab('PERIODS');
        document.getElementById('prPeriodName').value = 'Báo Cáo Tuần 35/2026';
        const local = new Date(Date.now() + 60 * 24 * 3600 * 1000);
        // datetime-local input cần dạng "YYYY-MM-DDTHH:MM" theo GIỜ ĐỊA PHƯƠNG của trình duyệt.
        const pad = (n) => String(n).padStart(2, '0');
        document.getElementById('prPeriodEndTime').value = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T09:00`;
        const kdIdx = DB.depts.indexOf('Kinh Doanh');
        document.getElementById(`prPeriodDept_${kdIdx}`).checked = true;
        await createReportPeriod({ preventDefault() {} });
        const p = DB.reportPeriods[0];
        return { alerts: window.__alerts, period: p };
      });
      assert(result.period, 'Kỳ báo cáo phải được tạo');
      assertEqual(result.period.status, 'OPEN', 'Kỳ mới tạo phải ở trạng thái OPEN');
      assertEqual(result.period.deptScope.all, false, 'Phạm vi không phải "tất cả phòng ban"');
      assert(result.period.deptScope.depts.includes('Kinh Doanh'), 'Phạm vi phải gồm đúng phòng ban đã chọn (Kinh Doanh)');
      assertIncludes(result.alerts, 'Đã tạo kỳ báo cáo mới', 'Phải có thông báo tạo kỳ thành công');
      periodId = result.period.id;
    });

    // ===== 2) Nhân viên nộp báo cáo: Lưu Nháp rồi Gửi (happy path Nhập Liệu) =====
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

    // ===== 3) Validation: mỗi người chỉ được 1 báo cáo / kỳ (server tự chặn tạo báo cáo thứ 2) =====
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

    // ===== 4) Permission: người không có reportAggregate không tổng hợp được (server tự chặn) =====
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

    // ===== 5) reportManage đóng kỳ sớm (điều kiện bắt buộc trước khi tổng hợp) =====
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

    // ===== 6) reportAggregate tổng hợp theo Báo Cáo đã chọn, sửa 1 slide, rồi Phát Hành/Hủy Phát Hành =====
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

    // ===== 7) Đối Chiếu Theo Công Việc — dựng period.taskCompilation từ DB.tasks, TÁCH RIÊNG khỏi
    // period.compilation (bản tổng hợp CHÍNH THỨC đã phát hành/hủy phát hành ở bước 6 trên) — bấm nút
    // này KHÔNG được đụng gì tới compilation đang có, chỉ ghi vào field taskCompilation riêng. =====
    await run.run('Đối Chiếu Theo Công Việc: dựng period.taskCompilation từ DB.tasks, KHÔNG đụng compilation chính thức', async () => {
      const beforeCompilation = await page.evaluate((pId) => {
        const p = DB.reportPeriods.find(x => x.id === pId);
        return JSON.parse(JSON.stringify(p.compilation));
      }, periodId);

      const result = await page.evaluate(async (pId) => {
        window.__resetCapture();
        prAggCurrentPeriodId = pId;
        await mergeReportPeriodByTasksAction();
        const p = DB.reportPeriods.find(x => x.id === pId);
        const statsSlide = p.taskCompilation.slides.find(s => s.kind === 'TASK_STATS');
        const tasksSlide = p.taskCompilation.slides.find(s => s.kind === 'TASKS');
        return {
          alerts: window.__alerts,
          compilation: p.compilation,
          statsText: statsSlide ? statsSlide.text : null,
          taskItems: tasksSlide ? tasksSlide.items : null
        };
      }, periodId);
      assert(result.statsText, 'Phải có slide thống kê công việc (TASK_STATS) trong taskCompilation');
      assertIncludes(result.statsText, 'Tổng số công việc: 2', 'Phải đếm đúng tổng 2 công việc trong phạm vi kỳ');
      assertIncludes(result.statsText, 'Đã hoàn thành: 1', 'Phải đếm đúng 1 việc đã hoàn thành');
      assertIncludes(result.statsText, 'Đang thực hiện: 1', 'Phải đếm đúng 1 việc đang thực hiện');
      assert(result.taskItems && result.taskItems.length === 2, 'Slide danh sách công việc phải liệt kê đủ 2 việc của nhân viên trong phạm vi kỳ');
      // Hành động này chỉ làm mới khối xem-riêng (im lặng, không alert) — khác các hành động thay đổi
      // bản tổng hợp chính thức (merge/save/publish) vốn đều alert kết quả. Không có warning gì thì
      // window.__alerts phải rỗng.
      assertEqual(result.alerts.length, 0, 'Không alert gì khi đối chiếu thành công (không có cảnh báo ranh giới kỳ)');
      assertEqual(JSON.stringify(result.compilation), JSON.stringify(beforeCompilation), 'compilation (bản tổng hợp chính thức, đã phát hành/hủy phát hành) không được thay đổi gì');
    });

    // ===== 8) Đối Chiếu Theo Công Việc KHÔNG hiện cho người không có quyền quản lý/tổng hợp báo cáo =====
    await run.run('Riêng tư: taskCompilation KHÔNG lộ cho người không có reportManage/reportAggregate', async () => {
      await loginAs(page, EMP_NOAGG);
      const period = await page.evaluate((pId) => DB.reportPeriods.find(x => x.id === pId), periodId);
      assert(!period.taskCompilation, 'Người không có quyền quản lý/tổng hợp không được thấy taskCompilation qua GET /api/data');
      await loginAs(page, AGG1);
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
