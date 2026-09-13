// server/tests/test-checklist-initdatabase-load.js
//
// Regression test cho LỖ HỔNG THẬT phát hiện khi dựng demo module Checklist (v21.1): initDatabase()
// (public/js/core.js) CHƯA TỪNG gán DB.checklistTemplates/DB.checklistSubmissions từ response GET
// /api/data — module-checklist.js đọc thẳng 2 field này (comment đầu file đó ghi rõ "đã nạp sẵn qua GET
// /api/data") nhưng không ai thực sự gán chúng. Mọi hàm đọc đều tự `|| []` nên KHÔNG lỗi JS/crash gì cả
// — hậu quả ÂM THẦM: mẫu/bài nộp đã có SẴN TỪ TRƯỚC (do người khác tạo, hoặc phiên trước của chính mình)
// KHÔNG BAO GIỜ hiện ra sau khi tải lại trang, cho tới khi người dùng tự tạo/sửa 1 bản ghi MỚI ngay
// trong phiên đó (lúc đó checklistApplyTemplateUpdate()/checklistApplySubmissionUpdate() mới tự
// "DB.checklistTemplates = DB.checklistTemplates || []" rồi thêm bản ghi mới vào) — ảnh hưởng MỌI người
// dùng module này kể từ khi module ra đời, không phải lỗi riêng của đợt v21.x. Các bộ test browser khác
// (test-checklist-builder-ui.js/test-checklist-deduction-builder-ui.js) đều seed checklistTemplates:[]
// RỖNG nên chưa từng chạm phải gap này (luôn tạo mới trong phiên, chưa từng kiểm tra tải lại dữ liệu CŨ).
//
// Chạy: node server/tests/test-checklist-initdatabase-load.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assertEqual
} = require('./testHarness');

const PORT = 8988;

const MANAGER = { username: 'qltc3', name: 'Quản Lý Checklist 3', dept: 'Phòng Vận Hành', perms: { checklistTemplateManage: true, checklistReportView: true }, active: true };

// 1 template + 1 submission ĐÃ TỒN TẠI SẴN (mô phỏng dữ liệu do NGƯỜI KHÁC tạo từ trước, hoặc phiên
// trước của chính người dùng) — KHÔNG tạo qua bất kỳ hành động client nào trong bài test này.
const EXISTING_TEMPLATE = {
  id: 777, templateCode: 'CL_EXISTING', templateName: 'Mẫu Đã Tồn Tại Từ Trước', templateType: 'STORE_SELF',
  templateKind: 'QA', scoringMode: 'SCORED', passThreshold: 80, status: 'ACTIVE', version: 1,
  clonedFromTemplateId: null, activatedAt: '10:00:00 1/9/2026', creator: 'nguoikhac', creatorName: 'Người Khác',
  questions: [{ id: 1, text: 'Câu hỏi có sẵn', type: 'SINGLE_CHOICE', displayOrder: 1, showIfOptionId: null, isRequired: true, maxScore: 10, note: '', category: '', options: [{ id: 1, text: 'Đạt', scoreValue: 10, isPassing: true, isCriticalFail: false, displayOrder: 1 }, { id: 2, text: 'Không đạt', scoreValue: 0, isPassing: false, isCriticalFail: false, displayOrder: 2 }] }]
};
const EXISTING_SUBMISSION = {
  id: 888, templateId: 777, templateCode: 'CL_EXISTING', templateName: 'Mẫu Đã Tồn Tại Từ Trước', templateType: 'STORE_SELF', templateVersion: 1,
  storeCode: 'Siêu thị A', submittedByUsername: 'nguoikhac2', submittedByName: 'Người Khác 2',
  status: 'SUBMITTED', answers: [{ questionId: 1, optionIds: [1], note: '' }], deductions: [],
  totalScore: 10, maxPossibleScore: 10, scorePercent: 100, hasCriticalFail: false, isPassed: true,
  startedAt: '10:00:00 1/9/2026', submittedAt: '10:05:00 1/9/2026',
  storeResponseText: null, storeRespondedAt: null, storeRespondedByUsername: null, storeRespondedByName: null
};

const state = createMockState({
  depts: ['Phòng Vận Hành'], stores: ['Siêu thị A'], users: [MANAGER],
  checklistTemplates: [EXISTING_TEMPLATE], checklistSubmissions: [EXISTING_SUBMISSION]
});

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err && err.stack || String(err)));

  try {
    await run.run('Đăng nhập MỚI (chưa từng tạo/sửa gì trong phiên) -> DB.checklistTemplates/checklistSubmissions phải có SẴN dữ liệu đã tồn tại từ trước (không chỉ mảng rỗng chờ hành động đầu tiên)', async () => {
      const s = await page.evaluate(async (u) => {
        window.__resetCapture();
        await proceedAfterAuth(u);
        return {
          templatesCount: (DB.checklistTemplates || []).length,
          submissionsCount: (DB.checklistSubmissions || []).length,
          templateCode: DB.checklistTemplates?.[0]?.templateCode,
          submissionStore: DB.checklistSubmissions?.[0]?.storeCode
        };
      }, MANAGER);
      assertEqual(s.templatesCount, 1, 'DB.checklistTemplates phải có ĐÚNG 1 mẫu đã tồn tại sẵn ngay sau khi đăng nhập (KHÔNG phải mảng rỗng)');
      assertEqual(s.templateCode, 'CL_EXISTING', 'Phải đúng nội dung mẫu đã tồn tại từ trước, không phải dữ liệu client tự tạo');
      assertEqual(s.submissionsCount, 1, 'DB.checklistSubmissions phải có ĐÚNG 1 bài nộp đã tồn tại sẵn ngay sau khi đăng nhập');
      assertEqual(s.submissionStore, 'Siêu thị A', 'Phải đúng nội dung bài nộp đã tồn tại từ trước');
    });

    await run.run('Tab Cấu Hình phải HIỂN THỊ NGAY mẫu đã có sẵn (không cần thao tác gì thêm)', async () => {
      const html = await page.evaluate(() => {
        switchTab('checklist'); setChecklistSubTab('CONFIG');
        return document.getElementById('checklistTemplateListWrap').innerHTML;
      });
      assertEqual(html.includes('Mẫu Đã Tồn Tại Từ Trước'), true, 'Danh sách mẫu phải hiện đúng tên mẫu đã có sẵn ngay khi vào tab Cấu Hình');
    });

    await run.run('Không có ngoại lệ JS chưa bắt nào phát sinh', async () => {
      assertEqual(jsErrors.length, 0, `Phải không có lỗi JS nào (${jsErrors.join('; ')})`);
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
