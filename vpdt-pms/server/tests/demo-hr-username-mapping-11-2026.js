// server/tests/demo-hr-username-mapping-11-2026.js
//
// DEMO thật (Playwright, chụp ảnh — không phải test regression) cho "🆔 Mã NV ↔ Tài Khoản" (v30.69),
// dựng lại ĐÚNG kịch bản người dùng báo cáo (ảnh Hồ Sơ Nhân Sự: BL3883/BL3884/BL3885 "Đang làm việc"
// nhưng Tài Khoản VPDT "Chưa liên kết") để xác nhận màn Mã NV ↔ Tài Khoản có tự đưa đúng 3 hồ sơ này vào
// nhóm "❌ Chưa có tài khoản" hay không, và demo trọn luồng chọn + tạo hàng loạt.
//
// (11/2026, mở rộng) thêm 1 hồ sơ "BL 3900" (employeeCode dính khoảng trắng) + 1 tài khoản mồ côi
// "BL 4000" (username dính khoảng trắng, không liên kết hồ sơ nào) để demo khối "🧹 Khoảng Trắng Dư
// Thừa" — quét READ-ONLY dữ liệu CŨ đã lỡ dính khoảng trắng (bản vá Nhập Excel chỉ chặn phát sinh MỚI).
//
// Chạy: node server/tests/demo-hr-username-mapping-11-2026.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'hr-username-mapping-11-2026');

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true, totpEnabled: true };
// NV0010: user ĐÃ CÓ sẵn, username === employeeCode -> MATCHED (đối chứng nhóm đã khớp).
const NV0010_USER = { username: 'NV0010', name: 'Phạm Văn An', dept: 'Phòng Kế Toán', perms: {}, active: true };
// NV0099: user ĐÃ CÓ nhưng username KHÁC employeeCode (dữ liệu cũ) -> MISMATCH.
const NV0099_USER = { username: 'nv99cu', name: 'Đỗ Thị Mai', dept: 'Phòng Kế Toán', perms: {}, active: true };
// BL 4000: tài khoản MỒ CÔI (không liên kết hồ sơ nào) nhưng username dính khoảng trắng dư thừa.
const ORPHAN_WHITESPACE_USER = { username: 'BL 4000', name: 'Tài Khoản Dính Khoảng Trắng', dept: 'Phòng Kế Toán', perms: {}, active: true };

function hrProcess(id, employeeCode, fullName) {
  return { id, processType: 'ONBOARDING', employeeCode, fullName, status: 'IN_PROGRESS' };
}

function profile({ employeeCode, processId, dept, jobTitle, posType, username, contactPhone, personalEmail }) {
  return {
    employeeCode, processId, status: 'ACTIVE', onboardingQueueStatus: 'CONFIRMED',
    dept, jobTitle, posType: posType || 'STORE', username: username || null,
    contactPhone: contactPhone || null, workEmail: null, personalEmail: personalEmail || null,
    updatedAt: new Date().toISOString()
  };
}

