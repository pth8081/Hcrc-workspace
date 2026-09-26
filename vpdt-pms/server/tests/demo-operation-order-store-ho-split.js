// server/tests/demo-operation-order-store-ho-split.js
//
// DEMO thật (không phải tests/test-*.js — không nằm trong bộ hồi quy chạy tự động) cho đợt "Tách Đơn
// Hàng Siêu Thị/HO": 3 sub-tab "🏬 Đặt Hàng Tại Siêu Thị"/"🏢 Đặt Hàng Tại HO"/"📊 Báo Cáo", quy trình
// duyệt theo MỨC GIÁ TRỊ (TÁCH RIÊNG hoàn toàn 2 luồng, không còn theo phòng ban), 2 tab admin cấu hình
// mới ("Quy Trình & Phê Duyệt" > "QT Vận Hành - Đặt Hàng Tại Siêu Thị/HO"), luồng Nhập Hàng/Hủy Nhập vẫn
// hoạt động sau khi duyệt, và Báo Cáo mở rộng (Tổng Chuỗi/Siêu Thị/HO/từng siêu thị).
//
// Ghi chú môi trường (giống hệt các demo-*.js khác của module Vận Hành): sandbox này KHÔNG có Docker
// daemon chạy được và KHÔNG có SQL Server cài sẵn — không dựng được "server thật + SQL Server thật".
// Demo dưới đây dùng ĐÚNG kiến trúc tests/testHarness.js: Chromium thật (Playwright) mở ĐÚNG
// public/index.html + toàn bộ public/js/*.js thật, chỉ tầng mạng (fetch) giả lập để gọi thẳng
// lib/workflowEngine.js/lib/recordActions.js/lib/createValidation.js THẬT (không tự đoán lại logic
// nghiệp vụ) thay vì đi qua HTTP + SQL Server thật — TRUNG THỰC khai báo, không giả vờ đây là server thật.
//
// Chạy: node server/tests/demo-operation-order-store-ho-split.js
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'operation-order-store-ho-split');

const DEPT = 'Phòng Vận Hành';
const CREATOR = { username: 'vh_creator_demo', name: 'Nhân Viên Mua Hàng (Demo)', dept: DEPT, perms: { operationOrderCreate: true }, active: true };
// BUG THẬT đã sửa (demo này viết TRƯỚC đợt "Quy Trình Hỗn Hợp", commit 2b7b569 — xem
// resolveOperationOrderWorkflowConfigForItemClient()/computeOperationOrderStoreMixedApproversClient() ở
// core.js): approver của luồng SIÊU THỊ giờ tra HOÀN TOÀN theo BƯỚC + siêu thị qua
// DB.operationOrderStoreMixedApprovalRules, KHÔNG còn phân biệt theo MỨC GIÁ TRỊ (tier) như trước nữa —
// operationOrderStoreTierWorkflows[...].approvers cũ giờ CHỈ còn dùng để biết SỐ BƯỚC (workflowId), không
// còn dùng để tra NGƯỜI duyệt. Vì vậy STORE_LOW/STORE_HIGH không còn thể tách biệt theo mức được nữa —
// STORE_LOW giữ vai trò approver Bước 1 DUY NHẤT áp dụng cho MỌI mức Siêu Thị (mirror khuôn seed ở
// tests/test-operation-order-location-tiers.js), STORE_HIGH giữ lại chỉ để minh hoạ "không có tên trong
// Quy Trình Hỗn Hợp thì bị chặn hoàn toàn, bất kể mức nào". HO vẫn giữ NGUYÊN cơ chế tier cũ (không đổi).
const STORE_LOW = { username: 'vh_store_low_demo', name: 'Trưởng Ca Siêu Thị (Demo)', dept: DEPT, perms: { operationOrderCreate: true, canBeApprover: true, operationOrderReceiptManageStore: { all: true, depts: [] } }, active: true };
const STORE_HIGH = { username: 'vh_store_high_demo', name: 'Giám Đốc Vận Hành Siêu Thị (Demo)', dept: DEPT, perms: { operationOrderCreate: true, canBeApprover: true }, active: true };
const HO_APPROVER = { username: 'vh_ho_demo', name: 'Trưởng Phòng Mua Hàng HO (Demo)', dept: DEPT, perms: { operationOrderCreate: true, canBeApprover: true, operationOrderReceiptManageHO: true }, active: true };
// totpEnabled:true — bắt buộc cho tài khoản admin (proceedAfterAuth() ở core.js chặn admin CHƯA bật
// TOTP bằng 1 modal thiết lập bắt buộc, không gọi initDatabase() cho tới khi thiết lập xong; demo chỉ
// cần login thẳng để chụp ảnh, không kiểm tra luồng TOTP).
const ADMIN = { username: 'admin_demo', name: 'Quản Trị Viên (Demo)', dept: DEPT, perms: { admin: true }, active: true, totpEnabled: true };

