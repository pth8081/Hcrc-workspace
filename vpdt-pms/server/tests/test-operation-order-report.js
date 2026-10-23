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
//      PENDING -> APPROVE bởi đúng approver vẫn hoạt động y hệt trước, duyệt xong bước cuối DỪNG HẲN ở
//      APPROVED (CẬP NHẬT, đợt "tạm vô hiệu hoá Nhập/Hủy Hàng" theo yêu cầu người dùng — KHÔNG còn tự
//      động chuyển AWAITING_RECEIPT như trước nữa, xem lib/workflowEngine.js).
//   3. Sub-tab "🧾 Duyệt Nhập/Hủy Đơn Hàng" + 2 nút "📥 Nhập Hàng"/"🚫 Hủy Nhập" — TẠM VÔ HIỆU HOÁ, ép
//      ẩn khỏi UI bất kể quyền operationOrderReceiptManage (chỉ ẩn lối vào, hàm/route xử lý vẫn còn —
//      unit-test đầy đủ ở tests/test-operation-order-receiving.js). File này chỉ còn xác nhận sub-tab
//      không mở được + Báo Cáo vẫn hiển thị đúng dữ liệu LỊCH SỬ (mô phỏng bằng cách gán thẳng DB) cho
//      các hồ sơ CŨ từng ở AWAITING_RECEIPT/RECEIVED/RECEIPT_CANCELLED.
//   4. Báo cáo (luôn gộp CẢ Siêu Thị lẫn HO — "Tổng Chuỗi"): đếm đúng Tổng/Đã phê duyệt/Chưa phê
//      duyệt/Bị từ chối/Chờ nhập hàng/Đã nhập hàng/Đã hủy nhập + tổng giá trị đã duyệt/đã nhập hàng +
//      nhóm đúng theo tháng (approvedAt/receivedAt) — vẫn đúng cho dữ liệu LỊCH SỬ dù không còn đường
//      tạo mới các trạng thái Chờ Nhập Hàng/Đã Nhập Hàng/Đã Hủy Nhập qua UI.
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
    // CẬP NHẬT (đợt "tạm vô hiệu hoá Nhập/Hủy Hàng", theo yêu cầu TRỰC TIẾP người dùng): duyệt xong bước
    // cuối giờ DỪNG HẲN ở APPROVED (như mọi module khác), KHÔNG còn tự động chuyển AWAITING_RECEIPT nữa.
    await run.run('Trưởng phòng duyệt đơn A/B/E (đúng approver dept-workflow) -> dừng hẳn ở APPROVED (không còn tự chuyển AWAITING_RECEIPT)', async () => {
      await loginAs(page, APPROVER);
      for (const id of [idA, idB, idE]) {
        const updated = await approveOrder(page, id);
        assertEqual(updated.status, 'APPROVED', `Đơn #${id} duyệt xong bước cuối phải dừng ở APPROVED`);
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

    // ===== 3) Nút "Nhập Hàng"/"Hủy Nhập" — TẠM VÔ HIỆU HOÁ (đợt tiếp nối "Phiếu Phê Duyệt" operationOrders,
    // theo yêu cầu TRỰC TIẾP người dùng: "sau phê duyệt ko còn trạng thái chờ nhập hàng, hủy và nhập hàng
    // nữa"). Sub-tab "🧾 Duyệt Nhập/Hủy Đơn Hàng" giờ ép ẩn khỏi UI (không còn ai bấm vào được, kể cả
    // người có quyền operationOrderReceiptManage — xem setOperationOrderSubTab() ở module-vanhanh.js).
    // Hàm renderOperationOrderReceiptApprovalTab()/receiveOperationOrderGoods()/cancelOperationOrderReceipt()
    // KHÔNG bị xoá (chỉ mất lối vào UI) — phần unit-test đầy đủ cho các hàm đó (ma trận quyền/trạng thái)
    // đã có sẵn ở tests/test-operation-order-receiving.js, KHÔNG lặp lại ở đây. Phần còn lại của file này
    // chỉ cần xác nhận: (a) sub-tab RECEIPT không còn mở được dù đúng quyền, (b) Báo Cáo vẫn hiển thị
    // ĐÚNG dữ liệu LỊCH SỬ cho các hồ sơ đã từng ở AWAITING_RECEIPT/RECEIVED/RECEIPT_CANCELLED (mô phỏng
    // bằng cách gán thẳng DB, giống dữ liệu cũ trước đợt tắt tính năng — không còn đường tạo MỚI qua UI). =====
    await run.run('Sub-tab "🧾 Duyệt Nhập/Hủy Đơn Hàng" giờ LUÔN bị ẩn, kể cả với người có đủ quyền operationOrderReceiptManage', async () => {
      await loginAs(page, APPROVER);
      const hidden = await page.evaluate(() => {
        setOperationOrderSubTab('RECEIPT');
        // Bị ép fallback về STORE/HO (xem opOrderTabOrder trong setOperationOrderSubTab()) vì RECEIPT
        // luôn allowed=false bây giờ — panel Receipt phải ẩn, panel Danh Sách phải hiện thay thế.
        return {
          receiptPanelHidden: document.getElementById('opOrderReceiptPanel').classList.contains('hidden'),
          btnHidden: document.getElementById('btnOpOrderSubRECEIPT').classList.contains('hidden'),
          fellBackToList: !document.getElementById('opOrderListPanel').classList.contains('hidden')
        };
      });
      assert(hidden.receiptPanelHidden, 'Panel Duyệt Nhập/Hủy Đơn Hàng phải luôn ẩn');
      assert(hidden.btnHidden, 'Nút sub-tab RECEIPT phải luôn ẩn (kể cả người có quyền operationOrderReceiptManage)');
      assert(hidden.fellBackToList, 'Phải tự fallback về 1 sub-tab còn cho phép (STORE/HO) khi xin mở RECEIPT');
      // Fallback ở trên rơi về sub-tab ĐẦU TIÊN được phép trong opOrderTabOrder ('STORE'), KHÔNG phải 'HO'
      // — trả lại đúng 'HO' cho các kịch bản lọc Danh Sách phía sau (toàn bộ 5 đơn test này đều tạo ở HO).
      await page.evaluate(() => setOperationOrderSubTab('HO'));
    });
    await run.run('Mô phỏng dữ liệu LỊCH SỬ (như trước đợt tắt tính năng): đơn A->RECEIVED, đơn B->RECEIPT_CANCELLED, đơn E->AWAITING_RECEIPT (giả lập đơn CŨ còn kẹt từ trước khi tắt)', async () => {
      // KHÔNG còn đi qua UI thật (RECEIPT tab đã ẩn) — gán thẳng DB, đúng hình dạng receiveOperationOrderGoods()/
      // cancelOperationOrderReceipt() (lib/recordActions.js) từng tạo ra, để kiểm Báo Cáo vẫn đọc đúng
      // dữ liệu cũ dạng này (các hàm đó vẫn hoạt động y hệt, chỉ mất lối vào UI — xem test-operation-
      // order-receiving.js cho phần unit-test đầy đủ của chính 2 hàm này). Đơn E vừa duyệt xong ở bước
      // trước giờ dừng ở APPROVED thật (hành vi MỚI) — ở đây ép nó về AWAITING_RECEIPT để giả lập 1 đơn
      // CŨ (tạo trước đợt tắt tính năng) vẫn còn kẹt ở bước chờ nhập hàng, xác nhận Báo Cáo vẫn đếm/hiện
      // đúng dữ liệu lịch sử dạng này (không bị xoá/vỡ bởi thay đổi lần này).
      await page.evaluate(({ idA, idB, idE }) => {
        const a = DB.operationOrders.find(o => o.id === idA);
        a.status = 'RECEIVED';
        a.receivedAt = new Date().toISOString();
        a.history.push({ step: 0, action: 'RECEIVED', approver: 'Trưởng Phòng Vận Hành', username: 'tp.vanhanh', time: new Date().toLocaleString('vi-VN'), comment: '' });
        const b = DB.operationOrders.find(o => o.id === idB);
        b.status = 'RECEIPT_CANCELLED';
        b.receiptCancelledAt = new Date().toISOString();
        b.history.push({ step: 0, action: 'RECEIPT_CANCELLED', approver: 'Trưởng Phòng Vận Hành', username: 'tp.vanhanh', time: new Date().toLocaleString('vi-VN'), comment: 'NCC báo hết hàng, không giao được' });
        const e = DB.operationOrders.find(o => o.id === idE);
        e.status = 'AWAITING_RECEIPT';
      }, { idA, idB, idE });
      const [a, b, e] = await page.evaluate(({ idA, idB, idE }) => [idA, idB, idE].map(id => DB.operationOrders.find(o => o.id === id)), { idA, idB, idE });
      assertEqual(a.status, 'RECEIVED');
      assertEqual(b.status, 'RECEIPT_CANCELLED');
      assertEqual(e.status, 'AWAITING_RECEIPT', 'Giả lập đơn CŨ còn kẹt ở Chờ Nhập Hàng (dữ liệu lịch sử, không còn đường tạo mới qua UI)');
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

    await run.run('Báo Cáo: nhóm "Giá trị đã phê duyệt theo tháng" tách đúng 3 tháng khác nhau (7/2026, 8/2026, tháng hiện tại)', async () => {
      // LỖI ĐÃ VÁ (đợt rà soát v25.1→v25.70): đơn B KHÔNG patch approvedAt (giữ nguyên mốc "hôm nay" lúc
      // duyệt ở kịch bản trước) nên nhãn "Tháng X/YYYY" của B luôn là THÁNG CHẠY TEST THẬT, không phải
      // hằng số "Tháng 9/2026" — trước đây gán cứng "hôm nay = tháng 9/2026" nên test tự đỏ bất kỳ lúc
      // nào chạy khác tháng 9 (VD chạy vào tháng 10 như bây giờ). Tính nhãn tháng hiện tại NGAY TRONG
      // page.evaluate() (cùng Date/timezone mà renderOperationOrderReport() dùng để nhóm thật) thay vì
      // hardcode — logic thật (nhóm theo tháng) không đổi, chỉ sửa cách bài test tự biết "hôm nay" là
      // tháng nào.
      const { dom, currentMonthLabel } = await page.evaluate(() => {
        const now = new Date();
        return {
          dom: document.getElementById('opOrderReportApprovedByMonth').innerText,
          currentMonthLabel: `Tháng ${now.getMonth() + 1}/${now.getFullYear()}`
        };
      });
      assertIncludes(dom, 'Tháng 7/2026', `Phải có nhóm Tháng 7/2026 (đơn A), thực tế:\n${dom}`);
      assertIncludes(dom, 'Tháng 8/2026', `Phải có nhóm Tháng 8/2026 (đơn E), thực tế:\n${dom}`);
      assertIncludes(dom, currentMonthLabel, `Phải có nhóm ${currentMonthLabel} (đơn B, duyệt lúc chạy test = hôm nay), thực tế:\n${dom}`);
    });
    await run.run('Báo Cáo: nhóm "Giá trị đã nhập hàng theo tháng" chỉ có 1 tháng (7/2026, đơn A)', async () => {
      const { dom, currentMonthLabel } = await page.evaluate(() => {
        const now = new Date();
        return {
          dom: document.getElementById('opOrderReportReceivedByMonth').innerText,
          currentMonthLabel: `Tháng ${now.getMonth() + 1}/${now.getFullYear()}`
        };
      });
      assertIncludes(dom, 'Tháng 7/2026', `Phải có nhóm Tháng 7/2026, thực tế:\n${dom}`);
      assert(!dom.includes('Tháng 8/2026') && !dom.includes(currentMonthLabel), `Không được có tháng khác (chỉ A là RECEIVED), thực tế:\n${dom}`);
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
