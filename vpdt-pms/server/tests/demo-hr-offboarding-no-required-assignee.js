// server/tests/demo-hr-offboarding-no-required-assignee.js
//
// DEMO thật (Playwright, chụp ảnh — không phải test regression), theo yêu cầu người dùng: "có những
// nhân sự có thể phải ra về ngay trong ngày... bỏ hết dấu sao để nhập bất cứ công việc gì cũng có thể
// exit được" (12/2026). Hành vi SERVER đã được test kỹ ở tests/test-hr-lifecycle.js (mục "OFFBOARDING —
// KHÔNG CÒN CHẶN THIẾU GÁN PHỤ TRÁCH", 53/53 scenario) — demo này CHỈ minh hoạ bằng ẢNH + THAO TÁC THẬT
// trên UI: mở form "+ Tạo Offboarding", để trống hết khối "Gán Phụ Trách", bấm nút "🔒 Tạo Quy Trình"
// THẬT và xác nhận quy trình tạo thành công (KHÔNG còn bị chặn như trước).
//
// Chạy: node server/tests/demo-hr-offboarding-no-required-assignee.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { startStaticServer, createMockState, createRunner, launchPage, buildOrgChartFixture } = require('./testHarness');

const PORT = 8997;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'hr-offboarding-no-required-assignee');

const HR1 = { id: 1, username: 'hr1', name: 'Chuyên Viên Nhân Sự', dept: 'Phòng Nhân Sự', perms: { hrOffboardingManage: true }, active: true };
const EMP = { id: 2, username: 'nv.gaprut', name: 'Phạm Văn Gấp Rút', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', perms: {}, active: true };

// Checklist mẫu Offboarding tối giản — toàn bộ 2 việc đều BẮT BUỘC (isRequired: true), đúng kịch bản
// "nhân sự ra về ngay trong ngày, chưa kịp tìm đủ người phụ trách cho từng việc bắt buộc".
const OFFB_TEMPLATES = [
  { id: 1, processType: 'OFFBOARDING', stage: 'NOTICE', taskName: 'Thông báo cho phòng ban', department: 'HR', dueDaysOffset: 0, isRequired: true, displayOrder: 1, isActive: true },
  { id: 2, processType: 'OFFBOARDING', stage: 'ASSET_REVOKE', taskName: 'Thu hồi thiết bị + khoá tài khoản', department: 'IT', dueDaysOffset: 0, isRequired: true, displayOrder: 2, isActive: true }
];

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, user);
}
async function shot(page, name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`📸 ${file}`);
}

