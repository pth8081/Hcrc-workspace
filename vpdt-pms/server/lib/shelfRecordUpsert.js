// lib/shelfRecordUpsert.js — "Ghi Nhận Theo Lô" (Kiểm Soát Hàng Hóa, 11/2026, theo yêu cầu người dùng
// sau khi dùng thử bản ghi-nhận-cộng-dồn cũ: "scan lại nếu bán hết phải tự điều chỉnh về đúng số thực
// tế, không phải cộng dồn mãi"). TÁCH RIÊNG khỏi lib/createValidation.js/routes/create.js — route generic
// POST /api/create/shelfRecords (và toàn bộ hàng đợi đồng bộ offline dựa trên clientRecordId dedupe, xem
// trySyncPendingShelfRecords() ở module-vanhanh.js) GIỮ NGUYÊN 100% hành vi CŨ (luôn CHÈN bản ghi mới,
// không bao giờ cập nhật) — đổi route đó sang "có thể vừa chèn vừa sửa" sẽ phá vỡ giả định offline-sync
// 1-payload-offline = 1-bản-ghi-mới mà cơ chế clientRecordId dedupe đang dựa vào. Route MỚI
// (POST /api/shelf-stock/records/upsert, routes/shelfStock.js) chỉ dùng cho lượt Ghi Nhận THẬT SỰ ONLINE
// (không phải lượt đồng bộ lại hàng đợi offline) — xem submitShelfRecord() (module-vanhanh.js).
//
// "CÙNG LÔ" (ghi đè số lượng, không cộng dồn) = CÙNG dept + CÙNG shelfLocationId + CÙNG mã sản phẩm
// (khớp maHang HOẶC maVach — dung nạp đúng kiểu người ghi nhận chỉ gõ 1 trong 2, giống hệt cách
// jobs/shelfStockThresholdAlert.js::sumTodaySkuQuantity() đối chiếu) + CÙNG NGUYÊN VĂN expiryDate (kể cả
// cùng rỗng) + bản ghi đang CÒN ĐƯỢC THEO DÕI (quantity > 0). Một dòng đã "Ngừng theo dõi" (quantity=0,
// đã bán hết) KHÔNG được 1 lượt scan mới âm thầm "hồi sinh" — khớp thêm điều kiện quantity>0 vào đây là
// CỐ Ý, để nhập lô mới sau khi bán hết luôn tạo dòng MỚI tinh (lịch sử dòng cũ vẫn nguyên vẹn, tách bạch).
'use strict';
const { HttpError } = require('./httpErrors');

const MAX_CODE_LEN = 20; // khớp đúng maHang/maVach.slice(0,20) ở lib/createValidation.js shelfRecords

// Dùng chung bởi route /records/upsert — validate + chuẩn hoá field, KHÔNG đụng gì tới dept/id/createdAt/
// creator (route tự gán sau khi biết là chèn mới hay cập nhật bản ghi đã khoá).
function normalizeShelfRecordPayload(payload, user, appData) {
  const shelfLocationId = Number(payload?.shelfLocationId);
  const shelfLocation = (appData?.shelfLocations || []).find(s => s.id === shelfLocationId);
  if (!shelfLocation || shelfLocation.dept !== user.dept || shelfLocation.active === false) {
    throw new HttpError(400, 'Quầy kệ không hợp lệ hoặc không thuộc siêu thị của bạn');
  }
  const productName = String(payload?.productName || '').trim();
  if (!productName) throw new HttpError(400, 'Vui lòng nhập Tên Sản Phẩm');
  const quantity = Number(payload?.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new HttpError(400, 'Số lượng không hợp lệ (phải là số không âm)');
  }
  let expiryDate = '';
  if (payload?.expiryDate) {
    const d = new Date(payload.expiryDate);
    if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Hạn sử dụng không hợp lệ');
    expiryDate = d.toISOString();
  }
  return {
    shelfLocationId, shelfLocationCode: shelfLocation.code, shelfLocationName: shelfLocation.name,
    productName, quantity, expiryDate,
    note: String(payload?.note || '').trim(),
    maHang: String(payload?.maHang || '').trim().slice(0, MAX_CODE_LEN),
    maVach: String(payload?.maVach || '').trim().slice(0, MAX_CODE_LEN),
    customData: payload?.customData
  };
}

function findMatchingActiveShelfRecord(records, { dept, shelfLocationId, maHang, maVach, expiryDate }) {
  return (records || []).find(r => {
    if (!r || r.dept !== dept || r.shelfLocationId !== shelfLocationId) return false;
    if (!(Number(r.quantity) > 0)) return false; // dòng đã ngừng theo dõi -> KHÔNG khớp, xem chú thích đầu file
    const matchesCode = (maHang && r.maHang === maHang) || (maVach && r.maVach === maVach);
    if (!matchesCode) return false;
    return String(r.expiryDate || '') === String(expiryDate || '');
  }) || null;
}

function formatCreatedAt(date) {
  return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

module.exports = { normalizeShelfRecordPayload, findMatchingActiveShelfRecord, formatCreatedAt, MAX_CODE_LEN };
