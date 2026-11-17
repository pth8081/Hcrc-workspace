// server/tests/test-hr-username-mapping-bulk-create-multigroup.js
//
// Regression test (Playwright, testHarness.js) cho "🆕 Tạo Tài Khoản Cho N Hồ Sơ" ở màn "🆔 Mã NV ↔ Tài
// Khoản" (module-hethong-tabs.js) — theo yêu cầu TRỰC TIẾP người dùng: "phân quyền càn theo kiểu
// dropdown + searchable + multi choice để add nhiều group một lúc". Trước đây ô "Nhóm Phân Quyền Áp
// Dụng Cho Tài Khoản Mới" là <select> ĐƠN (#umapGroupSelect), chỉ gán được ĐÚNG 1 nhóm dù backend
// (routes/hrUsernameMapping.js POST /bulk-create-accounts, lib/hrUsernameMapping.js
// prepareBulkCreateAccounts()) đã hỗ trợ sẵn groupIds[] dạng MẢNG từ trước.
//
// FIX: đổi sang renderMultiSelectDropdown() dùng chung (#umapGroupMultiSelect) + getMultiSelectValues()
// đọc lại lúc Lưu — gán được NHIỀU nhóm cùng lúc, perms tạo ra là HỢP (OR) của tất cả nhóm đã chọn.
//
// Chạy: node server/tests/test-hr-username-mapping-bulk-create-multigroup.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8998;

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true, totpEnabled: true };

