// routes/dsmartWholesalePrice.js — Hỗ Trợ IT > "💰 Cài Đặt Giá Bán Buôn" (12/2026, theo yêu cầu người
// dùng, trao đổi đầy đủ trong phiên làm việc) — tính năng ĐẦU TIÊN của hệ thống GHI TRỰC TIẾP vào CSDL
// BÊN NGOÀI (DSmart16 Trung Tâm, bảng CSPRICE) thay vì chỉ gọi API/đồng bộ đọc như các tích hợp DSmart
// khác (lib/dsmartApiClient.js, jobs/inventorySync.js...).
//
// MÔ HÌNH DỮ LIỆU — ĐÃ SỬA LẦN 5 (12/2026, lỗi thật production: PK_CSPRICE xác nhận qua SSMS CHỈ gồm
// (CUST_ID, SKU_ID), KHÔNG phải "lịch sử giá nhiều dòng phân biệt bởi FR_DATE/TO_DATE" như hiểu nhầm trước
// đây — xem chú thích đầy đủ tại lib/dsmartSqlClient.js). Mỗi cặp (CUST_ID, SKU_ID) CHỈ CÓ ĐÚNG 1 DÒNG trên
// CSPRICE tại một thời điểm. "Thêm Giá Mới" cho 1 cặp CHƯA có dòng là INSERT; cho 1 cặp ĐÃ có dòng là GHI
// ĐÈ tự động (insertWholesalePrice() dùng khuôn upsert chuẩn — thử UPDATE TRƯỚC, 0 dòng khớp thì mới
// INSERT — KHÔNG còn dựa vào bắt lỗi trùng khoá chính nữa, xem lib/dsmartSqlClient.js) — xem xử lý
// "wasOverwrite" ở route POST /apply bên dưới (tự đánh dấu DELETED MỌI entry mirror ACTIVE cũ cho đúng cặp
// này nếu có, khoá theo withAppLock để tránh race giữa các request đồng thời, tránh 2 entry ACTIVE cùng trỏ
// 1 dòng CSPRICE thật). "Sửa" chỉ áp dụng cho dòng CHƯA xoá (UPDATE đúng
// dòng đó theo khoá CUST_ID+SKU_ID — CSPRICE KHÔNG có cột ID tự tăng, xem chú thích đầy đủ tại
// lib/dsmartSqlClient.js). "Xoá" (tay hoặc tự động theo giờ đặt) là DELETE THẬT khỏi CSPRICE, không hoàn
// tác được qua hệ thống này. "Dùng Lại" (từ 1 dòng đã xoá) là INSERT dòng MỚI — nếu lúc này đã có dòng khác
// (hiếm, ai đó tạo lại ngoài hệ thống) thì cũng tự ghi đè theo đúng cơ chế trên, không báo lỗi.
//
// PHẠM VI QUẢN LÝ (người dùng xác nhận rõ): CHỈ dữ liệu TỰ NỘP qua chính tính năng này (bảng mirror nội
// bộ dbo.DsmartWholesalePriceEntries) — KHÔNG quét/hiển thị dữ liệu có sẵn trong CSPRICE từ trước.
//
// QUYỀN: itSupportPriceWriteDsmart (hoặc admin) cho MỌI thao tác đọc/ghi dữ liệu giá; RIÊNG màn Cấu Hình
// Kết Nối (chứa thông tin hạ tầng + mật khẩu) CHỈ admin — cùng mức nhạy cảm inventoryApiConfig.
const express = require('express');
const multer = require('multer');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { hasModuleAccessServer } = require('../lib/recordViewScope');
const { getAllForCollection, createForCollection, withLockedRecordForCollection, withAppLock } = require('../lib/recordStore');
const { getSanitizedConfig, saveConfig, getAutoDeleteConfig, saveAutoDeleteConfig, getRawConfig, decryptSecret } = require('../lib/dsmartPriceConfigStore');
const { insertWholesalePrice, updateWholesalePrice, deleteWholesalePrice, testDsmartConnection, testSkuDefAccess, inspectCspriceColumns, custIdExistsInCsprice, testStoreConnection, closeStorePool, DsmartConfigError } = require('../lib/dsmartSqlClient');
const storeConnStore = require('../lib/dsmartStorePriceConnectionsStore');
const { parseWholesalePriceFile, buildWholesalePriceTemplateWorkbook } = require('../lib/dsmartWholesalePriceFileParser');
const { parseStoreConnectionFile, buildStoreConnectionTemplateWorkbook, buildStoreConnectionExportWorkbook } = require('../lib/dsmartStoreConnectionFileParser');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { insertSystemLog } = require('../lib/systemLogStore');
const uploadRateLimiter = require('../lib/uploadRateLimiter');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

function canManageDsmartPrice(user) {
  return !!(user?.perms?.admin || user?.perms?.itSupportPriceWriteDsmart);
}

router.use((req, res, next) => {
  if (!hasModuleAccessServer(req.freshUser, 'itSupport')) {
    return res.status(403).json({ error: 'Module Hỗ Trợ IT đã bị khoá cho tài khoản của bạn — liên hệ admin nếu cần dùng lại.' });
  }
  if (!canManageDsmartPrice(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền sử dụng "Cài Đặt Giá Bán Buôn" (DSmart16 Trung Tâm).' });
  }
  next();
});

function logDsmartPrice(req, actionType, targetObject, description) {
  insertSystemLog({
    username: req.freshUser.username, fullName: req.freshUser.name,
    ipAddress: req.ip, module: 'IT_SUPPORT', actionType, targetObject, description, status: 'SUCCESS'
  }).catch(err => console.error('Ghi log Cài Đặt Giá Bán Buôn lỗi:', err.message));
}

// ===================== Cấu Hình Kết Nối (CHỈ admin — chứa thông tin hạ tầng + mật khẩu) =====================
router.get('/config', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới xem được Cấu Hình Kết Nối' });
  try {
    res.json({ ok: true, config: await getSanitizedConfig() });
  } catch (err) { sendCatchError(res, err, 'GET /api/dsmart-price/config'); }
});

router.put('/config', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới sửa được Cấu Hình Kết Nối' });
  try {
    const { host, port, database, user, password, autoDeleteEnabled, autoDeleteHour, autoDeleteMinute } = req.body || {};
    if (!host || !database || !user) throw new HttpError(400, 'Thiếu Host/Tên CSDL/Tài khoản');
    const hour = Number(autoDeleteHour);
    const minute = Number(autoDeleteMinute);
    if (autoDeleteEnabled && (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59)) {
      throw new HttpError(400, 'Giờ/phút Tự Động Xoá không hợp lệ (giờ 0-23, phút 0-59)');
    }
    const saved = await saveConfig({
      host: String(host).trim(), port: Number(port) || 1433, database: String(database).trim(), user: String(user).trim(),
      password: password ? String(password) : null,
      autoDeleteEnabled: !!autoDeleteEnabled, autoDeleteHour: Number.isInteger(hour) ? hour : 23, autoDeleteMinute: Number.isInteger(minute) ? minute : 0
    }, req.freshUser.username);
    logDsmartPrice(req, 'UPDATE_DSMART_PRICE_CONFIG', 'dsmartPriceDbConfig', `Cập nhật Cấu Hình Kết Nối DSmart16 Trung Tâm (${saved.host})`);
    res.json({ ok: true, config: saved });
  } catch (err) { sendCatchError(res, err, 'PUT /api/dsmart-price/config'); }
});

