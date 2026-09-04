// routes/priceFile.js — Upload + đọc file Excel bảng giá cho module "Phê Duyệt Giá" (Hỗ Trợ IT), dùng
// chung cho cả lúc tạo đề xuất mới lẫn tải lên tệp bổ sung khi có yêu cầu bổ sung (route riêng, không
// dùng chung routes/upload.js) vì cần ĐỌC NỘI DUNG file ngay để trả về danh sách mặt hàng có cấu trúc
// cho form xem trước trước khi gửi — mirror đúng cấu trúc routes/vppCatalog.js.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { parsePriceFile, parsePriceTemplateColumns, normalizeHeader } = require('../lib/priceFileParser');
const { getAppDataValueCached, getAllAppData } = require('../lib/appData');
const { getAllForCollection } = require('../lib/recordStore');
const { canViewItPriceApproval } = require('../lib/recordViewScope');
const { resolveApprovedFileUrl } = require('../lib/recordActions');
const { parseUploadsFileUrl } = require('../lib/fileAuthz');
const { assertDecompressedSizeWithinBudget } = require('../lib/xlsxSafeRead');
const { verifyFileSignature } = require('../lib/fileSignature');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

const uploadRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Bạn đang tải lên quá nhiều tệp, vui lòng thử lại sau ít phút.' }
});

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = new Set(['.xlsx', '.xls']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXT.has(ext) ? ext : '';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return cb(new HttpError(400, `Chỉ chấp nhận file Excel (.xlsx/.xls), không hỗ trợ: ${ext || '(không rõ)'}`));
    }
    cb(null, true);
  }
});

// POST /api/it-price/parse-file — chỉ người có quyền itPriceProposeCreate (hoặc admin) mới gọi được:
// dùng cho cả lúc tạo đề xuất mới lẫn tải lên tệp bổ sung (Yêu Cầu Bổ Sung) của chính đề xuất đang có.
// Trường form "masterListId" (tuỳ chọn) — nếu gửi kèm, dò cột file bảng giá thật theo ĐÚNG tên cột của
// Mẫu Giá đó (đọc thẳng DB.itPriceMasterLists ở server, KHÔNG gửi nguyên khuôn cột ra ngoài khi chưa
// chọn) thay vì bộ từ khoá chung — báo lỗi rõ ràng nếu thiếu cột bắt buộc theo mẫu. Mẫu Giá giờ CHỈ là
// khuôn cột (không còn dữ liệu giá thật để đối chiếu/tự động duyệt — xem lib/createValidation.js).
router.post('/parse-file', uploadRateLimiter, (req, res) => {
  if (!req.freshUser.perms?.admin && !req.freshUser.perms?.itPriceProposeCreate) {
    return res.status(403).json({ error: 'Bạn không có quyền đề xuất duyệt giá' });
  }
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/it-price/parse-file');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp bảng giá cần tải lên' });

    try {
      const declaredExt = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, declaredExt);
      if (!check.ok) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: check.reason });
      }
      let masterListName = null;
      let template = null;
      const masterListId = req.body.masterListId ? Number(req.body.masterListId) : null;
      if (masterListId) {
        const masterLists = (await getAppDataValueCached('itPriceMasterLists')) || [];
        const master = masterLists.find(m => m.id === masterListId);
        if (master) { template = master; masterListName = master.name; }
      }
      const { items, columnLabels } = await parsePriceFile(buffer, template);

      res.json({
        items,
        columnLabels,
        masterListName,
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        size: req.file.size
      });
    } catch (parseErr) {
      fs.unlink(req.file.path, () => {});
      sendCatchError(res, parseErr, 'POST /api/it-price/parse-file');
    }
  });
});

