// lib/inventorySnapshotStore.js — Snapshot tồn kho hệ thống (BRGMART), mỗi dòng = 1 MÃ ĐIỂM
// (dbo.SystemInventorySnapshots, xem chú thích đầy đủ tại CREATE TABLE ở sql/schema.sql), tách khỏi
// dbo.AppData dùng chung (sự cố production 11/2026 — xem VERSION.md v29.17/v29.19). Trước đây TOÀN BỘ
// tồn kho (~650 nghìn dòng, ngày càng phình to theo số siêu thị kết nối) dồn vào 1 dòng JSON DUY NHẤT
// trong dbo.AppData, khiến MỌI request GET /api/data phải tải blob khổng lồ đó (đã vá tạm ở v29.17 bằng
// cách loại khỏi vòng đọc chung) VÀ mỗi lần Đồng Bộ phải ghi đè NGUYÊN dòng đó (khoá đúng dòng trong lúc
// ghi, ảnh hưởng MỌI siêu thị khác đang được Đối Chiếu đọc cùng lúc). Tách mỗi Mã Điểm thành 1 dòng
// riêng giải quyết TRIỆT ĐỂ cả 2: đồng bộ 1 điểm chỉ khoá ĐÚNG dòng của điểm đó, và Đối Chiếu chỉ cần
// SQL lọc đúng Mã Điểm cần (WHERE MaDiem IN (...)) thay vì tải hết rồi lọc bằng JS.
const { getPool, sql } = require('../db');
const { getAppDataValue } = require('./appData');

// Cache ngắn hạn TRONG BỘ NHỚ theo TỪNG Mã Điểm riêng (khác lib/appData.js/lib/taskStore.js ở chỗ cache
// theo NHIỀU khoá nhỏ — tối đa vài chục Mã Điểm — thay vì 1 khoá lớn gộp hết) — cùng lý do/TTL/cơ chế
// IPC PM2 cluster với các cache khác trong hệ thống (xem giải thích đầy đủ ở lib/appData.js).
const CACHE_TTL_MS = parseInt(process.env.APPDATA_CACHE_TTL_MS || '3000', 10);
const cache = new Map(); // MaDiem -> { value, expiresAt }
const CACHE_INVALIDATE_CHANNEL = 'inventorySnapshotCacheInvalidate';

if (typeof process.on === 'function') {
  process.on('message', (packet) => {
    if (packet && packet.type === 'process:msg' && packet.data && packet.data.channel === CACHE_INVALIDATE_CHANNEL) {
      cache.clear();
    }
  });
}

function invalidateCache() {
  cache.clear();
  if (typeof process.send === 'function') {
    try {
      process.send({ type: 'process:msg', data: { channel: CACHE_INVALIDATE_CHANNEL } });
    } catch (err) {
      console.error('⛔ Không phát được tín hiệu xoá cache snapshot tồn kho liên tiến trình:', err.message);
    }
  }
}

function toEntry(row) {
  return {
    rows: JSON.parse(row.Payload),
    capNhatLuc: row.CapNhatLuc || null,
    fetchedAt: row.FetchedAt ? row.FetchedAt.toISOString() : null
  };
}

