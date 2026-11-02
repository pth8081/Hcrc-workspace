// server/tests/test-checklist-required-bulk-toggle.js
//
// Test cho đợt vá v28.83 — người dùng báo thật (kèm 3 ảnh chụp màn hình): mẫu "Checklist Hàng Ngày
// GĐST/CHT (Tự Đánh Giá)" (CL_STCH_DAILY) có 47-49 câu hỏi "Bắt buộc" không trả lời được là không nộp
// bài được, trái yêu cầu đã chốt trước đây ("làm đến đâu tính đến đó, không bắt buộc làm hết"). Gốc rễ:
// seedChecklistStoreSelfDaily.js không đặt cờ isRequired cho câu nào -> validateChecklistQuestions()
// (lib/checklist.js) mặc định "không nói rõ = Bắt buộc:true" -> cả 49 câu bị khoá bắt buộc ngay từ lúc
// tạo, và màn Cấu Hình trước đây không có cách nào gỡ hàng loạt (chỉ có checkbox từng câu một).
//
// 2 phần được vá, test tương ứng 2 phần dưới đây:
//   A. scripts/fix-checklist-required-default.js — script 1 lần vá dữ liệu PRODUCTION đang live (CHỈ
//      đụng đúng mẫu CL_STCH_DAILY bản ACTIVE, không lan sang mẫu khác — đúng yêu cầu người dùng).
//   B. Nút "Bắt Buộc Tất Cả"/"Bỏ Bắt Buộc Tất Cả" mới ở builder câu hỏi (public/fragments/
//      systemSection.html + public/js/module-admin-checklistconfig.js::setAllChecklistBuilderQuestionsRequired())
//      — cho admin tự xử lý hàng loạt, không cần script, áp dụng cho CẢ mẫu hiện tại lẫn mẫu tạo mới
//      sau này.
//
// Chạy: node server/tests/test-checklist-required-bulk-toggle.js
'use strict';
const fs = require('fs');
const path = require('path');
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assertEqual
} = require('./testHarness');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

// ===================== Phần A: scripts/fix-checklist-required-default.js (pure logic, không cần DB) =====
function testUnmarkAllQuestionsRequired() {
  const { unmarkAllQuestionsRequired, TARGET_TEMPLATE_CODE, TARGET_STATUS } = require('../scripts/fix-checklist-required-default');

  check('TARGET_TEMPLATE_CODE đúng CL_STCH_DAILY (phạm vi thu hẹp đúng 1 mẫu)', TARGET_TEMPLATE_CODE === 'CL_STCH_DAILY', TARGET_TEMPLATE_CODE);
  check('TARGET_STATUS đúng ACTIVE (chỉ sửa bản đang dùng, không đụng DRAFT/ARCHIVED cũ)', TARGET_STATUS === 'ACTIVE', TARGET_STATUS);

  // 1. Câu isRequired:true -> false, câu isRequired undefined (mô phỏng seed gốc) -> false, câu đã
  //    false từ trước giữ nguyên (không nằm trong danh sách changes -> idempotent).
  const item1 = {
    templateCode: 'CL_STCH_DAILY',
    questions: [
      { text: 'Câu 1', isRequired: true, options: [{ text: 'Đạt' }] },
      { text: 'Câu 2', options: [{ text: 'Đạt' }] }, // undefined — mô phỏng đúng seed gốc
      { text: 'Câu 3', isRequired: false, options: [{ text: 'Đạt' }] }
    ]
  };
  const changes1 = unmarkAllQuestionsRequired(item1);
  check('Sửa đúng 2 câu (câu 1 true->false, câu 2 undefined->false), bỏ qua câu đã false', changes1.length === 2, changes1);
  check('Mọi câu sau khi sửa đều isRequired:false', item1.questions.every(q => q.isRequired === false), item1.questions.map(q => q.isRequired));
  check('KHÔNG đụng field nào khác (text/options giữ nguyên)', item1.questions[0].text === 'Câu 1' && item1.questions[0].options[0].text === 'Đạt', item1.questions[0]);

  // 2. Idempotent — chạy lại lần 2 trên CHÍNH item đã sửa -> 0 thay đổi.
  const changes2 = unmarkAllQuestionsRequired(item1);
  check('Idempotent: chạy lại lần 2 -> 0 câu cần sửa', changes2.length === 0, changes2);

  // 3. questions rỗng/thiếu -> không crash, trả mảng rỗng.
  const changes3 = unmarkAllQuestionsRequired({ templateCode: 'X' });
  check('Mẫu không có questions[] -> không crash, trả mảng rỗng', Array.isArray(changes3) && changes3.length === 0, changes3);
}

