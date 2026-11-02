#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression: email "Cần phê duyệt" cho Đề Nghị Thanh Toán (paymentRequests) — phát hiện khi rà soát
// toàn hệ thống theo yêu cầu người dùng ("Bạn xem giúp mình ở tất cả các module sao người phê duyệt
// đang không nhận được email khi họ có phê duyệt nhỉ?"): module này TRƯỚC ĐÂY CHƯA TỪNG gửi email này
// ở bất kỳ điểm nào dù đã có quy trình duyệt theo bước/phòng ban riêng từ lâu (paymentDeptWorkflows) —
// xem notifyPaymentApprovalNeeded() (module-thanhtoan.js) + APPROVAL_EMAIL_EVENTS.OFFICE.paymentApprovalNeeded
// (core.js, checkbox RIÊNG tách khỏi "approvalNeeded" của officeReqs).
//
// Cùng kiến trúc hand-stub fetch + Playwright như tests/test-approvalneeded-email-uniform-leave-swap-training.js
// (xem rationale đầy đủ ở đó) — monkeypatch notifyUsersByEmail() thành spy, KHÔNG đi hết đường ống email
// thật (đã có test riêng cho dispatchRealEmail()/HTML template). showConfirmModal()+withApprovalAuth()
// (approverAuthLevel mặc định 'NONE' -> bỏ qua modal PIN/OTP) dùng window.__confirmPending() thật của
// testHarness.js — nhưng vì withApprovalAuth() KHÔNG await actionFn() (fire-and-forget khi level NONE),
// phải chờ thêm 1 nhịp setTimeout ngắn sau __confirmPending() mới đọc được kết quả.
//
// Run: node server/tests/test-payment-approval-needed-email.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8995;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/') || urlPath.startsWith('/fragments/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          const ct = urlPath.startsWith('/js/') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
          res.writeHead(200, { 'Content-Type': ct });
          res.end(data);
        });
      }
      fs.readFile(INDEX_HTML_PATH, (err, data) => {
        if (err) { res.writeHead(500); res.end(String(err)); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}

async function scenario(name, fn) {
  try {
    await fn();
  } catch (e) {
    record(name, false, 'threw: ' + (e && e.message ? e.message : String(e)));
  }
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
  await page.waitForTimeout(150);

  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => 'test';
    window.__fetchHandlers = {};
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const key = `${method} ${url}`;
      const handler = window.__fetchHandlers[key] || window.__fetchHandlers[url];
      const result = handler ? handler(opts && opts.body ? JSON.parse(opts.body) : {}) : { status: 200, body: {} };
      const status = result.status || 200;
      return { ok: status >= 200 && status < 300, status, json: async () => result.body || {} };
    };

    window.__emailCalls = [];
    window.notifyUsersByEmail = (...args) => { window.__emailCalls.push(args); };

    // __confirmPending() — mirror ĐÚNG bản gốc ở tests/testHarness.js (test này KHÔNG dùng
    // testHarness.js's launchPage() nên phải tự định nghĩa lại): submitPaymentRequestAction()/
    // approvePaymentRequestAction() đều gọi showConfirmModal({onConfirm}) trước khi chạy thật.
    window.__confirmPending = async () => {
      const fn = (typeof _pendingConfirmAction !== 'undefined') ? _pendingConfirmAction : null;
      const modal = document.getElementById('genericConfirmModal');
      if (modal) modal.classList.add('hidden');
      _pendingConfirmAction = null;
      if (fn) return await fn();
    };

    DB.depts = ['Kế Toán'];
    DB.users = [];
    DB.workflows = [{ id: 'wf-pay-test', steps: [{ order: 1, name: 'Kế Toán Trưởng duyệt' }, { order: 2, name: 'Giám Đốc duyệt' }] }];
    DB.paymentDeptWorkflows = { 'Kế Toán': { workflowId: 'wf-pay-test', approvers: { 1: ['pay1'], 2: ['pay2'] } } };
    DB.paymentRequests = [];
    DB.contracts = []; DB.officeReqs = [];
  });

  // ==========================================================================
  // 1) "Chuyển Xác Nhận Thanh Toán" (DRAFT -> PENDING, bắt đầu từ Bước 1) -> phải gửi email cho ĐÚNG
  //    người duyệt bước 1 (pay1) — đây là điểm TRƯỚC ĐÂY HOÀN TOÀN KHÔNG gửi email gì.
  // ==========================================================================
  await scenario('Chuyển Xác Nhận Thanh Toán (DRAFT->PENDING): notifyUsersByEmail("OFFICE","NOTIFY_PAYMENT_APPROVAL_NEEDED",...) đúng người duyệt Bước 1', async () => {
    const r = await page.evaluate(async () => {
      const nv1 = { username: 'nv1', name: 'Nhân Viên Kế Toán', dept: 'Kế Toán', role: 'NHANVIEN', jobTitle: null, perms: { admin: false, moduleAccess: {} } };
      DB.users.push(nv1);
      finishLogin(nv1);

      DB.paymentRequests = [{
        id: 5001, title: 'Thanh toán test email', dept: 'Kế Toán', status: 'DRAFT',
        installments: [{ description: 'Đợt 1', amount: 5000000, dueDate: '' }], requestFiles: [],
        creator: 'nv1', sourceModule: null, sourceId: null
      }];
      managePaymentExpandedId = null;

      window.__fetchHandlers['POST /api/records/paymentRequests/5001/edit'] = (body) => ({
        status: 200, body: { ok: true, item: { ...DB.paymentRequests[0], installments: body.installments, requestFiles: body.requestFiles } }
      });
      window.__fetchHandlers['POST /api/records/paymentRequests/5001/submit'] = () => ({
        status: 200,
        body: {
          ok: true,
          item: { ...DB.paymentRequests[0], status: 'PENDING', currentStep: 1, history: [], submittedBy: 'nv1', submittedByName: 'Nhân Viên Kế Toán', submittedAt: '2026-11-02 10:00:00' }
        }
      });

      window.__emailCalls = [];
      submitPaymentRequestAction(5001);
      await window.__confirmPending();
      await new Promise(res => setTimeout(res, 150)); // withApprovalAuth() KHÔNG await actionFn() khi level NONE
      return { emailCalls: window.__emailCalls, alerts: window.__alerts.slice() };
    });
    record('gửi ĐÚNG 1 lần email "OFFICE"/"NOTIFY_PAYMENT_APPROVAL_NEEDED"',
      r.emailCalls.length === 1 && r.emailCalls[0][0] === 'OFFICE' && r.emailCalls[0][1] === 'NOTIFY_PAYMENT_APPROVAL_NEEDED', JSON.stringify(r));
    record('targetCode = "5001" (paymentRequests không có field code, dùng id)',
      r.emailCalls[0] && r.emailCalls[0][2] === '5001', JSON.stringify(r));
    record('người nhận đúng [pay1] (người duyệt Bước 1)',
      r.emailCalls[0] && JSON.stringify([...r.emailCalls[0][3]].sort()) === JSON.stringify(['pay1']), JSON.stringify(r));
  });

  // ==========================================================================
  // 2) Duyệt Bước 1 -> chuyển Bước 2 (ADVANCED) -> phải gửi email cho ĐÚNG người duyệt Bước 2 (pay2).
  // ==========================================================================
  await scenario('Duyệt Bước 1 (ADVANCED sang Bước 2): notifyUsersByEmail("OFFICE","NOTIFY_PAYMENT_APPROVAL_NEEDED",...) đúng người duyệt Bước 2', async () => {
    const r = await page.evaluate(async () => {
      const pay1 = { username: 'pay1', name: 'Kế Toán Trưởng', dept: 'Kế Toán', role: 'NHANVIEN', jobTitle: null, perms: { admin: false, moduleAccess: {} } };
      DB.users.push(pay1);
      finishLogin(pay1);

      DB.paymentRequests = [{
        id: 5002, title: 'Thanh toán test email 2', dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [],
        installments: [{ description: 'Đợt 1', amount: 3000000, dueDate: '' }], requestFiles: []
      }];

      window.__fetchHandlers['POST /api/workflow/paymentRequests/5002/approve'] = () => ({
        status: 200,
        body: {
          ok: true,
          item: { ...DB.paymentRequests[0], currentStep: 2, history: [{ step: 1, action: 'APPROVE', by: 'pay1' }] },
          transition: { type: 'ADVANCED', stepApprovers: ['pay1'], nextStep: 2, nextStepName: 'Giám Đốc duyệt', nextApprovers: ['pay2'] }
        }
      });

      window.__emailCalls = [];
      approvePaymentRequestAction(5002);
      await window.__confirmPending();
      await new Promise(res => setTimeout(res, 150));
      return { emailCalls: window.__emailCalls, alerts: window.__alerts.slice() };
    });
    record('gửi ĐÚNG 1 lần email "OFFICE"/"NOTIFY_PAYMENT_APPROVAL_NEEDED"',
      r.emailCalls.length === 1 && r.emailCalls[0][0] === 'OFFICE' && r.emailCalls[0][1] === 'NOTIFY_PAYMENT_APPROVAL_NEEDED', JSON.stringify(r));
    record('người nhận đúng [pay2] (người duyệt Bước 2, lấy từ transition.nextApprovers — KHÔNG phải pay1)',
      r.emailCalls[0] && JSON.stringify([...r.emailCalls[0][3]].sort()) === JSON.stringify(['pay2']), JSON.stringify(r));
  });

  // ==========================================================================
  // 3) Duyệt xong bước CUỐI (COMPLETED) -> KHÔNG còn ai "cần phê duyệt" nữa -> KHÔNG gửi email này
  //    (hành vi gốc không đổi — chỉ xác nhận không vô tình gửi thêm email sai lúc hoàn tất).
  // ==========================================================================
  await scenario('Duyệt Bước CUỐI (COMPLETED): KHÔNG gửi email "NOTIFY_PAYMENT_APPROVAL_NEEDED" nào (không còn ai cần duyệt)', async () => {
    const r = await page.evaluate(async () => {
      DB.paymentRequests = [{
        id: 5003, title: 'Thanh toán test email 3', dept: 'Kế Toán', status: 'PENDING', currentStep: 2, history: [],
        installments: [{ description: 'Đợt 1', amount: 2000000, dueDate: '' }], requestFiles: []
      }];

      window.__fetchHandlers['POST /api/workflow/paymentRequests/5003/approve'] = () => ({
        status: 200,
        body: {
          ok: true,
          item: { ...DB.paymentRequests[0], status: 'APPROVED', paymentStatus: 'CHO_THANH_TOAN' },
          transition: { type: 'COMPLETED' }
        }
      });

      window.__emailCalls = [];
      approvePaymentRequestAction(5003);
      await window.__confirmPending();
      await new Promise(res => setTimeout(res, 150));
      return { emailCalls: window.__emailCalls };
    });
    record('KHÔNG có email "NOTIFY_PAYMENT_APPROVAL_NEEDED" nào gửi khi quy trình đã COMPLETED',
      r.emailCalls.length === 0, JSON.stringify(r));
  });

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length) process.exitCode = 1;
})().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