async function main() {
  const state = createMockState({
    depts: ['Phòng Nhân Sự', 'Phòng CNTT', 'Phòng Kế Toán'],
    stores: [],
    users: [HR1, EMP],
    hrTaskTemplates: OFFB_TEMPLATES,
    orgChartVersions: [buildOrgChartFixture([{ dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên' }])]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  await page.setViewportSize({ width: 1100, height: 1000 });

  try {
    await loginAs(page, HR1);
    await page.evaluate(() => { switchTab('hrLifecycle'); });
    await page.waitForTimeout(150);

    // Bấm THẬT nút "+ Tạo Offboarding" (không gọi thẳng showHrCreateForm() qua JS) — đúng như người
    // dùng thật sẽ bấm.
    await page.click('#btnHrpCreateOffboarding');
    await page.waitForTimeout(150);

    // Ảnh 1 — khối "Gán Phụ Trách" hiện đúng nhãn MỚI "(tuỳ chọn)", KHÔNG còn dấu sao đỏ — cả 2 việc
    // bắt buộc đều chưa gán ai.
    await page.evaluate(() => document.getElementById('hrpOffbTaskAssignWrap').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    const headerText = await page.evaluate(() => document.getElementById('hrpOffbTaskAssignWrap').querySelector('p').textContent);
    console.log(`\n01: Nhãn khối "Gán Phụ Trách" ở form Offboarding: "${headerText}"`);
    assert(!headerText.includes('*') && headerText.includes('tuỳ chọn'), 'LỖI: nhãn phải là "(tuỳ chọn)", không còn dấu sao bắt buộc');
    await shot(page, '1-form-offboarding-gan-phu-trach-tuy-chon');

    // Chọn nhân viên nghỉ việc (gõ-và-chọn THẬT qua ô sdd, đúng format "Tên — Phòng ban (username)" mà
    // populateSystemUsersDatalist() sinh ra) + điền Ngày Nghỉ Việc — 2 trường BẮT BUỘC duy nhất còn lại.
    await page.evaluate((emp) => {
      const input = document.getElementById('hrpOffbEmployeeInput');
      input.value = `${emp.name} — ${emp.dept} (${emp.username})`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, EMP);
    await page.fill('#hrpOffbLastWorkingDate', '2026-11-20');
    await page.waitForTimeout(100);

    const submitEnabled = await page.evaluate(() => !document.getElementById('btnSubmitHrpOffboarding').disabled);
    assert(submitEnabled, 'LỖI: nút "Tạo Quy Trình" phải BẬT sau khi đã điền Nhân Viên + Ngày Nghỉ Việc, dù CHƯA gán Phụ Trách cho 2 việc bắt buộc');

    // Ảnh 2 — form đã điền đủ Nhân Viên + Ngày Nghỉ Việc, khối "Gán Phụ Trách" VẪN để trống hoàn toàn,
    // nút "Tạo Quy Trình" đã BẬT (không bị khoá).
    await page.evaluate(() => document.getElementById('hrpOffboardingForm').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(100);
    await shot(page, '2-da-dien-nhan-vien-ngay-nghi-chua-gan-phu-trach-nut-da-bat');

    // Bấm THẬT nút submit — xác nhận quy trình TẠO THÀNH CÔNG (trước đây sẽ bị chặn 400 "Vui lòng gán
    // Phụ Trách cho các việc bắt buộc..."). alert() thành công bị chặn lại qua __resetCapture() của
    // testHarness (xem window.alert stub) — đọc lại qua __getAlerts().
    await run.run('Bấm THẬT "🔒 Tạo Quy Trình" khi CHƯA gán Phụ Trách cho bất kỳ việc bắt buộc nào -> tạo THÀNH CÔNG (không còn bị chặn)', async () => {
      await page.click('#btnSubmitHrpOffboarding');
      await page.waitForTimeout(200);
      const alerts = await page.evaluate(() => window.__alerts || []);
      const lastAlert = alerts[alerts.length - 1] || '';
      assert(lastAlert.includes('✅ Đã tạo quy trình Offboarding'), `Phải báo tạo THÀNH CÔNG, không phải lỗi chặn — alert cuối: "${lastAlert}"`);
      const created = await page.evaluate(() => (DB.hrProcesses || []).find(p => p.employeeUsername === 'nv.gaprut'));
      assert(created, 'Quy trình Offboarding phải thực sự được tạo trong DB.hrProcesses');
      assert.strictEqual(created.status, 'IN_PROGRESS', 'Quy trình mới tạo phải ở trạng thái Đang thực hiện');
      assert(created.tasks.every(t => !t.assignedToUsername), '2 việc bắt buộc đều CHƯA có người phụ trách — đúng kịch bản để trống lúc tạo');
    });

    // Ảnh 3 — màn Danh Sách Quy Trình: quy trình Offboarding của "Phạm Văn Gấp Rút" đã xuất hiện,
    // "Đang thực hiện", chứng minh KHÔNG hề bị chặn tạo dù chưa gán Phụ Trách.
    await page.waitForTimeout(150);
    await shot(page, '3-quy-trinh-offboarding-da-tao-thanh-cong-trong-danh-sach');

    console.log(`\n✅ Demo hoàn tất — ảnh lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
