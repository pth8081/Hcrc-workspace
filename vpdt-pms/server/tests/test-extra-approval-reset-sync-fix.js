// server/tests/test-extra-approval-reset-sync-fix.js
//
// Bug thật (10/2026, người dùng báo qua ảnh chụp màn hình Mua Hàng Bán Lẻ): "Khi chọn bước phê duyệt
// cuối cùng mà ấn làm mới thì phê duyệt thêm vẫn không thay đổi mặc dù phê duyệt cuối cùng đã đổi... bạn
// xem module văn bản trình và hợp đồng có vẻ không bị".
//
// NGUYÊN NHÂN GỐC: formEl.reset() (gọi bên trong mọi resetXxxForm() của 7 module dùng chung
// renderExtraApprovalMount()/"Nhóm Phê Duyệt Cuối" — CAR/OFFICE_BUY/OFFICE_FIX/ITPRICE_RETAIL/
// ITPRICE_WHOLESALE/OPERATION_ORDER_*/DOC/PAYMENT) đưa <select id="extraApprovalLevel_<mk>"> về lại
// option đầu tiên NHƯNG KHÔNG bắn sự kiện 'change' (hành vi chuẩn của HTMLFormElement.reset() trên mọi
// trình duyệt) — nên onExtraApprovalLevelChange(mk) không tự chạy lại, khiến khối checkbox "Phê Duyệt
// Thêm" (renderExtraApprovalLayerCheckboxes()) GIỮ NGUYÊN markup của Cấp vừa bị đổi đi, không khớp Cấp
// vừa reset về. Văn Bản Trình/Hợp Đồng KHÔNG bị vì 2 module đó dùng khối "Nhóm Phê Duyệt Trình/HĐ" bespoke
// riêng (renderSubmissionExtraApprovalMount()/renderContractExtraApprovalMount()), không đi qua
// renderExtraApprovalMount() dùng chung này.
//
// ĐÃ VÁ: gọi lại renderExtraApprovalMount(moduleKey, mountId) (dựng lại TOÀN BỘ khối dropdown+checkbox về
// đúng trạng thái sạch, mirror ĐÚNG lời gọi ban đầu lúc vào tab) ở cuối mỗi resetXxxForm() của 7 module
// trên. VPP KHÔNG cần vá (resetVppRegForm() không hề đụng tới <select> Cấp Phê Duyệt Cuối — đã xác nhận
// qua đọc code, không phải bỏ sót).
//
// Bài test này xác nhận bản vá qua browser Playwright THẬT, bấm THẬT nút "↺ Làm Mới" (không gọi thẳng
// resetXxxForm()) cho 3 module đại diện (ITPRICE_RETAIL — đúng module trong ảnh chụp màn hình người dùng
// gửi, CAR, DOC) — mỗi module seed 2 Cấp Phê Duyệt Cuối có tập "Phê Duyệt Thêm" hiển thị KHÁC NHAU (Cấp
// "Khác" có thêm 1 lớp "Nhóm B" mà Cấp "Mặc định" không có), chọn Cấp "Khác" rồi bấm "↺ Làm Mới" thật, xác
// nhận: (1) <select> trở về đúng Cấp mặc định (hành vi form.reset() chuẩn), VÀ (2) khối checkbox "Phê
// Duyệt Thêm" KHÔNG còn sót checkbox "Nhóm B" (nếu còn sót tức là panel chưa được dựng lại — đúng y hệt
// bug người dùng báo).
//
// Chạy: node server/tests/test-extra-approval-reset-sync-fix.js
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

