// server/tests/demo-hr-process-sync-draft-profile-11-2026.js
//
// DEMO thật (Playwright, chụp ảnh — không phải test regression) cho nút "🔄 Đồng Bộ Hồ Sơ Nháp" (11/2026,
// theo yêu cầu người dùng: "4 mã đang xử lý... cho nó thành 4 hồ sơ ở onboarding" — 1 số quy trình
// Onboarding "mồ côi" vẫn "Đang thực hiện" bình thường ở Danh Sách Quy Trình nhưng KHÔNG hiện trong hàng
// đợi "🕐 Hồ Sơ Onboarding" vì hồ sơ Hồ Sơ Nhân Sự Nháp đặt chỗ lúc tạo bị thiếu/mất liên kết).
//
// Kịch bản: tạo 2 quy trình Onboarding (NV0010, NV0011) — NV0011 bị mô phỏng "mồ côi" (xoá tay khỏi
// employeeProfiles, như dữ liệu cũ thật). Chụp TRƯỚC: hàng đợi chỉ thấy NV0010. Bấm "🔄 Đồng Bộ Hồ Sơ
// Nháp" ở quy trình NV0011. Chụp SAU: hàng đợi thấy ĐỦ cả 2.
//
// Dùng chung testHarness.js (mirror ĐÚNG lib/recordActions.js/routes/records.js/routes/employeeProfile.js
// thật) — cùng khuôn demo-hr-process-edit-11-2026.js.
//
// Chạy: node server/tests/demo-hr-process-sync-draft-profile-11-2026.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');
const employeeProfile = require('../lib/employeeProfile');

const PORT = 8996;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'hr-process-sync-draft-profile-11-2026');

const HR1 = { username: 'hr1', name: 'Chuyên Viên Nhân Sự', dept: 'Phòng Nhân Sự', perms: { hrOnboardingManage: true, hrOffboardingManage: true }, active: true };

const ONB_TEMPLATES = [
  { id: 1, processType: 'ONBOARDING', stage: 'FIRST_DAY', taskName: 'Ký hợp đồng lao động', department: 'HR', dueDaysOffset: 0, isRequired: true, displayOrder: 1, isActive: true }
];

const state = createMockState({
  depts: ['Phòng Kế Toán'], stores: [], jobTitles: ['Nhân viên'], storeJobTitles: [],
  users: [HR1], hrTaskTemplates: ONB_TEMPLATES
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function shot(page, name, selector) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  if (selector) await page.locator(selector).screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: false });
  console.log(`📸 ${file}`);
}

