// lib/appData.js — Đọc/ghi 1 collection JSON trong dbo.AppData, dùng chung bởi routes/data.js,
// routes/auth.js, routes/workflow.js và seedDefaults.js (trước đây mỗi nơi tự viết lại cùng 1 đoạn SQL).
const { getPool, sql } = require('../db');

// Cache ngắn hạn TRONG BỘ NHỚ, chỉ áp dụng cho getAppDataValueCached() bên dưới (KHÔNG ảnh hưởng
// getAppDataValue() thường — mọi nơi khác trong code vẫn đọc thẳng DB như cũ). Lý do: requireAuth()
// (lib/auth.js) đọc lại TOÀN BỘ collection "users" ở MỖI request có xác thực để kiểm tra tài khoản
// còn active hay không — với nhiều người dùng thao tác đồng thời, đây là 1 DB round-trip nhân theo
// SỐ REQUEST chứ không phải số người, dễ thành điểm nghẽn đầu tiên khi tải cao. TTL vài giây vẫn giữ
// đúng ý "vô hiệu hóa có hiệu lực gần như ngay lập tức" (chỉ trễ tối đa TTL) trong khi giảm mạnh số
// lần đọc DB. Cache bị xoá NGAY khi có ghi (setAppDataValue/setAppDataValueIfVersionMatches/
// withLockedAppDataValue, xem cuối các hàm bên dưới) nên trong CÙNG 1 tiến trình Node, thay đổi luôn
// thấy ngay không cần chờ hết TTL — độ trễ TTL chỉ còn ý nghĩa khi chạy nhiều tiến trình (PM2 cluster
// mode), vì mỗi tiến trình giữ cache riêng.
const CACHE_TTL_MS = parseInt(process.env.APPDATA_CACHE_TTL_MS || '3000', 10);
const cache = new Map(); // DataKey -> { value, expiresAt }
// Cache riêng cho getAllAppDataWithVersionsCached() bên dưới — TOÀN BỘ bảng AppData trong 1 lượt, dùng
// cho GET /api/data (xem routes/data.js): trước đây MỖI request đều tự SELECT + JSON.parse lại nguyên
// bảng AppData (~28 collection), dù nội dung giống hệt nhau giữa các người dùng khác nhau gọi gần như
// cùng lúc — phần lọc theo quyền xem CHỈ xảy ra SAU bước này (xem routes/data.js), nên bước đọc+parse
// này an toàn để dùng chung. Xoá CÙNG LÚC với cacheInvalidate(key) bất kỳ bên dưới — đơn giản hơn theo
// dõi key nào ảnh hưởng gì (bảng AppData có ~28 key, ghi 1 key bất kỳ đều nên coi ảnh hưởng "toàn bộ").
let allDataCache = null; // { data, versions, expiresAt }

// PM2 cluster mode chạy nhiều tiến trình Node độc lập, MỖI tiến trình giữ 1 bản cache TRONG BỘ NHỚ
// riêng (biến `cache`/`allDataCache` ở trên) — ghi ở tiến trình A chỉ tự xoá cache của CHÍNH tiến trình
// A, các tiến trình B/C/D... vẫn phục vụ dữ liệu cũ tới hết TTL (mặc định 3s). Với đa số collection đây
// chỉ là dữ liệu hiển thị trễ vài giây, nhưng "users" lại là ngoại lệ ĐÁNG KỂ: requireAuth() (lib/auth.js)
// đọc cache này ở MỌI request đã đăng nhập để kiểm tra tài khoản còn active/còn đúng quyền hay không —
// admin khoá 1 tài khoản ở tiến trình A, nhưng request của tài khoản đó rơi vào tiến trình B vẫn coi là
// active tới 3s sau. PM2 cluster mode tự động chuyển tiếp message process.send({type:'process:msg',...})
// tới MỌI tiến trình khác của cùng app (tính năng IPC có sẵn, không cần thêm gói/hạ tầng như Redis) —
// dùng kênh đó để phát tín hiệu xoá cache ngay khi có 1 tiến trình ghi, thay vì đợi hết TTL ở nơi khác.
// applyRemoteCacheInvalidate() (nghe message tới) KHÔNG được gọi lại cacheInvalidate() ở dưới — nếu
// không sẽ phát lại vô hạn giữa các tiến trình.
const APPDATA_CACHE_INVALIDATE_CHANNEL = 'appDataCacheInvalidate';

function applyRemoteCacheInvalidate(key) {
  cache.delete(key);
  allDataCache = null;
}

