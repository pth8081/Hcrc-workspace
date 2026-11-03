// server/tests/test-itprice-download-after-approve-ui.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng gửi ảnh chụp "Phê Duyệt Giá Bán Buôn" bị chặn tải, hỏi thêm "kiểm tra lại
// giá phê duyệt bán lẻ có làm đúng... ở các bước phê duyệt đều cho phép tải file giá để em ngay cả khi đã
// phê duyệt rồi không"): server (lib/fileAuthz.js) đã có ngoại lệ "ai đã TỪNG ký duyệt (action APPROVED,
// không bị invalidated) ở BẤT KỲ bước nào của chính hồ sơ này thì giữ quyền tải file MỚI NHẤT vĩnh viễn",
// nhưng client (public/js/module-itsupport-price.js::renderItPriceModal()) CHƯA mirror ngoại lệ này —
// nút "⬇️ Tải file gốc" chỉ hiện cho (a) file đã chính thức duyệt hoặc (b) approver ĐÚNG BƯỚC HIỆN TẠI khi
// hồ sơ còn PENDING. Khi hồ sơ qua bước kế tiếp (đổi currentStep), approver bước trước mất hẳn nút tải dù
// server vẫn cho phép — đúng những gì ảnh chụp người dùng gửi thể hiện. Bug này KHÔNG phân biệt priceType
// (buildItPriceRowHtml/renderItPriceModal dùng CHUNG cho RETAIL/WHOLESALE) nên test cả 2 loại.
//
// Test bằng BROWSER THẬT (testHarness.js, backend mock dùng ĐÚNG lib/workflowEngine.js::applyWorkflowAction
// — không phải suy luận) để chứng minh hành vi UI thật trước/sau khi approver bấm Duyệt.
//
// Chạy: node server/tests/test-itprice-download-after-approve-ui.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;
let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { console.log(`PASS: ${name}`); passed++; }
  else { console.log(`FAIL: ${name}`); failed++; }
}

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

const STAFF_KD = { username: 'staff_kd', name: 'Ngô Văn Kinh Doanh', dept: 'Kinh Doanh', perms: { itPriceProposeCreateRetail: true }, active: true };
const APPROVER1 = { username: 'approver1', name: 'Trưởng Phòng Duyệt', dept: 'Kinh Doanh', perms: {}, active: true };
const APPROVER2 = { username: 'approver2', name: 'Giám Đốc Duyệt', dept: 'Ban Giám Đốc', perms: {}, active: true };

const STAFF_MH = { username: 'staff_mh', name: 'Người Đề Xuất Buôn', dept: 'Phòng Mua Hàng', perms: { itPriceProposeCreateWholesale: true }, active: true };
const GDST_A = { username: 'gd.a', name: 'Giám Đốc Siêu Thị A', dept: 'Siêu Thị A', jobTitle: 'Giám Đốc Siêu Thị', perms: {}, active: true };
const PTGD = { username: 'ptgd', name: 'Phó Tổng Giám Đốc', dept: 'Ban Giám Đốc', perms: {}, active: true };

const MASTER_LIST = {
  id: 1, name: 'Bảng Giá Chuẩn 2026',
  columns: [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }, { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }],
  fileUrl: '/uploads/mau-gia-chuan-2026.xlsx', fileName: 'Mau Gia Chuan 2026.xlsx',
  uploadedBy: 'admin', uploadedByName: 'Quản Trị Viên', uploadedAt: new Date().toLocaleString('vi-VN')
};

