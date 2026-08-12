// server.js — Điểm khởi chạy chính của ứng dụng VPDT (Văn Phòng Điện Tử)
require('dotenv').config();
const express = require('express');
const path = require('path');
const { getPool } = require('./db');
const { seedDefaults } = require('./seedDefaults');
const dataRoutes = require('./routes/data');

const app = express();
const PORT = process.env.PORT || 3000;

// Tăng giới hạn body vì tài liệu/hợp đồng được lưu dạng base64 (Data URL) ngay trong JSON,
// giữ đúng hành vi gốc của ứng dụng (fileData nhúng trực tiếp trong object, không tách file riêng).
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// API
app.use('/api/data', dataRoutes);

// Health check (dùng cho giám sát / load balancer / kiểm tra nhanh sau khi deploy)
app.get('/api/health', async (req, res) => {
  try {
    await getPool();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', detail: err.message });
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
  } catch (err) {
    console.error('⛔ Không thể khởi động server:', err.message);
    process.exit(1);
  }
}

start();