function onboardPayload(code, name) {
  return {
    processType: 'ONBOARDING', employeeCode: code, fullName: name,
    employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên',
    email: '', phone: '0911111111', startDate: '2026-12-01', note: ''
  };
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });

  try {
    await loginAs(page, HR1);

    const p10 = await page.evaluate(async (payload) => {
      const result = await callCreateAction('hrProcesses', payload);
      DB.hrProcesses = DB.hrProcesses || [];
      DB.hrProcesses.unshift(result.item);
      return result.item;
    }, onboardPayload('NV0010', 'Bùi Văn Mười'));

    const p11 = await page.evaluate(async (payload) => {
      const result = await callCreateAction('hrProcesses', payload);
      DB.hrProcesses.unshift(result.item);
      return result.item;
    }, onboardPayload('NV0011', 'Cao Thị Mười Một'));

    // testHarness.js mock mirror đúng validateAndPrepareCreate() THUẦN cho "/api/create/:moduleKey" —
    // KHÔNG mirror thêm withLockedAppDataValue('employeeProfiles', ...) thật (cần SQL Server thật, không
    // chạy được trong sandbox) mà createOnboardingProcessRecord() gọi để tự tạo hồ sơ Nháp lúc tạo quy
    // trình thật (routes/create.js). Nghĩa là CẢ 2 quy trình vừa tạo ở mock này đều "mồ côi" mặc định —
    // ĐÚNG kịch bản cần demo. Giả lập NGAY cho NV0010 1 hồ sơ Nháp đã liên kết sẵn (trường hợp bình
    // thường, đối chứng với NV0011 cố tình để "mồ côi") bằng ĐÚNG hàm thật tạo hồ sơ Nháp.
    state.employeeProfiles = state.employeeProfiles || [];
    const p10Profile = employeeProfile.createDraftProfileForOnboarding('NV0010', 'hr1', 'Chuyên Viên Nhân Sự');
    p10Profile.processId = p10.id;
    p10Profile.onboardingQueueStatus = 'PENDING';
    state.employeeProfiles.push(p10Profile);
    console.log('Trước khi đồng bộ — employeeProfiles trong hàng đợi:', state.employeeProfiles.map(p => p.employeeCode));

    // ===== Ảnh 1: Hàng đợi "🕐 Hồ Sơ Onboarding" TRƯỚC khi đồng bộ — chỉ thấy NV0010, THIẾU NV0011 =====
    await page.evaluate(() => { switchTab('hrProfile'); setHrProfileView('ONBOARDING_QUEUE'); });
    await page.waitForTimeout(200);
    await shot(page, '1-hang-doi-truoc-khi-dong-bo-thieu-nv0011');
    const queueBeforeHtml = await page.evaluate(() => document.getElementById('hrpfViewOnboardingQueue').innerText);
    if (queueBeforeHtml.includes('NV0011')) throw new Error('Demo lỗi: NV0011 KHÔNG được xuất hiện ở bước này (phải mô phỏng "mồ côi" thành công)');
    if (!queueBeforeHtml.includes('NV0010')) throw new Error('Demo lỗi: NV0010 phải xuất hiện bình thường ở bước này');
    console.log('✅ Xác nhận: hàng đợi TRƯỚC khi đồng bộ chỉ có NV0010, thiếu NV0011 (đúng kịch bản "mồ côi")');

    // ===== Ảnh 2: Chi Tiết Quy Trình NV0011 — thấy nút "🔄 Đồng Bộ Hồ Sơ Nháp" =====
    await page.evaluate((id) => { switchTab('hrLifecycle'); setHrLifecycleView('LIST'); openHrProcessDetail(id); }, p11.id);
    await page.waitForSelector('#hrpDetailModal:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(150);
    await shot(page, '2-chi-tiet-quy-trinh-nv0011-truoc-khi-bam-nut', '#hrpDetailModal .max-w-4xl');

    // ===== Bấm "🔄 Đồng Bộ Hồ Sơ Nháp" =====
    await page.click('button[data-op="hrpSyncDraftProfile"]');
    await page.waitForFunction(() => window.__alerts.length > 0, null, { timeout: 5000 });
    const alertMsg = await page.evaluate(() => window.__alerts.slice(-1)[0]);
    console.log('Thông báo sau khi bấm:', alertMsg);
    if (!alertMsg.includes('Đã đồng bộ lại hồ sơ Nháp')) throw new Error('Demo lỗi: không nhận được thông báo thành công như mong đợi');
    // alert() chặn JS tới khi evaluate() đọc xong window.__alerts — chụp lại NGAY sau khi biết chắc đã xử lý xong.
    await shot(page, '3-sau-khi-bam-dong-bo-thanh-cong', '#hrpDetailModal .max-w-4xl');

    // ===== Ảnh 4: Hàng đợi "🕐 Hồ Sơ Onboarding" SAU khi đồng bộ — ĐỦ cả NV0010 lẫn NV0011 =====
    await page.evaluate(() => { closeHrProcessDetail(); switchTab('hrProfile'); setHrProfileView('ONBOARDING_QUEUE'); });
    await page.waitForTimeout(200);
    await shot(page, '4-hang-doi-sau-khi-dong-bo-du-ca-2');
    const queueAfterHtml = await page.evaluate(() => document.getElementById('hrpfViewOnboardingQueue').innerText);
    if (!queueAfterHtml.includes('NV0010') || !queueAfterHtml.includes('NV0011')) {
      throw new Error('Demo lỗi: hàng đợi SAU khi đồng bộ phải thấy ĐỦ cả NV0010 lẫn NV0011');
    }
    console.log('✅ Xác nhận: hàng đợi SAU khi đồng bộ đã thấy ĐỦ cả NV0010 lẫn NV0011');

    console.log(`\n✅ Demo hoàn tất — ảnh lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
