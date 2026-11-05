// server/tests/test-itprice-emergency-reject-button-visibility.js
//
// ĐIỀU TRA báo cáo người dùng (11/2026): "Bình đã có quyền itPriceEmergencyRejectApproveRetail từ trước,
// nhưng nút '✅ Duyệt Huỷ Hồ Sơ' (xét duyệt yêu cầu Từ Chối Khẩn Cấp) KHÔNG hiện ra — chỉ sau khi admin
// CẤP THÊM quyền itPriceProposeCreateRetail (đề xuất giá bán lẻ, không liên quan) + F5 thì nút mới hiện
// ra được". Test này tái hiện ĐÚNG kịch bản: 1 hồ sơ Bán Lẻ đã APPROVED, quản lý (final-step approver)
// gửi yêu cầu "Từ chối khẩn cấp" (emergencyRejectStatus='PENDING'), đăng nhập 1 tài khoản CHỈ có ĐÚNG
// itPriceEmergencyRejectApproveRetail (KHÔNG itPriceProposeCreateRetail, KHÔNG là approver phòng ban nào,
// moduleAccess mặc định/không khai = cho phép — xem hasModuleAccess() core.js) — mở hồ sơ qua đúng tab
// "Mua Hàng > Phê Duyệt Giá Bán Lẻ" (context='APPROVAL', nơi nút này LẼ RA phải hiện), xem nút có hiện
// không.
//
// Chạy: node server/tests/test-itprice-emergency-reject-button-visibility.js
'use strict';
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8991;

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };
const QUANLY = { username: 'quanly', name: 'Trần Thị Quản Lý', dept: 'Phòng Kinh Doanh', perms: {}, active: true };
// Bình: CHỈ có ĐÚNG itPriceEmergencyRejectApproveRetail — KHÔNG itPriceProposeCreateRetail, KHÔNG là
// approver phòng ban nào (itPriceDeptWorkflows rỗng), moduleAccess KHÔNG khai (mặc định cho phép mọi
// module, xem hasModuleAccess()).
const BINH = { username: 'binh', name: 'Nguyễn Văn Bình', dept: 'Phòng Kinh Doanh', perms: { itPriceEmergencyRejectApproveRetail: true }, active: true };

const state = createMockState({
  depts: ['Ban Giám Đốc', 'Phòng Kinh Doanh'],
  users: [ADMIN, QUANLY, BINH],
  priceZones: ['Miền Bắc'],
  workflows: [{ id: 'WF_1STEP', name: 'Duyệt 1 bước', steps: [{ order: 1, name: 'Duyệt' }] }],
  // itPriceDeptWorkflows CỐ Ý RỖNG — hồ sơ RETAIL của phòng "Phòng Kinh Doanh" không map tới workflowId
  // nào -> resolveItPriceWorkflowConfigForItemClient() fallback {workflowId:'WF_1STEP', approvers:{1:['admin']}}
  // (xem resolveItPriceWorkflowConfigForItemClient() ở core.js) — Bình KHÔNG nằm trong approvers mặc định
  // đó, đúng ý "không phải approver phòng ban nào" của kịch bản.
  itPriceDeptWorkflows: {},
  itPriceApprovals: [{
    id: 1, code: 'DGBL-0001', dept: 'Phòng Kinh Doanh', status: 'APPROVED', currentStep: 1,
    priceType: 'RETAIL', priceZone: 'Miền Bắc', applied: false,
    creator: 'quanly', creatorName: 'Trần Thị Quản Lý', createdAt: '08:00:00 01/11/2026',
    history: [{ step: 1, action: 'APPROVED', username: 'quanly', time: '09:00:00 01/11/2026' }],
    emergencyRejectStatus: 'PENDING',
    emergencyRejectRequestedBy: 'quanly', emergencyRejectRequestedByName: 'Trần Thị Quản Lý',
    emergencyRejectRequestedAt: '10:00:00 01/11/2026',
    emergencyRejectReason: 'Khách huỷ đơn, không cần áp giá nữa',
    files: [{ fileUrl: '/uploads/demo.xlsx', fileName: 'demo.xlsx', items: [], columnLabels: [] }]
  }]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  let failed = 0;
  function check(name, cond, detail) {
    if (cond) { console.log(`PASS: ${name}`); }
    else { console.log(`FAIL: ${name}${detail ? '\n  -> ' + detail : ''}`); failed++; }
  }
  try {
    // ===== 1) Đăng nhập Bình, vào ĐÚNG tab "Mua Hàng > Phê Duyệt Giá Bán Lẻ" (context='APPROVAL') =====
    await loginAs(page, BINH);
    const canAccess = await page.evaluate(() => canAccessPurchasingModule(currentUser));
    check('Bình (chỉ có quyền Từ Chối Khẩn Cấp) vào được module Mua Hàng', canAccess === true, `canAccessPurchasingModule=${canAccess}`);

    await page.evaluate(async () => { await switchTab('muaHang'); setPurchasingSubTab('ITPRICE'); });
    await page.waitForTimeout(200);

    const listText = await page.evaluate(() => document.getElementById('mhItPriceTableBody')?.innerText || '(KHÔNG TÌM THẤY #mhItPriceTableBody)');
    console.log('\nNội dung bảng "Phê Duyệt Giá Bán Lẻ" (Mua Hàng) khi Bình xem:\n' + listText);
    check('Hồ sơ DGBL-0001 (đang chờ Từ Chối Khẩn Cấp) hiện trong danh sách của Bình', listText.includes('DGBL-0001'), listText);

    // ===== 2) Mở modal chi tiết ĐÚNG như Bình sẽ làm (bấm "👁️ Chi tiết" ở dòng đó, context='APPROVAL') =====
    await page.evaluate(() => openItPriceModal(1, 'APPROVAL'));
    await page.waitForTimeout(150);
    const modalControlsHtml = await page.evaluate(() => document.getElementById('itPriceModalControls')?.innerHTML || '(KHÔNG TÌM THẤY #itPriceModalControls)');
    console.log('\nNội dung #itPriceModalControls khi Bình mở modal:\n' + modalControlsHtml);
    check('Nút "✅ Duyệt Huỷ Hồ Sơ" HIỆN RA cho Bình (chỉ cần quyền Từ Chối Khẩn Cấp, KHÔNG cần itPriceProposeCreateRetail)',
      modalControlsHtml.includes('Duyệt Huỷ Hồ Sơ') || modalControlsHtml.includes('approveItPriceEmergencyRejectAction'),
      modalControlsHtml);

    // ===== 3) Đối chứng: nút này CÓ xuất hiện ở Approval Hub (action rời, không qua modal) không =====
    const approvalHubText = await page.evaluate(async () => {
      await switchTab('approvalHub');
      await new Promise(r => setTimeout(r, 150));
      return document.getElementById('approvalHubTableBody')?.innerText || '(KHÔNG TÌM THẤY)';
    });
    console.log('\nNội dung Trung Tâm Phê Duyệt (Approval Hub) của Bình:\n' + approvalHubText);
    check('Hồ sơ DGBL-0001 CŨNG hiện trong Approval Hub của Bình (đường thay thế)', approvalHubText.includes('DGBL-0001'), approvalHubText);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failed ? `\n❌ ${failed} kịch bản KHÔNG khớp kỳ vọng.` : '\n✅ Tất cả đúng kỳ vọng.');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
