// server/tests/demo-mixed-approval-secondary-jobtitle.js
//
// DEMO thật (Playwright, chụp ảnh — không phải test tự động), theo báo cáo người dùng (11/2026):
// "Loan giữ chức danh kiêm nhiệm 'Thẩm định FMCG 2' ở Cấu Hình Quy Trình Nâng Cao (QT Giá Bán Buôn) nhưng
// khi Xem Trước Quy Trình, Bước 1 KHÔNG hiện Loan dù chọn đúng ngành hàng Loan phụ trách — chỉ hiện người
// theo Siêu Thị". Nguyên nhân thật (đã điều tra qua test + trao đổi với người dùng, xem
// tests/test-mixed-approval-secondary-jobtitle.js cho bộ test logic đầy đủ): hàm khớp approver trước đây
// yêu cầu CHỨC DANH CHÍNH của người đó phải bằng rule.jobTitle TRƯỚC KHI xét "Vị Trí Kiêm Nhiệm" — người
// giữ chức danh ĐÓ hoàn toàn dưới dạng kiêm nhiệm (chức danh chính là thứ khác hẳn) không bao giờ khớp.
//
// Demo này dựng lại CHÍNH XÁC kịch bản Loan qua UI thật:
//   1. Đăng nhập admin, vào Cấu Hình Quy Trình Nâng Cao > QT Giá Bán Buôn — thêm 2 dòng Bước 1 qua UI
//      thật: (a) "Giám đốc Siêu thị" Mặc định (mọi ngành hàng), (b) "Thẩm định FMCG 2" chỉ áp dụng ngành
//      hàng "Nông sản..." — Loan giữ chức danh này CHỈ qua Vị Trí Kiêm Nhiệm (chức danh CHÍNH của Loan là
//      "Nhân Viên Mua Hàng", khác hẳn).
//   2. Đăng nhập người đề xuất, mở form "Đề Xuất Duyệt Giá Bán Buôn" (Vận Hành), chọn đúng Siêu Thị +
//      Ngành Hàng "Nông sản...", bấm "🔍 Xem Quy Trình" THẬT — chụp ảnh modal xác nhận Bước 1 giờ hiện
//      ĐÚNG CẢ HAI người (GĐST + Loan).
//   3. Loan đăng nhập, duyệt THẬT bằng callWorkflowAction() (không mock) — xác nhận duyệt được.
//
// Chạy: node server/tests/demo-mixed-approval-secondary-jobtitle.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8992;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'mixed-approval-secondary-jobtitle');

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };
const GDST = { username: 'gdst', name: 'Phạm Thị Liễu', dept: 'Siêu thị 63 Hàng Trống', jobTitle: 'Giám đốc Siêu thị', perms: {}, active: true };
// Loan: chức danh CHÍNH "Nhân Viên Mua Hàng" — "Thẩm định FMCG 2" CHỈ là Vị Trí Kiêm Nhiệm (HO).
const LOAN = {
  username: 'loan', name: 'Loan', dept: 'Phòng Mua Hàng', jobTitle: 'Nhân Viên Mua Hàng', perms: {}, active: true,
  secondaryPositions: [{ jobTitle: 'Thẩm định FMCG 2', dept: 'HO' }]
};
const PROPOSER = { username: 'proposer', name: 'Người Đề Xuất', dept: 'Phòng Mua Hàng', perms: { itPriceProposeCreateWholesale: true }, active: true };