if (typeof process.on === 'function') {
  process.on('message', (packet) => {
    if (packet && packet.type === 'process:msg' && packet.data && packet.data.channel === APPDATA_CACHE_INVALIDATE_CHANNEL) {
      applyRemoteCacheInvalidate(packet.data.key);
    }
  });
}

function cacheInvalidate(key) {
  cache.delete(key);
  allDataCache = null;
  if (typeof process.send === 'function') {
    try {
      process.send({ type: 'process:msg', data: { channel: APPDATA_CACHE_INVALIDATE_CHANNEL, key } });
    } catch (err) {
      console.error('⛔ Không phát được tín hiệu xoá cache appData sang tiến trình khác:', err.message);
    }
  }
}

async function getAppDataValueCached(key) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await getAppDataValue(key);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

// Trả { data: {DataKey: value}, versions: {DataKey: isoString} } — cùng hình dạng vòng lặp đang làm
// thủ công ở routes/data.js GET /. Đối tượng `data`/`versions` trả về được DÙNG CHUNG giữa nhiều request
// đồng thời trong TTL — nơi gọi (routes/data.js) PHẢI shallow-clone `data` trước khi gán đè bất kỳ
// property nào lên nó (vd `data.users = stripPasswords(...)`), tuyệt đối không sửa trực tiếp object trả
// về ở đây hay các mảng bên trong nó, nếu không request khác đang đọc cùng cache sẽ thấy dữ liệu sai.
async function getAllAppDataWithVersionsCached() {
  if (allDataCache && allDataCache.expiresAt > Date.now()) return allDataCache;
  const pool = await getPool();
  const result = await pool.request().query('SELECT DataKey, DataValue, UpdatedAt FROM dbo.AppData');
  const data = {};
  const versions = {};
  for (const row of result.recordset) {
    try {
      data[row.DataKey] = JSON.parse(row.DataValue);
      versions[row.DataKey] = row.UpdatedAt.toISOString();
    } catch (e) {
      console.error(`Lỗi parse JSON cho key "${row.DataKey}":`, e.message);
      data[row.DataKey] = null;
    }
  }
  allDataCache = { data, versions, expiresAt: Date.now() + CACHE_TTL_MS };
  return allDataCache;
}

async function getAppDataValue(key) {
  const pool = await getPool();
  const result = await pool.request()
    .input('k', sql.NVarChar(100), key)
    .query('SELECT DataValue FROM dbo.AppData WHERE DataKey = @k');
  if (result.recordset.length === 0) return null;
  return JSON.parse(result.recordset[0].DataValue);
}

// Đọc kèm "version" (chính là UpdatedAt, cột đã có sẵn NOT NULL DEFAULT SYSUTCDATETIME() — xem
// sql/schema.sql, không cần thêm cột mới) — dùng làm token optimistic concurrency: client phải gửi
// lại đúng version đã đọc thì ghi mới được chấp nhận, tránh 2 người ghi đè mất thay đổi của nhau.
async function getAppDataValueWithVersion(key) {
  const pool = await getPool();
  const result = await pool.request()
    .input('k', sql.NVarChar(100), key)
    .query('SELECT DataValue, UpdatedAt FROM dbo.AppData WHERE DataKey = @k');
  if (result.recordset.length === 0) return { value: null, version: null };
  const row = result.recordset[0];
  return { value: JSON.parse(row.DataValue), version: row.UpdatedAt.toISOString() };
}

// WITH (HOLDLOCK) trên target — cùng lỗi đã biết của SQL Server đã vá cho MERGE upsert token ở
// lib/ephemeralStore.js (audit Đợt 5, Giai đoạn 3): thiếu HOLDLOCK, 2 request cùng tạo 1 DataKey MỚI
// gần như đồng thời có thể cùng đọc thấy "chưa khớp" rồi cùng INSERT, vi phạm khoá chính thay vì
// upsert êm. Đường ghi này dùng cho MỌI key AppData (users, permGroups, collection chưa migrate sang
// dbo.Records...) nên rủi ro rộng hơn ephemeral token, dù bản thân race hiếm gặp (chỉ lộ khi key CHƯA
// từng tồn tại).
async function setAppDataValue(key, value) {
  const pool = await getPool();
  await pool.request()
    .input('k', sql.NVarChar(100), key)
    .input('v', sql.NVarChar(sql.MAX), JSON.stringify(value))
    .query(`
      MERGE dbo.AppData WITH (HOLDLOCK) AS target
      USING (SELECT @k AS DataKey) AS src
      ON target.DataKey = src.DataKey
      WHEN MATCHED THEN
        UPDATE SET DataValue = @v, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (DataKey, DataValue) VALUES (@k, @v);
    `);
  cacheInvalidate(key);
}

