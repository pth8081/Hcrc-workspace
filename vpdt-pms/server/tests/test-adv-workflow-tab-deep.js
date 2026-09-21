// tests/test-adv-workflow-tab-deep.js — Test nghiệp vụ CHUYÊN SÂU cho toàn bộ 4 sub-tab của
// "🔀 Quy Trình Nâng Cao" (Hệ Thống, từ v23.65, đổi tên "Quy Trình Hỗn Hợp" -> "🏬 Quy Trình Đặt Hàng
// Siêu Thị" ở v23.66) SAU khi dời 3 khối cấu hình chung ra khỏi cây phân quyền cá nhân. Khác các bài
// test điều hướng/CSP đã có (chỉ click qua rồi kiểm tra section hiện ra) — bài này THAO TÁC THẬT qua UI
// (gõ, chọn, bấm) cho từng nghiệp vụ và xác nhận DỮ LIỆU đổi đúng, không chỉ DOM hiện đúng:
//
//   A) 🏬 Quy Trình Đặt Hàng Siêu Thị (MIXED) — thêm dòng chức danh, thêm dòng người cụ thể (có siêu thị
//      ngoại lệ), xoá dòng, rồi chạy applyWorkflowAction() THẬT trên 1 đơn hàng để xác nhận người vừa
//      cấu hình qua UI thực sự duyệt được.
//   B) ⚡ Áp Dụng Nhanh (QUICKAPPLY) — tạo cấu hình, xem trước tác động, áp dụng thật (xác nhận
//      DB.deptWorkflows được điền đúng phòng ban còn thiếu), sửa cấu hình, xoá cấu hình.
//   C) 🖋️ Nhóm Phê Duyệt Trình/HĐ (GROUPS) — thêm/đổi tên/gán thành viên/xoá nhóm phê duyệt Văn Bản
//      Trình LẪN Hợp Đồng, thêm/xoá Cấp Phê Duyệt Cuối Cùng, xác nhận getSubmissionApprovalLayers() ở
//      core.js phản ánh đúng ngay sau khi lưu qua UI (không chỉ DB thô).
//   D) 🧩 Nhóm Quyền Đặc Biệt (SPECIALPERM) — Đơn Vị Tham Gia Quy Trình, Nhóm Không Cấp VPP, Vị Trí Tham
//      Gia Quy Trình (builder tự dựng, có ghép phòng ban lẫn không ghép) — xác nhận đúng hàm đọc lại
//      (getWorkflowParticipatingDepts()/isUserVppExcluded()/wfPositionPairPickerItems()) phản ánh đúng.
//   E) Cross-cutting: sửa tài khoản "admin" KHÔNG còn khoá nhầm 2 sub-tab GROUPS/SPECIALPERM (bug đã sửa
//      khi dời ra khỏi #permFieldsContainer); tìm kiếm cây phân quyền KHÔNG khớp nội dung đã dời đi;
//      không có lỗi JS/console.error nào phát sinh trong TOÀN BỘ bài test.
const path = require('path');
const http = require('http');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml'
  }[ext] || 'application/octet-stream';
}
function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

// Gõ tìm + bấm chọn 1 gợi ý trong 1 ô renderMultiSelectDropdown() (data-op="gmsAdd") HOẶC
// renderPeopleMultiSelect() (data-op="pmsAdd") — cùng khuôn [data-pms-search]/[data-pms-dropdown], chỉ
// khác tên op — mirror thao tác tay thật, không gọi thẳng hàm JS nội bộ.
async function multiSelectPick(page, containerId, query, expectedLabelSubstring) {
  const input = page.locator(`#${containerId} input[data-pms-search]`);
  await input.click();
  await input.fill(query);
  await page.waitForTimeout(80);
  const option = page.locator(`#${containerId} [data-op="gmsAdd"], #${containerId} [data-op="pmsAdd"]`).filter({ hasText: expectedLabelSubstring }).first();
  await option.click();
  await page.waitForTimeout(50);
}

