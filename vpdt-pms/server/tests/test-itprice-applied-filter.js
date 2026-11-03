// server/tests/test-itprice-applied-filter.js
//
// Theo yêu cầu người dùng (11/2026, kèm ảnh chụp màn "Phê Duyệt Giá" — Mua Hàng): "Cột áp giá hiện
// trạng thái 'Hoàn thành (tên người thực hiện)' và 'Chưa hoàn thành'. Thêm lọc 'Chưa hoàn thành' và
// 'Hoàn thành' để filter dữ liệu kiểm tra chính xác hơn các yêu cầu chưa thực hiện hoặc thực hiện rồi" —
// áp dụng cho CẢ 3 màn (Mua Hàng-Bán Lẻ, Vận Hành-Bán Buôn, Hỗ Trợ IT), cùng gốc
// itPriceAppliedBadge()/itPriceAppliedFilterMatches() (module-itsupport-price.js).
//
// Chạy: node server/tests/test-itprice-applied-filter.js
'use strict';
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8992;
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

function mkItem(id, code, priceType, status, extra) {
  return {
    id, code, priceType, dept: 'Kinh Doanh', creator: 'nv', creatorName: 'Nhân Viên',
    createdAt: new Date().toLocaleString('vi-VN'), status, currentStep: status === 'PENDING' ? 1 : 2,
    history: [], infoRequests: [], applied: false, reason: 'test', storeScope: { stores: [] },
    files: [{ id: 1, fileUrl: '/uploads/t.xlsx', fileName: 't.xlsx', uploadedBy: 'nv', uploadedByName: 'Nhân Viên',
      uploadedAt: new Date().toLocaleString('vi-VN'), columnLabels: [{ key: 'c0', label: 'Mã' }], items: [{ values: { c0: '1' } }] }],
    ...extra
  };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- ' + detail : ''}`); }
}

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}
async function rowCount(page, selector) {
  return page.evaluate((sel) => document.querySelectorAll(sel + ' tbody tr').length, selector);
}

