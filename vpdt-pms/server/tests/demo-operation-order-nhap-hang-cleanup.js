// server/tests/demo-operation-order-nhap-hang-cleanup.js
//
// DEMO thật (không phải tests/test-*.js — không nằm trong bộ hồi quy chạy tự động), chụp lại TRẠNG THÁI
// THẬT của màn hình sau đợt dọn sạch trạng thái Nhập/Hủy Hàng (v29.25 + v29.26) ở Vận Hành > Đơn Hàng,
// cho CẢ 2 tab "🏬 Đặt Hàng Tại Siêu Thị" lẫn "🏢 Đặt Hàng Tại HO" (dùng chung code) — theo yêu cầu
// người dùng "gửi lại tất cả các ảnh demo mà bạn đã chỉnh sửa".
//
// Dùng ĐÚNG kiến trúc tests/testHarness.js: Chromium thật (Playwright) mở ĐÚNG public/index.html + toàn
// bộ public/js/*.js thật, chỉ tầng mạng (fetch) giả lập — gọi thẳng lib/workflowEngine.js/lib/
// recordActions.js THẬT, không tự đoán lại logic nghiệp vụ.
//
// Chạy: node server/tests/demo-operation-order-nhap-hang-cleanup.js
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'operation-order-nhap-hang-cleanup');

const DEPT = 'Phòng Vận Hành';
const CREATOR = { username: 'vh_creator', name: 'Nhân Viên Mua Hàng (Demo)', dept: DEPT, perms: { operationOrderCreate: true }, active: true };
const STORE_APPROVER = { username: 'vh_store_ap', name: 'Trưởng Ca Siêu Thị (Demo)', dept: DEPT, perms: { operationOrderCreate: true, canBeApprover: true }, active: true };
const HO_APPROVER = { username: 'vh_ho_ap', name: 'Trưởng Phòng Mua Hàng HO (Demo)', dept: DEPT, perms: { operationOrderCreate: true, canBeApprover: true }, active: true };
const ADMIN = { username: 'admin_demo', name: 'Quản Trị Viên (Demo)', dept: DEPT, perms: { admin: true }, active: true, totpEnabled: true };

