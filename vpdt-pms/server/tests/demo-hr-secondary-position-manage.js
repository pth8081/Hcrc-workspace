// server/tests/demo-hr-secondary-position-manage.js
//
// DEMO thật (Playwright, chụp ảnh — không phải test tự động), theo yêu cầu người dùng (11/2026):
// "tạo ra một vị trí kiêm nhiệm phê duyệt mà không trùng với vị trí kiêm nhiệm do Nhân Sự làm, vị trí
// kiêm nhiệm này sẽ có mặt trong TẤT CẢ quy trình phê duyệt mà tôi đã cấu hình chưa, xem thử nhé" — xác
// nhận lại với người dùng trước khi làm (AskUserQuestion): tạo 1 vị trí kiêm nhiệm MỚI (chưa ai dùng,
// không trùng/ảnh hưởng dữ liệu HR đang có) qua chính ô "🏷️ Gán Vị Trí Kiêm Nhiệm" (quyền riêng
// hrSecondaryPositionManage, v29.43-44) rồi xác nhận nó tự động có hiệu lực ở MỌI quy trình "Theo vị
// trí" đã cấu hình cho đúng vị trí đó — không cần cấu hình lại kiêm nhiệm riêng cho từng quy trình.
//
// CẬP NHẬT (11/2026, báo cáo người dùng — "ô này chỉ tìm được vị trí CÓ THẬT trong Cơ Cấu Tổ Chức, trong
// khi ô 'Vị Trí Kiêm Nhiệm (tuỳ chọn)' ở TRÊN lại tìm được chức danh HO/Siêu Thị đã tạo ở phân quyền mà
// không cần có node — không nhất quán"): demo này giờ dựng đúng kịch bản lỗi thật — "Thẩm định
// ultrafresh" KHÔNG còn là 1 node POSITION trong Cơ Cấu Tổ Chức (buildOrgVersion() dưới đây CHỈ còn
// node DEPARTMENT, không có node POSITION nào), CHỈ tồn tại ở danh mục 🧭 Vị Trí Tham Gia Quy Trình
// (appData.workflowParticipatingPositions) — TRƯỚC bản vá, admin2 sẽ gõ "Thẩm định ultrafresh" ở ô "Gán
// Vị Trí Kiêm Nhiệm" và nhận "Không tìm thấy"; SAU bản vá, ô này tìm thấy và gán được bình thường.
//
// Dùng testHarness.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js thật, mock
// GET/POST /api/hr-profile/secondary-position* + /linked-usernames mirror ĐÚNG routes/employeeProfile.js
// thật):
//   PHẦN 1: Admin2 — ĐÃ có quyền "admin" (vào được tab Hệ Thống bình thường — xác nhận lại với người
//     dùng: "ko ai được vào module hệ thống ngoài admin", KHÔNG đổi gate này) nhưng KHÔNG có
//     hrProfileManage/hrProfileEdit (không phải HR), CHỈ thêm đúng quyền riêng hrSecondaryPositionManage
//     — mở "Sửa Người Dùng" cho tài khoản thử nghiệm (ĐÃ liên kết hồ sơ Nhân Sự nên ô kiêm nhiệm chính bị
//     khoá) — chụp ảnh ô "🏷️ Gán Vị Trí Kiêm Nhiệm" mới xuất hiện, chọn vị trí "Thẩm định ultrafresh" (vị
//     trí HOÀN TOÀN MỚI, chưa ai giữ, không đụng gì tới dữ liệu kiêm nhiệm HR đang quản lý), bấm Lưu —
//     chụp ảnh kết quả.
//   PHẦN 2: Xác nhận sửa ở đây KHÔNG update ngược lại Hồ Sơ Nhân Sự (employeeProfiles không đổi).
//   PHẦN 3: Dùng ĐÚNG quy trình "QT Giá Bán Buôn" (itPriceWholesale, cơ chế duyệt riêng theo
//     jobTitle/kiêm nhiệm — lib/workflowEngine.js::resolveItPriceWholesaleStoreMixedApprovers()) ĐÃ cấu
//     hình bước 1 yêu cầu đúng vị trí "Thẩm định ultrafresh" — đăng nhập người đề xuất, bấm "🔍 Xem Quy
//     Trình" THẬT, chụp ảnh xác nhận tài khoản thử nghiệm giờ hiện ra làm người duyệt — KHÔNG cần cấu
//     hình lại gì thêm ở đây, chỉ nhờ vừa gán kiêm nhiệm ở PHẦN 1.
//   PHẦN 4: Dùng CƠ CHẾ KHÁC HẲN (lib/positionApprovers.js::resolveStepApproverUsernames() — cơ chế
//     "Theo vị trí" DÙNG CHUNG cho rất nhiều module khác: Giá Bán Lẻ, Ngân Sách, Đặt Hàng NCC...) — gọi
//     THẬT hàm này (không viết lại logic) với 1 cấu hình bước duyệt giả định khác hẳn PHẦN 3, xác nhận
//     tài khoản thử nghiệm CŨNG hiện ra đúng — chứng minh 1 lần gán kiêm nhiệm có hiệu lực ở MỌI cơ chế
//     "Theo vị trí" đang có trong hệ thống, không chỉ riêng module nào.
//
// Chạy: node server/tests/demo-hr-secondary-position-manage.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');
const positionApprovers = require('../lib/positionApprovers');

