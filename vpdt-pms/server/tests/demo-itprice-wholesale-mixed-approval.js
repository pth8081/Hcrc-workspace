// server/tests/demo-itprice-wholesale-mixed-approval.js
//
// DEMO thật (Playwright, chụp ảnh — không phải test tự động) cho tính năng "🏪 QT Giá Bán Buôn (Siêu
// Thị)" (10/2026, theo yêu cầu người dùng "xây tính năng tự khớp đúng siêu thị cho người duyệt Phê
// Duyệt Giá Bán Buôn", CÙNG CƠ CHẾ "🏬 Quy Trình Đặt Hàng Siêu Thị" đã có từ trước cho operationOrders
// STORE). Chụp đủ các bước để xác nhận:
//   1. Màn "🔄 Quy Trình & Phê Duyệt" (mục Phê Duyệt Giá Bán Buôn) giờ hiện ĐÚNG banner cảnh báo
//      "KHÔNG còn tác dụng" — LỖI THẬT phát hiện VÀ VÁ ngay khi người dùng hỏi lại (trước đó chỉ
//      OPERATION_ORDER_STORE có banner này, ITPRICE_WHOLESALE bị sót).
//   2. Sub-tab MỚI "🏪 QT Giá Bán Buôn (Siêu Thị)" (Nghiệp Vụ Nâng Cao) — y hệt khuôn UI "🏬 Quy Trình
//      Đặt Hàng Siêu Thị" (chụp cả 2 để so sánh trực quan), chỉ thêm dropdown "Đang xem Mức".
//   3. Thêm 1 dòng "Chức danh" + Mặc định (không khai siêu thị) qua UI thật (gõ/chọn/bấm, không chọt
//      tay vào DB) -> lưu thành công, hiện đúng trong bảng.
//   4. Kịch bản nghiệp vụ: GĐST Siêu Thị A duyệt được đề xuất Bán Buôn của Siêu Thị A; GĐST Siêu Thị B
//      (CÙNG chức danh, dept khác) KHÔNG duyệt được — xác nhận đúng hành vi mới đã mô tả với người dùng.
//
// Chạy: node server/tests/demo-itprice-wholesale-mixed-approval.js
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');
const { applyWorkflowAction } = require('../lib/workflowEngine');

const PORT = 8998;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'itprice-wholesale-mixed-approval');

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };
const GD_A = { username: 'gd.a', name: 'Nguyễn Văn A', dept: 'Siêu Thị Quận 1', jobTitle: 'Giám Đốc siêu thị', perms: {}, active: true };
const GD_B = { username: 'gd.b', name: 'Trần Thị B', dept: 'Siêu Thị Quận 7', jobTitle: 'Giám Đốc siêu thị', perms: {}, active: true };