const state = createMockState({
  depts: ['Phòng Kế Toán', 'Phòng IT'],
  stores: ['Siêu thị BRGMart Moonlight', 'Siêu thị Hải Dương', 'Siêu thị số 390 Nguyễn Văn Cử'],
  storeJobTitles: [{ label: 'Nhân viên Bán hàng' }, { label: 'Nhân viên An ninh' }],
  jobTitles: ['Nhân viên'],
  users: [ADMIN, NV0010_USER, NV0099_USER, ORPHAN_WHITESPACE_USER],
  permGroups: [{ id: 'grp_banhang', name: 'Nhân Viên Bán Hàng Siêu Thị', perms: { operationOrderView: true } }],
  hrProcesses: [
    hrProcess(1, 'BL3884', 'Trần Thị Huyền'),
    hrProcess(2, 'BL3885', 'Bùi Hữu Phong'),
    hrProcess(3, 'BL3883', 'Lò Thị Chử'),
    hrProcess(4, 'NV0010', 'Phạm Văn An'),
    hrProcess(5, 'NV0099', 'Đỗ Thị Mai'),
    hrProcess(6, 'BL 3900', 'Vũ Thị Năm')
  ],
  employeeProfiles: [
    // Đúng 3 hồ sơ trong ảnh người dùng báo cáo — "Đang làm việc" (ACTIVE) nhưng CHƯA liên kết tài khoản.
    profile({ employeeCode: 'BL3884', processId: 1, dept: 'Siêu thị BRGMart Moonlight', jobTitle: 'Nhân viên Bán hàng', contactPhone: '0911222884', personalEmail: 'huyen.tt@gmail.com' }),
    profile({ employeeCode: 'BL3885', processId: 2, dept: 'Siêu thị Hải Dương', jobTitle: 'Nhân viên An ninh', contactPhone: '0911222885' }),
    profile({ employeeCode: 'BL3883', processId: 3, dept: 'Siêu thị số 390 Nguyễn Văn Cử', jobTitle: 'Nhân viên Bán hàng', contactPhone: '0911222883' }),
    // Đối chứng: 1 hồ sơ ĐÃ khớp, 1 hồ sơ lệch mã (dữ liệu cũ).
    profile({ employeeCode: 'NV0010', processId: 4, dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', posType: 'HO', username: 'NV0010' }),
    profile({ employeeCode: 'NV0099', processId: 5, dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', posType: 'HO', username: 'nv99cu' }),
    // Dữ liệu CŨ dính khoảng trắng (từ trước bản vá Nhập Excel) — "BL 3900" (đáng lẽ là "BL3900").
    profile({ employeeCode: 'BL 3900', processId: 6, dept: 'Siêu thị Hải Dương', jobTitle: 'Nhân viên Bán hàng' })
  ]
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

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 950 });

  await loginAs(page, ADMIN);
  await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('USERNAMEMAP'); });
  await page.waitForTimeout(300);

  // Ảnh 1: màn vừa mở — 4 thẻ thống kê + bảng mặc định "Chỉ hiện vấn đề" PHẢI thấy đúng BL3884/BL3885/
  // BL3883 (nhóm ❌ Chưa có tài khoản) + NV0099 (nhóm ⚠️ Lệch mã), KHÔNG thấy NV0010 (✅ Đã khớp, bị lọc).
  await shot(page, '1-bao-cao-ban-dau', '#adminSubUsernameMap');

  const stats = await page.evaluate(() => ({
    total: document.getElementById('umapStatTotal').innerText,
    matched: document.getElementById('umapStatMatched').innerText,
    mismatch: document.getElementById('umapStatMismatch').innerText,
    missing: document.getElementById('umapStatMissing').innerText,
    rowsShown: [...document.querySelectorAll('#umapTableWrap tbody tr td:nth-child(2)')].map(td => td.innerText)
  }));
  console.log('📊 Thống kê:', stats);
  console.log(stats.rowsShown.includes('BL3884') && stats.rowsShown.includes('BL3885') && stats.rowsShown.includes('BL3883')
    ? '✅ XÁC NHẬN: cả 3 Mã NV trong ảnh người dùng báo cáo ĐỀU hiện đúng ở nhóm "❌ Chưa có tài khoản".'
    : '⛔ KHÔNG thấy đủ 3 Mã NV — cần điều tra thêm.');

  // Tick ĐÚNG 3 checkbox trong ảnh người dùng báo cáo — CỐ Ý bỏ qua "BL 3900" (hồ sơ dính khoảng trắng
  // cũ) để minh hoạ rằng Admin tự quyết định dòng nào tạo tài khoản ngay, dòng nào cần rà soát trước.
  await page.evaluate(() => {
    ['BL3883', 'BL3884', 'BL3885'].forEach(code => {
      const cb = document.querySelector(`#umapTableWrap input[data-arg0="${code}"]`);
      if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  });
  await page.waitForTimeout(150);
  await shot(page, '2-da-chon-3-ho-so', '#adminSubUsernameMap');

  // Bấm "🆕 Tạo Tài Khoản Cho Mục Đã Chọn" -> mở modal xác nhận.
  await page.evaluate(() => document.getElementById('umapBulkCreateBtn').click());
  await page.waitForTimeout(250);
  await shot(page, '3-modal-xac-nhan-tao-tai-khoan', '#genericConfirmModal');

  // Chọn Nhóm Phân Quyền cho cả lượt.
  await page.evaluate(() => {
    const sel = document.getElementById('umapGroupSelect');
    sel.value = 'grp_banhang';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await shot(page, '4-modal-da-chon-nhom-phan-quyen', '#genericConfirmModal');

  // Xác nhận tạo.
  await page.evaluate(() => window.__confirmPending());
  await page.waitForTimeout(300);
  const alertMsg = await page.evaluate(() => window.__alerts[window.__alerts.length - 1]);
  console.log('💬 Thông báo kết quả:', alertMsg);
  await shot(page, '5-ket-qua-sau-khi-tao', '#adminSubUsernameMap');

  const afterStats = await page.evaluate(() => ({
    matched: document.getElementById('umapStatMatched').innerText,
    missing: document.getElementById('umapStatMissing').innerText
  }));
  console.log('📊 Thống kê sau khi tạo:', afterStats);

  await browser.close();
  server.close();
  console.log('✅ Demo xong.');
}

main().catch(err => { console.error(err); process.exit(1); });
