// server/tests/demo-hr-select-fields.js
//
// DEMO thật (chụp ảnh, không phải bộ hồi quy) — theo yêu cầu người dùng xem trực quan TRƯỚC KHI xác
// nhận thực hiện chính thức đợt rà soát "các trường có nút select chọn nhưng đang để nhập tay" ở 3 màn
// Onboarding/Hồ Sơ Nhân Sự/Quản Lý Hợp Đồng. Chụp ĐỦ các điểm đã sửa:
//   1. Quản Lý Danh Mục — 4 danh mục MỚI (Quan Hệ/Quốc Tịch/Loại Thay Đổi HĐ/Lý Do Chấm Dứt HĐ) gom
//      chung vào khối "Danh Mục Nhân Sự" (fuchsia) có sẵn.
//   2. Onboarding — "Trình Độ" (khối Học Vấn) nay là <select> nguồn Danh Mục Bằng Cấp.
//   3. Hồ Sơ Nhân Sự — modal "+ Tạo Hồ Sơ Mới": "Nơi cấp CCCD/CMND" (LỖI ĐÃ VÁ — trước đây input tự do
//      dù server ép enum, gây lỗi 400 khó hiểu) + "Quan hệ" nay đều là <select>.
//   4. Hồ Sơ Nhân Sự — "Chi Tiết" (Sửa): "Quan hệ"/"Quốc tịch" + dòng Người Phụ Thuộc nay đều <select>.
//   5. Quản Lý Hợp Đồng — "Loại thay đổi" (Phụ Lục) nay <select> + vẫn nhập tay được khi chọn "Khác".
//   6. Quản Lý Hợp Đồng — "Chấm Dứt Hợp Đồng": THAY popup prompt() cũ bằng modal có <select>.
//
// Dùng ĐÚNG hạ tầng Playwright thật (tests/_harness-contract.js) — gọi THẲNG các hàm render/mở modal
// thật của client (renderHrpfProfileForm()/openHrContractDetailModal()/closeHrContractManual()...) với
// dữ liệu set trực tiếp vào DB.* (không cần dựng server giả riêng — demo thuần UI, không submit API).
//
// Chạy: node server/tests/demo-hr-select-fields.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.HR_SELECT_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'hr-select-fields');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const h = await startHarness();
  const { page, loginAs, stop } = h;
  await page.setViewportSize({ width: 1400, height: 1100 });
  const jsExceptions = [];
  page.on('pageerror', (err) => jsExceptions.push(String(err)));

  try {
    await loginAs('admin');

    // Cấp đủ quyền để vào cả 3 màn (admin KHÔNG tự bypass hrContractManage theo thiết kế).
    await page.evaluate(() => {
      const u = DB.users.find(x => x.username === 'admin');
      if (u) u.perms = Object.assign({}, u.perms, { hrProfileManage: true, hrContractManage: true, hrOnboardingManage: true });
      currentUser.perms = Object.assign({}, currentUser.perms, { hrProfileManage: true, hrContractManage: true, hrOnboardingManage: true });
    });

    // Seed 4 danh mục MỚI + các danh mục có sẵn liên quan, để demo có dữ liệu thật hiện trong dropdown.
    await page.evaluate(() => {
      DB.relationshipTypes = ['Vợ/Chồng', 'Con', 'Cha', 'Mẹ', 'Anh/Chị/Em', 'Ông/Bà', 'Khác'];
      DB.nationalities = ['Việt Nam', 'Hoa Kỳ', 'Nhật Bản'];
      DB.contractAmendmentTypes = ['Tăng lương', 'Đổi chức danh', 'Gia hạn hợp đồng', 'Đổi phòng ban', 'Khác'];
      DB.contractTerminationReasons = ['Hết hạn hợp đồng', 'Nghỉ việc tự nguyện', 'Sa thải', 'Thỏa thuận chấm dứt', 'Khác'];
      DB.nationalIdIssuePlaces = ['Bộ Công An', 'Cục Cảnh sát QLHC về TTXH'];
      DB.educationDegrees = ['Trung Cấp', 'Cao Đẳng', 'Đại Học', 'Sau Đại Học'];
    });

    // ===== 1. Quản Lý Danh Mục — khối "Danh Mục Nhân Sự" (fuchsia) với 4 danh mục mới =====
    await page.evaluate(() => { switchTab('system'); });
    await page.evaluate(() => { setSystemSubTab('ADMIN'); setAdminSubTab('CATALOG'); });
    await page.waitForTimeout(150);
    // Mở rộng 4 khối <details> mới + 2 khối lân cận để thấy rõ chúng nằm LIỀN KỀ trong cùng 1 nhóm.
    await page.evaluate(() => {
      ['relationshipTypeList', 'nationalityList', 'contractAmendmentTypeList', 'contractTerminationReasonList', 'educationDegreeList'].forEach(id => {
        const el = document.getElementById(id);
        const details = el?.closest('details');
        if (details) details.open = true;
      });
      document.getElementById('educationDegreeList')?.closest('details')?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '1-danh-muc-nhan-su-gom-chung.png') });

    // ===== 2. Onboarding — "Trình Độ" là select =====
    await page.evaluate(() => { switchTab('hrLifecycle'); });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.getElementById('hrpOnboardingForm')?.scrollIntoView({ block: 'center' });
    });
    // Chọn sẵn 1 giá trị để thấy rõ đây là dropdown thật (không phải ô trống nhìn giống input).
    await page.selectOption('#hrpOnbEduDegree', 'Đại Học').catch(() => {});
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '2-onboarding-trinh-do-select.png') });

    // ===== 3. Hồ Sơ Nhân Sự — modal "+ Tạo Hồ Sơ Mới" =====
    await page.evaluate(() => { switchTab('hrProfile'); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { openHrpfCreateModal(); });
    await page.waitForTimeout(150);
    await page.selectOption('#hrpfCF_nationalIdIssuePlace', 'Bộ Công An').catch(() => {});
    await page.selectOption('#hrpfCF_emergencyContactRelationship', 'Mẹ').catch(() => {});
    await page.evaluate(() => {
      document.getElementById('hrpfCF_nationalIdIssuePlace')?.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '3-ho-so-tao-moi-select.png') });
    await page.evaluate(() => { closeHrpfCreateModal(); });

    // ===== 4. Hồ Sơ Nhân Sự — "Chi Tiết" (Sửa): gọi THẲNG renderHrpfProfileForm() với 1 hồ sơ mẫu,
    // KHÔNG qua fetch/API thật (demo thuần UI) =====
    await page.evaluate(() => {
      const profile = {
        employeeCode: 'NV2001', fullName: 'Nguyễn Văn Kinh Doanh', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân Viên Kinh Doanh',
        email: 'nv.kd@hcrc.vn', status: 'ACTIVE',
        emergencyContactName: 'Nguyễn Thị Mẹ', emergencyContactPhone: '0911222333', emergencyContactRelationship: 'Mẹ',
        nationality: 'Việt Nam',
        dependents: [{ id: 'd1', fullName: 'Nguyễn Văn Con', relationship: 'Con', nationality: 'Việt Nam', dateOfBirth: '2020-06-01', taxCode: null }],
        education: [{ id: 'e1', degree: 'Đại Học', major: 'Quản Trị Kinh Doanh', school: 'Đại Học Kinh Tế TP.HCM', graduationYear: 2017 }]
      };
      document.getElementById('hrpfDetailBody').innerHTML = renderHrpfProfileForm(profile, { scope: 'MANAGE', readOnly: false });
      document.getElementById('hrpfDetailModalTitle').textContent = '✏️ Hồ Sơ Nhân Sự (đang sửa)';
      document.getElementById('hrpfDetailModal').classList.remove('hidden');
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.getElementById('hrpfF_emergencyContactRelationship')?.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '4a-ho-so-chi-tiet-quan-he-quoc-tich-select.png') });
    await page.evaluate(() => {
      document.querySelector('.hrpf-dependent-row')?.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '4b-ho-so-chi-tiet-nguoi-phu-thuoc-select.png') });
    await page.evaluate(() => { closeHrpfDetailModal(); });

    // ===== 5. Quản Lý Hợp Đồng — "Loại thay đổi" (Phụ Lục) select + vẫn nhập tay được khi chọn "Khác" =====
    await page.evaluate(() => {
      DB.laborContracts = [{
        id: 9001, employeeCode: 'NV2001', employeeName: 'Nguyễn Văn Kinh Doanh', contractType: 'INDEFINITE',
        status: 'ACTIVE', startDate: '2024-01-01', endDate: null, baseSalary: 15000000, amendments: []
      }];
      switchTab('hrContract');
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => { openHrContractDetailModal(9001); });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.getElementById('hrcNewAmendmentType')?.scrollIntoView({ block: 'center' });
    });
    await page.selectOption('#hrcNewAmendmentType', 'Tăng lương').catch(() => {});
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '5a-hop-dong-loai-thay-doi-select.png') });
    // Chọn "Khác" -> hiện ô nhập tay (giữ linh hoạt như cũ).
    await page.selectOption('#hrcNewAmendmentType', 'Khác').catch(() => {});
    await page.fill('#hrcNewAmendmentTypeOther', 'Điều chỉnh phụ cấp ăn trưa đặc biệt').catch(() => {});
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '5b-hop-dong-loai-thay-doi-khac-nhap-tay.png') });

    // ===== 6. Quản Lý Hợp Đồng — "Chấm Dứt Hợp Đồng": modal select THAY prompt() cũ =====
    await page.evaluate(() => { closeHrContractManual(9001); });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '6-hop-dong-cham-dut-modal-select.png') });

    console.log('jsExceptions:', jsExceptions);
    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await stop();
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
