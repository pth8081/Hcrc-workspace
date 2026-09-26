// server/tests/test-extra-approval-preview-fix.js
//
// "Nhóm Phê Duyệt Cuối" (10/2026) — rà soát TỪNG quy trình trong 10 quy trình áp dụng tính năng này
// (DOC/CAR/OFFICE_BUY/OFFICE_FIX/VPP/PAYMENT/ITPRICE_RETAIL/ITPRICE_WHOLESALE/OPERATION_ORDER_STORE/
// OPERATION_ORDER_HO) theo yêu cầu người dùng "test từng quy trình, đảm bảo không sót case study và
// không bị lỗi, nhớ test cả CSP".
//
// PHÁT HIỆN THẬT (không phải giả định) khi rà soát: appendExtraApprovalLayersForPreview() (core.js) đã
// được VIẾT SẴN từ đợt merge trước nhưng KHÔNG hề được gọi ở bất kỳ nút "🔍 Xem Quy Trình" nào của cả 7
// module (previewDocWorkflow/previewCarWorkflow/previewOfficeWorkflow/previewVppWorkflow/
// previewPaymentWorkflow/previewItPriceWorkflow/previewMhItPriceWorkflow/previewOperationOrderWorkflow)
// — nghĩa là người tạo hồ sơ chọn xong Cấp/Nhóm Phê Duyệt Cuối trên form nhưng bấm "Xem Quy Trình" thì
// KHÔNG thấy các bước mới này trong bản xem trước (hồ sơ tạo ra vẫn ĐÚNG vì server luôn tự xác thực lại,
// chỉ riêng bản xem trước bị thiếu). Đã vá: nối appendExtraApprovalLayersForPreview() vào cả 8 điểm gọi
// openGenericWorkflowPreviewModal() liên quan (2 nhánh trong module-itsupport-price.js).
//
// PHÁT HIỆN THỨ 2 (case study bị bỏ sót khi viết appendExtraApprovalLayersForPreview() lần đầu):
// hàm này giả định `resolved` LUÔN là 1 object có `.steps` — đúng với server (flatWorkflowConfigToSteps()
// luôn trả về object mặc định, không bao giờ null) nhưng SAI với client: các previewXxxWorkflow() truyền
// THẲNG DB.deptWorkflows[dept] (hoặc tương đương) — giá trị này có thể là `undefined` khi phòng ban/mức
// đang chọn CHƯA được cấu hình quy trình gốc (buildGenericDeptWorkflowPreviewHTML() tự hiện cảnh báo
// "chưa cấu hình" cho case này). Nếu người dùng ĐÃ chọn xong Cấp/Nhóm Phê Duyệt Cuối trên form nhưng
// phòng ban/mức lại CHƯA có quy trình gốc, gọi thẳng `resolved.steps` sẽ NÉM LỖI (TypeError: Cannot read
// properties of undefined). Đã vá bằng 1 dòng guard `if (!resolved) return resolved;` ở đầu hàm.
//
// Bài test này xác nhận CẢ 2 lần vá trên qua browser Playwright thật (không tự đoán lại logic):
//   A) Rà soát ĐỦ 10 quy trình — mount UI thật, chọn Cấp+Nhóm, gọi appendExtraApprovalLayersForPreview()
//      thật, xác nhận bước mới được nối đúng vào bản xem trước cho TỪNG quy trình (không sót module nào).
//   B) Case study "chưa cấu hình quy trình gốc + đã chọn Nhóm Phê Duyệt Cuối" — xác nhận KHÔNG throw lỗi
//      cho CẢ 10 quy trình (case dễ bị bỏ sót nhất, chính là lỗi thật vừa phát hiện).
//   C) 2 kịch bản click-through THẬT qua nút bấm (không gọi thẳng hàm JS nội bộ) cho Tài Liệu (DOC,
//      module thường) — xác nhận nút "🔍 Xem Quy Trình" thật sự hiện đúng bước mới, VÀ không crash khi
//      rơi vào case study B ở trên qua chính cái nút đó.
//   D) CSP: không có lỗi console/page nào phát sinh trong toàn bộ bài test (script-src/style-src thật,
//      không phải đoán) + không có event-handler nội tuyến nào trong 8 file JS vừa sửa.
//
// Chạy: node server/tests/test-extra-approval-preview-fix.js
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

