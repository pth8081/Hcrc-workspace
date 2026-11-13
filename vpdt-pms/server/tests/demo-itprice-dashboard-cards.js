// server/tests/demo-itprice-dashboard-cards.js
//
// DEMO (11/2026, theo yêu cầu người dùng kèm ảnh chụp màn "📦 Đơn Hàng": "làm cho vận hành --> giá bán
// buôn và mua hàng --> giá bán lẻ dashboard giống kiểu đơn đặt hàng") — thêm dashboard thẻ-bấm-để-lọc
// (Tổng Đề Xuất/Đang Chờ Duyệt/Đã Phê Duyệt/Bị Từ Chối, cùng khuôn #operationOrderDashboardCards) vào
// CẢ 2 màn tự phục vụ: "💲 Phê Duyệt Giá Bán Buôn" (Vận Hành) và "💲 Phê Duyệt Giá Bán Lẻ" (Mua Hàng).
// Dùng CHUNG buildDashboardCardsHTML()/applyDashboardCardFilter() (core.js) — y hệt cơ chế Hỗ Trợ IT
// (itPriceDashboardCards) đã có từ trước, chỉ khác CỐ ĐỊNH priceType theo đúng màn.
//
// Chạy: node server/tests/demo-itprice-dashboard-cards.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8992;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'itprice-dashboard-cards');
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

function mkItem(id, code, priceType, status) {
  return {
    id, code, priceType, dept: 'Phòng Mua hàng Thực phẩm Tươi sống',
    creator: 'nv_mh', creatorName: 'Phạm Thị Thanh Loan', createdAt: new Date().toLocaleString('vi-VN'),
    status, currentStep: status === 'PENDING' ? 1 : 2, history: [], infoRequests: [], applied: false,
    reason: 'Demo dashboard', storeScope: { stores: [] },
    files: [{ id: 1, fileUrl: '/uploads/demo.xlsx', fileName: 'demo.xlsx',
      uploadedBy: 'nv_mh', uploadedByName: 'Phạm Thị Thanh Loan', uploadedAt: new Date().toLocaleString('vi-VN'),
      columnLabels: [{ key: 'c0', label: 'Mã hàng' }], items: [{ values: { c0: '1001' } }] }]
  };
}