// Ghi CÓ ĐIỀU KIỆN: chỉ áp dụng nếu UpdatedAt hiện tại trong DB vẫn khớp đúng expectedVersion đã đọc
// trước đó — UPDATE ... WHERE ... là 1 lệnh nguyên tử ở tầng SQL Server nên an toàn trước race
// condition thật (2 request tới cùng lúc), không chỉ là kiểm tra "đọc rồi so sánh rồi ghi" ở tầng app.
// Trả rowsAffected=0 (conflict=true) nếu ai đó đã ghi đè key này sau lần client đọc gần nhất.
async function setAppDataValueIfVersionMatches(key, value, expectedVersion) {
  const pool = await getPool();
  const result = await pool.request()
    .input('k', sql.NVarChar(100), key)
    .input('v', sql.NVarChar(sql.MAX), JSON.stringify(value))
    .input('expected', sql.DateTime2(3), new Date(expectedVersion))
    .query(`
      UPDATE dbo.AppData
      SET DataValue = @v, UpdatedAt = SYSUTCDATETIME()
      WHERE DataKey = @k AND UpdatedAt = @expected;

      SELECT UpdatedAt FROM dbo.AppData WHERE DataKey = @k;
    `);
  const conflict = result.rowsAffected[0] === 0;
  const newVersion = result.recordset?.[0]?.UpdatedAt?.toISOString() || null;
  if (!conflict) cacheInvalidate(key);
  return { conflict, version: newVersion };
}

// Đọc TOÀN BỘ AppData trong 1 lượt (không kèm version) — dùng làm ngữ cảnh tra cứu (cấu hình quy
// trình theo phòng ban/loại, danh sách user...) cho routes/workflow.js, không phải nơi ghi dữ liệu.
async function getAllAppData() {
  const pool = await getPool();
  const result = await pool.request().query('SELECT DataKey, DataValue FROM dbo.AppData');
  const data = {};
  for (const row of result.recordset) {
    try { data[row.DataKey] = JSON.parse(row.DataValue); } catch (e) { data[row.DataKey] = null; }
  }
  return data;
}

// Đọc-sửa-ghi 1 collection trong 1 giao dịch có khoá dòng (UPDLOCK, HOLDLOCK) — dùng cho các thay
// đổi chỉ động tới 1 phần tử trong mảng (vd. duyệt 1 hồ sơ) để 2 request xử lý 2 hồ sơ KHÁC NHAU
// trong CÙNG collection không bị chặn nhầm lẫn nhau (khác với optimistic concurrency ở
// setAppDataValueIfVersionMatches — nơi đó phù hợp khi client tự thay cả collection nên không biết
// gộp thay đổi, còn ở đây server biết chính xác đang sửa gì nên khoá+đọc-mới-nhất+ghi là đủ an toàn
// và không gây xung đột giả giữa các hồ sơ độc lập). mutatorFn nhận mảng hiện tại, trả mảng mới cần
// lưu (hoặc throw để huỷ giao dịch, không ghi gì cả).
async function withLockedAppDataValue(key, mutatorFn) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const readReq = new sql.Request(tx);
    const readResult = await readReq
      .input('k', sql.NVarChar(100), key)
      .query('SELECT DataValue FROM dbo.AppData WITH (UPDLOCK, HOLDLOCK) WHERE DataKey = @k');
    if (readResult.recordset.length === 0) {
      throw new Error(`Key không tồn tại trong AppData: ${key}`);
    }
    const currentValue = JSON.parse(readResult.recordset[0].DataValue);

    const newValue = await mutatorFn(currentValue);

    const writeReq = new sql.Request(tx);
    await writeReq
      .input('k', sql.NVarChar(100), key)
      .input('v', sql.NVarChar(sql.MAX), JSON.stringify(newValue))
      .query('UPDATE dbo.AppData SET DataValue = @v, UpdatedAt = SYSUTCDATETIME() WHERE DataKey = @k');

    await tx.commit();
    cacheInvalidate(key);
    return newValue;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

module.exports = {
  getAppDataValue, getAppDataValueCached, getAppDataValueWithVersion, getAllAppData,
  getAllAppDataWithVersionsCached,
  setAppDataValue, setAppDataValueIfVersionMatches, withLockedAppDataValue
};
