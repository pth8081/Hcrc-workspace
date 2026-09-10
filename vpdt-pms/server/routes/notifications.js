// routes/notifications.js — Thông báo trong app (chuông ở header) — xem lib/notifications.js cho lý do
// generic, không riêng cho module nào.
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { getAllForCollection, withLockedRecordForCollection } = require('../lib/recordStore');
const { filterNotificationsForUser } = require('../lib/notifications');

router.use(requireAuth, blockIfMustChangePassword);

router.get('/', async (req, res) => {
  try {
    const all = await getAllForCollection('notifications');
    const mine = filterNotificationsForUser(all, req.freshUser).slice(0, 100);
    res.json({ notifications: mine, unreadCount: mine.filter(n => !n.isRead).length });
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
router.post('/mark-all-read', async (req, res) => {
  try {
    const all = await getAllForCollection('notifications');
    const mine = all.filter(n => n.username === req.freshUser.username && !n.isRead);
    for (const n of mine) {
      await withLockedRecordForCollection('notifications', n.id, (item) => { item.isRead = true; return item; });
    }
    res.json({ ok: true, count: mine.length });
  } catch (err) { sendCatchError(res, err, 'POST /api/notifications/mark-all-read'); }
});

module.exports = router;