// POST /config/test-connection — nút "🔌 Kiểm Tra Kết Nối" (12/2026, theo yêu cầu người dùng). Nhận
// ĐÚNG giá trị đang gõ dở trên form (CHƯA bấm Lưu) để admin kiểm tra TRƯỚC khi lưu, tránh lưu nhầm cấu
// hình sai rồi mới phát hiện lúc Thêm Giá Mới thật. Mật khẩu để trống -> dùng mật khẩu ĐÃ LƯU (cùng ngữ
// nghĩa "để trống = giữ nguyên mật khẩu cũ" như PUT /config) — nếu chưa từng lưu mật khẩu nào thì báo rõ
// lỗi, không đoán. Body rỗng hoàn toàn (không gửi gì) -> test đúng cấu hình ĐÃ LƯU hiện tại.
router.post('/config/test-connection', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới kiểm tra được kết nối' });
  try {
    const { host, port, database, user, password } = req.body || {};
    let overrideCfg = null;
    if (host || database || user) {
      if (!host || !database || !user) throw new HttpError(400, 'Thiếu Host/Tên CSDL/Tài khoản để kiểm tra kết nối');
      let pass = password ? String(password) : null;
      if (!pass) {
        const raw = await getRawConfig();
        if (!raw?.passwordEnc) throw new HttpError(400, 'Chưa có mật khẩu đã lưu trước đó — vui lòng nhập mật khẩu để kiểm tra.');
        pass = decryptSecret(raw.passwordEnc);
      }
      overrideCfg = { host: String(host).trim(), port: Number(port) || 1433, database: String(database).trim(), user: String(user).trim(), password: pass };
    }
    const result = await testDsmartConnection(overrideCfg);
    logDsmartPrice(req, 'TEST_DSMART_PRICE_CONNECTION', 'dsmartPriceDbConfig', `Kiểm tra kết nối DSmart16 Trung Tâm thành công (${result.ms}ms)${overrideCfg ? ' — dùng giá trị đang gõ dở' : ' — dùng cấu hình đã lưu'}`);
    res.json({ ok: true, ms: result.ms });
  } catch (err) { sendCatchError(res, err, 'POST /api/dsmart-price/config/test-connection'); }
});

// POST /config/inspect-table — nút "🔍 Kiểm Tra Cấu Trúc Bảng CSPRICE" (12/2026, LỖI THẬT PRODUCTION đã
// phát hiện qua 3 lần vá liên tiếp — xem chú thích đầy đủ ở đầu lib/dsmartSqlClient.js). Cùng khuôn
// overrideCfg như test-connection ở trên (admin xem được NGAY với giá trị đang gõ dở, không cần bấm Lưu trước) — CHỈ đọc metadata
// (INFORMATION_SCHEMA.COLUMNS + sys.identity_columns), không đụng dữ liệu thật trong CSPRICE.
router.post('/config/inspect-table', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới kiểm tra được cấu trúc bảng' });
  try {
    const { host, port, database, user, password } = req.body || {};
    let overrideCfg = null;
    if (host || database || user) {
      if (!host || !database || !user) throw new HttpError(400, 'Thiếu Host/Tên CSDL/Tài khoản để kiểm tra cấu trúc bảng');
      let pass = password ? String(password) : null;
      if (!pass) {
        const raw = await getRawConfig();
        if (!raw?.passwordEnc) throw new HttpError(400, 'Chưa có mật khẩu đã lưu trước đó — vui lòng nhập mật khẩu để kiểm tra.');
        pass = decryptSecret(raw.passwordEnc);
      }
      overrideCfg = { host: String(host).trim(), port: Number(port) || 1433, database: String(database).trim(), user: String(user).trim(), password: pass };
    }
    const result = await inspectCspriceColumns(overrideCfg);
    logDsmartPrice(req, 'INSPECT_DSMART_CSPRICE_TABLE', 'dsmartPriceDbConfig', `Kiểm tra cấu trúc bảng CSPRICE — ${result.columns.length} cột, cột ID tự tăng: ${result.identityColumn || '(không thấy)'}`);
    res.json({ ok: true, ...result });
  } catch (err) { sendCatchError(res, err, 'POST /api/dsmart-price/config/inspect-table'); }
});

// POST /config/test-skudef-access — nút "🔍 Kiểm Tra Quyền Đọc SKU_DEF" (12/2026, LỖI THẬT PRODUCTION LẦN
// 4: người dùng gửi nguyên văn mã nguồn phần mềm áp giá CŨ (BRG_APP.sql) cho thấy CSPRICE cần tra thêm
// Đơn Vị Tính/Hệ Số Quy Đổi/Mã Thuế từ bảng dbo.SKU_DEF theo Mã Sản Phẩm — xem lookupSkuDefUnitInfo()/
// lib/dsmartSqlClient.js). Bảng SKU_DEF CÙNG CSDL DSmart16 nhưng KHÁC CSPRICE, nên cần quyền SELECT RIÊNG
// — nút này để đội IT tự xác nhận quyền đã đủ TRƯỚC khi thử ghi giá thật, cùng khuôn overrideCfg như
// test-connection/inspect-table ở trên.
router.post('/config/test-skudef-access', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới kiểm tra được quyền đọc SKU_DEF' });
  try {
    const { host, port, database, user, password } = req.body || {};
    let overrideCfg = null;
    if (host || database || user) {
      if (!host || !database || !user) throw new HttpError(400, 'Thiếu Host/Tên CSDL/Tài khoản để kiểm tra quyền đọc SKU_DEF');
      let pass = password ? String(password) : null;
      if (!pass) {
        const raw = await getRawConfig();
        if (!raw?.passwordEnc) throw new HttpError(400, 'Chưa có mật khẩu đã lưu trước đó — vui lòng nhập mật khẩu để kiểm tra.');
        pass = decryptSecret(raw.passwordEnc);
      }
      overrideCfg = { host: String(host).trim(), port: Number(port) || 1433, database: String(database).trim(), user: String(user).trim(), password: pass };
    }
    const result = await testSkuDefAccess(overrideCfg);
    logDsmartPrice(req, 'TEST_DSMART_PRICE_SKUDEF_ACCESS', 'dsmartPriceDbConfig', `Kiểm tra quyền đọc SKU_DEF thành công (${result.ms}ms)${overrideCfg ? ' — dùng giá trị đang gõ dở' : ' — dùng cấu hình đã lưu'}`);
    res.json({ ok: true, ms: result.ms, sampleRow: result.sampleRow });
  } catch (err) { sendCatchError(res, err, 'POST /api/dsmart-price/config/test-skudef-access'); }
});

// ===================== Cấu Hình Kết Nối Siêu Thị (12/2026, FAN-OUT — theo yêu cầu người dùng "tôi muốn
// cài đặt giá đến tận máy chủ db của siêu thị... khi tôi thay đổi như xóa, sửa nó cũng truyền xuống tất
// cả các siêu thị") — CHỈ admin, cùng mức nhạy cảm Cấu Hình Kết Nối DSmart16 Trung Tâm ở trên (chứa host/
// mật khẩu hạ tầng của TỪNG siêu thị). =====================
router.get('/store-connections', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới xem được Cấu Hình Kết Nối Siêu Thị' });
  try {
    res.json({ ok: true, items: await storeConnStore.listSanitized() });
  } catch (err) { sendCatchError(res, err, 'GET /api/dsmart-price/store-connections'); }
});

