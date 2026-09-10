// server/tests/test-operation-order-report.js
//
// Regression Playwright cho Vận Hành > Đơn Hàng, đợt "Báo Cáo + Nhập Hàng" — dùng testHarness.js (mock
// backend gọi THẲNG lib/workflowEngine.js/lib/recordActions.js thật, KHÔNG tự đoán lại logic — xem
// đầu file đó) vì sandbox này không có SQL Server/Docker để chạy server.js thật.
//
// Phủ:
//   1. Sub-tab "🏬 Đặt Hàng Tại Siêu Thị"/"🏢 Đặt Hàng Tại HO"/"📊 Báo Cáo" (đợt "Tách Đơn Hàng Siêu
//      Thị/HO" — thay cho 2 sub-tab "Danh Sách"/"Báo Cáo" cũ).
//   2. Quy trình duyệt theo MỨC GIÁ TRỊ (HO, tier LT100M — thay cho quy trình theo phòng ban cũ):
//      PENDING -> APPROVE bởi đúng approver vẫn hoạt động y hệt trước — chỉ khác 1 điểm: duyệt xong
//      bước cuối giờ tự động chuyển AWAITING_RECEIPT (không dừng ở APPROVED).
//   3. 2 nút MỚI "📥 Nhập Hàng"/"🚫 Hủy Nhập": chỉ hiện + chỉ gọi được khi AWAITING_RECEIPT, chỉ đúng
//      quần thể approver/admin mới thao tác được (chặn 403 với người ngoài quyền).
//   4. Báo cáo (luôn gộp CẢ Siêu Thị lẫn HO — "Tổng Chuỗi"): đếm đúng Tổng/Đã phê duyệt/Chưa phê
//      duyệt/Bị từ chối/Chờ nhập hàng/Đã nhập hàng/Đã hủy nhập + tổng giá trị đã duyệt/đã nhập hàng +
//      nhóm đúng theo tháng (approvedAt/receivedAt).
//   5. Lọc "Siêu Thị (Nơi Nhận)" thu hẹp đúng cả Danh Sách lẫn Báo Cáo.
//
// Chạy: node server/tests/test-operation-order-report.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8985;

const DEPT = 'Phòng Vận Hành';
const CREATOR = { username: 'nv.mua', name: 'Nhân Viên Mua Hàng', dept: DEPT, perms: { operationOrderCreate: true }, active: true };
// Đợt "Duyệt Nhập/Hủy Đơn Hàng tập trung": quyền Nhập Hàng/Hủy Nhập KHÔNG còn mirror quần thể Duyệt/Từ
// chối nữa — cần quyền RIÊNG operationOrderReceiptManage ({all,depts[]}, xem lib/recordActions.js
// isApproverForOperationOrderReceipt()). Gán all:true cho APPROVER ở đây để giữ nguyên các kịch bản
// "Trưởng phòng vừa Duyệt vừa Nhập Hàng" của test này (đơn giản hoá, không cần tách 2 role riêng).
const APPROVER = { username: 'tp.vanhanh', name: 'Trưởng Phòng Vận Hành', dept: DEPT, perms: { operationOrderReceiptManage: { all: true, depts: [] } }, active: true };
const OUTSIDER = { username: 'nv.khac', name: 'Nhân Viên Phòng Khác', dept: 'Phòng Kế Toán', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: DEPT, perms: { admin: true }, active: true };

// Tất cả 5 đơn của test này đều tạo ở sub-tab "Đặt Hàng Tại HO" (đợt "Tách Đơn Hàng Siêu Thị/HO") — quy
// trình duyệt giờ theo MỨC GIÁ TRỊ (HO chỉ 2 mức LT100M/GTE100M), mọi amount dùng trong test đều < 100
// triệu nên rơi hết vào tier LT100M, chỉ cần cấu hình đúng 1 tier này là đủ cho toàn bộ kịch bản.
const state = createMockState({
  depts: [DEPT, 'Phòng Kế Toán'],
  users: [CREATOR, APPROVER, OUTSIDER, ADMIN],
  operationOrderHOTierWorkflows: {
    LT100M: { workflowId: 'wf-vh-order', approvers: { 1: [APPROVER.username] } }
  },
  workflows: [
    { id: 'wf-vh-order', steps: [{ order: 1, name: 'Trưởng Phòng Duyệt' }] }
  ]
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__alerts = [];
    await proceedAfterAuth(u);
  }, user);
}

