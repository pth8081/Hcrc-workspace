// routes/adminTrustedCa.js — Quản lý danh sách CA nội bộ được tin cậy cho các lượt GỌI RA NGOÀI qua
// HTTPS của server (10/2026, xem lib/trustedCaManager.js cho cơ chế đầy đủ). Mount tại
// /api/admin/trusted-ca. Cùng khuôn routes/adminTlsCert.js: admin-only, multer memoryStorage (file rất
// nhỏ), dùng CHUNG lib/uploadRateLimiter.js.
const express = require('express');
const multer = require('multer');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { insertSystemLog } = require('../lib/systemLogStore');
const { sendServerError } = require('../lib/errorResponse');
const trustedCaManager = require('../lib/trustedCaManager');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

function requireAdmin(req, res) {
  if (!req.freshUser?.perms?.admin) {
    res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được quản lý Chứng Chỉ Tin Cậy (CA ngoài)' });
    return false;
  }
  return true;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: trustedCaManager.MAX_PEM_BYTES, files: 1 }
});

router.get('/', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json({
      certificates: trustedCaManager.listCaCertificates(),
      envConfig: trustedCaManager.getEnvConfigStatus()
    });
  } catch (err) {
    sendServerError(res, 500, err, 'GET /api/admin/trusted-ca', 'Không thể tải danh sách Chứng Chỉ Tin Cậy');
  }
});

const uploadSingle = upload.single('caCertFile');

router.post('/', uploadRateLimiter, (req, res) => {
  if (!requireAdmin(req, res)) return;
  uploadSingle(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${Math.round(trustedCaManager.MAX_PEM_BYTES / 1024)}KB — chứng chỉ CA PEM thật chỉ vài KB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendServerError(res, 500, err, 'POST /api/admin/trusted-ca (multer)', 'Không thể nhận tệp chứng chỉ CA');
    try {
      if (!req.file) return res.status(400).json({ error: 'Vui lòng chọn file chứng chỉ CA (.pem/.crt/.cer)' });
      const name = String(req.body?.name || '').trim();
      let added;
      try {
        added = trustedCaManager.addCaCertificates({
          rawPem: req.file.buffer.toString('utf8'),
          name,
          addedBy: req.user.username,
          addedByName: req.freshUser?.name || req.user.username
        });
      } catch (validationErr) {
        return res.status(400).json({ error: validationErr.message });
      }

      insertSystemLog({
        username: req.user.username, fullName: req.freshUser?.name || req.user.username, ipAddress: req.ip,
        module: 'SYSTEM', actionType: 'TRUSTED_CA_ADDED',
        targetObject: added.map(a => a.subject).join('; '),
        description: `Thêm ${added.length} chứng chỉ CA tin cậy: ${added.map(a => `${a.name} (Subject: ${a.subject}, hạn dùng: ${a.validTo})`).join('; ')} — CẦN RESTART (pm2 restart) để áp dụng cho MỌI tiến trình`,
        status: 'SUCCESS'
      }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (thêm CA tin cậy):', e.message));

      res.json({
        ok: true, added,
        envConfig: trustedCaManager.getEnvConfigStatus(),
        message: `Đã thêm ${added.length} chứng chỉ CA. Chạy "pm2 restart" để áp dụng cho TẤT CẢ tiến trình PM2 — xem hướng dẫn cấu hình NODE_EXTRA_CA_CERTS (1 lần) nếu chưa làm.`
      });
    } catch (err) {
      sendServerError(res, 500, err, 'POST /api/admin/trusted-ca', 'Không thể thêm chứng chỉ CA tin cậy');
    }
  });
});

router.delete('/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
    let removed;
    try {
      removed = trustedCaManager.deleteCaCertificate(id);
    } catch (err) {
      if (err.message === 'NOT_FOUND') return res.status(404).json({ error: 'Không tìm thấy chứng chỉ CA này' });
      throw err;
    }

    insertSystemLog({
      username: req.user.username, fullName: req.freshUser?.name || req.user.username, ipAddress: req.ip,
      module: 'SYSTEM', actionType: 'TRUSTED_CA_DELETED', targetObject: removed.subject || `#${id}`,
      description: `Xoá chứng chỉ CA tin cậy "${removed.name}" (Subject: ${removed.subject}) — CẦN RESTART để áp dụng cho MỌI tiến trình`,
      status: 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (xoá CA tin cậy):', e.message));

    res.json({ ok: true, message: 'Đã xoá. Chạy "pm2 restart" để áp dụng cho TẤT CẢ tiến trình.' });
  } catch (err) {
    sendServerError(res, 500, err, 'DELETE /api/admin/trusted-ca/:id', 'Không thể xoá chứng chỉ CA tin cậy');
  }
});

module.exports = router;
