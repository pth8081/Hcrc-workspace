// routes/pwaManifest.js — sinh manifest.json ĐỘNG (không phải file tĩnh) cho tính năng "Cài đặt ứng
// dụng" (PWA) — lý do phải động: mục "shortcuts" (phím tắt hiện ra khi nhấn giữ icon app trên màn hình
// chính, chỉ Android/Chrome hỗ trợ, Safari iOS bỏ qua hoàn toàn) đọc trực tiếp từ cấu hình admin chọn ở
// "Hệ Thống → Quản Trị" (DB.pwaShortcutModules, xem defaults.js) — file tĩnh không thể phản ánh thay đổi
// đó mà không cần build lại/deploy lại.
//
// KHÔNG yêu cầu đăng nhập — cùng khuôn GET /api/health, GET /api/captcha (server.js): trình duyệt tải
// manifest.json để xét điều kiện "có cài đặt được không" ngay khi mở trang, TRƯỚC/không nhất thiết kèm
// đúng lúc đã có phiên đăng nhập, và nội dung trả về (tên module, không phải dữ liệu nghiệp vụ) không có
// gì nhạy cảm.
const express = require('express');
const router = express.Router();
const { getAppDataValueCached } = require('../lib/appData');

// Danh mục ĐẦY ĐỦ các module có thể chọn làm phím tắt — key PHẢI khớp đúng tên tab dùng ở switchTab()
// (index.html). Đây là bản sao thủ công của danh sách tương ứng ở PWA_SHORTCUT_CATALOG trong
// index.html (admin panel dùng để vẽ checkbox) — 2 nơi phải sửa cùng lúc nếu thêm/bớt module nào, không
// import chung được vì server.js/index.html không dùng chung module JS.
const PWA_SHORTCUT_CATALOG = {
  approvalHub: 'Phê Duyệt',
  doc: 'Tài Liệu',
  submission: 'Văn Bản Trình',
  task: 'Công Việc',
  contract: 'Hợp Đồng',
  minutes: 'Biên Bản Họp',
  internal: 'Truyền Thông',
  meeting: 'Phòng Họp',
  car: 'Đăng Ký Xe',
  vpp: 'Văn Phòng Phẩm',
  uniform: 'Đồng Phục',
  office: 'Tổng Hợp',
  budget: 'Ngân Sách',
  itSupport: 'Hỗ Trợ IT',
  periodicReport: 'Báo Cáo Định Kỳ',
  reports: 'Báo Cáo'
};

// Nhấn giữ icon app chỉ hoạt động thực tế trên Android — hầu hết launcher chỉ hiện tối đa 4 phím tắt dù
// khai nhiều hơn, nên chặn NGAY tại đây cho khớp UI admin panel (ô chọn cũng chặn tối đa 4 — xem
// index.html), tránh khai dư vô ích nếu admin lỡ ghi thẳng qua API.
const MAX_SHORTCUTS = 4;

router.get('/manifest.json', async (req, res) => {
  let shortcutModules = [];
  try {
    shortcutModules = (await getAppDataValueCached('pwaShortcutModules')) || [];
  } catch (e) {
    console.warn('Không đọc được cấu hình pwaShortcutModules, bỏ qua shortcuts:', e.message);
  }

  const shortcuts = shortcutModules
    .filter(key => PWA_SHORTCUT_CATALOG[key])
    .slice(0, MAX_SHORTCUTS)
    .map(key => ({
      name: PWA_SHORTCUT_CATALOG[key],
      short_name: PWA_SHORTCUT_CATALOG[key],
      url: `/?shortcut=${encodeURIComponent(key)}`
    }));

  res.setHeader('Content-Type', 'application/manifest+json');
  res.json({
    name: 'HCRC Workspace',
    short_name: 'HCRC WS',
    description: 'Không gian làm việc số HCRC',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0b1f4d',
    theme_color: '#0b1f4d',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts
  });
});

module.exports = router;
