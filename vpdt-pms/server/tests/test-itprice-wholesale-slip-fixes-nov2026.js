// server/tests/test-itprice-wholesale-slip-fixes-nov2026.js
//
// Regression cho 4 fix Vận Hành > Phê Duyệt Giá Bán Buôn (11/2026, yêu cầu người dùng gửi kèm 2 ảnh):
//   (a) Modal xem Excel CHUNG (renderExcelProtected(), module-internalcomms-daotao-viewer.js) đọc
//       cell.numFmt để hiển thị đúng %/số có phân cách nghìn/ngày tháng như Excel thật, thay vì số thô.
//   (b) formatItPriceCellValue() (module-itsupport-price.js): ép tối đa 2 số thập phân cho cột tiền/số
//       lượng + làm tròn 2 số cho MỌI cột số khác có dấu chấm chưa thuộc 3 nhóm %/tiền/số lượng.
//   (c) buildItPriceWholesaleApprovalSlipHTML(): gắn class "as-landscape" (scoped qua
//       buildApprovalSlipShellHTML({extraClass})) để chỉ phiếu này in khổ ngang, không đụng
//       APPROVAL_SLIP_CSS mặc định dùng chung cho các Phiếu Phê Duyệt khác (Xe/Hợp Đồng/VPP...).
//   (d) buildItPriceWholesaleApprovalSlipHTML() loại cột "STT" đọc nguyên văn từ Mẫu Giá/file khỏi bảng
//       mặt hàng (tránh dup 2 cột STT) + renderItPriceFilePreview() hiện cảnh báo khi phát hiện cột này.
//
// Chạy: node server/tests/test-itprice-wholesale-slip-fixes-nov2026.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }[ext] || 'application/octet-stream';
}
function startStaticServer(port, extraDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      let filePath;
      if (urlPath.startsWith('/__fixtures/')) {
        filePath = path.join(extraDir, urlPath.replace('/__fixtures/', ''));
      } else {
        filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
      }
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

async function buildFixtureXlsx(fixtureDir) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Bang Gia');
  sheet.getRow(1).values = ['Mặt hàng', 'Margin', 'Thành tiền', 'Ngày áp dụng'];
  const row = sheet.getRow(2);
  row.getCell(1).value = 'Sữa tươi';
  row.getCell(2).value = 0.252054794520548; // percent fraction
  row.getCell(2).numFmt = '0.00%';
  row.getCell(3).value = 1234567;
  row.getCell(3).numFmt = '#,##0';
  row.getCell(4).value = new Date(Date.UTC(2026, 10, 7)); // 2026-11-07
  row.getCell(4).numFmt = 'dd/mm/yyyy';
  await sheet.commit ? null : null;
  const filePath = path.join(fixtureDir, 'fixture-numfmt.xlsx');
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

async function main() {
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'itprice-numfmt-'));
  await buildFixtureXlsx(fixtureDir);
  const server = await startStaticServer(PORT, fixtureDir);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  // ---- (b)/(d)/(c): formatItPriceCellValue() + buildItPriceWholesaleApprovalSlipHTML() ----
  const out = await page.evaluate(() => {
    const colTyLe = { key: 'c8', label: 'Tỷ lệ %' }; // KHÔNG thuộc 3 nhóm percent/currency/quantity hiện có
    const colMaHang = { key: 'c0', label: 'Mã hàng' };
    const colDonGia = { key: 'c1', label: 'Đơn giá' };
    const colSoLuong = { key: 'c2', label: 'Số lượng' };
    const roundingMatrix = {
      // (b) cột KHÔNG thuộc nhóm nào, có dấu chấm -> làm tròn còn đúng 2 số
      genericDecimalRounded: formatItPriceCellValue(colTyLe, '0.07') === '0.07',
      genericDecimalRoundedLong: formatItPriceCellValue(colTyLe, '0.123456') === '0.12',
      // mã hàng dạng số nguyên dài KHÔNG bị đụng (không có dấu chấm)
      integerCodeUntouched: formatItPriceCellValue(colMaHang, '254000001291') === '254000001291',
      // (b) cột tiền/số lượng vẫn giới hạn tối đa 2 số lẻ dù input có nhiều số lẻ hơn
      currencyCapped2: formatItPriceCellValue(colDonGia, '29371.729999') === '29.371,73 đ',
      quantityCapped2: formatItPriceCellValue(colSoLuong, '1200.3456') === '1.200,35'
    };

    // (d) isItPriceSttColumn() nhận diện đúng, không phân biệt hoa/thường/dấu
    const sttDetect = {
      plain: isItPriceSttColumn({ label: 'STT' }),
      lower: isItPriceSttColumn({ label: 'stt' }),
      withSpace: isItPriceSttColumn({ label: ' Stt ' }),
      notMatched: !isItPriceSttColumn({ label: 'Số TT Hàng' }) && !isItPriceSttColumn({ label: 'Mã Hàng' })
    };

    // Seed tối thiểu 1 đề xuất WHOLESALE APPROVED có file với cột "STT" trùng (bug ảnh 2 người dùng gửi)
    Object.assign(DB, {
      workflows: [{ id: 'WF_1STEP', name: '1 bước', steps: [{ order: 1, name: 'Duyệt' }] }],
      itPriceTierWorkflows: { ALL: { workflowId: 'WF_1STEP', approvers: { 1: ['gd1'] } } },
      itPriceDeptWorkflows: {},
      itPriceApprovals: []
    });
    const columnLabels = [
      { key: 'c0', label: 'STT' }, { key: 'c1', label: 'Mã hàng' }, { key: 'c2', label: 'Margin bán lẻ' }
    ];
    const fileItems = [
      { values: { c0: '1', c1: 'SP001', c2: '0.25205479452054796' } },
      { values: { c0: '2', c1: 'SP002', c2: '0.205' } }
    ];
    const p = {
      id: 9001, code: 'BB-FIX-001', dept: 'Phòng Vận Hành', priceType: 'WHOLESALE', priceTier: 'ALL',
      storeScope: { mode: 'ALL' }, nganhHang: [], creator: 'nv1', creatorName: 'Nguyễn Văn A',
      createdAt: '07/09/2026', status: 'APPROVED', currentStep: 2,
      files: [{ id: 701, fileName: 'gia.xlsx', columnLabels, items: fileItems }],
      history: [{ step: 1, action: 'APPROVED', approver: 'Duyệt', username: 'gd1', time: '10:00 07/09/2026', comment: '' }]
    };
    DB.itPriceApprovals.push(p);
    const html = buildItPriceWholesaleApprovalSlipHTML(p);
    const sttCount = (html.match(/<th>STT<\/th>/g) || []).length;
    const slipMatrix = {
      noDuplicateSttHeader: sttCount === 1,
      maHangColumnStillPresent: html.includes('Mã hàng'),
      marginStillFormatted: html.includes('25.21%'),
      hasLandscapeClass: /class="approval-slip as-landscape"/.test(html)
    };

    // (d) cảnh báo khi preview có cột STT
    document.getElementById('itPriceFilePreviewWrap')?.classList.add('hidden');
    renderItPriceFilePreview({ items: fileItems, columnLabels });
    const warnShown = !document.getElementById('itPriceFilePreviewSttWarning').classList.contains('hidden');
    renderItPriceFilePreview({ items: [{ values: { c0: 'X' } }], columnLabels: [{ key: 'c0', label: 'Mã hàng' }] });
    const warnHiddenWithoutStt = document.getElementById('itPriceFilePreviewSttWarning').classList.contains('hidden');

    return { roundingMatrix, sttDetect, slipMatrix, warnShown, warnHiddenWithoutStt };
  });

  record('(b) Cột số KHÔNG thuộc nhóm nào, có dấu chấm -> làm tròn đúng 2 số (0.07 -> "0.07")', out.roundingMatrix.genericDecimalRounded);
  record('(b) Cột số lẻ dài hơn 2 số -> làm tròn còn 2 số (0.123456 -> "0.12")', out.roundingMatrix.genericDecimalRoundedLong);
  record('(b) Mã hàng dạng số nguyên dài KHÔNG bị đụng (không có dấu chấm)', out.roundingMatrix.integerCodeUntouched);
  record('(b) Cột tiền ép tối đa 2 số lẻ dù input nhiều số lẻ hơn', out.roundingMatrix.currencyCapped2, JSON.stringify(out.roundingMatrix));
  record('(b) Cột số lượng ép tối đa 2 số lẻ dù input nhiều số lẻ hơn', out.roundingMatrix.quantityCapped2, JSON.stringify(out.roundingMatrix));
  record('(d) isItPriceSttColumn() nhận đúng "STT" không phân biệt hoa/thường/khoảng trắng, loại trừ nhãn khác', Object.values(out.sttDetect).every(Boolean), JSON.stringify(out.sttDetect));
  record('(d) buildItPriceWholesaleApprovalSlipHTML() KHÔNG còn dup cột STT (chỉ 1 <th>STT</th>)', out.slipMatrix.noDuplicateSttHeader);
  record('(d) Cột "Mã hàng" thật vẫn còn nguyên trong bảng', out.slipMatrix.maHangColumnStillPresent);
  record('(b) Margin bán lẻ vẫn định dạng % đúng như cũ (không bị đợt sửa (b) làm hỏng)', out.slipMatrix.marginStillFormatted);
  record('(c) Phiếu Giá Bán Buôn có class "as-landscape" (scoped, không đụng slip module khác)', out.slipMatrix.hasLandscapeClass);
  record('(d) renderItPriceFilePreview() hiện cảnh báo khi phát hiện cột "STT"', out.warnShown);
  record('(d) renderItPriceFilePreview() ẩn cảnh báo khi không có cột "STT"', out.warnHiddenWithoutStt);

  // ---- (c) kiểm tra 1 slip builder KHÁC (Xe) KHÔNG bị gắn as-landscape (đảm bảo scoped đúng) ----
  const carOut = await page.evaluate(() => {
    if (typeof buildCarApprovalSlipHTML !== 'function') return { skipped: true };
    const car = {
      code: 'XE-TEST-001', dept: 'Hành Chính', plateNumber: '29A-12345', driverName: 'Tài xế A',
      purpose: 'Công tác', fromDate: '01/01/2026', toDate: '02/01/2026', creator: 'u1', creatorName: 'U1',
      createdAt: '01/01/2026', status: 'APPROVED', history: []
    };
    const html = buildCarApprovalSlipHTML(car);
    return { skipped: false, hasLandscape: html.includes('as-landscape'), hasDefaultClass: /class="approval-slip"/.test(html) };
  });
  if (!carOut.skipped) {
    record('(c) buildCarApprovalSlipHTML() (module khác) KHÔNG bị gắn as-landscape — xác nhận scoped đúng', !carOut.hasLandscape && carOut.hasDefaultClass, JSON.stringify(carOut));
  } else {
    console.log('  (bỏ qua kiểm tra buildCarApprovalSlipHTML — module chưa tải trong trang test này)');
  }

  // ---- (a) renderExcelProtected() đọc cell.numFmt đúng như Excel thật ----
  const excelOut = await page.evaluate(async (port) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    await window.renderExcelProtected(container, `http://127.0.0.1:${port}/__fixtures/fixture-numfmt.xlsx`);
    const cells = [...container.querySelectorAll('td')].map(td => td.textContent);
    return { cells };
  }, PORT);
  const cells = excelOut.cells || [];
  record('(a) Cột % đọc cell.numFmt "0.00%" -> hiện "25.21%" (không còn số thô dài)', cells.includes('25.21%'), JSON.stringify(cells));
  record('(a) Cột số có numFmt "#,##0" -> hiện phân cách nghìn kiểu Việt ("1.234.567")', cells.includes('1.234.567'), JSON.stringify(cells));
  record('(a) Cột ngày numFmt "dd/mm/yyyy" -> hiện đúng "07/11/2026" (không phải chuỗi Date thô)', cells.includes('07/11/2026'), JSON.stringify(cells));

  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh', pageErrors.length === 0, pageErrors.join('; '));

  await browser.close();
  server.close();
  fs.rmSync(fixtureDir, { recursive: true, force: true });

  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log(`\n==== ${passed}/${total} scenario(s) passed ====`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('LỖI CHẠY TEST:', err);
  process.exit(1);
});