(async () => {
  const ITEMS = [
    mkItem(1, 'C-PENDING', 'RETAIL', 'PENDING', {}),
    mkItem(2, 'C-UNCLAIMED', 'RETAIL', 'APPROVED', {}),
    mkItem(3, 'C-CLAIMED', 'RETAIL', 'APPROVED', { applyClaimedBy: 'it1', applyClaimedByName: 'IT Một' }),
    mkItem(4, 'C-DONE', 'RETAIL', 'APPROVED', { applied: true, appliedByName: 'IT Hai' })
  ];
  const state = createMockState({
    depts: ['Kinh Doanh'],
    users: [ADMIN],
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Phê duyệt' }] }],
    itPriceDeptWorkflows: { 'Kinh Doanh': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } },
    itPriceApprovals: ITEMS
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await loginAs(page, ADMIN);

    // ---------- Badge wording (itPriceAppliedBadge) ----------
    const badges = await page.evaluate(() => {
      const items = DB.itPriceApprovals;
      return items.map(i => itPriceAppliedBadge(i));
    });
    check('PENDING (chưa duyệt) -> "—" (không hiện Hoàn thành/Chưa hoàn thành)', badges[0].includes('—') && !badges[0].includes('Hoàn thành'));
    check('APPROVED chưa ai nhận -> "Chưa hoàn thành" (không có "đang xử lý")', badges[1].includes('Chưa hoàn thành') && !badges[1].includes('đang xử lý'));
    check('APPROVED đang có người nhận (applyClaimedBy) -> "Chưa hoàn thành — đang xử lý (IT Một)"', badges[2].includes('Chưa hoàn thành') && badges[2].includes('đang xử lý') && badges[2].includes('IT Một'));
    check('APPROVED đã áp giá xong (applied) -> "Hoàn thành (IT Hai)"', badges[3].includes('Hoàn thành') && badges[3].includes('IT Hai') && !badges[3].includes('Chưa hoàn thành'));

    // ---------- Filter: Mua Hàng (Bán Lẻ) ----------
    await page.evaluate(async () => { await switchTab('muaHang'); setPurchasingSubTab('ITPRICE'); });
    await page.waitForTimeout(150);
    check('Mua Hàng mặc định (không lọc): hiện đủ 4 dòng', await rowCount(page, '#mhItPriceTableBody') === 4 || (await page.evaluate(() => document.getElementById('mhItPriceTableBody').children.length)) === 4);

    await page.evaluate(() => { document.getElementById('filterAppliedMhItPrice').value = 'DONE'; onMhItPriceFilterChange(); });
    await page.waitForTimeout(100);
    let codes = await page.evaluate(() => Array.from(document.querySelectorAll('#mhItPriceTableBody tr')).map(tr => tr.querySelector('td')?.innerText || ''));
    check('Mua Hàng lọc "Hoàn thành" -> CHỈ còn C-DONE', codes.length === 1 && codes[0].includes('C-DONE'), JSON.stringify(codes));

    await page.evaluate(() => { document.getElementById('filterAppliedMhItPrice').value = 'PENDING'; onMhItPriceFilterChange(); });
    await page.waitForTimeout(100);
    codes = await page.evaluate(() => Array.from(document.querySelectorAll('#mhItPriceTableBody tr')).map(tr => tr.querySelector('td')?.innerText || ''));
    check('Mua Hàng lọc "Chưa hoàn thành" -> ĐÚNG 2 dòng (C-UNCLAIMED + C-CLAIMED), KHÔNG có C-PENDING/C-DONE',
      codes.length === 2 && codes.some(c => c.includes('C-UNCLAIMED')) && codes.some(c => c.includes('C-CLAIMED')), JSON.stringify(codes));

    await page.evaluate(() => resetMhItPriceFilters());
    await page.waitForTimeout(100);
    const afterReset = await page.evaluate(() => document.getElementById('filterAppliedMhItPrice').value);
    check('resetMhItPriceFilters() xoá luôn filterAppliedMhItPrice', afterReset === '');

    // ---------- Filter: Vận Hành (Bán Buôn) ----------
    await page.evaluate(async (items) => {
      await switchTab('vanHanh');
      DB.itPriceApprovals = items.map(i => ({ ...i, priceType: 'WHOLESALE' }));
      setVanHanhSubTab('ITPRICE');
    }, ITEMS);
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.getElementById('filterAppliedVanHanhItPrice').value = 'DONE'; onVanHanhItPriceFilterChange(); });
    await page.waitForTimeout(100);
    codes = await page.evaluate(() => Array.from(document.querySelectorAll('#vanHanhItPriceTableBody tr')).map(tr => tr.querySelector('td')?.innerText || ''));
    check('Vận Hành lọc "Hoàn thành" -> CHỈ còn C-DONE', codes.length === 1 && codes[0].includes('C-DONE'), JSON.stringify(codes));

    // ---------- Filter: Hỗ Trợ IT ----------
    await page.evaluate(async (items) => {
      await switchTab('itSupport');
      DB.itPriceApprovals = items;
      setItSupportSubTab('PRICE');
      setItPriceSubTab('RETAIL');
    }, ITEMS);
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.getElementById('filterAppliedItPrice').value = 'PENDING'; onItPriceFilterChange(); });
    await page.waitForTimeout(100);
    codes = await page.evaluate(() => Array.from(document.querySelectorAll('#itPriceTableBody tr')).map(tr => tr.querySelector('td')?.innerText || ''));
    check('Hỗ Trợ IT lọc "Chưa hoàn thành" -> ĐÚNG 2 dòng (C-UNCLAIMED + C-CLAIMED)',
      codes.length === 2 && codes.some(c => c.includes('C-UNCLAIMED')) && codes.some(c => c.includes('C-CLAIMED')), JSON.stringify(codes));

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