// GET /store-connections/options (12/2026, theo yêu cầu người dùng: ô chọn "🏬 Áp Dụng Cho Siêu Thị" ở
// "1. Thêm Giá Mới"/"↩️ Dùng Lại" CẦN danh sách siêu thị đang Enabled=1 để chọn — KHÔNG gác riêng admin
// như GET /store-connections ở trên (chỉ cần itSupportPriceWriteDsmart/admin, đã gác sẵn ở router.use()
// đầu file) vì MỌI người được áp giá đều cần chọn được siêu thị áp dụng, không chỉ admin. Trả về RẤT ÍT
// trường (chỉ id/Mã/Tên — KHÔNG có host/user/port, vốn là thông tin hạ tầng chỉ admin mới cần biết) để
// không mở rộng phạm vi lộ thông tin kết nối ngoài ý "cấu hình admin siêu thị"/"cấu hình admin HO" mà
// người dùng xác nhận chỉ CHỨA sẵn ở màn Cấu Hình (admin), không phải lộ thêm field mới cho người không
// quản trị. Siêu thị CHƯA cấu hình (không có dòng nào) hoặc đang Tắt sẽ KHÔNG xuất hiện ở đây — đúng ý
// "siêu thị nào chưa được cấu hình thì coi như không hiện trong danh sách".
router.get('/store-connections/options', async (req, res) => {
  try {
    const items = (await storeConnStore.listRaw({ onlyEnabled: true }))
      .map(s => ({ id: s.id, storeCode: s.storeCode, storeName: s.storeName }));
    res.json({ ok: true, items });
  } catch (err) { sendCatchError(res, err, 'GET /api/dsmart-price/store-connections/options'); }
});

router.post('/store-connections', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới thêm được kết nối siêu thị' });
  try {
    const { storeCode, storeName, host, port, database, user, password } = req.body || {};
    const created = await storeConnStore.createStore({
      storeCode: String(storeCode || '').trim(), storeName: String(storeName || '').trim(),
      host: String(host || '').trim(), port: Number(port) || 1433, database: String(database || '').trim(),
      user: String(user || '').trim(), password: password ? String(password) : null
    }, req.freshUser.username);
    logDsmartPrice(req, 'CREATE_DSMART_STORE_CONNECTION', created.storeCode, `Thêm kết nối siêu thị "${created.storeName}" (${created.storeCode})`);
    res.json({ ok: true, item: created });
  } catch (err) { sendCatchError(res, err, 'POST /api/dsmart-price/store-connections'); }
});

router.put('/store-connections/:id', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới sửa được kết nối siêu thị' });
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { storeCode, storeName, host, port, database, user, password, enabled } = req.body || {};
    const updated = await storeConnStore.updateStore(id, {
      storeCode: String(storeCode || '').trim(), storeName: String(storeName || '').trim(),
      host: String(host || '').trim(), port: Number(port) || 1433, database: String(database || '').trim(),
      user: String(user || '').trim(), password: password ? String(password) : null, enabled: !!enabled
    }, req.freshUser.username);
    logDsmartPrice(req, 'UPDATE_DSMART_STORE_CONNECTION', updated.storeCode, `Sửa kết nối siêu thị "${updated.storeName}" (${updated.storeCode})${updated.enabled ? '' : ' — ĐÃ TẮT'}`);
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, 'PUT /api/dsmart-price/store-connections/:id'); }
});

router.delete('/store-connections/:id', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới xoá được kết nối siêu thị' });
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const existing = await storeConnStore.getRawById(id);
    await storeConnStore.deleteStore(id);
    // Đóng luôn pool kết nối đang cache (nếu có) theo đúng id này — audit chéo 12/2026 phát hiện xoá
    // kết nối trước đây không dọn storePoolCache, treo pool lơ lửng tới khi server restart.
    await closeStorePool(id);
    logDsmartPrice(req, 'DELETE_DSMART_STORE_CONNECTION', existing?.storeCode || String(id), `Xoá kết nối siêu thị "${existing?.storeName || ''}" (${existing?.storeCode || id})`);
    res.json({ ok: true });
  } catch (err) { sendCatchError(res, err, 'DELETE /api/dsmart-price/store-connections/:id'); }
});

// POST /store-connections/:id/test-connection — nút "🔌 Kiểm Tra Kết Nối" trên TỪNG dòng siêu thị. Nhận
// giá trị đang gõ dở (chưa Lưu) nếu client gửi kèm password mới; nếu để trống password thì test với mật
// khẩu ĐÃ LƯU của đúng kết nối đó (id).
router.post('/store-connections/:id/test-connection', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới kiểm tra được kết nối siêu thị' });
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const existing = await storeConnStore.getRawById(id);
    if (!existing) throw new HttpError(404, 'Không tìm thấy kết nối siêu thị này');
    const { host, port, database, user, password } = req.body || {};
    let pass = password ? String(password) : null;
    if (!pass) {
      if (!existing.passwordEnc) throw new HttpError(400, 'Chưa có mật khẩu đã lưu — vui lòng nhập mật khẩu để kiểm tra.');
      pass = storeConnStore.decryptSecret(existing.passwordEnc);
    }
    const result = await testStoreConnection({
      host: host ? String(host).trim() : existing.host, port: port ? Number(port) : existing.port,
      database: database ? String(database).trim() : existing.database, user: user ? String(user).trim() : existing.user,
      password: pass
    });
    logDsmartPrice(req, 'TEST_DSMART_STORE_CONNECTION', existing.storeCode, `Kiểm tra kết nối siêu thị "${existing.storeName}" (${existing.storeCode}) thành công (${result.ms}ms)`);
    res.json({ ok: true, ms: result.ms });
  } catch (err) { sendCatchError(res, err, 'POST /api/dsmart-price/store-connections/:id/test-connection'); }
});

