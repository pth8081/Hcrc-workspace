// server/tests/demo-approval-hub-submitter.js
//
// DEMO thật (không phải bộ hồi quy tự động) — chụp ảnh tính năng MỚI "hiện thông tin người gửi/trình"
// trong bảng ✅ Phê Duyệt (Hub), theo đúng yêu cầu người dùng (11/2026): "hiện thêm thông tin người
// gửi/trình để có thông tin rõ ràng hơn", hiển thị dưới dạng 1 dòng nhỏ "Gửi: <tên>" ngay dưới mã hồ sơ
// ở cột "Mã" (không thêm cột mới — tránh làm bảng cuộn ngang nhiều hơn trên tablet/mobile, xem
// resolveApprovalHubSubmitter() ở core-approvalhub.js).
//
// Dùng testHarness.js (Chromium thật mở public/index.html thật qua static server PHỤC VỤ ĐỦ CSS/asset,
// không chỉ HTML+JS — bắt buộc cho demo chụp ảnh, khác test-approval-hub.js vốn chỉ cần DOM, không cần
// style) — seed đủ 3 trường hợp đại diện cho resolveApprovalHubSubmitter():
//   1. Tài liệu (doc) — có sẵn uploaderName trên bản ghi -> hiện NGAY, không cần tra DB.users.
//   2. Hợp đồng (contract) — KHÔNG có field tên riêng (creatorNameField: null) -> tự tra DB.users theo
//      username để lấy tên hiển thị.
//   3. Công Việc đang xin Gia Hạn (taskPending) — tên người xin gia hạn lưu trực tiếp trong
//      task.pendingExtension.requestedByName (không qua resolveApprovalHubSubmitter()).
//
// Chạy: node server/tests/demo-approval-hub-submitter.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'approval-hub-submitter');

const DUYET1 = {
  username: 'duyet1', name: 'Người Duyệt Một', dept: 'Kế Toán', role: 'NHANVIEN', jobTitle: null,
  perms: { admin: false, moduleAccess: {} }, active: true, totpEnabled: true,
};

async function shot(page, width, height, file, label) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(150);
  await page.locator('#approvalHubSection').screenshot({ path: path.join(OUT_DIR, file) });
  console.log(`📸 ${label} (${width}x${height}) ->`, file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({
    depts: ['Kế Toán', 'Kinh Doanh'], stores: [],
    users: [
      DUYET1,
      { username: 'tvhop', name: 'Trần Văn Hợp', dept: 'Kinh Doanh', role: 'NHANVIEN', jobTitle: null, perms: {}, active: true },
      { username: 'phamvan', name: 'Phạm Văn Tùng', dept: 'Kinh Doanh', role: 'NHANVIEN', jobTitle: null, perms: {}, active: true },
    ],
    // 1. Tài liệu — uploaderName có sẵn trên bản ghi -> hiện ngay, không cần tra DB.users.
    deptWorkflows: { 'Kế Toán': { approvers: { 1: ['duyet1'] }, steps: [{ name: 'Trưởng phòng duyệt' }] } },
    docs: [
      { id: 101, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [], displayCode: 'TL-0088',
        title: 'Quy chế chi tiêu nội bộ Quý 4', uploader: 'ntlan', uploaderName: 'Nguyễn Thị Lan', createdAt: '08:12:00 3/11/2026' },
    ],
    // 2. Hợp đồng — KHÔNG có creatorName, chỉ có creator (username) -> tự tra DB.users.
    contracts: [
      { id: 401, dept: 'Kinh Doanh', approvalStatus: 'PENDING', currentStep: 1, history: [], isAddendum: false,
        code: 'HD-0231', title: 'Hợp đồng thuê mặt bằng Siêu thị Quận 7',
        effectiveSteps: [{ order: 1, name: 'Sếp duyệt' }], effectiveApprovers: { 1: ['duyet1'] },
        creator: 'tvhop', signedFileStatus: 'DRAFT', signedFileCurrentStep: 1, signedFileHistory: [], createdAt: '09:45:00 3/11/2026' },
    ],
    // 3. Công Việc xin Gia Hạn — requestedByName lưu trực tiếp trong pendingExtension (không qua
    // resolveApprovalHubSubmitter()) — duyet1 phải là assignedBy để mục này được tính.
    tasks: [
      { id: 701, dept: 'Kinh Doanh', sourceCode: 'CV-0456', title: 'Kiểm kê kho VPP cuối năm', assignedBy: 'duyet1',
        assignedTo: 'phamvan', pendingExtension: { newDeadline: '2026-11-20', requestedBy: 'phamvan', requestedByName: 'Phạm Văn Tùng', requestedAt: '14:30:00 2/11/2026' } },
    ],
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await page.evaluate(async (u) => {
      window.__resetCapture && window.__resetCapture();
      await proceedAfterAuth(u);
    }, DUYET1);
    await page.evaluate(async () => { await switchTab('approvalHub'); });
    await page.waitForTimeout(200);

    const rowCount = await page.evaluate(() => document.querySelectorAll('#approvalHubTableBody tr').length);
    console.log(`ℹ️  Số dòng hiện ở Hub: ${rowCount} (kỳ vọng 3: Tài liệu/Hợp đồng/Công Việc)`);

    await shot(page, 1440, 900, '01-desktop.png', 'Desktop');
    await shot(page, 834, 1194, '02-tablet.png', 'Tablet (iPad)');
    await shot(page, 390, 844, '03-mobile.png', 'Mobile (iPhone 12)');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n✅ Demo hoàn tất — ảnh chụp ở:', OUT_DIR);
})();
