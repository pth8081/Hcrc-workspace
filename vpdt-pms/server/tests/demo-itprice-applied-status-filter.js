// server/tests/demo-itprice-applied-status-filter.js
//
// DEMO thật (không phải bộ hồi quy tự động) — chụp ảnh tính năng MỚI theo yêu cầu người dùng (11/2026,
// ảnh chụp màn "Phê Duyệt Giá" - Mua Hàng): "Cột áp giá hiện trạng thái 'Hoàn thành (tên người thực
// hiện)' và 'Chưa hoàn thành'. Thêm lọc 'Chưa hoàn thành' và 'Hoàn thành' để filter dữ liệu kiểm tra
// chính xác hơn các yêu cầu chưa thực hiện hoặc thực hiện rồi" — áp dụng cho CẢ 3 màn (Mua Hàng-Bán Lẻ,
// Vận Hành-Bán Buôn, Hỗ Trợ IT), chung 1 gốc (itPriceAppliedBadge()/itPriceAppliedFilterMatches(),
// module-itsupport-price.js). Demo này CHỤP CẢ 3 MÀN, mỗi màn chụp 3 lượt (mặc định, lọc "Hoàn thành",
// lọc "Chưa hoàn thành") để người dùng xác nhận trước khi merge.
//
// Chạy: node server/tests/demo-itprice-applied-status-filter.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'itprice-applied-status-filter');
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

function mkItem(id, code, priceType, status, extra) {
  return {
    id, code, priceType, dept: 'Phòng Mua hàng Thực phẩm Tươi sống',
    creator: 'nv_mh', creatorName: 'Phạm Thị Thanh Loan', createdAt: new Date().toLocaleString('vi-VN'),
    status, currentStep: status === 'PENDING' ? 1 : 2, history: [], infoRequests: [], applied: false,
    reason: 'Gia hạn khuyến mãi tháng 11', storeScope: { stores: [] },
    files: [{ id: 1, fileUrl: '/uploads/demo.xlsx', fileName: 'Gia han khuyen mai 11.xlsx',
      uploadedBy: 'nv_mh', uploadedByName: 'Phạm Thị Thanh Loan', uploadedAt: new Date().toLocaleString('vi-VN'),
      columnLabels: [{ key: 'c0', label: 'Mã hàng' }], items: [{ values: { c0: '1001' } }] }],
    ...extra
  };
}

const ITEMS = [
  mkItem(1, 'HCRC-MHTPTS-ITPG-BL-021', 'RETAIL', 'PENDING', {}),
  mkItem(2, 'HCRC-MHTPTS-ITPG-BL-020', 'RETAIL', 'APPROVED', {}),
  mkItem(3, 'HCRC-MHTPTS-ITPG-BL-019', 'RETAIL', 'APPROVED', {
    applyClaimedBy: 'it_staff', applyClaimedByName: 'Nguyễn Văn Hỗ Trợ', applyClaimedAt: new Date().toLocaleString('vi-VN')
  }),
  mkItem(4, 'HCRC-MHTPTS-ITPG-BL-018', 'RETAIL', 'APPROVED', {
    applied: true, appliedByName: 'Trần Thị Hỗ Trợ IT', appliedAt: new Date().toLocaleString('vi-VN')
  })
];

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
    depts: ['Phòng Mua hàng Thực phẩm Tươi sống'],
    users: [ADMIN, { username: 'nv_mh', name: 'Phạm Thị Thanh Loan', dept: 'Phòng Mua hàng Thực phẩm Tươi sống', perms: {}, active: true },
      { username: 'it_staff', name: 'Nguyễn Văn Hỗ Trợ', dept: 'Phòng IT', perms: { itPriceSupport: true }, active: true }],
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Phê duyệt' }] }],
    itPriceDeptWorkflows: { 'Phòng Mua hàng Thực phẩm Tươi sống': { workflowId: 'WF_1STEP', approvers: { 1: ['nv_mh'] } } },
    itPriceApprovals: ITEMS
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await loginAs(page, ADMIN);

    // ---------- Màn 1: Mua Hàng (Bán Lẻ) ----------
    await page.evaluate(async () => { await switchTab('muaHang'); setPurchasingSubTab('ITPRICE'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.querySelector('#muaHangSection details.filter-box-details')?.setAttribute('open', ''); });
    await page.waitForTimeout(100);
    await shot(page, '#muaHangSection', '1-mua-hang-ban-le-mac-dinh.png');

    await page.evaluate(() => { document.getElementById('filterAppliedMhItPrice').value = 'DONE'; onMhItPriceFilterChange(); });
    await page.waitForTimeout(150);
    await shot(page, '#muaHangSection', '2-mua-hang-loc-hoan-thanh.png');

    await page.evaluate(() => { document.getElementById('filterAppliedMhItPrice').value = 'PENDING'; onMhItPriceFilterChange(); });
    await page.waitForTimeout(150);
    await shot(page, '#muaHangSection', '3-mua-hang-loc-chua-hoan-thanh.png');
    await page.evaluate(() => resetMhItPriceFilters());

    // ---------- Màn 2: Vận Hành (Bán Buôn) — dùng lại 4 item, đổi priceType ----------
    await page.evaluate(async (items) => {
      await switchTab('vanHanh');
      DB.itPriceApprovals = items.map(i => ({ ...i, priceType: 'WHOLESALE' }));
      setVanHanhSubTab('ITPRICE');
    }, ITEMS);
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.querySelector('#vanHanhSection details.filter-box-details')?.setAttribute('open', ''); });
    await page.waitForTimeout(100);
    await shot(page, '#vanHanhSection', '4-van-hanh-ban-buon-mac-dinh.png');

    await page.evaluate(() => { document.getElementById('filterAppliedVanHanhItPrice').value = 'DONE'; onVanHanhItPriceFilterChange(); });
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhSection', '5-van-hanh-loc-hoan-thanh.png');
    await page.evaluate(() => resetVanHanhItPriceFilters());

    // ---------- Màn 3: Hỗ Trợ IT (cả Bán Lẻ + Bán Buôn qua 2 sub-tab con) ----------
    await page.evaluate(async (items) => {
      await switchTab('itSupport');
      DB.itPriceApprovals = [...items, ...items.map(i => ({ ...i, id: i.id + 100, priceType: 'WHOLESALE' }))];
      setItSupportSubTab('PRICE');
      setItPriceSubTab('RETAIL');
    }, ITEMS);
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.querySelector('#itSupportSection details.filter-box-details')?.setAttribute('open', ''); });
    await page.waitForTimeout(100);
    await shot(page, '#itSupportSection', '6-ho-tro-it-mac-dinh.png');

    await page.evaluate(() => { document.getElementById('filterAppliedItPrice').value = 'PENDING'; onItPriceFilterChange(); });
    await page.waitForTimeout(150);
    await shot(page, '#itSupportSection', '7-ho-tro-it-loc-chua-hoan-thanh.png');

    console.log('\n✅ Đã chụp xong demo — xem thư mục', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})();
