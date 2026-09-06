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
// 3 approver KHÁC NHAU — cố tình cấu hình mỗi người 1 mức/1 luồng RIÊNG để chứng minh 2 quy trình Siêu
// Thị/HO tách biệt hoàn toàn VÀ 3 mức của Siêu Thị định tuyến khác nhau: STORE_LOW chỉ duyệt mức
// "< 10 triệu", STORE_HIGH chỉ duyệt mức ">= 100 triệu" (2 mức KHÁC nhau của CÙNG luồng Siêu Thị), HO
// chỉ duyệt luồng HO — không ai trong 3 người này duyệt được hồ sơ ngoài đúng phạm vi được cấp.
const STORE_LOW = { username: 'vh_store_low_demo', name: 'Trưởng Ca Siêu Thị (Demo)', dept: DEPT, perms: { operationOrderCreate: true, canBeApprover: true }, active: true };
const STORE_HIGH = { username: 'vh_store_high_demo', name: 'Giám Đốc Vận Hành Siêu Thị (Demo)', dept: DEPT, perms: { operationOrderCreate: true, canBeApprover: true }, active: true };
const HO_APPROVER = { username: 'vh_ho_demo', name: 'Trưởng Phòng Mua Hàng HO (Demo)', dept: DEPT, perms: { operationOrderCreate: true, canBeApprover: true }, active: true };
// totpEnabled:true — bắt buộc cho tài khoản admin (proceedAfterAuth() ở core.js chặn admin CHƯA bật
// TOTP bằng 1 modal thiết lập bắt buộc, không gọi initDatabase() cho tới khi thiết lập xong; demo chỉ
// cần login thẳng để chụp ảnh, không kiểm tra luồng TOTP).
const ADMIN = { username: 'admin_demo', name: 'Quản Trị Viên (Demo)', dept: DEPT, perms: { admin: true }, active: true, totpEnabled: true };

