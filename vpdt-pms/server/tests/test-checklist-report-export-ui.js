// server/tests/test-checklist-report-export-ui.js
//
// Regression test cho UI MỚI v21.1: (1) ô "Nhóm/Hạng mục" (category) tuỳ chọn khi soạn câu hỏi loại QA,
// (2) bộ lọc Siêu Thị + nút "📥 Xuất Theo Mẫu Gốc" ở tab Báo Cáo — dùng testHarness.js (Chromium thật mở
// public/index.html thật + public/js/*.js thật). Route THẬT /api/checklist/export-report (trả file nhị
// phân) đã được kiểm chi tiết ở tests/test-checklist-export.js (HTTP-level, đọc lại bằng ExcelJS) — bài
// test NÀY chỉ xác minh lớp UI (chặn khi thiếu mẫu, gửi ĐÚNG payload lên server) bằng cách chặn
// window.fetch NGAY TRONG TRANG để bắt lại request thay vì dựng thêm route giả cho response nhị phân.
//
// Chạy: node server/tests/test-checklist-report-export-ui.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assertEqual
} = require('./testHarness');

const PORT = 8987;

const REPORTER = { username: 'bc2', name: 'Người Xem Báo Cáo 2', dept: 'Phòng Vận Hành', perms: { checklistTemplateManage: true, checklistReportView: true }, active: true };

const state = createMockState({
  depts: ['Phòng Vận Hành'], stores: ['Siêu thị A', 'Siêu thị B'],
  users: [REPORTER], checklistTemplates: [], checklistSubmissions: []
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
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err && err.stack || String(err)));

  try {
    await loginAs(page, REPORTER);
    await page.evaluate(() => { switchTab('checklist'); setChecklistSubTab('CONFIG'); });

    await run.run('Builder QA: ô "Nhóm/Hạng mục" tồn tại + gõ DOM thật cập nhật đúng checklistBuilderQuestions[].category', async () => {
      const s = await page.evaluate(() => {
        openChecklistTemplateBuilder(null, 'QA');
        addChecklistBuilderQuestion();
        const catInput = document.querySelector('#checklistBuilderQuestionsWrap input[data-arg1="category"]');
        const exists = !!catInput;
        if (catInput) {
          catInput.value = '1. Kiểm soát cảnh quan chung';
          catInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return { exists, category: checklistBuilderQuestions[0]?.category };
      });
      assertEqual(s.exists, true, 'Phải render ra ô nhập Nhóm/Hạng mục cho câu hỏi QA');
      assertEqual(s.category, '1. Kiểm soát cảnh quan chung', 'Gõ vào ô Nhóm phải cập nhật đúng field category trong state');
    });

    await run.run('Tab Báo Cáo: bộ lọc Siêu Thị nạp đúng danh sách từ DB.stores + checklistSubmissions', async () => {
      const s = await page.evaluate(() => {
        DB.checklistSubmissions = [{ storeCode: 'Siêu thị C (chỉ có trong bài nộp, không còn trong DB.stores)' }];
        setChecklistSubTab('REPORT');
        return Array.from(document.getElementById('checklistReportStoreFilter').options).map(o => o.value).sort();
      });
      assertEqual(JSON.stringify(s), JSON.stringify(['Siêu thị A', 'Siêu thị B', 'Siêu thị C (chỉ có trong bài nộp, không còn trong DB.stores)'].sort()), 'Phải gộp cả DB.stores VÀ mọi storeCode từng có bài nộp (kể cả siêu thị không còn trong danh mục hiện tại)');
    });

    await run.run('Xuất Theo Mẫu Gốc: chưa chọn mẫu cụ thể -> báo lỗi rõ ràng, KHÔNG gọi API', async () => {
      const s = await page.evaluate(async () => {
        let fetchCalled = false;
        const orig = window.fetch;
        window.fetch = (...args) => { fetchCalled = true; return orig(...args); };
        document.getElementById('checklistReportTemplateFilter').value = '';
        await exportChecklistReportByOriginalTemplate();
        window.fetch = orig;
        return { fetchCalled, alerts: window.__alerts.slice() };
      });
      assertEqual(s.fetchCalled, false, 'Chưa chọn mẫu cụ thể thì KHÔNG được gọi API export');
      assertEqual(s.alerts.some(a => a.includes('chọn ĐÚNG 1 mẫu')), true, 'Phải báo rõ lý do (chưa chọn đúng 1 mẫu)');
    });

    await run.run('Xuất Theo Mẫu Gốc: đã chọn mẫu + 2 siêu thị -> gửi ĐÚNG payload lên /api/checklist/export-report', async () => {
      const s = await page.evaluate(async () => {
        DB.checklistTemplates = [{ id: 555, templateCode: 'CL_UI_EXPORT_TEST', templateName: 'Mẫu Test Xuất Báo Cáo', templateKind: 'QA' }];
        renderChecklistReportTab();
        document.getElementById('checklistReportTemplateFilter').value = '555';
        document.getElementById('checklistReportFromDate').value = '2026-09-01';
        document.getElementById('checklistReportToDate').value = '2026-09-30';
        const storeSel = document.getElementById('checklistReportStoreFilter');
        Array.from(storeSel.options).forEach(o => { o.selected = (o.value === 'Siêu thị A' || o.value === 'Siêu thị B'); });

        let capturedUrl = null, capturedBody = null;
        const orig = window.fetch;
        window.fetch = (url, opts) => {
          capturedUrl = url; capturedBody = opts && opts.body ? JSON.parse(opts.body) : null;
          return Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(['fake xlsx content']) });
        };
        await exportChecklistReportByOriginalTemplate();
        window.fetch = orig;
        return { capturedUrl, capturedBody };
      });
      assertEqual(s.capturedUrl, '/api/checklist/export-report', 'Phải gọi ĐÚNG route export-report');
      assertEqual(s.capturedBody.templateId, 555, 'Phải gửi đúng templateId đã chọn');
      assertEqual(JSON.stringify([...s.capturedBody.storeCodes].sort()), JSON.stringify(['Siêu thị A', 'Siêu thị B']), 'Phải gửi đúng danh sách siêu thị đã chọn');
      assertEqual(s.capturedBody.fromDate, '2026-09-01', 'Phải gửi đúng fromDate');
      assertEqual(s.capturedBody.toDate, '2026-09-30', 'Phải gửi đúng toDate');
    });

    await run.run('Xuất Theo Mẫu Gốc: KHÔNG chọn siêu thị nào -> gửi storeCodes=null (server tự hiểu là TẤT CẢ)', async () => {
      const s = await page.evaluate(async () => {
        document.getElementById('checklistReportTemplateFilter').value = '555';
        const storeSel = document.getElementById('checklistReportStoreFilter');
        Array.from(storeSel.options).forEach(o => { o.selected = false; });
        let capturedBody = null;
        const orig = window.fetch;
        window.fetch = (url, opts) => { capturedBody = opts && opts.body ? JSON.parse(opts.body) : null; return Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(['x']) }); };
        await exportChecklistReportByOriginalTemplate();
        window.fetch = orig;
        return capturedBody;
      });
      assertEqual(s.storeCodes, null, 'Không chọn siêu thị nào phải gửi storeCodes=null (server hiểu là tất cả)');
    });

    await run.run('Không có ngoại lệ JS chưa bắt nào phát sinh trong suốt bộ test', async () => {
      assertEqual(jsErrors.length, 0, `Phải không có lỗi JS nào (${jsErrors.join('; ')})`);
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
