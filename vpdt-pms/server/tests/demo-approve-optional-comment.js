// server/tests/demo-approve-optional-comment.js — Demo ảnh cho người dùng: ô ghi chú TUỲ CHỌN khi Duyệt
// (itPriceApprovals, module người dùng hỏi trực tiếp) + nơi hiển thị sau khi duyệt.
'use strict';
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8995;
const OUT_DIR = '/tmp/claude-0/-home-user-vpdt-dms/92486df7-a010-5b7a-a5ae-6b624f39c073/scratchpad';

const APPROVER = { username: 'approver1', name: 'Trần Thị Trưởng Phòng', dept: 'Kinh Doanh', perms: {}, active: true };
const PROPOSER = { username: 'staff_kd', name: 'Nguyễn Văn Đề Xuất', dept: 'Kinh Doanh', perms: { itPriceProposeCreateRetail: true }, active: true };

const ITEM = {
  id: 1, code: 'ITPG-2026-0042', priceType: 'RETAIL', priceZone: 'Miền Bắc', dept: 'Kinh Doanh',
  creator: PROPOSER.username, creatorName: PROPOSER.name, createdAt: '08:30:00 05/11/2026',
  storeScope: { mode: 'ALL' }, reason: 'Điều chỉnh giá theo chương trình khuyến mãi tháng 11',
  status: 'PENDING', currentStep: 1, history: [], infoRequests: [], applied: false,
  files: [{ id: 1, fileUrl: '/uploads/test.xlsx', fileName: 'Bang-gia-11-2026.xlsx', uploadedBy: PROPOSER.username, uploadedByName: PROPOSER.name, uploadedAt: '08:30:00 05/11/2026',
    columnLabels: [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }, { key: 'price', label: 'Giá mới' }],
    items: [{ values: { code: 'SP001', name: 'Sữa tươi tiệt trùng 1L', price: '28,000' } }] }]
};

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

(async () => {
  const state = createMockState({
    depts: ['Kinh Doanh', 'Ban Giám Đốc'],
    users: [APPROVER, PROPOSER],
    itPriceApprovals: [ITEM],
    itPriceDeptWorkflows: { 'Kinh Doanh': { workflowId: 'wf-1step', approvers: { 1: ['approver1'] } } },
    workflows: [{ id: 'wf-1step', steps: [{ order: 1, name: 'Duyệt' }] }]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });

  try {
    await loginAs(page, APPROVER);
    await page.evaluate(async () => {
      await switchTab('muaHang');
      setPurchasingSubTab('ITPRICE');
      openItPriceModal(1, 'APPROVAL');
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => approveItPrice(1));
    await page.waitForTimeout(150);
    await page.fill('#approveCommentInput', 'Đã kiểm tra bảng giá, khớp đúng chương trình khuyến mãi tháng 11 — đồng ý duyệt.');
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(OUT_DIR, 'demo-1-o-ghi-chu-khi-duyet.png') });

    await page.click('#genericConfirmOkBtn');
    await page.waitForTimeout(300);
    await page.evaluate(() => openItPriceModal(1, 'APPROVAL'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, 'demo-2-ghi-chu-hien-trong-lich-su.png') });

    console.log('Đã lưu 2 ảnh demo vào ' + OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})();
