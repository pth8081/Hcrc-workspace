// Demo script (KHÔNG phải regression test) — chụp ảnh 2 màn hình Onboarding/Offboarding trong module
// "Nhân Sự > Onboarding / Offboarding" để gửi cho người dùng xem trực quan, bao gồm trường "Ngày Nghỉ
// Việc" vừa thêm vào form Offboarding. Dùng chung testHarness.js (mirror đúng luật nghiệp vụ thật).
// Chạy: node server/tests/demo-hr-lifecycle-screenshot.js
const { startStaticServer, createMockState, launchPage } = require('./testHarness');
const path = require('path');

const PORT = 8987;
const OUT_DIR = '/tmp/claude-0/-home-user-vpdt-dms/92486df7-a010-5b7a-a5ae-6b624f39c073/scratchpad';

const HR1 = { username: 'hr1', name: 'Chuyên Viên Nhân Sự', dept: 'Phòng Nhân Sự', perms: { hrOnboardingCreate: true, hrOffboardingCreate: true }, active: true };
const EMP = { username: 'nv.ketoan', name: 'Nguyễn Văn Kế Toán', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', email: 'ketoan@company.com', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

const state = createMockState({
  depts: ['Phòng Nhân Sự', 'Phòng CNTT', 'Phòng Kế Toán', 'Ban Giám Đốc'],
  stores: ['Siêu Thị A'],
  jobTitles: ['Nhân viên', 'Chuyên viên'],
  storeJobTitles: [{ label: 'Nhân viên bán hàng' }],
  users: [HR1, EMP, ADMIN]
});

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, HR1);
    await page.evaluate(() => { switchTab('hrLifecycle'); setHrLifecycleSubTab('ONBOARD'); });

    // Điền sẵn 1 vài field cho form Onboarding để demo trực quan hơn (không submit).
    await page.fill('#hrOnbEmployeeCode', 'NV0099');
    await page.fill('#hrOnbFullName', 'Trần Thị Mới');
    await page.selectOption('#hrOnbPosType', 'STORE');
    await page.waitForTimeout(150);
    await page.fill('#hrOnbEmail', 'tranthimoi@hcrc.vn');
    await page.fill('#hrOnbPhone', '0987654321');
    await page.fill('#hrOnbStartDate', '2026-09-15');
    await page.screenshot({ path: path.join(OUT_DIR, 'demo-onboarding.png'), fullPage: true });
    console.log('Saved demo-onboarding.png');

    await page.evaluate(() => { setHrLifecycleSubTab('OFFBOARD'); });
    // Gõ + chọn nhân viên qua ô sdd (giống thao tác thật của người dùng).
    await page.fill('#hrOffbEmployeeInput', 'Kế Toán');
    await page.waitForTimeout(150);
    await page.evaluate(() => { resolveHrOffboardingEmployeeInput('Nguyễn Văn Kế Toán — Phòng Kế Toán (nv.ketoan)'); });
    await page.fill('#hrOffbLastWorkingDate', '2026-09-30');
    await page.check('#hrOffbChecklistHandover');
    await page.check('#hrOffbChecklistBenefits');
    await page.fill('#hrOffbReason', 'Nghỉ việc theo nguyện vọng cá nhân');
    await page.screenshot({ path: path.join(OUT_DIR, 'demo-offboarding.png'), fullPage: true });
    console.log('Saved demo-offboarding.png');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
