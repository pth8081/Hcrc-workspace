'use strict';
// server/tests/test-operationorder-store-tier-mixed-approval.js
//
// Test cho tính năng "Mức" (tier) thêm vào Quy Trình Đặt Hàng Siêu Thị (operationOrderStoreMixedApprovalRules,
// 10/2026, theo yêu cầu người dùng: "đặt hàng siêu thị được cấu hình trong quy trình nâng cao cần xử lý
// giống đặt hàng bán buôn... để tôi có thể chọn được các mức link đến được quy trình đặt hàng") — CÙNG
// KHUÔN tier của "🏪 QT Giá Bán Buôn (Siêu Thị)" (itPriceWholesaleStoreMixedApprovalRules, xem
// test-itprice-wholesale-mixed-approval.js), NHƯNG khác 1 điểm cốt lõi: `tier` ở đây là TÙY CHỌN (dữ liệu
// thật đã có từ trước đợt này không hề có field `tier`) — dòng không có `tier` (wildcard, `!r.tier`) PHẢI
// tiếp tục áp dụng cho CẢ 3 mức như hành vi gốc, không được coi là "không khớp mức nào" rồi biến mất.
//
// Phủ (phần 1, server, lib/workflowEngine.js::resolveOperationOrderStoreMixedApprovers()):
//   1. Dòng WILDCARD (không tier, dữ liệu kiểu CŨ) áp dụng cho CẢ 3 mức — regression chống đứt gãy dữ
//      liệu sản xuất đã cấu hình từ trước khi tính năng Mức ra đời.
//   2. Dòng CÓ tier cụ thể CHỈ áp dụng đúng mức đó — mức khác (dù cùng số bước) không khớp.
//   3. HỢP (UNION): 1 dòng wildcard + 1 dòng tier cụ thể cùng khớp 1 (bước, mức, siêu thị) -> người duyệt
//      là hợp cả 2, không loại trừ nhau — admin có thể thêm override CHỈ cho 1 mức cụ thể mà không cần
//      sửa/xoá dòng wildcard đang áp dụng cho các mức còn lại.
//   4. Khác mức, khác bước: dòng tier cụ thể của Bước 1 Mức A không bị lẫn sang Bước 1 Mức B.
//
// Phủ (phần 2, client mirror, public/js/core.js::computeOperationOrderStoreMixedApproversClient()):
//   5. Cùng 3 kịch bản (wildcard/tier cụ thể/union) phải cho kết quả GIỐNG HỆT server — mirror 1:1, tránh
//      lệch hành vi hiển thị (preview approver) so với server áp dụng thật lúc duyệt.
//
// Chạy: node server/tests/test-operationorder-store-tier-mixed-approval.js
const assert = require('assert');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const {
  applyWorkflowAction, WorkflowError,
  resolveOperationOrderStoreMixedApprovers
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
const WF_1STEP = { id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] };

