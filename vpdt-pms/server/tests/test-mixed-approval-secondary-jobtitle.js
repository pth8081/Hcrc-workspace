'use strict';
// server/tests/test-mixed-approval-secondary-jobtitle.js
//
// LỖI ĐÃ VÁ (11/2026, báo cáo người dùng — "Loan giữ chức danh kiêm nhiệm 'Thẩm định FMCG 2' ở Cấu Hình
// Quy Trình Nâng Cao (QT Giá Bán Buôn) nhưng không bao giờ lên danh sách duyệt dù cấu hình đúng Mức/
// Bước/Ngành Hàng"): resolveOperationOrderStoreMixedApprovalRuleUsernames()/
// resolveItPriceWholesaleMixedApprovalRuleUsernamesForStores() (lib/workflowEngine.js) VÀ 2 bản mirror
// client (public/js/core.js) trước đây lọc u.jobTitle === rule.jobTitle TRƯỚC — "Vị Trí Kiêm Nhiệm"
// (secondaryPositions) CHỈ được xét SAU đó để mở rộng PHÒNG BAN cho người ĐÃ khớp sẵn chức danh CHÍNH.
// Hậu quả: 1 người giữ ĐÚNG chức danh rule yêu cầu nhưng HOÀN TOÀN dưới dạng kiêm nhiệm (chức danh chính
// là thứ khác hẳn) không bao giờ lọt qua được bước lọc đầu tiên, dù đúng chức danh đúng phòng ban —
// approvers[] trống, bước treo vĩnh viễn (chỉ admin bypass được).
//
// Vá: coi chức danh CHÍNH + từng mục Vị Trí Kiêm Nhiệm của 1 người là các "vị trí" độc lập — khớp rule
// NẾU BẤT KỲ 1 vị trí nào có ĐÚNG jobTitle VÀ thoả điều kiện phòng ban của CHÍNH vị trí đó (cố ý KHÔNG
// trộn phòng ban giữa các vị trí khác nhau của cùng 1 người — xem kịch bản "cách ly" bên dưới).
//
// Phủ CẢ 4 nơi (2 module x 2 phía):
//   1-4. operationOrders STORE, server (lib/workflowEngine.js)
//   5-8. itPriceWholesale, server (lib/workflowEngine.js) — kịch bản CHÍNH người dùng báo cáo (có Ngành Hàng)
//   9-10. operationOrders STORE, client mirror (public/js/core.js)
//   11-12. itPriceWholesale, client mirror (public/js/core.js)
//
// Chạy: node server/tests/test-mixed-approval-secondary-jobtitle.js
const assert = require('assert');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const {
  applyWorkflowAction, WorkflowError,
  resolveOperationOrderStoreMixedApprovers, resolveItPriceWholesaleStoreMixedApprovers
} = require('../lib/workflowEngine');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}
function assertThrows(fn, statusExpected, label) {
  try { fn(); } catch (err) {
    assert(err instanceof WorkflowError || typeof err.status === 'number', `${label}: lỗi ném ra phải có .status`);
    if (statusExpected !== undefined) assert.strictEqual(err.status, statusExpected, `${label}: sai mã lỗi (nhận ${err.status})`);
    return;
  }
  throw new Error(`${label}: đáng lẽ phải ném lỗi nhưng không`);
}
function freshOrder(overrides) {
  return Object.assign({
    id: 1, code: 'DH-0001', dept: 'Siêu Thị A', status: 'PENDING', currentStep: 1, history: [],
    creator: 'nv.a', creatorName: 'Nhân Viên A', amount: 5000000, orderLocationType: 'STORE', items: []
  }, overrides);
}
function freshItPrice(overrides) {
  return Object.assign({
    id: 1, code: 'DGBB-0001', dept: 'HO', status: 'PENDING', currentStep: 1, history: [],
    creator: 'nv.hr', creatorName: 'Nhân Viên HO', priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5',
    storeScope: { stores: ['Siêu Thị A'] }, nganhHang: [], items: []
  }, overrides);
}
const WF_1STEP = { id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] };

