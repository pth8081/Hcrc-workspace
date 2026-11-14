// tests/test-price-sync-job.js — test logic THUẦN cho jobs/priceSync.js ("💲 Kiểm Tra Giá" — đồng bộ
// ngầm bảng giá offline, 12/2026). Stub lib/appData.js + lib/priceSnapshotStore.js + jobs/inventorySync.js
// + lib/priceCheckApiClient.js (KHÔNG cần DB/HTTP thật, cùng khuôn tests/test-inventory-api-config.js).
// Chạy: node tests/test-price-sync-job.js
'use strict';
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

// ===== Stub lib/appData.js — AppData "priceSyncLocks" giữ trong RAM, CÙNG chữ ký withLockedAppDataValue thật =====
let appDataStore = { priceSyncLocks: {} };
stubModule('lib/appData.js', {
  getAppDataValue: async (key) => appDataStore[key],
  withLockedAppDataValue: async (key, mutatorFn) => {
    if (!(key in appDataStore)) throw new Error(`Key không tồn tại trong AppData: ${key}`);
    appDataStore[key] = await mutatorFn(appDataStore[key]);
    return appDataStore[key];
  }
});

// ===== Stub lib/priceSnapshotStore.js — snapshot giữ trong RAM theo maDiem =====
let priceSnapshots = {}; // maDiem -> {rows, capNhatLuc, fetchedAt}
stubModule('lib/priceSnapshotStore.js', {
  getSnapshotForMaDiemMerged: async (maDiemRaw) => {
    const codes = String(maDiemRaw || '').split(',').map(s => s.trim()).filter(Boolean);
    const entries = codes.map(c => priceSnapshots[c]).filter(Boolean);
    if (!entries.length) return null;
    return entries[0];
  },
  replaceSnapshotForMaDiem: async (maDiem, entry, fetchedAt) => {
    priceSnapshots[maDiem] = { rows: entry.rows || [], capNhatLuc: entry.capNhatLuc || null, fetchedAt: fetchedAt.toISOString() };
  }
});

// ===== Stub ./inventorySync — creds + danh sách mã hàng đã biết theo maDiem =====
let mockInventoryByMaDiem = {}; // maDiem -> rows [{maHang, tenHang, maVach, soLuongTon}]
let mockCreds = { baseUrl: 'https://api.test.local', apiKey: 'test-key', source: 'ui' };
let resolveCredsCallCount = 0;
stubModule('jobs/inventorySync.js', {
  resolveInventoryApiCreds: async () => { resolveCredsCallCount++; return mockCreds; },
  getSystemInventoryForMaDiem: async (maDiem) => {
    const rows = mockInventoryByMaDiem[maDiem];
    return rows && rows.length ? { rows, capNhatLuc: '2026-12-01T00:00:00Z', fetchedAt: '2026-12-01T00:05:00Z' } : null;
  }
});

// ===== Stub lib/priceCheckApiClient.js — checkPrice() giả lập theo map maHang -> kết quả/lỗi =====
class PriceCheckApiAuthError extends Error {}
class PriceCheckApiNotFoundError extends Error {}
let mockPriceResults = {}; // maHang -> {giaThuong,...} | {__authError:true} | undefined (= 404 not found)
let checkPriceCallLog = [];
stubModule('lib/priceCheckApiClient.js', {
  checkPrice: async ({ maHang, maDiem }) => {
    checkPriceCallLog.push(maHang);
    const hit = mockPriceResults[maHang];
    if (!hit) throw new PriceCheckApiNotFoundError(`Không tìm thấy giá cho mã ${maHang}`);
    if (hit.__authError) throw new PriceCheckApiAuthError('Giá Bán API từ chối truy cập (401)');
    return { maHang, tenHang: hit.tenHang || '', maVach: hit.maVach || null, giaThuong: hit.giaThuong ?? null, giaKhuyenMai: hit.giaKhuyenMai ?? null, coKhuyenMai: !!hit.coKhuyenMai, capNhatLuc: hit.capNhatLuc || null };
  },
  PriceCheckApiAuthError,
  PriceCheckApiNotFoundError
});

