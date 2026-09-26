// server/tests/demo-itprice-context-buttons.js
//
// DEMO thật (không phải bộ hồi quy tự động — xem tests/test-it-support.js/test-approval-hub.js cho
// phần đó) cho yêu cầu người dùng (đợt 2, 10/2026): "Phê duyệt/từ chối/bổ sung/phê duyệt khẩn cấp làm
// tại 2 tab phê duyệt giá. Riêng IT sẽ là các nút còn lại như hỗ trợ và áp giá thôi."
//
// Chứng minh bằng ảnh chụp thật (Playwright, Chromium) CÙNG 1 hồ sơ Phê Duyệt Giá Bán Lẻ, mở modal
// "Chi tiết" (bằng click thật vào nút, không gọi thẳng hàm) từ 2 nơi khác nhau:
//   - Mua Hàng > Phê Duyệt Giá (context='APPROVAL') — người duyệt bước cuối thấy đủ nút Duyệt/Từ
//     chối/Yêu Cầu Bổ Sung/Từ Chối Khẩn.
//   - Hỗ Trợ IT > Phê Duyệt Giá (context='SUPPORT') — đội IT chỉ thấy nút hỗ trợ/áp giá (Tôi Đang Xử
//     Lý/Yêu Cầu Bổ Sung của IT), KHÔNG còn thấy Duyệt/Từ chối/Từ Chối Khẩn.
//
// Chạy: node server/tests/demo-itprice-context-buttons.js
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'itprice-context-buttons');

const STAFF_KD = { username: 'staff_kd', name: 'Ngô Văn Kinh Doanh', dept: 'Kinh Doanh', perms: { itPriceProposeCreateRetail: true }, active: true };
const APPROVER1 = { username: 'approver1', name: 'Trưởng Phòng Duyệt', dept: 'Kinh Doanh', perms: {}, active: true };
const IT1 = { username: 'it1', name: 'Đội Hỗ Trợ IT', dept: 'IT', perms: { itManage: true, itPriceSupport: true }, active: true };

