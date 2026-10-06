// server/tests/demo-itprice-approver-download.js
//
// DEMO thật (không phải bộ hồi quy tự động) — chụp ảnh tính năng mới theo yêu cầu người dùng (10/2026):
// "Trong phê duyệt giá bạn cho mình thêm nút tải file từ bước người phê duyệt giúp tôi nhé. Người gửi
// phê duyệt thì vẫn chỉ xem là được" + "sửa lại font khi upload tên file lên để người dùng dễ nhận biết".
//
// Chạy: node server/tests/demo-itprice-approver-download.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'itprice-approver-download');

const STAFF_KD = { username: 'staff_kd', name: 'Ngô Văn Kinh Doanh', dept: 'Kinh Doanh', perms: { itPriceProposeCreateRetail: true }, active: true };
const APPROVER1 = { username: 'approver1', name: 'Trưởng Phòng Duyệt', dept: 'Kinh Doanh', perms: {}, active: true };

const MASTER_LIST = {
  id: 1, name: 'Bảng Giá Chuẩn 2026',
  columns: [
    { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
    { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
  ],
  fileUrl: '/uploads/mau-gia-chuan-2026.xlsx', fileName: '261006 Test Gia Hạn Khuyến Mãi.xlsx',
  uploadedBy: 'admin', uploadedByName: 'Quản Trị Viên', uploadedAt: new Date().toLocaleString('vi-VN')
};

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({
    depts: ['Kinh Doanh'],
    users: [STAFF_KD, APPROVER1],
    itPriceMasterLists: [MASTER_LIST],
    itPriceDeptWorkflows: { 'Kinh Doanh': { workflowId: 'wf-kd-price', approvers: { 1: ['approver1'] } } },
    workflows: [{ id: 'wf-kd-price', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }] }]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    // 1) Tạo đề xuất Phê Duyệt Giá Bán Lẻ còn PENDING (chưa ai duyệt).
    await loginAs(page, STAFF_KD);
    const created = await page.evaluate(async () => {
      await switchTab('muaHang');
      setPurchasingSubTab('ITPRICE');
      openMhItPriceCreateForm();
      document.getElementById('mhItPriceMasterListSelect').value = String(1);
      document.getElementById('mhItPriceReason').value = 'Điều chỉnh giá theo chương trình khuyến mãi 06.10';
      mhItPricePendingFile = {
        fileUrl: '/uploads/261006-test-tag.xlsx', fileName: '261006 Test TAG.xlsx',
        items: [
          { values: { code: '1001302147', name: 'Mít cắt miếng.', oldPrice: '47000', newPrice: '66000' } },
          { values: { code: '1001601470', name: 'Mít ruột đỏ cắt miếng SF', oldPrice: '48000', newPrice: '68000' } }
        ],
        columnLabels: [
          { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
          { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
        ]
      };
      document.getElementById('mhItPriceRetailZone').value = 'Miền Bắc';
      await submitMhItPriceApproval({ preventDefault() {}, target: { reset() {} } });
      return DB.itPriceApprovals[0];
    });
    console.log('Tạo đề xuất:', created.code, created.status);

    // 2) Danh sách đề xuất (font tên file đã rõ hơn — font-medium, không còn mờ nhạt).
    await page.waitForTimeout(150);
    await shot(page, '#mhItPriceTableBody', '1-danh-sach-ten-file-ro-hon.png');

    // 3) Mở modal với tài khoản NGƯỜI GỬI (staff_kd) — vẫn chỉ XEM, không có nút tải.
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), created.id);
    await page.waitForTimeout(150);
    await shot(page, '#itPriceModal', '2-nguoi-gui-chi-xem-khong-tai-duoc.png');
    await page.evaluate(() => closeItPriceModal());

    // 4) Đăng nhập người DUYỆT (approver1) — mở modal, PHẢI thấy nút "⬇️ Tải file gốc" dù hồ sơ còn PENDING.
    await loginAs(page, APPROVER1);
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), created.id);
    await page.waitForTimeout(150);
    await shot(page, '#itPriceModal', '3-nguoi-duyet-thay-nut-tai-file-dang-cho-duyet.png');

    console.log('\n✅ Demo xong — ảnh lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})();