// Hồ sơ WHOLESALE tạo sẵn trực tiếp trong state (bỏ qua chi tiết UI tạo đề xuất bán buôn — không liên
// quan tới bug đang kiểm, chỉ cần đúng hình dạng item.priceType/priceTier/storeScope/files/status thật).
const WHOLESALE_ITEM = {
  id: 9001, code: 'ITPG-BB-TEST-001', priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5', dept: 'Phòng Mua Hàng',
  creator: STAFF_MH.username, creatorName: STAFF_MH.name, createdAt: new Date().toLocaleString('vi-VN'),
  storeScope: { mode: 'OTHER', stores: ['Siêu Thị A'] }, reason: 'Test tải file sau khi đã duyệt — bán buôn',
  masterListId: MASTER_LIST.id, masterListName: MASTER_LIST.name,
  status: 'PENDING', currentStep: 1, history: [], infoRequests: [], applied: false,
  files: [{ id: 1, fileUrl: '/uploads/wholesale-test.xlsx', fileName: 'wholesale-test.xlsx', uploadedBy: STAFF_MH.username, uploadedByName: STAFF_MH.name, uploadedAt: new Date().toLocaleString('vi-VN'),
    columnLabels: [{ key: 'code', label: 'Mã hàng' }], items: [{ values: { code: '002' } }] }]
};

