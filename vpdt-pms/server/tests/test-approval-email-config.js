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
      if (urlPath.startsWith('/js/') || urlPath.startsWith('/fragments/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          // /fragments/*.html (v23.11): khung HTML tách lười (TAB_SECTION_FRAGMENT/loadTabSectionHtml,
          // core.js) — THIẾU nhánh này trước đây khiến mọi request rơi vào fallback "trả nguyên
          // index.html" bên dưới, loadTabSectionHtml() coi là THÀNH CÔNG nhưng gán sai nội dung vào
          // innerHTML section (bug thật, xem test-meeting-car.js).
          const contentType = urlPath.startsWith('/js/') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
          res.writeHead(200, { 'Content-Type': contentType });
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

  // LỖI ĐÃ VÁ (đợt audit cụm Văn Bản Trình, mức thấp — "HTML gọn"): #approvalEmailModuleTableBody/
  // #approvalEmailSpecialList (renderApprovalEmailConfigForm()) nay sống trong fragment lazy-load
  // fragments/systemSection.html thay vì nhúng cứng trong index.html — phải nạp fragment 'system' trước
  // khi gọi renderApprovalEmailConfigForm(), nếu không #approvalEmailModuleTableBody không tồn tại,
  // hàm no-op và mọi id "apel_*" đều null.
  await page.evaluate(() => loadTabSectionHtml('system'));

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
    // Gap-fill (đợt rà soát chuyên sâu lần 2 trước go-live, mức Trung Bình): thêm 4 module mới
    // (UNIFORM/HR_LEAVE/HR_SWAP/TRAINING) — trước đây 12, giờ 16.
    record('bảng chính vẽ đủ 1 dòng / module (16 module có email phê duyệt)', r.rowCount === 16, JSON.stringify({ rowCount: r.rowCount }));
    record('khối "Sự kiện đặc thù" thật sự có nội dung (SUBMISSION/IT_SUPPORT)', /Văn Bản Trình/.test(r.specialsHTML) && /Hỗ Trợ IT/.test(r.specialsHTML), 'rendered');
  });

  // ==========================================================================
  // LỖI ĐÃ VÁ (10/2026, phản hồi người dùng — "khi IT xử lý xong phê duyệt thì gắn link để người gửi có
  // thể truy cập trực tiếp vào phiếu yêu cầu"; MỞ RỘNG 11/2026 Giai đoạn 2, theo yêu cầu người dùng "ấn
  // vào thông báo phải truy cập trực tiếp vào thông tin" — giống ảnh chụp email "Cần phê duyệt" không hề
  // có link): email "Kết quả duyệt" (family 'result', có từ đợt trước) VÀ GIỜ CẢ email "Cần phê duyệt"
  // (family 'approvalNeeded') đều kèm 1 link ?gotoModule=<tab>&code=<mã> YÊU CẦU ĐĂNG NHẬP (không có cơ
  // chế bỏ qua đăng nhập nào — quyết định của người dùng) — xem buildApprovalEmailLink()/
  // LINKABLE_EMAIL_FAMILIES/APPROVAL_EMAIL_LINK_TAB ở core.js. Các sự kiện đặc thù khác (forwardRequested,
  // opinionRequested, fileProposal*, ticket*, emergencyReject*...) CHƯA có link ở đợt này (Giai đoạn 3).
  // ==========================================================================
  await scenario('buildApprovalEmailLink(): CẢ "Kết quả duyệt" LẪN "Cần phê duyệt" (CAR) đều kèm link ?gotoModule=car&code=...', async () => {
    const r = await page.evaluate(() => {
      DB.approvalEmailConfig = { CAR: { approvalNeeded: true, result: true } };
      window.__fetchCalls.length = 0;
      notifyUsersByEmail('CAR', 'NOTIFY_APPROVED', 'XE-009', ['nguoitrinh1'], 'XE-009 đã duyệt', 'Nội dung đã duyệt');
      notifyUsersByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', 'XE-009', ['duyet1'], 'Cần duyệt XE-009', 'Nội dung cần duyệt');
      const calls = window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).map(c => JSON.parse(c.body).text);
      return { resultBody: calls[0], neededBody: calls[1] };
    });
    record('email "Kết quả duyệt" kèm đúng link gotoModule=car', /\?gotoModule=car&code=XE-009/.test(r.resultBody), r.resultBody);
    record('email "Kết quả duyệt" link nêu rõ "yêu cầu đăng nhập"', /yêu cầu đăng nhập/.test(r.resultBody), r.resultBody);
    record('email "Cần phê duyệt" (Giai đoạn 2, family approvalNeeded) GIỜ CŨNG kèm đúng link gotoModule=car', /\?gotoModule=car&code=XE-009/.test(r.neededBody), r.neededBody);
  });

  await scenario('buildApprovalEmailLink(): OPERATION_ORDER (alias) vẫn gộp đúng về tab "vanHanh"; LICENSE "Cần phê duyệt" (Giai đoạn 2) GIỜ CÓ link, "Kết quả duyệt" (không có email) thì không áp dụng', async () => {
    const r = await page.evaluate(() => {
      DB.approvalEmailConfig = { OPERATION: { result: true }, LICENSE: { approvalNeeded: true } };
      window.__fetchCalls.length = 0;
      notifyUsersByEmail('OPERATION_ORDER', 'NOTIFY_APPROVED', 'DH-001', ['nguoitrinh1'], 's', 'b');
      notifyUsersByEmail('LICENSE', 'NOTIFY_APPROVAL_NEEDED', 'GP-001', ['duyet1'], 's', 'b');
      const calls = window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).map(c => JSON.parse(c.body).text);
      return { operationBody: calls[0], licenseBody: calls[1] };
    });
    record('OPERATION_ORDER (module alias thật truyền vào) vẫn tra đúng link tab "vanHanh"', /\?gotoModule=vanHanh&code=DH-001/.test(r.operationBody), r.operationBody);
    record('LICENSE "Cần phê duyệt" (Giai đoạn 2) GIỜ CÓ link đúng tab "license"', /\?gotoModule=license&code=GP-001/.test(r.licenseBody || ''), r.licenseBody);
  });

  // Giai đoạn 3 (11/2026) — toàn bộ family đặc thù còn lại (forwardRequested/opinionRequested/
  // fileProposal*/applied/ticket*/emergencyReject*) giờ CŨNG có link, tái dùng opener SẴN CÓ của đúng
  // module đó (không có opener riêng mới nào) — xác nhận cho SUBMISSION (nhiều family nhất) + IT_SUPPORT
  // (2 collection khác nhau, price lẫn ticket).
  await scenario('buildApprovalEmailLink(): Giai đoạn 3 — SUBMISSION mọi family đặc thù (forwardRequested/opinionRequested/fileProposal*) đều có link', async () => {
    const r = await page.evaluate(() => {
      DB.approvalEmailConfig = { SUBMISSION: { opinionRequested: true, fileProposal: true, fileProposalAccepted: true, fileProposalDeclined: true, forwardRequested: true, forwardReplied: true } };
      window.__fetchCalls.length = 0;
      notifyUsersByEmail('SUBMISSION', 'NOTIFY_OPINION_REQUESTED', 'VBT-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('SUBMISSION', 'NOTIFY_FILE_PROPOSAL', 'VBT-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('SUBMISSION', 'NOTIFY_FILE_PROPOSAL_ACCEPTED', 'VBT-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('SUBMISSION', 'NOTIFY_FILE_PROPOSAL_DECLINED', 'VBT-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('SUBMISSION', 'NOTIFY_FORWARD_REQUESTED', 'VBT-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('SUBMISSION', 'NOTIFY_FORWARD_REPLIED', 'VBT-301', ['duyet1'], 's', 'b');
      return window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).map(c => JSON.parse(c.body).text);
    });
    const labels = ['opinionRequested', 'fileProposal', 'fileProposalAccepted', 'fileProposalDeclined', 'forwardRequested', 'forwardReplied'];
    r.forEach((body, i) => record(`SUBMISSION "${labels[i]}" kèm đúng link gotoModule=submission&code=VBT-301`, /\?gotoModule=submission&code=VBT-301/.test(body), body));
  });

  await scenario('buildApprovalEmailLink(): Giai đoạn 3 — IT_SUPPORT mọi family đặc thù (applied/requestInfo/emergencyReject*/ticket*) đều có link', async () => {
    const r = await page.evaluate(() => {
      DB.approvalEmailConfig = { IT_SUPPORT: { applied: true, requestInfo: true, emergencyRejectRequest: true, emergencyRejectApproved: true, emergencyRejectDenied: true, ticketApprovalNeeded: true, ticketEscalationApproved: true, ticketEscalationDenied: true, ticketDone: true } };
      window.__fetchCalls.length = 0;
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_APPLIED', 'GIA-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_REQUEST_INFO', 'GIA-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_IT_PRICE_EMERGENCY_REJECT_REQUEST', 'GIA-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_IT_PRICE_EMERGENCY_REJECT_APPROVED', 'GIA-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_IT_PRICE_EMERGENCY_REJECT_DENIED', 'GIA-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_TICKET_APPROVAL_NEEDED', 'TK-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_TICKET_ESCALATION_APPROVED', 'TK-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_TICKET_ESCALATION_DENIED', 'TK-301', ['duyet1'], 's', 'b');
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_TICKET_DONE', 'TK-301', ['duyet1'], 's', 'b');
      return window.__fetchCalls.filter(c => c.url.includes('/api/send-email')).map(c => JSON.parse(c.body).text);
    });
    const expected = ['GIA-301', 'GIA-301', 'GIA-301', 'GIA-301', 'GIA-301', 'TK-301', 'TK-301', 'TK-301', 'TK-301'];
    const labels = ['applied', 'requestInfo', 'emergencyRejectRequest', 'emergencyRejectApproved', 'emergencyRejectDenied', 'ticketApprovalNeeded', 'ticketEscalationApproved', 'ticketEscalationDenied', 'ticketDone'];
    r.forEach((body, i) => record(`IT_SUPPORT "${labels[i]}" kèm đúng link gotoModule=itSupport&code=${expected[i]}`, new RegExp(`\\?gotoModule=itSupport&code=${expected[i]}`).test(body), body));
  });

  // Giai đoạn 3 — xác nhận THẬT (không chỉ ở mức text link) rằng forwardRequested/fileProposalAccepted
  // mở đúng modal hiện có (không có opener riêng, tái dùng openProcessSubmissionModal) — đặc biệt lưu ý
  // trường hợp fileProposalAccepted (đề xuất ĐÃ được giải quyết xong khi email này gửi đi — nếu trỏ
  // nhầm sang openResolveFileProposalModal() sẽ bị no-op câm lặng, xem chú thích LINKABLE_EMAIL_FAMILIES).
  await scenario('gotoApprovalResultRecordFromQueryParam(): Giai đoạn 3 — fileProposalAccepted (đề xuất ĐÃ giải quyết xong) vẫn mở đúng #submissionProcessModal, KHÔNG rơi vào no-op', async () => {
    const r = await page.evaluate(async () => {
      DB.submissions = [{
        id: 2002, code: 'VBT-302', title: 'Tờ trình test 2', dept: 'Kế Toán', creator: 'nguoitrinh1', creatorName: 'Người Trình',
        priority: 'Bình thường', type: 'Khác', createdAt: 'x', content: 'c', customData: {}, status: 'PENDING', currentStep: 1,
        history: [], forwardThreads: [], pendingFileProposal: null // ĐÃ giải quyết xong (null) — đúng trạng thái lúc email "đã chấp nhận" gửi đi
      }];
      history.replaceState(null, '', window.location.pathname + '?gotoModule=submission&code=VBT-302');
      await gotoApprovalResultRecordFromQueryParam();
      return {
        modalHidden: document.getElementById('submissionProcessModal').classList.contains('hidden'),
        modalTitle: document.getElementById('subModalTitle').innerText
      };
    });
    record('#submissionProcessModal vẫn tự mở đúng (không bị no-op dù pendingFileProposal đã null)', !r.modalHidden, JSON.stringify(r));
    record('mở đúng hồ sơ VBT-302', r.modalTitle.includes('VBT-302'), JSON.stringify(r));
    await page.evaluate(() => { document.getElementById('submissionProcessModal').classList.add('hidden'); DB.submissions = []; });
  });

  // ==========================================================================
  // gotoApprovalResultRecordFromQueryParam(): đầu vào URL ?gotoModule=<tab>&code=<mã> (đúng link vừa
  // dựng ở trên) — xác nhận điều hướng thật sự chạy (switchTab) + cảnh báo đúng mã hồ sơ, và KHÔNG điều
  // hướng lung tung nếu tab lạ (không thuộc allowlist APPROVAL_EMAIL_LINK_TAB, đề phòng URL bị sửa tay).
  // ==========================================================================
  await scenario('gotoApprovalResultRecordFromQueryParam(): điều hướng đúng tab + báo đúng mã hồ sơ, xoá query param sau khi dùng', async () => {
    const r = await page.evaluate(async () => {
      history.replaceState(null, '', window.location.pathname + '?gotoModule=car&code=XE-009');
      window.__alerts.length = 0;
      await gotoApprovalResultRecordFromQueryParam();
      const carSectionVisible = !document.getElementById('carSection').classList.contains('hidden');
      return { carSectionVisible, alerts: window.__alerts.slice(), urlAfter: window.location.search };
    });
    record('switchTab("car") thực sự chạy — section Đăng Ký Xe hiển thị', r.carSectionVisible, JSON.stringify(r));
    record('hiện đúng 1 cảnh báo nêu mã hồ sơ XE-009', r.alerts.length === 1 && r.alerts[0].includes('XE-009'), JSON.stringify(r));
    record('query param bị xoá khỏi URL ngay sau khi dùng (F5 không điều hướng lại)', r.urlAfter === '', JSON.stringify(r));
  });

  // LỖI ĐÃ VÁ (11/2026, yêu cầu người dùng "ấn vào thông báo phải truy cập trực tiếp vào thông tin"):
  // kịch bản TRÊN xác nhận hành vi CŨ (không tìm thấy bản ghi -> fallback alert) vẫn hoạt động đúng —
  // kịch bản NÀY xác nhận hành vi MỚI: khi hồ sơ CÓ THẬT trong DB.carRegs, link phải tự MỞ THẲNG modal
  // xử lý (#carProcessModal) thay vì chỉ alert, qua openLinkedApprovalRecordByCode()/
  // APPROVAL_EMAIL_RECORD_OPENER (core.js).
  await scenario('gotoApprovalResultRecordFromQueryParam(): hồ sơ CÓ THẬT -> tự MỞ THẲNG modal xử lý (không chỉ alert mã)', async () => {
    const r = await page.evaluate(async () => {
      DB.carRegs = [{
        id: 9001, code: 'XE-009', dept: 'Kế Toán', creatorName: 'Người Trình', destination: 'Hà Nội',
        type: '4 chỗ', km: 50, passengers: '2', status: 'PENDING', history: [], currentStep: 1
      }];
      history.replaceState(null, '', window.location.pathname + '?gotoModule=car&code=XE-009');
      window.__alerts.length = 0;
      await gotoApprovalResultRecordFromQueryParam();
      return {
        modalHidden: document.getElementById('carProcessModal').classList.contains('hidden'),
        modalTitle: document.getElementById('carModalTitle').innerText,
        alerts: window.__alerts.slice()
      };
    });
    record('modal xử lý Đăng Ký Xe (#carProcessModal) tự MỞ RA (không còn ẩn)', !r.modalHidden, JSON.stringify(r));
    record('modal mở ĐÚNG hồ sơ XE-009 (tiêu đề khớp mã)', r.modalTitle.includes('XE-009'), JSON.stringify(r));
    record('KHÔNG còn alert "tìm mã trong danh sách" nữa (đã mở thẳng, không cần báo tay)', r.alerts.length === 0, JSON.stringify(r));
    await page.evaluate(() => { document.getElementById('carProcessModal').classList.add('hidden'); DB.carRegs = []; });
  });

  // IT_SUPPORT có 2 collection khác nhau (itPriceApprovals/itSupportTickets) tuỳ actionType gốc —
  // APPROVAL_EMAIL_RECORD_OPENER.IT_SUPPORT.dbKeys phải dò ĐÚNG collection chứa mã, không chỉ thử mỗi
  // itPriceApprovals rồi bỏ cuộc.
  await scenario('gotoApprovalResultRecordFromQueryParam(): IT_SUPPORT dò đúng collection itSupportTickets (không chỉ itPriceApprovals) -> mở #itTicketModal', async () => {
    const r = await page.evaluate(async () => {
      DB.itPriceApprovals = [];
      DB.itSupportTickets = [{
        id: 7001, code: 'TK-777', title: 'Máy in hỏng', dept: 'Kế Toán', creatorName: 'Người Trình',
        category: 'HARDWARE', status: 'OPEN', description: 'Test mô tả'
      }];
      history.replaceState(null, '', window.location.pathname + '?gotoModule=itSupport&code=TK-777');
      await gotoApprovalResultRecordFromQueryParam();
      return {
        modalHidden: document.getElementById('itTicketModal').classList.contains('hidden'),
        modalTitle: document.getElementById('itTicketModalTitle').innerText
      };
    });
    record('#itTicketModal tự mở (dò đúng collection itSupportTickets)', !r.modalHidden, JSON.stringify(r));
    record('mở đúng ticket TK-777', r.modalTitle.includes('TK-777'), JSON.stringify(r));
    await page.evaluate(() => { document.getElementById('itTicketModal').classList.add('hidden'); DB.itSupportTickets = []; });
  });

  // OPERATION dùng chung 1 tab "vanHanh" cho 3 collection khác nhau (operationOrders/
  // operationStoreOpenings/operationRepairs) qua hàm openOperationProcessModal(kind, id) — xác nhận dò
  // đúng collection operationRepairs và truyền đúng "kind" tương ứng (không hardcode operationOrders).
  await scenario('gotoApprovalResultRecordFromQueryParam(): OPERATION dò đúng collection operationRepairs + truyền đúng kind', async () => {
    const r = await page.evaluate(async () => {
      currentUser.perms.operationRepairCreate = true; // canAccessOperationModule() cần quyền này mới vào được tab "vanHanh"
      DB.operationOrders = []; DB.operationStoreOpenings = [];
      DB.operationRepairs = [{
        id: 5001, code: 'SCST-555', title: 'Sửa điều hoà', dept: 'Kế Toán', creatorName: 'Người Trình',
        status: 'PENDING', history: [], currentStep: 1
      }];
      history.replaceState(null, '', window.location.pathname + '?gotoModule=vanHanh&code=SCST-555');
      await gotoApprovalResultRecordFromQueryParam();
      return {
        modalHidden: document.getElementById('operationProcessModal').classList.contains('hidden'),
        modalTitle: document.getElementById('operationProcessModalTitle').innerText
      };
    });
    record('#operationProcessModal tự mở (dò đúng collection operationRepairs)', !r.modalHidden, JSON.stringify(r));
    record('mở đúng hồ sơ SCST-555 (kind="operationRepairs" được truyền đúng)', r.modalTitle.includes('SCST-555'), JSON.stringify(r));
    await page.evaluate(() => { document.getElementById('operationProcessModal').classList.add('hidden'); DB.operationRepairs = []; });
  });

  // LỖI THẬT phát hiện khi viết test trên (module chưa kịp nạp vì switchTab() từ chối quyền truy cập
  // tab giữa chừng, KHÔNG throw — chỉ tự alert + return sớm): opener.open() khi đó gọi 1 hàm chưa tồn
  // tại (ReferenceError). Vá bằng try/catch RIÊNG quanh opener.open() trong openLinkedApprovalRecordByCode()
  // — xác nhận ở đây bằng cách giả lập "hàm mở chưa nạp" (xoá hẳn khỏi global) thay vì phụ thuộc đúng
  // kịch bản phân quyền thật (dễ vỡ theo cấu hình quyền từng module).
  await scenario('openLinkedApprovalRecordByCode(): hàm "mở hồ sơ" của module đích CHƯA được nạp (vd module con lazy-load chưa kịp xong) -> rơi về báo mã AN TOÀN, không throw lỗi JS ra ngoài', async () => {
    const r = await page.evaluate(() => {
      DB.carRegs = [{ id: 9002, code: 'XE-010', dept: 'Kế Toán', creatorName: 'X', destination: 'HN', type: '4 chỗ', km: 1, passengers: '1', status: 'PENDING', history: [], currentStep: 1 }];
      const original = window.openCarProcessModal;
      // function top-level khai báo trong <script> cổ điển là thuộc tính KHÔNG configurable của window
      // -> delete window.openCarProcessModal âm thầm thất bại (trả về false, không throw) — phải GÁN
      // ĐÈ bằng undefined mới mô phỏng đúng "module-dangkyxe.js chưa kịp nạp".
      window.openCarProcessModal = undefined;
      window.__alerts.length = 0;
      let threw = null;
      try { openLinkedApprovalRecordByCode('car', 'XE-010'); } catch (e) { threw = e.message; }
      window.openCarProcessModal = original; // khôi phục ngay, không ảnh hưởng các kịch bản khác
      DB.carRegs = [];
      return { threw, alerts: window.__alerts.slice() };
    });
    record('KHÔNG throw lỗi JS ra ngoài (được try/catch bên trong bắt gọn)', r.threw === null, JSON.stringify(r));
    record('rơi về đúng alert báo mã hồ sơ như hành vi fallback cũ', r.alerts.length === 1 && r.alerts[0].includes('XE-010'), JSON.stringify(r));
  });

  // DOC/LICENSE/SUBMISSION: 3 module còn lại dùng khuôn opener ĐƠN GIẢN nhất (1 dbKey, gọi thẳng 1 hàm
  // theo r.id) — xác nhận thêm vài đại diện cho chắc (CAR/IT_SUPPORT/OPERATION ở trên đã phủ các khuôn
  // phức tạp hơn: nhiều dbKey, tham số "kind").
  await scenario('gotoApprovalResultRecordFromQueryParam(): DOC mở đúng #viewDocModal theo code', async () => {
    const r = await page.evaluate(async () => {
      currentUser.perms.docApprove = true;
      DB.docs = [{ id: 3001, code: 'TL-333', title: 'Quy chế mẫu', dept: 'Kế Toán', cat: 'Chung', uploader: 'nguoitrinh1', uploaderName: 'Người Trình', creatorName: 'X', status: 'PENDING', history: [], currentStep: 1, versionNumber: 1, ver: 1 }];
      history.replaceState(null, '', window.location.pathname + '?gotoModule=doc&code=TL-333');
      await gotoApprovalResultRecordFromQueryParam();
      return {
        modalHidden: document.getElementById('docDetailModal').classList.contains('hidden'),
        modalTitle: document.getElementById('docDetailTitle').innerText
      };
    });
    record('#docDetailModal tự mở', !r.modalHidden, JSON.stringify(r));
    record('mở đúng hồ sơ TL-333', r.modalTitle.includes('TL-333'), JSON.stringify(r));
    await page.evaluate(() => { document.getElementById('docDetailModal').classList.add('hidden'); DB.docs = []; });
  });

  await scenario('gotoApprovalResultRecordFromQueryParam(): LICENSE mở đúng #licenseDetailModal theo code', async () => {
    const r = await page.evaluate(async () => {
      currentUser.perms.licenseApprove = true;
      DB.licenses = [{ id: 4001, code: 'GP-444', licenseType: 'Giấy phép kinh doanh', dept: 'Kế Toán', creatorName: 'X', status: 'PENDING', history: [], versionNumber: 1 }];
      history.replaceState(null, '', window.location.pathname + '?gotoModule=license&code=GP-444');
      await gotoApprovalResultRecordFromQueryParam();
      return {
        modalHidden: document.getElementById('licenseDetailModal').classList.contains('hidden'),
        modalTitle: document.getElementById('licenseDetailTitle').innerText
      };
    });
    record('#licenseDetailModal tự mở', !r.modalHidden, JSON.stringify(r));
    record('mở đúng hồ sơ GP-444', r.modalTitle.includes('GP-444'), JSON.stringify(r));
    await page.evaluate(() => { document.getElementById('licenseDetailModal').classList.add('hidden'); DB.licenses = []; });
  });

  await scenario('gotoApprovalResultRecordFromQueryParam(): SUBMISSION mở đúng #submissionProcessModal theo code', async () => {
    const r = await page.evaluate(async () => {
      currentUser.perms.submissionApprove = true;
      DB.submissions = [{ id: 2001, code: 'VBT-222', title: 'Tờ trình test', dept: 'Kế Toán', creator: 'nguoitrinh1', creatorName: 'Người Trình', priority: 'Bình thường', type: 'Khác', createdAt: 'x', content: 'c', customData: {}, status: 'PENDING', currentStep: 1, history: [], forwardThreads: [] }];
      history.replaceState(null, '', window.location.pathname + '?gotoModule=submission&code=VBT-222');
      await gotoApprovalResultRecordFromQueryParam();
      return {
        modalHidden: document.getElementById('submissionProcessModal').classList.contains('hidden'),
        modalTitle: document.getElementById('subModalTitle').innerText
      };
    });
    record('#submissionProcessModal tự mở', !r.modalHidden, JSON.stringify(r));
    record('mở đúng hồ sơ VBT-222', r.modalTitle.includes('VBT-222'), JSON.stringify(r));
    await page.evaluate(() => { document.getElementById('submissionProcessModal').classList.add('hidden'); DB.submissions = []; });
  });

  await scenario('gotoApprovalResultRecordFromQueryParam(): OFFICE mở đúng #officeProcessModal theo code', async () => {
    const r = await page.evaluate(async () => {
      currentUser.perms.officeBuy = true; // canAccessOfficeModule() cần quyền này mới vào được tab "office"
      DB.officeReqs = [{ id: 1001, code: 'VP-111', title: 'Mua máy in', dept: 'Kế Toán', creatorName: 'X', subType: 'MUA_BAN', amount: 5000000, qty: 1, reason: 'test', createdAt: 'x', status: 'PENDING', history: [], currentStep: 1 }];
      history.replaceState(null, '', window.location.pathname + '?gotoModule=office&code=VP-111');
      await gotoApprovalResultRecordFromQueryParam();
      return {
        modalHidden: document.getElementById('officeProcessModal').classList.contains('hidden'),
        modalText: document.getElementById('officeProcessModal').innerText
      };
    });
    record('#officeProcessModal tự mở', !r.modalHidden, JSON.stringify(r));
    record('mở đúng hồ sơ VP-111', r.modalText.includes('VP-111'), JSON.stringify(r));
    await page.evaluate(() => { document.getElementById('officeProcessModal').classList.add('hidden'); DB.officeReqs = []; });
  });

  await scenario('gotoApprovalResultRecordFromQueryParam(): VPP mở đúng #vppRegModal theo code', async () => {
    const r = await page.evaluate(async () => {
      DB.vppRegistrations = [{ id: 1501, code: 'VPP-151', periodName: 'Quý 4/2026', dept: 'Kế Toán', creatorName: 'X', items: [], status: 'PENDING', history: [], currentStep: 1 }];
      history.replaceState(null, '', window.location.pathname + '?gotoModule=vpp&code=VPP-151');
      await gotoApprovalResultRecordFromQueryParam();
      return {
        modalHidden: document.getElementById('vppRegModal').classList.contains('hidden'),
        modalTitle: document.getElementById('vppRegModalTitle').innerText
      };
    });
    record('#vppRegModal tự mở', !r.modalHidden, JSON.stringify(r));
    record('mở đúng hồ sơ VPP-151', r.modalTitle.includes('VPP-151'), JSON.stringify(r));
    await page.evaluate(() => { document.getElementById('vppRegModal').classList.add('hidden'); DB.vppRegistrations = []; });
  });

  await scenario('gotoApprovalResultRecordFromQueryParam(): CONTRACT mở đúng #viewDocModal (viewContractDetails) theo code', async () => {
    const r = await page.evaluate(async () => {
      DB.contracts = [{
        id: 6001, code: 'HD-666', title: 'Hợp đồng test', dept: 'Kế Toán', partner: 'Công ty X', type: 'Hợp đồng kinh tế',
        amount: 1000000, approvalStatus: 'PENDING', startDate: '2026-01-01', endDate: '2026-12-31',
        creator: 'nguoitrinh1', createdAt: 'x', currentStep: 1, history: [], content: 'c', isAddendum: false,
        paymentType: 'ONE_TIME', paymentStatus: 'UNPAID', customData: {}, signedCustomData: {}, paymentInstallments: [], forwardThreads: []
      }];
      history.replaceState(null, '', window.location.pathname + '?gotoModule=contract&code=HD-666');
      await gotoApprovalResultRecordFromQueryParam();
      return {
        modalHidden: document.getElementById('viewDocModal').classList.contains('hidden'),
        modalTitle: document.getElementById('viewModalTitle').innerText
      };
    });
    record('#viewDocModal tự mở (viewContractDetails dùng chung modal này)', !r.modalHidden, JSON.stringify(r));
    record('mở đúng hồ sơ HD-666', r.modalTitle.includes('HD-666'), JSON.stringify(r));
    await page.evaluate(() => { document.getElementById('viewDocModal').classList.add('hidden'); DB.contracts = []; });
  });

  await scenario('gotoApprovalResultRecordFromQueryParam(): INTERNAL mở đúng #internalArticleModal theo code', async () => {
    const r = await page.evaluate(async () => {
      DB.internalPosts = [{ id: 8001, code: 'TT-888', title: 'Thông báo test', dept: 'Kế Toán', authorName: 'X', createdAt: 'x', type: 'NEWS', status: 'PENDING', content: 'c' }];
      history.replaceState(null, '', window.location.pathname + '?gotoModule=internal&code=TT-888');
      await gotoApprovalResultRecordFromQueryParam();
      return {
        modalHidden: document.getElementById('internalArticleModal').classList.contains('hidden'),
        modalTitle: document.getElementById('internalArticleTitle').innerText,
        modalSub: document.getElementById('internalArticleSub').innerText
      };
    });
    record('#internalArticleModal tự mở', !r.modalHidden, JSON.stringify(r));
    record('mở đúng hồ sơ TT-888 (mã hiện trong phần phụ đề)', r.modalSub.includes('TT-888'), JSON.stringify(r));
    await page.evaluate(() => { document.getElementById('internalArticleModal').classList.add('hidden'); DB.internalPosts = []; });
  });

  // MEETING: xác nhận ĐÚNG như phương án đã thống nhất với người dùng (chưa có màn "xem chi tiết 1
  // phiếu" nào trong hệ thống cho Phòng Họp) — link VẪN được gắn vào email (đúng allowlist
  // LINKABLE_EMAIL_FAMILIES) nhưng KHÔNG có mặt trong APPROVAL_EMAIL_RECORD_OPENER nên chỉ dừng ở mức
  // chuyển đúng tab + báo mã (hành vi cũ), không mở thẳng modal nào — xác nhận KHÔNG lỗi gì phát sinh.
  await scenario('gotoApprovalResultRecordFromQueryParam(): MEETING chưa có hàm mở hồ sơ -> vẫn chuyển đúng tab + báo mã (không mở modal, đúng phương án đã chốt)', async () => {
    const r = await page.evaluate(async () => {
      currentUser.perms.meetingApprove = true; // canAccessMeetingModule() cần quyền này mới vào được tab "meeting"
      history.replaceState(null, '', window.location.pathname + '?gotoModule=meeting&code=PH-001');
      window.__alerts.length = 0;
      await gotoApprovalResultRecordFromQueryParam();
      return {
        meetingSectionVisible: !document.getElementById('meetingSection').classList.contains('hidden'),
        alerts: window.__alerts.slice()
      };
    });
    record('switchTab("meeting") thực sự chạy', r.meetingSectionVisible, JSON.stringify(r));
    record('MEETING chưa có opener -> rơi về đúng alert báo mã PH-001 (không mở modal nào, không lỗi)', r.alerts.length === 1 && r.alerts[0].includes('PH-001'), JSON.stringify(r));
  });

  await scenario('gotoApprovalResultRecordFromQueryParam(): tab KHÔNG thuộc allowlist (URL bị sửa tay) -> bỏ qua an toàn, không điều hướng/không xoá param', async () => {
    const r = await page.evaluate(async () => {
      await switchTab('dashboard');
      history.replaceState(null, '', window.location.pathname + '?gotoModule=__evil__&code=X');
      window.__alerts.length = 0;
      await gotoApprovalResultRecordFromQueryParam();
      const carSectionVisible = !document.getElementById('carSection').classList.contains('hidden');
      return { carSectionVisible, alerts: window.__alerts.slice(), urlAfter: window.location.search };
    });
    record('tab lạ -> KHÔNG điều hướng sang Đăng Ký Xe', !r.carSectionVisible, JSON.stringify(r));
    record('tab lạ -> KHÔNG hiện cảnh báo nào', r.alerts.length === 0, JSON.stringify(r));
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
