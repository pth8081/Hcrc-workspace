// server/tests/demo-operation-estimate-attachment-perms.js
//
// DEMO thật (không phải bộ hồi quy tự động) — chụp ảnh SO SÁNH quyền Tệp Đính Kèm sau bản sửa: người
// quản lý hồ sơ toàn quyền (upload/xoá được) vs người chỉ phụ trách 1 phần danh mục lớn (CHỈ XEM, không
// còn nút "+ Thêm tệp"/"✕ Xoá"). Dùng testHarness.js (Chromium thật mở public/index.html thật).
//
// Chạy: node server/tests/demo-operation-estimate-attachment-perms.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'operation-estimate-attachment-perms');

const MANAGER = { username: 'demo_qlda_mgr', name: 'Trưởng Phòng Vận Hành', dept: 'Vận Hành', perms: { operationRecordManageAll: true }, active: true };
const OWNER = { username: 'demo_own_a', name: 'Người Phụ Trách Nội Thất', dept: 'Vận Hành', perms: {}, active: true };

const RECORD_A = {
  id: 7101, code: 'MMST-7101', storeName: 'Siêu Thị Demo Quyền', dept: 'Vận Hành', creator: 'demo_qlda_mgr',
  estimateStatus: 'APPROVED',
  estimateItems: [
    {
      id: 1, parentId: null, content: 'Nội thất trưng bày', description: '', amount: 250000000, note: '',
      assignedToUsernames: ['demo_own_a'], assignedToNames: ['Người Phụ Trách Nội Thất'],
      attachments: [{ fileUrl: '/uploads/demo-bao-gia-noi-that.pdf', fileName: 'Bao_Gia_Noi_That.pdf', fileType: 'application/pdf', uploadedByName: 'Trưởng Phòng Vận Hành', uploadedAt: new Date().toISOString() }]
    }
  ]
};

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({
    depts: ['Vận Hành'], users: [MANAGER, OWNER],
    operationStoreOpenings: [RECORD_A]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1200, height: 500 });

  try {
    // 1) MANAGER — vẫn thêm/xoá được (đối chứng không bị ảnh hưởng)
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await page.waitForTimeout(150);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); openOperationEstimateModal('operationStoreOpenings', 7101); });
    await page.waitForTimeout(200);
    await shot(page, '#operationEstimateItemsTableBody', '01-manager-van-them-xoa-duoc.png');
    await page.evaluate(() => closeOperationEstimateModal());

    // 2) OWNER (chỉ phụ trách danh mục "Nội thất trưng bày") — CHỈ XEM, không còn nút thêm/xoá
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, OWNER);
    await page.waitForTimeout(150);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); openOperationEstimateModal('operationStoreOpenings', 7101); });
    await page.waitForTimeout(200);
    await shot(page, '#operationEstimateItemsTableBody', '02-owner-chi-xem-khong-them-xoa-duoc.png');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n✅ Demo hoàn tất — ảnh chụp ở:', OUT_DIR);
})().catch(err => { console.error(err); process.exit(1); });
