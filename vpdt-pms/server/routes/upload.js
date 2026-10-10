// routes/upload.js — Nhận file đính kèm (multipart/form-data) và lưu ra ổ đĩa server,
// thay vì nhúng base64 (Data URL) vào JSON như trước. API JSON /api/data chỉ còn lưu
// đường dẫn (fileUrl) trỏ tới file vật lý dưới đây.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { getAppDataValueCached } = require('../lib/appData');
const { verifyFileSignature } = require('../lib/fileSignature');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { recordUploadedFile } = require('../lib/uploadedFiles');
const { fixUploadedFilename } = require('../lib/uploadFilename');

const router = express.Router();

// Giới hạn riêng cho tải file (ghi ra ổ đĩa, tốn tài nguyên hơn API JSON thường) — chặt hơn giới hạn
// chung toàn /api (xem server.js) để tránh 1 tài khoản làm đầy ổ đĩa bằng cách tải liên tục.

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);

// ===== Làn tải VIDEO (9/2026 — video bài Nhịp Sống HCRC/Góc Chia Sẻ) =====
// Giới hạn RIÊNG mỗi video — hằng số đặt tên rõ ràng, đổi ở ĐÂY nếu cần nâng/hạ (client đọc cùng giá trị
// qua INTERNAL_VIDEO_MAX_MB_CLIENT ở module-internalcomms-nhipsong.js chỉ để báo lỗi sớm, server vẫn là
// nơi chặn thật). Vượt xa UPLOAD_MAX_MB chung (mặc định 20MB) nên KHÔNG thể đi chung 1 multer với mọi tệp
// khác (multer.limits.fileSize cố định theo instance, và nới giới hạn chung lên 200MB sẽ mở cho MỌI module
// khác tải tệp 200MB). Tách hẳn 1 instance multer riêng CHỈ nhận .mp4/.webm, chỉ dùng khi request tự khai
// ?module=internalVideo trên URL (multer chưa parse body nên không đọc được field "module" trước khi chọn
// instance) — field "module" trong body vẫn PHẢI khớp đúng 'internalVideo' (kiểm lại sau khi parse), không
// cho mượn làn này để đẩy tệp khác. Triển khai sau Nginx: client_max_body_size cũng phải >= giá trị này.
const INTERNAL_VIDEO_MODULE_KEY = 'internalVideo';
const INTERNAL_VIDEO_MAX_MB = 200;
const VIDEO_EXT = new Set(['.mp4', '.webm']);
// Kiểm chữ ký nhị phân video chỉ cần phần đầu tệp (hộp "ftyp" của MP4 / header EBML của WebM) — KHÔNG đọc
// nguyên tệp 200MB vào RAM như nhánh tài liệu/ảnh (vài MB) bên dưới.
const VIDEO_SIGNATURE_HEAD_BYTES = 64 * 1024;

