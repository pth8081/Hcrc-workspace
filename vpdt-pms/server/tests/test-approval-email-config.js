#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression suite: "🔔 Thông Báo Email Phê Duyệt" (DB.approvalEmailConfig)
//
// Covers the NEW admin-configurable gate added inside notifyRecipientsByEmail()
// (public/js/core.js) — the single choke point all ~88 approval-workflow email
// call sites across ~13 modules already funnel through (notifyUsersByEmail() ->
// notifyRecipientsByEmail() -> dispatchRealEmail()). This suite does NOT re-drive
// each module's real approve/reject UI (already covered by the other suites in
// this directory) — it exercises the gate itself directly via
// notifyUsersByEmail()/notifyRecipientsByEmail(), which is exactly the function
// every one of those 88 call sites goes through, so it is a faithful test of the
// new behavior without duplicating ~13 modules' business logic.
//
// Same static-file-server + Playwright + stubbed-fetch approach as
// test-approval-hub.js — see test-admin-users-permgroups.js for the full
// rationale (no real backend available in this sandbox). core.js (where
// APPROVAL_EMAIL_EVENTS/classifyApprovalEmailEvent()/isApprovalEmailSuppressed()/
// notifyRecipientsByEmail()/renderApprovalEmailConfigForm()/saveApprovalEmailConfig()
// all live) is EAGER-loaded via a plain <script> tag — no MODULE_LOAD_GROUPS
// lazy-load dance needed to reach any of them.
//
// Run: node server/tests/test-approval-email-config.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8996;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
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

  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.__fetchCalls = [];
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      window.__fetchCalls.push({ url: String(url), method, body: opts && opts.body });
      // send-email + syncStorage('approvalEmailConfig') đều chỉ cần "ok" — bài test này không quan tâm
      // phản hồi thật, chỉ quan tâm CÓ gọi tới hay KHÔNG (đúng bản chất "cổng chặn TRƯỚC dispatch").
      return { ok: true, status: 200, json: async () => ({ sent: [], failed: [], simulated: true }) };
    };

    DB.depts = ['Kế Toán'];
    DB.stores = [];
    DB.users = [
      { username: 'duyet1', name: 'Người Duyệt', dept: 'Kế Toán', email: 'duyet1@company.com', perms: {} },
      { username: 'nguoitrinh1', name: 'Người Trình', dept: 'Kế Toán', email: 'trinh1@company.com', perms: {} }
    ];
    finishLogin(DB.users[0]);
  });

  // ==========================================================================
  // (a) Với cấu hình mặc định đã xác nhận (approvalNeeded:false / result:true),
  // "Cần phê duyệt" bị chặn, "Kết quả duyệt" vẫn gửi — 3 module khác hình dạng mã
  // nguồn: CAR (chuẩn, notifyUsersByEmail), SUBMISSION (nhiều family), IT_SUPPORT
  // (family đặc thù riêng ticket/giá, độc lập với approvalNeeded/result chính).
  // ==========================================================================
  await scenario('CAR: approvalNeeded=false chặn email "Cần phê duyệt", result=true vẫn gửi "Kết quả duyệt"', async () => {
    const r = await page.evaluate(() => {
      DB.approvalEmailConfig = { CAR: { approvalNeeded: false, result: true } };
      window.__fetchCalls.length = 0;
      const before = DB.systemLogs.length;
      notifyUsersByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', 'XE-001', ['duyet1'], 'Cần duyệt XE-001', 'Nội dung cần duyệt');
      const logAfterNeeded = DB.systemLogs[0];
      const sendCallsAfterNeeded = window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).length;

      notifyUsersByEmail('CAR', 'NOTIFY_APPROVED', 'XE-001', ['nguoitrinh1'], 'XE-001 đã duyệt', 'Nội dung đã duyệt');
      const logAfterResult = DB.systemLogs[0];
      const sendCallsAfterResult = window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).length;

      return {
        addedRows: DB.systemLogs.length - before,
        neededStatus: logAfterNeeded.status, neededActionType: logAfterNeeded.actionType,
        sendCallsAfterNeeded, sendCallsAfterResult,
        resultStatus: logAfterResult.status, resultActionType: logAfterResult.actionType
      };
    });
    record('CAR "Cần phê duyệt" bị chặn — KHÔNG gọi POST /api/send-email',
      r.sendCallsAfterNeeded === 0, JSON.stringify(r));
    record('CAR "Cần phê duyệt" vẫn ghi 1 dòng Nhật ký hệ thống, status=SUPPRESSED, actionType giữ nguyên',
      r.neededStatus === 'SUPPRESSED' && r.neededActionType === 'NOTIFY_APPROVAL_NEEDED', JSON.stringify(r));
    record('CAR "Kết quả duyệt" (NOTIFY_APPROVED) vẫn gọi POST /api/send-email thật',
      r.sendCallsAfterResult === 1, JSON.stringify(r));
    record('CAR "Kết quả duyệt" ghi log status=SUCCESS',
      r.resultStatus === 'SUCCESS' && r.resultActionType === 'NOTIFY_APPROVED', JSON.stringify(r));
  });

  await scenario('SUBMISSION: approvalNeeded=false chặn, result=true + opinionRequested=true vẫn gửi (không phụ thuộc nhau)', async () => {
    const r = await page.evaluate(() => {
      DB.approvalEmailConfig = { SUBMISSION: { approvalNeeded: false, result: true, opinionRequested: true, fileProposal: true, fileProposalAccepted: true } };
      window.__fetchCalls.length = 0;
      notifyUsersByEmail('SUBMISSION', 'NOTIFY_APPROVAL_NEEDED', 'VBT-001', ['duyet1'], 's', 'b');
      const afterNeeded = window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).length;
      notifyUsersByEmail('SUBMISSION', 'NOTIFY_OPINION_REQUESTED', 'VBT-001', ['duyet1'], 's', 'b');
      const afterOpinion = window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).length;
      notifyUsersByEmail('SUBMISSION', 'NOTIFY_APPROVED', 'VBT-001', ['nguoitrinh1'], 's', 'b');
      const afterResult = window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).length;
      return { afterNeeded, afterOpinion, afterResult };
    });
    record('SUBMISSION "Cần phê duyệt" bị chặn (0 lượt gửi)', r.afterNeeded === 0, JSON.stringify(r));
    record('SUBMISSION "Xin ý kiến" (opinionRequested, family riêng) vẫn gửi dù "Cần phê duyệt" đang tắt', r.afterOpinion === 1, JSON.stringify(r));
    record('SUBMISSION "Kết quả duyệt" vẫn gửi', r.afterResult === 2, JSON.stringify(r));
  });

  // ==========================================================================
  // (e) Family đặc thù (IT_SUPPORT ticket) hoạt động ĐỘC LẬP với 2 toggle chính
  // approvalNeeded/result của CHÍNH module đó (cả 2 đang BẬT ở đây).
  // ==========================================================================
  await scenario('IT_SUPPORT: family đặc thù (ticketEscalationApproved) tắt độc lập, không phụ thuộc approvalNeeded/result đang bật', async () => {
    const r = await page.evaluate(() => {
      DB.approvalEmailConfig = { IT_SUPPORT: { approvalNeeded: true, result: true, ticketEscalationApproved: false, ticketDone: true } };
      window.__fetchCalls.length = 0;
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_APPROVAL_NEEDED', 'GIA-001', ['duyet1'], 's', 'b');
      const afterMainApprovalNeeded = window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).length;
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_TICKET_ESCALATION_APPROVED', 'TK-001', ['nguoitrinh1'], 's', 'b');
      const afterTicketEscalation = window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).length;
      const suppressedLog = DB.systemLogs.find(l => l.actionType === 'NOTIFY_TICKET_ESCALATION_APPROVED');
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_TICKET_DONE', 'TK-001', ['nguoitrinh1'], 's', 'b');
      const afterTicketDone = window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).length;
      return { afterMainApprovalNeeded, afterTicketEscalation, afterTicketDone, suppressedStatus: suppressedLog && suppressedLog.status };
    });
    record('IT_SUPPORT main "approvalNeeded"=true vẫn gửi bình thường', r.afterMainApprovalNeeded === 1, JSON.stringify(r));
    record('IT_SUPPORT "Ticket leo thang được duyệt" (family riêng, tắt) bị chặn dù approvalNeeded/result của module đang BẬT',
      r.afterTicketEscalation === 1 /* vẫn = 1, không tăng thêm */, JSON.stringify(r));
    record('email bị chặn ghi log status=SUPPRESSED', r.suppressedStatus === 'SUPPRESSED', JSON.stringify(r));
    record('IT_SUPPORT "Ticket hoàn tất" (family riêng khác, vẫn bật) tiếp tục gửi bình thường', r.afterTicketDone === 2, JSON.stringify(r));
  });

  // ==========================================================================
  // (b) Bật lại approvalNeeded qua ĐÚNG luồng admin UI thật (render form -> tích
  // checkbox -> saveApprovalEmailConfig(), không chỉ gán thẳng DB.*) -> email
  // thật sự gửi lại.
  // ==========================================================================
  await scenario('Bật lại "Cần phê duyệt" qua saveApprovalEmailConfig() (luồng admin UI thật) khiến email gửi lại', async () => {
    const r = await page.evaluate(async () => {
      DB.approvalEmailConfig = { CAR: { approvalNeeded: false, result: true } };
      renderApprovalEmailConfigForm();
      const before = document.getElementById('apel_CAR_approvalNeeded').checked;
      document.getElementById('apel_CAR_approvalNeeded').checked = true;
      window.__fetchCalls.length = 0;
      saveApprovalEmailConfig({ preventDefault() {} });
      const savedValue = DB.approvalEmailConfig.CAR.approvalNeeded;
      // syncStorage() (gọi bên trong saveApprovalEmailConfig()) xếp fetch() vào 1 chuỗi Promise
      // (hàng đợi tuần tự theo key) — DB.approvalEmailConfig đã đổi NGAY (đồng bộ), nhưng lượt gọi
      // fetch thật chỉ chạy ở microtask kế tiếp. Nhường 1 vòng event loop (setTimeout 0) để chuỗi đó
      // kịp chạy trước khi đọc lại window.__fetchCalls — không phải lỗi thời gian của tính năng, chỉ
      // là cách bài test này quan sát đúng 1 tác dụng phụ bất đồng bộ.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const wroteToServer = window.__fetchCalls.some(c => c.method === 'POST' && c.url.includes('/api/data/approvalEmailConfig'));
      notifyUsersByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', 'XE-002', ['duyet1'], 's', 'b');
      const sentAfterToggle = window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).length;
      // Mô phỏng "tải lại màn hình" (không thật sự reload trang — chỉ gọi lại đúng hàm render mà
      // setAdminSubTab('APPREMAIL')/setSystemSubTab('ADMIN') gọi mỗi lần vào lại tab) để xác nhận giá
      // trị vừa lưu THẬT SỰ được đọc lại đúng từ DB.approvalEmailConfig, không chỉ còn đúng do state
      // cũ chưa bị xoá trong DOM.
      renderApprovalEmailConfigForm();
      const checkedAfterReload = document.getElementById('apel_CAR_approvalNeeded').checked;
      return { before, savedValue, wroteToServer, sentAfterToggle, checkedAfterReload };
    });
    record('checkbox render ban đầu đúng false (mặc định đã lưu)', r.before === false, JSON.stringify(r));
    record('saveApprovalEmailConfig() cập nhật DB.approvalEmailConfig.CAR.approvalNeeded = true', r.savedValue === true, JSON.stringify(r));
    record('saveApprovalEmailConfig() gọi POST /api/data/approvalEmailConfig (syncStorage) để lưu lên server', r.wroteToServer, JSON.stringify(r));
    record('sau khi bật lại, NOTIFY_APPROVAL_NEEDED của CAR gửi email thật trở lại', r.sentAfterToggle === 1, JSON.stringify(r));
    record('"tải lại" màn hình (render lại từ DB.approvalEmailConfig) vẫn hiện đúng giá trị vừa lưu — xác nhận có lưu thật, không chỉ là state DOM tạm',
      r.checkedAfterReload === true, JSON.stringify(r));
  });

  // ==========================================================================
  // (c) Fail-open: sự kiện KHÔNG được phân loại (actionType tương lai chưa biết
  // tới, HOẶC module hoàn toàn chưa có gì trong DB.approvalEmailConfig) luôn gửi.
  // ==========================================================================
  await scenario('Fail-open: actionType chưa được phân loại luôn gửi dù module đang tắt "Cần phê duyệt"', async () => {
    const r = await page.evaluate(() => {
      DB.approvalEmailConfig = { CAR: { approvalNeeded: false, result: true } };
      window.__fetchCalls.length = 0;
      notifyUsersByEmail('CAR', 'NOTIFY_SOME_FUTURE_EVENT_NOT_YET_CLASSIFIED', 'XE-003', ['duyet1'], 's', 'b');
      const sent = window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).length;
      const log = DB.systemLogs[0];
      return { sent, status: log.status, classify: classifyApprovalEmailEvent('CAR', 'NOTIFY_SOME_FUTURE_EVENT_NOT_YET_CLASSIFIED') };
    });
    record('classifyApprovalEmailEvent() trả về null cho actionType chưa biết', r.classify === null, JSON.stringify(r));
    record('email vẫn được gửi (fail-open), KHÔNG bị chặn oan', r.sent === 1 && r.status !== 'SUPPRESSED', JSON.stringify(r));
  });

  await scenario('Fail-open: module hoàn toàn CHƯA có gì trong DB.approvalEmailConfig vẫn gửi bình thường (khớp hành vi cũ trước tính năng này)', async () => {
    const r = await page.evaluate(() => {
      DB.approvalEmailConfig = {}; // DOC chưa từng được admin lưu / CSDL mới chưa seed
      window.__fetchCalls.length = 0;
      notifyUsersByEmail('DOC', 'NOTIFY_APPROVAL_NEEDED', 'TL-010', ['duyet1'], 's', 'b');
      return { sent: window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).length, status: DB.systemLogs[0].status };
    });
    record('module chưa cấu hình gì -> vẫn gửi (fail-open trên toàn bộ config, không chỉ actionType)',
      r.sent === 1 && r.status !== 'SUPPRESSED', JSON.stringify(r));
  });

  // ==========================================================================
  // classifyApprovalEmailEvent() — kiểm thử đơn vị trực tiếp thêm vài trường hợp
  // biên: TASK (cố ý ngoài phạm vi), OPERATION_* alias gộp vào 1 khối "OPERATION",
  // LICENSE.result (KHÔNG áp dụng được — không có actionTypes nào ánh xạ).
  // ==========================================================================
  await scenario('classifyApprovalEmailEvent(): TASK ngoài phạm vi -> null; OPERATION_ORDER/STORE_OPEN/REPAIR đều gộp vào configModule "OPERATION"; LICENSE không có family "result"', async () => {
    const r = await page.evaluate(() => ({
      task: classifyApprovalEmailEvent('TASK', 'NOTIFY_TASK_ASSIGNED'),
      opOrder: classifyApprovalEmailEvent('OPERATION_ORDER', 'NOTIFY_APPROVED'),
      opStore: classifyApprovalEmailEvent('OPERATION_STORE_OPEN', 'NOTIFY_REQUEST_CHANGES'),
      opRepair: classifyApprovalEmailEvent('OPERATION_REPAIR', 'NOTIFY_APPROVAL_NEEDED'),
      licenseApproved: classifyApprovalEmailEvent('LICENSE', 'NOTIFY_APPROVED'),
      licenseNeeded: classifyApprovalEmailEvent('LICENSE', 'NOTIFY_APPROVAL_NEEDED')
    }));
    record('TASK/NOTIFY_TASK_ASSIGNED -> null (cố ý ngoài phạm vi tính năng này)', r.task === null, JSON.stringify(r));
    record('OPERATION_ORDER/NOTIFY_APPROVED -> {configModule:"OPERATION", family:"result"}',
      JSON.stringify(r.opOrder) === JSON.stringify({ configModule: 'OPERATION', family: 'result' }), JSON.stringify(r));
    record('OPERATION_STORE_OPEN/NOTIFY_REQUEST_CHANGES -> cùng configModule "OPERATION"/family "result"',
      JSON.stringify(r.opStore) === JSON.stringify({ configModule: 'OPERATION', family: 'result' }), JSON.stringify(r));
    record('OPERATION_REPAIR/NOTIFY_APPROVAL_NEEDED -> configModule "OPERATION"/family "approvalNeeded"',
      JSON.stringify(r.opRepair) === JSON.stringify({ configModule: 'OPERATION', family: 'approvalNeeded' }), JSON.stringify(r));
    record('LICENSE/NOTIFY_APPROVED -> null (Duyệt/Từ chối Giấy Phép chưa có email ở bất kỳ đâu, không có gì để phân loại)',
      r.licenseApproved === null, JSON.stringify(r));
    record('LICENSE/NOTIFY_APPROVAL_NEEDED vẫn phân loại được bình thường (chỉ "result" là không áp dụng, không phải cả module)',
      JSON.stringify(r.licenseNeeded) === JSON.stringify({ configModule: 'LICENSE', family: 'approvalNeeded' }), JSON.stringify(r));
  });

  // ==========================================================================
  // renderApprovalEmailConfigForm(): CSDL hoàn toàn mới (chưa từng lưu gì) phải
  // hiện ĐÚNG các mặc định đã xác nhận, và 3 ô "không có email cho sự kiện này"
  // (LICENSE.result) phải hiện disabled — không phải 1 checkbox khả dụng nhưng
  // vô tác dụng.
  // ==========================================================================
  await scenario('renderApprovalEmailConfigForm(): mặc định đúng khi DB.approvalEmailConfig rỗng (CSDL mới)', async () => {
    const r = await page.evaluate(() => {
      DB.approvalEmailConfig = {};
      renderApprovalEmailConfigForm();
      return {
        carApprovalNeeded: document.getElementById('apel_CAR_approvalNeeded').checked,
        carResult: document.getElementById('apel_CAR_result').checked,
        licenseApprovalNeeded: document.getElementById('apel_LICENSE_approvalNeeded').checked,
        licenseResultDisabled: document.getElementById('apel_LICENSE_result').disabled,
        licenseResultExists: !!document.getElementById('apel_LICENSE_result'),
        submissionOpinionRequested: document.getElementById('apel_SUBMISSION_opinionRequested').checked,
        itSupportTicketDone: document.getElementById('apel_IT_SUPPORT_ticketDone').checked,
        rowCount: document.querySelectorAll('#approvalEmailModuleTableBody tr').length,
        specialsHTML: document.getElementById('approvalEmailSpecialList').innerHTML
      };
    });
    record('CAR "Cần phê duyệt" mặc định KHÔNG tích (defaultOn:false)', r.carApprovalNeeded === false, JSON.stringify({ carApprovalNeeded: r.carApprovalNeeded }));
    record('CAR "Kết quả duyệt" mặc định CÓ tích', r.carResult === true, JSON.stringify({ carResult: r.carResult }));
    record('LICENSE "Cần phê duyệt" vẫn render bình thường (mặc định không tích)', r.licenseApprovalNeeded === false, JSON.stringify({ licenseApprovalNeeded: r.licenseApprovalNeeded }));
    record('LICENSE "Kết quả duyệt" render Ở DẠNG DISABLED (không có email cho sự kiện này), không phải checkbox khả dụng',
      r.licenseResultExists && r.licenseResultDisabled === true, JSON.stringify({ exists: r.licenseResultExists, disabled: r.licenseResultDisabled }));
    record('SUBMISSION "Xin ý kiến" (đặc thù) mặc định CÓ tích', r.submissionOpinionRequested === true, JSON.stringify({ submissionOpinionRequested: r.submissionOpinionRequested }));
    record('IT_SUPPORT "Ticket hoàn tất" (đặc thù) mặc định CÓ tích', r.itSupportTicketDone === true, JSON.stringify({ itSupportTicketDone: r.itSupportTicketDone }));
    record('bảng chính vẽ đủ 1 dòng / module (12 module có email phê duyệt)', r.rowCount === 12, JSON.stringify({ rowCount: r.rowCount }));
    record('khối "Sự kiện đặc thù" thật sự có nội dung (SUBMISSION/IT_SUPPORT)', /Văn Bản Trình/.test(r.specialsHTML) && /Hỗ Trợ IT/.test(r.specialsHTML), 'rendered');
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