const MODULE_KEYS = ['ITPRICE_RETAIL', 'CAR', 'DOC'];

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

    // 2 nhóm, 2 Cấp — Cấp "L1" (mặc định, option đầu tiên) CHỈ hiện "Nhóm A" (locked, tự tick), Cấp "L2"
    // hiện THÊM "Nhóm B" (KHÔNG locked) — đúng khuôn seed của test-extra-approval-preview-fix.js, chỉ
    // thêm 1 lớp thứ 2 để phân biệt rõ 2 Cấp qua chính tập checkbox hiển thị (không cần mở dropdown).
    const GROUPS = [
      { id: 'GA', label: 'Nhóm A', order: 1, members: ['tp.cntt'], singleApprover: true },
      { id: 'GB', label: 'Nhóm B', order: 2, members: ['tp.cntt'], singleApprover: true }
    ];
    const LEVELS = [
      { id: 'L1', label: 'Mặc định', visibleGroupIds: ['GA'], lockedGroupIds: ['GA'], isSystemDefault: true },
      { id: 'L2', label: 'Khác', visibleGroupIds: ['GA', 'GB'], lockedGroupIds: ['GA'] }
    ];
    const extraSeed = {};
    moduleKeys.forEach(mk => { extraSeed[`extraApprovalGroups_${mk}`] = JSON.parse(JSON.stringify(GROUPS)); extraSeed[`extraApprovalLevels_${mk}`] = JSON.parse(JSON.stringify(LEVELS)); });

    Object.assign(DB, {
      depts: ['Phòng CNTT'], jobTitles: ['Nhân viên', 'Trưởng Phòng'],
      storeJobTitles: [{ label: 'Giám Đốc Siêu Thị' }], stores: ['Siêu Thị Quận 1'],
      workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] }],
      deptWorkflows: { 'Phòng CNTT': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } },
      carDeptWorkflows: { 'Phòng CNTT': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } },
      officeDeptWorkflows: { 'Phòng CNTT': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } },
      officeFixDeptWorkflows: {}, itPriceDeptWorkflows: {}, itPriceTierWorkflows: {},
      operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {}, operationOrderStoreMixedApprovalRules: [],
      submissionApprovalGroups: [], submissionApprovalLevels: [], contractApprovalGroups: [], contractApprovalLevels: [],
      workflowParticipatingDepts: [], workflowParticipatingDeptGroups: [], vppExcludedJobTitles: [], workflowParticipatingPositions: [],
      quickApplyConfigs: [], deptAbbrs: {}, docCatAbbrs: {}, cats: ['Chính sách'],
      itPriceApprovals: [], itSupportTickets: [], itPriceMasterLists: [], itServiceRenewals: [],
      docs: [], carRegs: [], officeReqs: [], vppRegistrations: [], paymentRequests: [], operationOrders: [],
      vppPeriods: [], uniformCatalog: [], formTemplates: {}, mhPriceZones: ['Vùng 1'],
      users: [], permGroups: [], _versions: {},
      ...extraSeed
    });

    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000',
      perms: { admin: true, uploadAll: true, carCreate: true, itPriceProposeCreateRetail: true },
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
  record('setup: finishLogin(admin) + seed DB.* cho 3 moduleKey (2 Cấp lệch tập checkbox) không lỗi', setup.loginOk && setup.headerShown, JSON.stringify(setup));

  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  // Kịch bản dùng chung cho cả 3 module: chọn Cấp "L2" (hiện thêm checkbox "Nhóm B") qua selectOption()
  // (bắn sự kiện 'change' thật -> onExtraApprovalLevelChange() thật chạy), xác nhận checkbox "Nhóm B" đã
  // xuất hiện trong panel, rồi bấm THẬT nút "↺ Làm Mới" -> xác nhận <select> về lại "L1" VÀ checkbox
  // "Nhóm B" KHÔNG còn sót trong panel (đúng tập của L1).
  async function runResetSyncScenario(mk, { openForm, resetBtnSelector }) {
    await openForm();
    const levelSel = page.locator(`#extraApprovalLevel_${mk}`);
    await levelSel.selectOption('L2');
    await page.waitForTimeout(50);
    const gbBeforeReset = await page.locator(`#extraApprovalDropdownPanel_${mk} input.extra-layer-toggle_${mk}[value="GB"]`).count();
    record(`${mk}: chọn Cấp "Khác" (L2) qua DOM thật -> checkbox "Nhóm B" xuất hiện đúng trong panel`, gbBeforeReset === 1,
      JSON.stringify({ gbBeforeReset }));

    await page.click(resetBtnSelector);
    await page.waitForTimeout(50);

    const afterReset = await page.evaluate((moduleKey) => ({
      levelValue: document.getElementById(`extraApprovalLevel_${moduleKey}`)?.value,
      gbStillInPanel: !!document.querySelector(`#extraApprovalDropdownPanel_${moduleKey} input.extra-layer-toggle_${moduleKey}[value="GB"]`)
    }), mk);
    record(`${mk}: bấm THẬT nút "↺ Làm Mới" -> <select> Cấp Phê Duyệt Cuối Cùng trở về đúng Cấp mặc định (L1)`,
      afterReset.levelValue === 'L1', JSON.stringify(afterReset));
    record(`${mk}: bấm THẬT nút "↺ Làm Mới" -> khối "Phê Duyệt Thêm" ĐÃ ĐƯỢC DỰNG LẠI đúng theo Cấp mới (checkbox "Nhóm B" của Cấp cũ KHÔNG còn sót) — chính bug người dùng báo`,
      afterReset.gbStillInPanel === false, JSON.stringify(afterReset));
  }

  // 1) ITPRICE_RETAIL (Mua Hàng Bán Lẻ) — ĐÚNG module trong ảnh chụp màn hình người dùng gửi.
  await page.evaluate(async () => { await switchTab('muaHang'); setPurchasingSubTab('ITPRICE'); });
  await page.waitForSelector('#muaHangSection', { state: 'visible' });
  await page.waitForTimeout(80);
  await runResetSyncScenario('ITPRICE_RETAIL', {
    openForm: () => page.click('#btnMhItPriceCreateNew'),
    resetBtnSelector: '#mhItPriceCreateForm button[data-arg1="resetMhItPriceForm"]'
  });

  // 2) CAR (Đăng Ký Xe).
  await page.evaluate(async () => { await switchTab('car'); });
  await page.waitForSelector('#carSection', { state: 'visible' });
  await page.waitForTimeout(80);
  await runResetSyncScenario('CAR', {
    openForm: () => page.click('[data-op="openCarForm"]'),
    resetBtnSelector: '#carForm button[data-arg1="resetCarRegForm"]'
  });

  // 3) DOC (Tài Liệu).
  await page.evaluate(async () => { await switchTab('doc'); });
  await page.waitForSelector('#docSection', { state: 'visible' });
  await page.waitForTimeout(80);
  await page.evaluate(() => openUploadBox());
  await page.selectOption('#selDept', 'Phòng CNTT');
  await runResetSyncScenario('DOC', {
    openForm: () => Promise.resolve(),
    resetBtnSelector: '#docForm button[data-arg1="resetDocUploadForm"]'
  });

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
