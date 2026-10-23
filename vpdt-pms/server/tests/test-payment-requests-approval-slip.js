// server/tests/test-payment-requests-approval-slip.js
//
// Regression cho tính năng "🖨️ Xem/Tải Phiếu Phê Duyệt" ở Đề Nghị Thanh Toán (paymentRequests) —
// tiếp nối đợt operationOrders (v28.5) + vppRegistrations, ghép vào ĐÚNG khung dùng chung
// buildApprovalSlipShellHTML()/APPROVAL_SLIP_CSS/buildApprovalSignatureColumnHTML() (core.js).
// KHÁC các module trước: paymentRequests KHÔNG có modal chi tiết riêng — 2 nút Xem/Tải Phiếu nằm
// NGAY TRONG cell hành động của mỗi dòng bảng (renderPaymentRequests()), và KHÔNG có field `code`
// (dùng "PT-<id>" làm mã phiếu hiển thị).
//
// Kiểm tra:
//   A. isPaymentRequestPostApproval(): đúng ma trận status (DRAFT/PENDING/NEED_INFO -> false;
//      APPROVED/PAID -> true).
//   B. canAccessPaymentRequestApprovalSlip(): admin/người tạo đề nghị/người duyệt đúng quy trình ->
//      true; người ngoài -> false.
//   C. buildPaymentRequestApprovalSlipHTML(): dùng ĐÚNG khung chung (class as-field-table/
//      as-items-table/as-sign-row), hiện đúng mã "PT-<id>", chân ký (tên người duyệt + ý kiến), các
//      đợt thanh toán.
//   D. viewPaymentRequestApprovalSlip()/downloadPaymentRequestApprovalSlip(): chặn đúng khi CHƯA phê
//      duyệt và khi người xem không có quyền; mở modal/tạo file đúng khi hợp lệ.
//   E. Giao diện: renderPaymentRequests() chỉ hiện 2 nút Xem/Tải Phiếu trong cell hành động khi đã
//      phê duyệt (APPROVED/PAID) + đúng quyền, KHÔNG hiện khi còn PENDING.
//   F. Không có lỗi JS chưa bắt (pageerror) nào phát sinh.
//
// Chạy: node server/tests/test-payment-requests-approval-slip.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'
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

