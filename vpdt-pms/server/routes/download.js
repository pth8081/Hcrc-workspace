// routes/download.js — Route TẢI file đính kèm dùng chung cho TOÀN hệ thống (khác /uploads/ tĩnh ở
// server.js — chỗ đó dùng để XEM file trong Khung Xem Bảo Vệ qua PDF.js/mammoth/exceljs, giữ nguyên
// không đổi). Route này CHỈ phục vụ khi người dùng bấm "Tải" thật sự: nếu file là PDF thì đóng dấu
// watermark "Hệ thống văn phòng số Công ty HCRC" vào góc dưới-trái MỖI TRANG trước khi trả về — CHỈ vẽ
// thêm 1 dòng chữ đè lên (dùng pdf-lib), không dựng lại/không đổi nội dung gốc của trang nào, nên tài
// liệu (kể cả hợp đồng) vẫn giữ nguyên giá trị nội dung, chỉ thêm watermark nhận diện ở góc không đụng
// tới phần thân/nơi ký. Các loại file khác (Word/Excel/ảnh...) được trả về NGUYÊN VẸN, không qua bước
// đóng dấu — theo đúng phạm vi khách hàng xác nhận (chỉ PDF luôn có watermark khi tải).
const express = require('express');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { getAllForCollection } = require('../lib/recordStore');
const { canDownloadRecordFile } = require('../lib/recordViewScope');

const router = express.Router();

// Tra ngược fileUrl -> bản ghi sở hữu nó, CHỈ cho 2 collection đã xác nhận có lỗ hổng qua rà soát
// (Tài Liệu, Văn Bản Trình — mỗi bản ghi có scope xem/tải riêng theo phòng ban, xem canDownloadFile()
// ở public/index.html). Nếu file không thuộc 2 collection này (hợp đồng, đăng ký xe, văn phòng, biên
// bản họp, bài truyền thông nội bộ...) thì CHO PHÉP như trước (chưa mở rộng kiểm tra sang các module
// đó — cần rà lại đúng scope riêng của từng module trước khi áp dụng, tránh chặn nhầm).
async function findOwningRecord(fileUrl) {
  const [docs, submissions] = await Promise.all([
    getAllForCollection('docs'),
    getAllForCollection('submissions')
  ]);
  const doc = (docs || []).find(d => d.fileUrl === fileUrl);
  if (doc) return { moduleKey: 'doc', dept: doc.dept, ownerUsername: doc.uploader };
  const sub = (submissions || []).find(s => s.fileUrl === fileUrl || (s.extraFiles || []).some(ef => ef.fileUrl === fileUrl));
  if (sub) return { moduleKey: 'submission', dept: sub.dept, ownerUsername: sub.creator };
  return null;
}
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

router.get('/', async (req, res) => {
  const fileUrl = String(req.query.fileUrl || '');
  // fileUrl luôn có dạng "/uploads/<tên-file-do-server-sinh-ra>" (xem routes/upload.js — tên file luôn
  // là <timestamp>-<16 hex>.<ext>, không chứa ký tự do người dùng nhập) — chặn path traversal bằng cách
  // chỉ nhận đúng 1 thành phần tên file (không có "/" hay "..") rồi resolve lại để chắc chắn vẫn nằm
  // trong đúng thư mục uploads/.
  const m = /^\/uploads\/([^/\\]+)$/.exec(fileUrl);
  if (!m) return res.status(400).json({ error: 'Đường dẫn tệp không hợp lệ' });

  const filePath = path.join(UPLOAD_DIR, m[1]);
  if (path.dirname(filePath) !== UPLOAD_DIR || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Không tìm thấy tệp' });
  }

  const owning = await findOwningRecord(fileUrl);
  if (owning && !canDownloadRecordFile(req.freshUser, owning.moduleKey, owning.dept, owning.ownerUsername)) {
    return res.status(403).json({ error: 'Bạn không có quyền tải tệp này' });
  }

  const downloadName = String(req.query.name || m[1]).replace(/[\r\n"]/g, '');
  const asciiFallback = downloadName.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader('Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);

  const ext = path.extname(m[1]).toLowerCase();
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
});

module.exports = router;
