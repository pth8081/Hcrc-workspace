// server/tests/demo-itprice-nganhhang-multi-approve.js
//
// DEMO thật (Playwright, chụp ảnh — không phải test tự động), theo yêu cầu người dùng sau khi tính năng
// "Ngành Hàng" cho Phê Duyệt Giá Bán Buôn đã merge (10/2026). Người dùng hỏi lại 2 điều, demo này trả lời
// CẢ HAI bằng UI thật + hành vi thật (không suy luận):
//
//   (1) "Ngành hàng phải được chọn NHIỀU ngành hàng gắn vào MỘT người, giống Siêu Thị" — xác nhận cột
//       "Ngành Hàng Phụ Trách" (màn "🏪 QT Giá Bán Buôn (Siêu Thị)") dùng ĐÚNG widget multi-select như cột
//       "Siêu Thị Phụ Trách" đã có — 1 dòng/1 người có thể gán NHIỀU ngành hàng cùng lúc.
//   (2) "Nếu trong 1 bước, 2 người khác nhau mỗi người phụ trách 1 ngành hàng khác nhau, và đề xuất chọn
//       CẢ 2 ngành hàng đó — thì phải CẢ 2 người cùng duyệt mới pass, đúng không?" — XÁC NHẬN ĐÚNG, và demo
//       bằng callWorkflowAction() thật (không mock), + soi Trung Tâm Phê Duyệt (Approval Hub) của người
//       thứ 2 TRƯỚC/SAU khi người thứ 1 duyệt để thấy rõ hồ sơ còn/hết nằm trong danh sách "chờ tôi duyệt".
//
// Chạy: node server/tests/demo-itprice-nganhhang-multi-approve.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8999;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'itprice-nganhhang-multi-approve');

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };
const TRUONG_TP = { username: 'truong.tp', name: 'Lê Thị Thực Phẩm', dept: 'Kinh Doanh', perms: {}, active: true };
const TRUONG_HMP = { username: 'truong.hmp', name: 'Phạm Văn Hoá Mỹ Phẩm', dept: 'Kinh Doanh', perms: {}, active: true };
const QUAN_LY_VUNG = { username: 'ql.vung', name: 'Trần Quản Lý Vùng', dept: 'Kinh Doanh', perms: {}, active: true };
const PROPOSER = { username: 'proposer', name: 'Người Đề Xuất', dept: 'Kinh Doanh', perms: { itPriceProposeCreateWholesale: true }, active: true };

