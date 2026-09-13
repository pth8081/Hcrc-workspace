// server/tests/test-checklist-deduction-builder-ui.js
//
// Regression test cho UI Builder loại 2 "📉 Trừ Điểm Theo Hạng Mục" (v21.0 — templateKind DEDUCTION,
// mẫu VSATTP) — dùng testHarness.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js
// thật, đi qua route generic /api/create/checklistTemplates thật -> lib/createValidation.js ->
// lib/checklist.js::validateChecklistCategories() THẬT). Khác test-checklist-builder-ui.js (chỉ test
// loại QA cũ) và test-checklist.js (không qua browser).
//
// Kiểm:
//   1. "+ Tạo Mẫu Mới" -> hiện bảng chọn loại mẫu (#checklistKindPickerWrap); chọn "Trừ Điểm Theo Hạng
//      Mục" -> mở builder với khung Câu Hỏi ẨN, khung Hạng Mục HIỆN (đúng ngược với loại QA).
//   2. addChecklistBuilderCategory/addChecklistBuilderSubItem/addChecklistBuilderCriteria dựng đúng cây
//      qua thao tác DOM thật (gõ input, không gán thẳng biến JS) -> renderChecklistBuilderCategories()
//      không lỗi, input phản ánh đúng state.
//   3. Lưu mẫu -> server THẬT (route /api/create/checklistTemplates) chấp nhận, gán đúng templateKind
//      DEDUCTION + categories tree, KHÔNG có trường questions/scoringMode.
//   4. Sửa (edit) 1 mẫu DEDUCTION đã lưu -> builder mở lại đúng loại, KHÔNG hiện khung Câu Hỏi.
//   5. Không có ngoại lệ JS chưa bắt nào phát sinh trong suốt bộ test.
//
// Chạy: node server/tests/test-checklist-deduction-builder-ui.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assertEqual
} = require('./testHarness');

const PORT = 8986;

const MANAGER = { username: 'qltc2', name: 'Quản Lý Checklist 2', dept: 'Phòng Vận Hành', perms: { checklistTemplateManage: true }, active: true };