(async () => {
  const state = createMockState({
    depts: ['Kinh Doanh', 'Ban Giám Đốc', 'Siêu Thị A', 'Phòng Mua Hàng'],
    users: [STAFF_KD, APPROVER1, APPROVER2, STAFF_MH, GDST_A, PTGD],
    itPriceMasterLists: [MASTER_LIST],
    itPriceApprovals: [WHOLESALE_ITEM],
    // RETAIL: 2 bước — approver1 duyệt bước 1 thì sang approver2 ở bước 2.
    itPriceDeptWorkflows: { 'Kinh Doanh': { workflowId: 'wf-kd-price-2step', approvers: { 1: ['approver1'], 2: ['approver2'] } } },
    workflows: [
      { id: 'wf-kd-price-2step', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }, { order: 2, name: 'Giám Đốc Duyệt' }] },
      { id: 'WF_W_2STEP', steps: [{ order: 1, name: 'GĐST Duyệt' }, { order: 2, name: 'Phó TGĐ Duyệt' }] }
    ],
    // WHOLESALE: 2 bước — gd.a (GĐST Siêu Thị A, JOBTITLE mode) duyệt bước 1 thì sang ptgd (PERSON mode) ở bước 2.
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
    // ============ RETAIL ============
    await loginAs(page, STAFF_KD);
    const retailItem = await page.evaluate(async () => {
      await switchTab('muaHang');
      setPurchasingSubTab('ITPRICE');
      openMhItPriceCreateForm();
      document.getElementById('mhItPriceMasterListSelect').value = String(1);
      document.getElementById('mhItPriceReason').value = 'Test tải file sau khi đã duyệt — bán lẻ';
      mhItPricePendingFile = {
        fileUrl: '/uploads/retail-test.xlsx', fileName: 'retail-test.xlsx',
        items: [{ values: { code: '001', name: 'Hàng A', oldPrice: '10000', newPrice: '12000' } }],
        columnLabels: [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }, { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }]
      };
      document.getElementById('mhItPriceRetailZone').value = 'Miền Bắc';
      await submitMhItPriceApproval({ preventDefault() {}, target: { reset() {} } });
      return DB.itPriceApprovals.find(x => x.priceType !== 'WHOLESALE');
    });

    // approver1 duyệt bước 1 -> hồ sơ sang bước 2 (vẫn PENDING).
    await loginAs(page, APPROVER1);
    await page.evaluate(async (id) => { await approveItPriceConfirmed(id); }, retailItem.id);
    const afterStep1 = await page.evaluate((id) => DB.itPriceApprovals.find(x => x.id === id), retailItem.id);
    check('RETAIL: sau khi approver1 duyệt bước 1, hồ sơ sang bước 2 còn PENDING', afterStep1.status === 'PENDING' && afterStep1.currentStep === 2);

    // approver1 mở lại modal — PHẢI còn thấy nút tải (ngoại lệ "đã từng duyệt"), KHÔNG còn là approver bước hiện tại.
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), retailItem.id);
    await page.waitForTimeout(100);
    const retailDownloadHtml = await page.evaluate(() => document.getElementById('itPriceModalFiles').innerHTML);
    check('RETAIL: approver1 (đã duyệt bước 1, nay KHÔNG phải approver bước 2) VẪN thấy nút Tải file gốc',
      retailDownloadHtml.includes('Tải file gốc'));
    await page.evaluate(() => closeItPriceModal());

    // Người ngoài (staff_kd — người gửi) vẫn KHÔNG có nút tải — không được "lan lỗi" sang người không liên quan.
    await loginAs(page, STAFF_KD);
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), retailItem.id);
    await page.waitForTimeout(100);
    const creatorHtml = await page.evaluate(() => document.getElementById('itPriceModalFiles').innerHTML);
    check('RETAIL: người gửi đề xuất (chưa từng duyệt) KHÔNG có nút Tải file gốc', !creatorHtml.includes('Tải file gốc'));
    await page.evaluate(() => closeItPriceModal());

    // approver2 (approver bước 2 hiện tại, CHƯA duyệt) PHẢI thấy nút tải qua nhánh "approver bước hiện tại".
    await loginAs(page, APPROVER2);
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), retailItem.id);
    await page.waitForTimeout(100);
    const approver2Html = await page.evaluate(() => document.getElementById('itPriceModalFiles').innerHTML);
    check('RETAIL: approver2 (approver bước 2 hiện tại) thấy nút Tải file gốc', approver2Html.includes('Tải file gốc'));
    await page.evaluate(() => closeItPriceModal());

    // ============ WHOLESALE ============
    // Hồ sơ WHOLESALE_ITEM đã có sẵn trong state (server) ngay từ đầu — DB.itPriceApprovals phía client
    // cần đồng bộ lại 1 lần sau khi đăng nhập để thấy nó (giống cách syncStorage() tải DB thật lúc login).
    const wItem = await (async () => {
      await loginAs(page, STAFF_MH);
      return page.evaluate(() => DB.itPriceApprovals.find(x => x.code === 'ITPG-BB-TEST-001'));
    })();
    assert.ok(wItem, 'WHOLESALE_ITEM phải xuất hiện trong DB.itPriceApprovals sau khi đăng nhập (đồng bộ từ state)');

    // gd.a (GĐST Siêu Thị A, approver bước 1 qua JOBTITLE mode) duyệt bước 1.
    await loginAs(page, GDST_A);
    await page.evaluate(async (id) => { await approveItPriceConfirmed(id); }, wItem.id);
    const wAfterStep1 = await page.evaluate((id) => DB.itPriceApprovals.find(x => x.id === id), wItem.id);
    check('WHOLESALE: sau khi gd.a duyệt bước 1, hồ sơ sang bước 2 còn PENDING', wAfterStep1.status === 'PENDING' && wAfterStep1.currentStep === 2);

    // gd.a mở lại modal — PHẢI vẫn thấy nút tải dù không còn là approver bước hiện tại (bước 2 là ptgd).
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), wItem.id);
    await page.waitForTimeout(100);
    const wholesaleDownloadHtml = await page.evaluate(() => document.getElementById('itPriceModalFiles').innerHTML);
    check('WHOLESALE: gd.a (đã duyệt bước 1, nay KHÔNG phải approver bước 2) VẪN thấy nút Tải file gốc',
      wholesaleDownloadHtml.includes('Tải file gốc'));
    await page.evaluate(() => closeItPriceModal());

    // ptgd (approver bước 2 hiện tại, CHƯA duyệt) PHẢI thấy nút tải qua nhánh "approver bước hiện tại".
    await loginAs(page, PTGD);
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), wItem.id);
    await page.waitForTimeout(100);
    const ptgdHtml = await page.evaluate(() => document.getElementById('itPriceModalFiles').innerHTML);
    check('WHOLESALE: ptgd (approver bước 2 hiện tại) thấy nút Tải file gốc', ptgdHtml.includes('Tải file gốc'));
    await page.evaluate(() => closeItPriceModal());

    // Người ngoài hoàn toàn không liên quan — KHÔNG được thấy nút tải.
    await loginAs(page, STAFF_MH);
    await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), wItem.id);
    await page.waitForTimeout(100);
    const wCreatorHtml = await page.evaluate(() => document.getElementById('itPriceModalFiles').innerHTML);
    check('WHOLESALE: người gửi đề xuất (chưa từng duyệt) KHÔNG có nút Tải file gốc', !wCreatorHtml.includes('Tải file gốc'));
    await page.evaluate(() => closeItPriceModal());

  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