// GET /connections/status (12/2026, theo yêu cầu người dùng: "theo dõi việc kết nối đến các máy siêu thị
// và máy HO... để tôi mở ra tôi xem trạng thái đang kết nối hoặc không kết nối") — kiểm tra kết nối THẬT
// tới DSmart16 Trung Tâm + TỪNG siêu thị đã cấu hình (song song, không giới hạn lô như fan-out ghi dữ
// liệu — đây chỉ là 1 câu SELECT 1 nhẹ/siêu thị, không phải thao tác ghi) NGAY khi được gọi — KHÔNG lưu
// cache, luôn kiểm tra MỚI mỗi lần mở màn này, đúng ý "mở ra xem trạng thái hiện tại". CHỈ admin — cùng
// mức nhạy cảm "🏬 Kết Nối Siêu Thị"/"⚙️ Cấu Hình Kết Nối" (hiện đủ Host/Tên CSDL của từng siêu thị, dù
// không lộ mật khẩu).
router.get('/connections/status', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới xem được trạng thái kết nối' });
  try {
    const hoPromise = (async () => {
      try {
        const result = await testDsmartConnection();
        return { ok: true, ms: result.ms, error: null };
      } catch (err) {
        return { ok: false, ms: null, error: err.message || 'Lỗi không xác định' };
      }
    })();

    // LỖI THẬT đã vá (12/2026, người dùng báo lỗi thật — log server cho thấy bảng
    // dbo.DsmartStorePriceConnections chưa tồn tại trên CSDL production, do chưa chạy schema.sql của đợt
    // tính năng Fan-Out): TRƯỚC ĐÂY lỗi đọc danh sách siêu thị (storeConnStore.listRaw()) làm SẬP LUÔN cả
    // phần HO — dù HO vẫn kết nối tốt, người dùng vẫn thấy TRỐNG TRƠN cả bảng (kể cả dòng HO) vì toàn bộ
    // route coi là 1 khối, lỗi 1 phần làm hỏng phần còn lại. Vá: tách riêng — lỗi đọc danh sách siêu thị
    // CHỈ làm rỗng mảng `stores` kèm `storesError` mô tả rõ, KHÔNG còn kéo theo cả HO.
    const storesPromise = (async () => {
      try {
        const stores = await storeConnStore.listRaw();
        const results = await Promise.all(stores.map(async (s) => {
          const base = { id: s.id, storeCode: s.storeCode, storeName: s.storeName, host: s.host, port: s.port, database: s.database };
          if (!s.enabled) return { ...base, disabled: true, ok: null, ms: null, error: null };
          if (!s.passwordEnc) return { ...base, disabled: false, ok: false, ms: null, error: 'Chưa có mật khẩu đã lưu' };
          try {
            const password = storeConnStore.decryptSecret(s.passwordEnc);
            const result = await testStoreConnection({ host: s.host, port: s.port, database: s.database, user: s.user, password });
            return { ...base, disabled: false, ok: true, ms: result.ms, error: null };
          } catch (err) {
            return { ...base, disabled: false, ok: false, ms: null, error: err.message || 'Lỗi không xác định' };
          }
        }));
        return { stores: results, storesError: null };
      } catch (err) {
        return { stores: [], storesError: err.message || 'Lỗi không xác định' };
      }
    })();

    const [ho, { stores, storesError }] = await Promise.all([hoPromise, storesPromise]);
    res.json({ ok: true, ho, stores, storesError, checkedAt: new Date().toISOString() });
  } catch (err) { sendCatchError(res, err, 'GET /api/dsmart-price/connections/status'); }
});

// ===================== Nhập hàng loạt kết nối siêu thị qua file Excel (12/2026, theo yêu cầu người
// dùng: "vì nó sẽ có rất nhiều siêu thị thì cho phép tôi có tải file mẫu và upload file mẫu được
// không") — CHỈ admin, cùng mức nhạy cảm mọi route /store-connections khác (chứa mật khẩu hạ tầng).
// RỦI RO ĐÃ NÊU RÕ VỚI NGƯỜI DÙNG, NGƯỜI DÙNG CHẤP NHẬN: cột Mật Khẩu trong file là CHỮ THƯỜNG — file
// KHÔNG được lưu lại trên server (chỉ đọc buffer trong request). ===================

router.get('/store-connections/template', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới tải được file mẫu kết nối siêu thị' });
  try {
    const wb = await buildStoreConnectionTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Ket_Noi_Sieu_Thi.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/dsmart-price/store-connections/template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// GET /store-connections/export (12/2026, theo yêu cầu người dùng: "xuất file Excel bằng đúng thông tin,
// đúng file nhập ấy") — xuất TOÀN BỘ kết nối siêu thị ĐANG CÓ, ĐÚNG khuôn 7 cột file nhập (kể cả Mật Khẩu
// đã GIẢI MÃ về chữ thường) để tự nhập lại được ngay qua "📂 Nhập Hàng Loạt" — dùng để backup/di chuyển
// cấu hình. CÙNG mức rủi ro đã nêu rõ với người dùng ở file nhập (cột Mật Khẩu là chữ thường) — file KHÔNG
// lưu lại trên server, chỉ ghi thẳng vào response.
router.get('/store-connections/export', async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới xuất được danh sách kết nối siêu thị' });
  try {
    const rawItems = await storeConnStore.listRaw();
    const items = rawItems.map(it => ({
      ...it, password: it.passwordEnc ? storeConnStore.decryptSecret(it.passwordEnc) : ''
    }));
    const wb = await buildStoreConnectionExportWorkbook(items);
    logDsmartPrice(req, 'EXPORT_DSMART_STORE_CONNECTIONS', 'all', `Xuất danh sách kết nối siêu thị ra Excel (${items.length} dòng)`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Ket_Noi_Sieu_Thi_Xuat.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/dsmart-price/store-connections/export lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xuất file Excel' });
  }
});

// POST /store-connections/preview — đọc file, KHÔNG ghi gì, đánh dấu từng dòng sẽ THÊM MỚI hay SỬA (so
// khớp Mã Siêu Thị với danh sách đã có) để admin xem trước trước khi bấm Nhập thật.
router.post('/store-connections/preview', uploadRateLimiter, (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới nhập được file kết nối siêu thị' });
  priceFileUpload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/dsmart-price/store-connections/preview');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần tải lên' });
    try {
      const { rows } = await parseStoreConnectionFile(req.file.buffer);
      const existing = await storeConnStore.listSanitized();
      const existingByCode = new Map(existing.map(s => [s.storeCode, s]));
      const seenInFile = new Set();
      const withMode = rows.map(r => {
        if (r.errors.length) return { ...r, mode: null };
        const found = existingByCode.get(r.storeCode) || null;
        if (found || seenInFile.has(r.storeCode)) {
          seenInFile.add(r.storeCode);
          return { ...r, mode: 'UPDATE' };
        }
        seenInFile.add(r.storeCode);
        if (!r.password) {
          return { ...r, errors: [...r.errors, 'Thiếu Mật Khẩu (bắt buộc khi thêm Mã Siêu Thị mới)'], mode: null };
        }
        return { ...r, mode: 'CREATE' };
      });
      // Trả NGUYÊN mật khẩu lại cho client (cùng khuôn preview giá bán buôn trả nguyên dữ liệu dòng) —
      // client giữ lại đúng các dòng này để gửi thẳng cho /import khi admin bấm Nhập, không yêu cầu
      // admin tải file lên 2 lần. Chỉ cùng 1 trình duyệt của ĐÚNG admin vừa tải file lên thấy lại được
      // (response của chính request họ gửi) — không phải lộ cho người khác.
      res.json({ ok: true, fileName: req.file.originalname, rows: withMode });
    } catch (err2) { sendCatchError(res, err2, 'POST /api/dsmart-price/store-connections/preview'); }
  });
});

