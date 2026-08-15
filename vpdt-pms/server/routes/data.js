// routes/data.js — API generic thay thế localStorage: mỗi "collection" của app = 1 dòng trong AppData.
// Trước đây router này KHÔNG có xác thực gì — ai gọi cũng đọc/ghi được toàn bộ dữ liệu công ty (kể
// cả mật khẩu người dùng dạng plaintext). Giờ bắt buộc đăng nhập (requireAuth) cho MỌI route, và các
// collection nhạy cảm (users, cấu hình quy trình, nhóm phân quyền...) chỉ admin mới được GHI.
const express = require('express');
const router = express.Router();
const { getPool } = require('../db');
const { DEFAULTS } = require('../defaults');
const { getAppDataValue, setAppDataValue, setAppDataValueIfVersionMatches } = require('../lib/appData');
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

// Xác nhận LẠI quyền admin từ CSDL tại thời điểm ghi, không tin cờ "admin" cache sẵn trong JWT lúc
// đăng nhập (req.user.admin, hiệu lực tới 8h) — nếu không re-fetch, một admin vừa bị THU HỒI quyền sẽ
// vẫn ghi được vào các collection nhạy cảm (users/permGroups/deptWorkflows...) cho tới khi JWT hết
// hạn hoặc họ tự đăng xuất. Khớp đúng cách routes/workflow.js, routes/create.js, routes/records.js đã
// làm (re-fetch freshUser từ DB thay vì tin token) — trước đây route này (viết từ trước, ở Bước 0) là
// nơi DUY NHẤT còn sót lại kiểu tin token cũ.
async function isCurrentlyAdmin(username) {
  const users = await getAppDataValue('users');
  const freshUser = (users || []).find(u => u.username === username);
  return !!freshUser?.perms?.admin;
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

// GET /api/data  → trả về TOÀN BỘ dữ liệu app dưới dạng { depts, cats, users, docs, ..., _versions }
// _versions[key] = UpdatedAt (ISO string) tại thời điểm đọc — client lưu lại, gửi kèm header
// If-Match khi ghi (syncStorage()) để server phát hiện xung đột ghi đồng thời (xem POST /:key bên
// dưới + lib/appData.js setAppDataValueIfVersionMatches()).
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT DataKey, DataValue, UpdatedAt FROM dbo.AppData');

    const data = {};
    const versions = {};
    for (const row of result.recordset) {
      try {
        data[row.DataKey] = JSON.parse(row.DataValue);
        versions[row.DataKey] = row.UpdatedAt.toISOString();
      } catch (e) {
        console.error(`Lỗi parse JSON cho key "${row.DataKey}":`, e.message);
        data[row.DataKey] = null;
      }
    }
    if (data.users) data.users = stripPasswords(data.users);
    data._versions = versions;
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

// POST /api/data/:key  → ghi đè toàn bộ 1 collection (tương đương syncStorage(key) trước đây).
// Header If-Match (tuỳ chọn, so version đọc gần nhất) -> nếu có, chỉ ghi khi chưa ai đổi key này kể
// từ lúc client đọc; ai đó đã ghi trước thì trả 409 thay vì âm thầm ghi đè mất thay đổi của họ. Nếu
// KHÔNG gửi If-Match thì ghi vô điều kiện như trước (đường lùi an toàn cho các nơi chưa cập nhật
// theo dõi version — không phá hành vi hiện có).
router.post('/:key', async (req, res) => {
  const { key } = req.params;
  if (!VALID_KEYS.has(key)) return res.status(400).json({ error: `Key không hợp lệ: ${key}` });

  let value = req.body;
  if (value === undefined) return res.status(400).json({ error: 'Thiếu dữ liệu (body) cần lưu' });

  try {
    if (ADMIN_ONLY_KEYS.has(key) && !(await isCurrentlyAdmin(req.user.username))) {
      return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới có quyền sửa dữ liệu này' });
    }

    if (key === 'users') value = await prepareUsersForSave(value);

    const ifMatch = req.get('If-Match');
    if (ifMatch) {
      const { conflict, version } = await setAppDataValueIfVersionMatches(key, value, ifMatch);
      if (conflict) {
        return res.status(409).json({
          error: `Dữ liệu "${key}" vừa bị người khác thay đổi — vui lòng tải lại trang rồi thử lại.`,
          conflict: true
        });
      }
      res.set('ETag', version);
      return res.json({ ok: true, version });
    }

    await setAppDataValue(key, value);
    res.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/data/${key} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể lưu dữ liệu vào SQL Server', detail: err.message });
  }
});

module.exports = router;
