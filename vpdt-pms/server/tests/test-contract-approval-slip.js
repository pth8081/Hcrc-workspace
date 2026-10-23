// server/tests/test-contract-approval-slip.js
//
// Regression cho tính năng "🖨️ Xem/Tải Phiếu Phê Duyệt" ở Hợp Đồng (contracts). Yêu cầu người dùng
// (10/2026): phiếu phải có chân ký, format đẹp/cân đối giống Đăng Ký Xe/Văn Bản Trình/Đặt Hàng NCC —
// ghép vào ĐÚNG khung dùng chung buildApprovalSlipShellHTML()/APPROVAL_SLIP_CSS/
// buildApprovalSignatureColumnHTML() (core.js), không tự vẽ CSS riêng. 2 quyết định QUAN TRỌNG người
// dùng đã xác nhận rõ (khác operationOrders/vppRegistrations):
//   (1) Nút CHỈ hiện ở tab "Quản Lý Hợp Đồng" (activeContractSubTab === 'MANAGE'), KHÔNG hiện ở tab
//       "Phê Duyệt Hợp Đồng" (hồ sơ APPROVED đã biến khỏi tab đó, chuyển hẳn sang tab Quản Lý).
//   (2) KHÔNG áp dụng cho hồ sơ "📥 Nhập Hợp Đồng/Phụ Lục Đã Ký" (isSignedImport — APPROVED ngay lúc
//       tạo, không qua bước duyệt nào, không có effectiveSteps/history thật).
//
// Kiểm tra:
//   A. isContractPostApproval(): đúng ma trận status (PENDING/REJECTED/DRAFT/NEEDS_SUPPLEMENT -> false;
//      APPROVED qua quy trình thật (có effectiveSteps) -> true; APPROVED kiểu isSignedImport (KHÔNG có
//      effectiveSteps) -> false).
//   B. canAccessContractApprovalSlip(): admin/người tạo/người duyệt đúng quy trình -> true; người
//      ngoài/không có user -> false.
//   C. buildContractApprovalSlipHTML(): dùng ĐÚNG khung chung (as-field-table/as-sign-row), hiện đúng
//      mã hợp đồng, đối tác, chân ký (tên người duyệt + ý kiến).
//   D. viewContractApprovalSlip()/downloadContractApprovalSlip(): chặn đúng khi CHƯA phê duyệt hoàn tất
//      qua quy trình thật (gồm cả case isSignedImport) và khi người xem không có quyền; mở modal/tạo
//      file đúng khi hợp lệ.
//   E. Giao diện: buildContractRowHTML() CHỈ hiện 2 tuỳ chọn "Xem/Tải Phiếu Phê Duyệt" ở dropdown khi
//      activeContractSubTab === 'MANAGE' + đã phê duyệt hoàn tất qua quy trình thật + đúng quyền — KHÔNG
//      hiện ở tab APPROVAL (dù cùng 1 hồ sơ APPROVED) và KHÔNG hiện cho hồ sơ isSignedImport dù đang ở
//      tab MANAGE.
//   F. Không có lỗi JS chưa bắt (pageerror) nào phát sinh.
//
// Chạy: node server/tests/test-contract-approval-slip.js
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
    // --- Seed tối thiểu: 1 hợp đồng đã phê duyệt hoàn tất QUA QUY TRÌNH THẬT (2 bước), snapshot
    // effectiveSteps/effectiveApprovers y hệt cách lib/createValidation.js (nhánh "else") gán lúc tạo.
    Object.assign(DB, {
      users: [
        { username: 'nv1', name: 'Nguyễn Văn Nhân Viên', perms: {} },
        { username: 'tp1', name: 'Trưởng Phòng A', perms: {} },
        { username: 'gd1', name: 'Giám Đốc Vận Hành', perms: {} }
      ],
      workflows: [{ id: 'WF_2STEP', name: '2 bước', steps: [
        { order: 1, name: 'Trưởng Phòng', actionLabel: null },
        { order: 2, name: 'Giám Đốc', actionLabel: 'Phê Duyệt Cuối' }
      ] }],
      contractApprovalDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'WF_2STEP', approvers: { 1: ['tp1'], 2: ['gd1'] } } },
      contracts: []
    });

    const contract = {
      id: 8001, code: 'HCRC-KD-NCC-001', title: 'Hợp đồng cung cấp văn phòng phẩm',
      dept: 'Phòng Kinh Doanh', custodianDept: 'Phòng Kinh Doanh', partner: 'Công ty TNHH ABC',
      type: 'Mua bán hàng hóa', content: 'Cung cấp văn phòng phẩm định kỳ hàng tháng.',
      amount: 120000000, startDate: '2027-01-01', endDate: '2027-12-31',
      approvalStatus: 'APPROVED', currentStep: 3, isAddendum: false,
      effectiveSteps: [{ order: 1, name: 'Trưởng Phòng', actionLabel: null }, { order: 2, name: 'Giám Đốc', actionLabel: 'Phê Duyệt Cuối' }],
      effectiveApprovers: { 1: ['tp1'], 2: ['gd1'] },
      history: [
        { step: 1, action: 'APPROVED', approver: 'Trưởng Phòng A', username: 'tp1', time: '08:30 02/10/2026', comment: 'Đồng ý, đúng nhu cầu.' },
        { step: 2, action: 'APPROVED', approver: 'Giám Đốc Vận Hành', username: 'gd1', time: '09:00 02/10/2026', comment: '' }
      ],
      creator: 'nv1', createdAt: '08:00 01/10/2026'
    };
    DB.contracts.push(contract);

    // Hồ sơ "📥 Nhập Hợp Đồng/Phụ Lục Đã Ký" (isSignedImport) — APPROVED NGAY, KHÔNG có effectiveSteps/
    // history thật (mirror chính xác nhánh isSignedImport của lib/createValidation.js).
    const importedContract = Object.assign({}, contract, {
      id: 8002, code: 'HCRC-KD-NCC-002', approvalStatus: 'APPROVED', currentStep: undefined,
      effectiveSteps: undefined, effectiveApprovers: undefined, history: undefined, signedFileUrl: '/uploads/fake-signed.pdf'
    });
    DB.contracts.push(importedContract);

    const pendingContract = Object.assign({}, contract, { id: 8003, code: 'HCRC-KD-NCC-003', approvalStatus: 'PENDING', currentStep: 1, history: [] });
    DB.contracts.push(pendingContract);

    const statusMatrix = {
      PENDING: isContractPostApproval(pendingContract),
      REJECTED: isContractPostApproval(Object.assign({}, contract, { approvalStatus: 'REJECTED' })),
      DRAFT: isContractPostApproval(Object.assign({}, contract, { approvalStatus: 'DRAFT' })),
      NEEDS_SUPPLEMENT: isContractPostApproval(Object.assign({}, contract, { approvalStatus: 'NEEDS_SUPPLEMENT' })),
      APPROVED_REAL_FLOW: isContractPostApproval(contract),
      APPROVED_SIGNED_IMPORT: isContractPostApproval(importedContract)
    };

    const admin = { username: 'admin1', perms: { admin: true } };
    const creator = { username: 'nv1', perms: {} };
    const approver = { username: 'tp1', perms: {} };
    const outsider = { username: 'u.khac', perms: {} };
    const accessMatrix = {
      admin: canAccessContractApprovalSlip(admin, contract),
      creator: canAccessContractApprovalSlip(creator, contract),
      approver: canAccessContractApprovalSlip(approver, contract),
      outsider: canAccessContractApprovalSlip(outsider, contract),
      noUser: canAccessContractApprovalSlip(null, contract)
    };

    const slipHTML = buildContractApprovalSlipHTML(contract);

    // --- D: viewContractApprovalSlip()/downloadContractApprovalSlip() qua đúng hàm thật ---
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
    viewContractApprovalSlip(contract.id);
    const outsiderBlockedView = alerts.length === 1 && document.getElementById('viewModalContent').innerHTML === '';
    alerts.length = 0;

    currentUser = creator;
    document.getElementById('viewModalContent').innerHTML = '';
    viewContractApprovalSlip(pendingContract.id);
    const pendingBlockedView = alerts.length === 1 && document.getElementById('viewModalContent').innerHTML === '';
    alerts.length = 0;

    currentUser = creator;
    document.getElementById('viewModalContent').innerHTML = '';
    viewContractApprovalSlip(importedContract.id);
    const signedImportBlockedView = alerts.length === 1 && document.getElementById('viewModalContent').innerHTML === '';
    alerts.length = 0;

    currentUser = creator;
    document.getElementById('viewModalContent').innerHTML = '';
    viewContractApprovalSlip(contract.id);
    const creatorCanView = alerts.length === 0 &&
      document.getElementById('viewDocModal').classList.contains('hidden') === false &&
      document.getElementById('viewModalContent').innerHTML.includes('HCRC-KD-NCC-001');
    document.getElementById('viewDocModal').classList.add('hidden');

    currentUser = approver;
    downloadContractApprovalSlip(contract.id);
    const approverCanDownload = alerts.length === 0 && createObjectURLCalled && downloadFileName === 'PhieuPheDuyet_HopDong_HCRC-KD-NCC-001.html';

    HTMLAnchorElement.prototype.click = origClick;

    // --- E: buildContractRowHTML() dropdown — đúng tab + đúng gate isSignedImport ---
    currentUser = creator;
    activeContractSubTab = 'MANAGE';
    const rowHTMLManage = buildContractRowHTML(contract);
    const rowManageHasSlipOptions = rowHTMLManage.includes('viewSlip') && rowHTMLManage.includes('downloadSlip');

    const rowHTMLManagePending = buildContractRowHTML(pendingContract);
    const rowManagePendingNoSlip = !rowHTMLManagePending.includes('viewSlip') && !rowHTMLManagePending.includes('downloadSlip');

    const rowHTMLManageSignedImport = buildContractRowHTML(importedContract);
    const rowManageSignedImportNoSlip = !rowHTMLManageSignedImport.includes('viewSlip') && !rowHTMLManageSignedImport.includes('downloadSlip');

    activeContractSubTab = 'APPROVAL';
    const rowHTMLApproval = buildContractRowHTML(contract);
    const rowApprovalNoSlip = !rowHTMLApproval.includes('viewSlip') && !rowHTMLApproval.includes('downloadSlip');
    activeContractSubTab = 'MANAGE';

    return {
      statusMatrix, accessMatrix, slipHTML,
      outsiderBlockedView, pendingBlockedView, signedImportBlockedView, creatorCanView, approverCanDownload,
      rowManageHasSlipOptions, rowManagePendingNoSlip, rowManageSignedImportNoSlip, rowApprovalNoSlip
    };
  });

  record('A: isContractPostApproval() đúng ma trận status (loại trừ isSignedImport)',
    out.statusMatrix.PENDING === false && out.statusMatrix.REJECTED === false &&
    out.statusMatrix.DRAFT === false && out.statusMatrix.NEEDS_SUPPLEMENT === false &&
    out.statusMatrix.APPROVED_REAL_FLOW === true && out.statusMatrix.APPROVED_SIGNED_IMPORT === false,
    JSON.stringify(out.statusMatrix));

  record('B: canAccessContractApprovalSlip() — admin/người tạo/người duyệt -> true, người ngoài/không có user -> false',
    out.accessMatrix.admin === true && out.accessMatrix.creator === true && out.accessMatrix.approver === true &&
    out.accessMatrix.outsider === false && out.accessMatrix.noUser === false,
    JSON.stringify(out.accessMatrix));

  record('C: Phiếu dùng ĐÚNG khung chung (as-field-table/as-sign-row)',
    out.slipHTML.includes('as-field-table') && out.slipHTML.includes('as-sign-row'));
  record('C: Phiếu hiện đúng mã hợp đồng, đối tác',
    out.slipHTML.includes('HCRC-KD-NCC-001') && out.slipHTML.includes('Công ty TNHH ABC'));
  record('C: Phiếu hiện đúng chân ký của 2 người đã duyệt (kèm ý kiến bước 1)',
    out.slipHTML.includes('Trưởng Phòng A') && out.slipHTML.includes('Giám Đốc Vận Hành') && out.slipHTML.includes('Đồng ý, đúng nhu cầu.'));

  record('D: Người KHÔNG có quyền (outsider) bị chặn xem phiếu kèm alert rõ ràng, modal không hiện nội dung', out.outsiderBlockedView);
  record('D: Hợp đồng CHƯA phê duyệt hoàn tất (PENDING) -> chặn xem phiếu dù chính người tạo', out.pendingBlockedView);
  record('D: Hồ sơ "Nhập Hợp Đồng Đã Ký" (isSignedImport, APPROVED nhưng không qua quy trình thật) -> chặn xem phiếu', out.signedImportBlockedView);
  record('D: Người tạo hồ sơ xem được phiếu (modal mở, đúng nội dung)', out.creatorCanView);
  record('D: Người duyệt tải được phiếu (tạo file đúng tên PhieuPheDuyet_HopDong_<mã>.html)', out.approverCanDownload);

  record('E: buildContractRowHTML() ở tab MANAGE hiện tuỳ chọn Xem/Tải Phiếu Phê Duyệt khi đủ điều kiện', out.rowManageHasSlipOptions);
  record('E: buildContractRowHTML() ở tab MANAGE KHÔNG hiện tuỳ chọn này khi hợp đồng còn PENDING', out.rowManagePendingNoSlip);
  record('E: buildContractRowHTML() ở tab MANAGE KHÔNG hiện tuỳ chọn này cho hồ sơ "Nhập Hợp Đồng Đã Ký"', out.rowManageSignedImportNoSlip);
  record('E: buildContractRowHTML() ở tab APPROVAL KHÔNG hiện tuỳ chọn này dù cùng 1 hồ sơ đã APPROVED', out.rowApprovalNoSlip);

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
