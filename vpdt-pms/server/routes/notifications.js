// routes/notifications.js — Thông báo trong app (chuông ở header) — xem lib/notifications.js cho lý do
// generic, không riêng cho module nào.
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { withLockedRecordForCollection, queryDedicatedRecords } = require('../lib/recordStore');
const { filterNotificationsForUser } = require('../lib/notifications');

router.use(requireAuth, blockIfMustChangePassword);

// Bước 8a — trước đây getAllForCollection('notifications') quét NGUYÊN bảng (mọi người dùng) mỗi lần
// chuông header gọi (tăng trưởng nhanh nhất hệ thống, tự sinh liên tục qua notifyUsers()) rồi mới lọc
// "của tôi" ở Node — nặng dần theo tổng số thông báo TOÀN HỆ THỐNG dù 1 người chỉ xem tối đa 100 cái gần
// nhất. Giờ lọc where.Username NGAY Ở SQL (queryDedicatedRecords(), Bước 7d) — vẫn áp lại ĐÚNG
// filterNotificationsForUser() thật (canViewNotification: username khớp) làm lớp chắn quyền xem thứ 2,
// không tin riêng SQL where — khớp nguyên tắc "SQL chỉ thu hẹp, filter*ForUser() mới là chốt quyền xem
// thật" đã áp dụng xuyên suốt Bước 7/8.
//
// unreadCount SỬA THÊM 1 lỗi có sẵn: trước đây tính trên ĐÚNG 100 bản ghi mới nhất đã cắt (`mine.filter`)
// — người có >100 thông báo chưa đọc sẽ luôn thấy số hiển thị ở chuông header BỊ THIẾU (tối đa 100 dù
// thực tế nhiều hơn). Giờ đếm THẬT bằng 1 truy vấn where.IsRead=false riêng (COUNT thật ở SQL qua
// pageSize:1 + đọc field `total`, không cần tải dữ liệu để đếm).
router.get('/', async (req, res) => {
  try {
    const { items: rawMine } = await queryDedicatedRecords('notifications', {
      where: { Username: req.freshUser.username },
      page: 1, pageSize: 100
    });
    const mine = filterNotificationsForUser(rawMine, req.freshUser);
    const { total: unreadCount } = await queryDedicatedRecords('notifications', {
      where: { Username: req.freshUser.username, IsRead: false },
      page: 1, pageSize: 1
    });
    res.json({ notifications: mine, unreadCount });
  } catch (err) { sendCatchError(res, err, 'GET /api/notifications'); }
});

router.patch('/:id/read', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const result = await withLockedRecordForCollection('notifications', itemId, (item) => {
      if (item.username !== req.freshUser.username) throw new HttpError(403, 'Bạn không có quyền với thông báo này');
      item.isRead = true;
      return item;
    });
    res.json({ ok: true, item: result });
  } catch (err) { sendCatchError(res, err, `PATCH /api/notifications/${req.params.id}/read`); }
});

// Đánh dấu TOÀN BỘ đã đọc — tiện cho nút "Đánh dấu tất cả đã đọc" ở dropdown chuông, tránh N request.
// Cùng lý do Bước 8a ở trên: chỉ lấy về đúng thông báo CHƯA ĐỌC CỦA NGƯỜI GỌI (where.Username +
// where.IsRead=false ở SQL) thay vì quét toàn bảng rồi mới lọc — tập cần khoá/ghi từng dòng phía dưới
// không đổi (vẫn từng dòng qua withLockedRecordForCollection, chỉ đổi cách LẤY DANH SÁCH ban đầu).
router.post('/mark-all-read', async (req, res) => {
  try {
    const { items: rawUnread } = await queryDedicatedRecords('notifications', {
      where: { Username: req.freshUser.username, IsRead: false }
    });
    const mine = filterNotificationsForUser(rawUnread, req.freshUser);
    for (const n of mine) {
      await withLockedRecordForCollection('notifications', n.id, (item) => { item.isRead = true; return item; });
    }
    res.json({ ok: true, count: mine.length });
  } catch (err) { sendCatchError(res, err, 'POST /api/notifications/mark-all-read'); }
});

module.exports = router;
