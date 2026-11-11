// server/tests/test-budget-dept-workflow-ui.js
//
// Kiểm UI THẬT (Chromium + public/index.html thật + public/js/*.js thật, cùng hạ tầng testHarness.js) cho
// Ngân Sách — bước Phê Duyệt CUỐI (stage=APPROVED) nay CŨNG theo cấu hình phòng ban
// (budgetApprovedDeptWorkflows, xem canDecideBudgetLineFinal()/canDecideBudgetLineFinalClient()).
// Người KHÔNG giữ quyền phẳng (budgetManage) nhưng được admin gán riêng cho ĐÚNG phòng ban của hồ sơ
// phải THẤY nút Duyệt; với hồ sơ phòng ban KHÁC (chưa cấu hình) thì KHÔNG thấy.
// lib/recordActions.js (canDecideBudgetLineFinal) đã có test thuần riêng
// (test-audit-createvsapprove-gaps.js #5b) — file này chỉ xác minh phần UI (nút ẩn/hiện đúng), không lặp
// lại logic.
//
// 11/2026: file này TRƯỚC ĐÂY tên "test-budget-meeting-dept-workflow-ui.js", kiểm GỘP cả Ngân Sách lẫn
// Đặt Phòng Họp (2 module cùng khuôn cấu hình theo phòng ban lúc đó) — phần Đặt Phòng Họp đã bị GỠ hoàn
// toàn (theo yêu cầu người dùng "bỏ luôn quy trình phòng họp cho đỡ nhầm", xem canDecideMeeting() ở
// lib/recordActions.js), nên đổi tên file + xoá hẳn phần kiểm UI Đặt Phòng Họp (tab "QT Đặt Phòng Họp"
// không còn tồn tại trên UI nữa — xem test-meeting-approval-hub-self-decide.js cho hành vi mới của
// canDecideMeetingClient()).
//
// Chạy: node server/tests/test-budget-dept-workflow-ui.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage, createRunner, assert } = require('./testHarness');

const PORT = 8997;
const OUT_DIR = process.env.BUDGET_DEPT_WF_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'budget-dept-workflow');

