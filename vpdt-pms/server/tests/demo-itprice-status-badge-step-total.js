// server/tests/demo-itprice-status-badge-step-total.js
//
// Demo ảnh trước/sau cho bản vá "BƯỚC 0/1" sai ở modal Phê Duyệt Giá (đúng ra phải là 0/2 khi hồ sơ có
// lớp phê duyệt thêm "Giám đốc CUNB") — người dùng gửi ảnh chụp mã HCRC-MHF-ITPG-BL-005. Dựng lại ĐÚNG
// kịch bản đó (1 bước dept gốc + 1 lớp phê duyệt thêm) rồi mở modal thật qua openItPriceModal().
//
// Chạy: node server/tests/demo-itprice-status-badge-step-total.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'itprice-status-badge-step-total');
const USER = { username: 'demo_user', name: 'Nguyễn Lê Huân', dept: 'Phòng Mua hàng FMCG', perms: {}, active: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}
async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

const ITEM = {
  id: 1, code: 'HCRC-MHF-ITPG-BL-005', priceType: 'RETAIL', dept: 'Phòng Mua hàng FMCG',
  creator: 'demo_user', creatorName: 'Nguyễn Lê Huân', createdAt: new Date().toLocaleString('vi-VN'),
  status: 'PENDING', currentStep: 1, history: [], infoRequests: [], applied: false,
  reason: 'Em gửi anh chị thay đổi giá NCC Minh Long, Anh chị duyệt giúp em ạ',
  storeScope: { stores: [] },
  files: [{ id: 1, fileUrl: '/uploads/thay-doi-gia-minh-long.xlsx', fileName: 'Thay doi gia Minh Long 5.11.26.xlsx',
    uploadedBy: 'demo_user', uploadedByName: 'Nguyễn Lê Huân', uploadedAt: new Date().toLocaleString('vi-VN'),
    columnLabels: [{ key: 'c0', label: 'Mã hàng' }], items: Array.from({ length: 95 }, (_, i) => ({ values: { c0: String(i + 1) } })) }],
  extraApprovalLayers: [
    { layerKey: 'CUNB', label: 'Giám đốc CUNB', actionLabel: 'Phê duyệt', approvers: ['gdcunb1'] }
  ]
};

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const state = createMockState({
    depts: ['Phòng Mua hàng FMCG'],
    users: [USER, { username: 'truong_phong1', name: 'Trịnh Thị Thu Thủy', dept: 'Phòng Mua hàng FMCG', perms: {}, active: true },
      { username: 'gdcunb1', name: 'Nguyễn Thị Hải Bình', dept: 'Ban Giám Đốc', perms: {}, active: true }],
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Phê duyệt' }] }],
    itPriceDeptWorkflows: { 'Phòng Mua hàng FMCG': { workflowId: 'WF_1STEP', approvers: { 1: ['truong_phong1'] } } },
    itPriceApprovals: [ITEM]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await loginAs(page, USER);
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), ITEM.id);
    await page.waitForTimeout(300);
    await shot(page, '#itPriceModal', 'sau-khi-va-hien-dung-0-2.png');

    const statusText = await page.evaluate(() => document.querySelector('#itPriceModalDetails')?.innerText || '');
    console.log('Dòng Trạng thái:', statusText.split('\n')[0]);
    if (!statusText.includes('BƯỚC 0/2') && !statusText.includes('0/2')) {
      throw new Error('❌ Modal thật KHÔNG hiện đúng "0/2" — bản vá chưa hoạt động!');
    }
    console.log('\n✅ XÁC NHẬN: modal thật (production code) đã hiện đúng "0/2" thay vì "0/1".');
  } finally {
    await browser.close();
    server.close();
  }
})();
