// server/tests/test-itprice-wholesale-approval-slip.js
//
// Regression cho tính năng "🖨️ Xem/Tải Phiếu Phê Duyệt" + định dạng bảng mặt hàng đúng Excel ở Phê
// Duyệt Giá Bán Buôn (itPriceApprovals, priceType==='WHOLESALE') — yêu cầu người dùng (11/2026):
// "khi phê duyệt xong để thực hiện cần in ra phiếu phê duyệt có thông tin đầy đủ như khi nhập form và
// có cả thông tin các mã hàng phê duyệt và chân ký phê duyệt để có thể in phiếu lưu bản cứng" + "cho
// xem thông tin trên web các giá trị giống hệt khi nhập excel... cột %, đơn giá, số lượng phải chính
// xác theo định dạng". Tái dùng hạ tầng Phiếu Phê Duyệt dùng chung (buildApprovalSlipShellHTML()/
// buildApprovalSignatureColumnHTML(), core.js) — mirror test-operation-order-approval-slip.js.
//
// Kiểm tra:
//   A. isItPriceCurrencyColumn()/isItPriceQuantityColumn()/formatItPriceCellValue(): nhận diện đúng cột
//      theo nhãn, định dạng đúng tiền tệ/số lượng/%, không đụng cột khác, giá trị không parse được giữ
//      nguyên chuỗi gốc.
//   B. canAccessItPriceWholesaleApprovalSlip(): admin/người tạo/người đã từng duyệt bất kỳ bước nào ->
//      true; người ngoài -> false.
//   C. buildItPriceWholesaleApprovalSlipHTML(): dùng đúng khung chung (as-field-table/as-items-table/
//      as-sign-row), hiện đủ field form (mã đề xuất, phòng ban, mức áp dụng, đơn vị áp dụng, ngành
//      hàng...), bảng mặt hàng lấy từ ĐÚNG file đã duyệt, định dạng đúng theo Excel, có chân ký.
//   D. viewItPriceWholesaleApprovalSlip()/downloadItPriceWholesaleApprovalSlip(): chặn đúng khi priceType
//      !== WHOLESALE, khi CHƯA APPROVED, khi người xem không có quyền; mở modal/tạo file đúng khi hợp lệ.
//   E. renderItPriceModalControls(): chỉ hiện 2 nút Xem/Tải Phiếu khi đủ điều kiện (WHOLESALE + APPROVED
//      + có quyền), KHÔNG hiện cho RETAIL dù đã APPROVED.
//   F. Không có lỗi JS chưa bắt (pageerror) nào phát sinh.
//
// Chạy: node server/tests/test-itprice-wholesale-approval-slip.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'
  }[ext] || 'application/octet-stream';
}
function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  const out = await page.evaluate(() => {
    // --- A: isItPriceCurrencyColumn()/isItPriceQuantityColumn()/formatItPriceCellValue() ---
    const colDonGia = { key: 'c1', label: 'Đơn Giá Bán Buôn Mới' };
    const colSoLuong = { key: 'c2', label: 'Số Lượng Tối Thiểu' };
    const colPercent = { key: 'c3', label: '% Chiết Khấu' };
    const colMaHang = { key: 'c0', label: 'Mã Hàng' };
    const colHinhThuc = { key: 'c4', label: 'Hình Thức Chiết Khấu' };
    const formatMatrix = {
      currencyDetected: isItPriceCurrencyColumn(colDonGia) && !isItPriceCurrencyColumn(colMaHang) && !isItPriceCurrencyColumn(colPercent),
      quantityDetected: isItPriceQuantityColumn(colSoLuong) && !isItPriceQuantityColumn(colMaHang) && !isItPriceQuantityColumn(colDonGia),
      percentStillWorks: isItPricePercentColumn(colPercent) && !isItPriceCurrencyColumn(colPercent) && !isItPriceQuantityColumn(colPercent),
      hinhThucExcludedFromAll: !isItPricePercentColumn(colHinhThuc) && !isItPriceCurrencyColumn(colHinhThuc) && !isItPriceQuantityColumn(colHinhThuc),
      currencyFormatted: formatItPriceCellValue(colDonGia, '185000') === '185.000 đ',
      quantityFormatted: formatItPriceCellValue(colSoLuong, '1200') === '1.200',
      percentFormatted: formatItPriceCellValue(colPercent, '0.08') === '8.00%',
      maHangUnformatted: formatItPriceCellValue(colMaHang, 'SP00123') === 'SP00123',
      currencyNonNumericPassthrough: formatItPriceCellValue(colDonGia, 'N/A') === 'N/A',
      emptyPassthrough: formatItPriceCellValue(colDonGia, '') === ''
    };

    // --- Seed tối thiểu: 1 đề xuất Bán Buôn đã APPROVED hoàn tất, quy trình 2 bước, 1 file đã duyệt ---
    Object.assign(DB, {
      workflows: [{ id: 'WF_2STEP', name: 'Bán Buôn 2 bước', steps: [
        { order: 1, name: 'Trưởng Phòng Mua Hàng', actionLabel: null },
        { order: 2, name: 'Giám Đốc Vận Hành', actionLabel: 'Phê Duyệt Cuối' }
      ] }],
      itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_2STEP', approvers: { 1: ['tp1'], 2: ['gd1'] } } },
      itPriceDeptWorkflows: {},
      itPriceApprovals: []
    });
    const columnLabels = [
      { key: 'c0', label: 'Mã Hàng' }, { key: 'c1', label: 'Tên Hàng' },
      { key: 'c2', label: 'Số Lượng Tối Thiểu' }, { key: 'c3', label: 'Đơn Giá Bán Buôn' },
      { key: 'c4', label: '% Chiết Khấu' }
    ];
    const fileItems = [
      { values: { c0: 'SP00123', c1: 'Sữa tươi Vinamilk 1L', c2: '500', c3: '185000', c4: '0.08' } },
      { values: { c0: 'SP00456', c1: 'Sữa chua Yomost 180ml', c2: '1200', c3: '42500', c4: '0.055' } }
    ];
    const p = {
      id: 8001, code: 'BB-2026-0417', dept: 'Phòng Mua Hàng', priceType: 'WHOLESALE',
      priceTier: 'MARGIN_LT5', wholesaleApplyUnit: 'Đại lý cấp 1 - Miền Bắc',
      storeScope: { mode: 'OTHER', stores: ['Siêu Thị A'] }, nganhHang: [],
      reason: 'Áp giá combo quý IV/2026', masterListName: 'Mẫu Giá Bán Buôn Chuẩn 2026',
      effectiveDate: '15/11/2026', expiryMode: 'OTHER', expiryDate: '31/12/2026',
      creator: 'nv1', creatorName: 'Nguyễn Thị Lan', createdAt: '08:00 15/10/2026',
      status: 'APPROVED', currentStep: 3,
      files: [{ id: 901, fileName: 'bang-gia.xlsx', columnLabels, items: fileItems }],
      history: [
        { step: 1, action: 'APPROVED', approver: 'Trưởng Phòng Mua Hàng', username: 'tp1', time: '09:00 16/10/2026', comment: '' },
        { step: 2, action: 'APPROVED', approver: 'Giám Đốc Vận Hành', username: 'gd1', time: '10:00 17/10/2026', comment: 'Đồng ý' }
      ]
    };
    DB.itPriceApprovals.push(p);

    // --- B: canAccessItPriceWholesaleApprovalSlip() ---
    const admin = { username: 'admin1', perms: { admin: true } };
    const creator = { username: 'nv1', perms: {} };
    const approver = { username: 'tp1', perms: {} };
    const outsider = { username: 'u.khac', perms: {} };
    const accessMatrix = {
      admin: canAccessItPriceWholesaleApprovalSlip(admin, p),
      creator: canAccessItPriceWholesaleApprovalSlip(creator, p),
      approver: canAccessItPriceWholesaleApprovalSlip(approver, p),
      outsider: canAccessItPriceWholesaleApprovalSlip(outsider, p),
      noUser: canAccessItPriceWholesaleApprovalSlip(null, p)
    };

    // --- C: buildItPriceWholesaleApprovalSlipHTML() ---
    const slipHTML = buildItPriceWholesaleApprovalSlipHTML(p);

    // --- D: view/download gating ---
    const alerts = [];
    window.alert = (msg) => alerts.push(msg);
    let createObjectURLCalled = false;
    URL.createObjectURL = () => { createObjectURLCalled = true; return 'blob:fake'; };
    URL.revokeObjectURL = () => {};
    let downloadFileName = null;
    HTMLAnchorElement.prototype.click = function () { downloadFileName = this.download; };

    // D1: outsider -> blocked
    currentUser = outsider;
    document.getElementById('viewModalContent').innerHTML = '';
    viewItPriceWholesaleApprovalSlip(p.id);
    const outsiderBlockedView = alerts.length === 1 && document.getElementById('viewModalContent').innerHTML === '';
    alerts.length = 0;

    // D2: priceType RETAIL -> blocked ngay cả cho creator/admin (chặn đúng phạm vi ngay tại hàm, không
    // chỉ ẩn nút)
    const retailApproved = Object.assign({}, p, { id: 8002, code: 'BL-001', priceType: 'RETAIL' });
    DB.itPriceApprovals.push(retailApproved);
    currentUser = admin;
    document.getElementById('viewModalContent').innerHTML = '';
    viewItPriceWholesaleApprovalSlip(retailApproved.id);
    const retailBlockedView = alerts.length === 1 && document.getElementById('viewModalContent').innerHTML === '';
    alerts.length = 0;

    // D3: chưa APPROVED -> blocked
    const pendingWholesale = Object.assign({}, p, { id: 8003, code: 'BB-002', status: 'PENDING' });
    DB.itPriceApprovals.push(pendingWholesale);
    currentUser = creator;
    document.getElementById('viewModalContent').innerHTML = '';
    viewItPriceWholesaleApprovalSlip(pendingWholesale.id);
    const pendingBlockedView = alerts.length === 1 && document.getElementById('viewModalContent').innerHTML === '';
    alerts.length = 0;

    // D4: creator hợp lệ -> mở được, nội dung đúng
    currentUser = creator;
    document.getElementById('viewModalContent').innerHTML = '';
    viewItPriceWholesaleApprovalSlip(p.id);
    const creatorCanView = alerts.length === 0 &&
      document.getElementById('viewDocModal').classList.contains('hidden') === false &&
      document.getElementById('viewModalContent').innerHTML.includes('BB-2026-0417');
    alerts.length = 0;

    // D5: approver (từng duyệt bước 1) -> tải được, download đúng tên file
    currentUser = approver;
    downloadItPriceWholesaleApprovalSlip(p.id);
    const approverCanDownload = alerts.length === 0 && createObjectURLCalled && downloadFileName === 'PhieuPheDuyetGiaBanBuon_BB-2026-0417.html';

    // --- E: renderItPriceModalControls() ---
    currentItPriceModalId = p.id;
    currentItPriceModalContext = 'SUPPORT';
    currentUser = creator;
    renderItPriceModalControls(p);
    const controlsHTML = document.getElementById('itPriceModalControls').innerHTML;
    const wholesaleButtonsShown = controlsHTML.includes('viewItPriceWholesaleApprovalSlip') && controlsHTML.includes('downloadItPriceWholesaleApprovalSlip');

    renderItPriceModalControls(retailApproved);
    const retailControlsHTML = document.getElementById('itPriceModalControls').innerHTML;
    const retailButtonsHidden = !retailControlsHTML.includes('viewItPriceWholesaleApprovalSlip') && !retailControlsHTML.includes('downloadItPriceWholesaleApprovalSlip');

    return {
      formatMatrix, accessMatrix, slipHTML,
      outsiderBlockedView, retailBlockedView, pendingBlockedView, creatorCanView, approverCanDownload,
      wholesaleButtonsShown, retailButtonsHidden
    };
  });

  record('A1: isItPriceCurrencyColumn() nhận đúng cột "Đơn Giá Bán Buôn Mới", loại trừ Mã Hàng/%', out.formatMatrix.currencyDetected, JSON.stringify(out.formatMatrix));
  record('A2: isItPriceQuantityColumn() nhận đúng cột "Số Lượng Tối Thiểu", loại trừ Mã Hàng/Đơn Giá', out.formatMatrix.quantityDetected, JSON.stringify(out.formatMatrix));
  record('A3: isItPricePercentColumn() vẫn hoạt động như cũ, không bị 2 bộ nhận diện mới đụng vào', out.formatMatrix.percentStillWorks, JSON.stringify(out.formatMatrix));
  record('A4: "Hình Thức Chiết Khấu" vẫn bị loại khỏi CẢ 3 bộ nhận diện (percent/currency/quantity)', out.formatMatrix.hinhThucExcludedFromAll, JSON.stringify(out.formatMatrix));
  record('A5: formatItPriceCellValue() cột tiền "185000" -> "185.000 đ"', out.formatMatrix.currencyFormatted, JSON.stringify(out.formatMatrix));
  record('A6: formatItPriceCellValue() cột số lượng "1200" -> "1.200"', out.formatMatrix.quantityFormatted, JSON.stringify(out.formatMatrix));
  record('A7: formatItPriceCellValue() cột % "0.08" -> "8.00%" (không đổi hành vi cũ)', out.formatMatrix.percentFormatted, JSON.stringify(out.formatMatrix));
  record('A8: cột không khớp nhóm nào (Mã Hàng) giữ nguyên chuỗi gốc', out.formatMatrix.maHangUnformatted, JSON.stringify(out.formatMatrix));
  record('A9: cột tiền giá trị không parse được ("N/A") giữ nguyên, không vỡ', out.formatMatrix.currencyNonNumericPassthrough, JSON.stringify(out.formatMatrix));
  record('A10: giá trị rỗng giữ nguyên rỗng', out.formatMatrix.emptyPassthrough, JSON.stringify(out.formatMatrix));

  record('B1: admin truy cập được Phiếu Phê Duyệt', out.accessMatrix.admin === true, JSON.stringify(out.accessMatrix));
  record('B2: người tạo đề xuất truy cập được', out.accessMatrix.creator === true, JSON.stringify(out.accessMatrix));
  record('B3: người đã từng duyệt (bất kỳ bước nào) truy cập được', out.accessMatrix.approver === true, JSON.stringify(out.accessMatrix));
  record('B4: người ngoài KHÔNG truy cập được', out.accessMatrix.outsider === false, JSON.stringify(out.accessMatrix));
  record('B5: không có currentUser -> false, không crash', out.accessMatrix.noUser === false, JSON.stringify(out.accessMatrix));

  record('C1: Phiếu dùng đúng khung chung (as-field-table/as-items-table/as-sign-row)',
    out.slipHTML.includes('as-field-table') && out.slipHTML.includes('as-items-table') && out.slipHTML.includes('as-sign-row'));
  record('C2: Phiếu có đủ field form (mã đề xuất, phòng ban, mức áp dụng, đơn vị áp dụng, lý do, mẫu giá, ngày áp dụng)',
    out.slipHTML.includes('BB-2026-0417') && out.slipHTML.includes('Phòng Mua Hàng') &&
    out.slipHTML.includes('Đại lý cấp 1 - Miền Bắc') && out.slipHTML.includes('Áp giá combo quý IV/2026') &&
    out.slipHTML.includes('Mẫu Giá Bán Buôn Chuẩn 2026') && out.slipHTML.includes('15/11/2026'));
  record('C3: bảng mặt hàng lấy đúng từ file đã duyệt, định dạng đúng (185.000 đ / 1.200 / 8.00%)',
    out.slipHTML.includes('SP00123') && out.slipHTML.includes('185.000') && out.slipHTML.includes('1.200') && out.slipHTML.includes('8.00%'));
  record('C4: có chân ký cho cả 2 bước (tên người duyệt)',
    out.slipHTML.includes('Trưởng Phòng Mua Hàng') && out.slipHTML.includes('Giám Đốc Vận Hành') && out.slipHTML.includes('Đồng ý'));

  record('D1: người ngoài bị chặn xem (alert, không mở modal)', out.outsiderBlockedView);
  record('D2: priceType RETAIL bị chặn ngay cả cho admin (chặn đúng tại hàm, không chỉ ẩn nút)', out.retailBlockedView);
  record('D3: chưa APPROVED bị chặn xem', out.pendingBlockedView);
  record('D4: người tạo hợp lệ mở được modal, nội dung đúng mã đề xuất', out.creatorCanView);
  record('D5: người từng duyệt tải được, đúng tên file PhieuPheDuyetGiaBanBuon_<mã>.html', out.approverCanDownload);

  record('E1: renderItPriceModalControls() hiện 2 nút Xem/Tải Phiếu cho WHOLESALE đã APPROVED + đủ quyền', out.wholesaleButtonsShown);
  record('E2: renderItPriceModalControls() KHÔNG hiện 2 nút đó cho RETAIL dù đã APPROVED', out.retailButtonsHidden);

  record('F: không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();

  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n==== ${passed}/${results.length} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed) process.exitCode = 1;
}
main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
