// server/tests/demo-operation-order-pdf-autofill.js
//
// DEMO thật (không phải quy hoạch tests/test-*.js — không nằm trong bộ hồi quy chạy tự động) cho đợt
// "Vận Hành > 📦 Đơn Hàng: đọc PDF phiếu đặt hàng NCC tự động điền form".
//
// Ghi chú môi trường: sandbox này KHÔNG có Docker daemon chạy được (ulimit bị chặn) và KHÔNG có SQL
// Server cài sẵn — không dựng được "server thật + SQL Server thật" đúng nghĩa đen. Demo dưới đây dùng
// ĐÚNG kiến trúc testHarness.js mà TOÀN BỘ bộ test thật của repo này đã dùng (xem đầu file đó): Chromium
// thật (Playwright) mở ĐÚNG public/index.html thật + toàn bộ public/js/*.js thật (kể cả pdfjs-dist vendor
// thật ở public/vendor/pdfjs/), chỉ tầng mạng (fetch) là giả lập để gọi thẳng lib/createValidation.js
// thật thay vì qua HTTP — nghĩa là: việc đọc file PDF thật + parse + tự điền form hoàn toàn chạy bằng
// code thật, không giả lập gì (input file đọc bằng file.arrayBuffer() thật ngay trong trình duyệt, không
// đi qua mock nào); chỉ bước LƯU record cuối cùng là qua validateAndPrepareCreate() thật nhưng chạy
// trong tiến trình Node của demo thay vì 1 socket SQL Server thật.
//
// Chạy: node server/tests/demo-operation-order-pdf-autofill.js
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;
const SAMPLE_PDF = '/root/.claude/uploads/92486df7-a010-5b7a-a5ae-6b624f39c073/5b98f22e-120HT_PO.pdf';
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'operation-order-pdf-autofill');

const CREATOR = { username: 'vh_po_demo', name: 'Người Lập Đơn Hàng (Demo)', dept: 'Vận Hành', perms: { operationOrderCreate: true }, active: true };