// ===================== 1-2) operationOrders STORE — chức danh CẤP CÔNG TY, hoàn toàn kiêm nhiệm =====================
{
  // Loan-style: chức danh CHÍNH khác hẳn, "Thẩm Định Ngành Hàng" chỉ là Vị Trí Kiêm Nhiệm.
  const loan = {
    username: 'loan', name: 'Loan', dept: 'Phòng Mua Hàng', jobTitle: 'Nhân Viên Mua Hàng', perms: {}, active: true,
    secondaryPositions: [{ jobTitle: 'Thẩm Định Ngành Hàng', dept: 'HO' }]
  };
  const appData = {
    workflows: [WF_1STEP], users: [loan],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Thẩm Định Ngành Hàng', stores: [] }
    ],
    storeJobTitles: [] // chức danh cấp công ty — KHÔNG thuộc danh mục Chức Danh (Siêu Thị)
  };
  test('operationOrders STORE: chức danh cấp công ty HOÀN TOÀN kiêm nhiệm (chức danh chính khác hẳn) vẫn khớp được', () => {
    const r = resolveOperationOrderStoreMixedApprovers(appData.operationOrderStoreMixedApprovalRules, 'Siêu Thị A', appData.users, [1], undefined);
    assert.deepStrictEqual(r[1], ['loan']);
  });
  test('operationOrders STORE end-to-end: Loan (kiêm nhiệm) duyệt được đơn Siêu Thị A', () => {
    const item = freshOrder({ dept: 'Siêu Thị A' });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: loan, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
}

// ===================== 3-4) operationOrders STORE — chức danh SIÊU THỊ kiêm nhiệm + CÁCH LY vị trí =====================
{
  // U giữ 2 vị trí kiêm nhiệm KHÁC NHAU ở 2 siêu thị khác nhau — rule chỉ được "mượn" dept của ĐÚNG vị
  // trí có jobTitle khớp, KHÔNG được mượn dept của vị trí kiêm nhiệm khác (dù cùng 1 người).
  const u = {
    username: 'u.multi', name: 'U Đa Vai Trò', dept: 'Phòng Mua Hàng', jobTitle: 'Nhân Viên Mua Hàng', perms: {}, active: true,
    secondaryPositions: [
      { jobTitle: 'Thủ Kho', dept: 'Siêu Thị X' },
      { jobTitle: 'Giám Đốc Siêu Thị', dept: 'Siêu Thị Y' }
    ]
  };
  const appData = {
    workflows: [WF_1STEP], users: [u],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc Siêu Thị', stores: [] }
    ],
    storeJobTitles: [{ label: 'Giám Đốc Siêu Thị' }]
  };
  const storeJobTitleLabels = appData.storeJobTitles.map(j => j.label);
  test('operationOrders STORE: kiêm nhiệm ĐÚNG chức danh + đúng siêu thị (Siêu Thị Y) -> khớp', () => {
    const r = resolveOperationOrderStoreMixedApprovers(appData.operationOrderStoreMixedApprovalRules, 'Siêu Thị Y', appData.users, [1], undefined, storeJobTitleLabels);
    assert.deepStrictEqual(r[1], ['u.multi']);
  });
  test('operationOrders STORE: CÁCH LY vị trí — Siêu Thị X (vị trí kiêm nhiệm KHÁC, "Thủ Kho") KHÔNG được mượn để khớp "Giám Đốc Siêu Thị"', () => {
    const r = resolveOperationOrderStoreMixedApprovers(appData.operationOrderStoreMixedApprovalRules, 'Siêu Thị X', appData.users, [1], undefined, storeJobTitleLabels);
    assert.deepStrictEqual(r[1], [], 'Không được lẫn dept của vị trí kiêm nhiệm KHÁC chức danh');
  });
}

