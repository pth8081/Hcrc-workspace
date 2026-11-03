// server/tests/demo-itprice-download-after-approve.js
//
// DEMO ảnh chụp (không phải bộ hồi quy — xem tests/test-itprice-download-after-approve-ui.js) cho fix
// v28.85: nút "⬇️ Tải file gốc" PHẢI vẫn hiện cho approver ĐÃ TỪNG duyệt 1 bước, dù hồ sơ đã qua bước kế
// tiếp — đúng yêu cầu người dùng kiểm tra lại cho CẢ Bán Lẻ VÀ Bán Buôn.
//
// Chạy: node server/tests/demo-itprice-download-after-approve.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8998;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'itprice-download-after-approve');

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}
async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

const STAFF_KD = { username: 'staff_kd', name: 'Ngô Văn Kinh Doanh', dept: 'Kinh Doanh', perms: { itPriceProposeCreateRetail: true }, active: true };
const APPROVER1 = { username: 'approver1', name: 'Trưởng Phòng Duyệt', dept: 'Kinh Doanh', perms: {}, active: true };
const APPROVER2 = { username: 'approver2', name: 'Giám Đốc Duyệt', dept: 'Ban Giám Đốc', perms: {}, active: true };
const GDST_A = { username: 'gd.a', name: 'Giám Đốc Siêu Thị A', dept: 'Siêu Thị A', jobTitle: 'Giám Đốc Siêu Thị', perms: {}, active: true };
const PTGD = { username: 'ptgd', name: 'Phó Tổng Giám Đốc', dept: 'Ban Giám Đốc', perms: {}, active: true };

const MASTER_LIST = {
  id: 1, name: 'Bảng Giá Chuẩn 2026',
  columns: [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }, { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }],
  fileUrl: '/uploads/mau-gia-chuan-2026.xlsx', fileName: 'Mau Gia Chuan 2026.xlsx',
  uploadedBy: 'admin', uploadedByName: 'Quản Trị Viên', uploadedAt: new Date().toLocaleString('vi-VN')
};
const WHOLESALE_ITEM = {
  id: 9001, code: 'ITPG-BB-DEMO-001', priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5', dept: 'Phòng Mua Hàng',
  creator: 'staff_mh', creatorName: 'Người Đề Xuất Buôn', createdAt: new Date().toLocaleString('vi-VN'),
  storeScope: { mode: 'OTHER', stores: ['Siêu Thị A'] }, reason: 'Điều chỉnh margin chương trình khuyến mãi quý 4',
  masterListId: MASTER_LIST.id, masterListName: MASTER_LIST.name,
  status: 'PENDING', currentStep: 1, history: [], infoRequests: [], applied: false,
  files: [{ id: 1, fileUrl: '/uploads/wholesale-test.xlsx', fileName: 'Bang Gia Ban Buon Sieu Thi A.xlsx', uploadedBy: 'staff_mh', uploadedByName: 'Người Đề Xuất Buôn', uploadedAt: new Date().toLocaleString('vi-VN'),
    columnLabels: [{ key: 'code', label: 'Mã hàng' }], items: [{ values: { code: '1002200019' } }] }]
};

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const state = createMockState({
    depts: ['Kinh Doanh', 'Ban Giám Đốc', 'Siêu Thị A', 'Phòng Mua Hàng'],
    users: [STAFF_KD, APPROVER1, APPROVER2, GDST_A, PTGD, { username: 'staff_mh', name: 'Người Đề Xuất Buôn', dept: 'Phòng Mua Hàng', perms: { itPriceProposeCreateWholesale: true }, active: true }],
    itPriceMasterLists: [MASTER_LIST],
    itPriceApprovals: [WHOLESALE_ITEM],
    itPriceDeptWorkflows: { 'Kinh Doanh': { workflowId: 'wf-kd-price-2step', approvers: { 1: ['approver1'], 2: ['approver2'] } } },
    workflows: [
      { id: 'wf-kd-price-2step', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }, { order: 2, name: 'Giám Đốc Duyệt' }] },
      { id: 'WF_W_2STEP', steps: [{ order: 1, name: 'GĐST Duyệt' }, { order: 2, name: 'Phó TGĐ Duyệt' }] }
    ],
    itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_W_2STEP' } },
    itPriceWholesaleStoreMixedApprovalRules: [
      { id: 1, tier: 'MARGIN_LT5', step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc Siêu Thị', stores: [] },
      { id: 2, tier: 'MARGIN_LT5', step: 2, mode: 'PERSON', username: 'ptgd', stores: [] }
    ],
    storeJobTitles: [{ label: 'Giám Đốc Siêu Thị' }]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    // ============ BÁN LẺ ============
    await loginAs(page, STAFF_KD);
    const retailItem = await page.evaluate(async () => {
      await switchTab('muaHang');
      setPurchasingSubTab('ITPRICE');
      openMhItPriceCreateForm();
      document.getElementById('mhItPriceMasterListSelect').value = String(1);
      document.getElementById('mhItPriceReason').value = 'Điều chỉnh giá theo chương trình khuyến mãi quý 4';
      mhItPricePendingFile = {
        fileUrl: '/uploads/retail-demo.xlsx', fileName: 'Bang Gia Ban Le Mien Bac.xlsx',
        items: [{ values: { code: '1001302147', name: 'Mít cắt miếng', oldPrice: '47000', newPrice: '52000' } }],
        columnLabels: [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }, { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }]
      };
      document.getElementById('mhItPriceRetailZone').value = 'Miền Bắc';
      await submitMhItPriceApproval({ preventDefault() {}, target: { reset() {} } });
      return DB.itPriceApprovals.find(x => x.priceType !== 'WHOLESALE');
    });

    await loginAs(page, APPROVER1);
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), retailItem.id);
    await page.waitForTimeout(150);
    await shot(page, '#itPriceModal', '1-ban-le-approver1-TRUOC-khi-duyet-thay-nut-tai.png');
    await page.evaluate(() => closeItPriceModal());

    await page.evaluate(async (id) => { await approveItPriceConfirmed(id); }, retailItem.id);
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), retailItem.id);
    await page.waitForTimeout(150);
    await shot(page, '#itPriceModal', '2-ban-le-approver1-SAU-khi-duyet-VAN-thay-nut-tai.png');
    await page.evaluate(() => closeItPriceModal());

    // ============ BÁN BUÔN ============
    await loginAs(page, GDST_A);
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), WHOLESALE_ITEM.id);
    await page.waitForTimeout(150);
    await shot(page, '#itPriceModal', '3-ban-buon-gdst-TRUOC-khi-duyet-thay-nut-tai.png');
    await page.evaluate(() => closeItPriceModal());

    await page.evaluate(async (id) => { await approveItPriceConfirmed(id); }, WHOLESALE_ITEM.id);
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), WHOLESALE_ITEM.id);
    await page.waitForTimeout(150);
    await shot(page, '#itPriceModal', '4-ban-buon-gdst-SAU-khi-duyet-VAN-thay-nut-tai.png');
    await page.evaluate(() => closeItPriceModal());

    console.log('\n✅ Demo xong — ảnh lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})();