// ===================== 1) Dòng WILDCARD (không tier) áp dụng cho CẢ 3 mức =====================
{
  const gdA = { username: 'gd.a', name: 'Giám Đốc A', dept: 'Siêu Thị A', perms: {}, active: true };
  const appData = {
    workflows: [WF_1STEP], users: [gdA],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' }, FROM10M_TO100M: { workflowId: 'WF_1STEP' }, GTE100M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    // Dòng cấu hình CŨ, lưu trước khi tính năng Mức ra đời -> hoàn toàn không có field `tier`.
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'PERSON', username: 'gd.a', stores: ['Siêu Thị A'] }
    ]
  };

  test('WILDCARD (không tier): khớp approver ở mức LT10M (≤10tr)', () => {
    const item = freshOrder({ dept: 'Siêu Thị A', amount: 5000000 });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdA, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('WILDCARD (không tier): khớp approver ở mức FROM10M_TO100M (>10tr-≤100tr) — KHÔNG hề bị "biến mất" dù chưa gán tier', () => {
    const item = freshOrder({ dept: 'Siêu Thị A', amount: 50000000 });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdA, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('WILDCARD (không tier): khớp approver ở mức GTE100M (>100tr)', () => {
    const item = freshOrder({ dept: 'Siêu Thị A', amount: 500000000 });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdA, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('resolveOperationOrderStoreMixedApprovers() trực tiếp: dòng wildcard trả về approver cho CẢ 3 mức truyền vào', () => {
    const r1 = resolveOperationOrderStoreMixedApprovers(appData.operationOrderStoreMixedApprovalRules, 'Siêu Thị A', appData.users, [1], 'LT10M');
    const r2 = resolveOperationOrderStoreMixedApprovers(appData.operationOrderStoreMixedApprovalRules, 'Siêu Thị A', appData.users, [1], 'FROM10M_TO100M');
    const r3 = resolveOperationOrderStoreMixedApprovers(appData.operationOrderStoreMixedApprovalRules, 'Siêu Thị A', appData.users, [1], 'GTE100M');
    assert.deepStrictEqual(r1[1], ['gd.a']);
    assert.deepStrictEqual(r2[1], ['gd.a']);
    assert.deepStrictEqual(r3[1], ['gd.a']);
  });
}

// ===================== 2) Dòng CÓ tier cụ thể CHỈ áp dụng đúng mức đó =====================
{
  const gdHigh = { username: 'gd.high', name: 'GĐ Mức Cao', dept: 'Siêu Thị A', perms: {}, active: true };
  const appData = {
    workflows: [WF_1STEP], users: [gdHigh],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' }, GTE100M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: [
      { id: 1, tier: 'GTE100M', step: 1, mode: 'PERSON', username: 'gd.high', stores: ['Siêu Thị A'] }
    ]
  };

  test('Dòng tier cụ thể (GTE100M): approver duyệt được đơn ĐÚNG mức GTE100M', () => {
    const item = freshOrder({ dept: 'Siêu Thị A', amount: 500000000 });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdHigh, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('Dòng tier cụ thể (GTE100M): CÙNG approver KHÔNG duyệt được đơn mức LT10M (dòng không khớp mức) -> 403', () => {
    const item = freshOrder({ dept: 'Siêu Thị A', amount: 5000000 });
    assertThrows(() => applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdHigh, comment: '', appData }), 403, 'khác mức');
  });
  test('resolveOperationOrderStoreMixedApprovers(): dòng tier cụ thể không lọt sang tier khác dù cùng Bước', () => {
    const matchOwn = resolveOperationOrderStoreMixedApprovers(appData.operationOrderStoreMixedApprovalRules, 'Siêu Thị A', appData.users, [1], 'GTE100M');
    const matchOther = resolveOperationOrderStoreMixedApprovers(appData.operationOrderStoreMixedApprovalRules, 'Siêu Thị A', appData.users, [1], 'LT10M');
    assert.deepStrictEqual(matchOwn[1], ['gd.high']);
    assert.deepStrictEqual(matchOther[1], []);
  });
}

// ===================== 3) HỢP (UNION): wildcard + tier cụ thể cùng khớp 1 (bước, mức) =====================
{
  const gdDefault = { username: 'gd.default', name: 'GĐ Mặc Định', dept: 'Siêu Thị A', perms: {}, active: true };
  const ptgdHigh = { username: 'ptgd.high', name: 'Phó TGĐ Mức Cao', dept: 'Ban Giám Đốc', perms: {}, active: true };
  const rules = [
    // Wildcard: GĐ siêu thị duyệt Bước 1 ở MỌI mức.
    { id: 1, step: 1, mode: 'PERSON', username: 'gd.default', stores: ['Siêu Thị A'] },
    // Override CHỈ ở mức GTE100M: thêm Phó TGĐ cùng duyệt Bước 1 (không đụng gì tới dòng wildcard).
    { id: 2, tier: 'GTE100M', step: 1, mode: 'PERSON', username: 'ptgd.high', stores: ['Siêu Thị A'] }
  ];
  const appData = {
    workflows: [WF_1STEP], users: [gdDefault, ptgdHigh],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' }, GTE100M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: rules
  };

  test('UNION: ở mức GTE100M, Bước 1 có CẢ wildcard LẪN tier cụ thể -> cả 2 người đều là approver', () => {
    const approvers = resolveOperationOrderStoreMixedApprovers(rules, 'Siêu Thị A', appData.users, [1], 'GTE100M');
    assert.deepStrictEqual(new Set(approvers[1]), new Set(['gd.default', 'ptgd.high']));
  });
  test('UNION: ở mức LT10M (tier cụ thể không áp dụng), Bước 1 CHỈ còn wildcard', () => {
    const approvers = resolveOperationOrderStoreMixedApprovers(rules, 'Siêu Thị A', appData.users, [1], 'LT10M');
    assert.deepStrictEqual(approvers[1], ['gd.default']);
  });
  test('UNION end-to-end: đơn mức GTE100M, Phó TGĐ (chỉ gán riêng mức này) duyệt được dù KHÔNG có trong dòng wildcard', () => {
    const item = freshOrder({ dept: 'Siêu Thị A', amount: 500000000 });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: ptgdHigh, comment: '', appData });
    // Bước đồng duyệt (2 approver) -> 1 lượt duyệt đầu là PARTIAL_APPROVE, không phải COMPLETED.
    assert.strictEqual(transition.type, 'PARTIAL_APPROVE');
  });
  test('UNION end-to-end: đơn mức LT10M, Phó TGĐ (chỉ gán riêng mức GTE100M) KHÔNG duyệt được -> 403', () => {
    const item = freshOrder({ dept: 'Siêu Thị A', amount: 5000000 });
    assertThrows(() => applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: ptgdHigh, comment: '', appData }), 403, 'union khác mức');
  });
}

