'use strict';

// tests/test-system-health-audit.js
//
// Regression cho lib/systemHealthAudit.js — "🔍 Audit Hệ Thống" (11/2026, mở rộng từ "Audit Quy Trình"/
// "Audit Người Dùng" theo yêu cầu người dùng). 2 mục: B2 (tỷ lệ lỗi kỹ thuật bất thường theo ngày, đọc
// dbo.ErrorLogs) + B3 (record tham chiếu file đã mất trên đĩa uploads/) — CẢ 2 async, cần mock
// lib/errorLogStore (DB) nhưng dùng THẬT lib/recordStore.collectRecordFileUrls() (hàm thuần, không đụng
// DB) + thao tác file THẬT trên uploads/ (cùng khuôn test-audit-round2-cluster6.js — ghi/xoá file test
// có tên DUY NHẤT, dọn trong finally).
//
// Chạy: node server/tests/test-system-health-audit.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const TEST_FILE_NAME = `test-system-health-audit-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
const TEST_FILE_URL = `/uploads/${TEST_FILE_NAME}`;
const MISSING_FILE_URL = `/uploads/test-system-health-audit-missing-${Date.now()}.txt`;

let DAILY_COUNTS = [];
stubModule('lib/errorLogStore', {
  getDailyErrorCounts: async () => DAILY_COUNTS
});

const { collectRecordFileUrls } = require('../lib/recordStore'); // hàm THUẦN thật, không đụng DB
let RECORDS_BY_COLLECTION = {};
stubModule('lib/recordStore', {
  DEDICATED_TABLES: { fakeCollectionA: {} },
  getAllDedicatedRecords: async (collection) => RECORDS_BY_COLLECTION[collection] || [],
  collectRecordFileUrls
});

const { auditSystemHealthGaps, computeFindingsSignature } = require('../lib/systemHealthAudit');

let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

function flatDays(countsArr) {
  // countsArr: mảng 8 số nguyên, PHẦN TỬ CUỐI là "hôm nay".
  const out = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push({ date: d.toISOString().slice(0, 10), count: countsArr[7 - i] });
  }
  return out;
}

(async () => {
  // ===== B2: tỷ lệ lỗi hệ thống bất thường =====
  await run('B2: hôm nay 5 lỗi (dưới MIN_ABS=10) dù baseline=0 -> KHÔNG báo', async () => {
    DAILY_COUNTS = flatDays([0, 0, 0, 0, 0, 0, 0, 5]);
    RECORDS_BY_COLLECTION = {};
    const findings = await auditSystemHealthGaps();
    assert.ok(!findings.some(f => f.type === 'ABNORMAL_ERROR_RATE'));
  });

  await run('B2: hôm nay 60 lỗi, baseline 2 lỗi/ngày (ratio 30x) -> CRITICAL', async () => {
    DAILY_COUNTS = flatDays([2, 2, 2, 2, 2, 2, 2, 60]);
    RECORDS_BY_COLLECTION = {};
    const findings = await auditSystemHealthGaps();
    const f = findings.find(f => f.type === 'ABNORMAL_ERROR_RATE');
    assert.ok(f && f.severity === 'CRITICAL', JSON.stringify(findings));
  });

  await run('B2: hôm nay 30 lỗi, baseline 10 lỗi/ngày (ratio 3x) -> WARNING', async () => {
    DAILY_COUNTS = flatDays([10, 10, 10, 10, 10, 10, 10, 30]);
    RECORDS_BY_COLLECTION = {};
    const findings = await auditSystemHealthGaps();
    const f = findings.find(f => f.type === 'ABNORMAL_ERROR_RATE');
    assert.ok(f && f.severity === 'WARNING', JSON.stringify(findings));
  });

  await run('B2: hôm nay 15 lỗi, baseline 12 lỗi/ngày (ratio ~1.25x, dưới ngưỡng) -> KHÔNG báo', async () => {
    DAILY_COUNTS = flatDays([12, 12, 12, 12, 12, 12, 12, 15]);
    RECORDS_BY_COLLECTION = {};
    const findings = await auditSystemHealthGaps();
    assert.ok(!findings.some(f => f.type === 'ABNORMAL_ERROR_RATE'));
  });

  // ===== B3: record trỏ tới file đã mất trên đĩa =====
  await run('B3: record tham chiếu file THẬT đang tồn tại -> KHÔNG báo', async () => {
    DAILY_COUNTS = flatDays([0, 0, 0, 0, 0, 0, 0, 0]);
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, TEST_FILE_NAME), 'noi dung test');
    try {
      RECORDS_BY_COLLECTION = { fakeCollectionA: [{ id: 1, fileUrl: TEST_FILE_URL }] };
      const findings = await auditSystemHealthGaps();
      assert.ok(!findings.some(f => f.type === 'MISSING_FILE'));
    } finally {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, TEST_FILE_NAME)); } catch (e) { /* đã xoá rồi */ }
    }
  });

  await run('B3: record tham chiếu file KHÔNG tồn tại trên đĩa -> WARNING, đúng tên collection/id', async () => {
    DAILY_COUNTS = flatDays([0, 0, 0, 0, 0, 0, 0, 0]);
    RECORDS_BY_COLLECTION = { fakeCollectionA: [{ id: 42, fileUrl: MISSING_FILE_URL }] };
    const findings = await auditSystemHealthGaps();
    const f = findings.find(f => f.type === 'MISSING_FILE');
    assert.ok(f && f.severity === 'WARNING', JSON.stringify(findings));
    assert.ok(f.scopeLabel.includes('fakeCollectionA') && f.scopeLabel.includes('42'), f.scopeLabel);
    assert.ok(f.reason.includes(MISSING_FILE_URL), f.reason);
  });

  await run('B3: record KHÔNG có field fileUrl nào -> KHÔNG báo, không throw', async () => {
    DAILY_COUNTS = flatDays([0, 0, 0, 0, 0, 0, 0, 0]);
    RECORDS_BY_COLLECTION = { fakeCollectionA: [{ id: 1, name: 'không có file' }] };
    const findings = await auditSystemHealthGaps();
    assert.ok(!findings.some(f => f.type === 'MISSING_FILE'));
  });

  await run('computeFindingsSignature(): không phụ thuộc thứ tự, đổi khi có phát hiện mới', async () => {
    const a = [{ type: 'X', scopeLabel: 's1', severity: 'WARNING' }, { type: 'Y', scopeLabel: 's2', severity: 'CRITICAL' }];
    const b = [{ type: 'Y', scopeLabel: 's2', severity: 'CRITICAL' }, { type: 'X', scopeLabel: 's1', severity: 'WARNING' }];
    assert.strictEqual(computeFindingsSignature(a), computeFindingsSignature(b));
    const c = [...a, { type: 'Z', scopeLabel: 's3', severity: 'INFO' }];
    assert.notStrictEqual(computeFindingsSignature(a), computeFindingsSignature(c));
  });

  await run('auditSystemHealthGaps() không throw khi collection lỗi (getAllDedicatedRecords reject)', async () => {
    DAILY_COUNTS = flatDays([0, 0, 0, 0, 0, 0, 0, 0]);
    RECORDS_BY_COLLECTION = null; // getAllDedicatedRecords(collection) -> RECORDS_BY_COLLECTION[collection] throws (null.xxx)
    const findings = await auditSystemHealthGaps();
    assert.ok(Array.isArray(findings));
  });

  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