// Mặc định SAN cho module MỚI khi admin CHƯA từng cấu hình riêng ở "Quản Lý Tệp File" (khác các module
// cũ hơn — doc/submission/contract/...: KHÔNG cấu hình riêng thì rơi về ALLOWED_EXT chung, gồm cả
// .pdf/.docx/.xlsx lẫn ảnh, vì các module đó vốn CHỈ tải lên tài liệu văn phòng). "trainingTestImage"
// (ảnh minh hoạ câu hỏi Ngân Hàng Câu Hỏi) đúng ra CHỈ nên nhận ảnh ngay từ đầu — không đợi admin phải tự
// vào cấu hình mới siết đúng, vì defaults.js chỉ seed được cho CSDL hoàn toàn mới (seedDefaults.js chỉ
// ghi key CHƯA từng tồn tại, không tự thêm sub-key mới vào 1 key "uploadFileTypeConfig" đã có sẵn ở các
// hệ thống đang chạy) — dùng map mặc định NGAY TẠI ĐÂY để áp dụng được cho CẢ 2 trường hợp (cài mới lẫn
// hệ thống đang chạy nâng cấp code). Admin vẫn override được bình thường qua UI (config[moduleKey] khi
// đó khác rỗng sẽ thắng map này, xem 2 dòng "||" bên dưới).
const MODULE_DEFAULT_ALLOWED_EXT = {
  trainingTestImage: ['.jpg', '.jpeg', '.png', '.webp'],
  // checklistAnswerPhoto (ảnh bằng chứng đính kèm câu trả lời Checklist Đánh Giá Siêu Thị) — cùng lý do
  // trainingTestImage ở trên, chỉ nên nhận ảnh ngay từ đầu.
  checklistAnswerPhoto: ['.jpg', '.jpeg', '.png', '.webp'],
  // internalImage (LỖI ĐÃ VÁ, đợt rà soát chuyên sâu upload 10/2026, mức Trung bình — "đụng độ
  // moduleKey"): trước đây banner tin tuyển dụng (rjBannerFile) + ảnh tài liệu Truyền Thông Nội Bộ
  // (tdFile khi docType==='IMAGE') dùng CHUNG moduleKey 'internal' với tệp văn bản (internalFile/
  // rrCvFile, admin cấu hình "Loại Tệp Cho Phép" cho 'internal' chỉ gồm .pdf/.docx/.xlsx — xem
  // UPLOAD_EXT_UNIVERSE ở module-tailieu.js) — nếu admin cấu hình đúng như nhãn "Truyền Thông Nội Bộ"
  // gợi ý (chỉ văn bản), mọi banner/ảnh tài liệu bị chặn tải lên dù đây là tính năng hợp lệ, KHÔNG hề
  // liên quan tới cấu hình loại tệp văn bản admin vừa chỉnh. Tách hẳn moduleKey riêng cho nhánh ảnh.
  internalImage: ['.jpg', '.jpeg', '.png', '.webp'],
  // internalVideo (9/2026, video bài Nhịp Sống HCRC/Góc Chia Sẻ, tối đa 2 video/bài — trần số lượng kiểm ở
  // lib/createValidation.js normalizeInternalPostMedia()) — CHỈ .mp4/.webm. Đi qua "làn video" RIÊNG (xem
  // INTERNAL_VIDEO_MODULE_KEY bên dưới) vì dung lượng vượt xa giới hạn chung UPLOAD_MAX_MB.
  internalVideo: ['.mp4', '.webm'],
  // operationEstimate (tệp đính kèm "danh mục lớn" của Danh Mục Đầu Tư, Vận Hành > QLDA) — theo đúng
  // yêu cầu người dùng "cho phép upload file dạng PDF, docx, xlsx" — CHỈ 3 định dạng này mặc định (admin
  // vẫn tự mở rộng được qua "Quản Lý Tệp File" nếu cần).
  operationEstimate: ['.pdf', '.docx', '.xlsx'],
  // officeFixTechAssessment (11/2026, Kỹ Thuật Xác Nhận Sửa Chữa VP) — ảnh/tài liệu hiện trường người xác
  // nhận kỹ thuật tải lên lúc Duyệt bước kỹ thuật, cùng khuôn checklistAnswerPhoto/trainingTestImage.
  officeFixTechAssessment: ['.jpg', '.jpeg', '.png', '.webp', '.pdf']
};
const MODULE_DEFAULT_MAX_MB = {
  trainingTestImage: 5,
  checklistAnswerPhoto: 5,
  internalImage: 5,
  internalVideo: INTERNAL_VIDEO_MAX_MB,
  officeFixTechAssessment: 5
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Danh sách phần mở rộng cho phép — khớp với loại tài liệu/hồ sơ DMS thường dùng
const ALLOWED_EXT = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.png', '.jpg', '.jpeg', '.gif', '.webp'
]);

// makeUploader(allowedExt, maxMb) — 1 instance multer cho 1 "làn" tải lên (làn chung ALLOWED_EXT/MAX_MB,
// làn video VIDEO_EXT/INTERNAL_VIDEO_MAX_MB — xem chú thích INTERNAL_VIDEO_MODULE_KEY ở trên).
function makeUploader(allowedExt, maxMb) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = allowedExt.has(ext) ? ext : '';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
    }
  });
  return multer({
    storage,
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedExt.has(ext)) {
        return cb(new HttpError(400, `Định dạng tệp không được hỗ trợ: ${ext || '(không rõ)'}`));
      }
      cb(null, true);
    }
  });
}
const upload = makeUploader(ALLOWED_EXT, MAX_MB);
const uploadVideo = makeUploader(VIDEO_EXT, INTERNAL_VIDEO_MAX_MB);

async function readFileHead(filePath, maxBytes) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