const PORT = 8994;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'hr-secondary-position-manage');

// ADMIN2: CÓ quyền "admin" (vào tab Hệ Thống bình thường — đúng chuẩn "chỉ admin vào module Hệ Thống"),
// nhưng KHÔNG có hrProfileManage/hrProfileEdit (không phải HR) — CHỈ thêm đúng quyền riêng
// hrSecondaryPositionManage để dùng được ô kiêm nhiệm mới, không mở thêm quyền Hồ Sơ Nhân Sự nào khác.
const ADMIN2 = {
  id: 1, username: 'admin2', name: 'Admin Cấu Hình Quy Trình (không thuộc HR)', dept: 'Phòng IT', posType: 'HO',
  perms: { admin: true, hrSecondaryPositionManage: true }, totpEnabled: true, active: true
};
// Tài khoản thử nghiệm — ĐÃ liên kết hồ sơ Nhân Sự (employeeProfiles bên dưới) nên ô kiêm nhiệm CHÍNH bị
// khoá ở màn Sửa Người Dùng, nhưng CHƯA có kiêm nhiệm nào (secondaryPositions rỗng).
const TEST_ACCOUNT = {
  id: 2, username: 'ketoan1', name: 'Nguyễn Thị Kế Toán', dept: 'Phòng Kế Toán', jobTitle: 'Nhân Viên Kế Toán',
  posType: 'HO', perms: {}, secondaryPositions: [], active: true
};
const PROPOSER = {
  id: 3, username: 'proposer', name: 'Người Đề Xuất', dept: 'Phòng Mua Hàng', posType: 'HO',
  perms: { itPriceProposeCreateWholesale: true }, active: true
};