// ===================== 5-8) itPriceWholesale — kịch bản CHÍNH người dùng báo cáo (kèm Ngành Hàng) =====================
{
  const gdst = { username: 'gdst', name: 'Phạm Thị Liễu', dept: 'Siêu thị 63 Hàng Trống', jobTitle: 'Giám đốc Siêu thị', perms: {}, active: true };
  // "Loan": chức danh CHÍNH là "Nhân Viên Mua Hàng", "Thẩm định FMCG 2" CHỈ là Vị Trí Kiêm Nhiệm (HO).
  const loan = {
    username: 'loan', name: 'Loan', dept: 'Phòng Mua Hàng', jobTitle: 'Nhân Viên Mua Hàng', perms: {}, active: true,
    secondaryPositions: [{ jobTitle: 'Thẩm định FMCG 2', dept: 'HO' }]
  };
  const appData = {
    workflows: [WF_1STEP], users: [gdst, loan],
    itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_1STEP' } },
    storeJobTitles: [{ label: 'Giám đốc Siêu thị' }],
    itPriceWholesaleStoreMixedApprovalRules: [
      { id: 1, tier: 'MARGIN_LT5', step: 1, mode: 'JOBTITLE', jobTitle: 'Giám đốc Siêu thị', jobTitleDept: null, stores: [], nganhHang: [] },
      { id: 2, tier: 'MARGIN_LT5', step: 1, mode: 'JOBTITLE', jobTitle: 'Thẩm định FMCG 2', jobTitleDept: null, stores: [], nganhHang: ['NONGSAN'] }
    ]
  };
  test('itPriceWholesale: Loan (chức danh "Thẩm định FMCG 2" HOÀN TOÀN kiêm nhiệm) lên đúng approver Bước 1 khi đề xuất chọn đúng ngành hàng', () => {
    const r = resolveItPriceWholesaleStoreMixedApprovers(appData.itPriceWholesaleStoreMixedApprovalRules, 'MARGIN_LT5', ['Siêu thị 63 Hàng Trống'], ['NONGSAN'], appData.users, [1], appData.storeJobTitles.map(j => j.label));
    assert.deepStrictEqual(new Set(r[1]), new Set(['gdst', 'loan']));
  });
  test('itPriceWholesale: đề xuất KHÔNG chọn ngành hàng của Loan -> Loan KHÔNG lên approver (vẫn còn GĐST mặc định)', () => {
    const r = resolveItPriceWholesaleStoreMixedApprovers(appData.itPriceWholesaleStoreMixedApprovalRules, 'MARGIN_LT5', ['Siêu thị 63 Hàng Trống'], ['KHAC'], appData.users, [1], appData.storeJobTitles.map(j => j.label));
    assert.deepStrictEqual(r[1], ['gdst']);
  });
  test('itPriceWholesale end-to-end: Loan (kiêm nhiệm) duyệt THẬT được đề xuất đúng ngành hàng', () => {
    const item = freshItPrice({ storeScope: { stores: ['Siêu thị 63 Hàng Trống'] }, nganhHang: ['NONGSAN'] });
    const { transition } = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: loan, comment: '', appData });
    // Bước đồng duyệt 2 người (gdst + loan) -> 1 lượt duyệt đầu là PARTIAL_APPROVE.
    assert.strictEqual(transition.type, 'PARTIAL_APPROVE');
  });
  test('itPriceWholesale end-to-end: Loan KHÔNG duyệt được đề xuất ngành hàng khác (ngoài phạm vi kiêm nhiệm) -> 403', () => {
    const item = freshItPrice({ storeScope: { stores: ['Siêu thị 63 Hàng Trống'] }, nganhHang: ['KHAC'] });
    assertThrows(() => applyWorkflowAction({ moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: loan, comment: '', appData }), 403, 'Loan ngoài phạm vi ngành hàng kiêm nhiệm');
  });
}