// Mỗi priceType: 1 PENDING, 2 APPROVED, 1 REJECTED -> Tổng=4, Đang Chờ=1, Đã Duyệt=2, Từ Chối=1.
function buildItems(priceType, startId) {
  return [
    mkItem(startId, `CODE-${priceType}-1`, priceType, 'PENDING'),
    mkItem(startId + 1, `CODE-${priceType}-2`, priceType, 'APPROVED'),
    mkItem(startId + 2, `CODE-${priceType}-3`, priceType, 'APPROVED'),
    mkItem(startId + 3, `CODE-${priceType}-4`, priceType, 'REJECTED')
  ];
}

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const state = createMockState({
    depts: ['Phòng Mua hàng Thực phẩm Tươi sống'],
    users: [ADMIN],
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Phê duyệt' }] }],
    itPriceDeptWorkflows: { 'Phòng Mua hàng Thực phẩm Tươi sống': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } },
    itPriceApprovals: [...buildItems('WHOLESALE', 1), ...buildItems('RETAIL', 101)]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);

    // ===== 1) Vận Hành -> "💲 Phê Duyệt Giá Bán Buôn" =====
    await page.evaluate(async () => { await switchTab('vanHanh'); setVanHanhSubTab('ITPRICE'); });
    await page.waitForTimeout(250);
    await shot(page, '#vanHanhSection', '1-van-hanh-gia-ban-buon-dashboard.png');

    const vhCards = await page.evaluate(() => Array.from(document.querySelectorAll('#vanHanhItPriceDashboardCards > div > div')).map(c => {
      const [label, count] = Array.from(c.children).map(x => x.textContent.trim());
      return { label, count };
    }));
    console.log('Vận Hành - thẻ dashboard:', vhCards);
    assert.deepStrictEqual(vhCards, [
      { label: 'Tổng Đề Xuất', count: '4' }, { label: 'Đang Chờ Duyệt', count: '1' },
      { label: 'Đã Phê Duyệt', count: '2' }, { label: 'Bị Từ Chối', count: '1' }
    ], 'LỖI: dashboard Vận Hành phải đúng 4/1/2/1');

    // Bấm thẻ "Đang Chờ Duyệt" -> chỉ còn 1 dòng, thẻ tô sáng đúng.
    await page.click('[data-op="filterVanHanhItPriceByCard"][data-arg0="PENDING"]');
    await page.waitForTimeout(150);
    const vhRowsAfterPending = await page.evaluate(() => document.querySelectorAll('#vanHanhItPriceTableBody tr').length);
    assert.strictEqual(vhRowsAfterPending, 1, 'LỖI: bấm thẻ "Đang Chờ Duyệt" (Vận Hành) phải còn đúng 1 dòng');
    await shot(page, '#vanHanhSection', '2-van-hanh-bam-the-dang-cho-duyet.png');
    console.log('PASS: Vận Hành - bấm thẻ "Đang Chờ Duyệt" -> lọc đúng 1 dòng');

    await page.click('[data-op="filterVanHanhItPriceByCard"][data-arg0=""]');
    await page.waitForTimeout(150);

    // ===== 2) Mua Hàng -> "💲 Phê Duyệt Giá Bán Lẻ" =====
    await page.evaluate(async () => { await switchTab('muaHang'); setPurchasingSubTab('ITPRICE'); });
    await page.waitForTimeout(250);
    await shot(page, '#muaHangSection', '3-mua-hang-gia-ban-le-dashboard.png');

    const mhCards = await page.evaluate(() => Array.from(document.querySelectorAll('#mhItPriceDashboardCards > div > div')).map(c => {
      const [label, count] = Array.from(c.children).map(x => x.textContent.trim());
      return { label, count };
    }));
    console.log('Mua Hàng - thẻ dashboard:', mhCards);
    assert.deepStrictEqual(mhCards, [
      { label: 'Tổng Đề Xuất', count: '4' }, { label: 'Đang Chờ Duyệt', count: '1' },
      { label: 'Đã Phê Duyệt', count: '2' }, { label: 'Bị Từ Chối', count: '1' }
    ], 'LỖI: dashboard Mua Hàng phải đúng 4/1/2/1');

    await page.click('[data-op="filterMhItPriceByCard"][data-arg0="APPROVED"]');
    await page.waitForTimeout(150);
    const mhRowsAfterApproved = await page.evaluate(() => document.querySelectorAll('#mhItPriceTableBody tr').length);
    assert.strictEqual(mhRowsAfterApproved, 2, 'LỖI: bấm thẻ "Đã Phê Duyệt" (Mua Hàng) phải còn đúng 2 dòng');
    await shot(page, '#muaHangSection', '4-mua-hang-bam-the-da-phe-duyet.png');
    console.log('PASS: Mua Hàng - bấm thẻ "Đã Phê Duyệt" -> lọc đúng 2 dòng');

    // ===== 3) Xác nhận 2 màn ĐỘC LẬP — dashboard Vận Hành (Bán Buôn) KHÔNG lẫn đếm của Mua Hàng (Bán Lẻ). =====
    await page.evaluate(async () => { await switchTab('vanHanh'); setVanHanhSubTab('ITPRICE'); });
    await page.waitForTimeout(200);
    const vhTotalAfter = await page.evaluate(() => document.querySelector('#vanHanhItPriceDashboardCards > div > div')?.children[1]?.textContent.trim());
    assert.strictEqual(vhTotalAfter, '4', 'LỖI: quay lại Vận Hành, thẻ Tổng Đề Xuất vẫn phải là 4 (KHÔNG lẫn Bán Lẻ)');
    console.log('PASS: 2 màn độc lập — đổi/lọc ở Mua Hàng không ảnh hưởng dashboard Vận Hành');

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh: ' + jsErrors.join('\n'));
    console.log('PASS: Không có lỗi console.error/pageerror nào trong suốt quá trình thao tác THẬT');

    console.log('\n==== 6/6 scenario(s) passed ====');
    console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
