// routes/data.js — API generic thay thế localStorage: mỗi "collection" của app = 1 dòng trong AppData.
// Trước đây router này KHÔNG có xác thực gì — ai gọi cũng đọc/ghi được toàn bộ dữ liệu công ty (kể
// cả mật khẩu người dùng dạng plaintext). Giờ bắt buộc đăng nhập (requireAuth) cho MỌI route, và các
// collection nhạy cảm (users, cấu hình quy trình, nhóm phân quyền...) chỉ admin mới được GHI.
const express = require('express');
const router = express.Router();
const { getPool } = require('../db');
const { DEFAULTS } = require('../defaults');
const { getAppDataValue, setAppDataValue, setAppDataValueIfVersionMatches } = require('../lib/appData');
const { requireAuth, blockIfMustChangePassword, hashPassword, isBcryptHash, validatePin } = require('../lib/auth');
const { validatePasswordStrength } = require('../lib/passwordPolicy');
const { HttpError } = require('../lib/httpErrors');
const { getAllTasks } = require('../lib/taskStore');
const { getAllForCollection, MIGRATED_COLLECTIONS } = require('../lib/recordStore');
const { sendServerError } = require('../lib/errorResponse');
const {
  filterDocsForUser, filterSubmissionsForUser, filterInternalPostsForUser, sanitizeReportPeriodsForUser
} = require('../lib/recordViewScope');

const VALID_KEYS = new Set(Object.keys(DEFAULTS));

// Các collection chỉ Quản Trị Viên mới được GHI — đều là màn hình "Quản trị" trong admin panel
// (quản lý user/quyền, cấu hình quy trình phê duyệt theo phòng ban/loại, cấu hình SMTP). systemLogs
// không còn ở đây/không còn trong VALID_KEYS — từ Bước 6a có route + bảng riêng (routes/systemLog.js,
// lib/systemLogStore.js): ghi (mọi user) qua POST /api/log, xoá (chỉ admin) qua DELETE /api/log.
const ADMIN_ONLY_KEYS = new Set([
  'users', 'permGroups', 'emailConfig', 'workflows',
  'deptWorkflows', 'submissionDeptWorkflows', 'submissionTypeDeptWorkflows', 'submissionApprovalGroups',
  'carDeptWorkflows', 'officeBuyDeptWorkflows', 'officeFixDeptWorkflows', 'officeInvestDeptWorkflows', 'vppDeptWorkflows',
  'contractApprovalDeptWorkflows', 'contractApprovalGroups', 'contractManageDeptWorkflows',
  // submissionTypes: chi phối tra cứu quy trình theo loại (submissionTypeDeptWorkflows) — không để
  // user thường tự đổi/xoá key đang được cấu hình quy trình riêng. contractTypes/carTypes/jobTitles
  // KHÔNG thêm vào đây (giữ đúng độ mở như depts/cats — thuần danh sách nhãn hiển thị, không có bước
  // tra cứu phụ thuộc nào khác dựa vào giá trị của chúng).
  'submissionTypes'
]);

router.use(requireAuth, blockIfMustChangePassword);

