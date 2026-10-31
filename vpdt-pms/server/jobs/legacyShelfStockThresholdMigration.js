// jobs/legacyShelfStockThresholdMigration.js — Di trú dữ liệu shelfStockThresholds CŨ (trước đợt THIẾT
// KẾ LẠI 11/2026 — xem khối shelfStockThresholds ở lib/createValidation.js) sang model MỚI. CHẠY Ở
// SERVER lúc khởi động (mirror ĐÚNG khuôn jobs/legacyViewScopeMigration.js — peek-before-write để không
// bump UpdatedAt vô ích ở MỌI lần khởi động khi không còn gì để sửa, idempotent tự nhiên).
//
// Quy tắc di trú (đã xác nhận với người dùng — KHÔNG được âm thầm xoá dữ liệu, bất kỳ email cũ nào
// không khớp được tài khoản thật phải được GIỮ LẠI để admin tự xem/xử lý):
//   - scope === 'SKU'      -> maHang = scopeValue (đã xác nhận: SKU cũ đang lưu đúng mã nội bộ 10 số)
//   - scope === 'CATEGORY' -> category = scopeValue
//   - recipientEmails[]    -> mỗi email khớp ĐÚNG email (không phân biệt hoa/thường) của 1 user ACTIVE
//                             -> thêm username đó vào extraRecipientUsernames (dedup); không khớp được ai
//                             -> giữ nguyên trong field MỚI "unmigratedExternalEmails" (KHÔNG xoá).
// Sau khi di trú, field cũ (scope/scopeValue/recipientEmails) bị xoá khỏi bản ghi — nhận diện "cần di
// trú" dựa vào SỰ TỒN TẠI của field `scope` (field này không còn được ghi bởi model mới, nên còn sót lại
// chắc chắn là dữ liệu cũ chưa di trú — idempotent tự nhiên, không cần cờ migratedAt riêng).
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { insertSystemLog } = require('../lib/systemLogStore');

function migrateOneThreshold(item, usersByEmailLower) {
  if (!item || item.scope === undefined) return { item, changed: false }; // đã di trú hoặc chưa từng có scope -> bỏ qua

  const next = { ...item };
  if (item.scope === 'SKU') next.maHang = String(item.scopeValue || '').trim().slice(0, 20);
  else if (item.scope === 'CATEGORY') next.category = String(item.scopeValue || '').trim().slice(0, 100);
  if (next.maVach === undefined) next.maVach = '';

  const oldEmails = Array.isArray(item.recipientEmails) ? item.recipientEmails : [];
  const extraRecipientUsernames = new Set(Array.isArray(item.extraRecipientUsernames) ? item.extraRecipientUsernames : []);
  const unmigratedExternalEmails = [];
  for (const raw of oldEmails) {
    const email = String(raw || '').trim();
    if (!email) continue;
    const matchedUser = usersByEmailLower.get(email.toLowerCase());
    if (matchedUser) extraRecipientUsernames.add(matchedUser.username);
    else unmigratedExternalEmails.push(email);
  }
  next.extraRecipientUsernames = [...extraRecipientUsernames];
  if (unmigratedExternalEmails.length) next.unmigratedExternalEmails = unmigratedExternalEmails;

  delete next.scope;
  delete next.scopeValue;
  delete next.recipientEmails;
  return { item: next, changed: true, unmigratedCount: unmigratedExternalEmails.length };
}

async function migrateLegacyShelfStockThresholds() {
  try {
    const users = await getAppDataValue('users');
    const usersByEmailLower = new Map();
    (Array.isArray(users) ? users : []).forEach(u => {
      if (u && u.email && u.active !== false) usersByEmailLower.set(String(u.email).trim().toLowerCase(), u);
    });

    // Đọc trước KHÔNG khoá, chỉ để biết có THẬT SỰ cần ghi hay không, TRƯỚC khi vào
    // withLockedAppDataValue() — cùng lý do đã áp dụng ở jobs/legacyViewScopeMigration.js (tránh bump
    // UpdatedAt vô ích, có thể làm cửa hàng trưởng đang sửa Ngưỡng Tồn ở tab khác gặp conflict 409).
    const peekList = await getAppDataValue('shelfStockThresholds');
    if (!Array.isArray(peekList) || !peekList.length) return;
    const anyLegacy = peekList.some(it => it && it.scope !== undefined);
    if (!anyLegacy) return;

    let migratedCount = 0;
    let totalUnmigratedEmails = 0;
    await withLockedAppDataValue('shelfStockThresholds', (current) => {
      const list = Array.isArray(current) ? current : [];
      return list.map(item => {
        const { item: next, changed, unmigratedCount } = migrateOneThreshold(item, usersByEmailLower);
        if (changed) {
          migratedCount++;
          totalUnmigratedEmails += (unmigratedCount || 0);
        }
        return next;
      });
    });

    console.log(`✅ [Di trú Ngưỡng Tồn] Đã di trú ${migratedCount} bản ghi shelfStockThresholds sang model mới (maHang/maVach/category + extraRecipientUsernames).${totalUnmigratedEmails ? ` ${totalUnmigratedEmails} email cũ không khớp tài khoản nào — đã giữ lại ở field "unmigratedExternalEmails" để admin tự xem/xử lý.` : ''}`);
    if (migratedCount) {
      await insertSystemLog({
        username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Startup Migration)',
        module: 'SHELF_STOCK_THRESHOLD', actionType: 'MIGRATE', targetObject: 'shelfStockThresholds',
        description: `Di trú ${migratedCount} ngưỡng tồn sang model mới (tách Mã Hàng/Mã Vạch/Ngành Hàng + Tầng 4 người nhận theo tài khoản).${totalUnmigratedEmails ? ` ${totalUnmigratedEmails} email cũ không khớp tài khoản nào, giữ lại ở "unmigratedExternalEmails" — admin xem lại ở màn Ngưỡng Tồn.` : ''}`,
        status: 'SUCCESS'
      });
    }
  } catch (err) {
    console.error('⛔ [Di trú Ngưỡng Tồn] Lỗi khi di trú shelfStockThresholds:', err.message);
  }
}

module.exports = { migrateLegacyShelfStockThresholds, migrateOneThreshold };
