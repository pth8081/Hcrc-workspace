// server/tests/test-deptviewscope-migration.js
//
// Regression test cho LỖI ĐÃ VÁ (rà soát v24.74→v24.81, 11/2026, mức Cao — cấp thừa quyền xem xuyên công
// ty) ở migration tự động trong initDatabase() (public/js/core.js, đợt "Việc D" v24.80): migration này gộp
// MỌI user có quyền phẳng CŨ submissionView/contractView.all/.depts vào deptViewScopeConfig.submission/
// contract.extraViewers (xem toàn công ty) để không mất quyền khi bỏ 2 quyền phẳng đó. TRƯỚC KHI VÁ: bất
// kỳ `.depts` không rỗng nào (kể cả khi TOÀN BỘ depts chỉ trùng đúng phòng ban hiện tại của chính user đó
// — hoàn toàn dư thừa, vì mode DEPT mặc định đã tự cho xem đúng phòng mình) cũng bị coi là "cần di trú",
// vô tình cấp THÊM quyền xem xuyên công ty mà user đó CHƯA TỪNG có thật sự. SAU KHI VÁ: chỉ di trú khi
// `.depts` có ít nhất 1 phòng ban KHÁC phòng ban hiện tại của chính user.
//
// Chạy: node server/tests/test-deptviewscope-migration.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT = 8986;

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, totpEnabled: true, active: true };
// Case 1 (KHÔNG được di trú): .depts CHỈ trùng đúng phòng ban hiện tại của chính user -> hoàn toàn dư
// thừa, mode DEPT mặc định đã tự cho xem đúng phòng mình rồi.
const REDUNDANT_USER = { username: 'nv_du_thua', name: 'NV Dư Thừa', dept: 'Phòng Nhân Sự', perms: { submissionView: { depts: ['Phòng Nhân Sự'] } }, active: true };
// Case 2 (PHẢI được di trú): .depts có phòng ban KHÁC phòng ban hiện tại -> tín hiệu thật "từng được cấp
// xem phòng ban khác", phải giữ quyền tương đương qua extraViewers.
const CROSS_DEPT_USER = { username: 'nv_xem_cheo', name: 'NV Xem Chéo', dept: 'Phòng Kế Toán', perms: { contractView: { depts: ['Phòng Kế Toán', 'Phòng Kinh Doanh'] } }, active: true };
// Case 3 (PHẢI được di trú): .all=true -> luôn là tín hiệu thật, bất kể phòng ban hiện tại.
const ALL_VIEW_USER = { username: 'nv_xem_het', name: 'NV Xem Hết', dept: 'Phòng IT', perms: { submissionView: { all: true } }, active: true };

const state = createMockState({
  depts: ['Ban Giám Đốc', 'Phòng Nhân Sự', 'Phòng Kế Toán', 'Phòng Kinh Doanh', 'Phòng IT'],
  users: [ADMIN, REDUNDANT_USER, CROSS_DEPT_USER, ALL_VIEW_USER]
});

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err && err.stack || String(err)));

  try {
    await run.run('Migration deptViewScopeConfig: user .depts CHỈ trùng đúng phòng ban mình (dư thừa) -> KHÔNG được thêm vào extraViewers', async () => {
      const s = await page.evaluate(async (u) => {
        window.__resetCapture();
        await proceedAfterAuth(u);
        return {
          submissionExtraViewers: DB.deptViewScopeConfig?.submission?.extraViewers || [],
          contractExtraViewers: DB.deptViewScopeConfig?.contract?.extraViewers || []
        };
      }, ADMIN);
      assertEqual(s.submissionExtraViewers.includes('nv_du_thua'), false,
        'User chỉ có submissionView.depts=[đúng phòng mình] KHÔNG được cấp thừa quyền xem xuyên công ty');
    });

    await run.run('Migration deptViewScopeConfig: user .depts có phòng ban KHÁC phòng mình -> PHẢI được thêm vào extraViewers', async () => {
      const s = await page.evaluate(async (u) => {
        window.__resetCapture();
        await proceedAfterAuth(u);
        return { contractExtraViewers: DB.deptViewScopeConfig?.contract?.extraViewers || [] };
      }, ADMIN);
      assertEqual(s.contractExtraViewers.includes('nv_xem_cheo'), true,
        'User có contractView.depts chứa phòng ban KHÁC phòng mình PHẢI được giữ quyền qua extraViewers');
    });

    await run.run('Migration deptViewScopeConfig: user .all=true -> PHẢI được thêm vào extraViewers (bất kể phòng ban hiện tại)', async () => {
      const s = await page.evaluate(async (u) => {
        window.__resetCapture();
        await proceedAfterAuth(u);
        return { submissionExtraViewers: DB.deptViewScopeConfig?.submission?.extraViewers || [] };
      }, ADMIN);
      assertEqual(s.submissionExtraViewers.includes('nv_xem_het'), true,
        'User có submissionView.all=true PHẢI được giữ quyền qua extraViewers');
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
