// server/tests/test-checklist-builder-ui.js
//
// Regression test cho UI "🛠️ Cấu Hình" của module Checklist Đánh Giá Siêu Thị (v20.9 — scoringMode +
// trừ điểm) — dùng testHarness.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js
// thật, "🄼🄾🄲🄺 backend" nhưng ĐI QUA route generic /api/create/checklistTemplates thật (real
// validateAndPrepareCreate() -> lib/createValidation.js::checklistTemplates.extraValidate() ->
// lib/checklist.js::assertTemplateCoreFields()/validateChecklistQuestions() THẬT) — khác
// tests/test-checklist.js (chạy thẳng routes/checklist.js qua HTTP, không qua browser).
//
// Kiểm:
//   1. Builder UI hiện ô "Chế Độ Chấm Điểm" + đổi sang PASS_FAIL_ONLY thì ẩn hết ô nhập điểm tối đa/điểm
//      đáp án/ngưỡng đạt %.
//   2. Lưu mẫu SCORED với 1 đáp án mang điểm ÂM (trừ điểm "yêu cầu vàng") -> server THẬT chấp nhận
//      nguyên vẹn, không bị ép về 0/dương.
//   3. Lưu mẫu PASS_FAIL_ONLY -> server THẬT ép cứng maxScore/scoreValue về 0 + passThreshold về null,
//      bất kể client trót còn gửi số cũ (builder ẩn ô nhưng KHÔNG xoá field khỏi state JS đang soạn).
//
// Chạy: node server/tests/test-checklist-builder-ui.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assertEqual
} = require('./testHarness');

const PORT = 8985;

