// server/tests/test-itprice-wholesale-pending-download.js
//
// Theo yêu cầu người dùng (11/2026, kèm ảnh chụp "Phê Duyệt Giá Bán Lẻ"): "tôi có yêu cầu file giá phải
// được download cả ở trạng thái chưa duyệt và trạng thái đã duyệt để người phê duyệt có thể xem được" —
// đã xác nhận Bán Lẻ (Mua Hàng) hoạt động đúng qua test-itprice-download-filename-code.js có sẵn. File
// này xác nhận THÊM cho Bán Buôn (Vận Hành, priceType='WHOLESALE') — dùng CHUNG code
// (canDownloadPendingFile/itPriceAppliedBadge, module-itsupport-price.js) nhưng cơ chế xác định NGƯỜI
// DUYỆT khác hẳn (itPriceWholesaleStoreMixedApprovalRules thay vì itPriceDeptWorkflows) nên cần kiểm
// riêng, không suy luận từ kết quả Bán Lẻ.
//
// Chạy: node server/tests/test-itprice-wholesale-pending-download.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert } = require('./testHarness');

const PORT = 8991;

const PROPOSER = { username: 'vh_proposer', name: 'Người Đề Xuất VH', dept: 'Phòng Vận Hành (HO)', perms: {}, active: true };
const GD_A = { username: 'gd.a2', name: 'Giám Đốc Siêu Thị A', dept: 'Siêu Thị A', jobTitle: 'Giám Đốc Siêu Thị', perms: {}, active: true };
const GD_B = { username: 'gd.b2', name: 'Giám Đốc Siêu Thị B', dept: 'Siêu Thị B', jobTitle: 'Giám Đốc Siêu Thị', perms: {}, active: true };

const ITEM = {
  id: 501, code: 'HCRC-VH-ITPG-BB-TEST01', priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5',
  dept: 'Phòng Vận Hành (HO)', creator: 'vh_proposer', creatorName: 'Người Đề Xuất VH',
  createdAt: new Date().toLocaleString('vi-VN'), status: 'PENDING', currentStep: 1,
  history: [], infoRequests: [], applied: false, reason: 'Giảm giá bán buôn thử nghiệm',
  storeScope: { mode: 'OTHER', stores: ['Siêu Thị A'] }, nganhHang: [], wholesaleApplyUnit: 'Thùng',
  files: [{ id: 1, fileUrl: '/uploads/vh-test.xlsx', fileName: 'VH Test Gia Ban Buon.xlsx',
    uploadedBy: 'vh_proposer', uploadedByName: 'Người Đề Xuất VH', uploadedAt: new Date().toLocaleString('vi-VN'),
    columnLabels: [{ key: 'c0', label: 'Mã hàng' }], items: [{ values: { c0: '1' } }] }]
};

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}
async function downloadHref(page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('#itPriceModalFiles a'));
    const dlLink = links.find(a => a.textContent.includes('Tải file gốc'));
    return dlLink ? dlLink.getAttribute('href') : null;
  });
}
async function blockedNoteVisible(page) {
  return page.evaluate(() => (document.getElementById('itPriceModalFiles')?.innerText || '').includes('Chỉ file đã phê duyệt mới tải được'));
}

(async () => {
  const { run, summary } = createRunner();

  const state = createMockState({
    depts: ['Phòng Vận Hành (HO)', 'Siêu Thị A', 'Siêu Thị B'],
    users: [PROPOSER, GD_A, GD_B],
    storeJobTitles: [{ label: 'Giám Đốc Siêu Thị' }],
    workflows: [{ id: 'WF_1STEP_VH', steps: [{ order: 1, name: 'Duyệt' }] }],
    itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_1STEP_VH' } },
    itPriceWholesaleStoreMixedApprovalRules: [
      { id: 1, tier: 'MARGIN_LT5', step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc Siêu Thị', stores: [] }
    ],
    itPriceApprovals: [ITEM]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await run('Người ĐỀ XUẤT (không phải approver) mở modal hồ sơ PENDING -> KHÔNG có link tải, hiện đúng ghi chú chặn', async () => {
      await loginAs(page, PROPOSER);
      await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), ITEM.id);
      await page.waitForTimeout(150);
      const href = await downloadHref(page);
      assert(!href, `Người đề xuất KHÔNG được thấy link tải khi hồ sơ còn PENDING — nhận href: ${href}`);
      assert(await blockedNoteVisible(page), 'Phải hiện đúng ghi chú "Chỉ file đã phê duyệt mới tải được" cho người đề xuất');
      await page.evaluate(() => closeItPriceModal());
    });

    await run('GĐST SIÊU THỊ KHÁC (gd.b, không khớp storeScope) mở modal PENDING -> KHÔNG có link tải', async () => {
      await loginAs(page, GD_B);
      await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), ITEM.id);
      await page.waitForTimeout(150);
      const href = await downloadHref(page);
      assert(!href, `GĐST siêu thị KHÔNG liên quan không được thấy link tải — nhận href: ${href}`);
      await page.evaluate(() => closeItPriceModal());
    });

    await run('Đúng NGƯỜI DUYỆT bước hiện tại (gd.a, GĐST Siêu Thị A) mở modal hồ sơ PENDING -> CÓ link "Tải file gốc"', async () => {
      await loginAs(page, GD_A);
      await page.evaluate((id) => openItPriceModal(id, 'APPROVAL'), ITEM.id);
      await page.waitForTimeout(150);
      const href = await downloadHref(page);
      assert(href, 'Đúng người duyệt bước hiện tại PHẢI thấy link "⬇️ Tải file gốc" dù hồ sơ còn PENDING (Bán Buôn)');
      const url = new URL(href, 'http://localhost');
      assert(url.searchParams.get('name') === `${ITEM.code} - ${ITEM.files[0].fileName}`,
        'Tên file tải về phải cộng đúng mã phiếu đằng trước, giống hệt Bán Lẻ');
      await page.evaluate(() => closeItPriceModal());
    });

    await run('Sau khi gd.a DUYỆT (APPROVED) -> link "Tải file gốc" vẫn còn, cho CẢ người đề xuất xem lại', async () => {
      await page.evaluate(async (id) => { await approveItPriceConfirmed(id); }, ITEM.id);
      await page.waitForTimeout(150);
      await page.evaluate((id) => openItPriceModal(id, 'VIEW'), ITEM.id);
      await page.waitForTimeout(150);
      const href = await downloadHref(page);
      assert(href, 'Sau khi APPROVED, link "⬇️ Tải file gốc" vẫn phải còn cho đúng người vừa duyệt (gd.a)');
      await page.evaluate(() => closeItPriceModal());

      await loginAs(page, PROPOSER);
      await page.evaluate((id) => openItPriceModal(id, 'VIEW'), ITEM.id);
      await page.waitForTimeout(150);
      const hrefProposer = await downloadHref(page);
      assert(hrefProposer, 'Sau khi APPROVED, người đề xuất cũng phải tải được file ĐÃ DUYỆT (không còn bị chặn như lúc PENDING)');
      await page.evaluate(() => closeItPriceModal());
    });
  } finally {
    await browser.close();
    server.close();
  }

  summary();
})().catch((err) => { console.error(err); process.exit(1); });
