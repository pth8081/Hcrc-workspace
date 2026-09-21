// server/tests/test-carreg-driver-view-info.js
//
// PHÁT HIỆN (phản hồi người dùng): tab "🧑‍✈️ Lái Xe" (Đăng Ký Xe) trước đây chỉ hiện Mã/Phòng ban/Lộ
// trình/Thời gian/Xe cho tài xế được phân công — KHÔNG hiện "Người đặt xe" (người đăng ký chuyến) và
// không có lối nào mở "Phiếu Phê Duyệt" đầy đủ ngay từ tab này — dù canAccessCarApprovalSlip()/
// viewCarApprovalSlip() (core.js) đã cho phép ĐÚNG tài xế được gán xem/tải từ trước (task #145), tài xế
// không biết/không tới được vì nút "👁️ Xem Phiếu" chỉ nằm ở dropdown "⋮ Khác" của bảng danh sách chung
// "🚗 Đăng Ký Xe" (không phải tab họ thường mở). Vá: thêm thẳng "Người đặt xe" vào thẻ + nút "👁️ Xem
// Phiếu" mở đúng Phiếu Phê Duyệt (có đủ Người đăng ký/Người sử dụng trực tiếp/Lộ trình di chuyển/Mục
// đích) ngay tại tab "Lái Xe" — xem renderCarDriverTab() (module-dangkyxe.js).
//
// Chạy: node server/tests/test-carreg-driver-view-info.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertIncludes } = require('./testHarness');

const PORT = 8994;

const BOOKER = { username: 'nv_dat_xe', name: 'Nhân Viên Đặt Xe', dept: 'Kinh Doanh', perms: {}, active: true };
// Tài xế THUẦN — KHÔNG có bất kỳ quyền car* nào khác (không phải carDispatch/admin/creator) — đúng vai
// trò thực tế: chỉ được PHÂN CÔNG lái, không quản lý gì thêm.
const DRIVER = { username: 'lx_thuan', name: 'Tài Xế Thuần', dept: 'Hành Chính', perms: {}, active: true };

const CAR_REG = {
  id: 5501, code: 'DKX-5501', dept: 'Kinh Doanh', creator: 'nv_dat_xe', creatorName: 'Nhân Viên Đặt Xe',
  status: 'APPROVED', currentStep: 99,
  type: 'Xe 4 chỗ', km: 20, passengers: '2', directUser: 'Nhân Viên Đặt Xe', purpose: 'Đi gặp khách hàng',
  reason: 'Ký hợp đồng quý IV', destination: 'Trụ sở công ty → Khách sạn ABC (đón khách)',
  startTime: '2026-09-22T08:00:00', endTime: '2026-09-22T12:00:00',
  assignedDriverUsername: 'lx_thuan', assignedDriver: 'Tài Xế Thuần', assignedPlate: '51A-123.45',
  assignedVehicleType: 'Sedan', driverConfirmed: false, history: []
};

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const state = createMockState({
    depts: ['Kinh Doanh', 'Hành Chính'], users: [BOOKER, DRIVER], carRegs: [CAR_REG]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await loginAs(page, DRIVER);
    await page.evaluate(() => { switchTab('car'); setCarSubTab('DRIVER'); });
    await page.waitForTimeout(150);

    await run.run('Tab "Lái Xe": thẻ chuyến hiện thẳng "Người đặt xe" (trước đây không có)', async () => {
      const html = await page.evaluate(() => document.getElementById('carDriverListWrap').innerHTML);
      assertIncludes(html, 'Người đặt xe', 'Thẻ phải có nhãn "Người đặt xe"');
      assertIncludes(html, 'Nhân Viên Đặt Xe', 'Phải hiện đúng tên người đăng ký chuyến');
    });

    await run.run('Tab "Lái Xe": có nút "👁️ Xem Phiếu" ngay trên thẻ (trước đây phải qua bảng danh sách chung mới có)', async () => {
      const html = await page.evaluate(() => document.getElementById('carDriverListWrap').innerHTML);
      assertIncludes(html, 'Xem Phiếu', 'Phải có nút Xem Phiếu ngay trên thẻ');
      assertIncludes(html, 'data-op="viewCarApprovalSlip"', 'Nút phải gọi đúng hàm viewCarApprovalSlip() đã có sẵn (core.js)');
    });

    await run.run('Bấm "👁️ Xem Phiếu" -> mở đúng Phiếu Phê Duyệt đầy đủ (Người đăng ký/Lộ trình/Mục đích) — tài xế THUẦN (không admin/carDispatch/creator) vẫn xem được', async () => {
      await page.evaluate(() => { viewCarApprovalSlip(5501); });
      await page.waitForTimeout(100);
      const result = await page.evaluate(() => ({
        visible: !document.getElementById('viewDocModal').classList.contains('hidden'),
        title: document.getElementById('viewModalTitle').innerText,
        sub: document.getElementById('viewModalSub').innerText,
        content: document.getElementById('viewModalContent').innerHTML
      }));
      assert(result.visible, 'Modal Phiếu Phê Duyệt phải mở ra');
      assertIncludes(result.title, 'DKX-5501');
      assertIncludes(result.sub, 'Nhân Viên Đặt Xe', 'Dòng phụ đề phải nêu người đăng ký');
      assertIncludes(result.content, 'Nhân Viên Đặt Xe', 'Nội dung phiếu phải có Người đăng ký');
      assertIncludes(result.content, 'Trụ sở công ty', 'Nội dung phiếu phải có đủ Lộ trình di chuyển (điểm đón/điểm đến)');
      assertIncludes(result.content, 'Khách sạn ABC', 'Lộ trình phải có cả điểm đến');
      assertIncludes(result.content, 'Đi gặp khách hàng', 'Nội dung phiếu phải có Mục đích sử dụng');
    });

    await run.run('canAccessCarApprovalSlip(): người NGOÀI phạm vi (không phải creator/tài xế được gán/approver/admin) vẫn KHÔNG xem được — bản vá không mở rộng quá phạm vi cũ', async () => {
      const denied = await page.evaluate(() => {
        const outsider = { username: 'nguoi_ngoai', perms: {} };
        return canAccessCarApprovalSlip(outsider, DB.carRegs.find((c) => c.id === 5501));
      });
      assert(denied === false, 'Người ngoài phạm vi vẫn phải bị chặn, đúng hành vi cũ (task #145)');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