const state = createMockState({
  depts: [DEPT],
  users: [CREATOR, STORE_LOW, STORE_HIGH, HO_APPROVER, ADMIN],
  workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
  operationOrderStoreTierWorkflows: {
    LT10M: { workflowId: 'WF_1STEP', approvers: { 1: [STORE_LOW.username] } },
    GTE100M: { workflowId: 'WF_1STEP', approvers: { 1: [STORE_HIGH.username] } }
    // FROM10M_TO100M cố ý CHƯA cấu hình — minh hoạ "chưa ai (ngoài Admin) duyệt được" đúng cảnh báo ở
    // renderItPriceTierWorkflowTab()/saveItPriceTierWorkflowConfig() nếu admin lưu thiếu người duyệt.
  },
  operationOrderHOTierWorkflows: {
    LT100M: { workflowId: 'WF_1STEP', approvers: { 1: [HO_APPROVER.username] } }
  }
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

    // ===== 3) Chứng minh 2 quy trình Siêu Thị/HO TÁCH RIÊNG HOÀN TOÀN — mỗi mức chỉ đúng người được
    // cấu hình mới duyệt được, người khác (dù cùng luồng Siêu Thị, khác mức, hoặc khác hẳn luồng HO) đều
    // bị chặn 403 =====
    await loginAs(page, STORE_LOW);
    const storeLowApproveHighBlocked = await tryApprove(page, storeHigh.id);
    console.log(`STORE_LOW thử duyệt đơn STORE mức CAO (150tr, tier GTE100M — không thuộc quyền của mình): ${storeLowApproveHighBlocked.ok ? 'LỖI — LẼ RA PHẢI BỊ CHẶN' : `BỊ CHẶN ĐÚNG (${storeLowApproveHighBlocked.error})`}`);
    if (storeLowApproveHighBlocked.ok) throw new Error('LỖ HỔNG: STORE_LOW không được cấu hình cho tier GTE100M nhưng vẫn duyệt được!');
    const storeLowApproveHoBlocked = await tryApprove(page, hoOrder.id);
    console.log(`STORE_LOW thử duyệt đơn HO (không thuộc luồng Siêu Thị): ${storeLowApproveHoBlocked.ok ? 'LỖI — LẼ RA PHẢI BỊ CHẶN' : `BỊ CHẶN ĐÚNG (${storeLowApproveHoBlocked.error})`}`);
    if (storeLowApproveHoBlocked.ok) throw new Error('LỖ HỔNG: STORE_LOW duyệt được đơn HO — 2 luồng KHÔNG còn tách biệt!');
    // STORE_LOW duyệt ĐÚNG phạm vi của mình (tier LT10M) -> AWAITING_RECEIPT.
    const storeLowApproved = await approveOrder(page, storeLow.id);
    console.log(`STORE_LOW duyệt đơn ĐÚNG tier của mình (${storeLow.code}, LT10M): status=${storeLowApproved.status}`);

    await loginAs(page, HO_APPROVER);
    const hoApproveStoreBlocked = await tryApprove(page, storeQ7.id);
    console.log(`HO_APPROVER thử duyệt đơn Siêu Thị (không thuộc luồng HO): ${hoApproveStoreBlocked.ok ? 'LỖI — LẼ RA PHẢI BỊ CHẶN' : `BỊ CHẶN ĐÚNG (${hoApproveStoreBlocked.error})`}`);
    if (hoApproveStoreBlocked.ok) throw new Error('LỖ HỔNG: HO_APPROVER duyệt được đơn Siêu Thị — 2 luồng KHÔNG còn tách biệt!');
    const hoApproved = await approveOrder(page, hoOrder.id);
    console.log(`HO_APPROVER duyệt đơn ĐÚNG luồng của mình (${hoOrder.code}, tier LT100M): status=${hoApproved.status}`);

    await loginAs(page, STORE_HIGH);
    const storeHighApproveLowBlocked = await tryApprove(page, storeQ7.id); // storeQ7 vẫn PENDING, tier LT10M — STORE_HIGH KHÔNG được cấu hình cho tier này
    console.log(`STORE_HIGH thử duyệt đơn STORE mức THẤP (tier LT10M — không thuộc quyền của mình): ${storeHighApproveLowBlocked.ok ? 'LỖI — LẼ RA PHẢI BỊ CHẶN' : `BỊ CHẶN ĐÚNG (${storeHighApproveLowBlocked.error})`}`);
    if (storeHighApproveLowBlocked.ok) throw new Error('LỖ HỔNG: STORE_HIGH không được cấu hình cho tier LT10M nhưng vẫn duyệt được!');
    const storeHighApproved = await approveOrder(page, storeHigh.id);
    console.log(`STORE_HIGH duyệt đơn ĐÚNG tier của mình (${storeHigh.code}, GTE100M): status=${storeHighApproved.status}`);

    // storeQ7 (tier LT10M) vẫn cần được duyệt cho đủ dữ liệu Báo Cáo — STORE_LOW mới đúng quyền.
    await loginAs(page, STORE_LOW);
    const storeQ7Approved = await approveOrder(page, storeQ7.id);
    console.log(`STORE_LOW duyệt nốt ${storeQ7.code} (Q7, tier LT10M): status=${storeQ7Approved.status}`);

    // ===== 4) Ảnh minh hoạ: danh sách Siêu Thị SAU khi 3 đơn đều AWAITING_RECEIPT, 2 tier khác nhau đã
    // được 2 approver KHÁC NHAU xử lý (STORE_LOW cho LT10M, STORE_HIGH cho GTE100M) — chụp khi đăng nhập
    // CREATOR (người tạo cả 3 đơn, thấy được TOÀN BỘ bất kể tier/approver, khác STORE_LOW/STORE_HIGH chỉ
    // thấy đúng phạm vi tier được cấp — đúng thiết kế canView, không phải giới hạn của demo). =====
    await loginAs(page, CREATOR);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); setOperationOrderSubTab('STORE'); });
    await page.waitForSelector('#opOrderListPanel', { state: 'visible' });
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '03-sieu-thi-2-muc-da-duyet-boi-2-nguoi-khac-nhau.png') });
    console.log('Đã chụp: 03 (3 đơn Siêu Thị đều AWAITING_RECEIPT — mức thấp/cao do 2 approver KHÁC NHAU duyệt, mức giữa 10-100tr vẫn hiện đúng nhãn dù chưa có đơn nào rơi vào)');

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
