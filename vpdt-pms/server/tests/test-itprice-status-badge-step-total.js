// server/tests/test-itprice-status-badge-step-total.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng phát hiện qua ảnh chụp "HCRC-MHF-ITPG-BL-005" — modal hiện "QUY TRÌNH
// PHÊ DUYỆT" ĐỦ 2 bước (Bước 1: Phê duyệt + Bước 2: Giám đốc CUNB) nhưng dòng "Trạng thái" tổng kết ở
// trên lại hiện "⏳ BƯỚC 0/1" — SAI, phải là 0/2): itPriceStatusBadge() (module-itsupport-price.js)
// trước đây tính tổng số bước bằng cách tra LẠI base workflow thô qua
// DB.workflows.find(wfConfig.workflowId) — bỏ mất lớp "Nhóm Phê Duyệt Cuối" (extraApprovalLayers, đông
// cứng trên CHÍNH hồ sơ lúc tạo) mà resolveItPriceWorkflowConfigForItemClient() đã cộng sẵn vào
// wfConfig.steps. Đã sửa: dùng THẲNG wfConfig.steps (đã đúng).
//
// Test bằng browser thật (testHarness.js), gọi ĐÚNG hàm itPriceStatusBadge() production — không mô
// phỏng lại logic.
//
// Chạy: node server/tests/test-itprice-status-badge-step-total.js
'use strict';
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`PASS: ${name}`); passed++; }
  else { console.log(`FAIL: ${name}${detail ? ` -> ${detail}` : ''}`); failed++; }
}

const USER = { username: 'demo_user', name: 'Người Dùng Demo', dept: 'Phòng Mua hàng FMCG', perms: {}, active: true };

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

(async () => {
  const state = createMockState({
    depts: ['Phòng Mua hàng FMCG'],
    users: [USER],
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Phê duyệt' }] }],
    // Dept workflow GỐC chỉ 1 bước — đúng kịch bản báo cáo: lớp "Giám đốc CUNB" là lớp CỘNG THÊM
    // (extraApprovalLayers trên hồ sơ), KHÔNG nằm trong workflow gốc.
    itPriceDeptWorkflows: { 'Phòng Mua hàng FMCG': { workflowId: 'WF_1STEP', approvers: { 1: ['truong_phong1'] } } }
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await loginAs(page, USER);

    // Hồ sơ PENDING, bước 1 (chưa ai duyệt), CÓ lớp phê duyệt thêm "Giám đốc CUNB" — đúng kịch bản ảnh
    // chụp người dùng gửi (HCRC-MHF-ITPG-BL-005: Bước 1 Phê duyệt + Bước 2 Giám đốc CUNB).
    const itemWithExtraLayer = {
      id: 1, code: 'HCRC-MHF-ITPG-BL-005', priceType: 'RETAIL', dept: 'Phòng Mua hàng FMCG',
      creator: 'demo_user', creatorName: 'Nguyễn Lê Huân', status: 'PENDING', currentStep: 1,
      history: [], infoRequests: [], applied: false, files: [],
      extraApprovalLayers: [
        { layerKey: 'CUNB', label: 'Giám đốc CUNB', actionLabel: 'Phê duyệt', approvers: ['gdcunb1'] }
      ]
    };
    const badgeWithExtraLayer = await page.evaluate((p) => itPriceStatusBadge(p), itemWithExtraLayer);
    console.log('Badge (có lớp phê duyệt thêm):', badgeWithExtraLayer);
    check('Hồ sơ có 1 bước gốc + 1 lớp phê duyệt thêm (2 bước tổng) -> badge PHẢI hiện "0/2", KHÔNG phải "0/1"',
      badgeWithExtraLayer.includes('0/2') && !badgeWithExtraLayer.includes('0/1'), badgeWithExtraLayer);

    // Đối chứng: hồ sơ KHÔNG có lớp phê duyệt thêm (chỉ 1 bước thật) -> vẫn phải hiện "0/1" như cũ,
    // không bị đổi sai hành vi của trường hợp phổ biến nhất.
    const itemNoExtraLayer = { ...itemWithExtraLayer, id: 2, code: 'HCRC-MHF-ITPG-BL-006', extraApprovalLayers: [] };
    const badgeNoExtraLayer = await page.evaluate((p) => itPriceStatusBadge(p), itemNoExtraLayer);
    console.log('Badge (KHÔNG có lớp phê duyệt thêm, đối chứng):', badgeNoExtraLayer);
    check('Đối chứng — hồ sơ CHỈ 1 bước thật (không lớp thêm) -> badge vẫn đúng "0/1" (không đổi hành vi cũ)',
      badgeNoExtraLayer.includes('0/1'), badgeNoExtraLayer);

    // Sau khi bước 1 đã duyệt (currentStep=2, còn PENDING chờ bước 2 "Giám đốc CUNB") -> phải hiện "1/2".
    const itemStep2 = { ...itemWithExtraLayer, id: 3, code: 'HCRC-MHF-ITPG-BL-007', currentStep: 2,
      history: [{ action: 'APPROVED', username: 'truong_phong1', step: 1 }] };
    const badgeStep2 = await page.evaluate((p) => itPriceStatusBadge(p), itemStep2);
    console.log('Badge (đã qua bước 1, đang chờ bước 2 "Giám đốc CUNB"):', badgeStep2);
    check('Đã duyệt xong bước 1, đang chờ bước 2 (lớp phê duyệt thêm) -> badge PHẢI hiện "1/2"',
      badgeStep2.includes('1/2'), badgeStep2);

    // APPROVED hoàn tất (qua cả 2 bước) -> phải hiện "2/2".
    const itemApproved = { ...itemWithExtraLayer, id: 4, code: 'HCRC-MHF-ITPG-BL-008', status: 'APPROVED', currentStep: 2,
      history: [{ action: 'APPROVED', username: 'truong_phong1', step: 1 }, { action: 'APPROVED', username: 'gdcunb1', step: 2 }] };
    const badgeApproved = await page.evaluate((p) => itPriceStatusBadge(p), itemApproved);
    console.log('Badge (đã phê duyệt xong, đủ 2 bước):', badgeApproved);
    check('APPROVED (qua đủ cả 2 bước, có lớp phê duyệt thêm) -> badge PHẢI hiện "2/2"',
      badgeApproved.includes('2/2'), badgeApproved);

  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
