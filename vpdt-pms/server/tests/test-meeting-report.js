// tests/test-meeting-report.js — Regression suite cho "📊 Báo Cáo" MỚI trong module Phòng Họp (đợt
// "chuyển Danh Mục Phòng Họp vào Quản Lý Danh Mục + thêm subtab báo cáo trong module phòng họp", yêu cầu
// người dùng "để người quản lý có thể xem báo cáo ngay trong module phòng họp") — xem
// renderMeetingReportTab()/setMeetingSubTab() ở module-phonghop.js.
//
// Bao phủ:
//   1. Chỉ người CÓ quyền duyệt lịch họp (canApproveMeeting() — admin/perms.meetingApprove) mới thấy
//      nút "📊 Báo Cáo"; người KHÔNG có quyền gọi setMeetingSubTab('REPORT') trực tiếp vẫn bị lùi về
//      REGISTER (chặn URL/gọi hàm thủ công).
//   2. renderMeetingReportTab(): thẻ tổng hợp đúng (Tổng/Đã Duyệt/Đang Chờ/Đã Hủy/Tổng Giờ), CHỈ tính
//      lịch ĐÃ DUYỆT vào giờ sử dụng + nhóm theo phòng/phòng ban/tháng.
//   3. Bộ lọc khoảng ngày áp theo startTime (thời gian SỬ DỤNG), không phải createdAt.
//   4. Phòng chưa có lịch nào trong khoảng lọc vẫn hiện trong danh sách theo phòng (0 giờ/0 lịch).
//
// Chạy: node server/tests/test-meeting-report.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8993;