// ===================== Phần A (tiếp): mô phỏng toàn bộ main() qua DB giả — xác nhận SCOPE đúng (chỉ
// UPDATE đúng mẫu/đúng trạng thái, KHÔNG đụng mẫu khác dù trùng 1 phần tên) + dry-run KHÔNG ghi gì.
async function testScriptDbScope() {
  const dbPath = require.resolve('../db');
  const recordStorePath = require.resolve('../lib/recordStore');
  const scriptPath = require.resolve('../scripts/fix-checklist-required-default');

  // Dữ liệu giả: 1 mẫu CL_STCH_DAILY ACTIVE (phải sửa), 1 mẫu CL_STCH_DAILY DRAFT cũ (KHÔNG được đụng —
  // lịch sử bản clone trước đó), 1 mẫu KHÁC HẲN (CL_VSATTP, ACTIVE, câu cố ý Bắt buộc — KHÔNG được đụng,
  // đúng yêu cầu "đừng lan lỗi sang vùng khác").
  const rows = [
    { Id: 1, Payload: JSON.stringify({ templateCode: 'CL_STCH_DAILY', status: 'ACTIVE', questions: [{ text: 'Q1', isRequired: true, options: [] }, { text: 'Q2', options: [] }] }) },
    { Id: 2, Payload: JSON.stringify({ templateCode: 'CL_STCH_DAILY', status: 'DRAFT', questions: [{ text: 'Old Q', isRequired: true, options: [] }] }) },
    { Id: 3, Payload: JSON.stringify({ templateCode: 'CL_VSATTP', status: 'ACTIVE', questions: [{ text: 'VSATTP Q', isRequired: true, options: [] }] }) }
  ];
  const updates = [];
  const fakePool = {
    request() {
      const inputs = {};
      return {
        input(name, type, value) { inputs[name] = value; return this; },
        async query(sqlText) {
          if (/SELECT Id, Payload FROM/.test(sqlText)) {
            // Mô phỏng ĐÚNG mệnh đề WHERE TemplateCode=@code AND Status=@status của script thật.
            const matched = rows.filter(r => {
              const parsed = JSON.parse(r.Payload);
              return parsed.templateCode === inputs.code && parsed.status === inputs.status;
            });
            return { recordset: matched };
          }
          if (/UPDATE .* SET Payload/.test(sqlText)) {
            updates.push({ id: inputs.id, payload: JSON.parse(inputs.payload) });
            return {};
          }
          throw new Error('Unexpected query: ' + sqlText);
        }
      };
    },
    async close() {}
  };
  const fakeSql = { NVarChar: () => 'NVARCHAR', BigInt: 'BIGINT', MAX: 'MAX' };

  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getPool: async () => fakePool, sql: fakeSql } };
  require.cache[recordStorePath] = { id: recordStorePath, filename: recordStorePath, loaded: true, exports: { dedicatedTableName: (c) => `dbo.${c === 'checklistTemplates' ? 'ChecklistTemplates' : c}` } };
  delete require.cache[scriptPath];

  // Xác nhận mệnh đề WHERE của script thật (TemplateCode=@code AND Status=@status) chỉ khớp ĐÚNG 1 dòng
  // (Id=1 — ACTIVE + đúng mã CL_STCH_DAILY), KHÔNG lẫn Id=2 (DRAFT, bản clone cũ) hay Id=3 (mã khác hẳn,
  // CL_VSATTP) — gọi qua cùng `pool`/`sql` đã mock ở trên, đúng cú pháp script thật dùng.
  const pool = await fakePool;
  const sql = fakeSql;
  const result = await pool.request().input('code', sql.NVarChar(50), 'CL_STCH_DAILY').input('status', sql.NVarChar(20), 'ACTIVE')
    .query('SELECT Id, Payload FROM dbo.ChecklistTemplates WHERE TemplateCode = @code AND Status = @status');
  check('Chỉ khớp ĐÚNG 1 dòng (Id=1 — ACTIVE + đúng mã CL_STCH_DAILY)', result.recordset.length === 1 && result.recordset[0].Id === 1, result.recordset.map(r => r.Id));

  // Chạy main() thật (module thật, DB giả) ở chế độ dry-run -> updates[] phải RỖNG (không ghi gì).
  const origArgv = process.argv;
  process.argv = ['node', 'script'];
  delete require.cache[scriptPath];
  const { main: scriptMain } = require('../scripts/fix-checklist-required-default');
  await scriptMain();
  check('Dry-run (không --confirm): KHÔNG ghi UPDATE nào xuống DB', updates.length === 0, updates);
  process.argv = origArgv;

  // --confirm: PHẢI ghi đúng 1 UPDATE (Id=1), và payload ghi lại có cả 2 câu isRequired:false.
  process.argv = ['node', 'script', '--confirm'];
  delete require.cache[scriptPath];
  const { main: scriptMainConfirm } = require('../scripts/fix-checklist-required-default');
  await scriptMainConfirm();
  check('--confirm: ghi ĐÚNG 1 UPDATE (chỉ Id=1, không đụng Id=2/Id=3)', updates.length === 1 && updates[0].id === 1, updates);
  check('--confirm: payload ghi lại có mọi câu isRequired:false', updates.length === 1 && updates[0].payload.questions.every(q => q.isRequired === false), updates[0] && updates[0].payload);
  process.argv = origArgv;

  // Xác nhận unmarkAllQuestionsRequired không hề chạm tới item CL_VSATTP nếu không được gọi cho nó.
  const vsattpItem = JSON.parse(rows[2].Payload);
  check('Mẫu CL_VSATTP (không truyền vào hàm) giữ nguyên isRequired:true, không bị ảnh hưởng', vsattpItem.questions[0].isRequired === true, vsattpItem.questions[0]);

  delete require.cache[dbPath];
  delete require.cache[recordStorePath];
  delete require.cache[scriptPath];
}