const state = createMockState({
  depts: ['Ban Giám Đốc'],
  stores: ['Siêu Thị Quận 1', 'Siêu Thị Quận 7'],
  storeJobTitles: [{ label: 'Giám Đốc siêu thị' }],
  jobTitles: [],
  users: [ADMIN, GD_A, GD_B],
  workflows: [{ id: 'wf-tier-a', name: 'Duyệt 1 bước', steps: [{ order: 1, name: 'Duyệt' }] }],
  itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'wf-tier-a' } },
  itPriceWholesaleStoreMixedApprovalRules: []
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
  await page.setViewportSize({ width: 1200, height: 1400 });

  try {
    await loginAs(page, ADMIN);

    // testHarness KHÔNG mô phỏng generic POST /api/data/:key — chỉ cần "lưu thành công" cho đúng 1 key
    // demo này dùng tới.
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

    // ===== 1) "🔄 Quy Trình & Phê Duyệt" (mục Phê Duyệt Giá Bán Buôn) — banner cảnh báo MỚI vá =====
    await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('WORKFLOW'); switchWfModule('ITPRICE_WHOLESALE'); });
    await page.waitForTimeout(150);
    const bannerCheck = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasNewSubTabName: text.includes('QT Giá Bán Buôn (Siêu Thị)'),
        // Đợt "Dọn UI chết" (10/2026): banner đổi từ "...KHÔNG còn tác dụng" (coi như vẫn còn hiện UI
        // chết bên dưới) sang "Màn này chỉ còn dùng để..." VÌ picker người duyệt/"Theo vị trí" nay ẨN
        // HẲN luôn (không chỉ cảnh báo) — kiểm thêm picker THẬT KHÔNG còn trong DOM.
        hasNoEffectNote: text.includes('Màn này chỉ còn dùng để'),
        pickerHidden: !document.querySelector('[id^="wfTierApproverPicker_"]')
      };
    });
    console.log('01: "Quy Trình & Phê Duyệt" (Phê Duyệt Giá Bán Buôn) — banner cảnh báo mới:', JSON.stringify(bannerCheck));
    if (!bannerCheck.hasNewSubTabName || !bannerCheck.hasNoEffectNote || !bannerCheck.pickerHidden) throw new Error('Banner cảnh báo/ẩn picker chưa đúng — kiểm tra lại module-itsupport-tier.js');
    await shot(page, '01-canh-bao-khong-con-tac-dung-o-quy-trinh-phe-duyet');

    // ===== 2) So sánh: "🏬 Quy Trình Đặt Hàng Siêu Thị" (cơ chế gốc, đã có từ trước) =====
    await page.evaluate(async () => { setSystemSubTab('ADVWORKFLOW'); setAdvWorkflowSubTab('MIXED'); });
    await page.waitForTimeout(150);
    console.log('\n02: "🏬 Quy Trình Đặt Hàng Siêu Thị" (cơ chế GỐC, operationOrders STORE) — màn tham khảo để so sánh.');
    await shot(page, '02-co-che-goc-dat-hang-sieu-thi');

    // ===== 3) Sub-tab MỚI "🏪 QT Giá Bán Buôn (Siêu Thị)" — rỗng ban đầu =====
    await page.evaluate(async () => { setAdvWorkflowSubTab('ITPRICE_MIXED'); });
    await page.waitForTimeout(150);
    console.log('\n03: "🏪 QT Giá Bán Buôn (Siêu Thị)" — màn MỚI, cùng khuôn UI, thêm dropdown "Đang xem Mức".');
    await shot(page, '03-man-moi-qt-gia-ban-buon-rong');

    // ===== 4) Thêm 1 dòng "Chức danh" + Mặc định qua UI thật =====
    await page.fill('#ipmaNewJobTitleInput', 'Giám Đốc siêu thị — Siêu Thị');
    await page.click('#ipmaSubmitBtn');
    await page.waitForTimeout(200);
    const rulesAfterAdd = await page.evaluate(() => DB.itPriceWholesaleStoreMixedApprovalRules);
    console.log('04: Thêm dòng "Giám Đốc siêu thị" (Mặc định, Mức MARGIN_LT5, Bước 1) qua UI -> DB:', JSON.stringify(rulesAfterAdd));
    if (rulesAfterAdd.length !== 1 || rulesAfterAdd[0].jobTitle !== 'Giám Đốc siêu thị') throw new Error('Thêm dòng qua UI không ra đúng kết quả mong đợi');
    await shot(page, '04-them-dong-giam-doc-sieu-thi-qua-ui');

    // ===== 5) Kịch bản nghiệp vụ thật: GĐST A duyệt được đề xuất của A, GĐST B KHÔNG duyệt được =====
    const appData = {
      workflows: state.workflows, users: state.users,
      itPriceTierWorkflows: state.itPriceTierWorkflows,
      itPriceWholesaleStoreMixedApprovalRules: rulesAfterAdd
    };
    function wholesaleItem(dept) {
      return { id: 1, priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5', dept, creator: 'proposer', creatorName: 'Người Đề Xuất', status: 'PENDING', currentStep: 1, history: [], files: [], applied: false };
    }
    const resultA = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item: wholesaleItem('Siêu Thị Quận 1'), action: 'APPROVE', user: GD_A, comment: '', appData });
    console.log(`\n05a: GĐST Siêu Thị Quận 1 (gd.a) duyệt đề xuất CỦA ĐÚNG siêu thị mình -> ${resultA.item.status} ✅`);
    let blockedForB = null;
    try {
      applyWorkflowAction({ moduleKey: 'itPriceApprovals', item: wholesaleItem('Siêu Thị Quận 1'), action: 'APPROVE', user: GD_B, comment: '', appData });
    } catch (err) { blockedForB = err; }
    console.log(`05b: GĐST Siêu Thị Quận 7 (gd.b, CÙNG chức danh "Giám Đốc siêu thị") thử duyệt đề xuất của Siêu Thị Quận 1 -> ${blockedForB ? `CHẶN 403 ✅ ("${blockedForB.message}")` : 'LỖI: KHÔNG bị chặn!'}`);
    if (!blockedForB || blockedForB.status !== 403) throw new Error('GĐST siêu thị khác đáng lẽ phải bị chặn 403 nhưng không');

    console.log('\n✅ Demo hoàn tất — ảnh lưu ở:', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
