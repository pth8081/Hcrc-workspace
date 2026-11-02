// server/tests/test-itprice-download-filename-code.js
//
// LỖI ĐÃ VÁ (11/2026, yêu cầu người dùng "team IT muốn tên file tải về cộng thêm mã phiếu đằng trước, để
// sau này đối chiếu lại"): nút "⬇️ Tải file gốc" ở modal Phê Duyệt Giá (module-itsupport-price.js) trước
// đây tải về ĐÚNG TÊN FILE GỐC người đề xuất đặt (VD "261006 Test TAG.xlsx"), không có cách nào biết file
// đó thuộc đề xuất/mã phiếu nào nếu đã tải về nhiều lần hoặc đổi tên — nay cộng "<mã phiếu> - " đằng trước
// (CHỈ đổi tên lúc TẢI, không đụng tới fileName gốc lưu trong DB/hiển thị tiêu đề).
//
// Dùng nguyên luồng tạo + duyệt THẬT (testHarness.js) để có p.code SINH THẬT ở server (generateCode),
// không hard-code giả — đúng tinh thần "test kỹ, không suy luận" theo yêu cầu người dùng.
//
// Chạy: node server/tests/test-itprice-download-filename-code.js
'use strict';

const { startStaticServer, createMockState, launchPage, createRunner, assert } = require('./testHarness');

const PORT = 8997;

const STAFF_KD = { username: 'staff_kd2', name: 'Ngô Văn Kinh Doanh 2', dept: 'Kinh Doanh', perms: { itPriceProposeCreateRetail: true }, active: true };
const APPROVER1 = { username: 'approver1b', name: 'Trưởng Phòng Duyệt', dept: 'Kinh Doanh', perms: {}, active: true };

const MASTER_LIST = {
  id: 1, name: 'Bảng Giá Chuẩn 2026',
  columns: [
    { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
    { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
  ],
  fileUrl: '/uploads/mau-gia-chuan-2026.xlsx', fileName: 'Mau Gia Chuan 2026.xlsx',
  uploadedBy: 'admin', uploadedByName: 'Quản Trị Viên', uploadedAt: new Date().toLocaleString('vi-VN')
};

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

(async () => {
  const { run, summary } = createRunner();

  const state = createMockState({
    depts: ['Kinh Doanh'],
    users: [STAFF_KD, APPROVER1],
    itPriceMasterLists: [MASTER_LIST],
    itPriceDeptWorkflows: { 'Kinh Doanh': { workflowId: 'wf-kd-price2', approvers: { 1: ['approver1b'] } } },
    workflows: [{ id: 'wf-kd-price2', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }] }]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    let itemId, itemCode, originalFileName;

    await run('Tạo đề xuất Bán Lẻ (PENDING) qua đúng luồng thật — lấy mã phiếu SINH THẬT ở server', async () => {
      await loginAs(page, STAFF_KD);
      const created = await page.evaluate(async () => {
        await switchTab('muaHang');
        setPurchasingSubTab('ITPRICE');
        openMhItPriceCreateForm();
        document.getElementById('mhItPriceMasterListSelect').value = String(1);
        document.getElementById('mhItPriceReason').value = 'Điều chỉnh giá theo chương trình khuyến mãi — test mã phiếu trong tên file tải về';
        mhItPricePendingFile = {
          fileUrl: '/uploads/261101-test-ma-phieu.xlsx', fileName: '261101 Test Ma Phieu.xlsx',
          items: [{ values: { code: '1001302147', name: 'Mít cắt miếng.', oldPrice: '47000', newPrice: '66000' } }],
          columnLabels: [
            { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
            { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
          ]
        };
        document.getElementById('mhItPriceRetailZone').value = 'Miền Bắc';
        await submitMhItPriceApproval({ preventDefault() {}, target: { reset() {} } });
        return DB.itPriceApprovals[0];
      });
      itemId = created.id;
      itemCode = created.code;
      originalFileName = created.files[created.files.length - 1].fileName;
      assert(itemCode && itemCode.length > 0, 'Đề xuất phải có mã phiếu sinh thật ở server');
      assert(originalFileName === '261101 Test Ma Phieu.xlsx', `Phải lấy đúng tên file gốc vừa nộp — nhận được: ${originalFileName}`);
    });

    await run('Người DUYỆT mở modal (hồ sơ còn PENDING) — href "Tải file gốc" phải chứa "<mã phiếu> - <tên file gốc>" đã encode', async () => {
      await loginAs(page, APPROVER1);
      await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), itemId);
      await page.waitForTimeout(150);

      const href = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('#itPriceModalFiles a'));
        const dlLink = links.find(a => a.textContent.includes('Tải file gốc'));
        return dlLink ? dlLink.getAttribute('href') : null;
      });
      assert(href, 'Phải có đúng 1 link "⬇️ Tải file gốc" hiện ra cho người duyệt đúng bước hiện tại');

      const url = new URL(href, 'http://localhost');
      const nameParam = url.searchParams.get('name');
      assert(nameParam === `${itemCode} - ${originalFileName}`,
        `Tên file tải về (param "name") phải là "<mã phiếu> - <tên file gốc>" — nhận được: ${nameParam}`);

      await page.evaluate(() => closeItPriceModal());
    });

    // Duyệt hồ sơ tới APPROVED để xác nhận link "Tải file gốc" VẪN cộng mã phiếu sau khi đã duyệt chính
    // thức (nhánh isApprovedFile khác nhánh canDownloadPendingFile vừa kiểm ở trên — 2 điều kiện riêng
    // trong canDownloadThisFile, phải kiểm cả 2 để không bỏ sót).
    await run('Sau khi DUYỆT (APPROVED) — href "Tải file gốc" vẫn cộng đúng mã phiếu đằng trước', async () => {
      await page.evaluate(async (id) => {
        await approveItPriceConfirmed(id); // mirror ĐÚNG hàm thật đứng sau nút "Duyệt" (withApprovalAuth
        // bỏ qua modal PIN/OTP vì approverAuthLevel mặc định 'NONE' cho APPROVER1 ở trên).
      }, itemId);
      await page.waitForTimeout(150);

      await page.evaluate((id) => openItPriceModal(id, 'VIEW'), itemId);
      await page.waitForTimeout(150);
      const href = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('#itPriceModalFiles a'));
        const dlLink = links.find(a => a.textContent.includes('Tải file gốc'));
        return dlLink ? dlLink.getAttribute('href') : null;
      });
      assert(href, 'Hồ sơ APPROVED vẫn phải có link "⬇️ Tải file gốc" cho đúng file đã duyệt');
      const url = new URL(href, 'http://localhost');
      const nameParam = url.searchParams.get('name');
      assert(nameParam === `${itemCode} - ${originalFileName}`,
        `Sau khi APPROVED, tên file tải về vẫn phải cộng đúng mã phiếu đằng trước (nhánh isApprovedFile) — nhận được: ${nameParam}`);
      await page.evaluate(() => closeItPriceModal());
    });
  } finally {
    await browser.close();
    server.close();
  }

  summary();
})().catch((err) => { console.error(err); process.exit(1); });
