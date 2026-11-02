// server/tests/test-checklist-required-bulk-toggle-e2e-indep.js
//
// Bài test THỨ 2, ĐỘC LẬP với tests/test-checklist-required-bulk-toggle.js (viết lại từ đầu, kịch bản
// khác hẳn — không re-run lại đúng bài kia) — do AGENT KIỂM THỬ ĐỘC LẬP viết để audit lại đợt vá v28.83
// (nút "☑️ Bắt Buộc Tất Cả"/"⬜ Bỏ Bắt Buộc Tất Cả" ở builder checklist, setAllChecklistBuilderQuestionsRequired()
// — public/js/module-admin-checklistconfig.js). Dùng Playwright THẬT (Chromium thật mở public/index.html
// thật + toàn bộ public/js/*.js thật) qua tests/testHarness.js — KHÔNG tự đoán lại hành vi, chạy đúng
// code thật và đi qua route generic /api/create/checklistTemplates THẬT (validateAndPrepareCreate() ->
// lib/createValidation.js::checklistTemplates.extraValidate() -> lib/checklist.js::validateChecklistQuestions()
// THẬT) cho mọi lần "Lưu Mẫu".
//
// 4 nhóm kịch bản (đánh số đúng yêu cầu task):
//   1. Tạo mẫu MỚI, thêm 5 câu hỏi (mặc định isRequired:true) -> "Bỏ Bắt Buộc Tất Cả" -> cả 5 câu false
//      (state JS + checkbox DOM) -> tick tay lại ĐÚNG 1 checkbox -> xác nhận thay đổi tay đó KHÔNG bị bulk
//      button "đè" lại, sống sót qua render lại (thêm câu thứ 6) -> bấm THẬT nút "💾 Lưu Mẫu" (click DOM
//      thật, không gọi hàm trực tiếp) -> xác nhận server THẬT lưu đúng isRequired từng câu.
//   2. Đổi Chế Độ Chấm Điểm (SCORED <-> PASS_FAIL_ONLY) trước/sau khi dùng bulk-toggle -> xác nhận 2 tính
//      năng không "đá" nhau: đổi scoring mode KHÔNG tự ý reset lại isRequired, và bulk-toggle không phá vỡ
//      việc ẩn/hiện ô điểm theo đúng chế độ.
//   3. Bấm bulk-toggle khi chưa có câu hỏi nào (builder trống) -> không crash JS, không lỗi console.
//   4. Mô phỏng ĐÚNG bug thật: nạp 1 mẫu NHÁP có sẵn 49 câu isRequired:true (giống seed gốc trước vá) vào
//      luồng SỬA (openChecklistTemplateBuilder(id)) -> "Bỏ Bắt Buộc Tất Cả" -> lưu qua route THẬT
//      POST /api/checklist/templates/:id/edit (gọi lại ĐÚNG 2 hàm thật lib/checklist.js:
//      assertTemplateCoreFields()/validateChecklistQuestions(), mirror routes/checklist.js dòng 97-132 —
//      testHarness.js chung KHÔNG có route này nên tự mô phỏng ở ĐÂY bằng chính hàm thật, không tự đoán
//      lại logic) -> rồi chứng minh bằng CHÍNH lib/checklist.js::computeChecklistScoring()/
//      assertReadyToFinalize() THẬT (không viết lại) rằng 1 bài chỉ trả lời 5/49 câu KHÔNG bị chặn nộp sau
//      khi vá, và CÓ bị chặn (đối chứng) nếu còn isRequired:true như trước khi vá.
//
// Chạy: node server/tests/test-checklist-required-bulk-toggle-e2e-indep.js
'use strict';
const path = require('path');
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assertEqual, assert
} = require('./testHarness');
const checklist = require('../lib/checklist');
const { HttpError } = require('../lib/httpErrors');

const PORT = 8997;
const ADMIN = { username: 'admin', name: 'Admin Checklist', dept: 'Phòng Vận Hành', perms: { admin: true }, active: true };