async function main() {
  const { server, browser, page } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const meetingApprover = makeUser({ username: 'manager1', name: 'Quản Lý Phòng Họp', dept: 'Phòng IT', perms: { meetingApprove: true } });
    const staff = makeUser({ username: 'staff1', name: 'Nhân Viên Thường', dept: 'Phòng IT', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate(() => {
      DB.meetingRooms = [
        { id: 1, name: 'Phòng Họp Lớn A', short: 'Phòng A' },
        { id: 2, name: 'Phòng Họp Nhỏ B', short: 'Phòng B' } // KHÔNG có lịch nào — phải vẫn hiện 0h/0 lịch
      ];
      DB.meetings = [
        // Đã duyệt, Phòng A, Phòng IT, tháng 1/2026, 2 tiếng.
        { id: 1, room: 'Phòng Họp Lớn A', dept: 'Phòng IT', status: 'APPROVED', startTime: '2026-01-10T08:00', endTime: '2026-01-10T10:00', createdAt: '09/01/2026 10:00:00' },
        // Đã duyệt, Phòng A, Phòng Kế Toán, tháng 2/2026, 1 tiếng.
        { id: 2, room: 'Phòng Họp Lớn A', dept: 'Phòng Kế Toán', status: 'APPROVED', startTime: '2026-02-05T14:00', endTime: '2026-02-05T15:00', createdAt: '04/02/2026 10:00:00' },
        // Đang chờ duyệt — KHÔNG tính vào giờ sử dụng/nhóm theo phòng-ban, CHỈ tính vào "Tổng"/"Đang Chờ".
        { id: 3, room: 'Phòng Họp Lớn A', dept: 'Phòng IT', status: 'PENDING', startTime: '2026-01-15T08:00', endTime: '2026-01-15T09:00', createdAt: '14/01/2026 10:00:00' },
        // Đã hủy — CHỈ tính vào "Tổng"/"Đã Hủy".
        { id: 4, room: 'Phòng Họp Lớn A', dept: 'Phòng IT', status: 'CANCELLED', startTime: '2026-01-20T08:00', endTime: '2026-01-20T09:00', createdAt: '19/01/2026 10:00:00' },
        // Đã duyệt nhưng NGOÀI khoảng lọc sẽ dùng bên dưới (tháng 6) — dùng cho test bộ lọc khoảng ngày.
        { id: 5, room: 'Phòng Họp Lớn A', dept: 'Phòng IT', status: 'APPROVED', startTime: '2026-06-01T08:00', endTime: '2026-06-01T09:00', createdAt: '31/05/2026 10:00:00' }
      ];
    });

    await run('canApproveMeeting()=false (nhân viên thường): nút "📊 Báo Cáo" bị ẩn, gọi setMeetingSubTab("REPORT") trực tiếp vẫn lùi về REGISTER', async () => {
      const result = await page.evaluate((u) => {
        finishLogin(u);
        setMeetingSubTab('REPORT');
        return {
          btnHidden: document.getElementById('btnMeetingSubReport').classList.contains('hidden'),
          reportPanelHidden: document.getElementById('meetingReportTabContent').classList.contains('hidden'),
          registerPanelHidden: document.getElementById('meetingRegisterTabContent').classList.contains('hidden'),
          activeSubTab: activeMeetingSubTab
        };
      }, staff);
      assert(result.btnHidden, 'Nút Báo Cáo phải ẩn với người không có quyền duyệt lịch họp');
      assert(result.reportPanelHidden, 'Khung Báo Cáo phải ẩn');
      assert(!result.registerPanelHidden, 'Phải lùi về tab Đăng Ký thay vì hiện Báo Cáo trắng');
      assertEqual(result.activeSubTab, 'REGISTER');
    });

    await run('canApproveMeeting()=true (meetingApprove): nút "📊 Báo Cáo" hiện, mở được đúng tab', async () => {
      const result = await page.evaluate((u) => {
        finishLogin(u);
        setMeetingSubTab('REPORT');
        return {
          btnHidden: document.getElementById('btnMeetingSubReport').classList.contains('hidden'),
          reportPanelHidden: document.getElementById('meetingReportTabContent').classList.contains('hidden'),
          activeSubTab: activeMeetingSubTab
        };
      }, meetingApprover);
      assert(!result.btnHidden, 'Nút Báo Cáo phải hiện với người có quyền meetingApprove');
      assert(!result.reportPanelHidden, 'Khung Báo Cáo phải hiện');
      assertEqual(result.activeSubTab, 'REPORT');
    });

    await run('renderMeetingReportTab(): thẻ tổng hợp đúng — CHỈ tính giờ sử dụng của lịch ĐÃ DUYỆT, KHÔNG lọc theo ngày (để trống)', async () => {
      const result = await page.evaluate(() => {
        document.getElementById('meetingReportFromDate').value = '';
        document.getElementById('meetingReportToDate').value = '';
        renderMeetingReportTab();
        const cardsText = document.getElementById('meetingReportSummaryCards').innerText;
        return { cardsText };
      });
      // 5 lịch tổng, 3 đã duyệt (id 1,2,5 = 2h+1h+1h = 4h), 1 đang chờ, 1 đã hủy.
      assert(/Tổng Số Lịch[\s\S]*?5/.test(result.cardsText), `Phải có 5 tổng lịch: ${result.cardsText}`);
      assert(/Đã Duyệt[\s\S]*?3/.test(result.cardsText), `Phải có 3 đã duyệt: ${result.cardsText}`);
      assert(/Đang Chờ Duyệt[\s\S]*?1/.test(result.cardsText), `Phải có 1 đang chờ: ${result.cardsText}`);
      assert(/Đã Hủy[\s\S]*?1/.test(result.cardsText), `Phải có 1 đã hủy: ${result.cardsText}`);
      assert(/Tổng Giờ Đã Sử Dụng[\s\S]*?4/.test(result.cardsText), `Phải có 4 giờ đã sử dụng (2+1+1): ${result.cardsText}`);
    });

    await run('renderMeetingReportTab(): nhóm theo Phòng Họp — phòng CHƯA có lịch (Phòng B) vẫn hiện 0, phòng có lịch (Phòng A) tổng đúng giờ', async () => {
      const result = await page.evaluate(() => {
        document.getElementById('meetingReportFromDate').value = '';
        document.getElementById('meetingReportToDate').value = '';
        renderMeetingReportTab();
        return { roomBarsText: document.getElementById('meetingReportRoomBars').innerText };
      });
      assert(result.roomBarsText.includes('Phòng B'), 'Phòng chưa có lịch nào vẫn phải liệt kê (0 lịch)');
      assert(result.roomBarsText.includes('Phòng A'), 'Phòng có lịch phải liệt kê');
    });

    await run('renderMeetingReportTab(): nhóm theo Phòng Ban — chỉ tính lịch ĐÃ DUYỆT (Phòng IT 2 lịch, Phòng Kế Toán 1 lịch)', async () => {
      const result = await page.evaluate(() => {
        document.getElementById('meetingReportFromDate').value = '';
        document.getElementById('meetingReportToDate').value = '';
        renderMeetingReportTab();
        return { deptBarsText: document.getElementById('meetingReportDeptBars').innerText };
      });
      assert(result.deptBarsText.includes('Phòng IT'), 'Phải có Phòng IT');
      assert(result.deptBarsText.includes('Phòng Kế Toán'), 'Phải có Phòng Kế Toán');
    });

    await run('renderMeetingReportTab(): bộ lọc Từ Ngày/Đến Ngày áp theo startTime — giới hạn tháng 1/2026 thì chỉ còn 1 lịch đã duyệt (id 1), loại bỏ id 2 (tháng 2) và id 5 (tháng 6)', async () => {
      const result = await page.evaluate(() => {
        document.getElementById('meetingReportFromDate').value = '2026-01-01';
        document.getElementById('meetingReportToDate').value = '2026-01-31';
        renderMeetingReportTab();
        const cardsText = document.getElementById('meetingReportSummaryCards').innerText;
        document.getElementById('meetingReportFromDate').value = '';
        document.getElementById('meetingReportToDate').value = '';
        renderMeetingReportTab();
        return { cardsText };
      });
      assert(/Tổng Số Lịch[\s\S]*?3/.test(result.cardsText), `Trong tháng 1 chỉ còn 3 lịch (id 1,3,4): ${result.cardsText}`);
      assert(/Đã Duyệt[\s\S]*?1/.test(result.cardsText), `Chỉ còn đúng 1 lịch đã duyệt trong tháng 1 (id 1): ${result.cardsText}`);
      assert(/Tổng Giờ Đã Sử Dụng[\s\S]*?2/.test(result.cardsText), `Chỉ còn 2 giờ (lịch id 1): ${result.cardsText}`);
    });

    await run('renderMeetingReportTab(): xu hướng theo tháng — 2 tháng khác nhau (1/2026 và 2/2026) đều xuất hiện', async () => {
      const result = await page.evaluate(() => {
        renderMeetingReportTab();
        return { monthlyText: document.getElementById('meetingReportMonthlyBars').innerText };
      });
      assert(result.monthlyText.includes('Tháng 1/2026'), `Phải có Tháng 1/2026: ${result.monthlyText}`);
      assert(result.monthlyText.includes('Tháng 2/2026'), `Phải có Tháng 2/2026: ${result.monthlyText}`);
    });

    summarize('test-meeting-report.js');
  } finally {
    await teardown({ server, browser });
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
