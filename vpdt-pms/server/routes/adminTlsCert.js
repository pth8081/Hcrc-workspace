// routes/adminTlsCert.js — Quản lý chứng chỉ TLS/HTTPS cho server tự phục vụ HTTPS (không qua Nginx),
// mount tại /api/admin/tls-cert. Xem lib/tlsCertManager.js cho mô hình đầy đủ (restart thủ công để áp
// dụng, cổng qua .env HTTPS_PORT). Admin-only — đây là thao tác hạ tầng nhạy cảm nhất trong hệ thống
// (private key TLS), gác chặt hơn các route admin khác: dùng multer.memoryStorage() (không ghi file tạm
// ra đĩa qua multer — PEM chỉ vài KB, giữ trong RAM tới lúc validate xong mới tự ghi file qua
// tlsCertManager.saveCertFiles()), dùng CHUNG lib/uploadRateLimiter.js (bucket rate-limit upload DÙNG
// CHUNG toàn hệ thống — xem chú thích đầy đủ tại lib/uploadRateLimiter.js, KHÔNG tự tạo rate limiter
// riêng ở đây để tránh lặp lại đúng lỗi "mỗi route 1 limiter riêng" đã vá trước đó).
const express = require('express');
const multer = require('multer');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { insertSystemLog } = require('../lib/systemLogStore');
const { sendServerError } = require('../lib/errorResponse');
const tlsCertManager = require('../lib/tlsCertManager');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

function requireAdmin(req, res) {
  if (!req.freshUser?.perms?.admin) {
    res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được quản lý chứng chỉ TLS' });
    return false;
  }
  return true;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: tlsCertManager.MAX_PEM_BYTES, files: 3 }
});

// GET /api/admin/tls-cert/status — metadata cert hiện có trên đĩa (Subject/Issuer/hạn dùng, KHÔNG kèm
// private key) + trạng thái HTTPS listener thật của tiến trình đang chạy, để UI phân biệt rõ "đã tải
// cert mới nhưng chưa restart" với "đang chạy HTTPS thật".
router.get('/status', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const onDisk = tlsCertManager.getCertMetadataFromDisk();
    res.json({
      hasCertOnDisk: tlsCertManager.hasCertFilesOnDisk(),
      certMetadata: onDisk,
      httpsListener: tlsCertManager.getHttpsStatus(),
      httpsPortConfigured: process.env.HTTPS_PORT ? Number(process.env.HTTPS_PORT) : null
    });
  } catch (err) {
    sendServerError(res, 500, err, 'GET /api/admin/tls-cert/status', 'Không thể tải trạng thái chứng chỉ TLS');
  }
});

// POST /api/admin/tls-cert — nhận 3 field multipart: privateKey (bắt buộc), certificate (bắt buộc),
// caChain (tuỳ chọn). Validate bằng tls.createSecureContext() thật (xem
// tlsCertManager.validateAndDescribe()) rồi mới ghi file — sai/lệch key-cert bị chặn ở đây, KHÔNG để
// lọt vào đĩa rồi chỉ phát hiện lúc restart (khi đó HTTP cũng không chạy được nếu lỗi code xử lý sai).
const uploadFields = upload.fields([
  { name: 'privateKey', maxCount: 1 },
  { name: 'certificate', maxCount: 1 },
  { name: 'caChain', maxCount: 1 }
]);

router.post('/', uploadRateLimiter, (req, res) => {
  if (!requireAdmin(req, res)) return;
  uploadFields(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${Math.round(tlsCertManager.MAX_PEM_BYTES / 1024)}KB — chứng chỉ/khoá PEM thật chỉ vài KB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendServerError(res, 500, err, 'POST /api/admin/tls-cert (multer)', 'Không thể nhận tệp chứng chỉ TLS');
    try {
      const privateKeyFile = req.files?.privateKey?.[0];
      const certificateFile = req.files?.certificate?.[0];
      const caChainFile = req.files?.caChain?.[0];
      if (!privateKeyFile || !certificateFile) {
        return res.status(400).json({ error: 'Vui lòng chọn đủ Private Key và Certificate' });
      }
      const keyPem = privateKeyFile.buffer.toString('utf8');
      const certPem = certificateFile.buffer.toString('utf8');
      const caPem = caChainFile ? caChainFile.buffer.toString('utf8') : null;

      let metadata;
      try {
        metadata = tlsCertManager.saveCertFiles({ keyPem, certPem, caPem });
      } catch (err) {
        // Lỗi NGHIỆP VỤ (PEM sai định dạng/key-cert lệch nhau) — thông điệp tls.createSecureContext()/
        // X509Certificate ném ra đã an toàn để hiển thị (không chứa đường dẫn hệ thống/stack), hiện thẳng
        // cho admin tự biết sửa gì, không đi qua sendServerError() (vốn ẩn chi tiết ở production).
        return res.status(400).json({ error: `Chứng chỉ không hợp lệ: ${err.message}` });
      }

      insertSystemLog({
        username: req.user.username, fullName: req.freshUser?.name || req.user.username, ipAddress: req.ip,
        module: 'SYSTEM', actionType: 'TLS_CERT_UPLOADED',
        targetObject: metadata.subject || '(TLS certificate)',
        description: `Tải chứng chỉ TLS/HTTPS mới (Subject: ${metadata.subject || '?'}, hạn dùng: ${metadata.validTo || '?'}${metadata.hasCaChain ? ', có kèm CA Chain' : ''}) — CẦN RESTART (pm2 restart) để áp dụng`,
        status: 'SUCCESS'
      }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (tải chứng chỉ TLS):', e.message));

      res.json({
        ok: true,
        certMetadata: metadata,
        httpsListener: tlsCertManager.getHttpsStatus(),
        message: 'Đã lưu chứng chỉ TLS thành công. Chạy "pm2 restart" (hoặc khởi động lại server) để áp dụng chứng chỉ mới.'
      });
    } catch (err) {
      sendServerError(res, 500, err, 'POST /api/admin/tls-cert', 'Không thể lưu chứng chỉ TLS');
    }
  });
});

// DELETE /api/admin/tls-cert — xoá chứng chỉ khỏi đĩa (CẦN RESTART để server quay lại chạy thuần HTTP —
// không tự tắt HTTPS listener đang chạy, đúng mô hình "áp dụng bằng restart thủ công" đã chọn).
router.delete('/', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    if (!tlsCertManager.hasCertFilesOnDisk()) {
      return res.status(404).json({ error: 'Chưa có chứng chỉ TLS nào trên hệ thống' });
    }
    tlsCertManager.deleteCertFiles();

    insertSystemLog({
      username: req.user.username, fullName: req.freshUser?.name || req.user.username, ipAddress: req.ip,
      module: 'SYSTEM', actionType: 'TLS_CERT_DELETED', targetObject: '(TLS certificate)',
      description: 'Xoá chứng chỉ TLS/HTTPS khỏi hệ thống — CẦN RESTART để server quay lại chạy thuần HTTP',
      status: 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (xoá chứng chỉ TLS):', e.message));

    res.json({ ok: true, message: 'Đã xoá chứng chỉ TLS. Chạy "pm2 restart" để server quay lại chạy thuần HTTP.' });
  } catch (err) {
    sendServerError(res, 500, err, 'DELETE /api/admin/tls-cert', 'Không thể xoá chứng chỉ TLS');
  }
});

module.exports = router;
