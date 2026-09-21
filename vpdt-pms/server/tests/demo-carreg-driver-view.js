// server/tests/demo-carreg-driver-view.js
//
// DEMO thật (không phải bộ hồi quy tự động) — chụp ảnh tab "🧑‍✈️ Lái Xe" sau khi thêm hiển thị
// "Người đặt xe" + nút "👁️ Xem Phiếu" (theo phản hồi người dùng), và ảnh Phiếu Phê Duyệt đầy đủ mở ra
// từ nút đó. Dùng testHarness.js (Chromium thật mở public/index.html thật).
//
// Chạy: node server/tests/demo-carreg-driver-view.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8995;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'carreg-driver-view');

const BOOKER = { username: 'nv_dat_xe', name: 'Chị Lan (Kinh Doanh)', dept: 'Kinh Doanh', perms: {}, active: true };
const DRIVER = { username: 'lx_thuan', name: 'Anh Tài Xế Hùng', dept: 'Hành Chính', perms: {}, active: true };

const CAR_REG = {
  id: 5601, code: 'DKX-5601', dept: 'Kinh Doanh', creator: 'nv_dat_xe', creatorName: 'Chị Lan (Kinh Doanh)',
  status: 'APPROVED', currentStep: 99,
  type: 'Xe 4 chỗ', km: 24, passengers: '2', directUser: 'Chị Lan (Kinh Doanh)', directUserPhone: '0901234567',
  purpose: 'Gặp khách hàng', reason: 'Ký hợp đồng quý IV với đối tác ABC',
  destination: 'Trụ sở công ty (25 Lê Lợi, Q1) → Khách sạn Rex (141 Nguyễn Huệ, Q1)',
  startTime: '2026-09-22T08:00:00', endTime: '2026-09-22T12:00:00',
  assignedDriverUsername: 'lx_thuan', assignedDriver: 'Anh Tài Xế Hùng', assignedPlate: '51A-123.45',
  assignedVehicleType: 'Sedan', driverConfirmed: false, history: []
};

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({
    depts: ['Kinh Doanh', 'Hành Chính'], users: [BOOKER, DRIVER], carRegs: [CAR_REG]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1000, height: 750 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, DRIVER);
    await page.waitForTimeout(150);

    // 1) Tab "Lái Xe" — thẻ chuyến có "Người đặt xe" + nút "Xem Phiếu"
    await page.evaluate(() => { switchTab('car'); setCarSubTab('DRIVER'); });
    await page.waitForTimeout(150);
    await shot(page, '#carDriverListWrap', '01-tab-lai-xe-nguoi-dat-xe.png');

    // 2) Bấm "Xem Phiếu" — chụp Phiếu Phê Duyệt đầy đủ
    await page.evaluate(() => { viewCarApprovalSlip(5601); });
    await page.waitForTimeout(150);
    await shot(page, '#viewDocModal', '02-phieu-phe-duyet-day-du.png');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n✅ Demo hoàn tất — ảnh chụp ở:', OUT_DIR);
})().catch(err => { console.error(err); process.exit(1); });