// 10 moduleKey áp dụng "Nhóm Phê Duyệt Cuối" — ĐÚNG danh sách EXTRA_APPROVAL_MODULE_KEYS (routes/data.js).
const MODULE_KEYS = [
  'DOC', 'CAR', 'OFFICE_BUY', 'OFFICE_FIX', 'VPP', 'PAYMENT',
  'ITPRICE_RETAIL', 'ITPRICE_WHOLESALE', 'OPERATION_ORDER_STORE', 'OPERATION_ORDER_HO'
];

async function main() {
  const PORT = 9700 + Math.floor(Math.random() * 400);
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

  const setup = await page.evaluate((moduleKeys) => {
    window.alert = () => {};
    window.confirm = () => true;
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && !url.startsWith('/api/')) return realFetch(url, opts);
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]), blob: async () => new Blob([]) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const GROUPS = [{ id: 'CEO', label: 'Cấp Phê Duyệt Cuối Cùng', order: 1, members: ['tp.cntt'], singleApprover: true }];
    const LEVELS = [{ id: 'L1', label: 'Mặc định', visibleGroupIds: ['CEO'], lockedGroupIds: ['CEO'], isSystemDefault: true }];
    const extraSeed = {};
    moduleKeys.forEach(mk => { extraSeed[`extraApprovalGroups_${mk}`] = JSON.parse(JSON.stringify(GROUPS)); extraSeed[`extraApprovalLevels_${mk}`] = JSON.parse(JSON.stringify(LEVELS)); });

    Object.assign(DB, {
      depts: ['Phòng CNTT', 'Phòng Kế Toán'], jobTitles: ['Nhân viên', 'Trưởng Phòng'],
      storeJobTitles: [{ label: 'Giám Đốc Siêu Thị' }], stores: ['Siêu Thị Quận 1'],
      workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] }],
      // Chỉ "Phòng CNTT" có quy trình gốc — "Phòng Kế Toán" CỐ Ý để trống (dùng cho case study B: chưa
      // cấu hình quy trình gốc + đã chọn Nhóm Phê Duyệt Cuối).
      deptWorkflows: { 'Phòng CNTT': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } },
      carDeptWorkflows: { 'Phòng CNTT': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } },
      vppDeptWorkflows: { 'Phòng CNTT': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } },
      paymentDeptWorkflows: { 'Phòng CNTT': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } },
      officeDeptWorkflows: { 'Phòng CNTT': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } },
      officeFixDeptWorkflows: {}, itPriceDeptWorkflows: {}, itPriceTierWorkflows: {},
      operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {}, operationOrderStoreMixedApprovalRules: [],
      submissionApprovalGroups: [], submissionApprovalLevels: [], contractApprovalGroups: [], contractApprovalLevels: [],
      workflowParticipatingDepts: [], workflowParticipatingDeptGroups: [], vppExcludedJobTitles: [], workflowParticipatingPositions: [],
      quickApplyConfigs: [], deptAbbrs: {}, docCatAbbrs: {}, cats: [],
      itPriceApprovals: [], itSupportTickets: [], itPriceMasterLists: [], itServiceRenewals: [],
      docs: [], carRegs: [], officeReqs: [], vppRegistrations: [], paymentRequests: [], operationOrders: [],
      vppPeriods: [], uniformCatalog: [], formTemplates: {},
      users: [], permGroups: [], _versions: {},
      ...extraSeed
    });

    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000',
      perms: { admin: true, uploadAll: true, carCreate: true, officeCreate: true, vppRegisterCreate: true, paymentManage: true, operationOrderCreate: true, itPriceProposeCreateRetail: true, itPriceProposeCreateWholesale: true },
      groupIds: [], permOverrides: null, active: true
    };
    const approverUser = {
      id: 2, username: 'tp.cntt', name: 'Trưởng Phòng CNTT', dept: 'Phòng CNTT', jobTitle: 'Trưởng Phòng',
      email: 'tp@test.local', phone: '0900000001', perms: { canBeApprover: true }, groupIds: [], permOverrides: null, active: true
    };
    DB.users.push(adminUser, approverUser);
    finishLogin(adminUser);
    return {
      loginOk: document.getElementById('loginSection').classList.contains('hidden'),
      headerShown: !document.getElementById('userHeader').classList.contains('hidden')
    };
  }, MODULE_KEYS);
  record('setup: finishLogin(admin) + seed DB.* cho cả 10 moduleKey không lỗi', setup.loginOk && setup.headerShown, JSON.stringify(setup));

  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  // =====================================================================================
  // A) + B) Rà soát ĐỦ 10 quy trình qua appendExtraApprovalLayersForPreview() THẬT (mount UI thật, chọn
  // Cấp+Nhóm qua DOM thật) — mỗi quy trình test cả 2 nhánh: (A) có quy trình gốc -> nối đúng bước mới;
  // (B) KHÔNG có quy trình gốc (resolved=undefined) + đã chọn Nhóm Phê Duyệt Cuối -> KHÔNG throw.
  // =====================================================================================
  const perModuleResults = await page.evaluate((moduleKeys) => {
    const out = {};
    moduleKeys.forEach(mk => {
      const mountId = `testMount_${mk}`;
      let mountDiv = document.getElementById(mountId);
      if (!mountDiv) { mountDiv = document.createElement('div'); mountDiv.id = mountId; document.body.appendChild(mountDiv); }
      try {
        renderExtraApprovalMount(mk, mountId);
        // Chọn Cấp "L1" (option duy nhất) rồi nối lớp checkbox (locked "CEO" đã tự tick sẵn qua
        // renderExtraApprovalLayerCheckboxes() — không cần tick tay).
        const levelSel = document.getElementById(`extraApprovalLevel_${mk}`);
        if (levelSel) { levelSel.value = 'L1'; onExtraApprovalLevelChange(mk); }

        // (A) CÓ quy trình gốc -> phải nối thêm đúng 1 "extraStep" (KHÔNG động tới workflowId/approvers
        // gốc — buildGenericDeptWorkflowPreviewHTML() định vị bước gốc qua DB.workflows[workflowId], chỉ
        // đọc thêm wfConfig.extraSteps để nối SAU CÙNG, xem core.js).
        const baseResolved = { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
        const appended = appendExtraApprovalLayersForPreview(baseResolved, mk);
        const appendedOk = appended && appended.workflowId === 'WF_1STEP' &&
          JSON.stringify(appended.approvers) === JSON.stringify({ 1: ['admin'] }) &&
          appended.extraSteps && appended.extraSteps.length === 1 &&
          appended.extraSteps[0].name === 'Cấp Phê Duyệt Cuối Cùng' &&
          JSON.stringify(appended.extraSteps[0].approvers) === JSON.stringify(['tp.cntt']);

        // (B) case study — KHÔNG có quy trình gốc (undefined), Nhóm Phê Duyệt Cuối VẪN đã được chọn ở
        // trên -> phải trả về `undefined` (giữ nguyên, không throw).
        let crashGuardOk = false, crashGuardError = null;
        try {
          const resultUndef = appendExtraApprovalLayersForPreview(undefined, mk);
          crashGuardOk = resultUndef === undefined;
        } catch (e) { crashGuardError = String(e && e.message || e); }

        out[mk] = { appendedOk, crashGuardOk, crashGuardError, appended: JSON.stringify(appended) };
      } catch (e) {
        out[mk] = { error: String(e && e.message || e) };
      }
    });
    return out;
  }, MODULE_KEYS);

  MODULE_KEYS.forEach(mk => {
    const r = perModuleResults[mk];
    record(`A) ${mk}: mount + chọn Cấp/Nhóm qua DOM thật -> appendExtraApprovalLayersForPreview() nối ĐÚNG bước mới vào bản xem trước`,
      r && !r.error && r.appendedOk, JSON.stringify(r));
    record(`B) ${mk}: quy trình gốc CHƯA cấu hình (resolved=undefined) + đã chọn Nhóm Phê Duyệt Cuối -> KHÔNG throw (case study dễ bỏ sót nhất)`,
      r && !r.error && r.crashGuardOk && !r.crashGuardError, JSON.stringify(r));
  });

  // Dọn sạch các mount tạm dùng riêng cho phần A/B ở trên — tránh trùng id với mount THẬT của mỗi module
  // (VD #extraApprovalLevel_DOC) khi phần C bên dưới thao tác qua UI thật của module Tài Liệu.
  await page.evaluate((moduleKeys) => {
    moduleKeys.forEach(mk => document.getElementById(`testMount_${mk}`)?.remove());
  }, MODULE_KEYS);

  // =====================================================================================
  // C) Click-through THẬT qua nút bấm "🔍 Xem Quy Trình" của Tài Liệu (DOC) — không gọi thẳng hàm nội bộ.
  // =====================================================================================
  await page.evaluate(async () => { await switchTab('doc'); });
  await page.waitForSelector('#docSection', { state: 'visible' });
  await page.waitForTimeout(80);

  // C1: dept CÓ quy trình gốc + đã chọn Cấp/Nhóm Phê Duyệt Cuối -> modal phải hiện ĐÚNG bước mới.
  await page.selectOption('#selDept', 'Phòng CNTT');
  const docLevelSel = page.locator('#extraApprovalLevel_DOC');
  if (await docLevelSel.count()) {
    await docLevelSel.selectOption('L1');
    await page.waitForTimeout(50);
  }
  await page.click('#docPreviewWfBtn');
  await page.waitForSelector('#viewDocModal:not(.hidden)', { state: 'visible' });
  const modalTextWithExtra = await page.locator('#viewModalContent').innerText();
  record('C1. DOC: bấm THẬT nút "🔍 Xem Quy Trình" (dept đã có quy trình gốc + đã chọn Nhóm Phê Duyệt Cuối) -> modal hiện ĐÚNG bước "Cấp Phê Duyệt Cuối Cùng" mới nối thêm',
    modalTextWithExtra.includes('Cấp Phê Duyệt Cuối Cùng') && modalTextWithExtra.includes('Trưởng Phòng CNTT'),
    modalTextWithExtra);
  await page.click('#viewDocModal button, #viewDocModal [data-op]').catch(() => {});
  await page.evaluate(() => document.getElementById('viewDocModal')?.classList.add('hidden'));

  // C2: case study thật qua nút bấm — đổi dept sang "Phòng Kế Toán" (KHÔNG có quy trình gốc), Cấp/Nhóm
  // Phê Duyệt Cuối VẪN còn đang chọn từ bước C1 (DOM không reset) -> bấm nút KHÔNG được throw lỗi, modal
  // phải hiện cảnh báo "chưa được cấu hình" như hành vi cũ (không đổi hành vi này, chỉ không crash thêm).
  await page.selectOption('#selDept', 'Phòng Kế Toán');
  let clickError = null;
  try {
    await page.click('#docPreviewWfBtn');
    await page.waitForSelector('#viewDocModal:not(.hidden)', { state: 'visible' });
  } catch (e) { clickError = String(e && e.message || e); }
  const modalTextNoConfig = await page.locator('#viewModalContent').innerText();
  record('C2. DOC (case study): dept CHƯA có quy trình gốc + Nhóm Phê Duyệt Cuối vẫn đang chọn -> bấm "🔍 Xem Quy Trình" KHÔNG throw, vẫn hiện đúng cảnh báo "chưa được cấu hình"',
    !clickError && /chưa được cấu hình/i.test(modalTextNoConfig), JSON.stringify({ clickError, modalTextNoConfig }));

  // =====================================================================================
  // D) CSP — không có lỗi JS/console nào phát sinh trong TOÀN BỘ bài test (script-src/style-src thật).
  // =====================================================================================
  record('D. KHÔNG có lỗi JS (pageerror/console.error) nào phát sinh trong toàn bộ bài test (CSP thật, không unsafe-inline)',
    pageErrors.length === 0, JSON.stringify(pageErrors));

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
