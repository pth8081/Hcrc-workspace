// tests/test-contract-type-approval-workflow-client.js — Release 2/3 "Hợp Đồng theo Loại Pháp Lý"
// ("làm giống Văn Bản Trình"): kiểm tra PHÍA CLIENT sau khi bật hasTypes/dbKey/legacyDbKey/
// typesFromContractCatalog cho WF_MODULE_CONFIG.CONTRACT_APPROVAL (module-workflow.js) + extend
// getWfModuleTypes() đọc DB.contractTypes (module-ngansach.js) — Release 1 (nền tảng server) đã có
// test riêng ở test-contract-type-approval-workflow-foundation.js, bài này chỉ test phần MỚI thêm ở
// Release 2 (client): danh sách loại cho tab admin, ghi/đọc đúng map lồng qua UI thật, preview đúng
// loại đang chọn, canAccessContractModule()/canAccessApprovalHub() nhận diện đúng approver CHỈ cấu
// hình riêng theo loại (không có trong map phẳng cũ). CHỈ phạm vi "Phê Duyệt" — "Quản Lý HĐ"
// (contractManageDeptWorkflows) KHÔNG đổi gì, không test ở đây (đúng yêu cầu người dùng).
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8997;

// Gõ tìm + bấm chọn 1 gợi ý trong 1 ô renderPeopleMultiSelect() (data-op="pmsAdd") — mirror thao tác
// tay thật, KHÔNG set thẳng `.checked` trên input ẩn (widget dựng lại input ẩn mỗi lần renderChips(),
// chỉ phát sinh SAU khi bấm chọn qua dropdown — xem renderPeopleMultiSelect() ở core.js).
async function multiSelectPick(page, containerId, query, expectedLabelSubstring) {
  const input = page.locator(`#${containerId} input[data-pms-search]`);
  await input.click();
  await input.fill(query);
  await page.waitForTimeout(80);
  const option = page.locator(`#${containerId} [data-op="pmsAdd"]`).filter({ hasText: expectedLabelSubstring }).first();
  await option.click();
  await page.waitForTimeout(50);
}

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const seed = Object.assign({}, baseCatalogSeed(), {
      contractTypes: ['Hợp đồng kinh tế', 'Hợp đồng dịch vụ'],
      workflows: [
        { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] },
        { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }, { order: 2, name: 'Phê duyệt 2' }] }
      ],
      contractApprovalDeptWorkflows: {}, contractTypeApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      contractApprovalGroups: [], contractApprovalLevels: [], contracts: [], users: []
    });
    await page.evaluate((s) => { Object.assign(DB, s); }, seed);

    const admin = makeUser({ username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng CNTT', perms: { admin: true, canBeApprover: true } });
    const approverKT = makeUser({ username: 'tp.kt', name: 'Trưởng Phòng Kế Toán', dept: 'Phòng Kế Toán', jobTitle: 'Trưởng phòng', perms: { canBeApprover: true } });
    // typeOnlyApprover: KHÔNG có dept, KHÔNG có bất kỳ quyền phẳng/nhóm nào — chỉ được gán làm approver
    // qua ĐÚNG map lồng contractTypeApprovalDeptWorkflows (mô phỏng "chỉ duyệt bước cuối theo 1 loại HĐ
    // cụ thể") — mục tiêu chính của Release 2's canAccessContractModule()/canAccessApprovalHub() check.
    const typeOnlyApprover = Object.assign(makeUser({ username: 'gd.only', name: 'Giám Đốc (chỉ duyệt theo loại)', jobTitle: 'Trưởng phòng', perms: { canBeApprover: true } }), { dept: '' });
    await page.evaluate((users) => { DB.users.push(...users); }, [admin, approverKT, typeOnlyApprover]);
    await page.evaluate((u) => finishLogin(u), admin);
    if (typeof page !== 'undefined') await page.evaluate(() => { if (typeof stopApprovalPolling === 'function') stopApprovalPolling(); });

    await run('A1. getWfModuleTypes(\'CONTRACT_APPROVAL\') đọc DB.contractTypes (typesFromContractCatalog), KHÔNG dùng DB.submissionTypes', async () => {
      const types = await page.evaluate(() => getWfModuleTypes('CONTRACT_APPROVAL'));
      assertEqual(types.length, 2, 'Phải trả đúng 2 loại từ DB.contractTypes');
      assert(types.some(t => t.key === 'Hợp đồng kinh tế' && t.label === 'Hợp đồng kinh tế'), 'Thiếu loại "Hợp đồng kinh tế"');
      assert(types.some(t => t.key === 'Hợp đồng dịch vụ'), 'Thiếu loại "Hợp đồng dịch vụ"');
    });

    await run('A2. WF_MODULE_CONFIG.CONTRACT_APPROVAL: hasTypes=true, dbKey mới (nested) + legacyDbKey (map phẳng cũ)', async () => {
      const cfg = await page.evaluate(() => WF_MODULE_CONFIG.CONTRACT_APPROVAL);
      assertEqual(cfg.hasTypes, true, 'Phải bật hasTypes để kích hoạt tab theo loại');
      assertEqual(cfg.dbKey, 'contractTypeApprovalDeptWorkflows', 'dbKey phải là map lồng mới');
      assertEqual(cfg.legacyDbKey, 'contractApprovalDeptWorkflows', 'legacyDbKey phải là map phẳng cũ (fallback hiển thị)');
    });

    await run('A3. CONTRACT_MANAGE KHÔNG bị đụng tới (đúng yêu cầu người dùng — chỉ "Phê Duyệt", không phải "Quản Lý HĐ")', async () => {
      const cfg = await page.evaluate(() => WF_MODULE_CONFIG.CONTRACT_MANAGE);
      assert(!cfg.hasTypes, 'CONTRACT_MANAGE không được có hasTypes');
      assertEqual(cfg.dbKey, 'contractManageDeptWorkflows', 'CONTRACT_MANAGE vẫn dùng đúng map phẳng cũ, không đổi');
    });

    // ===== B: màn admin "Quy Trình & Phê Duyệt" — chuyển qua module Hợp Đồng-Phê Duyệt, thấy đúng tab loại =====
    await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('WORKFLOW'); });
    await page.waitForSelector('#workflowSection', { state: 'visible' });
    await page.evaluate(() => { switchWfModule('CONTRACT_APPROVAL'); });
    await page.waitForTimeout(50);

    await run('B1. Màn admin hiện đúng 2 nút tab loại Hợp Đồng (wfSubmissionTypeTabs không ẩn, có 2 nút)', async () => {
      const info = await page.evaluate(() => {
        const el = document.getElementById('wfSubmissionTypeTabs');
        return { hidden: el.classList.contains('hidden'), count: el.querySelectorAll('button').length, text: el.innerText };
      });
      assert(!info.hidden, 'Hàng tab loại phải HIỆN khi module có >= 2 loại');
      assertEqual(info.count, 2, 'Phải có đúng 2 nút tab loại');
      assert(/Hợp đồng kinh tế/.test(info.text) && /Hợp đồng dịch vụ/.test(info.text), 'Thiếu nhãn loại trên tab: ' + info.text);
    });

    // Chọn tab loại "Hợp đồng kinh tế" rồi lưu cấu hình Phòng Kế Toán: WF_1STEP, approver = tp.kt
    await page.evaluate(() => { switchWfSubmissionType('Hợp đồng kinh tế'); });
    await page.waitForTimeout(50);

    await run('B2. Chọn đúng người duyệt (tp.kt) cho Phòng Kế Toán ở tab "Hợp đồng kinh tế" rồi Lưu -> ghi vào ĐÚNG contractTypeApprovalDeptWorkflows["Hợp đồng kinh tế"]["Phòng Kế Toán"], KHÔNG đụng map phẳng', async () => {
      await page.evaluate(() => { window.alert = () => {}; window.confirm = () => true; });
      await multiSelectPick(page, 'wfApproverPicker_Phòng_Kế_Toán_1', 'Trưởng Phòng Kế Toán', 'Trưởng Phòng Kế Toán');
      await page.click('button[data-op="saveDeptWorkflowConfig"][data-arg0="Phòng Kế Toán"]');
      await page.waitForTimeout(80);
      const result = await page.evaluate(() => ({
        nested: DB.contractTypeApprovalDeptWorkflows,
        flat: DB.contractApprovalDeptWorkflows
      }));
      const cfg = result.nested?.['Hợp đồng kinh tế']?.['Phòng Kế Toán'];
      assert(!!cfg, 'Phải có cấu hình nested cho đúng loại+phòng ban: ' + JSON.stringify(result.nested));
      assertEqual(cfg.workflowId, 'WF_1STEP', 'workflowId phải khớp mẫu đang chọn');
      assert((cfg.approvers?.[1] || []).includes('tp.kt'), 'Approver bước 1 phải có tp.kt: ' + JSON.stringify(cfg.approvers));
      assert(!result.flat['Phòng Kế Toán'], 'KHÔNG được ghi nhầm vào map phẳng cũ (chỉ cấu hình RIÊNG cho loại này)');
    });

    await run('B3. Đổi sang tab loại KHÁC ("Hợp đồng dịch vụ") -> Phòng Kế Toán hiện mặc định (chưa cấu hình riêng cho loại này, KHÔNG lẫn cấu hình của loại kia)', async () => {
      await page.evaluate(() => { switchWfSubmissionType('Hợp đồng dịch vụ'); });
      await page.waitForTimeout(50);
      const configured = await page.evaluate(() => isDeptWorkflowConfigured('Phòng Kế Toán'));
      assert(!configured, 'Loại "Hợp đồng dịch vụ" chưa từng cấu hình riêng cho Phòng Kế Toán -> phải báo CHƯA cấu hình');
    });

    // ===== C: business logic client (getContractApprovalDeptWorkflowConfig/buildEffectiveContractApprovalWorkflow) =====
    await run('C1. getContractApprovalDeptWorkflowConfig(): loại có cấu hình riêng + đúng phòng ban -> dùng map lồng, KHÔNG dùng map phẳng', async () => {
      const cfg = await page.evaluate(() => getContractApprovalDeptWorkflowConfig('Hợp đồng kinh tế', 'Phòng Kế Toán'));
      assertEqual(cfg.workflowId, 'WF_1STEP', 'Phải lấy đúng cấu hình nested vừa lưu ở B2');
      assert((cfg.approvers?.[1] || []).includes('tp.kt'), 'Phải có tp.kt');
    });

    await run('C2. getContractApprovalDeptWorkflowConfig(): loại KHÁC (chưa cấu hình riêng) -> fallback map phẳng cũ (đang rỗng -> mặc định WF_1STEP/admin)', async () => {
      const cfg = await page.evaluate(() => getContractApprovalDeptWorkflowConfig('Hợp đồng dịch vụ', 'Phòng Kế Toán'));
      assertEqual(cfg.workflowId, 'WF_1STEP', 'Mặc định khi chưa cấu hình gì');
      assert((cfg.approvers?.[1] || []).includes('admin'), 'Mặc định fallback phải là admin (hành vi CŨ, chưa cấu hình gì)');
    });

    await run('C3. buildEffectiveContractApprovalWorkflow(contractType, dept, ...): snapshot lúc TẠO MỚI dùng đúng cấu hình theo loại đang chọn trên form', async () => {
      const wf = await page.evaluate(() => buildEffectiveContractApprovalWorkflow('Hợp đồng kinh tế', 'Phòng Kế Toán', [], {}, 'KHAC'));
      assert((wf.approvers?.[1] || []).includes('tp.kt'), 'Phải build đúng approver theo loại "Hợp đồng kinh tế": ' + JSON.stringify(wf));
    });

    await run('C4. buildContractApprovalWorkflowPreviewHTML(contractType, dept, ...) (nguồn cho nút "🔍 Xem Trước") hiện đúng người duyệt theo loại đang chọn', async () => {
      const html = await page.evaluate(() => buildContractApprovalWorkflowPreviewHTML('Hợp đồng kinh tế', 'Phòng Kế Toán', [], {}, 'KHAC'));
      assert(/Trưởng Phòng Kế Toán/.test(html), 'Preview phải hiện đúng tên approver theo loại: ' + html);
    });

    await run('C4b. buildContractApprovalWorkflowPreviewHTML() với loại KHÁC (chưa cấu hình riêng) hiện đúng fallback (admin)', async () => {
      const html = await page.evaluate(() => buildContractApprovalWorkflowPreviewHTML('Hợp đồng dịch vụ', 'Phòng Kế Toán', [], {}, 'KHAC'));
      assert(!/Trưởng Phòng Kế Toán/.test(html), 'Loại chưa cấu hình riêng KHÔNG được hiện nhầm approver của loại khác');
    });

    // ===== D: canAccessContractModule()/canAccessApprovalHub() — approver CHỈ qua map lồng theo loại =====
    await run('D1. canAccessContractModule(): user KHÔNG dept, KHÔNG quyền phẳng, CHỈ là approver qua contractTypeApprovalDeptWorkflows -> vẫn PHẢI vào được tab Hợp Đồng', async () => {
      const result = await page.evaluate((username) => {
        DB.contractTypeApprovalDeptWorkflows = { 'Hợp đồng kinh tế': { 'Phòng Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: [username] } } } };
        const u = DB.users.find(x => x.username === username);
        return canAccessContractModule(u);
      }, typeOnlyApprover.username);
      assert(result === true, 'Phải nhận diện đúng approver chỉ cấu hình riêng theo loại (lỗi trước Release 2: chỉ xét map phẳng)');
    });

    await run('D2. canAccessContractModule(): user KHÔNG xuất hiện ở BẤT KỲ đâu (map lồng/phẳng/nhóm) -> vẫn bị chặn (không nới quyền quá mức)', async () => {
      const result = await page.evaluate(() => {
        DB.contractTypeApprovalDeptWorkflows = { 'Hợp đồng kinh tế': { 'Phòng Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['tp.kt'] } } } };
        const u = { username: 'ai.do.khac', dept: '', perms: {} };
        return canAccessContractModule(u);
      });
      assert(result === false, 'Không được tự nới quyền cho người hoàn toàn không liên quan');
    });

    await run('D3. canAccessApprovalHub(): approver CHỈ qua map lồng theo loại Hợp Đồng cũng phải thấy được Hộp Thư Phê Duyệt', async () => {
      const result = await page.evaluate((username) => {
        DB.contractTypeApprovalDeptWorkflows = { 'Hợp đồng kinh tế': { 'Phòng Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: [username] } } } };
        const u = DB.users.find(x => x.username === username);
        return canAccessApprovalHub(u);
      }, typeOnlyApprover.username);
      assert(result === true, 'canAccessApprovalHub() phải nhận diện đúng approver chỉ cấu hình riêng theo loại');
    });

    await run('E1. Không có lỗi JS (pageerror/console.error) nào phát sinh trong toàn bộ bài test', async () => {
      assertEqual(pageErrors.length, 0, 'pageErrors: ' + JSON.stringify(pageErrors));
    });
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-contract-type-approval-workflow-client');
}

main().catch((err) => { console.error(err); process.exit(1); });
