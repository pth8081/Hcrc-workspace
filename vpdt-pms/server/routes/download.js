// routes/download.js — Route TẢI file đính kèm dùng chung cho TOÀN hệ thống (khác /uploads/ tĩnh ở
// server.js — chỗ đó dùng để XEM file trong Khung Xem Bảo Vệ qua PDF.js/mammoth/exceljs). Route này
// CHỈ phục vụ khi người dùng bấm "Tải" thật sự: nếu file là PDF thì đóng dấu watermark "Hệ thống văn
// phòng số Công ty HCRC" vào góc dưới-trái MỖI TRANG trước khi trả về — CHỈ vẽ thêm 1 dòng chữ đè lên
// (dùng pdf-lib), không dựng lại/không đổi nội dung gốc của trang nào, nên tài liệu (kể cả hợp đồng)
// vẫn giữ nguyên giá trị nội dung, chỉ thêm watermark nhận diện ở góc không đụng tới phần thân/nơi ký.
// Các loại file khác (Word/Excel/ảnh...) được trả về NGUYÊN VẸN, không qua bước đóng dấu — theo đúng
// phạm vi khách hàng xác nhận (chỉ PDF luôn có watermark khi tải).
//
// Phần TRA NGƯỢC file -> hồ sơ sở hữu + KIỂM QUYỀN đã được tách sang lib/fileAuthz.js để dùng CHUNG với
// middleware chặn /uploads ở server.js (trước đây /uploads chỉ có requireAuth, ai đăng nhập cũng đọc
// được mọi file nếu biết URL — xem ghi chú đầu lib/fileAuthz.js). Ở đây gọi với mode 'download' để giữ
// NGUYÊN khuôn quyền cũ theo cờ "<moduleKey>Download"; /uploads gọi với mode 'view'.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { parseUploadsFileUrl, authorizeFileAccess } = require('../lib/fileAuthz');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf');

// Chữ tiếng Việt có dấu KHÔNG nằm trong bảng mã WinAnsi mà 14 font chuẩn (Helvetica...) của pdf-lib hỗ
// trợ — bắt buộc phải nhúng 1 font TTF Unicode riêng (qua fontkit) mới vẽ đúng được dấu, nếu không
// pdf-lib sẽ ném lỗi ngay khi drawText(). DejaVu Sans (giấy phép tự do, kèm theo trong assets/fonts/)
// có đủ bộ chữ Latin mở rộng cho tiếng Việt.
const WATERMARK_TEXT = 'Hệ thống văn phòng số Công ty HCRC';
let embeddedFontBytes = null;
function getFontBytes() {
  if (!embeddedFontBytes) embeddedFontBytes = fs.readFileSync(FONT_PATH);
  return embeddedFontBytes;
}

// LƯU Ý BẢO TRÌ: toàn bộ thân handler được bọc try/catch (xem downloadHandler() bên dưới) — lưới an
// toàn cho ĐÚNG lớp lỗi đã thực sự xảy ra ở route này trước đây: 1 hàm canView* import từ
// lib/recordViewScope.js (hoặc gián tiếp qua lib/fileAuthz.js) bị BỎ SÓT khỏi khối module.exports của
// nguồn, nên biến import về `undefined` và lời gọi ném TypeError. Handler là `async` trong Express 4
// (KHÔNG tự bắt promise rejection) và tiến trình không cài `unhandledRejection` handler nào, nên 1 lượt
// tải file bất kỳ đủ để hạ cả tiến trình Node. Bọc lại để lỗi lập trình kiểu này thành 500 cho ĐÚNG
// request đó thay vì sập server cho tất cả mọi người — KHÔNG thay thế cho việc export/kiểm tra đúng ở
// nguồn (đã vá riêng, xem lib/recordViewScope.js).
router.get('/', (req, res) => {
  downloadHandler(req, res).catch((err) => {
    console.error('⛔ GET /api/files/download: lỗi không mong đợi:', err && err.stack || err);
    if (!res.headersSent) res.status(500).json({ error: 'Không thể tải tệp — lỗi máy chủ' });
  });
});

async function downloadHandler(req, res) {
  const fileUrl = String(req.query.fileUrl || '');
  // fileUrl luôn có dạng "/uploads/<tên-file-do-server-sinh-ra>" (xem routes/upload.js — tên file luôn
  // là <timestamp>-<16 hex>.<ext>, không chứa ký tự do người dùng nhập) — chặn path traversal bằng cách
  // chỉ nhận đúng 1 thành phần tên file (không có "/" hay ".."), rồi resolve lại để chắc chắn vẫn nằm
  // trong đúng thư mục uploads/ (parseUploadsFileUrl() ở lib/fileAuthz.js, dùng chung với /uploads).
  const fileName = parseUploadsFileUrl(fileUrl);
  if (!fileName) return res.status(400).json({ error: 'Đường dẫn tệp không hợp lệ' });

  const filePath = path.join(UPLOAD_DIR, fileName);
  if (path.dirname(filePath) !== UPLOAD_DIR || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Không tìm thấy tệp' });
  }

  // mode 'download': giữ NGUYÊN khuôn quyền cũ theo cờ "<moduleKey>Download" (canDownloadRecordFile) —
  // ĐÚNG bộ luật mà middleware /uploads/ ở server.js dùng khi gọi mode 'view', chỉ khác mode. 1 nguồn
  // sự thật duy nhất (lib/fileAuthz.js) cho câu hỏi "người này có được lấy tệp này không".
  if (!(await authorizeFileAccess(req.freshUser, fileUrl, 'download'))) {
    return res.status(403).json({ error: 'Bạn không có quyền tải tệp này' });
  }

  const downloadName = String(req.query.name || fileName).replace(/[\r\n"]/g, '');
  const asciiFallback = downloadName.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader('Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);

  const ext = path.extname(fileName).toLowerCase();
  if (ext !== '.pdf') {
    return res.sendFile(filePath);
  }

  try {
    const originalBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(originalBytes);
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(getFontBytes(), { subset: true });

    for (const page of pdfDoc.getPages()) {
      page.drawText(WATERMARK_TEXT, {
        x: 24,
        y: 14,
        size: 13,
        font,
        color: rgb(0.42, 0.42, 0.42),
        opacity: 0.8
      });
    }

    const stampedBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(Buffer.from(stampedBytes));
  } catch (err) {
    console.error('⛔ GET /api/files/download: đóng dấu watermark PDF lỗi, trả về file gốc:', err.message);
    res.setHeader('Content-Type', 'application/pdf');
    return res.sendFile(filePath);
  }
}

module.exports = router;