// POST /api/upload  → nhận field "file" (+ field text "module" tuỳ chọn), trả về thông tin để lưu
// vào collection JSON tương ứng
router.post('/', uploadRateLimiter, (req, res) => {
  const isVideoLane = req.query && req.query.module === INTERNAL_VIDEO_MODULE_KEY;
  const laneUploader = isVideoLane ? uploadVideo : upload;
  const laneMaxMb = isVideoLane ? INTERNAL_VIDEO_MAX_MB : MAX_MB;
  laneUploader.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${laneMaxMb}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    // err ở đây (không phải MulterError) chỉ có thể tới từ fileFilter phía trên — LUÔN là HttpError(400,
    // <thông điệp an toàn cho người dùng>) do chính route này ném ra (xem fileFilter) — nhưng
    // sendCatchError() vẫn kiểm instanceof thay vì tin mọi err đều an toàn để hiển thị: nếu tương lai
    // multer/Node ném ra 1 lỗi KHÔNG PHẢI do fileFilter (VD lỗi ghi đĩa ENOSPC/EACCES — chứa đường dẫn
    // thật trên server), lỗi đó tự động rơi về sendServerError() (không lộ chi tiết khi NODE_ENV=production)
    // thay vì trả thẳng err.message như trước — xem lib/errorResponse.js.
    if (err) return sendCatchError(res, err, 'POST /api/upload');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần tải lên' });
    req.file.originalname = fixUploadedFilename(req.file.originalname);

    // Kiểm tra riêng theo module (xem admin "Loại Tệp Cho Phép") — SAU khi ALLOWED_EXT (danh sách
    // tổng, dùng ở fileFilter phía trên) đã chặn phần mở rộng nguy hiểm. Module chưa được cấu hình
    // riêng (hoặc field "module" bỏ trống) thì coi như dùng nguyên danh sách tổng — không phá vỡ các
    // chỗ gọi /api/upload cũ chưa gửi kèm "module".
    const moduleKey = (req.body.module || '').trim();
    // Làn video chỉ dành đúng cho moduleKey 'internalVideo' — khai ?module=internalVideo trên URL để được
    // giới hạn 200MB nhưng body lại khai module khác (hoặc bỏ trống) thì TỪ CHỐI, không cho mượn làn.
    if (isVideoLane && moduleKey !== INTERNAL_VIDEO_MODULE_KEY) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Làn tải video chỉ dành cho video bài viết Truyền Thông Nội Bộ' });
    }
    if (moduleKey) {
      try {
        const [config, sizeConfig] = await Promise.all([
          getAppDataValueCached('uploadFileTypeConfig'),
          getAppDataValueCached('uploadSizeLimitConfig')
        ]);
        const configuredForModule = config && config[moduleKey];
        const allowedForModule = (Array.isArray(configuredForModule) && configuredForModule.length)
          ? configuredForModule : MODULE_DEFAULT_ALLOWED_EXT[moduleKey];
        if (Array.isArray(allowedForModule) && allowedForModule.length) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          if (!allowedForModule.includes(ext)) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: `Định dạng tệp không được phép cho mục này: ${ext || '(không rõ)'}` });
          }
        }
        // Giới hạn dung lượng RIÊNG theo module (Hệ Thống → "Quản Lý Tệp File") — CHỈ có thể siết chặt
        // thêm, không vượt qua nổi giới hạn CHUNG toàn hệ thống ở multer.limits.fileSize phía trên (file
        // vượt giới hạn chung đã bị multer tự chặn từ trước khi tới được đây, xem nhánh LIMIT_FILE_SIZE).
        const configuredMaxMb = sizeConfig && Number(sizeConfig[moduleKey]) > 0 ? Number(sizeConfig[moduleKey]) : null;
        const maxMbForModule = configuredMaxMb || MODULE_DEFAULT_MAX_MB[moduleKey] || null;
        if (maxMbForModule && req.file.size > maxMbForModule * 1024 * 1024) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép cho mục này (${maxMbForModule}MB)` });
        }
      } catch (e) {
        // Lỗi tra cứu cấu hình không được chặn tải lên bình thường — coi như module chưa cấu hình riêng.
      }
    }

    // Kiểm tra chữ ký nhị phân thật của file — chạy 1 lần, SAU khi đuôi file đã qua cả 2 lớp lọc theo
    // đuôi ở trên (ALLOWED_EXT toàn cục + uploadFileTypeConfig riêng theo module nếu có), đối chiếu với
    // đúng đuôi mà file đang "sống sót" qua các lớp lọc đó (đuôi thật sự dùng để lưu file, xem `safeExt`
    // ở multer.diskStorage phía trên).
    try {
      const declaredExt = path.extname(req.file.originalname).toLowerCase();
      const buffer = VIDEO_EXT.has(declaredExt)
        ? await readFileHead(req.file.path, VIDEO_SIGNATURE_HEAD_BYTES)
        : await fs.promises.readFile(req.file.path);
      const check = await verifyFileSignature(buffer, declaredExt);
      if (!check.ok) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: check.reason });
      }
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Không thể kiểm tra nội dung tệp vừa tải lên.' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    // Ghi nhận CHÍNH CHỦ đã tải file này lên (dbo.UploadedFiles) — nguồn sự thật để
    // assertPayloadFileUrlsOwnedByUser() (lib/uploadedFiles.js, gọi ở routes/create.js) chặn việc tự
    // đặt fileUrl = tệp của người khác khi tạo hồ sơ. Lỗi ghi KHÔNG được chặn lượt tải lên đã thành công
    // (file vật lý đã lưu xong, trả lỗi ở đây sẽ làm mồ côi file mà không có cách nào dọn) — chỉ log lại.
    try {
      await recordUploadedFile(fileUrl, req.freshUser.username);
    } catch (e) {
      console.error('⛔ Không ghi được UploadedFiles cho', fileUrl, ':', e.message);
    }

    res.json({
      fileUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      size: req.file.size
    });
  });
});

module.exports = router;
// Export phụ cho test (tests/test-internal-media-server.js) — không đổi cách server.js dùng router ở trên.
module.exports.INTERNAL_VIDEO_MAX_MB = INTERNAL_VIDEO_MAX_MB;
module.exports.INTERNAL_VIDEO_MODULE_KEY = INTERNAL_VIDEO_MODULE_KEY;
module.exports.MODULE_DEFAULT_ALLOWED_EXT = MODULE_DEFAULT_ALLOWED_EXT;
module.exports.MODULE_DEFAULT_MAX_MB = MODULE_DEFAULT_MAX_MB;
