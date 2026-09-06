// server/tests/demo-operation-order-report-receiving.js
//
// DEMO thật (không phải tests/test-*.js — không nằm trong bộ hồi quy chạy tự động) cho đợt "Vận Hành >
// Đơn Hàng: Báo Cáo + Nhập Hàng" — sub-tab "📋 Danh Sách"/"📊 Báo Cáo", 2 nút MỚI "📥 Nhập Hàng"/
// "🚫 Hủy Nhập", lọc "Siêu Thị (Nơi Nhận)".
//
// Ghi chú môi trường (giống hệt tests/demo-operation-order-pdf-autofill.js): sandbox này KHÔNG có Docker
// daemon chạy được và KHÔNG có SQL Server cài sẵn — không dựng được "server thật + SQL Server thật".
// Demo dưới đây dùng ĐÚNG kiến trúc tests/testHarness.js: Chromium thật (Playwright) mở ĐÚNG
// public/index.html + toàn bộ public/js/*.js thật, chỉ tầng mạng (fetch) giả lập để gọi thẳng
// lib/workflowEngine.js/lib/recordActions.js/lib/createValidation.js THẬT (không tự đoán lại logic
// nghiệp vụ) thay vì đi qua HTTP + SQL Server thật.
//
// Chạy: node server/tests/demo-operation-order-report-receiving.js
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'operation-order-report-receiving');

const DEPT = 'Vận Hành';
const CREATOR = { username: 'vh_demo_creator', name: 'Nhân Viên Mua Hàng (Demo)', dept: DEPT, perms: { operationOrderCreate: true }, active: true };
// APPROVER giữ CẢ operationOrderCreate (để qua được cổng canAccessOperationModule() và xem được màn
// hình Vận Hành) LẪN vai trò approver dept-workflow (operationOrderDeptWorkflows bên dưới) — thực tế 1
// Trưởng phòng thường vừa tự đặt hàng vừa duyệt đơn của nhân viên, nên gán cả 2 không phi thực tế; các
// test hồi quy (test-operation-order-report.js) đã tách riêng creator/approver/outsider để kiểm NGHIÊM
// NGẶT từng lớp quyền — demo này chỉ cần 1 tài khoản xem được đủ mọi thứ để chụp ảnh liền mạch.
const APPROVER = { username: 'vh_demo_tp', name: 'Trưởng Phòng Vận Hành (Demo)', dept: DEPT, perms: { operationOrderCreate: true }, active: true };

const state = createMockState({
  depts: [DEPT],
  users: [CREATOR, APPROVER],
  operationOrderHOTierWorkflows: {
    LT100M: { workflowId: 'wf-vh-order-demo', approvers: { 1: [APPROVER.username] } }
  },
  workflows: [{ id: 'wf-vh-order-demo', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }] }]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}