const state = createMockState({
  depts: ['Ban Giám Đốc', 'Kinh Doanh'],
  stores: ['Siêu Thị A'],
  users: [ADMIN, TRUONG_TP, TRUONG_HMP, QUAN_LY_VUNG, PROPOSER],
  nganhHangCatalog: [
    { id: 1, code: 'NH-TP', name: 'Thực Phẩm Tươi Sống', dept: '' },
    { id: 2, code: 'NH-HMP', name: 'Hóa Mỹ Phẩm', dept: '' }
  ],
  workflows: [{ id: 'WF_1STEP', name: 'Duyệt 1 bước', steps: [{ order: 1, name: 'Duyệt' }] }],
  itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_1STEP' }, DISCOUNT_GT5: { workflowId: 'WF_1STEP' } },
  itPriceWholesaleStoreMixedApprovalRules: [],
  itPriceApprovals: []
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

    // testHarness không mô phỏng generic POST /api/data/:key — chỉ cần "lưu thành công" cho đúng 1 key
    // demo này dùng tới (mirror demo-itprice-wholesale-mixed-approval.js).
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

    // ===== 1) Vào màn "🏪 QT Giá Bán Buôn (Siêu Thị)" — Hệ Thống > Nghiệp Vụ Nâng Cao =====
    await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADVWORKFLOW'); setAdvWorkflowSubTab('ITPRICE_MIXED'); });
    await page.waitForTimeout(150);
    await shot(page, '01-man-cau-hinh-rong');

    // ===== 2) Thêm dòng 1: truong.tp phụ trách ĐÚNG 1 ngành hàng NH-TP (qua UI thật) =====
    await page.evaluate(() => { document.getElementById('ipmaNewMode').value = 'PERSON'; onItPriceWholesaleMixedApprovalNewModeChange(); });
    await page.fill('#ipmaNewPersonInput', 'Lê Thị Thực Phẩm (truong.tp) - Kinh Doanh');
    const nganhHangInput1 = await page.$('#ipmaNewNganhHangPicker [data-pms-search]');
    await nganhHangInput1.click();
    await nganhHangInput1.type('Thực Phẩm');
    await page.waitForTimeout(150);
    await page.click('#ipmaNewNganhHangPicker [data-op="gmsAdd"]');
    await page.click('#ipmaSubmitBtn');
    await page.waitForTimeout(200);

    // ===== 3) Thêm dòng 2: truong.hmp phụ trách ĐÚNG 1 ngành hàng NH-HMP =====
    await page.evaluate(() => { document.getElementById('ipmaNewMode').value = 'PERSON'; onItPriceWholesaleMixedApprovalNewModeChange(); });
    await page.fill('#ipmaNewPersonInput', 'Phạm Văn Hoá Mỹ Phẩm (truong.hmp) - Kinh Doanh');
    const nganhHangInput2 = await page.$('#ipmaNewNganhHangPicker [data-pms-search]');
    await nganhHangInput2.click();
    await nganhHangInput2.type('Hoá Mỹ Phẩm');
    await page.waitForTimeout(150);
    await page.click('#ipmaNewNganhHangPicker [data-op="gmsAdd"]');
    await page.click('#ipmaSubmitBtn');
    await page.waitForTimeout(200);

    const rulesAfter2 = await page.evaluate(() => DB.itPriceWholesaleStoreMixedApprovalRules);
    console.log('04: 2 dòng (Mức Margin<5%) sau khi thêm qua UI:', JSON.stringify(rulesAfter2, null, 2));
    if (rulesAfter2.length !== 2) throw new Error('Phải có đúng 2 dòng ở Mức Margin<5% sau khi thêm qua UI');
    await shot(page, '02a-2-dong-margin-lt5-moi-nguoi-1-nganh-hang');

    // ===== 4) ĐỔI SANG Mức KHÁC (Chiết khấu > 5%, dropdown "Đang xem Mức") rồi thêm dòng 3: ql.vung phụ
    // trách CẢ 2 ngành hàng CÙNG LÚC — cố ý đặt ở Mức RIÊNG để KHÔNG ảnh hưởng gì tới kịch bản "2 người,
    // 2 ngành hàng khác nhau" đang test ở Mức Margin<5% phía trên (giữ 2 kịch bản độc lập, dễ đọc). Đây
    // là minh chứng TRỰC TIẾP cho CÂU HỎI 1: 1 người có thể gán NHIỀU ngành hàng cùng lúc, giống hệt cách
    // multi-select ở cột "Siêu Thị Phụ Trách" đã có từ trước =====
    await page.selectOption('#ipmaNewTier', 'DISCOUNT_GT5');
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.getElementById('ipmaNewMode').value = 'PERSON'; onItPriceWholesaleMixedApprovalNewModeChange(); });
    await page.fill('#ipmaNewPersonInput', 'Trần Quản Lý Vùng (ql.vung) - Kinh Doanh');
    const nganhHangInput3a = await page.$('#ipmaNewNganhHangPicker [data-pms-search]');
    await nganhHangInput3a.click();
    await nganhHangInput3a.type('Thực Phẩm');
    await page.waitForTimeout(150);
    await page.click('#ipmaNewNganhHangPicker [data-op="gmsAdd"]');
    const nganhHangInput3b = await page.$('#ipmaNewNganhHangPicker [data-pms-search]');
    await nganhHangInput3b.click();
    await nganhHangInput3b.type('Hoá Mỹ Phẩm');
    await page.waitForTimeout(150);
    await page.click('#ipmaNewNganhHangPicker [data-op="gmsAdd"]');
    await page.click('#ipmaSubmitBtn');
    await page.waitForTimeout(200);

    const rulesAfterAdd = await page.evaluate(() => DB.itPriceWholesaleStoreMixedApprovalRules);
    console.log('04b: Dòng thứ 3 (Mức Chiết khấu>5%, ql.vung) đã thêm qua UI:', JSON.stringify(rulesAfterAdd, null, 2));
    if (rulesAfterAdd.length !== 3) throw new Error('Phải có đúng 3 dòng sau khi thêm qua UI');
    const rowVung = rulesAfterAdd.find(r => r.username === 'ql.vung');
    if (!rowVung || rowVung.nganhHang.length !== 2) throw new Error('Dòng "ql.vung" phải có ĐÚNG 2 ngành hàng (chứng minh 1 người gán được nhiều ngành hàng, giống Siêu Thị)');
    // fetch mock ở trên chỉ trả ok:true cho POST (không có route "ghi" thật trong testHarness) — phải tự
    // đồng bộ lại object `state` (dùng chung tham chiếu với server GET /api/data) để các LẦN ĐĂNG NHẬP
    // SAU (truong.tp/truong.hmp) nhận đúng 3 dòng vừa thêm, không bị initDatabase() ghi đè về rỗng.
    state.itPriceWholesaleStoreMixedApprovalRules = rulesAfterAdd;
    await shot(page, '02b-mot-nguoi-gan-ca-2-nganh-hang-cung-luc');
    console.log('\n✅ CÂU HỎI 1 — "chọn nhiều ngành hàng gắn vào 1 người, giống Siêu Thị": ĐÚNG — xem ảnh 02b, dòng "Trần Quản Lý Vùng" mang 2 ngành hàng (Thực Phẩm Tươi Sống + Hóa Mỹ Phẩm) cùng lúc, multi-select giống hệt cột "Siêu Thị Phụ Trách".');

    // ===== 5) Form đề xuất Bán Buôn (Vận Hành) — multi-select "Ngành Hàng Áp Dụng" chọn CẢ 2 ngành hàng
    // (NH-TP + NH-HMP), đúng kịch bản người dùng mô tả "2 người cùng chọn 1 ngành hàng [khác nhau]" =====
    await loginAs(page, PROPOSER);
    await page.evaluate(async () => { await switchTab('vanHanh'); setVanHanhSubTab('ITPRICE'); openItPriceCreateForm(); });
    await page.waitForTimeout(150);
    await page.selectOption('#itPriceTier', 'MARGIN_LT5');
    await page.fill('#itPriceWholesaleApplyUnit', 'Công ty TNHH Demo');
    await page.fill('#itPriceEffectiveDate', '2026-11-01');
    const storeInput = await page.$('#itPriceStoreScopeStoresMultiSelect [data-pms-search]');
    await storeInput.click(); await storeInput.type('A'); await page.waitForTimeout(150);
    await page.click('#itPriceStoreScopeStoresMultiSelect [data-op="gmsAdd"]');
    const nganhHangFormInput1 = await page.$('#itPriceNganhHangMultiSelect [data-pms-search]');
    await nganhHangFormInput1.click(); await nganhHangFormInput1.type('Thực Phẩm'); await page.waitForTimeout(150);
    await page.click('#itPriceNganhHangMultiSelect [data-op="gmsAdd"]');
    const nganhHangFormInput2 = await page.$('#itPriceNganhHangMultiSelect [data-pms-search]');
    await nganhHangFormInput2.click(); await nganhHangFormInput2.type('Hoá Mỹ Phẩm'); await page.waitForTimeout(150);
    await page.click('#itPriceNganhHangMultiSelect [data-op="gmsAdd"]');
    await shot(page, '03-form-de-xuat-chon-ca-2-nganh-hang');
    await page.evaluate(() => {
      itPricePendingFile = {
        fileUrl: '/uploads/demo-nganhhang.xlsx', fileName: 'demo-nganhhang.xlsx',
        items: [{ values: { code: 'DEMO01', name: 'Sản phẩm demo', oldPrice: '1000', newPrice: '1200' } }],
        columnLabels: [
          { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' },
          { key: 'oldPrice', label: 'Giá cũ' }, { key: 'newPrice', label: 'Giá mới' }
        ]
      };
    });
    await page.click('#itPriceCreateForm button[type="submit"]');
    await page.waitForTimeout(200);
    const created = await page.evaluate(() => DB.itPriceApprovals[0]);
    console.log('\n05: Đề xuất đã tạo, nganhHang =', JSON.stringify(created?.nganhHang));
    if (!created || JSON.stringify([...created.nganhHang].sort()) !== JSON.stringify(['NH-HMP', 'NH-TP'])) {
      throw new Error('Đề xuất phải lưu đúng CẢ 2 mã ngành hàng đã chọn trên form');
    }
    const proposalId = created.id;

    // ===== 6) Trung Tâm Phê Duyệt của truong.hmp TRƯỚC khi truong.tp duyệt — hồ sơ ĐANG hiện (vì cả 2
    // đều là approver của bước 1, do rule mỗi người chỉ khớp ĐÚNG 1 ngành hàng, UNION lại thành 2 người) =====
    await loginAs(page, TRUONG_HMP);
    await page.evaluate(async () => { await switchTab('approvalHub'); });
    await page.waitForTimeout(150);
    await shot(page, '04a-truong-hmp-truoc-khi-truong-tp-duyet');
    const hmpBefore = await page.evaluate((code) => document.getElementById('approvalHubTableBody').innerText.includes(code), created.code);
    console.log(`\n06a: Hồ sơ đang hiện trong "Chờ tôi duyệt" của truong.hmp TRƯỚC khi truong.tp duyệt? ${hmpBefore ? 'CÓ ✅' : 'KHÔNG ❌'}`);
    if (!hmpBefore) throw new Error('truong.hmp phải thấy hồ sơ cần duyệt NGAY TỪ ĐẦU (là 1 trong 2 approver của bước 1)');

    // ===== 7) truong.tp duyệt (gọi callWorkflowAction() THẬT, không mock) =====
    // callWorkflowAction() CHỈ gọi API + trả về { item, transition } — KHÔNG tự ghi lại vào DB.itPriceApprovals
    // (đó là việc của wrapper approveItPriceConfirmed(), module-itsupport-price.js: "DB.itPriceApprovals[idx] =
    // updated"). Gọi trực tiếp callWorkflowAction() như demo này phải tự làm bước đó, nếu không DB.itPriceApprovals
    // vẫn giữ bản SNAPSHOT CŨ (từ lần GET /api/data gần nhất) — đọc nhầm dữ liệu cũ dù server đã cập nhật đúng.
    await loginAs(page, TRUONG_TP);
    const afterFirstApprove = await page.evaluate(async (id) => {
      try {
        const result = await callWorkflowAction('itPriceApprovals', id, 'approve', {});
        const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
        if (idx !== -1) DB.itPriceApprovals[idx] = result.item;
        return { ok: true };
      } catch (e) { return { ok: false, message: e.message }; }
    }, proposalId);
    console.log('\n07: truong.tp (phụ trách NH-TP) duyệt ->', JSON.stringify(afterFirstApprove));
    if (!afterFirstApprove.ok) throw new Error('truong.tp PHẢI duyệt được (là approver hợp lệ của NH-TP): ' + afterFirstApprove.message);
    const itemAfterFirst = await page.evaluate(() => DB.itPriceApprovals[0]);
    console.log(`    -> trạng thái hồ sơ sau khi truong.tp duyệt: status=${itemAfterFirst.status}, currentStep=${itemAfterFirst.currentStep} (PHẢI còn PENDING ở cùng bước 1 — còn thiếu truong.hmp)`);
    if (itemAfterFirst.status !== 'PENDING' || itemAfterFirst.currentStep !== 1) {
      throw new Error('LỖI: hồ sơ không được coi là HOÀN TẤT bước chỉ với 1/2 người duyệt — đáng lẽ phải còn PENDING ở bước 1');
    }

    // ===== 8) Trung Tâm Phê Duyệt của truong.hmp SAU khi truong.tp duyệt — hồ sơ VẪN còn hiện (còn
    // thiếu CHÍNH truong.hmp phê duyệt) — TRẢ LỜI câu hỏi 2 bằng UI thật, không chỉ bằng log =====
    await loginAs(page, TRUONG_HMP);
    await page.evaluate(async () => { await switchTab('approvalHub'); });
    await page.waitForTimeout(150);
    await shot(page, '04b-truong-hmp-sau-khi-truong-tp-duyet-van-con');
    const hmpAfterFirst = await page.evaluate((code) => document.getElementById('approvalHubTableBody').innerText.includes(code), created.code);
    console.log(`\n08: Hồ sơ VẪN còn trong "Chờ tôi duyệt" của truong.hmp SAU KHI truong.tp đã duyệt? ${hmpAfterFirst ? 'CÓ ✅ (đúng — cần cả 2 người)' : 'KHÔNG ❌ (SAI)'}`);
    if (!hmpAfterFirst) throw new Error('LỖI: hồ sơ đã biến mất khỏi hàng đợi của truong.hmp dù truong.hmp CHƯA duyệt — vi phạm yêu cầu "cả 2 người cùng duyệt mới pass"');

    // ===== 9) truong.hmp duyệt tiếp -> ĐỦ cả 2 người (AND) -> hồ sơ hoàn tất =====
    const afterSecondApprove = await page.evaluate(async (id) => {
      try {
        const result = await callWorkflowAction('itPriceApprovals', id, 'approve', {});
        const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
        if (idx !== -1) DB.itPriceApprovals[idx] = result.item;
        return { ok: true };
      } catch (e) { return { ok: false, message: e.message }; }
    }, proposalId);
    console.log('\n09: truong.hmp (phụ trách NH-HMP) duyệt tiếp ->', JSON.stringify(afterSecondApprove));
    if (!afterSecondApprove.ok) throw new Error('truong.hmp PHẢI duyệt được: ' + afterSecondApprove.message);
    const itemAfterSecond = await page.evaluate(() => DB.itPriceApprovals[0]);
    console.log(`    -> trạng thái hồ sơ sau khi CẢ 2 đã duyệt: status=${itemAfterSecond.status} (phải chuyển khỏi PENDING bước 1, VD APPROVED nếu đó là bước cuối)`);
    if (itemAfterSecond.status === 'PENDING' && itemAfterSecond.currentStep === 1) {
      throw new Error('LỖI: đủ cả 2 người duyệt rồi mà vẫn còn kẹt ở bước 1');
    }
    await page.evaluate(async () => { await switchTab('approvalHub'); });
    await page.waitForTimeout(150);
    await shot(page, '04c-sau-khi-ca-2-da-duyet-het-hoan-tat');

    console.log('\n✅ CÂU HỎI 2 — "2 người khác nhau mỗi người 1 ngành hàng, đề xuất chọn cả 2 thì phải CẢ 2 người cùng duyệt mới pass": ĐÚNG — xem ảnh 04a/04b/04c.');
    console.log('\n✅ Demo hoàn tất — ảnh lưu ở:', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
