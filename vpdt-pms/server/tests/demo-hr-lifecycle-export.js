// server/tests/demo-hr-lifecycle-export.js
//
// DEMO thật (chụp ảnh, KHÔNG phải test regression) cho nút "📊 Xuất Excel" mới ở Onboarding/Offboarding
// (v25.9, theo yêu cầu người dùng — CHỈ xuất, không Tải Mẫu/Nhập). Dùng hạ tầng harness nhẹ
// (_harness-contract.js) + seed trực tiếp DB.hrProcesses phía client (không cần route server thật, vì
// exportHrProcessExcel() chỉ đọc DB.hrProcesses đã có sẵn).
//
// Chạy: node server/tests/demo-hr-lifecycle-export.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.HRLIFECYCLE_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'hr-lifecycle-export-v25.9');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const h = await startHarness();
  const { page, loginAs, stop } = h;
  await page.setViewportSize({ width: 1500, height: 1100 });

  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
  await page.evaluate((u) => {
    const idx = DB.users.findIndex((x) => x.username === u.username);
    if (idx >= 0) DB.users[idx] = u; else DB.users.push(u);
  }, ADMIN);

  await loginAs('admin');

  // Seed 1 quy trình Onboarding + 1 Offboarding trực tiếp vào DB.hrProcesses (đủ để renderHrProcessList()/
  // exportHrProcessExcel() render/xuất, không cần qua route tạo thật — demo UI thuần, không phải test).
  await page.evaluate(() => {
    DB.hrProcesses = [
      {
        id: 1, processType: 'ONBOARDING', employeeCode: 'NV2001', fullName: 'Trần Văn Mới',
        employeeDept: 'Phòng Kinh Doanh', employeeJobTitle: 'Nhân viên Kinh Doanh', employeePosType: 'HO',
        email: 'tranvanmoi@hcrc.vn', phone: '0909111222', stage: 'TRAINING', targetEndDate: '2026-11-01',
        status: 'IN_PROGRESS', tasks: [{ status: 'DONE' }, { status: 'DONE' }, { status: 'PENDING' }]
      },
      {
        id: 2, processType: 'OFFBOARDING', employeeUsername: 'nv.cu', fullName: 'Nguyễn Thị Nghỉ',
        employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Chuyên viên', employeePosType: 'HO',
        email: 'nghiviec@hcrc.vn', phone: '0909333444', stage: 'HANDOVER', targetEndDate: '2026-10-20',
        status: 'IN_PROGRESS', reason: 'Xin nghỉ việc theo nguyện vọng cá nhân',
        tasks: [{ status: 'DONE' }, { status: 'PENDING' }]
      }
    ];
  });

  await page.evaluate(() => { switchTab('hrLifecycle'); setHrLifecycleView('LIST'); });
  await page.waitForSelector('#hrpListContainer', { timeout: 5000 });
  await page.waitForTimeout(200);

  await page.screenshot({ path: path.join(OUT_DIR, '1-danh-sach-quy-trinh-nut-xuat-excel.png'), fullPage: false });
  console.log('Đã chụp: 1-danh-sach-quy-trinh-nut-xuat-excel.png');

  // Xác nhận click thật hoạt động (không mở dialog tải file thật trong headless, chỉ xác nhận không lỗi JS).
  const result = await page.evaluate(() => {
    const originalFn = window.downloadXlsxFromServer;
    let captured = null;
    window.downloadXlsxFromServer = (fileName, sheetName, columns, rows) => { captured = { fileName, rowCount: rows.length }; };
    exportHrProcessExcel();
    window.downloadXlsxFromServer = originalFn;
    return captured;
  });
  console.log('exportHrProcessExcel() trả về:', result);

  console.log('jsExceptions:', h.jsExceptions);
  await stop();
  console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