async function createOrder(page, { title, receivingLocationName, amount }) {
  return page.evaluate(({ title, receivingLocationName, amount }) => {
    setOperationOrderSubTab('HO');
    document.getElementById('voCode').value = generateOperationOrderCode();
    document.getElementById('voTitle').value = title;
    document.getElementById('voSupplier').value = 'Công ty CP Thực Phẩm Demo';
    document.getElementById('voReceivingLocationName').value = receivingLocationName || '';
    operationOrderItems = [{ name: 'Mì gói Hảo Hảo', unit: 'Thùng', qty: 10, unitPrice: amount / 10, note: '', productCode: '', barcode: '', qtyReceived: null }];
    return submitOperationOrder({ preventDefault() {}, target: { reset() {} } }).then(() => DB.operationOrders.find(o => o.title === title));
  }, { title, receivingLocationName, amount });
}
async function approveOrder(page, id) {
  return page.evaluate(async (id) => {
    openOperationProcessModal('operationOrders', id);
    document.getElementById('txtOperationProcessComment').value = 'Đồng ý, giá hợp lý';
    await processOperation('APPROVE');
    return DB.operationOrders.find(o => o.id === id);
  }, id);
}
async function receiveGoods(page, id) {
  return page.evaluate(async (id) => {
    openOperationOrderReceiptActionModal(id, 'RECEIVE');
    await confirmOperationOrderReceiptAction();
    return DB.operationOrders.find(o => o.id === id);
  }, id);
}
async function cancelReceipt(page, id, reason) {
  return page.evaluate(async ({ id, reason }) => {
    openOperationOrderReceiptActionModal(id, 'CANCEL');
    document.getElementById('opReceiptReason').value = reason;
    await confirmOperationOrderReceiptAction();
    return DB.operationOrders.find(o => o.id === id);
  }, { id, reason });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1500, height: 1600 });

  try {
    // ===== Chuẩn bị dữ liệu: 4 đơn hàng, 2 siêu thị khác nhau =====
    await loginAs(page, CREATOR);
    const a = await createOrder(page, { title: 'Đặt hàng NCC Bảo Minh - Q1', receivingLocationName: 'Siêu thị BRGMart Quận 1', amount: 5000000 });
    const b = await createOrder(page, { title: 'Đặt hàng NCC Hảo Hảo - Q7', receivingLocationName: 'Siêu thị BRGMart Quận 7', amount: 8000000 });
    const c = await createOrder(page, { title: 'Đặt hàng NCC Vinamilk - Q1', receivingLocationName: 'Siêu thị BRGMart Quận 1', amount: 3000000 });
    const d = await createOrder(page, { title: 'Đặt hàng NCC Acecook - Q7', receivingLocationName: 'Siêu thị BRGMart Quận 7', amount: 6000000 });
    console.log('Đã tạo 4 đơn hàng:', [a, b, c, d].map(o => `${o.code} (${o.title})`).join(', '));

    // Trưởng phòng duyệt A, B, C (đưa cả 3 vào AWAITING_RECEIPT) — D giữ nguyên PENDING để minh hoạ badge "Đang Chờ Duyệt".
    await loginAs(page, APPROVER);
    for (const o of [a, b, c]) {
      const updated = await approveOrder(page, o.id);
      console.log(`Đã duyệt ${updated.code}: status=${updated.status}, approvedAt=${updated.approvedAt}`);
    }

    // A -> Nhập Hàng (RECEIVED). B -> Hủy Nhập (RECEIPT_CANCELLED). C giữ AWAITING_RECEIPT để chụp ảnh nút.
    const aReceived = await receiveGoods(page, a.id);
    console.log(`Đã Nhập Hàng ${aReceived.code}: status=${aReceived.status}, receivedAt=${aReceived.receivedAt}`);
    const bCancelled = await cancelReceipt(page, b.id, 'Nhà cung cấp báo hết hàng, không giao được đợt này');
    console.log(`Đã Hủy Nhập ${bCancelled.code}: status=${bCancelled.status}, lý do="${bCancelled.history.at(-1).comment}"`);

    // ===== Ảnh 1: Sub-tab "📋 Danh Sách" — tổng quan các trạng thái (PENDING/AWAITING_RECEIPT/RECEIVED/RECEIPT_CANCELLED) =====
    // Vẫn đang đăng nhập APPROVER (vừa duyệt/nhập hàng xong ở trên) — đủ quyền xem module (operationOrderCreate)
    // LẪN thấy nút Nhập Hàng/Hủy Nhập (approver dept-workflow) nên không cần đổi user cho phần chụp ảnh.
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); setOperationOrderSubTab('HO'); });
    await page.waitForSelector('#opOrderListPanel', { state: 'visible' });
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '01-danh-sach-subtab-tong-quan.png') });
    console.log('Đã chụp: 01-danh-sach-subtab-tong-quan.png (sub-tab Danh Sách + Báo Cáo, badge trạng thái mới)');

    // ===== Ảnh 2: Nút "📥 Nhập Hàng"/"🚫 Hủy Nhập" ở đơn C (đang AWAITING_RECEIPT) — mở dropdown "Khác ▾"
    // rồi chọn "receive-goods" để hiện modal xác nhận thật (handleActionCellDispatch() thật, không giả lập). =====
    const rowLocatorC = page.locator('#operationOrderTableBody tr', { hasText: c.code });
    await rowLocatorC.scrollIntoViewIfNeeded();
    await rowLocatorC.screenshot({ path: path.join(OUT_DIR, '02a-dong-don-cho-nhap-hang-voi-dropdown.png') });
    await rowLocatorC.locator('select').selectOption('receive-goods');
    await page.waitForSelector('#operationOrderReceiptModal', { state: 'visible' });
    await page.locator('#operationOrderReceiptModal > div').first().screenshot({ path: path.join(OUT_DIR, '02b-modal-xac-nhan-nhap-hang.png') });
    console.log('Đã chụp: 02a (dòng đơn C + dropdown "Khác ▾" có Nhập Hàng/Hủy Nhập), 02b (modal xác nhận Nhập Hàng thật)');
    await page.evaluate(() => closeOperationOrderReceiptActionModal()); // đóng lại, KHÔNG xác nhận — giữ đơn C ở AWAITING_RECEIPT cho báo cáo

    // ===== Ảnh 3: Sub-tab "📊 Báo Cáo" — đếm đúng + tổng giá trị + nhóm theo tháng =====
    await page.evaluate(() => setOperationOrderSubTab('REPORT'));
    await page.waitForSelector('#opOrderReportPanel', { state: 'visible' });
    await page.locator('#opOrderReportPanel').screenshot({ path: path.join(OUT_DIR, '03-bao-cao-subtab.png') });
    const reportSummary = await page.locator('#opOrderReportSummaryCards').innerText();
    const reportTotals = await page.locator('#opOrderReportValueTotals').innerText();
    console.log('\n=== Báo Cáo — thẻ tổng hợp ===\n' + reportSummary);
    console.log('\n=== Báo Cáo — tổng giá trị ===\n' + reportTotals);
    console.log('Đã chụp: 03-bao-cao-subtab.png');

    // ===== Ảnh 4: Lọc "Siêu Thị (Nơi Nhận)" thu hẹp danh sách =====
    await page.evaluate(() => setOperationOrderSubTab('HO'));
    await page.waitForSelector('#opOrderListPanel', { state: 'visible' });
    const rowCountBefore = await page.locator('#operationOrderTableBody tr').count();
    await page.selectOption('#filterLocationOperationOrder', 'Siêu thị BRGMart Quận 1');
    await page.waitForFunction(() => true); // onchange đã chạy đồng bộ (onOperationOrderFilterChange không async)
    const rowCountAfter = await page.locator('#operationOrderTableBody tr').count();
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '04-loc-sieu-thi-thu-hep.png') });
    console.log(`Đã chụp: 04-loc-sieu-thi-thu-hep.png (${rowCountBefore} dòng -> ${rowCountAfter} dòng sau khi lọc "Siêu thị BRGMart Quận 1")`);
    if (rowCountAfter >= rowCountBefore) throw new Error(`Bộ lọc siêu thị KHÔNG thu hẹp danh sách (trước ${rowCountBefore}, sau ${rowCountAfter})`);

    console.log(`\nẢnh chụp lưu tại: ${OUT_DIR}`);
    console.log('\nKẾT QUẢ: demo hoàn tất, mọi bước diễn ra đúng như mô tả.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
