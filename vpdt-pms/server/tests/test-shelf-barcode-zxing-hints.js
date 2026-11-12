// server/tests/test-shelf-barcode-zxing-hints.js
//
// LỖI THẬT đã vá (11/2026, người dùng báo "Kiểm Tra Giá/Ghi Nhận Quầy Kệ không hoạt động trên iPhone" —
// kèm ảnh chụp camera MỞ ĐƯỢC, mã vạch rõ trong khung hình nhưng không bao giờ bắt được): iPhone không có
// window.BarcodeDetector native nên LUÔN rơi vào nhánh quét bằng thư viện ZXing (runShelfBarcodeZxingLoop(),
// module-vanhanh.js) — trước đây khởi tạo `new ZXing.BrowserMultiFormatReader()` KHÔNG truyền hints, khiến
// ZXing cố decode MỌI định dạng nó hỗ trợ (~15 định dạng) trên MỖI khung hình — quá chậm trên máy không có
// BarcodeDetector tăng tốc phần cứng. Đã vá lần 1 (v30.4): giới hạn 6 định dạng + TRY_HARDER.
//
// CẬP NHẬT (11/2026, theo yêu cầu người dùng "xử lý giống scan & checkout" — đối chiếu cơ chế BRG Scan &
// Checkout dùng trên iPhone): vá lần 2 —
//   1. KHÔNG còn gọi reader.decodeFromVideoElement(video, cb) (ZXing tự lấy khung hình ở ĐÚNG độ phân giải
//      camera, không co nhỏ) — thay bằng vòng lặp tự dựng: mỗi 120ms vẽ video lên canvas ẩn, co nhỏ về rộng
//      tối đa 960px rồi gọi reader.decode(canvas) — khớp đúng pipeline BRG mô tả (co nhỏ trước khi giải mã).
//   2. Danh sách định dạng: bỏ QR_CODE (QR bên BRG chỉ dành cho quét mã giỏ hàng, KHÔNG áp dụng cho Mã
//      Vạch/Mã Hàng ở đây), thêm CODE_39 + ITF (1 số mã vạch thùng/sỉ NCC dùng 2 định dạng này).
//
// CẬP NHẬT LẦN 3 (11/2026, người dùng gửi kèm tài liệu + code mẫu rút trực tiếp từ ứng dụng nội bộ KHÁC
// của chính người dùng — "BRG Scan & Checkout" — ĐÃ xác nhận quét được thật trên iPhone, sau khi xác nhận
// bản vá lần 2 ở trên VẪN KHÔNG quét được trên iPhone thật): bỏ hẳn lớp `BrowserMultiFormatReader` (lớp
// bọc cấp cao của ZXing) — gọi THẲNG lớp giải mã cấp thấp `MultiFormatReader` + tự dựng
// `HTMLCanvasElementLuminanceSource`/`BinaryBitmap`/`HybridBinarizer` thủ công, đúng từng bước BRG dùng.
// Vòng lặp cũng đổi từ setInterval() thuần sang setTimeout(...) rồi mới requestAnimationFrame(...) (khớp
// đúng mẫu BRG), và thêm điều kiện video.readyState >= 2 (không chỉ videoWidth).
//
// Test này xác nhận ĐÚNG hints được set qua setHints() + ĐÚNG luồng vẽ-canvas-rồi-decode() qua
// MultiFormatReader/HTMLCanvasElementLuminanceSource/BinaryBitmap/HybridBinarizer — dùng THẬT public/
// vendor/zxing/zxing.min.js (không mock enum, tránh lệch giá trị thật) + static server thật. Giả lập
// camera: KHÔNG mở camera thật (tránh getUserMedia()/video.play() treo trong môi trường không có camera
// phần cứng) — gọi THẲNG runShelfBarcodeZxingLoop() với 1 <video> có sẵn trong DOM, tự gán
// videoWidth/videoHeight/readyState giả (video thật không có stream) + override
// CanvasRenderingContext2D.prototype.drawImage thành no-op (vẽ video rỗng lên canvas sẽ không có pixel
// thật/có thể ném lỗi tuỳ trình duyệt, không liên quan tới điều cần kiểm ở đây — chỉ cần xác nhận
// reader.decode() được gọi với 1 BinaryBitmap dựng từ canvas đã co nhỏ đúng kích thước).
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
    let decodeCalls = [];

    // Video thật trong DOM không có stream (videoWidth/videoHeight = 0, readyState = 0 mặc định) — gán
    // giả các thuộc tính readonly này để vòng lặp (kiểm tra readyState >= 2 && videoWidth) không bị bỏ
    // qua ngay từ đầu.
    const video = document.getElementById('shelfBarcodeVideo');
    Object.defineProperty(video, 'videoWidth', { value: 1280, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 720, configurable: true });
    Object.defineProperty(video, 'readyState', { value: 2, configurable: true }); // HAVE_CURRENT_DATA
    // drawImage(video,...) thật có thể ném lỗi/không vẽ gì vì video không có khung hình thật — không liên
    // quan tới điều cần kiểm (hints + kích thước canvas đưa vào decode()) nên vô hiệu hoá no-op.
    const origDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function () { /* no-op cho môi trường test */ };

    const RealReader = window.ZXing.MultiFormatReader;
    window.ZXing.MultiFormatReader = class extends RealReader {
      setHints(hints) {
        capturedHints = hints;
        return super.setHints(hints);
      }
      decode(bitmap) {
        decodeCalls.push({
          isBinaryBitmap: bitmap instanceof window.ZXing.BinaryBitmap,
          width: bitmap && typeof bitmap.getWidth === 'function' ? bitmap.getWidth() : null,
          height: bitmap && typeof bitmap.getHeight === 'function' ? bitmap.getHeight() : null
        });
        // Lượt gọi ĐẦU TIÊN mô phỏng quét thành công — các lượt tiếp theo (nếu vòng lặp còn sống) không
        // nên xảy ra vì onShelfBarcodeDecoded() sẽ đóng modal (shelfBarcodeStream=null) ngay sau đó, loop
        // tự dừng hẳn không hẹn tick tiếp theo nữa.
        if (decodeCalls.length === 1) return { getText: () => '4710105060019' };
        throw new Error('NotFoundException (giả lập)');
      }
    };
    shelfBarcodeModalMode = 'PRICECHECK';
    // runShelfBarcodeZxingLoop() gate theo !shelfBarcodeStream (mirror đúng runShelfBarcodeDetectorLoop() —
    // dừng vòng lặp ngay khi modal đã đóng/camera chưa từng mở) — gán giả 1 object bất kỳ (truthy) vì test
    // này không mở camera thật qua openShelfBarcodeModalCore().
    shelfBarcodeStream = { getTracks: () => [] }; // closeShelfBarcodeModal() gọi .getTracks() khi đóng modal sau lượt quét thành công
    document.getElementById('pcMaHang').value = '';
    let submitPriceCheckCalled = false;
    const origSubmit = window.submitPriceCheck;
    window.submitPriceCheck = () => { submitPriceCheckCalled = true; };

    runShelfBarcodeZxingLoop(video, document.getElementById('shelfBarcodeStatus'));
    // Interval 120ms — chờ đủ lâu để chắc chắn ít nhất 1 tick đã chạy.
    await new Promise(resolve => setTimeout(resolve, 400));

    window.submitPriceCheck = origSubmit;
    CanvasRenderingContext2D.prototype.drawImage = origDrawImage;

    const hintsEntries = capturedHints ? [...capturedHints.entries()] : null;
    return {
      error: null,
      hasHints: !!capturedHints,
      possibleFormats: capturedHints ? capturedHints.get(window.ZXing.DecodeHintType.POSSIBLE_FORMATS) : null,
      tryHarder: capturedHints ? capturedHints.get(window.ZXing.DecodeHintType.TRY_HARDER) : null,
      hintsEntryCount: hintsEntries ? hintsEntries.length : 0,
      decodeCallCount: decodeCalls.length,
      firstDecodeCall: decodeCalls[0] || null,
      submitPriceCheckCalled,
      pcMaHangValue: document.getElementById('pcMaHang').value,
      expectedFormats: [
        window.ZXing.BarcodeFormat.EAN_13, window.ZXing.BarcodeFormat.EAN_8,
        window.ZXing.BarcodeFormat.CODE_128, window.ZXing.BarcodeFormat.UPC_A,
        window.ZXing.BarcodeFormat.UPC_E, window.ZXing.BarcodeFormat.CODE_39,
        window.ZXing.BarcodeFormat.ITF
      ],
    };
  });

  if (out.error) {
    record('setup: window.ZXing tải được trong thời gian chờ', false, out.error);
  } else {
    record('runShelfBarcodeZxingLoop(): khởi tạo MultiFormatReader (cấp thấp) + setHints() CÓ truyền hints (không còn rỗng/undefined)',
      out.hasHints, JSON.stringify(out));
    record('hints: POSSIBLE_FORMATS giới hạn ĐÚNG 7 định dạng (EAN-13/EAN-8/Code128/UPC-A/UPC-E/Code39/ITF — KHÔNG còn QR_CODE)',
      Array.isArray(out.possibleFormats) && JSON.stringify([...out.possibleFormats].sort()) === JSON.stringify([...out.expectedFormats].sort()),
      JSON.stringify(out));
    record('hints: TRY_HARDER = true (ưu tiên đọc đúng hơn tốc độ, chấp nhận được vì đã giảm số định dạng phải thử)',
      out.tryHarder === true, JSON.stringify(out));
    record('hints: ĐÚNG 2 mục (không thừa/thiếu field lạ)', out.hintsEntryCount === 2, JSON.stringify(out));
    record('reader.decode() được gọi với 1 BinaryBitmap dựng từ HTMLCanvasElementLuminanceSource+HybridBinarizer (KHÔNG còn qua lớp BrowserMultiFormatReader)',
      out.decodeCallCount >= 1 && out.firstDecodeCall && out.firstDecodeCall.isBinaryBitmap, JSON.stringify(out));
    record('canvas đưa vào BinaryBitmap đã được CO NHỎ về rộng tối đa 960px (video gốc 1280px) — đúng pipeline BRG mô tả',
      out.firstDecodeCall && out.firstDecodeCall.width === 960 && out.firstDecodeCall.height === 540, JSON.stringify(out));
    record('Giả lập quét thành công ở chế độ Kiểm Tra Giá -> vẫn route đúng sang submitPriceCheck() với đúng mã vừa quét (hành vi cũ không đổi)',
      out.submitPriceCheckCalled && out.pcMaHangValue === '4710105060019', JSON.stringify(out));
    record('Sau khi quét thành công, vòng lặp KHÔNG gọi decode() thêm lần nào nữa (loop tự dừng vì shelfBarcodeStream đã về null)',
      out.decodeCallCount === 1, JSON.stringify(out));
  }
  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} scenarios passed.`);
  if (failed) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exit(1); });