// Không giữ budgetManage — CHỈ được gán riêng theo phòng ban (budgetCreate cần để qua được
// canAccessBudgetModule()).
const DEPT_APPROVER = {
  id: 2, username: 'tp_kd', name: 'Trần Thị Trưởng Phòng KD', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng phòng',
  perms: { budgetCreate: true }, active: true
};
const CREATOR = {
  id: 3, username: 'nv_kd', name: 'Nguyễn Văn Nhân Viên', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên',
  perms: { budgetCreate: true }, active: true
};
const WF_1STEP = { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Duyệt' }] };

const BUDGET_LINE_CONFIGURED = {
  id: 101, stage: 'APPROVED', status: 'SUBMITTED', dept: 'Phòng Kinh Doanh', location: 'HO',
  content: 'Nâng cấp máy chủ nội bộ', description: '', quantity: 1, unitPrice: 180000000, vatPercent: 0,
  totalAmount: 180000000, budgetType: 'CAPEX', itemCategory: 'SYSTEM', budgetYear: 2026, budgetMonth: 10,
  createdBy: 'nv_kd', createdByName: 'Nguyễn Văn Nhân Viên', note: ''
};
const BUDGET_LINE_UNCONFIGURED = {
  id: 102, stage: 'APPROVED', status: 'SUBMITTED', dept: 'Phòng Kỹ Thuật', location: 'HO',
  content: 'Mua thiết bị mạng', description: '', quantity: 1, unitPrice: 50000000, vatPercent: 0,
  totalAmount: 50000000, budgetType: 'CAPEX', itemCategory: 'HARDWARE', budgetYear: 2026, budgetMonth: 10,
  createdBy: 'nv_kd', createdByName: 'Nguyễn Văn Nhân Viên', note: ''
};

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({
    depts: ['Phòng Kinh Doanh', 'Phòng Kỹ Thuật'],
    users: [DEPT_APPROVER, CREATOR],
    workflows: [WF_1STEP],
    budgetLines: [BUDGET_LINE_CONFIGURED, BUDGET_LINE_UNCONFIGURED],
    // Chỉ "Phòng Kinh Doanh" được cấu hình — "Phòng Kỹ Thuật" CỐ Ý để trống, mô phỏng đúng phòng ban
    // chưa được admin cấu hình gì.
    budgetApprovedDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'WF_1STEP', approvers: { 1: ['tp_kd'] } } }
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, DEPT_APPROVER);

    // ===== 1) Ngân Sách — tab "✅ Phê Duyệt" =====
    await page.evaluate(() => { switchTab('budget'); setBudgetLineTab('APPROVE'); });
    await page.waitForTimeout(200);
    await shot(page, '#budgetSection', '01-ngansach-phe-duyet-tab.png');

    const budgetButtons = await page.evaluate(() => ({
      configuredHasApprove: !!document.querySelector('button[data-op="approveBudgetLineDraft"][data-arg0="101"]'),
      unconfiguredHasApprove: !!document.querySelector('button[data-op="approveBudgetLineDraft"][data-arg0="102"]')
    }));
    await run.run('Ngân Sách: tp_kd (budgetCreate, KHÔNG budgetManage) được gán riêng cho Phòng Kinh Doanh -> THẤY nút "✔ Duyệt" ở dòng 101 (đúng phòng ban)', () => {
      assert(budgetButtons.configuredHasApprove, 'Thiếu nút Duyệt ở dòng đã cấu hình');
    });
    await run.run('Ngân Sách: cùng người đó KHÔNG thấy nút Duyệt ở dòng 102 (Phòng Kỹ Thuật, chưa cấu hình)', () => {
      assert(!budgetButtons.unconfiguredHasApprove, 'Lại thấy nút Duyệt ở dòng chưa cấu hình — rò quyền chéo phòng ban');
    });

    // ===== 2) Hệ Thống → Quy Trình & Phê Duyệt → tab "📊 QT Ngân Sách - Phê Duyệt" =====
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, Object.assign({}, DEPT_APPROVER, { perms: { admin: true }, totpEnabled: true }));
    await page.evaluate(() => switchTab('system'));
    await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelector('#btnSystemSubWorkflow')?.click());
    await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelector('#btnWfModBudgetApprove')?.click());
    await page.waitForTimeout(150);
    await shot(page, '#workflowSection', '02-admin-qt-ngansach-phe-duyet.png');
    const budgetApproveTabState = await page.evaluate(() => ({
      title: document.getElementById('wfConfigTitle')?.innerText,
      hasDeptCard: !!document.querySelector('#deptWorkflowConfigContainer')
    }));
    await run.run('Admin UI: tab "QT Ngân Sách - Phê Duyệt" render đúng tiêu đề + panel cấu hình theo phòng ban', () => {
      assert(budgetApproveTabState.title && budgetApproveTabState.title.includes('Phê Duyệt Cuối Ngân Sách'), `Tiêu đề sai: ${budgetApproveTabState.title}`);
      assert(budgetApproveTabState.hasDeptCard, 'Thiếu panel cấu hình theo phòng ban');
    });

    const meetingTabBtnExists = await page.evaluate(() => !!document.querySelector('#btnWfModMeeting'));
    await run.run('Admin UI: tab "QT Đặt Phòng Họp" ĐÃ BỊ GỠ hoàn toàn (11/2026) — không còn nút nào để bấm vào', () => {
      assert(!meetingTabBtnExists, 'Nút "#btnWfModMeeting" không được còn tồn tại trên UI');
    });

    await run.run('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', () => {
      assert(pageErrors.length === 0, `pageErrors: ${JSON.stringify(pageErrors)}`);
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