async function main() {
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  const out = await page.evaluate(() => {
    // --- Seed tối thiểu: 1 đề nghị thanh toán đã phê duyệt hoàn tất (APPROVED), quy trình 2 bước ---
    Object.assign(DB, {
      workflows: [{ id: 'WF_2STEP', name: 'Thanh toán 2 bước', steps: [
        { order: 1, name: 'Trưởng Phòng', actionLabel: null },
        { order: 2, name: 'Kế Toán Trưởng', actionLabel: 'Phê Duyệt Cuối' }
      ] }],
      paymentDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'WF_2STEP', approvers: { 1: ['tp1'], 2: ['kt1'] } } },
      paymentRequests: []
    });
    const pr = {
      id: 9001, sourceModule: 'MANUAL', sourceCode: null, dept: 'Phòng Kinh Doanh',
      title: 'Thanh toán tiền điện Q4', amount: 12000000, createdBy: 'nv1', createdByName: 'Nguyễn Văn Nhân Viên',
      installments: [{ description: 'Đợt 1', amount: 6000000, confirmed: false }, { description: 'Đợt 2', amount: 6000000, confirmed: false }],
      status: 'APPROVED', currentStep: 3, createdAt: '08:00 01/10/2026',
      history: [
        { step: 1, action: 'APPROVED', approver: 'Trưởng Phòng A', username: 'tp1', time: '08:30 02/10/2026', comment: 'Đồng ý, đúng nhu cầu.' },
        { step: 2, action: 'APPROVED', approver: 'Kế Toán Trưởng B', username: 'kt1', time: '09:00 02/10/2026', comment: '' }
      ]
    };
    DB.paymentRequests.push(pr);

    const statusMatrix = {};
    ['DRAFT', 'PENDING', 'NEED_INFO', 'APPROVED', 'PAID'].forEach(s => {
      statusMatrix[s] = isPaymentRequestPostApproval({ status: s });
    });

    const admin = { username: 'admin1', perms: { admin: true } };
    const creator = { username: 'nv1', perms: {} };
    const approver = { username: 'tp1', perms: {} };
    const outsider = { username: 'u.khac', perms: {} };
    const accessMatrix = {
      admin: canAccessPaymentRequestApprovalSlip(admin, pr),
      creator: canAccessPaymentRequestApprovalSlip(creator, pr),
      approver: canAccessPaymentRequestApprovalSlip(approver, pr),
      outsider: canAccessPaymentRequestApprovalSlip(outsider, pr),
      noUser: canAccessPaymentRequestApprovalSlip(null, pr)
    };

    const slipHTML = buildPaymentRequestApprovalSlipHTML(pr);

    // --- D: viewPaymentRequestApprovalSlip()/downloadPaymentRequestApprovalSlip() qua đúng hàm thật ---
    const alerts = [];
    window.alert = (msg) => alerts.push(msg);
    let createObjectURLCalled = false;
    URL.createObjectURL = () => { createObjectURLCalled = true; return 'blob:fake'; };
    URL.revokeObjectURL = () => {};
    const origClick = HTMLAnchorElement.prototype.click;
    let downloadFileName = null;
    HTMLAnchorElement.prototype.click = function () { downloadFileName = this.download; };

    currentUser = outsider;
    document.getElementById('viewModalContent').innerHTML = '';
    viewPaymentRequestApprovalSlip(pr.id);
    const outsiderBlockedView = alerts.length === 1 && document.getElementById('viewModalContent').innerHTML === '';
    alerts.length = 0;

    const pendingPr = Object.assign({}, pr, { id: 9002, status: 'PENDING' });
    DB.paymentRequests.push(pendingPr);
    currentUser = creator;
    document.getElementById('viewModalContent').innerHTML = '';
    viewPaymentRequestApprovalSlip(pendingPr.id);
    const pendingBlockedView = alerts.length === 1 && document.getElementById('viewModalContent').innerHTML === '';
    alerts.length = 0;

    currentUser = creator;
    document.getElementById('viewModalContent').innerHTML = '';
    viewPaymentRequestApprovalSlip(pr.id);
    const creatorCanView = alerts.length === 0 &&
      document.getElementById('viewDocModal').classList.contains('hidden') === false &&
      document.getElementById('viewModalContent').innerHTML.includes('PT-9001');
    document.getElementById('viewDocModal').classList.add('hidden');

    currentUser = approver;
    downloadPaymentRequestApprovalSlip(pr.id);
    const approverCanDownload = alerts.length === 0 && createObjectURLCalled && downloadFileName === 'PhieuPheDuyet_PT-9001.html';

    // Trạng thái PAID cũng phải tải được (post-approval thứ 2) — người tạo xem thử.
    const paidPr = Object.assign({}, pr, { id: 9003, status: 'PAID' });
    DB.paymentRequests.push(paidPr);
    currentUser = creator;
    downloadPaymentRequestApprovalSlip(paidPr.id);
    const paidCanDownload = alerts.length === 0 && downloadFileName === 'PhieuPheDuyet_PT-9003.html';

    HTMLAnchorElement.prototype.click = origClick;

    // --- E: renderPaymentRequests() cell hành động hiện/ẩn đúng nút Xem/Tải Phiếu ---
    currentUser = creator;
    renderPaymentRequests();
    const tbodyHTML = document.getElementById('paymentTableBody').innerHTML;
    const approvedRowHasSlipButtons = tbodyHTML.includes('viewPaymentRequestApprovalSlip') && tbodyHTML.includes('downloadPaymentRequestApprovalSlip');

    DB.paymentRequests = [pendingPr];
    renderPaymentRequests();
    const tbodyHTMLPendingOnly = document.getElementById('paymentTableBody').innerHTML;
    const pendingRowNoSlipButtons = !tbodyHTMLPendingOnly.includes('viewPaymentRequestApprovalSlip') && !tbodyHTMLPendingOnly.includes('downloadPaymentRequestApprovalSlip');

    currentUser = outsider;
    DB.paymentRequests = [pr];
    renderPaymentRequests();
    const outsiderRowNoSlipButtons = !document.getElementById('paymentTableBody').innerHTML.includes('viewPaymentRequestApprovalSlip');

    return {
      statusMatrix, accessMatrix, slipHTML,
      outsiderBlockedView, pendingBlockedView, creatorCanView, approverCanDownload, paidCanDownload,
      approvedRowHasSlipButtons, pendingRowNoSlipButtons, outsiderRowNoSlipButtons
    };
  });

  record('A: isPaymentRequestPostApproval() đúng ma trận status',
    out.statusMatrix.DRAFT === false && out.statusMatrix.PENDING === false && out.statusMatrix.NEED_INFO === false &&
    out.statusMatrix.APPROVED === true && out.statusMatrix.PAID === true,
    JSON.stringify(out.statusMatrix));

  record('B: canAccessPaymentRequestApprovalSlip() — admin/người tạo/người duyệt -> true, người ngoài/không có user -> false',
    out.accessMatrix.admin === true && out.accessMatrix.creator === true && out.accessMatrix.approver === true &&
    out.accessMatrix.outsider === false && out.accessMatrix.noUser === false,
    JSON.stringify(out.accessMatrix));

  record('C: Phiếu dùng ĐÚNG khung chung (as-field-table/as-items-table/as-sign-row)',
    out.slipHTML.includes('as-field-table') && out.slipHTML.includes('as-items-table') && out.slipHTML.includes('as-sign-row'));
  record('C: Phiếu hiện đúng mã "PT-<id>", nội dung đề nghị, các đợt thanh toán',
    out.slipHTML.includes('PT-9001') && out.slipHTML.includes('Thanh toán tiền điện Q4') && out.slipHTML.includes('Đợt 1') && out.slipHTML.includes('Đợt 2'));
  record('C: Phiếu hiện đúng chân ký của NGƯỜI đề nghị + 2 người đã duyệt (kèm ý kiến bước 1)',
    out.slipHTML.includes('Nguyễn Văn Nhân Viên') && out.slipHTML.includes('Trưởng Phòng A') && out.slipHTML.includes('Kế Toán Trưởng B') && out.slipHTML.includes('Đồng ý, đúng nhu cầu.'));

  record('D: Người KHÔNG có quyền (outsider) bị chặn xem phiếu kèm alert rõ ràng, modal không hiện nội dung', out.outsiderBlockedView);
  record('D: Đề nghị CHƯA phê duyệt (PENDING) -> chặn xem phiếu dù chính người tạo', out.pendingBlockedView);
  record('D: Người tạo đề nghị xem được phiếu (modal mở, đúng nội dung)', out.creatorCanView);
  record('D: Người duyệt tải được phiếu khi APPROVED (tạo file đúng tên PhieuPheDuyet_PT-<id>.html)', out.approverCanDownload);
  record('D: Vẫn tải được phiếu khi đã chuyển sang PAID (trạng thái post-approval thứ 2)', out.paidCanDownload);

  record('E: renderPaymentRequests() hiện 2 nút Xem/Tải Phiếu trong cell hành động khi APPROVED + đúng quyền', out.approvedRowHasSlipButtons);
  record('E: renderPaymentRequests() KHÔNG hiện 2 nút này khi đề nghị còn PENDING', out.pendingRowNoSlipButtons);
  record('E: renderPaymentRequests() KHÔNG hiện 2 nút này cho người ngoài không có quyền', out.outsiderRowNoSlipButtons);

  record('F: Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();
  finish();
}

function finish() {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log('');
  console.log(`${passed}/${total} scenarios passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