// POST /store-connections/import — ghi THẬT (CREATE/UPDATE từng dòng) — client gửi lại NGUYÊN VẸN các
// dòng hợp lệ đã preview (bao gồm mật khẩu, do /preview đã trả về nguyên — xem
// module-itsupport-dsmartprice.js::applyDsmartStoreConnImport()), KHÔNG tin dữ liệu client gửi lên dù
// đã qua /preview trước đó (validate lại toàn bộ server-side ở đây).
router.post('/store-connections/import', uploadRateLimiter, async (req, res) => {
  if (!req.freshUser?.perms?.admin) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới nhập được file kết nối siêu thị' });
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Không có dòng nào để nhập' });
  if (rows.length > 500) return res.status(400).json({ error: 'Quá nhiều dòng trong 1 lượt nhập (tối đa 500)' });

  // LỖI THẬT đã vá (phát hiện 12/2026, người dùng báo lỗi thật lúc nhập 34 siêu thị): toàn bộ phần thân
  // route này TRƯỚC ĐÂY KHÔNG có try/catch bao ngoài — nếu storeConnStore.listRaw() (đọc trước khi vào
  // vòng lặp) hoặc bất kỳ bước nào NGOÀI vòng lặp ném lỗi, đây là 1 promise bị reject KHÔNG ai .catch()
  // trong 1 route handler async của Express 4.x (Express 4 KHÔNG tự bắt lỗi từ async handler như Express
  // 5) — rơi thẳng vào process.on('unhandledRejection') ở lib/errorLogCapture.js, vốn CHỦ Ý thoát hẳn
  // tiến trình Node để PM2 tự khởi động lại (đúng thiết kế cho lỗi THẬT SỰ không lường trước được, nhưng
  // route này lẽ ra phải trả lỗi rõ ràng cho client thay vì làm sập cả server giữa 1 lượt nhập hàng loạt
  // nhiều dòng). Vá: bọc try/catch quanh TOÀN BỘ thân route, cùng khuôn mọi route khác trong file.
  try {
    const existingList = await storeConnStore.listRaw();
    const byCode = new Map(existingList.map(s => [s.storeCode, s]));
    const results = [];
    for (const r of rows) {
      const storeCode = String(r.storeCode || '').trim();
      const storeName = String(r.storeName || '').trim();
      const host = String(r.host || '').trim();
      const port = Number(r.port) || 1433;
      const database = String(r.database || '').trim();
      const user = String(r.user || '').trim();
      const password = r.password ? String(r.password) : null;
      if (!storeCode || !storeName || !host || !database || !user) {
        results.push({ storeCode, success: false, error: 'Dữ liệu dòng không hợp lệ (đã kiểm tra lại server-side)' });
        continue;
      }
      try {
        const found = byCode.get(storeCode);
        if (found) {
          const updated = await storeConnStore.updateStore(found.id, { storeCode, storeName, host, port, database, user, password, enabled: found.enabled }, req.freshUser.username);
          byCode.set(storeCode, { ...found, storeName, host, port, database, user });
          results.push({ storeCode, success: true, mode: 'UPDATE', item: updated });
        } else {
          if (!password) { results.push({ storeCode, success: false, error: 'Thiếu Mật Khẩu (bắt buộc khi thêm Mã Siêu Thị mới)' }); continue; }
          const created = await storeConnStore.createStore({ storeCode, storeName, host, port, database, user, password }, req.freshUser.username);
          byCode.set(storeCode, { id: created.id, storeCode, storeName, host, port, database, user, enabled: true });
          results.push({ storeCode, success: true, mode: 'CREATE', item: created });
        }
      } catch (err) {
        results.push({ storeCode, success: false, error: err.message || 'Lỗi không xác định' });
      }
    }
    const successCount = results.filter(r => r.success).length;
    const createCount = results.filter(r => r.success && r.mode === 'CREATE').length;
    const updateCount = results.filter(r => r.success && r.mode === 'UPDATE').length;
    logDsmartPrice(req, 'IMPORT_DSMART_STORE_CONNECTIONS', req.body?.sourceFileName || 'import', `Nhập hàng loạt kết nối siêu thị: ${successCount}/${rows.length} dòng thành công (${createCount} thêm mới, ${updateCount} sửa)`);
    res.json({ ok: true, results, successCount, failCount: results.length - successCount });
  } catch (err) { sendCatchError(res, err, 'POST /api/dsmart-price/store-connections/import'); }
});

// ===================== Tự Động Xoá Khi Hết Hạn (itSupportPriceWriteDsmart — KHÔNG cần admin, khác hẳn
// Cấu Hình Kết Nối ở trên: đây là bật/tắt nghiệp vụ hàng ngày, không đụng gì tới host/mật khẩu) ======
router.get('/auto-delete-config', async (req, res) => {
  try {
    res.json({ ok: true, config: await getAutoDeleteConfig() });
  } catch (err) { sendCatchError(res, err, 'GET /api/dsmart-price/auto-delete-config'); }
});

router.patch('/auto-delete-config', async (req, res) => {
  try {
    const { autoDeleteEnabled, autoDeleteHour, autoDeleteMinute } = req.body || {};
    const hour = Number(autoDeleteHour);
    const minute = Number(autoDeleteMinute);
    if (autoDeleteEnabled && (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59)) {
      throw new HttpError(400, 'Giờ/phút Tự Động Xoá không hợp lệ (giờ 0-23, phút 0-59)');
    }
    const saved = await saveAutoDeleteConfig({
      autoDeleteEnabled: !!autoDeleteEnabled, autoDeleteHour: Number.isInteger(hour) ? hour : 23, autoDeleteMinute: Number.isInteger(minute) ? minute : 0
    }, req.freshUser.username);
    logDsmartPrice(req, 'UPDATE_DSMART_PRICE_AUTODELETE', 'dsmartPriceDbConfig',
      `${saved.autoDeleteEnabled ? 'Bật' : 'Tắt'} Tự Động Xoá Khi Hết Hạn${saved.autoDeleteEnabled ? ` lúc ${String(saved.autoDeleteHour).padStart(2, '0')}:${String(saved.autoDeleteMinute).padStart(2, '0')}` : ''}`);
    res.json({ ok: true, config: saved });
  } catch (err) { sendCatchError(res, err, 'PATCH /api/dsmart-price/auto-delete-config'); }
});

// ===================== File mẫu =====================
router.get('/template', async (req, res) => {
  try {
    const wb = await buildWholesalePriceTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Gia_Ban_Buon_DSmart.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/dsmart-price/template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// ===================== Đọc danh sách (chỉ dữ liệu tự nộp qua tính năng này) =====================
router.get('/entries', async (req, res) => {
  try {
    const entries = await getAllForCollection('dsmartWholesalePriceEntries');
    res.json({ ok: true, items: entries });
  } catch (err) { sendCatchError(res, err, 'GET /api/dsmart-price/entries'); }
});

// Lịch Sử Thao Tác — GỘP (flatten) mảng history của TỪNG bản ghi thành 1 danh sách phẳng, mới nhất trước.
router.get('/history', async (req, res) => {
  try {
    const entries = await getAllForCollection('dsmartWholesalePriceEntries');
    const rows = [];
    for (const e of entries) {
      for (const h of (e.history || [])) {
        rows.push({ ...h, entryId: e.id, custId: e.custId, skuId: e.skuId });
      }
    }
    rows.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ ok: true, items: rows });
  } catch (err) { sendCatchError(res, err, 'GET /api/dsmart-price/history'); }
});

// overlapsExisting(): dòng MỚI (frDate/toDate) có trùng khoảng ngày với 1 dòng ACTIVE đã có (CÙNG
// custId+skuId) không — chỉ để CẢNH BÁO MỀM ở bước xem trước, KHÔNG chặn cứng (người dùng tự quyết định,
// CSPRICE vẫn chấp nhận nhiều dòng trùng — DSmart tự chọn dòng nào áp dụng theo logic riêng của nó).
// overlapsExisting() (Lần 5, 12/2026 — SỬA theo đúng khoá chính thật CSPRICE xác nhận qua SSMS): KHÔNG còn
// so khoảng ngày (FR_DATE/TO_DATE KHÔNG phải 1 phần khoá — xem chú thích đầy đủ ở lib/dsmartSqlClient.js)
// — CHỈ cần trùng (CUST_ID, SKU_ID) với 1 entry ACTIVE trong mirror là SẼ bị GHI ĐÈ khi Thêm, bất kể ngày
// hiệu lực có chồng nhau hay không (CSPRICE chỉ cho phép 1 dòng/cặp khách+SP tại một thời điểm).
function overlapsExisting(existingActive, custId, skuId) {
  return existingActive.some(e => e.custId === custId && e.skuId === skuId && e.status === 'ACTIVE');
}

// annotateNewCustIds(rows): gắn cờ `custIdNeverSeen` (12/2026, LỖI THẬT PRODUCTION — người dùng tự điều
// tra qua Extended Events/plan cache DSmart16, xác nhận lookup giá lúc lập phiếu bán buôn khoá CHẶT theo
// CUST_ID, set nhầm mã khách thì giá KHÔNG BAO GIỜ áp đúng chỗ, không phải lỗi đồng bộ) — CẢNH BÁO MỀM nếu
// Mã Khách B2B CHƯA TỪNG xuất hiện trong CSPRICE thật (mọi SKU), để người dùng tự soát lại trước khi ghi,
// không chặn cứng (khách hàng/siêu thị MỚI hoàn toàn vẫn là tình huống hợp lệ). Chỉ kiểm tra 1 lần / Mã
// Khách PHÂN BIỆT (nhiều dòng cùng mã chỉ gọi DSmart 1 lần), chạy theo từng đợt nhỏ (không dồn quá nhiều
// kết nối cùng lúc). Nếu DSmart không kết nối được lúc xem trước, fail-open (coi như KHÔNG kiểm tra được,
// không cảnh báo gì) — đây chỉ là cảnh báo bổ sung, không được để chặn mất luôn bước xem trước chính.
const NEW_CUST_CHECK_CONCURRENCY = 5;
async function annotateNewCustIds(rows) {
  const distinctCustIds = [...new Set(rows.filter(r => r.errors.length === 0).map(r => r.custId))];
  const existsMap = new Map();
  for (let i = 0; i < distinctCustIds.length; i += NEW_CUST_CHECK_CONCURRENCY) {
    const chunk = distinctCustIds.slice(i, i + NEW_CUST_CHECK_CONCURRENCY);
    await Promise.all(chunk.map(async (custId) => {
      try {
        existsMap.set(custId, await custIdExistsInCsprice(custId));
      } catch (_) {
        existsMap.set(custId, null); // không kiểm tra được -> fail-open, không cảnh báo
      }
    }));
  }
  return rows.map(r => ({ ...r, custIdNeverSeen: r.errors.length === 0 && existsMap.get(r.custId) === false }));
}

// ===================== 1. Thêm Giá Mới: xem trước (đọc file, KHÔNG ghi gì) =====================
const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
const priceFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname)) return cb(new HttpError(400, 'Chỉ chấp nhận file Excel (.xlsx)'));
    cb(null, true);
  }
});