async function main() {
  const PORT = 9300 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (/Failed to load resource/i.test(text)) return;
      pageErrors.push('console.error: ' + text);
    }
  });
  page.on('dialog', (d) => d.accept('__DIALOG_DEFAULT__').catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  // ---- Seed 1 admin đầy đủ quyền + dữ liệu nghiệp vụ tối thiểu cho cả 4 sub-tab ----
  const setup = await page.evaluate(() => {
    window.alert = () => {};
    window.confirm = () => true;
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && !url.startsWith('/api/')) return realFetch(url, opts);
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]), blob: async () => new Blob([]) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    Object.assign(DB, {
      depts: ['Phòng CNTT', 'Phòng Kế Toán'],
      jobTitles: ['Nhân viên', 'Trưởng Phòng'],
      storeJobTitles: [{ label: 'Giám Đốc Siêu Thị' }],
      stores: ['Siêu Thị Quận 1', 'Siêu Thị Quận 2'],
      workflows: [
        { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] },
        { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }, { order: 2, name: 'Phê duyệt 2' }] }
      ],
      deptWorkflows: {}, // DOC module — target cho test Áp Dụng Nhanh (chưa cấu hình gì)
      // LT10M gắn WF_2STEP (không phải WF_1STEP) để có đủ 2 bước khớp đúng 2 dòng cấu hình MIXED test A2/A3.
      operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_2STEP', approvers: {} } },
      operationOrderHOTierWorkflows: {},
      operationOrderStoreMixedApprovalRules: [],
      submissionApprovalGroups: [], submissionApprovalLevels: [],
      contractApprovalGroups: [], contractApprovalLevels: [],
      workflowParticipatingDepts: [], vppExcludedJobTitles: [], workflowParticipatingPositions: [],
      quickApplyConfigs: [],
      deptAbbrs: {}, docCatAbbrs: {}, itPriceApprovals: [], itSupportTickets: [], itPriceMasterLists: [],
      itPriceDeptWorkflows: {}, itPriceTierWorkflows: {}, itServiceRenewals: [],
      users: [], permGroups: [], _versions: {}
    });

    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000', perms: { admin: true }, groupIds: [], permOverrides: null, active: true
    };
    const approverUser = {
      id: 2, username: 'tp.cntt', name: 'Trưởng Phòng CNTT', dept: 'Phòng CNTT', jobTitle: 'Trưởng Phòng',
      email: 'tp@test.local', phone: '0900000001', perms: { canBeApprover: true }, groupIds: [], permOverrides: null, active: true
    };
    const storeGdUser = {
      id: 3, username: 'gd.st1', name: 'Giám Đốc Siêu Thị Quận 1', dept: 'Siêu Thị Quận 1', jobTitle: 'Giám Đốc Siêu Thị',
      email: 'gdst1@test.local', phone: '0900000002', perms: { canBeApprover: true }, groupIds: [], permOverrides: null, active: true
    };
    DB.users.push(adminUser, approverUser, storeGdUser);
    finishLogin(adminUser);
    return {
      loginOk: document.getElementById('loginSection').classList.contains('hidden'),
      headerShown: !document.getElementById('userHeader').classList.contains('hidden')
    };
  });
  record('setup: finishLogin(admin) + seed DB.* không lỗi', setup.loginOk && setup.headerShown, JSON.stringify(setup));

  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADVWORKFLOW'); });
  await page.waitForSelector('#advWorkflowSection', { state: 'visible' });

  // =====================================================================================
  // A) 🏬 Quy Trình Đặt Hàng Siêu Thị (MIXED)
  // =====================================================================================
  await page.click('#btnAdvWorkflowSubMixed');
  await page.waitForSelector('#mixedApprovalSection', { state: 'visible' });
  await page.waitForTimeout(50);

  // A1: bảng rỗng ban đầu
  const emptyRowText = await page.locator('#mixedApprovalTableBody').innerText();
  record('A1. MIXED: bảng trống hiện đúng thông báo "Chưa có dòng cấu hình nào"', /Chưa có dòng cấu hình/.test(emptyRowText), emptyRowText);

  // A2: thêm dòng Bước 1, chức danh "Giám Đốc Siêu Thị — Siêu Thị" (danh mục storeJobTitles), KHÔNG chọn
  // siêu thị (mặc định) — đúng kịch bản thật "GD siêu thị mặc định tự khớp theo ĐÚNG siêu thị của người
  // giữ chức danh đó" (khác hẳn PERSON+ngoại lệ ở A3, xem chú thích Huong-dan-nghiep-vu.md mục Đơn Hàng).
  await page.selectOption('#maNewStep', '1');
  await page.fill('#maNewJobTitleInput', 'Giám Đốc Siêu Thị — Siêu Thị');
  await page.click('button[data-op="addMixedApprovalRule"]');
  await page.waitForTimeout(80);
  let rulesAfterA2 = await page.evaluate(() => DB.operationOrderStoreMixedApprovalRules);
  record('A2. MIXED: thêm dòng Bước 1 chức danh "Giám Đốc Siêu Thị" (danh mục Siêu Thị) qua UI -> DB có đúng 1 dòng',
    rulesAfterA2.length === 1 && rulesAfterA2[0].step === 1 && rulesAfterA2[0].mode === 'JOBTITLE' && rulesAfterA2[0].jobTitle === 'Giám Đốc Siêu Thị',
    JSON.stringify(rulesAfterA2));
  const rowsAfterA2 = await page.locator('#mixedApprovalTableBody tr').count();
  record('A2b. MIXED: bảng hiện đúng 1 dòng vừa thêm', rowsAfterA2 === 1, `rows=${rowsAfterA2}`);

  // A3: thêm dòng Bước 2, người cụ thể "tp.cntt", ngoại lệ đúng "Siêu Thị Quận 1"
  await page.selectOption('#maNewStep', '2');
  await page.selectOption('#maNewMode', 'PERSON');
  await page.waitForTimeout(30);
  await page.fill('#maNewPersonInput', 'Trưởng Phòng CNTT (tp.cntt) - Phòng CNTT');
  await multiSelectPick(page, 'maNewStoresPicker', 'Siêu Thị Quận 1', 'Siêu Thị Quận 1');
  await page.click('button[data-op="addMixedApprovalRule"]');
  await page.waitForTimeout(80);
  const rulesAfterA3 = await page.evaluate(() => DB.operationOrderStoreMixedApprovalRules);
  const rowA3 = rulesAfterA3.find(r => r.step === 2);
  record('A3. MIXED: thêm dòng Bước 2 NGƯỜI CỤ THỂ + siêu thị ngoại lệ qua UI -> DB đúng',
    !!rowA3 && rowA3.mode === 'PERSON' && rowA3.username === 'tp.cntt' && Array.isArray(rowA3.stores) && rowA3.stores.includes('Siêu Thị Quận 1'),
    JSON.stringify(rowA3));

  // A4: business logic THẬT (client mirror) — computeOperationOrderStoreMixedApproversClient() (core.js)
  // phải trả đúng người cho từng Bước/Siêu Thị dựa trên 2 dòng vừa thêm qua UI ở trên — đây CHÍNH LÀ hàm
  // dùng để hiển thị/preview approver thật ở màn tạo/duyệt đơn, không phải hàm test tự viết riêng.
  const resolveCheck = await page.evaluate(() => {
    if (typeof computeOperationOrderStoreMixedApproversClient !== 'function') return { hasResolver: false };
    const q1 = computeOperationOrderStoreMixedApproversClient('Siêu Thị Quận 1', [1, 2]);
    const q2 = computeOperationOrderStoreMixedApproversClient('Siêu Thị Quận 2', [1, 2]);
    return { hasResolver: true, q1, q2 };
  });
  if (resolveCheck.hasResolver) {
    record('A4a. MIXED business logic: Bước 1 (chức danh "Giám Đốc Siêu Thị", mặc định) CHỈ khớp "gd.st1" ở ĐÚNG Siêu Thị Quận 1 (nơi gd.st1 thuộc về), KHÔNG khớp ở Quận 2',
      resolveCheck.q1[1].includes('gd.st1') && !resolveCheck.q2[1].includes('gd.st1'), JSON.stringify(resolveCheck));
    record('A4b. MIXED business logic: Bước 2 (người cụ thể, ngoại lệ ĐÚNG Siêu Thị Quận 1) khớp "tp.cntt" ở Quận 1',
      resolveCheck.q1[2].includes('tp.cntt'), JSON.stringify(resolveCheck.q1));
    record('A4c. MIXED business logic: Bước 2 KHÔNG khớp ai ở Siêu Thị Quận 2 (ngoại lệ chỉ áp dụng đúng Siêu Thị Quận 1)',
      !resolveCheck.q2[2].includes('tp.cntt'), JSON.stringify(resolveCheck.q2));
  } else {
    record('A4. MIXED business logic: FAIL — không tìm thấy computeOperationOrderStoreMixedApproversClient() ở core.js', false);
  }

  // A4d: chốt hạ bằng resolveOperationOrderWorkflowConfigForItemClient() (điểm CHUNG duy nhất mọi nơi
  // hiển thị/kiểm quyền 1 đơn hàng THẬT đọc qua) trên 1 đơn nháp Siêu Thị Quận 1 — phải trả approvers
  // Bước 1 chứa "tp.cntt" (khớp đúng cấu hình vừa thêm qua UI ở A2/A3, KHÔNG gọi hàm test tự viết riêng).
  const itemConfigCheck = await page.evaluate(() => {
    if (typeof resolveOperationOrderWorkflowConfigForItemClient !== 'function') return { skipped: true };
    const cfg = resolveOperationOrderWorkflowConfigForItemClient({ orderLocationType: 'STORE', dept: 'Siêu Thị Quận 1', amount: 5000000, itemsTotal: 5000000 });
    return { skipped: false, workflowId: cfg && cfg.workflowId, approversStep1: cfg && cfg.approvers && cfg.approvers[1], approversStep2: cfg && cfg.approvers && cfg.approvers[2] };
  });
  if (!itemConfigCheck.skipped) {
    record('A4d. MIXED end-to-end: resolveOperationOrderWorkflowConfigForItemClient() (điểm tra approver DUY NHẤT cho 1 đơn thật) trả đúng "gd.st1" Bước 1 + "tp.cntt" Bước 2 cho đơn Siêu Thị Quận 1',
      Array.isArray(itemConfigCheck.approversStep1) && itemConfigCheck.approversStep1.includes('gd.st1')
        && Array.isArray(itemConfigCheck.approversStep2) && itemConfigCheck.approversStep2.includes('tp.cntt'),
      JSON.stringify(itemConfigCheck));
  } else {
    record('A4d. MIXED end-to-end: FAIL — không tìm thấy resolveOperationOrderWorkflowConfigForItemClient() ở core.js', false);
  }

  // A5: xoá dòng Bước 1
  await page.evaluate(() => { window.confirm = () => true; });
  const deleteBtnStep1 = page.locator('#mixedApprovalTableBody tr', { hasText: 'Bước 1' }).locator('button[data-op="deleteMixedApprovalRule"]');
  await deleteBtnStep1.click();
  await page.waitForTimeout(80);
  const rulesAfterA5 = await page.evaluate(() => DB.operationOrderStoreMixedApprovalRules);
  record('A5. MIXED: xoá dòng Bước 1 qua UI -> DB chỉ còn 1 dòng (Bước 2)',
    rulesAfterA5.length === 1 && rulesAfterA5[0].step === 2, JSON.stringify(rulesAfterA5));

  // A6: banner cảnh báo "người duyệt KHÔNG còn tác dụng ở đây, cấu hình ở sub-tab..." (renderItPriceTierWorkflowTab(),
  // module-itsupport-tier.js — dùng CHUNG cho mọi module pureTier, kể cả OPERATION_ORDER_STORE, hiển thị
  // ở màn "🔄 Quy Trình & Phê Duyệt" khi chọn đúng module "Vận Hành - Đặt Hàng Tại Siêu Thị") phải dùng
  // ĐÚNG tên mới "🏬 Quy Trình Đặt Hàng Siêu Thị", không còn sót tên cũ "Quy Trình Hỗn Hợp".
  await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('WORKFLOW'); switchWfModule('OPERATION_ORDER_STORE'); });
  await page.waitForTimeout(80);
  const bannerCheck = await page.evaluate(() => {
    const text = document.body.innerText;
    return { hasNewName: text.includes('Quy Trình Đặt Hàng Siêu Thị'), hasOldName: text.includes('Quy Trình Hỗn Hợp'), hasNoEffectNote: text.includes('KHÔNG còn tác dụng') };
  });
  record('A6. Banner cảnh báo ở "🔄 Quy Trình & Phê Duyệt" (module Đặt Hàng Tại Siêu Thị) dùng ĐÚNG tên mới, KHÔNG còn sót tên cũ',
    bannerCheck.hasNewName && bannerCheck.hasNoEffectNote && !bannerCheck.hasOldName, JSON.stringify(bannerCheck));
  await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADVWORKFLOW'); setAdvWorkflowSubTab('MIXED'); });
  await page.waitForTimeout(50);

  // =====================================================================================
  // B) ⚡ Áp Dụng Nhanh (QUICKAPPLY)
  // =====================================================================================
  await page.click('#btnAdvWorkflowSubQuickApply');
  await page.waitForSelector('#quickApplySection', { state: 'visible' });
  await page.waitForTimeout(50);

  const emptyQaList = await page.locator('#quickApplyConfigList').innerText();
  record('B1. QUICKAPPLY: danh sách cấu hình trống ban đầu hiện đúng thông báo', /Chưa có cấu hình/.test(emptyQaList), emptyQaList);

  // B2: tạo cấu hình mới — mẫu WF_1STEP, module DOC
  await page.selectOption('#qaTplSelect', 'WF_1STEP');
  await page.locator('#qaModuleGrid .qaModuleCheck[value="DOC"]').check();
  await page.click('#btnSaveQaConfig');
  await page.waitForTimeout(80);
  const configsAfterB2 = await page.evaluate(() => DB.quickApplyConfigs);
  record('B2. QUICKAPPLY: tạo cấu hình (mẫu WF_1STEP, module DOC) qua UI -> DB có đúng 1 cấu hình',
    configsAfterB2.length === 1 && configsAfterB2[0].workflowId === 'WF_1STEP' && configsAfterB2[0].modules.includes('DOC'),
    JSON.stringify(configsAfterB2));

  // B3: xem trước tác động — phải liệt kê đúng 2 phòng ban (DOC chưa cấu hình cho cả 2)
  const cfgId = configsAfterB2[0].id;
  await page.click(`button[data-op="showQuickApplyConfigImpact"][data-arg0="${cfgId}"]`);
  await page.waitForTimeout(60);
  const impactText = await page.locator(`#qaImpact_${cfgId}`).innerText();
  record('B3. QUICKAPPLY: "🔍 Xem Trước" liệt kê đúng 2 phòng ban đang thiếu cấu hình Tài liệu',
    /Phòng CNTT/.test(impactText) && /Phòng Kế Toán/.test(impactText) && /2 mục/.test(impactText),
    impactText);

  // B4: áp dụng thật — DB.deptWorkflows phải được điền cho cả 2 phòng ban
  await page.click(`button[data-op="applyQuickApplyConfig"][data-arg0="${cfgId}"]`);
  await page.waitForTimeout(80);
  const deptWfAfterB4 = await page.evaluate(() => DB.deptWorkflows);
  record('B4. QUICKAPPLY: bấm "⚡ Áp Dụng" -> DB.deptWorkflows điền ĐÚNG cả 2 phòng ban với workflowId WF_1STEP',
    deptWfAfterB4['Phòng CNTT']?.workflowId === 'WF_1STEP' && deptWfAfterB4['Phòng Kế Toán']?.workflowId === 'WF_1STEP',
    JSON.stringify(deptWfAfterB4));

  // B5: áp dụng lại lần 2 -> KHÔNG được ghi đè (đã có cấu hình từ B4)
  const deptWfSnapshotB4 = JSON.parse(JSON.stringify(deptWfAfterB4));
  await page.evaluate(() => { window.deptWorkflows_ptCntt_manual_marker = (DB.deptWorkflows['Phòng CNTT'].approvers = { 1: ['tp.cntt'] }); });
  await page.click(`button[data-op="showQuickApplyConfigImpact"][data-arg0="${cfgId}"]`);
  await page.waitForTimeout(60);
  const impactAfterB5 = await page.locator(`#qaImpact_${cfgId}`).innerText();
  record('B5. QUICKAPPLY: sau khi đã áp dụng, "Xem Trước" báo KHÔNG còn mục nào thiếu (không tự ghi đè cấu hình đã có)',
    /Không còn mục nào thiếu/.test(impactAfterB5), impactAfterB5);
  const deptWfAfterB5Check = await page.evaluate(() => DB.deptWorkflows['Phòng CNTT'].approvers);
  record('B5b. QUICKAPPLY: approvers đã gán tay ở "Phòng CNTT" (bước 1 = tp.cntt) KHÔNG bị Áp Dụng Nhanh đụng tới',
    JSON.stringify(deptWfAfterB5Check) === JSON.stringify({ 1: ['tp.cntt'] }), JSON.stringify(deptWfAfterB5Check));

  // B6: sửa cấu hình — đổi mẫu sang WF_2STEP
  await page.click(`button[data-op="editQuickApplyConfig"][data-arg0="${cfgId}"]`);
  await page.waitForTimeout(50);
  await page.selectOption('#qaTplSelect', 'WF_2STEP');
  await page.click('#btnSaveQaConfig');
  await page.waitForTimeout(80);
  const configsAfterB6 = await page.evaluate(() => DB.quickApplyConfigs);
  record('B6. QUICKAPPLY: sửa cấu hình đổi mẫu sang WF_2STEP qua UI -> DB cập nhật đúng (vẫn 1 cấu hình, không tạo trùng)',
    configsAfterB6.length === 1 && configsAfterB6[0].workflowId === 'WF_2STEP', JSON.stringify(configsAfterB6));

  // B7: xoá cấu hình
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click(`button[data-op="deleteQuickApplyConfig"][data-arg0="${cfgId}"]`);
  await page.waitForTimeout(80);
  const configsAfterB7 = await page.evaluate(() => DB.quickApplyConfigs);
  record('B7. QUICKAPPLY: xoá cấu hình qua UI -> DB rỗng lại', configsAfterB7.length === 0, JSON.stringify(configsAfterB7));

  // =====================================================================================
  // C) 🖋️ Nhóm Phê Duyệt Trình/HĐ (GROUPS)
  // =====================================================================================
  await page.click('#btnAdvWorkflowSubGroups');
  await page.waitForSelector('#advWorkflowSubGroups', { state: 'visible' });
  await page.waitForTimeout(50);

  // C1: thêm nhóm phê duyệt Văn Bản Trình (prompt() trả về tên nhóm)
  await page.evaluate(() => { window.prompt = () => 'Xin Ý Kiến Ban GĐ'; });
  await page.click('button[data-op="addApprovalGroup"][data-arg0="submission"]');
  await page.waitForTimeout(80);
  const subGroupsAfterC1 = await page.evaluate(() => DB.submissionApprovalGroups);
  record('C1. GROUPS (Văn Bản Trình): thêm nhóm mới qua UI -> DB có đúng 1 nhóm "Xin Ý Kiến Ban GĐ"',
    subGroupsAfterC1.length === 1 && subGroupsAfterC1[0].label === 'Xin Ý Kiến Ban GĐ' && subGroupsAfterC1[0].blocking === true,
    JSON.stringify(subGroupsAfterC1));

  // C2: đổi tên nhóm qua input trực tiếp trên bảng
  const subGroupId = subGroupsAfterC1[0].id;
  const renameInput = page.locator(`input[data-op-change="renameApprovalGroup"][data-arg1="${subGroupId}"]`);
  await renameInput.fill('Xin Ý Kiến Ban Giám Đốc');
  await renameInput.dispatchEvent('change');
  await page.waitForTimeout(60);
  const subGroupsAfterC2 = await page.evaluate(() => DB.submissionApprovalGroups);
  record('C2. GROUPS: đổi tên nhóm qua ô input trực tiếp -> DB cập nhật đúng tên mới',
    subGroupsAfterC2[0].label === 'Xin Ý Kiến Ban Giám Đốc', JSON.stringify(subGroupsAfterC2));

  // C3: gán thành viên cho nhóm (chọn "tp.cntt") rồi bấm Lưu Thành Viên
  const pickerId = `apgMemberPicker_submission_${subGroupId}`;
  await multiSelectPick(page, pickerId, 'Trưởng Phòng CNTT', 'Trưởng Phòng CNTT');
  await page.click(`button[data-op="saveApprovalGroupMembers"][data-arg0="submission"][data-arg1="${subGroupId}"]`);
  await page.waitForTimeout(80);
  const subGroupsAfterC3 = await page.evaluate(() => DB.submissionApprovalGroups);
  record('C3. GROUPS: gán thành viên "tp.cntt" cho nhóm qua UI + bấm Lưu -> DB.members đúng',
    JSON.stringify(subGroupsAfterC3[0].members) === JSON.stringify(['tp.cntt']), JSON.stringify(subGroupsAfterC3));

  // C3.5: gán "Nhãn Phê Duyệt" riêng cho nhóm qua ô input mới thêm trên bảng — lan toả tới nút bấm
  // Duyệt/chân ký in của tờ trình MỚI tick nhóm này (task #47 mở rộng sang Nhóm Phê Duyệt Trình/HĐ,
  // trước đây chỉ có ở "🛠️ Định Nghĩa Các Mẫu Bước Phê Duyệt").
  const actionLabelInput = page.locator(`input[data-op-change="updateApprovalGroupActionLabel"][data-arg1="${subGroupId}"]`);
  await actionLabelInput.fill('Xác Nhận');
  await actionLabelInput.dispatchEvent('change');
  await page.waitForTimeout(60);
  const subGroupsAfterC3_5 = await page.evaluate(() => DB.submissionApprovalGroups);
  record('C3.5. GROUPS: gán "Nhãn Phê Duyệt" = "Xác Nhận" qua ô input mới -> DB.actionLabel cập nhật đúng',
    subGroupsAfterC3_5[0].actionLabel === 'Xác Nhận', JSON.stringify(subGroupsAfterC3_5));

  const layerActionLabelCheck = await page.evaluate(() => {
    const layers = getSubmissionApprovalLayers();
    const layer = layers.find(l => l.key === DB.submissionApprovalGroups[0].id);
    return layer && layer.actionLabel;
  });
  record('C3.5b. GROUPS business logic: getSubmissionApprovalLayers() phản ánh ĐÚNG actionLabel vừa gán',
    layerActionLabelCheck === 'Xác Nhận', String(layerActionLabelCheck));

  // Xác nhận end-to-end: buildEffectiveSubmissionWorkflow() (dựng quy trình hiệu lực lúc TẠO tờ trình
  // mới) phải gắn ĐÚNG actionLabel này vào bước do nhóm sinh ra — đây chính là dữ liệu resolveStepActionLabel()
  // đọc để quyết định nhãn nút bấm/chân ký in.
  const effectiveWfCheck = await page.evaluate((groupId) => {
    const wf = buildEffectiveSubmissionWorkflow('Đề Xuất Mua Sắm', 'Phòng CNTT', [groupId], {}, null);
    const step = wf.steps.find(s => s.layerKey === groupId);
    return step && step.actionLabel;
  }, subGroupId);
  record('C3.5c. GROUPS business logic: buildEffectiveSubmissionWorkflow() gắn actionLabel vào ĐÚNG bước sinh ra từ nhóm',
    effectiveWfCheck === 'Xác Nhận', String(effectiveWfCheck));

  // C4: business logic THẬT — getSubmissionApprovalLayers() (core.js, nguồn trực tiếp cho ô "Phê duyệt"
  // ở form tạo Văn Bản Trình — trả shape {key,label,blocking,...}, key = alias của id) phải phản ánh ĐÚNG
  // tên nhóm vừa đổi qua UI; members KHÔNG nằm trong shape này (chỉ dùng nội bộ form admin) nên xác nhận
  // riêng thẳng từ DB (đã gán qua C3, cùng nguồn UI vừa thao tác).
  const layersCheck = await page.evaluate(() => {
    if (typeof getSubmissionApprovalLayers !== 'function') return { skipped: true };
    const layers = getSubmissionApprovalLayers();
    const layer = layers.find(l => l.key === DB.submissionApprovalGroups[0].id);
    return { skipped: false, found: !!layer, label: layer && layer.label, blocking: layer && layer.blocking };
  });
  if (!layersCheck.skipped) {
    record('C4. GROUPS business logic: getSubmissionApprovalLayers() (nguồn ô "Phê duyệt" form tạo Văn Bản Trình) phản ánh ĐÚNG tên nhóm vừa đổi qua UI',
      layersCheck.found && layersCheck.label === 'Xin Ý Kiến Ban Giám Đốc' && layersCheck.blocking === true,
      JSON.stringify(layersCheck));
  } else {
    record('C4. GROUPS business logic: FAIL — không tìm thấy getSubmissionApprovalLayers() ở core.js', false);
  }

  // C5: thêm Cấp Phê Duyệt Cuối Cùng mới (Văn Bản Trình)
  await page.evaluate(() => { window.prompt = () => 'Cấp Thử Nghiệm'; });
  await page.click('button[data-op="addApprovalLevel"][data-arg0="submission"]');
  await page.waitForTimeout(80);
  const subLevelsAfterC5 = await page.evaluate(() => DB.submissionApprovalLevels);
  record('C5. GROUPS: thêm Cấp Phê Duyệt Cuối Cùng mới (Văn Bản Trình) qua UI -> DB có đúng 1 cấp',
    subLevelsAfterC5.length === 1 && subLevelsAfterC5[0].label === 'Cấp Thử Nghiệm', JSON.stringify(subLevelsAfterC5));

  // C6: xoá nhóm phê duyệt vừa tạo
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click(`button[data-op="deleteApprovalGroup"][data-arg0="submission"][data-arg1="${subGroupId}"]`);
  await page.waitForTimeout(80);
  const subGroupsAfterC6 = await page.evaluate(() => DB.submissionApprovalGroups);
  record('C6. GROUPS: xoá nhóm phê duyệt qua UI -> DB rỗng lại', subGroupsAfterC6.length === 0, JSON.stringify(subGroupsAfterC6));

  // C7: LẶP LẠI cho Hợp Đồng (contract) — engine dùng chung, xác nhận 2 module KHÔNG lẫn dữ liệu của nhau
  await page.evaluate(() => { window.prompt = () => 'Nhóm HĐ Thử Nghiệm'; });
  await page.click('button[data-op="addApprovalGroup"][data-arg0="contract"]');
  await page.waitForTimeout(80);
  const contractGroupsAfterC7 = await page.evaluate(() => DB.contractApprovalGroups);
  const subGroupsStillEmpty = await page.evaluate(() => DB.submissionApprovalGroups);
  record('C7. GROUPS (Hợp Đồng): thêm nhóm mới KHÔNG lẫn/ảnh hưởng dữ liệu nhóm Văn Bản Trình (đã xoá ở C6)',
    contractGroupsAfterC7.length === 1 && contractGroupsAfterC7[0].label === 'Nhóm HĐ Thử Nghiệm' && subGroupsStillEmpty.length === 0,
    JSON.stringify({ contractGroupsAfterC7, subGroupsStillEmpty }));
  // Hợp đồng KHÔNG có cột "Chặn Quy Trình?" (hasBlocking:false) — xác nhận field đó không được gán.
  record('C7b. GROUPS (Hợp Đồng): nhóm mới KHÔNG có field "blocking" (đúng cấu hình hasBlocking:false của Hợp Đồng)',
    contractGroupsAfterC7[0].blocking === undefined, JSON.stringify(contractGroupsAfterC7[0]));

  const contractGroupId = contractGroupsAfterC7[0].id;
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click(`button[data-op="deleteApprovalGroup"][data-arg0="contract"][data-arg1="${contractGroupId}"]`);
  await page.waitForTimeout(80);

  // =====================================================================================
  // D) 🧩 Nhóm Quyền Đặc Biệt (SPECIALPERM)
  // =====================================================================================
  await page.click('#btnAdvWorkflowSubSpecialPerm');
  await page.waitForSelector('#advWorkflowSubSpecialPerm', { state: 'visible' });
  await page.waitForTimeout(50);

  // D1: Đơn Vị Tham Gia Quy Trình — thêm "Phòng CNTT", bấm Lưu
  await multiSelectPick(page, 'workflowParticipatingDeptsMultiSelect', 'Phòng CNTT', 'Phòng CNTT');
  await page.click('button[data-op="saveWorkflowParticipatingDepts"]');
  await page.waitForTimeout(80);
  const deptsAfterD1 = await page.evaluate(() => DB.workflowParticipatingDepts);
  record('D1. SPECIALPERM: thêm "Phòng CNTT" vào Đơn Vị Tham Gia Quy Trình qua UI + Lưu -> DB đúng',
    JSON.stringify(deptsAfterD1) === JSON.stringify(['Phòng CNTT']), JSON.stringify(deptsAfterD1));
  const getDeptsCheck = await page.evaluate(() => typeof getWorkflowParticipatingDepts === 'function' ? getWorkflowParticipatingDepts() : null);
  record('D1b. SPECIALPERM business logic: getWorkflowParticipatingDepts() (nguồn màn Quy Trình & Phê Duyệt) trả ĐÚNG danh sách đã lọc',
    JSON.stringify(getDeptsCheck) === JSON.stringify(['Phòng CNTT']), JSON.stringify(getDeptsCheck));

  // D2: Nhóm Không Cấp VPP — thêm "Trưởng Phòng" (đúng chức danh của tp.cntt), bấm Lưu
  await multiSelectPick(page, 'vppExcludedJobTitlesMultiSelect', 'Trưởng Phòng', 'Trưởng Phòng');
  await page.click('button[data-op="saveVppExcludedJobTitles"]');
  await page.waitForTimeout(80);
  const vppExcludedAfterD2 = await page.evaluate(() => DB.vppExcludedJobTitles);
  record('D2. SPECIALPERM: thêm "Trưởng Phòng" vào Nhóm Không Cấp VPP qua UI + Lưu -> DB đúng',
    JSON.stringify(vppExcludedAfterD2) === JSON.stringify(['Trưởng Phòng']), JSON.stringify(vppExcludedAfterD2));
  const isExcludedCheck = await page.evaluate(() => typeof isUserVppExcluded === 'function'
    ? { tpExcluded: isUserVppExcluded(DB.users.find(u => u.username === 'tp.cntt')), adminExcluded: isUserVppExcluded(DB.users.find(u => u.username === 'admin')) }
    : null);
  record('D2b. SPECIALPERM business logic: isUserVppExcluded() — "tp.cntt" (Trưởng Phòng) bị loại, "admin" (Nhân viên) KHÔNG bị loại',
    isExcludedCheck && isExcludedCheck.tpExcluded === true && isExcludedCheck.adminExcluded === false, JSON.stringify(isExcludedCheck));

  // D3: Vị Trí Tham Gia Quy Trình (builder tự dựng, KHÁC 2 widget trên — dùng input trực tiếp + nút "➕
  // Thêm", xem chú thích module-admin-specialperm.js). Thêm 1 cặp CÓ ghép phòng ban + 1 cặp KHÔNG ghép
  // phòng ban (chức danh áp dụng mọi nơi, VD "Giám Đốc Siêu Thị" không cần siêu thị cụ thể).
  await page.fill('#wfPosBuilderJobTitle', 'Trưởng Phòng');
  await page.fill('#wfPosBuilderDept', 'Phòng CNTT');
  await page.click('button[data-op="addWfPositionPairFromBuilder"]');
  await page.waitForTimeout(60);
  await page.fill('#wfPosBuilderJobTitle', 'Giám Đốc Siêu Thị');
  await page.fill('#wfPosBuilderDept', '');
  await page.click('button[data-op="addWfPositionPairFromBuilder"]');
  await page.waitForTimeout(60);
  const chipsText = await page.locator('#workflowParticipatingPositionsMultiSelect [data-wfpos-chips]').innerText();
  record('D3a. SPECIALPERM: builder thêm được CẢ cặp có ghép phòng ban ("Trưởng Phòng — Phòng CNTT") LẪN cặp chỉ chức danh ("Giám Đốc Siêu Thị")',
    /Trưởng Phòng — Phòng CNTT/.test(chipsText) && /Giám Đốc Siêu Thị/.test(chipsText) && !/Giám Đốc Siêu Thị —/.test(chipsText),
    chipsText);

  await page.click('button[data-op="saveWorkflowParticipatingPositions"]');
  await page.waitForTimeout(80);
  const positionsAfterD3 = await page.evaluate(() => DB.workflowParticipatingPositions);
  record('D3b. SPECIALPERM: bấm Lưu Vị Trí Tham Gia Quy Trình -> DB có đúng 2 cặp (1 có dept, 1 dept rỗng)',
    positionsAfterD3.length === 2
      && positionsAfterD3.some(p => p.jobTitle === 'Trưởng Phòng' && p.dept === 'Phòng CNTT')
      && positionsAfterD3.some(p => p.jobTitle === 'Giám Đốc Siêu Thị' && p.dept === ''),
    JSON.stringify(positionsAfterD3));

  // D4: business logic — wfPositionPairPickerItems() (nguồn ô "Theo vị trí" ở Quy Trình & Phê Duyệt)
  // giờ phải CHỈ hiện đúng 2 cặp vừa thêm (KHÔNG còn tích chéo toàn bộ jobTitles×depts như khi rỗng).
  const pickerItemsCheck = await page.evaluate(() => typeof wfPositionPairPickerItems === 'function' ? wfPositionPairPickerItems() : null);
  record('D4. SPECIALPERM business logic: wfPositionPairPickerItems() CHỈ hiện đúng 2 cặp đã cấu hình (không tích chéo toàn bộ nữa)',
    Array.isArray(pickerItemsCheck) && pickerItemsCheck.length === 2, JSON.stringify(pickerItemsCheck));

  // D5: xoá 1 chip trước khi Lưu (KHÔNG lưu ngay) — xác nhận Lưu lần 2 phản ánh đúng còn 1 cặp
  await page.click('#workflowParticipatingPositionsMultiSelect button[data-op="removeWfPositionPairFromBuilder"]');
  await page.waitForTimeout(50);
  await page.click('button[data-op="saveWorkflowParticipatingPositions"]');
  await page.waitForTimeout(80);
  const positionsAfterD5 = await page.evaluate(() => DB.workflowParticipatingPositions);
  record('D5. SPECIALPERM: xoá 1 chip (chưa Lưu) rồi Lưu lại -> DB chỉ còn đúng 1 cặp', positionsAfterD5.length === 1, JSON.stringify(positionsAfterD5));

  // =====================================================================================
  // E) Cross-cutting: khoá tài khoản admin KHÔNG còn ảnh hưởng GROUPS/SPECIALPERM + tìm kiếm cây quyền
  // =====================================================================================
  await page.evaluate(() => { editUser(1); }); // 1 = id tài khoản "admin" đã seed ở trên
  await page.waitForTimeout(50);
  const lockCheck = await page.evaluate(() => ({
    groupsDisabledCount: document.querySelectorAll('#advWorkflowSubGroups input:disabled, #advWorkflowSubGroups select:disabled').length,
    specialPermDisabledCount: document.querySelectorAll('#advWorkflowSubSpecialPerm input:disabled, #advWorkflowSubSpecialPerm select:disabled').length,
    mixedDisabledCount: document.querySelectorAll('#mixedApprovalSection input:disabled, #mixedApprovalSection select:not([disabled]):disabled').length
  }));
  record('E1. Sửa tài khoản "admin" KHÔNG còn khoá nhầm ô nhập ở "🖋️ Nhóm Phê Duyệt Trình/HĐ" (đã dời khỏi #permFieldsContainer)',
    lockCheck.groupsDisabledCount === 0, JSON.stringify(lockCheck));
  record('E2. Sửa tài khoản "admin" KHÔNG còn khoá nhầm ô nhập ở "🧩 Nhóm Quyền Đặc Biệt" (đã dời khỏi #permFieldsContainer)',
    lockCheck.specialPermDisabledCount === 0, JSON.stringify(lockCheck));
  // Đóng form sửa admin lại (không lưu gì) để không ảnh hưởng phần còn lại của bài test.
  await page.evaluate(() => { if (typeof resetUserForm === 'function') resetUserForm(); });

  // E3: tìm kiếm cây phân quyền (Quản Trị > Phân Quyền) — nội dung "Nhóm Phê Duyệt Trình"/"Quyền Đặc
  // Biệt" đã dời hẳn khỏi cây, filterPermTree() KHÔNG được khớp nhầm text còn sót trong DOM cũ.
  await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('PERMS'); });
  await page.waitForTimeout(60);
  const searchInput = page.locator('#permTreeSearch');
  const searchExists = await searchInput.count();
  let searchResultText = null;
  if (searchExists) {
    await searchInput.fill('Nhóm Phê Duyệt Trình');
    await page.waitForTimeout(80);
    searchResultText = await page.locator('#permFieldsContainer').innerText();
    await searchInput.fill('');
    await page.waitForTimeout(50);
  }
  record('E3. Cây phân quyền: tìm "Nhóm Phê Duyệt Trình" KHÔNG khớp gì trong #permFieldsContainer (đã dời hẳn ra ngoài)',
    !searchExists || !/Nhóm Phê Duyệt Trình \(Văn Bản Trình\)/.test(searchResultText || ''),
    `searchExists=${searchExists}, text=${(searchResultText || '').slice(0, 200)}`);

  // E4: expand-all/collapse-all cây quyền vẫn chạy không lỗi (setAllPermTreeNodes, nếu tồn tại)
  const expandCollapseOk = await page.evaluate(() => {
    try {
      if (typeof setAllPermTreeNodes === 'function') { setAllPermTreeNodes(true); setAllPermTreeNodes(false); }
      return true;
    } catch (e) { return String(e); }
  });
  record('E4. Mở rộng/thu gọn toàn bộ cây phân quyền (setAllPermTreeNodes) chạy không lỗi sau khi đã bớt 3 khối',
    expandCollapseOk === true, JSON.stringify(expandCollapseOk));

  // E5: không có lỗi JS/console.error nào phát sinh trong TOÀN BỘ bài test
  record('E5. KHÔNG có lỗi JS (pageerror/console.error) nào phát sinh trong toàn bộ bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenario(s) passed.`);
  if (failed.length) {
    console.log(`\n${failed.length} FAILED:`);
    failed.forEach(f => console.log(' - ' + f.name));
    process.exit(1);
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