// ===== Seed mẫu NHÁP mô phỏng ĐÚNG bug thật (49 câu, KHÔNG câu nào đặt isRequired:false — giống
// seedChecklistStoreSelfDaily.js trước vá) — optionId đánh số toàn cục 1..98, ĐÚNG thuật toán
// validateChecklistQuestions() thật (lib/checklist.js) để dữ liệu seed hợp lệ ngay từ đầu.
function buildBugTemplate49Questions() {
  const questions = [];
  let nextOptionId = 1;
  for (let i = 0; i < 49; i++) {
    const passId = nextOptionId++;
    const failId = nextOptionId++;
    questions.push({
      id: i + 1, text: `Câu hỏi tự đánh giá số ${i + 1}`, type: 'SINGLE_CHOICE', displayOrder: i + 1,
      showIfOptionId: null, isRequired: true, maxScore: 10, note: '', category: '',
      options: [
        { id: passId, text: 'Đạt', scoreValue: 10, isPassing: true, isCriticalFail: false, displayOrder: 1 },
        { id: failId, text: 'Không đạt', scoreValue: 0, isPassing: false, isCriticalFail: false, displayOrder: 2 }
      ]
    });
  }
  return {
    id: 9001, templateCode: 'CL_STCH_DAILY_TESTCLONE', templateName: 'Checklist Hàng Ngày GĐST/CHT (Tự Đánh Giá) — bản mô phỏng test',
    templateType: 'STORE_SELF', templateKind: 'QA', status: 'DRAFT', version: 1,
    scoringMode: 'SCORED', passThreshold: null, isAtvstp: false, questions
  };
}