router.post('/preview', uploadRateLimiter, (req, res) => {
  priceFileUpload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/dsmart-price/preview');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp cần tải lên' });
    try {
      const { rows } = await parseWholesalePriceFile(req.file.buffer);
      const existingActive = await getAllForCollection('dsmartWholesalePriceEntries');
      const withOverlap = rows.map(r => ({
        ...r,
        hasOverlap: r.errors.length === 0 && overlapsExisting(existingActive, r.custId, r.skuId)
      }));
      const withNewCustCheck = await annotateNewCustIds(withOverlap);
      res.json({ ok: true, fileName: req.file.originalname, rows: withNewCustCheck });
    } catch (err2) { sendCatchError(res, err2, 'POST /api/dsmart-price/preview'); }
  });
});

// ===================== 1b. Thêm Giá Mới: ghi thật (INSERT từng dòng vào CSPRICE) =====================
// Dùng CHUNG cho cả luồng "upload file" (rows đã qua /preview) lẫn luồng "↩️ Dùng Lại" (client tự dựng
// ĐÚNG 1 dòng từ dữ liệu cũ, không qua /preview) — cả 2 đều validate lại server-side ở đây, KHÔNG tin dữ
// liệu client gửi lên dù đã qua /preview trước đó (preview chỉ là gợi ý hiển thị, không phải bước khoá).
function todayDateOnlyIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// schedule=true (12/2026, theo yêu cầu người dùng: "giá sẽ theo ngày bắt đầu trong file excel và lịch tự
// động bắt ngày bắt đầu và áp giá từ 0 giờ, nếu người tạo chọn đặt lịch, còn không đặt lịch thì sẽ là áp
// giá luôn") — CHỈ hoãn ghi khi Ngày Bắt Đầu (frDate) THẬT SỰ ở TƯƠNG LAI (> hôm nay); dòng frDate=hôm
// nay/quá khứ áp NGAY dù có tick "Đặt Lịch" (không có gì để chờ — tick nhầm cũng không delay sai ý).
// Dòng hoãn lưu status='SCHEDULED' (dsmartKey=null, CHƯA ghi gì vào CSPRICE) — job
// jobs/dsmartAutoApplyScheduledPrices.js chạy định kỳ, tới đúng frDate thì tự gọi insertWholesalePrice()
// (kèm FAN-OUT xuống mọi siêu thị, xem lib/dsmartSqlClient.js) và chuyển ACTIVE.
router.post('/apply', uploadRateLimiter, async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const sourceFileName = req.body?.sourceFileName || null;
  const sourceAction = req.body?.sourceAction === 'REUSE' ? 'REUSE' : 'UPLOAD';
  const schedule = !!req.body?.schedule;
  // targetStoreIds (12/2026, theo yêu cầu người dùng: "cho phép tôi chọn hoặc là tất cả siêu thị, hoặc cho
  // tôi chọn từng siêu thị... lấy luôn từ cái phần cấu hình admin ấy"): null/thiếu = ÁP DỤNG TẤT CẢ siêu
  // thị đang Enabled=1 (mặc định, GIỮ NGUYÊN hành vi cũ) — xem fanOutToStores()/lib/dsmartSqlClient.js.
  // Mảng id = ĐÓNG BĂNG đúng danh sách đã chọn, lưu lại trên MỖI entry (ACTIVE lẫn SCHEDULED) để "Sửa"/
  // "Xoá"/job tự động áp dụng đã lên lịch SAU NÀY nhắm đúng những siêu thị đã từng nhận dòng này, không bị
  // lệch nếu sau đó có thêm siêu thị mới Enabled. KHÔNG validate khớp đúng ID có tồn tại/Enabled ở đây —
  // fanOutToStores() tự giao với danh sách đang Enabled=1 tại THỜI ĐIỂM ghi, id lạ/đã Tắt chỉ đơn giản
  // không nhận được gì (an toàn, không ném lỗi).
  const rawTargetStoreIds = req.body?.targetStoreIds;
  const targetStoreIds = Array.isArray(rawTargetStoreIds) ? rawTargetStoreIds.map(Number).filter(Number.isFinite) : null;
  if (!rows.length) return res.status(400).json({ error: 'Không có dòng nào để ghi' });
  if (rows.length > 2000) return res.status(400).json({ error: 'Quá nhiều dòng trong 1 lượt ghi (tối đa 2000)' });

  const today = todayDateOnlyIso();
  const results = [];
  for (const r of rows) {
    const custId = String(r.custId || '').trim();
    const skuId = String(r.skuId || '').trim();
    const price = Number(r.price);
    const frDate = String(r.frDate || '');
    const toDate = String(r.toDate || '');
    if (!custId || !skuId || custId.length > 50 || skuId.length > 50 || !Number.isFinite(price) || price < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(frDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || frDate > toDate) {
      results.push({ custId, skuId, success: false, error: 'Dữ liệu dòng không hợp lệ (đã kiểm tra lại server-side)' });
      continue;
    }
    if (schedule && frDate > today) {
      try {
        const entryId = await withAppLock(`dsmartWholesalePrice:${custId}:${skuId}`, async () => {
          const now = new Date().toISOString();
          const entry = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            dsmartKey: null, custId, skuId, price, frDate, toDate, status: 'SCHEDULED', targetStoreIds,
            createdBy: req.freshUser.username, createdAt: now, sourceFileName,
            history: [{ action: 'SCHEDULE', mode: sourceAction, actor: req.freshUser.username, at: now, price, frDate, toDate, sourceFileName }]
          };
          await createForCollection('dsmartWholesalePriceEntries', () => entry);
          return entry.id;
        });
        results.push({ custId, skuId, success: true, entryId, scheduled: true });
      } catch (err) {
        results.push({ custId, skuId, success: false, error: err.message || 'Lỗi không xác định' });
      }
      continue;
    }
    try {
      // Khoá theo đúng cặp (CUST_ID, SKU_ID) — audit chéo phát hiện: không khoá thì 2 request /apply THẬT
      // chạy đồng thời cho cùng 1 cặp có thể cùng đọc "existingActive" TRƯỚC khi cái kia kịp ghi entry mới,
      // dẫn tới mirror nội bộ có >1 entry ACTIVE cùng trỏ 1 dòng CSPRICE thật (dữ liệu THẬT trên CSPRICE vẫn
      // đúng nhờ PK, đây chỉ là nguy cơ lệch ở bảng theo dõi nội bộ của riêng tính năng này). Khoá bọc
      // NGUYÊN cả bước ghi DSmart lẫn bước dọn mirror để 2 request đồng thời tự xếp hàng, request sau sẽ
      // thấy đúng entry MỚI của request trước là "cũ" khi tới lượt mình.
      const { entryId, overwritten, storeResults, storeFanOutError } = await withAppLock(`dsmartWholesalePrice:${custId}:${skuId}`, async () => {
        const { wasOverwrite, storeResults, storeFanOutError, ...dsmartKey } = await insertWholesalePrice({ custId, skuId, price, frDate, toDate }, targetStoreIds);
        const now = new Date().toISOString();
        // Trùng khoá chính CSPRICE (CUST_ID, SKU_ID) -> insertWholesalePrice() đã TỰ GHI ĐÈ dòng cũ trên
        // DSmart thay vì báo lỗi (xem Lần 5, lib/dsmartSqlClient.js). Đánh dấu DELETED MỌI entry mirror
        // ACTIVE cũ cho đúng cặp này (không chỉ entry đầu tiên khớp — phòng trường hợp tồn đọng >1 entry
        // ACTIVE từ trước khi có khoá này) vì dữ liệu giá/ngày của NHỮNG entry đó không còn đúng với dòng
        // thật trên DSmart nữa — tránh mirror có nhiều entry ACTIVE cùng trỏ 1 dòng CSPRICE thật, đồng thời
        // tự dọn luôn dòng dữ liệu cũ lỗi (thiếu cột) từ sự cố Lần 3 nếu có.
        if (wasOverwrite) {
          const existingActive = await getAllForCollection('dsmartWholesalePriceEntries');
          const staleList = existingActive.filter(e => e.custId === custId && e.skuId === skuId && e.status === 'ACTIVE');
          for (const stale of staleList) {
            await withLockedRecordForCollection('dsmartWholesalePriceEntries', stale.id, async (item) => {
              if (item.status !== 'ACTIVE') return item;
              return {
                ...item, status: 'DELETED', deletedBy: req.freshUser.username, deletedAt: now,
                history: [...(item.history || []), {
                  action: 'DELETE', mode: 'AUTO_OVERWRITTEN', actor: req.freshUser.username, at: now,
                  oldPrice: item.price, oldFrDate: item.frDate, oldToDate: item.toDate,
                  note: 'Bị ghi đè tự động bởi 1 lượt "Thêm Giá Mới" khác cho cùng Mã Khách B2B/Mã Sản Phẩm (CSPRICE chỉ cho phép 1 dòng/cặp)'
                }]
              };
            });
          }
        }
        const entry = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          dsmartKey, custId, skuId, price, frDate, toDate, status: 'ACTIVE', targetStoreIds,
          createdBy: req.freshUser.username, createdAt: now, sourceFileName,
          history: [{ action: wasOverwrite ? 'INSERT_OVERWRITE' : 'INSERT', mode: sourceAction, actor: req.freshUser.username, at: now, price, frDate, toDate, sourceFileName, storeResults }]
        };
        await createForCollection('dsmartWholesalePriceEntries', () => entry);
        return { entryId: entry.id, overwritten: wasOverwrite, storeResults, storeFanOutError };
      });
      results.push({ custId, skuId, success: true, entryId, overwritten, storeResults, storeFanOutError });
    } catch (err) {
      results.push({ custId, skuId, success: false, error: err instanceof DsmartConfigError ? err.message : (err.message || 'Lỗi không xác định') });
      // Lỗi kết nối/cấu hình (DsmartConfigError) sẽ LẶP LẠI y hệt cho mọi dòng còn lại — dừng sớm thay vì
      // thử tiếp hàng loạt lần vô ích (và tránh spam lỗi kết nối hàng chục/trăm lần trong 1 lượt).
      if (err instanceof DsmartConfigError) {
        for (const remaining of rows.slice(rows.indexOf(r) + 1)) {
          results.push({ custId: remaining.custId, skuId: remaining.skuId, success: false, error: 'Bỏ qua do lỗi kết nối DSmart ở dòng trước' });
        }
        break;
      }
    }
  }
  const successCount = results.filter(r => r.success).length;
  const overwriteCount = results.filter(r => r.success && r.overwritten).length;
  const scheduledCount = results.filter(r => r.success && r.scheduled).length;
  logDsmartPrice(req, 'INSERT_DSMART_PRICE', sourceFileName || 'reuse', `Thêm giá bán buôn: ${successCount}/${rows.length} dòng thành công (${sourceAction})${overwriteCount ? `, trong đó ${overwriteCount} dòng GHI ĐÈ giá đã có` : ''}${scheduledCount ? `, trong đó ${scheduledCount} dòng ĐÃ LÊN LỊCH (chưa áp dụng ngay)` : ''}`);
  res.json({ ok: true, results, successCount, failCount: results.length - successCount, scheduledCount });
});

