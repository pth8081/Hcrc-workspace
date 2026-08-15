// routes/data.js — API generic thay thế localStorage: mỗi "collection" của app = 1 dòng trong AppData.
// Trước đây router này KHÔNG có xác thực gì — ai gọi cũng đọc/ghi được toàn bộ dữ liệu công ty (kể
// cả mật khẩu người dùng dạng plaintext). Giờ bắt buộc đăng nhập (requireAuth) cho MỌI route, và các
// collection nhạy cảm (users, cấu hình quy trình, nhóm phân quyền...) chỉ admin mới được GHI.
const express = require('express');
const router = express.Router();
const { getPool } = require('../db');
const { DEFAULTS } = require('../defaults');
const { getAppDataValue, setAppDataValue } = require('../lib/appData');
const { requireAuth, hashPassword, isBcryptHash } = require('../lib/auth');

const VALID_KEYS = new Set(Object.keys(DEFAULTS));

// Các collection chỉ Quản Trị Viên mới được GHI — đều là màn hình "Quản trị" trong admin panel
// (quản lý user/quyền, cấu hình quy trình phê duyệt theo phòng ban/loại, cấu hình SMTP). Không gồm
// systemLogs vì MỌI hành động nghiệp vụ (tạo/duyệt hồ sơ...) đều tự động ghi log, không riêng admin.
const ADMIN_ONLY_KEYS = new Set([
  'users', 'permGroups', 'emailConfig',
  'deptWorkflows', 'submissionDeptWorkflows', 'submissionTypeDeptWorkflows', 'submissionApprovalGroups',
  'carDeptWorkflows', 'officeBuyDeptWorkflows', 'officeFixDeptWorkflows', 'officeInvestDeptWorkflows'
]);

router.use(requireAuth);

// Không bao giờ trả field mật khẩu (dù đã hash) ra ngoài — kể cả cho user đã đăng nhập, kể cả admin.
// Trình duyệt không cần giá trị này để làm bất cứ việc gì (đăng nhập/đổi mật khẩu đều qua API riêng).
function stripPasswords(users) {
  if (!Array.isArray(users)) return users;
  return users.map(({ pass, password, ...rest }) => rest);
}

// Trước khi ghi collection "users": KHÔNG bao giờ lưu lại mật khẩu dạng plaintext.
// - Nếu admin để trống ô mật khẩu khi sửa user (form không còn hiển thị mật khẩu cũ) -> giữ
//   nguyên hash đang lưu của đúng user đó (khớp theo id), KHÔNG xoá/ghi đè thành rỗng.
// - Nếu admin nhập mật khẩu mới (chuỗi thường) -> hash lại bằng bcrypt trước khi lưu.
async function prepareUsersForSave(incomingUsers) {
  const existing = (await getAppDataValue('users')) || [];
  const existingById = new Map(existing.map(u => [u.id, u]));

  return Promise.all(incomingUsers.map(async (u) => {
    const prior = existingById.get(u.id);
    if (!u.pass) {
      return { ...u, pass: prior ? prior.pass : undefined };
    }
    if (isBcryptHash(u.pass)) return u; // đã hash sẵn (không phải trường hợp bình thường, nhưng an toàn)
    return { ...u, pass: await hashPassword(u.pass) };
  }));
}

// GET /api/data  → trả về TOÀN BỘ dữ liệu app dưới dạng { depts, cats, users, docs, ... }
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT DataKey, DataValue FROM dbo.AppData');

    const data = {};
    for (const row of result.recordset) {
      try {
        data[row.DataKey] = JSON.parse(row.DataValue);
      } catch (e) {
        console.error(`Lỗi parse JSON cho key "${row.DataKey}":`, e.message);
        data[row.DataKey] = null;
      }
    }
    if (data.users) data.users = stripPasswords(data.users);
    res.json(data);
  } catch (err) {
    console.error('GET /api/data lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tải dữ liệu từ SQL Server', detail: err.message });
  }
});

// GET /api/data/:key  → trả về 1 collection cụ thể (ít dùng, tiện cho debug)
router.get('/:key', async (req, res) => {
  const { key } = req.params;
  if (!VALID_KEYS.has(key)) return res.status(400).json({ error: `Key không hợp lệ: ${key}` });

  try {
    const value = await getAppDataValue(key);
    if (value === null) return res.json(DEFAULTS[key]);
    res.json(key === 'users' ? stripPasswords(value) : value);
  } catch (err) {
    console.error(`GET /api/data/${key} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể tải dữ liệu từ SQL Server', detail: err.message });
  }
});

// POST /api/data/:key  → ghi đè toàn bộ 1 collection (tương đương syncStorage(key) trước đây)
router.post('/:key', async (req, res) => {
  const { key } = req.params;
  if (!VALID_KEYS.has(key)) return res.status(400).json({ error: `Key không hợp lệ: ${key}` });

  if (ADMIN_ONLY_KEYS.has(key) && !req.user.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới có quyền sửa dữ liệu này' });
  }

  let value = req.body;
  if (value === undefined) return res.status(400).json({ error: 'Thiếu dữ liệu (body) cần lưu' });

  try {
    if (key === 'users') value = await prepareUsersForSave(value);
    await setAppDataValue(key, value);
    res.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/data/${key} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể lưu dữ liệu vào SQL Server', detail: err.message });
  }
});

module.exports = router;
