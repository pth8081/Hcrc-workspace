// server.js — Điểm khởi chạy chính của ứng dụng VPDT (Văn Phòng Điện Tử)
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { version: APP_VERSION } = require('./package.json');
const { getPool } = require('./db');
const { seedDefaults } = require('./seedDefaults');
const { requireAuth } = require('./lib/auth');
const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');
const workflowRoutes = require('./routes/workflow');
const createRoutes = require('./routes/create');
const meetingActionsRoutes = require('./routes/meetingActions');
const recordsRoutes = require('./routes/records');
const systemLogRoutes = require('./routes/systemLog');
const uploadRoutes = require('./routes/upload');
const emailRoutes = require('./routes/email');
const { checkContractExpiryReminders } = require('./jobs/contractExpiryReminder');

const app = express();
const PORT = process.env.PORT || 3000;

// Tài liệu/hồ sơ không còn nhúng base64 trong JSON — file đính kèm được tải lên qua
// POST /api/upload và lưu ra ổ đĩa (thư mục uploads/), collection JSON chỉ giữ fileUrl.
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

// API — /api/auth (đăng nhập/đăng xuất) đứng ngoài yêu cầu đăng nhập vì đó CHÍNH LÀ chỗ đăng nhập;
// mọi API còn lại bắt buộc có phiên hợp lệ (requireAuth) — trước đây hoàn toàn không có bước này.
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/create', createRoutes);
app.use('/api/meetings', meetingActionsRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/log', systemLogRoutes);
app.use('/api/upload', requireAuth, uploadRoutes);
app.use('/api/send-email', requireAuth, emailRoutes);

// Phục vụ file đính kèm đã tải lên
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
    res.status(500).json({ status: 'error', db: 'disconnected', detail: err.message, version: APP_VERSION });
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
