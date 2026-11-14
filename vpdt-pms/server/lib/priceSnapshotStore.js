// lib/priceSnapshotStore.js — Snapshot "bảng giá" offline cho "💲 Kiểm Tra Giá" (dbo.StorePriceSnapshots,
// xem chú thích đầy đủ tại CREATE TABLE ở sql/schema.sql), CÙNG KHUÔN lib/inventorySnapshotStore.js
// (1 dòng/Mã Điểm, Payload giữ nguyên JSON, cache RAM ngắn hạn + tự xoá cache liên tiến trình qua PM2
// IPC) — khác ở chỗ ĐÂY LÀ "bulk giả" do jobs/priceSync.js tự dựng (đối tác không có API bulk giá thật),
// nên replaceSnapshotForMaDiem() ghi ĐÚNG 1 Mã Điểm mỗi lần (không phải ghi đè toàn bộ mọi Mã Điểm cùng
// lúc như inventorySnapshotStore.replaceSnapshot() — vì mỗi lần đồng bộ giá chỉ phục vụ ĐÚNG 1 siêu thị
// vừa có người vào tab, không phải "hứng" 1 lượt API trả về mọi siêu thị cùng lúc như Tồn Kho).
const { getPool, sql } = require('../db');

const CACHE_TTL_MS = parseInt(process.env.APPDATA_CACHE_TTL_MS || '3000', 10);
const cache = new Map(); // MaDiem -> { value, expiresAt }
const CACHE_INVALIDATE_CHANNEL = 'priceSnapshotCacheInvalidate';

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
      console.error('⛔ Không phát được tín hiệu xoá cache snapshot giá liên tiến trình:', err.message);
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
    .query('SELECT Payload, CapNhatLuc, FetchedAt FROM dbo.StorePriceSnapshots WHERE MaDiem = @maDiem');
  const value = result.recordset.length ? toEntry(result.recordset[0]) : null;
  cache.set(maDiem, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

// 1 siêu thị có thể gộp NHIỀU Mã Điểm (admin gõ "217,305" ở Danh Mục Siêu Thị khi sáp nhập 2 siêu thị cũ
// — CÙNG cơ chế đã có ở getSystemInventoryForMaDiem(), jobs/inventorySync.js) — gộp rows của mọi Mã Điểm
// đã có dữ liệu, không chặn hẳn nếu thiếu 1 trong các mã.
async function getSnapshotForMaDiemMerged(maDiemRaw) {
  if (!maDiemRaw) return null;
  const codes = [...new Set(String(maDiemRaw).split(',').map(s => s.trim()).filter(Boolean))];
  if (!codes.length) return null;
  const entries = (await Promise.all(codes.map(getSnapshotForMaDiem))).filter(Boolean);
  if (!entries.length) return null;
  if (entries.length === 1) return entries[0];
  const rows = entries.flatMap(e => e.rows || []);
  const capNhatLuc = entries.reduce((latest, e) => (e.capNhatLuc && (!latest || e.capNhatLuc > latest)) ? e.capNhatLuc : latest, null);
  const fetchedAt = entries.reduce((latest, e) => (e.fetchedAt && (!latest || e.fetchedAt > latest)) ? e.fetchedAt : latest, null);
  return { rows, capNhatLuc, fetchedAt };
}

// Ghi ĐÚNG 1 Mã Điểm (khác replaceSnapshot() nhiều-Mã-Điểm-cùng-lúc của inventorySnapshotStore.js) —
// MERGE độc lập, không đụng tới dữ liệu của Mã Điểm khác.
async function replaceSnapshotForMaDiem(maDiem, entry, fetchedAt) {
  const pool = await getPool();
  await pool.request()
    .input('maDiem', sql.NVarChar(50), maDiem)
    .input('fetchedAt', sql.DateTime2(3), fetchedAt)
    .input('capNhatLuc', sql.NVarChar(100), entry.capNhatLuc ? String(entry.capNhatLuc).slice(0, 100) : null)
    .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(entry.rows || []))
    .query(`
      MERGE dbo.StorePriceSnapshots WITH (HOLDLOCK) AS target
      USING (SELECT @maDiem AS MaDiem) AS src ON target.MaDiem = src.MaDiem
      WHEN MATCHED THEN UPDATE SET Payload = @payload, CapNhatLuc = @capNhatLuc, FetchedAt = @fetchedAt
      WHEN NOT MATCHED THEN INSERT (MaDiem, Payload, CapNhatLuc, FetchedAt) VALUES (@maDiem, @payload, @capNhatLuc, @fetchedAt);
    `);
  invalidateCache();
}

async function getSnapshotStats() {
  const pool = await getPool();
  const result = await pool.request()
    .query('SELECT COUNT(*) AS storeCount, MAX(FetchedAt) AS lastFetchedAt FROM dbo.StorePriceSnapshots');
  const row = result.recordset[0];
  return { storeCount: row.storeCount, lastFetchedAt: row.lastFetchedAt ? row.lastFetchedAt.toISOString() : null };
}

module.exports = {
  getSnapshotForMaDiem, getSnapshotForMaDiemMerged, replaceSnapshotForMaDiem, getSnapshotStats
};
