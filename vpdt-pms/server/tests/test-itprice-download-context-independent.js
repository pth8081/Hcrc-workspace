// server/tests/test-itprice-download-context-independent.js
//
// Hồi quy: nút "⬇️ Tải file gốc" ở modal chi tiết Phê Duyệt Giá KHÔNG được phép phụ thuộc vào
// currentItPriceModalContext (tab đang mở modal đó) — chỉ phụ thuộc đúng quyền thật của server
// (lib/fileAuthz.js, mode:'download'): hồ sơ còn PENDING + đúng người duyệt bước hiện tại.
//
// Bối cảnh (11/2026, người dùng báo lỗi kèm ảnh chụp): hồ sơ Bán Lẻ có "Nhóm Phê Duyệt Cuối" (2 bước),
// người duyệt bước cuối không thấy nút Tải lúc hồ sơ còn PENDING. Trước khi vá, canDownloadPendingFile
// (module-itsupport-price.js) còn bắt buộc `currentItPriceModalContext === 'APPROVAL'` — điều kiện này
// KHÔNG tồn tại ở phía server, nên bất kỳ màn nào mở modal với context='SUPPORT' (VD "👁️ Chi tiết" ở
// bảng Hỗ Trợ IT, renderItPriceApprovals()) đều ẩn nhầm nút Tải dù server vẫn cho tải thật.
//
// Chạy: node server/tests/test-itprice-download-context-independent.js
'use strict';

const { startStaticServer, createMockState, launchPage, createRunner, assert } = require('./testHarness');

const PORT = 8991;

const APPROVER1 = { username: 'approver1', name: 'Hoàng Văn Đại', dept: 'Kinh Doanh', perms: {}, active: true };
const FINAL_APPROVER = { username: 'giamdoc1', name: 'Nguyễn Thị Hải Bình', dept: 'Kinh Doanh', perms: {}, active: true };
const SUPPORT_STAFF = { username: 'it1', name: 'Nhân Viên IT', dept: 'HO', perms: { itPriceSupport: true }, active: true };

function buildState() {
  return createMockState({
    depts: ['Kinh Doanh'],
    users: [APPROVER1, FINAL_APPROVER, SUPPORT_STAFF],
    itPriceDeptWorkflows: { 'Kinh Doanh': { workflowId: 'wf-kd-price', approvers: { 1: ['approver1'] } } },
    workflows: [{ id: 'wf-kd-price', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }] }],
    itPriceApprovals: [{
      id: 901, code: 'HCRC-TEST-ITPG-BL-001', dept: 'Kinh Doanh', priceType: 'RETAIL',
      status: 'PENDING', currentStep: 2,
      history: [
        { step: 1, stepName: 'Trưởng Phòng Duyệt', approver: 'Hoàng Văn Đại', username: 'approver1', action: 'APPROVED', comment: '', time: '16:44:33 03/11/2026' }
      ],
      extraApprovalLayers: [
        { layerKey: 'final_cunb', label: 'Giám đốc CUNB', actionLabel: null, approvers: ['giamdoc1'] }
      ],
      creator: 'approver1', creatorName: 'Hoàng Văn Đại',
      productName: 'Test sản phẩm', reason: '', customData: {},
      files: [
        { id: 1, fileName: 'test-file.xlsx', fileUrl: '/uploads/test-file.xlsx', uploadedBy: 'approver1', uploadedByName: 'Hoàng Văn Đại', uploadedAt: '16:31:04 03/11/2026', items: [], columnLabels: [] }
      ],
      infoRequests: [], createdAt: '16:31:04 03/11/2026'
    }]
  });
}

(async () => {
  const runner = createRunner();
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, buildState());

  await runner.run(
    'Người duyệt bước cuối mở modal với context="SUPPORT" (mirror "👁️ Chi tiết" ở bảng Hỗ Trợ IT) VẪN thấy nút Tải file gốc',
    async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, FINAL_APPROVER);
      await page.evaluate((id) => { openItPriceModal(id, 'SUPPORT'); }, 901);
      await page.waitForTimeout(100);
      const filesHtml = await page.evaluate(() => document.getElementById('itPriceModalFiles').innerHTML);
      assert(filesHtml.includes('Tải file gốc'), 'Thiếu nút "Tải file gốc" dù đúng người duyệt bước hiện tại — ' + filesHtml);
      assert(!filesHtml.includes('Chỉ file đã phê duyệt mới tải được'), 'Vẫn còn hiện thông báo khoá tải nhầm — ' + filesHtml);
    }
  );

  await runner.run(
    'Người duyệt bước cuối mở modal với context="APPROVAL" (mirror tab Mua Hàng/Vận Hành) vẫn thấy nút Tải file gốc (hành vi cũ, không bị phá)',
    async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, FINAL_APPROVER);
      await page.evaluate((id) => { openItPriceModal(id, 'APPROVAL'); }, 901);
      await page.waitForTimeout(100);
      const filesHtml = await page.evaluate(() => document.getElementById('itPriceModalFiles').innerHTML);
      assert(filesHtml.includes('Tải file gốc'), 'Thiếu nút "Tải file gốc" ở context APPROVAL — ' + filesHtml);
      const controlsHtml = await page.evaluate(() => document.getElementById('itPriceModalControls').innerHTML);
      assert(controlsHtml.includes('data-op="approveItPrice"'), 'Thiếu nút Duyệt ở đúng context APPROVAL — ' + controlsHtml);
    }
  );

  await runner.run(
    'Nhân viên Hỗ Trợ IT (KHÔNG phải người duyệt bước nào của hồ sơ này) mở modal với context="SUPPORT" -> KHÔNG thấy nút Tải (chỉ xem)',
    async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, SUPPORT_STAFF);
      await page.evaluate((id) => { openItPriceModal(id, 'SUPPORT'); }, 901);
      await page.waitForTimeout(100);
      const filesHtml = await page.evaluate(() => document.getElementById('itPriceModalFiles').innerHTML);
      assert(!filesHtml.includes('Tải file gốc'), 'Nhân viên IT không liên quan không được thấy nút Tải — ' + filesHtml);
      assert(filesHtml.includes('👁️ Xem'), 'Vẫn phải thấy nút Xem — ' + filesHtml);
    }
  );

  await runner.run(
    'Người duyệt BƯỚC 1 (đã duyệt xong, hồ sơ đang ở bước 2) mở với context="SUPPORT" -> vẫn thấy nút Tải (ngoại lệ "đã từng duyệt")',
    async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, APPROVER1);
      await page.evaluate((id) => { openItPriceModal(id, 'SUPPORT'); }, 901);
      await page.waitForTimeout(100);
      const filesHtml = await page.evaluate(() => document.getElementById('itPriceModalFiles').innerHTML);
      assert(filesHtml.includes('Tải file gốc'), 'Người đã từng duyệt bước trước phải vẫn tải được — ' + filesHtml);
    }
  );

  await browser.close();
  server.close();
  runner.summary();
})();
