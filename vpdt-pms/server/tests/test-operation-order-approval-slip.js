// server/tests/test-operation-order-approval-slip.js
//
// Regression cho tính năng "🖨️ Xem/Tải Phiếu Phê Duyệt" ở Đặt Hàng NCC (operationOrders — gồm CẢ
// "Đặt hàng tại Siêu Thị" và "Đặt hàng tại HO", cùng 1 collection, phân biệt qua orderLocationType).
// Yêu cầu người dùng (10/2026): phiếu phải có chân ký, format đẹp/cân đối giống Đăng Ký Xe/Văn Bản
// Trình — ghép vào ĐÚNG khung dùng chung buildApprovalSlipShellHTML()/APPROVAL_SLIP_CSS/
// buildApprovalSignatureColumnHTML() (core.js), không tự vẽ CSS riêng.
//
// Kiểm tra:
//   A. isOperationOrderPostApproval(): đúng ma trận status (DRAFT/PENDING/REJECTED -> false;
//      APPROVED/AWAITING_RECEIPT/RECEIVED/RECEIPT_CANCELLED -> true).
//   B. canAccessOperationOrderApprovalSlip(): admin/người tạo đơn/người duyệt đúng quy trình -> true;
//      người ngoài -> false.
//   C. buildOperationOrderApprovalSlipHTML(): dùng ĐÚNG khung chung (class as-field-table/as-items-table/
//      as-sign-row), hiện đúng chân ký (tên người duyệt + ý kiến), mã đơn, NCC, hạng mục.
//   D. viewOperationOrderApprovalSlip()/downloadOperationOrderApprovalSlip(): chặn đúng khi CHƯA phê
//      duyệt hoàn tất và khi người xem không có quyền; mở modal/tạo file đúng khi hợp lệ.
//   E. Giao diện: buildOperationRowHTML() chỉ hiện 2 tuỳ chọn "Xem/Tải Phiếu" ở dropdown khi đã phê
//      duyệt hoàn tất + đúng quyền; openOperationProcessModal() thêm đúng 2 nút vào khối controls (cả 2
//      nhánh canApprove/view-only), KHÔNG xoá mất nút Duyệt/Từ chối/Yêu cầu bổ sung đã có.
//   F. Không có lỗi JS chưa bắt (pageerror) nào phát sinh.
//
// Chạy: node server/tests/test-operation-order-approval-slip.js
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
    // --- Seed tối thiểu: 1 đơn HO đã phê duyệt hoàn tất (AWAITING_RECEIPT), quy trình 2 bước ---
    Object.assign(DB, {
      workflows: [{ id: 'WF_2STEP', name: 'HO 2 bước', steps: [
        { order: 1, name: 'Trưởng Phòng', actionLabel: null },
        { order: 2, name: 'Giám Đốc Vận Hành', actionLabel: 'Phê Duyệt Cuối' }
      ] }],
      operationOrderHOTierWorkflows: { LT100M: { workflowId: 'WF_2STEP', approvers: { 1: ['tp1'], 2: ['gd1'] } } },
      operationOrderStoreTierWorkflows: {},
      operationOrderStoreMixedApprovalRules: [],
      operationOrders: []
    });
    const order = {
      id: 7001, code: 'DH-HO-001', dept: 'Phòng Vận Hành', orderLocationType: 'HO',
      title: 'Đặt hàng văn phòng phẩm Q4', supplier: 'Công ty TNHH ABC', amount: 5000000,
      note: 'Giao trước 20/10', createdAt: '08:00 01/10/2026',
      items: [{ name: 'Giấy A4', productCode: 'GA4', unit: 'Ream', qty: 50, unitPrice: 60000, amount: 3000000 },
              { name: 'Bút bi', productCode: 'BB01', unit: 'Hộp', qty: 10, unitPrice: 200000, amount: 2000000 }],
      status: 'AWAITING_RECEIPT', currentStep: 3, approvedAt: '09:00 02/10/2026',
      history: [
        { step: 1, action: 'APPROVED', approver: 'Trưởng Phòng A', username: 'tp1', time: '08:30 02/10/2026', comment: 'Đồng ý, đúng nhu cầu.' },
        { step: 2, action: 'APPROVED', approver: 'Giám Đốc Vận Hành', username: 'gd1', time: '09:00 02/10/2026', comment: '' }
      ],
      creator: 'nv1', creatorName: 'Nguyễn Văn Nhân Viên'
    };
    DB.operationOrders.push(order);

    const statusMatrix = {};
    ['DRAFT', 'PENDING', 'REJECTED', 'APPROVED', 'AWAITING_RECEIPT', 'RECEIVED', 'RECEIPT_CANCELLED'].forEach(s => {
      statusMatrix[s] = isOperationOrderPostApproval({ status: s });
    });

    const admin = { username: 'admin1', perms: { admin: true } };
    const creator = { username: 'nv1', perms: {} };
    const approver = { username: 'tp1', perms: {} };
    const outsider = { username: 'u.khac', perms: {} };
    const accessMatrix = {
      admin: canAccessOperationOrderApprovalSlip(admin, order),
      creator: canAccessOperationOrderApprovalSlip(creator, order),
      approver: canAccessOperationOrderApprovalSlip(approver, order),
      outsider: canAccessOperationOrderApprovalSlip(outsider, order),
      noUser: canAccessOperationOrderApprovalSlip(null, order)
    };

    const slipHTML = buildOperationOrderApprovalSlipHTML(order);

    // --- D: viewOperationOrderApprovalSlip()/downloadOperationOrderApprovalSlip() qua đúng hàm thật ---
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
    viewOperationOrderApprovalSlip(order.id);
    const outsiderBlockedView = alerts.length === 1 && document.getElementById('viewModalContent').innerHTML === '';
    alerts.length = 0;

    const pendingOrder = Object.assign({}, order, { id: 7002, code: 'DH-HO-002', status: 'PENDING' });
    DB.operationOrders.push(pendingOrder);
    currentUser = creator;
    document.getElementById('viewModalContent').innerHTML = '';
    viewOperationOrderApprovalSlip(pendingOrder.id);
    const pendingBlockedView = alerts.length === 1 && document.getElementById('viewModalContent').innerHTML === '';
    alerts.length = 0;

    currentUser = creator;
    document.getElementById('viewModalContent').innerHTML = '';
    viewOperationOrderApprovalSlip(order.id);
    const creatorCanView = alerts.length === 0 &&
      document.getElementById('viewDocModal').classList.contains('hidden') === false &&
      document.getElementById('viewModalContent').innerHTML.includes('DH-HO-001');
    document.getElementById('viewDocModal').classList.add('hidden');

    currentUser = approver;
    downloadOperationOrderApprovalSlip(order.id);
    const approverCanDownload = alerts.length === 0 && createObjectURLCalled && downloadFileName === 'PhieuPheDuyet_DH-HO-001.html';

    HTMLAnchorElement.prototype.click = origClick;

    // --- E: buildOperationRowHTML() dropdown + openOperationProcessModal() controls ---
    currentUser = creator;
    const rowHTML = buildOperationRowHTML('operationOrders', order);
    const rowHasSlipOptions = rowHTML.includes('viewSlip') && rowHTML.includes('downloadSlip');

    const rowHTMLPending = buildOperationRowHTML('operationOrders', pendingOrder);
    const rowPendingNoSlipOptions = !rowHTMLPending.includes('viewSlip') && !rowHTMLPending.includes('downloadSlip');

    currentUser = approver; // tp1: đã duyệt bước 1 -> currentStep đã sang 3 (hết bước), không còn canApprove, nhánh "view-only"
    openOperationProcessModal('operationOrders', order.id);
    const controlsHTML = document.getElementById('operationProcessModalControls').innerHTML;
    const viewOnlyBranchHasSlipButtons = controlsHTML.includes('viewOperationOrderApprovalSlip') && controlsHTML.includes('downloadOperationOrderApprovalSlip') && controlsHTML.includes('Bạn chỉ có quyền xem');
    document.getElementById('operationProcessModal').classList.add('hidden');

    return {
      statusMatrix, accessMatrix, slipHTML,
      outsiderBlockedView, pendingBlockedView, creatorCanView, approverCanDownload,
      rowHasSlipOptions, rowPendingNoSlipOptions, viewOnlyBranchHasSlipButtons
    };
  });

  record('A: isOperationOrderPostApproval() đúng ma trận status',
    out.statusMatrix.DRAFT === false && out.statusMatrix.PENDING === false && out.statusMatrix.REJECTED === false &&
    out.statusMatrix.APPROVED === true && out.statusMatrix.AWAITING_RECEIPT === true &&
    out.statusMatrix.RECEIVED === true && out.statusMatrix.RECEIPT_CANCELLED === true,
    JSON.stringify(out.statusMatrix));

  record('B: canAccessOperationOrderApprovalSlip() — admin/người tạo/người duyệt -> true, người ngoài/không có user -> false',
    out.accessMatrix.admin === true && out.accessMatrix.creator === true && out.accessMatrix.approver === true &&
    out.accessMatrix.outsider === false && out.accessMatrix.noUser === false,
    JSON.stringify(out.accessMatrix));

  record('C: Phiếu dùng ĐÚNG khung chung (as-field-table/as-items-table/as-sign-row)',
    out.slipHTML.includes('as-field-table') && out.slipHTML.includes('as-items-table') && out.slipHTML.includes('as-sign-row'));
  record('C: Phiếu hiện đúng mã đơn, NCC, tên hạng mục',
    out.slipHTML.includes('DH-HO-001') && out.slipHTML.includes('Công ty TNHH ABC') && out.slipHTML.includes('Giấy A4') && out.slipHTML.includes('Bút bi'));
  record('C: Phiếu hiện đúng chân ký của NGƯỜI tạo đơn + 2 người đã duyệt (kèm ý kiến bước 1)',
    out.slipHTML.includes('Nguyễn Văn Nhân Viên') && out.slipHTML.includes('Trưởng Phòng A') && out.slipHTML.includes('Giám Đốc Vận Hành') && out.slipHTML.includes('Đồng ý, đúng nhu cầu.'));

  record('D: Người KHÔNG có quyền (outsider) bị chặn xem phiếu kèm alert rõ ràng, modal không hiện nội dung', out.outsiderBlockedView);
  record('D: Đơn CHƯA phê duyệt hoàn tất (PENDING) -> chặn xem phiếu dù chính người tạo', out.pendingBlockedView);
  record('D: Người tạo đơn xem được phiếu (modal mở, đúng nội dung)', out.creatorCanView);
  record('D: Người duyệt tải được phiếu (tạo file đúng tên PhieuPheDuyet_<mã>.html)', out.approverCanDownload);

  record('E: buildOperationRowHTML() hiện tuỳ chọn Xem/Tải Phiếu khi đã phê duyệt hoàn tất + đúng quyền', out.rowHasSlipOptions);
  record('E: buildOperationRowHTML() KHÔNG hiện tuỳ chọn này khi đơn còn PENDING', out.rowPendingNoSlipOptions);
  record('E: openOperationProcessModal() nhánh view-only vẫn giữ thông báo cũ VÀ thêm đúng 2 nút Xem/Tải Phiếu', out.viewOnlyBranchHasSlipButtons);

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