async function getSnapshotForMaDiem(maDiem) {
  const hit = cache.get(maDiem);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const pool = await getPool();
  const result = await pool.request()
    .input('maDiem', sql.NVarChar(50), maDiem)
    .query('SELECT Payload, CapNhatLuc, FetchedAt FROM dbo.SystemInventorySnapshots WHERE MaDiem = @maDiem');
  const value = result.recordset.length ? toEntry(result.recordset[0]) : null;
  cache.set(maDiem, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

// NHIỀU Mã Điểm cùng lúc (gộp 2 siêu thị về 1 Mã Điểm tra cứu — xem chú thích getSystemInventoryForMaDiem()
// ở jobs/inventorySync.js) — 1 lượt SQL WHERE IN thay vì lặp gọi getSnapshotForMaDiem() nhiều lần.
async function getSnapshotMapForMaDiems(maDiems) {
  const out = {};
  const uncachedCodes = [];
  for (const code of maDiems) {
    const hit = cache.get(code);
    if (hit && hit.expiresAt > Date.now()) { if (hit.value) out[code] = hit.value; }
    else uncachedCodes.push(code);
  }
  if (uncachedCodes.length) {
    const pool = await getPool();
    const request = pool.request();
    const placeholders = uncachedCodes.map((code, i) => {
      request.input(`c${i}`, sql.NVarChar(50), code);
      return `@c${i}`;
    });
    const result = await request.query(
      `SELECT MaDiem, Payload, CapNhatLuc, FetchedAt FROM dbo.SystemInventorySnapshots WHERE MaDiem IN (${placeholders.join(',')})`
    );
    const foundCodes = new Set();
    for (const row of result.recordset) {
      const entry = toEntry(row);
      out[row.MaDiem] = entry;
      foundCodes.add(row.MaDiem);
      cache.set(row.MaDiem, { value: entry, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    for (const code of uncachedCodes) {
      if (!foundCodes.has(code)) cache.set(code, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    }
  }
  return out;
}

// Ghi đè TOÀN BỘ snapshot sau 1 lượt đồng bộ thành công — xoá các Mã Điểm KHÔNG còn trong lần đồng bộ
// mới (điểm đã đổi mã/ngừng theo dõi) + upsert từng Mã Điểm CÒN có dữ liệu. MỖI Mã Điểm là 1 MERGE ĐỘC
// LẬP trong transaction (khác hẳn trước đây ghi đè 1 dòng khổng lồ duy nhất) — khoá đúng phạm vi hẹp,
// không chặn các Mã Điểm khác đang được Đối Chiếu đọc cùng lúc. byMaDiem: { [maDiem]: { rows, capNhatLuc } }.
async function replaceSnapshot(byMaDiem, fetchedAt) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const codes = Object.keys(byMaDiem);
    const delReq = new sql.Request(tx);
    if (codes.length) {
      const placeholders = codes.map((code, i) => { delReq.input(`k${i}`, sql.NVarChar(50), code); return `@k${i}`; });
      await delReq.query(`DELETE FROM dbo.SystemInventorySnapshots WHERE MaDiem NOT IN (${placeholders.join(',')})`);
    } else {
      await delReq.query('DELETE FROM dbo.SystemInventorySnapshots');
    }
    for (const [maDiem, entry] of Object.entries(byMaDiem)) {
      const req = new sql.Request(tx);
      await req
        .input('maDiem', sql.NVarChar(50), maDiem)
        .input('fetchedAt', sql.DateTime2(3), fetchedAt)
        .input('capNhatLuc', sql.NVarChar(100), entry.capNhatLuc ? String(entry.capNhatLuc).slice(0, 100) : null)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(entry.rows || []))
        .query(`
          MERGE dbo.SystemInventorySnapshots WITH (HOLDLOCK) AS target
          USING (SELECT @maDiem AS MaDiem) AS src ON target.MaDiem = src.MaDiem
          WHEN MATCHED THEN UPDATE SET Payload = @payload, CapNhatLuc = @capNhatLuc, FetchedAt = @fetchedAt
          WHEN NOT MATCHED THEN INSERT (MaDiem, Payload, CapNhatLuc, FetchedAt) VALUES (@maDiem, @payload, @capNhatLuc, @fetchedAt);
        `);
    }
    await tx.commit();
    invalidateCache();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

async function getSnapshotStats() {
  const pool = await getPool();
  const result = await pool.request()
    .query('SELECT COUNT(*) AS storeCount, MAX(FetchedAt) AS lastFetchedAt FROM dbo.SystemInventorySnapshots');
  const row = result.recordset[0];
  return { storeCount: row.storeCount, lastFetchedAt: row.lastFetchedAt ? row.lastFetchedAt.toISOString() : null };
}

// Di trú dữ liệu CŨ (nếu còn) từ AppData.systemInventorySnapshot (1 dòng JSON khổng lồ, thiết kế trước
// đợt tách bảng này) sang bảng SystemInventorySnapshots — CHỈ chạy nếu bảng mới đang RỖNG (idempotent,
// mirror ĐÚNG khuôn lib/systemLogStore.js::migrateLegacySystemLogs()/lib/taskStore.js::migrateLegacyTasks()).
// Dữ liệu hiện có (đã đồng bộ thành công từ trước) được chuyển NGUYÊN VẸN — KHÔNG cần người dùng bấm
// "Đồng Bộ Ngay" lại, không mất dữ liệu. Xoá dòng AppData cũ SAU KHI di chuyển xong, cùng lý do
// migrateLegacySystemLogs() (tránh GET /api/data vô tình đọc lại thấy key cũ).
async function migrateLegacyInventorySnapshot() {
  const pool = await getPool();
  const countResult = await pool.request().query('SELECT COUNT(*) AS c FROM dbo.SystemInventorySnapshots');
  if (countResult.recordset[0].c > 0) return; // đã có dữ liệu -> bỏ qua

  const legacy = await getAppDataValue('systemInventorySnapshot');
  if (!legacy || !legacy.byMaDiem || !Object.keys(legacy.byMaDiem).length) return;

  const fetchedAt = legacy.fetchedAt ? new Date(legacy.fetchedAt) : new Date();
  await replaceSnapshot(legacy.byMaDiem, fetchedAt);
  await pool.request().query(`DELETE FROM dbo.AppData WHERE DataKey = 'systemInventorySnapshot'`);
  console.log(`   ↳ Đã di chuyển snapshot tồn kho cũ (${Object.keys(legacy.byMaDiem).length} Mã Điểm) sang bảng SystemInventorySnapshots.`);
}

module.exports = {
  getSnapshotForMaDiem, getSnapshotMapForMaDiems, replaceSnapshot, getSnapshotStats, migrateLegacyInventorySnapshot
};