// ===================== 2. Sửa (UPDATE đúng 1 dòng CHƯA xoá) =====================
router.patch('/entries/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const price = Number(req.body?.price);
    const frDate = String(req.body?.frDate || '');
    const toDate = String(req.body?.toDate || '');
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Giá không hợp lệ');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(frDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || frDate > toDate) {
      throw new HttpError(400, 'Ngày bắt đầu/kết thúc không hợp lệ');
    }
    // LỖI THẬT đã vá (audit chéo trước deploy, 12/2026): route này TRƯỚC ĐÂY chỉ khoá theo record-id nội
    // bộ (withLockedRecordForCollection), KHÔNG khoá theo cặp (CUST_ID, SKU_ID) như POST /apply và job
    // "Lên Lịch Áp Giá" đang dùng — nên có thể đụng độ (race) với 1 request /apply/job khác CÙNG lúc ghi
    // đè đúng cặp CUST_ID/SKU_ID này (hiếm nhưng cùng loại lỗi vừa vá ở jobs/dsmartAutoDeleteExpiredPrices.js).
    // Vá: đọc trước CUST_ID/SKU_ID (không đổi qua Sửa) để giành ĐÚNG khoá chung, rồi mới khoá record-id.
    const peek = (await getAllForCollection('dsmartWholesalePriceEntries')).find(x => x.id === id);
    if (!peek) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    let storeResults, storeFanOutError;
    const updated = await withAppLock(`dsmartWholesalePrice:${peek.custId}:${peek.skuId}`, () => withLockedRecordForCollection('dsmartWholesalePriceEntries', id, async (item) => {
      if (item.status !== 'ACTIVE') throw new HttpError(409, 'Dòng này đã bị xoá khỏi DSmart — không thể sửa, dùng "↩️ Dùng Lại" để tạo dòng mới.');
      // Lần 5: khoá chính thật CHỈ gồm CUST_ID+SKU_ID (KHÔNG đổi khi FR_DATE/TO_DATE đổi như giả định Lần 2
      // sai trước đây) — lưu lại khoá trả về chỉ để nhất quán, không còn bắt buộc như trước (xem chú thích
      // đầy đủ tại updateWholesalePrice()/lib/dsmartSqlClient.js).
      // targetStoreIds (12/2026): LUÔN tái dùng đúng danh sách siêu thị đã ĐÓNG BĂNG lúc "Thêm Giá Mới"
      // (null = đã chọn "Tất Cả" lúc đó, vẫn linh động theo Enabled hiện tại) — KHÔNG có UI chọn lại ở
      // bước Sửa, tránh "Sửa" vô tình fan-out sang 1 siêu thị CHƯA từng nhận dòng này lúc Thêm (báo lỗi
      // rõ ràng, xem updatePriceOnPool()/lib/dsmartSqlClient.js).
      const { storeResults: sr, storeFanOutError: sfe, ...newDsmartKey } = await updateWholesalePrice({ dsmartKey: item.dsmartKey, price, frDate, toDate }, item.targetStoreIds);
      storeResults = sr; storeFanOutError = sfe;
      const now = new Date().toISOString();
      return {
        ...item, price, frDate, toDate, dsmartKey: newDsmartKey, updatedBy: req.freshUser.username, updatedAt: now,
        history: [...(item.history || []), { action: 'UPDATE', actor: req.freshUser.username, at: now, oldPrice: item.price, oldFrDate: item.frDate, oldToDate: item.toDate, newPrice: price, newFrDate: frDate, newToDate: toDate, storeResults }]
      };
    }));
    logDsmartPrice(req, 'UPDATE_DSMART_PRICE', String(id), `Sửa giá bán buôn DSmart (${updated.custId}/${updated.skuId})`);
    res.json({ ok: true, item: updated, storeResults, storeFanOutError });
  } catch (err) { sendCatchError(res, err, 'PATCH /api/dsmart-price/entries/:id'); }
});