// Tạo 1 đơn hàng qua ĐÚNG luồng thật (submitOperationOrder() -> POST /api/create/operationOrders ->
// validateAndPrepareCreate() thật ở lib/createValidation.js, qua dispatcher của testHarness.js) — không
// tự dựng object giả, đảm bảo hồ sơ seed ra khớp 100% hình dạng dữ liệu thật. setOperationOrderSubTab('HO')
// TRƯỚC khi điền form: orderLocationType gắn ngầm theo đúng sub-tab đang mở lúc gửi (mirror priceType),
// KHÔNG có ô chọn tay nào — mọi đơn của test này đều "Đặt Hàng Tại HO" (xem chú thích ở state phía trên).
async function createOrder(page, { title, receivingLocationName, amount }) {
  return page.evaluate(({ title, receivingLocationName, amount }) => {
    setOperationOrderSubTab('HO');
    document.getElementById('voCode').value = generateOperationOrderCode();
    document.getElementById('voTitle').value = title;
    document.getElementById('voSupplier').value = 'NCC Test';
    document.getElementById('voReceivingLocationName').value = receivingLocationName || '';
    operationOrderItems = [{ name: 'Hàng test', unit: 'Cái', qty: 1, unitPrice: amount, note: '', productCode: '', barcode: '', qtyReceived: null }];
    return submitOperationOrder({ preventDefault() {}, target: { reset() {} } }).then(() => {
      const item = DB.operationOrders.find(o => o.title === title);
      return item;
    });
  }, { title, receivingLocationName, amount });
}