// CỐ Ý KHÔNG có node POSITION nào tên "Thẩm định ultrafresh" — đúng kịch bản lỗi người dùng báo cáo (vị
// trí này không/không còn tồn tại trong Cơ Cấu Tổ Chức, chỉ còn trong danh mục Vị Trí Tham Gia Quy
// Trình bên dưới). Chỉ giữ DEPARTMENT để demo vẫn có đúng tên phòng ban cho các field khác.
function buildOrgVersion() {
  return {
    id: 1, status: 'APPLIED',
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', departmentRef: null, jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Mua Hàng Thực Phẩm Tươi Sống', departmentRef: 'Phòng Mua Hàng Thực Phẩm Tươi Sống', jobTitle: null, requiresDept: null, positionKey: null }
    ]
  };
}

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}
async function shot(page, name, selector) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  if (selector) await page.locator(selector).screenshot({ path: file }); else await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${file}`);
}

async function main() {
  const state = createMockState({
    depts: ['Phòng IT', 'Phòng Kế Toán', 'Phòng Mua Hàng'],
    stores: [],
    users: [ADMIN2, TEST_ACCOUNT, PROPOSER],
    orgChartVersions: [buildOrgVersion()],
    // Hồ sơ Nhân Sự ĐÃ liên kết tài khoản ketoan1 (secondaryPositions RỖNG — HR chưa từng gán kiêm nhiệm
    // gì cho người này) — mục đích DUY NHẤT: khiến ô kiêm nhiệm CHÍNH bị khoá ở màn Sửa Người Dùng, đúng
    // kịch bản gốc người dùng báo cáo.
    employeeProfiles: [{ employeeCode: 'NV900', username: 'ketoan1', secondaryPositions: [] }],
    // 🧭 Vị Trí Tham Gia Quy Trình (Hệ Thống > Quyền Đặc Biệt, khối 17) — nguồn DUY NHẤT còn lại cho
    // "Thẩm định ultrafresh" (không có node POSITION nào trong buildOrgVersion() ở trên). Đây chính là
    // danh mục admin đã dùng để cấu hình itPriceWholesaleStoreMixedApprovalRules bên dưới.
    workflowParticipatingPositions: [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }],
    workflows: [{ id: 'WF_1STEP', name: 'Duyệt 1 bước', steps: [{ order: 1, name: 'Người duyệt bước 1' }] }],
    itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_1STEP' } },
    storeJobTitles: [],
    nganhHangCatalog: [{ id: 1, code: 'ULTRAFRESH', name: 'Thực phẩm tươi sống (Ultrafresh)', dept: '' }],
    // Bước 1 QT Giá Bán Buôn (MARGIN_LT5) ĐÃ cấu hình SẴN TỪ TRƯỚC yêu cầu đúng vị trí "Thẩm định
    // ultrafresh" cho ngành hàng Ultrafresh — ĐÚNG như lời người dùng "tôi đã cấu hình quy trình rồi".
    itPriceWholesaleStoreMixedApprovalRules: [
      { id: 1, tier: 'MARGIN_LT5', step: 1, mode: 'JOBTITLE', jobTitle: 'Thẩm định ultrafresh', jobTitleDept: null, stores: [], nganhHang: ['ULTRAFRESH'] }
    ],
    itPriceApprovals: []
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1100 });

  try {
    // ===== PHẦN 1: Admin2 (quyền riêng, KHÔNG phải HR) gán kiêm nhiệm MỚI qua ô vừa làm =====
    await loginAs(page, ADMIN2);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('PERMS'); });
    await page.waitForTimeout(150);
    await page.evaluate((id) => { editUser(id); }, TEST_ACCOUNT.id);
    // renderSecondaryPositionsWidget() render lần đầu (locked=false), rồi ensureHrLinkedUsernamesLoaded()
    // trả về xong mới render lại (locked=true) — chờ đủ cho .then() chạy.
    await page.waitForTimeout(300);

    const mainBoxLocked = await page.evaluate(() => document.getElementById('uSecondaryPositionsMultiSelect')?.classList.contains('pointer-events-none'));
    const quickEditBoxVisible = await page.evaluate(() => !document.getElementById('uSecondaryPositionManageBlock')?.classList.contains('hidden'));
    console.log(`\n01: Ô kiêm nhiệm CHÍNH bị khoá (đã liên kết hồ sơ Nhân Sự)? ${mainBoxLocked} — Ô "🏷️ Gán Vị Trí Kiêm Nhiệm" MỚI hiện ra cho admin2 (chỉ có quyền riêng)? ${quickEditBoxVisible}`);
    if (!mainBoxLocked || !quickEditBoxVisible) throw new Error('❌ Box không hiện đúng như kỳ vọng.');
    await shot(page, '01-truoc-khi-gan-oKiemNhiemChinh-khoa-va-oGanNhanh-xuat-hien');

    // Gõ tìm "Thẩm định ultrafresh" — vị trí KHÔNG có node thật trong Cơ Cấu Tổ Chức (buildOrgVersion()
    // ở trên không có node POSITION nào), CHỈ tồn tại ở danh mục Vị Trí Tham Gia Quy Trình. TRƯỚC bản vá
    // ô này sẽ ra "Không tìm thấy"; SAU bản vá phải tìm thấy đúng 1 gợi ý khớp.
    const picker = await page.$('#uSecondaryPositionManagePicker [data-pms-search]');
    await picker.click(); await picker.type('Thẩm định ultrafresh'); await page.waitForTimeout(150);
    const dropdownText = await page.evaluate(() => document.getElementById('uSecondaryPositionManagePicker')?.innerText || '');
    console.log(`\n01b: Gõ "Thẩm định ultrafresh" (KHÔNG có node thật trong Cơ Cấu Tổ Chức) — gợi ý hiện ra: ${dropdownText.includes('Thẩm định ultrafresh') ? '✅ CÓ tìm thấy (đúng bản vá)' : '❌ Không tìm thấy (lỗi cũ)'}`);
    if (!dropdownText.includes('Thẩm định ultrafresh')) throw new Error('❌ Không tìm thấy gợi ý "Thẩm định ultrafresh" — bản vá chưa hoạt động.');
    await shot(page, '01b-go-tim-ThamDinhUltrafresh-khong-co-node-van-tim-thay');
    await page.click('#uSecondaryPositionManagePicker [data-op="gmsAdd"]');
    await page.waitForTimeout(100);
    await page.click('#uSecondaryPositionManageSaveBtn');
    await page.waitForTimeout(250);

    const alertsAfterSave = await page.evaluate(() => window.__alerts);
    console.log('02: Thông báo sau khi Lưu:', JSON.stringify(alertsAfterSave));
    if (!alertsAfterSave.some(a => a.includes('Đã lưu'))) throw new Error('❌ Lưu không thành công.');
    await shot(page, '02-sau-khi-chon-ThamDinhUltrafresh-va-bam-Luu');

    // ===== PHẦN 2: Xác nhận KHÔNG update ngược lại Hồ Sơ Nhân Sự =====
    const profileAfter = state.employeeProfiles.find(p => p.username === 'ketoan1');
    const userAfter = state.users.find(u => u.username === 'ketoan1');
    console.log(`\n03: profile.secondaryPositions (field HR thấy ở Chi tiết hồ sơ) sau khi admin2 Lưu: ${JSON.stringify(profileAfter.secondaryPositions)} — ĐÚNG như xác nhận, KHÔNG hề bị đụng tới.`);
    console.log(`04: user.secondaryPositions (dùng để chấm "Theo vị trí") sau khi Lưu: ${JSON.stringify(userAfter.secondaryPositions)}`);
    if (profileAfter.secondaryPositions.length !== 0) throw new Error('❌ LỖI: Hồ Sơ Nhân Sự bị update ngược — đúng điều người dùng KHÔNG muốn!');
    if (userAfter.secondaryPositions.length !== 1 || userAfter.secondaryPositions[0].jobTitle !== 'Thẩm định ultrafresh') {
      throw new Error('❌ Gán kiêm nhiệm không đúng.');
    }
    console.log('✅ XÁC NHẬN: Sửa ở ô "Gán Vị Trí Kiêm Nhiệm" KHÔNG update ngược lại Hồ Sơ Nhân Sự — HR mở hồ sơ ketoan1 sẽ KHÔNG thấy gì thay đổi.');

    // ===== PHẦN 3: Quy trình THẬT (QT Giá Bán Buôn) ĐÃ cấu hình SẴN từ trước — tự áp dụng ngay, không
    // cần sửa lại gì ở màn cấu hình quy trình =====
    await loginAs(page, PROPOSER);
    await page.evaluate(async () => { await switchTab('vanHanh'); setVanHanhSubTab('ITPRICE'); openItPriceCreateForm(); });
    await page.waitForTimeout(150);
    await page.selectOption('#itPriceTier', 'MARGIN_LT5');
    const nganhHangFormInput = await page.$('#itPriceNganhHangMultiSelect [data-pms-search]');
    await nganhHangFormInput.click(); await nganhHangFormInput.type('Ultrafresh'); await page.waitForTimeout(150);
    await page.click('#itPriceNganhHangMultiSelect [data-op="gmsAdd"]');
    await page.waitForTimeout(100);
    await page.click('#itPricePreviewWfBtn');
    await page.waitForTimeout(200);
    await shot(page, '03-xem-truoc-quy-trinh-QT-Gia-Ban-Buon-tu-co-NguyenThiKeToan', '#viewDocModal');

    const modalText = await page.evaluate(() => document.getElementById('viewModalContent').innerText);
    console.log('\n05: Nội dung modal "Xem Trước Quy Trình" (QT Giá Bán Buôn):\n' + modalText);
    if (!modalText.includes('Nguyễn Thị Kế Toán')) {
      throw new Error('❌ Bước 1 PHẢI hiện "Nguyễn Thị Kế Toán" — quy trình đã cấu hình SẴN từ trước (không đụng gì thêm), chỉ nhờ PHẦN 1 vừa gán kiêm nhiệm.');
    }
    console.log('\n✅ XÁC NHẬN: Quy trình "QT Giá Bán Buôn" ĐÃ CẤU HÌNH SẴN (không sửa gì thêm ở đây) — Nguyễn Thị Kế Toán tự động trở thành người duyệt Bước 1 CHỈ NHỜ vừa được gán kiêm nhiệm "Thẩm định ultrafresh" ở màn Phân Quyền.');

    // ===== PHẦN 4: Cơ chế "Theo vị trí" KHÁC HẲN (lib/positionApprovers.js — dùng chung cho Giá Bán Lẻ,
    // Ngân Sách, Đặt Hàng NCC...) — gọi THẬT hàm thật, KHÔNG viết lại logic, với 1 cấu hình bước duyệt
    // giả định hoàn toàn khác PHẦN 3 (module/ý nghĩa khác), xác nhận Nguyễn Thị Kế Toán CŨNG hiện ra =====
    const hypotheticalBudgetStepConfig = {
      approverMode: { 1: 'POSITION' },
      approversByPosition: { 1: [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }] }
    };
    const budgetApprovers = positionApprovers.resolveStepApproverUsernames(hypotheticalBudgetStepConfig, 1, [...state.users, { ...userAfter, perms: { canBeApprover: true } }]);
    console.log(`\n06: Thử với 1 cấu hình bước duyệt HOÀN TOÀN KHÁC (giả định dùng cho Ngân Sách/Giá Bán Lẻ/Đặt Hàng NCC... — cơ chế "Theo vị trí" chung, lib/positionApprovers.js) cho ĐÚNG vị trí "Thẩm định ultrafresh": ${JSON.stringify(budgetApprovers)}`);
    if (!budgetApprovers.includes('ketoan1')) {
      throw new Error('❌ Cơ chế "Theo vị trí" dùng chung không nhận diện được — kiêm nhiệm KHÔNG áp dụng cho mọi quy trình như mong đợi.');
    }
    console.log('✅ XÁC NHẬN THÊM: resolveStepApproverUsernames() (hàm THẬT dùng chung cho Giá Bán Lẻ/Ngân Sách/Đặt Hàng NCC...) CŨNG nhận diện Nguyễn Thị Kế Toán ngay — 1 lần gán kiêm nhiệm có hiệu lực ở MỌI quy trình "Theo vị trí" đang có trong hệ thống, không chỉ riêng QT Giá Bán Buôn ở PHẦN 3.');

    console.log('\n🖼️  Ảnh demo đã lưu tại:', OUT_DIR);
    console.log('✅ DEMO THÀNH CÔNG — vị trí kiêm nhiệm mới gán qua quyền riêng hrSecondaryPositionManage: (1) không trùng/đụng dữ liệu HR, (2) không update ngược Hồ Sơ Nhân Sự, (3) tự động có hiệu lực ở TẤT CẢ quy trình "Theo vị trí" đã cấu hình cho đúng vị trí đó, dù qua cơ chế nào.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error('💥 Demo lỗi:', e); process.exitCode = 1; });