const state = createMockState({
  depts: ['Phòng Vận Hành'],
  users: [ADMIN],
  checklistTemplates: [buildBugTemplate49Questions()]
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

  // ===== Mô phỏng route THẬT POST /api/checklist/templates/:id/edit (mirror ĐÚNG routes/checklist.js
  // dòng 97-132) — testHarness.js chung KHÔNG có route này (chỉ /api/create generic). Gọi lại CHÍNH các
  // hàm thật lib/checklist.js (assertTemplateCoreFields/validateChecklistQuestions), KHÔNG tự đoán lại
  // logic nghiệp vụ — expose qua Node rồi override window.fetch CHỈ cho đúng 1 path này, mọi path khác
  // vẫn rơi về fetch gốc (đã được launchPage() gán, gọi __apiDispatch thật của testHarness.js).
  await page.exposeFunction('__realChecklistEditDispatch', async (templateId, bodyStr) => {
    let body = {};
    try { body = bodyStr ? JSON.parse(bodyStr) : {}; } catch (e) { /* noop */ }
    const list = state.checklistTemplates;
    const idx = list.findIndex(t => t.id === templateId);
    if (idx === -1) return { status: 404, body: { error: 'Không tìm thấy mẫu checklist' } };
    const template = list[idx];
    try {
      if (!checklist.canManageChecklistTemplates(ADMIN)) {
        throw new HttpError(403, 'Bạn không có quyền quản lý Checklist Đánh Giá Siêu Thị');
      }
      if (template.status !== 'DRAFT') {
        throw new HttpError(409, 'Chỉ sửa được checklist đang ở trạng thái Nháp — checklist đã Kích Hoạt/Lưu Trữ phải Nhân Bản thành bản mới để sửa');
      }
      const core = checklist.assertTemplateCoreFields(body);
      if (core.templateCode !== template.templateCode) throw new HttpError(400, 'Không thể đổi Mã checklist sau khi đã tạo');
      const existingKind = template.templateKind || 'QA';
      if (core.templateKind !== existingKind) throw new HttpError(400, 'Không thể đổi loại mẫu sau khi đã tạo');
      let updated;
      if (core.templateKind === 'DEDUCTION') {
        updated = { ...template, ...core, categories: checklist.validateChecklistCategories(body.categories) };
      } else {
        updated = { ...template, ...core, questions: checklist.validateChecklistQuestions(body.questions, core.scoringMode) };
      }
      list[idx] = updated;
      return { status: 200, body: { ok: true, item: updated } };
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
      return { status: 500, body: { error: err.message || 'Lỗi máy chủ không xác định' } };
    }
  });
  await page.evaluate(() => {
    const origFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const m = String(url).match(/^\/api\/checklist\/templates\/(\d+)\/edit$/);
      if (m && method === 'POST') {
        const bodyStr = (opts && typeof opts.body === 'string') ? opts.body : '{}';
        const result = await window.__realChecklistEditDispatch(Number(m[1]), bodyStr);
        return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
      }
      return origFetch(url, opts);
    };
  });

  try {
    await loginAs(page, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('BIZCONFIG'); });

    // ===================== NHÓM 1 =====================
    await run.run('[1a] Mẫu MỚI: thêm 5 câu hỏi -> mặc định CẢ 5 isRequired:true (hành vi gốc, KHÔNG đổi)', async () => {
      const r = await page.evaluate(() => {
        openChecklistTemplateBuilder();
        for (let i = 0; i < 5; i++) addChecklistBuilderQuestion();
        return {
          arr: checklistBuilderQuestions.map(q => q.isRequired),
          checkedCount: [...document.querySelectorAll('#checklistBuilderQuestionsWrap input[data-arg1="isRequired"]')].filter(el => el.checked).length
        };
      });
      assertEqual(JSON.stringify(r.arr), JSON.stringify([true, true, true, true, true]), 'Mặc định thêm câu phải Bắt buộc:true');
      assertEqual(r.checkedCount, 5, 'Cả 5 checkbox DOM phải đang tick');
    });

    await run.run('[1b] Bấm "Bỏ Bắt Buộc Tất Cả" -> cả 5 câu false (state JS + checkbox DOM đồng bộ)', async () => {
      const r = await page.evaluate(() => {
        document.querySelector('[data-op="setAllChecklistBuilderQuestionsRequired"][data-arg0="false"]').click();
        return {
          arr: checklistBuilderQuestions.map(q => q.isRequired),
          checkedCount: [...document.querySelectorAll('#checklistBuilderQuestionsWrap input[data-arg1="isRequired"]')].filter(el => el.checked).length
        };
      });
      assertEqual(JSON.stringify(r.arr), JSON.stringify([false, false, false, false, false]), 'Cả 5 câu phải isRequired:false sau bulk-toggle');
      assertEqual(r.checkedCount, 0, 'Cả 5 checkbox DOM phải bỏ tick');
    });

    await run.run('[1c] Tick tay lại ĐÚNG 1 checkbox (câu thứ 3) -> chỉ đúng câu đó true, không bị bulk-toggle "đè" lại, sống sót qua render lại (thêm câu thứ 6)', async () => {
      const r = await page.evaluate(() => {
        // Click checkbox thật (giống người dùng bấm tay) — không gán .checked trực tiếp, để đúng luồng
        // 'change' event -> data-op-change="updateChecklistBuilderQuestionField" (data-arg-el="2" đọc el.checked).
        const boxes = [...document.querySelectorAll('#checklistBuilderQuestionsWrap input[data-arg1="isRequired"]')];
        boxes[2].click();
        const afterClick = checklistBuilderQuestions.map(q => q.isRequired);
        // Render lại (thêm câu thứ 6) — renderChecklistBuilderQuestions() vẽ lại TOÀN BỘ DOM câu hỏi từ
        // state JS, xác nhận thay đổi tay ở câu 3 không bị mất khi DOM bị vẽ lại.
        addChecklistBuilderQuestion();
        const afterRerender = checklistBuilderQuestions.map(q => q.isRequired);
        const boxesAfter = [...document.querySelectorAll('#checklistBuilderQuestionsWrap input[data-arg1="isRequired"]')].map(el => el.checked);
        return { afterClick, afterRerender, boxesAfter };
      });
      assertEqual(JSON.stringify(r.afterClick), JSON.stringify([false, false, true, false, false]), 'Chỉ đúng câu 3 (index 2) phải true sau khi tick tay');
      assertEqual(JSON.stringify(r.afterRerender), JSON.stringify([false, false, true, false, false, true]), 'Sau khi thêm câu 6 (mặc định true), câu 3 vẫn giữ true, các câu khác vẫn giữ false — KHÔNG bị bulk-toggle cũ "đè" lại');
      assertEqual(JSON.stringify(r.boxesAfter), JSON.stringify([false, false, true, false, false, true]), 'Checkbox DOM vẽ lại phải khớp đúng state JS ở trên');
    });

    await run.run('[1d] Điền đủ thông tin + bấm THẬT nút "💾 Lưu Mẫu" (click DOM, không gọi hàm trực tiếp) -> server THẬT (/api/create/checklistTemplates) lưu đúng isRequired từng câu', async () => {
      await page.evaluate(() => {
        document.getElementById('checklistBuilderCode').value = 'CL_E2E_INDEP_1';
        document.getElementById('checklistBuilderName').value = 'Checklist Test Độc Lập 1';
        document.getElementById('checklistBuilderType').value = 'STORE_SELF';
        checklistBuilderQuestions.forEach((q, i) => { q.text = `Câu hỏi test ${i + 1}`; });
        window.__resetCapture();
        document.querySelector('[data-op="saveChecklistTemplateBuilder"]').click();
      });
      await page.waitForFunction(() => Array.isArray(DB.checklistTemplates) && DB.checklistTemplates.some(t => t.templateCode === 'CL_E2E_INDEP_1'), { timeout: 5000 });
      const saved = await page.evaluate(() => DB.checklistTemplates.find(t => t.templateCode === 'CL_E2E_INDEP_1'));
      assert(!!saved, 'Template phải được lưu thành công qua nút Lưu Mẫu thật');
      assertEqual(JSON.stringify(saved.questions.map(q => q.isRequired)), JSON.stringify([false, false, true, false, false, true]), 'Server THẬT phải lưu đúng isRequired từng câu (bulk-toggle + tick tay), không bị server ép lại thành 1 giá trị chung');
    });

    // ===================== NHÓM 2 =====================
    await run.run('[2a] Mẫu MỚI khác: 3 câu, đổi SCORED -> PASS_FAIL_ONLY -> isRequired KHÔNG bị tự reset', async () => {
      const r = await page.evaluate(() => {
        closeChecklistTemplateBuilder();
        openChecklistTemplateBuilder();
        for (let i = 0; i < 3; i++) addChecklistBuilderQuestion();
        const before = checklistBuilderQuestions.map(q => q.isRequired);
        document.getElementById('checklistBuilderScoringMode').value = 'PASS_FAIL_ONLY';
        onChecklistBuilderScoringModeChange();
        const after = checklistBuilderQuestions.map(q => q.isRequired);
        const hasMaxScoreInput = !!document.querySelector('#checklistBuilderQuestionsWrap input[data-arg1="maxScore"]');
        return { before, after, hasMaxScoreInput };
      });
      assertEqual(JSON.stringify(r.before), JSON.stringify([true, true, true]), 'Trước khi đổi mode: mặc định true');
      assertEqual(JSON.stringify(r.after), JSON.stringify([true, true, true]), 'Đổi SCORED->PASS_FAIL_ONLY KHÔNG được tự đổi isRequired');
      assertEqual(r.hasMaxScoreInput, false, 'PASS_FAIL_ONLY phải ẩn ô Điểm Tối Đa');
    });

    await run.run('[2b] Ở chế độ PASS_FAIL_ONLY: bấm "Bỏ Bắt Buộc Tất Cả" vẫn hoạt động đúng + ô "Bắt buộc" vẫn còn hiện (không bị ẩn theo scoring mode)', async () => {
      const r = await page.evaluate(() => {
        document.querySelector('[data-op="setAllChecklistBuilderQuestionsRequired"][data-arg0="false"]').click();
        return {
          arr: checklistBuilderQuestions.map(q => q.isRequired),
          hasRequiredCheckbox: !!document.querySelector('#checklistBuilderQuestionsWrap input[data-arg1="isRequired"]'),
          hasMaxScoreInput: !!document.querySelector('#checklistBuilderQuestionsWrap input[data-arg1="maxScore"]')
        };
      });
      assertEqual(JSON.stringify(r.arr), JSON.stringify([false, false, false]), 'Bulk-toggle phải hoạt động đúng dù đang ở PASS_FAIL_ONLY');
      assertEqual(r.hasRequiredCheckbox, true, 'Ô "Bắt buộc trả lời" không liên quan tới scoring mode, phải luôn còn');
      assertEqual(r.hasMaxScoreInput, false, 'PASS_FAIL_ONLY vẫn phải ẩn ô Điểm Tối Đa sau bulk-toggle (2 tính năng không phá nhau)');
    });

    await run.run('[2c] Đổi lại PASS_FAIL_ONLY -> SCORED: isRequired vẫn giữ false (không tự bật lại), ô Điểm Tối Đa hiện lại', async () => {
      const r = await page.evaluate(() => {
        document.getElementById('checklistBuilderScoringMode').value = 'SCORED';
        onChecklistBuilderScoringModeChange();
        return {
          arr: checklistBuilderQuestions.map(q => q.isRequired),
          hasMaxScoreInput: !!document.querySelector('#checklistBuilderQuestionsWrap input[data-arg1="maxScore"]')
        };
      });
      assertEqual(JSON.stringify(r.arr), JSON.stringify([false, false, false]), 'Quay lại SCORED KHÔNG được tự bật lại isRequired');
      assertEqual(r.hasMaxScoreInput, true, 'SCORED phải hiện lại ô Điểm Tối Đa');
    });

    await run.run('[2d] Bấm "Bắt Buộc Tất Cả" rồi lưu thật qua PASS_FAIL_ONLY -> server THẬT giữ đúng isRequired:true + ép scoringMode/maxScore/passThreshold đúng luật PASS_FAIL_ONLY', async () => {
      const saved = await page.evaluate(async () => {
        document.getElementById('checklistBuilderScoringMode').value = 'PASS_FAIL_ONLY';
        onChecklistBuilderScoringModeChange();
        document.querySelector('[data-op="setAllChecklistBuilderQuestionsRequired"][data-arg0="true"]').click();
        document.getElementById('checklistBuilderCode').value = 'CL_E2E_INDEP_2';
        document.getElementById('checklistBuilderName').value = 'Checklist Test Độc Lập 2 (PASS_FAIL_ONLY)';
        document.getElementById('checklistBuilderType').value = 'STORE_SELF';
        checklistBuilderQuestions.forEach((q, i) => { q.text = `Câu hỏi PF ${i + 1}`; });
        await saveChecklistTemplateBuilder();
        return DB.checklistTemplates.find(t => t.templateCode === 'CL_E2E_INDEP_2');
      });
      assert(!!saved, 'Template PASS_FAIL_ONLY phải lưu thành công qua route thật');
      assertEqual(saved.scoringMode, 'PASS_FAIL_ONLY', 'scoringMode phải lưu đúng');
      assertEqual(JSON.stringify(saved.questions.map(q => q.isRequired)), JSON.stringify([true, true, true]), 'Bulk-toggle "Bắt Buộc Tất Cả" phải sống sót qua việc lưu ở chế độ PASS_FAIL_ONLY');
      assertEqual(saved.passThreshold, null, 'PASS_FAIL_ONLY vẫn phải ép passThreshold về null (không liên quan gì tới bulk-toggle, xác nhận 2 cơ chế không đụng nhau)');
      assertEqual(saved.questions.every(q => q.maxScore === 0), true, 'PASS_FAIL_ONLY vẫn phải ép maxScore về 0 cho mọi câu');
    });

    // ===================== NHÓM 3 =====================
    await run.run('[3] Builder TRỐNG (0 câu hỏi) -> bấm cả 2 nút bulk-toggle -> KHÔNG crash, state vẫn rỗng', async () => {
      const jsErrorsBefore = jsErrors.length;
      const r = await page.evaluate(() => {
        closeChecklistTemplateBuilder();
        openChecklistTemplateBuilder();
        const lenBefore = checklistBuilderQuestions.length;
        document.querySelector('[data-op="setAllChecklistBuilderQuestionsRequired"][data-arg0="false"]').click();
        document.querySelector('[data-op="setAllChecklistBuilderQuestionsRequired"][data-arg0="true"]').click();
        const lenAfter = checklistBuilderQuestions.length;
        const wrapHtml = document.getElementById('checklistBuilderQuestionsWrap').innerHTML;
        return { lenBefore, lenAfter, wrapHtml };
      });
      assertEqual(r.lenBefore, 0, 'Builder mới mở phải có 0 câu hỏi');
      assertEqual(r.lenAfter, 0, 'Bấm bulk-toggle với 0 câu hỏi KHÔNG được tự tạo ra câu hỏi nào');
      assertEqual(r.wrapHtml.trim(), '', 'Khung câu hỏi vẫn phải trống sau khi bấm bulk-toggle với 0 câu hỏi');
      assertEqual(jsErrors.length, jsErrorsBefore, 'KHÔNG phát sinh lỗi JS (pageerror) nào khi bấm bulk-toggle với builder trống');
    });

    await run.run('[3b] (bổ sung) Bấm THẬT nút "💾 Lưu Mẫu" với 0 câu hỏi -> KHÔNG crash, server THẬT trả lỗi rõ ràng "cần ít nhất 1 câu hỏi" qua alert', async () => {
      await page.evaluate(() => {
        document.getElementById('checklistBuilderCode').value = 'CL_E2E_INDEP_EMPTY';
        document.getElementById('checklistBuilderName').value = 'Checklist Test Rỗng';
        document.getElementById('checklistBuilderType').value = 'STORE_SELF';
        window.__resetCapture();
        document.querySelector('[data-op="saveChecklistTemplateBuilder"]').click();
      });
      await page.waitForFunction(() => window.__alerts && window.__alerts.length > 0, { timeout: 5000 });
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some(a => a.includes('ít nhất 1 câu hỏi')), `Phải báo lỗi rõ ràng từ server thật (validateChecklistQuestions), alerts: ${JSON.stringify(alerts)}`);
      assertEqual(await page.evaluate(() => DB.checklistTemplates.some(t => t.templateCode === 'CL_E2E_INDEP_EMPTY')), false, 'KHÔNG được lưu được mẫu 0 câu hỏi nào');
    });

    // ===================== NHÓM 4 =====================
    let templateAfterFix = null;
    await run.run('[4a] Nạp ĐÚNG mẫu NHÁP mô phỏng bug thật (49 câu, isRequired:true hết) vào luồng SỬA -> builder nạp đúng 49 câu, đúng trạng thái bug', async () => {
      const r = await page.evaluate(() => {
        closeChecklistTemplateBuilder();
        openChecklistTemplateBuilder(9001);
        return {
          count: checklistBuilderQuestions.length,
          allRequired: checklistBuilderQuestions.every(q => q.isRequired === true),
          editingId: checklistBuilderEditingId,
          title: document.getElementById('checklistBuilderTitle').innerText
        };
      });
      assertEqual(r.count, 49, 'Phải nạp đúng 49 câu hỏi từ mẫu bug thật');
      assertEqual(r.allRequired, true, 'Đúng hiện trạng bug: cả 49 câu đều isRequired:true trước khi vá');
      assertEqual(r.editingId, 9001, 'checklistBuilderEditingId phải đúng id mẫu đang sửa (để Lưu gọi route /edit, không phải /create)');
      assert(r.title.includes('Sửa Mẫu Checklist'), 'Tiêu đề builder phải đúng luồng SỬA');
    });

    await run.run('[4b] Bấm "Bỏ Bắt Buộc Tất Cả" trên 49 câu -> cả 49 false (state JS + checkbox DOM)', async () => {
      const r = await page.evaluate(() => {
        document.querySelector('[data-op="setAllChecklistBuilderQuestionsRequired"][data-arg0="false"]').click();
        const boxes = [...document.querySelectorAll('#checklistBuilderQuestionsWrap input[data-arg1="isRequired"]')];
        return {
          allFalseInState: checklistBuilderQuestions.every(q => q.isRequired === false),
          boxCount: boxes.length,
          anyChecked: boxes.some(b => b.checked)
        };
      });
      assertEqual(r.allFalseInState, true, 'Cả 49 câu phải isRequired:false trong state JS sau bulk-toggle');
      assertEqual(r.boxCount, 49, 'Phải render đúng 49 checkbox');
      assertEqual(r.anyChecked, false, 'KHÔNG checkbox nào còn tick');
    });

    await run.run('[4c] Lưu qua route THẬT POST /api/checklist/templates/:id/edit (gọi lại đúng assertTemplateCoreFields()/validateChecklistQuestions() thật) -> xác nhận lưu đúng 49 câu isRequired:false', async () => {
      await page.evaluate(() => {
        window.__resetCapture();
        document.querySelector('[data-op="saveChecklistTemplateBuilder"]').click();
      });
      await page.waitForFunction(() => {
        const t = DB.checklistTemplates && DB.checklistTemplates.find(x => x.id === 9001);
        return !!t && Array.isArray(t.questions) && t.questions.length === 49 && t.questions.every(q => q.isRequired === false);
      }, { timeout: 5000 });
      templateAfterFix = await page.evaluate(() => DB.checklistTemplates.find(t => t.id === 9001));
      assert(!!templateAfterFix, 'Phải lưu được qua route /edit thật');
      assertEqual(templateAfterFix.questions.length, 49, 'Vẫn phải giữ đúng 49 câu hỏi (không mất câu nào qua route edit thật)');
      assertEqual(templateAfterFix.questions.every(q => q.isRequired === false), true, 'Server THẬT (validateChecklistQuestions) phải lưu đúng isRequired:false cho cả 49 câu');
      assertEqual(templateAfterFix.templateCode, 'CL_STCH_DAILY_TESTCLONE', 'templateCode phải giữ bất biến qua route edit thật (đúng chặn ở routes/checklist.js)');
    });

    await run.run('[4d] CHỨNG MINH bằng CHÍNH lib/checklist.js::computeChecklistScoring()/assertReadyToFinalize() THẬT: trả lời 5/49 câu KHÔNG bị chặn SAU vá, NHƯNG CÓ bị chặn (đối chứng) nếu còn isRequired:true như TRƯỚC vá', async () => {
      assert(!!templateAfterFix, 'Cần templateAfterFix từ bước [4c]');
      // Chỉ trả lời 5/49 câu (chọn đáp án "Đạt" — option đầu tiên của mỗi câu) — mô phỏng ĐÚNG tình huống
      // người dùng thật báo cáo: "làm đến đâu tính đến đó", không trả lời hết.
      const partialAnswers = templateAfterFix.questions.slice(0, 5).map(q => ({ questionId: q.id, optionIds: [q.options[0].id] }));

      // SAU VÁ: toàn bộ 49 câu isRequired:false (templateAfterFix) -> KHÔNG được chặn.
      const scoringAfterFix = checklist.computeChecklistScoring(templateAfterFix, partialAnswers);
      assertEqual(scoringAfterFix.missingRequired.length, 0, 'Sau vá: KHÔNG câu nào được tính là "thiếu bắt buộc" (toàn bộ isRequired:false)');
      let threwAfterFix = false;
      try { checklist.assertReadyToFinalize(scoringAfterFix); } catch (e) { threwAfterFix = true; }
      assertEqual(threwAfterFix, false, 'Sau vá: assertReadyToFinalize() THẬT KHÔNG được throw — nhân viên siêu thị nộp được 5/49 câu bình thường');

      // ĐỐI CHỨNG — TRƯỚC VÁ: dựng lại CHÍNH template đó nhưng ép isRequired:true hết (đúng hiện trạng bug
      // gốc sản phẩm thật báo cáo) -> PHẢI bị chặn, để xác nhận hàm thật THỰC SỰ phân biệt được 2 trường
      // hợp (không phải do answers/template có gì khác gây false positive).
      const templateBeforeFix = { ...templateAfterFix, questions: templateAfterFix.questions.map(q => ({ ...q, isRequired: true })) };
      const scoringBeforeFix = checklist.computeChecklistScoring(templateBeforeFix, partialAnswers);
      assertEqual(scoringBeforeFix.missingRequired.length, 44, 'Trước vá (mô phỏng): đúng 44 câu còn thiếu (49 - 5 đã trả lời) bị tính thiếu bắt buộc');
      let threwBeforeFix = false, errMsg = '';
      try { checklist.assertReadyToFinalize(scoringBeforeFix); } catch (e) { threwBeforeFix = true; errMsg = e.message; }
      assertEqual(threwBeforeFix, true, 'Trước vá (mô phỏng): assertReadyToFinalize() THẬT PHẢI throw — đúng y hệt bug người dùng báo cáo (chặn cứng nộp bài)');
      assert(errMsg.includes('44') && errMsg.includes('bắt buộc'), `Thông báo lỗi phải đúng định dạng thật của assertReadyToFinalize() (lib/checklist.js), got: ${errMsg}`);
    });

    await run.run('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong SUỐT bộ test', async () => {
      assertEqual(jsErrors.length, 0, `Phải không có lỗi JS nào: ${jsErrors.join('\n')}`);
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(err => { console.error(err); process.exit(1); });