const state = createMockState({
  depts: ['Phòng Vận Hành'],
  users: [MANAGER],
  checklistTemplates: []
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
    await loginAs(page, MANAGER);
    await page.evaluate(() => { switchTab('checklist'); setChecklistSubTab('CONFIG'); });

    await run.run('"+ Tạo Mẫu Mới" hiện bảng chọn loại mẫu, chọn DEDUCTION -> builder hiện khung Hạng Mục, ẩn khung Câu Hỏi', async () => {
      const s = await page.evaluate(() => {
        openChecklistTemplateCreatePicker();
        const pickerVisible = !document.getElementById('checklistKindPickerWrap').classList.contains('hidden');
        chooseChecklistTemplateKind('DEDUCTION');
        return {
          pickerVisible,
          pickerHiddenAfterChoose: document.getElementById('checklistKindPickerWrap').classList.contains('hidden'),
          builderVisible: !document.getElementById('checklistTemplateBuilderWrap').classList.contains('hidden'),
          categoriesSectionHidden: document.getElementById('checklistBuilderCategoriesSection').classList.contains('hidden'),
          questionsSectionHidden: document.getElementById('checklistBuilderQuestionsSection').classList.contains('hidden'),
          scoringModeWrapHidden: document.getElementById('checklistBuilderScoringModeWrap').classList.contains('hidden'),
          builderKind: checklistBuilderKind
        };
      });
      assertEqual(s.pickerVisible, true, 'Bấm "+ Tạo Mẫu Mới" phải hiện bảng chọn loại');
      assertEqual(s.pickerHiddenAfterChoose, true, 'Chọn loại xong phải ẩn bảng chọn');
      assertEqual(s.builderVisible, true, 'Chọn loại xong phải mở khung soạn mẫu');
      assertEqual(s.categoriesSectionHidden, false, 'DEDUCTION -> khung Hạng Mục phải HIỆN');
      assertEqual(s.questionsSectionHidden, true, 'DEDUCTION -> khung Câu Hỏi phải ẨN');
      assertEqual(s.scoringModeWrapHidden, true, 'DEDUCTION -> ô Chế Độ Chấm Điểm/Ngưỡng Đạt phải ẨN');
      assertEqual(s.builderKind, 'DEDUCTION', 'checklistBuilderKind phải là DEDUCTION');
    });

    await run.run('Dựng cây qua thao tác DOM thật: 1 hạng mục lớn / 2 hạng mục con / tổng 3 tiêu chí', async () => {
      const s = await page.evaluate(() => {
        addChecklistBuilderCategory();
        addChecklistBuilderSubItem(0);
        addChecklistBuilderSubItem(0);
        addChecklistBuilderCriteria(0, 0);
        addChecklistBuilderCriteria(0, 1);
        addChecklistBuilderCriteria(0, 1);
        return {
          catCount: checklistBuilderCategories.length,
          subCount: checklistBuilderCategories[0].subItems.length,
          criteriaCounts: checklistBuilderCategories[0].subItems.map(su => su.criteria.length),
          catNameInputExists: !!document.querySelector('#checklistBuilderCategoriesWrap input[data-arg1="name"]'),
          criteriaTextareaCount: document.querySelectorAll('#checklistBuilderCategoriesWrap textarea[data-arg3="description"]').length
        };
      });
      assertEqual(s.catCount, 1, 'Phải có đúng 1 hạng mục lớn');
      assertEqual(s.subCount, 2, 'Phải có đúng 2 hạng mục con');
      assertEqual(JSON.stringify(s.criteriaCounts), JSON.stringify([1, 2]), 'Hạng mục con 1 có 1 tiêu chí, hạng mục con 2 có 2 tiêu chí');
      assertEqual(s.catNameInputExists, true, 'Phải render ra ô nhập tên hạng mục lớn');
      assertEqual(s.criteriaTextareaCount, 3, 'Phải render đủ 3 ô mô tả tiêu chí (1+2)');
    });

    await run.run('Gõ dữ liệu qua DOM thật (input event, không gán thẳng biến JS) -> state cập nhật đúng', async () => {
      const s = await page.evaluate(() => {
        function setVal(sel, v) { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
        setVal('#checklistBuilderCategoriesWrap input[data-arg1="name"]', 'CHẤT LƯỢNG SẢN PHẨM');
        setVal('#checklistBuilderCategoriesWrap input[data-arg1="maxDeduction"]', '40');
        const subNameInputs = document.querySelectorAll('#checklistBuilderCategoriesWrap input[data-arg2="name"]');
        subNameInputs[0].value = 'Chất lượng cảm quan';
        subNameInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        subNameInputs[1].value = 'Hạn sử dụng';
        subNameInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        const critTextareas = document.querySelectorAll('#checklistBuilderCategoriesWrap textarea[data-arg3="description"]');
        critTextareas.forEach((ta, i) => { ta.value = `Vi phạm số ${i + 1}`; ta.dispatchEvent(new Event('input', { bubbles: true })); });
        return JSON.parse(JSON.stringify(checklistBuilderCategories));
      });
      assertEqual(s[0].name, 'CHẤT LƯỢNG SẢN PHẨM', 'Tên hạng mục lớn phải cập nhật đúng từ DOM');
      assertEqual(s[0].maxDeduction, 40, 'Điểm tối đa hạng mục lớn phải cập nhật đúng (số)');
      assertEqual(s[0].subItems[0].name, 'Chất lượng cảm quan', 'Tên hạng mục con 1 phải đúng');
      assertEqual(s[0].subItems[1].name, 'Hạn sử dụng', 'Tên hạng mục con 2 phải đúng');
      assertEqual(s[0].subItems[0].criteria[0].description, 'Vi phạm số 1', 'Mô tả tiêu chí đầu tiên phải đúng');
      assertEqual(s[0].subItems[1].criteria[1].description, 'Vi phạm số 3', 'Mô tả tiêu chí cuối cùng phải đúng');
    });

    await run.run('Lưu mẫu DEDUCTION -> server THẬT (route /api/create/checklistTemplates) chấp nhận đúng cấu trúc', async () => {
      const saved = await page.evaluate(async () => {
        document.getElementById('checklistBuilderCode').value = 'CL_UI_DEDUCTION';
        document.getElementById('checklistBuilderName').value = 'Checklist Test Trừ Điểm UI';
        document.getElementById('checklistBuilderType').value = 'CONTROL_AUDIT';
        await saveChecklistTemplateBuilder();
        return DB.checklistTemplates.find(t => t.templateCode === 'CL_UI_DEDUCTION');
      });
      assertEqual(!!saved, true, 'Template phải được lưu thành công qua route /api/create/checklistTemplates THẬT');
      assertEqual(saved.templateKind, 'DEDUCTION', 'templateKind phải lưu đúng DEDUCTION');
      assertEqual(saved.scoringMode, null, 'DEDUCTION -> scoringMode phải là null (server tự ép, xem assertTemplateCoreFields())');
      assertEqual(saved.categories.length, 1, 'Phải lưu đúng 1 hạng mục lớn');
      assertEqual(saved.categories[0].subItems.length, 2, 'Phải lưu đúng 2 hạng mục con');
      const allCriteriaIds = saved.categories[0].subItems.flatMap(su => su.criteria.map(c => c.id));
      assertEqual(JSON.stringify(allCriteriaIds), JSON.stringify([1, 2, 3]), 'Server phải tự đánh id toàn cục liên tục 1..3 cho 3 tiêu chí (validateChecklistCategories())');
      assertEqual(saved.questions, undefined, 'Mẫu DEDUCTION KHÔNG được có trường questions');
    });

    await run.run('Sửa (edit) lại mẫu DEDUCTION vừa lưu -> builder mở đúng loại, khung Câu Hỏi vẫn ẨN', async () => {
      const s = await page.evaluate(() => {
        closeChecklistTemplateBuilder();
        const t = DB.checklistTemplates.find(x => x.templateCode === 'CL_UI_DEDUCTION');
        openChecklistTemplateBuilder(t.id);
        return {
          builderKind: checklistBuilderKind,
          categoriesLoaded: checklistBuilderCategories.length,
          questionsSectionHidden: document.getElementById('checklistBuilderQuestionsSection').classList.contains('hidden'),
          categoryNameValue: document.querySelector('#checklistBuilderCategoriesWrap input[data-arg1="name"]').value
        };
      });
      assertEqual(s.builderKind, 'DEDUCTION', 'Mở sửa mẫu DEDUCTION phải nạp đúng checklistBuilderKind');
      assertEqual(s.categoriesLoaded, 1, 'Phải nạp lại đúng 1 hạng mục đã lưu');
      assertEqual(s.questionsSectionHidden, true, 'Sửa mẫu DEDUCTION vẫn phải ẨN khung Câu Hỏi');
      assertEqual(s.categoryNameValue, 'CHẤT LƯỢNG SẢN PHẨM', 'Ô tên hạng mục phải hiện đúng giá trị đã lưu');
    });

    // Route /api/checklist/submissions/* (routes/checklist.js) KHÔNG đi qua generic /api/create hay
    // /api/records mà testHarness.js mô phỏng — nên phần dựng bài làm (renderChecklistDeductionSubmissionForm())
    // được kiểm THUẦN PHÍA CLIENT ở đây (gán thẳng checklistActiveSubmission/checklistActiveTemplateForSubmission
    // rồi gọi render + hàm cập nhật field, không gọi lưu nháp/nộp bài qua mạng) — luồng lưu/nộp bài DEDUCTION
    // ĐÃ được test đầy đủ qua HTTP THẬT ở tests/test-checklist.js ("Finalize DEDUCTION: nộp bài KHÔNG cần ảnh
    // minh chứng").
    await run.run('renderChecklistSubmissionForm() dựng đúng form làm bài DEDUCTION (cây hạng mục/tiêu chí) + cập nhật deductedPoints/riskLevel qua DOM thật', async () => {
      const s = await page.evaluate(() => {
        const t = DB.checklistTemplates.find(x => x.templateCode === 'CL_UI_DEDUCTION');
        checklistActiveTemplateForSubmission = t;
        checklistActiveSubmission = { id: 999999, storeCode: 'ST01', templateId: t.id, deductions: [] };
        document.getElementById('checklistSubmissionFormWrap').classList.remove('hidden');
        renderChecklistSubmissionForm();
        const criteriaRows = document.querySelectorAll('#checklistSubmissionFormWrap input[data-arg1="deductedPoints"]');
        const firstCriteriaId = t.categories[0].subItems[0].criteria[0].id;
        const pointsInput = document.querySelector(`#checklistSubmissionFormWrap input[data-arg0="${firstCriteriaId}"][data-arg1="deductedPoints"]`);
        pointsInput.value = '15';
        pointsInput.dispatchEvent(new Event('input', { bubbles: true }));
        const riskSelect = document.querySelector(`#checklistSubmissionFormWrap select[data-arg0="${firstCriteriaId}"][data-arg1="riskLevel"]`);
        riskSelect.value = 'B';
        riskSelect.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          criteriaRowCount: criteriaRows.length,
          deductions: JSON.parse(JSON.stringify(checklistActiveSubmission.deductions)),
          firstCriteriaId
        };
      });
      assertEqual(s.criteriaRowCount, 3, 'Phải render đủ 3 ô nhập điểm trừ (khớp 3 tiêu chí đã tạo)');
      const d = s.deductions.find(x => x.criteriaId === s.firstCriteriaId);
      assertEqual(!!d, true, 'Phải tạo bản ghi deduction cho tiêu chí vừa nhập điểm');
      assertEqual(d.deductedPoints, 15, 'deductedPoints phải cập nhật đúng từ input DOM thật (input event)');
      assertEqual(d.riskLevel, 'B', 'riskLevel phải cập nhật đúng từ select DOM thật (change event)');
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