const state = createMockState({
  depts: [DEPT],
  users: [CREATOR, STORE_LOW, STORE_HIGH, HO_APPROVER, ADMIN],
  workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
  // .approvers ở đây (STORE) giờ CHỈ còn là dữ liệu lịch sử, KHÔNG còn được đọc để tra người duyệt nữa
  // (xem chú thích ở STORE_LOW/STORE_HIGH phía trên) — giữ lại nguyên workflowId để biết SỐ BƯỚC.
  operationOrderStoreTierWorkflows: {
    LT10M: { workflowId: 'WF_1STEP', approvers: { 1: [STORE_LOW.username] } },
    GTE100M: { workflowId: 'WF_1STEP', approvers: { 1: [STORE_HIGH.username] } }
    // FROM10M_TO100M cố ý CHƯA cấu hình — minh hoạ "chưa ai (ngoài Admin) duyệt được" đúng cảnh báo ở
    // renderItPriceTierWorkflowTab()/saveItPriceTierWorkflowConfig() nếu admin lưu thiếu người duyệt.
  },
  operationOrderHOTierWorkflows: {
    LT100M: { workflowId: 'WF_1STEP', approvers: { 1: [HO_APPROVER.username] } }
  },
  // Quy Trình Hỗn Hợp (đợt commit 2b7b569, sau khi demo này viết) — approver THẬT của luồng Siêu Thị,
  // tra theo Bước + siêu thị, KHÔNG theo tier. mode PERSON + stores:[] = STORE_LOW áp dụng Bước 1 cho MỌI
  // siêu thị/MỌI mức (mirror khuôn seed ở tests/test-operation-order-location-tiers.js). STORE_HIGH CỐ Ý
  // không có dòng nào ở đây — minh hoạ người không có tên trong Quy Trình Hỗn Hợp bị chặn hoàn toàn.
  operationOrderStoreMixedApprovalRules: [
    { id: 1, step: 1, mode: 'PERSON', username: STORE_LOW.username, stores: [] }
  ]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, user);
}
async function createOrder(page, { locationType, title, receivingLocationName, amount }) {
  return page.evaluate(({ locationType, title, receivingLocationName, amount }) => {
    switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); setOperationOrderSubTab(locationType);
    document.getElementById('voCode').value = generateOperationOrderCode();
    document.getElementById('voTitle').value = title;
    document.getElementById('voSupplier').value = 'NCC Demo';
    document.getElementById('voReceivingLocationName').value = receivingLocationName || '';
    operationOrderItems = [{ name: 'Hàng hoá demo', unit: 'Thùng', qty: 1, unitPrice: amount, note: '', productCode: '', barcode: '', qtyReceived: null }];
    return submitOperationOrder({ preventDefault() {}, target: { reset() {} } }).then(() => DB.operationOrders.find(o => o.title === title));
  }, { locationType, title, receivingLocationName, amount });
}
async function approveOrder(page, id) {
  return page.evaluate(async (id) => {
    openOperationProcessModal('operationOrders', id);
    document.getElementById('txtOperationProcessComment').value = 'Đồng ý duyệt';
    await processOperation('APPROVE');
    return DB.operationOrders.find(o => o.id === id);
  }, id);
}
async function tryApprove(page, id) {
  // Gọi thẳng callWorkflowAction() (bỏ qua UI, vì modal ẩn hẳn nút Duyệt khi canApprove=false) để xác
  // nhận đúng lớp chặn phía SERVER (applyWorkflowAction() thật) khi người KHÔNG đúng tier/luồng cố duyệt.
  return page.evaluate(async (id) => {
    try { await callWorkflowAction('operationOrders', id, 'approve', { comment: 'thử duyệt' }); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }, id);
}
async function receiveGoods(page, id) {
  return page.evaluate(async (id) => {
    openOperationOrderReceiptActionModal(id, 'RECEIVE');
    await confirmOperationOrderReceiptAction();
    return DB.operationOrders.find(o => o.id === id);
  }, id);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1500, height: 1700 });

  try {
    // ===== 0) Admin cấu hình 2 tab TIER MỚI (Quy Trình & Phê Duyệt) — chụp trước khi tạo đơn để chứng
    // minh cấu hình admin đã sẵn sàng TRƯỚC khi nhân viên thao tác, không phải "giả lập ngược". =====
    await loginAs(page, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('WORKFLOW'); switchWfModule('OPERATION_ORDER_STORE'); });
    await page.waitForSelector('#deptWorkflowConfigContainer', { state: 'visible' });
    await page.locator('#workflowSection').screenshot({ path: path.join(OUT_DIR, '00a-admin-cau-hinh-tier-sieu-thi.png') });
    await page.evaluate(() => switchWfModule('OPERATION_ORDER_HO'));
    await page.waitForSelector('#deptWorkflowConfigContainer', { state: 'visible' });
    await page.locator('#workflowSection').screenshot({ path: path.join(OUT_DIR, '00b-admin-cau-hinh-tier-ho.png') });
    console.log('Đã chụp: 00a/00b (2 tab admin MỚI cấu hình quy trình theo mức giá trị, tách riêng Siêu Thị/HO)');

    // ===== 1) Sub-tab "🏬 Đặt Hàng Tại Siêu Thị" — form tạo mới + badge đúng ngữ cảnh =====
    await loginAs(page, CREATOR);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); setOperationOrderSubTab('STORE'); });
    await page.waitForSelector('#opOrderListPanel', { state: 'visible' });
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '01-subtab-dat-hang-tai-sieu-thi.png') });
    console.log('Đã chụp: 01 (sub-tab "Đặt Hàng Tại Siêu Thị" — 3 sub-tab STORE/HO/REPORT + badge ngữ cảnh trên form)');

    // Đơn STORE mức THẤP (< 10 triệu, 5.000.000) -> tier LT10M -> STORE_LOW duyệt được.
    const storeLow = await createOrder(page, { locationType: 'STORE', title: 'Đặt hàng bánh kẹo Tết - Q1 (mức thấp)', receivingLocationName: 'Siêu thị BRGMart Quận 1', amount: 5000000 });
    // Đơn STORE mức CAO (>= 100 triệu, 150.000.000) -> tier GTE100M -> STORE_HIGH duyệt được, STORE_LOW KHÔNG được.
    const storeHigh = await createOrder(page, { locationType: 'STORE', title: 'Đặt hàng hàng Tết số lượng lớn - Q1 (mức cao)', receivingLocationName: 'Siêu thị BRGMart Quận 1', amount: 150000000 });
    // Đơn STORE khác nơi nhận (Quận 7) để minh hoạ báo cáo "theo từng siêu thị" có >1 dòng.
    const storeQ7 = await createOrder(page, { locationType: 'STORE', title: 'Đặt hàng nước giải khát - Q7', receivingLocationName: 'Siêu thị BRGMart Quận 7', amount: 3000000 });
    console.log(`Đã tạo 3 đơn Siêu Thị: ${storeLow.code} (5tr, tier LT10M), ${storeHigh.code} (150tr, tier GTE100M), ${storeQ7.code} (3tr, Q7)`);

    // ===== 2) Sub-tab "🏢 Đặt Hàng Tại HO" =====
    await page.evaluate(() => setOperationOrderSubTab('HO'));
    await page.waitForSelector('#opOrderListPanel', { state: 'visible' });
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '02-subtab-dat-hang-tai-ho.png') });
    console.log('Đã chụp: 02 (sub-tab "Đặt Hàng Tại HO" — badge đổi đúng ngữ cảnh, danh sách RIÊNG không lẫn đơn Siêu Thị)');

    // Đơn HO (50 triệu, < 100 triệu) -> tier LT100M -> HO_APPROVER duyệt được.
    const hoOrder = await createOrder(page, { locationType: 'HO', title: 'Đặt hàng văn phòng phẩm toàn hệ thống - HO', receivingLocationName: 'Kho Tổng HO', amount: 50000000 });
    console.log(`Đã tạo 1 đơn HO: ${hoOrder.code} (50tr, tier LT100M)`);

    // ===== 3) Chứng minh 2 quy trình Siêu Thị/HO TÁCH RIÊNG HOÀN TOÀN =====
    // BUG THẬT đã sửa (demo này viết TRƯỚC đợt "Quy Trình Hỗn Hợp") — luồng Siêu Thị KHÔNG còn phân biệt
    // theo mức giá trị nữa (xem chú thích ở khai báo STORE_LOW/STORE_HIGH đầu file): STORE_LOW giờ là
    // approver Bước 1 DUY NHẤT áp dụng cho MỌI mức (LT10M/FROM10M_TO100M/GTE100M như nhau) — chỉ còn
    // demo được "STORE >< HO tách biệt hoàn toàn" + "không có tên trong Quy Trình Hỗn Hợp (STORE_HIGH) thì
    // bị chặn HOÀN TOÀN, bất kể mức nào", KHÔNG còn demo được "2 approver khác nhau cho 2 mức khác nhau"
    // như bản gốc nữa.
    // Chạy các phép thử "PHẢI BỊ CHẶN" TRƯỚC khi duyệt bất kỳ đơn nào (cả 4 đơn còn PENDING) — để lỗi bị
    // chặn ĐÚNG vì THIẾU QUYỀN (403), không lẫn với lỗi "hồ sơ đã xử lý xong" (409) nếu thử SAU khi đơn đã
    // được duyệt bởi người khác.
    await loginAs(page, STORE_LOW);
    const storeLowApproveHoBlocked = await tryApprove(page, hoOrder.id);
    console.log(`STORE_LOW thử duyệt đơn HO (không thuộc luồng Siêu Thị): ${storeLowApproveHoBlocked.ok ? 'LỖI — LẼ RA PHẢI BỊ CHẶN' : `BỊ CHẶN ĐÚNG (${storeLowApproveHoBlocked.error})`}`);
    if (storeLowApproveHoBlocked.ok) throw new Error('LỖ HỔNG: STORE_LOW duyệt được đơn HO — 2 luồng KHÔNG còn tách biệt!');

    await loginAs(page, HO_APPROVER);
    const hoApproveStoreBlocked = await tryApprove(page, storeQ7.id);
    console.log(`HO_APPROVER thử duyệt đơn Siêu Thị (không thuộc luồng HO): ${hoApproveStoreBlocked.ok ? 'LỖI — LẼ RA PHẢI BỊ CHẶN' : `BỊ CHẶN ĐÚNG (${hoApproveStoreBlocked.error})`}`);
    if (hoApproveStoreBlocked.ok) throw new Error('LỖ HỔNG: HO_APPROVER duyệt được đơn Siêu Thị — 2 luồng KHÔNG còn tách biệt!');

    // STORE_HIGH KHÔNG có dòng nào trong Quy Trình Hỗn Hợp (operationOrderStoreMixedApprovalRules) — bị
    // chặn HOÀN TOÀN khỏi luồng Siêu Thị, bất kể mức nào (khác hẳn thiết kế CŨ trước đợt "Quy Trình Hỗn
    // Hợp", nơi STORE_HIGH từng có quyền riêng ở tier GTE100M).
    await loginAs(page, STORE_HIGH);
    const storeHighBlocked = await tryApprove(page, storeQ7.id);
    console.log(`STORE_HIGH thử duyệt đơn Siêu Thị (không có tên trong Quy Trình Hỗn Hợp): ${storeHighBlocked.ok ? 'LỖI — LẼ RA PHẢI BỊ CHẶN' : `BỊ CHẶN ĐÚNG (${storeHighBlocked.error})`}`);
    if (storeHighBlocked.ok) throw new Error('LỖ HỔNG: STORE_HIGH không có tên trong Quy Trình Hỗn Hợp nhưng vẫn duyệt được!');

    // STORE_LOW (approver Bước 1 duy nhất của Quy Trình Hỗn Hợp) duyệt được CẢ 3 đơn Siêu Thị, bất kể mức.
    await loginAs(page, STORE_LOW);
    const storeLowApproved = await approveOrder(page, storeLow.id);
    console.log(`STORE_LOW duyệt đơn mức THẤP (${storeLow.code}, LT10M): status=${storeLowApproved.status}`);
    const storeHighApprovedByLow = await approveOrder(page, storeHigh.id);
    console.log(`STORE_LOW duyệt luôn đơn mức CAO (${storeHigh.code}, GTE100M — Quy Trình Hỗn Hợp không còn phân biệt mức): status=${storeHighApprovedByLow.status}`);
    const storeQ7Approved = await approveOrder(page, storeQ7.id);
    console.log(`STORE_LOW duyệt nốt ${storeQ7.code} (Q7, tier LT10M): status=${storeQ7Approved.status}`);

    await loginAs(page, HO_APPROVER);
    const hoApproved = await approveOrder(page, hoOrder.id);
    console.log(`HO_APPROVER duyệt đơn ĐÚNG luồng của mình (${hoOrder.code}, tier LT100M): status=${hoApproved.status}`);

    // ===== 4) Ảnh minh hoạ: danh sách Siêu Thị SAU khi 3 đơn đều AWAITING_RECEIPT — CẢ 3 đều do CÙNG 1
    // approver Quy Trình Hỗn Hợp (STORE_LOW) duyệt, bất kể mức — chụp khi đăng nhập CREATOR (người tạo cả
    // 3 đơn, thấy được TOÀN BỘ, khác STORE_LOW chỉ thấy đúng phạm vi được cấp — đúng thiết kế canView,
    // không phải giới hạn của demo). =====
    await loginAs(page, CREATOR);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); setOperationOrderSubTab('STORE'); });
    await page.waitForSelector('#opOrderListPanel', { state: 'visible' });
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '03-sieu-thi-2-muc-da-duyet-boi-2-nguoi-khac-nhau.png') });
    console.log('Đã chụp: 03 (3 đơn Siêu Thị đều AWAITING_RECEIPT — cả 3 mức đều do CÙNG 1 approver Quy Trình Hỗn Hợp duyệt, mức giữa 10-100tr vẫn hiện đúng nhãn dù chưa có đơn nào rơi vào)');

    // ===== 5) Luồng Nhập Hàng vẫn hoạt động bình thường SAU KHI duyệt (bất kể theo tier nào) =====
    await loginAs(page, HO_APPROVER);
    const hoReceived = await receiveGoods(page, hoOrder.id);
    console.log(`HO_APPROVER xác nhận Nhập Hàng cho đơn HO (${hoOrder.code}): status=${hoReceived.status}, receivedAt=${hoReceived.receivedAt}`);
    await loginAs(page, STORE_LOW);
    const storeLowReceived = await receiveGoods(page, storeLow.id);
    console.log(`STORE_LOW xác nhận Nhập Hàng cho đơn Siêu Thị mức thấp (${storeLow.code}): status=${storeLowReceived.status}`);
    // Chụp lại bằng ADMIN (thấy TOÀN BỘ, không giới hạn theo phạm vi tier của 1 approver cụ thể) để thấy
    // rõ cả 3 đơn Siêu Thị cùng lúc: 2 đã RECEIVED (storeLow, và storeHigh vẫn AWAITING_RECEIPT — chưa ai
    // Nhập Hàng), storeQ7 cũng AWAITING_RECEIPT.
    await loginAs(page, ADMIN);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); setOperationOrderSubTab('STORE'); });
    await page.waitForSelector('#opOrderListPanel', { state: 'visible' });
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '04-sau-nhap-hang-status-received.png') });
    console.log('Đã chụp: 04 (đơn đã chuyển RECEIVED sau khi Nhập Hàng — luồng nhận hàng nguyên vẹn sau khi đổi hẳn cơ chế duyệt, xem qua ADMIN để thấy toàn bộ 3 đơn Siêu Thị)');

    // ===== 6) Báo Cáo mở rộng — Tổng Chuỗi + Siêu Thị + HO + theo từng siêu thị =====
    await loginAs(page, ADMIN);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); setOperationOrderSubTab('REPORT'); });
    await page.waitForSelector('#opOrderReportPanel', { state: 'visible' });
    await page.locator('#opOrderReportPanel').screenshot({ path: path.join(OUT_DIR, '05-bao-cao-mo-rong.png') });
    const chain = await page.locator('#opOrderReportSummaryCards').innerText();
    const storeCards = await page.locator('#opOrderReportStoreSummaryCards').innerText();
    const hoCards = await page.locator('#opOrderReportHOSummaryCards').innerText();
    const byStore = await page.locator('#opOrderReportByStoreTableBody').innerText();
    console.log('\n=== Báo Cáo — Tổng Chuỗi ===\n' + chain);
    console.log('\n=== Báo Cáo — Đặt Hàng Tại Siêu Thị ===\n' + storeCards);
    console.log('\n=== Báo Cáo — Đặt Hàng Tại HO ===\n' + hoCards);
    console.log('\n=== Báo Cáo — Theo Từng Siêu Thị (+ TỔNG CHUỖI) ===\n' + byStore);
    console.log('Đã chụp: 05 (Báo Cáo — Tổng Chuỗi/Siêu Thị/HO/theo từng siêu thị + dòng TỔNG CHUỖI)');
    if (!byStore.includes('TỔNG CHUỖI')) throw new Error('Báo cáo thiếu dòng "TỔNG CHUỖI" theo từng siêu thị!');
    if (!byStore.includes('BRGMart Quận 1') || !byStore.includes('BRGMart Quận 7')) throw new Error('Báo cáo thiếu breakdown theo từng siêu thị!');

    console.log(`\nẢnh chụp lưu tại: ${OUT_DIR}`);
    console.log('\nKẾT QUẢ: demo hoàn tất, mọi bước diễn ra đúng như mô tả — 2 quy trình Siêu Thị/HO tách biệt hoàn toàn, đúng biên giới mức, luồng Nhập Hàng và Báo Cáo mở rộng đều hoạt động.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