// Không bao giờ trả field mật khẩu (dù đã hash) ra ngoài — kể cả cho user đã đăng nhập, kể cả admin.
// Trình duyệt không cần giá trị này để làm bất cứ việc gì (đăng nhập/đổi mật khẩu đều qua API riêng).
// Cũng bỏ luôn failedLoginAttempts/lockedUntil (lib/loginAttempts.js) — GET /api/data trả nguyên mảng
// "users" cho MỌI người đã đăng nhập (không riêng admin), nên 2 field này trước đây vô tình để lộ cho
// bất kỳ nhân viên nào biết đồng nghiệp nào đang bị khoá tài khoản/bị dò mật khẩu — front-end không hề
// đọc dùng 2 field này ở đâu cả nên bỏ hẳn, không ảnh hưởng tính năng. mustChangePassword GIỮ LẠI vì
// màn quản lý người dùng (admin) có hiện badge "Chưa đổi mật khẩu tạm" dựa trên đúng field này.
function stripPasswords(users) {
  if (!Array.isArray(users)) return users;
  return users.map(({ pass, password, pinHash, failedLoginAttempts, lockedUntil, ...rest }) => rest);
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
// - Nếu admin nhập mật khẩu mới (chuỗi thường, tạo user mới hoặc reset mật khẩu cho user cũ) -> xác
//   minh đủ mạnh (cùng chuẩn với tự đổi mật khẩu ở PATCH /api/auth/me, xem lib/passwordPolicy.js —
//   trước đây đường này KHÔNG kiểm tra gì cả, admin có thể đặt mật khẩu 1 ký tự cho user khác), hash
//   lại bằng bcrypt, và đánh dấu mustChangePassword=true — mật khẩu admin gõ tạm chỉ có giá trị cho
//   LẦN ĐĂNG NHẬP ĐẦU, buộc chính user đó phải tự đổi lại ngay (xem lib/auth.js blockIfMustChangePassword),
//   giảm nguy cơ mật khẩu tạm/yếu tồn tại lâu dài không ai để ý.
async function prepareUsersForSave(incomingUsers) {
  const existing = (await getAppDataValue('users')) || [];
  const existingById = new Map(existing.map(u => [u.id, u]));

  return Promise.all(incomingUsers.map(async (u) => {
    const prior = existingById.get(u.id);
    // mustChangePassword/failedLoginAttempts/lockedUntil do SERVER tự quản lý (client không hề gõ ra
    // ở form) — nếu client đang cầm bản DB.users CŨ (vd vừa lưu tạo user xong, chưa tải lại trang) thì
    // object "u" gửi lên sẽ THIẾU các field này. Luôn khôi phục lại từ "prior" khi client không tự
    // gửi kèm, tránh bị xoá mất mustChangePassword=true oan uổng chỉ vì admin sửa tiếp 1 field khác
    // (VD sửa email) ngay sau khi tạo, trong cùng phiên chưa kịp đồng bộ lại.
    const preserved = prior ? {
      ...(u.mustChangePassword === undefined && { mustChangePassword: prior.mustChangePassword }),
      ...(u.failedLoginAttempts === undefined && { failedLoginAttempts: prior.failedLoginAttempts }),
      ...(u.lockedUntil === undefined && { lockedUntil: prior.lockedUntil }),
      // pinHash CHỈ được server tự ghi (từ u.pin plaintext bên dưới) — nếu client không gửi u.pin (để
      // trống ô = giữ nguyên PIN cũ), giữ lại pinHash cũ, KHÔNG để mất chỉ vì admin sửa field khác.
      ...(u.pin === undefined && { pinHash: prior.pinHash })
    } : {};

    let record = { ...u, ...preserved };
    delete record.pin; // KHÔNG BAO GIỜ lưu PIN dạng plaintext — chỉ lưu pinHash bên dưới.

    // Tài khoản "admin" mặc định (xem defaults.js) LUÔN có toàn quyền và KHÔNG bị sửa quyền bởi bất kỳ
    // ai — kể cả từ form phân quyền hay gán vào nhóm phân quyền — đảm bảo hệ thống luôn còn đúng 1 tài
    // khoản toàn quyền không thể bị khoá/gỡ quyền nhầm, tránh tình huống không còn ai đủ quyền tự sửa
    // lại. Ép ở ĐÂY (điểm ghi CSDL duy nhất cho collection "users") thay vì chỉ ở client để không phụ
    // thuộc việc giao diện có khoá đúng hay không.
    if (record.username === 'admin') {
      record.perms = { admin: true };
    }

    if (u.pin) {
      const pinError = validatePin(u.pin);
      if (pinError) throw new HttpError(400, `Mã PIN của tài khoản "${u.username}": ${pinError}`);
      record.pinHash = await hashPassword(u.pin);
    }

    if (!u.pass) {
      return { ...record, pass: prior ? prior.pass : undefined };
    }
    if (isBcryptHash(u.pass)) return record; // đã hash sẵn (không phải trường hợp bình thường, nhưng an toàn)

    const passwordError = validatePasswordStrength(u.pass);
    if (passwordError) {
      throw new HttpError(400, `Mật khẩu của tài khoản "${u.username}": ${passwordError}`);
    }
    return { ...record, pass: await hashPassword(u.pass), mustChangePassword: true };
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
    // tasks (Bước 6b) và mọi collection trong MIGRATED_COLLECTIONS (Bước 6c trở đi — hiện tại:
    // submissions) không còn trong dbo.AppData — nguồn riêng từ bảng của chúng. Không có
    // _versions.<key> tương ứng cho các key này (không còn khái niệm "version" AppData) — an toàn vì
    // client không còn ghi các collection này qua đường chung nữa (tasks đi qua routes/records.js, các
    // collection trong MIGRATED_COLLECTIONS đi qua routes/create.js + routes/workflow.js). systemLogs
    // KHÔNG còn trả kèm ở đây nữa (trước đây lộ cho MỌI người đăng nhập dù chỉ admin xem được trên
    // giao diện) — đọc riêng qua GET /api/log (routes/systemLog.js, chỉ admin) khi mở tab Nhật ký.
    // Đọc SONG SONG (Promise.all) thay vì tuần tự từng collection một — trước đây vòng lặp for..await
    // khiến GET /api/data phải đợi ĐỦ 13 lượt round-trip DB (mỗi collection trong MIGRATED_COLLECTIONS)
    // nối tiếp nhau, cộng dồn độ trễ mạng/DB của từng lượt (đây là nguyên nhân chính khiến lần tải dữ
    // liệu đầu tiên sau khi đăng nhập mất nhiều giây) — các collection này độc lập nhau, pool kết nối
    // (db.js, mặc định 20) thừa sức phục vụ song song, không có lý do gì phải chờ tuần tự.
    const migratedList = [...MIGRATED_COLLECTIONS];
    const [tasksResult, ...collectionResults] = await Promise.all([
      getAllTasks(),
      ...migratedList.map(collection => getAllForCollection(collection))
    ]);
    data.tasks = tasksResult;
    migratedList.forEach((collection, i) => { data[collection] = collectionResults[i]; });

    // Lọc lại quyền XEM phía server cho các collection trước đây chỉ ẩn ở giao diện (xem
    // lib/recordViewScope.js) — ai gọi thẳng GET /api/data cũng không còn đọc được hồ sơ ngoài phạm vi
    // phòng ban/quyền xem của mình nữa.
    if (data.docs) data.docs = await filterDocsForUser(data.docs, req.freshUser);
    if (data.submissions) data.submissions = await filterSubmissionsForUser(data.submissions, req.freshUser);
    if (data.internalPosts) data.internalPosts = filterInternalPostsForUser(data.internalPosts, req.freshUser);
    if (data.reportPeriods) data.reportPeriods = sanitizeReportPeriodsForUser(data.reportPeriods, req.freshUser);

    data._versions = versions;
    res.json(data);
  } catch (err) {
    sendServerError(res, 500, err, 'GET /api/data', 'Không thể tải dữ liệu từ SQL Server');
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
    sendServerError(res, 500, err, `GET /api/data/${key}`, 'Không thể tải dữ liệu từ SQL Server');
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
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, `POST /api/data/${key}`, 'Không thể lưu dữ liệu vào SQL Server');
  }
});

module.exports = router;