const MASTER_LIST = {
  id: 1, name: 'Bảng Giá Chuẩn 2026',
  columns: [
    { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
    { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
  ],
  fileUrl: '/uploads/mau-gia-chuan-2026.xlsx', fileName: 'mau-gia-chuan-2026.xlsx',
  uploadedBy: 'admin', uploadedByName: 'Quản Trị Viên', uploadedAt: new Date().toLocaleString('vi-VN')
};

const state = createMockState({
  depts: ['Kinh Doanh', 'IT'],
  stores: ['Siêu thị Demo'],
  users: [STAFF_KD, APPROVER1, IT1],
  itPriceMasterLists: [MASTER_LIST],
  itPriceDeptWorkflows: { 'Kinh Doanh': { workflowId: 'wf-kd-price', approvers: { 1: ['approver1'] } } },
  workflows: [{ id: 'wf-kd-price', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }] }]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function shot(page, name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${file}`);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1000, height: 1200 });

  try {
    // ===== 1) Tạo 1 đề xuất Bán Lẻ thật (Mua Hàng) =====
    await loginAs(page, STAFF_KD);
    const createdId = await page.evaluate(async () => {
      await switchTab('muaHang');
      setPurchasingSubTab('ITPRICE');
      document.getElementById('mhItPriceCode').value = generateItPriceCode();
      document.getElementById('mhItPriceMasterListSelect').value = String(1);
      document.getElementById('mhItPriceReason').value = 'Điều chỉnh giá theo chương trình khuyến mãi Quý 4';
      mhItPricePendingFile = {
        fileUrl: '/uploads/gia-de-xuat-demo.xlsx', fileName: 'gia-de-xuat-demo.xlsx',
        items: [{ values: { code: 'SP001', name: 'Mì gói Hảo Hảo', oldPrice: '5000', newPrice: '5500' } }],
        columnLabels: [
          { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
          { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
        ]
      };
      document.getElementById('mhItPriceRetailZone').value = 'Miền Bắc';
      await submitMhItPriceApproval({ preventDefault() {}, target: { reset() {} } });
      return DB.itPriceApprovals[0].id;
    });
    console.log(`Đã tạo đề xuất #${createdId} (PENDING, chờ approver1 duyệt bước 1).`);

    // ===== 2) approver1 (người duyệt bước cuối/duy nhất) vào Mua Hàng > Phê Duyệt Giá, bấm "Chi
    // tiết" thật trên danh sách -> PHẢI thấy đủ nút Duyệt/Từ chối/Yêu Cầu Bổ Sung (context=APPROVAL). =====
    await loginAs(page, APPROVER1);
    await page.evaluate(async () => { await switchTab('muaHang'); setPurchasingSubTab('ITPRICE'); });
    await page.waitForTimeout(150);
    await page.locator('#mhItPriceTableBody button[data-op="openItPriceModal"]').first().scrollIntoViewIfNeeded();
    await page.locator('#mhItPriceTableBody button[data-op="openItPriceModal"]').first().click();
    await page.waitForTimeout(150);
    console.log('01: Mua Hàng > Phê Duyệt Giá — modal Chi tiết mở từ ĐÂY phải có Duyệt/Từ chối/Yêu Cầu Bổ Sung.');
    await shot(page, '01-mua-hang-phe-duyet-gia-du-nut-duyet');

    const approvalHtml = await page.evaluate(() => document.getElementById('itPriceModalControls').innerHTML);
    console.log('  -> có nút Duyệt (approveItPrice):', approvalHtml.includes('data-op="approveItPrice"'));
    console.log('  -> có nút Từ chối (rejectItPrice):', approvalHtml.includes('data-op="rejectItPrice"'));
    console.log('  -> có nút Yêu Cầu Bổ Sung (requestItPriceInfoApprover):', approvalHtml.includes('data-op="requestItPriceInfoApprover"'));
    console.log('  -> KHÔNG có nút hỗ trợ/áp giá của IT (claimPriceApplyAction):', !approvalHtml.includes('data-op="claimPriceApplyAction"'));

    // Duyệt bước 1 (bước cuối) -> APPROVED, để bước 3 chứng minh IT chỉ còn nút hỗ trợ/áp giá.
    await page.evaluate(async (id) => { await approveItPriceConfirmed(id); }, createdId);
    await page.evaluate(() => { if (typeof closeItPriceModal === 'function') closeItPriceModal(); });

    // ===== 3) IT1 (đội Hỗ Trợ IT) vào Hỗ Trợ IT > Phê Duyệt Giá, bấm "Chi tiết" thật trên CÙNG hồ sơ
    // -> CHỈ còn thấy nút hỗ trợ/áp giá (Tôi Đang Xử Lý/Yêu Cầu Bổ Sung của IT), KHÔNG còn Duyệt/Từ
    // chối/Từ Chối Khẩn (context=SUPPORT). =====
    await loginAs(page, IT1);
    await page.evaluate(async () => { await switchTab('itSupport'); setItSupportSubTab('PRICE'); });
    await page.waitForTimeout(150);
    await page.locator('#itPriceTableBody button[data-op="openItPriceModal"]').first().scrollIntoViewIfNeeded();
    await page.locator('#itPriceTableBody button[data-op="openItPriceModal"]').first().click();
    await page.waitForTimeout(150);
    console.log('\n02: Hỗ Trợ IT > Phê Duyệt Giá — modal Chi tiết mở từ ĐÂY chỉ còn nút hỗ trợ/áp giá.');
    await shot(page, '02-ho-tro-it-chi-con-nut-ho-tro-ap-gia');

    const supportHtml = await page.evaluate(() => document.getElementById('itPriceModalControls').innerHTML);
    console.log('  -> KHÔNG có nút Duyệt (approveItPrice):', !supportHtml.includes('data-op="approveItPrice"'));
    console.log('  -> KHÔNG có nút Từ chối (rejectItPrice):', !supportHtml.includes('data-op="rejectItPrice"'));
    console.log('  -> KHÔNG có nút Yêu Cầu Bổ Sung của người duyệt (requestItPriceInfoApprover):', !supportHtml.includes('data-op="requestItPriceInfoApprover"'));
    console.log('  -> CÓ nút "Tôi Đang Xử Lý" (claimPriceApplyAction):', supportHtml.includes('data-op="claimPriceApplyAction"'));
    console.log('  -> CÓ nút Yêu Cầu Bổ Sung của IT (requestItPriceInfoIt):', supportHtml.includes('data-op="requestItPriceInfoIt"'));
  } finally {
    await browser.close();
    server.close();
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
