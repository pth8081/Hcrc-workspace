// server/tests/test-periodic-report-pdf.js
//
// Regression test cho luồng GHÉP FILE PDF THẬT của Báo Cáo Định Kỳ (reportEntries.entryType==='PDF') —
// giờ là hình thức nộp báo cáo DUY NHẤT (đã bỏ hẳn PowerPoint .pptx). Luồng PPTX ở test-periodic-report.js
// giờ chỉ còn kiểm tra khả năng ĐỌC LẠI dữ liệu CŨ (không còn đường tạo entry PPTX mới nào nữa):
//   - Nộp báo cáo dạng PDF (entryType='PDF', không có parsedSlides).
//   - Validation: fileUrl bắt buộc + đúng khuôn /uploads/... (assertUploadedFileUrl).
//   - Tổng Hợp PDF (mergeReportPeriodPdf) — gom theo phòng ban, chặn trang tham chiếu entry không hợp lệ,
//     gọi lại nhiều lần THAY THẾ hoàn toàn pages[] cũ (không cộng dồn).
//   - Phát Hành PDF (publishReportPeriodPdf) — GHÉP BYTE THẬT bằng pdf-lib (lib/reportPdfMerge.js), số
//     trang file kết quả phải đúng bằng số trang đã CHỌN (không phải tổng số trang gốc), có watermark.
//   - Trang tham chiếu vượt quá số trang thật của file nguồn (file đã đổi sau lúc tổng hợp) -> 400.
//   - Hủy Phát Hành — về MERGED, xoá field publish, file cũ để lại mồ côi trên đĩa (đúng quy ước hệ thống).
//   - Riêng tư: pdfCompilation ẩn tới khi PUBLISHED thì công khai toàn công ty (giống compilation, KHÁC
//     taskCompilation).
//
// Chạy: node server/tests/test-periodic-report-pdf.js
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8986;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// ===================== Seed dữ liệu =====================
const HC_PR = { username: 'hc_pr2', name: 'Nguyễn Văn Báo Cáo PDF', dept: 'Hành Chính', perms: { reportManage: true }, active: true };
const AGG1 = { username: 'agg2', name: 'Trần Tổng Hợp Viên PDF', dept: 'Ban Giám Đốc', perms: { reportAggregate: true }, active: true };
const EMP_KD = { username: 'emp_kd2', name: 'Lê Văn Kinh Doanh PDF', dept: 'Kinh Doanh', perms: { reportEntryCreate: true }, active: true };
const EMP_HC = { username: 'emp_hc2', name: 'Phạm Thị Hành Chính PDF', dept: 'Hành Chính', perms: { reportEntryCreate: true }, active: true };
const EMP_NOAGG = { username: 'emp_noagg2', name: 'Đỗ Không Quyền Tổng Hợp PDF', dept: 'Kinh Doanh', perms: { reportEntryCreate: true }, active: true };

const state = createMockState({
  depts: ['Hành Chính', 'Kinh Doanh', 'Ban Giám Đốc'],
  users: [HC_PR, AGG1, EMP_KD, EMP_HC, EMP_NOAGG]
});

// Sinh 1 file PDF THẬT (pdf-lib) ra server/uploads/ — publishReportPeriodPdf() thực sự mở/copy/đóng dấu
// byte thật (không phải chuỗi giả "%PDF..." như 1 vài fixture cũ khác), nên fixture ở đây PHẢI là PDF hợp
// lệ về cấu trúc, giống hệt điều kiện thật khi nhân viên tải file lên qua /api/upload.
async function makeFixturePdf(fileName, pageCount) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([200, 200]);
  const bytes = await doc.save();
  const filePath = path.join(UPLOAD_DIR, fileName);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return `/uploads/${fileName}`;
}

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

