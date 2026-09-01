// lib/reportPdfMerge.js — Ghép nhiều file PDF THẬT thành 1 (Báo Cáo Định Kỳ, reportEntries.entryType
// 'PDF') + đóng dấu watermark, dùng đúng kỹ thuật/font đã có ở routes/download.js (đóng dấu khi tải file
// bất kỳ) để toàn hệ thống chỉ có 1 kiểu watermark PDF duy nhất — tách riêng khỏi lib/recordActions.js
// (vốn 100% đồng bộ, không đụng ổ đĩa) để phần lớn file đó giữ nguyên phong cách hiện có; chỉ 2 hàm gọi
// module này (mergeReportPeriodPdf/publishReportPeriodPdf) mới cần async.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { HttpError } = require('./httpErrors');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const WATERMARK_TEXT = 'Hệ thống văn phòng số Công ty HCRC';

// Sao y parseUploadsFileUrl() ở lib/fileAuthz.js — chép lại thay vì require chéo vì fileAuthz.js require
// lib/recordViewScope.js, mà file đó lại require lib/recordActions.js (nơi DUY NHẤT gọi module này) ->
// require vòng thật sự (đã từng gây lỗi "canApproveInternalPost is not a function" khi recordActions.js
// nạp reportPdfMerge.js SỚM hơn phần định nghĩa các hàm của chính nó). Cùng tiền lệ đã có ở
// lib/recordStore.js (parseUploadsFileName(), xem chú thích ở đó).
function parseUploadsFileUrl(fileUrl) {
  const m = /^\/uploads\/([^/\\]+)$/.exec(String(fileUrl || ''));
  if (!m) return null;
  if (m[1] === '.' || m[1] === '..') return null;
  return m[1];
}

let embeddedFontBytes = null;
function getFontBytes() {
  if (!embeddedFontBytes) embeddedFontBytes = fs.readFileSync(FONT_PATH);
  return embeddedFontBytes;
}

// pages: period.pdfCompilation.pages hiện có (đã qua mergeReportPeriodPdf(), mỗi phần tử
// {sourceEntryId, sourcePageIndex,...} — CHỈ 2 field này được dùng ở đây, mọi field khác trong pages[]
// chỉ để hiển thị, không ảnh hưởng bước ghép thật). entries: TOÀN BỘ reportEntries hiện có, CALLER tự
// đọc rồi truyền vào (giữ đúng nguyên tắc chung của lib/recordActions.js).
//
// Trả về {bytes, pageCount} của file PDF cuối cùng đã ghép + đóng dấu. Đây là nơi DUY NHẤT thật sự ép
// buộc sourcePageIndex hợp lệ so với số trang THẬT của file — lúc mergeReportPeriodPdf() (tổng hợp) chỉ
// client biết số trang qua pdf.js, không đáng tin tuyệt đối tới lúc phát hành này (file gốc lý thuyết có
// thể đã đổi giữa 2 bước, dù entry SUBMITTED thì fileUrl không đổi được nữa qua UI bình thường).
async function materializeReportPeriodPdf(pages, entries) {
  const list = Array.isArray(pages) ? pages : [];
  if (!list.length) throw new HttpError(400, 'Bản tổng hợp PDF không có trang nào');
  const entriesById = new Map((entries || []).map((e) => [e.id, e]));
  const merged = await PDFDocument.create();
  const srcDocCache = new Map(); // key = entry.fileUrl (tra lại từ entry đã xác thực, KHÔNG dùng field client gửi)

  for (const page of list) {
    const entry = entriesById.get(page.sourceEntryId);
    if (!entry || entry.entryType !== 'PDF') {
      throw new HttpError(409, `Trang tham chiếu tới báo cáo #${page.sourceEntryId} không còn hợp lệ — vui lòng tổng hợp lại`);
    }
    let srcDoc = srcDocCache.get(entry.fileUrl);
    if (!srcDoc) {
      const fileName = parseUploadsFileUrl(entry.fileUrl);
      if (!fileName) throw new HttpError(400, 'Đường dẫn tệp nguồn không hợp lệ');
      const filePath = path.join(UPLOAD_DIR, fileName);
      if (path.dirname(filePath) !== UPLOAD_DIR || !fs.existsSync(filePath)) {
        throw new HttpError(404, `Không tìm thấy tệp gốc của báo cáo "${entry.title || entry.id}" — có thể đã bị xoá, vui lòng tổng hợp lại`);
      }
      const bytes = fs.readFileSync(filePath);
      srcDoc = await PDFDocument.load(bytes);
      srcDocCache.set(entry.fileUrl, srcDoc);
    }
    const pageIndex = Number(page.sourcePageIndex);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= srcDoc.getPageCount()) {
      throw new HttpError(400, `Trang ${pageIndex + 1} không tồn tại trong tệp của báo cáo "${entry.title || entry.id}" — có thể tệp đã thay đổi, vui lòng tổng hợp lại`);
    }
    const [copied] = await merged.copyPages(srcDoc, [pageIndex]);
    merged.addPage(copied);
  }

  merged.registerFontkit(fontkit);
  const font = await merged.embedFont(getFontBytes(), { subset: true });
  for (const pg of merged.getPages()) {
    pg.drawText(WATERMARK_TEXT, { x: 24, y: 14, size: 13, font, color: rgb(0.42, 0.42, 0.42), opacity: 0.8 });
  }
  const bytes = await merged.save();
  return { bytes: Buffer.from(bytes), pageCount: merged.getPageCount() };
}

// Ghi bytes đã ghép ra server/uploads/ theo ĐÚNG quy ước đặt tên của routes/upload.js
// (`${Date.now()}-${16 ký tự hex}.pdf`) để hoà chung 1 chỗ với mọi file tải lên khác (dọn mồ côi tự
// động qua unlinkUnreferencedUploads() ở lib/recordStore.js đã quét theo regex chuỗi, không cần biết
// riêng file này).
function writeMergedPdfFile(bytes, periodName) {
  const fileName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), bytes);
  const downloadName = `${String(periodName || 'BaoCao').trim().replace(/[\\/:*?"<>|]+/g, '_') || 'BaoCao'}.pdf`;
  return { fileUrl: `/uploads/${fileName}`, fileName: downloadName };
}

module.exports = { materializeReportPeriodPdf, writeMergedPdfFile, WATERMARK_TEXT };
