// routes/data.js — API generic thay thế localStorage: mỗi "collection" của app = 1 dòng trong AppData
const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');
const { DEFAULTS } = require('../defaults');

const VALID_KEYS = new Set(Object.keys(DEFAULTS));

// GET /api/data  → trả về TOÀN BỘ dữ liệu app dưới dạng { depts, cats, users, docs, ... }
// (tương đương việc đọc toàn bộ các key "dms_*" từ localStorage lúc initDatabase() trước đây)
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT DataKey, DataValue FROM dbo.AppData');

    const data = {};
    for (const row of result.recordset) {
      try {
        data[row.DataKey] = JSON.parse(row.DataValue);
      } catch (e) {
        console.error(`Lỗi parse JSON cho key "${row.DataKey}":`, e.message);
        data[row.DataKey] = null;
      }
    }
    res.json(data);
  } catch (err) {
    console.error('GET /api/data lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tải dữ liệu từ SQL Server', detail: err.message });
  }
});

// GET /api/data/:key  → trả về 1 collection cụ thể (ít dùng, tiện cho debug)
router.get('/:key', async (req, res) => {
  const { key } = req.params;
  if (!VALID_KEYS.has(key)) return res.status(400).json({ error: `Key không hợp lệ: ${key}` });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('k', sql.NVarChar(100), key)
      .query('SELECT DataValue FROM dbo.AppData WHERE DataKey = @k');

    if (result.recordset.length === 0) return res.json(DEFAULTS[key]);
    res.json(JSON.parse(result.recordset[0].DataValue));
  } catch (err) {
    console.error(`GET /api/data/${key} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể tải dữ liệu từ SQL Server', detail: err.message });
  }
});

// POST /api/data/:key  → ghi đè toàn bộ 1 collection (tương đương syncStorage(key) trước đây)
router.post('/:key', async (req, res) => {
  const { key } = req.params;
  if (!VALID_KEYS.has(key)) return res.status(400).json({ error: `Key không hợp lệ: ${key}` });

  const value = req.body;
  if (value === undefined) return res.status(400).json({ error: 'Thiếu dữ liệu (body) cần lưu' });

  try {
    const pool = await getPool();
    await pool.request()
      .input('k', sql.NVarChar(100), key)
      .input('v', sql.NVarChar(sql.MAX), JSON.stringify(value))
      .query(`
        MERGE dbo.AppData AS target
        USING (SELECT @k AS DataKey) AS src
        ON target.DataKey = src.DataKey
        WHEN MATCHED THEN
          UPDATE SET DataValue = @v, UpdatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (DataKey, DataValue) VALUES (@k, @v);
      `);
    res.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/data/${key} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể lưu dữ liệu vào SQL Server', detail: err.message });
  }
});

module.exports = router;
