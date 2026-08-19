// server.js — Điểm khởi chạy chính của ứng dụng VPDT (Văn Phòng Điện Tử)
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const securityHeaders = require('./lib/securityHeaders');
const { version: APP_VERSION } = require('./package.json');
const { getPool } = require('./db');
const { seedDefaults } = require('./seedDefaults');
const { requireAuth, blockIfMustChangePassword } = require('./lib/auth');
const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');
const workflowRoutes = require('./routes/workflow');
const createRoutes = require('./routes/create');
const meetingActionsRoutes = require('./routes/meetingActions');
const recordsRoutes = require('./routes/records');
const systemLogRoutes = require('./routes/systemLog');
const uploadRoutes = require('./routes/upload');
const emailRoutes = require('./routes/email');
const vppCatalogRoutes = require('./routes/vppCatalog');
const { checkContractExpiryReminders } = require('./jobs/contractExpiryReminder');

const app = express();
const PORT = process.env.PORT || 3000;

// 'trust proxy' — CHỈ bật khi server chạy SAU một reverse proxy thật (ví dụ Nginx theo hướng dẫn
// deploy, mục 8). Mặc định TẮT (không đặt biến môi trường) để tránh lỗ hổng giả mạo IP: rate-limit +
// khoá tài khoản khi đăng nhập sai nhiều lần (routes/auth.js) dựa vào req.ip — nếu bật 'trust proxy' khi
// server không thực sự đứng sau proxy, kẻ tấn công có thể tự đặt header X-Forwarded-For để giả IP khác
// nhau mỗi lần, né được giới hạn. Đặt TRUST_PROXY=1 trong .env nếu deploy đúng 1 lớp Nginx phía trước.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : parseInt(process.env.TRUST_PROXY, 10));
}

// CORS — whitelist tường minh qua ALLOWED_ORIGINS (.env, phân tách bằng dấu phẩy). Trước đây KHÔNG hề
// cấu hình gì (không phải "mở toang *" — Express không tự thêm header CORS nào nên trình duyệt áp
// same-origin mặc định — nhưng đó là an toàn NGẪU NHIÊN, không tường minh). Mặc định KHÔNG đặt biến
// này thì vẫn giữ nguyên hành vi cũ (chỉ same-origin, không có Origin nào được whitelist) — chỉ khi
// cần 1 frontend khác domain gọi tới (hiện chưa có) mới cần khai báo. KHÔNG BAO GIỜ dùng "*": ứng dụng
// xác thực bằng cookie (Allow-Credentials bắt buộc true), origin "*" + credentials bị chính trình
// duyệt từ chối, và nếu cho qua được thì tương đương vô hiệu hoá same-origin policy hoàn toàn.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Match');
    return res.sendStatus(204);
  }
  next();
});

app.use(securityHeaders);

// Tài liệu/hồ sơ không còn nhúng base64 trong JSON — file đính kèm được tải lên qua
// POST /api/upload và lưu ra ổ đĩa (thư mục uploads/), collection JSON chỉ giữ fileUrl.
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

// Rate limit TOÀN CỤC cho mọi /api/* — trước đây chỉ có /api/auth/login (routes/auth.js) được giới
// hạn, mọi API còn lại (đọc/ghi dữ liệu, tải file, gửi email...) không giới hạn tần suất, 1 tài khoản
// hợp lệ (dù quyền thấp) vẫn có thể gọi API dồn dập không giới hạn. Ngưỡng đủ rộng cho thao tác bình
// thường của 1 người dùng thật (SPA tải nhiều đợt dữ liệu khi chuyển tab/lọc/tìm kiếm) nhưng vẫn chặn
// được lạm dụng bằng script. Route nhạy cảm hơn (login, upload, gửi email) đã/sẽ có limiter RIÊNG chặt
// hơn nằm chồng lên (xem routes/auth.js, routes/upload.js, routes/email.js).
const globalApiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Bạn đang gửi quá nhiều yêu cầu, vui lòng thử lại sau ít phút.' }
});
app.use('/api', globalApiRateLimiter);