// POST /entries/:id/cancel-schedule — hủy 1 dòng ĐANG CHỜ áp dụng (status SCHEDULED, 12/2026, theo yêu
// cầu người dùng về tính năng "Lên Lịch Áp Giá") — CHƯA từng ghi gì vào CSPRICE nên không cần hoàn tác gì
// ở DSmart, chỉ đổi trạng thái nội bộ. Dòng ĐÃ áp dụng (ACTIVE) hoặc đã hủy/xoá trước đó không hủy lại
// được qua endpoint này.
router.post('/entries/:id/cancel-schedule', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    // LỖI THẬT đã vá (audit chéo lần 2, 12/2026 — cùng loại race vừa vá ở jobs/dsmartAutoApplyScheduledPrices.js):
    // route này TRƯỚC ĐÂY chỉ khoá theo record-id nội bộ, KHÔNG giành khoá chung theo cặp (CUST_ID, SKU_ID)
    // như job "Lên Lịch Áp Giá" đang dùng — nếu hủy lịch ĐÚNG LÚC job đang chờ giành khoá để ghi giá dòng
    // này vào DSmart, job vẫn có thể ghi giá THẬT vào CSPRICE dù lịch đã bị hủy (job đã vá đọc lại trạng
    // thái NGAY TRONG khoá trước khi ghi, nhưng vẫn cần route này giành ĐÚNG khoá đó để job phải CHỜ, không
    // xen vào giữa job đang xử lý). Vá: đọc trước CUST_ID/SKU_ID để giành ĐÚNG khoá chung, rồi mới khoá
    // record-id — cùng khuôn PATCH /entries/:id và POST /entries/:id/delete ở trên.
    const peek = (await getAllForCollection('dsmartWholesalePriceEntries')).find(x => x.id === id);
    if (!peek) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    const updated = await withAppLock(`dsmartWholesalePrice:${peek.custId}:${peek.skuId}`, () => withLockedRecordForCollection('dsmartWholesalePriceEntries', id, async (item) => {
      if (item.status !== 'SCHEDULED') throw new HttpError(409, 'Dòng này không còn ở trạng thái "Đã Lên Lịch" (có thể đã được áp dụng hoặc đã hủy trước đó).');
      const now = new Date().toISOString();
      return {
        ...item, status: 'CANCELLED', cancelledBy: req.freshUser.username, cancelledAt: now,
        history: [...(item.history || []), { action: 'CANCEL_SCHEDULE', actor: req.freshUser.username, at: now }]
      };
    }));
    logDsmartPrice(req, 'CANCEL_DSMART_PRICE_SCHEDULE', String(id), `Hủy lịch áp giá bán buôn DSmart (${updated.custId}/${updated.skuId})`);
    res.json({ ok: true, item: updated });
  } catch (err) { sendCatchError(res, err, 'POST /api/dsmart-price/entries/:id/cancel-schedule'); }
});

// ===================== 3. Xoá (tay) — DELETE thật khỏi CSPRICE =====================
router.post('/entries/:id/delete', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    // Khoá theo cặp (CUST_ID, SKU_ID) TRƯỚC khi khoá record-id — cùng lý do đã vá ở PATCH /entries/:id và
    // jobs/dsmartAutoDeleteExpiredPrices.js ngay trên (tránh race với /apply/job Lên Lịch cùng chạm đúng
    // cặp này).
    const peek = (await getAllForCollection('dsmartWholesalePriceEntries')).find(x => x.id === id);
    if (!peek) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    let storeResults, storeFanOutError;
    const updated = await withAppLock(`dsmartWholesalePrice:${peek.custId}:${peek.skuId}`, () => withLockedRecordForCollection('dsmartWholesalePriceEntries', id, async (item) => {
      if (item.status !== 'ACTIVE') throw new HttpError(409, 'Dòng này đã được xoá trước đó rồi.');
      // targetStoreIds: tái dùng đúng danh sách đã chọn lúc Thêm (xem chú thích ở PATCH /entries/:id ở trên).
      const delResult = await deleteWholesalePrice({ dsmartKey: item.dsmartKey }, item.targetStoreIds);
      storeResults = delResult.storeResults; storeFanOutError = delResult.storeFanOutError;
      const now = new Date().toISOString();
      return {
        ...item, status: 'DELETED', deletedBy: req.freshUser.username, deletedAt: now,
        history: [...(item.history || []), { action: 'DELETE', mode: 'MANUAL', actor: req.freshUser.username, at: now, storeResults }]
      };
    }));
    logDsmartPrice(req, 'DELETE_DSMART_PRICE', String(id), `Xoá giá bán buôn DSmart (${updated.custId}/${updated.skuId})`);
    res.json({ ok: true, item: updated, storeResults, storeFanOutError });
  } catch (err) { sendCatchError(res, err, 'POST /api/dsmart-price/entries/:id/delete'); }
});

module.exports = router;