const state = createMockState({
  depts: [DEPT],
  users: [CREATOR, STORE_APPROVER, HO_APPROVER, ADMIN],
  workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
  operationOrderStoreMixedApprovalRules: [{ id: 1, step: 1, mode: 'PERSON', username: STORE_APPROVER.username, stores: [] }],
  operationOrderHOTierWorkflows: { LT100M: { workflowId: 'WF_1STEP', approvers: { 1: [HO_APPROVER.username] } } }
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
async function rejectOrder(page, id) {
  return page.evaluate(async (id) => {
    openOperationProcessModal('operationOrders', id);
    document.getElementById('txtOperationProcessComment').value = 'Không đúng nhu cầu';
    await processOperation('REJECT');
    return DB.operationOrders.find(o => o.id === id);
  }, id);
}
// Giả lập dữ liệu LỊCH SỬ (hồ sơ tạo trước khi tắt luồng Nhập/Hủy Hàng) — gán thẳng DB, đúng hình dạng
// receiveOperationOrderGoods()/cancelOperationOrderReceipt() (lib/recordActions.js) từng tạo ra, vì
// sub-tab "🧾 Duyệt Nhập/Hủy Đơn Hàng" đã ẩn khỏi UI, không còn đường tạo qua thao tác thật.
async function forceLegacyStatus(page, id, status) {
  await page.evaluate(({ id, status }) => {
    const o = DB.operationOrders.find(x => x.id === id);
    o.status = status;
    if (status === 'RECEIVED') o.receivedAt = new Date().toISOString();
    if (status === 'RECEIPT_CANCELLED') o.receiptCancelledAt = new Date().toISOString();
  }, { id, status });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1400, height: 1600 });

  try {
    // ===== 1) Tạo đơn qua ĐÚNG luồng thật cho cả 2 tab =====
    await loginAs(page, CREATOR);
    const sPending = await createOrder(page, { locationType: 'STORE', title: 'Đặt hàng bánh kẹo - còn chờ duyệt', receivingLocationName: 'Siêu thị BRGMart Quận 1', amount: 1500000 });
    const sToApprove = await createOrder(page, { locationType: 'STORE', title: 'Đặt hàng nước giải khát - sẽ duyệt', receivingLocationName: 'Siêu thị BRGMart Quận 1', amount: 2500000 });
    const sToReject = await createOrder(page, { locationType: 'STORE', title: 'Đặt hàng đồ chơi - sẽ bị từ chối', receivingLocationName: 'Siêu thị BRGMart Quận 7', amount: 800000 });
    const sLegacyReceived = await createOrder(page, { locationType: 'STORE', title: 'Đặt hàng mì gói - hồ sơ cũ (RECEIVED)', receivingLocationName: 'Siêu thị BRGMart Quận 7', amount: 4200000 });
    const sLegacyCancelled = await createOrder(page, { locationType: 'STORE', title: 'Đặt hàng sữa tươi - hồ sơ cũ (RECEIPT_CANCELLED)', receivingLocationName: 'Siêu thị BRGMart Quận 1', amount: 3100000 });

    const hPending = await createOrder(page, { locationType: 'HO', title: 'Đặt hàng văn phòng phẩm HO - còn chờ duyệt', receivingLocationName: 'Kho Tổng HO', amount: 12000000 });
    const hToApprove = await createOrder(page, { locationType: 'HO', title: 'Đặt hàng thiết bị IT HO - sẽ duyệt', receivingLocationName: 'Kho Tổng HO', amount: 35000000 });
    const hLegacyAwaiting = await createOrder(page, { locationType: 'HO', title: 'Đặt hàng đồng phục HO - hồ sơ cũ (AWAITING_RECEIPT)', receivingLocationName: 'Kho Tổng HO', amount: 18000000 });

    // ===== 2) Duyệt/từ chối qua ĐÚNG luồng thật =====
    await loginAs(page, STORE_APPROVER);
    await approveOrder(page, sToApprove.id);
    await rejectOrder(page, sToReject.id);
    await approveOrder(page, sLegacyReceived.id);
    await approveOrder(page, sLegacyCancelled.id);

    await loginAs(page, HO_APPROVER);
    await approveOrder(page, hToApprove.id);
    await approveOrder(page, hLegacyAwaiting.id);

    // ===== 3) Ép về dữ liệu LỊCH SỬ (hồ sơ cũ trước khi tắt luồng Nhập/Hủy Hàng) =====
    await forceLegacyStatus(page, sLegacyReceived.id, 'RECEIVED');
    await forceLegacyStatus(page, sLegacyCancelled.id, 'RECEIPT_CANCELLED');
    await forceLegacyStatus(page, hLegacyAwaiting.id, 'AWAITING_RECEIPT');

    // ===== 4) Ảnh demo — xem bằng ADMIN để thấy TOÀN BỘ hồ sơ, không giới hạn phạm vi approver =====
    await loginAs(page, ADMIN);

    // 4a) Danh Sách — "🏬 Đặt Hàng Tại Siêu Thị": dashboard 4 thẻ (Tổng Số/Đang Chờ Duyệt/Đã Phê Duyệt/
    // Bị Từ Chối) + danh sách — 2 hồ sơ cũ (RECEIVED/RECEIPT_CANCELLED) phải hiện CHUNG badge "✅ Đã phê
    // duyệt", KHÔNG còn 2 nhãn riêng như trước, và được tính vào thẻ "Đã Phê Duyệt" (không phải 2 thẻ
    // Chờ Nhập Hàng/Đã Nhập Hàng đã bỏ).
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); setOperationOrderSubTab('STORE'); });
    await page.waitForSelector('#opOrderListPanel', { state: 'visible' });
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '01-danh-sach-dat-hang-sieu-thi.png') });
    console.log('Đã chụp: 01 (Danh Sách "Đặt Hàng Tại Siêu Thị" — dashboard 4 thẻ + 2 hồ sơ cũ RECEIVED/RECEIPT_CANCELLED hiện CHUNG badge "Đã phê duyệt")');

    // 4b) Danh Sách — "🏢 Đặt Hàng Tại HO": tương tự, 1 hồ sơ cũ AWAITING_RECEIPT phải hiện "Đã phê duyệt".
    await page.evaluate(() => setOperationOrderSubTab('HO'));
    await page.waitForSelector('#opOrderListPanel', { state: 'visible' });
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '02-danh-sach-dat-hang-tai-ho.png') });
    console.log('Đã chụp: 02 (Danh Sách "Đặt Hàng Tại HO" — hồ sơ cũ AWAITING_RECEIPT hiện "Đã phê duyệt")');

    // 4c) Bộ lọc Trạng Thái — xác nhận chỉ còn đúng 5 lựa chọn (KHÔNG còn Chờ Nhập Hàng/Đã Nhập Hàng/Đã
    // Hủy Nhập/"Đã Phê Duyệt (hồ sơ cũ)").
    const filterOptions = await page.evaluate(() => Array.from(document.getElementById('filterStatusOperationOrder').options).map(o => o.textContent.trim()));
    console.log('Các lựa chọn trong bộ lọc "Trạng Thái":', JSON.stringify(filterOptions));
    if (filterOptions.some(t => /Chờ Nhập Hàng|Đã Nhập Hàng|Đã Hủy Nhập|hồ sơ cũ/i.test(t))) {
      throw new Error('LỖI: bộ lọc Trạng Thái vẫn còn sót lựa chọn Nhập/Hủy Hàng!');
    }

    // 4d) Bấm thẻ "Đã Phê Duyệt" trên dashboard -> lọc đúng, đếm đúng cả 2 hồ sơ cũ (RECEIVED +
    // RECEIPT_CANCELLED) + 1 hồ sơ APPROVED thật = 3.
    await page.evaluate(() => setOperationOrderSubTab('STORE'));
    await page.locator('#operationOrderDashboardCards [data-arg0="APPROVED_FAMILY"]').click();
    await page.waitForTimeout(100);
    const filteredRows = await page.evaluate(() => Array.from(document.querySelectorAll('#operationOrderTableBody tr')).length);
    console.log(`Bấm thẻ "Đã Phê Duyệt" (Siêu Thị) -> còn ${filteredRows} dòng (kỳ vọng 3: sToApprove + sLegacyReceived + sLegacyCancelled)`);
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '03-bam-the-da-phe-duyet-loc-dung.png') });
    console.log('Đã chụp: 03 (bấm thẻ dashboard "Đã Phê Duyệt" -> lọc đúng cả hồ sơ mới lẫn hồ sơ cũ)');
    await page.evaluate(() => { document.getElementById('filterStatusOperationOrder').value = ''; onOperationOrderFilterChange(); });

    // 4e) Báo Cáo — chỉ còn đúng 3 khối x 4 thẻ trạng thái (Tổng Chuỗi/Siêu Thị/HO), không còn số
    // tiền/biểu đồ theo tháng/bảng theo siêu thị.
    await page.evaluate(() => setOperationOrderSubTab('REPORT'));
    await page.waitForSelector('#opOrderReportPanel', { state: 'visible' });
    await page.locator('#opOrderReportPanel').screenshot({ path: path.join(OUT_DIR, '04-bao-cao-don-hang-rut-gon.png') });
    const chainCards = await page.locator('#opOrderReportSummaryCards').innerText();
    const storeCards = await page.locator('#opOrderReportStoreSummaryCards').innerText();
    const hoCards = await page.locator('#opOrderReportHOSummaryCards').innerText();
    console.log('\n=== Báo Cáo Đơn Hàng — Tổng Chuỗi ===\n' + chainCards);
    console.log('\n=== Báo Cáo Đơn Hàng — Siêu Thị ===\n' + storeCards);
    console.log('\n=== Báo Cáo Đơn Hàng — HO ===\n' + hoCards);
    console.log('Đã chụp: 04 (Báo Cáo Đơn Hàng — chỉ còn 3 khối x 4 thẻ trạng thái)');
    if (/Chờ Nhập Hàng|Đã Nhập Hàng|Đã Hủy Nhập/i.test(chainCards + storeCards + hoCards)) {
      throw new Error('LỖI: Báo Cáo Đơn Hàng vẫn còn sót thẻ Nhập/Hủy Hàng!');
    }

    // 4f) Phiếu Phê Duyệt in/tải cho 1 hồ sơ cũ (RECEIVED) — xác nhận KHÔNG còn khối "Nhập Hàng" riêng.
    await page.evaluate(() => setOperationOrderSubTab('STORE'));
    await page.waitForSelector('#opOrderListPanel', { state: 'visible' });
    await page.evaluate((id) => viewOperationOrderApprovalSlip(id), sLegacyReceived.id);
    await page.waitForSelector('#viewDocModal:not(.hidden)', { state: 'visible' });
    await page.locator('#viewDocModal .bg-white').first().screenshot({ path: path.join(OUT_DIR, '05-phieu-phe-duyet-ho-so-cu.png') });
    const slipText = await page.locator('#viewModalContent').innerText();
    console.log('Đã chụp: 05 (Phiếu Phê Duyệt cho hồ sơ cũ RECEIVED — không còn khối "Nhập Hàng" riêng)');
    if (/Đã nhập hàng|Đã hủy nhập hàng/i.test(slipText)) {
      throw new Error('LỖI: Phiếu Phê Duyệt vẫn còn hiện khối "Nhập Hàng" riêng cho hồ sơ cũ!');
    }
    await page.evaluate(() => document.getElementById('viewDocModal').classList.add('hidden'));

    // 4g) 📊 Báo Cáo Quản Trị (module Báo Cáo TOP-LEVEL, khác Báo Cáo nội bộ của Đơn Hàng ở trên) >
    // Vận Hành > "📦 Báo Cáo Đơn Hàng (Vận Hành)" — statusBuckets cũng chỉ còn 3 bucket.
    await page.evaluate(() => { switchTab('reports'); selectReportsNavL1('vanHanh'); selectReportsNavL2('vanHanh'); });
    await page.waitForTimeout(200);
    await page.locator('#reportsContent').screenshot({ path: path.join(OUT_DIR, '06-bao-cao-quan-tri-van-hanh.png') });
    const adminReportText = await page.locator('#reportsContent').innerText();
    console.log('Đã chụp: 06 (📊 Báo Cáo Quản Trị > Vận Hành > Báo Cáo Đơn Hàng — statusBuckets đã gộp, chỉ còn 3 bucket)');
    if (/Chờ Nhập Hàng|Đã Nhập Hàng|Đã Hủy Nhập|Đã huỷ nhập/i.test(adminReportText)) {
      throw new Error('LỖI: Báo Cáo Quản Trị (Vận Hành) vẫn còn sót bucket Nhập/Hủy Hàng!');
    }

    console.log(`\nẢnh chụp lưu tại: ${OUT_DIR}`);
    console.log('\nKẾT QUẢ: demo hoàn tất — không còn nơi nào trên UI hiện riêng trạng thái Chờ Nhập Hàng/Đã Nhập Hàng/Đã Hủy Nhập, cho CẢ 2 tab Siêu Thị/HO.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
