// lib/notifications.js — Thông báo trong app (generic, dùng chung cho MỌI module cần báo 1 người dùng
// biết 1 việc gì đó xảy ra), xây LÚC LÀM Module Lương (Mục 8 tài liệu gốc: "công bố phiếu lương -> tạo
// thông báo trong app, thay hoàn toàn email") nhưng KHÔNG khoá cứng riêng cho Lương — `type`/`linkTo` là
// chuỗi tự do, module khác (hợp đồng sắp hết hạn, task quá hạn...) gọi notifyUsers() y hệt, không cần
// sửa file này. Collection MIGRATED_COLLECTIONS (dbo.Records) — cùng khuôn attendanceRecords (hệ thống
// tự sinh liên tục, tăng trưởng theo thời gian), KHÔNG có createValidation.js entry vì không phải "người
// dùng tự tạo" — chỉ server tự sinh qua notifyUsers().
'use strict';

const { insertRecord } = require('./recordStore');

function nowVN() {
  return new Date().toLocaleString('vi-VN');
}

function defaultNotification(username, type, title, message, linkTo, idOffset) {
  return {
    id: Date.now() + (idOffset || 0),
    username, type: String(type || '').slice(0, 40),
    title: String(title || '').slice(0, 200), message: String(message || '').slice(0, 500),
    linkTo: linkTo ? String(linkTo).slice(0, 200) : null,
    isRead: false, createdAt: nowVN()
  };
}

// Tạo hàng loạt thông báo GIỐNG NHAU cho nhiều người nhận (VD công bố kỳ lương -> mỗi nhân viên có
// payslip 1 thông báo) — idOffset tăng dần tránh đụng Id trong cùng 1 lượt gọi (insertRecord vẫn tự retry
// nếu đụng thật, xem lib/recordStore.js, đây chỉ giảm số lần phải retry).
async function notifyUsers(usernames, type, title, message, linkTo) {
  const uniq = [...new Set((usernames || []).filter(Boolean))];
  const created = [];
  for (let i = 0; i < uniq.length; i++) {
    const notification = defaultNotification(uniq[i], type, title, message, linkTo, i);
    created.push(await insertRecord('notifications', notification));
  }
  return created;
}

function canViewNotification(user, item) {
  return !!(user && item.username === user.username);
}
function filterNotificationsForUser(items, user) {
  return (items || []).filter(n => canViewNotification(user, n)).sort((a, b) => b.id - a.id);
}

module.exports = { defaultNotification, notifyUsers, canViewNotification, filterNotificationsForUser };