// API — /api/auth (đăng nhập/đăng xuất) đứng ngoài yêu cầu đăng nhập vì đó CHÍNH LÀ chỗ đăng nhập;
// mọi API còn lại bắt buộc có phiên hợp lệ (requireAuth) — trước đây hoàn toàn không có bước này.
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/create', createRoutes);
app.use('/api/meetings', meetingActionsRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/log', systemLogRoutes);
app.use('/api/upload', requireAuth, blockIfMustChangePassword, uploadRoutes);
app.use('/api/send-email', requireAuth, blockIfMustChangePassword, emailRoutes);
app.use('/api/vpp', vppCatalogRoutes);

// Phục vụ file đính kèm đã tải lên — PHẢI đăng nhập mới tải được (trước đây express.static phục vụ
// thẳng, ai có đúng URL — kể cả chưa đăng nhập — đều tải được, vô hiệu hoá các quyền Xem/Tải file theo
// module đã cấp). Chưa phân biệt được quyền theo TỪNG hồ sơ cụ thể (vd nhân viên phòng khác vẫn tải
// được nếu đoán/có sẵn đúng URL) — chỉ chặn được người hoàn toàn CHƯA đăng nhập; phân quyền chi tiết
// hơn theo hồ sơ sẽ cần thiết kế riêng (route tải có kiểm tra ngược lại hồ sơ chứa fileUrl đó).
app.use('/uploads', requireAuth, blockIfMustChangePassword, express.static(path.join(__dirname, 'uploads')));

// Phục vụ PDF.js (tự lưu trên server, không qua CDN) — dùng để vẽ PDF ra <canvas> ở Khung Xem Bảo Vệ
// thay vì plugin PDF gốc của trình duyệt (bị Chrome/Edge chặn khi nằm trong modal có lớp nền mờ, và
// không thể ẩn thanh công cụ In/Tải có sẵn của plugin). Lấy trực tiếp từ node_modules nên luôn khớp
// phiên bản đã cài qua npm, không cần bước copy thủ công.
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build')));

// Health check (dùng cho giám sát / load balancer / kiểm tra nhanh sau khi deploy). "version" luôn
// trả về ngay cả khi DB lỗi — dùng để xác nhận server đang chạy ĐÚNG bản code vừa deploy (so khớp với
// package.json trên máy), độc lập với tình trạng kết nối SQL Server.
app.get('/api/health', async (req, res) => {
  try {
    await getPool();
    res.json({ status: 'ok', db: 'connected', version: APP_VERSION });
  } catch (err) {
    console.error('⛔ GET /api/health: kết nối DB lỗi:', err.message);
    const isProd = process.env.NODE_ENV === 'production';
    res.status(500).json({
      status: 'error', db: 'disconnected', version: APP_VERSION,
      ...(isProd ? {} : { detail: err.message })
    });
  }
});

// Phục vụ frontend tĩnh (file index.html đã chuyển đổi sang gọi API thay vì localStorage)
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  try {
    console.log('⏳ Đang kết nối SQL Server...');
    await getPool();
    console.log('⏳ Đang kiểm tra / khởi tạo dữ liệu mặc định...');
    await seedDefaults();
    app.listen(PORT, () => {
      console.log(`✅ VPDT server đang chạy tại http://localhost:${PORT}`);
    });

    // Nhắc hết hạn hợp đồng: kiểm tra ngay lúc khởi động, sau đó lặp lại mỗi 24h.
    // Không phụ thuộc việc có ai mở trình duyệt hay không.
    checkContractExpiryReminders();
    setInterval(checkContractExpiryReminders, 24 * 60 * 60 * 1000);
  } catch (err) {
    console.error('⛔ Không thể khởi động server:', err.message);
    process.exit(1);
  }
}

start();