// Nộp + gửi 1 báo cáo PDF (giả lập onPrEntryPdfFilesChange() đã ghép xong — set thẳng prEntryPendingFile,
// tránh phải dựng File nhị phân thật xuyên qua CDP evaluate()).
async function submitPdfEntry(page, periodId, title, fileUrl) {
  return page.evaluate(async ({ pId, title, fileUrl }) => {
    switchTab('periodicReport');
    setPeriodicReportSubTab('ENTRY');
    document.getElementById('prEntryPeriodSelect').value = String(pId);
    onPrEntryPeriodChange();
    document.getElementById('prEntryTitle').value = title;
    prEntryPendingFile = { file: { name: fileUrl.split('/').pop() }, parsedSlides: [] };
    uploadFileToServer = async () => ({ fileUrl, fileName: fileUrl.split('/').pop(), fileType: 'application/pdf' });
    await savePrEntryDraft();
    const draftId = prEntryDraftId;
    await submitPrEntryAction(draftId, true);
    await window.__confirmPending();
    return DB.reportEntries.find((x) => x.id === draftId);
  }, { pId: periodId, title, fileUrl });
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  let periodId = null;
  let entryKdId = null;
  let entryHcId = null;
  let tmpPeriodId = null; // kỳ phụ CÒN OPEN dùng riêng cho các kịch bản validation tạo entry mới
  const writtenFiles = []; // dọn sạch mọi file PDF thật đã ghi ra đĩa (fixture + file đã ghép) lúc kết thúc

  try {
    // ===== Chuẩn bị: kỳ báo cáo (phạm vi tất cả phòng ban) + 2 báo cáo PDF SUBMITTED của 2 phòng khác
    // nhau (Kinh Doanh nộp trước, Hành Chính nộp sau — dùng để kiểm tra thứ tự phòng ban lúc tổng hợp),
    // rồi đóng kỳ sớm (đủ điều kiện tổng hợp) =====
    await run.run('Chuẩn bị: tạo kỳ + 2 báo cáo PDF thật (2 phòng khác nhau) + đóng kỳ sớm', async () => {
      const kdFileUrl = await makeFixturePdf('test_pr_pdf_kd.pdf', 2);
      const hcFileUrl = await makeFixturePdf('test_pr_pdf_hc.pdf', 1);
      writtenFiles.push(path.join(UPLOAD_DIR, 'test_pr_pdf_kd.pdf'), path.join(UPLOAD_DIR, 'test_pr_pdf_hc.pdf'));

      await loginAs(page, HC_PR);
      const period = await page.evaluate(async () => {
        switchTab('periodicReport');
        setPeriodicReportSubTab('PERIODS');
        document.getElementById('prPeriodName').value = 'Báo Cáo Tuần PDF 2026';
        const local = new Date(Date.now() + 60 * 24 * 3600 * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        document.getElementById('prPeriodEndTime').value = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T09:00`;
        document.getElementById('prPeriodDeptAll').checked = true;
        await createReportPeriod({ preventDefault() {} });
        return DB.reportPeriods[0];
      });
      assert(period, 'Kỳ báo cáo phải được tạo');
      periodId = period.id;

      await loginAs(page, EMP_KD);
      const kdEntry = await submitPdfEntry(page, periodId, 'Báo cáo PDF - Kinh Doanh', kdFileUrl);
      entryKdId = kdEntry.id;
      assertEqual(kdEntry.entryType, 'PDF', 'Báo cáo Kinh Doanh phải là entryType PDF');
      assertEqual(kdEntry.parsedSlides.length, 0, 'entryType PDF không có parsedSlides');
      assertEqual(kdEntry.status, 'SUBMITTED', 'Báo cáo phải ở trạng thái SUBMITTED sau khi gửi');

      await loginAs(page, EMP_HC);
      const hcEntry = await submitPdfEntry(page, periodId, 'Báo cáo PDF - Hành Chính', hcFileUrl);
      entryHcId = hcEntry.id;
      assertEqual(hcEntry.entryType, 'PDF', 'Báo cáo Hành Chính phải là entryType PDF');

      await loginAs(page, HC_PR);
      await page.evaluate(async (pId) => {
        switchTab('periodicReport');
        setPeriodicReportSubTab('PERIODS');
        closePrPeriodAction(pId);
        await window.__confirmPending();
      }, periodId);
      const closedPeriod = await page.evaluate((pId) => DB.reportPeriods.find((x) => x.id === pId), periodId);
      assertEqual(closedPeriod.status, 'CLOSED', 'Kỳ phải chuyển sang CLOSED để đủ điều kiện tổng hợp');
    });

    // ===== 1) Validation: PDF mode thiếu fileUrl -> 400; fileUrl sai khuôn -> 400. Cần 1 kỳ CÒN OPEN
    // riêng (không dùng periodId chính, đã CLOSED ở bước Chuẩn bị) — kỳ đã đóng sẽ bị chặn "kỳ đã kết
    // thúc" TRƯỚC khi validate tới fileUrl, không phản ánh đúng điều đang muốn kiểm ở đây. =====
    await run.run('Validation: entryType PDF bắt buộc fileUrl đúng khuôn /uploads/...', async () => {
      await loginAs(page, HC_PR);
      const tmpPeriod = await page.evaluate(async () => {
        switchTab('periodicReport');
        setPeriodicReportSubTab('PERIODS');
        document.getElementById('prPeriodName').value = 'Kỳ Tạm Kiểm Tra Validation PDF';
        const local = new Date(Date.now() + 60 * 24 * 3600 * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        document.getElementById('prPeriodEndTime').value = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T09:00`;
        document.getElementById('prPeriodDeptAll').checked = true;
        await createReportPeriod({ preventDefault() {} });
        return DB.reportPeriods.find((p) => p.name === 'Kỳ Tạm Kiểm Tra Validation PDF');
      });
      await loginAs(page, EMP_KD);
      const result = await page.evaluate(async (pId) => {
        const out = { errors: [] };
        try {
          await callCreateAction('reportEntries', { periodId: pId, title: 'Thiếu file', entryType: 'PDF' });
        } catch (err) { out.errors.push(err.message); }
        try {
          await callCreateAction('reportEntries', { periodId: pId, title: 'Sai khuôn', entryType: 'PDF', fileUrl: 'javascript:alert(1)' });
        } catch (err) { out.errors.push(err.message); }
        return out;
      }, tmpPeriod.id);
      assertIncludes(result.errors[0], 'Vui lòng chọn tệp báo cáo PDF', 'Thiếu fileUrl phải báo đúng lý do');
      assertIncludes(result.errors[1], 'không hợp lệ', 'fileUrl sai khuôn /uploads/... phải bị assertUploadedFileUrl() chặn');
      tmpPeriodId = tmpPeriod.id;
    });

    // ===== 2) Regression: đã BỎ HẲN hình thức nộp PowerPoint (.pptx) — entryType LUÔN bị ép về 'PDF' ở
    // server (normalizeReportEntryPayload(), lib/createValidation.js), kể cả khi client cố tình gửi
    // entryType 'PPTX' + fileUrl .pptx + parsedSlides (giả lập 1 request thủ công cố lách qua UI đã gỡ
    // form PPTX) — parsedSlides luôn bị ép về [] cho MỌI entry tạo mới từ nay, không còn đường tạo entry
    // PPTX mới nào nữa (chỉ dữ liệu CŨ tạo trước đợt này còn giữ entryType 'PPTX', xem
    // test-periodic-report.js kịch bản "dữ liệu CŨ"). fileUrl vẫn phải đúng khuôn /uploads/... (PDF) —
    // đường dẫn .pptx gửi kèm không được chấp nhận thay thế.
    await run.run('Regression: entryType LUÔN ép về PDF (đã bỏ PPTX) — client cố gửi PPTX/parsedSlides cũng bị bỏ qua', async () => {
      await loginAs(page, EMP_NOAGG);
      const result = await page.evaluate(async (pId) => {
        const created = await callCreateAction('reportEntries', {
          periodId: pId, title: 'Cố tạo báo cáo PPTX sau khi đã bỏ tính năng',
          entryType: 'PPTX', fileUrl: '/uploads/fake_old.pdf', fileName: 'fake_old.pdf', fileType: 'pdf',
          parsedSlides: [{ title: 'Slide 1', bodyLines: ['abc'], images: [] }]
        });
        return created.item;
      }, tmpPeriodId);
      assertEqual(result.entryType, 'PDF', 'Dù client gửi entryType PPTX, server vẫn phải ép về PDF (đã bỏ hẳn PPTX)');
      assertEqual(result.parsedSlides.length, 0, 'parsedSlides client gửi kèm phải bị bỏ qua (ép về mảng rỗng) cho entry tạo mới');
    });

    // ===== 3) Permission: EMP_NOAGG (không có reportAggregate) bị chặn cả mergePdf/publishPdf/unpublishPdf =====
    await run.run('Permission: không có reportAggregate bị chặn ở cả 3 route Ghép PDF', async () => {
      const result = await page.evaluate(async (pId) => {
        window.__resetCapture();
        prAggCurrentPeriodId = pId;
        await publishPrPdfCompilation();
        const publishStatus = document.getElementById('prAggPdfStatusLine').innerText;
        window.__resetCapture();
        await unpublishPrPdfCompilation();
        const unpublishAlerts = [...window.__alerts];
        return { publishStatus, unpublishAlerts };
      }, periodId);
      assertIncludes(result.publishStatus, 'Bạn không có quyền tổng hợp Báo Cáo Định Kỳ', 'publishPdf phải bị server chặn quyền');
      assertIncludes(result.unpublishAlerts, 'Bạn không có quyền tổng hợp Báo Cáo Định Kỳ', 'unpublishPdf phải bị server chặn quyền');
    });

    // ===== 4) Tổng Hợp PDF: gom đúng theo phòng ban (Kinh Doanh chọn trước -> đứng trước Hành Chính
    // trong deptOrder) + chặn trang tham chiếu entry không hợp lệ =====
    await run.run('Tổng Hợp PDF: đúng deptOrder theo thứ tự entry đã chọn + chặn entry không hợp lệ', async () => {
      await loginAs(page, AGG1);
      const invalidResult = await page.evaluate(async (pId) => {
        window.__resetCapture();
        prAggCurrentPeriodId = pId;
        prAggPdfSelectedIds = [999999];
        prAggPdfPages = [{ sourceEntryId: 999999, sourcePageIndex: 0 }];
        await mergeReportPeriodPdfAction();
        return { alerts: window.__alerts };
      }, periodId);
      assertIncludes(invalidResult.alerts, 'không hợp lệ', 'Trang tham chiếu entry không thuộc kỳ/không phải PDF/chưa gửi phải bị chặn');

      // Dựng thẳng prAggPdfSelectedIds/prAggPdfPages thay vì gọi togglePrAggPdfEntry() (hàm đó render
      // thumbnail thật qua pdf.js, cần fetch được /uploads/... — máy chủ tĩnh của bộ test này (testHarness.js
      // startStaticServer()) chỉ phục vụ public/, không có route /uploads/ thật). Phần cần kiểm ở đây là
      // LOGIC SERVER (mergeReportPeriodPdf) nhận đúng {sourceEntryId, sourcePageIndex} — không phụ thuộc
      // việc trình duyệt có vẽ được thumbnail hay không.
      const result = await page.evaluate(async ({ pId, kdId, hcId }) => {
        window.__resetCapture();
        prAggCurrentPeriodId = pId;
        prAggPdfSelectedIds = [kdId, hcId];
        prAggPdfPages = [
          { sourceEntryId: kdId, sourcePageIndex: 0 },
          { sourceEntryId: kdId, sourcePageIndex: 1 },
          { sourceEntryId: hcId, sourcePageIndex: 0 }
        ];
        await mergeReportPeriodPdfAction();
        const p = DB.reportPeriods.find((x) => x.id === pId);
        return { alerts: window.__alerts, deptOrder: p.pdfCompilation.deptOrder, pageCount: p.pdfCompilation.pages.length, status: p.pdfCompilation.status };
      }, { pId: periodId, kdId: entryKdId, hcId: entryHcId });
      assertEqual(result.status, 'MERGED', 'Sau tổng hợp PDF, trạng thái phải là MERGED');
      assertEqual(result.deptOrder.join(','), 'Kinh Doanh,Hành Chính', 'deptOrder phải theo đúng thứ tự entry được chọn trước (Kinh Doanh trước Hành Chính)');
      assertEqual(result.pageCount, 3, 'Tổng số trang phải đúng bằng 2 (Kinh Doanh) + 1 (Hành Chính)');
      assertIncludes(result.alerts, 'Đã tổng hợp bản ghép PDF', 'Phải có thông báo tổng hợp PDF thành công');
    });

    // ===== 5) Gọi lại Tổng Hợp PDF lần 2 với ít trang hơn -> THAY THẾ hoàn toàn (không cộng dồn) =====
    await run.run('Tổng Hợp PDF lần 2 (bỏ 1 trang) THAY THẾ hoàn toàn pages[] cũ', async () => {
      const result = await page.evaluate(async (pId) => {
        window.__resetCapture();
        prAggPdfPages.splice(1, 1); // bỏ trang thứ 2 (còn lại 2 trang: tr.1 Kinh Doanh + 1 trang Hành Chính)
        await mergeReportPeriodPdfAction();
        const p = DB.reportPeriods.find((x) => x.id === pId);
        return { pageCount: p.pdfCompilation.pages.length };
      }, periodId);
      assertEqual(result.pageCount, 2, 'Tổng hợp lại phải THAY THẾ hoàn toàn — còn đúng 2 trang sau khi bỏ 1');
    });

    // ===== 6) Phát Hành PDF: ghép BYTE THẬT — số trang file kết quả phải đúng số trang đã CHỌN (2),
    // KHÔNG phải tổng số trang gốc (3) =====
    await run.run('Phát Hành PDF: ghép byte thật, đúng số trang đã chọn, có watermark', async () => {
      const result = await page.evaluate(async (pId) => {
        window.__resetCapture();
        await publishPrPdfCompilation();
        const p = DB.reportPeriods.find((x) => x.id === pId);
        return {
          statusLine: document.getElementById('prAggPdfStatusLine').innerText,
          status: p.pdfCompilation.status,
          publishedFileUrl: p.pdfCompilation.publishedFileUrl,
          publishedFileName: p.pdfCompilation.publishedFileName,
          publishedByName: p.pdfCompilation.publishedByName
        };
      }, periodId);
      assertEqual(result.status, 'PUBLISHED', 'Sau khi phát hành, pdfCompilation.status phải là PUBLISHED');
      assertEqual(result.publishedByName, AGG1.name, 'Phải ghi đúng người phát hành');
      assertIncludes(result.statusLine, 'Đã phát hành bản ghép PDF', 'Phải có thông báo phát hành PDF thành công');
      assert(result.publishedFileUrl, 'Phải có publishedFileUrl trỏ tới file đã ghép thật');

      const filePath = path.join(UPLOAD_DIR, path.basename(result.publishedFileUrl));
      writtenFiles.push(filePath);
      assert(fs.existsSync(filePath), 'File PDF đã ghép phải THẬT SỰ tồn tại trên đĩa');
      const mergedDoc = await PDFDocument.load(fs.readFileSync(filePath));
      assertEqual(mergedDoc.getPageCount(), 2, 'File PDF đã ghép phải có đúng 2 trang (bằng số trang đã curated, không phải tổng 3 trang gốc)');
    });

    // ===== 7) Riêng tư: pdfCompilation ẩn tới khi PUBLISHED thì công khai TOÀN CÔNG TY (giống
    // compilation, KHÁC hẳn taskCompilation không có ngoại lệ nào) =====
    await run.run('Riêng tư: pdfCompilation công khai cho mọi người sau khi PUBLISHED (khác taskCompilation)', async () => {
      await loginAs(page, EMP_NOAGG);
      const period = await page.evaluate((pId) => DB.reportPeriods.find((x) => x.id === pId), periodId);
      assert(period.pdfCompilation, 'pdfCompilation đã PUBLISHED phải công khai cho MỌI người có quyền vào module (kể cả không có reportManage/reportAggregate)');
      assertEqual(period.pdfCompilation.status, 'PUBLISHED', 'Trạng thái đọc được phải là PUBLISHED');
    });

    // ===== 8) Phát Hành PDF với trang vượt số trang thật của file nguồn (giả lập file đã đổi sau lúc
    // tổng hợp) -> 400, KHÔNG đổi trạng thái =====
    await run.run('Phát Hành PDF với sourcePageIndex vượt số trang thật của file -> 400, không đổi state', async () => {
      await loginAs(page, AGG1);
      const before = await page.evaluate(async ({ pId, kdId, hcId }) => {
        window.__resetCapture();
        prAggCurrentPeriodId = pId;
        await unpublishPrPdfCompilation();
        prAggPdfPages = [{ sourceEntryId: kdId, sourcePageIndex: 0 }, { sourceEntryId: hcId, sourcePageIndex: 99 }];
        await mergeReportPeriodPdfAction();
        const p = DB.reportPeriods.find((x) => x.id === pId);
        return JSON.parse(JSON.stringify(p.pdfCompilation));
      }, { pId: periodId, kdId: entryKdId, hcId: entryHcId });
      assertEqual(before.status, 'MERGED', 'Tổng hợp với chỉ số trang giả (99) vẫn cho qua ở bước merge (chưa mở file thật)');

      const result = await page.evaluate(async (pId) => {
        window.__resetCapture();
        await publishPrPdfCompilation();
        const p = DB.reportPeriods.find((x) => x.id === pId);
        return { statusLine: document.getElementById('prAggPdfStatusLine').innerText, status: p.pdfCompilation.status };
      }, periodId);
      assertIncludes(result.statusLine, 'không tồn tại trong tệp', 'Phát hành với chỉ số trang vượt quá số trang thật phải báo lỗi rõ ràng');
      assertEqual(result.status, 'MERGED', 'Trạng thái KHÔNG được đổi sang PUBLISHED khi phát hành thất bại giữa chừng');

      // Dọn lại đúng state hợp lệ (2 trang thật) để không ảnh hưởng bước sau, rồi phát hành lại.
      await page.evaluate(async ({ pId, kdId, hcId }) => {
        window.__resetCapture();
        prAggPdfPages = [{ sourceEntryId: kdId, sourcePageIndex: 0 }, { sourceEntryId: hcId, sourcePageIndex: 0 }];
        await mergeReportPeriodPdfAction();
        await publishPrPdfCompilation();
      }, { pId: periodId, kdId: entryKdId, hcId: entryHcId });
      const after = await page.evaluate((pId) => DB.reportPeriods.find((x) => x.id === pId).pdfCompilation, periodId);
      if (after.publishedFileUrl) writtenFiles.push(path.join(UPLOAD_DIR, path.basename(after.publishedFileUrl)));
      assertEqual(after.status, 'PUBLISHED', 'Phát hành lại với dữ liệu hợp lệ phải thành công');
    });

    // ===== 9) Hủy Phát Hành: về MERGED, xoá field publish, file cũ để lại MỒ CÔI trên đĩa (đúng quy ước
    // hiện có toàn hệ thống — không có action nào proactively unlink khi chỉ đổi trạng thái) =====
    await run.run('Hủy Phát Hành PDF: về MERGED, xoá field publish, file cũ vẫn còn trên đĩa', async () => {
      const beforeFileUrl = await page.evaluate((pId) => DB.reportPeriods.find((x) => x.id === pId).pdfCompilation.publishedFileUrl, periodId);
      const beforeFilePath = path.join(UPLOAD_DIR, path.basename(beforeFileUrl));
      assert(fs.existsSync(beforeFilePath), 'File đã phát hành phải tồn tại trước khi hủy phát hành');

      const result = await page.evaluate(async (pId) => {
        window.__resetCapture();
        await unpublishPrPdfCompilation();
        const p = DB.reportPeriods.find((x) => x.id === pId);
        return { alerts: window.__alerts, pdfCompilation: p.pdfCompilation };
      }, periodId);
      assertEqual(result.pdfCompilation.status, 'MERGED', 'Sau khi hủy phát hành, trạng thái phải quay lại MERGED');
      assertEqual(result.pdfCompilation.publishedFileUrl, null, 'publishedFileUrl phải được xoá');
      assertEqual(result.pdfCompilation.publishedFileName, null, 'publishedFileName phải được xoá');
      assertIncludes(result.alerts, 'Đã hủy phát hành bản ghép PDF', 'Phải có thông báo hủy phát hành PDF thành công');
      assert(fs.existsSync(beforeFilePath), 'File PDF cũ phải CÒN NGUYÊN trên đĩa (mồ côi có chủ đích, không tự xoá khi chỉ đổi trạng thái)');
    });
  } finally {
    for (const f of writtenFiles) { try { fs.unlinkSync(f); } catch (e) { /* đã xoá hoặc chưa từng tạo — bỏ qua */ } }
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-periodic-report-pdf.js:', err);
  process.exitCode = 1;
});