// ===================== Phần B: nút "Bắt Buộc Tất Cả"/"Bỏ Bắt Buộc Tất Cả" ở builder (UI thật) =========
function testBulkToggleButtonsInHtml() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'fragments', 'systemSection.html'), 'utf8');
  check('HTML có nút "Bắt Buộc Tất Cả" đúng data-op + data-arg0="true"', /data-op="setAllChecklistBuilderQuestionsRequired"[^>]*data-arg0="true"/.test(html), null);
  check('HTML có nút "Bỏ Bắt Buộc Tất Cả" đúng data-op + data-arg0="false"', /data-op="setAllChecklistBuilderQuestionsRequired"[^>]*data-arg0="false"/.test(html), null);
  // CSP self-check cục bộ cho đúng đoạn vừa thêm: không onclick/style nội tuyến động.
  const idx = html.indexOf('Đặt hàng loạt');
  const block = html.slice(idx, idx + 500);
  check('Đoạn HTML mới không có onclick/style nội tuyến (CSP)', !/on[a-z]+="|[^-]style="/.test(block), block);
}

const PORT = 8986;
const MANAGER = { username: 'admin', name: 'Admin Checklist', dept: 'Phòng Vận Hành', perms: { admin: true }, active: true };

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

async function testBulkToggleRealUi(run) {
  const state = createMockState({ depts: ['Phòng Vận Hành'], users: [MANAGER], checklistTemplates: [] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err && err.stack || String(err)));

  try {
    await loginAs(page, MANAGER);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('BIZCONFIG'); openChecklistTemplateBuilder(); });

    await run.run('Builder UI: thêm 2 câu hỏi -> mặc định CẢ 2 đều Bắt buộc (mirror đúng hành vi mặc định server, bug gốc)', async () => {
      const r = await page.evaluate(() => {
        addChecklistBuilderQuestion();
        addChecklistBuilderQuestion();
        return checklistBuilderQuestions.map(q => q.isRequired);
      });
      assertEqual(JSON.stringify(r), JSON.stringify([true, true]), 'Mặc định thêm câu mới phải Bắt buộc:true (đúng hành vi cũ, KHÔNG đổi)');
    });

    await run.run('Bấm "Bỏ Bắt Buộc Tất Cả" -> cả 2 câu isRequired:false, checkbox UI đồng bộ', async () => {
      const r = await page.evaluate(() => {
        document.querySelector('[data-op="setAllChecklistBuilderQuestionsRequired"][data-arg0="false"]').click();
        return {
          state: checklistBuilderQuestions.map(q => q.isRequired),
          checkboxesChecked: [...document.querySelectorAll('#checklistBuilderQuestionsWrap input[data-arg1="isRequired"]')].map(el => el.checked)
        };
      });
      assertEqual(JSON.stringify(r.state), JSON.stringify([false, false]), 'State JS phải false cả 2 câu');
      assertEqual(JSON.stringify(r.checkboxesChecked), JSON.stringify([false, false]), 'Checkbox UI phải bỏ tick cả 2 câu (render lại đúng state)');
    });

    await run.run('Bấm "Bắt Buộc Tất Cả" -> cả 2 câu isRequired:true trở lại, checkbox UI đồng bộ', async () => {
      const r = await page.evaluate(() => {
        document.querySelector('[data-op="setAllChecklistBuilderQuestionsRequired"][data-arg0="true"]').click();
        return {
          state: checklistBuilderQuestions.map(q => q.isRequired),
          checkboxesChecked: [...document.querySelectorAll('#checklistBuilderQuestionsWrap input[data-arg1="isRequired"]')].map(el => el.checked)
        };
      });
      assertEqual(JSON.stringify(r.state), JSON.stringify([true, true]), 'State JS phải true cả 2 câu');
      assertEqual(JSON.stringify(r.checkboxesChecked), JSON.stringify([true, true]), 'Checkbox UI phải tick lại cả 2 câu');
    });

    await run.run('Không có lỗi JS nào phát sinh trong suốt luồng thao tác trên', () => {
      assertEqual(jsErrors.length, 0, 'jsErrors: ' + jsErrors.join('\n'));
    });
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  testUnmarkAllQuestionsRequired();
  await testScriptDbScope();
  testBulkToggleButtonsInHtml();

  console.log(`\n[Phần A+B tĩnh] ${pass} PASS, ${fail} FAIL`);

  const run = createRunner();
  await testBulkToggleRealUi(run);
  run.summary();

  if (fail > 0 || process.exitCode === 1) process.exit(1);
  process.exit(0);
}

main().catch(err => { console.error('⛔ Lỗi khi chạy test:', err); process.exit(1); });
