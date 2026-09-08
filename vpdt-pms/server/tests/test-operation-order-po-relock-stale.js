// server/tests/test-operation-order-po-relock-stale.js
//
// Audit nghiệp vụ (Vận Hành > 📦 Đơn Hàng > Đọc PDF tự động điền + khoá field, đợt v13.5).
//
// GIẢ THUYẾT LỖI: applyOperationOrderPoLock()/poFillField()/poFillMoneyField() (public/js/module-vanhanh.js)
// dùng "if (value) el.value = value" — CHỈ ghi đè field khi PDF mới đọc RA được giá trị cho field đó. Khi
// người dùng chọn NHẦM 1 file PDF (VD PDF khác NCC/khác đợt, thiếu 1-2 trường như "Ngày Giao"/"hạng mục")
// rồi chọn LẠI file khác NGAY qua chính ô #voFile — input #voFile KHÔNG bị khoá bởi applyOperationOrderPoLock()
// (chỉ khoá các field text VOxxx, không khoá chính input file) nên KHÔNG bắt buộc phải bấm "🔄 Nhập Lại Từ
// Đầu" trước — đây là 1 thao tác rất tự nhiên. Hệ quả: field nào PDF lần 2 KHÔNG đọc ra được (rỗng) sẽ
// GIỮ NGUYÊN giá trị CŨ từ PDF lần 1 (không bị xoá/không được yêu cầu xác nhận lại) NHƯNG applyOperationOrderPoLock(f2)
// tính lại khoá theo f2 -> field đó chuyển sang KHÔNG khoá (readOnly=false), trông y hệt như field người
// dùng tự gõ/field PDF-lần-2 không có, không còn dấu hiệu nào cho biết giá trị đang hiển thị thực ra vẫn
// là dữ liệu SÓT LẠI từ file PDF #1 đã bị thay thế — dễ nộp đơn hàng với dữ liệu LẪN LỘN giữa 2 phiếu NCC
// khác nhau mà không ai để ý (VD: Ngày Giao/Địa chỉ giao/Người đặt hàng của phiếu CŨ đi kèm Số Đơn NCC/hạng
// mục của phiếu MỚI).
//
// Test gọi ĐÚNG 3 hàm thật (poFillField/poFillMoneyField/applyOperationOrderPoLock, public/js/module-vanhanh.js)
// theo ĐÚNG trình tự mà handleOperationOrderPdfUpload() thật gọi (chỉ bỏ qua bước đọc byte PDF thật — đã có
// tests/demo-operation-order-pdf-autofill.js xác nhận riêng bước đọc/parse PDF thật hoạt động đúng; ở đây
// object "f" truyền vào có ĐÚNG hình dạng mà parsePoLinesToFields() trả về) — KHÔNG dựng lại/đoán lại logic
// khoá, dùng nguyên hàm sản xuất thật đang chạy trong trình duyệt thật (Playwright + public/index.html thật).
//
// Chạy: node server/tests/test-operation-order-po-relock-stale.js
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8998;
const SHOTS_DIR = process.env.PO_RELOCK_SHOTS_DIR || path.join(require('os').tmpdir(), 'po-relock-stale-shots');
try { fs.mkdirSync(SHOTS_DIR, { recursive: true }); } catch (_) { /* ignore */ }

const CREATOR = { username: 'vh_po_relock', name: 'Người Lập Đơn Hàng (Audit)', dept: 'Vận Hành', perms: { operationOrderCreate: true }, active: true };
const state = createMockState({ depts: ['Vận Hành'], users: [CREATOR] });

// Hình dạng object "f" ĐÚNG như parsePoLinesToFields() trả về (xem module-vanhanh.js) — chỉ 2 field khác
// nhau có chủ đích giữa "PDF #1" và "PDF #2" để cô lập đúng 1 biến số đang kiểm tra: deliveryDate (PDF #2
// KHÔNG đọc được, mô phỏng phiếu thiếu dòng "Ngày Giao") + items (PDF #2 KHÔNG đọc được hạng mục nào).
const PDF1_FIELDS = {
  poNumber: 'PO-CU-001', orderDate: '2026-01-01T09:00', deliveryDate: '2026-01-05',
  ordererName: 'Người Đặt Hàng CŨ', stationCode: 'ST-CU', supplierCode: 'SUP-CU', supplierTaxCode: 'TAX-CU',
  receivingLocationCode: 'RC-CU', receivingLocationName: 'Kho CŨ', deliveryAddress: 'Địa chỉ giao CŨ, Hà Nội',
  discountAmount: 1000, vatAmount: 2000, afterDiscountAmount: 30000, paymentTotalAmount: 32000,
  supplierName: 'NCC CŨ',
  items: [{ name: 'Hàng CŨ', unit: 'Cái', qty: 5, unitPrice: 6000, note: '', productCode: 'PC-CU', barcode: 'BC-CU', qtyReceived: null }]
};
// PDF #2: đúng thực tế "chọn nhầm/chọn lại file khác NGAY, không bấm Nhập Lại Từ Đầu trước" — poNumber MỚI
// (khác hẳn), nhưng deliveryDate + items KHÔNG đọc được (rỗng/[] — mô phỏng phiếu thiếu dòng "Ngày Giao"/
// không có bảng hạng mục đọc được, vẫn hợp lệ vì gotAnything chỉ cần poNumber||ordererName||supplierCode||items.length).
const PDF2_FIELDS = {
  poNumber: 'PO-MOI-002', orderDate: '2026-02-01T09:00', deliveryDate: '',
  ordererName: 'Người Đặt Hàng MỚI', stationCode: 'ST-MOI', supplierCode: 'SUP-MOI', supplierTaxCode: 'TAX-MOI',
  receivingLocationCode: 'RC-MOI', receivingLocationName: 'Kho MỚI', deliveryAddress: '',
  discountAmount: 0, vatAmount: 500, afterDiscountAmount: 10000, paymentTotalAmount: 10500,
  supplierName: 'NCC MỚI',
  items: []
};