// ===================== 9-12) Client mirror (public/js/core.js) =====================
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8993;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function clientMirrorMain() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let results;
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));

    results = await page.evaluate(() => {
      const results = [];
      function check(name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

      // ----- operationOrders STORE: chức danh cấp công ty hoàn toàn kiêm nhiệm -----
      DB.users = [{
        username: 'loan', name: 'Loan', dept: 'Phòng Mua Hàng', jobTitle: 'Nhân Viên Mua Hàng', active: true,
        secondaryPositions: [{ jobTitle: 'Thẩm Định Ngành Hàng', dept: 'HO' }]
      }];
      DB.storeJobTitles = [];
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Thẩm Định Ngành Hàng', stores: [] }
      ];
      const oo = computeOperationOrderStoreMixedApproversClient('Siêu Thị A', [1], undefined);
      check('Client mirror — operationOrders: chức danh cấp công ty hoàn toàn kiêm nhiệm vẫn khớp', JSON.stringify(oo[1]) === '["loan"]', JSON.stringify(oo));

      // ----- operationOrders STORE: cách ly vị trí (không mượn dept vị trí kiêm nhiệm khác) -----
      DB.users = [{
        username: 'u.multi', name: 'U Đa Vai Trò', dept: 'Phòng Mua Hàng', jobTitle: 'Nhân Viên Mua Hàng', active: true,
        secondaryPositions: [{ jobTitle: 'Thủ Kho', dept: 'Siêu Thị X' }, { jobTitle: 'Giám Đốc Siêu Thị', dept: 'Siêu Thị Y' }]
      }];
      DB.storeJobTitles = [{ label: 'Giám Đốc Siêu Thị' }];
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc Siêu Thị', stores: [] }
      ];
      const ooY = computeOperationOrderStoreMixedApproversClient('Siêu Thị Y', [1], undefined);
      const ooX = computeOperationOrderStoreMixedApproversClient('Siêu Thị X', [1], undefined);
      check('Client mirror — operationOrders: kiêm nhiệm ĐÚNG siêu thị (Y) khớp', JSON.stringify(ooY[1]) === '["u.multi"]', JSON.stringify(ooY));
      check('Client mirror — operationOrders: CÁCH LY — siêu thị X (vị trí kiêm nhiệm khác) KHÔNG khớp', JSON.stringify(ooX[1]) === '[]', JSON.stringify(ooX));

      // ----- itPriceWholesale: kịch bản chính người dùng báo cáo -----
      DB.users = [
        { username: 'gdst', name: 'Phạm Thị Liễu', dept: 'Siêu thị 63 Hàng Trống', jobTitle: 'Giám đốc Siêu thị', active: true },
        {
          username: 'loan', name: 'Loan', dept: 'Phòng Mua Hàng', jobTitle: 'Nhân Viên Mua Hàng', active: true,
          secondaryPositions: [{ jobTitle: 'Thẩm định FMCG 2', dept: 'HO' }]
        }
      ];
      DB.storeJobTitles = [{ label: 'Giám đốc Siêu thị' }];
      DB.itPriceWholesaleStoreMixedApprovalRules = [
        { id: 1, tier: 'MARGIN_LT5', step: 1, mode: 'JOBTITLE', jobTitle: 'Giám đốc Siêu thị', jobTitleDept: null, stores: [], nganhHang: [] },
        { id: 2, tier: 'MARGIN_LT5', step: 1, mode: 'JOBTITLE', jobTitle: 'Thẩm định FMCG 2', jobTitleDept: null, stores: [], nganhHang: ['NONGSAN'] }
      ];
      const ip1 = computeItPriceWholesaleStoreMixedApproversClient('MARGIN_LT5', ['Siêu thị 63 Hàng Trống'], ['NONGSAN'], [1]);
      const ip2 = computeItPriceWholesaleStoreMixedApproversClient('MARGIN_LT5', ['Siêu thị 63 Hàng Trống'], ['KHAC'], [1]);
      check('Client mirror — itPriceWholesale: Loan (kiêm nhiệm) lên approver khi đúng ngành hàng',
        new Set(ip1[1]).size === 2 && ip1[1].includes('gdst') && ip1[1].includes('loan'), JSON.stringify(ip1));
      check('Client mirror — itPriceWholesale: Loan KHÔNG lên approver khi ngành hàng khác (chỉ còn GĐST)',
        JSON.stringify(ip2[1]) === '["gdst"]', JSON.stringify(ip2));

      return { results };
    });
  } finally {
    await browser.close();
    server.close();
  }
  for (const r of results.results) {
    if (r.pass) { console.log(`PASS: ${r.name}`); passed++; }
    else { console.log(`FAIL: ${r.name}\n  -> ${r.detail}`); failed++; }
  }
}

clientMirrorMain().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}).catch(err => { console.error(err); process.exit(1); });
