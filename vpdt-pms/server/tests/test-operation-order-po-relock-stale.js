// server/tests/test-operation-order-po-relock-stale.js
//
// Audit nghiệp vụ (Vận Hành > 📦 Đơn Hàng > Đọc PDF tự động điền + khoá field).
//
// LỊCH SỬ: bản test trước đây (đợt v13.9, commit 35383d7) mô phỏng lại 1 phần trình tự gọi hàm
// (chỉ poFillField/poFillMoneyField/applyOperationOrderPoLock qua window.__applyPoSeq) để chứng minh
// lỗi "chọn lại PDF #2 mà không bấm Reset -> field PDF #2 không đọc được vẫn SÓT giá trị PDF #1 nhưng
// lại MỞ KHOÁ". Tuy nhiên bản test đó KHÔNG gọi đúng hàm production thật
// (handleOperationOrderPdfUpload()) — nó bỏ sót chính đoạn guard clear-trước-khi-điền đã được thêm
// TRONG CÙNG commit 35383d7 đó:
//   if (operationOrderPoLocked) {
//     Object.keys(OPERATION_ORDER_PO_FIELD_TO_KEY).forEach(id => { ...el.value = ''... });
//     operationOrderItems = [];
//     applyOperationOrderPoLock(null);
//   }
// Guard này chạy ngay khi chọn lại 1 file MỚI (bất kể lần đầu hay lần sau) trong khi
// operationOrderPoLocked đang true — xoá sạch các field PO về rỗng + mở khoá TRƯỚC khi điền dữ liệu
// PDF #2, nên field nào PDF #2 không đọc được sẽ hiện ĐÚNG là rỗng (không sót dữ liệu PDF #1) chứ
// không phải "sót giá trị cũ nhưng mở khoá" như bản test cũ giả định.
//
// Rà soát lại (10/2026) bằng cách gọi THẲNG hàm handleOperationOrderPdfUpload() thật (không dựng lại
// sequence tay) — stub window.pdfjsLib.getDocument() (0 trang, khỏi cần byte PDF thật) +
// window.parsePoLinesToFields() (trả thẳng object field đã chuẩn bị sẵn, khỏi cần dựng lại token PDF
// thật — bước đọc/parse PDF thật đã có tests/demo-operation-order-pdf-autofill.js xác nhận riêng) —
// xác nhận: KHÔNG còn sót dữ liệu, bug này đã được vá đúng từ trước. Viết lại test này để gọi đúng
// hàm thật và test ĐÚNG hành vi hiện tại (không còn test ngược kiểu "assert lỗi vẫn còn").
//
// Chạy: node server/tests/test-operation-order-po-relock-stale.js
const path = require('path');
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8998;
const CREATOR = { username: 'vh_po_relock', name: 'Người Lập Đơn Hàng (Audit)', dept: 'Vận Hành', perms: { operationOrderCreate: true }, active: true };
const state = createMockState({ depts: ['Vận Hành'], users: [CREATOR] });

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

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await run.run('Setup: login + mở form Đặt Hàng Tại Siêu Thị + stub pdf.js/parsePoLinesToFields', async () => {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, CREATOR);
      await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); });
      // Thu gọn form (10/2026) — #operationOrderForm giờ mặc định ẨN, phải bấm "+ Tạo Đơn Hàng" trước.
      await page.evaluate(() => openOperationOrderForm());
      await page.waitForSelector('#operationOrderForm', { state: 'visible' });
      // Stub để gọi được NGUYÊN hàm handleOperationOrderPdfUpload() thật mà không cần byte PDF thật —
      // bước đọc/parse PDF thật (poExtractLines/parsePoLinesToFields trên dữ liệu nhị phân thật) đã có
      // tests/demo-operation-order-pdf-autofill.js xác nhận riêng.
      await page.evaluate(() => {
        window.pdfjsLib = { getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }) };
        window.__poParseQueue = [];
        window.parsePoLinesToFields = () => window.__poParseQueue.shift();
      });
    });

    await run.run('Chọn "PDF #1" qua handleOperationOrderPdfUpload() THẬT -> field khoá đúng + giá trị đúng PDF #1', async () => {
      await page.evaluate(async (f) => {
        window.__poParseQueue.push(f);
        const fakeFile = new File(['%PDF-fake'], 'po1.pdf', { type: 'application/pdf' });
        await handleOperationOrderPdfUpload({ target: { files: [fakeFile] } });
      }, PDF1_FIELDS);
      const after1 = await page.evaluate(() => ({
        deliveryDate: document.getElementById('voDeliveryDate').value,
        deliveryDateReadOnly: document.getElementById('voDeliveryDate').readOnly,
        deliveryAddress: document.getElementById('voDeliveryAddress').value,
        poNumber: document.getElementById('voPoNumber').value,
        itemsCount: operationOrderItems.length,
        itemsLocked: operationOrderItemsLocked
      }));
      assertEqual(after1.deliveryDate, '2026-01-05', 'Sau PDF #1: Ngày Giao phải đúng giá trị PDF #1');
      assert(after1.deliveryDateReadOnly, 'Sau PDF #1: Ngày Giao phải bị khoá (readOnly) vì PDF #1 đọc được');
      assertEqual(after1.poNumber, 'PO-CU-001', 'Sau PDF #1: Số Đơn NCC đúng PDF #1');
      assertEqual(after1.itemsCount, 1, 'Sau PDF #1: phải có đúng 1 hạng mục đọc từ PDF #1');
      assert(after1.itemsLocked, 'Sau PDF #1: bảng hạng mục phải khoá vì PDF #1 đọc được hạng mục');
    });

    await run.run('Chọn lại NGAY "PDF #2" khác qua hàm THẬT (không bấm "Nhập Lại Từ Đầu") -> field PDF #1 phải được XOÁ SẠCH (guard clear-trước-khi-điền), KHÔNG còn sót dữ liệu cũ', async () => {
      await page.evaluate(async (f) => {
        window.__poParseQueue.push(f);
        const fakeFile = new File(['%PDF-fake'], 'po2.pdf', { type: 'application/pdf' });
        await handleOperationOrderPdfUpload({ target: { files: [fakeFile] } });
      }, PDF2_FIELDS);
      const after2 = await page.evaluate(() => ({
        poNumber: document.getElementById('voPoNumber').value,
        ordererName: document.getElementById('voOrdererName').value,
        deliveryDate: document.getElementById('voDeliveryDate').value,
        deliveryDateReadOnly: document.getElementById('voDeliveryDate').readOnly,
        deliveryAddress: document.getElementById('voDeliveryAddress').value,
        deliveryAddressReadOnly: document.getElementById('voDeliveryAddress').readOnly,
        itemsCount: operationOrderItems.length,
        itemsLocked: operationOrderItemsLocked
      }));

      // Các field PDF #2 THẬT SỰ đọc được phải cập nhật đúng.
      assertEqual(after2.poNumber, 'PO-MOI-002', 'Số Đơn NCC phải cập nhật đúng theo PDF #2');
      assertEqual(after2.ordererName, 'Người Đặt Hàng MỚI', 'Người đặt hàng phải cập nhật đúng theo PDF #2');

      // Đã VÁ (guard clear-trước-khi-điền trong handleOperationOrderPdfUpload()): field nào PDF #2
      // KHÔNG đọc được phải hiện rỗng (đã xoá sạch giá trị PDF #1), không được sót "2026-01-05".
      assertEqual(after2.deliveryDate, '', 'Ngày Giao phải được XOÁ SẠCH (rỗng) vì PDF #2 không cung cấp — KHÔNG được sót giá trị PDF #1');
      assertEqual(after2.deliveryDateReadOnly, false, 'Ngày Giao phải mở khoá (readOnly=false) vì hiện đang rỗng, chờ người dùng tự nhập hoặc chọn đúng PDF');
      assertEqual(after2.deliveryAddress, '', 'Địa chỉ giao phải được XOÁ SẠCH (rỗng), không được sót giá trị PDF #1');

      assertEqual(after2.itemsCount, 0, 'Bảng hạng mục phải RỖNG (đã xoá operationOrderItems cũ) vì PDF #2 không có hạng mục nào');
      assertEqual(after2.itemsLocked, false, 'Bảng hạng mục phải mở khoá vì hiện đang rỗng, không phải dữ liệu PDF #1 sót lại trông như đã xác nhận');
    });

    await run.run('Field người dùng tự gõ tay (Tiêu Đề/Nhà Cung Cấp) KHÔNG bị guard xoá nhầm khi chọn lại PDF', async () => {
      await page.evaluate(() => { resetOperationOrderForm(); openOperationOrderForm(); });
      await page.evaluate(() => {
        document.getElementById('voTitle').value = 'Tiêu đề tự gõ tay';
        document.getElementById('voSupplier').value = 'NCC tự gõ tay';
        document.getElementById('voNote').value = 'Ghi chú tự gõ tay';
      });
      await page.evaluate(async (f) => {
        window.__poParseQueue.push(f);
        const fakeFile = new File(['%PDF-fake'], 'po3.pdf', { type: 'application/pdf' });
        await handleOperationOrderPdfUpload({ target: { files: [fakeFile] } });
      }, PDF1_FIELDS);
      // PDF #1 lần 2: lúc này form chưa khoá (operationOrderPoLocked=false sau reset) nên guard
      // clear-trước-khi-điền không chạy — nhánh "lần đầu chọn PDF" vẫn giữ nguyên field tự gõ.
      await page.evaluate(async (f) => {
        window.__poParseQueue.push(f);
        const fakeFile = new File(['%PDF-fake'], 'po4.pdf', { type: 'application/pdf' });
        await handleOperationOrderPdfUpload({ target: { files: [fakeFile] } });
      }, PDF2_FIELDS);
      const after = await page.evaluate(() => ({
        title: document.getElementById('voTitle').value,
        note: document.getElementById('voNote').value,
      }));
      assertEqual(after.title, 'Tiêu đề tự gõ tay', 'Guard clear-trước-khi-điền KHÔNG được đụng tới Tiêu Đề do người dùng tự gõ');
      assertEqual(after.note, 'Ghi chú tự gõ tay', 'Guard clear-trước-khi-điền KHÔNG được đụng tới Ghi Chú do người dùng tự gõ');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch((err) => { console.error(err); process.exit(1); });