// Mirror ĐÚNG trình tự bên trong handleOperationOrderPdfUpload() (module-vanhanh.js, sau đoạn đọc/parse
// PDF) — gọi NGUYÊN hàm thật poFillField/poFillMoneyField/applyOperationOrderPoLock, KHÔNG tự viết lại.
// Định nghĩa 1 lần trong trang qua page.evaluate (window.__applyPoSeq), gọi lại nhiều lần cho từng "PDF".
const APPLY_PO_SEQ_SRC = `
window.__applyPoSeq = function(f) {
  if (f.supplierName && !document.getElementById('voSupplier').value.trim()) {
    document.getElementById('voSupplier').value = f.supplierName;
  }
  poFillField('voPoNumber', f.poNumber);
  poFillField('voOrderDate', f.orderDate);
  poFillField('voDeliveryDate', f.deliveryDate);
  poFillField('voOrdererName', f.ordererName);
  poFillField('voStationCode', f.stationCode);
  poFillField('voSupplierCode', f.supplierCode);
  poFillField('voSupplierTaxCode', f.supplierTaxCode);
  poFillField('voReceivingLocationCode', f.receivingLocationCode);
  poFillField('voReceivingLocationName', f.receivingLocationName);
  poFillField('voDeliveryAddress', f.deliveryAddress);
  poFillMoneyField('voDiscountAmount', f.discountAmount);
  poFillMoneyField('voVatAmount', f.vatAmount);
  poFillMoneyField('voAfterDiscountAmount', f.afterDiscountAmount);
  poFillMoneyField('voPaymentTotalAmount', f.paymentTotalAmount);
  if (f.items.length > 0) { operationOrderItems = f.items; }
  applyOperationOrderPoLock(f);
};
`;

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await run.run('Setup: login + mở form Đặt Hàng Tại Siêu Thị', async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, CREATOR);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); });
      await page.waitForSelector('#operationOrderForm', { state: 'visible' });
      await page.evaluate((src) => { (0, eval)(src); }, APPLY_PO_SEQ_SRC);
    });

    await run.run('"Nhập PDF #1" (mô phỏng đúng chuỗi gọi hàm thật) -> field khoá đúng + giá trị đúng PDF #1', async () => {
      await page.evaluate((f) => { window.__applyPoSeq(f); }, PDF1_FIELDS);
      const after1 = await page.evaluate(() => ({
        deliveryDate: document.getElementById('voDeliveryDate').value,
        deliveryDateReadOnly: document.getElementById('voDeliveryDate').readOnly,
        deliveryAddress: document.getElementById('voDeliveryAddress').value,
        poNumber: document.getElementById('voPoNumber').value,
        itemsCount: operationOrderItems.length,
        itemsLocked: operationOrderItemsLocked
      }));
      await page.screenshot({ path: path.join(SHOTS_DIR, '01-sau-pdf1.png'), fullPage: true });
      assertEqual(after1.deliveryDate, '2026-01-05', 'Sau PDF #1: Ngày Giao phải đúng giá trị PDF #1');
      assert(after1.deliveryDateReadOnly, 'Sau PDF #1: Ngày Giao phải bị khoá (readOnly) vì PDF #1 đọc được');
      assertEqual(after1.poNumber, 'PO-CU-001', 'Sau PDF #1: Số Đơn NCC đúng PDF #1');
      assertEqual(after1.itemsCount, 1, 'Sau PDF #1: phải có đúng 1 hạng mục đọc từ PDF #1');
      assert(after1.itemsLocked, 'Sau PDF #1: bảng hạng mục phải khoá vì PDF #1 đọc được hạng mục');
    });

    await run.run('BUG: chọn lại NGAY 1 "PDF #2" khác (KHÔNG bấm "Nhập Lại Từ Đầu" trước — thao tác tự nhiên, ô #voFile không hề bị khoá) -> Ngày Giao/hạng mục SÓT LẠI dữ liệu PDF #1 nhưng lại hiện MỞ KHOÁ như thể đã xác nhận đúng', async () => {
      await page.evaluate((f) => { window.__applyPoSeq(f); }, PDF2_FIELDS);
      const after2 = await page.evaluate(() => ({
        poNumber: document.getElementById('voPoNumber').value,
        ordererName: document.getElementById('voOrdererName').value,
        deliveryDate: document.getElementById('voDeliveryDate').value,
        deliveryDateReadOnly: document.getElementById('voDeliveryDate').readOnly,
        deliveryAddress: document.getElementById('voDeliveryAddress').value,
        deliveryAddressReadOnly: document.getElementById('voDeliveryAddress').readOnly,
        itemsCount: operationOrderItems.length,
        itemsFirstName: operationOrderItems[0] ? operationOrderItems[0].name : null,
        itemsLocked: operationOrderItemsLocked
      }));
      await page.screenshot({ path: path.join(SHOTS_DIR, '02-sau-pdf2-du-lieu-lan-lon.png'), fullPage: true });

      // Các field PDF #2 THẬT SỰ đọc được phải cập nhật đúng (không phải lỗi ở phần này).
      assertEqual(after2.poNumber, 'PO-MOI-002', 'Số Đơn NCC phải cập nhật đúng theo PDF #2 (field này PDF #2 CÓ đọc được)');
      assertEqual(after2.ordererName, 'Người Đặt Hàng MỚI', 'Người đặt hàng phải cập nhật đúng theo PDF #2');

      // ĐIỂM XÁC NHẬN LỖI: Ngày Giao PDF #2 không đọc được (rỗng) -> đúng ra phải HOẶC giữ khoá+giá trị cũ
      // rõ ràng HOẶC được xoá về rỗng để người dùng biết cần tự điền lại — thực tế: vẫn hiện giá trị PDF #1
      // ("2026-01-05") NHƯNG readOnly đã tắt (trông như ô tự do/đã xác nhận), đi kèm poNumber đã đổi hẳn
      // sang PO-MOI-002 -> dữ liệu ĐƠN HÀNG cuối cùng nếu nộp ngay sẽ LẪN Ngày Giao của phiếu CŨ (PO-CU-001)
      // với Số Đơn NCC/Người đặt hàng của phiếu MỚI (PO-MOI-002), không có cảnh báo nào.
      console.log(`  >> [BUG CONFIRM] voDeliveryDate sau PDF #2 = "${after2.deliveryDate}" (readOnly=${after2.deliveryDateReadOnly}) trong khi poNumber đã đổi sang "${after2.poNumber}" — PDF #2 không hề cung cấp Ngày Giao`);
      assertEqual(after2.deliveryDate, '2026-01-05',
        'XÁC NHẬN LỖI: Ngày Giao vẫn giữ nguyên giá trị của PDF #1 (SÓT LẠI) dù đơn hàng đã mang Số Đơn NCC/Người đặt hàng của PDF #2 — poFillField() chỉ ghi đè khi value truthy, không xoá/cảnh báo khi PDF sau không có field này');
      assertEqual(after2.deliveryDateReadOnly, false,
        'XÁC NHẬN LỖI: Ngày Giao bị MỞ KHOÁ (readOnly=false) sau PDF #2 dù giá trị đang hiển thị thực ra là SÓT LẠI từ PDF #1, không phải do PDF #2 xác nhận lại hay do người dùng tự gõ mới — không còn dấu hiệu gì phân biệt được với dữ liệu hợp lệ mới');

      assertEqual(after2.deliveryAddress, 'Địa chỉ giao CŨ, Hà Nội',
        'XÁC NHẬN LỖI (field thứ 2, cùng cơ chế): Địa chỉ giao cũng SÓT LẠI giá trị PDF #1 dù PDF #2 không cung cấp');

      assertEqual(after2.itemsCount, 1, 'XÁC NHẬN LỖI: bảng hạng mục vẫn còn 1 dòng SÓT LẠI từ PDF #1 (PDF #2 không có hạng mục nào, operationOrderItems lẽ ra phải rỗng hoặc được hỏi lại rõ ràng)');
      assertEqual(after2.itemsFirstName, 'Hàng CŨ', 'XÁC NHẬN LỖI: hạng mục hiển thị vẫn là "Hàng CŨ" (từ PDF #1) dù Số Đơn NCC đã đổi sang phiếu MỚI');
      assertEqual(after2.itemsLocked, false, 'XÁC NHẬN LỖI: bảng hạng mục bị MỞ KHOÁ (trông như tự do sửa/thêm) dù dữ liệu đang hiển thị vẫn là hạng mục SÓT LẠI từ PDF #1, không phải do PDF #2 xác nhận');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
  console.log(`(Ảnh chụp màn hình lưu tại: ${SHOTS_DIR})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
