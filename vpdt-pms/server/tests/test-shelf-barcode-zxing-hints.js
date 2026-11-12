// server/tests/test-shelf-barcode-zxing-hints.js
//
// LỖI THẬT đã vá (11/2026, người dùng báo "Kiểm Tra Giá/Ghi Nhận Quầy Kệ không hoạt động trên iPhone" —
// kèm ảnh chụp camera MỞ ĐƯỢC, mã vạch rõ trong khung hình nhưng không bao giờ bắt được): iPhone không có
// window.BarcodeDetector native nên LUÔN rơi vào nhánh quét bằng thư viện ZXing (runShelfBarcodeZxingLoop(),
// module-vanhanh.js) — trước đây khởi tạo `new ZXing.BrowserMultiFormatReader()` KHÔNG truyền hints, khiến
// ZXing cố decode MỌI định dạng nó hỗ trợ (~15 định dạng: QR/EAN/UPC/Code128/Code39/Code93/ITF/Codabar/
// DataMatrix/Aztec/PDF417/RSS...) trên MỖI khung hình — quá chậm trên máy không có BarcodeDetector tăng
// tốc phần cứng, tỉ lệ bắt được mã vạch (trước khi tay di chuyển/camera mất nét) thấp tới mức như
// "không hoạt động". Đã vá: giới hạn ĐÚNG 6 định dạng cần dùng (mirror y hệt danh sách
// runShelfBarcodeDetectorLoop()) qua DecodeHintType.POSSIBLE_FORMATS + bật TRY_HARDER.
//
// Test này xác nhận ĐÚNG hints được truyền vào constructor BrowserMultiFormatReader() — dùng THẬT
// public/vendor/zxing/zxing.min.js (không mock enum, tránh lệch giá trị thật) + static server thật, chỉ
// giả lập camera (navigator.mediaDevices.getUserMedia trả về 1 MediaStream rỗng, không cần pixel thật) và
// window.BarcodeDetector = undefined để ép đi đúng nhánh ZXing.
//
// Chạy: node server/tests/test-shelf-barcode-zxing-hints.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

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

  const out = await page.evaluate(async () => {
    // Test này KHÔNG mở camera thật (tránh getUserMedia()/video.play() treo trong môi trường không có
    // camera phần cứng) — chỉ cần tải THẬT /vendor/zxing/zxing.min.js (đúng file sản phẩm dùng) rồi gọi
    // THẲNG runShelfBarcodeZxingLoop() với 1 <video> bất kỳ sẵn có trong DOM (không cần stream/play gì
    // cả, vì decodeFromVideoElement() thật sự chạy sẽ bị THAY THẾ bằng bản giả lập bên dưới trước khi gọi).
    await new Promise((resolve, reject) => {
      if (window.ZXing) return resolve();
      const s = document.createElement('script');
      s.src = '/vendor/zxing/zxing.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Không tải được /vendor/zxing/zxing.min.js'));
      document.head.appendChild(s);
    });
    if (!window.ZXing) return { error: 'window.ZXing không tải được' };

    let capturedHints = null;
    let decodeFromVideoElementCalled = false;
    let decodedCallback = null;

    const RealReader = window.ZXing.BrowserMultiFormatReader;
    window.ZXing.BrowserMultiFormatReader = class extends RealReader {
      constructor(hints) {
        super(hints);
        capturedHints = hints;
        this.timeBetweenScansMillis = 150;
      }
      decodeFromVideoElement(video, cb) {
        decodeFromVideoElementCalled = true;
        decodedCallback = cb;
        // KHÔNG gọi super thật (không có pixel thật để decode trong môi trường test) — chỉ cần xác nhận
        // runShelfBarcodeZxingLoop() có gọi đúng hàm này với callback hợp lệ.
      }
    };
    // shelfBarcodeModalMode: biến `let` top-level của module-vanhanh.js, cùng global lexical environment
    // với trang (script cổ điển, không phải module) — gán thẳng được như mọi biến toàn cục khác, mirror
    // đúng những gì openShelfBarcodeModalForPriceCheck() sẽ làm nếu gọi thật.
    shelfBarcodeModalMode = 'PRICECHECK';
    runShelfBarcodeZxingLoop(document.getElementById('shelfBarcodeVideo'), document.getElementById('shelfBarcodeStatus'));

    // Giả lập 1 lượt quét thành công -> xác nhận callback vẫn route đúng sang Kiểm Tra Giá (không đổi
    // hành vi cũ, chỉ đổi cách khởi tạo reader).
    document.getElementById('pcMaHang').value = '';
    let submitPriceCheckCalled = false;
    const origSubmit = window.submitPriceCheck;
    window.submitPriceCheck = () => { submitPriceCheckCalled = true; };
    decodedCallback({ getText: () => '4710105060019' });
    window.submitPriceCheck = origSubmit;

    const hintsEntries = capturedHints ? [...capturedHints.entries()] : null;
    return {
      error: null,
      hasHints: !!capturedHints,
      possibleFormats: capturedHints ? capturedHints.get(window.ZXing.DecodeHintType.POSSIBLE_FORMATS) : null,
      tryHarder: capturedHints ? capturedHints.get(window.ZXing.DecodeHintType.TRY_HARDER) : null,
      hintsEntryCount: hintsEntries ? hintsEntries.length : 0,
      decodeFromVideoElementCalled,
      submitPriceCheckCalled,
      pcMaHangValue: document.getElementById('pcMaHang').value,
      expectedFormats: [
        window.ZXing.BarcodeFormat.EAN_13, window.ZXing.BarcodeFormat.EAN_8,
        window.ZXing.BarcodeFormat.CODE_128, window.ZXing.BarcodeFormat.UPC_A,
        window.ZXing.BarcodeFormat.UPC_E, window.ZXing.BarcodeFormat.QR_CODE
      ],
    };
  });

  if (out.error) {
    record('setup: window.ZXing tải được trong thời gian chờ', false, out.error);
  } else {
    record('runShelfBarcodeZxingLoop(): khởi tạo BrowserMultiFormatReader() CÓ truyền hints (không còn rỗng/undefined)',
      out.hasHints, JSON.stringify(out));
    record('hints: POSSIBLE_FORMATS giới hạn ĐÚNG 6 định dạng, khớp y hệt danh sách BarcodeDetector (ean_13/ean_8/code_128/upc_a/upc_e/qr_code)',
      Array.isArray(out.possibleFormats) && JSON.stringify([...out.possibleFormats].sort()) === JSON.stringify([...out.expectedFormats].sort()),
      JSON.stringify(out));
    record('hints: TRY_HARDER = true (ưu tiên đọc đúng hơn tốc độ, chấp nhận được vì đã giảm số định dạng phải thử)',
      out.tryHarder === true, JSON.stringify(out));
    record('hints: ĐÚNG 2 mục (không thừa/thiếu field lạ)', out.hintsEntryCount === 2, JSON.stringify(out));
    record('decodeFromVideoElement() vẫn được gọi (không phá vỡ luồng quét cũ)', out.decodeFromVideoElementCalled, JSON.stringify(out));
    record('Giả lập quét thành công ở chế độ Kiểm Tra Giá -> vẫn route đúng sang submitPriceCheck() với đúng mã vừa quét (hành vi cũ không đổi)',
      out.submitPriceCheckCalled && out.pcMaHangValue === '4710105060019', JSON.stringify(out));
  }
  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} scenarios passed.`);
  if (failed) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exit(1); });
