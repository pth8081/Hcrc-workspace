// tests/test-report-tab-excel-export.js — Xuất Excel cho 3 báo cáo theo mẫu người dùng cung cấp
// (10/2026): Đăng Ký Xe ("Theo Dõi Đăng Ký - Sử Dụng Xe Ô Tô"), Đặt Phòng Họp ("Theo Dõi Đăng Ký - Sử
// Dụng Phòng Họp"), Văn Phòng Phẩm (2 sheet "Danh_muc_dinh_muc" + "Dang_ky_cap_phat").
//
// Cả 3 đều CHỈ ĐỌC dữ liệu client-side (DB.carRegs/DB.meetings/DB.vppRegistrations/DB.vppPeriods đã tải
// sẵn) rồi gọi downloadXlsxFromServer()/downloadMultiSheetXlsxFromServer() (core.js) có sẵn — không có
// route ghi mới, không đổi dữ liệu/luồng hiện có (xem CLAUDE.md mục "Tính năng Báo Cáo/Xuất Excel mới").
// Mock backend (_mock-backend.js) chặn POST /api/admin/export-xlsx và đẩy body vào window.__xlsxExports.
//
// Bao phủ:
//   1. Car: buildCarReportExportRows() lọc đúng theo khoảng ngày (startTime), map đúng nhãn trạng thái/
//      đánh giá/thời gian sử dụng thực tế; bấm nút "📤 Xuất Excel" (data-op thật) gửi đúng cột/hàng.
//   2. Meeting: buildMeetingReportExportRows() tương tự, map đúng nhãn trạng thái; bấm nút thật.
//   3. VPP: buildVppReportByDeptExportRows() khớp ĐÚNG công thức Chi phí/Định mức/Tỷ lệ đang hiện trên
//      màn renderVppReports(); buildVppReportTrackingExportRows() ra đúng 1 dòng/mặt hàng, 6 cột quy
//      trình Đặt Hàng/Cấp Phát + "Định mức được duyệt" để TRỐNG (theo xác nhận người dùng); bấm nút
//      thật gửi đúng 2 sheet.
//
// Chạy: node server/tests/test-report-tab-excel-export.js
'use strict';
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8996;

