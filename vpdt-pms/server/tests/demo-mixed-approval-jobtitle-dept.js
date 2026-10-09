// server/tests/demo-mixed-approval-jobtitle-dept.js
//
// DEMO thật (Playwright, chụp ảnh — không phải test tự động) cho tính năng "ghép đúng người theo (chức
// danh, phòng ban) HO" (10/2026, v25.51) — theo yêu cầu người dùng nguyên văn: "tôi lấy vị trí chức danh
// trong quy trình đặc biệt được không? Tôi muốn ghép đúng người thay vì vị trí đang lấy là HO (ví dụ
// trưởng phòng HO thì có nhiều Tp lắm)".
//
// Kịch bản dữ liệu: công ty có 2 "Trưởng phòng" ở 2 phòng ban KHÁC NHAU (Phòng CNTT/Phòng Kinh Doanh) —
// trước đợt vá này, chọn chức danh "Trưởng phòng" ở "🏬 Quy Trình Đặt Hàng Siêu Thị"/"🏪 QT Giá Bán Buôn
// (Siêu Thị)" sẽ khớp NHẦM CẢ 2 người (hoặc không ai cả, tuỳ chế độ Mặc định/Ngoại lệ). Demo chụp đủ:
//   1. Cả 2 màn admin — ô "Chức Danh" nay gợi ý THÊM cặp (chức danh, phòng ban) từ "🧭 Vị Trí Tham Gia
//      Quy Trình" (CỘNG THÊM, không mất lựa chọn chức danh HO trơn cũ).
//   2. Thêm 1 dòng chọn ĐÚNG cặp "Trưởng phòng — Phòng CNTT" qua UI thật (gõ/chọn/bấm) trên CẢ 2 màn —
//      bảng hiện badge "🏢 HO — Phòng CNTT" (khác hẳn badge "🏢 HO" trơn của dòng không gán phòng ban).
//   3. Kịch bản nghiệp vụ thật: Trưởng Phòng CNTT duyệt được; Trưởng Phòng Kinh Doanh (CÙNG chức danh,
//      KHÁC phòng ban) bị chặn 403 — xác nhận đúng hành vi mới đã mô tả với người dùng, cho CẢ 2 quy
//      trình (Đặt Hàng Siêu Thị VÀ Phê Duyệt Giá Bán Buôn).
//
// Chạy: node server/tests/demo-mixed-approval-jobtitle-dept.js
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');
const { applyWorkflowAction } = require('../lib/workflowEngine');

