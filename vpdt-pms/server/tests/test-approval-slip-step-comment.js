// server/tests/test-approval-slip-step-comment.js
//
// Regression cho v22.9: "Ý kiến của Bộ Phận Chuyên Môn" (yêu cầu người dùng, đối chiếu Mẫu BM-TS02
// "Phiếu báo hỏng/đề nghị sửa chữa" — cột "Ý kiến của Bộ phận chuyên môn" nằm ngay trong phần đánh giá,
// KHÔNG tách riêng) — buildApprovalSignatureColumnHTML() (public/js/core.js) giờ hiện ĐÚNG ghi chú/ý
// kiến (history[].comment) của CHÍNH bước đó ngay dưới chữ ký, thay vì chỉ hiện ý kiến của bước DUYỆT
// CUỐI CÙNG (khối "Ý Kiến Chỉ Đạo Của Người Phê Duyệt Cuối Cùng" tách riêng cũ, đã bỏ khỏi
// buildSubmissionApprovalSlipHTML()/buildOfficeApprovalSlipHTML() — bị trùng lặp + làm rớt mất ý kiến
// của các bước GIỮA, VD "Bộ Phận Chuyên Môn" cho ý kiến trước khi "Trưởng Phòng" phê duyệt).
//
// Kiểm tra:
//   A. buildApprovalSignatureColumnHTML(): bước có comment -> hiện đúng nội dung trong .as-sign-comment;
//      bước không có comment -> KHÔNG render .as-sign-comment (không có div rỗng).
//   B. Quy trình 2 bước (Bộ Phận Chuyên Môn -> Trưởng Phòng), MỖI bước 1 comment khác nhau -> phiếu in
//      "Sửa Chữa" (buildOfficeApprovalSlipHTML) hiện ĐỦ CẢ 2 ý kiến, đúng vị trí dưới đúng chữ ký —
//      không chỉ hiện ý kiến bước cuối như thiết kế cũ.
//   C. Khối "Ý Kiến Chỉ Đạo Của Người Phê Duyệt Cuối Cùng" tách riêng đã bỏ hẳn khỏi phiếu (không còn
//      xuất hiện ở đâu trong HTML trả về) — tránh trùng lặp với ý kiến đã hiện dưới chữ ký.
//   D. Phiếu "Văn Bản Trình" (buildSubmissionApprovalSlipHTML) cũng hiện đúng ý kiến dưới chữ ký, cùng
//      khuôn B/C ở trên.
//
// Chạy: node server/tests/test-approval-slip-step-comment.js
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
  // Ha tang: nap lười KHUNG HTML theo tab (v23.11, core.js::TAB_SECTION_FRAGMENT/loadTabSectionHtml) — mirror dòng trên, cùng lý do (xem _harness.js).
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  const out = await page.evaluate(() => {
    // ===== A: buildApprovalSignatureColumnHTML() trực tiếp =====
    const stepWithComment = { order: 1, name: 'Bộ Phận Chuyên Môn', actionLabel: 'Cho Ý Kiến' };
    const historyWithComment = [{ step: 1, action: 'APPROVED', approver: 'Đỗ Văn Kỹ Thuật', username: 'kythuat1', time: '08:30 14/09/2026', comment: 'Đã kiểm tra thực tế, đề xuất nạp gas + vệ sinh dàn lạnh.' }];
    const htmlWithComment = buildApprovalSignatureColumnHTML(stepWithComment, historyWithComment);

    const stepNoComment = { order: 2, name: 'Trưởng Phòng', actionLabel: null };
    const historyNoComment = [{ step: 2, action: 'APPROVED', approver: 'Trần Thị Trưởng Phòng', username: 'tpkd1', time: '09:00 14/09/2026', comment: '' }];
    const htmlNoComment = buildApprovalSignatureColumnHTML(stepNoComment, historyNoComment);

    // ===== B/C: quy trình 2 bước cho officeReqs (SUA_CHUA — Mẫu BM-TS02) =====
    Object.assign(DB, {
      workflows: [{ id: 'WF_2STEP_CM', name: 'Sửa Chữa có ý kiến chuyên môn', steps: [
        { order: 1, name: 'Bộ Phận Chuyên Môn', actionLabel: 'Cho Ý Kiến' },
        { order: 2, name: 'Trưởng Phòng', actionLabel: null }
      ] }],
      officeFixDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'WF_2STEP_CM', approvers: { 1: ['kythuat1'], 2: ['tpkd1'] } } },
      officeBuyDeptWorkflows: {}
    });
    const officeItem = {
      id: 5001, code: 'HCRC-SC-001', subType: 'SUA_CHUA', dept: 'Phòng Kinh Doanh',
      title: 'Sửa máy lạnh khu vực làm việc tầng 3', qty: '02 bộ', amount: 8500000,
      supplier: 'Cty Điện Lạnh Miền Bắc', usageTime: 'Trong tuần này',
      reason: 'Máy lạnh kêu to, không mát.', customData: {}, createdAt: '08:00 14/09/2026',
      status: 'APPROVED', currentStep: 3,
      history: [
        { step: 1, action: 'APPROVED', approver: 'Đỗ Văn Kỹ Thuật', username: 'kythuat1', time: '08:30 14/09/2026', comment: 'Ý KIẾN CHUYÊN MÔN: đã kiểm tra, đề xuất nạp gas.' },
        { step: 2, action: 'APPROVED', approver: 'Trần Thị Trưởng Phòng', username: 'tpkd1', time: '09:00 14/09/2026', comment: 'Ý KIẾN TRƯỞNG PHÒNG: đồng ý duyệt.' }
      ],
      creator: 'nv1', creatorName: 'Nguyễn Văn Kinh Doanh'
    };
    const officeSlipHTML = buildOfficeApprovalSlipHTML(officeItem);

    // ===== D: buildSubmissionApprovalSlipHTML() =====
    Object.assign(DB, {
      submissionDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'WF_2STEP_CM', approvers: { 1: ['kythuat1'], 2: ['tpkd1'] } } },
      submissionTypeDeptWorkflows: {}
    });
    const subItem = {
      id: 6001, code: 'VBT-001', dept: 'Phòng Kinh Doanh', type: 'Đề Xuất', priority: 'Thường', title: 'Test',
      content: 'Nội dung test', createdAt: '08:00 14/09/2026', status: 'APPROVED', currentStep: 3,
      history: [
        { step: 1, action: 'APPROVED', approver: 'Đỗ Văn Kỹ Thuật', username: 'kythuat1', time: '08:30 14/09/2026', comment: 'Ý KIẾN CHUYÊN MÔN VBT' },
        { step: 2, action: 'APPROVED', approver: 'Trần Thị Trưởng Phòng', username: 'tpkd1', time: '09:00 14/09/2026', comment: 'Ý KIẾN TRƯỞNG PHÒNG VBT' }
      ],
      creator: 'nv1', creatorName: 'Nguyễn Văn Kinh Doanh'
    };
    const subSlipHTML = buildSubmissionApprovalSlipHTML(subItem);

    return { htmlWithComment, htmlNoComment, officeSlipHTML, subSlipHTML };
  });

  record('A: buildApprovalSignatureColumnHTML() hiện đúng comment của CHÍNH bước đó trong .as-sign-comment',
    out.htmlWithComment.includes('as-sign-comment') && out.htmlWithComment.includes('Đã kiểm tra thực tế, đề xuất nạp gas'));
  record('A: bước KHÔNG có comment -> KHÔNG render .as-sign-comment',
    !out.htmlNoComment.includes('as-sign-comment'));

  record('B: Phiếu Sửa Chữa hiện ĐỦ CẢ 2 ý kiến (Bộ Phận Chuyên Môn + Trưởng Phòng), không chỉ bước cuối',
    out.officeSlipHTML.includes('Ý KIẾN CHUYÊN MÔN: đã kiểm tra, đề xuất nạp gas.') && out.officeSlipHTML.includes('Ý KIẾN TRƯỞNG PHÒNG: đồng ý duyệt.'));
  record('C: Khối "Ý Kiến Chỉ Đạo Của Người Phê Duyệt Cuối Cùng" tách riêng đã bỏ hẳn khỏi phiếu Sửa Chữa',
    !out.officeSlipHTML.includes('Ý Kiến Chỉ Đạo Của Người Phê Duyệt Cuối Cùng'));

  record('D: Phiếu Văn Bản Trình cũng hiện ĐỦ CẢ 2 ý kiến dưới đúng chữ ký',
    out.subSlipHTML.includes('Ý KIẾN CHUYÊN MÔN VBT') && out.subSlipHTML.includes('Ý KIẾN TRƯỞNG PHÒNG VBT'));
  record('D: Khối "Ý Kiến Chỉ Đạo Của Người Phê Duyệt Cuối Cùng" tách riêng đã bỏ hẳn khỏi phiếu Văn Bản Trình',
    !out.subSlipHTML.includes('Ý Kiến Chỉ Đạo Của Người Phê Duyệt Cuối Cùng'));

  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

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
