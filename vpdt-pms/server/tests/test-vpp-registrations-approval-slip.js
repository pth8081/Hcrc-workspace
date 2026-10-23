// server/tests/test-vpp-registrations-approval-slip.js
//
// Regression cho tính năng "🖨️ Xem/Tải Phiếu Phê Duyệt" ở Văn Phòng Phẩm (vppRegistrations) — tiếp
// nối đợt operationOrders (v28.5), ghép vào ĐÚNG khung dùng chung buildApprovalSlipShellHTML()/
// APPROVAL_SLIP_CSS/buildApprovalSignatureColumnHTML() (core.js), không tự vẽ CSS riêng.
//
// Kiểm tra:
//   A. isVppRegistrationPostApproval(): đúng ma trận status (DRAFT/PENDING/REJECTED/CANCELLED -> false;
//      APPROVED -> true).
//   B. canAccessVppRegistrationApprovalSlip(): admin/người đăng ký/người duyệt đúng quy trình -> true;
//      người ngoài -> false.
//   C. buildVppRegistrationApprovalSlipHTML(): dùng ĐÚNG khung chung (class as-field-table/
//      as-items-table/as-sign-row), hiện đúng chân ký (tên người duyệt + ý kiến), mã đăng ký, mặt hàng.
//   D. viewVppRegistrationApprovalSlip()/downloadVppRegistrationApprovalSlip(): chặn đúng khi CHƯA phê
//      duyệt và khi người xem không có quyền; mở modal/tạo file đúng khi hợp lệ.
//   E. Giao diện: renderVppRegistrations() dropdown chỉ hiện 2 tuỳ chọn "Xem/Tải Phiếu" khi đã phê
//      duyệt + đúng quyền; openVppRegModal() thêm đúng 2 nút vào khối actionBtns (cả 2 nhánh
//      canApprove/view-only), KHÔNG xoá mất nút Duyệt/Từ chối/Yêu cầu bổ sung đã có.
//   F. Không có lỗi JS chưa bắt (pageerror) nào phát sinh.
//
// Chạy: node server/tests/test-vpp-registrations-approval-slip.js
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
    // --- Seed tối thiểu: 1 đăng ký VPP đã phê duyệt hoàn tất (APPROVED), quy trình 2 bước ---
    Object.assign(DB, {
      workflows: [{ id: 'WF_2STEP', name: 'VPP 2 bước', steps: [
        { order: 1, name: 'Trưởng Phòng', actionLabel: null },
        { order: 2, name: 'Giám Đốc', actionLabel: 'Phê Duyệt Cuối' }
      ] }],
      vppDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'WF_2STEP', approvers: { 1: ['tp1'], 2: ['gd1'] } } },
      vppRegistrations: []
    });
    const reg = {
      id: 8001, code: 'DK-VPP-K1-nv1-8001', periodId: 1, periodName: 'Kỳ 1/2026', dept: 'Phòng Kinh Doanh',
      creator: 'nv1', creatorName: 'Nguyễn Văn Nhân Viên',
      items: [{ code: 'GA4', name: 'Giấy A4', unit: 'Ream', qty: 20, price: 60000 },
              { code: 'BB01', name: 'Bút bi', unit: 'Hộp', qty: 5, price: 150000 }],
      status: 'APPROVED', currentStep: 3, createdAt: '08:00 01/10/2026',
      history: [
        { step: 1, action: 'APPROVED', approver: 'Trưởng Phòng A', username: 'tp1', time: '08:30 02/10/2026', comment: 'Đồng ý, đúng nhu cầu.' },
        { step: 2, action: 'APPROVED', approver: 'Giám Đốc B', username: 'gd1', time: '09:00 02/10/2026', comment: '' }
      ]
    };
    DB.vppRegistrations.push(reg);

    const statusMatrix = {};
    ['DRAFT', 'PENDING', 'REJECTED', 'CANCELLED', 'APPROVED'].forEach(s => {
      statusMatrix[s] = isVppRegistrationPostApproval({ status: s });
    });

    const admin = { username: 'admin1', perms: { admin: true } };
    const creator = { username: 'nv1', perms: {} };
    const approver = { username: 'tp1', perms: {} };
    const outsider = { username: 'u.khac', perms: {} };
    const accessMatrix = {
      admin: canAccessVppRegistrationApprovalSlip(admin, reg),
      creator: canAccessVppRegistrationApprovalSlip(creator, reg),
      approver: canAccessVppRegistrationApprovalSlip(approver, reg),
      outsider: canAccessVppRegistrationApprovalSlip(outsider, reg),
      noUser: canAccessVppRegistrationApprovalSlip(null, reg)
    };

    const slipHTML = buildVppRegistrationApprovalSlipHTML(reg);

    // --- D: viewVppRegistrationApprovalSlip()/downloadVppRegistrationApprovalSlip() qua đúng hàm thật ---
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
    viewVppRegistrationApprovalSlip(reg.id);
    const outsiderBlockedView = alerts.length === 1 && document.getElementById('viewModalContent').innerHTML === '';
    alerts.length = 0;

    const pendingReg = Object.assign({}, reg, { id: 8002, code: 'DK-VPP-K1-nv1-8002', status: 'PENDING' });
    DB.vppRegistrations.push(pendingReg);
    currentUser = creator;
    document.getElementById('viewModalContent').innerHTML = '';
    viewVppRegistrationApprovalSlip(pendingReg.id);
    const pendingBlockedView = alerts.length === 1 && document.getElementById('viewModalContent').innerHTML === '';
    alerts.length = 0;

    currentUser = creator;
    document.getElementById('viewModalContent').innerHTML = '';
    viewVppRegistrationApprovalSlip(reg.id);
    const creatorCanView = alerts.length === 0 &&
      document.getElementById('viewDocModal').classList.contains('hidden') === false &&
      document.getElementById('viewModalContent').innerHTML.includes('DK-VPP-K1-nv1-8001');
    document.getElementById('viewDocModal').classList.add('hidden');

    currentUser = approver;
    downloadVppRegistrationApprovalSlip(reg.id);
    const approverCanDownload = alerts.length === 0 && createObjectURLCalled && downloadFileName === 'PhieuPheDuyet_VPP_DK-VPP-K1-nv1-8001.html';

    HTMLAnchorElement.prototype.click = origClick;

    // --- E: renderVppRegistrations() dropdown + openVppRegModal() actionBtns ---
    currentUser = creator;
    renderVppRegistrations();
    const tbodyHTML = document.getElementById('vppRegTableBody').innerHTML;
    const rowHasSlipOptions = tbodyHTML.includes('viewSlip') && tbodyHTML.includes('downloadSlip');

    DB.vppRegistrations = [pendingReg];
    renderVppRegistrations();
    const tbodyHTMLPendingOnly = document.getElementById('vppRegTableBody').innerHTML;
    const rowPendingNoSlipOptions = !tbodyHTMLPendingOnly.includes('viewSlip') && !tbodyHTMLPendingOnly.includes('downloadSlip');
    DB.vppRegistrations = [reg, pendingReg];

    currentUser = approver; // tp1: đã duyệt bước 1 -> currentStep đã sang 3 (hết bước), view-only
    openVppRegModal(reg.id);
    const actionBtnsHTML = document.getElementById('vppRegModalActionBtns').innerHTML;
    const viewOnlyBranchHasSlipButtons = actionBtnsHTML.includes('viewVppRegistrationApprovalSlip') && actionBtnsHTML.includes('downloadVppRegistrationApprovalSlip') && actionBtnsHTML.includes('Bạn chỉ có quyền xem');
    document.getElementById('vppRegModal').classList.add('hidden');

    return {
      statusMatrix, accessMatrix, slipHTML,
      outsiderBlockedView, pendingBlockedView, creatorCanView, approverCanDownload,
      rowHasSlipOptions, rowPendingNoSlipOptions, viewOnlyBranchHasSlipButtons
    };
  });

  record('A: isVppRegistrationPostApproval() đúng ma trận status',
    out.statusMatrix.DRAFT === false && out.statusMatrix.PENDING === false && out.statusMatrix.REJECTED === false &&
    out.statusMatrix.CANCELLED === false && out.statusMatrix.APPROVED === true,
    JSON.stringify(out.statusMatrix));

  record('B: canAccessVppRegistrationApprovalSlip() — admin/người đăng ký/người duyệt -> true, người ngoài/không có user -> false',
    out.accessMatrix.admin === true && out.accessMatrix.creator === true && out.accessMatrix.approver === true &&
    out.accessMatrix.outsider === false && out.accessMatrix.noUser === false,
    JSON.stringify(out.accessMatrix));

  record('C: Phiếu dùng ĐÚNG khung chung (as-field-table/as-items-table/as-sign-row)',
    out.slipHTML.includes('as-field-table') && out.slipHTML.includes('as-items-table') && out.slipHTML.includes('as-sign-row'));
  record('C: Phiếu hiện đúng mã đăng ký, kỳ, tên mặt hàng',
    out.slipHTML.includes('DK-VPP-K1-nv1-8001') && out.slipHTML.includes('Kỳ 1/2026') && out.slipHTML.includes('Giấy A4') && out.slipHTML.includes('Bút bi'));
  record('C: Phiếu hiện đúng chân ký của NGƯỜI đăng ký + 2 người đã duyệt (kèm ý kiến bước 1)',
    out.slipHTML.includes('Nguyễn Văn Nhân Viên') && out.slipHTML.includes('Trưởng Phòng A') && out.slipHTML.includes('Giám Đốc B') && out.slipHTML.includes('Đồng ý, đúng nhu cầu.'));

  record('D: Người KHÔNG có quyền (outsider) bị chặn xem phiếu kèm alert rõ ràng, modal không hiện nội dung', out.outsiderBlockedView);
  record('D: Đăng ký CHƯA phê duyệt (PENDING) -> chặn xem phiếu dù chính người đăng ký', out.pendingBlockedView);
  record('D: Người đăng ký xem được phiếu (modal mở, đúng nội dung)', out.creatorCanView);
  record('D: Người duyệt tải được phiếu (tạo file đúng tên PhieuPheDuyet_VPP_<mã>.html)', out.approverCanDownload);

  record('E: renderVppRegistrations() dropdown hiện tuỳ chọn Xem/Tải Phiếu khi đã phê duyệt + đúng quyền', out.rowHasSlipOptions);
  record('E: renderVppRegistrations() KHÔNG hiện tuỳ chọn này khi đăng ký còn PENDING', out.rowPendingNoSlipOptions);
  record('E: openVppRegModal() nhánh view-only vẫn giữ thông báo cũ VÀ thêm đúng 2 nút Xem/Tải Phiếu', out.viewOnlyBranchHasSlipButtons);

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