const state = createMockState({
  depts: ['Vận Hành'],
  users: [CREATOR]
});

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(SAMPLE_PDF)) throw new Error(`Không tìm thấy file PDF mẫu: ${SAMPLE_PDF}`);

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1400, height: 1400 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, CREATOR);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); });
    await page.waitForSelector('#operationOrderForm', { state: 'visible' });

    // ===== 1) Ảnh TRƯỚC khi upload (form trống) =====
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '01-form-truoc-khi-upload.png') });

    // ===== 2) Upload file PDF mẫu thật vào #voFile — kích hoạt handleOperationOrderPdfUpload() thật =====
    await page.setInputFiles('#voFile', SAMPLE_PDF);
    await page.waitForFunction(() => {
      const el = document.getElementById('voPdfParseStatus');
      return el && !el.classList.contains('hidden') && /✅|⚠️/.test(el.innerText);
    }, { timeout: 15000 });

    const parseStatusText = await page.locator('#voPdfParseStatus').innerText();
    console.log('Trạng thái parse:', parseStatusText);
    if (!parseStatusText.includes('✅')) throw new Error(`Parse PDF thất bại: ${parseStatusText}`);

    // Mở khối "Chi Tiết Từ Phiếu Đặt Hàng" nếu đang thu gọn (mặc định mở sẵn, đề phòng đổi sau này)
    const boxHidden = await page.evaluate(() => document.getElementById('operationOrderPoDetailsBox').classList.contains('hidden'));
    if (boxHidden) await page.click('[data-op="toggleOperationOrderPoDetailsBox"]');

    // ===== 3) Ảnh SAU khi tự điền =====
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '02-form-sau-khi-tu-dien.png') });

    // ===== 4) Đối chiếu giá trị đã điền với đúng nội dung PDF mẫu (đọc bằng mắt/tra cứu thủ công PDF) =====
    const filled = await page.evaluate(() => ({
      title: document.getElementById('voTitle').value,
      supplier: document.getElementById('voSupplier').value,
      poNumber: document.getElementById('voPoNumber').value,
      orderDate: document.getElementById('voOrderDate').value,
      deliveryDate: document.getElementById('voDeliveryDate').value,
      ordererName: document.getElementById('voOrdererName').value,
      stationCode: document.getElementById('voStationCode').value,
      supplierCode: document.getElementById('voSupplierCode').value,
      supplierTaxCode: document.getElementById('voSupplierTaxCode').value,
      receivingLocationCode: document.getElementById('voReceivingLocationCode').value,
      receivingLocationName: document.getElementById('voReceivingLocationName').value,
      deliveryAddress: document.getElementById('voDeliveryAddress').value,
      discountAmountDisplay: document.getElementById('voDiscountAmount').value,
      afterDiscountAmountDisplay: document.getElementById('voAfterDiscountAmount').value,
      vatAmountDisplay: document.getElementById('voVatAmount').value,
      paymentTotalAmountDisplay: document.getElementById('voPaymentTotalAmount').value,
      // Round-trip qua ĐÚNG getMoneyValue() thật (core.js) — không tự viết lại logic parse
      discountAmountValue: getMoneyValue(document.getElementById('voDiscountAmount')),
      afterDiscountAmountValue: getMoneyValue(document.getElementById('voAfterDiscountAmount')),
      vatAmountValue: getMoneyValue(document.getElementById('voVatAmount')),
      paymentTotalAmountValue: getMoneyValue(document.getElementById('voPaymentTotalAmount')),
      items: operationOrderItems.map(it => ({ name: it.name, productCode: it.productCode, barcode: it.barcode, unit: it.unit, qty: it.qty, unitPrice: it.unitPrice }))
    }));

    const EXPECTED = {
      poNumber: '400001302608000212',
      ordererName: 'Nguyễn Thị Hương Giang',
      stationCode: 'BRVANHANH19',
      supplierCode: '254000001184',
      supplierName: 'Công ty cổ phần kinh doanh chế biến nông sản Bảo Minh',
      supplierTaxCode: '0106705176',
      receivingLocationCode: '10011',
      receivingLocationName: 'Siêu thị BRGMart 120 Hàng Trống',
      deliveryAddress: 'Số 120 Hàng Trống, P Hàng Trống, Q Hoàn Kiếm, HN',
      orderDate: '2026-08-27T09:22',
      deliveryDate: '2026-08-29',
      discountAmountValue: 0,
      vatAmountValue: 115848,
      afterDiscountAmountValue: 2108100,
      paymentTotalAmountValue: 2223948,
      itemCount: 8
    };

    console.log('\n=== Giá trị đã tự điền ===');
    console.log(JSON.stringify(filled, null, 2));

    const mismatches = [];
    const check = (label, actual, expected) => { if (actual !== expected) mismatches.push(`${label}: kỳ vọng ${JSON.stringify(expected)}, thực tế ${JSON.stringify(actual)}`); };
    check('poNumber', filled.poNumber, EXPECTED.poNumber);
    check('ordererName', filled.ordererName, EXPECTED.ordererName);
    check('stationCode', filled.stationCode, EXPECTED.stationCode);
    check('supplierCode', filled.supplierCode, EXPECTED.supplierCode);
    check('supplier (tên NCC)', filled.supplier, EXPECTED.supplierName);
    check('supplierTaxCode', filled.supplierTaxCode, EXPECTED.supplierTaxCode);
    check('receivingLocationCode', filled.receivingLocationCode, EXPECTED.receivingLocationCode);
    check('receivingLocationName', filled.receivingLocationName, EXPECTED.receivingLocationName);
    check('deliveryAddress', filled.deliveryAddress, EXPECTED.deliveryAddress);
    check('orderDate', filled.orderDate, EXPECTED.orderDate);
    check('deliveryDate', filled.deliveryDate, EXPECTED.deliveryDate);
    check('discountAmountValue (round-trip getMoneyValue)', filled.discountAmountValue, EXPECTED.discountAmountValue);
    check('vatAmountValue (round-trip getMoneyValue)', filled.vatAmountValue, EXPECTED.vatAmountValue);
    check('afterDiscountAmountValue (round-trip getMoneyValue)', filled.afterDiscountAmountValue, EXPECTED.afterDiscountAmountValue);
    check('paymentTotalAmountValue (round-trip getMoneyValue)', filled.paymentTotalAmountValue, EXPECTED.paymentTotalAmountValue);
    check('số hạng mục đọc được', filled.items.length, EXPECTED.itemCount);

    if (mismatches.length) {
      console.log('\n⚠️  CÁC FIELD KHÔNG KHỚP KỲ VỌNG (báo cáo trung thực, không che giấu):');
      mismatches.forEach(m => console.log('  - ' + m));
    } else {
      console.log('\n✅ TOÀN BỘ field đối chiếu khớp đúng nội dung PDF mẫu.');
    }

    // ===== 5) Nộp đơn hàng (nút thật, KHÔNG tự bỏ qua form) =====
    await page.click('#operationOrderForm button[type="submit"]');
    await page.waitForFunction(() => window.__alerts && window.__alerts.some(a => a.includes('Đã gửi đơn hàng thành công')));
    const newId = await page.evaluate(() => DB.operationOrders[0].id);

    // ===== 6) Ảnh màn xem chi tiết sau khi lưu =====
    await page.evaluate((id) => openOperationProcessModal('operationOrders', id), newId);
    await page.waitForSelector('#operationProcessModal', { state: 'visible' });
    await page.locator('#operationProcessModal .bg-white.rounded-lg, #operationProcessModal > div').first().screenshot({ path: path.join(OUT_DIR, '03-chi-tiet-sau-khi-luu.png') }).catch(async () => {
      await page.locator('#operationProcessModal').screenshot({ path: path.join(OUT_DIR, '03-chi-tiet-sau-khi-luu.png') });
    });

    const savedRecord = await page.evaluate((id) => DB.operationOrders.find(o => o.id === id), newId);
    console.log('\n=== Bản ghi đã lưu (qua validateAndPrepareCreate thật) ===');
    console.log(JSON.stringify({
      poNumber: savedRecord.poNumber, ordererName: savedRecord.ordererName, supplierCode: savedRecord.supplierCode,
      supplierTaxCode: savedRecord.supplierTaxCode, deliveryAddress: savedRecord.deliveryAddress,
      discountAmount: savedRecord.discountAmount, vatAmount: savedRecord.vatAmount,
      afterDiscountAmount: savedRecord.afterDiscountAmount, paymentTotalAmount: savedRecord.paymentTotalAmount,
      amount: savedRecord.amount, itemCount: savedRecord.items.length
    }, null, 2));

    console.log(`\nẢnh chụp lưu tại: ${OUT_DIR}`);
    console.log(mismatches.length ? `\nKẾT QUẢ: ${mismatches.length} field không khớp — xem chi tiết ở trên.` : '\nKẾT QUẢ: demo thành công, mọi field khớp đúng.');
    process.exitCode = mismatches.length ? 1 : 0;
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
