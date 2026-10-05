// server/tests/demo-contract-stuck-fallback-fix-10-2026.js
//
// Demo ảnh cho bản vá Cao #1 (rà soát v24.74→v24.90, 10/2026): setContractSubTab() stuck-fallback —
// chụp lại trạng thái ĐÃ VÁ khi user bị tắt CẢ 2 checkbox Mục 0 contractApproval/contractManage (nhưng
// module Hợp Đồng vẫn mở vì canAccessContractModule() chỉ cần user.dept) — PHẢI thấy màn "Bạn không có
// quyền xem mục này", KHÔNG còn form/danh sách của sub-tab đã bị khoá như trước khi vá.
//
// Chạy: node server/tests/demo-contract-stuck-fallback-fix-10-2026.js
'use strict';
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;
const CONTRACT_USER = {
  username: 'contract_demo', name: 'NV Hợp Đồng (Demo)', dept: 'Vận Hành',
  perms: { moduleAccess: { contractApproval: false, contractManage: false } }
};

async function main() {
  const state = createMockState({ depts: ['Vận Hành'], users: [CONTRACT_USER] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  try {
    await page.evaluate(async (u) => {
      window.__resetCapture();
      await proceedAfterAuth(u);
    }, CONTRACT_USER);
    await page.evaluate(() => { switchTab('contract'); });
    await page.waitForTimeout(150);

    const outDir = path.join(__dirname, '.tmp-assets');
    const shotPath = path.join(outDir, 'demo-contract-stuck-fallback-fixed.png');
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`✅ Đã chụp: ${shotPath}`);

    const state2 = await page.evaluate(() => ({
      active: activeContractSubTab,
      tbodyText: document.getElementById('contractTableBody')?.innerText || '',
      approvalBtnHidden: document.getElementById('btnContractSubApproval')?.classList.contains('hidden'),
      manageBtnHidden: document.getElementById('btnContractSubManage')?.classList.contains('hidden')
    }));
    console.log('activeContractSubTab:', state2.active);
    console.log('Nội dung bảng:', JSON.stringify(state2.tbodyText));
    console.log('2 nút sub-tab đều ẩn (vì cả 2 checkbox đều tắt):', state2.approvalBtnHidden, state2.manageBtnHidden);
    if (state2.active !== null) throw new Error('❌ activeContractSubTab phải null');
    if (!state2.tbodyText.includes('Bạn không có quyền xem mục này')) throw new Error('❌ Thiếu thông báo "không có quyền"');
    console.log('✅ Demo xác nhận: đã vá đúng — không còn lộ form/danh sách sub-tab bị khoá.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