const PORT = 8999;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'mixed-approval-jobtitle-dept');

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };
const TP_CNTT = { username: 'tp.cntt', name: 'Lê Văn Phúc', dept: 'Phòng CNTT', jobTitle: 'Trưởng phòng', perms: {}, active: true };
const TP_KD = { username: 'tp.kd', name: 'Nguyễn Thị Hoa', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng phòng', perms: {}, active: true };

const state = createMockState({
  depts: ['Ban Giám Đốc', 'Phòng CNTT', 'Phòng Kinh Doanh'],
  stores: ['Siêu Thị Quận 1', 'Siêu Thị Quận 7'],
  jobTitles: ['Trưởng phòng'],
  storeJobTitles: [],
  // "🧭 Vị Trí Tham Gia Quy Trình" — danh mục nguồn gợi ý cặp (chức danh, phòng ban) MỚI dùng cho cả 2 màn.
  workflowParticipatingPositions: [
    { jobTitle: 'Trưởng phòng', dept: 'Phòng CNTT' },
    { jobTitle: 'Trưởng phòng', dept: 'Phòng Kinh Doanh' }
  ],
  users: [ADMIN, TP_CNTT, TP_KD],
  workflows: [{ id: 'wf-1step', name: 'Duyệt 1 bước', steps: [{ order: 1, name: 'Duyệt' }] }],
  operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'wf-1step' } },
  operationOrderHOTierWorkflows: {},
  operationOrderStoreMixedApprovalRules: [],
  itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'wf-1step' } },
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
  await page.setViewportSize({ width: 1280, height: 1500 });

  try {
    await loginAs(page, ADMIN);

    // testHarness KHÔNG mô phỏng generic POST /api/data/:key — cho "lưu thành công" đúng 2 key demo này dùng.
    await page.evaluate(() => {
      const savedFetch = window.fetch;
      const DEMO_OK_KEYS = new Set(['operationOrderStoreMixedApprovalRules', 'itPriceWholesaleStoreMixedApprovalRules']);
      window.fetch = async (url, opts) => {
        const m = /^\/api\/data\/([^/]+)$/.exec(url);
        if (m && opts?.method === 'POST' && DEMO_OK_KEYS.has(m[1])) {
          return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true }) };
        }
        return savedFetch(url, opts);
      };
    });

    // ===== 1) "🏬 Quy Trình Đặt Hàng Siêu Thị" — màn rỗng ban đầu =====
    await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADVWORKFLOW'); setAdvWorkflowSubTab('MIXED'); });
    await page.waitForTimeout(150);
    console.log('01: "🏬 Quy Trình Đặt Hàng Siêu Thị" — màn rỗng ban đầu.');
    await shot(page, '01-dat-hang-sieu-thi-rong');

    // ===== 2) Mở form Thêm Dòng, chọn Kiểu "Chức danh", gõ xem gợi ý mới =====
    await page.selectOption('#maNewMode', 'JOBTITLE');
    await page.evaluate(() => onMixedApprovalNewModeChange());
    const optsCheck = await page.evaluate(() => mixedApprovalJobTitleOptions());
    console.log('02: Gợi ý chức danh hiện có (gộp phẳng + cặp phòng ban):', JSON.stringify(optsCheck));
    if (!optsCheck.includes('Trưởng phòng — HO') || !optsCheck.includes('Trưởng phòng — Phòng CNTT — HO') || !optsCheck.includes('Trưởng phòng — Phòng Kinh Doanh — HO')) {
      throw new Error('Gợi ý chức danh chưa đủ (thiếu cặp phòng ban hoặc mất chức danh phẳng cũ)');
    }
    await page.fill('#maNewJobTitleInput', 'Trưởng phòng — Phòng CNTT — HO');
    await shot(page, '02-go-chon-dung-cap-phong-ban');

    // ===== 3) Bấm "+ Thêm Dòng" -> lưu thành công, bảng hiện đúng badge "🏢 HO — Phòng CNTT" =====
    await page.click('#maSubmitBtn');
    await page.waitForTimeout(200);
    const rulesAfterAdd = await page.evaluate(() => DB.operationOrderStoreMixedApprovalRules);
    console.log('03: Thêm dòng "Trưởng phòng — Phòng CNTT" (Bước 1, Mặc định) qua UI -> DB:', JSON.stringify(rulesAfterAdd));
    if (rulesAfterAdd.length !== 1 || rulesAfterAdd[0].jobTitle !== 'Trưởng phòng' || rulesAfterAdd[0].jobTitleDept !== 'Phòng CNTT') {
      throw new Error('Thêm dòng qua UI không ra đúng jobTitle/jobTitleDept mong đợi');
    }
    const tbodyHTML = await page.evaluate(() => document.getElementById('mixedApprovalTableBody')?.innerHTML || '');
    if (!tbodyHTML.includes('Phòng CNTT')) throw new Error('Bảng chưa hiện đúng badge phòng ban "Phòng CNTT"');
    await shot(page, '03-da-them-dong-truong-phong-cntt');

    // ===== 4) Kịch bản nghiệp vụ thật: Trưởng Phòng CNTT duyệt được, Trưởng Phòng Kinh Doanh BỊ CHẶN =====
    const appDataStore = {
      workflows: state.workflows, users: state.users,
      operationOrderStoreTierWorkflows: state.operationOrderStoreTierWorkflows,
      operationOrderHOTierWorkflows: state.operationOrderHOTierWorkflows,
      operationOrderStoreMixedApprovalRules: rulesAfterAdd
    };
    function storeOrder(id, dept) {
      return { id, code: `DH-000${id}`, dept, orderLocationType: 'STORE', status: 'PENDING', currentStep: 1, history: [], creator: 'nv.a', creatorName: 'Nhân Viên A', amount: 5000000, items: [] };
    }
    const resultOk = applyWorkflowAction({ moduleKey: 'operationOrders', item: storeOrder(1, 'Siêu Thị Quận 1'), action: 'APPROVE', user: TP_CNTT, comment: '', appData: appDataStore });
    console.log(`\n04a: Trưởng Phòng CNTT (tp.cntt) duyệt đơn Đặt Hàng Siêu Thị -> ${resultOk.item.status} ✅`);
    let blocked = null;
    try {
      applyWorkflowAction({ moduleKey: 'operationOrders', item: storeOrder(2, 'Siêu Thị Quận 1'), action: 'APPROVE', user: TP_KD, comment: '', appData: appDataStore });
    } catch (err) { blocked = err; }
    console.log(`04b: Trưởng Phòng Kinh Doanh (tp.kd, CÙNG chức danh "Trưởng phòng", KHÁC phòng ban) thử duyệt -> ${blocked ? `CHẶN 403 ✅ ("${blocked.message}")` : 'LỖI: KHÔNG bị chặn!'}`);
    if (!blocked || blocked.status !== 403) throw new Error('tp.kd đáng lẽ phải bị chặn 403 (khác phòng ban) nhưng không');

    // ===== 5) So sánh trực quan: "🏪 QT Giá Bán Buôn (Siêu Thị)" — CÙNG cơ chế, chụp cả empty lẫn đã thêm =====
    await page.evaluate(async () => { setAdvWorkflowSubTab('ITPRICE_MIXED'); });
    await page.waitForTimeout(150);
    console.log('\n05: "🏪 QT Giá Bán Buôn (Siêu Thị)" — màn rỗng ban đầu (cùng khuôn UI).');
    await shot(page, '05-ban-buon-rong');

    await page.selectOption('#ipmaNewMode', 'JOBTITLE');
    await page.evaluate(() => onItPriceWholesaleMixedApprovalNewModeChange());
    await page.fill('#ipmaNewJobTitleInput', 'Trưởng phòng — Phòng CNTT — HO');
    await page.click('#ipmaSubmitBtn');
    await page.waitForTimeout(200);
    const wholesaleRulesAfterAdd = await page.evaluate(() => DB.itPriceWholesaleStoreMixedApprovalRules);
    console.log('06: Thêm dòng "Trưởng phòng — Phòng CNTT" (Bán Buôn) qua UI -> DB:', JSON.stringify(wholesaleRulesAfterAdd));
    if (wholesaleRulesAfterAdd.length !== 1 || wholesaleRulesAfterAdd[0].jobTitleDept !== 'Phòng CNTT') {
      throw new Error('Thêm dòng Bán Buôn qua UI không ra đúng jobTitleDept mong đợi');
    }
    await shot(page, '06-ban-buon-da-them-dong-truong-phong-cntt');

    // ===== 6) Kịch bản nghiệp vụ thật cho Bán Buôn (CÙNG kết quả như Đặt Hàng Siêu Thị) =====
    const appDataWholesale = {
      workflows: state.workflows, users: state.users,
      itPriceTierWorkflows: state.itPriceTierWorkflows,
      itPriceWholesaleStoreMixedApprovalRules: wholesaleRulesAfterAdd
    };
    function wholesaleItem(id, dept) {
      return { id, priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5', dept, creator: 'proposer', creatorName: 'Người Đề Xuất', status: 'PENDING', currentStep: 1, history: [], files: [], applied: false };
    }
    const resultOkWs = applyWorkflowAction({ moduleKey: 'itPriceApprovals', item: wholesaleItem(1, 'Siêu Thị Quận 1'), action: 'APPROVE', user: TP_CNTT, comment: '', appData: appDataWholesale });
    console.log(`\n07a: Trưởng Phòng CNTT duyệt đề xuất Phê Duyệt Giá Bán Buôn -> ${resultOkWs.item.status} ✅`);
    let blockedWs = null;
    try {
      applyWorkflowAction({ moduleKey: 'itPriceApprovals', item: wholesaleItem(2, 'Siêu Thị Quận 1'), action: 'APPROVE', user: TP_KD, comment: '', appData: appDataWholesale });
    } catch (err) { blockedWs = err; }
    console.log(`07b: Trưởng Phòng Kinh Doanh thử duyệt đề xuất Bán Buôn -> ${blockedWs ? `CHẶN 403 ✅ ("${blockedWs.message}")` : 'LỖI: KHÔNG bị chặn!'}`);
    if (!blockedWs || blockedWs.status !== 403) throw new Error('tp.kd đáng lẽ phải bị chặn 403 ở Bán Buôn nhưng không');

    console.log('\n✅ Demo hoàn tất — ảnh lưu ở:', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
