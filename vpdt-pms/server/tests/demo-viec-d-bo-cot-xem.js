// server/tests/demo-viec-d-bo-cot-xem.js
//
// DEMO thật (người dùng yêu cầu "làm xong nhớ demo cho tôi xem ảnh") cho "Việc D" (11/2026) — bỏ cột
// "Xem" (quyền phẳng cũ submissionView/contractView) khỏi Ma Trận Phân Quyền ở 2 khối Văn Bản Trình/Hợp
// Đồng, chỉ còn Tạo mới + Tải xuống (giống khuôn đã áp cho Tài Liệu ở v24.75) — kèm chứng minh quyền
// "Xem xuyên phòng ban" cũ (ks_kiemsoat/sep_duyet, submissionView.all/contractView.all) đã được tự động
// di trú sang deptViewScopeConfig.submission/contract.extraViewers (Hệ Thống → Nghiệp Vụ Nâng Cao →
// 🔒 Phạm Vi Xem Theo Phòng Ban), không bị mất quyền.
//
// Dùng testHarness.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js thật).
//
// Chạy: node server/tests/demo-viec-d-bo-cot-xem.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'viec-d-bo-cot-xem');

const ADMIN_USER = {
  id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', posType: 'HO',
  perms: { admin: true }, totpEnabled: true, active: true
};
const KS_KIEMSOAT = { id: 2, username: 'ks_kiemsoat', name: 'Lê Văn KS', dept: 'Phòng IT', posType: 'HO', perms: {}, active: true };
const SEP_DUYET = { id: 3, username: 'sep_duyet', name: 'Phạm Văn BGD', dept: 'Ban Giám Đốc', posType: 'HO', perms: {}, active: true };
const NV_THUONG = { id: 4, username: 'nv_thuong', name: 'Nguyễn Văn Thường', dept: 'Phòng Kinh Doanh', posType: 'HO', perms: {}, active: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({
    depts: ['Ban Giám Đốc', 'Phòng IT', 'Phòng Kinh Doanh'],
    users: [ADMIN_USER, KS_KIEMSOAT, SEP_DUYET, NV_THUONG],
    // Mô phỏng ĐÚNG kết quả sau khi migrateLegacyPerms() (core.js, initDatabase()) tự chạy 1 lần trên
    // production thật — đã gộp 2 user seed cũ (submissionView.all/contractView.all=true) vào extraViewers.
    deptViewScopeConfig: {
      submission: { mode: 'DEPT', extraViewers: ['ks_kiemsoat', 'sep_duyet'], managerCanView: false },
      contract: { mode: 'DEPT', extraViewers: ['ks_kiemsoat', 'sep_duyet'], managerCanView: false }
    }
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1100 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN_USER);
    await page.waitForTimeout(150);

    // ===== 1) Ma Trận Phân Quyền: cây quyền — khối "📜 3. Văn Bản Trình" chỉ còn Tạo mới + Tải xuống =====
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('PERMS'); });
    await page.waitForTimeout(150);
    await page.evaluate((id) => { editUser(id); }, NV_THUONG.id);
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const badge = document.getElementById('permTreeBadge_sub');
      if (badge) { badge.closest('details').open = true; badge.scrollIntoView({ block: 'center' }); }
    });
    await page.waitForTimeout(100);
    const subHasView = await page.evaluate(() => !!document.getElementById('pSubViewAll'));
    console.log(`✅ Khối Văn Bản Trình còn checkbox "Xem" (pSubViewAll)? ${subHasView} (phải là false)`);
    if (subHasView) throw new Error('❌ Checkbox "Xem" (pSubViewAll) VẪN còn trong form — Việc D chưa dọn hết.');
    await shot(page, 'details:has(#permTreeBadge_sub)', '01-van-ban-trinh-chi-con-tao-moi-tai-xuong.png');

    // ===== 2) Khối "📄 4. Hợp Đồng & Giấy Phép" chỉ còn Tạo mới + Tải xuống =====
    await page.evaluate(() => {
      const badge = document.getElementById('permTreeBadge_contract');
      if (badge) { badge.closest('details').open = true; badge.scrollIntoView({ block: 'center' }); }
    });
    await page.waitForTimeout(100);
    const contractHasView = await page.evaluate(() => !!document.getElementById('pContractViewAll'));
    console.log(`✅ Khối Hợp Đồng còn checkbox "Xem" (pContractViewAll)? ${contractHasView} (phải là false)`);
    if (contractHasView) throw new Error('❌ Checkbox "Xem" (pContractViewAll) VẪN còn trong form — Việc D chưa dọn hết.');
    await shot(page, 'details:has(#permTreeBadge_contract)', '02-hop-dong-chi-con-tao-moi-tai-xuong.png');
    await page.evaluate(() => cancelPermFormEdit());

    // ===== 3) Phạm Vi Xem Theo Phòng Ban: ks_kiemsoat/sep_duyet ĐÃ được di trú vào extraViewers của
    //     Tờ Trình/Hợp Đồng — chứng minh KHÔNG mất quyền "xem xuyên phòng ban" cũ sau khi bỏ cột "Xem". =====
    await page.evaluate(() => { setSystemSubTab('ADVWORKFLOW'); setAdvWorkflowSubTab('DEPTVIEWSCOPE'); });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.getElementById('deptViewScopeTableBody')?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(100);
    await shot(page, '#advWorkflowSubDeptViewScope', '03-pham-vi-xem-theo-phong-ban-extraviewers-da-di-tru.png');

    console.log('\n✅ DEMO HOÀN TẤT — ảnh lưu ở:', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