// Duyệt (bước duy nhất) — mở modal xử lý + gọi processOperation('APPROVE') trực tiếp, cùng khuôn
// approveItPriceConfirmed()/... đã dùng ở các test khác (bỏ qua lớp showConfirmModal() thuần UI/
// withApprovalAuth() — approverAuthLevel mặc định NONE nên không ảnh hưởng gì tới kết quả).
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
    document.getElementById('txtOperationProcessComment').value = 'Giá quá cao';
    await processOperation('REJECT');
    return DB.operationOrders.find(o => o.id === id);
  }, id);
}
async function receiveGoods(page, id) {
  return page.evaluate(async (id) => {
    window.__alerts = [];
    openOperationOrderReceiptActionModal(id, 'RECEIVE');
    await confirmOperationOrderReceiptAction();
    return { item: DB.operationOrders.find(o => o.id === id), alerts: window.__alerts.slice() };
  }, id);
}
async function cancelReceipt(page, id, reason) {
  return page.evaluate(async ({ id, reason }) => {
    window.__alerts = [];
    openOperationOrderReceiptActionModal(id, 'CANCEL');
    if (reason !== undefined) document.getElementById('opReceiptReason').value = reason;
    await confirmOperationOrderReceiptAction();
    return { item: DB.operationOrders.find(o => o.id === id), alerts: window.__alerts.slice() };
  }, { id, reason });
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  let idA, idB, idC, idD, idE;

  try {
    // ===== 1) Tạo 5 đơn hàng khác nhau (2 nơi nhận khác nhau, 1 không nhập nơi nhận) =====
    await run.run('Tạo 5 đơn hàng qua đúng luồng thật (submitOperationOrder -> validateAndPrepareCreate thật)', async () => {
      await loginAs(page, CREATOR);
      const a = await createOrder(page, { title: 'Đơn A - sẽ Nhập Hàng', receivingLocationName: 'Siêu thị Quận 1', amount: 1000000 });
      const b = await createOrder(page, { title: 'Đơn B - sẽ Hủy Nhập', receivingLocationName: 'Siêu thị Quận 7', amount: 2000000 });
      const c = await createOrder(page, { title: 'Đơn C - còn Chờ Duyệt', receivingLocationName: 'Siêu thị Quận 1', amount: 500000 });
      const d = await createOrder(page, { title: 'Đơn D - bị Từ Chối', receivingLocationName: 'Siêu thị Quận 7', amount: 300000 });
      const e = await createOrder(page, { title: 'Đơn E - Chờ Nhập Hàng', receivingLocationName: '', amount: 700000 });
      [idA, idB, idC, idD, idE] = [a, b, c, d, e].map(o => o.id);
      assert(a && b && c && d && e, 'Cả 5 đơn hàng phải được tạo thành công');
      assertEqual(a.status, 'PENDING', 'Đơn mới tạo phải PENDING (chưa đụng gì tới quy trình duyệt)');
    });

    // ===== 2) Quy trình duyệt phòng ban CŨ vẫn hoạt động — regression cao nhất =====
    await run.run('Trưởng phòng duyệt đơn A/B/E (đúng approver dept-workflow) -> tự động AWAITING_RECEIPT (KHÔNG dừng ở APPROVED)', async () => {
      await loginAs(page, APPROVER);
      for (const id of [idA, idB, idE]) {
        const updated = await approveOrder(page, id);
        assertEqual(updated.status, 'AWAITING_RECEIPT', `Đơn #${id} duyệt xong bước cuối phải tự chuyển AWAITING_RECEIPT`);
        assert(updated.approvedAt, `Đơn #${id} phải có approvedAt sau khi duyệt`);
      }
    });
    await run.run('Trưởng phòng từ chối đơn D -> REJECTED như cũ (không ảnh hưởng gì bởi tính năng mới)', async () => {
      const updated = await rejectOrder(page, idD);
      assertEqual(updated.status, 'REJECTED');
      assert(!updated.approvedAt, 'REJECTED không được có approvedAt');
    });
    await run.run('Đơn C giữ nguyên PENDING (chưa ai duyệt) — không bị tính năng mới đụng vào', async () => {
      const item = await page.evaluate((id) => DB.operationOrders.find(o => o.id === id), idC);
      assertEqual(item.status, 'PENDING');
    });
    await run.run('Người NGOÀI quy trình duyệt (nv.khac) vẫn bị chặn Duyệt/Từ chối 403 — quyền gốc không bị nới lỏng', async () => {
      await loginAs(page, OUTSIDER);
      // canApprove=false với outsider -> openOperationProcessModal() không hề dựng nút Duyệt/textarea
      // (modal chỉ hiện span "chỉ xem"), nên gọi thẳng callWorkflowAction() (lớp fetch mà processOperation()
      // dùng bên trong) để mô phỏng ĐÚNG "1 request tự soạn bỏ qua UI" (vd DevTools sửa tay) — kiểm tra
      // đúng lớp chặn SERVER (applyWorkflowAction() thật qua dispatcher testHarness.js), không phụ thuộc
      // cấu trúc DOM của modal.
      const result = await page.evaluate(async (id) => {
        let error = null;
        try { await callWorkflowAction('operationOrders', id, 'approve', { comment: 'tự ý duyệt' }); }
        catch (e) { error = e.message; }
        return { error, item: DB.operationOrders.find(o => o.id === id) };
      }, idC);
      assertIncludes(result.error || '', 'không có quyền', 'Phải báo lỗi không có quyền xử lý');
      assertEqual(result.item.status, 'PENDING', 'Đơn C không được đổi trạng thái khi bị chặn quyền');
    });

    // ===== 3) Nút "Nhập Hàng"/"Hủy Nhập" — đợt "Duyệt Nhập/Hủy Đơn Hàng tập trung" đã CHUYỂN 2 nút này
    // khỏi dòng ở Danh Sách STORE/HO sang HẲN 1 sub-tab riêng "🧾 Duyệt Nhập/Hủy Đơn Hàng"
    // (renderOperationOrderReceiptApprovalTab() -> #opOrderReceiptTableBody), gated bởi quyền RIÊNG
    // operationOrderReceiptManage — KHÔNG còn nằm trong dropdown "Khác" của bảng Danh Sách nữa. =====
    await run.run('Sub-tab "Duyệt Nhập/Hủy Đơn Hàng": chỉ hiện đúng các đơn AWAITING_RECEIPT mà mình có quyền', async () => {
      await loginAs(page, APPROVER);
      const html = await page.evaluate(() => { renderOperationOrderReceiptApprovalTab(); return document.getElementById('opOrderReceiptTableBody').innerHTML; });
      const countReceive = (html.match(/📥 Nhập Hàng/g) || []).length;
      const countCancel = (html.match(/🚫 Hủy Nhập/g) || []).length;
      // AWAITING_RECEIPT ngay lúc này: A, B, E (idA/idB sẽ được xử lý ở kịch bản dưới, nhưng thứ tự
      // chạy tới đây A/B vẫn còn AWAITING_RECEIPT -> tổng cộng 3 dòng đủ điều kiện).
      assertEqual(countReceive, 3, 'Phải có đúng 3 nút Nhập Hàng (A, B, E đang AWAITING_RECEIPT)');
      assertEqual(countCancel, 3, 'Phải có đúng 3 nút Hủy Nhập (A, B, E đang AWAITING_RECEIPT)');
    });
    await run.run('Người NGOÀI quyền operationOrderReceiptManage KHÔNG thấy đơn nào ở sub-tab Duyệt Nhập/Hủy Đơn Hàng', async () => {
      await loginAs(page, OUTSIDER);
      const html = await page.evaluate(() => { renderOperationOrderReceiptApprovalTab(); return document.getElementById('opOrderReceiptTableBody').innerHTML; });
      assert(!html.includes('📥 Nhập Hàng'), 'Người ngoài quyền không được thấy nút Nhập Hàng');
      assert(!html.includes('🚫 Hủy Nhập'), 'Người ngoài quyền không được thấy nút Hủy Nhập');
    });
    await run.run('Người NGOÀI quyền gọi thẳng API Nhập Hàng (bỏ qua UI) vẫn bị chặn 403, KHÔNG đổi trạng thái', async () => {
      const result = await receiveGoods(page, idE); // vẫn đăng nhập OUTSIDER từ bước trên
      assertIncludes(result.alerts, 'không có quyền', 'Phải báo lỗi không có quyền xác nhận nhập hàng');
      assertEqual(result.item.status, 'AWAITING_RECEIPT', 'Trạng thái không được đổi khi bị chặn quyền');
    });
    await run.run('cancelOperationOrderReceipt qua UI thật: thiếu lý do -> chặn lại, KHÔNG gọi API (validate phía client)', async () => {
      await loginAs(page, APPROVER);
      const result = await cancelReceipt(page, idB, ''); // để trống lý do
      assertIncludes(result.alerts, 'Vui lòng nhập lý do hủy nhập', 'Phải chặn ngay ở client khi thiếu lý do, không gọi API');
      assertEqual(result.item.status, 'AWAITING_RECEIPT', 'Chưa đổi gì vì bị chặn validate trước khi gọi API');
    });
    await run.run('Trưởng phòng (approver) xác nhận Nhập Hàng cho đơn A -> RECEIVED + receivedAt', async () => {
      const result = await receiveGoods(page, idA);
      assertEqual(result.item.status, 'RECEIVED');
      assert(result.item.receivedAt, 'Phải có receivedAt');
      assertIncludes(result.alerts, 'Đã xác nhận nhập hàng', 'Phải thông báo thành công');
    });
    await run.run('Trưởng phòng Hủy Nhập cho đơn B (có lý do) -> RECEIPT_CANCELLED + receiptCancelledAt', async () => {
      const result = await cancelReceipt(page, idB, 'NCC báo hết hàng, không giao được');
      assertEqual(result.item.status, 'RECEIPT_CANCELLED');
      assert(result.item.receiptCancelledAt, 'Phải có receiptCancelledAt');
      assertIncludes(result.alerts, 'Đã hủy nhập đơn hàng', 'Phải thông báo thành công');
    });
    await run.run('Không thể Nhập Hàng/Hủy Nhập LẦN NỮA cho đơn đã RECEIVED (sai trạng thái nguồn) — chặn 409', async () => {
      const result = await receiveGoods(page, idA);
      assertIncludes(result.alerts, 'chờ nhập hàng', 'Phải báo lỗi sai trạng thái (đã RECEIVED rồi, không còn AWAITING_RECEIPT)');
      assertEqual(result.item.status, 'RECEIVED', 'Trạng thái không được đổi thêm lần nữa');
    });

    // ===== 4) Báo Cáo — đếm đúng + nhóm đúng theo tháng =====
    // Patch approvedAt/receivedAt để có ĐỦ 3 mốc tháng khác nhau kiểm nhóm "theo thời gian" (không ảnh
    // hưởng gì tới các assertion trạng thái ở trên, chỉ đổi 1 field ngày tháng thuần dữ liệu).
    await run.run('Chuẩn bị mốc thời gian khác tháng cho A/E (đã duyệt) để kiểm nhóm theo tháng', async () => {
      await page.evaluate(({ idA, idE }) => {
        const a = DB.operationOrders.find(o => o.id === idA);
        a.approvedAt = '2026-07-15T09:00:00.000Z';
        a.receivedAt = '2026-07-20T09:00:00.000Z';
        const e = DB.operationOrders.find(o => o.id === idE);
        e.approvedAt = '2026-08-10T09:00:00.000Z';
      }, { idA, idE });
      assert(true);
    });

    await run.run('Báo Cáo: đếm đúng Tổng/Đã phê duyệt/Chưa phê duyệt/Bị từ chối/Chờ nhập hàng/Đã nhập hàng/Đã hủy nhập', async () => {
      const dom = await page.evaluate(() => {
        document.getElementById('opReportFromDateOperationOrder').value = '';
        document.getElementById('opReportToDateOperationOrder').value = '';
        document.getElementById('opReportFilterLocation').value = '';
        renderOperationOrderReport();
        return document.getElementById('opOrderReportSummaryCards').innerText;
      });
      // 5 đơn: A=RECEIVED, B=RECEIPT_CANCELLED, C=PENDING, D=REJECTED, E=AWAITING_RECEIPT.
      // Đã Phê Duyệt = A+B+E = 3. Chưa Phê Duyệt = C = 1. Bị Từ Chối = D = 1. Chờ Nhập Hàng = E = 1.
      // Đã Nhập Hàng = A = 1. Đã Hủy Nhập = B = 1. Tổng = 5.
      assertIncludes(dom, 'Tổng Số Đơn');
      assert(/Tổng Số Đơn\s*\n?\s*5/.test(dom), `Tổng số đơn phải là 5, thực tế:\n${dom}`);
      assert(/Đã Phê Duyệt\s*\n?\s*3/.test(dom), `Đã phê duyệt phải là 3, thực tế:\n${dom}`);
      assert(/Chưa Phê Duyệt\s*\n?\s*1/.test(dom), `Chưa phê duyệt phải là 1, thực tế:\n${dom}`);
      assert(/Bị Từ Chối\s*\n?\s*1/.test(dom), `Bị từ chối phải là 1, thực tế:\n${dom}`);
      assert(/Chờ Nhập Hàng\s*\n?\s*1/.test(dom), `Chờ nhập hàng phải là 1, thực tế:\n${dom}`);
      assert(/Đã Nhập Hàng\s*\n?\s*1/.test(dom), `Đã nhập hàng phải là 1, thực tế:\n${dom}`);
      assert(/Đã Hủy Nhập\s*\n?\s*1/.test(dom), `Đã hủy nhập phải là 1, thực tế:\n${dom}`);
    });

    await run.run('Báo Cáo: tổng giá trị đã phê duyệt = A+B+E (3.700.000), đã nhập hàng = A (1.000.000)', async () => {
      const dom = await page.evaluate(() => document.getElementById('opOrderReportValueTotals').innerText);
      assertIncludes(dom, '3.700.000', `Tổng giá trị đã phê duyệt phải là 3.700.000 VNĐ (1tr+2tr+700k), thực tế:\n${dom}`);
      assertIncludes(dom, '1.000.000', `Tổng giá trị đã nhập hàng phải là 1.000.000 VNĐ (chỉ đơn A), thực tế:\n${dom}`);
    });

    await run.run('Báo Cáo: nhóm "Giá trị đã phê duyệt theo tháng" tách đúng 3 tháng khác nhau (7, 8, 9/2026)', async () => {
      const dom = await page.evaluate(() => document.getElementById('opOrderReportApprovedByMonth').innerText);
      assertIncludes(dom, 'Tháng 7/2026', `Phải có nhóm Tháng 7/2026 (đơn A), thực tế:\n${dom}`);
      assertIncludes(dom, 'Tháng 8/2026', `Phải có nhóm Tháng 8/2026 (đơn E), thực tế:\n${dom}`);
      assertIncludes(dom, 'Tháng 9/2026', `Phải có nhóm Tháng 9/2026 (đơn B, duyệt lúc chạy test = hôm nay)`);
    });
    await run.run('Báo Cáo: nhóm "Giá trị đã nhập hàng theo tháng" chỉ có 1 tháng (7/2026, đơn A)', async () => {
      const dom = await page.evaluate(() => document.getElementById('opOrderReportReceivedByMonth').innerText);
      assertIncludes(dom, 'Tháng 7/2026', `Phải có nhóm Tháng 7/2026, thực tế:\n${dom}`);
      assert(!dom.includes('Tháng 8/2026') && !dom.includes('Tháng 9/2026'), `Không được có tháng khác (chỉ A là RECEIVED), thực tế:\n${dom}`);
    });

    // ===== 5) Lọc "Siêu Thị (Nơi Nhận)" — thu hẹp đúng cả Danh Sách lẫn Báo Cáo =====
    await run.run('Lọc Danh Sách theo "Siêu thị Quận 1" -> chỉ còn đúng 2 đơn (A, C)', async () => {
      const rowCodes = await page.evaluate(() => {
        renderOperationList('operationOrders'); // populate dropdown trước khi set value
        document.getElementById('filterLocationOperationOrder').value = 'Siêu thị Quận 1';
        onOperationOrderFilterChange();
        return Array.from(document.querySelectorAll('#operationOrderTableBody tr td:first-child')).map(td => td.innerText.trim());
      });
      assertEqual(rowCodes.length, 2, `Phải còn đúng 2 dòng (A, C) sau khi lọc theo Siêu thị Quận 1, thực tế: ${JSON.stringify(rowCodes)}`);
      // Reset lại filter để không ảnh hưởng kịch bản sau.
      await page.evaluate(() => { document.getElementById('filterLocationOperationOrder').value = ''; onOperationOrderFilterChange(); });
    });
    await run.run('Lọc Báo Cáo theo "Siêu thị Quận 7" -> chỉ còn B (RECEIPT_CANCELLED) + D (REJECTED), Tổng Số Đơn = 2', async () => {
      const dom = await page.evaluate(() => {
        document.getElementById('opReportFilterLocation').value = 'Siêu thị Quận 7';
        onOperationOrderReportFilterChange();
        return document.getElementById('opOrderReportSummaryCards').innerText;
      });
      assert(/Tổng Số Đơn\s*\n?\s*2/.test(dom), `Tổng số đơn (lọc Quận 7) phải là 2, thực tế:\n${dom}`);
      assert(/Bị Từ Chối\s*\n?\s*1/.test(dom), `Bị từ chối (lọc Quận 7) phải là 1 (đơn D), thực tế:\n${dom}`);
      assert(/Đã Hủy Nhập\s*\n?\s*1/.test(dom), `Đã hủy nhập (lọc Quận 7) phải là 1 (đơn B), thực tế:\n${dom}`);
      // Reset lại filter.
      await page.evaluate(() => { document.getElementById('opReportFilterLocation').value = ''; onOperationOrderReportFilterChange(); });
    });

    // ===== 6) Sub-tab Siêu Thị/HO/Báo Cáo (đợt "Tách Đơn Hàng Siêu Thị/HO") — chuyển qua lại đúng =====
    await run.run('Chuyển sub-tab "📊 Báo Cáo" rồi quay lại "HO" không lỗi, đúng panel hiển thị', async () => {
      const result = await page.evaluate(() => {
        setOperationOrderSubTab('REPORT');
        const reportVisible = !document.getElementById('opOrderReportPanel').classList.contains('hidden');
        const listHiddenWhileReport = document.getElementById('opOrderListPanel').classList.contains('hidden');
        setOperationOrderSubTab('HO');
        const listVisibleAfter = !document.getElementById('opOrderListPanel').classList.contains('hidden');
        const reportHiddenAfter = document.getElementById('opOrderReportPanel').classList.contains('hidden');
        return { reportVisible, listHiddenWhileReport, listVisibleAfter, reportHiddenAfter };
      });
      assert(result.reportVisible, 'Panel Báo Cáo phải hiện khi chọn sub-tab REPORT');
      assert(result.listHiddenWhileReport, 'Panel Danh Sách phải ẩn khi đang ở sub-tab REPORT');
      assert(result.listVisibleAfter, 'Panel Danh Sách phải hiện lại khi chọn sub-tab HO');
      assert(result.reportHiddenAfter, 'Panel Báo Cáo phải ẩn khi quay lại sub-tab HO');
    });
    await run.run('Sub-tab "STORE" chỉ hiện đơn STORE (0 đơn — toàn bộ 5 đơn của test này đều là HO)', async () => {
      const rowCodes = await page.evaluate(() => {
        setOperationOrderSubTab('STORE');
        return Array.from(document.querySelectorAll('#operationOrderTableBody tr td:first-child')).map(td => td.innerText.trim());
      });
      // Bảng rỗng render 1 dòng duy nhất "Chưa có đơn hàng nào." (không phải mã đơn) — không có mã đơn
      // thật nào (bắt đầu bằng DH) lọt qua sub-tab STORE.
      assert(!rowCodes.some(c => c.startsWith('DH')), `Sub-tab STORE không được hiện đơn hàng nào (toàn bộ đều tạo ở HO), thực tế: ${JSON.stringify(rowCodes)}`);
      await page.evaluate(() => setOperationOrderSubTab('HO')); // trả lại đúng sub-tab cho các bước sau (không còn bước nào dùng activeOperationOrderSubTab, nhưng giữ nguyên trạng thái sạch)
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-operation-order-report.js:', err);
  process.exitCode = 1;
});
