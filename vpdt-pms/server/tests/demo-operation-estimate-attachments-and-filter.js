// server/tests/demo-operation-estimate-attachments-and-filter.js
//
// DEMO thật (không phải bộ hồi quy tự động) — chụp ảnh 2 tính năng mới theo yêu cầu người dùng:
//   1) Cột "Tệp Đính Kèm" ở bảng Danh Mục Đầu Tư (danh mục lớn).
//   2) Bộ lọc "Hồ Sơ" mới ở tab Báo Cáo (Vận Hành > QLDA).
// Dùng testHarness.js (Chromium thật mở public/index.html thật).
//
// Chạy: node server/tests/demo-operation-estimate-attachments-and-filter.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'operation-estimate-attachments');

const DEMO_USER = {
  username: 'demo_qlda', name: 'Trưởng Phòng Vận Hành', dept: 'Vận Hành',
  perms: { operationRecordManageAll: true }, active: true
};

const RECORD_A = {
  id: 7001, code: 'MMST-7001', storeName: 'Siêu Thị Demo A', dept: 'Vận Hành', creator: 'demo_qlda',
  estimateStatus: 'APPROVED',
  estimateItems: [
    {
      id: 1, parentId: null, content: 'Nội thất trưng bày', description: 'Kệ, quầy thu ngân', amount: 250000000, note: '',
      assignedToUsernames: ['demo_qlda'], assignedToNames: ['Trưởng Phòng Vận Hành'],
      attachments: [{ fileUrl: '/uploads/demo-bao-gia-noi-that.pdf', fileName: 'Bao_Gia_Noi_That.pdf', fileType: 'application/pdf', uploadedByName: 'Trưởng Phòng Vận Hành', uploadedAt: new Date().toISOString() }]
    },
    { id: 2, parentId: 1, content: 'Kệ trưng bày', description: '', amount: 100000000, note: '' },
    { id: 3, parentId: null, content: 'Hệ thống điện & chiếu sáng', description: '', amount: 180000000, note: '', assignedToUsernames: [], assignedToNames: [], attachments: [] }
  ]
};
const RECORD_B = {
  id: 7002, code: 'SCST-7002', title: 'Sửa Chữa Demo B', dept: 'Vận Hành', creator: 'demo_qlda', estimateStatus: 'APPROVED'
};

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({
    depts: ['Vận Hành'], users: [DEMO_USER],
    operationStoreOpenings: [RECORD_A], operationRepairs: [RECORD_B]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1200, height: 900 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, DEMO_USER);
    await page.waitForTimeout(150);

    // 1) Danh Mục Đầu Tư — mở modal, chụp bảng có cột "Tệp Đính Kèm"
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); setOperationStoreSubTab('OPEN'); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { openOperationEstimateModal('operationStoreOpenings', 7001); });
    await page.waitForTimeout(200);
    await shot(page, '#operationEstimateModal', '01-danh-muc-dau-tu-tep-dinh-kem.png');
    await page.evaluate(() => closeOperationEstimateModal());

    // 2) Báo Cáo QLDA — chụp khối "🔍 Lọc Báo Cáo" có dropdown "Hồ Sơ" mới
    await page.evaluate(() => { setOperationStoreSubTab('REPORT'); renderOperationStoreReport(); });
    await page.waitForTimeout(200);
    await shot(page, '#opStoreReportPanel', '02-bao-cao-qlda-loc-ho-so.png');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n✅ Demo hoàn tất — ảnh chụp ở:', OUT_DIR);
})().catch(err => { console.error(err); process.exit(1); });