// POST /api/it-price/master-list/parse-file — chỉ admin (khớp ADMIN_ONLY_KEYS cho itPriceMasterLists ở
// routes/data.js). CHỈ đọc dòng tiêu đề để lấy khuôn cột (columns), KHÔNG đọc/lưu bất kỳ dòng dữ liệu
// nào bên dưới — Mẫu Giá giờ thuần là khuôn cột đại diện cho định dạng bên mua hàng gửi tại 1 thời điểm,
// không còn phải bảng giá thật để đối chiếu tự động. Client tự đặt tên/lưu qua POST /api/data/itPriceMasterLists
// (khớp khuôn "Nhóm Không Cấp Văn Phòng Phẩm" — parse xong không tự ghi CSDL ngay, gộp vào danh sách rồi
// bấm 1 nút Lưu chung).
router.post('/master-list/parse-file', uploadRateLimiter, (req, res) => {
  if (!req.freshUser.perms?.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới có quyền nạp Mẫu Giá' });
  }
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/it-price/master-list/parse-file');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp mẫu cần tải lên' });

    try {
      const declaredExt = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, declaredExt);
      if (!check.ok) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: check.reason });
      }
      const columns = await parsePriceTemplateColumns(buffer);
      res.json({
        columns,
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname,
        size: req.file.size
      });
    } catch (parseErr) {
      fs.unlink(req.file.path, () => {});
      sendCatchError(res, parseErr, 'POST /api/it-price/master-list/parse-file');
    }
  });
});

// POST /api/it-price/:id/download-marked — "Đánh dấu cột trước khi tải" (mục 4 kế hoạch): tô nền xanh
// da trời nhạt cho TOÀN BỘ cell (cả header lẫn dữ liệu) của các cột được chọn, GIỮ NGUYÊN ĐỦ mọi cột
// khác của file gốc — KHÔNG xoá/ẩn cột nào. Sinh buffer MỚI theo TỪNG request, KHÔNG bao giờ ghi đè file
// gốc trên đĩa (chỉ đọc buffer vào bộ nhớ rồi trả thẳng qua response, không fs.writeFile lại filePath).
//
// CHỈ áp dụng cho ĐÚNG file khớp resolveApprovedFileUrl(item) (dùng lại NGUYÊN hàm dùng chung với
// lib/fileAuthz.js mục 2 — không viết luồng quyền/luồng xác định "file đã duyệt" riêng, xem rủi ro #3/#4
// ở kế hoạch). Tự kiểm lại canViewItPriceApproval() ngay tại đây (KHÔNG tin riêng client đã lọc đúng
// quyền trước khi hiện nút) — cùng khuôn mọi route ghi/đọc dữ liệu nhạy cảm khác trong hệ thống.
const MARK_COLUMN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFDFF5' } };

