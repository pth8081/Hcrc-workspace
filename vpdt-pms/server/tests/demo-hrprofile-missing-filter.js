// tests/demo-hrprofile-missing-filter.js — DEMO ảnh thật (Playwright) cho tính năng MỚI (12/2026, theo
// yêu cầu người dùng kèm ảnh chụp mobile Cơ Cấu Tổ Chức "chưa có ai giữ": "Bộ phân nhân sự có nhiều vị
// trí chưa gán chức danh nên tôi muốn ô tìm kiếm sẽ có thêm lọc tìm hồ sơ chưa gán chức danh, phòng ban,
// để nhân sự cập nhật") — 2 checkbox MỚI "💼 Chưa gán Chức Danh"/"🏢 Chưa gán Phòng Ban" trong panel bộ
// lọc đã có của "📋 Quản Lý Hồ Sơ" (xem tests/test-hrprofile-manage-filter-panel.js cho bộ hồi quy đầy đủ).
//
// Chạy: node server/tests/demo-hrprofile-missing-filter.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8995;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'hrprofile-missing-filter');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const HR = { username: 'hr1', name: 'Trần Thị Nhân Sự', dept: 'Nhân Sự', perms: { hrProfileManage: true }, active: true, totpEnabled: true };
  const LINKED_USER = { username: 'nv.hoang', name: 'Nguyễn Đức Hoàng Dương', dept: 'Siêu thị số 390 Nguyễn Văn Cừ', startDate: '2024-03-01', active: true, totpEnabled: true };
  const PROFILES = [
    { employeeCode: 'BL3880', username: 'nv.hoang', status: 'ACTIVE', dept: 'Siêu thị số 390 Nguyễn Văn Cừ', jobTitle: 'Nhân viên',
      employmentType: 'Chính thức', nationalId: '079201001234', joinDateAtHcrc: '2024-03-01', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    // 2 hồ sơ MỚI (theo đúng ảnh Cơ Cấu Tổ Chức người dùng gửi — "Trưởng phòng Mua hàng"/"Phó phòng Mua
    // hàng" ở Ban Cung Ứng còn "chưa có ai giữ") — đã có Phòng Ban (Ban Cung Ứng gán vị trí) nhưng CHƯA
    // GÁN Chức Danh cụ thể, cần nhân sự cập nhật.
    { employeeCode: 'BL4001', username: null, status: 'ACTIVE', dept: 'Ban Cung Ứng', jobTitle: '',
      employmentType: 'Chính thức', nationalId: '', joinDateAtHcrc: '2026-01-15', createdAt: '2026-01-15', updatedAt: '2026-01-15' },
    { employeeCode: 'BL4002', username: null, status: 'ACTIVE', dept: 'Ban Cung Ứng', jobTitle: '',
      employmentType: 'Chính thức', nationalId: '', joinDateAtHcrc: '2026-01-16', createdAt: '2026-01-16', updatedAt: '2026-01-16' },
    // 1 hồ sơ CÓ Chức Danh nhưng CHƯA GÁN Phòng Ban (vừa tạo, chưa qua Cơ Cấu Tổ Chức).
    { employeeCode: 'BL4003', username: null, status: 'ACTIVE', dept: '', jobTitle: 'Nhân viên Kho',
      employmentType: 'Thời vụ', nationalId: '', joinDateAtHcrc: '2026-01-18', createdAt: '2026-01-18', updatedAt: '2026-01-18' }
  ];
  const state = createMockState({
    users: [HR, LINKED_USER], employeeProfiles: PROFILES,
    employmentTypes: ['Chính thức', 'Thời vụ', 'Bán thời gian']
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 420, height: 900 }); // viewport nhỏ — mô phỏng điện thoại, đúng ảnh người dùng gửi
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, HR);
    await page.evaluate(() => { switchTab('hrProfile'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { setHrProfileView('MANAGE'); });
    await page.waitForTimeout(300);

    await page.evaluate(() => document.getElementById('hrpfViewManage').scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(OUT_DIR, '1-truoc-khi-mo-bo-loc.png'), fullPage: false });
    console.log('📸 1-truoc-khi-mo-bo-loc.png — màn Quản Lý Hồ Sơ, panel bộ lọc đang thu gọn');

    await page.click('#btnToggleHrpfMgFilter');
    await page.waitForTimeout(150);
    await page.evaluate(() => document.getElementById('hrpfMgFilterPanel').scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(OUT_DIR, '2-mo-bo-loc-thay-2-o-moi.png'), fullPage: false });
    console.log('📸 2-mo-bo-loc-thay-2-o-moi.png — mở bộ lọc, thấy 2 ô "💼 Chưa gán Chức Danh" / "🏢 Chưa gán Phòng Ban" MỚI');

    await page.check('#hrpfMgFilterMissingJobTitle');
    await page.check('#hrpfMgFilterMissingDept');
    await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById('hrpfManageListWrap').scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(OUT_DIR, '3-tick-ca-2-o-loc-ra-dung-3-ho-so.png'), fullPage: false });
    const tbodyText = await page.textContent('#hrpfManageTableBody');
    console.log('📸 3-tick-ca-2-o-loc-ra-dung-3-ho-so.png — tick cả 2 ô, CHỈ còn 3 hồ sơ thiếu (BL4001/BL4002/BL4003), kèm badge ⚠️ ngay trên tên');
    console.log(tbodyText.includes('BL4001') && tbodyText.includes('BL4002') && tbodyText.includes('BL4003') && !tbodyText.includes('BL3880')
      ? '✅ Đúng: lọc ra đúng 3 hồ sơ thiếu, loại BL3880 (đã đủ Chức Danh + Phòng Ban)'
      : '⚠️ SAI KẾT QUẢ LỌC — xem lại code');

    if (jsErrors.length) console.log('⚠️ Có lỗi JS: ' + jsErrors.join(' | '));
    else console.log('\n✅ Demo hoàn tất — không có lỗi JS, ảnh lưu tại: ' + OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