// ===================== 4) Khác mức, khác bước: không lẫn giữa các ô (tier, step) =====================
{
  const u1 = { username: 'u1', name: 'User 1', dept: 'Siêu Thị A', perms: {}, active: true };
  const u2 = { username: 'u2', name: 'User 2', dept: 'Siêu Thị A', perms: {}, active: true };
  const rules = [
    { id: 1, tier: 'LT10M', step: 1, mode: 'PERSON', username: 'u1', stores: ['Siêu Thị A'] },
    { id: 2, tier: 'GTE100M', step: 1, mode: 'PERSON', username: 'u2', stores: ['Siêu Thị A'] }
  ];
  test('Dòng tier A Bước 1 không lẫn sang tier B Bước 1 (cùng số bước, khác mức)', () => {
    const matchLT10M = resolveOperationOrderStoreMixedApprovers(rules, 'Siêu Thị A', [u1, u2], [1], 'LT10M');
    const matchGTE100M = resolveOperationOrderStoreMixedApprovers(rules, 'Siêu Thị A', [u1, u2], [1], 'GTE100M');
    assert.deepStrictEqual(matchLT10M[1], ['u1']);
    assert.deepStrictEqual(matchGTE100M[1], ['u2']);
  });
}

console.log(`\n${passed} passed, ${failed} failed (server, lib/workflowEngine.js).`);

// =====================================================================================
// Phần 2: client mirror (computeOperationOrderStoreMixedApproversClient(), public/js/core.js) — cùng 3
// kịch bản (wildcard/tier cụ thể/union) phải khớp 1:1 kết quả server ở trên.
// =====================================================================================
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8973;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
};
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

      // ----- Wildcard áp dụng cho CẢ 3 mức -----
      DB.users = [{ username: 'gd.a', name: 'Giám Đốc A', dept: 'Siêu Thị A', active: true }];
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'PERSON', username: 'gd.a', stores: ['Siêu Thị A'] }
      ];
      const w1 = computeOperationOrderStoreMixedApproversClient('Siêu Thị A', [1], 'LT10M');
      const w2 = computeOperationOrderStoreMixedApproversClient('Siêu Thị A', [1], 'FROM10M_TO100M');
      const w3 = computeOperationOrderStoreMixedApproversClient('Siêu Thị A', [1], 'GTE100M');
      check('Client mirror — WILDCARD: khớp CẢ 3 mức (LT10M/FROM10M_TO100M/GTE100M)',
        JSON.stringify(w1[1]) === '["gd.a"]' && JSON.stringify(w2[1]) === '["gd.a"]' && JSON.stringify(w3[1]) === '["gd.a"]',
        JSON.stringify({ w1, w2, w3 }));

      // ----- Tier cụ thể CHỈ khớp đúng mức -----
      DB.users = [{ username: 'gd.high', name: 'GĐ Mức Cao', dept: 'Siêu Thị A', active: true }];
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, tier: 'GTE100M', step: 1, mode: 'PERSON', username: 'gd.high', stores: ['Siêu Thị A'] }
      ];
      const own = computeOperationOrderStoreMixedApproversClient('Siêu Thị A', [1], 'GTE100M');
      const other = computeOperationOrderStoreMixedApproversClient('Siêu Thị A', [1], 'LT10M');
      check('Client mirror — tier cụ thể: khớp đúng GTE100M, KHÔNG khớp LT10M',
        JSON.stringify(own[1]) === '["gd.high"]' && JSON.stringify(other[1]) === '[]',
        JSON.stringify({ own, other }));

      // ----- UNION: wildcard + tier cụ thể cùng khớp 1 (bước, mức) -----
      DB.users = [
        { username: 'gd.default', name: 'GĐ Mặc Định', dept: 'Siêu Thị A', active: true },
        { username: 'ptgd.high', name: 'Phó TGĐ Mức Cao', dept: 'Ban Giám Đốc', active: true }
      ];
      DB.operationOrderStoreMixedApprovalRules = [
        { id: 1, step: 1, mode: 'PERSON', username: 'gd.default', stores: ['Siêu Thị A'] },
        { id: 2, tier: 'GTE100M', step: 1, mode: 'PERSON', username: 'ptgd.high', stores: ['Siêu Thị A'] }
      ];
      const unionHigh = computeOperationOrderStoreMixedApproversClient('Siêu Thị A', [1], 'GTE100M');
      const unionLow = computeOperationOrderStoreMixedApproversClient('Siêu Thị A', [1], 'LT10M');
      check('Client mirror — UNION: mức GTE100M có CẢ 2 người (wildcard + tier cụ thể)',
        new Set(unionHigh[1]).size === 2 && unionHigh[1].includes('gd.default') && unionHigh[1].includes('ptgd.high'),
        JSON.stringify(unionHigh));
      check('Client mirror — UNION: mức LT10M CHỈ còn wildcard (gd.default)',
        JSON.stringify(unionLow[1]) === '["gd.default"]', JSON.stringify(unionLow));

      return { results };
    });
  } finally {
    await browser.close();
    server.close();
  }

  results.results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
  const clientFailed = results.results.filter(r => !r.pass).length;
  console.log(`\n${results.results.length - clientFailed}/${results.results.length} client mirror scenario(s) passed.`);
  if (failed > 0 || clientFailed > 0) process.exit(1);
}

clientMirrorMain().catch((err) => { console.error(err); process.exit(1); });