const MANAGER = { username: 'qltc1', name: 'Quản Lý Checklist', dept: 'Phòng Vận Hành', perms: { checklistTemplateManage: true }, active: true };

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
    await page.evaluate(() => { switchTab('checklist'); setChecklistSubTab('CONFIG'); openChecklistTemplateBuilder(); });

    await run.run('Builder: mặc định chế độ "Có chấm điểm" -> ô Ngưỡng Điểm Đạt hiện, ô điểm câu hỏi hiện sau khi thêm câu', async () => {
      const state1 = await page.evaluate(() => {
        addChecklistBuilderQuestion();
        return {
          scoringMode: document.getElementById('checklistBuilderScoringMode').value,
          thresholdHidden: document.getElementById('checklistBuilderPassThresholdWrap').classList.contains('hidden'),
          hasMaxScoreInput: !!document.querySelector('#checklistBuilderQuestionsWrap input[data-arg1="maxScore"]'),
          hasScoreValueInput: !!document.querySelector('#checklistBuilderQuestionsWrap input[data-arg2="scoreValue"]')
        };
      });
      assertEqual(state1.scoringMode, 'SCORED', 'Mặc định phải là SCORED');
      assertEqual(state1.thresholdHidden, false, 'SCORED -> ô Ngưỡng Điểm Đạt phải HIỆN');
      assertEqual(state1.hasMaxScoreInput, true, 'SCORED -> ô Điểm Tối Đa câu hỏi phải HIỆN');
      assertEqual(state1.hasScoreValueInput, true, 'SCORED -> ô Điểm đáp án phải HIỆN');
    });

    await run.run('Builder: đổi sang PASS_FAIL_ONLY -> ẩn hết ô Ngưỡng Đạt/Điểm Tối Đa/Điểm Đáp Án (không xoá field khỏi state JS đang soạn)', async () => {
      const state2 = await page.evaluate(() => {
        document.getElementById('checklistBuilderScoringMode').value = 'PASS_FAIL_ONLY';
        onChecklistBuilderScoringModeChange();
        return {
          thresholdHidden: document.getElementById('checklistBuilderPassThresholdWrap').classList.contains('hidden'),
          hasMaxScoreInput: !!document.querySelector('#checklistBuilderQuestionsWrap input[data-arg1="maxScore"]'),
          hasScoreValueInput: !!document.querySelector('#checklistBuilderQuestionsWrap input[data-arg2="scoreValue"]'),
          // isPassing/isCriticalFail vẫn phải còn — đây là 2 cờ DUY NHẤT còn ý nghĩa ở chế độ này.
          hasIsPassingCheckbox: !!document.querySelector('#checklistBuilderQuestionsWrap input[data-arg2="isPassing"]'),
          questionsInMemory: checklistBuilderQuestions.length
        };
      });
      assertEqual(state2.thresholdHidden, true, 'PASS_FAIL_ONLY -> ô Ngưỡng Điểm Đạt phải ẨN');
      assertEqual(state2.hasMaxScoreInput, false, 'PASS_FAIL_ONLY -> ô Điểm Tối Đa câu hỏi phải ẨN');
      assertEqual(state2.hasScoreValueInput, false, 'PASS_FAIL_ONLY -> ô Điểm đáp án phải ẨN');
      assertEqual(state2.hasIsPassingCheckbox, true, 'PASS_FAIL_ONLY -> ô "Đạt" vẫn phải còn (cờ duy nhất còn ý nghĩa)');
      assertEqual(state2.questionsInMemory, 1, 'Đổi chế độ KHÔNG được xoá câu hỏi đang soạn dở khỏi bộ nhớ');
    });

    await run.run('Lưu mẫu SCORED với đáp án mang điểm ÂM (yêu cầu vàng) -> server THẬT giữ nguyên số âm', async () => {
      const saved = await page.evaluate(async () => {
        closeChecklistTemplateBuilder();
        openChecklistTemplateBuilder();
        document.getElementById('checklistBuilderCode').value = 'CL_UI_NEG';
        document.getElementById('checklistBuilderName').value = 'Checklist Test Điểm Âm';
        document.getElementById('checklistBuilderType').value = 'STORE_SELF';
        document.getElementById('checklistBuilderScoringMode').value = 'SCORED';
        onChecklistBuilderScoringModeChange();
        addChecklistBuilderQuestion();
        checklistBuilderQuestions[0].text = 'Có tuân thủ PCCC không?';
        checklistBuilderQuestions[0].maxScore = 0;
        checklistBuilderQuestions[0].options[0].scoreValue = 0;
        checklistBuilderQuestions[0].options[1].scoreValue = -20;
        checklistBuilderQuestions[0].options[1].isCriticalFail = true;
        await saveChecklistTemplateBuilder();
        return DB.checklistTemplates.find(t => t.templateCode === 'CL_UI_NEG');
      });
      assertEqual(!!saved, true, 'Template phải được lưu thành công qua route /api/create/checklistTemplates THẬT');
      assertEqual(saved.scoringMode, 'SCORED', 'scoringMode phải lưu đúng SCORED');
      assertEqual(saved.questions[0].options[1].scoreValue, -20, 'Server THẬT phải giữ nguyên điểm ÂM (-20), không ép về 0/dương');
    });

    await run.run('Lưu mẫu PASS_FAIL_ONLY -> server THẬT ép cứng maxScore/scoreValue về 0 + passThreshold về null', async () => {
      const saved = await page.evaluate(async () => {
        closeChecklistTemplateBuilder();
        openChecklistTemplateBuilder();
        document.getElementById('checklistBuilderCode').value = 'CL_UI_PF';
        document.getElementById('checklistBuilderName').value = 'Checklist Test Pass/Fail';
        document.getElementById('checklistBuilderType').value = 'STORE_SELF';
        document.getElementById('checklistBuilderScoringMode').value = 'PASS_FAIL_ONLY';
        onChecklistBuilderScoringModeChange();
        document.getElementById('checklistBuilderPassThreshold').value = '80'; // cố tình còn giá trị cũ trong DOM (đã ẩn, KHÔNG đọc khi lưu)
        addChecklistBuilderQuestion();
        checklistBuilderQuestions[0].text = 'Đồng phục có đúng quy định không?';
        // Mô phỏng field CŨ vẫn còn "sót" trong state JS đang soạn (builder ẩn ô nhưng object questions[]
        // KHÔNG bị xoá field, xem chú thích trên) — server phải tự ép về 0, không tin nguyên state JS gửi lên.
        checklistBuilderQuestions[0].maxScore = 50;
        checklistBuilderQuestions[0].options[0].scoreValue = 999;
        checklistBuilderQuestions[0].options[1].scoreValue = -50;
        await saveChecklistTemplateBuilder();
        return DB.checklistTemplates.find(t => t.templateCode === 'CL_UI_PF');
      });
      assertEqual(!!saved, true, 'Template phải được lưu thành công');
      assertEqual(saved.scoringMode, 'PASS_FAIL_ONLY', 'scoringMode phải lưu đúng PASS_FAIL_ONLY');
      assertEqual(saved.passThreshold, null, 'Server THẬT phải ép passThreshold về null');
      assertEqual(saved.questions[0].maxScore, 0, 'Server THẬT phải ép maxScore về 0 dù state JS còn "sót" giá trị 50');
      assertEqual(saved.questions[0].options[0].scoreValue, 0, 'Server THẬT phải ép scoreValue đáp án Đạt về 0 dù state JS còn "sót" giá trị 999');
      assertEqual(saved.questions[0].options[1].scoreValue, 0, 'Server THẬT phải ép scoreValue đáp án Không đạt về 0 dù state JS còn "sót" giá trị -50');
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
