// server/tests/demo-hr-process-edit-11-2026.js
//
// DEMO thật (Playwright, chụp ảnh — không phải test regression), theo yêu cầu người dùng: "Bạn xem cái
// phần onboarding này có sửa không, chứ hủy như này nó bị rác hồ sơ. Offboarding cũng vậy, có cho phép
// sửa để nó chạy tiếp đến lúc hoàn thành thì thôi... cả hai đều đưa ảnh để mua cho mình xác nhận mới
// thực hiện" — đã được xác nhận phương án qua Artifact mockup ("OK, bạn thực hiện đi"), đây là DEMO ảnh
// cho tính năng THẬT (không phải mockup) trước khi xin xác nhận merge vào main.
//
// Chụp đủ 3 việc của đợt này:
//   1. "✏️ Sửa Quy Trình" (ONBOARDING) — sửa Mã Nhân Viên + Họ Tên, quy trình tiếp tục chạy đúng chỗ
//      đang dừng (KHÔNG mất checklist/tiến độ đã làm, khác hẳn phải Huỷ rồi tạo lại).
//   2. "✏️ Sửa Quy Trình" (OFFBOARDING) — sửa Ngày Nghỉ Dự Kiến + Ghi Chú.
//   3. Danh sách quy trình mặc định ẨN "Đã Huỷ" (đỡ rối màn theo dõi tiến độ hằng ngày).
//   4. Nhập Excel hàng loạt Onboarding — điền Mã Nhân Viên bị chặn ngay (MỚI, theo yêu cầu "mã sinh tự
//      động mà không được điền mã").
//
// Dùng chung testHarness.js (mirror ĐÚNG lib/recordActions.js/routes/records.js thật, không tự đoán lại
// luật nghiệp vụ) — cùng khuôn demo-hr-onboarding-offboarding-perm-split.js.
//
// Chạy: node server/tests/demo-hr-process-edit-11-2026.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8999;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'hr-process-edit-11-2026');

