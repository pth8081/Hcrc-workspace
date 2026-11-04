// server/tests/demo-itprice-download-context-fix.js
//
// DEMO thật — chụp ảnh fix "nút Tải file gốc không hiện ở bước phê duyệt khi dùng Nhóm Phê Duyệt Cuối"
// (11/2026, người dùng báo lỗi kèm ảnh chụp thật từ production — mã HCRC-MHTPTS-ITPG-BL-013).
//
// Mô phỏng đúng cấu trúc hồ sơ thật: Bán Lẻ, 2 bước (Trưởng Phòng Duyệt -> Giám đốc CUNB qua "Nhóm Phê
// Duyệt Cuối"), đang PENDING ở bước 2 — người duyệt bước cuối mở modal từ context="SUPPORT" (mirror
// trường hợp không mở từ đúng 2 tab Mua Hàng/Vận Hành) để chứng minh nút Tải giờ vẫn hiện đúng.
//
// Chạy: node server/tests/demo-itprice-download-context-fix.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8990;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'itprice-download-context-fix');

const FINAL_APPROVER = { username: 'BL1370', name: 'Nguyễn Thị Hải Bình', dept: 'Phòng Mua hàng Thực phẩm Tươi sống', perms: {}, active: true };
const APPROVER1 = { username: 'BL2059', name: 'Hoàng Văn Đại', dept: 'Phòng Mua hàng Thực phẩm Tươi sống', perms: {}, active: true };
const SUBMITTER = { username: 'BL022', name: 'Phạm Thị Thanh Loan', dept: 'Phòng Mua hàng Thực phẩm Tươi sống', perms: {}, active: true };

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({
    depts: ['Phòng Mua hàng Thực phẩm Tươi sống'],
    users: [FINAL_APPROVER, APPROVER1, SUBMITTER],
    itPriceDeptWorkflows: { 'Phòng Mua hàng Thực phẩm Tươi sống': { workflowId: 'wf-bl-price', approvers: { 1: ['BL2059'] } } },
    workflows: [{ id: 'wf-bl-price', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }] }],
    itPriceApprovals: [{
      id: 901, code: 'HCRC-MHTPTS-ITPG-BL-013', dept: 'Phòng Mua hàng Thực phẩm Tươi sống', priceType: 'RETAIL',
      status: 'PENDING', currentStep: 2,
      history: [
        { step: 1, stepName: 'Trưởng Phòng Duyệt', approver: 'Hoàng Văn Đại', username: 'BL2059', action: 'APPROVED', comment: '', time: '16:44:33 03/11/2026' }
      ],
      extraApprovalLayers: [
        { layerKey: 'exgrp_itprice_retail_mvhvg4a298', label: 'Giám đốc CUNB', actionLabel: 'Phê duyệt', approvers: ['BL1370'] }
      ],
      creator: 'BL022', creatorName: 'Phạm Thị Thanh Loan',
      productName: 'Khuyến mãi.', reason: 'Cải giá bán KM Evergrow 362 Ngọc Lâm',
      customData: {}, nganhHang: [],
      files: [
        { id: 1, fileName: '261103 KM Evergrow riêng Ngọc Lâm.xlsx', fileUrl: '/uploads/test-file.xlsx', uploadedBy: 'BL022', uploadedByName: 'Phạm Thị Thanh Loan', uploadedAt: '16:31:04 03/11/2026', items: [1, 2, 3, 4, 5], columnLabels: [] }
      ],
      infoRequests: [], createdAt: '16:31:04 03/11/2026'
    }]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, FINAL_APPROVER);
  // context='SUPPORT' — mô phỏng trường hợp KHÔNG mở từ đúng 2 tab Mua Hàng/Vận Hành (trước khi vá, nút
  // Tải sẽ bị ẩn nhầm ở đây dù người này đúng là approver bước hiện tại).
  await page.evaluate((id) => { openItPriceModal(id, 'SUPPORT'); }, 901);
  await page.waitForTimeout(200);

  await page.setViewportSize({ width: 900, height: 700 });
  await page.locator('#itPriceModal .bg-white').first().screenshot({ path: path.join(OUT_DIR, '01-sau-khi-vua-nut-tai-hien-dung.png') });
  console.log('📸 01-sau-khi-vua-nut-tai-hien-dung.png');

  await browser.close();
  server.close();
  console.log('\n✅ Demo hoàn tất — ảnh chụp ở:', OUT_DIR);
})();