async function main() {
  const { server, browser, page } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const carManager = makeUser({ username: 'car.mgr', name: 'QL Xe', dept: 'Phòng Hành Chính', perms: { carReportView: true } });
    const meetingManager = makeUser({ username: 'meeting.mgr', name: 'QL Phòng Họp', dept: 'Phòng Hành Chính', perms: { meetingApprove: true } });
    const vppManager = makeUser({ username: 'vpp.mgr', name: 'QL VPP', dept: 'Phòng Hành Chính', perms: { vppManage: true } });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());

    // ===================== 1) ĐĂNG KÝ XE =====================
    await page.evaluate(() => {
      DB.carRegs = [
        {
          id: 1, code: 'CAR-0001', status: 'COMPLETED', startTime: '2026-01-10T08:00', createdAt: '09/01/2026 10:00:00',
          creatorName: 'Nguyễn Văn An', dept: 'Phòng Kinh Doanh', passengers: '3', directUser: 'Nguyễn Văn An',
          purpose: 'Công tác (đính kèm QĐ, KH)', reason: 'Khảo sát mặt bằng',
          assignedDriver: 'Trần Văn Bình', assignedVehicleType: 'Xe 7 chỗ', assignedPlate: '30A-123.45',
          destination: 'HCRC HN → Hà Đông', driverConfirmedAt: '10/01/2026 08:30:00', tripEndedAt: '10/01/2026 11:45:00',
          actualKm: 42.5, evaluationRating: 4, evaluationIssues: [], evaluationComment: 'Tốt'
        },
        {
          id: 2, code: 'CAR-0002', status: 'PENDING', startTime: '2026-01-15T09:00', createdAt: '14/01/2026 14:00:00',
          creatorName: 'Vũ Thị Lan', dept: 'Phòng Kế Toán', passengers: '1', directUser: 'Vũ Thị Lan',
          purpose: 'Khác (đính kèm KH)', reason: 'Đi nộp hồ sơ thuế'
        },
        // Ngoài khoảng lọc dùng ở test bộ lọc ngày bên dưới (tháng 6).
        { id: 3, code: 'CAR-0003', status: 'APPROVED', startTime: '2026-06-01T08:00', createdAt: '31/05/2026 10:00:00', creatorName: 'X', dept: 'Phòng IT' }
      ];
    });

    await run('[Car] buildCarReportExportRows(): lọc đúng khoảng ngày + map đủ cột (không lọc ngày -> cả 3 dòng)', async () => {
      await page.evaluate((u) => { finishLogin(u); }, carManager);
      await page.evaluate(() => switchTab('car')); // Điều hướng THẬT -> unhide #carSection (bindCspDelegation cần element visible để click được).
      await page.evaluate(() => setCarSubTab('REPORT'));
      await page.evaluate(() => { document.getElementById('carReportFromDate').value = ''; document.getElementById('carReportToDate').value = ''; });
      const rows = await page.evaluate(() => buildCarReportExportRows());
      assertEqual(rows.length, 3, 'Không lọc ngày phải ra đủ 3 phiếu');
      const r1 = rows.find(r => r.code === 'CAR-0001');
      assertEqual(r1.status, 'Hoàn thành', 'Trạng thái COMPLETED phải map đúng nhãn');
      assertEqual(r1.dept, 'Phòng Kinh Doanh');
      assertEqual(r1.assignedDriver, 'Trần Văn Bình');
      assertEqual(r1.assignedVehicleType, 'Xe 7 chỗ');
      assertEqual(r1.assignedPlate, '30A-123.45');
      assertEqual(r1.usageTime, '10/01/2026 08:30:00 ➔ 10/01/2026 11:45:00', 'Thời gian sử dụng thực tế = xác nhận LX ➔ kết thúc chuyến');
      assertEqual(r1.actualKm, 42.5);
      assert(r1.evalText.includes('★★★★☆') && r1.evalText.includes('Tốt'), 'Đánh giá phải có sao + nhận xét');
      const r2 = rows.find(r => r.code === 'CAR-0002');
      assertEqual(r2.status, 'Đang chờ duyệt');
      assertEqual(r2.usageTime, '', 'Chưa có lái xe xác nhận -> để trống');
      assertEqual(r2.evalText, '', 'Chưa đánh giá -> để trống');
    });

    await run('[Car] Bộ lọc ngày (startTime) hoạt động đúng — chỉ trong khoảng mới được xuất', async () => {
      await page.evaluate(() => {
        document.getElementById('carReportFromDate').value = '2026-01-01';
        document.getElementById('carReportToDate').value = '2026-01-31';
      });
      const rows = await page.evaluate(() => buildCarReportExportRows());
      assertEqual(rows.length, 2, 'Chỉ 2 phiếu tháng 1 nằm trong khoảng lọc');
      assert(!rows.some(r => r.code === 'CAR-0003'), 'Phiếu tháng 6 phải bị loại khỏi khoảng lọc tháng 1');
    });

    await run('[Car] Bấm nút "📤 Xuất Excel" (data-op thật) gửi đúng sheetName + cột tới export-xlsx', async () => {
      await page.evaluate(() => { window.__xlsxExports = []; });
      const btnFound = await page.evaluate(() => !!document.querySelector('#carSubReport [data-op="downloadCarReportExcel"]'));
      assert(btnFound, 'Nút Xuất Excel phải có trong #carSubReport với data-op đúng tên hàm');
      await page.click('#carSubReport [data-op="downloadCarReportExcel"]');
      await page.waitForTimeout(50);
      const exp = await page.evaluate(() => window.__xlsxExports[window.__xlsxExports.length - 1]);
      assertEqual(exp.sheetName, 'Theo Doi Su Dung Xe');
      assertEqual(exp.columns.find(c => c.key === 'code').header, 'Mã hồ sơ');
      assertEqual(exp.columns.length, 16, 'Đủ 16 cột theo mẫu người dùng cung cấp');
      assertEqual(exp.rows.length, 2, 'Đúng số phiếu trong khoảng lọc tháng 1 đang chọn');
    });

    // ===================== 2) ĐẶT PHÒNG HỌP =====================
    await page.evaluate(() => {
      DB.meetingRooms = [{ id: 1, name: 'Phòng Họp Tầng 3', short: 'PH3' }];
      DB.meetings = [
        { id: 1, code: 'PH-0001', dept: 'Phòng Kinh Doanh', room: 'Phòng Họp Tầng 3', title: 'Review doanh số Quý 3', attendees: 12, startTime: '2026-02-05T09:00', endTime: '2026-02-05T11:00', equipment: 'Máy chiếu, Micro', status: 'APPROVED' },
        { id: 2, code: 'PH-0002', dept: 'Phòng Nhân Sự', room: 'Phòng Họp Tầng 3', title: 'Phỏng vấn ứng viên', attendees: 4, startTime: '2026-02-06T14:00', endTime: '2026-02-06T16:00', equipment: '', status: 'PENDING' },
        { id: 3, code: 'PH-0003', dept: 'Phòng Kế Toán', room: 'Phòng Họp Tầng 3', title: 'Ngoài khoảng lọc', attendees: 6, startTime: '2026-08-01T08:00', endTime: '2026-08-01T09:00', equipment: '', status: 'APPROVED' }
      ];
    });

    await run('[Meeting] buildMeetingReportExportRows(): map đủ cột + đúng nhãn trạng thái', async () => {
      await page.evaluate((u) => { finishLogin(u); }, meetingManager);
      await page.evaluate(() => switchTab('meeting')); // Điều hướng THẬT -> unhide #meetingSection.
      await page.evaluate(() => setMeetingSubTab('REPORT'));
      await page.evaluate(() => { document.getElementById('meetingReportFromDate').value = ''; document.getElementById('meetingReportToDate').value = ''; });
      const rows = await page.evaluate(() => buildMeetingReportExportRows());
      assertEqual(rows.length, 3);
      const r1 = rows.find(r => r.code === 'PH-0001');
      assertEqual(r1.dept, 'Phòng Kinh Doanh');
      assertEqual(r1.room, 'Phòng Họp Tầng 3');
      assertEqual(r1.title, 'Review doanh số Quý 3');
      assertEqual(r1.attendees, 12);
      assertEqual(r1.equipment, 'Máy chiếu, Micro');
      assertEqual(r1.status, 'Đã duyệt');
      assertEqual(rows.find(r => r.code === 'PH-0002').status, 'Đang chờ duyệt');
    });

    await run('[Meeting] Bộ lọc ngày (startTime) hoạt động đúng', async () => {
      await page.evaluate(() => {
        document.getElementById('meetingReportFromDate').value = '2026-02-01';
        document.getElementById('meetingReportToDate').value = '2026-02-28';
      });
      const rows = await page.evaluate(() => buildMeetingReportExportRows());
      assertEqual(rows.length, 2, 'Chỉ 2 lịch tháng 2 nằm trong khoảng lọc');
    });

    await run('[Meeting] Bấm nút "📤 Xuất Excel" (data-op thật) gửi đúng sheetName + cột', async () => {
      await page.evaluate(() => { window.__xlsxExports = []; });
      const btnFound = await page.evaluate(() => !!document.querySelector('#meetingReportTabContent [data-op="downloadMeetingReportExcel"]'));
      assert(btnFound, 'Nút Xuất Excel phải có trong tab Báo Cáo Phòng Họp với data-op đúng tên hàm');
      await page.click('#meetingReportTabContent [data-op="downloadMeetingReportExcel"]');
      await page.waitForTimeout(50);
      const exp = await page.evaluate(() => window.__xlsxExports[window.__xlsxExports.length - 1]);
      assertEqual(exp.sheetName, 'Theo Doi Su Dung Phong Hop');
      assertEqual(exp.columns.length, 9, 'Đủ 9 cột theo mẫu người dùng cung cấp');
      assertEqual(exp.rows.length, 2);
    });

    // ===================== 3) VĂN PHÒNG PHẨM =====================
    await page.evaluate(() => {
      DB.vppPeriods = [{
        id: 1, name: 'Kỳ 3/2026 (Quý 3)', perPersonBudget: 100000,
        deptHeadcounts: { 'Phòng Kinh Doanh': 60, 'Phòng Kế Toán': 30 },
        deptBudgetRates: {}
      }];
      DB.vppRegistrations = [
        {
          id: 1, periodId: 1, code: 'VPP-0041', dept: 'Phòng Kinh Doanh', creatorName: 'Nguyễn Văn An',
          createdAt: '05/09/2026 08:00:00', status: 'APPROVED',
          items: [
            { name: 'Bút bi Thiên Long', code: 'VPP001', unit: 'Cái', qty: 40, price: 3000 },
            { name: 'Giấy A4 Double A', code: 'VPP014', unit: 'Ram', qty: 8, price: 65000 }
          ],
          history: [{ approver: 'QL VPP', username: 'vpp.mgr', time: '06/09/2026', action: 'APPROVE', step: 1, comment: '' }]
        },
        {
          id: 2, periodId: 1, code: 'VPP-0042', dept: 'Phòng Kế Toán', creatorName: 'Vũ Thị Lan',
          createdAt: '06/09/2026 09:00:00', status: 'PENDING',
          items: [{ name: 'Bìa còng A4', code: 'VPP022', unit: 'Cái', qty: 25, price: 28000 }],
          history: [{ approver: 'QL VPP', username: 'vpp.mgr', time: '06/09/2026', action: 'REQUEST_CHANGES', step: 1, comment: 'Vượt định mức, kiểm tra lại' }]
        }
      ];
    });

    await run('[VPP] buildVppReportByDeptExportRows(): khớp ĐÚNG công thức Chi phí/Định mức/Tỷ lệ đang hiện ở màn Báo Cáo', async () => {
      const period = { id: 1, name: 'Kỳ 3/2026 (Quý 3)', perPersonBudget: 100000, deptHeadcounts: { 'Phòng Kinh Doanh': 60, 'Phòng Kế Toán': 30 }, deptBudgetRates: {} };
      const rows = await page.evaluate((p) => buildVppReportByDeptExportRows(p), period);
      const kd = rows.find(r => r.dept === 'Phòng Kinh Doanh');
      // 40*3000 + 8*65000 = 120000 + 520000 = 640000; định mức = 100000*60 = 6,000,000; tỷ lệ ~10.7%.
      assertEqual(kd.cost, 640000);
      assertEqual(kd.quota, 6000000);
      assertEqual(kd.ratio, '10.7%');
      const kt = rows.find(r => r.dept === 'Phòng Kế Toán');
      // PENDING không tính vào Chi phí (chỉ APPROVED) — Chi phí = 0.
      assertEqual(kt.cost, 0);
      assertEqual(kt.quota, 3000000);
      assertEqual(kt.ratio, '0%');
    });

    await run('[VPP] buildVppReportTrackingExportRows(): 1 dòng/mặt hàng, 6 cột quy trình Đặt Hàng/Cấp Phát + Định mức để TRỐNG, Ghi chú lấy từ lịch sử gần nhất', async () => {
      const period = { id: 1, name: 'Kỳ 3/2026 (Quý 3)' };
      const rows = await page.evaluate((p) => buildVppReportTrackingExportRows(p), period);
      assertEqual(rows.length, 3, '2 mặt hàng của VPP-0041 + 1 mặt hàng của VPP-0042 = 3 dòng');
      const butBi = rows.find(r => r.itemName === 'Bút bi Thiên Long');
      assertEqual(butBi.code, 'VPP-0041');
      assertEqual(butBi.dept, 'Phòng Kinh Doanh');
      assertEqual(butBi.qtyRegistered, 40);
      assertEqual(butBi.priceEstimate, 3000);
      assertEqual(butBi.totalEstimate, 120000);
      assertEqual(butBi.status, 'Đã Duyệt');
      ['approvedQuota', 'adjustNote', 'adjustDate', 'adjustQty', 'orderQty', 'appliedPrice', 'finalTotal', 'allocatedAt'].forEach(k => {
        assertEqual(butBi[k], '', `Cột "${k}" thuộc quy trình Đặt Hàng/Cấp Phát chưa có trong hệ thống -> phải để trống`);
      });
      const biaCong = rows.find(r => r.itemName === 'Bìa còng A4');
      assertEqual(biaCong.status, 'Đang Chờ Duyệt');
      assertEqual(biaCong.note, 'Vượt định mức, kiểm tra lại', 'Ghi chú lấy từ comment lịch sử xử lý gần nhất');
    });

    await run('[VPP] Bấm nút "📤 Xuất Báo Cáo Đăng Ký – Cấp Phát" (data-op thật) gửi đúng 2 sheet', async () => {
      await page.evaluate((u) => { finishLogin(u); }, vppManager);
      await page.evaluate(() => switchTab('vpp')); // Điều hướng THẬT -> unhide #vppSection.
      await page.evaluate(() => setVppSubTab('REPORTS'));
      await page.evaluate(() => {
        renderVppReportPeriodOptions();
        document.getElementById('vppReportPeriodSelect').value = '1';
        window.__xlsxExports = [];
      });
      const btnFound = await page.evaluate(() => !!document.querySelector('#vppSubReports [data-op="downloadVppRegistrationTrackingExcel"]'));
      assert(btnFound, 'Nút Xuất Báo Cáo Đăng Ký – Cấp Phát phải có trong #vppSubReports với data-op đúng tên hàm');
      await page.click('#vppSubReports [data-op="downloadVppRegistrationTrackingExcel"]');
      await page.waitForTimeout(50);
      const exp = await page.evaluate(() => window.__xlsxExports[window.__xlsxExports.length - 1]);
      assert(Array.isArray(exp.sheets), 'Phải gửi dạng nhiều sheet {fileName, sheets}');
      assertEqual(exp.sheets.length, 2);
      assertEqual(exp.sheets[0].sheetName, 'Danh_muc_dinh_muc');
      assertEqual(exp.sheets[1].sheetName, 'Dang_ky_cap_phat');
      assertEqual(exp.sheets[1].columns.length, 21, 'Đủ 21 cột theo mẫu người dùng cung cấp');
      assertEqual(exp.sheets[1].rows.length, 3);
    });

    await run('[VPP] Chưa chọn kỳ -> báo lỗi rõ ràng, không gọi export-xlsx', async () => {
      await page.evaluate(() => {
        window.__alerts = [];
        window.__xlsxExports = [];
        document.getElementById('vppReportPeriodSelect').innerHTML = '<option value="">-- Chọn kỳ --</option>';
      });
      await page.click('#vppSubReports [data-op="downloadVppRegistrationTrackingExcel"]');
      await page.waitForTimeout(50);
      const alerts = await page.evaluate(() => window.__alerts);
      const exportsCount = await page.evaluate(() => window.__xlsxExports.length);
      assert(alerts.some(a => /chọn kỳ/i.test(a)), 'Phải báo lỗi nhắc chọn kỳ đăng ký');
      assertEqual(exportsCount, 0, 'Không được gọi export-xlsx khi chưa chọn kỳ');
    });
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-report-tab-excel-export.js');
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
