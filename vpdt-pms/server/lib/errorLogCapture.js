// lib/errorLogCapture.js — Nhật Ký Lỗi Hệ Thống (10/2026): bọc console.error()/console.warn() TOÀN
// CỤC + bắt uncaughtException/unhandledRejection, ghi thêm mỗi lời gọi vào dbo.ErrorLogs (xem
// lib/errorLogStore.js). Yêu cầu người dùng: "lấy tất cả các log lỗi của hệ thống đưa lên đây để tôi có
// thể điều tra được ngay cả khi không dùng đến pm2 log" — trước đây 175+ lời gọi console.error() rải
// rác khắp lib/routes/ CHỈ đổ ra stdout/stderr (chỉ xem được qua `pm2 logs`). Bọc 1 LẦN DUY NHẤT ở đây
// (gọi installErrorLogCapture() sớm nhất có thể trong server.js) thay vì sửa từng chỗ gọi.
//
// Tách riêng khỏi server.js (thay vì viết thẳng ở đó) để TEST ĐƯỢC bằng unit test thường (server.js gọi
// start() không điều kiện ở cuối file, tự kết nối SQL Server thật + app.listen() — không thể require()
// trực tiếp trong môi trường test không có DB thật). Nhận `exit` qua tham số (mặc định process.exit) để
// test tự thay bằng hàm giả, tránh unit test thật sự làm tiến trình thoát.
function installErrorLogCapture({ exit = (code) => process.exit(code) } = {}) {
  const originalConsoleError = console.error.bind(console);
  const originalConsoleWarn = console.warn.bind(console);

  // captureErrorLog() PHẢI không bao giờ ném lỗi ra ngoài và PHẢI chỉ dùng originalConsoleError (KHÔNG
  // BAO GIỜ gọi console.error đã bị bọc bên dưới) khi cần tự báo lỗi của CHÍNH NÓ (VD không kết nối được
  // CSDL) — nếu không sẽ ĐỆ QUY VÔ HẠN đúng lúc CSDL đang là nguyên nhân gây lỗi.
  function captureErrorLog(level, args) {
    try {
      // require() ĐẶT TRONG HÀM (không require ở top-level của module này) — lib/errorLogStore.js
      // require('../db') -> require('mssql'), muốn chắc chắn dotenv đã load xong trước khi bất kỳ module
      // nào đọc biến môi trường kết nối DB; installErrorLogCapture() được gọi RẤT SỚM trong server.js
      // (ngay sau require('dotenv').config()), trước khi các module khác kịp require('./db').
      const { insertErrorLog } = require('./errorLogStore');
      const errObj = args.find(a => a instanceof Error);
      const message = args
        .map(a => a instanceof Error ? a.message : (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ')
        .slice(0, 4000);
      // Giới hạn cứng 3s — uncaughtException/unhandledRejection (bên dưới) cần thoát tiến trình NHANH để
      // pm2 restart kịp thời, không được để việc ghi log (có thể treo nếu chính CSDL đang là nguyên nhân
      // gây lỗi/mất kết nối) kéo dài thời gian downtime.
      return Promise.race([
        insertErrorLog({ level, message, stack: errObj ? errObj.stack : null, source: null }),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]).catch(() => {});
    } catch (e) {
      return Promise.resolve();
    }
  }

  console.error = (...args) => {
    originalConsoleError(...args);
    captureErrorLog('ERROR', args);
  };
  console.warn = (...args) => {
    originalConsoleWarn(...args);
    captureErrorLog('WARNING', args);
  };

  // Lỗi hoàn toàn không lường trước — hiếm nhưng nghiêm trọng nhất. Vẫn THOÁT TIẾN TRÌNH sau khi ghi log
  // (giữ nguyên hành vi crash-restart mặc định của Node/pm2 hiện tại — KHÔNG cố "sống tiếp" với state có
  // thể đã hỏng, xác nhận với người dùng khi thiết kế tính năng này).
  process.on('uncaughtException', (err) => {
    originalConsoleError('⛔ uncaughtException (chưa từng lường trước) — tiến trình sẽ thoát, pm2 tự khởi động lại:', err);
    captureErrorLog('ERROR', [err]).finally(() => exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    originalConsoleError('⛔ unhandledRejection (Promise bị reject không ai .catch()) — tiến trình sẽ thoát, pm2 tự khởi động lại:', err);
    captureErrorLog('ERROR', [err]).finally(() => exit(1));
  });

  // Trả lại cho caller (server.js dùng thực tế; test dùng để gọi trực tiếp captureErrorLog()/kiểm tra
  // console.error đã bị thay thế đúng chưa mà không cần gọi qua console.error() thật).
  return { originalConsoleError, originalConsoleWarn, captureErrorLog };
}

module.exports = { installErrorLogCapture };
