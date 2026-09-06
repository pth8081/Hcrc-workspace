// ecosystem.config.js — cấu hình PM2 chạy server.js ở CLUSTER MODE (nhiều tiến trình Node, tận dụng
// hết số nhân CPU của máy chủ) thay vì 1 tiến trình đơn (fork mode) như mặc định trước đây. Xem
// HUONG_DAN_DEPLOY_UBUNTU.md mục 9a để biết khi nào nên dùng file này thay vì lệnh `pm2 start
// server.js` trực tiếp — cần trước hết đã public ứng dụng cho nhiều người dùng đồng thời (vài trăm
// người trở lên); ứng dụng nội bộ ít người dùng thì fork mode đơn giản vẫn đủ dùng.
//
// Node là đơn luồng cho JS — 1 tiến trình chỉ dùng được 1 nhân CPU. `instances: 'max'` để PM2 tự chạy
// đúng bằng số nhân CPU thật của máy (đổi thành số cụ thể, vd. 2, nếu muốn chừa lại CPU cho việc
// khác). Ứng dụng đã stateless giữa các request (xác thực qua JWT + tra DB, không giữ session trong
// bộ nhớ tiến trình) nên chạy nhiều tiến trình cùng lúc an toàn — KHÔNG cần sticky session ở Nginx.
//
// Job định kỳ (nhắc hết hạn hợp đồng, giám sát ổ đĩa... — server.js) đã tự nhận biết biến
// NODE_APP_INSTANCE (PM2 tự gán, KHÔNG phải tự đặt tay) để chỉ chạy ở ĐÚNG 1 tiến trình (instance 0)
// khi ở cluster mode — không cần cấu hình thêm gì ở đây cho việc đó.
//
// Chạy dưới tài khoản hệ thống riêng (không phải root) + PM2 do systemd quản lý: xem
// HUONG_DAN_DEPLOY_UBUNTU.md mục 9a-9b — không cần sửa gì ở file này cho việc đó, mọi đường dẫn ở đây
// (script, log PM2...) đều tương đối/tự suy ra theo user đang chạy `pm2 start`, không giả định user cụ
// thể nào.
//
// Sử dụng: pm2 start ecosystem.config.js --env production
module.exports = {
  apps: [
    {
      name: 'vpdt',
      script: 'server.js',
      exec_mode: 'cluster',
      instances: 'max',
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
