// server/tests/demo-approve-toast-autoclose.js
//
// DEMO thật — chụp ảnh tính năng MỚI (11/2026, phản hồi người dùng kèm ảnh chụp màn hình Phê Duyệt Giá
// IT: "nếu ấn phê duyệt thì sẽ đóng màn hình phê duyệt luôn ko cần hiện ra thông báo nào khác để phải
// thao tác"): bấm "Phê Duyệt" trong hộp thoại xác nhận -> modal chi tiết TỰ ĐÓNG ngay, thông báo kết quả
// hiện dưới dạng toast góc màn hình TỰ biến mất (showApprovalToast(), core.js) thay vì alert() của trình
// duyệt bắt buộc phải bấm OK mới làm được gì tiếp (trước đây modal chi tiết còn tự MỞ LẠI sau alert(),
// bắt người dùng tự đóng thêm 1 lần nữa).
//
// Dùng testHarness.js (Chromium thật mở public/index.html thật, round-trip THẬT qua callWorkflowAction()
// 'itPriceApprovals' approve — khớp đúng khuôn demo-itprice-status-badge-step-total.js).
//
// Chạy: node server/tests/demo-approve-toast-autoclose.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'approve-toast-autoclose');
const APPROVER = { username: 'truong_phong1', name: 'Trịnh Thị Thu Thủy', dept: 'Phòng Mua hàng FMCG', perms: {}, active: true };
const CREATOR = { username: 'demo_user', name: 'Nguyễn Lê Huân', dept: 'Phòng Mua hàng FMCG', perms: {}, active: true };

const ITEM = {
  id: 1, code: 'HCRC-MHF-ITPG-BL-024', priceType: 'RETAIL', dept: 'Phòng Mua hàng FMCG',
  creator: 'demo_user', creatorName: 'Nguyễn Lê Huân', createdAt: new Date().toLocaleString('vi-VN'),
  status: 'PENDING', currentStep: 1, history: [], infoRequests: [], applied: false,
  reason: 'Em gửi anh chị file gia hạn CTKM HMP, Anh chị duyệt giúp em ạ',
  storeScope: { stores: [] }, wholesaleApplyUnit: 'Gia hạn Chương trình Khuyến mại',
  files: [{ id: 1, fileUrl: '/uploads/ctkm-hmp.xlsx', fileName: 'TH gia han CTKM HMP.xlsx',
    uploadedBy: 'demo_user', uploadedByName: 'Nguyễn Lê Huân', uploadedAt: new Date().toLocaleString('vi-VN'),
    columnLabels: [{ key: 'c0', label: 'Mã hàng' }], items: Array.from({ length: 300 }, (_, i) => ({ values: { c0: String(i + 1) } })) }],
};

async function shot(page, selector, file, label) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log(`📸 ${label} ->`, file);
}
// #approvalToastContainer dùng position:fixed (neo theo viewport, KHÔNG theo flow của <body>) — chụp
// page.locator('body').screenshot() có thể cắt/bỏ sót phần tử fixed nếu body cao hơn viewport (Playwright
// phải cuộn để chụp element cao hơn khung nhìn, phần tử fixed không "dính" đúng theo khung cuộn đó). Dùng
// page.screenshot() (chụp đúng khung nhìn hiện tại, không cuộn) để toast góc phải LUÔN lộ ra đúng ảnh.
async function shotViewport(page, file, label) {
  await page.screenshot({ path: path.join(OUT_DIR, file) });
  console.log(`📸 ${label} ->`, file);
}
async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const state = createMockState({
    depts: ['Phòng Mua hàng FMCG'],
    users: [APPROVER, CREATOR],
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Phê duyệt' }] }],
    itPriceDeptWorkflows: { 'Phòng Mua hàng FMCG': { workflowId: 'WF_1STEP', approvers: { 1: ['truong_phong1'] } } },
    itPriceApprovals: [ITEM]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1180, height: 820 });

  try {
    await loginAs(page, APPROVER);
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), ITEM.id);
    await page.waitForTimeout(250);
    await shot(page, '#itPriceModal', '01-truoc-khi-bam-phe-duyet.png', 'Modal chi tiết — trước khi bấm Phê Duyệt');

    await page.click('[data-op="approveItPrice"]');
    await page.waitForTimeout(200);
    await shot(page, '#genericConfirmModal > div', '02-hop-thoai-xac-nhan.png', 'Hộp thoại "Xác Nhận Phê Duyệt" mở ra');

    await page.click('#genericConfirmOkBtn');
    await page.waitForTimeout(150);
    await shotViewport(page, '03-ngay-sau-khi-bam-phe-duyet.png', 'NGAY sau khi bấm Phê Duyệt — modal tự đóng, toast hiện góc phải');

    const stateAfter = await page.evaluate(() => ({
      modalHidden: document.getElementById('itPriceModal').classList.contains('hidden'),
      toastVisible: !!document.querySelector('#approvalToastContainer')?.textContent?.trim(),
      toastText: document.querySelector('#approvalToastContainer')?.textContent?.trim() || '',
      status: DB.itPriceApprovals.find(x => x.id === 1)?.status
    }));
    console.log('Trạng thái sau khi duyệt:', JSON.stringify(stateAfter, null, 2));
    if (!stateAfter.modalHidden) throw new Error('❌ Modal chi tiết KHÔNG tự đóng sau khi bấm Phê Duyệt!');
    if (!stateAfter.toastVisible) throw new Error('❌ Không thấy toast thông báo kết quả!');
    if (stateAfter.status !== 'APPROVED') throw new Error('❌ Hồ sơ KHÔNG chuyển đúng trạng thái APPROVED!');

    await page.waitForTimeout(4200); // chờ toast tự biến mất (4s theo showApprovalToast())
    await shotViewport(page, '04-sau-4s-toast-tu-bien-mat.png', 'Sau ~4 giây — toast TỰ biến mất, không cần thao tác gì thêm');
    const toastGone = await page.evaluate(() => !document.querySelector('#approvalToastContainer')?.textContent?.trim());
    if (!toastGone) throw new Error('❌ Toast KHÔNG tự biến mất sau 4s!');

    console.log('\n✅ XÁC NHẬN: bấm "Phê Duyệt" -> modal chi tiết tự đóng NGAY, toast tự biến mất, không cần thao tác gì thêm.');
  } finally {
    await browser.close();
    server.close();
  }
})();