function buildState() {
  return createMockState({
    depts: ['Phòng Kế Toán'],
    stores: ['Siêu thị BRGMart Moonlight'],
    storeJobTitles: [{ label: 'Nhân viên Bán hàng' }],
    jobTitles: ['Nhân viên'],
    users: [ADMIN],
    // 2 nhóm quyền KHÔNG giao nhau — xác nhận perms tạo ra là HỢP (OR) của CẢ 2, không phải chỉ 1.
    permGroups: [
      { id: 'grp_a', name: 'Nhóm A — Xem Đơn Hàng', perms: { operationOrderView: true } },
      { id: 'grp_b', name: 'Nhóm B — Duyệt Giấy Phép', perms: { licenseApprove: true } }
    ],
    hrProcesses: [{ id: 1, processType: 'ONBOARDING', employeeCode: 'BL9100', fullName: 'Nguyễn Văn Test' }],
    employeeProfiles: [{
      employeeCode: 'BL9100', processId: 1, status: 'ACTIVE', onboardingQueueStatus: 'CONFIRMED',
      dept: 'Siêu thị BRGMart Moonlight', jobTitle: 'Nhân viên Bán hàng', posType: 'STORE', username: null,
      contactPhone: '0911111111', workEmail: null, personalEmail: null, updatedAt: new Date().toISOString()
    }]
  });
}

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const server = await startStaticServer(PORT);
  let failures = 0;
  const check = (label, cond, detail) => {
    if (cond) { console.log(`PASS: ${label}`); } else { console.log(`FAIL: ${label}${detail ? '\n  -> ' + detail : ''}`); failures++; }
  };

  const state = buildState();
  const { browser, page } = await launchPage(PORT, state);
  try {
    await loginAs(page, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('USERNAMEMAP'); });
    await page.waitForTimeout(200);

    // Chọn đúng 1 hồ sơ "Chưa có tài khoản" rồi mở modal tạo tài khoản.
    await page.evaluate(() => {
      const cb = document.querySelector('#umapTableWrap input[data-arg0="BL9100"]');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('umapBulkCreateBtn').click();
    });
    await page.waitForTimeout(200);

    const widgetState = await page.evaluate(() => ({
      hasOldSelect: !!document.getElementById('umapGroupSelect'),
      hasNewWidget: !!document.getElementById('umapGroupMultiSelect'),
      searchInputExists: !!document.querySelector('#umapGroupMultiSelect [data-pms-search]')
    }));
    check('Đổi đúng sang widget tìm-kiếm-đa-chọn (#umapGroupMultiSelect), KHÔNG còn <select> đơn cũ',
      !widgetState.hasOldSelect && widgetState.hasNewWidget && widgetState.searchInputExists, JSON.stringify(widgetState));

    // Gõ tìm + chọn CẢ 2 nhóm qua đúng thao tác người dùng thật (gõ vào ô tìm kiếm, bấm dòng gợi ý) —
    // không gọi thẳng gmsAdd() để xác nhận luôn cả phần tìm kiếm (searchable) hoạt động đúng.
    await page.evaluate(() => {
      const input = document.querySelector('#umapGroupMultiSelect [data-pms-search]');
      input.value = 'Nhóm A';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(50);
    const matchCountA = await page.evaluate(() => document.querySelectorAll('#umapGroupMultiSelect [data-pms-dropdown] [data-op="gmsAdd"]').length);
    check('Gõ "Nhóm A" -> dropdown CHỈ còn gợi ý đúng 1 nhóm khớp (tìm kiếm hoạt động)', matchCountA === 1, String(matchCountA));
    await page.evaluate(() => document.querySelector('#umapGroupMultiSelect [data-pms-dropdown] [data-op="gmsAdd"]').click());
    await page.evaluate(() => {
      const input = document.querySelector('#umapGroupMultiSelect [data-pms-search]');
      input.value = 'Nhóm B';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => document.querySelector('#umapGroupMultiSelect [data-pms-dropdown] [data-op="gmsAdd"]').click());

    const chipsAfterPick = await page.evaluate(() => [...document.querySelectorAll('#umapGroupMultiSelect [data-pms-chips] span')].map(s => s.textContent.trim()));
    check('Chọn được CẢ 2 nhóm cùng lúc -> hiện đủ 2 chip', chipsAfterPick.length === 2, JSON.stringify(chipsAfterPick));

    await page.evaluate(() => window.__confirmPending());
    await page.waitForTimeout(300);
    const alertMsg = await page.evaluate(() => window.__alerts[window.__alerts.length - 1]);
    check('Tạo tài khoản thành công', /Đã tạo thành công 1 tài khoản: BL9100/.test(alertMsg || ''), alertMsg);

    const reportAfter = await page.evaluate(async () => {
      const res = await fetch('/api/admin/username-mapping');
      return res.json();
    });
    const createdRow = (reportAfter.rows || []).find(r => r.employeeCode === 'BL9100');
    check('Hồ sơ BL9100 đã chuyển sang trạng thái "Đã khớp" (username liên kết thành công)',
      !!createdRow && createdRow.status === 'MATCHED' && createdRow.currentUsername === 'BL9100', JSON.stringify(createdRow));

    // Đọc thẳng state phía Node (CÙNG tham chiếu mock backend đang dùng, xem testHarness.js::launchPage())
    // để xác nhận perms tạo ra là HỢP (OR) của CẢ 2 nhóm đã chọn — không phải chỉ nhóm chọn ĐẦU/CUỐI.
    const createdUser = (state.users || []).find(u => u.username === 'BL9100');
    check('Tài khoản mới được gán ĐÚNG groupIds của cả 2 nhóm đã chọn',
      !!createdUser && Array.isArray(createdUser.groupIds) && createdUser.groupIds.includes('grp_a') && createdUser.groupIds.includes('grp_b'),
      JSON.stringify(createdUser && createdUser.groupIds));
    check('perms tạo ra là HỢP (OR) của CẢ 2 nhóm — có cả operationOrderView (Nhóm A) LẪN licenseApprove (Nhóm B)',
      !!createdUser && createdUser.perms?.operationOrderView === true && createdUser.perms?.licenseApprove === true,
      JSON.stringify(createdUser && createdUser.perms));

    console.log(`\n${failures === 0 ? 'All passed' : failures + ' FAILED'}`);
    process.exitCode = failures ? 1 : 0;
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