process.env.PRICE_SYNC_PACE_MS = '0'; // không cần chờ thật giữa các lượt gọi trong test
const { syncStorePriceCatalog, claimPriceSyncSlot, releasePriceSyncSlot } = require('../jobs/priceSync');

(async () => {
  // 1) Chưa cấu hình đối tác -> skip, không gọi gì thêm.
  mockCreds = null;
  let r = await syncStorePriceCatalog('217');
  check('skip khi chưa cấu hình API đối tác', r.skipped === true && r.reason === 'not_configured', r);
  mockCreds = { baseUrl: 'https://api.test.local', apiKey: 'test-key', source: 'ui' };

  // 2) maDiemRaw rỗng -> skip ngay, không gọi resolveInventoryApiCreds().
  resolveCredsCallCount = 0;
  r = await syncStorePriceCatalog('');
  check('skip ngay khi thiếu Mã Điểm, không gọi resolveInventoryApiCreds()', r.skipped === true && r.reason === 'no_ma_diem' && resolveCredsCallCount === 0, r);

  // 3) Chưa có dữ liệu Tồn Kho cho Mã Điểm này -> skip rõ lý do.
  mockInventoryByMaDiem = {};
  r = await syncStorePriceCatalog('217');
  check('skip khi chưa có dữ liệu Tồn Kho cho Mã Điểm', r.results[0].skipped === true && r.results[0].reason === 'no_inventory_data', r);

  // 4) Đồng bộ đầy đủ lần đầu: 3 mã hàng, 1 mã có giá, 1 mã KHÔNG có giá (404, bỏ qua, không chặn), 1 mã lỗi auth (DỪNG HẲN).
  mockInventoryByMaDiem = { '217': [
    { maHang: 'SP001', tenHang: 'Sản phẩm 1', soLuongTon: 10 },
    { maHang: 'SP002', tenHang: 'Sản phẩm 2', soLuongTon: 5 },
    { maHang: 'SP003', tenHang: 'Sản phẩm 3', soLuongTon: 2 }
  ] };
  mockPriceResults = {
    SP001: { tenHang: 'Sản phẩm 1', giaThuong: 10000, capNhatLuc: '2026-12-01T08:00:00Z' },
    // SP002 KHÔNG có trong map -> checkPrice() throw PriceCheckApiNotFoundError (giả lập "còn hàng nhưng đối tác không bán")
    SP003: { __authError: true }
  };
  checkPriceCallLog = [];
  priceSnapshots = {};
  r = await syncStorePriceCatalog('217', { force: true });
  check('đồng bộ xong, có 1 mã lỗi auth -> dừng hẳn vòng lặp (không gọi tiếp mã sau đó)', checkPriceCallLog.length === 3, checkPriceCallLog);
  check('kết quả trả ok:false kèm lỗi khi gặp PriceCheckApiAuthError', r.results[0].ok === false && /từ chối truy cập/.test(r.results[0].error || ''), r);

  // 4b) Xác nhận rõ: gặp lỗi auth giữa chừng thì KHÔNG ghi snapshot nửa vời (giữ nguyên bản cũ, nếu có) —
  // đúng tinh thần "lỗi giữa chừng giữ nguyên cache cũ" của jobs/inventorySync.js.
  check('không ghi snapshot nửa vời khi dừng giữa chừng vì lỗi auth', priceSnapshots['217'] === undefined, priceSnapshots['217']);

  // 5) Đồng bộ lại, lần này không có lỗi auth — 2/3 mã có giá (SP002 vẫn 404, bỏ qua, không chặn).
  mockPriceResults = {
    SP001: { tenHang: 'Sản phẩm 1', giaThuong: 10000, capNhatLuc: '2026-12-01T08:00:00Z' },
    SP003: { tenHang: 'Sản phẩm 3', giaThuong: 30000, capNhatLuc: '2026-12-01T08:00:00Z' }
  };
  checkPriceCallLog = [];
  r = await syncStorePriceCatalog('217', { force: true });
  check('đồng bộ đủ cả 3 mã (không dừng giữa chừng khi không có lỗi auth)', checkPriceCallLog.length === 3, checkPriceCallLog);
  check('lưu đúng 2/3 mã có giá (1 mã 404 bị bỏ qua, không chặn cả lượt)', r.results[0].ok === true && r.results[0].itemCount === 2 && r.results[0].errorCount === 1, r.results[0]);
  check('snapshot lưu đúng 2 dòng', priceSnapshots['217'].rows.length === 2, priceSnapshots['217']);

  // 6) force:false, bản vừa đồng bộ xong CÒN MỚI (chưa quá 1 ngày) -> skip (not_due), KHÔNG gọi lại đối tác.
  checkPriceCallLog = [];
  r = await syncStorePriceCatalog('217', { force: false });
  check('force:false + bản còn mới -> skip not_due, không gọi lại đối tác', r.results[0].skipped === true && r.results[0].reason === 'not_due' && checkPriceCallLog.length === 0, r);

  // 7) force:true LUÔN chạy lại dù bản còn mới.
  checkPriceCallLog = [];
  r = await syncStorePriceCatalog('217', { force: true });
  check('force:true luôn chạy lại dù bản còn mới', checkPriceCallLog.length === 3, checkPriceCallLog);

  // 8) Nhiều Mã Điểm gộp (sáp nhập 2 siêu thị, "217,305") -> đồng bộ TỪNG Mã Điểm riêng, không gộp payload.
  mockInventoryByMaDiem['305'] = [{ maHang: 'SP900', tenHang: 'Sản phẩm 900', soLuongTon: 1 }];
  mockPriceResults.SP900 = { tenHang: 'Sản phẩm 900', giaThuong: 90000 };
  checkPriceCallLog = [];
  r = await syncStorePriceCatalog('217,305', { force: true });
  check('2 Mã Điểm gộp -> đồng bộ đủ CẢ 2, mỗi điểm 1 kết quả riêng', r.results.length === 2 && r.results.every(x => x.ok || x.skipped), r.results);
  check('2 Mã Điểm lưu snapshot RIÊNG, không lẫn vào nhau', priceSnapshots['217'].rows.length === 2 && priceSnapshots['305'].rows.length === 1, { p217: priceSnapshots['217'], p305: priceSnapshots['305'] });

  // 9) "Giành chỗ" (claimPriceSyncSlot) — chống 2 tiến trình/request cùng lúc chạy chung 1 Mã Điểm.
  await releasePriceSyncSlot('999'); // đảm bảo sạch trước khi test
  const claimed1 = await claimPriceSyncSlot('999');
  const claimed2 = await claimPriceSyncSlot('999');
  check('giành chỗ lần 1 thành công', claimed1 === true);
  check('giành chỗ lần 2 (đang có người giữ) THẤT BẠI', claimed2 === false);
  await releasePriceSyncSlot('999');
  const claimed3 = await claimPriceSyncSlot('999');
  check('giành chỗ lại được SAU KHI đã gỡ khoá', claimed3 === true);
  await releasePriceSyncSlot('999');

  // 10) syncStorePriceCatalog() tự "giành chỗ" — 2 lệnh gọi "song song" cho CÙNG Mã Điểm chỉ 1 lệnh thật
  // sự chạy vòng lặp (lệnh kia skip "already_in_progress") — mô phỏng 2 nhân viên cùng mở tab gần như
  // đồng thời. Reset snapshot để ép buộc "đã tới hạn" (force:false nhưng chưa từng đồng bộ).
  delete priceSnapshots['217'];
  checkPriceCallLog = [];
  // Giả lập race: giành chỗ TRƯỚC (như thể 1 request khác đã bắt đầu), rồi gọi syncStorePriceCatalog()
  // thường (phải thấy đã bị giữ chỗ, skip ngay).
  await claimPriceSyncSlot('217');
  r = await syncStorePriceCatalog('217', { force: false });
  check('đã có tiến trình khác giữ chỗ -> skip already_in_progress, không gọi đối tác', r.results[0].skipped === true && r.results[0].reason === 'already_in_progress' && checkPriceCallLog.length === 0, r);
  await releasePriceSyncSlot('217');

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  if (fail > 0) process.exit(1);
})();
