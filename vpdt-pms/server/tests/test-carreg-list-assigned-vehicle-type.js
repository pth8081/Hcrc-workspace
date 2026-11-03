// server/tests/test-carreg-list-assigned-vehicle-type.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo ảnh chụp "Danh Sách Phiếu Đăng Ký Xe": phiếu đăng ký 1 chỗ ngồi
// (c.type, VD "5 chỗ") nhưng Phòng Hành Chính thực tế gán 1 xe KHÁC loại (c.assignedVehicleType, VD "Xe
// 7 chỗ") kèm biển số của đúng xe đó (c.assignedPlate) — dòng danh sách rút gọn (renderCarRegs(), bảng
// "🚗 Đăng Ký Xe" + thẻ "Người đặt xe" tab "🧑‍✈️ Lái Xe") trước đây LUÔN ghép c.type (loại xe NGƯỜI
// ĐĂNG KÝ yêu cầu lúc tạo phiếu, DB.carTypes) với displayPlate (biển số xe THẬT đã gán, DB.carVehicleTypes)
// — khi 2 trường này không khớp (chuyện bình thường, không phải lúc nào cũng có đúng loại xe trống), dòng
// danh sách hiện sai lệch kiểu "5 chỗ (30G-468.62)" dù biển số 30G-468.62 thực ra là xe 7 chỗ. Phiếu phê
// duyệt đầy đủ (buildCarApprovalSlipHTML(), core.js) đã tách 2 dòng riêng "Loại xe đăng ký"/"Loại xe cụ
// thể" rõ ràng nên không bị nhầm — chỉ 2 chỗ rút gọn trên bị ghép sai.
//
// Đã vá: cả 2 chỗ ưu tiên hiện c.assignedVehicleType (loại xe THẬT đã gán) khi đã có, chỉ hiện lại c.type
// (yêu cầu ban đầu) khi phiếu CHƯA được xử lý/gán xe nào (assignedVehicleType rỗng) — xem
// public/js/module-dangkyxe.js, renderCarRegs() + renderCarDriverTab().
//
// Chạy: node server/tests/test-carreg-list-assigned-vehicle-type.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertIncludes, assert } = require('./testHarness');

const PORT = 8993;

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, totpEnabled: true, active: true };
const DRIVER = { username: 'lx_thang', name: 'Phạm Quang Thắng', dept: 'Hành Chính', perms: {}, active: true };

// Đúng kịch bản người dùng báo: đăng ký "5 chỗ" nhưng được gán thực tế "Xe 7 chỗ" biển 30G-468.62.
const CAR_REG_MISMATCH = {
  id: 9001, code: 'DKX-9001', dept: 'Phòng Kiểm Soát Tuân Thủ và Chất Lượng', creator: 'lx_thang', creatorName: 'Phạm Quang Thắng',
  status: 'APPROVED', currentStep: 99,
  type: '5 chỗ', km: 115, passengers: '2', directUser: 'Phạm Quang Thắng', purpose: 'Công tác',
  reason: 'Đi siêu thị Đồ Sơn', destination: '51 Lê Đại Hành, Hai Bà Trưng, Hà Nội → Siêu thị Đồ Sơn',
  startTime: '2026-11-09T08:00:00', endTime: '2026-11-09T17:30:00',
  assignedDriverUsername: 'lx_thang', assignedDriver: 'Phạm Quang Thắng', assignedPlate: '30G-468.62',
  assignedVehicleType: 'Xe 7 chỗ', driverConfirmed: false, history: []
};

// Phiếu chưa xử lý (chưa gán xe) — phải vẫn hiện ĐÚNG loại xe đăng ký ban đầu (không đổi hành vi cũ).
const CAR_REG_UNASSIGNED = {
  id: 9002, code: 'DKX-9002', dept: 'Phòng Kiểm Soát Tuân Thủ và Chất Lượng', creator: 'lx_thang', creatorName: 'Phạm Quang Thắng',
  status: 'PENDING', currentStep: 0,
  type: '5 chỗ', km: 80, passengers: '2', directUser: 'Phạm Quang Thắng', purpose: 'Công tác',
  reason: 'Đi siêu thị khác', destination: 'HO → Siêu thị BRG Mart',
  startTime: '2026-11-24T08:00:00', endTime: '2026-11-24T17:30:00',
  assignedDriverUsername: '', assignedDriver: '', assignedPlate: '', assignedVehicleType: '', history: []
};

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const state = createMockState({
    depts: ['Phòng Kiểm Soát Tuân Thủ và Chất Lượng', 'Hành Chính'], users: [ADMIN, DRIVER],
    carRegs: [CAR_REG_MISMATCH, CAR_REG_UNASSIGNED]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await loginAs(page, ADMIN);
    await page.evaluate(async () => { await switchTab('car'); });
    await page.waitForTimeout(150);

    await run.run('LỖI ĐÃ VÁ: bảng danh sách hiện ĐÚNG loại xe THẬT đã gán (Xe 7 chỗ) thay vì loại xe đăng ký ban đầu (5 chỗ)', async () => {
      const html = await page.evaluate(() => document.getElementById('carTableBody').innerHTML);
      assertIncludes(html, 'Xe 7 chỗ', 'Phải hiện đúng assignedVehicleType ("Xe 7 chỗ") khi đã gán xe');
      assertIncludes(html, '30G-468.62', 'Vẫn phải hiện đúng biển số thật đã gán');
    });

    await run.run('ĐỐI CHỨNG: dòng danh sách KHÔNG còn hiện nhầm "5 chỗ" đứng cạnh biển số xe 7 chỗ đã gán', async () => {
      const html = await page.evaluate(() => document.getElementById('carTableBody').innerHTML);
      assert(!/5 chỗ[^<]*\(30G-468\.62\)/.test(html), 'KHÔNG được ghép "5 chỗ" với biển số của xe 7 chỗ (đúng lỗi người dùng báo)');
    });

    await run.run('Phiếu CHƯA gán xe vẫn hiện đúng loại xe đăng ký ban đầu (không đổi hành vi cũ)', async () => {
      const html = await page.evaluate(() => document.getElementById('carTableBody').innerHTML);
      assertIncludes(html, 'DKX-9002', 'Phải thấy phiếu chưa xử lý trong danh sách');
      assertIncludes(html, 'Chưa xếp', 'Phiếu chưa gán xe vẫn hiện "(Chưa xếp)" như cũ');
    });

    await loginAs(page, DRIVER);
    await page.evaluate(() => { switchTab('car'); setCarSubTab('DRIVER'); });
    await page.waitForTimeout(150);

    await run.run('LỖI ĐÃ VÁ: tab "Lái Xe" (thẻ "Chuyến của tôi") cũng hiện ĐÚNG loại xe thật đã gán, không còn ghép nhầm "5 chỗ"', async () => {
      const html = await page.evaluate(() => document.getElementById('carDriverListWrap').innerHTML);
      assertIncludes(html, 'Xe 7 chỗ', 'Thẻ tài xế phải hiện đúng assignedVehicleType');
      assert(!/5 chỗ[^<]*\(30G-468\.62\)/.test(html), 'Thẻ tài xế KHÔNG được ghép "5 chỗ" với biển số xe 7 chỗ');
    });

  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