const state = createMockState({
  depts: ['Ban Giám Đốc', 'Phòng Mua Hàng', 'HO'],
  stores: ['Siêu thị 63 Hàng Trống'],
  storeJobTitles: [{ label: 'Giám đốc Siêu thị' }],
  jobTitles: ['Thẩm định FMCG 2'],
  users: [ADMIN, GDST, LOAN, PROPOSER],
  nganhHangCatalog: [
    { id: 1, code: 'NONGSAN', name: 'Nông sản, bột các loại (Farm produce, cooking flours)', dept: '' },
    { id: 2, code: 'FRESH', name: 'Fresh', dept: '' }
  ],
  workflows: [{ id: 'WF_1STEP', name: 'Duyệt 1 bước', steps: [{ order: 1, name: 'GĐ/CHT Siêu thị/Mua hàng' }] }],
  itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_1STEP' } },
  itPriceWholesaleStoreMixedApprovalRules: [],
  itPriceApprovals: []
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function shot(page, name, selector) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  if (selector) await page.locator(selector).screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${file}`);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1400 });

  try {
    await loginAs(page, ADMIN);

    // testHarness không mô phỏng generic POST /api/data/:key — chỉ cần "lưu thành công" cho đúng 1 key
    // demo này dùng tới (mirror các demo mixed-approval trước).
    await page.evaluate(() => {
      const savedFetch = window.fetch;
      const DEMO_OK_KEYS = new Set(['itPriceWholesaleStoreMixedApprovalRules']);
      window.fetch = async (url, opts) => {
        const m = /^\/api\/data\/([^/]+)$/.exec(url);
        if (m && opts?.method === 'POST' && DEMO_OK_KEYS.has(m[1])) {
          return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
        }
        return savedFetch(url, opts);
      };
    });

    // ===== 1) Cấu Hình Quy Trình Nâng Cao > QT Giá Bán Buôn — thêm 2 dòng Bước 1 qua UI thật =====
    await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADVWORKFLOW'); setAdvWorkflowSubTab('ITPRICE_MIXED'); });
    await page.waitForTimeout(150);
    await page.selectOption('#ipmaNewTier', 'MARGIN_LT5');
    await page.waitForTimeout(100);

    // Dòng (a): "Giám đốc Siêu thị" — Mặc định (mọi siêu thị, mọi ngành hàng).
    await page.fill('#ipmaNewJobTitleInput', 'Giám đốc Siêu thị — Siêu Thị');
    await page.click('#ipmaSubmitBtn');
    await page.waitForTimeout(200);

    // Dòng (b): "Thẩm định FMCG 2" — chỉ áp dụng ngành hàng "Nông sản...".  CHÍNH dòng này Loan chỉ giữ
    // qua Vị Trí Kiêm Nhiệm, KHÔNG phải chức danh chính của Loan.
    await page.fill('#ipmaNewJobTitleInput', 'Thẩm định FMCG 2 — HO');
    const nganhHangInput = await page.$('#ipmaNewNganhHangPicker [data-pms-search]');
    await nganhHangInput.click();
    await nganhHangInput.type('Nông sản');
    await page.waitForTimeout(150);
    await page.click('#ipmaNewNganhHangPicker [data-op="gmsAdd"]');
    await page.click('#ipmaSubmitBtn');
    await page.waitForTimeout(200);

    const rulesAfterAdd = await page.evaluate(() => DB.itPriceWholesaleStoreMixedApprovalRules);
    console.log('01: 2 dòng Bước 1 (Mức Margin<5%) sau khi thêm qua UI:', JSON.stringify(rulesAfterAdd, null, 2));
    if (rulesAfterAdd.length !== 2) throw new Error('Phải có đúng 2 dòng sau khi thêm qua UI');
    // fetch mock ở trên chỉ trả ok:true cho POST (không có route "ghi" thật) — tự đồng bộ `state` để lần
    // đăng nhập SAU (proposer/Loan) nhận đúng 2 dòng vừa thêm, không bị initDatabase() ghi đè về rỗng.
    state.itPriceWholesaleStoreMixedApprovalRules = rulesAfterAdd;
    await shot(page, '01-cau-hinh-2-dong-buoc-1', '#itPriceMixedApprovalSection');

    // ===== 2) Form đề xuất Bán Buôn (Vận Hành) — chọn Siêu Thị + đúng ngành hàng Loan phụ trách, bấm
    // "🔍 Xem Quy Trình" THẬT (nút id itPricePreviewWfBtn, hàm previewItPriceWorkflow()) =====
    await loginAs(page, PROPOSER);
    await page.evaluate(async () => { await switchTab('vanHanh'); setVanHanhSubTab('ITPRICE'); openItPriceCreateForm(); });
    await page.waitForTimeout(150);
    await page.selectOption('#itPriceTier', 'MARGIN_LT5');
    const storeInput = await page.$('#itPriceStoreScopeStoresMultiSelect [data-pms-search]');
    await storeInput.click(); await storeInput.type('63 Hàng Trống'); await page.waitForTimeout(150);
    await page.click('#itPriceStoreScopeStoresMultiSelect [data-op="gmsAdd"]');
    const nganhHangFormInput = await page.$('#itPriceNganhHangMultiSelect [data-pms-search]');
    await nganhHangFormInput.click(); await nganhHangFormInput.type('Nông sản'); await page.waitForTimeout(150);
    await page.click('#itPriceNganhHangMultiSelect [data-op="gmsAdd"]');
    await page.waitForTimeout(100);
    await page.click('#itPricePreviewWfBtn');
    await page.waitForTimeout(200);
    await shot(page, '02-xem-truoc-quy-trinh-sau-khi-va', '#viewDocModal');

    const modalText = await page.evaluate(() => document.getElementById('viewModalContent').innerText);
    console.log('\n02: Nội dung modal "Xem Trước Quy Trình":\n' + modalText);
    if (!modalText.includes('Phạm Thị Liễu')) throw new Error('❌ Bước 1 phải có GĐST (Phạm Thị Liễu)');
    if (!modalText.includes('Loan')) throw new Error('❌ LỖI CHƯA VÁ: Bước 1 phải có Loan (chức danh kiêm nhiệm "Thẩm định FMCG 2")');
    console.log('\n✅ XÁC NHẬN: Bước 1 giờ hiện ĐÚNG CẢ HAI người — Phạm Thị Liễu (GĐST, mặc định) VÀ Loan (chức danh "Thẩm định FMCG 2" CHỈ giữ qua Vị Trí Kiêm Nhiệm).');

    // Nộp đề xuất thật để bước 3 (Loan duyệt) có hồ sơ thật để thao tác.
    await page.evaluate(() => {
      itPricePendingFile = {
        fileUrl: '/uploads/demo-secondary-jobtitle.xlsx', fileName: 'demo-secondary-jobtitle.xlsx',
        items: [{ values: { code: 'DEMO01', name: 'Sản phẩm demo', oldPrice: '1000', newPrice: '1200' } }],
        columnLabels: [
          { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
          { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
        ]
      };
    });
    await page.fill('#itPriceWholesaleApplyUnit', 'Công ty TNHH Demo');
    await page.fill('#itPriceEffectiveDate', '2026-11-01');
    await page.click('#viewDocModal button:has-text("Đóng")').catch(() => {});
    await page.click('#itPriceCreateForm button[type="submit"]');
    await page.waitForTimeout(200);
    const created = await page.evaluate(() => DB.itPriceApprovals[0]);
    if (!created) throw new Error('Gửi đề xuất thật thất bại');
    console.log(`\n03: Đã gửi đề xuất thật [${created.code}], ngành hàng = ${JSON.stringify(created.nganhHang)}`);

    // ===== 3) Loan duyệt THẬT (callWorkflowAction() thật, không mock) =====
    await loginAs(page, LOAN);
    const approveResult = await page.evaluate(async (id) => {
      try {
        const result = await callWorkflowAction('itPriceApprovals', id, 'approve', {});
        return { ok: true, status: result.item.status, currentStep: result.item.currentStep };
      } catch (e) { return { ok: false, message: e.message }; }
    }, created.id);
    console.log('\n04: Loan (kiêm nhiệm "Thẩm định FMCG 2") bấm Duyệt ->', JSON.stringify(approveResult));
    if (!approveResult.ok) throw new Error('❌ Loan PHẢI duyệt được thật (là approver hợp lệ qua Vị Trí Kiêm Nhiệm): ' + approveResult.message);
    console.log('\n✅ XÁC NHẬN THÊM: Loan duyệt THẬT thành công (không chỉ hiện đúng ở bản xem trước — luồng duyệt thật cũng đã khớp đúng).');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