const HR1 = { username: 'hr1', name: 'Chuyên Viên Nhân Sự', dept: 'Phòng Nhân Sự', perms: { hrOnboardingManage: true, hrOffboardingManage: true }, active: true };
const EMP = { username: 'nv.ketoan', name: 'Nguyễn Văn Kế Toán', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', email: 'ketoan@company.com', perms: {}, active: true };

const ONB_TEMPLATES = [
  { id: 1, processType: 'ONBOARDING', stage: 'PRE_BOARDING', taskName: 'Chuẩn bị máy tính', department: 'IT', dueDaysOffset: -3, isRequired: true, displayOrder: 1, isActive: true },
  { id: 2, processType: 'ONBOARDING', stage: 'FIRST_DAY', taskName: 'Ký hợp đồng lao động', department: 'HR', dueDaysOffset: 0, isRequired: true, displayOrder: 2, isActive: true }
];
const OFFB_TEMPLATES = [
  { id: 10, processType: 'OFFBOARDING', stage: 'NOTICE', taskName: 'Thông báo nghỉ việc', department: 'HR', dueDaysOffset: 0, isRequired: true, displayOrder: 1, isActive: true },
  { id: 11, processType: 'OFFBOARDING', stage: 'HANDOVER', taskName: 'Bàn giao công việc', department: 'MANAGER', dueDaysOffset: 3, isRequired: true, displayOrder: 2, isActive: true }
];

const state = createMockState({
  depts: ['Phòng Nhân Sự', 'Phòng CNTT', 'Phòng Kế Toán'],
  stores: ['Siêu Thị A'],
  jobTitles: ['Nhân viên', 'Chuyên viên'],
  storeJobTitles: [{ label: 'Nhân viên bán hàng' }],
  users: [HR1, EMP],
  hrTaskTemplates: [...ONB_TEMPLATES, ...OFFB_TEMPLATES]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function shot(page, name, selector) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  if (selector) {
    await page.locator(selector).screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: false });
  }
  console.log(`📸 ${file}`);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });

  try {
    await loginAs(page, HR1);

    // ===== 1) ONBOARDING: tạo quy trình, hoàn thành 1 task, rồi "✏️ Sửa Quy Trình" đổi Mã NV sai =====
    const onboardId = await page.evaluate(async () => {
      const result = await callCreateAction('hrProcesses', {
        processType: 'ONBOARDING', employeeCode: 'NV0099', fullName: 'Vũ Thị Sáu',
        employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên',
        email: '', phone: '0912345678', startDate: '2026-12-01', note: ''
      });
      DB.hrProcesses = DB.hrProcesses || [];
      DB.hrProcesses.unshift(result.item);
      return result.item.id;
    });
    // Hoàn thành 1 task trước — minh chứng "Sửa Quy Trình" KHÔNG đụng checklist đã làm.
    await page.evaluate(async (id) => {
      const item = DB.hrProcesses.find(p => p.id === id);
      const task = item.tasks.find(t => t.taskName === 'Ký hợp đồng lao động');
      const result = await callRecordAction('hrProcesses', id, 'complete-task', { taskId: task.taskId });
      hrpApplyProcessUpdate(result.item);
    }, onboardId);

    await page.evaluate(() => { switchTab('hrLifecycle'); setHrLifecycleView('LIST'); });
    await page.waitForTimeout(150);
    await page.evaluate((id) => openHrProcessDetail(id), onboardId);
    await page.waitForSelector('#hrpDetailModal:not(.hidden)');
    await page.waitForTimeout(150);
    // Ảnh 1 — Chi Tiết: thấy đủ 2 nút "✏️ Sửa Quy Trình" / "❌ Huỷ Quy Trình", 1 task đã Hoàn thành.
    await shot(page, '1-onboarding-chi-tiet-truoc-khi-sua', '#hrpDetailModal .max-w-4xl');

    await page.click('button[data-op="hrpEditProcess"]');
    await page.waitForSelector('#genericConfirmModal:not(.hidden)');
    await page.waitForTimeout(150);
    // Ảnh 2 — Modal "Sửa Quy Trình" điền sẵn đúng dữ liệu hiện tại (Mã NV gõ sai "NV0099").
    await shot(page, '2-onboarding-modal-sua-dien-san');

    await page.fill('#hrpEditEmployeeCode', 'NV0100');
    await page.fill('#hrpEditFullName', 'Vũ Thị Sáu (Đã sửa đúng tên)');
    await page.click('#genericConfirmOkBtn');
    await page.waitForFunction((id) => DB.hrProcesses.find(p => p.id === id)?.employeeCode === 'NV0100', onboardId, { timeout: 5000 });
    await page.waitForTimeout(150);
    // Ảnh 3 — Chi Tiết SAU khi sửa: Mã NV/Họ Tên đã đổi, task "Chuẩn bị máy tính" VẪN Hoàn thành (không
    // mất tiến độ), quy trình vẫn "Đang thực hiện" (không phải tạo lại từ đầu như trước đây phải Huỷ).
    await shot(page, '3-onboarding-chi-tiet-sau-khi-sua', '#hrpDetailModal .max-w-4xl');

    await page.evaluate(() => { closeHrProcessDetail(); });

    // ===== 2) OFFBOARDING: tạo quy trình, "✏️ Sửa Quy Trình" đổi Ngày Nghỉ Dự Kiến + Ghi Chú =====
    const offboardId = await page.evaluate(async () => {
      const result = await callCreateAction('hrProcesses', {
        processType: 'OFFBOARDING', employeeUsername: 'nv.ketoan', lastWorkingDate: '2026-12-10', reason: 'Nghỉ việc theo nguyện vọng'
      });
      DB.hrProcesses.unshift(result.item);
      return result.item.id;
    });
    await page.evaluate((id) => openHrProcessDetail(id), offboardId);
    await page.waitForSelector('#hrpDetailModal:not(.hidden)');
    await page.waitForTimeout(150);
    await page.click('button[data-op="hrpEditProcess"]');
    await page.waitForSelector('#genericConfirmModal:not(.hidden)');
    await page.waitForTimeout(150);
    // Ảnh 4 — Modal "Sửa Quy Trình" (OFFBOARDING) — KHÔNG có ô Tài Khoản/Người Kế Nhiệm (cố ý).
    await shot(page, '4-offboarding-modal-sua-dien-san');

    await page.fill('#hrpEditLastWorkingDate', '2026-12-20');
    await page.fill('#hrpEditNote', 'Đã xác nhận lại ngày nghỉ chính xác với quản lý trực tiếp.');
    await page.click('#genericConfirmOkBtn');
    await page.waitForFunction((id) => DB.hrProcesses.find(p => p.id === id)?.lastWorkingDate === '2026-12-20', offboardId, { timeout: 5000 });
    await page.waitForTimeout(150);
    // Ảnh 5 — Chi Tiết OFFBOARDING sau khi sửa Ngày Nghỉ Dự Kiến + Ghi Chú.
    await shot(page, '5-offboarding-chi-tiet-sau-khi-sua', '#hrpDetailModal .max-w-4xl');
    await page.evaluate(() => { document.getElementById('hrpDetailModal').classList.add('hidden'); });

    // ===== 3) Danh sách mặc định ẨN "Đã Huỷ" =====
    const cancelId = await page.evaluate(async () => {
      const result = await callCreateAction('hrProcesses', {
        processType: 'ONBOARDING', employeeCode: 'NV0101', fullName: 'Hồ Sơ Sẽ Bị Huỷ Để Demo',
        employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên',
        email: '', phone: '0900000000', startDate: '2026-12-01', note: ''
      });
      DB.hrProcesses.unshift(result.item);
      const r2 = await callRecordAction('hrProcesses', result.item.id, 'cancel', { reason: 'Trùng dữ liệu, demo Huỷ' });
      hrpApplyProcessUpdate(r2.item);
      return result.item.id;
    });
    await page.evaluate(() => { setHrLifecycleView('LIST'); renderHrProcessList(); });
    await page.waitForTimeout(150);
    // Ảnh 6 — Danh sách mặc định (bộ lọc Trạng Thái = "Đang thực hiện"): KHÔNG thấy hồ sơ "Đã Huỷ" vừa tạo.
    await shot(page, '6-danh-sach-mac-dinh-an-da-huy');

    await page.selectOption('#hrpViewList select[data-op-change="setHrpListFilterStatus"]', 'ALL');
    await page.waitForTimeout(150);
    // Ảnh 7 — Chọn lại "Tất cả" ở bộ lọc: hồ sơ "Đã Huỷ" hiện ra lại bình thường (vẫn xem được, chỉ
    // không mặc định hiện).
    await shot(page, '7-danh-sach-chon-tat-ca-hien-lai-da-huy');
    await page.selectOption('#hrpViewList select[data-op-change="setHrpListFilterStatus"]', 'IN_PROGRESS');

    // ===== 4) Nhập Excel hàng loạt Onboarding — điền Mã Nhân Viên bị chặn =====
    // Route "/apply-create-import" không có :id (action trên CẢ LÔ, không phải 1 bản ghi) nên KHÔNG khớp
    // route generic /api/records/:module/:id/:action mà testHarness.js mirror — mock dùng chung ở đây
    // không có nhánh riêng cho route này (hạ tầng demo, không phải lỗi tính năng). Việc chặn Mã Nhân Viên
    // điền tay ở Nhập Excel hàng loạt đã được xác nhận ĐẦY ĐỦ qua bộ test riêng mount ĐÚNG routes/records.js
    // thật (tests/test-hr-process-onboarding-create-import.js, 14/14 passed — cả qua bước xem trước lẫn
    // gửi thẳng field bỏ qua xem trước), không lặp lại ở đây.
    await page.evaluate(() => { openHrpOnbCreateImportModal(); });
    await page.waitForTimeout(150);
    await shot(page, '8-modal-nhap-excel-onboarding');
    console.log('   ℹ️  Việc chặn Mã Nhân Viên ở Nhập Excel hàng loạt đã xác nhận qua tests/test-hr-process-onboarding-create-import.js (14/14 passed), không demo lại ở đây (mock dùng chung chưa mirror route /apply-create-import).');

    console.log(`\n✅ Demo hoàn tất — ảnh lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