router.post('/:id/download-marked', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const items = await getAllForCollection('itPriceApprovals');
    const item = (items || []).find(x => x.id === itemId);
    if (!item) return res.status(404).json({ error: 'Không tìm thấy đề xuất' });

    const appData = await getAllAppData();
    if (!(await canViewItPriceApproval(req.freshUser, item, appData))) {
      return res.status(403).json({ error: 'Bạn không có quyền tải tệp của đề xuất này' });
    }

    const approvedFileUrl = resolveApprovedFileUrl(item);
    if (!approvedFileUrl) {
      return res.status(403).json({ error: 'Đề xuất này chưa có tệp đã được phê duyệt chính thức để tải' });
    }
    const file = (item.files || []).find(f => f.fileUrl === approvedFileUrl);
    if (!file) return res.status(404).json({ error: 'Không tìm thấy tệp đã phê duyệt' });

    const columnLabels = (file.columnLabels && file.columnLabels.length) ? file.columnLabels : [{ key: 'c0', label: 'Dữ liệu' }];
    const validKeys = new Set(columnLabels.map(c => c.key));
    const rawKeys = Array.isArray(req.body?.columnKeys) ? req.body.columnKeys : [];
    const markKeys = Array.from(new Set(rawKeys.map(k => String(k)).filter(k => validKeys.has(k))));
    if (!markKeys.length) return res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 cột cần đánh dấu' });

    const fileName = parseUploadsFileUrl(approvedFileUrl);
    if (!fileName) return res.status(400).json({ error: 'Đường dẫn tệp không hợp lệ' });
    const filePath = path.join(UPLOAD_DIR, fileName);
    if (path.dirname(filePath) !== UPLOAD_DIR || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Không tìm thấy tệp' });
    }

    const buffer = fs.readFileSync(filePath);
    // Phòng thủ thêm (defense-in-depth) dù tệp này đã qua đúng lớp kiểm zip-bomb 1 lần lúc TẢI LÊN ban
    // đầu (xem lib/priceFileParser.js::parsePriceFile -> streamFirstSheetRows) — ở đây lần đầu tiên đọc
    // TOÀN BỘ workbook (workbook.xlsx.load(), không streaming) để giữ được style/định dạng gốc lúc ghi
    // lại, tốn RAM nhiều hơn hẳn nên đáng kiểm lại cho chắc trước khi load.
    await assertDecompressedSizeWithinBudget(buffer);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return res.status(400).json({ error: 'Tệp không có sheet dữ liệu nào' });

    // Map key cột (columnLabels[].key) -> chỉ số cột THẬT trong sheet — không tin lại vị trí suy ra lúc
    // parse ban đầu (có thể lệch nếu nộp qua Mẫu Giá, xem lib/priceFileParser.js::matchColumnsToTemplate:
    // thứ tự cột trong file thật không nhất thiết trùng Mẫu Giá) mà DÒ LẠI theo TÊN CỘT (đã chuẩn hoá hoa/
    // thường/dấu, dùng ĐÚNG normalizeHeader() dùng chung với lib/priceFileParser.js) ngay trên dòng tiêu
    // đề thật của sheet đang mở — luôn khớp đúng cột thật bất kể thứ tự.
    // Dòng tiêu đề THẬT không chắc luôn là dòng 1 vật lý — lib/priceFileParser.js::parsePriceFile (qua
    // streamFirstSheetRows, mặc định includeEmpty:false) coi dòng KHÔNG-TRỐNG ĐẦU TIÊN là dòng tiêu đề, tức
    // file thật có thể có dòng trống/tiêu đề phụ phía trên (VD dòng tên công ty/tiêu đề bảng) mà dòng tiêu
    // đề cột thật nằm ở dòng 2/3... — dò lại ĐÚNG quy ước đó ở đây (row.hasValues), KHÔNG giả định cứng
    // dòng 1, nếu không sẽ đọc nhầm dòng trống/tiêu đề phụ làm tiêu đề cột và không khớp được cột nào.
    let headerRowNumber = null;
    for (let r = 1; r <= worksheet.rowCount; r++) {
      if (worksheet.getRow(r).hasValues) { headerRowNumber = r; break; }
    }
    if (!headerRowNumber) {
      return res.status(400).json({ error: 'Tệp không có dòng tiêu đề nào' });
    }
    const headerRow = worksheet.getRow(headerRowNumber);
    const headerColByNorm = new Map();
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const norm = normalizeHeader(cell.value == null ? '' : String(cell.value));
      if (norm && !headerColByNorm.has(norm)) headerColByNorm.set(norm, colNumber);
    });

    const labelByKey = new Map(columnLabels.map(c => [c.key, c.label]));
    const targetCols = [];
    for (const key of markKeys) {
      const label = labelByKey.get(key);
      const colNumber = label ? headerColByNorm.get(normalizeHeader(label)) : null;
      if (colNumber) targetCols.push(colNumber);
    }
    if (!targetCols.length) {
      return res.status(400).json({ error: 'Không khớp được cột nào cần đánh dấu với tệp gốc trên đĩa' });
    }

    // Tô từ ĐÚNG dòng tiêu đề thật trở xuống (headerRowNumber, không phải dòng 1) — tránh tô nhầm lên
    // dòng trống/tiêu đề phụ phía trên dòng tiêu đề cột nếu file thật có (xem chú thích dò headerRowNumber
    // ở trên).
    const maxRow = Math.max(worksheet.rowCount || 0, worksheet.actualRowCount || 0, headerRowNumber);
    for (const colNumber of targetCols) {
      for (let r = headerRowNumber; r <= maxRow; r++) {
        worksheet.getCell(r, colNumber).fill = MARK_COLUMN_FILL;
      }
    }

    const outName = `${(file.fileName || 'bang-gia').replace(/\.xlsx?$/i, '')}-danh-dau.xlsx`;
    const asciiFallback = outName.replace(/[^\x20-\x7E]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(outName)}`);
    // Ghi buffer MỚI thẳng vào response — KHÔNG đụng tới filePath trên đĩa (đọc bằng fs.readFileSync ở
    // trên, không có bất kỳ fs.writeFile*/fs.copyFile* nào nhắm vào filePath trong toàn bộ handler này).
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('⛔ POST /api/it-price/:id/download-marked lỗi:', err && err.stack || err);
    if (!res.headersSent) res.status(500).json({ error: 'Không thể tạo tệp đã đánh dấu' });
  }
});

module.exports = router;
